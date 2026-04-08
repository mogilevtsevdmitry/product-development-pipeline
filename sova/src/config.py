from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://sova:sova@localhost:5432/sova"
    redis_url: str = "redis://localhost:6379/0"
    bot_token: str = ""
    anthropic_api_key: str = ""
    app_base_url: str = "http://localhost:8000"
    encryption_key: str = ""
    webhook_path: str = "/bot/webhook"

    model_config = {"env_file": ".env", "extra": "ignore"}


settings = Settings()
