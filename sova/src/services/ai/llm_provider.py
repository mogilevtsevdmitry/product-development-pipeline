"""LLM Provider abstraction with Claude implementation and fallback logic."""

import logging
from abc import ABC, abstractmethod

import httpx

logger = logging.getLogger(__name__)

DEFAULT_API_URL = "https://api.anthropic.com/v1/messages"
ANTHROPIC_VERSION = "2023-06-01"

# Model identifiers
MODEL_SONNET = "claude-sonnet-4-20250514"
MODEL_HAIKU = "claude-haiku-4-20250514"

MAX_CONSECUTIVE_FAILURES = 3


class LLMError(Exception):
    """Raised when LLM call fails."""


class LLMProvider(ABC):
    """Abstract base for LLM providers."""

    @abstractmethod
    async def complete(self, system: str, user: str) -> str:
        """Send a completion request (Sonnet-class model).

        Args:
            system: System prompt.
            user: User message.

        Returns:
            Model response text.
        """
        ...

    @abstractmethod
    async def categorize(self, description: str, categories: list[str]) -> str:
        """Categorize an expense description (Haiku-class model).

        Args:
            description: Expense description text.
            categories: List of valid category names.

        Returns:
            Best matching category name.
        """
        ...


class ClaudeProvider(LLMProvider):
    """Claude API provider using httpx.

    Supports custom base_url for OpenRouter or other compatible APIs.
    """

    def __init__(
        self, api_key: str, base_url: str = "", timeout: float = 30.0
    ):
        if not api_key:
            raise ValueError("ANTHROPIC_API_KEY is required")
        self._api_key = api_key
        self._base_url = base_url.rstrip("/") if base_url else ""
        self._timeout = timeout

    @property
    def _api_url(self) -> str:
        """Resolve API endpoint: custom base_url or default Anthropic."""
        if self._base_url:
            return f"{self._base_url}/messages"
        return DEFAULT_API_URL

    def _headers(self) -> dict[str, str]:
        headers = {
            "x-api-key": self._api_key,
            "anthropic-version": ANTHROPIC_VERSION,
            "content-type": "application/json",
        }
        # OpenRouter uses Authorization header instead of x-api-key
        if self._base_url and "openrouter" in self._base_url:
            headers["Authorization"] = f"Bearer {self._api_key}"
        return headers

    async def _call(
        self, model: str, system: str, user: str, max_tokens: int = 2048
    ) -> str:
        """Make a Claude API call."""
        payload = {
            "model": model,
            "max_tokens": max_tokens,
            "system": system,
            "messages": [{"role": "user", "content": user}],
        }

        async with httpx.AsyncClient(timeout=self._timeout) as client:
            try:
                resp = await client.post(
                    self._api_url, headers=self._headers(), json=payload
                )
                resp.raise_for_status()
            except httpx.HTTPStatusError as e:
                logger.error("LLM API HTTP error: %s %s", e.response.status_code, e.response.text)
                raise LLMError(f"LLM API error: {e.response.status_code}") from e
            except httpx.RequestError as e:
                logger.error("LLM API request error: %s", str(e))
                raise LLMError(f"LLM API request error: {e}") from e

        data = resp.json()
        # Extract text from content blocks
        content_blocks = data.get("content", [])
        texts = [b["text"] for b in content_blocks if b.get("type") == "text"]
        if not texts:
            raise LLMError("No text content in LLM response")
        return "\n".join(texts)

    async def complete(self, system: str, user: str) -> str:
        """Complete using Sonnet model."""
        return await self._call(MODEL_SONNET, system, user, max_tokens=2048)

    async def categorize(self, description: str, categories: list[str]) -> str:
        """Categorize using Haiku model (fast, cheap)."""
        system = (
            "You are a financial transaction categorizer. "
            "Given a transaction description, return ONLY the best matching category name "
            "from the provided list. Return the category name exactly as given, nothing else."
        )
        user = (
            f"Description: {description}\n"
            f"Categories: {', '.join(categories)}\n"
            f"Best category:"
        )
        result = await self._call(MODEL_HAIKU, system, user, max_tokens=50)
        # Clean up: take first line, strip whitespace
        result = result.strip().split("\n")[0].strip()
        # Validate against known categories
        for cat in categories:
            if cat.lower() == result.lower():
                return cat
        # If no exact match, return as-is (caller can fallback)
        return result


class FallbackProvider(LLMProvider):
    """Wraps multiple providers; switches to next after consecutive failures."""

    def __init__(self, providers: list[LLMProvider]):
        if not providers:
            raise ValueError("At least one provider is required")
        self._providers = providers
        self._current_index = 0
        self._consecutive_failures = 0

    @property
    def current_provider(self) -> LLMProvider:
        return self._providers[self._current_index]

    def _switch_provider(self) -> None:
        """Switch to next provider after too many failures."""
        next_index = (self._current_index + 1) % len(self._providers)
        if next_index != self._current_index:
            logger.warning(
                "Switching LLM provider from %d to %d after %d failures",
                self._current_index,
                next_index,
                self._consecutive_failures,
            )
            self._current_index = next_index
            self._consecutive_failures = 0

    async def complete(self, system: str, user: str) -> str:
        try:
            result = await self.current_provider.complete(system, user)
            self._consecutive_failures = 0
            return result
        except LLMError:
            self._consecutive_failures += 1
            if self._consecutive_failures >= MAX_CONSECUTIVE_FAILURES:
                self._switch_provider()
            raise

    async def categorize(self, description: str, categories: list[str]) -> str:
        try:
            result = await self.current_provider.categorize(description, categories)
            self._consecutive_failures = 0
            return result
        except LLMError:
            self._consecutive_failures += 1
            if self._consecutive_failures >= MAX_CONSECUTIVE_FAILURES:
                self._switch_provider()
            raise
