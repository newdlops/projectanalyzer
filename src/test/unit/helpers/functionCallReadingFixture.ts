/** Real two-file graph fixtures and portable model replies for call-reading integration tests. */
import fs from "node:fs";
import path from "node:path";
import { TypeScriptAnalyzer } from "../../../analyzer/languages/typescript";
import { KotlinAnalyzer } from "../../../analyzer/languages/kotlin";
import { createContentHash } from "../../../shared/hash";
import type { ProjectGraph, SourceFile } from "../../../shared/types";
import type { FunctionNarrativeContext } from "../../../shared/functionNarratives";
import { getFunctionCallFixedInputs } from "../../../shared/functionCallNarratives";

/** Uses real parser symbol/edge extraction including cross-file resolution. */
export async function loadFunctionCallReadingFixture(language: "typescript" | "kotlin" = "typescript",
  transform?: (name: string, source: string) => string) {
  const extension = language === "kotlin" ? "kt" : "ts";
  const files: SourceFile[] = ["reading", "readingHelpers"].map(name => {
    const original = fs.readFileSync(path.resolve(__dirname, `../../../../src/test/fixtures/functionCalls/${name}.${extension}`), "utf8");
    const content = transform?.(name, original) ?? original;
    return { path: `/workspace/${name}.${extension}`, languageId: language, content, sizeBytes: Buffer.byteLength(content), contentHash: createContentHash(content) };
  });
  const analyzer = language === "kotlin" ? new KotlinAnalyzer() : new TypeScriptAnalyzer();
  const parsed = await Promise.all(files.map(file => analyzer.parse(file)));
  const nodes = (await Promise.all(parsed.map(file => analyzer.extractSymbols(file)))).flat();
  const edges = (await Promise.all(parsed.map(file => analyzer.extractEdges(file, { sourceFiles: files, workspaceRoot: "/workspace" })))).flat();
  const graph: ProjectGraph = { workspaceRoot: "/workspace", version: "1", generatedAt: "2026-10-06T00:00:00.000Z", nodes, edges,
    diagnostics: [], metadata: { languages: [language], fileCount: files.length, symbolCount: nodes.length, edgeCount: edges.length } };
  return { graph, files, root: nodes.find(node => node.name === "checkout")!, source: files[0].content };
}

/** This is an explicit external-model test double, not a claim about real model accuracy. */
export function functionCallReadingReply(context: FunctionNarrativeContext, language: "ko" | "en" = "en") {
  const ko = language === "ko", task = context.callTask!;
  return { modelName: "External model fixture", text: JSON.stringify({
    ...(task.includeSummary ? { summary: ko ? "선택한 호출 관계를 읽습니다." : "Read the selected source calls.", flow: ko ? "소스 조건에 따라 값을 전달하고 반환 구문을 읽습니다." : "Follow the source conditions, transfer arguments and read the return expression." } : {}),
    calls: task.targets.map(target => ({ callId: target.callId,
      role: ko ? "대상 함수가 원문의 계산을 담당합니다." : "The callee performs the supplied source calculation.",
      inputs: getFunctionCallFixedInputs(target,language)??(ko ? "호출 인자가 대상의 매개변수로 전달됩니다." : "Caller arguments bind to the callee parameters."),
      output: ko ? "소스의 반환식을 호출부에서 사용합니다." : "The caller uses the source return expression.",
      effects: ko ? "제공된 지역 계산 이외의 효과는 미확인입니다." : "Effects beyond the supplied local calculation are unknown.",
      reason: ko ? "선택한 소스 조건이 호출에 도달시킵니다." : "The selected source guards reach this call." })), limitations: []
  }) };
}
