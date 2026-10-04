import { getFunctionTutorGuideStyles } from "./functionTutorGuideStyles";
import { getFunctionSummaryStyles } from "./summary";
import { getFunctionNarrativesStyles } from "../../functionNarratives";

/** Theme-native styles for the retained lazy scenario interpreter and Function Guide surface. */

export function getFunctionTutorStyles(): string {
  return /* css */ `
    ${getFunctionTutorGuideStyles()}
    ${getFunctionSummaryStyles()}
    ${getFunctionNarrativesStyles()}
  `;
}
