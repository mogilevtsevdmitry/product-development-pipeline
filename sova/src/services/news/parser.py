"""News Parser Service — fetches news from RSS feeds, MOEX and CBR APIs."""

import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from xml.etree import ElementTree

import httpx

logger = logging.getLogger(__name__)

# RSS feed sources
RSS_SOURCES: dict[str, str] = {
    "rbc": "https://rbc.ru/v10/ajax/get-news-feed/project/rbcnews/lastN/20",
    "kommersant": "https://www.kommersant.ru/RSS/news.xml",
}

MOEX_IMOEX_URL = "https://iss.moex.com/iss/engines/stock/markets/index/securities/IMOEX.json"
CBR_RATES_URL = "https://www.cbr-xml-daily.ru/daily_json.js"

DEFAULT_TIMEOUT = 15.0


@dataclass
class NewsItem:
    """Parsed news item."""

    title: str
    url: str
    source: str
    published_at: datetime | None = None
    text_snippet: str = ""


@dataclass
class ExchangeRate:
    """Exchange rate from CBR."""

    currency: str
    value: float
    previous: float


@dataclass
class IndexData:
    """MOEX index data."""

    name: str
    value: float
    change_percent: float


async def fetch_rss(url: str, source: str, client: httpx.AsyncClient | None = None) -> list[NewsItem]:
    """Fetch and parse RSS feed, returning list of NewsItem."""
    own_client = client is None
    if own_client:
        client = httpx.AsyncClient(timeout=DEFAULT_TIMEOUT)
    try:
        resp = await client.get(url, follow_redirects=True)
        resp.raise_for_status()
    except httpx.HTTPError as e:
        logger.error("Failed to fetch RSS from %s: %s", source, e)
        if own_client:
            await client.aclose()
        return []

    items: list[NewsItem] = []
    try:
        root = ElementTree.fromstring(resp.text)
        # Standard RSS 2.0 — items under channel
        for item_el in root.iter("item"):
            title_el = item_el.find("title")
            link_el = item_el.find("link")
            desc_el = item_el.find("description")
            pub_el = item_el.find("pubDate")

            title = title_el.text.strip() if title_el is not None and title_el.text else ""
            link = link_el.text.strip() if link_el is not None and link_el.text else ""
            snippet = desc_el.text.strip() if desc_el is not None and desc_el.text else ""
            pub_date = _parse_rss_date(pub_el.text.strip()) if pub_el is not None and pub_el.text else None

            if title:
                items.append(NewsItem(
                    title=title,
                    url=link,
                    source=source,
                    published_at=pub_date,
                    text_snippet=snippet[:500],
                ))
    except ElementTree.ParseError as e:
        logger.error("Failed to parse RSS XML from %s: %s", source, e)

    if own_client:
        await client.aclose()
    return items


def _parse_rss_date(date_str: str) -> datetime | None:
    """Parse RFC 822 date from RSS pubDate field."""
    # Common format: "Mon, 01 Jan 2024 12:00:00 +0300"
    from email.utils import parsedate_to_datetime
    try:
        return parsedate_to_datetime(date_str)
    except (ValueError, TypeError):
        return None


async def fetch_all_rss(client: httpx.AsyncClient | None = None) -> list[NewsItem]:
    """Fetch news from all configured RSS sources."""
    all_items: list[NewsItem] = []
    own_client = client is None
    if own_client:
        client = httpx.AsyncClient(timeout=DEFAULT_TIMEOUT)
    try:
        for source, url in RSS_SOURCES.items():
            items = await fetch_rss(url, source, client)
            all_items.extend(items)
            logger.info("Fetched %d items from %s", len(items), source)
    finally:
        if own_client:
            await client.aclose()
    return all_items


async def fetch_moex_index(client: httpx.AsyncClient | None = None) -> IndexData | None:
    """Fetch IMOEX index data from MOEX ISS API."""
    own_client = client is None
    if own_client:
        client = httpx.AsyncClient(timeout=DEFAULT_TIMEOUT)
    try:
        resp = await client.get(MOEX_IMOEX_URL, follow_redirects=True)
        resp.raise_for_status()
        data = resp.json()

        # MOEX ISS returns columns + data arrays
        marketdata = data.get("marketdata", {})
        columns = marketdata.get("columns", [])
        rows = marketdata.get("data", [])

        if not rows:
            return None

        row = rows[0]
        col_map = {c: i for i, c in enumerate(columns)}

        value_idx = col_map.get("CURRENTVALUE") or col_map.get("LAST")
        change_idx = col_map.get("LASTCHANGEPRCNT") or col_map.get("CHANGEPRC")

        value = float(row[value_idx]) if value_idx is not None and row[value_idx] is not None else 0.0
        change = float(row[change_idx]) if change_idx is not None and row[change_idx] is not None else 0.0

        return IndexData(name="IMOEX", value=value, change_percent=change)
    except (httpx.HTTPError, KeyError, IndexError, TypeError) as e:
        logger.error("Failed to fetch MOEX index: %s", e)
        return None
    finally:
        if own_client:
            await client.aclose()


async def fetch_exchange_rates(
    currencies: list[str] | None = None,
    client: httpx.AsyncClient | None = None,
) -> list[ExchangeRate]:
    """Fetch exchange rates from CBR daily JSON API.

    Args:
        currencies: List of currency codes to fetch (default: USD, EUR, CNY).
        client: Optional shared httpx client.
    """
    if currencies is None:
        currencies = ["USD", "EUR", "CNY"]

    own_client = client is None
    if own_client:
        client = httpx.AsyncClient(timeout=DEFAULT_TIMEOUT)
    try:
        resp = await client.get(CBR_RATES_URL, follow_redirects=True)
        resp.raise_for_status()
        data = resp.json()

        valute = data.get("Valute", {})
        rates: list[ExchangeRate] = []
        for code in currencies:
            info = valute.get(code)
            if info:
                rates.append(ExchangeRate(
                    currency=code,
                    value=float(info["Value"]),
                    previous=float(info["Previous"]),
                ))
        return rates
    except (httpx.HTTPError, KeyError, TypeError) as e:
        logger.error("Failed to fetch CBR rates: %s", e)
        return []
    finally:
        if own_client:
            await client.aclose()
