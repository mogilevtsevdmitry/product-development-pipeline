"""Billing handlers — AI balance, top-up, withdrawal, history."""

from decimal import Decimal

from aiogram import Router, F
from aiogram.filters import Command
from aiogram.types import (
    Message,
    CallbackQuery,
    PreCheckoutQuery,
    ContentType,
    LabeledPrice,
)
from sqlalchemy.ext.asyncio import AsyncSession

from src.services.billing_service import (
    BillingService,
    InsufficientWithdrawalError,
    MIN_WITHDRAWAL,
)
from src.bot.keyboards.billing import ai_balance_keyboard, withdraw_confirm_keyboard

router = Router(name="billing")

# Stars-to-rubles conversion: 1 Star ~ 1.3₽ (approximate, Telegram sets actual rate)
# For simplicity we use fixed amounts in rubles, Stars amount computed at payment time.
TOPUP_PRICES = {
    "100": (Decimal("100.00"), 50),   # 100₽ ~ 50 Stars
    "300": (Decimal("300.00"), 150),   # 300₽ ~ 150 Stars
    "500": (Decimal("500.00"), 250),   # 500₽ ~ 250 Stars
}


def _format_balance_text(balance: Decimal) -> str:
    return (
        f"💎 *AI-баланс:* {balance:.2f} ₽\n\n"
        "Пополни баланс, чтобы использовать AI-аналитику, дайджесты и чат."
    )


def _format_history(history: list[dict]) -> str:
    if not history:
        return "📜 История операций пуста."

    lines = ["📜 *История AI-баланса:*\n"]
    type_labels = {
        "topup": "➕ Пополнение",
        "withdrawal": "💸 Вывод",
        "charge": "🤖 Списание",
    }
    for entry in history:
        label = type_labels.get(entry["type"], entry["type"])
        amount = entry["amount"]
        date_str = entry["date"].strftime("%d.%m %H:%M")
        detail = f" ({entry['details']})" if entry.get("details") else ""
        sign = "+" if entry["type"] == "topup" else "-"
        lines.append(f"  {label}: {sign}{amount:.2f}₽{detail} — {date_str}")

    return "\n".join(lines)


# ------------------------------------------------------------------
# /ai_balance command + menu callback
# ------------------------------------------------------------------


@router.message(Command("ai_balance"))
async def cmd_ai_balance(message: Message, db: AsyncSession) -> None:
    """Show AI balance with top-up buttons."""
    billing = BillingService(db)
    balance = await billing.get_balance(message.from_user.id)
    await message.answer(
        _format_balance_text(balance),
        reply_markup=ai_balance_keyboard(),
    )


@router.callback_query(F.data == "menu:ai_balance")
async def on_ai_balance_callback(callback: CallbackQuery, db: AsyncSession) -> None:
    """Handle AI balance callback from main menu."""
    billing = BillingService(db)
    balance = await billing.get_balance(callback.from_user.id)
    await callback.message.edit_text(
        _format_balance_text(balance),
        reply_markup=ai_balance_keyboard(),
    )
    await callback.answer()


# ------------------------------------------------------------------
# Top-up flow via Telegram Stars
# ------------------------------------------------------------------


@router.callback_query(F.data.startswith("billing:topup:"))
async def on_topup_select(callback: CallbackQuery, db: AsyncSession) -> None:
    """User selected a top-up amount — send Telegram Stars invoice."""
    amount_key = callback.data.split(":")[2]
    if amount_key not in TOPUP_PRICES:
        await callback.answer("Неизвестная сумма", show_alert=True)
        return

    rub_amount, stars = TOPUP_PRICES[amount_key]

    await callback.message.answer_invoice(
        title="Пополнение AI-баланса",
        description=f"Пополнение на {rub_amount:.0f}₽ для AI-аналитики в Сове",
        payload=f"topup_{callback.from_user.id}_{amount_key}",
        currency="XTR",  # Telegram Stars currency
        prices=[LabeledPrice(label=f"AI-баланс +{rub_amount:.0f}₽", amount=stars)],
    )
    await callback.answer()


@router.pre_checkout_query()
async def on_pre_checkout(query: PreCheckoutQuery, db: AsyncSession) -> None:
    """Respond to pre-checkout query — must answer within 10 seconds."""
    await query.answer(ok=True)


@router.message(F.content_type == ContentType.SUCCESSFUL_PAYMENT)
async def on_successful_payment(message: Message, db: AsyncSession) -> None:
    """Handle successful Telegram Stars payment."""
    payment = message.successful_payment
    payload = payment.invoice_payload  # e.g. "topup_12345_300"

    parts = payload.split("_")
    if len(parts) < 3 or parts[0] != "topup":
        return

    amount_key = parts[2]
    if amount_key not in TOPUP_PRICES:
        return

    rub_amount, stars = TOPUP_PRICES[amount_key]
    provider_tx_id = payment.telegram_payment_charge_id
    idempotency_key = f"stars_{provider_tx_id}"

    billing = BillingService(db)
    tx = await billing.topup(
        user_id=message.from_user.id,
        amount=rub_amount,
        stars_amount=stars,
        provider_tx_id=provider_tx_id,
        idempotency_key=idempotency_key,
    )

    if tx is not None:
        balance = await billing.get_balance(message.from_user.id)
        await message.answer(
            f"✅ Баланс пополнен на {rub_amount:.0f}₽!\n"
            f"💎 Текущий баланс: {balance:.2f}₽",
            reply_markup=ai_balance_keyboard(),
        )


# ------------------------------------------------------------------
# /ai_history command + callback
# ------------------------------------------------------------------


@router.message(Command("ai_history"))
async def cmd_ai_history(message: Message, db: AsyncSession) -> None:
    """Show AI usage and billing history."""
    billing = BillingService(db)
    history = await billing.get_history(message.from_user.id, limit=10)
    await message.answer(_format_history(history))


@router.callback_query(F.data == "billing:history")
async def on_history_callback(callback: CallbackQuery, db: AsyncSession) -> None:
    """Handle history callback from balance screen."""
    billing = BillingService(db)
    history = await billing.get_history(callback.from_user.id, limit=10)
    await callback.message.edit_text(_format_history(history))
    await callback.answer()


# ------------------------------------------------------------------
# Withdrawal
# ------------------------------------------------------------------


@router.message(Command("withdraw"))
async def cmd_withdraw(message: Message, db: AsyncSession) -> None:
    """Show available balance and withdrawal confirmation."""
    billing = BillingService(db)
    available = await billing.get_available_for_withdrawal(message.from_user.id)

    if available < MIN_WITHDRAWAL:
        await message.answer(
            f"💸 Доступно для вывода: {available:.2f}₽\n"
            f"Минимальная сумма вывода: {MIN_WITHDRAWAL:.0f}₽."
        )
        return

    await message.answer(
        f"💸 Доступно для вывода: {available:.2f}₽\n\n"
        "Средства будут возвращены в Telegram Stars.",
        reply_markup=withdraw_confirm_keyboard(available),
    )


@router.callback_query(F.data == "billing:withdraw")
async def on_withdraw_callback(callback: CallbackQuery, db: AsyncSession) -> None:
    """Handle withdraw callback from balance screen."""
    billing = BillingService(db)
    available = await billing.get_available_for_withdrawal(callback.from_user.id)

    if available < MIN_WITHDRAWAL:
        await callback.message.edit_text(
            f"💸 Доступно для вывода: {available:.2f}₽\n"
            f"Минимальная сумма вывода: {MIN_WITHDRAWAL:.0f}₽."
        )
        await callback.answer()
        return

    await callback.message.edit_text(
        f"💸 Доступно для вывода: {available:.2f}₽\n\n"
        "Средства будут возвращены в Telegram Stars.",
        reply_markup=withdraw_confirm_keyboard(available),
    )
    await callback.answer()


@router.callback_query(F.data.startswith("billing:withdraw_confirm:"))
async def on_withdraw_confirm(callback: CallbackQuery, db: AsyncSession) -> None:
    """Process withdrawal after user confirmation."""
    amount_str = callback.data.split(":")[2]
    amount = Decimal(amount_str)

    billing = BillingService(db)
    try:
        await billing.withdraw(callback.from_user.id, amount)
        balance = await billing.get_balance(callback.from_user.id)
        await callback.message.edit_text(
            f"✅ Вывод {amount:.2f}₽ выполнен.\n"
            f"💎 Текущий баланс: {balance:.2f}₽"
        )
    except InsufficientWithdrawalError:
        await callback.message.edit_text(
            "❌ Недостаточно средств для вывода. Баланс мог измениться."
        )
    await callback.answer()


@router.callback_query(F.data == "billing:withdraw_cancel")
async def on_withdraw_cancel(callback: CallbackQuery, db: AsyncSession) -> None:
    """Cancel withdrawal — return to balance screen."""
    billing = BillingService(db)
    balance = await billing.get_balance(callback.from_user.id)
    await callback.message.edit_text(
        _format_balance_text(balance),
        reply_markup=ai_balance_keyboard(),
    )
    await callback.answer()
