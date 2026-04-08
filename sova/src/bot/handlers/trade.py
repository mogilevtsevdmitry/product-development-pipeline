"""Bot handlers for trading commands.

Parses trade commands from natural language, shows order details
with legal disclaimer, handles confirm/cancel callbacks.

LEGAL: Every trade confirmation MUST include:
"⚠️ Сделка инициирована вами. Сервис не даёт инвестиционных рекомендаций."
"""

import logging
import uuid
from decimal import Decimal

from aiogram import Router, F
from aiogram.types import (
    Message,
    CallbackQuery,
    InlineKeyboardMarkup,
    InlineKeyboardButton,
)
from sqlalchemy.ext.asyncio import AsyncSession

from src.services.trade_parser import parse_trade
from src.services.trade_service import (
    TradeService,
    TradeError,
    OrderNotFoundError,
    OrderExpiredError,
    PriceDeviationError,
    TradeLimitExceededError,
    DEFAULT_TRADE_LIMIT,
)

logger = logging.getLogger(__name__)

router = Router(name="trade")

LEGAL_DISCLAIMER = (
    "⚠️ Сделка инициирована вами. "
    "Сервис не даёт инвестиционных рекомендаций."
)

ORDER_PREVIEW_TEXT = (
    "📋 Заявка на {direction_text}:\n"
    "{ticker} × {quantity} лотов\n"
    "Тип: {order_type_text}\n"
    "{price_line}"
    "\n{disclaimer}\n"
)

ORDER_PREVIEW_WITH_LIMIT_WARNING = (
    "📋 Заявка на {direction_text}:\n"
    "{ticker} × {quantity} лотов\n"
    "Тип: {order_type_text}\n"
    "{price_line}"
    "\n⚠️ Сумма сделки превышает {limit:,.0f}₽. "
    "Требуется дополнительное подтверждение.\n"
    "\n{disclaimer}\n"
)

EXECUTION_SUCCESS_TEXT = (
    "✅ Заявка исполнена: {ticker} × {quantity} по {price}₽"
)

EXECUTION_FAILED_TEXT = "❌ Не удалось исполнить заявку. Попробуйте позже."

ORDER_EXPIRED_TEXT = (
    "⏰ Заявка отменена — истёк таймаут подтверждения (60 сек).\n"
    "Цена могла измениться."
)

PRICE_CHANGED_TEXT = (
    "⚠️ Цена изменилась с {old_price}₽ до {new_price}₽.\n"
    "Подтвердите заявку по новой цене."
)

PARSE_ERROR_TEXT = (
    "❓ Не удалось распознать торговую команду.\n"
    "Примеры:\n"
    "• купить SBER 10 лотов\n"
    "• продать GAZP 5 лотов по 180\n"
    "• купить 3 лота YNDX"
)

NO_TBANK_TEXT = (
    "❌ Для торговли необходимо подключить T-Bank.\n"
    "Используйте /menu → Настройки → Подключить T-Bank"
)


def _direction_text(direction: str) -> str:
    return "покупку" if direction == "buy" else "продажу"


def _order_type_text(order_type: str) -> str:
    return "Рыночная" if order_type == "market" else "Лимитная"


def _build_price_line(order_type: str, price: Decimal | None) -> str:
    if order_type == "limit" and price is not None:
        return f"Цена: {price}₽ за лот\n"
    return ""


# ------------------------------------------------------------------
# Trade text handler (catches trade-like messages)
# ------------------------------------------------------------------


@router.message(F.text, ~F.text.startswith("/"))
async def handle_trade_text(message: Message, db: AsyncSession) -> None:
    """Parse trade commands from text messages.

    This handler should be registered BEFORE the AI handler and expense
    handler so it catches trade commands first.
    """
    parsed = parse_trade(message.text)
    if parsed is None:
        return  # Not a trade command, let next handler try

    user_id = message.from_user.id

    # Create the order
    service = TradeService(db)
    order = await service.create_order(
        user_id=user_id,
        ticker=parsed.ticker,
        direction=parsed.direction,
        quantity=parsed.quantity,
        order_type=parsed.order_type,
        price=parsed.price,
    )

    # Check trade limit
    estimated_price = parsed.price or Decimal("0")
    exceeds_limit = False
    if estimated_price > 0:
        total = estimated_price * parsed.quantity
        if total > DEFAULT_TRADE_LIMIT:
            exceeds_limit = True

    # Build message
    price_line = _build_price_line(parsed.order_type, parsed.price)
    direction_text = _direction_text(parsed.direction)
    order_type_text = _order_type_text(parsed.order_type)

    if exceeds_limit:
        text = ORDER_PREVIEW_WITH_LIMIT_WARNING.format(
            direction_text=direction_text,
            ticker=parsed.ticker,
            quantity=parsed.quantity,
            order_type_text=order_type_text,
            price_line=price_line,
            limit=DEFAULT_TRADE_LIMIT,
            disclaimer=LEGAL_DISCLAIMER,
        )
    else:
        text = ORDER_PREVIEW_TEXT.format(
            direction_text=direction_text,
            ticker=parsed.ticker,
            quantity=parsed.quantity,
            order_type_text=order_type_text,
            price_line=price_line,
            disclaimer=LEGAL_DISCLAIMER,
        )

    # Confirmation buttons
    keyboard = InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(
                    text="Подтвердить",
                    callback_data=f"trade_confirm:{order.id}",
                ),
                InlineKeyboardButton(
                    text="Отмена",
                    callback_data=f"trade_cancel:{order.id}",
                ),
            ]
        ]
    )

    await message.answer(text, reply_markup=keyboard)


# ------------------------------------------------------------------
# Callback: confirm trade
# ------------------------------------------------------------------


@router.callback_query(F.data.startswith("trade_confirm:"))
async def handle_trade_confirm(callback: CallbackQuery, db: AsyncSession) -> None:
    """Handle trade confirmation callback."""
    await callback.answer()

    order_id_str = callback.data.split(":", 1)[1]
    try:
        order_id = uuid.UUID(order_id_str)
    except (ValueError, TypeError):
        await callback.message.edit_text("❌ Неверный идентификатор заявки.")
        return

    service = TradeService(db)

    try:
        order = await service.confirm_order(order_id)

        # TODO: In production, enqueue to Trade Worker via Redis.
        # For now, just show submitted status.
        await callback.message.edit_text(
            f"📤 Заявка отправлена на исполнение.\n"
            f"{order.ticker} × {order.quantity} лотов ({order.direction})\n"
            f"\n{LEGAL_DISCLAIMER}"
        )

    except OrderExpiredError:
        await callback.message.edit_text(ORDER_EXPIRED_TEXT)

    except PriceDeviationError as e:
        # Re-show with updated price
        text = PRICE_CHANGED_TEXT.format(
            old_price=e.old_price,
            new_price=e.new_price,
        )
        # Create new order with updated price
        old_order = await service.get_order(order_id)
        if old_order:
            new_order = await service.create_order(
                user_id=old_order.user_id,
                ticker=old_order.ticker,
                direction=old_order.direction,
                quantity=old_order.quantity,
                order_type=old_order.order_type,
                price=e.new_price,
            )
            keyboard = InlineKeyboardMarkup(
                inline_keyboard=[
                    [
                        InlineKeyboardButton(
                            text="Подтвердить",
                            callback_data=f"trade_confirm:{new_order.id}",
                        ),
                        InlineKeyboardButton(
                            text="Отмена",
                            callback_data=f"trade_cancel:{new_order.id}",
                        ),
                    ]
                ]
            )
            await callback.message.edit_text(text, reply_markup=keyboard)
        else:
            await callback.message.edit_text(text)

    except OrderNotFoundError:
        await callback.message.edit_text("❌ Заявка не найдена или уже обработана.")

    except TradeError as e:
        logger.error("Trade error: %s", e)
        await callback.message.edit_text(EXECUTION_FAILED_TEXT)

    except Exception as e:
        logger.error("Unexpected error in trade confirm: %s", e)
        await callback.message.edit_text(EXECUTION_FAILED_TEXT)


# ------------------------------------------------------------------
# Callback: cancel trade
# ------------------------------------------------------------------


@router.callback_query(F.data.startswith("trade_cancel:"))
async def handle_trade_cancel(callback: CallbackQuery, db: AsyncSession) -> None:
    """Handle trade cancellation callback."""
    await callback.answer("Отменено")

    order_id_str = callback.data.split(":", 1)[1]
    try:
        order_id = uuid.UUID(order_id_str)
    except (ValueError, TypeError):
        await callback.message.edit_text("Заявка отменена.")
        return

    service = TradeService(db)
    try:
        await service.cancel_order(order_id)
    except OrderNotFoundError:
        pass  # Already cancelled or doesn't exist

    await callback.message.edit_text("Заявка отменена.")
