/**
 * Environment-independent curriculum contract for evidence-based project onboarding.
 *
 * The roadmap describes what a contributor must learn, while the short
 * orientation actions connect that process to evidence the analyzer already
 * exposes. It deliberately separates observed activity from understanding or
 * production readiness, which require human confirmation and runtime proof.
 */

/** Confidence vocabulary used across the learning journey. */
export type ProjectLearningEvidenceState =
  | "discovered"
  | "inferred"
  | "confirmed"
  | "demonstrated"
  | "unknown";

/** Stable stages in the complete project-learning process. */
export type ProjectLearningStageId =
  | "context"
  | "architecture"
  | "criticalFlows"
  | "dataDependencies"
  | "qualityChange"
  | "operationsFailure"
  | "handsOnProof"
  | "continuousRefresh";

/** One stage in the long-form learning roadmap. */
export type ProjectLearningRoadmapStage = {
  id: ProjectLearningStageId;
  title: string;
  objective: string;
  evidenceStates: ProjectLearningEvidenceState[];
  evidenceNeeded: string;
  exitCriteria: string;
};

/** Observable browser action used by the initial guided orientation slice. */
export type ProjectLearningOrientationActionId =
  | "inspectScope"
  | "traceRepresentativePath"
  | "verifyConcreteSource";

/** Pedagogical framing around one analyzer-backed orientation action. */
export type ProjectLearningOrientationAction = {
  id: ProjectLearningOrientationActionId;
  title: string;
  supportsStages: ProjectLearningStageId[];
  whyItMatters: string;
  learn: string;
  inspectEvidence: string;
  activity: string;
  explainBack: string;
  exitCriteria: string;
};

/** Versioned static curriculum embedded into the sidebar browser script. */
export type ProjectLearningCurriculum = {
  version: string;
  orientationActions: ProjectLearningOrientationAction[];
  roadmap: ProjectLearningRoadmapStage[];
};

/**
 * Returns the stable curriculum in learning order.
 *
 * No project-specific business importance, ownership, or operational claim is
 * generated here. Later evidence adapters may fill those gaps only from
 * repository, maintainer, or demonstrated runtime evidence.
 */
export function createProjectLearningCurriculum(): ProjectLearningCurriculum {
  return {
    version: "1",
    orientationActions: [
      {
        id: "inspectScope",
        title: "Map the project",
        supportsStages: ["context", "architecture"],
        whyItMatters: "Narrow the technical scope before reading implementation details.",
        learn:
          "Detected scopes and source areas are static evidence, not team or business boundaries.",
        inspectEvidence: "Project Map, framework evidence, analyzed files, and source landmarks.",
        activity: "Choose one detected scope and inspect its measured source areas.",
        explainBack: "Which scope are you studying, and what source evidence identifies it?",
        exitCriteria: "The current graph returns detail for one selected scope."
      },
      {
        id: "traceRepresentativePath",
        title: "Trace one request",
        supportsStages: ["criticalFlows", "dataDependencies"],
        whyItMatters: "Execution order gives isolated files and symbols a concrete purpose.",
        learn:
          "A representative path is a static reading example, not runtime frequency or business criticality.",
        inspectEvidence: "Entrypoint, handler, intermediate calls, boundary, confidence, and omissions.",
        activity: "Expand one HTTP or GraphQL reading path from entrypoint to its shown boundary.",
        explainBack: "What triggers the flow, where does it cross a boundary, and which gaps remain?",
        exitCriteria: "One representative path disclosure is opened."
      },
      {
        id: "verifyConcreteSource",
        title: "Verify in source",
        supportsStages: ["criticalFlows", "handsOnProof"],
        whyItMatters: "Analyzer output is a source-reading hypothesis until a person verifies it.",
        learn:
          "Definitions, call sites, and mapping evidence answer different questions and must stay distinct.",
        inspectEvidence: "A concrete source-backed step and its workspace-relative definition location.",
        activity:
          "Request one concrete step in the editor, then confirm it opened before inspecting adjacent code.",
        explainBack: "Why does this source support the shown step, and where could runtime behavior differ?",
        exitCriteria: "A concrete reading-path source action is sent to the editor."
      }
    ],
    roadmap: [
      {
        id: "context",
        title: "Context & scope",
        objective: "Explain why the project exists, who depends on it, its owner, boundaries, and failure impact.",
        evidenceStates: ["discovered", "confirmed", "unknown"],
        evidenceNeeded: "Analyzer footprint plus maintainer-confirmed purpose, owner, and impact.",
        exitCriteria: "A newcomer can state the purpose, audience, ownership, boundary, and unknowns."
      },
      {
        id: "architecture",
        title: "Architecture & entrypoints",
        objective: "Identify deployable scopes, interfaces, entrypoints, major components, and design decisions.",
        evidenceStates: ["discovered", "inferred", "confirmed"],
        evidenceNeeded: "Source structure, configuration, design documents, and maintainer corrections.",
        exitCriteria: "A source-backed system map separates observed facts, inference, and open questions."
      },
      {
        id: "criticalFlows",
        title: "Critical flows",
        objective: "Trace normal, error, and degraded paths in execution order and connect them to user impact.",
        evidenceStates: ["discovered", "inferred", "confirmed", "unknown"],
        evidenceNeeded: "Static paths plus team-confirmed criticality and runtime traces.",
        exitCriteria: "Three to five confirmed flows have triggers, boundaries, owners, gaps, and impact."
      },
      {
        id: "dataDependencies",
        title: "Data & dependencies",
        objective: "Follow inputs, transformations, state, schemas, external systems, and failure policies.",
        evidenceStates: ["discovered", "inferred", "confirmed", "unknown"],
        evidenceNeeded: "Models and calls plus owners, consistency rules, retries, timeouts, and recovery evidence.",
        exitCriteria: "A dependency ledger records state ownership, failure behavior, confidence, and unknowns."
      },
      {
        id: "qualityChange",
        title: "Quality & change",
        objective: "Connect tests, build, configuration, security, capacity, and blast radius to critical flows.",
        evidenceStates: ["discovered", "confirmed", "demonstrated", "unknown"],
        evidenceNeeded: "Repository configuration plus successful build, test, and change-impact evidence.",
        exitCriteria: "Readiness gaps are evidence-backed and converted into prioritized change work."
      },
      {
        id: "operationsFailure",
        title: "Operations & failure",
        objective: "Learn signals, SLOs, alerts, runbooks, escalation, deployment, rollback, capacity, and recovery.",
        evidenceStates: ["confirmed", "demonstrated", "unknown"],
        evidenceNeeded: "Operational documents, telemetry, incident history, and safe failure exercises.",
        exitCriteria: "The learner can diagnose, escalate, mitigate, and recover with demonstrated evidence."
      },
      {
        id: "handsOnProof",
        title: "Hands-on proof",
        objective: "Run the project, trace a real request, make a safe change, and explain the system back.",
        evidenceStates: ["demonstrated", "unknown"],
        evidenceNeeded: "Executed commands, runtime trace, reviewed change, and maintainer feedback.",
        exitCriteria: "A maintainer validates the learner's explanation and completed safe contribution."
      },
      {
        id: "continuousRefresh",
        title: "Continuous refresh",
        objective: "Detect knowledge drift after changes and keep canonical learning evidence current.",
        evidenceStates: ["confirmed", "demonstrated", "unknown"],
        evidenceNeeded: "Evidence fingerprints, reviewed updates, and tracked learning gaps.",
        exitCriteria: "Changed evidence triggers review, and confirmed gaps enter the engineering backlog."
      }
    ]
  };
}
