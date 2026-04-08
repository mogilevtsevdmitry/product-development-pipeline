"""Tests for AI prompts — system prompt building and legal restrictions."""

import pytest

from src.services.ai.prompts import (
    build_system_prompt,
    contains_forbidden_phrases,
    BASE_SYSTEM_PROMPT,
    INVESTMENT_DISCLAIMER,
    LEVEL_INSTRUCTIONS,
    QUERY_PROMPTS,
    FORBIDDEN_PHRASES,
)


# ------------------------------------------------------------------
# build_system_prompt
# ------------------------------------------------------------------


def test_system_prompt_contains_legal_restrictions():
    """System prompt must contain the legal restriction block."""
    prompt = build_system_prompt("chat")
    assert "КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО" in prompt
    assert "купи" in prompt
    assert "продай" in prompt
    assert "рекомендую" in prompt


def test_system_prompt_contains_allowed_actions():
    """System prompt must describe what AI CAN do."""
    prompt = build_system_prompt("chat")
    assert "МОЖНО" in prompt
    assert "P/E" in prompt
    assert "дивидендная доходность" in prompt


def test_system_prompt_contains_disclaimer_instruction():
    """System prompt must instruct AI to add disclaimer."""
    prompt = build_system_prompt("chat")
    assert "не является инвестиционной рекомендацией" in prompt


def test_system_prompt_adapts_to_level():
    """Prompt should include level-specific instructions."""
    beginner_prompt = build_system_prompt("chat", user_level="beginner")
    assert "новичок" in beginner_prompt.lower()

    advanced_prompt = build_system_prompt("chat", user_level="advanced")
    assert "опытный инвестор" in advanced_prompt.lower()


def test_system_prompt_includes_query_instructions():
    """Prompt should include query-type-specific instructions."""
    prompt = build_system_prompt("analyze_portfolio")
    assert "портфель" in prompt.lower()
    assert "P/E" in prompt


def test_system_prompt_includes_extra_instructions():
    """Extra instructions should be appended."""
    prompt = build_system_prompt("analyze_ticker", extra_instructions="Тикер: SBER")
    assert "Тикер: SBER" in prompt


def test_system_prompt_defaults_to_beginner():
    """Unknown level should default to beginner."""
    prompt = build_system_prompt("chat", user_level="unknown_level")
    assert "новичок" in prompt.lower()


# ------------------------------------------------------------------
# contains_forbidden_phrases
# ------------------------------------------------------------------


def test_forbidden_phrases_detected():
    """Should detect forbidden investment phrases."""
    text = "Я рекомендую купить акции Газпрома"
    found = contains_forbidden_phrases(text)
    assert "купи" in found  # "купить" contains "купи"
    assert "рекомендую" in found


def test_no_forbidden_phrases_in_clean_text():
    """Should return empty list for clean text."""
    text = "P/E компании составляет 8.5, что ниже среднеотраслевого"
    found = contains_forbidden_phrases(text)
    assert found == []


def test_forbidden_phrases_case_insensitive():
    """Should detect regardless of case."""
    text = "СТОИТ КУПИТЬ эти акции"
    found = contains_forbidden_phrases(text)
    assert "стоит купить" in found


# ------------------------------------------------------------------
# Constants validation
# ------------------------------------------------------------------


def test_all_query_types_have_prompts():
    """Every query type should have a prompt template."""
    expected_types = [
        "analyze_finances", "analyze_portfolio", "analyze_ticker",
        "analyze_expenses", "model_savings", "generate_digest", "chat",
    ]
    for qt in expected_types:
        assert qt in QUERY_PROMPTS, f"Missing prompt for {qt}"


def test_investment_disclaimer_present():
    """Investment disclaimer constant should exist and contain key text."""
    assert "не является инвестиционной рекомендацией" in INVESTMENT_DISCLAIMER
