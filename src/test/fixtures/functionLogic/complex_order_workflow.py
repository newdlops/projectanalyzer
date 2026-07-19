"""Standalone Python Function Visualizer stress fixture.

The main batch workflow combines Python-specific control flow, long source
labels, indexed value changes, receiver mutations, and expandable same-file
child calls without requiring third-party packages.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol


@dataclass(slots=True)
class OrderItem:
    """One source item used by the workflow fixture."""

    sku: str
    quantity: int
    unit_price: float
    fragile: bool = False
    backorder_allowed: bool = False


@dataclass(slots=True)
class Order:
    """Input order with enough metadata to create meaningful branches."""

    order_id: str
    customer_id: str
    currency: str
    items: list[OrderItem]
    cancelled: bool = False
    source: str = "unknown"
    priority: str = "standard"
    flags: set[str] = field(default_factory=set)


@dataclass(slots=True)
class BatchOptions:
    """Static policy values that control the fixture's branch outcomes."""

    allow_backorder: bool
    allow_manual_review: bool
    fail_fast: bool
    risk_threshold: int
    maximum_items_per_order: int
    blocked_sources: set[str] = field(default_factory=set)


class InventoryPort(Protocol):
    """Inventory boundary called by the local reservation helper."""

    def available(self, sku: str) -> int:
        raise NotImplementedError

    def reserve(self, sku: str, quantity: int) -> str:
        raise NotImplementedError

    def release(self, reservation_id: str) -> None:
        raise NotImplementedError


class PaymentPort(Protocol):
    """Payment boundary used by the main workflow."""

    def charge(self, payload: dict[str, object]) -> dict[str, object]:
        raise NotImplementedError

    def refund(self, payment_id: str) -> None:
        raise NotImplementedError


class AuditPort(Protocol):
    """Audit boundary that makes source-level effects visible."""

    def publish(self, event: str, payload: dict[str, object]) -> None:
        raise NotImplementedError


class WorkflowJournal:
    """Accumulates readable phase evidence for the returned fixture result."""

    def __init__(self) -> None:
        self._entries: list[str] = []

    def record(self, order_id: str, phase: str, detail: str) -> None:
        """Record one phase transition without invoking an external system."""

        self._entries.append(f"{order_id}:{phase}:{detail}")

    def snapshot(self) -> list[str]:
        """Return a defensive copy of the accumulated entries."""

        return list(self._entries)


def process_complex_order_batch(
    orders: list[Order],
    inventory: InventoryPort,
    payments: PaymentPort,
    audit: AuditPort,
    options: BatchOptions,
) -> dict[str, object]:
    """Process the complex fixture flow and return all accumulated evidence.

    Place the editor cursor inside this function, run ``Visualize Current
    Function``, and expand helper calls directly from their graph boxes.
    """

    journal = WorkflowJournal()
    pending_orders = list(orders)
    result: dict[str, object] = {
        "accepted_order_ids": [],
        "rejected_order_ids": [],
        "review_order_ids": [],
        "skipped_order_ids": [],
        "backordered_skus": set(),
        "failures_by_order_id": {},
        "metrics": {
            "attempted": len(orders),
            "accepted": 0,
            "rejected": 0,
            "reviewed": 0,
            "skipped": 0,
            "released_reservations": 0,
        },
        "summary": {
            "total_orders": len(orders),
            "completed_orders": 0,
            "reconciliation": {
                "identifiers": {
                    "environment_specific_composite_audit_key_for_downstream_reconciliation": "pending"
                }
            },
        },
        "journal": [],
    }

    while pending_orders:
        order = pending_orders.pop(0)
        if should_skip_order(order, options):
            result["skipped_order_ids"].append(order.order_id)
            result["metrics"]["skipped"] += 1
            journal.record(order.order_id, "skip", "policy")
            continue

        reservations: list[dict[str, object]] = []
        captured_payment_id: str | None = None
        rejection_reason: str | None = None
        order_total = 0.0

        try:
            normalized_order = normalize_order(order)
            journal.record(
                order.order_id,
                "normalize",
                f"{len(normalized_order.items)} items",
            )

            if (
                is_high_risk_order(normalized_order, options.risk_threshold)
                and normalized_order.priority == "critical"
                and any(item.fragile and item.quantity > 1 for item in normalized_order.items)
                and "manual-verification-required" in normalized_order.flags
                and not options.allow_manual_review
            ):
                rejection_reason = (
                    "manual review is disabled for a critical fragile order"
                )

            for item in normalized_order.items:
                if rejection_reason:
                    break
                if item.quantity <= 0 or item.unit_price < 0:
                    journal.record(
                        order.order_id,
                        "item",
                        f"ignored invalid {item.sku}",
                    )
                    continue

                reservation = reserve_inventory(
                    item,
                    inventory,
                    options.allow_backorder,
                )
                match reservation["status"]:
                    case "reserved":
                        reservations.append(
                            {
                                "id": reservation["reservation_id"],
                                "sku": item.sku,
                                "quantity": item.quantity,
                            }
                        )
                        order_total += item.quantity * item.unit_price
                    case "backordered":
                        result["backordered_skus"].add(item.sku)
                        if not item.backorder_allowed:
                            rejection_reason = (
                                f"backorder is forbidden for {item.sku}"
                            )
                    case "rejected":
                        rejection_reason = str(reservation["reason"])
                    case unexpected_status:
                        raise ValueError(
                            f"unexpected reservation status: {unexpected_status}"
                        )
            else:
                journal.record(order.order_id, "inventory", "item loop completed")

            journal.record(order.order_id, "inventory", "post-loop continuation")
            if rejection_reason:
                result["metrics"]["released_reservations"] += rollback_reservations(
                    reservations,
                    inventory,
                )
                result["rejected_order_ids"].append(order.order_id)
                result["failures_by_order_id"][order.order_id] = rejection_reason
                result["metrics"]["rejected"] += 1
                if options.fail_fast:
                    raise RuntimeError(
                        f"fail-fast rejection: {order.order_id}: {rejection_reason}"
                    )
                continue

            payment = payments.charge(
                {
                    "order_id": order.order_id,
                    "customer_id": order.customer_id,
                    "amount": order_total,
                    "currency": order.currency,
                }
            )
            captured_payment_id = (
                str(payment["id"])
                if payment["status"] == "captured"
                else None
            )

            match payment["status"]:
                case "captured":
                    result["accepted_order_ids"].append(order.order_id)
                    result["metrics"]["accepted"] += 1
                    journal.record(
                        order.order_id,
                        "payment",
                        f"captured {payment['id']}",
                    )
                case "review":
                    if not options.allow_manual_review:
                        raise RuntimeError(
                            f"manual review is disabled: {order.order_id}"
                        )
                    result["review_order_ids"].append(order.order_id)
                    result["metrics"]["reviewed"] += 1
                    journal.record(
                        order.order_id,
                        "payment",
                        f"review {payment['id']}",
                    )
                case "declined":
                    result["metrics"]["released_reservations"] += (
                        rollback_reservations(reservations, inventory)
                    )
                    result["rejected_order_ids"].append(order.order_id)
                    result["failures_by_order_id"][order.order_id] = str(
                        payment.get("reason", "payment declined")
                    )
                    result["metrics"]["rejected"] += 1
                case unexpected_status:
                    raise ValueError(
                        f"unexpected payment status: {unexpected_status}"
                    )

            audit.publish(
                "order.batch.processed",
                {
                    "order_id": order.order_id,
                    "payment_status": payment["status"],
                    "reservation_count": len(reservations),
                    "order_total": order_total,
                },
            )
        except Exception as error:
            if captured_payment_id:
                payments.refund(captured_payment_id)
            result["metrics"]["released_reservations"] += rollback_reservations(
                reservations,
                inventory,
            )
            result["rejected_order_ids"].append(order.order_id)
            result["failures_by_order_id"][order.order_id] = normalize_error(error)
            result["metrics"]["rejected"] += 1
            journal.record(order.order_id, "error", normalize_error(error))
            if options.fail_fast:
                raise
        finally:
            result["summary"]["completed_orders"] += 1
            journal.record(order.order_id, "finish", "attempt completed")

    summary = build_batch_summary(result)
    result["summary"]["reconciliation"]["identifiers"][
        "environment_specific_composite_audit_key_for_downstream_reconciliation"
    ] = ":".join(
        [
            str(summary["outcome"]),
            str(summary["completed"]),
            str(result["metrics"]["accepted"]),
            str(result["metrics"]["reviewed"]),
            str(result["metrics"]["rejected"]),
            str(len(result["backordered_skus"])),
        ]
    )
    result["journal"] = journal.snapshot()
    audit.publish(
        "order.batch.completed",
        {
            **summary,
            "reconciliation_key": result["summary"]["reconciliation"]
            ["identifiers"]
            ["environment_specific_composite_audit_key_for_downstream_reconciliation"],
        },
    )
    return result


def should_skip_order(order: Order, options: BatchOptions) -> bool:
    """Return whether the order should bypass processing entirely."""

    if order.cancelled or not order.items:
        return True
    return (
        order.source in options.blocked_sources
        or len(order.items) > options.maximum_items_per_order
    )


def normalize_order(order: Order) -> Order:
    """Create normalized values without mutating the supplied order."""

    normalized_items = [
        OrderItem(
            sku=item.sku.strip().upper(),
            quantity=int(item.quantity),
            unit_price=item.unit_price,
            fragile=item.fragile,
            backorder_allowed=item.backorder_allowed,
        )
        for item in order.items
    ]
    return Order(
        order_id=order.order_id,
        customer_id=order.customer_id,
        currency=order.currency.strip().upper(),
        items=normalized_items,
        cancelled=order.cancelled,
        source=order.source.strip().lower(),
        priority=order.priority,
        flags={flag.strip().lower() for flag in order.flags},
    )


def is_high_risk_order(order: Order, threshold: int) -> bool:
    """Combine static indicators without claiming an observed risk score."""

    score = 5 if order.priority == "critical" else 0
    for item in order.items:
        score += 2 if item.fragile else 0
        score += 3 if item.quantity * item.unit_price > 1_000 else 0
    return score >= threshold


def reserve_inventory(
    item: OrderItem,
    inventory: InventoryPort,
    allow_backorder: bool,
) -> dict[str, object]:
    """Map inventory availability into one explicit reservation outcome."""

    available = inventory.available(item.sku)
    if available >= item.quantity:
        return {
            "status": "reserved",
            "reservation_id": inventory.reserve(item.sku, item.quantity),
        }
    if allow_backorder and item.backorder_allowed:
        return {"status": "backordered"}
    return {
        "status": "rejected",
        "reason": f"insufficient inventory for {item.sku}",
    }


def rollback_reservations(
    reservations: list[dict[str, object]],
    inventory: InventoryPort,
) -> int:
    """Release reservations iteratively and return the release count."""

    released = 0
    for reservation in reversed(reservations):
        inventory.release(str(reservation["id"]))
        released += 1
    return released


def build_batch_summary(result: dict[str, object]) -> dict[str, object]:
    """Derive the final terminal summary from accumulated counters."""

    metrics = result["metrics"]
    completed = (
        metrics["accepted"]
        + metrics["reviewed"]
        + metrics["rejected"]
        + metrics["skipped"]
    )
    if metrics["attempted"] == 0:
        return {"outcome": "empty", "completed": completed}
    return {
        "outcome": (
            "complete" if completed == metrics["attempted"] else "partial"
        ),
        "completed": completed,
    }


def normalize_error(error: BaseException) -> str:
    """Normalize an exception without inspecting runtime-specific subclasses."""

    return str(error) or error.__class__.__name__
