"""Tests for AI Service — full flow with mocked LLM provider."""

import pytest
from decimal import Decimal
from unittest.mock import AsyncMock

from src.models.user import User
from src.services.user_service import UserService
from src.services.billing_service import BillingService, InsufficientBalanceError
from src.services.ai.service import AIService, QUERY_COSTS, INVESTMENT_QUERY_TYPES
from src.services.ai.llm_provider import LLMProvider, LLMError
from src.services.ai.prompts import INVESTMENT_DISCLAIMER


async def _create_funded_user(db, user_id: int = 800001, balance: Decimal = Decimal("100")) -> User:
    """Create user and top up their AI balance."""
    service = UserService(db)
    user, _ = await service.get_or_create(user_id, "ai_test", "AT")
    billing = BillingService(db)
    await billing.topup(user_id, balance, int(balance / 2), "tg_ai", f"topup_ai_{user_id}")
    return user


def _mock_provider(response: str = "AI analysis result") -> AsyncMock:
    """Create a mock LLM provider."""
    provider = AsyncMock(spec=LLMProvider)
    provider.complete = AsyncMock(return_value=response)
    provider.categorize = AsyncMock(return_value="Еда")
    return provider


# ------------------------------------------------------------------
# Cost table
# ------------------------------------------------------------------


def test_query_costs_defined():
    """All expected query types should have costs."""
    assert QUERY_COSTS["analyze_finances"] == Decimal("5")
    assert QUERY_COSTS["analyze_portfolio"] == Decimal("8")
    assert QUERY_COSTS["analyze_ticker"] == Decimal("10")
    assert QUERY_COSTS["analyze_expenses"] == Decimal("5")
    assert QUERY_COSTS["model_savings"] == Decimal("5")
    assert QUERY_COSTS["generate_digest"] == Decimal("12")
    assert QUERY_COSTS["chat"] == Decimal("3")
    assert QUERY_COSTS["smart_categorize"] == Decimal("0")


# ------------------------------------------------------------------
# analyze_finances
# ------------------------------------------------------------------


async def test_analyze_finances_charges_user(db):
    """Should charge 5 rub and return LLM response."""
    await _create_funded_user(db, 800001)
    provider = _mock_provider("Your finances look good")
    service = AIService(db, provider)

    result = await service.analyze_finances(800001)

    assert "Your finances look good" in result
    provider.complete.assert_called_once()

    # Check balance was charged
    billing = BillingService(db)
    balance = await billing.get_balance(800001)
    assert balance == Decimal("95")  # 100 - 5


async def test_analyze_finances_insufficient_balance(db):
    """Should raise InsufficientBalanceError if balance too low."""
    await _create_funded_user(db, 800002, balance=Decimal("3"))
    provider = _mock_provider()
    service = AIService(db, provider)

    with pytest.raises(InsufficientBalanceError):
        await service.analyze_finances(800002)

    # Provider should NOT have been called
    provider.complete.assert_not_called()


# ------------------------------------------------------------------
# analyze_portfolio (investment — needs disclaimer)
# ------------------------------------------------------------------


async def test_analyze_portfolio_adds_disclaimer(db):
    """Portfolio analysis should append investment disclaimer."""
    await _create_funded_user(db, 800003)
    provider = _mock_provider("Portfolio is diversified")
    service = AIService(db, provider)

    result = await service.analyze_portfolio(800003)

    assert "Portfolio is diversified" in result
    assert "не является инвестиционной рекомендацией" in result


# ------------------------------------------------------------------
# analyze_ticker
# ------------------------------------------------------------------


async def test_analyze_ticker_charges_10(db):
    """Ticker analysis should charge 10 rub."""
    await _create_funded_user(db, 800004)
    provider = _mock_provider("SBER analysis")
    service = AIService(db, provider)

    result = await service.analyze_ticker(800004, "SBER")

    assert "SBER analysis" in result
    billing = BillingService(db)
    balance = await billing.get_balance(800004)
    assert balance == Decimal("90")  # 100 - 10


# ------------------------------------------------------------------
# chat
# ------------------------------------------------------------------


async def test_chat_charges_3(db):
    """Chat should charge 3 rub."""
    await _create_funded_user(db, 800005)
    provider = _mock_provider("Here is the answer")
    service = AIService(db, provider)

    result = await service.chat(800005, "What about my budget?")

    assert "Here is the answer" in result
    billing = BillingService(db)
    balance = await billing.get_balance(800005)
    assert balance == Decimal("97")  # 100 - 3


# ------------------------------------------------------------------
# smart_categorize (free, Haiku)
# ------------------------------------------------------------------


async def test_smart_categorize_free(db):
    """Smart categorize should be free — no balance check."""
    service_user = UserService(db)
    await service_user.get_or_create(800006, "cat_test", "CT")

    provider = _mock_provider()
    provider.categorize = AsyncMock(return_value="Транспорт")
    service = AIService(db, provider)

    result = await service.smart_categorize("такси до работы")

    assert result == "Транспорт"
    provider.categorize.assert_called_once()
    # Balance should be unchanged (0)
    billing = BillingService(db)
    balance = await billing.get_balance(800006)
    assert balance == Decimal("0")


async def test_smart_categorize_fallback_on_error(db):
    """Should return 'Другое' if LLM fails."""
    service_user = UserService(db)
    await service_user.get_or_create(800007, "cat_err", "CE")

    provider = _mock_provider()
    provider.categorize = AsyncMock(side_effect=LLMError("fail"))
    service = AIService(db, provider)

    result = await service.smart_categorize("something unknown")
    assert result == "Другое"


# ------------------------------------------------------------------
# generate_digest
# ------------------------------------------------------------------


async def test_generate_digest_charges_12(db):
    """Digest should charge 12 rub."""
    await _create_funded_user(db, 800008)
    provider = _mock_provider("Daily digest content")
    service = AIService(db, provider)

    result = await service.generate_digest(800008, "daily")

    assert "Daily digest content" in result
    billing = BillingService(db)
    balance = await billing.get_balance(800008)
    assert balance == Decimal("88")  # 100 - 12


# ------------------------------------------------------------------
# Forbidden phrase filtering
# ------------------------------------------------------------------


async def test_forbidden_phrases_trigger_extra_disclaimer(db):
    """If LLM response contains forbidden phrases, extra disclaimer is added."""
    await _create_funded_user(db, 800009)
    # Simulate LLM returning forbidden text
    provider = _mock_provider("Я рекомендую обратить внимание на диверсификацию")
    service = AIService(db, provider)

    result = await service.analyze_finances(800009)

    # Should have the extra safety disclaimer
    assert "исключительно аналитический характер" in result


# ------------------------------------------------------------------
# get_cost
# ------------------------------------------------------------------


def test_get_cost_known_type():
    """Should return correct cost for known type."""
    from unittest.mock import MagicMock
    service = AIService.__new__(AIService)
    assert service.get_cost("chat") == Decimal("3")
    assert service.get_cost("analyze_portfolio") == Decimal("8")


def test_get_cost_unknown_defaults_to_3():
    """Unknown query type should default to 3 rub."""
    service = AIService.__new__(AIService)
    assert service.get_cost("unknown_type") == Decimal("3")
