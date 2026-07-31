/** Unit coverage for the single Project Analyzer UI language preference. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { localizeHost, resolveUiLanguage } from "../../localization/uiLanguage";

test("resolves explicit UI language preferences before VS Code locale", () => {
  assert.equal(resolveUiLanguage("ko", "en-US"), "ko");
  assert.equal(resolveUiLanguage("en", "ko-KR"), "en");
});

test("uses Korean only for auto Korean VS Code display locales", () => {
  assert.equal(resolveUiLanguage("auto", "ko"), "ko");
  assert.equal(resolveUiLanguage("auto", "ko-KR"), "ko");
  assert.equal(resolveUiLanguage("auto", "fr-FR"), "en");
  assert.equal(resolveUiLanguage(undefined, undefined), "en");
  assert.equal(resolveUiLanguage("malformed", "en-US"), "en");
});

test("retains semantic sidebar status and re-emits only language plus localized status", () => {
  const provider = readFileSync(
    resolve(process.cwd(), "src/webview/explorerViewProvider.ts"),
    "utf8"
  );
  const start = provider.indexOf("public async updateUiLanguage");
  const end = provider.indexOf("/**\n   * Routes a GUI analysis request", start);
  const updateSource = provider.slice(start, end);

  assert.equal(localizeHost("en", "analyzingCurrentFile"), "Analyzing current file");
  assert.equal(localizeHost("ko", "analyzingCurrentFile"), "현재 파일 분석 중");
  assert.equal(localizeHost("en", "explorerView"), "Understand Code");
  assert.equal(localizeHost("ko", "explorerView"), "코드 이해");
  assert.equal(localizeHost("en", "showingCallers", { name: "Cart.load", count: 2, depth: 1 }), "Showing callers for Cart.load (2 call edges, depth 1)");
  assert.equal(localizeHost("ko", "showingCallers", { name: "Cart.load", count: 2, depth: 1 }), "Cart.load의 호출자 표시 중 (호출 간선 2개, 깊이 1)");
  assert.match(updateSource, /type: "ui\/language"/u);
  assert.match(updateSource, /this\.view\.title = localizeHost\(language, "explorerView"\)/u);
  assert.match(updateSource, /this\.semanticStatus\) await this\.postStatus/u);
  assert.doesNotMatch(updateSource, /runAnalysis|publishGraph|clear\(|select|resolveWorkspaceGraph/u);
});

test("owns only the matching resolved sidebar view through disposal", () => {
  const provider = readFileSync(
    resolve(process.cwd(), "src/webview/explorerViewProvider.ts"),
    "utf8"
  );
  const start = provider.indexOf("public resolveWebviewView");
  const end = provider.indexOf("/**\n   * Sends graph availability", start);
  const resolveSource = provider.slice(start, end);

  assert.match(resolveSource, /webviewView\.title = localizeHost\(this\.uiLanguage, "explorerView"\)/u);
  assert.match(resolveSource, /webviewView\.onDidDispose/u);
  assert.match(resolveSource, /if \(this\.view === webviewView\)/u);
  assert.match(resolveSource, /this\.view = undefined/u);
  assert.match(resolveSource, /this\.webviewReady = false/u);
});

test("export action keeps save copy localized and its result locale-neutral", () => {
  const source = readFileSync(resolve(process.cwd(), "src/webview/webviewHostActions.ts"), "utf8");
  assert.match(source, /saveLabel: localizeHost\(language, "exportGraph"\)/u);
  assert.match(source, /Promise<\{ nodeCount: number \} \| undefined>/u);
  assert.match(source, /return \{ nodeCount: graph\.nodes\.length \}/u);
  assert.doesNotMatch(source, /Exported \$\{/u);
});
