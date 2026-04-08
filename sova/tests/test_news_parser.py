"""Tests for news parser service."""

import pytest
from unittest.mock import AsyncMock, patch
from datetime import datetime, timezone

import httpx

from src.services.news.parser import (
    fetch_rss,
    fetch_all_rss,
    fetch_moex_index,
    fetch_exchange_rates,
    NewsItem,
    ExchangeRate,
    IndexData,
    _parse_rss_date,
)

SAMPLE_RSS_XML = """<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Test Feed</title>
    <item>
      <title>Рынок акций вырос на 2%</title>
      <link>https://example.com/news/1</link>
      <description>Индекс Мосбиржи прибавил 2% на фоне позитива.</description>
      <pubDate>Mon, 08 Apr 2026 10:00:00 +0300</pubDate>
    </item>
    <item>
      <title>Газпром объявил дивиденды</title>
      <link>https://example.com/news/2</link>
      <description>Совет директоров рекомендовал дивиденды за 2025.</description>
      <pubDate>Mon, 08 Apr 2026 09:00:00 +0300</pubDate>
    </item>
  </channel>
</rss>
"""

SAMPLE_MOEX_JSON = {
    "marketdata": {
        "columns": ["SECID", "BOARDID", "CURRENTVALUE", "LASTCHANGEPRCNT"],
        "data": [["IMOEX", "SNDX", 3200.5, 1.23]],
    }
}

SAMPLE_CBR_JSON = {
    "Date": "2026-04-08T11:30:00+03:00",
    "Valute": {
        "USD": {
            "ID": "R01235",
            "CharCode": "USD",
            "Value": 92.5,
            "Previous": 92.3,
        },
        "EUR": {
            "ID": "R01239",
            "CharCode": "EUR",
            "Value": 100.2,
            "Previous": 100.0,
        },
        "CNY": {
            "ID": "R01375",
            "CharCode": "CNY",
            "Value": 12.8,
            "Previous": 12.7,
        },
    },
}


def _mock_response(content: str | dict, status_code: int = 200) -> httpx.Response:
    """Create a mock httpx Response."""
    if isinstance(content, dict):
        import json
        text = json.dumps(content)
    else:
        text = content
    return httpx.Response(
        status_code=status_code,
        text=text,
        request=httpx.Request("GET", "https://example.com"),
    )


@pytest.fixture
def mock_client():
    """Create a mock httpx.AsyncClient."""
    client = AsyncMock(spec=httpx.AsyncClient)
    return client


async def test_fetch_rss_parses_items(mock_client):
    """RSS parser should extract title, link, description, and pubDate."""
    mock_client.get = AsyncMock(return_value=_mock_response(SAMPLE_RSS_XML))
    items = await fetch_rss("https://example.com/rss", "test", mock_client)

    assert len(items) == 2
    assert items[0].title == "Рынок акций вырос на 2%"
    assert items[0].url == "https://example.com/news/1"
    assert items[0].source == "test"
    assert items[0].text_snippet == "Индекс Мосбиржи прибавил 2% на фоне позитива."
    assert items[0].published_at is not None


async def test_fetch_rss_empty_on_http_error(mock_client):
    """RSS parser should return empty list on HTTP error."""
    mock_client.get = AsyncMock(side_effect=httpx.HTTPStatusError(
        "500", request=httpx.Request("GET", "https://example.com"),
        response=httpx.Response(500),
    ))
    items = await fetch_rss("https://example.com/rss", "test", mock_client)
    assert items == []


async def test_fetch_rss_empty_on_malformed_xml(mock_client):
    """RSS parser should return empty list on invalid XML."""
    mock_client.get = AsyncMock(return_value=_mock_response("not xml at all <><>"))
    items = await fetch_rss("https://example.com/rss", "test", mock_client)
    assert items == []


async def test_fetch_all_rss(mock_client):
    """fetch_all_rss should aggregate items from all sources."""
    mock_client.get = AsyncMock(return_value=_mock_response(SAMPLE_RSS_XML))
    items = await fetch_all_rss(mock_client)
    # 2 items per source, 2 sources = 4 items
    assert len(items) == 4


async def test_fetch_moex_index(mock_client):
    """MOEX index fetch should parse JSON response correctly."""
    mock_client.get = AsyncMock(return_value=_mock_response(SAMPLE_MOEX_JSON))
    result = await fetch_moex_index(mock_client)

    assert result is not None
    assert result.name == "IMOEX"
    assert result.value == 3200.5
    assert result.change_percent == 1.23


async def test_fetch_moex_index_returns_none_on_error(mock_client):
    """MOEX fetch should return None on HTTP error."""
    mock_client.get = AsyncMock(side_effect=httpx.HTTPStatusError(
        "500", request=httpx.Request("GET", "https://example.com"),
        response=httpx.Response(500),
    ))
    result = await fetch_moex_index(mock_client)
    assert result is None


async def test_fetch_exchange_rates(mock_client):
    """Exchange rates fetch should return rates for requested currencies."""
    mock_client.get = AsyncMock(return_value=_mock_response(SAMPLE_CBR_JSON))
    rates = await fetch_exchange_rates(client=mock_client)

    assert len(rates) == 3
    usd = next(r for r in rates if r.currency == "USD")
    assert usd.value == 92.5
    assert usd.previous == 92.3


async def test_fetch_exchange_rates_subset(mock_client):
    """Exchange rates should filter to requested currencies only."""
    mock_client.get = AsyncMock(return_value=_mock_response(SAMPLE_CBR_JSON))
    rates = await fetch_exchange_rates(currencies=["EUR"], client=mock_client)

    assert len(rates) == 1
    assert rates[0].currency == "EUR"


async def test_fetch_exchange_rates_empty_on_error(mock_client):
    """Exchange rates should return empty list on error."""
    mock_client.get = AsyncMock(side_effect=httpx.ConnectError("timeout"))
    rates = await fetch_exchange_rates(client=mock_client)
    assert rates == []


def test_parse_rss_date_valid():
    """Should parse standard RFC 822 dates."""
    dt = _parse_rss_date("Mon, 08 Apr 2026 10:00:00 +0300")
    assert dt is not None
    assert dt.year == 2026
    assert dt.month == 4


def test_parse_rss_date_invalid():
    """Should return None for invalid dates."""
    assert _parse_rss_date("not a date") is None
