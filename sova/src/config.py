from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://sova:sova@localhost:5432/sova"
    redis_url: str = "redis://localhost:6379/0"
    bot_token: str = ""
    anthropic_api_key: str = ""
    app_base_url: str = "http://localhost:8000"
    encryption_key: str = ""
    webhook_path: str = "/bot/webhook"

    # ZenMoney OAuth 2.0
    zenmoney_consumer_key: str = ""
    zenmoney_consumer_secret: str = ""
    zenmoney_redirect_uri: str = ""  # e.g. https://sova.app/api/oauth/zenmoney/callback

    # T-Bank Invest
    tbank_sandbox: bool = True  # use sandbox by default

    model_config = {"env_file": ".env", "extra": "ignore"}


settings = Settings()
