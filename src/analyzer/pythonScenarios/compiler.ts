/** Iterative Python-to-bytecode compiler for bounded, local, pure Scenario calculations. */
import { parser } from "@lezer/python";
import type { SyntaxNode } from "@lezer/common";
import type { FunctionLogicAnalysis } from "../functionLogic";
import type { FunctionTutorDeclarationAnalysis } from "../functionTutor/types";
import type { PythonInstruction as Instruction, PythonScenarioProgram } from "../../shared/pythonScenario/types";
import { createPythonRegexRuntime } from "../../shared/pythonScenario/regex";
import { pythonChildren as children, pythonLiteral } from "./syntax";

type Label = { position?: number };
type Task = { kind: "expression" | "statement"; node: SyntaxNode; loop?: { next: Label; end: Label }; negate?: boolean }
  | { kind: "emit"; instruction: Instruction; label?: Label } | { kind: "label"; label: Label };

/** Keeps only the selected callable and statically named same-file dependencies; missing syntax remains a gap. */
export function compilePythonScenario(declaration: FunctionTutorDeclarationAnalysis, source: string, logic: FunctionLogicAnalysis): PythonScenarioProgram | undefined {
  if (source.length > 1_048_576 || declaration.language !== "python") return;
  const tree = parser.parse(source);
  const definitions = new Map<string, SyntaxNode>(); const assignments = new Map<string, SyntaxNode>();
  const shadowed = new Set<string>(); let regexModule = "";
  for (const node of children(tree.topNode)) {
    const parts = children(node);
    if (node.name === "FunctionDefinition") {
      const name = parts.find((part) => part.name === "VariableName");
      if (name) { const text = source.slice(name.from, name.to); if (definitions.has(text)) shadowed.add(text); definitions.set(text, node); }
    } else if (node.name === "AssignStatement" && parts[0]?.name === "VariableName") {
      const name = source.slice(parts[0].from, parts[0].to); if (assignments.has(name)) shadowed.add(name); assignments.set(name, node);
    } else if (node.name === "ImportStatement") {
      const match = /^import\s+re(?:\s+as\s+(\w+))?\s*$/u.exec(source.slice(node.from, node.to));
      if (match) regexModule = match[1] ?? "re";
      else for (const part of parts) if (part.name === "VariableName") shadowed.add(source.slice(part.from, part.to));
    } else if (node.name !== "Comment") {
      // A conditional/rebound module name cannot be treated as a fixed same-file constant.
      const queue = [node]; const seen = new Set<string>();
      for (let i = 0; i < queue.length && i < 4096; i += 1) {
        const child = queue[i]; const key = `${child.from}:${child.to}`; if (seen.has(key)) continue; seen.add(key);
        if (child.name === "VariableName") shadowed.add(source.slice(child.from, child.to));
        queue.push(...children(child));
      }
    }
  }
  const root = definitions.get(declaration.functionNode.name); if (!root || shadowed.has(declaration.functionNode.name)) return;
  const lineStarts = [0]; for (let i = 0; i < source.length; i += 1) if (source[i] === "\n") lineStarts.push(i + 1);
  const offset = (range: { startLine: number; startCharacter: number }) => (lineStarts[range.startLine] ?? source.length) + range.startCharacter;
  const selection = root.getChild("VariableName");
  if (!selection || selection.from !== offset(declaration.functionNode.selectionRange)) return;
  const program: PythonScenarioProgram = {
    version: 1, root: declaration.functionNode.name, functions: [], globals: [],
    bindings: declaration.program.bindings.map((binding) => ({ name: binding.name, bindingId: binding.bindingId, parameterId: binding.parameterId })),
    entryBlockId: declaration.program.entryBlockId,
    edges: logic.edges.filter((edge) => !["defines", "deferred"].includes(edge.kind)).map((edge) => ({ edgeId: edge.id, sourceBlockId: edge.sourceId, targetBlockId: edge.targetId, kind: edge.kind })),
    stringCandidates: [], regexPatterns: []
  };
  const pendingFunctions = [program.root]; const pendingGlobals: string[] = []; const visited = new Set<string>();
  const regexPatterns = new Set<string>();
  const text = (node: SyntaxNode) => source.slice(node.from, node.to);
  /** Source range joins are only for root UI identity; helper internals cannot masquerade as root blocks. */
  function blockAt(node: SyntaxNode, decision = false): string | undefined {
    const candidates = logic.blocks.filter((block) => {
      if (decision && block.kind !== "condition" && block.kind !== "loop") return false;
      const start = offset(block.range); const end = (lineStarts[block.range.endLine] ?? source.length) + block.range.endCharacter;
      return start <= node.from && end >= node.to;
    }).sort((a, b) => ((a.range.endLine - a.range.startLine) * 10000 + a.range.endCharacter - a.range.startCharacter)
      - ((b.range.endLine - b.range.startLine) * 10000 + b.range.endCharacter - b.range.startCharacter));
    return candidates[0]?.id;
  }
  /** An explicit task stack emits instruction order and patches jumps after labels resolve. */
  function compile(nodes: SyntaxNode[], isRoot: boolean, locals: Set<string>, expressionOnly = false): Instruction[] {
    const output: Instruction[] = []; const patches: Array<{ instruction: Instruction; label: Label }> = [];
    const tasks: Task[] = nodes.slice().reverse().map((node) => ({ kind: expressionOnly ? "expression" : "statement", node }));
    let serial = 0; let work = 0;
    const emit = (instruction: Instruction, label?: Label): Task => ({ kind: "emit", instruction, label });
    const expr = (node: SyntaxNode, negate = false): Task => ({ kind: "expression", node, negate });
    const labelTask = (label: Label): Task => ({ kind: "label", label });
    const schedule = (...items: Task[]) => tasks.push(...items.reverse());
    const statements = (body: SyntaxNode | undefined, loop?: { next: Label; end: Label }): Task[] => body ? children(body).filter((child) => child.name !== ":" && child.name !== "Comment").map((node) => ({ kind: "statement", node, loop })) : [];
    const gap = () => output.push({ op: "gap" });
    const targetTasks = (targets: SyntaxNode[], blockId?: string): Task[] => {
      const names = targets.filter((node) => node.name === "VariableName");
      if (!names.length || targets.some((node) => node.name !== "VariableName" && node.name !== ",")) return [emit({ op: "gap" })];
      names.forEach((node) => locals.add(text(node)));
      return [...(names.length > 1 ? [emit({ op: "unpack", count: names.length })] : []), ...names.map((node) => emit({ op: "store", name: text(node), blockId }))];
    };
    while (tasks.length && ++work <= 8192 && output.length < 2048) {
      const task = tasks.pop()!;
      if (task.kind === "label") { task.label.position = output.length; continue; }
      if (task.kind === "emit") { output.push(task.instruction); if (task.label) patches.push({ instruction: task.instruction, label: task.label }); continue; }
      const node = task.node; const parts = children(node); const blockId = isRoot ? blockAt(node) : undefined;
      if (task.kind === "statement") {
        if (node.name === "Comment" || node.name === "PassStatement") continue;
        if (blockId && !["IfStatement", "ForStatement", "WhileStatement", "ReturnStatement"].includes(node.name)) output.push({ op: "trace", blockId });
        if (node.name === "AssignStatement" || node.name === "UpdateStatement") {
          const operator = parts.findIndex((part) => part.name === "AssignOp" || part.name === "UpdateOp");
          if (operator < 1 || parts[0].name !== "VariableName" || parts.filter((part) => part.name === "AssignOp" || part.name === "UpdateOp").length !== 1 || parts.slice(1, operator).some((part) => part.name !== "TypeDef")) { gap(); continue; }
          const name = text(parts[0]); locals.add(name);
          schedule(...(node.name === "UpdateStatement" ? [emit({ op: "load", name })] : []), expr(parts[operator + 1]),
            ...(node.name === "UpdateStatement" ? [emit({ op: "binary", name: text(parts[operator]).slice(0, -1) })] : []), emit({ op: "store", name, blockId }));
        } else if (node.name === "ReturnStatement") schedule(...(parts[1] ? [expr(parts[1])] : [emit({ op: "literal", value: null })]), emit({ op: "return", blockId }));
        else if (node.name === "ExpressionStatement") {
          if (parts[0]?.name === "String") continue; // Authored documentation has no execution effect.
          schedule(expr(parts[0]), emit({ op: "pop" }));
        } else if (node.name === "IfStatement") {
          const end: Label = {}; const workItems: Task[] = [];
          for (let i = 0; i < parts.length;) {
            if (parts[i].name === "else") { workItems.push(...statements(parts[i + 1], task.loop)); break; }
            if (!["if", "elif"].includes(parts[i].name) || parts[i + 2]?.name !== "Body") { workItems.push(emit({ op: "gap" })); break; }
            const otherwise: Label = {}; const condition = parts[i + 1];
            workItems.push(expr(condition), emit({ op: "branch", when: false, blockId: isRoot ? blockAt(condition, true) ?? blockId : undefined }, otherwise), ...statements(parts[i + 2], task.loop), emit({ op: "jump" }, end), labelTask(otherwise)); i += 3;
          }
          schedule(...workItems, labelTask(end));
        } else if (node.name === "ForStatement") {
          const inIndex = parts.findIndex((part) => part.name === "in"); const bodyIndex = parts.findIndex((part) => part.name === "Body");
          if (inIndex < 2 || bodyIndex !== inIndex + 2 || parts.length !== bodyIndex + 1 || parts[0].name !== "for") { gap(); continue; }
          const next: Label = {}; const end: Label = {}; const iterator = `@iter${serial++}`;
          schedule(expr(parts[inIndex + 1]), emit({ op: "iterate", name: iterator }), labelTask(next),
            emit({ op: "next", name: iterator, blockId }, end), ...targetTasks(parts.slice(1, inIndex), blockId),
            ...statements(parts[bodyIndex], { next, end }), emit({ op: "jump" }, next), labelTask(end));
        } else if (node.name === "WhileStatement" && parts.length === 3) {
          const next: Label = {}; const end: Label = {};
          schedule(labelTask(next), expr(parts[1]), emit({ op: "branch", when: false, blockId }, end), ...statements(parts[2], { next, end }), emit({ op: "jump" }, next), labelTask(end));
        } else if (node.name === "ContinueStatement" || node.name === "BreakStatement") {
          if (task.loop) schedule(emit({ op: "jump" }, node.name === "ContinueStatement" ? task.loop.next : task.loop.end)); else gap();
        } else gap();
        continue;
      }
      // Lezer places a leading `not` around a boolean expression. Python binds it
      // to the first operand; preserve parentheses while correcting that parser shape.
      if (node.name === "UnaryExpression" && parts[0]?.name === "not") { schedule(expr(parts[1], !task.negate)); continue; }
      const operator = node.name === "BinaryExpression" ? parts.slice(1, -1).map(text).join(" ").trim() : "";
      if (operator === "and" || operator === "or") {
        const end: Label = {};
        schedule(expr(parts[0], task.negate), emit({ op: "branch", when: operator === "or", keep: true }, end), expr(parts.at(-1)!), emit({ op: "binary", name: operator }), labelTask(end)); continue;
      }
      if (task.negate) { schedule(expr(node), emit({ op: "unary", name: "not" })); continue; }
      if (["String", "Number", "Boolean", "None"].includes(node.name)) {
        const value = pythonLiteral(text(node)); if (value === undefined) gap(); else output.push({ op: "literal", value });
      } else if (node.name === "VariableName") {
        const name = text(node); if (!locals.has(name) && assignments.has(name)) pendingGlobals.push(name);
        output.push({ op: "load", name });
      } else if (node.name === "ParenthesizedExpression") schedule(expr(parts[1]));
      else if (node.name === "ArrayExpression" || node.name === "TupleExpression") {
        const items = parts.filter((part) => !["[", "]", "(", ")", ","].includes(part.name)); schedule(...items.map((item) => expr(item)), emit({ op: "list", name: node.name === "TupleExpression" ? "tuple" : "list", count: items.length }));
      } else if (operator) {
        const comparison = /^(==|!=|<|<=|>|>=|in|not in|is|is not)$/u;
        if (comparison.test(operator) && parts[0].name === "BinaryExpression" && comparison.test(children(parts[0]).slice(1, -1).map(text).join(" ").trim())) { gap(); continue; }
        schedule(expr(parts[0]), expr(parts.at(-1)!), emit({ op: "binary", name: operator }));
      }
      else if (node.name === "UnaryExpression") schedule(expr(parts[1]), emit({ op: "unary", name: text(parts[0]) }));
      else if (node.name === "MemberExpression" && parts[1]?.name === "[") {
        const inner = parts.slice(2, -1); const colon = inner.findIndex((part) => part.name === ":");
        if (colon < 0 && inner.length === 1) schedule(expr(parts[0]), expr(inner[0]), emit({ op: "index" }));
        else if (inner.filter((part) => part.name === ":").length === 1 && inner.length <= 3) schedule(expr(parts[0]), ...(colon === 1 ? [expr(inner[0])] : [emit({ op: "literal", value: null })]), ...(colon < inner.length - 1 ? [expr(inner[colon + 1])] : [emit({ op: "literal", value: null })]), emit({ op: "slice" }));
        else gap();
      } else if (node.name === "ArrayComprehensionExpression" || node.name === "ArgList" && parts.some((part) => part.name === "for")) {
        const forIndex = parts.findIndex((part) => part.name === "for"); const inIndex = parts.findIndex((part) => part.name === "in"); const ifIndex = parts.findIndex((part) => part.name === "if");
        if (forIndex !== 2 || inIndex < forIndex + 2 || parts.filter((part) => part.name === "for").length !== 1 || (ifIndex < 0 ? parts.length - 1 : ifIndex) !== inIndex + 2) { gap(); continue; }
        const next: Label = {}; const end: Label = {}; const iterator = `@iter${serial++}`; const list = `@list${serial++}`;
        const loopBlock = isRoot ? blockAt(parts[inIndex + 1], true) : undefined;
        const filterBlock = isRoot && ifIndex >= 0 ? blockAt(parts[ifIndex + 1], true) : undefined;
        const itemBlock = isRoot ? blockAt(parts[1]) : undefined;
        schedule(emit({ op: "scope", keep: true }), emit({ op: "list", count: 0 }), emit({ op: "store", name: list }), expr(parts[inIndex + 1]), emit({ op: "iterate", name: iterator }), labelTask(next), emit({ op: "next", name: iterator, blockId: loopBlock }, end),
          ...targetTasks(parts.slice(forIndex + 1, inIndex), loopBlock), ...(ifIndex >= 0 ? [expr(parts[ifIndex + 1]), emit({ op: "branch", when: false, blockId: filterBlock }, next)] : []),
          ...(itemBlock ? [emit({ op: "trace", blockId: itemBlock })] : []), emit({ op: "load", name: list }), expr(parts[1]), emit({ op: "method", name: "append", count: 1 }), emit({ op: "pop" }), emit({ op: "jump" }, next), labelTask(end), emit({ op: "load", name: list }), emit({ op: "scope" }));
      } else if (node.name === "CallExpression") {
        const callee = parts[0]; const args = children(parts[1]); const member = children(callee); let argumentNodes = args.slice(1, -1).filter((part) => part.name !== ",");
        if (args.some((part) => part.name === "for")) {
          if (!["sum", "min", "max", "list", "tuple"].includes(text(callee)) || definitions.has(text(callee))) { gap(); continue; }
          argumentNodes = [parts[1]];
        }
        if (argumentNodes.some((part) => part.name === "AssignOp")) {
          // zip(strict=False) preserves Python's shortest-iterable semantics. Other keyword calls remain unknown.
          if (text(callee) !== "zip" || !/strict\s*=\s*False\s*\)$/u.test(text(parts[1]))) { gap(); continue; }
          argumentNodes = argumentNodes.slice(0, -3);
        }
        if (callee.name === "VariableName") {
          const name = text(callee);
          if (locals.has(name) || shadowed.has(name) || assignments.has(name)) { gap(); continue; }
          if (definitions.has(name)) pendingFunctions.push(name);
          else if (!["len", "int", "str", "sum", "zip", "abs", "min", "max", "range", "list", "tuple", "bool"].includes(name)) { gap(); continue; }
          schedule(...argumentNodes.map((arg) => expr(arg)), emit({ op: "call", name, count: argumentNodes.length }));
        } else if (callee.name === "MemberExpression" && member[1]?.name === ".") {
          const name = text(member[2]);
          if (text(member[0]) === regexModule && name === "compile" && !locals.has(regexModule) && !assignments.has(regexModule) && argumentNodes.length === 1) {
            const pattern = pythonLiteral(text(argumentNodes[0]));
            if (typeof pattern !== "string" || !createPythonRegexRuntime().parse(pattern)) { gap(); continue; }
            regexPatterns.add(pattern); schedule(emit({ op: "literal", value: pattern }), emit({ op: "call", name: "@regex", count: 1 }));
          } else if (["splitlines", "split", "join", "isdigit", "strip", "lower", "upper", "startswith", "endswith", "append", "finditer", "search", "groups", "group"].includes(name)) schedule(expr(member[0]), ...argumentNodes.map((arg) => expr(arg)), emit({ op: "method", name, count: argumentNodes.length, blockId }));
          else gap();
        } else gap();
      } else gap();
    }
    if (tasks.length) output.push({ op: "gap" });
    for (const patch of patches) { if (patch.label.position === undefined) patch.instruction.op = "gap"; else patch.instruction.target = patch.label.position; }
    return output;
  }
  for (let cursor = 0; cursor < pendingFunctions.length && visited.size < 8; cursor += 1) {
    const name = pendingFunctions[cursor]; if (visited.has(name)) continue; visited.add(name);
    const node = definitions.get(name); if (!node || shadowed.has(name) || assignments.has(name)) return;
    const params = children(node.getChild("ParamList")!).filter((part) => part.name === "VariableName").map(text);
    const parameterText = node.getChild("ParamList");
    if (!parameterText || children(parameterText).some((part) => part.name === "AssignOp" || part.name === "*" || part.name === "**")) return;
    const body = node.getChild("Body"); if (!body || node.getChild("async")) return;
    const locals = new Set(params); const queue = children(body); const seen = new Set<string>();
    for (let i = 0; i < queue.length && i < 4096; i += 1) {
      const child = queue[i]; const key = `${child.from}:${child.to}:${child.name}`; if (seen.has(key)) continue; seen.add(key);
      if (child.name === "FunctionDefinition" || child.name === "ClassDefinition") continue;
      if (["AssignStatement", "UpdateStatement"].includes(child.name) && child.firstChild?.name === "VariableName") locals.add(text(child.firstChild));
      queue.push(...children(child));
    }
    const instructions = compile(children(body).filter((part) => part.name !== ":"), name === program.root, locals);
    instructions.push({ op: "literal", value: null }, { op: "return" });
    program.functions.push({ id: name, parameters: params, instructions });
  }
  const globalVisited = new Set<string>();
  for (let cursor = 0; cursor < pendingGlobals.length && globalVisited.size < 24; cursor += 1) {
    const name = pendingGlobals[cursor]; if (globalVisited.has(name)) continue; globalVisited.add(name);
    const node = assignments.get(name); if (!node || shadowed.has(name)) return;
    const parts = children(node); const index = parts.findIndex((part) => part.name === "AssignOp"); if (index < 0) return;
    const instructions = compile([parts[index + 1]], false, new Set(), true);
    // Mutable module collections depend on outside state. Immutable tuples and regex constants are bounded here.
    if (instructions.some((instruction) => instruction.op === "list" && instruction.name !== "tuple")) instructions.splice(0, instructions.length, { op: "gap" });
    program.globals.push({ name, instructions });
  }
  if (pendingFunctions.some((name) => !visited.has(name)) || pendingGlobals.some((name) => !globalVisited.has(name))) return;
  program.globals.sort((left, right) => assignments.get(left.name)!.from - assignments.get(right.name)!.from);
  const regex = createPythonRegexRuntime(); const patternCandidates = [...regexPatterns].map((pattern) => regex.candidates(pattern));
  program.regexPatterns = [...regexPatterns];
  const numeric = patternCandidates.filter((values) => values.some((value) => /\d/u.test(value))).flat();
  const labels = patternCandidates.filter((values) => values.every((value) => !/\d/u.test(value))).flat();
  const candidates = [...numeric, ...labels];
  for (const value of numeric) {
    candidates.push(value + "\n" + value);
    for (const label of labels.slice(0, 2)) candidates.push(label + ": " + value, value + "\n" + label + ": " + value);
  }
  program.stringCandidates = [...new Set(candidates)].filter((value) => value.length <= 512).slice(0, 320);
  return program;
}
