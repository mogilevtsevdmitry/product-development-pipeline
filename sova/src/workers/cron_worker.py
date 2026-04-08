"""Cron Worker — periodic sync tasks using APScheduler.

Jobs:
- sync_zenmoney_all: every 4 hours — sync all active ZenMoney integrations
- sync_tbank_all: every hour, 7:00-23:00 MSK — sync all active T-Bank integrations
- refresh_tokens: every 30 minutes — refresh expiring ZenMoney tokens
- parse_news: every 2 hours — fetch news from RSS/API sources
- cleanup_news_cache: daily — delete expired cache entries
- check_large_expenses: every hour — detect unusually large expenses
- check_portfolio_drops: every hour, 7:00-23:00 — portfolio P&L alerts
- fetch_exchange_rates: every 4 hours — USD, EUR, CNY from CBR
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


async def generate_daily_digests() -> None:
    """Generate daily digests for users who have them enabled."""
    logger.info("Starting daily digest generation")
    async with async_session() as db:
        from sqlalchemy import select
        from src.models.user import User
        from src.services.ai.llm_provider import ClaudeProvider, FallbackProvider
        from src.services.ai.service import AIService

        # Find users with daily digest enabled
        result = await db.execute(
            select(User).where(
                User.onboarding_completed.is_(True),
            )
        )
        users = list(result.scalars().all())

        if not settings.anthropic_api_key:
            logger.warning("No ANTHROPIC_API_KEY — skipping digest generation")
            return

        provider = FallbackProvider([ClaudeProvider(api_key=settings.anthropic_api_key, base_url=settings.anthropic_base_url)])
        generated = 0
        failed = 0

        for user in users:
            # Check if user has digest notifications enabled
            notif = user.notification_settings or {}
            if not notif.get("daily_digest", False):
                continue

            try:
                service = AIService(db, provider)
                # Check if user has enough balance
                from src.services.billing_service import BillingService
                billing = BillingService(db)
                has_balance = await billing.has_sufficient_balance(
                    user.telegram_id, service.get_cost("generate_digest"),
                )
                if not has_balance:
                    logger.info("User %d: insufficient balance for digest", user.telegram_id)
                    continue

                await service.generate_digest(user.telegram_id, "daily")
                generated += 1
                logger.info("Generated digest for user %d", user.telegram_id)

            except Exception as e:
                failed += 1
                logger.error(
                    "Digest generation failed for user %d: %s",
                    user.telegram_id, str(e),
                )

        logger.info("Digest generation done: %d generated, %d failed", generated, failed)


async def parse_news() -> None:
    """Fetch news from all RSS sources and store in news_cache."""
    logger.info("Starting news parsing")
    import httpx
    from src.services.news.parser import fetch_all_rss
    from src.services.news.aggregator import NewsAggregator
    from src.services.news.personalizer import NewsPersonalizer

    async with httpx.AsyncClient(timeout=15.0) as client:
        items = await fetch_all_rss(client)

    async with async_session() as db:
        aggregator = NewsAggregator(db)
        stored = await aggregator.store_news(items)
        logger.info("News parsing done: %d new items stored", stored)

        # Tag news with tickers
        personalizer = NewsPersonalizer(db)
        tagged = await personalizer.tag_news_with_tickers()
        logger.info("Tagged %d news items with tickers", tagged)


async def cleanup_news_cache() -> None:
    """Delete expired news cache entries."""
    logger.info("Starting news cache cleanup")
    async with async_session() as db:
        from src.services.news.aggregator import NewsAggregator
        aggregator = NewsAggregator(db)
        deleted = await aggregator.cleanup_expired()
        logger.info("News cache cleanup done: %d entries deleted", deleted)


async def check_large_expenses() -> None:
    """Check for expenses 3x larger than user's category average."""
    logger.info("Starting large expense check")
    async with async_session() as db:
        from sqlalchemy import select, func
        from src.models.user import User
        from src.models.transaction import Transaction
        from datetime import datetime, timedelta, timezone

        now = datetime.now(timezone.utc)
        last_hour = now - timedelta(hours=1)
        thirty_days_ago = now - timedelta(days=30)

        # Find recent expenses (last hour)
        recent = await db.execute(
            select(Transaction).where(
                Transaction.created_at >= last_hour,
                Transaction.amount < 0,  # expenses are negative
            )
        )
        recent_txns = list(recent.scalars().all())

        if not recent_txns:
            logger.info("No recent expenses found")
            return

        # Group by user + check averages
        from src.bot.setup import bot
        if bot is None:
            logger.warning("Bot not available for notifications")
            return

        from src.services.notification_service import NotificationService
        notif = NotificationService(bot, db)

        for txn in recent_txns:
            # Calculate user's average for this category in last 30 days
            avg_result = await db.execute(
                select(func.avg(func.abs(Transaction.amount))).where(
                    Transaction.user_id == txn.user_id,
                    Transaction.category_id == txn.category_id,
                    Transaction.amount < 0,
                    Transaction.created_at >= thirty_days_ago,
                    Transaction.id != txn.id,
                )
            )
            avg_amount = avg_result.scalar()
            if avg_amount and avg_amount > 0:
                txn_amount = abs(txn.amount)
                multiplier = float(txn_amount / avg_amount)
                if multiplier >= 3:
                    from decimal import Decimal
                    await notif.notify_large_expense(
                        user_id=txn.user_id,
                        amount=Decimal(str(txn_amount)),
                        merchant=txn.description or "неизвестно",
                        multiplier=multiplier,
                    )

    logger.info("Large expense check done")


async def check_portfolio_drops() -> None:
    """Check portfolio drops vs threshold and notify users."""
    logger.info("Starting portfolio drop check")
    async with async_session() as db:
        from sqlalchemy import select, func
        from src.models.user import User
        from src.models.portfolio import PortfolioPosition
        from decimal import Decimal

        # Get all users with portfolio positions
        result = await db.execute(
            select(PortfolioPosition.user_id).group_by(PortfolioPosition.user_id)
        )
        user_ids = [row[0] for row in result.all()]

        if not user_ids:
            logger.info("No users with portfolios")
            return

        from src.bot.setup import bot
        if bot is None:
            logger.warning("Bot not available for notifications")
            return

        from src.services.notification_service import NotificationService
        notif = NotificationService(bot, db)

        for uid in user_ids:
            positions = await db.execute(
                select(PortfolioPosition).where(PortfolioPosition.user_id == uid)
            )
            total_current = Decimal("0")
            total_cost = Decimal("0")
            for pos in positions.scalars().all():
                if pos.current_price and pos.quantity and pos.avg_price:
                    total_current += pos.current_price * pos.quantity
                    total_cost += pos.avg_price * pos.quantity

            if total_cost > 0:
                change_pct = float((total_current - total_cost) / total_cost * 100)
                change_amount = total_current - total_cost
                # Notify if daily drop > 3%
                if change_pct <= -3.0:
                    await notif.notify_portfolio_drop(
                        user_id=uid,
                        percent=change_pct,
                        amount=change_amount,
                    )

    logger.info("Portfolio drop check done")


async def fetch_cbr_exchange_rates() -> None:
    """Fetch USD, EUR, CNY exchange rates from CBR."""
    logger.info("Starting exchange rates fetch")
    import httpx
    from src.services.news.parser import fetch_exchange_rates

    async with httpx.AsyncClient(timeout=15.0) as client:
        rates = await fetch_exchange_rates(client=client)

    for rate in rates:
        logger.info(
            "%s: %.4f (prev: %.4f)",
            rate.currency, rate.value, rate.previous,
        )
    logger.info("Exchange rates fetch done: %d rates", len(rates))


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

    # Daily digest: every day at 8:00 AM MSK
    scheduler.add_job(
        generate_daily_digests,
        trigger=CronTrigger(hour=8, minute=0, timezone="Europe/Moscow"),
        id="generate_daily_digests",
        name="Generate daily digests",
        replace_existing=True,
    )

    # Parse news: every 2 hours
    scheduler.add_job(
        parse_news,
        trigger=IntervalTrigger(hours=2),
        id="parse_news",
        name="Parse news from RSS/API sources",
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

    # Check large expenses: every hour
    scheduler.add_job(
        check_large_expenses,
        trigger=IntervalTrigger(hours=1),
        id="check_large_expenses",
        name="Check for unusually large expenses",
        replace_existing=True,
    )

    # Check portfolio drops: every hour, 7:00-23:00 MSK
    scheduler.add_job(
        check_portfolio_drops,
        trigger=CronTrigger(hour="7-23", minute=30, timezone="Europe/Moscow"),
        id="check_portfolio_drops",
        name="Check portfolio drops",
        replace_existing=True,
    )

    # Fetch exchange rates: every 4 hours
    scheduler.add_job(
        fetch_cbr_exchange_rates,
        trigger=IntervalTrigger(hours=4),
        id="fetch_exchange_rates",
        name="Fetch CBR exchange rates (USD, EUR, CNY)",
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
