/**
 * Public surface for the pure Guided Tour domain.
 * Internal stop selection and instruction templates remain module-private.
 */

export { createGuidedTourProjection } from "./guidedTourProjector";
export { GUIDED_TOUR_STOP_LIMIT } from "./stopProjector";
export type {
  GuidedTourEvidenceOnlyStop,
  GuidedTourLookFor,
  GuidedTourMission,
  GuidedTourNavigableStop,
  GuidedTourProjection,
  GuidedTourSelectionEvidence,
  GuidedTourSourceAnchor,
  GuidedTourStop,
  GuidedTourStopBase,
  GuidedTourStopKind,
  GuidedTourTransitionEvidence,
  GuidedTourUnavailable
} from "./types";
