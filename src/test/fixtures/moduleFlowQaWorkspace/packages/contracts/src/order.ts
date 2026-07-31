/** Shared boundary contract for the Module Flow desktop QA workspace. */
export type OrderRequest = {
  id: string;
  priority: boolean;
};

/** Creates the stable payload consumed by the core package. */
export function createOrder(id: string, priority: boolean): OrderRequest {
  return { id, priority };
}
