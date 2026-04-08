"""AI Worker — processes LLM tasks from Redis queue using arq.

Task types:
- ai_analyze_finances
- ai_analyze_portfolio
- ai_analyze_ticker
- ai_analyze_expenses
- ai_model_savings
- ai_generate_digest
- ai_chat
"""
import asyncio
import logging
from decimal import Decimal

from arq import create_pool
from arq.connections import RedisSettings, ArqRedis

from src.config import settings
from src.database import async_session
from src.services.ai.llm_provider import ClaudeProvider, FallbackProvider
from src.services.ai.service import AIService
from src.services.billing_service import InsufficientBalanceError
from src.services.ai.llm_provider import LLMError

logger = logging.getLogger(__name__)


def _parse_redis_url(url: str) -> RedisSettings:
    """Parse Redis URL into arq RedisSettings."""
    # redis://host:port/db
    from urllib.parse import urlparse
    parsed = urlparse(url)
    return RedisSettings(
        host=parsed.hostname or "localhost",
        port=parsed.port or 6379,
        database=int(parsed.path.lstrip("/") or "0"),
    )


def _create_provider() -> FallbackProvider:
    """Create LLM provider with fallback."""
    claude = ClaudeProvider(api_key=settings.anthropic_api_key, base_url=settings.anthropic_base_url)
    return FallbackProvider([claude])


async def ai_analyze_finances(ctx: dict, user_id: int) -> dict:
    """Process financial analysis request."""
    return await _process_ai_task(ctx, user_id, "analyze_finances")


async def ai_analyze_portfolio(ctx: dict, user_id: int) -> dict:
    """Process portfolio analysis request."""
    return await _process_ai_task(ctx, user_id, "analyze_portfolio")


async def ai_analyze_ticker(ctx: dict, user_id: int, ticker: str) -> dict:
    """Process ticker analysis request."""
    return await _process_ai_task(
        ctx, user_id, "analyze_ticker", ticker=ticker,
    )


async def ai_analyze_expenses(ctx: dict, user_id: int) -> dict:
    """Process expense analysis request."""
    return await _process_ai_task(ctx, user_id, "analyze_expenses")


async def ai_model_savings(
    ctx: dict, user_id: int, goal: str, amount: float, deadline: str,
) -> dict:
    """Process savings modeling request."""
    return await _process_ai_task(
        ctx, user_id, "model_savings",
        goal=goal, amount=Decimal(str(amount)), deadline=deadline,
    )


async def ai_generate_digest(ctx: dict, user_id: int, period: str = "daily") -> dict:
    """Process digest generation request."""
    return await _process_ai_task(
        ctx, user_id, "generate_digest", period=period,
    )


async def ai_chat(ctx: dict, user_id: int, message: str) -> dict:
    """Process free-form chat request."""
    return await _process_ai_task(ctx, user_id, "chat", message=message)


async def _process_ai_task(
    ctx: dict,
    user_id: int,
    task_type: str,
    **kwargs,
) -> dict:
    """Generic AI task processor."""
    try:
        provider = ctx.get("provider") or _create_provider()

        async with async_session() as db:
            service = AIService(db, provider)

            if task_type == "analyze_finances":
                result = await service.analyze_finances(user_id)
            elif task_type == "analyze_portfolio":
                result = await service.analyze_portfolio(user_id)
            elif task_type == "analyze_ticker":
                result = await service.analyze_ticker(user_id, kwargs["ticker"])
            elif task_type == "analyze_expenses":
                result = await service.analyze_expenses(user_id)
            elif task_type == "model_savings":
                result = await service.model_savings(
                    user_id, kwargs["goal"], kwargs["amount"], kwargs["deadline"],
                )
            elif task_type == "generate_digest":
                result = await service.generate_digest(user_id, kwargs.get("period", "daily"))
            elif task_type == "chat":
                result = await service.chat(user_id, kwargs["message"])
            else:
                return {"ok": False, "error": f"Unknown task type: {task_type}"}

        return {"ok": True, "result": result, "user_id": user_id}

    except InsufficientBalanceError as e:
        logger.warning("Insufficient balance for user %d: %s", user_id, e)
        return {"ok": False, "error": "insufficient_balance", "user_id": user_id}
    except LLMError as e:
        logger.error("LLM error for user %d: %s", user_id, e)
        return {"ok": False, "error": f"llm_error: {e}", "user_id": user_id}
    except Exception as e:
        logger.exception("Unexpected error in AI task for user %d", user_id)
        return {"ok": False, "error": str(e), "user_id": user_id}


async def startup(ctx: dict) -> None:
    """Worker startup hook — initialize provider."""
    logger.info("AI Worker starting up")
    if settings.anthropic_api_key:
        ctx["provider"] = _create_provider()
    else:
        logger.warning("No ANTHROPIC_API_KEY configured — AI tasks will fail")


async def shutdown(ctx: dict) -> None:
    """Worker shutdown hook."""
    logger.info("AI Worker shutting down")


class WorkerSettings:
    """arq worker settings."""
    redis_settings = _parse_redis_url(settings.redis_url)
    functions = [
        ai_analyze_finances,
        ai_analyze_portfolio,
        ai_analyze_ticker,
        ai_analyze_expenses,
        ai_model_savings,
        ai_generate_digest,
        ai_chat,
    ]
    on_startup = startup
    on_shutdown = shutdown
    max_jobs = 5
    job_timeout = 60  # LLM calls can take up to 30s


async def enqueue_ai_task(
    redis: ArqRedis,
    task_type: str,
    user_id: int,
    **kwargs,
) -> str | None:
    """Enqueue an AI task to the Redis queue.

    Returns job ID or None if enqueue fails.
    """
    func_map = {
        "analyze_finances": "ai_analyze_finances",
        "analyze_portfolio": "ai_analyze_portfolio",
        "analyze_ticker": "ai_analyze_ticker",
        "analyze_expenses": "ai_analyze_expenses",
        "model_savings": "ai_model_savings",
        "generate_digest": "ai_generate_digest",
        "chat": "ai_chat",
    }
    func_name = func_map.get(task_type)
    if not func_name:
        logger.error("Unknown AI task type: %s", task_type)
        return None

    try:
        job = await redis.enqueue_job(func_name, user_id, **kwargs)
        if job:
            return job.job_id
    except Exception as e:
        logger.error("Failed to enqueue AI task: %s", e)

    return None


def main():
    """Main entry point — run the arq worker."""
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    from arq import run_worker
    run_worker(WorkerSettings)


if __name__ == "__main__":
    main()
