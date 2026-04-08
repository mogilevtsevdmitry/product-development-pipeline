"""ZenMoney OAuth 2.0 flow helpers.

ZenMoney API docs: https://github.com/zenmoney/ZenPlugins/wiki/ZenMoney-API
OAuth endpoint: https://api.zenmoney.ru/oauth2/authorize
Token endpoint: https://api.zenmoney.ru/oauth2/token
"""
import urllib.parse

import httpx


ZENMONEY_AUTH_URL = "https://api.zenmoney.ru/oauth2/authorize"
ZENMONEY_TOKEN_URL = "https://api.zenmoney.ru/oauth2/token"


class ZenMoneyOAuth:
    """Handles ZenMoney OAuth 2.0 authorization code flow."""

    def __init__(
        self,
        consumer_key: str,
        consumer_secret: str,
        redirect_uri: str,
    ) -> None:
        self.consumer_key = consumer_key
        self.consumer_secret = consumer_secret
        self.redirect_uri = redirect_uri

    def build_auth_url(self, state: str | None = None) -> str:
        """Build the OAuth authorization URL that the user should visit.

        Args:
            state: Opaque value for CSRF protection (e.g. user telegram_id).
        """
        params = {
            "response_type": "code",
            "client_id": self.consumer_key,
            "redirect_uri": self.redirect_uri,
        }
        if state:
            params["state"] = state
        return f"{ZENMONEY_AUTH_URL}?{urllib.parse.urlencode(params)}"

    async def exchange_code(self, code: str) -> dict:
        """Exchange authorization code for access + refresh tokens.

        Returns dict with: access_token, refresh_token, expires_in, token_type.
        Raises httpx.HTTPStatusError on failure.
        """
        async with httpx.AsyncClient() as client:
            response = await client.post(
                ZENMONEY_TOKEN_URL,
                data={
                    "grant_type": "authorization_code",
                    "code": code,
                    "client_id": self.consumer_key,
                    "client_secret": self.consumer_secret,
                    "redirect_uri": self.redirect_uri,
                },
            )
            response.raise_for_status()
            return response.json()

    async def refresh_token(self, refresh_token_value: str) -> dict:
        """Refresh an expired access token using the refresh token.

        Returns dict with: access_token, refresh_token, expires_in.
        Raises httpx.HTTPStatusError on failure.
        """
        async with httpx.AsyncClient() as client:
            response = await client.post(
                ZENMONEY_TOKEN_URL,
                data={
                    "grant_type": "refresh_token",
                    "refresh_token": refresh_token_value,
                    "client_id": self.consumer_key,
                    "client_secret": self.consumer_secret,
                },
            )
            response.raise_for_status()
            return response.json()
