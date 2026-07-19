/**
 * Standalone Function Visualizer stress fixture. The exported batch workflow
 * combines nested decisions, loops, switches, exceptions, source-level value
 * changes, and same-file child calls without relying on external packages.
 */

export type OrderPriority = "standard" | "urgent" | "critical";
export type ReservationStatus = "reserved" | "backordered" | "rejected";
export type PaymentStatus = "captured" | "review" | "declined";

export interface OrderItem {
  sku: string;
  quantity: number;
  unitPrice: number;
  fragile: boolean;
  backorderAllowed: boolean;
}

export interface Order {
  id: string;
  customerId: string;
  cancelled: boolean;
  currency: string;
  items: OrderItem[];
  metadata: {
    source: string;
    priority: OrderPriority;
    flags: string[];
  };
}

export interface InventoryPort {
  available(sku: string): number;
  reserve(sku: string, quantity: number): string;
  release(reservationId: string): void;
}

export interface PaymentPort {
  charge(input: {
    orderId: string;
    customerId: string;
    amount: number;
    currency: string;
  }): { id: string; status: PaymentStatus; reason?: string };
  refund(paymentId: string): void;
}

export interface AuditPort {
  publish(event: string, payload: Record<string, unknown>): void;
}

export interface BatchOptions {
  allowBackorder: boolean;
  allowManualReview: boolean;
  failFast: boolean;
  riskThreshold: number;
  maximumItemsPerOrder: number;
  blockedSources: Set<string>;
}

type Reservation = {
  id: string;
  sku: string;
  quantity: number;
};

type BatchMetrics = {
  attempted: number;
  accepted: number;
  rejected: number;
  reviewed: number;
  skipped: number;
  releasedReservations: number;
};

export interface BatchResult {
  acceptedOrderIds: string[];
  rejectedOrderIds: string[];
  reviewOrderIds: string[];
  skippedOrderIds: string[];
  backorderedSkus: Set<string>;
  failuresByOrderId: Map<string, string>;
  metrics: BatchMetrics;
  summary: {
    totalOrders: number;
    completedOrders: number;
    reconciliation: {
      identifiers: {
        environmentSpecificCompositeAuditKeyForDownstreamReconciliation: string;
      };
    };
  };
  journal: string[];
}

/** Accumulates readable workflow evidence and exposes one immutable snapshot. */
class WorkflowJournal {
  private readonly entries: string[] = [];

  /** Records one phase transition or failure without external side effects. */
  public record(orderId: string, phase: string, detail: string): void {
    this.entries.push(`${orderId}:${phase}:${detail}`);
  }

  /** Returns a copy so later mutations cannot alter an already returned result. */
  public snapshot(): string[] {
    return [...this.entries];
  }
}

/**
 * Main fixture entrypoint. Place the editor cursor inside this function and run
 * "Visualize Current Function", then expand helper calls from their graph boxes.
 */
export function processComplexOrderBatch(
  orders: readonly Order[],
  inventory: InventoryPort,
  payments: PaymentPort,
  audit: AuditPort,
  options: BatchOptions
): BatchResult {
  const journal = new WorkflowJournal();
  const pendingOrders = [...orders];
  const result: BatchResult = {
    acceptedOrderIds: [],
    rejectedOrderIds: [],
    reviewOrderIds: [],
    skippedOrderIds: [],
    backorderedSkus: new Set<string>(),
    failuresByOrderId: new Map<string, string>(),
    metrics: {
      attempted: orders.length,
      accepted: 0,
      rejected: 0,
      reviewed: 0,
      skipped: 0,
      releasedReservations: 0
    },
    summary: {
      totalOrders: orders.length,
      completedOrders: 0,
      reconciliation: {
        identifiers: {
          environmentSpecificCompositeAuditKeyForDownstreamReconciliation: "pending"
        }
      }
    },
    journal: []
  };

  while (pendingOrders.length > 0) {
    const order = pendingOrders.shift();
    if (!order) {
      continue;
    }
    if (shouldSkipOrder(order, options)) {
      result.skippedOrderIds.push(order.id);
      result.metrics.skipped += 1;
      journal.record(order.id, "skip", "policy");
      continue;
    }

    const reservations: Reservation[] = [];
    let capturedPaymentId: string | undefined;
    let rejectionReason: string | undefined;
    let orderTotal = 0;

    try {
      const normalizedOrder = normalizeOrder(order);
      journal.record(order.id, "normalize", `${normalizedOrder.items.length} items`);

      if (
        isHighRiskOrder(normalizedOrder, options.riskThreshold)
        && normalizedOrder.metadata.priority === "critical"
        && normalizedOrder.items.some((item) => item.fragile && item.quantity > 1)
        && normalizedOrder.metadata.flags.includes("manual-verification-required")
        && !options.allowManualReview
      ) {
        rejectionReason = "manual review is disabled for a critical fragile order";
      }

      for (const item of normalizedOrder.items) {
        if (rejectionReason) {
          break;
        }
        if (item.quantity <= 0 || item.unitPrice < 0) {
          journal.record(order.id, "item", `ignored invalid ${item.sku}`);
          continue;
        }

        const reservation = reserveInventory(item, inventory, options.allowBackorder);
        switch (reservation.status) {
          case "reserved":
            reservations.push({
              id: reservation.reservationId,
              sku: item.sku,
              quantity: item.quantity
            });
            orderTotal += item.quantity * item.unitPrice;
            break;
          case "backordered":
            result.backorderedSkus.add(item.sku);
            if (!item.backorderAllowed) {
              rejectionReason = `backorder is forbidden for ${item.sku}`;
            }
            break;
          case "rejected":
            rejectionReason = reservation.reason;
            break;
          default:
            assertNever(reservation);
        }
      }

      journal.record(order.id, "inventory", "item loop completed");
      if (rejectionReason) {
        result.metrics.releasedReservations += rollbackReservations(reservations, inventory);
        result.rejectedOrderIds.push(order.id);
        result.failuresByOrderId.set(order.id, rejectionReason);
        result.metrics.rejected += 1;
        if (options.failFast) {
          throw new Error(`fail-fast rejection: ${order.id}: ${rejectionReason}`);
        }
        continue;
      }

      const payment = payments.charge({
        orderId: order.id,
        customerId: order.customerId,
        amount: orderTotal,
        currency: order.currency
      });
      capturedPaymentId = payment.status === "captured" ? payment.id : undefined;

      switch (payment.status) {
        case "captured":
          result.acceptedOrderIds.push(order.id);
          result.metrics.accepted += 1;
          journal.record(order.id, "payment", `captured ${payment.id}`);
          break;
        case "review":
          if (!options.allowManualReview) {
            throw new Error(`manual review is disabled: ${order.id}`);
          }
          result.reviewOrderIds.push(order.id);
          result.metrics.reviewed += 1;
          journal.record(order.id, "payment", `review ${payment.id}`);
          break;
        case "declined":
          result.metrics.releasedReservations += rollbackReservations(reservations, inventory);
          result.rejectedOrderIds.push(order.id);
          result.failuresByOrderId.set(order.id, payment.reason ?? "payment declined");
          result.metrics.rejected += 1;
          break;
        default:
          assertNever(payment.status);
      }

      audit.publish("order.batch.processed", {
        orderId: order.id,
        paymentStatus: payment.status,
        reservationCount: reservations.length,
        orderTotal
      });
    } catch (error) {
      if (capturedPaymentId) {
        payments.refund(capturedPaymentId);
      }
      result.metrics.releasedReservations += rollbackReservations(reservations, inventory);
      result.rejectedOrderIds.push(order.id);
      result.failuresByOrderId.set(order.id, normalizeError(error));
      result.metrics.rejected += 1;
      journal.record(order.id, "error", normalizeError(error));
      if (options.failFast) {
        throw error;
      }
    } finally {
      result.summary.completedOrders += 1;
      journal.record(order.id, "finish", "attempt completed");
    }
  }

  const summary = buildBatchSummary(result);
  result.summary.reconciliation.identifiers.environmentSpecificCompositeAuditKeyForDownstreamReconciliation = [
    summary.outcome,
    summary.completed,
    result.metrics.accepted,
    result.metrics.reviewed,
    result.metrics.rejected,
    result.backorderedSkus.size
  ].join(":");
  result.journal = journal.snapshot();
  audit.publish("order.batch.completed", {
    ...summary,
    reconciliationKey:
      result.summary.reconciliation.identifiers
        .environmentSpecificCompositeAuditKeyForDownstreamReconciliation
  });
  return result;
}

/** Decides whether an order should bypass the processing loop entirely. */
function shouldSkipOrder(order: Order, options: BatchOptions): boolean {
  if (order.cancelled || order.items.length === 0) {
    return true;
  }
  return options.blockedSources.has(order.metadata.source)
    || order.items.length > options.maximumItemsPerOrder;
}

/** Produces stable source values while retaining the original object contract. */
function normalizeOrder(order: Order): Order {
  const normalizedItems = order.items.map((item) => ({
    ...item,
    sku: item.sku.trim().toUpperCase(),
    quantity: Math.floor(item.quantity)
  }));
  return {
    ...order,
    currency: order.currency.trim().toUpperCase(),
    items: normalizedItems,
    metadata: {
      ...order.metadata,
      source: order.metadata.source.trim().toLowerCase(),
      flags: [...new Set(order.metadata.flags.map((flag) => flag.trim().toLowerCase()))]
    }
  };
}

/** Combines several static indicators without claiming a runtime risk score. */
function isHighRiskOrder(order: Order, threshold: number): boolean {
  let score = order.metadata.priority === "critical" ? 5 : 0;
  for (const item of order.items) {
    score += item.fragile ? 2 : 0;
    score += item.quantity * item.unitPrice > 1_000 ? 3 : 0;
  }
  return score >= threshold;
}

/** Maps inventory availability into one explicit reservation outcome. */
function reserveInventory(
  item: OrderItem,
  inventory: InventoryPort,
  allowBackorder: boolean
):
  | { status: "reserved"; reservationId: string }
  | { status: "backordered" }
  | { status: "rejected"; reason: string } {
  const available = inventory.available(item.sku);
  if (available >= item.quantity) {
    return {
      status: "reserved",
      reservationId: inventory.reserve(item.sku, item.quantity)
    };
  }
  if (allowBackorder && item.backorderAllowed) {
    return { status: "backordered" };
  }
  return {
    status: "rejected",
    reason: `insufficient inventory for ${item.sku}`
  };
}

/** Releases reservations iteratively and returns the exact release count. */
function rollbackReservations(
  reservations: readonly Reservation[],
  inventory: InventoryPort
): number {
  let released = 0;
  for (let index = reservations.length - 1; index >= 0; index -= 1) {
    const reservation = reservations[index];
    if (!reservation) {
      continue;
    }
    inventory.release(reservation.id);
    released += 1;
  }
  return released;
}

/** Derives a compact terminal summary from the accumulated result. */
function buildBatchSummary(result: BatchResult): {
  outcome: "empty" | "partial" | "complete";
  completed: number;
} {
  const completed = result.metrics.accepted
    + result.metrics.reviewed
    + result.metrics.rejected
    + result.metrics.skipped;
  if (result.metrics.attempted === 0) {
    return { outcome: "empty", completed };
  }
  return {
    outcome: completed === result.metrics.attempted ? "complete" : "partial",
    completed
  };
}

/** Normalizes unknown exceptions without assuming every throw is an Error. */
function normalizeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Makes newly introduced union members visible to both TypeScript and the graph. */
function assertNever(value: never): never {
  throw new Error(`Unexpected workflow state: ${String(value)}`);
}
