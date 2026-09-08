/** Real source adapters and planner fixtures shared by input-quality and neural learning tests. */
import { analyzeFunctionLogic } from "../../../analyzer/functionLogic";
import { analyzeFunctionTutorDeclaration } from "../../../analyzer/functionTutor";
import { buildFunctionTutorModel, CodeFlowInsightCache } from "../../../application/codeFlow";
import type { SymbolNode } from "../../../shared/types";
import { createGraph } from "./projectReadingGuideFixtures";

/** Runs both production syntax adapters and the production application planner. */
export async function buildInputModel(sourceText: string) {
  const lines = sourceText.split("\n");
  const startLine = lines.findIndex((line) => line.startsWith("export function inspect"));
  const node: SymbolNode = { id: "function:input-quality", kind: "function", name: "inspect", qualifiedName: "inspect",
    filePath: "/workspace/quality.ts", language: "typescript",
    range: { startLine, startCharacter: 0, endLine: lines.length - 1, endCharacter: lines.at(-1)!.length },
    selectionRange: { startLine, startCharacter: 16, endLine: startLine, endCharacter: 23 } };
  const functionLogic = analyzeFunctionLogic({ functionNode: node, sourceText });
  const declaration = analyzeFunctionTutorDeclaration({ functionNode: node, sourceText, functionLogic });
  const graph = createGraph({ files: [node.filePath], callables: [node] });
  const insights = new CodeFlowInsightCache().get(graph);
  return buildFunctionTutorModel({ graph, declaration, functionLogic, architectureIndex: insights.functionArchitecture,
    semanticFlows: insights.semanticFlows, functionIndex: insights.functionIndex, readSourceText: async () => sourceText });
}
