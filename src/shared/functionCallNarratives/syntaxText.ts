/** Compact lexical-region labels shared by Host-owned return/effect inventories; these are not selected execution paths. */
import type { FunctionCallReturnRegion } from "./sourceSyntaxTypes";

/** Keep every authored predicate/label without evaluating, shortening or selecting it. */
export function formatFunctionCallSyntaxSite(code: string, regions: readonly FunctionCallReturnRegion[]): string {
  const labels = regions.map(region => region.kind === "catch" && /^(?:catch|except)\b/u.test(region.label ?? "") ? region.label!
    : region.kind + (region.expression ? `(${region.expression})`
      : region.label && !["try", "finally", "true", "false"].includes(region.label) ? `(${region.label})` : ""));
  return (labels.length ? labels.join("→") + ": " : "") + "`" + code + "`";
}
