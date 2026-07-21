/**
 * Code-snippet presentation tests protect exact-text tokenization, multi-
 * language coverage, CSP-safe browser mounting, and VS Code theme colors.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  getCodeSnippetBrowserSource,
  getCodeSnippetStyles,
  tokenizeCodeSnippet,
  type CodeSnippetToken
} from "../../webview/codePresentation";

test("tokenizes multiline TypeScript and JSX without changing one character", () => {
  const source = [
    "const view = ready ? <Ready title=\"safe\" /> : null;",
    "// retain the source line",
    "return render(view, 0x2a);"
  ].join("\n");
  const tokens = tokenizeCodeSnippet(source);

  assert.equal(joinTokens(tokens), source);
  assertToken(tokens, "keyword", "const");
  assertToken(tokens, "type", "Ready");
  assertToken(tokens, "string", "\"safe\"");
  assertToken(tokens, "literal", "null");
  assertToken(tokens, "comment", "// retain the source line");
  assertToken(tokens, "function", "render");
  assertToken(tokens, "number", "0x2a");
});

test("recognizes Python and functional-language strings, comments, and keywords", () => {
  const source = [
    "def build(value):",
    "    note = \"\"\"first",
    "second\"\"\"",
    "    return value  # visible note",
    "let mapped = source |> map (fun item -> item + 1) (* exact stage *)"
  ].join("\n");
  const tokens = tokenizeCodeSnippet(source);

  assert.equal(joinTokens(tokens), source);
  assertToken(tokens, "keyword", "def");
  assertToken(tokens, "keyword", "return");
  assertToken(tokens, "string", "\"\"\"first\nsecond\"\"\"");
  assertToken(tokens, "comment", "# visible note");
  assertToken(tokens, "comment", "(* exact stage *)");
  assertToken(tokens, "operator", "|>");
});

test("browser mounting creates only textContent-backed spans for hostile-looking code", () => {
  const browserSource = getCodeSnippetBrowserSource();
  const created: FakeElement[] = [];
  const fakeDocument = {
    createElement(tagName: string): FakeElement {
      const element = createFakeElement(tagName);
      created.push(element);
      return element;
    }
  };
  const runtime = new Function(
    "document",
    `${browserSource}\nreturn { mountCodeSnippet, tokenizeCodeSnippet };`
  )(fakeDocument) as {
    mountCodeSnippet(element: FakeElement, value: string): void;
    tokenizeCodeSnippet(value: string): CodeSnippetToken[];
  };
  const target = createFakeElement("strong");
  const source = "<img src=x onerror=run()>\nreturn \"safe\";";

  runtime.mountCodeSnippet(target, source);

  assert.equal(joinTokens(runtime.tokenizeCodeSnippet(source)), source);
  assert.equal(readFakeText(target), source);
  assert.ok(target.classes.has("code-snippet"));
  assert.ok(created.every((element) => element.tagName === "span"));
  assert.doesNotMatch(browserSource, /innerHTML|outerHTML|insertAdjacentHTML/u);
  assert.doesNotThrow(() => new Function(browserSource));
});

test("theme styles preserve physical lines and expose distinct token classes", () => {
  const styles = getCodeSnippetStyles();

  assert.match(styles, /\.code-snippet,[\s\S]*white-space: pre-wrap/u);
  assert.match(styles, /\.code-snippet-keyword[\s\S]*symbolIcon-keywordForeground/u);
  assert.match(styles, /\.code-snippet-string[\s\S]*symbolIcon-stringForeground/u);
  assert.match(styles, /\.code-snippet-comment[\s\S]*editorLineNumber-foreground/u);
  assert.match(styles, /\.code-snippet-function[\s\S]*symbolIcon-functionForeground/u);
});

/** Finds one exact token so accidental broad token merging is visible. */
function assertToken(
  tokens: readonly CodeSnippetToken[],
  kind: CodeSnippetToken["kind"],
  text: string
): void {
  assert.ok(
    tokens.some((token) => token.kind === kind && token.text === text),
    `missing ${kind} token ${JSON.stringify(text)} in ${JSON.stringify(tokens)}`
  );
}

/** Reconstructs the source contract required by every tokenizer path. */
function joinTokens(tokens: readonly CodeSnippetToken[]): string {
  return tokens.map((token) => token.text).join("");
}

/** Minimal DOM node used to prove mounting never asks for an HTML parser. */
type FakeElement = {
  tagName: string;
  className: string;
  classes: Set<string>;
  textContent: string;
  children: FakeElement[];
  classList: { add(...names: string[]): void };
  append(...children: FakeElement[]): void;
  replaceChildren(...children: FakeElement[]): void;
};

/** Creates one append-only fake element with the browser methods under test. */
function createFakeElement(tagName: string): FakeElement {
  const classes = new Set<string>();
  const children: FakeElement[] = [];
  return {
    tagName,
    className: "",
    classes,
    textContent: "",
    children,
    classList: {
      add(...names: string[]) {
        for (const name of names) classes.add(name);
      }
    },
    append(...nextChildren) {
      children.push(...nextChildren);
    },
    replaceChildren(...nextChildren) {
      children.splice(0, children.length, ...nextChildren);
    }
  };
}

/** Mirrors the browser textContent getter across the test-only fake tree. */
function readFakeText(element: FakeElement): string {
  return element.textContent + element.children.map(readFakeText).join("");
}
