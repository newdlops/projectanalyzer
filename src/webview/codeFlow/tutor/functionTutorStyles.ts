import { getFunctionTutorGuideStyles } from "./functionTutorGuideStyles";
import { getFunctionSummaryStyles } from "./summary";

/** Theme-native styles for the retained lazy scenario interpreter and Function Guide surface. */

export function getFunctionTutorStyles(): string {
  return /* css */ `
    ${getFunctionTutorGuideStyles()}
    ${getFunctionSummaryStyles()}
  `;
}
