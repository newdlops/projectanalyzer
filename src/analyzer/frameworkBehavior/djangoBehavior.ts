/** Django syntax adapter: import-owned request hooks, ORM phases and response contracts. */
import { parser } from "@lezer/python";
import type { SyntaxNode } from "@lezer/common";
import { createLezerSource, getLezerChildren, lezerNodeRange, type LezerSource } from "../core/lezerSource";
import type { FrameworkBehaviorKind, FrameworkBehaviorPhase } from "../../shared/frameworkBehavior";
import { containsPosition, createFrameworkFactCollector } from "./support";
import type { FrameworkBehaviorInput, FunctionFrameworkBehavior } from "./types";

const LAZY = new Set(["all", "filter", "exclude", "order_by", "values", "values_list", "select_related", "prefetch_related", "annotate", "distinct", "only", "defer", "using"]);
const READ = new Set(["get", "aget", "first", "afirst", "last", "alast", "count", "acount", "exists", "aexists", "aggregate", "aaggregate", "in_bulk"]);
const WRITE = new Set(["create", "acreate", "update", "aupdate", "delete", "adelete", "get_or_create", "update_or_create", "bulk_create", "bulk_update"]);
const ASYNC_OPERATIONS = new Set(["aget", "afirst", "alast", "acount", "aexists", "aaggregate", "acreate", "aupdate", "adelete", "asave"]);

/** Reads evidence from the selected Python scope; lookalike method names stay unclassified. */
export function analyzeDjangoBehavior(input: FrameworkBehaviorInput): FunctionFrameworkBehavior | undefined {
  const source = createLezerSource(parser, input.sourceText!);
  const collector = createFrameworkFactCollector(input, "django");
  const depth = Math.max(1, Math.min(100, input.maxDepth ?? 40));
  const limit = () => { collector.result.limited = true; };
  const all = walk(source.tree.topNode, depth, limit);
  if (all.some((node) => node.type.isError)) return undefined;
  const position = input.functionNode.selectionRange ?? input.functionNode.range;
  const selected = all.filter((node) => node.name === "FunctionDefinition"
    && containsPosition(lezerNodeRange(source, node), position.startLine, position.startCharacter))
    .sort((left, right) => (left.to - left.from) - (right.to - right.from))[0];
  if (!selected) return undefined;
  const text = (node: SyntaxNode) => source.text.slice(node.from, node.to);
  const imports = readImports(source);
  const body = getLezerChildren(selected).find((node) => node.name === "Body");
  if (!body) return undefined;
  const local = walk(body, depth, limit, true);
  const shadowed = new Set<string>();
  const assignments = new Map<string, number>();
  for (const name of readImports(source, local).keys()) shadowed.add(name);
  const parameters = getLezerChildren(selected).find((node) => node.name === "ParamList");
  if (parameters) for (const node of getLezerChildren(parameters)) if (node.name === "VariableName") shadowed.add(text(node));
  for (const node of local) {
    for (const target of bindingTargets(node)) {
      const name = text(target); shadowed.add(name); assignments.set(name, (assignments.get(name) ?? 0) + 1);
    }
    if (node.name === "FunctionDefinition" || node.name === "ClassDefinition") {
      const name = getLezerChildren(node).find((child) => child.name === "VariableName");
      if (name) shadowed.add(text(name));
    }
  }
  // Enclosing Python function bindings also shadow globals inside a closure;
  // class attributes do not become lexical names in a method body.
  const ancestors = new Set<string>();
  let parent = selected.parent;
  while (parent && ancestors.size < depth) {
    const key = `${parent.name}:${parent.from}:${parent.to}`;
    if (ancestors.has(key)) break;
    ancestors.add(key);
    if (parent.name === "FunctionDefinition") {
      const children = getLezerChildren(parent);
      const params = children.find((node) => node.name === "ParamList");
      if (params) for (const node of getLezerChildren(params)) if (node.name === "VariableName") shadowed.add(text(node));
      const scope = children.find((node) => node.name === "Body");
      if (scope) for (const node of walk(scope, depth, limit, true)) {
        for (const name of bindingTargets(node)) shadowed.add(text(name));
        if (node.name === "ImportStatement") for (const name of readImports(source, [node]).keys()) shadowed.add(name);
      }
    }
    parent = parent.parent;
  }
  const resolve = (name: string, allowShadow = false) => {
    const [root, ...members] = name.split(".");
    const imported = allowShadow || !shadowed.has(root) ? imports.get(root) : undefined;
    return imported ? [imported, ...members].join(".") : undefined;
  };
  const models = new Set<string>();
  for (const [localName, imported] of imports) {
    if (shadowed.has(localName)) continue;
    const member = imported.split(".").at(-1);
    const module = imported.slice(0, -(member?.length ?? 0) - 1);
    if (input.units?.some((unit) => unit.framework.toLowerCase() === "django" && unit.kind === "model"
      && (unit.name === member || unit.qualifiedName?.split(".").at(-1) === member)
      && moduleMatchesFile(module, input.functionNode.filePath, unit.filePath))) models.add(localName);
  }
  for (const node of getLezerChildren(source.tree.topNode)) {
    if (node.name !== "ClassDefinition") continue;
    const children = getLezerChildren(node);
    const name = children.find((child) => child.name === "VariableName");
    const bases = children.find((child) => child.name === "ArgList");
    if (name && bases && !shadowed.has(text(name)) && getLezerChildren(bases).some((base) => resolve(text(base)) === "django.db.models.Model")) models.add(text(name));
  }
  const unit = input.units?.find((item) => item.framework.toLowerCase() === "django"
    && item.filePath === input.functionNode.filePath && item.range
    && containsPosition(item.range, position.startLine, position.startCharacter)
    && ["view", "route", "controller", "middleware"].includes(item.kind));
  const selectedName = getLezerChildren(selected).find((node) => node.name === "VariableName");
  const classMethod = selected.parent?.parent?.name === "ClassDefinition" && selectedName
    && ["get", "post", "put", "patch", "delete", "head", "options", "trace", "dispatch"].includes(text(selectedName));
  if (unit && (unit.name === (selectedName && text(selectedName)) || classMethod)) {
    const middleware = unit.kind === "middleware";
    collector.result.role = middleware ? "middleware" : "view";
    add(middleware ? "django-middleware" : "django-view", "request", unit.name, selected, "inferred");
  }
  const decorators = selected.parent?.name === "DecoratedStatement"
    ? getLezerChildren(selected.parent).filter((node) => node.name === "Decorator") : [];
  for (const decorator of decorators) {
    const name = text(decorator).trim().match(/^@([\w.]+)/u)?.[1];
    const resolved = name ? resolve(name, true) : undefined;
    if (!resolved) continue;
    if (resolved === "django.dispatch.receiver") {
      collector.result.role = "signal";
      add("django-signal", "registration", text(decorator), decorator);
    } else if (/^django\.views\.decorators\.http\.require_(?:GET|POST|safe|http_methods)$/u.test(resolved)) {
      add("django-method", "request", text(decorator), decorator);
    } else if (resolved === "django.contrib.auth.decorators.login_required") add("django-auth", "request", text(decorator), decorator);
    else if (resolved === "django.db.transaction.atomic") add("django-atomic", "request", text(decorator), decorator);
  }
  // A query alias is accepted only when assigned once; ambiguous reassignments
  // would otherwise make a later `count()` look like a proven ORM receiver.
  const queries = new Set<string>();
  const instances = new Set<string>();
  for (const node of local) {
    if (node.name === "AssignStatement" && node.firstChild?.name === "VariableName") {
      const children = getLezerChildren(node);
      const value = children.find((child) => child.name === "CallExpression");
      const target = text(node.firstChild);
      if (value && assignments.get(target) === 1) {
        const chain = callChain(value, source);
        if (isQueryChain(chain) && LAZY.has(chain.at(-1)!)) queries.add(target);
        else if ((chain.length === 1 && models.has(chain[0])) || (isQueryChain(chain) && ["get", "first", "last"].includes(chain.at(-1)!))) instances.add(target);
      }
    }
    if (node.name === "ForStatement") {
      const children = getLezerChildren(node);
      const iterable = children[children.findIndex((child) => child.name === "in") + 1];
      if (iterable?.name === "VariableName" && queries.has(text(iterable))) add("django-query-read", "query", text(iterable), iterable, "inferred");
    }
    if (node.name !== "CallExpression") continue;
    const callee = node.firstChild;
    if (!callee) continue;
    const resolved = resolve(text(callee));
    if (resolved === "django.db.transaction.atomic" && node.parent?.name === "WithStatement") add("django-atomic", "request", text(node), node);
    else if (resolved === "django.db.transaction.on_commit") add("django-commit", "query", text(node), node);
    else if (resolved === "django.shortcuts.render") add("django-render", "response", text(node), node);
    else if (resolved === "django.shortcuts.redirect") add("django-redirect", "response", text(node), node);
    else if (resolved && /^django\.http\.(?:JsonResponse|HttpResponse|StreamingHttpResponse|HttpResponseRedirect|HttpResponseNotFound|HttpResponseBadRequest)$/u.test(resolved)) add("django-response", "response", text(node), node);
    const chain = callChain(node, source);
    const method = chain.at(-1);
    // Creating a coroutine does not perform the ORM operation. Deferred awaits
    // through variables/tasks require data-flow proof outside this adapter.
    if (method && ASYNC_OPERATIONS.has(method) && node.parent?.name !== "AwaitExpression") continue;
    if (method && isQueryChain(chain)) {
      const kind = LAZY.has(method) ? "django-query-lazy" : READ.has(method) ? "django-query-read" : WRITE.has(method) ? "django-query-write" : undefined;
      if (kind) add(kind, "query", text(node), node, "inferred");
    }
    if (chain.length === 2 && instances.has(chain[0]) && ["save", "asave", "delete", "adelete"].includes(method!)) add("django-query-write", "query", text(node), node, "inferred");
    if (callee.name === "VariableName" && ["list", "tuple", "len", "bool"].includes(text(callee)) && !shadowed.has(text(callee))) {
      const args = getLezerChildren(node).find((child) => child.name === "ArgList");
      const value = args && getLezerChildren(args).find((child) => child.name === "VariableName");
      if (value && queries.has(text(value))) add("django-query-read", "query", text(node), node, "inferred");
    }
  }
  return collector.result.facts.length ? collector.result : undefined;

  /** Only manager/model ownership or a single-assignment query alias is evidence. */
  function isQueryChain(chain: string[]): boolean {
    if (queries.has(chain[0])) return chain.slice(1, -1).every((name) => LAZY.has(name));
    return models.has(chain[0]) && chain[1] === "objects" && chain.slice(2, -1).every((name) => LAZY.has(name));
  }
  function add(kind: FrameworkBehaviorKind, phase: FrameworkBehaviorPhase, subject: string, node: SyntaxNode, confidence: "exact" | "inferred" = "exact") {
    collector.add({ kind, phase, subject, confidence, range: lezerNodeRange(source, node) });
  }
}

/** Visits bounded syntax once, excluding nested callable bodies from the current scope. */
function walk(root: SyntaxNode, maxDepth: number, onLimit: () => void, skipScopes = false): SyntaxNode[] {
  const pending = [{ node: root, depth: 0 }];
  const seen = new Set<string>();
  const result: SyntaxNode[] = [];
  while (pending.length && result.length < 30_000) {
    const current = pending.pop()!;
    const key = `${current.node.name}:${current.node.from}:${current.node.to}`;
    if (seen.has(key)) continue;
    seen.add(key); result.push(current.node);
    if (skipScopes && ["FunctionDefinition", "ClassDefinition", "LambdaExpression"].includes(current.node.name)) continue;
    if (current.depth >= maxDepth) { onLimit(); continue; }
    const children = getLezerChildren(current.node);
    for (let index = children.length - 1; index >= 0; index -= 1) pending.push({ node: children[index], depth: current.depth + 1 });
  }
  if (pending.length) onLimit();
  return result;
}

/** Parses only real module-level import statements, so comments and strings cannot match. */
function readImports(source: LezerSource, nodes = getLezerChildren(source.tree.topNode)): Map<string, string> {
  const imports = new Map<string, string>();
  for (const node of nodes) {
    for (const name of bindingTargets(node)) imports.delete(source.text.slice(name.from, name.to));
    if (node.name !== "ImportStatement") continue;
    const statement = source.text.slice(node.from, node.to).replace(/[()\n\r]/gu, " ").trim();
    const from = statement.match(/^from\s+([\w.]+)\s+import\s+(.+)$/u);
    const plain = statement.match(/^import\s+(.+)$/u);
    for (const part of (from?.[2] ?? plain?.[1] ?? "").split(",")) {
      const match = part.trim().match(/^([\w.]+)(?:\s+as\s+(\w+))?$/u);
      if (!match) continue;
      const qualified = from ? from[1] + "." + match[1] : match[1];
      imports.set(match[2] ?? (from ? match[1] : match[1].split(".")[0]), !from && !match[2] ? match[1].split(".")[0] : qualified);
    }
  }
  for (const node of nodes) {
    if ((node.name === "AssignStatement" || node.name === "FunctionDefinition" || node.name === "ClassDefinition") && node.firstChild) {
      const name = node.name === "AssignStatement" ? node.firstChild : getLezerChildren(node).find((child) => child.name === "VariableName");
      if (name?.name === "VariableName") imports.delete(source.text.slice(name.from, name.to));
    }
  }
  return imports;
}

/** Conservative binding extraction covers destructuring, loop, exception and with targets. */
function bindingTargets(node: SyntaxNode): SyntaxNode[] {
  const children = getLezerChildren(node);
  const roots: SyntaxNode[] = [];
  if (["AssignStatement", "UpdateStatement", "NamedExpression"].includes(node.name)) {
    const end = children.findIndex((child) => child.name === "AssignOp" || child.name === "UpdateOp" || child.name === ":=");
    if (end >= 0) roots.push(...children.slice(0, end));
  } else if (node.name === "ForStatement") {
    const end = children.findIndex((child) => child.name === "in");
    if (end >= 0) roots.push(...children.slice(1, end));
  }
  if (["WithStatement", "TryStatement"].includes(node.name)) {
    for (let index = 0; index < children.length - 1; index += 1) if (children[index].name === "as") roots.push(children[index + 1]);
  }
  const result: SyntaxNode[] = [];
  const seen = new Set<string>();
  while (roots.length) {
    const target = roots.pop()!;
    const key = `${target.from}:${target.to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (target.name === "VariableName") result.push(target);
    else if (["TupleExpression", "ArrayExpression", "ParenthesizedExpression"].includes(target.name)) roots.push(...getLezerChildren(target));
  }
  return result;
}

/** Unwraps receiver chains without entering arguments or accepting computed attributes. */
function callChain(root: SyntaxNode, source: LezerSource): string[] {
  const members: string[] = [];
  const seen = new Set<string>();
  let node: SyntaxNode | null = root;
  while (node && members.length < 32) {
    const key = `${node.name}:${node.from}:${node.to}`;
    if (seen.has(key)) return [];
    seen.add(key);
    if (node.name === "CallExpression") { node = node.firstChild; continue; }
    if (node.name === "VariableName") return [source.text.slice(node.from, node.to), ...members];
    if (node.name !== "MemberExpression") return [];
    const property = getLezerChildren(node).find((child) => child.name === "PropertyName");
    if (!property) return [];
    members.unshift(source.text.slice(property.from, property.to)); node = node.firstChild;
  }
  return [];
}

/** Resolves import spelling against known model files without touching the filesystem. */
function moduleMatchesFile(module: string, currentFile: string, targetFile: string): boolean {
  const target = targetFile.replace(/\\/gu, "/");
  if (!module.startsWith(".")) return target.endsWith("/" + module.replace(/\./gu, "/") + ".py")
    || target.endsWith("/" + module.replace(/\./gu, "/") + "/__init__.py");
  const dots = module.match(/^\.+/u)![0].length;
  const parts = currentFile.replace(/\\/gu, "/").split("/").slice(0, -dots);
  const resolved = parts.join("/") + "/" + module.slice(dots).replace(/\./gu, "/");
  return target === resolved + ".py" || target === resolved + "/__init__.py";
}
