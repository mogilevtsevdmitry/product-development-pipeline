"""News Personalizer — matches news to user portfolio tickers via keyword matching."""

import logging
import re

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.news import NewsCache
from src.models.portfolio import PortfolioPosition

logger = logging.getLogger(__name__)

# Well-known ticker -> company name mappings for better matching
TICKER_KEYWORDS: dict[str, list[str]] = {
    "SBER": ["сбер", "сбербанк", "sberbank"],
    "GAZP": ["газпром", "gazprom"],
    "LKOH": ["лукойл", "lukoil"],
    "YNDX": ["яндекс", "yandex"],
    "GMKN": ["норникель", "nornickel", "норильский никель"],
    "ROSN": ["роснефть", "rosneft"],
    "MGNT": ["магнит", "magnit"],
    "NVTK": ["новатэк", "novatek"],
    "MTSS": ["мтс", "mts"],
    "POLY": ["полиметалл", "polymetal"],
    "TCSG": ["тинькофф", "tinkoff", "т-банк", "t-bank"],
    "VTBR": ["втб", "vtb"],
    "ALRS": ["алроса", "alrosa"],
    "CHMF": ["северсталь", "severstal"],
    "AFLT": ["аэрофлот", "aeroflot"],
    "PHOR": ["фосагро", "phosagro"],
    "MOEX": ["мосбиржа", "moex", "московская биржа"],
    "OZON": ["озон", "ozon"],
    "VKCO": ["вк", "vkontakte", "vk"],
    "PIKK": ["пик", "pik"],
}


class NewsPersonalizer:
    """Matches news items to user portfolio tickers."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_user_tickers(self, user_id: int) -> list[str]:
        """Get list of tickers from user's portfolio."""
        result = await self.db.execute(
            select(PortfolioPosition.ticker).where(
                PortfolioPosition.user_id == user_id
            )
        )
        return [row[0] for row in result.all()]

    async def tag_news_with_tickers(self, tickers: list[str] | None = None) -> int:
        """Scan untagged news and set affected_tickers based on keyword matching.

        Args:
            tickers: If provided, only match against these tickers.
                     If None, match against all known tickers.

        Returns:
            Number of news items updated.
        """
        # Get untagged news
        result = await self.db.execute(
            select(NewsCache).where(NewsCache.affected_tickers.is_(None))
        )
        untagged = list(result.scalars().all())

        if not untagged:
            return 0

        # Build search patterns
        if tickers:
            search_tickers = {t.upper() for t in tickers}
        else:
            search_tickers = set(TICKER_KEYWORDS.keys())

        updated = 0
        for entry in untagged:
            matched = find_tickers_in_text(
                entry.title + " " + (entry.summary or ""),
                search_tickers,
            )
            if matched:
                entry.affected_tickers = matched
                updated += 1

        if updated:
            await self.db.commit()

        logger.info("Tagged %d news items with tickers (of %d untagged)", updated, len(untagged))
        return updated

    async def get_personalized_news(self, user_id: int, limit: int = 5) -> list[NewsCache]:
        """Get news personalized for user's portfolio."""
        tickers = await self.get_user_tickers(user_id)
        if not tickers:
            # No portfolio — return recent general news
            result = await self.db.execute(
                select(NewsCache)
                .order_by(NewsCache.published_at.desc().nullslast())
                .limit(limit)
            )
            return list(result.scalars().all())

        # Get news matching user's tickers
        from src.services.news.aggregator import NewsAggregator
        aggregator = NewsAggregator(self.db)
        personalized = await aggregator.get_by_tickers(tickers, limit=limit)

        # If not enough personalized news, fill with recent
        if len(personalized) < limit:
            existing_ids = {n.id for n in personalized}
            result = await self.db.execute(
                select(NewsCache)
                .order_by(NewsCache.published_at.desc().nullslast())
                .limit(limit * 2)
            )
            for entry in result.scalars().all():
                if entry.id not in existing_ids:
                    personalized.append(entry)
                    if len(personalized) >= limit:
                        break

        return personalized[:limit]


def find_tickers_in_text(text: str, tickers: set[str]) -> list[str]:
    """Find which tickers are mentioned in text using keyword matching.

    Checks both the ticker symbol itself and known company name aliases.
    """
    text_lower = text.lower()
    text_upper = text.upper()
    matched: list[str] = []

    for ticker in tickers:
        # Check ticker symbol directly (case-insensitive)
        if ticker in text_upper:
            matched.append(ticker)
            continue

        # Check known company name keywords
        keywords = TICKER_KEYWORDS.get(ticker, [])
        for keyword in keywords:
            if keyword in text_lower:
                matched.append(ticker)
                break

    return matched
