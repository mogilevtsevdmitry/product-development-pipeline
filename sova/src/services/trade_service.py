"""Trade service — create, confirm, cancel, execute trade orders.

Handles the full lifecycle of a trade order:
1. create_order → pending_confirmation (shown to user)
2. confirm_order → submitted (enqueued for execution)
3. execute_order → executed/failed (called by Trade Worker)
4. cancel_order → cancelled (user cancelled or timeout)

Safety checks:
- 60-second confirmation timeout
- Price deviation check (>1% triggers re-show)
- Configurable trade limit (default 50,000 RUB)
"""

import logging
import uuid
from datetime import datetime, timezone, timedelta
from decimal import Decimal

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.trade_order import TradeOrder
from src.services.tbank.client import TBankClient, quotation_to_decimal

logger = logging.getLogger(__name__)

# Default trade limit in RUB
DEFAULT_TRADE_LIMIT = Decimal("50000")
# Confirmation timeout in seconds
CONFIRMATION_TIMEOUT_SECONDS = 60
# Price deviation threshold (1%)
PRICE_DEVIATION_THRESHOLD = Decimal("0.01")


class TradeError(Exception):
    """Base trade error."""


class OrderNotFoundError(TradeError):
    """Order not found."""


class OrderExpiredError(TradeError):
    """Order confirmation timed out."""


class PriceDeviationError(TradeError):
    """Price changed more than threshold between show and confirm."""

    def __init__(self, old_price: Decimal, new_price: Decimal):
        self.old_price = old_price
        self.new_price = new_price
        super().__init__(f"Price changed from {old_price} to {new_price}")


class TradeLimitExceededError(TradeError):
    """Order total exceeds trade limit."""

    def __init__(self, total: Decimal, limit: Decimal):
        self.total = total
        self.limit = limit
        super().__init__(f"Order total {total} exceeds limit {limit}")


class TradeService:
    def __init__(
        self,
        db: AsyncSession,
        tbank_client: TBankClient | None = None,
        trade_limit: Decimal = DEFAULT_TRADE_LIMIT,
    ):
        self.db = db
        self.tbank_client = tbank_client
        self.trade_limit = trade_limit

    # ------------------------------------------------------------------
    # Create order
    # ------------------------------------------------------------------

    async def create_order(
        self,
        user_id: int,
        ticker: str,
        direction: str,
        quantity: int,
        order_type: str = "market",
        price: Decimal | None = None,
    ) -> TradeOrder:
        """Create a new trade order with status 'pending_confirmation'.

        Args:
            user_id: Telegram user ID
            ticker: Instrument ticker (e.g. SBER)
            direction: 'buy' or 'sell'
            quantity: Number of lots
            order_type: 'market' or 'limit'
            price: Limit price (required for limit orders)

        Returns:
            Created TradeOrder
        """
        order = TradeOrder(
            user_id=user_id,
            ticker=ticker.upper(),
            direction=direction,
            quantity=quantity,
            order_type=order_type,
            price=price,
            status="pending_confirmation",
        )
        self.db.add(order)
        await self.db.commit()
        await self.db.refresh(order)
        return order

    # ------------------------------------------------------------------
    # Confirm order
    # ------------------------------------------------------------------

    async def confirm_order(self, order_id: uuid.UUID) -> TradeOrder:
        """Confirm a pending order — changes status to 'submitted'.

        Checks:
        - Order exists and is pending_confirmation
        - Not expired (60s timeout)
        - Price deviation <1% (if tbank_client available)

        Raises:
            OrderNotFoundError: if order not found or wrong status
            OrderExpiredError: if confirmation timeout exceeded
            PriceDeviationError: if price changed >1%
        """
        order = await self._get_order(order_id)
        if order is None or order.status != "pending_confirmation":
            raise OrderNotFoundError(f"Order {order_id} not found or not pending")

        # Check timeout
        now = datetime.now(timezone.utc)
        # Ensure created_at is timezone-aware (SQLite may strip tzinfo)
        created_at = order.created_at
        if created_at.tzinfo is None:
            created_at = created_at.replace(tzinfo=timezone.utc)
        elapsed = (now - created_at).total_seconds()
        if elapsed > CONFIRMATION_TIMEOUT_SECONDS:
            order.status = "cancelled"
            await self.db.commit()
            raise OrderExpiredError(
                f"Order expired after {elapsed:.0f}s (limit: {CONFIRMATION_TIMEOUT_SECONDS}s)"
            )

        # Price deviation check (only for market orders with a stored price)
        if (
            self.tbank_client is not None
            and order.price is not None
            and order.order_type == "market"
        ):
            current_price = await self.get_current_price(order.ticker)
            if current_price is not None and order.price > 0:
                deviation = abs(current_price - order.price) / order.price
                if deviation > PRICE_DEVIATION_THRESHOLD:
                    raise PriceDeviationError(order.price, current_price)

        order.status = "submitted"
        order.confirmed_at = now
        await self.db.commit()
        await self.db.refresh(order)
        return order

    # ------------------------------------------------------------------
    # Cancel order
    # ------------------------------------------------------------------

    async def cancel_order(self, order_id: uuid.UUID) -> TradeOrder:
        """Cancel a pending or submitted order.

        Raises:
            OrderNotFoundError: if order not found
        """
        order = await self._get_order(order_id)
        if order is None:
            raise OrderNotFoundError(f"Order {order_id} not found")

        if order.status in ("executed", "failed", "cancelled"):
            return order  # Already terminal

        order.status = "cancelled"
        await self.db.commit()
        await self.db.refresh(order)
        return order

    # ------------------------------------------------------------------
    # Execute order (called by Trade Worker)
    # ------------------------------------------------------------------

    async def execute_order(self, order_id: uuid.UUID) -> TradeOrder:
        """Execute a submitted order via T-Bank API.

        Called by the Trade Worker. Updates status to 'executed' or 'failed'.

        Raises:
            OrderNotFoundError: if order not found or wrong status
        """
        order = await self._get_order(order_id)
        if order is None or order.status != "submitted":
            raise OrderNotFoundError(f"Order {order_id} not found or not submitted")

        if self.tbank_client is None:
            order.status = "failed"
            await self.db.commit()
            raise TradeError("T-Bank client not configured")

        try:
            # Submit to T-Bank API
            result = await self._submit_to_tbank(order)
            order.status = "executed"
            order.tbank_order_id = result.get("order_id")
            order.executed_at = datetime.now(timezone.utc)
        except Exception as e:
            logger.error("Failed to execute order %s: %s", order_id, e)
            order.status = "failed"

        await self.db.commit()
        await self.db.refresh(order)
        return order

    # ------------------------------------------------------------------
    # Queries
    # ------------------------------------------------------------------

    async def get_pending_orders(self, user_id: int) -> list[TradeOrder]:
        """Get all pending_confirmation orders for a user."""
        result = await self.db.execute(
            select(TradeOrder).where(
                TradeOrder.user_id == user_id,
                TradeOrder.status == "pending_confirmation",
            )
        )
        return list(result.scalars().all())

    async def get_order(self, order_id: uuid.UUID) -> TradeOrder | None:
        """Get order by ID (public method)."""
        return await self._get_order(order_id)

    async def get_current_price(self, ticker: str) -> Decimal | None:
        """Fetch current price for a ticker from T-Bank API.

        Returns price per lot or None if unavailable.
        """
        if self.tbank_client is None:
            return None
        try:
            data = await self.tbank_client._request(
                "/tinkoff.public.invest.api.contract.v1.MarketDataService/GetLastPrices",
                {"instrumentId": [ticker]},
            )
            prices = data.get("lastPrices", [])
            if prices:
                return quotation_to_decimal(prices[0].get("price", {}))
        except Exception as e:
            logger.warning("Failed to get price for %s: %s", ticker, e)
        return None

    # ------------------------------------------------------------------
    # Trade limit check
    # ------------------------------------------------------------------

    def check_trade_limit(
        self, price: Decimal, quantity: int, limit: Decimal | None = None,
    ) -> bool:
        """Check if order total exceeds trade limit.

        Returns True if within limit, False if exceeds.
        """
        effective_limit = limit or self.trade_limit
        total = price * quantity
        return total <= effective_limit

    # ------------------------------------------------------------------
    # Expire stale orders
    # ------------------------------------------------------------------

    async def expire_stale_orders(self) -> int:
        """Cancel all pending_confirmation orders older than timeout.

        Returns number of expired orders.
        """
        cutoff = datetime.now(timezone.utc) - timedelta(
            seconds=CONFIRMATION_TIMEOUT_SECONDS
        )
        result = await self.db.execute(
            update(TradeOrder)
            .where(
                TradeOrder.status == "pending_confirmation",
                TradeOrder.created_at < cutoff,
            )
            .values(status="cancelled")
        )
        await self.db.commit()
        return result.rowcount

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    async def _get_order(self, order_id: uuid.UUID) -> TradeOrder | None:
        """Get order by ID."""
        result = await self.db.execute(
            select(TradeOrder).where(TradeOrder.id == order_id)
        )
        return result.scalar_one_or_none()

    async def _submit_to_tbank(self, order: TradeOrder) -> dict:
        """Submit order to T-Bank API.

        Returns dict with 'order_id' on success.
        """
        account_id = await self.tbank_client._resolve_account_id()

        # Determine order direction for T-Bank API
        direction_map = {
            "buy": "ORDER_DIRECTION_BUY",
            "sell": "ORDER_DIRECTION_SELL",
        }
        tb_direction = direction_map.get(order.direction, "ORDER_DIRECTION_BUY")

        # Determine order type for T-Bank API
        type_map = {
            "market": "ORDER_TYPE_MARKET",
            "limit": "ORDER_TYPE_LIMIT",
        }
        tb_type = type_map.get(order.order_type, "ORDER_TYPE_MARKET")

        body = {
            "accountId": account_id,
            "instrumentId": order.ticker,
            "quantity": str(order.quantity),
            "direction": tb_direction,
            "orderType": tb_type,
        }

        # Add price for limit orders
        if order.order_type == "limit" and order.price is not None:
            units = int(order.price)
            nano = int((order.price - units) * 1_000_000_000)
            body["price"] = {"units": str(units), "nano": nano}

        if self.tbank_client.sandbox:
            endpoint = "/tinkoff.public.invest.api.contract.v1.SandboxService/PostSandboxOrder"
        else:
            endpoint = "/tinkoff.public.invest.api.contract.v1.OrdersService/PostOrder"

        result = await self.tbank_client._request(endpoint, body)
        return {"order_id": result.get("orderId", "")}
