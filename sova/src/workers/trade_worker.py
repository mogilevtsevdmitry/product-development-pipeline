"""Trade Worker — executes trade orders via T-Bank API using arq.

Processes 'execute_trade' tasks from Redis queue:
1. Fetches order from DB
2. Submits to T-Bank API via TradeService
3. Updates order status (executed/failed)
4. Sends notification to user via bot

Rate limit: max 10 orders/minute per user.
"""

import asyncio
import logging
import time
from collections import defaultdict
from decimal import Decimal

from arq import create_pool
from arq.connections import RedisSettings, ArqRedis

from src.config import settings
from src.database import async_session
from src.services.trade_service import TradeService, TradeError
from src.services.tbank.client import TBankClient

logger = logging.getLogger(__name__)

# Rate limit: max 10 orders per minute per user
MAX_ORDERS_PER_MINUTE = 10
_user_order_times: dict[int, list[float]] = defaultdict(list)


def _parse_redis_url(url: str) -> RedisSettings:
    """Parse Redis URL into arq RedisSettings."""
    from urllib.parse import urlparse
    parsed = urlparse(url)
    return RedisSettings(
        host=parsed.hostname or "localhost",
        port=parsed.port or 6379,
        database=int(parsed.path.lstrip("/") or "0"),
    )


def _check_rate_limit(user_id: int) -> bool:
    """Check if user has exceeded rate limit.

    Returns True if within limit, False if exceeded.
    """
    now = time.monotonic()
    cutoff = now - 60.0
    # Remove old entries
    _user_order_times[user_id] = [
        t for t in _user_order_times[user_id] if t > cutoff
    ]
    if len(_user_order_times[user_id]) >= MAX_ORDERS_PER_MINUTE:
        return False
    _user_order_times[user_id].append(now)
    return True


def _create_tbank_client() -> TBankClient | None:
    """Create TBankClient if token is available."""
    # T-Bank tokens are per-user, stored in integrations.
    # For the worker, we'll create clients on demand from integration tokens.
    return None


async def execute_trade(
    ctx: dict,
    order_id: str,
    user_id: int,
) -> dict:
    """Execute a trade order.

    Args:
        ctx: arq context
        order_id: UUID string of the TradeOrder
        user_id: Telegram user ID (for rate limiting and notification)

    Returns:
        dict with 'ok', 'status', 'user_id', 'order_id'
    """
    import uuid

    # Rate limit check
    if not _check_rate_limit(user_id):
        logger.warning("Rate limit exceeded for user %d", user_id)
        return {
            "ok": False,
            "error": "rate_limit_exceeded",
            "user_id": user_id,
            "order_id": order_id,
        }

    try:
        order_uuid = uuid.UUID(order_id)
    except (ValueError, TypeError):
        return {
            "ok": False,
            "error": f"Invalid order_id: {order_id}",
            "user_id": user_id,
            "order_id": order_id,
        }

    try:
        async with async_session() as db:
            # Get T-Bank client for this user
            tbank_client = await _get_user_tbank_client(db, user_id)

            service = TradeService(db, tbank_client)
            order = await service.execute_order(order_uuid)

            return {
                "ok": order.status == "executed",
                "status": order.status,
                "user_id": user_id,
                "order_id": order_id,
                "tbank_order_id": order.tbank_order_id,
            }

    except TradeError as e:
        logger.error("Trade error for order %s: %s", order_id, e)
        return {
            "ok": False,
            "error": str(e),
            "user_id": user_id,
            "order_id": order_id,
        }
    except Exception as e:
        logger.exception("Unexpected error executing order %s", order_id)
        return {
            "ok": False,
            "error": str(e),
            "user_id": user_id,
            "order_id": order_id,
        }


async def _get_user_tbank_client(db, user_id: int) -> TBankClient | None:
    """Get a TBankClient configured with the user's T-Bank token."""
    from src.services.integration_service import IntegrationService
    from src.services.encryption_service import EncryptionService

    try:
        encryption = EncryptionService(settings.encryption_key)
        integration_svc = IntegrationService(db, encryption)
        token = await integration_svc.get_access_token(user_id, "tbank")
        if token:
            return TBankClient(
                token=token,
                sandbox=settings.tbank_sandbox,
            )
    except Exception as e:
        logger.warning("Failed to get T-Bank client for user %d: %s", user_id, e)

    return None


# ------------------------------------------------------------------
# arq worker lifecycle
# ------------------------------------------------------------------


async def startup(ctx: dict) -> None:
    """Worker startup hook."""
    logger.info("Trade Worker starting up")


async def shutdown(ctx: dict) -> None:
    """Worker shutdown hook."""
    logger.info("Trade Worker shutting down")


class WorkerSettings:
    """arq worker settings for Trade Worker."""
    redis_settings = _parse_redis_url(settings.redis_url)
    functions = [execute_trade]
    on_startup = startup
    on_shutdown = shutdown
    max_jobs = 5
    job_timeout = 30


async def enqueue_trade(
    redis: ArqRedis,
    order_id: str,
    user_id: int,
) -> str | None:
    """Enqueue a trade execution task.

    Returns job ID or None if enqueue fails.
    """
    try:
        job = await redis.enqueue_job(
            "execute_trade",
            order_id,
            user_id,
        )
        if job:
            return job.job_id
    except Exception as e:
        logger.error("Failed to enqueue trade: %s", e)
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
