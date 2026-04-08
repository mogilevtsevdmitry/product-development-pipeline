"""Tests for news bot handler."""

import pytest
from datetime import datetime, timedelta, timezone

from src.models.user import User
from src.models.news import NewsCache
from src.models.portfolio import PortfolioPosition
from src.services.user_service import UserService
from src.bot.handlers.news import on_news_callback


async def _setup_user(db, user_id: int = 600):
    """Create a test user."""
    service = UserService(db)
    await service.get_or_create(user_id, "newsuser", "News")


async def _add_news(db, title: str, url: str, tickers=None):
    """Add news entry."""
    entry = NewsCache(
        source="test",
        title=title,
        url=url,
        affected_tickers=tickers,
        published_at=datetime.now(timezone.utc),
        expires_at=datetime.now(timezone.utc) + timedelta(days=30),
    )
    db.add(entry)
    await db.commit()
    return entry


async def test_news_handler_with_items(db, make_callback):
    """Should display news items when available."""
    await _setup_user(db, 600)
    await _add_news(db, "Новость 1", "https://ex.com/1", ["SBER"])
    await _add_news(db, "Новость 2", "https://ex.com/2")

    cb = make_callback(data="menu:news", user_id=600)
    await on_news_callback(cb, db=db)

    cb.message.edit_text.assert_called_once()
    text = cb.message.edit_text.call_args[0][0]
    assert "Новость 1" in text
    assert "[SBER]" in text
    cb.answer.assert_called_once()


async def test_news_handler_empty(db, make_callback):
    """Should show empty message when no news available."""
    await _setup_user(db, 601)

    cb = make_callback(data="menu:news", user_id=601)
    await on_news_callback(cb, db=db)

    cb.message.edit_text.assert_called_once()
    text = cb.message.edit_text.call_args[0][0]
    assert "нет новостей" in text.lower() or "Пока нет" in text
    cb.answer.assert_called_once()


async def test_news_handler_has_keyboard(db, make_callback):
    """Should include reply markup (back to menu keyboard)."""
    await _setup_user(db, 602)
    await _add_news(db, "Test news", "https://ex.com/test")

    cb = make_callback(data="menu:news", user_id=602)
    await on_news_callback(cb, db=db)

    call_kwargs = cb.message.edit_text.call_args
    assert call_kwargs.kwargs.get("reply_markup") is not None
