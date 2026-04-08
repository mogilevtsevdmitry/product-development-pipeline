"""News Aggregator Service — stores parsed news, deduplicates, cleans up expired."""

import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.news import NewsCache
from src.services.news.parser import NewsItem

logger = logging.getLogger(__name__)

DEFAULT_TTL_DAYS = 30


class NewsAggregator:
    """Stores, deduplicates, and manages news cache."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def store_news(self, items: list[NewsItem]) -> int:
        """Store news items, skipping duplicates by URL.

        Returns the number of newly stored items.
        """
        if not items:
            return 0

        # Collect URLs for dedup check
        urls = [item.url for item in items if item.url]
        existing_urls: set[str] = set()
        if urls:
            result = await self.db.execute(
                select(NewsCache.url).where(NewsCache.url.in_(urls))
            )
            existing_urls = {row[0] for row in result.all() if row[0]}

        stored = 0
        now = datetime.now(timezone.utc)
        expires_at = now + timedelta(days=DEFAULT_TTL_DAYS)

        for item in items:
            if item.url and item.url in existing_urls:
                continue
            entry = NewsCache(
                source=item.source,
                title=item.title,
                url=item.url or None,
                published_at=item.published_at,
                summary=item.text_snippet or None,
                expires_at=expires_at,
            )
            self.db.add(entry)
            stored += 1
            if item.url:
                existing_urls.add(item.url)

        if stored > 0:
            await self.db.commit()
        logger.info("Stored %d new news items (skipped %d duplicates)", stored, len(items) - stored)
        return stored

    async def cleanup_expired(self) -> int:
        """Delete expired news cache entries. Returns count of deleted rows."""
        now = datetime.now(timezone.utc)
        result = await self.db.execute(
            delete(NewsCache).where(NewsCache.expires_at < now)
        )
        await self.db.commit()
        deleted = result.rowcount
        logger.info("Cleaned up %d expired news entries", deleted)
        return deleted

    async def get_recent(self, limit: int = 20) -> list[NewsCache]:
        """Get the most recent news entries."""
        result = await self.db.execute(
            select(NewsCache)
            .order_by(NewsCache.published_at.desc().nullslast())
            .limit(limit)
        )
        return list(result.scalars().all())

    async def get_by_tickers(self, tickers: list[str], limit: int = 10) -> list[NewsCache]:
        """Get news entries that mention any of the given tickers."""
        # Filter entries with affected_tickers that overlap with user's tickers
        result = await self.db.execute(
            select(NewsCache)
            .where(NewsCache.affected_tickers.isnot(None))
            .order_by(NewsCache.published_at.desc().nullslast())
            .limit(limit * 3)  # over-fetch, then filter in Python
        )
        all_entries = list(result.scalars().all())

        ticker_set = {t.upper() for t in tickers}
        matching = []
        for entry in all_entries:
            if entry.affected_tickers:
                entry_tickers = {t.upper() for t in entry.affected_tickers}
                if entry_tickers & ticker_set:
                    matching.append(entry)
                    if len(matching) >= limit:
                        break
        return matching
