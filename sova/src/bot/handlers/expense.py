from aiogram import Router, F
from aiogram.types import Message
from sqlalchemy.ext.asyncio import AsyncSession

from src.services.expense_parser import parse_expense
from src.services.transaction_service import TransactionService

router = Router(name="expense")

EXPENSE_RECORDED_TEXT = (
    "✅ Записано!\n"
    "  {description}: {amount:,.2f} ₽\n"
    "  Категория: {category}"
)


@router.message(F.text, ~F.text.startswith("/"))
async def handle_expense_text(message: Message, db: AsyncSession) -> None:
    """Try to parse plain text as an expense entry.

    This handler has low priority — it only catches messages that
    are NOT commands (don't start with /).
    """
    parsed = parse_expense(message.text)
    if parsed is None:
        # Not an expense — silently ignore (could be free text for AI in Plan 5)
        return

    service = TransactionService(db)
    tx = await service.create_expense(
        user_id=message.from_user.id,
        amount=parsed.amount,
        description=parsed.description,
        category_name=parsed.category_name,
        tag=parsed.tag,
    )

    await message.answer(
        EXPENSE_RECORDED_TEXT.format(
            description=parsed.description,
            amount=parsed.amount,
            category=parsed.category_name,
        )
    )
