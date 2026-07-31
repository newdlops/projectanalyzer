/**
 * Browser-source tests for retained Function Search semantic states. The small
 * harness executes the generated controller without involving Explorer canvas.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { getFunctionSearchBrowserSource } from "../../webview/functionSearch";

test("query-limit failure refreshes from retained semantics without another search request", () => {
  let language: "en" | "ko" = "en";
  const messages: unknown[] = [];
  const state = {
    graph: { version: "sidebar-snapshot:1" },
    functionSearchLoading: false,
    functionSearchActive: false,
    functionSearchRevision: 0,
    functionSearchRequestSequence: 0,
    treeRowsCache: new Map<string, unknown>()
  } as Record<string, any>;
  const elements = {
    functionSearch: { setAttribute() {} },
    functionSearchInput: { value: "x".repeat(513), disabled: false },
    functionSearchSubmit: { disabled: false },
    functionSearchClear: { hidden: false },
    functionSearchMore: { hidden: false, disabled: false },
    functionSearchStatus: { textContent: "" }
  };
  const text = (key: string, params?: { count?: number }) => {
    if (key === "search-query-limit") {
      return language === "ko"
        ? `검색어는 최대 ${params?.count}자입니다.`
        : `Search query is limited to ${params?.count} characters.`;
    }
    return key;
  };
  const controller = Function(
    "state", "elements", "projectAnalyzerText", "isCurrentGraphVersion", "postRequest", "renderFunctionCallTree",
    `${getFunctionSearchBrowserSource()}\nreturn { requestFunctionSearch, renderFunctionSearchControls, refreshFunctionSearchLanguage };`
  )(
    state,
    elements,
    text,
    () => true,
    (type: string, payload: unknown) => messages.push({ type, payload }),
    () => {}
  ) as {
    requestFunctionSearch(): void;
    renderFunctionSearchControls(): void;
    refreshFunctionSearchLanguage(): void;
  };

  controller.requestFunctionSearch();
  controller.renderFunctionSearchControls();
  assert.deepEqual(state.functionSearchLocalError, {
    key: "search-query-limit",
    params: { count: 512 }
  });
  assert.equal(elements.functionSearchStatus.textContent, "Search query is limited to 512 characters.");
  assert.deepEqual(messages, []);

  language = "ko";
  controller.refreshFunctionSearchLanguage();
  assert.equal(elements.functionSearchStatus.textContent, "검색어는 최대 512자입니다.");
  assert.deepEqual(messages, []);
});
