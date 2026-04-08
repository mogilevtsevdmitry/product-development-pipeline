"""Trade command parser — extracts trade intent from natural language.

Supports Russian-language commands like:
- "купить SBER 10 лотов"
- "продать GAZP 5 лотов по 180"
- "купить 3 лота YNDX"
"""

import re
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation


@dataclass
class ParsedTrade:
    """Parsed trade command."""
    direction: str  # "buy" or "sell"
    ticker: str
    quantity: int
    order_type: str  # "market" or "limit"
    price: Decimal | None = None


# Direction keywords
_BUY_WORDS = {"купить", "купи", "покупка", "покупаю", "купите"}
_SELL_WORDS = {"продать", "продай", "продажа", "продаю", "продайте"}

# Pattern: "купить SBER 10 лотов" or "продать GAZP 5 лотов по 180"
_PATTERN_TICKER_QTY = re.compile(
    r"(?P<direction>\S+)"           # buy/sell word
    r"\s+(?P<ticker>[A-ZА-Я]{1,10})" # ticker (uppercase)
    r"\s+(?P<qty>\d+)"             # quantity
    r"\s+лот(?:ов|а|)?"            # "лотов", "лота", "лот"
    r"(?:\s+по\s+(?P<price>[\d.,]+))?" # optional limit price
    r"(?:\s.*)?$",                  # ignore trailing text
    re.IGNORECASE,
)

# Pattern: "купить 3 лота YNDX" (quantity before ticker)
_PATTERN_QTY_TICKER = re.compile(
    r"(?P<direction>\S+)"           # buy/sell word
    r"\s+(?P<qty>\d+)"             # quantity
    r"\s+лот(?:ов|а|)?"            # "лотов", "лота", "лот"
    r"\s+(?P<ticker>[A-ZА-Я]{1,10})" # ticker (uppercase)
    r"(?:\s+по\s+(?P<price>[\d.,]+))?" # optional limit price
    r"(?:\s.*)?$",                  # ignore trailing text
    re.IGNORECASE,
)


def _parse_direction(word: str) -> str | None:
    """Map a Russian word to 'buy' or 'sell'."""
    w = word.lower().strip()
    if w in _BUY_WORDS:
        return "buy"
    if w in _SELL_WORDS:
        return "sell"
    return None


def _parse_price(raw: str | None) -> Decimal | None:
    """Parse price string to Decimal."""
    if not raw:
        return None
    try:
        cleaned = raw.replace(",", ".")
        return Decimal(cleaned)
    except (InvalidOperation, ValueError):
        return None


def parse_trade(text: str) -> ParsedTrade | None:
    """Parse a trade command from natural language text.

    Returns ParsedTrade if the text is a valid trade command, None otherwise.
    """
    if not text or not text.strip():
        return None

    text = text.strip()

    # Try pattern: direction TICKER qty лотов [по price]
    match = _PATTERN_TICKER_QTY.match(text)
    if match:
        direction = _parse_direction(match.group("direction"))
        if direction is None:
            return None
        ticker = match.group("ticker").upper()
        try:
            qty = int(match.group("qty"))
        except (ValueError, TypeError):
            return None
        if qty <= 0:
            return None
        price = _parse_price(match.group("price"))
        return ParsedTrade(
            direction=direction,
            ticker=ticker,
            quantity=qty,
            order_type="limit" if price is not None else "market",
            price=price,
        )

    # Try pattern: direction qty лотов TICKER [по price]
    match = _PATTERN_QTY_TICKER.match(text)
    if match:
        direction = _parse_direction(match.group("direction"))
        if direction is None:
            return None
        ticker = match.group("ticker").upper()
        try:
            qty = int(match.group("qty"))
        except (ValueError, TypeError):
            return None
        if qty <= 0:
            return None
        price = _parse_price(match.group("price"))
        return ParsedTrade(
            direction=direction,
            ticker=ticker,
            quantity=qty,
            order_type="limit" if price is not None else "market",
            price=price,
        )

    return None
