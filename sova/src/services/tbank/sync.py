"""T-Bank Invest portfolio and operations sync service.

Read-only for Plan 3 -- syncs portfolio positions and operations.
Uses upsert logic for idempotent syncing.
"""
import logging
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.integration import Integration
from src.models.portfolio import PortfolioPosition, PortfolioOperation
from src.services.encryption_service import EncryptionService
from src.services.integration_service import IntegrationService
from src.services.tbank.client import TBankClient
from src.services.tbank.mapper import TBankMapper
from src.config import settings

logger = logging.getLogger(__name__)


class TBankSyncService:
    """Synchronize T-Bank Invest data into local database."""

    def __init__(self, db: AsyncSession, encryption: EncryptionService) -> None:
        self.db = db
        self.encryption = encryption
        self.mapper = TBankMapper()
        self._integration_service = IntegrationService(db, encryption)

    async def sync(self, integration: Integration) -> None:
        """Run one sync cycle for a T-Bank Invest integration.

        1. Decrypt API token
        2. Fetch portfolio positions
        3. Fetch recent operations
        4. Map and upsert positions (replace all)
        5. Upsert operations (deduplicate)
        6. Update integration status
        """
        # Capture IDs before try/except so they survive a rollback
        integration_id = integration.id
        user_id = integration.user_id

        try:
            token = self.encryption.decrypt(integration.access_token_encrypted)
            client = TBankClient(
                token=token,
                sandbox=settings.tbank_sandbox,
            )

            # Fetch data
            raw_positions = await client.get_portfolio()
            raw_operations = await client.get_operations(days_back=30)

            # Resolve instrument info (ticker, name, sector)
            figis = {p["figi"] for p in raw_positions}
            figis.update(op["figi"] for op in raw_operations)
            instrument_info = await self._get_instrument_info(client, figis)

            # Upsert positions -- delete old, insert fresh
            await self._replace_positions(
                user_id, raw_positions, instrument_info
            )

            # Upsert operations -- insert only new
            await self._upsert_operations(
                user_id, raw_operations, instrument_info
            )

            await self.db.commit()
            await self._integration_service.record_sync_success(integration_id)
            logger.info("T-Bank sync completed for user %d", user_id)

        except Exception as e:
            await self.db.rollback()
            await self._integration_service.record_sync_error(
                integration_id, str(e)[:500]
            )
            logger.error(
                "T-Bank sync failed for user %d: %s",
                user_id,
                str(e),
            )

    async def _get_instrument_info(
        self, client: TBankClient, figis: set[str]
    ) -> dict[str, dict]:
        """Resolve FIGIs to instrument info (ticker, name, sector).

        Uses T-Bank InstrumentsService REST endpoint.
        """
        info: dict[str, dict] = {}
        for figi in figis:
            try:
                instrument = await client.get_instrument_by_figi(figi)
                info[figi] = {
                    "ticker": instrument.get("ticker", figi[:10]),
                    "name": instrument.get("name"),
                    "sector": instrument.get("sector"),
                }
            except Exception:
                info[figi] = {"ticker": figi[:10], "name": None, "sector": None}
        return info

    async def _replace_positions(
        self,
        user_id: int,
        raw_positions: list[dict],
        instrument_info: dict[str, dict],
    ) -> None:
        """Replace all portfolio positions for a user.

        Delete existing -> insert fresh. Simpler than upsert for positions
        since we always get the full portfolio snapshot.
        """
        # Delete existing positions
        await self.db.execute(
            delete(PortfolioPosition).where(PortfolioPosition.user_id == user_id)
        )

        # Insert new positions
        for raw in raw_positions:
            figi = raw["figi"]
            info = instrument_info.get(
                figi, {"ticker": "UNKNOWN", "name": None, "sector": None}
            )
            mapped = self.mapper.map_position(raw, info, user_id)
            position = PortfolioPosition(**mapped)
            self.db.add(position)

    async def _upsert_operations(
        self,
        user_id: int,
        raw_operations: list[dict],
        instrument_info: dict[str, dict],
    ) -> None:
        """Insert only new operations (deduplicate by ticker + type + date + total)."""
        for raw in raw_operations:
            figi = raw["figi"]
            info = instrument_info.get(figi, {"ticker": "UNKNOWN"})
            mapped = self.mapper.map_operation(raw, info, user_id)

            # Simple dedup: check if operation with same attributes exists
            result = await self.db.execute(
                select(PortfolioOperation).where(
                    PortfolioOperation.user_id == user_id,
                    PortfolioOperation.ticker == mapped["ticker"],
                    PortfolioOperation.operation_type == mapped["operation_type"],
                    PortfolioOperation.executed_at == mapped["executed_at"],
                    PortfolioOperation.total == mapped["total"],
                )
            )
            if result.scalar_one_or_none() is None:
                self.db.add(PortfolioOperation(**mapped))
