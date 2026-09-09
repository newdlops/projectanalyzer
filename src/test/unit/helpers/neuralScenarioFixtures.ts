/** Real source adapters and planner fixtures shared by input-quality and neural learning tests. */
import { analyzeFunctionLogic } from "../../../analyzer/functionLogic";
import { analyzeFunctionTutorDeclaration } from "../../../analyzer/functionTutor";
import { buildFunctionTutorModel, CodeFlowInsightCache } from "../../../application/codeFlow";
import type { SymbolNode } from "../../../shared/types";
import { createGraph } from "./projectReadingGuideFixtures";

/** Runs both production syntax adapters and the production application planner. */
export async function buildInputModel(sourceText: string, language: "typescript" | "python" = "typescript") {
  const lines = sourceText.split("\n");
  const startLine = lines.findIndex((line) => line.startsWith(language === "python" ? "def inspect" : "export function inspect"));
  const node: SymbolNode = { id: "function:input-quality", kind: "function", name: "inspect", qualifiedName: "inspect",
    filePath: language === "python" ? "/workspace/quality.py" : "/workspace/quality.ts", language,
    range: { startLine, startCharacter: 0, endLine: lines.length - 1, endCharacter: lines.at(-1)!.length },
    selectionRange: { startLine, startCharacter: language === "python" ? 4 : 16, endLine: startLine, endCharacter: language === "python" ? 11 : 23 } };
  const functionLogic = analyzeFunctionLogic({ functionNode: node, sourceText });
  const declaration = analyzeFunctionTutorDeclaration({ functionNode: node, sourceText, functionLogic });
  const graph = createGraph({ files: [node.filePath], callables: [node] });
  const insights = new CodeFlowInsightCache().get(graph);
  return buildFunctionTutorModel({ graph, declaration, functionLogic, architectureIndex: insights.functionArchitecture,
    semanticFlows: insights.semanticFlows, functionIndex: insights.functionIndex, readSourceText: async () => sourceText });
}
