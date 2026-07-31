import { createOrder } from "../../contracts/src/order";

/** Converts an app request into an execution result with an inspectable branch. */
export function processOrder(id: string, priority: boolean): string {
  const order = createOrder(id, priority);
  if (order.priority) {
    return dispatchPriority(order.id);
  }
  return dispatchStandard(order.id);
}

/** Boundary branch selected for urgent orders. */
export function dispatchPriority(id: string): string {
  return `priority:${id}`;
}

/** Boundary branch selected for normal orders. */
export function dispatchStandard(id: string): string {
  return `standard:${id}`;
}
