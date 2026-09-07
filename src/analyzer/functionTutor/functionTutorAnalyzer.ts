/**
 * TypeScript/JavaScript static Tutor adapter. It translates parser-proven
 * declaration, predicate, mutation, and callsite syntax into the language-
 * neutral Tutor program without evaluating source code.
 */
import * as ts from "typescript";
import { createContentHash } from "../../shared/hash";
import type { SourceRange, SymbolNode } from "../../shared/types";
import { analyzeFunctionLogic, type FunctionLogicAnalysis, type FunctionLogicBlock } from "../functionLogic";
import {
  findSelectedFunction,
  getScriptKind,
  getSupportedLanguage,
  isFunctionLikeWithBody,
  isLoopStatement,
  toSourceRange
} from "../functionLogic/typescriptFunctionLogicSyntax";
import type { FunctionLikeWithBody } from "../functionLogic/typescriptFunctionLogicInternal";
import { analyzeNonTypeScriptTutorDeclaration } from "./nonTypeScriptTutorAdapter";
import { createUnavailableFunctionTutorDeclaration } from "./functionTutorUnavailable";
import { analyzeFunctionTutorDocumentation } from "./documentation";
import {
  boundFunctionTutorStaticValue,
  createFunctionTutorUnknown,
  isFunctionTutorSafeObjectKey
} from "./staticValue";
import { toScenarioExpression } from "./scenario/expression";
import {
  readFunctionTutorParameterMembers,
  readFunctionTutorParameterTypeFacts
} from "./parameterTypeFacts";
import {
  collectFunctionTutorAtomicConditions,
  normalizeFunctionTutorLengthConstraint
} from "./parameterConstraintPaths";
import type {
  FunctionTutorAssignmentTarget,
  FunctionTutorCertainty,
  FunctionTutorConstraint,
  FunctionTutorDeclarationAnalysis,
  FunctionTutorDeclarationInput,
  FunctionTutorEvidence,
  FunctionTutorExpression,
  FunctionTutorGap,
  FunctionTutorOperation,
  FunctionTutorParameterFact,
  FunctionTutorProgram,
  FunctionTutorProgramBinding,
  FunctionTutorProgramBlock,
  FunctionTutorStaticValue
} from "./types";
import { buildFunctionTutorScenarioCatalog } from "./scenario/catalog";
/** Adapts declaration-local helpers to the focused Scenario expression module. */
function toExpression(expression: ts.Expression, sourceFile: ts.SourceFile, bindingsByName: Map<string, string>): FunctionTutorExpression {
  return toScenarioExpression(expression, { sourceFile, bindingsByName, readStaticValue, readBindingMember, readPropertyName, isSafeObjectKey: isFunctionTutorSafeObjectKey });
}
/** Dispatches declaration analysis while keeping unsupported languages explicit. */
export function analyzeFunctionTutorDeclaration(
  input: FunctionTutorDeclarationInput
): FunctionTutorDeclarationAnalysis {
  if (!input.sourceText) {
    return createUnavailableFunctionTutorDeclaration(input.functionNode, input.functionLogic, "The function source is unavailable for static Tutor analysis.");
  }
  const language = getSupportedLanguage(input.functionNode);
  if (language === "unsupported") {
    return withFunctionTutorDocumentation(
      analyzeNonTypeScriptTutorDeclaration(input.functionNode, input.sourceText, input.functionLogic),
      input.sourceText
    );
  }
  const sourceFile = ts.createSourceFile(
    input.functionNode.filePath,
    input.sourceText,
    ts.ScriptTarget.Latest,
    true,
    getScriptKind(input.functionNode.filePath, input.functionNode.language)
  );
  const functionNode = findSelectedFunction(sourceFile, input.functionNode);
  if (!functionNode) {
    return createUnavailableFunctionTutorDeclaration(
      input.functionNode,
      input.functionLogic,
      "The selected function could not be matched to its current source declaration."
    );
  }
  const analysis = analyzeTypeScriptLikeDeclaration(sourceFile, functionNode, input.functionNode, input.functionLogic);
  // The catalog is a Host-only, source-range-backed supplement. It deliberately
  // does not change the graph or use display names for dispatch.
  analysis.scenarioCatalog = buildFunctionTutorScenarioCatalog({
    sourceFile,
    rootNode: input.functionNode,
    rootFunction: functionNode,
    rootAnalysis: analysis,
    materialize: (node, symbol, thisBindingId) => {
      const logic = analyzeFunctionLogic({ functionNode: symbol, sourceText: input.sourceText });
      const child = analyzeTypeScriptLikeDeclaration(sourceFile, node, symbol, logic, thisBindingId);
      return child;
    }
  });
  return withFunctionTutorDocumentation(analysis, input.sourceText);
}
/** Adds authored documentation without allowing it to alter parser or scenario facts. */
function withFunctionTutorDocumentation(
  analysis: FunctionTutorDeclarationAnalysis,
  sourceText: string
): FunctionTutorDeclarationAnalysis {
  const documentation = analyzeFunctionTutorDocumentation({
    functionNode: analysis.functionNode,
    sourceText,
    language: analysis.language
  });
  return documentation ? { ...analysis, documentation } : analysis;
}
/** Builds parameter facts and a source-ordered program for one TS-like callable. */
function analyzeTypeScriptLikeDeclaration(
  sourceFile: ts.SourceFile,
  functionNode: FunctionLikeWithBody,
  graphNode: SymbolNode,
  functionLogic: FunctionLogicAnalysis,
  thisBindingId?: string
): FunctionTutorDeclarationAnalysis {
  const gaps: FunctionTutorGap[] = [];
  const bindingsByName = new Map<string, string>();
  for (const binding of functionLogic.valueBindings ?? []) bindingsByName.set(binding.name, binding.id);
  if (thisBindingId) bindingsByName.set("this", thisBindingId);
  const parameters = functionNode.parameters.map((parameter, index) =>
    createParameterFact(sourceFile, graphNode.filePath, parameter, index, bindingsByName, gaps)
  );
  const parameterByName = new Map(parameters.map((parameter) => [parameter.name, parameter]));
  const program = createProgram(sourceFile, functionNode, graphNode.filePath, functionLogic, parameters, bindingsByName, gaps);
  if (thisBindingId && !program.bindings.some((binding) => binding.bindingId === thisBindingId)) {
    program.bindings.push({ bindingId: thisBindingId, name: "this", kind: "local", certainty: "exact" });
  }
  if (readExecutionKind(functionNode) === "generator") {
    const generator = collectGeneratorSuspensions(functionNode, sourceFile, bindingsByName);
    program.generatorYields = generator.yields;
    program.generatorReturn = generator.returnValue;
  }
  const constraints = collectConstraints(sourceFile, functionNode, functionLogic, parameterByName);
  return {
    functionNode: graphNode,
    language: getSupportedLanguage(graphNode),
    executionKind: readExecutionKind(functionNode),
    parameters,
    constraints,
    program,
    gaps
  };
}
/** Collects only source-ordered synchronous generator suspension expressions. */
function collectGeneratorSuspensions(functionNode: FunctionLikeWithBody, sourceFile: ts.SourceFile, bindingsByName: Map<string, string>): { yields: FunctionTutorExpression[]; returnValue?: FunctionTutorExpression } {
  const yields: FunctionTutorExpression[] = [];
  let returnValue: FunctionTutorExpression | undefined;
  const pending: ts.Node[] = [functionNode.body];
  let cursor = 0;
  while (cursor < pending.length && yields.length < 24) {
    const current = pending[cursor++];
    if (current !== functionNode.body && ts.isFunctionLike(current)) continue;
    if (ts.isYieldExpression(current)) {
      if (current.asteriskToken || current.expression === undefined) { yields.push({ kind: "unsupported", reason: "unsupported-expression", summary: "Only plain yield expressions are supported." }); }
      else yields.push(toExpression(current.expression, sourceFile, bindingsByName));
      continue;
    }
    if (ts.isReturnStatement(current) && current.expression) returnValue = toExpression(current.expression, sourceFile, bindingsByName);
    ts.forEachChild(current, (child) => pending.push(child));
  }
  return { yields, returnValue };
}
/** Reads one parameter declaration without relying on rendered signature text. */
function createParameterFact(
  sourceFile: ts.SourceFile,
  filePath: string,
  parameter: ts.ParameterDeclaration,
  index: number,
  bindingsByName: Map<string, string>,
  gaps: FunctionTutorGap[]
): FunctionTutorParameterFact {
  const name = ts.isIdentifier(parameter.name) ? parameter.name.text : parameter.name.getText(sourceFile);
  const range = toSourceRange(sourceFile, parameter);
  const id = `tutor-parameter:${createContentHash(`${filePath}\0${range.startLine}\0${range.startCharacter}\0${index}`).slice(0, 24)}`;
  const typeFacts = readFunctionTutorParameterTypeFacts(parameter.type, sourceFile);
  const evidence: FunctionTutorEvidence[] = [{
    kind: parameter.type ? "parameter-type" : "fallback",
    certainty: parameter.type ? "exact" : "inferred",
    filePath,
    range,
    summary: parameter.type ? "Declared parameter type." : "No declared parameter type is available."
  }];
  const defaultValue = parameter.initializer ? readStaticValue(parameter.initializer, sourceFile) : undefined;
  if (parameter.initializer) {
    evidence.push({
      kind: "parameter-default",
      certainty: defaultValue?.kind === "unknown" ? "unknown" : "exact",
      filePath,
      range: toSourceRange(sourceFile, parameter.initializer),
      summary: "Declared parameter default."
    });
  }
  const memberFacts = readFunctionTutorParameterMembers(parameter, sourceFile);
  const ownGaps: FunctionTutorGap[] = [];
  if (!ts.isIdentifier(parameter.name)) {
    ownGaps.push({
      kind: "unsupported-parameter",
      parameterId: id,
      summary: "Destructured parameter inference is limited to direct named members."
    });
  }
  gaps.push(...ownGaps);
  return {
    id,
    bindingId: bindingsByName.get(name),
    name,
    index,
    callingMode: parameter.dotDotDotToken ? "rest-positional" : "positional",
    typeKind: typeFacts.kind,
    typeText: parameter.type?.getText(sourceFile),
    optional: Boolean(parameter.questionToken),
    rest: Boolean(parameter.dotDotDotToken),
    defaultValue: defaultValue?.kind === "unknown" ? undefined : defaultValue,
    literalValues: typeFacts.literalValues,
    typeRepresentative: typeFacts.representative,
    memberFacts,
    declarationEvidence: evidence,
    gaps: ownGaps
  };
}
/** Builds empty blocks first so later statement collection never changes graph identity. */
function createProgram(
  sourceFile: ts.SourceFile,
  functionNode: FunctionLikeWithBody,
  filePath: string,
  functionLogic: FunctionLogicAnalysis,
  parameters: FunctionTutorParameterFact[],
  bindingsByName: Map<string, string>,
  gaps: FunctionTutorGap[]
): FunctionTutorProgram {
  const blocksById = new Map<string, FunctionTutorProgramBlock>();
  for (const block of functionLogic.blocks) blocksById.set(block.id, createEmptyProgramBlock(block));
  const programBindings: FunctionTutorProgramBinding[] = [];
  for (const binding of functionLogic.valueBindings ?? []) {
    const parameter = parameters.find((candidate) => candidate.bindingId === binding.id);
    programBindings.push({
      bindingId: binding.id,
      parameterId: parameter?.id,
      name: binding.name,
      kind: binding.kind,
      certainty: binding.confidence
    });
  }
  const pending: ts.Node[] = [functionNode.body];
  while (pending.length > 0) {
    const node = pending.pop();
    if (!node) continue;
    if (node !== functionNode.body && isFunctionLikeWithBody(node)) continue;
    collectProgramStatement(sourceFile, node, filePath, functionLogic, blocksById, bindingsByName, programBindings, gaps);
    const children = collectTutorStatementChildren(node);
    for (let index = children.length - 1; index >= 0; index -= 1) pending.push(children[index]);
  }
  const entryBlockId = functionLogic.blocks.find((block) => block.kind === "entry")?.id
    ?? functionLogic.blocks[0]?.id
    ?? "tutor-entry:missing";
  const program: FunctionTutorProgram = {
    entryBlockId,
    blocks: functionLogic.blocks.map((block) => blocksById.get(block.id) ?? createEmptyProgramBlock(block)),
    edges: functionLogic.edges.map((edge) => ({
      edgeId: edge.id,
      sourceBlockId: edge.sourceId,
      targetBlockId: edge.targetId,
      kind: edge.kind,
      label: edge.label,
      certainty: edge.confidence
    })),
    bindings: programBindings,
    gaps: gaps.slice()
  };
  attachLogicalReturnContinuations(sourceFile, functionNode, filePath, functionLogic, program, bindingsByName, gaps);
  return program;
}
/** Selects structural statement children without re-walking every expression. */
function collectTutorStatementChildren(node: ts.Node): ts.Node[] {
  if (ts.isBlock(node)) return [...node.statements];
  if (ts.isIfStatement(node)) return [node.thenStatement, ...(node.elseStatement ? [node.elseStatement] : [])];
  if (isLoopStatement(node)) return [node.statement];
  if (ts.isSwitchStatement(node)) return node.caseBlock.clauses.flatMap((clause) => [...clause.statements]);
  if (ts.isTryStatement(node)) {
    return [node.tryBlock, ...(node.catchClause ? [node.catchClause.block] : []), ...(node.finallyBlock ? [node.finallyBlock] : [])];
  }
  return [];
}
/**
 * Connects the Function Logic short-circuit subgraph to its semantic return.
 * The CFG is authoritative for evaluation order; this adds one value hand-off
 * and never creates a synthetic graph edge or re-evaluates the logical return.
 */
function attachLogicalReturnContinuations(sourceFile: ts.SourceFile, functionNode: FunctionLikeWithBody, filePath: string, logic: FunctionLogicAnalysis, program: FunctionTutorProgram, bindingsByName: Map<string, string>, gaps: FunctionTutorGap[]): void {
  const pending: ts.Node[] = [functionNode.body];
  let cursor = 0;
  while (cursor < pending.length) {
    const node = pending[cursor++];
    if (node !== functionNode.body && isFunctionLikeWithBody(node)) continue;
    if (ts.isReturnStatement(node) && node.expression && ts.isBinaryExpression(node.expression)) {
      const operator = node.expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ? "and"
        : node.expression.operatorToken.kind === ts.SyntaxKind.BarBarToken ? "or"
          : node.expression.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ? "nullish" : undefined;
      if (operator) attachLogicalReturnContinuation(sourceFile, filePath, node, operator, logic, program, bindingsByName, gaps);
    }
    for (const child of collectTutorStatementChildren(node)) pending.push(child);
  }
}
/** Validates one top-level logical return before attaching its opaque continuation. */
function attachLogicalReturnContinuation(sourceFile: ts.SourceFile, filePath: string, statement: ts.ReturnStatement, operator: "and" | "or" | "nullish", logic: FunctionLogicAnalysis, program: FunctionTutorProgram, bindingsByName: Map<string, string>, gaps: FunctionTutorGap[]): void {
  const expression = statement.expression as ts.BinaryExpression;
  const byId = new Map(program.blocks.map((block) => [block.blockId, block]));
  const returnBlock = findProgramBlockForNode(sourceFile, statement, logic.blocks, byId, "return");
  const decisionBlock = findProgramBlockForNode(sourceFile, expression.left, logic.blocks, byId, "condition");
  const supplyBlock = findProgramBlockForNode(sourceFile, expression.right, logic.blocks, byId);
  if (!returnBlock || !decisionBlock || !supplyBlock || returnBlock.terminal?.kind !== "return") return;
  const outcomes = logic.edges.filter((edge) => edge.sourceId === decisionBlock.blockId && (edge.kind === "true" || edge.kind === "false"));
  const valid = outcomes.some((edge) => edge.kind === "true") && outcomes.some((edge) => edge.kind === "false")
    && outcomes.some((edge) => edge.targetId === returnBlock.blockId)
    && logic.edges.some((edge) => edge.sourceId === supplyBlock.blockId && edge.targetId === returnBlock.blockId);
  if (!valid || program.continuations?.length) {
    gaps.push({ kind: "unsupported-expression", blockId: returnBlock.blockId, summary: "The logical return does not have one unambiguous Function Logic continuation.", evidence: [createEvidence(filePath, toSourceRange(sourceFile, statement), "fallback", "unknown", "Ambiguous logical return continuation.")] });
    return;
  }
  const range = toSourceRange(sourceFile, expression);
  const id = `tutor-logical-return:${createContentHash(`${filePath}\0${range.startLine}\0${range.startCharacter}\0${returnBlock.blockId}`).slice(0, 24)}`;
  const select = toExpression(expression.left, sourceFile, bindingsByName);
  const supply = toExpression(expression.right, sourceFile, bindingsByName);
  decisionBlock.decision = { expression: operator === "nullish" ? { kind: "unary", operator: "non-nullish", operand: select } : select, continuationId: id, outcomes: outcomes.map((edge) => ({ edgeId: edge.id, label: edge.label ?? edge.kind, matches: edge.kind as "true" | "false" })) };
  supplyBlock.continuationSupplyId = id;
  returnBlock.terminal = { kind: "return", continuationId: id };
  program.continuations = [{ id, predicate: operator === "nullish" ? "non-nullish" : "truthy", select, supply, decisionBlockId: decisionBlock.blockId, supplyBlockId: supplyBlock.blockId, returnBlockId: returnBlock.blockId }];
}
/** Adds one statement's direct operations or decision to the matching visible block. */
function collectProgramStatement(
  sourceFile: ts.SourceFile,
  node: ts.Node,
  filePath: string,
  analysis: FunctionLogicAnalysis,
  blocksById: Map<string, FunctionTutorProgramBlock>,
  bindingsByName: Map<string, string>,
  programBindings: FunctionTutorProgramBinding[],
  gaps: FunctionTutorGap[]
): void {
  const expectedKind = ts.isIfStatement(node) ? "condition"
    : isLoopStatement(node) ? "loop"
      : ts.isSwitchStatement(node) ? "switch"
        : ts.isReturnStatement(node) ? "return"
          : ts.isThrowStatement(node) ? "throw"
            : ts.isBreakStatement(node) ? "break"
              : ts.isContinueStatement(node) ? "continue"
                : undefined;
  // Parser versions occasionally classify an async return as a plain operation;
  // retain the range-proven terminal rather than silently degrading to exit.
  const block = findProgramBlockForNode(sourceFile, node, analysis.blocks, blocksById, expectedKind)
    ?? (expectedKind ? findProgramBlockForNode(sourceFile, node, analysis.blocks, blocksById) : undefined);
  if (!block) return;
  if (ts.isIfStatement(node)) {
    block.decision = createDecision(sourceFile, node.expression, analysis, block.blockId, bindingsByName);
    return;
  }
  if (isLoopStatement(node)) {
    const expression = ts.isForStatement(node) ? node.condition : node.expression;
    if (expression) block.decision = createDecision(sourceFile, expression, analysis, block.blockId, bindingsByName);
    return;
  }
  if (ts.isSwitchStatement(node)) {
    block.decision = createDecision(sourceFile, node.expression, analysis, block.blockId, bindingsByName);
    return;
  }
  if (ts.isReturnStatement(node)) {
    block.terminal = { kind: "return", value: node.expression ? toExpression(node.expression, sourceFile, bindingsByName) : undefined };
    return;
  }
  if (ts.isThrowStatement(node)) {
    block.terminal = { kind: "throw", value: toExpression(node.expression, sourceFile, bindingsByName) };
    return;
  }
  if (ts.isBreakStatement(node)) {
    block.terminal = { kind: "break" };
    return;
  }
  if (ts.isContinueStatement(node)) {
    block.terminal = { kind: "continue" };
    return;
  }
  if (ts.isVariableStatement(node)) {
    // Conditional initializer value blocks overlap the declaration. Attach the
    // definition to the declaration's mutation/merge block so both exact CFG
    // outcomes rejoin before subsequent assignments.
    const operationBlock = findProgramBlockForNode(sourceFile, node, analysis.blocks, blocksById, "mutation") ?? block;
    for (const declaration of node.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name)) continue;
      const bindingId = ensureBinding(declaration.name.text, "local", bindingsByName, programBindings);
      if (declaration.initializer) operationBlock.operations.push({
        kind: "define",
        bindingId,
        value: toExpression(declaration.initializer, sourceFile, bindingsByName)
      });
      if (declaration.initializer) collectConditionalDecisions(declaration.initializer, sourceFile, analysis, blocksById, bindingsByName);
    }
    return;
  }
  if (ts.isExpressionStatement(node)) {
    const operation = readExpressionOperation(node.expression, sourceFile, bindingsByName);
    if (operation) {
      block.operations.push(operation);
      if (ts.isBinaryExpression(node.expression)) collectConditionalDecisions(node.expression.right, sourceFile, analysis, blocksById, bindingsByName);
    } else if (ts.isCallExpression(node.expression)) {
      block.operations.push({
        kind: "effect",
        effectKind: "call",
        summary: `Possible call: ${node.expression.expression.getText(sourceFile)}`,
        certainty: "exact"
      });
    } else {
      const range = toSourceRange(sourceFile, node);
      gaps.push({
        kind: "unsupported-expression",
        blockId: block.blockId,
        summary: "This expression is outside the Tutor's safe static operation set.",
        evidence: [createEvidence(filePath, range, "fallback", "unknown", "Unsupported source expression.")]
      });
    }
  }
}
/** Iteratively connects conditional RHS expressions to their existing CFG decision blocks. */
function collectConditionalDecisions(expression: ts.Expression, sourceFile: ts.SourceFile, analysis: FunctionLogicAnalysis, blocksById: Map<string, FunctionTutorProgramBlock>, bindingsByName: Map<string, string>): void {
  const pending: ts.Node[] = [expression]; let cursor = 0;
  while (cursor < pending.length && cursor < 96) {
    const current = pending[cursor++];
    if (ts.isConditionalExpression(current)) {
      const block = findProgramBlockForNode(sourceFile, current.condition, analysis.blocks, blocksById, "condition");
      if (block && !block.decision) block.decision = createDecision(sourceFile, current.condition, analysis, block.blockId, bindingsByName);
    }
    ts.forEachChild(current, (child) => { pending.push(child); });
  }
}
/** Turns simple assignment/update AST forms into operations without string parsing. */
function readExpressionOperation(
  expression: ts.Expression,
  sourceFile: ts.SourceFile,
  bindingsByName: Map<string, string>
): FunctionTutorOperation | undefined {
  if (ts.isBinaryExpression(expression) && isAssignmentOperator(expression.operatorToken.kind)) {
    const target = readAssignmentTarget(expression.left, bindingsByName);
    if (!target) return undefined;
    return {
      kind: "assign",
      target,
      value: toExpression(expression.right, sourceFile, bindingsByName),
      operator: assignmentOperator(expression.operatorToken.kind)
    };
  }
  if (ts.isDeleteExpression(expression)) {
    const target = readAssignmentTarget(expression.expression, bindingsByName);
    return target ? { kind: "delete", target } : undefined;
  }
  if (ts.isPrefixUnaryExpression(expression) || ts.isPostfixUnaryExpression(expression)) {
    if (expression.operator !== ts.SyntaxKind.PlusPlusToken && expression.operator !== ts.SyntaxKind.MinusMinusToken) return undefined;
    const target = readAssignmentTarget(expression.operand, bindingsByName);
    if (!target) return undefined;
    return { kind: "increment", target, delta: expression.operator === ts.SyntaxKind.PlusPlusToken ? 1 : -1 };
  }
  return undefined;
}
/** Limits assignment targets to tracked lexical bindings and direct own members. */
function readAssignmentTarget(
  expression: ts.Expression,
  bindingsByName: Map<string, string>
): FunctionTutorAssignmentTarget | undefined {
  if (ts.isIdentifier(expression)) {
    const bindingId = bindingsByName.get(expression.text);
    return bindingId ? { kind: "binding", bindingId } : undefined;
  }
  const member = readBindingMember(expression, bindingsByName);
  if (!member || member.segments.some((part) => part.kind === "static" && !isFunctionTutorSafeObjectKey(part.key))) return undefined;
  return { kind: "member", bindingId: member.bindingId, path: member.path, segments: member.segments };
}
/** Creates a decision by reusing Function Logic edge identities rather than labels. */
function createDecision(
  sourceFile: ts.SourceFile,
  expression: ts.Expression,
  analysis: FunctionLogicAnalysis,
  blockId: string,
  bindingsByName: Map<string, string>
) {
  const outcomes = analysis.edges.filter((edge) => edge.sourceId === blockId).map((edge) => ({
    edgeId: edge.id,
    label: edge.label ?? edge.kind,
    matches: edge.kind === "true" ? "true" as const
      : edge.kind === "false" ? "false" as const
        : edge.kind === "case" ? "case" as const
          : edge.kind === "exception" ? "exception" as const
            : edge.kind === "exit" ? "loop-exit" as const
              : "default" as const
  }));
  return { expression: toExpression(expression, sourceFile, bindingsByName), outcomes };
}
/** Picks the closest overlapping visible block, preferring the expected semantic role. */
function findProgramBlockForNode(
  sourceFile: ts.SourceFile,
  node: ts.Node,
  blocks: FunctionLogicBlock[],
  programBlocks: Map<string, FunctionTutorProgramBlock>,
  expectedKind?: string
): FunctionTutorProgramBlock | undefined {
  const range = toSourceRange(sourceFile, node);
  const candidates = blocks.filter((block) => rangeOverlaps(range, block.range)
    && (!expectedKind || block.kind === expectedKind));
  const selected = candidates.sort((left, right) => rangeArea(left.range) - rangeArea(right.range)
    || left.id.localeCompare(right.id))[0];
  return selected ? programBlocks.get(selected.id) : undefined;
}
/** Keeps analyzer program blocks source-backed even when they have no supported operation. */
function createEmptyProgramBlock(block: FunctionLogicBlock): FunctionTutorProgramBlock {
  return {
    blockId: block.id,
    kind: block.kind,
    label: block.label,
    operations: [],
    embeddedRelation: block.kind === "embedded" ? "immediate" : undefined,
    evidence: [createEvidence(block.filePath, block.range, "fallback", block.confidence, "Function Logic source block.")]
  };
}
/** Registers a local only once, preserving Function Logic IDs when available. */
function ensureBinding(
  name: string,
  kind: "local" | "constant",
  bindingsByName: Map<string, string>,
  programBindings: FunctionTutorProgramBinding[]
): string {
  const existing = bindingsByName.get(name);
  if (existing) return existing;
  const bindingId = `tutor-local:${createContentHash(name).slice(0, 20)}`;
  bindingsByName.set(name, bindingId);
  programBindings.push({ bindingId, name, kind, certainty: "inferred" });
  return bindingId;
}
/** Collects direct parameter predicates with an explicit stack, not parser recursion. */
function collectConstraints(
  sourceFile: ts.SourceFile,
  functionNode: FunctionLikeWithBody,
  analysis: FunctionLogicAnalysis,
  parameterByName: Map<string, FunctionTutorParameterFact>
): FunctionTutorConstraint[] {
  const constraints: FunctionTutorConstraint[] = [];
  const pending: ts.Node[] = [functionNode.body];
  while (pending.length > 0 && constraints.length < 64) {
    const node = pending.pop();
    if (!node) continue;
    if (node !== functionNode.body && isFunctionLikeWithBody(node)) continue;
    const expression = ts.isIfStatement(node) ? node.expression
      : ts.isWhileStatement(node) || ts.isDoStatement(node) ? node.expression
        : ts.isForStatement(node) ? node.condition
          : undefined;
    if (expression) {
      const block = findMatchingLogicBlock(sourceFile, expression, analysis.blocks, "condition")
        ?? findMatchingLogicBlock(sourceFile, expression, analysis.blocks, "loop");
      if (block) {
        for (const atomic of collectFunctionTutorAtomicConditions(expression)) {
          const constraint = readConstraint(sourceFile, atomic, block.id, parameterByName);
          if (constraint && constraints.length < 64) constraints.push(constraint);
        }
      }
    }
    const children = collectTutorStatementChildren(node);
    for (let index = children.length - 1; index >= 0; index -= 1) pending.push(children[index]);
  }
  return constraints;
}
/** Converts bare/null/scalar parameter predicates to candidate-domain constraints. */
function readConstraint(
  sourceFile: ts.SourceFile,
  expression: ts.Expression,
  blockId: string,
  parameterByName: Map<string, FunctionTutorParameterFact>
): FunctionTutorConstraint | undefined {
  let targetExpression = expression;
  let forcedOperator: FunctionTutorConstraint["operator"] | undefined;
  if (ts.isPrefixUnaryExpression(expression) && expression.operator === ts.SyntaxKind.ExclamationToken) {
    targetExpression = expression.operand;
    forcedOperator = "falsy";
  }
  const direct = readParameterReference(targetExpression, parameterByName);
  if (direct && !forcedOperator && !ts.isBinaryExpression(targetExpression)) {
    return createConstraint(sourceFile, expression, blockId, direct.parameter, direct.path, "truthy");
  }
  if (direct && forcedOperator) return createConstraint(sourceFile, expression, blockId, direct.parameter, direct.path, forcedOperator);
  if (!ts.isBinaryExpression(expression)) return undefined;
  const left = readParameterReference(expression.left, parameterByName);
  const right = readParameterReference(expression.right, parameterByName);
  const parameterRef = left ?? right;
  const operandNode = left ? expression.right : expression.left;
  if (!parameterRef) return undefined;
  const operand = readStaticValue(operandNode, sourceFile);
  if (operand.kind === "unknown") return undefined;
  const operator = binaryConstraintOperator(expression.operatorToken.kind, Boolean(right));
  if (!operator) return undefined;
  const normalized = normalizeFunctionTutorLengthConstraint(parameterRef.parameter, parameterRef.path, operator, operand);
  return createConstraint(sourceFile, expression, blockId, parameterRef.parameter, normalized.path, normalized.operator, operand);
}
/** Creates stable constraint identity from source location and parameter identity. */
function createConstraint(
  sourceFile: ts.SourceFile,
  expression: ts.Expression,
  blockId: string,
  parameter: FunctionTutorParameterFact,
  memberPath: string[],
  operator: FunctionTutorConstraint["operator"],
  operand?: FunctionTutorStaticValue
): FunctionTutorConstraint {
  const range = toSourceRange(sourceFile, expression);
  const evidence = createEvidence(parameter.declarationEvidence[0]?.filePath ?? "", range, "branch-constraint", "exact", "Direct parameter branch constraint.");
  return {
    id: `tutor-constraint:${createContentHash(`${blockId}\0${parameter.id}\0${range.startLine}\0${range.startCharacter}`).slice(0, 24)}`,
    blockId,
    parameterId: parameter.id,
    memberPath,
    operator,
    operand,
    certainty: "exact",
    evidence: [evidence]
  };
}
/** Resolves one identifier or direct property chain to a declared parameter. */
function readParameterReference(
  expression: ts.Expression,
  parameterByName: Map<string, FunctionTutorParameterFact>
): { parameter: FunctionTutorParameterFact; path: string[] } | undefined {
  if (ts.isIdentifier(expression)) {
    const parameter = parameterByName.get(expression.text);
    return parameter ? { parameter, path: [] } : undefined;
  }
  const member = readBindingMember(expression, new Map<string, string>(
    [...parameterByName.values()].flatMap((parameter) => parameter.bindingId ? [[parameter.name, parameter.bindingId]] : [])
  ));
  if (!member || member.path.some((part) => !isFunctionTutorSafeObjectKey(part))) return undefined;
  const parameter = [...parameterByName.values()].find((candidate) => candidate.bindingId === member.bindingId);
  return parameter ? { parameter, path: member.path } : undefined;
}
/** Reads an identifier/property chain without traversing arbitrary expressions. */
function readBindingMember(
  expression: ts.Expression,
  bindingsByName: Map<string, string>
): { bindingId: string; path: string[]; segments: Array<{ kind: "static"; key: string } | { kind: "binding"; bindingId: string }> } | undefined {
  const segments: Array<{ kind: "static"; key: string } | { kind: "binding"; bindingId: string }> = [];
  let current: ts.Expression = expression;
  while (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) {
    if (ts.isPropertyAccessExpression(current)) { segments.unshift({ kind: "static", key: current.name.text }); current = current.expression; continue; }
    const key = current.argumentExpression;
    if (!key) return undefined;
    if (ts.isIdentifier(key)) {
      const keyBindingId = bindingsByName.get(key.text); if (!keyBindingId) return undefined;
      segments.unshift({ kind: "binding", bindingId: keyBindingId });
    } else if (ts.isStringLiteral(key) || ts.isNoSubstitutionTemplateLiteral(key) || ts.isNumericLiteral(key)) {
      segments.unshift({ kind: "static", key: ts.isNumericLiteral(key) ? String(Number(key.text)) : key.text });
    } else return undefined;
    current = current.expression;
  }
  if (!ts.isIdentifier(current) && current.kind !== ts.SyntaxKind.ThisKeyword) return undefined;
  const bindingId = bindingsByName.get(ts.isIdentifier(current) ? current.text : "this");
  return bindingId ? { bindingId, path: segments.every((part) => part.kind === "static") ? segments.map((part) => part.key) : [], segments } : undefined;
}
/** Reads source literals and bounded literal containers without any evaluation. */
function readStaticValue(node: ts.Node, sourceFile: ts.SourceFile): FunctionTutorStaticValue {
  if (node.kind === ts.SyntaxKind.TrueKeyword) return { kind: "boolean", value: true };
  if (node.kind === ts.SyntaxKind.FalseKeyword) return { kind: "boolean", value: false };
  if (node.kind === ts.SyntaxKind.NullKeyword) return { kind: "null" };
  if (ts.isIdentifier(node) && node.text === "undefined") return { kind: "undefined" };
  if (ts.isNumericLiteral(node)) return boundFunctionTutorStaticValue({ kind: "number", value: Number(node.text.replaceAll("_", "")) });
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return { kind: "string", value: node.text };
  if (ts.isPrefixUnaryExpression(node) && (node.operator === ts.SyntaxKind.MinusToken || node.operator === ts.SyntaxKind.PlusToken) && ts.isNumericLiteral(node.operand)) {
    const value = Number(node.operand.text.replaceAll("_", "")) * (node.operator === ts.SyntaxKind.MinusToken ? -1 : 1);
    return boundFunctionTutorStaticValue({ kind: "number", value });
  }
  if (ts.isArrayLiteralExpression(node)) {
    return boundFunctionTutorStaticValue({
      kind: "array",
      items: node.elements.slice(0, 8).map((element) => ts.isExpression(element)
        ? readStaticValue(element, sourceFile)
        : createFunctionTutorUnknown("unsupported-expression", "Array spread is dynamic.")),
      truncated: node.elements.length > 8
    });
  }
  if (ts.isObjectLiteralExpression(node)) {
    const entries = node.properties.slice(0, 8).flatMap((property) => {
      if (!ts.isPropertyAssignment(property)) return [];
      const key = readPropertyName(property.name);
      return key && isFunctionTutorSafeObjectKey(key)
        ? [{ key, value: readStaticValue(property.initializer, sourceFile) }]
        : [];
    });
    return boundFunctionTutorStaticValue({ kind: "object", entries, truncated: node.properties.length > entries.length });
  }
  return createFunctionTutorUnknown("not-inferred", "The expression is not a safe static literal.");
}
/** Reads an own property label from literal syntax only. */
function readPropertyName(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  if (ts.isComputedPropertyName(name) && (ts.isStringLiteral(name.expression) || ts.isNumericLiteral(name.expression))) return name.expression.text;
  return undefined;
}
function binaryConstraintOperator(kind: ts.SyntaxKind, reverse: boolean): FunctionTutorConstraint["operator"] | undefined {
  const base = new Map<ts.SyntaxKind, FunctionTutorConstraint["operator"]>([
    [ts.SyntaxKind.EqualsEqualsToken, "eq"], [ts.SyntaxKind.EqualsEqualsEqualsToken, "eq"],
    [ts.SyntaxKind.ExclamationEqualsToken, "neq"], [ts.SyntaxKind.ExclamationEqualsEqualsToken, "neq"],
    [ts.SyntaxKind.LessThanToken, "lt"], [ts.SyntaxKind.LessThanEqualsToken, "lte"],
    [ts.SyntaxKind.GreaterThanToken, "gt"], [ts.SyntaxKind.GreaterThanEqualsToken, "gte"]
  ]).get(kind);
  if (!base || !reverse) return base;
  return base === "lt" ? "gt" : base === "lte" ? "gte" : base === "gt" ? "lt" : base === "gte" ? "lte" : base;
}
function isAssignmentOperator(kind: ts.SyntaxKind): boolean {
  return kind === ts.SyntaxKind.EqualsToken || kind === ts.SyntaxKind.PlusEqualsToken
    || kind === ts.SyntaxKind.MinusEqualsToken || kind === ts.SyntaxKind.AsteriskEqualsToken
    || kind === ts.SyntaxKind.SlashEqualsToken;
}
function assignmentOperator(kind: ts.SyntaxKind): "set" | "add" | "subtract" | "multiply" | "divide" {
  if (kind === ts.SyntaxKind.PlusEqualsToken) return "add";
  if (kind === ts.SyntaxKind.MinusEqualsToken) return "subtract";
  if (kind === ts.SyntaxKind.AsteriskEqualsToken) return "multiply";
  if (kind === ts.SyntaxKind.SlashEqualsToken) return "divide";
  return "set";
}
function findMatchingLogicBlock(
  sourceFile: ts.SourceFile,
  node: ts.Node,
  blocks: FunctionLogicBlock[],
  kind: string
): FunctionLogicBlock | undefined {
  const range = toSourceRange(sourceFile, node);
  return blocks.filter((block) => block.kind === kind && rangeOverlaps(range, block.range))
    .sort((left, right) => rangeArea(left.range) - rangeArea(right.range) || left.id.localeCompare(right.id))[0];
}
function rangeOverlaps(left: SourceRange, right: SourceRange | undefined): boolean {
  if (!right) return true;
  const leftStart = (left.startLine * 1_000_000) + left.startCharacter;
  const leftEnd = (left.endLine * 1_000_000) + left.endCharacter;
  const rightStart = (right.startLine * 1_000_000) + right.startCharacter;
  const rightEnd = (right.endLine * 1_000_000) + right.endCharacter;
  return leftStart <= rightEnd && rightStart <= leftEnd;
}
function rangeArea(range: SourceRange): number {
  return ((range.endLine - range.startLine) * 1_000_000) + (range.endCharacter - range.startCharacter);
}
function readExecutionKind(functionNode: FunctionLikeWithBody): FunctionTutorDeclarationAnalysis["executionKind"] {
  const async = Boolean(ts.getModifiers(functionNode)?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword));
  const generator = Boolean(functionNode.asteriskToken);
  return async && generator ? "async-generator" : async ? "async" : generator ? "generator" : "sync";
}
function createEvidence(
  filePath: string,
  range: SourceRange,
  kind: FunctionTutorEvidence["kind"],
  certainty: FunctionTutorCertainty,
  summary: string
): FunctionTutorEvidence {
  return { filePath, range, kind, certainty, summary };
}
