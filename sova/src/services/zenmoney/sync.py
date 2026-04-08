"""ZenMoney diff-based sync service.

Handles full initial import and incremental updates.
Uses upsert logic for idempotent syncing.
"""
import logging
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.account import Account
from src.models.category import Category
from src.models.integration import Integration
from src.models.transaction import Transaction
from src.services.encryption_service import EncryptionService
from src.services.integration_service import IntegrationService
from src.services.zenmoney.client import ZenMoneyClient
from src.services.zenmoney.mapper import ZenMoneyMapper

logger = logging.getLogger(__name__)


class ZenMoneySyncService:
    """Synchronize ZenMoney data into local database."""

    def __init__(self, db: AsyncSession, encryption: EncryptionService) -> None:
        self.db = db
        self.encryption = encryption
        self.mapper = ZenMoneyMapper()
        self._integration_service = IntegrationService(db, encryption)

    async def sync(self, integration: Integration) -> None:
        """Run one sync cycle for a ZenMoney integration.

        1. Decrypt access token
        2. Call ZenMoney diff API (full if first sync, incremental otherwise)
        3. Map and upsert accounts
        4. Map and upsert transactions
        5. Update integration last_synced_at
        """
        try:
            access_token = self.encryption.decrypt(integration.access_token_encrypted)
            client = ZenMoneyClient(access_token=access_token)

            # Use server_timestamp=0 for first sync, otherwise use a stored timestamp
            # For simplicity, we use last_synced_at epoch or 0
            server_timestamp = 0
            if integration.last_synced_at:
                server_timestamp = int(integration.last_synced_at.timestamp())

            data = await client.diff(server_timestamp=server_timestamp)

            # Build lookups
            instruments = self.mapper.build_instrument_lookup(data.get("instrument", []))
            tags = self.mapper.build_tag_lookup(data.get("tag", []))

            # Upsert accounts
            for zm_account in data.get("account", []):
                mapped = self.mapper.map_account(zm_account, instruments, integration.user_id)
                await self._upsert_account(mapped)

            # Upsert transactions
            for zm_tx in data.get("transaction", []):
                mapped = self.mapper.map_transaction(zm_tx, tags, integration.user_id)
                if mapped is None:
                    continue  # skip transfers
                await self._upsert_transaction(mapped)

            await self.db.commit()

            # Record success
            await self._integration_service.record_sync_success(integration.id)
            logger.info("ZenMoney sync completed for user %d", integration.user_id)

        except Exception as e:
            await self.db.rollback()
            await self._integration_service.record_sync_error(
                integration.id, str(e)[:500]
            )
            logger.error(
                "ZenMoney sync failed for user %d: %s",
                integration.user_id,
                str(e),
            )

    async def _upsert_account(self, data: dict) -> Account:
        """Insert or update account by (user_id, source, external_id)."""
        result = await self.db.execute(
            select(Account).where(
                Account.user_id == data["user_id"],
                Account.source == data["source"],
                Account.external_id == data["external_id"],
            )
        )
        existing = result.scalar_one_or_none()

        if existing:
            existing.name = data["name"]
            existing.balance = data["balance"]
            existing.currency = data["currency"]
            return existing
        else:
            account = Account(**data)
            self.db.add(account)
            return account

    async def _upsert_transaction(self, data: dict) -> Transaction:
        """Insert or update transaction by (user_id, source, external_id).

        Handles deduplication: if a transaction with the same external_id
        already exists, update it. Otherwise create new.
        """
        category_name = data.pop("category_name", "Другое")

        result = await self.db.execute(
            select(Transaction).where(
                Transaction.user_id == data["user_id"],
                Transaction.source == data["source"],
                Transaction.external_id == data["external_id"],
            )
        )
        existing = result.scalar_one_or_none()

        # Resolve category
        category = await self._find_category(category_name)
        category_id = category.id if category else None

        if existing:
            existing.amount = data["amount"]
            existing.description = data.get("description")
            existing.category_id = category_id
            return existing
        else:
            tx = Transaction(
                **data,
                category_id=category_id,
            )
            self.db.add(tx)
            return tx

    async def _find_category(self, name: str) -> "Category | None":
        """Find system category by name."""
        result = await self.db.execute(
            select(Category).where(Category.name == name, Category.user_id.is_(None))
        )
        return result.scalar_one_or_none()
