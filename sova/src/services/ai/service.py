"""AI Service — orchestrates billing, context, LLM, and logging for AI queries."""

import logging
from decimal import Decimal

from sqlalchemy.ext.asyncio import AsyncSession

from src.services.ai.llm_provider import LLMProvider, LLMError
from src.services.ai.context_builder import ContextBuilder
from src.services.ai.prompts import (
    build_system_prompt,
    contains_forbidden_phrases,
    INVESTMENT_DISCLAIMER,
    QUERY_PROMPTS,
)
from src.services.billing_service import BillingService, InsufficientBalanceError
from src.models.ai_usage import AIUsageLog

logger = logging.getLogger(__name__)

# Cost per query type in rubles
QUERY_COSTS: dict[str, Decimal] = {
    "analyze_finances": Decimal("5"),
    "analyze_portfolio": Decimal("8"),
    "analyze_ticker": Decimal("10"),
    "analyze_expenses": Decimal("5"),
    "model_savings": Decimal("5"),
    "generate_digest": Decimal("12"),
    "chat": Decimal("3"),
    "smart_categorize": Decimal("0"),  # Free (Haiku)
}

# Query types that involve investment content (need disclaimer)
INVESTMENT_QUERY_TYPES = {"analyze_portfolio", "analyze_ticker"}


class AIService:
    """Core AI service handling all AI query types."""

    def __init__(self, db: AsyncSession, provider: LLMProvider):
        self.db = db
        self.provider = provider
        self.billing = BillingService(db)
        self.context_builder = ContextBuilder(db)

    def get_cost(self, query_type: str) -> Decimal:
        """Get cost for a query type."""
        return QUERY_COSTS.get(query_type, Decimal("3"))

    async def _execute_query(
        self,
        user_id: int,
        query_type: str,
        user_message: str,
        extra_instructions: str = "",
        user_level: str = "beginner",
    ) -> str:
        """Execute an AI query with billing, context, LLM call, and logging.

        Args:
            user_id: Telegram user ID.
            query_type: One of QUERY_COSTS keys.
            user_message: User's message/question.
            extra_instructions: Additional prompt instructions.
            user_level: User expertise level.

        Returns:
            AI response text.

        Raises:
            InsufficientBalanceError: If user doesn't have enough balance.
            LLMError: If LLM call fails.
        """
        cost = self.get_cost(query_type)

        # 1. Check balance (if paid query)
        if cost > 0:
            has_balance = await self.billing.has_sufficient_balance(user_id, cost)
            if not has_balance:
                raise InsufficientBalanceError(
                    f"Недостаточно средств. Нужно {cost}₽, пополните AI-баланс."
                )

        # 2. Build context
        context = await self.context_builder.build_context(user_id)

        # 3. Build system prompt
        system_prompt = build_system_prompt(
            query_type=query_type,
            user_level=user_level,
            extra_instructions=extra_instructions,
        )

        # 4. Build user message with context
        full_user_message = f"Контекст пользователя:\n{context}\n\nЗапрос: {user_message}"

        # 5. Call LLM
        response = await self.provider.complete(system_prompt, full_user_message)

        # 6. Safety check: filter forbidden phrases from response
        forbidden = contains_forbidden_phrases(response)
        if forbidden:
            logger.warning(
                "AI response contained forbidden phrases: %s (user_id=%d, query=%s)",
                forbidden, user_id, query_type,
            )
            # Add safety disclaimer
            response += (
                "\n\n⚠️ Обратите внимание: данная информация носит "
                "исключительно аналитический характер."
            )

        # 7. Add investment disclaimer if needed
        if query_type in INVESTMENT_QUERY_TYPES:
            response += INVESTMENT_DISCLAIMER

        # 8. Charge via BillingService (if paid)
        if cost > 0:
            await self.billing.charge(
                user_id=user_id,
                cost=cost,
                query_type=query_type,
            )

        return response

    # ------------------------------------------------------------------
    # Public API methods
    # ------------------------------------------------------------------

    async def analyze_finances(self, user_id: int) -> str:
        """Financial overview (5 rub)."""
        return await self._execute_query(
            user_id=user_id,
            query_type="analyze_finances",
            user_message="Проанализируй мои финансы",
        )

    async def analyze_portfolio(self, user_id: int) -> str:
        """Portfolio analysis (8 rub)."""
        return await self._execute_query(
            user_id=user_id,
            query_type="analyze_portfolio",
            user_message="Проанализируй мой инвестиционный портфель",
        )

    async def analyze_ticker(self, user_id: int, ticker: str) -> str:
        """Ticker analysis (10 rub)."""
        return await self._execute_query(
            user_id=user_id,
            query_type="analyze_ticker",
            user_message=f"Расскажи про тикер {ticker}",
            extra_instructions=f"Тикер для анализа: {ticker}",
        )

    async def analyze_expenses(self, user_id: int) -> str:
        """Expense pattern analysis (5 rub)."""
        return await self._execute_query(
            user_id=user_id,
            query_type="analyze_expenses",
            user_message="Куда уходят мои деньги?",
        )

    async def model_savings(
        self,
        user_id: int,
        goal: str,
        amount: Decimal,
        deadline: str,
    ) -> str:
        """Savings scenario modeling (5 rub)."""
        return await self._execute_query(
            user_id=user_id,
            query_type="model_savings",
            user_message=(
                f"Реально ли накопить {amount:,.0f}₽ на '{goal}' к {deadline}?"
            ),
            extra_instructions=(
                f"Цель: {goal}, сумма: {amount:,.0f}₽, дедлайн: {deadline}"
            ),
        )

    async def generate_digest(self, user_id: int, period: str = "daily") -> str:
        """Daily/weekly digest (12 rub)."""
        period_label = "за сегодня" if period == "daily" else "за неделю"
        return await self._execute_query(
            user_id=user_id,
            query_type="generate_digest",
            user_message=f"Сгенерируй финансовый дайджест {period_label}",
            extra_instructions=f"Период: {period}",
        )

    async def chat(self, user_id: int, message: str) -> str:
        """Free-form AI chat (3 rub)."""
        return await self._execute_query(
            user_id=user_id,
            query_type="chat",
            user_message=message,
        )

    async def smart_categorize(self, description: str) -> str:
        """AI-powered categorization (free, uses Haiku).

        This is a lightweight call — no billing, no context, no logging.
        """
        from src.services.expense_parser import CATEGORY_KEYWORDS

        categories = list(CATEGORY_KEYWORDS.keys()) + ["Другое"]
        try:
            return await self.provider.categorize(description, categories)
        except LLMError:
            logger.warning("Smart categorize failed for '%s', falling back", description)
            return "Другое"
