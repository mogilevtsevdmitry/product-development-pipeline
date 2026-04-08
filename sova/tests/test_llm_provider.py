"""Tests for LLM Provider — ClaudeProvider and FallbackProvider."""

import pytest
from unittest.mock import AsyncMock, patch, MagicMock
import httpx

from src.services.ai.llm_provider import (
    LLMProvider,
    ClaudeProvider,
    FallbackProvider,
    LLMError,
    MODEL_SONNET,
    MODEL_HAIKU,
    CLAUDE_API_URL,
    MAX_CONSECUTIVE_FAILURES,
)


# ------------------------------------------------------------------
# ClaudeProvider
# ------------------------------------------------------------------


def test_claude_provider_requires_api_key():
    """Should raise ValueError if no API key."""
    with pytest.raises(ValueError, match="ANTHROPIC_API_KEY"):
        ClaudeProvider(api_key="")


async def test_claude_provider_complete_success():
    """Should return text from Claude API response."""
    provider = ClaudeProvider(api_key="test-key")

    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.raise_for_status = MagicMock()
    mock_response.json.return_value = {
        "content": [{"type": "text", "text": "Analysis result"}],
    }

    with patch("httpx.AsyncClient") as mock_client_cls:
        mock_client = AsyncMock()
        mock_client.post = AsyncMock(return_value=mock_response)
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client_cls.return_value = mock_client

        result = await provider.complete("system prompt", "user message")

    assert result == "Analysis result"
    mock_client.post.assert_called_once()
    call_args = mock_client.post.call_args
    assert call_args[0][0] == CLAUDE_API_URL
    payload = call_args[1]["json"]
    assert payload["model"] == MODEL_SONNET
    assert payload["system"] == "system prompt"


async def test_claude_provider_complete_http_error():
    """Should raise LLMError on HTTP error."""
    provider = ClaudeProvider(api_key="test-key")

    mock_response = MagicMock()
    mock_response.status_code = 500
    mock_response.text = "Internal Server Error"
    mock_response.raise_for_status.side_effect = httpx.HTTPStatusError(
        "Error", request=MagicMock(), response=mock_response,
    )

    with patch("httpx.AsyncClient") as mock_client_cls:
        mock_client = AsyncMock()
        mock_client.post = AsyncMock(return_value=mock_response)
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client_cls.return_value = mock_client

        with pytest.raises(LLMError, match="Claude API error: 500"):
            await provider.complete("sys", "user")


async def test_claude_provider_categorize_success():
    """Should return matched category name."""
    provider = ClaudeProvider(api_key="test-key")

    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.raise_for_status = MagicMock()
    mock_response.json.return_value = {
        "content": [{"type": "text", "text": "Еда"}],
    }

    with patch("httpx.AsyncClient") as mock_client_cls:
        mock_client = AsyncMock()
        mock_client.post = AsyncMock(return_value=mock_response)
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client_cls.return_value = mock_client

        result = await provider.categorize("кофе латте", ["Еда", "Транспорт", "Другое"])

    assert result == "Еда"
    # Verify Haiku model is used
    payload = mock_client.post.call_args[1]["json"]
    assert payload["model"] == MODEL_HAIKU


async def test_claude_provider_no_text_content():
    """Should raise LLMError if response has no text blocks."""
    provider = ClaudeProvider(api_key="test-key")

    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.raise_for_status = MagicMock()
    mock_response.json.return_value = {"content": []}

    with patch("httpx.AsyncClient") as mock_client_cls:
        mock_client = AsyncMock()
        mock_client.post = AsyncMock(return_value=mock_response)
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client_cls.return_value = mock_client

        with pytest.raises(LLMError, match="No text content"):
            await provider.complete("sys", "user")


# ------------------------------------------------------------------
# FallbackProvider
# ------------------------------------------------------------------


def test_fallback_requires_providers():
    """Should raise ValueError with empty list."""
    with pytest.raises(ValueError, match="At least one provider"):
        FallbackProvider([])


async def test_fallback_success_resets_failures():
    """Successful call should reset consecutive failure counter."""
    mock_provider = AsyncMock(spec=LLMProvider)
    mock_provider.complete = AsyncMock(return_value="ok")

    fallback = FallbackProvider([mock_provider])
    result = await fallback.complete("sys", "user")

    assert result == "ok"
    assert fallback._consecutive_failures == 0


async def test_fallback_switches_after_max_failures():
    """Should switch to next provider after MAX_CONSECUTIVE_FAILURES."""
    provider_a = AsyncMock(spec=LLMProvider)
    provider_a.complete = AsyncMock(side_effect=LLMError("fail"))

    provider_b = AsyncMock(spec=LLMProvider)
    provider_b.complete = AsyncMock(return_value="ok from b")

    fallback = FallbackProvider([provider_a, provider_b])

    # Fail MAX_CONSECUTIVE_FAILURES times
    for _ in range(MAX_CONSECUTIVE_FAILURES):
        with pytest.raises(LLMError):
            await fallback.complete("sys", "user")

    # Should have switched to provider_b
    assert fallback._current_index == 1

    # Next call should use provider_b
    result = await fallback.complete("sys", "user")
    assert result == "ok from b"


async def test_fallback_categorize_works():
    """Categorize should also go through fallback logic."""
    mock_provider = AsyncMock(spec=LLMProvider)
    mock_provider.categorize = AsyncMock(return_value="Транспорт")

    fallback = FallbackProvider([mock_provider])
    result = await fallback.categorize("такси", ["Еда", "Транспорт"])

    assert result == "Транспорт"
