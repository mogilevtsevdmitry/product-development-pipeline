"""Integration CRUD and status management service."""
import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.integration import Integration
from src.services.encryption_service import EncryptionService

MAX_ERRORS_BEFORE_STATUS_CHANGE = 3


class IntegrationService:
    def __init__(self, db: AsyncSession, encryption: EncryptionService) -> None:
        self.db = db
        self.encryption = encryption

    async def create(
        self,
        user_id: int,
        integration_type: str,
        access_token: str,
        refresh_token: str | None = None,
        token_expires_at: datetime | None = None,
        sync_from_date=None,
    ) -> Integration:
        """Create a new integration with encrypted tokens."""
        integration = Integration(
            user_id=user_id,
            type=integration_type,
            access_token_encrypted=self.encryption.encrypt(access_token),
            refresh_token_encrypted=(
                self.encryption.encrypt(refresh_token) if refresh_token else None
            ),
            token_expires_at=token_expires_at,
            sync_from_date=sync_from_date,
            status="active",
        )
        self.db.add(integration)
        await self.db.commit()
        await self.db.refresh(integration)
        return integration

    async def get(self, user_id: int, integration_type: str) -> Integration | None:
        """Get integration by user_id and type."""
        result = await self.db.execute(
            select(Integration).where(
                Integration.user_id == user_id,
                Integration.type == integration_type,
            )
        )
        return result.scalar_one_or_none()

    async def get_by_id(self, integration_id: uuid.UUID) -> Integration | None:
        """Get integration by its UUID."""
        result = await self.db.execute(
            select(Integration).where(Integration.id == integration_id)
        )
        return result.scalar_one_or_none()

    async def get_access_token(self, user_id: int, integration_type: str) -> str | None:
        """Get decrypted access token for an integration."""
        integration = await self.get(user_id, integration_type)
        if integration is None or integration.access_token_encrypted is None:
            return None
        return self.encryption.decrypt(integration.access_token_encrypted)

    async def get_refresh_token(self, integration_id: uuid.UUID) -> str | None:
        """Get decrypted refresh token."""
        integration = await self.get_by_id(integration_id)
        if integration is None or integration.refresh_token_encrypted is None:
            return None
        return self.encryption.decrypt(integration.refresh_token_encrypted)

    async def update_tokens(
        self,
        integration_id: uuid.UUID,
        access_token: str,
        refresh_token: str | None = None,
        expires_at: datetime | None = None,
    ) -> None:
        """Update encrypted tokens after OAuth refresh."""
        integration = await self.get_by_id(integration_id)
        if integration is None:
            return
        integration.access_token_encrypted = self.encryption.encrypt(access_token)
        if refresh_token is not None:
            integration.refresh_token_encrypted = self.encryption.encrypt(refresh_token)
        if expires_at is not None:
            integration.token_expires_at = expires_at
        await self.db.commit()

    async def record_sync_success(self, integration_id: uuid.UUID) -> None:
        """Record a successful sync -- reset error state."""
        integration = await self.get_by_id(integration_id)
        if integration is None:
            return
        integration.last_synced_at = datetime.now(timezone.utc)
        integration.error_count = 0
        integration.last_error = None
        integration.status = "active"
        await self.db.commit()

    async def record_sync_error(self, integration_id: uuid.UUID, error_msg: str) -> None:
        """Record a sync error. After 3 consecutive errors, mark status as 'error'."""
        integration = await self.get_by_id(integration_id)
        if integration is None:
            return
        integration.error_count += 1
        integration.last_error = error_msg
        if integration.error_count >= MAX_ERRORS_BEFORE_STATUS_CHANGE:
            integration.status = "error"
        await self.db.commit()

    async def disconnect(self, user_id: int, integration_type: str) -> None:
        """Mark integration as disconnected."""
        integration = await self.get(user_id, integration_type)
        if integration is None:
            return
        integration.status = "disconnected"
        integration.access_token_encrypted = None
        integration.refresh_token_encrypted = None
        await self.db.commit()

    async def list_for_user(self, user_id: int) -> list[Integration]:
        """List all integrations for a user."""
        result = await self.db.execute(
            select(Integration).where(Integration.user_id == user_id)
        )
        return list(result.scalars().all())

    async def get_active_integrations_by_type(
        self, integration_type: str
    ) -> list[Integration]:
        """Get all active integrations of a given type (for cron sync)."""
        result = await self.db.execute(
            select(Integration).where(
                Integration.type == integration_type,
                Integration.status == "active",
            )
        )
        return list(result.scalars().all())
