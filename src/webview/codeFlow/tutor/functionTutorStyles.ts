import { getFunctionTutorGuideStyles } from "./functionTutorGuideStyles";

/** Theme-native styles for the retained lazy scenario interpreter and Function Guide surface. */

export function getFunctionTutorStyles(): string {
  return /* css */ `
    ${getFunctionTutorGuideStyles()}
  `;
}
