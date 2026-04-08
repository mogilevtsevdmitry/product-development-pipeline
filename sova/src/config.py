from pydantic import model_validator
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://sova:sova@localhost:5432/sova"
    redis_url: str = "redis://localhost:6379/0"
    bot_token: str = ""
    telegram_bot_token: str = ""  # Vault uses this name; mapped to bot_token
    anthropic_api_key: str = ""
    anthropic_base_url: str = ""  # Custom base URL (e.g. OpenRouter)
    app_base_url: str = "http://localhost:8000"
    telegram_webapp_url: str = ""  # Vault: TELEGRAM_WEBAPP_URL
    port: int = 8000
    encryption_key: str = ""
    webhook_path: str = "/bot/webhook"
    jwt_secret: str = ""

    @model_validator(mode="after")
    def _resolve_bot_token(self) -> "Settings":
        """Use TELEGRAM_BOT_TOKEN from Vault if BOT_TOKEN is not set."""
        if not self.bot_token and self.telegram_bot_token:
            self.bot_token = self.telegram_bot_token
        # Derive app_base_url from telegram_webapp_url if available
        if self.telegram_webapp_url and self.app_base_url == "http://localhost:8000":
            self.app_base_url = self.telegram_webapp_url
        return self

    # ZenMoney OAuth 2.0
    zenmoney_consumer_key: str = ""
    zenmoney_consumer_secret: str = ""
    zenmoney_redirect_uri: str = ""  # e.g. https://sova.app/api/oauth/zenmoney/callback

    # T-Bank Invest
    tbank_sandbox: bool = True  # use sandbox by default

    model_config = {"env_file": ".env", "extra": "ignore"}

    @property
    def async_database_url(self) -> str:
        """Return asyncpg database URL, converting from sync format if needed."""
        url = self.database_url
        if url.startswith("postgresql://"):
            url = url.replace("postgresql://", "postgresql+asyncpg://", 1)
        elif url.startswith("postgresql+psycopg2://"):
            url = url.replace("postgresql+psycopg2://", "postgresql+asyncpg://", 1)
        return url

    @property
    def sync_database_url(self) -> str:
        """Return psycopg2 database URL for alembic migrations."""
        url = self.database_url
        if url.startswith("postgresql+asyncpg://"):
            url = url.replace("postgresql+asyncpg://", "postgresql+psycopg2://", 1)
        elif url.startswith("postgresql://"):
            url = url.replace("postgresql://", "postgresql+psycopg2://", 1)
        return url


settings = Settings()
