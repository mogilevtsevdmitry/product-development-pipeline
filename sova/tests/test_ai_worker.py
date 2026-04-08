"""Tests for AI Worker — arq task processing."""

import pytest
from decimal import Decimal
from unittest.mock import AsyncMock, patch, MagicMock

from src.workers.ai_worker import (
    ai_analyze_finances,
    ai_chat,
    ai_generate_digest,
    ai_analyze_ticker,
    _process_ai_task,
    WorkerSettings,
    _parse_redis_url,
)
from src.services.user_service import UserService
from src.services.billing_service import BillingService
from src.services.ai.llm_provider import LLMProvider


async def _create_funded_user(db, user_id: int = 700001):
    service = UserService(db)
    await service.get_or_create(user_id, "worker_test", "WT")
    billing = BillingService(db)
    await billing.topup(user_id, Decimal("100"), 50, "tg_w", f"topup_w_{user_id}")


def _mock_provider() -> AsyncMock:
    provider = AsyncMock(spec=LLMProvider)
    provider.complete = AsyncMock(return_value="Worker AI result")
    provider.categorize = AsyncMock(return_value="Еда")
    return provider


# ------------------------------------------------------------------
# _parse_redis_url
# ------------------------------------------------------------------


def test_parse_redis_url():
    """Should parse Redis URL correctly."""
    settings = _parse_redis_url("redis://myhost:6380/2")
    assert settings.host == "myhost"
    assert settings.port == 6380
    assert settings.database == 2


def test_parse_redis_url_defaults():
    """Should use defaults for missing parts."""
    settings = _parse_redis_url("redis://localhost/0")
    assert settings.host == "localhost"
    assert settings.database == 0


# ------------------------------------------------------------------
# WorkerSettings
# ------------------------------------------------------------------


def test_worker_settings_has_functions():
    """WorkerSettings should define all AI task functions."""
    func_names = [f.__name__ for f in WorkerSettings.functions]
    assert "ai_analyze_finances" in func_names
    assert "ai_analyze_portfolio" in func_names
    assert "ai_analyze_ticker" in func_names
    assert "ai_analyze_expenses" in func_names
    assert "ai_model_savings" in func_names
    assert "ai_generate_digest" in func_names
    assert "ai_chat" in func_names


def test_worker_settings_has_lifecycle_hooks():
    """WorkerSettings should have startup/shutdown hooks."""
    assert WorkerSettings.on_startup is not None
    assert WorkerSettings.on_shutdown is not None


# ------------------------------------------------------------------
# _process_ai_task
# ------------------------------------------------------------------


async def test_process_task_success(db):
    """Should process task and return ok result."""
    await _create_funded_user(db, 700001)
    provider = _mock_provider()
    ctx = {"provider": provider}

    with patch("src.workers.ai_worker.async_session") as mock_session:
        mock_session.return_value.__aenter__ = AsyncMock(return_value=db)
        mock_session.return_value.__aexit__ = AsyncMock(return_value=False)

        result = await _process_ai_task(ctx, 700001, "analyze_finances")

    assert result["ok"] is True
    assert "result" in result


async def test_process_task_insufficient_balance(db):
    """Should return insufficient_balance error."""
    service = UserService(db)
    await service.get_or_create(700002, "broke_test", "BT")
    # No top-up — user has 0 balance

    provider = _mock_provider()
    ctx = {"provider": provider}

    with patch("src.workers.ai_worker.async_session") as mock_session:
        mock_session.return_value.__aenter__ = AsyncMock(return_value=db)
        mock_session.return_value.__aexit__ = AsyncMock(return_value=False)

        result = await _process_ai_task(ctx, 700002, "analyze_finances")

    assert result["ok"] is False
    assert result["error"] == "insufficient_balance"


async def test_process_task_unknown_type(db):
    """Should return error for unknown task type."""
    await _create_funded_user(db, 700003)
    provider = _mock_provider()
    ctx = {"provider": provider}

    with patch("src.workers.ai_worker.async_session") as mock_session:
        mock_session.return_value.__aenter__ = AsyncMock(return_value=db)
        mock_session.return_value.__aexit__ = AsyncMock(return_value=False)

        result = await _process_ai_task(ctx, 700003, "nonexistent_type")

    assert result["ok"] is False
    assert "Unknown task type" in result["error"]
