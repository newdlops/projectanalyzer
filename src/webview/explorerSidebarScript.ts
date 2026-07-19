/** Sidebar script entrypoint for the flow-first product surface. */

import { getCodeFlowBrowserSource } from "./codeFlow";

/** Returns the complete browser program for the Activity Bar Code Flow Reader. */
export function getExplorerSidebarScript(): string {
  return getCodeFlowBrowserSource();
}
