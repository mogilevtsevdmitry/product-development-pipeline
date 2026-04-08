"""Tests for notification service."""

import pytest
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock

from src.models.user import User
from src.models.news import NewsCache
from src.services.notification_service import NotificationService


@pytest.fixture
def mock_bot():
    """Mock aiogram Bot."""
    bot = AsyncMock()
    bot.send_message = AsyncMock()
    return bot


@pytest.fixture
async def user_with_notif(db):
    """Create a user with notifications enabled."""
    user = User(
        telegram_id=500,
        username="notif_test",
        first_name="Notif",
        notification_settings={"enabled": True},
    )
    db.add(user)
    await db.commit()
    return user


@pytest.fixture
async def user_notif_disabled(db):
    """Create a user with notifications disabled."""
    user = User(
        telegram_id=501,
        username="notif_off",
        first_name="Off",
        notification_settings={"enabled": False},
    )
    db.add(user)
    await db.commit()
    return user


@pytest.fixture
async def user_partial_notif(db):
    """Create a user with some notifications disabled."""
    user = User(
        telegram_id=502,
        username="partial",
        first_name="Partial",
        notification_settings={
            "enabled": True,
            "large_expense": True,
            "portfolio_drop": False,
        },
    )
    db.add(user)
    await db.commit()
    return user


async def test_notify_large_expense(db, mock_bot, user_with_notif):
    """Should send large expense notification."""
    notif = NotificationService(mock_bot, db)
    result = await notif.notify_large_expense(
        user_id=500,
        amount=Decimal("15000"),
        merchant="Ашан",
        multiplier=3.0,
    )
    assert result is True
    mock_bot.send_message.assert_called_once()
    text = mock_bot.send_message.call_args.kwargs["text"]
    assert "15,000" in text
    assert "Ашан" in text


async def test_notify_budget_limit(db, mock_bot, user_with_notif):
    """Should send budget limit notification."""
    notif = NotificationService(mock_bot, db)
    result = await notif.notify_budget_limit(
        user_id=500,
        category="Еда",
        percent=80,
        remaining=Decimal("4200"),
        days_left=8,
    )
    assert result is True
    text = mock_bot.send_message.call_args.kwargs["text"]
    assert "80%" in text
    assert "Еда" in text


async def test_notify_portfolio_drop(db, mock_bot, user_with_notif):
    """Should send portfolio drop notification."""
    notif = NotificationService(mock_bot, db)
    result = await notif.notify_portfolio_drop(
        user_id=500,
        percent=-3.2,
        amount=Decimal("-12400"),
    )
    assert result is True
    text = mock_bot.send_message.call_args.kwargs["text"]
    assert "-3.2%" in text


async def test_notify_dividend(db, mock_bot, user_with_notif):
    """Should send dividend notification."""
    notif = NotificationService(mock_bot, db)
    result = await notif.notify_dividend(
        user_id=500,
        ticker="SBER",
        amount=Decimal("1200"),
    )
    assert result is True
    text = mock_bot.send_message.call_args.kwargs["text"]
    assert "SBER" in text
    assert "1,200" in text


async def test_notify_personalized_news(db, mock_bot, user_with_notif):
    """Should send personalized news notification."""
    news = NewsCache(
        source="test",
        title="Газпром отчёт за квартал",
        url="https://example.com/gazp",
        affected_tickers=["GAZP"],
    )
    notif = NotificationService(mock_bot, db)
    result = await notif.notify_personalized_news(user_id=500, news=news)
    assert result is True
    text = mock_bot.send_message.call_args.kwargs["text"]
    assert "Газпром" in text
    assert "GAZP" in text


async def test_notifications_disabled(db, mock_bot, user_notif_disabled):
    """Should not send when notifications globally disabled."""
    notif = NotificationService(mock_bot, db)
    result = await notif.notify_large_expense(
        user_id=501,
        amount=Decimal("10000"),
        merchant="Test",
        multiplier=5.0,
    )
    assert result is False
    mock_bot.send_message.assert_not_called()


async def test_per_type_notification_disabled(db, mock_bot, user_partial_notif):
    """Should respect per-type notification settings."""
    notif = NotificationService(mock_bot, db)

    # large_expense is enabled
    result1 = await notif.notify_large_expense(
        user_id=502,
        amount=Decimal("10000"),
        merchant="Test",
        multiplier=5.0,
    )
    assert result1 is True

    # portfolio_drop is disabled
    result2 = await notif.notify_portfolio_drop(
        user_id=502,
        percent=-5.0,
        amount=Decimal("-20000"),
    )
    assert result2 is False


async def test_send_failure_returns_false(db, mock_bot, user_with_notif):
    """Should return False when bot.send_message fails."""
    mock_bot.send_message = AsyncMock(side_effect=Exception("Connection error"))
    notif = NotificationService(mock_bot, db)
    result = await notif.notify_dividend(
        user_id=500,
        ticker="SBER",
        amount=Decimal("500"),
    )
    assert result is False
