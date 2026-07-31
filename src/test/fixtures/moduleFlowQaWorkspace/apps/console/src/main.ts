import { processOrder } from "../../../packages/core/src/processOrder";

/** App boundary used to open an expandable Module Flow branch during QA. */
export function runConsoleOrder(): string {
  return processOrder("qa-order", true);
}

export const completedOrder = runConsoleOrder();
