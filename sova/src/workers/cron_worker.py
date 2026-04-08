"""Cron Worker — periodic sync tasks using APScheduler.

Jobs:
- sync_zenmoney_all: every 4 hours — sync all active ZenMoney integrations
- sync_tbank_all: every hour, 7:00-23:00 MSK — sync all active T-Bank integrations
- refresh_tokens: every 30 minutes — refresh expiring ZenMoney tokens
- cleanup_news_cache: daily — delete expired cache entries (stub)
"""
import asyncio
import logging

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger

from src.config import settings
from src.database import async_session
from src.services.encryption_service import EncryptionService
from src.services.integration_service import IntegrationService
from src.services.zenmoney.sync import ZenMoneySyncService
from src.services.zenmoney.token_refresh import ZenMoneyTokenRefresher
from src.services.tbank.sync import TBankSyncService

logger = logging.getLogger(__name__)


async def sync_zenmoney_all() -> None:
    """Sync all active ZenMoney integrations."""
    logger.info("Starting ZenMoney sync for all users")
    async with async_session() as db:
        encryption = EncryptionService(settings.encryption_key)
        int_service = IntegrationService(db, encryption)
        integrations = await int_service.get_active_integrations_by_type("zenmoney")

        logger.info("Found %d active ZenMoney integrations", len(integrations))
        for integration in integrations:
            try:
                sync_service = ZenMoneySyncService(db, encryption)
                await sync_service.sync(integration)
            except Exception as e:
                logger.error(
                    "ZenMoney sync failed for user %d: %s",
                    integration.user_id,
                    str(e),
                )


async def sync_tbank_all() -> None:
    """Sync all active T-Bank Invest integrations."""
    logger.info("Starting T-Bank sync for all users")
    async with async_session() as db:
        encryption = EncryptionService(settings.encryption_key)
        int_service = IntegrationService(db, encryption)
        integrations = await int_service.get_active_integrations_by_type("tbank_invest")

        logger.info("Found %d active T-Bank integrations", len(integrations))
        for integration in integrations:
            try:
                sync_service = TBankSyncService(db, encryption)
                await sync_service.sync(integration)
            except Exception as e:
                logger.error(
                    "T-Bank sync failed for user %d: %s",
                    integration.user_id,
                    str(e),
                )


async def refresh_tokens() -> None:
    """Check and refresh ZenMoney tokens expiring within 5 minutes."""
    logger.info("Starting token refresh check")
    async with async_session() as db:
        encryption = EncryptionService(settings.encryption_key)
        int_service = IntegrationService(db, encryption)
        integrations = await int_service.get_active_integrations_by_type("zenmoney")

        refresher = ZenMoneyTokenRefresher(db, encryption)
        refreshed = 0
        failed = 0

        for integration in integrations:
            try:
                token = await refresher.ensure_valid_token(integration)
                if token is None:
                    failed += 1
                    logger.warning(
                        "Token refresh failed for user %d — integration disconnected",
                        integration.user_id,
                    )
                else:
                    refreshed += 1
            except Exception as e:
                failed += 1
                logger.error(
                    "Token refresh error for user %d: %s",
                    integration.user_id,
                    str(e),
                )

        logger.info("Token refresh done: %d ok, %d failed", refreshed, failed)


async def cleanup_news_cache() -> None:
    """Delete expired news cache entries (stub for Plan 7)."""
    logger.info("News cache cleanup: stub — nothing to do yet")


def create_scheduler() -> AsyncIOScheduler:
    """Create and configure APScheduler with sync jobs."""
    scheduler = AsyncIOScheduler()

    # ZenMoney: every 4 hours
    scheduler.add_job(
        sync_zenmoney_all,
        trigger=IntervalTrigger(hours=4),
        id="sync_zenmoney",
        name="Sync ZenMoney (all users)",
        replace_existing=True,
    )

    # T-Bank: every hour, 7:00-23:00 MSK
    scheduler.add_job(
        sync_tbank_all,
        trigger=CronTrigger(hour="7-23", minute=0, timezone="Europe/Moscow"),
        id="sync_tbank",
        name="Sync T-Bank Invest (all users)",
        replace_existing=True,
    )

    # Token refresh: every 30 minutes
    scheduler.add_job(
        refresh_tokens,
        trigger=IntervalTrigger(minutes=30),
        id="refresh_tokens",
        name="Refresh expiring ZenMoney tokens",
        replace_existing=True,
    )

    # News cache cleanup: daily at 4:00 AM MSK
    scheduler.add_job(
        cleanup_news_cache,
        trigger=CronTrigger(hour=4, minute=0, timezone="Europe/Moscow"),
        id="cleanup_news_cache",
        name="Cleanup expired news cache",
        replace_existing=True,
    )

    return scheduler


async def main():
    """Main entry point for the cron worker process."""
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    logger.info("Cron Worker starting")

    scheduler = create_scheduler()
    scheduler.start()
    logger.info("Cron Worker started, scheduled jobs: %s", [j.id for j in scheduler.get_jobs()])

    try:
        # Keep the worker running
        while True:
            await asyncio.sleep(60)
    except (KeyboardInterrupt, SystemExit):
        logger.info("Cron Worker shutting down")
        scheduler.shutdown()


if __name__ == "__main__":
    asyncio.run(main())
