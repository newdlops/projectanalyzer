/** Contract tests for finite browser localization descriptor inventories. */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";
import { getBrowserLocalizationSource } from "../../localization/browserCatalog";
import {
  FUNCTION_LOGIC_GAP_PRESENTATION_KEYS,
  CODE_FLOW_PRESENTATION_KEYS,
  FUNCTION_LOGIC_BLOCK_PRESENTATION_KEYS,
  FUNCTION_LOGIC_BROWSER_PRESENTATION_KEYS,
  FUNCTION_LOGIC_EDGE_PRESENTATION_KEYS,
  FUNCTION_LOGIC_SCENARIO_PRESENTATION_KEYS,
  FUNCTION_SEARCH_PRESENTATION_KEYS,
  MODULE_FLOW_PRESENTATION_KEYS,
  FUNCTION_TUTOR_FACT_PRESENTATION_KEYS,
  FUNCTION_TUTOR_GAP_PRESENTATION_KEYS,
  FUNCTION_TUTOR_SEMANTIC_PRESENTATION_KEYS
} from "../../localization/presentationDescriptors";

/** Executes the generated browser script against the smallest DOM surface it needs. */
function createBrowserRuntime(language: "en" | "ko") {
  const document = {
    body: undefined,
    documentElement: { lang: language },
    querySelectorAll: () => []
  };
  return Function(
    "document",
    `${getBrowserLocalizationSource()}\nreturn { projectAnalyzerUiCopy, projectAnalyzerText };`
  )(document) as {
    projectAnalyzerText: (key: string, values?: Record<string, string | number | boolean>) => string;
    projectAnalyzerUiCopy: Record<"en" | "ko", Record<string, string>>;
  };
}

/** Reads the manifest/NLS resources as VS Code does, without a second localization system. */
function readPackageLocalization(): {
  manifest: Record<string, unknown>;
  english: Record<string, string>;
  korean: Record<string, string>;
} {
  const root = process.cwd();
  return {
    manifest: JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as Record<string, unknown>,
    english: JSON.parse(readFileSync(resolve(root, "package.nls.json"), "utf8")) as Record<string, string>,
    korean: JSON.parse(readFileSync(resolve(root, "package.nls.ko.json"), "utf8")) as Record<string, string>
  };
}

/** Collects literal browser catalog references from active Webview source only. */
function readActiveWebviewLocalizationKeys(): Set<string> {
  const keys = new Set<string>();
  const root = resolve(process.cwd(), "src/webview");
  const pending = [root];
  while (pending.length > 0) {
    const directory = pending.pop();
    if (!directory) continue;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        pending.push(path);
      } else if (entry.isFile() && entry.name.endsWith(".ts")) {
        const source = readFileSync(path, "utf8");
        for (const match of source.matchAll(/projectAnalyzerText\(\s*["']([^"']+)["']\s*(?:,|\))/gu)) keys.add(match[1]);
        for (const match of source.matchAll(/\bdata-i18n(?:-[\w-]+)?=["']([^"']+)["']/gu)) keys.add(match[1]);
      }
    }
  }
  return keys;
}

/** Returns named interpolation slots, excluding escaped literal braces. */
function interpolationNames(value: string): string[] {
  return [...value.matchAll(/(?<!\{)\{([A-Za-z][A-Za-z0-9_-]*)\}(?!\})/gu)]
    .map((match) => match[1])
    .sort();
}

/** Extracts one `%nls.key%` placeholder and rejects direct user-visible manifest copy. */
function requireNlsPlaceholder(value: unknown): string {
  assert.equal(typeof value, "string");
  const match = /^%(.+)%$/u.exec(String(value));
  assert.ok(match, `expected NLS placeholder, received ${String(value)}`);
  return match[1];
}

test("ships every finite Function Logic and Tutor descriptor in both browser locales", () => {
  const catalog = createBrowserRuntime("en").projectAnalyzerUiCopy;
  const descriptorKeys = [
    ...FUNCTION_LOGIC_GAP_PRESENTATION_KEYS,
    ...CODE_FLOW_PRESENTATION_KEYS,
    ...FUNCTION_SEARCH_PRESENTATION_KEYS,
    ...FUNCTION_LOGIC_BLOCK_PRESENTATION_KEYS,
    ...FUNCTION_LOGIC_BROWSER_PRESENTATION_KEYS,
    ...FUNCTION_LOGIC_EDGE_PRESENTATION_KEYS,
    ...FUNCTION_LOGIC_SCENARIO_PRESENTATION_KEYS,
    ...MODULE_FLOW_PRESENTATION_KEYS,
    ...FUNCTION_TUTOR_GAP_PRESENTATION_KEYS,
    ...FUNCTION_TUTOR_FACT_PRESENTATION_KEYS,
    ...FUNCTION_TUTOR_SEMANTIC_PRESENTATION_KEYS
  ];
  for (const key of descriptorKeys) {
    assert.equal(typeof catalog.en[key], "string", `${key} must be present in English`);
    assert.equal(typeof catalog.ko[key], "string", `${key} must be present in Korean`);
  }
});

test("localizes every Project Analyzer manifest contribution with parity across NLS files", () => {
  const { manifest, english, korean } = readPackageLocalization();
  assert.deepEqual(Object.keys(english).sort(), Object.keys(korean).sort());
  const contributes = manifest.contributes as {
    viewsContainers: { activitybar: Array<Record<string, unknown>> };
    views: Record<string, Array<Record<string, unknown>>>;
    commands: Array<Record<string, unknown>>;
    configuration: { title: unknown; properties: Record<string, { description: unknown; enumDescriptions?: unknown[] }> };
  };
  const values: unknown[] = [manifest.displayName, manifest.description, contributes.configuration.title];
  for (const container of contributes.viewsContainers.activitybar) values.push(container.title);
  for (const views of Object.values(contributes.views)) for (const view of views) values.push(view.name);
  for (const command of contributes.commands) values.push(command.title, command.category);
  for (const property of Object.values(contributes.configuration.properties)) {
    values.push(property.description, ...(property.enumDescriptions || []));
  }
  for (const value of values) {
    const key = requireNlsPlaceholder(value);
    assert.equal(typeof english[key], "string", `${key} must resolve in English`);
    assert.equal(typeof korean[key], "string", `${key} must resolve in Korean`);
  }
});

test("browser formatter interpolates bounded descriptor values without changing literal parameters", () => {
  const englishRuntime = createBrowserRuntime("en");
  const koreanRuntime = createBrowserRuntime("ko");
  const english = englishRuntime.projectAnalyzerText;
  const korean = koreanRuntime.projectAnalyzerText;
  const literalDetail = "src/components/Panel.ts:42";
  assert.equal(
    english("logic-gap-statement-limit", { count: 2, limit: 48 }),
    "2 additional statements were omitted after the 48-block reading limit."
  );
  assert.equal(english("render-failed", { detail: literalDetail }), `Render failed: ${literalDetail}`);
  assert.equal(english("graph-project-root"), "Project Root");
  assert.equal(korean("graph-project-root"), "프로젝트 루트");
  assert.equal(english("graph-empty-analyze"), "Analyze to render graph");
  assert.equal(korean("graph-empty-analyze"), "그래프를 렌더링하려면 분석하세요");
  assert.equal(english("graph-projection-bounded", { loaded: 5, total: 12 }), "Loaded 5 of 12 nodes · expand or focus to inspect another bounded slice");
  assert.equal(korean("graph-projection-bounded", { loaded: 5, total: 12 }), "노드 12개 중 5개를 불러왔습니다 · 다른 범위 제한 조각을 보려면 확장하거나 포커스하세요");
  assert.match(korean("logic-gap-statement-limit", { count: 2, limit: 48 }), /2/u);
  assert.equal(english("logic-gap-statement-limit", { count: 2 }), "2 additional statements were omitted after the -block reading limit.");
  assert.equal(english("tutor-label-owner", { kind: english("tutor-label-owner-class"), name: "CartService" }), "Class: CartService");
  assert.equal(korean("tutor-label-owner", { kind: korean("tutor-label-owner-class"), name: "CartService" }), "클래스: CartService");
  assert.equal(english("tutor-seed-callsite", { ordinal: 2 }), "Callsite example 2");
  assert.equal(korean("tutor-seed-callsite", { ordinal: 2 }), "호출 지점 예제 2");
  assert.equal(english("tutor-overview-internal-shape", { decisions: 2, loops: 1, changes: 3 }), "2 decisions · 1 loops · 3 value changes");
  assert.equal(korean("tutor-terminal-exit"), "종료");
  assert.equal(english("logic-block-label-condition", { source: "amount >= 100" }), "Condition: amount >= 100");
  assert.equal(korean("logic-block-label-condition", { source: "amount >= 100" }), "조건: amount >= 100");
  assert.equal(korean("logic-block-detail-embedded", { source: "eval(code)" }), "이 포함 코드 경계는 정적으로 설명됩니다.");
  assert.equal(english("logic-edge-defines"), "defined body; not invoked");
  assert.equal(korean("logic-edge-deferred"), "별도로 예약됨");
  assert.equal(english("logic-edge-else-if"), "else if");
  assert.equal(korean("logic-edge-default"), "기본값");
  assert.equal(english("logic-edge-case", { source: "order.status" }), "case order.status");
  assert.equal(korean("logic-edge-catch", { name: "error" }), "catch error");
  assert.equal(english("logic-edge-elif", { source: "value > 0" }), "else if value > 0");
  assert.equal(korean("logic-edge-case", { source: "READY" }), "경우 READY");
  assert.equal(english("logic-edge-synchronized"), "synchronized body");
  assert.equal(korean("logic-edge-each", { source: "item" }), "각 item");
  assert.equal(english("scenario-reason-unsupported-token", { token: "@" }), "unsupported token @");
  assert.equal(korean("scenario-reason-unsupported-token", { token: "@" }), "지원하지 않는 토큰 @");
  assert.equal(english("scenario-reason-member-unavailable", { member: "toString" }), "member toString is unavailable");
  assert.equal(korean("scenario-reason-member-unavailable", { member: "toString" }), "멤버 toString을(를) 사용할 수 없음");
  assert.equal(english("scenario-reason-object-prototype", { key: "__proto__" }), "prototype-sensitive field is not writable");
  assert.equal(korean("scenario-reason-object-prototype", { key: "__proto__" }), "프로토타입 민감 필드에는 쓸 수 없음");
  assert.equal(english("scenario-trace-selection", { kind: "PARAM", name: "total", input: "input 4", current: "current 6", steps: "2 steps" }), "PARAM total · input 4 · current 6 · 2 steps");
  assert.equal(korean("scenario-trace-selection", { kind: "매개변수", name: "total", input: "입력 4", current: "현재 6", steps: "단계 2개" }), "매개변수 total · 입력 4 · 현재 6 · 단계 2개");
  assert.equal(english("edge-calls", { label: "Child.load" }), "calls Child.load");
  assert.equal(korean("edge-calls", { label: "Child.load" }), "Child.load 호출");
  assert.equal(english("logic-aria-none"), "none");
  assert.equal(korean("logic-aria-none"), "없음");
  englishRuntime.projectAnalyzerUiCopy.en["empty-browser-copy"] = "";
  koreanRuntime.projectAnalyzerUiCopy.ko["empty-browser-copy"] = "";
  assert.equal(english("empty-browser-copy"), "");
  assert.equal(korean("empty-browser-copy"), "");
  assert.equal(korean("missing-browser-copy"), "missing-browser-copy");
  assert.equal(english("resume", { label: "caller();" }), "Resume · caller();");
  assert.match(korean("resume", { label: "caller();" }), /caller\(\);/u);
  assert.equal(english("module-relation-calls", { count: 2 }), "2 calls");
  assert.equal(korean("module-relation-calls", { count: 2 }), "호출 2개");
  assert.equal(english("logic-edge-case", { source: "READY" }), "case READY");
  assert.equal(korean("logic-edge-case", { source: "READY" }), "경우 READY");
  assert.equal(english("module-cycle-self"), "Self cycle");
  assert.equal(korean("module-cycle-self"), "자체 순환");
  assert.equal(english("module-cycle-group", { count: 3 }), "Cycle · 3 nodes");
  assert.equal(korean("module-cycle-group", { count: 3 }), "순환 · 노드 3개");
});

test("Function Logic browser-owned confidence and transfer copy has Korean descriptor output", () => {
  const runtime = createBrowserRuntime("ko");

  assert.equal(runtime.projectAnalyzerText("logic-confidence-inferred"), "추론");
  assert.equal(runtime.projectAnalyzerText("logic-target-transfer", { target: "handler" }), " → handler");
  assert.equal(runtime.projectAnalyzerText("value-preview-binding-title", {
    role: "매개변수", name: "order", mode: runtime.projectAnalyzerText("value-preview-flow")
  }), "매개변수 order 강조 · 값 흐름");
});

test("browser catalogs expose exactly the same English and Korean key set", () => {
  const runtime = createBrowserRuntime("en");
  assert.deepEqual(
    Object.keys(runtime.projectAnalyzerUiCopy.en).sort(),
    Object.keys(runtime.projectAnalyzerUiCopy.ko).sort()
  );
});

test("browser catalog translations keep exact interpolation parameter parity", () => {
  const catalog = createBrowserRuntime("en").projectAnalyzerUiCopy;
  for (const key of Object.keys(catalog.en)) {
    assert.deepEqual(
      interpolationNames(catalog.en[key]),
      interpolationNames(catalog.ko[key]),
      `${key} must expose the same interpolation names in both locales`
    );
  }
});

test("active Webview literal localization references resolve in both browser catalogs", () => {
  const catalog = createBrowserRuntime("en").projectAnalyzerUiCopy;
  for (const key of readActiveWebviewLocalizationKeys()) {
    assert.equal(typeof catalog.en[key], "string", `${key} must resolve in English`);
    assert.equal(typeof catalog.ko[key], "string", `${key} must resolve in Korean`);
  }
});

test("package NLS translations keep exact interpolation parameter parity", () => {
  const { english, korean } = readPackageLocalization();
  for (const key of Object.keys(english)) {
    assert.deepEqual(
      interpolationNames(english[key]),
      interpolationNames(korean[key]),
      `${key} must expose the same interpolation names in both package locales`
    );
  }
});
