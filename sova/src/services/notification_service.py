"""Notification Service — sends bot notifications for various financial events."""

import logging
from decimal import Decimal

from aiogram import Bot
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.news import NewsCache
from src.services.user_service import UserService

logger = logging.getLogger(__name__)


class NotificationService:
    """Handles all bot notifications with user preference checks."""

    def __init__(self, bot: Bot, db: AsyncSession):
        self.bot = bot
        self.db = db
        self.user_service = UserService(db)

    async def _is_enabled(self, user_id: int, notification_type: str) -> bool:
        """Check if notification type is enabled for user."""
        settings = await self.user_service.get_notification_settings(user_id)
        # Global kill switch
        if not settings.get("enabled", True):
            return False
        # Per-type check (default: enabled)
        return settings.get(notification_type, True)

    async def _send(self, user_id: int, text: str) -> bool:
        """Send a message to user. Returns True if sent successfully."""
        try:
            await self.bot.send_message(chat_id=user_id, text=text)
            return True
        except Exception as e:
            logger.error("Failed to send notification to user %d: %s", user_id, e)
            return False

    async def notify_large_expense(
        self,
        user_id: int,
        amount: Decimal,
        merchant: str,
        multiplier: float,
    ) -> bool:
        """Notify about an unusually large expense.

        Example: "Трата 15,000 в Ашан -- в 3 раза больше обычного"
        """
        if not await self._is_enabled(user_id, "large_expense"):
            return False
        text = (
            f"💸 Крупная трата: {amount:,.0f}₽ в {merchant} "
            f"— в {multiplier:.0f} раза больше обычного"
        )
        return await self._send(user_id, text)

    async def notify_budget_limit(
        self,
        user_id: int,
        category: str,
        percent: int,
        remaining: Decimal,
        days_left: int,
    ) -> bool:
        """Notify when budget limit is approaching.

        Example: "Еда: 80% бюджета, осталось 4,200 на 8 дней"
        """
        if not await self._is_enabled(user_id, "budget_limit"):
            return False
        text = (
            f"⚠️ {category}: {percent}% бюджета израсходовано, "
            f"осталось {remaining:,.0f}₽ на {days_left} дней"
        )
        return await self._send(user_id, text)

    async def notify_portfolio_drop(
        self,
        user_id: int,
        percent: float,
        amount: Decimal,
    ) -> bool:
        """Notify about significant portfolio drop.

        Example: "Портфель -3.2% за день (-12,400)"
        """
        if not await self._is_enabled(user_id, "portfolio_drop"):
            return False
        text = (
            f"📉 Портфель {percent:+.1f}% за день "
            f"({amount:+,.0f}₽)"
        )
        return await self._send(user_id, text)

    async def notify_dividend(
        self,
        user_id: int,
        ticker: str,
        amount: Decimal,
    ) -> bool:
        """Notify about received dividends.

        Example: "Начислены дивиденды SBER: 1,200"
        """
        if not await self._is_enabled(user_id, "dividend"):
            return False
        text = f"💰 Начислены дивиденды {ticker}: {amount:,.0f}₽"
        return await self._send(user_id, text)

    async def notify_personalized_news(
        self,
        user_id: int,
        news: NewsCache,
    ) -> bool:
        """Notify about news relevant to user's portfolio.

        Example: "Газпром -4% -- у тебя 15% портфеля в GAZP"
        """
        if not await self._is_enabled(user_id, "personalized_news"):
            return False

        tickers_str = ""
        if news.affected_tickers:
            tickers_str = f" [{', '.join(news.affected_tickers)}]"
        text = f"📰 {news.title}{tickers_str}"
        if news.url:
            text += f"\n{news.url}"
        return await self._send(user_id, text)
