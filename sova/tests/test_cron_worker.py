import pytest
from unittest.mock import AsyncMock, patch, MagicMock

from src.workers.cron_worker import (
    sync_zenmoney_all,
    sync_tbank_all,
    refresh_tokens,
    cleanup_news_cache,
    create_scheduler,
)


async def test_sync_zenmoney_all_calls_sync_for_active_integrations():
    """sync_zenmoney_all should sync each active ZenMoney integration."""
    mock_integration = MagicMock()
    mock_integration.id = "int-1"
    mock_integration.user_id = 100
    mock_integration.type = "zenmoney"

    mock_db = AsyncMock()

    with patch("src.workers.cron_worker.async_session") as mock_session_factory:
        mock_session_factory.return_value.__aenter__ = AsyncMock(return_value=mock_db)
        mock_session_factory.return_value.__aexit__ = AsyncMock(return_value=False)

        with patch("src.workers.cron_worker.EncryptionService"):
            with patch("src.workers.cron_worker.IntegrationService") as MockIntSvc:
                mock_svc = AsyncMock()
                mock_svc.get_active_integrations_by_type.return_value = [mock_integration]
                MockIntSvc.return_value = mock_svc

                with patch("src.workers.cron_worker.ZenMoneySyncService") as MockSync:
                    mock_sync = AsyncMock()
                    MockSync.return_value = mock_sync

                    await sync_zenmoney_all()

                    mock_sync.sync.assert_called_once_with(mock_integration)


async def test_sync_tbank_all_calls_sync_for_active_integrations():
    """sync_tbank_all should sync each active T-Bank integration."""
    mock_integration = MagicMock()
    mock_integration.id = "int-2"
    mock_integration.user_id = 200
    mock_integration.type = "tbank_invest"

    mock_db = AsyncMock()

    with patch("src.workers.cron_worker.async_session") as mock_session_factory:
        mock_session_factory.return_value.__aenter__ = AsyncMock(return_value=mock_db)
        mock_session_factory.return_value.__aexit__ = AsyncMock(return_value=False)

        with patch("src.workers.cron_worker.EncryptionService"):
            with patch("src.workers.cron_worker.IntegrationService") as MockIntSvc:
                mock_svc = AsyncMock()
                mock_svc.get_active_integrations_by_type.return_value = [mock_integration]
                MockIntSvc.return_value = mock_svc

                with patch("src.workers.cron_worker.TBankSyncService") as MockSync:
                    mock_sync = AsyncMock()
                    MockSync.return_value = mock_sync

                    await sync_tbank_all()

                    mock_sync.sync.assert_called_once_with(mock_integration)


async def test_sync_zenmoney_handles_errors_gracefully():
    """sync_zenmoney_all should not crash on individual sync failures."""
    int1 = MagicMock(id="i1", user_id=100, type="zenmoney")
    int2 = MagicMock(id="i2", user_id=200, type="zenmoney")

    mock_db = AsyncMock()

    with patch("src.workers.cron_worker.async_session") as mock_session_factory:
        mock_session_factory.return_value.__aenter__ = AsyncMock(return_value=mock_db)
        mock_session_factory.return_value.__aexit__ = AsyncMock(return_value=False)

        with patch("src.workers.cron_worker.EncryptionService"):
            with patch("src.workers.cron_worker.IntegrationService") as MockIntSvc:
                mock_svc = AsyncMock()
                mock_svc.get_active_integrations_by_type.return_value = [int1, int2]
                MockIntSvc.return_value = mock_svc

                with patch("src.workers.cron_worker.ZenMoneySyncService") as MockSync:
                    mock_sync = AsyncMock()
                    # First sync fails, second succeeds
                    mock_sync.sync.side_effect = [Exception("API error"), None]
                    MockSync.return_value = mock_sync

                    # Should not raise
                    await sync_zenmoney_all()

                    assert mock_sync.sync.call_count == 2


async def test_refresh_tokens_refreshes_active_integrations():
    """refresh_tokens should check all active ZenMoney integrations."""
    mock_integration = MagicMock()
    mock_integration.id = "int-1"
    mock_integration.user_id = 100

    mock_db = AsyncMock()

    with patch("src.workers.cron_worker.async_session") as mock_session_factory:
        mock_session_factory.return_value.__aenter__ = AsyncMock(return_value=mock_db)
        mock_session_factory.return_value.__aexit__ = AsyncMock(return_value=False)

        with patch("src.workers.cron_worker.EncryptionService"):
            with patch("src.workers.cron_worker.IntegrationService") as MockIntSvc:
                mock_svc = AsyncMock()
                mock_svc.get_active_integrations_by_type.return_value = [mock_integration]
                MockIntSvc.return_value = mock_svc

                with patch("src.workers.cron_worker.ZenMoneyTokenRefresher") as MockRefresher:
                    mock_refresher = AsyncMock()
                    mock_refresher.ensure_valid_token.return_value = "valid-token"
                    MockRefresher.return_value = mock_refresher

                    await refresh_tokens()

                    mock_refresher.ensure_valid_token.assert_called_once_with(mock_integration)


async def test_cleanup_news_cache_runs_without_error():
    """cleanup_news_cache stub should run without errors."""
    await cleanup_news_cache()


def test_create_scheduler_has_all_jobs():
    """Scheduler should have all 5 jobs configured."""
    scheduler = create_scheduler()
    jobs = scheduler.get_jobs()
    job_ids = {j.id for j in jobs}

    assert "sync_zenmoney" in job_ids
    assert "sync_tbank" in job_ids
    assert "refresh_tokens" in job_ids
    assert "generate_daily_digests" in job_ids
    assert "cleanup_news_cache" in job_ids
    assert len(jobs) == 5
