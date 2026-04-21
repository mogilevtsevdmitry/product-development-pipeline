"""
Бюджеты агентов и stuck-detector.

Заменяет одиночный 10-минутный timeout на:
- per-agent timeout (общий лимит выполнения)
- max_idle_seconds (максимум без новой строки в stdout)

Если агент молчит дольше max_idle_seconds — считаем, что он застрял.
"""

import json
import os
import select
import signal
import subprocess
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Optional


@dataclass
class AgentBudget:
    """Бюджет на запуск агента."""
    timeout_seconds: int = 900       # общий лимит
    max_idle_seconds: int = 240      # без вывода = застрял
    label: str = "default"


# Дефолт + per-agent overrides
DEFAULT_BUDGET = AgentBudget(timeout_seconds=900, max_idle_seconds=240, label="default")

AGENT_BUDGETS: Dict[str, AgentBudget] = {
    # Тяжёлые агенты — больше времени, больше idle-окно
    "backend-developer":  AgentBudget(timeout_seconds=2400, max_idle_seconds=420, label="heavy"),
    "frontend-developer": AgentBudget(timeout_seconds=2400, max_idle_seconds=420, label="heavy"),
    "system-architect":   AgentBudget(timeout_seconds=1800, max_idle_seconds=360, label="heavy"),
    "ux-ui-designer":     AgentBudget(timeout_seconds=1800, max_idle_seconds=360, label="heavy"),
    "qa-engineer":        AgentBudget(timeout_seconds=1800, max_idle_seconds=360, label="heavy"),
    # Лёгкие агенты — короче лимиты
    "telegram-poster":    AgentBudget(timeout_seconds=300, max_idle_seconds=120, label="light"),
    "instagram-poster":   AgentBudget(timeout_seconds=300, max_idle_seconds=120, label="light"),
}


def get_budget(agent_id: str) -> AgentBudget:
    """Возвращает бюджет для агента (или дефолт)."""
    return AGENT_BUDGETS.get(agent_id, DEFAULT_BUDGET)


class AgentTimeout(RuntimeError):
    """Агент превысил общий timeout."""


class AgentStuck(RuntimeError):
    """Агент молчит дольше max_idle_seconds."""


class AgentRateLimited(RuntimeError):
    """Claude API rate limit. resets_at — unix timestamp когда сбросится."""
    def __init__(self, resets_at: int, kind: str = "five_hour"):
        self.resets_at = int(resets_at)
        self.kind = kind
        super().__init__(
            f"Rate limit ({kind}); resets at {time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(self.resets_at))}"
        )


class AgentAuthError(RuntimeError):
    """Транзиентный 401 от Anthropic API (после 10 внутренних retry CLI всё равно auth_failed).

    Чаще всего — серверный сбой Anthropic, не реально протухший токен.
    Стратегия: подождать N секунд и повторить.
    """
    def __init__(self, message: str = "API 401 authentication_failed"):
        super().__init__(message)


def run_with_budget(
    cmd: list,
    cwd: Path,
    env: Dict[str, str],
    budget: AgentBudget,
    log_file: Optional[Path] = None,
) -> str:
    """Запускает subprocess с контролем времени и stuck-детектором.

    Читает stdout построчно, отслеживает время последней строки.
    При превышении лимитов — отправляет SIGTERM, потом SIGKILL.

    Returns:
        Полный stdout процесса.

    Raises:
        AgentTimeout: общий timeout превышен.
        AgentStuck: процесс не пишет дольше max_idle_seconds.
        RuntimeError: ненулевой exit-код.
    """
    start_time = time.monotonic()
    last_output_at = start_time
    chunks: list = []
    rate_limit_info: Optional[Dict] = None
    auth_error_seen: bool = False

    proc = subprocess.Popen(
        cmd,
        cwd=str(cwd),
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        bufsize=1,
        text=True,
    )

    log_fp = None
    if log_file is not None:
        log_file.parent.mkdir(parents=True, exist_ok=True)
        log_fp = log_file.open("a", encoding="utf-8")
        log_fp.write(
            f"\n=== run @ {time.strftime('%Y-%m-%dT%H:%M:%S')} "
            f"budget={budget.label} timeout={budget.timeout_seconds}s "
            f"idle={budget.max_idle_seconds}s ===\n"
        )

    try:
        assert proc.stdout is not None
        fd = proc.stdout.fileno()
        while True:
            now = time.monotonic()
            elapsed = now - start_time
            idle = now - last_output_at

            if elapsed > budget.timeout_seconds:
                _terminate(proc)
                raise AgentTimeout(
                    f"Агент превысил timeout {budget.timeout_seconds}s"
                )
            if idle > budget.max_idle_seconds:
                _terminate(proc)
                raise AgentStuck(
                    f"Агент молчит {int(idle)}s "
                    f"(порог {budget.max_idle_seconds}s)"
                )

            # Ждём строку, но не дольше 5 секунд — чтобы регулярно проверять бюджет
            ready, _, _ = select.select([fd], [], [], 5.0)
            if ready:
                line = proc.stdout.readline()
                if line == "":
                    # EOF
                    break
                chunks.append(line)
                last_output_at = time.monotonic()
                if log_fp is not None:
                    log_fp.write(line)
                    log_fp.flush()
                # Парсим rate_limit_event на лету — будем знать сразу, до завершения процесса
                rl = _parse_rate_limit_line(line)
                if rl is not None:
                    rate_limit_info = rl
                if _line_indicates_auth_failure(line):
                    auth_error_seen = True

            if proc.poll() is not None and not ready:
                # Процесс завершился, прочитаем остаток
                rest = proc.stdout.read()
                if rest:
                    chunks.append(rest)
                    if log_fp is not None:
                        log_fp.write(rest)
                break

        rc = proc.wait()
        if rate_limit_info is not None:
            raise AgentRateLimited(
                resets_at=rate_limit_info.get("resetsAt", 0),
                kind=rate_limit_info.get("rateLimitType", "unknown"),
            )
        if auth_error_seen:
            raise AgentAuthError(
                f"Anthropic API 401 после внутренних retry CLI. "
                f"Хвост вывода:\n{''.join(chunks[-5:])}"
            )
        if rc != 0:
            raise RuntimeError(
                f"Процесс завершился с кодом {rc}. "
                f"Хвост вывода:\n{''.join(chunks[-20:])}"
            )

        return "".join(chunks)

    finally:
        if log_fp is not None:
            log_fp.close()
        if proc.poll() is None:
            _terminate(proc)


def _line_indicates_auth_failure(line: str) -> bool:
    """True если строка stream-json — финальный результат с api_error_status=401 / authentication_failed."""
    line = line.strip()
    if not line.startswith("{"):
        return False
    if "api_error_status" not in line and "authentication_failed" not in line:
        return False
    try:
        obj = json.loads(line)
    except json.JSONDecodeError:
        return False
    if obj.get("type") == "result" and obj.get("api_error_status") == 401:
        return True
    if obj.get("error") == "authentication_failed":
        return True
    return False


def _parse_rate_limit_line(line: str) -> Optional[Dict]:
    """Возвращает rate_limit_info если строка stream-json содержит rejected rate_limit_event."""
    line = line.strip()
    if not line.startswith("{") or "rate_limit_event" not in line:
        return None
    try:
        obj = json.loads(line)
    except json.JSONDecodeError:
        return None
    if obj.get("type") != "rate_limit_event":
        return None
    info = obj.get("rate_limit_info", {})
    if info.get("status") != "rejected":
        return None
    return info


def _terminate(proc: subprocess.Popen) -> None:
    """Аккуратно завершает процесс: SIGTERM → ждём 3с → SIGKILL."""
    try:
        proc.terminate()
        try:
            proc.wait(timeout=3)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait(timeout=2)
    except (ProcessLookupError, OSError):
        pass
