"""Bot handlers for AI queries and /digest command."""

import re
from decimal import Decimal

from aiogram import Router, F
from aiogram.filters import Command
from aiogram.types import Message, CallbackQuery, InlineKeyboardMarkup, InlineKeyboardButton
from sqlalchemy.ext.asyncio import AsyncSession

from src.services.ai.service import AIService, QUERY_COSTS
from src.services.ai.llm_provider import ClaudeProvider, FallbackProvider, LLMError
from src.services.billing_service import BillingService, InsufficientBalanceError
from src.config import settings

router = Router(name="ai")

# AI intent patterns (keyword -> query_type)
AI_INTENTS: list[tuple[re.Pattern, str]] = [
    (re.compile(r"что с (?:моими )?финанс", re.IGNORECASE), "analyze_finances"),
    (re.compile(r"мои финансы", re.IGNORECASE), "analyze_finances"),
    (re.compile(r"расскажи про (?:мой )?портфель", re.IGNORECASE), "analyze_portfolio"),
    (re.compile(r"мой портфель", re.IGNORECASE), "analyze_portfolio"),
    (re.compile(r"расскажи про ([A-Z]{1,5})", re.IGNORECASE), "analyze_ticker"),
    (re.compile(r"куда уходят деньги", re.IGNORECASE), "analyze_expenses"),
    (re.compile(r"реально ли накопить", re.IGNORECASE), "model_savings"),
    (re.compile(r"дайджест", re.IGNORECASE), "generate_digest"),
]

COST_CONFIRMATION_TEXT = (
    "🦉 Этот запрос стоит {cost}₽.\n"
    "Ваш баланс: {balance}₽\n\n"
    "Продолжить?"
)

INSUFFICIENT_BALANCE_TEXT = (
    "❌ Недостаточно средств.\n"
    "Стоимость запроса: {cost}₽\n"
    "Ваш баланс: {balance}₽\n\n"
    "Пополните AI-баланс через /menu → Баланс AI"
)

PROCESSING_TEXT = "🦉 Анализирую... Это займёт несколько секунд."

ERROR_TEXT = "❌ Произошла ошибка при обработке запроса. Попробуйте позже."


def _create_provider() -> FallbackProvider | None:
    """Create LLM provider, returning None if not configured."""
    if not settings.anthropic_api_key:
        return None
    claude = ClaudeProvider(api_key=settings.anthropic_api_key)
    return FallbackProvider([claude])


def detect_ai_intent(text: str) -> tuple[str | None, str | None]:
    """Detect AI intent from user message text.

    Returns (query_type, extra_data) or (None, None) if no AI intent.
    """
    for pattern, query_type in AI_INTENTS:
        match = pattern.search(text)
        if match:
            extra = match.group(1) if match.lastindex and match.lastindex >= 1 else None
            return query_type, extra
    return None, None


# ------------------------------------------------------------------
# /digest command
# ------------------------------------------------------------------

@router.message(Command("digest"))
async def handle_digest_command(message: Message, db: AsyncSession) -> None:
    """Handle /digest command — generate financial digest."""
    user_id = message.from_user.id
    billing = BillingService(db)
    cost = QUERY_COSTS["generate_digest"]
    balance = await billing.get_balance(user_id)

    if balance < cost:
        await message.answer(
            INSUFFICIENT_BALANCE_TEXT.format(cost=cost, balance=balance)
        )
        return

    # Show cost confirmation
    keyboard = InlineKeyboardMarkup(inline_keyboard=[
        [
            InlineKeyboardButton(
                text=f"Да, сгенерировать ({cost}₽)",
                callback_data="ai_confirm:generate_digest:",
            ),
            InlineKeyboardButton(text="Отмена", callback_data="ai_cancel"),
        ]
    ])

    await message.answer(
        COST_CONFIRMATION_TEXT.format(cost=cost, balance=balance),
        reply_markup=keyboard,
    )


# ------------------------------------------------------------------
# AI intent handler (text messages)
# ------------------------------------------------------------------

@router.message(F.text, ~F.text.startswith("/"))
async def handle_ai_text(message: Message, db: AsyncSession) -> None:
    """Detect AI intent in text messages and process.

    This handler should be registered BEFORE the expense handler
    so it can catch AI-intent messages first.
    """
    query_type, extra = detect_ai_intent(message.text)
    if query_type is None:
        return  # Not an AI intent, let next handler try

    user_id = message.from_user.id
    billing = BillingService(db)
    cost = QUERY_COSTS.get(query_type, Decimal("3"))
    balance = await billing.get_balance(user_id)

    if balance < cost:
        await message.answer(
            INSUFFICIENT_BALANCE_TEXT.format(cost=cost, balance=balance)
        )
        return

    # Build callback data with extra info
    extra_part = extra or ""
    callback_data = f"ai_confirm:{query_type}:{extra_part}"

    keyboard = InlineKeyboardMarkup(inline_keyboard=[
        [
            InlineKeyboardButton(
                text=f"Да ({cost}₽)",
                callback_data=callback_data,
            ),
            InlineKeyboardButton(text="Отмена", callback_data="ai_cancel"),
        ]
    ])

    await message.answer(
        COST_CONFIRMATION_TEXT.format(cost=cost, balance=balance),
        reply_markup=keyboard,
    )


# ------------------------------------------------------------------
# Callback: confirm AI query
# ------------------------------------------------------------------

@router.callback_query(F.data.startswith("ai_confirm:"))
async def handle_ai_confirm(callback: CallbackQuery, db: AsyncSession) -> None:
    """Process confirmed AI query."""
    await callback.answer()

    # Parse callback data: ai_confirm:query_type:extra
    parts = callback.data.split(":", 2)
    if len(parts) < 3:
        await callback.message.edit_text(ERROR_TEXT)
        return

    query_type = parts[1]
    extra = parts[2] if parts[2] else None
    user_id = callback.from_user.id

    provider = _create_provider()
    if provider is None:
        await callback.message.edit_text("❌ AI-сервис временно недоступен.")
        return

    await callback.message.edit_text(PROCESSING_TEXT)

    try:
        service = AIService(db, provider)

        if query_type == "analyze_finances":
            result = await service.analyze_finances(user_id)
        elif query_type == "analyze_portfolio":
            result = await service.analyze_portfolio(user_id)
        elif query_type == "analyze_ticker" and extra:
            result = await service.analyze_ticker(user_id, extra)
        elif query_type == "analyze_expenses":
            result = await service.analyze_expenses(user_id)
        elif query_type == "generate_digest":
            result = await service.generate_digest(user_id)
        elif query_type == "chat":
            result = await service.chat(user_id, extra or "")
        else:
            result = await service.chat(user_id, f"{query_type} {extra or ''}")

        # Truncate if too long for Telegram (4096 chars)
        if len(result) > 4000:
            result = result[:3997] + "..."

        await callback.message.edit_text(f"🦉 {result}")

    except InsufficientBalanceError:
        balance = await BillingService(db).get_balance(user_id)
        cost = QUERY_COSTS.get(query_type, Decimal("3"))
        await callback.message.edit_text(
            INSUFFICIENT_BALANCE_TEXT.format(cost=cost, balance=balance)
        )
    except LLMError as e:
        logger.error("LLM error for user %d: %s", user_id, e)
        await callback.message.edit_text(ERROR_TEXT)
    except Exception as e:
        logger.error("Unexpected error in AI handler: %s", e)
        await callback.message.edit_text(ERROR_TEXT)


# ------------------------------------------------------------------
# Callback: cancel AI query
# ------------------------------------------------------------------

@router.callback_query(F.data == "ai_cancel")
async def handle_ai_cancel(callback: CallbackQuery) -> None:
    """Cancel AI query."""
    await callback.answer("Отменено")
    await callback.message.edit_text("Запрос отменён.")


import logging
logger = logging.getLogger(__name__)
