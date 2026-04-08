"""ZenMoney token refresh logic.

Auto-refreshes expired access tokens. If refresh fails,
marks integration as disconnected and returns None.
"""
import logging
from datetime import datetime, timezone, timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from src.config import settings
from src.models.integration import Integration
from src.services.encryption_service import EncryptionService
from src.services.integration_service import IntegrationService
from src.services.zenmoney.oauth import ZenMoneyOAuth

logger = logging.getLogger(__name__)

# Refresh 5 minutes before actual expiry to avoid race conditions
TOKEN_EXPIRY_BUFFER = timedelta(minutes=5)


class ZenMoneyTokenRefresher:
    """Ensures a valid access token for ZenMoney API calls."""

    def __init__(self, db: AsyncSession, encryption: EncryptionService) -> None:
        self.db = db
        self.encryption = encryption
        self._integration_service = IntegrationService(db, encryption)

    async def ensure_valid_token(self, integration: Integration) -> str | None:
        """Get a valid access token, refreshing if expired.

        Returns:
            Valid access token string, or None if refresh failed
            (integration will be marked as disconnected).
        """
        now = datetime.now(timezone.utc)

        # Check if token is still valid
        # Handle both tz-aware and tz-naive datetimes (SQLite stores naive)
        expires_at = integration.token_expires_at
        if expires_at is not None and expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        if expires_at and expires_at > now + TOKEN_EXPIRY_BUFFER:
            # Token is still valid
            return self.encryption.decrypt(integration.access_token_encrypted)

        # Token expired — try to refresh
        if integration.refresh_token_encrypted is None:
            logger.warning(
                "No refresh token for integration %s (user %d) — disconnecting",
                integration.id,
                integration.user_id,
            )
            await self._integration_service.disconnect(
                integration.user_id, integration.type
            )
            return None

        refresh_token_value = self.encryption.decrypt(integration.refresh_token_encrypted)

        try:
            oauth = ZenMoneyOAuth(
                consumer_key=settings.zenmoney_consumer_key,
                consumer_secret=settings.zenmoney_consumer_secret,
                redirect_uri=settings.zenmoney_redirect_uri,
            )
            tokens = await oauth.refresh_token(refresh_token_value)

            # Update stored tokens
            expires_at = now + timedelta(seconds=tokens.get("expires_in", 3600))
            await self._integration_service.update_tokens(
                integration.id,
                access_token=tokens["access_token"],
                refresh_token=tokens.get("refresh_token"),
                expires_at=expires_at,
            )

            logger.info("Refreshed ZenMoney token for user %d", integration.user_id)
            return tokens["access_token"]

        except Exception as e:
            logger.error(
                "Failed to refresh ZenMoney token for user %d: %s",
                integration.user_id,
                str(e),
            )
            # Disconnect — user needs to re-authorize
            await self._integration_service.disconnect(
                integration.user_id, integration.type
            )
            # TODO: Send notification to user via bot (Plan 7)
            return None
