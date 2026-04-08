"""Tests for trade command parser."""

import pytest
from decimal import Decimal

from src.services.trade_parser import parse_trade, ParsedTrade


# ------------------------------------------------------------------
# Basic buy/sell commands
# ------------------------------------------------------------------


def test_buy_ticker_quantity():
    """Should parse 'купить SBER 10 лотов' as market buy."""
    result = parse_trade("купить SBER 10 лотов")
    assert result is not None
    assert result.direction == "buy"
    assert result.ticker == "SBER"
    assert result.quantity == 10
    assert result.order_type == "market"
    assert result.price is None


def test_sell_ticker_quantity():
    """Should parse 'продать GAZP 5 лотов' as market sell."""
    result = parse_trade("продать GAZP 5 лотов")
    assert result is not None
    assert result.direction == "sell"
    assert result.ticker == "GAZP"
    assert result.quantity == 5
    assert result.order_type == "market"


def test_buy_with_limit_price():
    """Should parse 'продать GAZP 5 лотов по 180' as limit sell."""
    result = parse_trade("продать GAZP 5 лотов по 180")
    assert result is not None
    assert result.direction == "sell"
    assert result.ticker == "GAZP"
    assert result.quantity == 5
    assert result.order_type == "limit"
    assert result.price == Decimal("180")


def test_buy_quantity_before_ticker():
    """Should parse 'купить 3 лота YNDX' (quantity before ticker)."""
    result = parse_trade("купить 3 лота YNDX")
    assert result is not None
    assert result.direction == "buy"
    assert result.ticker == "YNDX"
    assert result.quantity == 3
    assert result.order_type == "market"


def test_buy_quantity_before_ticker_with_price():
    """Should parse 'купить 5 лотов SBER по 285.50'."""
    result = parse_trade("купить 5 лотов SBER по 285.50")
    assert result is not None
    assert result.direction == "buy"
    assert result.ticker == "SBER"
    assert result.quantity == 5
    assert result.order_type == "limit"
    assert result.price == Decimal("285.50")


# ------------------------------------------------------------------
# Edge cases
# ------------------------------------------------------------------


def test_case_insensitive_direction():
    """Should handle uppercase direction words."""
    result = parse_trade("Купить SBER 1 лот")
    assert result is not None
    assert result.direction == "buy"


def test_single_lot():
    """Should handle singular 'лот'."""
    result = parse_trade("купить SBER 1 лот")
    assert result is not None
    assert result.quantity == 1


def test_ticker_uppercased():
    """Ticker should be uppercased in result."""
    result = parse_trade("купить SBER 10 лотов")
    assert result is not None
    assert result.ticker == "SBER"


# ------------------------------------------------------------------
# Non-trade text (should return None)
# ------------------------------------------------------------------


def test_non_trade_text_returns_none():
    """Should return None for non-trade text."""
    assert parse_trade("кофе 350") is None


def test_empty_text_returns_none():
    """Should return None for empty text."""
    assert parse_trade("") is None


def test_none_text_returns_none():
    """Should return None for None input."""
    assert parse_trade(None) is None


def test_random_text_returns_none():
    """Should return None for random text."""
    assert parse_trade("привет мир") is None


def test_direction_only_returns_none():
    """Should return None for just a direction word."""
    assert parse_trade("купить") is None
