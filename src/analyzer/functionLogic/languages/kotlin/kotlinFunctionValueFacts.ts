/**
 * Bounded Kotlin lexical binding/read/write facts for the shared CFG projector.
 * Identifier ownership comes from syntax parents and lexical block spans; lambda
 * and nested declaration scopes are pruned rather than executed by the parent.
 */
import { createContentHash } from "../../../../shared/hash";
import type { StructuredCallableDescriptor } from "../../core/structuredFunctionLogicAnalyzer";
import type { FunctionLogicValueAccessFact, FunctionLogicValueBindingFact, FunctionLogicValueFacts } from "../../dataFlow";
import {
  collectKotlinCallables, getKotlinChildNamed, kotlinNodeRange,
  type KotlinSource, type KotlinSyntaxNode
} from "../../../languages/kotlin";
import { isKotlinDeferredScope, readKotlinWrite, unwrapKotlinNode } from "./kotlinFunctionLogicSyntax";

const MAX_KOTLIN_BINDINGS = 300;
const MAX_KOTLIN_ACCESSES = 1800;
type NodeFrame = { node: KotlinSyntaxNode; parent?: KotlinSyntaxNode; ancestors: KotlinSyntaxNode[];
  scope: KotlinSyntaxNode; depth: number };
type LexicalBinding = { fact: FunctionLogicValueBindingFact; node: KotlinSyntaxNode;
  scope: KotlinSyntaxNode; availableFrom: number };

/** Produces lexical facts; no inferred type, runtime mutation, or dynamic receiver is resolved. */
export function collectKotlinFunctionValueFacts(source: KotlinSource,
  callable: StructuredCallableDescriptor<KotlinSyntaxNode>): FunctionLogicValueFacts {
  const frames = ownedFrames(callable.body);
  const bindings: LexicalBinding[] = [];
  const declarationNames = new Set<KotlinSyntaxNode>();
  const syntaxCallable = collectKotlinCallables(source).find((candidate) => candidate.node.from === callable.node.from
    && candidate.node.to === callable.node.to);
  for (const parameter of syntaxCallable?.parameters ?? []) {
    const parameterNode = getKotlinChildNamed(parameter.node, "parameter") ?? parameter.node;
    const identifier = getKotlinChildNamed(parameterNode, "simpleIdentifier");
    if (!identifier) continue;
    declarationNames.add(identifier);
    bindings.push(createBinding(source, identifier, parameter.name, "parameter", callable.body, 0));
  }
  for (const frame of frames) {
    const node = frame.node;
    if (node.name === "variableDeclaration") {
      const identifier = getKotlinChildNamed(node, "simpleIdentifier");
      if (!identifier) continue;
      declarationNames.add(identifier);
      const owner = [...frame.ancestors].reverse().find((ancestor) => ["propertyDeclaration", "forStatement", "whenSubject"].includes(ancestor.name));
      if (!owner) continue;
      const constant = owner.children.some((child) => child.name === "VAL");
      const scope = owner.name === "forStatement" ? owner : frame.scope;
      const name = source.text.slice(identifier.from, identifier.to).replace(/^`|`$/gu, "");
      bindings.push(createBinding(source, identifier, name, constant ? "constant" : "local", scope, identifier.to));
    } else if (node.name === "catchBlock") {
      const identifier = getKotlinChildNamed(node, "simpleIdentifier");
      if (!identifier) continue;
      declarationNames.add(identifier);
      bindings.push(createBinding(source, identifier, source.text.slice(identifier.from, identifier.to), "local", node, identifier.to));
    }
  }
  const retained = bindings.slice(0, MAX_KOTLIN_BINDINGS);
  const accesses: FunctionLogicValueAccessFact[] = [];
  const bindingsByName = new Map<string, LexicalBinding[]>();
  for (const binding of retained) {
    const rows = bindingsByName.get(binding.fact.name) ?? [];
    rows.push(binding); bindingsByName.set(binding.fact.name, rows);
  }
  for (const frame of frames) {
    const node = frame.node;
    if (node.name !== "simpleIdentifier" || declarationNames.has(node) || !isValueIdentifier(frame)) continue;
    const name = source.text.slice(node.from, node.to).replace(/^`|`$/gu, "");
    const binding = resolveBinding(bindingsByName.get(name) ?? [], node);
    if (!binding) continue;
    const assignment = [...frame.ancestors].reverse().find((ancestor) => ancestor.name === "assignment");
    const write = assignment && readKotlinWrite(source, assignment);
    const isTarget = write && write.targetNode.from <= node.from && node.to <= write.targetNode.to;
    const update = frame.ancestors.some((ancestor) => ["prefixUnaryExpression", "postfixUnaryExpression"].includes(ancestor.name)
      && /^(?:\+\+|--)|(?:\+\+|--)$/u.test(source.text.slice(ancestor.from, ancestor.to).trim()));
    const access = isTarget ? write.operator === "=" ? "write" : "readwrite" : update ? "readwrite" : "read";
    const sink = frame.ancestors.some((ancestor) => ancestor.name === "valueArgument"
      || (ancestor.name === "jumpExpression" && ancestor.children.some((child) => child.name === "RETURN" || child.name === "THROW")));
    accesses.push({ bindingId: binding.fact.id, access, usage: access === "read" || access === "readwrite" ? sink ? "sink" : "consume" : undefined,
      range: kotlinNodeRange(source, node), confidence: "exact" });
  }
  // The selected arm of a root if/when/Elvis initializer is the write source.
  // Placing these facts on individual arm expressions preserves branch-dependent
  // reaching definitions instead of pretending every arm ran sequentially.
  for (const frame of frames) {
    const write = readKotlinWrite(source, frame.node);
    if (!write || (frame.node.name !== "propertyDeclaration" && frame.node.name !== "assignment")) continue;
    const binding = resolveBinding(bindingsByName.get(write.target) ?? [], write.targetNode);
    if (!binding) continue;
    for (const arm of selectedValueArms(unwrapKotlinNode(write.expression))) {
      if (isAbruptArm(arm)) continue;
      accesses.push({ bindingId: binding.fact.id, access: write.operator === "=" ? "write" : "readwrite",
        range: kotlinNodeRange(source, arm), confidence: "exact" });
    }
  }
  return { bindings: retained.map((binding) => binding.fact), accesses: accesses.slice(0, MAX_KOTLIN_ACCESSES),
    omittedBindingCount: Math.max(0, bindings.length - retained.length),
    omittedAccessCount: Math.max(0, accesses.length - MAX_KOTLIN_ACCESSES) };
}

/** Retains a bounded syntax-parent view for source-role and lexical-scope checks. */
function ownedFrames(root: KotlinSyntaxNode): NodeFrame[] {
  const frames: NodeFrame[] = [];
  const pending: NodeFrame[] = [{ node: root, ancestors: [], scope: root, depth: 0 }];
  const visited = new Set<KotlinSyntaxNode>();
  while (pending.length && visited.size < 50000) {
    const frame = pending.pop();
    if (!frame || visited.has(frame.node) || frame.depth > 256) continue;
    visited.add(frame.node);
    if (frame.node !== root && isKotlinDeferredScope(frame.node)) continue;
    frames.push(frame);
    const scope = ["block", "catchBlock", "forStatement"].includes(frame.node.name) ? frame.node : frame.scope;
    for (let index = frame.node.children.length - 1; index >= 0; index -= 1) pending.push({
      node: frame.node.children[index], parent: frame.node, ancestors: [...frame.ancestors, frame.node],
      scope, depth: frame.depth + 1 });
  }
  return frames;
}

/** Stable binding identity is source-owned and scoped, rather than name-only. */
function createBinding(source: KotlinSource, node: KotlinSyntaxNode, name: string,
  kind: FunctionLogicValueBindingFact["kind"], scope: KotlinSyntaxNode, availableFrom: number): LexicalBinding {
  return { node, scope, availableFrom,
    fact: { id: `kotlin-value:${createContentHash(`${scope.from}:${scope.to}:${node.from}:${name}`).slice(0, 24)}`,
      name, kind, declarationRange: kotlinNodeRange(source, node),
      definitionPlacement: kind === "parameter" ? "entry" : "source", confidence: "exact" } };
}

/** Resolves only the most specific preceding lexical declaration with a known source span. */
function resolveBinding(candidates: LexicalBinding[], node: KotlinSyntaxNode): LexicalBinding | undefined {
  return candidates.filter((binding) => binding.availableFrom <= node.to
    && binding.scope.from <= node.from && node.to <= binding.scope.to)
    .sort((left, right) => (left.scope.to - left.scope.from) - (right.scope.to - right.scope.from)
      || right.availableFrom - left.availableFrom)[0];
}

/** Type names, member names, labels, and named argument keys are not lexical reads. */
function isValueIdentifier(frame: NodeFrame): boolean {
  const parent = frame.parent;
  if (!parent) return false;
  if (frame.ancestors.some((node) => ["type", "userType", "receiverType", "label", "annotation"].includes(node.name))) return false;
  if (["navigationSuffix", "label", "functionDeclaration", "parameter"].includes(parent.name)) return false;
  if (parent.name === "valueArgument" && parent.children.some((node) => node.name === "ASSIGNMENT")) return false;
  // Function callee identifiers are excluded unless they resolve as a tracked
  // callable-valued parameter/local; that lexical read remains valid evidence.
  return true;
}

/** Finds leaf values from root control expressions with bounded iterative jobs. */
function selectedValueArms(root: KotlinSyntaxNode): KotlinSyntaxNode[] {
  const results: KotlinSyntaxNode[] = [];
  const pending = [root];
  const visited = new Set<KotlinSyntaxNode>();
  while (pending.length && visited.size < 300) {
    const raw = pending.pop();
    if (!raw || visited.has(raw)) continue;
    visited.add(raw);
    const node = unwrapKotlinNode(raw);
    let bodies: KotlinSyntaxNode[] = [];
    if (node.name === "ifExpression") bodies = node.children.filter((child) => child.name === "controlStructureBody");
    else if (node.name === "whenExpression") bodies = node.children.filter((child) => child.name === "whenEntry")
      .flatMap((entry) => { const body = getKotlinChildNamed(entry, "controlStructureBody"); return body ? [body] : []; });
    else if (node.name === "elvisExpression") bodies = node.children.filter((child) => child.name === "infixFunctionCall");
    if (!bodies.length) { results.push(node); continue; }
    for (const body of bodies) {
      const block = unwrapKotlinNode(body);
      const statements = block.name === "block" ? getKotlinChildNamed(block, "statements")?.children.filter((child) => child.name === "statement") ?? [] : [block];
      const last = statements.at(-1);
      if (last) pending.push(last);
    }
  }
  return results;
}

/** A jump expression terminates instead of assigning the enclosing val/var. */
function isAbruptArm(node: KotlinSyntaxNode): boolean { return unwrapKotlinNode(node).name === "jumpExpression"; }
