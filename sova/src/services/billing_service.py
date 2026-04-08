"""Billing service — top-up, charge, withdraw, balance management."""

import uuid
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import select, update, func, case, literal_column
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.billing import BillingTransaction
from src.models.ai_usage import AIUsageLog
from src.models.user import User


FREE_CREDITS_AMOUNT = Decimal("50.00")
MIN_TOPUP = Decimal("100.00")
MIN_WITHDRAWAL = Decimal("50.00")
MAX_CHARGE_RETRIES = 3


class InsufficientBalanceError(Exception):
    """Raised when user does not have enough AI balance."""


class InsufficientWithdrawalError(Exception):
    """Raised when withdrawal amount exceeds available balance."""


class BillingService:
    def __init__(self, db: AsyncSession):
        self.db = db

    # ------------------------------------------------------------------
    # Grant free credits (onboarding)
    # ------------------------------------------------------------------

    async def grant_free_credits(
        self,
        user_id: int,
        amount: Decimal = FREE_CREDITS_AMOUNT,
    ) -> BillingTransaction | None:
        """Grant free AI credits on registration.

        Uses idempotency_key = 'free_credits_{user_id}' to prevent double-granting.
        Returns the transaction if created, None if already granted.
        """
        idem_key = f"free_credits_{user_id}"

        # Check if already granted
        existing = await self.db.execute(
            select(BillingTransaction).where(
                BillingTransaction.idempotency_key == idem_key
            )
        )
        if existing.scalar_one_or_none() is not None:
            return None

        now = datetime.now(timezone.utc)
        tx = BillingTransaction(
            user_id=user_id,
            type="topup",
            amount=amount,
            stars_amount=0,
            status="completed",
            idempotency_key=idem_key,
            created_at=now,
            completed_at=now,
        )
        self.db.add(tx)

        # Update user balance
        await self.db.execute(
            update(User)
            .where(User.telegram_id == user_id)
            .values(ai_balance=User.ai_balance + amount)
        )
        await self.db.commit()
        return tx

    # ------------------------------------------------------------------
    # Top-up via Telegram Stars
    # ------------------------------------------------------------------

    async def topup(
        self,
        user_id: int,
        amount: Decimal,
        stars_amount: int,
        provider_tx_id: str,
        idempotency_key: str,
    ) -> BillingTransaction | None:
        """Process a top-up payment via Telegram Stars.

        Returns the transaction if created, None if idempotency_key already exists.
        """
        # Idempotency check
        existing = await self.db.execute(
            select(BillingTransaction).where(
                BillingTransaction.idempotency_key == idempotency_key
            )
        )
        if existing.scalar_one_or_none() is not None:
            return None

        now = datetime.now(timezone.utc)
        tx = BillingTransaction(
            user_id=user_id,
            type="topup",
            amount=amount,
            stars_amount=stars_amount,
            status="completed",
            provider_tx_id=provider_tx_id,
            idempotency_key=idempotency_key,
            created_at=now,
            completed_at=now,
        )
        self.db.add(tx)

        # Update user balance
        await self.db.execute(
            update(User)
            .where(User.telegram_id == user_id)
            .values(ai_balance=User.ai_balance + amount)
        )
        await self.db.commit()
        return tx

    # ------------------------------------------------------------------
    # Charge for AI query (optimistic locking)
    # ------------------------------------------------------------------

    async def charge(
        self,
        user_id: int,
        cost: Decimal,
        query_type: str,
        tokens_used: int | None = None,
    ) -> AIUsageLog:
        """Charge user for an AI query using optimistic locking.

        Raises InsufficientBalanceError if balance is too low or version conflict
        after retries.
        """
        for attempt in range(MAX_CHARGE_RETRIES):
            # Read current version
            result = await self.db.execute(
                select(User.ai_balance, User.ai_balance_version).where(
                    User.telegram_id == user_id
                )
            )
            row = result.one_or_none()
            if row is None:
                raise InsufficientBalanceError("User not found")

            current_balance, current_version = row

            if current_balance < cost:
                raise InsufficientBalanceError(
                    f"Balance {current_balance} < cost {cost}"
                )

            # Optimistic locking update
            update_result = await self.db.execute(
                update(User)
                .where(
                    User.telegram_id == user_id,
                    User.ai_balance_version == current_version,
                    User.ai_balance >= cost,
                )
                .values(
                    ai_balance=User.ai_balance - cost,
                    ai_balance_version=User.ai_balance_version + 1,
                )
            )

            if update_result.rowcount == 1:
                # Success — create usage log
                log = AIUsageLog(
                    user_id=user_id,
                    query_type=query_type,
                    cost=cost,
                    tokens_used=tokens_used,
                )
                self.db.add(log)
                await self.db.commit()
                return log

            # Version conflict — retry with fresh data
            await self.db.rollback()

        raise InsufficientBalanceError(
            "Could not charge after retries (version conflict or insufficient balance)"
        )

    # ------------------------------------------------------------------
    # Withdrawal
    # ------------------------------------------------------------------

    async def withdraw(
        self,
        user_id: int,
        amount: Decimal,
    ) -> BillingTransaction:
        """Process a withdrawal. Reduces ai_balance and creates transaction.

        Raises InsufficientWithdrawalError if amount > available_for_withdrawal.
        """
        available = await self.get_available_for_withdrawal(user_id)
        if amount > available:
            raise InsufficientWithdrawalError(
                f"Requested {amount}, available {available}"
            )

        now = datetime.now(timezone.utc)
        tx = BillingTransaction(
            user_id=user_id,
            type="withdrawal",
            amount=amount,
            status="completed",
            created_at=now,
            completed_at=now,
        )
        self.db.add(tx)

        # Decrease balance
        await self.db.execute(
            update(User)
            .where(User.telegram_id == user_id)
            .values(ai_balance=User.ai_balance - amount)
        )
        await self.db.commit()
        return tx

    # ------------------------------------------------------------------
    # Balance queries
    # ------------------------------------------------------------------

    async def get_balance(self, user_id: int) -> Decimal:
        """Return current ai_balance for user."""
        result = await self.db.execute(
            select(User.ai_balance).where(User.telegram_id == user_id)
        )
        row = result.one_or_none()
        if row is None:
            return Decimal("0")
        return row[0]

    async def has_sufficient_balance(self, user_id: int, cost: Decimal) -> bool:
        """Check if user has enough balance for the given cost."""
        balance = await self.get_balance(user_id)
        return balance >= cost

    async def get_available_for_withdrawal(self, user_id: int) -> Decimal:
        """Calculate available balance for withdrawal.

        Available = sum(topup completed) - sum(ai_usage_log costs) - sum(withdrawal completed)
        This is computed from actual records, not the cached ai_balance field.
        """
        # Sum of completed topups
        topups_result = await self.db.execute(
            select(func.coalesce(func.sum(BillingTransaction.amount), 0)).where(
                BillingTransaction.user_id == user_id,
                BillingTransaction.type == "topup",
                BillingTransaction.status == "completed",
            )
        )
        total_topups = Decimal(str(topups_result.scalar()))

        # Sum of AI charges
        charges_result = await self.db.execute(
            select(func.coalesce(func.sum(AIUsageLog.cost), 0)).where(
                AIUsageLog.user_id == user_id,
            )
        )
        total_charges = Decimal(str(charges_result.scalar()))

        # Sum of completed withdrawals
        withdrawals_result = await self.db.execute(
            select(func.coalesce(func.sum(BillingTransaction.amount), 0)).where(
                BillingTransaction.user_id == user_id,
                BillingTransaction.type == "withdrawal",
                BillingTransaction.status == "completed",
            )
        )
        total_withdrawals = Decimal(str(withdrawals_result.scalar()))

        available = total_topups - total_charges - total_withdrawals
        return max(available, Decimal("0"))

    # ------------------------------------------------------------------
    # History
    # ------------------------------------------------------------------

    async def get_history(
        self, user_id: int, limit: int = 10
    ) -> list[dict]:
        """Get combined billing + usage history, ordered by date desc.

        Returns list of dicts with keys: type, amount, date, details.
        """
        # Billing transactions
        billing_result = await self.db.execute(
            select(BillingTransaction)
            .where(BillingTransaction.user_id == user_id)
            .order_by(BillingTransaction.created_at.desc())
            .limit(limit)
        )
        billing_rows = list(billing_result.scalars().all())

        # AI usage logs
        usage_result = await self.db.execute(
            select(AIUsageLog)
            .where(AIUsageLog.user_id == user_id)
            .order_by(AIUsageLog.created_at.desc())
            .limit(limit)
        )
        usage_rows = list(usage_result.scalars().all())

        # Combine and sort
        entries: list[dict] = []

        for tx in billing_rows:
            entries.append({
                "type": tx.type,
                "amount": tx.amount,
                "date": tx.created_at,
                "details": f"Stars: {tx.stars_amount}" if tx.stars_amount else None,
                "status": tx.status,
            })

        for log in usage_rows:
            entries.append({
                "type": "charge",
                "amount": log.cost or Decimal("0"),
                "date": log.created_at,
                "details": log.query_type,
                "status": "completed",
            })

        # Sort by date descending, take limit
        entries.sort(key=lambda e: e["date"], reverse=True)
        return entries[:limit]
