"""Tests for news personalizer service."""

import pytest
from datetime import datetime, timedelta, timezone

from src.models.news import NewsCache
from src.models.portfolio import PortfolioPosition
from src.models.user import User
from src.services.news.personalizer import NewsPersonalizer, find_tickers_in_text


async def _create_user(db, user_id: int = 1):
    """Helper: create a test user."""
    user = User(telegram_id=user_id, username="test", first_name="Test")
    db.add(user)
    await db.commit()
    return user


async def _add_position(db, user_id: int, ticker: str):
    """Helper: add a portfolio position."""
    pos = PortfolioPosition(user_id=user_id, ticker=ticker)
    db.add(pos)
    await db.commit()


async def _add_news(db, title: str, url: str, tickers: list[str] | None = None):
    """Helper: add a news cache entry."""
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


async def test_get_user_tickers(db):
    """Should return tickers from user portfolio."""
    await _create_user(db, 100)
    await _add_position(db, 100, "SBER")
    await _add_position(db, 100, "GAZP")

    p = NewsPersonalizer(db)
    tickers = await p.get_user_tickers(100)
    assert set(tickers) == {"SBER", "GAZP"}


async def test_tag_news_with_tickers(db):
    """Should tag untagged news based on ticker mentions."""
    entry = NewsCache(
        source="test",
        title="Сбербанк показал рекордную прибыль",
        url="https://example.com/sber-profit",
        summary="Сбербанк заработал больше всех.",
        published_at=datetime.now(timezone.utc),
        expires_at=datetime.now(timezone.utc) + timedelta(days=30),
    )
    db.add(entry)
    await db.commit()

    p = NewsPersonalizer(db)
    updated = await p.tag_news_with_tickers(tickers=["SBER", "GAZP"])
    assert updated == 1

    await db.refresh(entry)
    assert "SBER" in entry.affected_tickers


async def test_tag_news_no_match(db):
    """Should not tag news when no tickers match."""
    entry = NewsCache(
        source="test",
        title="Погода в Москве улучшается",
        url="https://example.com/weather",
        summary="Тепло и солнечно.",
        published_at=datetime.now(timezone.utc),
        expires_at=datetime.now(timezone.utc) + timedelta(days=30),
    )
    db.add(entry)
    await db.commit()

    p = NewsPersonalizer(db)
    updated = await p.tag_news_with_tickers(tickers=["SBER"])
    assert updated == 0


async def test_get_personalized_news_with_portfolio(db):
    """Should return ticker-matched news first."""
    await _create_user(db, 200)
    await _add_position(db, 200, "SBER")
    await _add_news(db, "Сбербанк дивиденды", "https://ex.com/1", ["SBER"])
    await _add_news(db, "Общие новости", "https://ex.com/2", None)

    p = NewsPersonalizer(db)
    news = await p.get_personalized_news(200, limit=5)
    assert len(news) >= 1
    # At least one should have SBER in affected_tickers
    sber_news = [n for n in news if n.affected_tickers and "SBER" in n.affected_tickers]
    assert len(sber_news) >= 1


async def test_get_personalized_news_no_portfolio(db):
    """Should return recent general news when no portfolio exists."""
    await _create_user(db, 300)
    await _add_news(db, "News 1", "https://ex.com/n1")
    await _add_news(db, "News 2", "https://ex.com/n2")

    p = NewsPersonalizer(db)
    news = await p.get_personalized_news(300, limit=5)
    assert len(news) == 2


def test_find_tickers_ticker_symbol():
    """Should match ticker symbol in uppercase text."""
    result = find_tickers_in_text("Акции SBER выросли на 5%", {"SBER", "GAZP"})
    assert "SBER" in result
    assert "GAZP" not in result


def test_find_tickers_company_name():
    """Should match company name keywords."""
    result = find_tickers_in_text("Газпром объявил дивиденды", {"SBER", "GAZP"})
    assert "GAZP" in result


def test_find_tickers_no_match():
    """Should return empty list when no tickers match."""
    result = find_tickers_in_text("Погода отличная сегодня", {"SBER", "GAZP"})
    assert result == []


def test_find_tickers_multiple():
    """Should find multiple tickers in same text."""
    result = find_tickers_in_text("Сбербанк и Газпром выросли", {"SBER", "GAZP", "LKOH"})
    assert "SBER" in result
    assert "GAZP" in result
    assert "LKOH" not in result
