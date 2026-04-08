"""Tests for news aggregator service."""

import pytest
from datetime import datetime, timedelta, timezone

from src.models.news import NewsCache
from src.services.news.aggregator import NewsAggregator
from src.services.news.parser import NewsItem


@pytest.fixture
def sample_news_items():
    """Create sample NewsItem objects."""
    return [
        NewsItem(
            title="Рынок растёт",
            url="https://example.com/1",
            source="test",
            published_at=datetime.now(timezone.utc),
            text_snippet="Подробности о росте.",
        ),
        NewsItem(
            title="Газпром дивиденды",
            url="https://example.com/2",
            source="test",
            published_at=datetime.now(timezone.utc),
            text_snippet="Газпром объявил дивиденды.",
        ),
        NewsItem(
            title="Курс доллара",
            url="https://example.com/3",
            source="test",
            published_at=datetime.now(timezone.utc),
            text_snippet="Доллар вырос.",
        ),
    ]


async def test_store_news(db, sample_news_items):
    """Should store all non-duplicate news items."""
    agg = NewsAggregator(db)
    stored = await agg.store_news(sample_news_items)
    assert stored == 3


async def test_store_news_dedup(db, sample_news_items):
    """Should skip duplicate items by URL."""
    agg = NewsAggregator(db)
    await agg.store_news(sample_news_items)

    # Store same items again — should skip all
    stored2 = await agg.store_news(sample_news_items)
    assert stored2 == 0


async def test_store_news_partial_dedup(db, sample_news_items):
    """Should store new items and skip existing ones."""
    agg = NewsAggregator(db)
    await agg.store_news(sample_news_items[:1])

    new_item = NewsItem(
        title="New item",
        url="https://example.com/new",
        source="test",
        published_at=datetime.now(timezone.utc),
    )
    stored = await agg.store_news(sample_news_items[:1] + [new_item])
    assert stored == 1


async def test_cleanup_expired(db):
    """Should delete expired entries and keep valid ones."""
    agg = NewsAggregator(db)
    now = datetime.now(timezone.utc)

    # Add expired entry
    expired = NewsCache(
        source="test",
        title="Expired",
        url="https://example.com/expired",
        expires_at=now - timedelta(days=1),
    )
    # Add valid entry
    valid = NewsCache(
        source="test",
        title="Valid",
        url="https://example.com/valid",
        expires_at=now + timedelta(days=10),
    )
    db.add(expired)
    db.add(valid)
    await db.commit()

    deleted = await agg.cleanup_expired()
    assert deleted == 1

    remaining = await agg.get_recent(limit=10)
    assert len(remaining) == 1
    assert remaining[0].title == "Valid"


async def test_get_recent(db, sample_news_items):
    """Should return items ordered by published_at descending."""
    agg = NewsAggregator(db)
    await agg.store_news(sample_news_items)

    recent = await agg.get_recent(limit=2)
    assert len(recent) == 2


async def test_get_by_tickers(db):
    """Should filter news by affected_tickers."""
    agg = NewsAggregator(db)

    entry1 = NewsCache(
        source="test",
        title="Сбербанк отчёт",
        url="https://example.com/sber",
        affected_tickers=["SBER"],
        published_at=datetime.now(timezone.utc),
        expires_at=datetime.now(timezone.utc) + timedelta(days=30),
    )
    entry2 = NewsCache(
        source="test",
        title="Газпром новости",
        url="https://example.com/gazp",
        affected_tickers=["GAZP"],
        published_at=datetime.now(timezone.utc),
        expires_at=datetime.now(timezone.utc) + timedelta(days=30),
    )
    entry3 = NewsCache(
        source="test",
        title="Общие новости",
        url="https://example.com/general",
        published_at=datetime.now(timezone.utc),
        expires_at=datetime.now(timezone.utc) + timedelta(days=30),
    )
    db.add_all([entry1, entry2, entry3])
    await db.commit()

    results = await agg.get_by_tickers(["SBER"], limit=10)
    assert len(results) == 1
    assert results[0].title == "Сбербанк отчёт"
