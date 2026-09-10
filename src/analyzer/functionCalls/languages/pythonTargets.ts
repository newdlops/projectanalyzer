/** Python binding checks prevent builtin/library spellings from borrowing unrelated project identities. */
import { parser } from "@lezer/python";
import type { SyntaxNode } from "@lezer/common";
import { createLezerSource, getLezerChildren, lezerPositionOffset } from "../../core/lezerSource";
import type { FunctionLogicCallsite } from "../../functionLogic";
import { createPortableProjectPathNormalizer } from "../../../shared/portableProjectPath";
import type { EdgeConfidence, SymbolNode } from "../../../shared/types";

type Binding = { kind: "import"; module: string; member?: string }
  | { kind: "declaration"; node: SyntaxNode } | { kind: "dynamic" };
type Scope = Map<string, Binding>;

/**
 * Parses lexical bindings once. Inferred name-only matches need an in-scope
 * definition or matching import; exact/resolved graph receiver evidence survives.
 * This is a conservative filter, not an import loader or a Python interpreter.
 */
export function createPythonCallTargetFilter(sourceText: string, workspaceRoot: string, maxDepth = 128) {
  const source = createLezerSource(parser, sourceText);
  const paths = createPortableProjectPathNormalizer(workspaceRoot);
  const depthLimit = Math.max(1, Math.min(512, Math.floor(maxDepth) || 128));
  const scopeKey = (node: SyntaxNode) => `${node.name}:${node.from}:${node.to}`;
  const scopes = new Map<string, Scope>();
  const pending = [{ node: source.tree.topNode, scope: source.tree.topNode, depth: 0 }];
  const visited = new Set<string>();
  let incomplete = false;
  while (pending.length && visited.size < 100_000) {
    const entry = pending.pop()!;
    const key = scopeKey(entry.node);
    if (visited.has(key)) continue;
    visited.add(key);
    if (entry.depth > depthLimit) { incomplete = true; continue; }
    const children = getLezerChildren(entry.node);
    const scope = scopes.get(scopeKey(entry.scope)) ?? new Map<string, Binding>();
    scopes.set(scopeKey(entry.scope), scope);
    let childScope = entry.scope;
    if (["FunctionDefinition", "ClassDefinition"].includes(entry.node.name)) {
      const name = children.find(child => child.name === "VariableName");
      if (name) scope.set(sourceText.slice(name.from, name.to), { kind: "declaration", node: entry.node });
      childScope = entry.node;
    } else if (entry.node.name === "ImportStatement") {
      readImports(children, sourceText, scope);
    } else if (entry.node.name === "ParamList") {
      // Default values can also be VariableName nodes; only parameter names
      // introduce bindings (cb=persist must not shadow the global persist).
      let parameterStart = true;
      for (const child of children) {
        if (child.name === ",") parameterStart = true;
        else if (child.name === "VariableName" && parameterStart) {
          scope.set(sourceText.slice(child.from, child.to), { kind: "dynamic" });
          parameterStart = false;
        }
      }
    } else if (entry.node.name === "AssignStatement" && children[0]?.name === "VariableName") {
      scope.set(sourceText.slice(children[0].from, children[0].to), { kind: "dynamic" });
    }
    for (let index = children.length - 1; index >= 0; index -= 1) {
      pending.push({ node: children[index], scope: childScope, depth: entry.depth + 1 });
    }
  }
  incomplete ||= pending.length > 0;

  return (site: FunctionLogicCallsite, target: SymbolNode, confidence: EdgeConfidence): boolean => {
    const strong = confidence === "exact" || confidence === "resolved";
    // A truncated binding index cannot justify a name-only project connection.
    if (incomplete) return strong;
    const text = site.calleeText.replace(/\s+/gu, "");
    const head = text.match(/^[\p{L}_][\p{L}\p{N}_]*/u)?.[0];
    if (!head) return strong;
    const offset = lezerPositionOffset(source, { line: site.range.startLine, character: site.range.startCharacter });
    let node: SyntaxNode | null = source.tree.resolveInner(offset, 1);
    const owners = new Set<string>();
    let inFunction = false;
    let binding: Binding | undefined;
    while (node && owners.size < depthLimit) {
      const key = scopeKey(node);
      if (owners.has(key)) break;
      owners.add(key);
      // A method does not inherit class-body import/variable bindings as globals.
      if (!(node.name === "ClassDefinition" && inFunction)) binding = scopes.get(key)?.get(head);
      if (binding) break;
      inFunction ||= node.name === "FunctionDefinition";
      node = node.parent;
    }
    if (!binding) return strong;
    if (binding.kind === "dynamic") return strong;
    const targetPath = paths.normalize(target.filePath).key;
    if (binding.kind === "declaration") {
      if (targetPath !== paths.normalize(site.filePath).key) return false;
      const selection = lezerPositionOffset(source, { line: target.selectionRange.startLine, character: target.selectionRange.startCharacter });
      return selection >= binding.node.from && selection < binding.node.to;
    }
    // Even a graph match cannot turn `from requests import get` into an
    // unrelated project get(). Imported aliases retain their module ownership.
    if (binding.member && text === head && target.name !== binding.member
      && !(target.kind === "constructor" && target.qualifiedName.split(".").at(-2) === binding.member)) return false;
    const modules = [binding.module, ...(binding.member ? [`${binding.module}.${binding.member}`] : [])];
    return modules.some(module => matchesImportedModule(module, site.filePath, targetPath, paths));
  };
}

/** Reads only grammar-owned import tokens; comments, strings and unrelated scopes cannot add bindings. */
function readImports(children: SyntaxNode[], source: string, scope: Scope): void {
  const tokens = children.filter(child => child.name !== "Comment").map(child => source.slice(child.from, child.to));
  const importIndex = tokens.indexOf("import");
  if (importIndex < 0) return;
  const fromModule = tokens[0] === "from" ? tokens.slice(1, importIndex).join("") : undefined;
  const groups: string[][] = [[]];
  for (const token of tokens.slice(importIndex + 1)) {
    if (token === ",") groups.push([]);
    else if (!["(", ")"].includes(token)) groups.at(-1)!.push(token);
  }
  for (const group of groups) {
    const as = group.indexOf("as");
    const imported = group.slice(0, as < 0 ? undefined : as).join("");
    if (!imported || imported === "*") continue;
    const local = as < 0 ? (fromModule !== undefined ? imported : imported.split(".")[0]) : group[as + 1];
    if (local) scope.set(local, { kind: "import", module: fromModule ?? imported,
      ...(fromModule !== undefined ? { member: imported } : {}) });
  }
}

/** Matches relative imports and workspace source roots using portable, segment-boundary paths. */
function matchesImportedModule(module: string, callerPath: string, targetPath: string,
  paths: ReturnType<typeof createPortableProjectPathNormalizer>): boolean {
  const relativeDepth = module.match(/^\.+/u)?.[0].length ?? 0;
  const suffix = module.slice(relativeDepth).replace(/\./gu, "/");
  if (relativeDepth) {
    const directory = paths.normalize(callerPath).key.split("/").slice(0, -1).join("/");
    const base = paths.normalize(`${directory}/${"../".repeat(relativeDepth - 1)}${suffix}`).key;
    return targetPath === `${base}.py` || paths.contains(base, targetPath);
  }
  const modulePath = `/${suffix}`;
  return targetPath.endsWith(`${modulePath}.py`) || targetPath.includes(`${modulePath}/`);
}
