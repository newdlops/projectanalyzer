/**
 * TypeScript/JavaScript static Tutor adapter. It translates parser-proven
 * declaration, predicate, mutation, and callsite syntax into the language-
 * neutral Tutor program without evaluating source code.
 */

import * as ts from "typescript";
import { createContentHash } from "../../shared/hash";
import type { SourceRange, SymbolNode } from "../../shared/types";
import type { FunctionLogicAnalysis, FunctionLogicBlock } from "../functionLogic";
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
import type {
  FunctionTutorAssignmentTarget,
  FunctionTutorCertainty,
  FunctionTutorConstraint,
  FunctionTutorDeclarationAnalysis,
  FunctionTutorDeclarationInput,
  FunctionTutorEvidence,
  FunctionTutorExpression,
  FunctionTutorGap,
  FunctionTutorMemberFact,
  FunctionTutorOperation,
  FunctionTutorParameterFact,
  FunctionTutorParameterTypeKind,
  FunctionTutorProgram,
  FunctionTutorProgramBinding,
  FunctionTutorProgramBlock,
  FunctionTutorStaticValue
} from "./types";

const MAX_EXPRESSION_DEPTH = 12;

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
  return withFunctionTutorDocumentation(
    analyzeTypeScriptLikeDeclaration(sourceFile, functionNode, input.functionNode, input.functionLogic),
    input.sourceText
  );
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
  functionLogic: FunctionLogicAnalysis
): FunctionTutorDeclarationAnalysis {
  const gaps: FunctionTutorGap[] = [];
  const bindingsByName = new Map<string, string>();
  for (const binding of functionLogic.valueBindings ?? []) bindingsByName.set(binding.name, binding.id);
  const parameters = functionNode.parameters.map((parameter, index) =>
    createParameterFact(sourceFile, graphNode.filePath, parameter, index, bindingsByName, gaps)
  );
  const parameterByName = new Map(parameters.map((parameter) => [parameter.name, parameter]));
  const program = createProgram(sourceFile, functionNode, graphNode.filePath, functionLogic, parameters, bindingsByName, gaps);
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
  const typeFacts = readTypeFacts(parameter.type, sourceFile);
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
  const memberFacts = readParameterMembers(parameter, sourceFile);
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
    memberFacts,
    declarationEvidence: evidence,
    gaps: ownGaps
  };
}

/** Maps a small, safe subset of TS type syntax to candidate-domain facts. */
function readTypeFacts(
  type: ts.TypeNode | undefined,
  sourceFile: ts.SourceFile
): { kind: FunctionTutorParameterTypeKind; literalValues: FunctionTutorStaticValue[] } {
  if (!type) return { kind: "unknown", literalValues: [] };
  if (type.kind === ts.SyntaxKind.BooleanKeyword) return { kind: "boolean", literalValues: [] };
  if (type.kind === ts.SyntaxKind.NumberKeyword || type.kind === ts.SyntaxKind.BigIntKeyword) return { kind: "number", literalValues: [] };
  if (type.kind === ts.SyntaxKind.StringKeyword) return { kind: "string", literalValues: [] };
  if (type.kind === ts.SyntaxKind.NullKeyword) return { kind: "null", literalValues: [{ kind: "null" }] };
  if (ts.isLiteralTypeNode(type)) {
    const value = readStaticValue(type.literal, sourceFile);
    return { kind: "literal-union", literalValues: value.kind === "unknown" ? [] : [value] };
  }
  if (ts.isUnionTypeNode(type)) {
    const literalValues = type.types.flatMap((member) => readTypeFacts(member, sourceFile).literalValues);
    if (literalValues.length > 0) return { kind: "literal-union", literalValues };
    return { kind: "unknown", literalValues: [] };
  }
  if (ts.isArrayTypeNode(type)) return { kind: "array", literalValues: [] };
  if (ts.isTupleTypeNode(type)) return { kind: "tuple", literalValues: [] };
  if (ts.isTypeLiteralNode(type)) return { kind: "object", literalValues: [] };
  if (ts.isFunctionTypeNode(type) || ts.isConstructorTypeNode(type)) return { kind: "callable", literalValues: [] };
  if (ts.isTypeReferenceNode(type)) {
    const text = type.typeName.getText(sourceFile);
    if (text === "Array" || text === "ReadonlyArray") return { kind: "array", literalValues: [] };
    if (text === "Record" || text === "Object") return { kind: "object", literalValues: [] };
    return { kind: "unknown", literalValues: [] };
  }
  return { kind: "unknown", literalValues: [] };
}

/** Extracts direct named object members only; deeper type chasing remains bounded. */
function readParameterMembers(parameter: ts.ParameterDeclaration, sourceFile: ts.SourceFile): FunctionTutorMemberFact[] {
  const members: FunctionTutorMemberFact[] = [];
  if (!ts.isObjectBindingPattern(parameter.name)) return members;
  for (const element of parameter.name.elements.slice(0, 8)) {
    if (!ts.isIdentifier(element.name)) continue;
    members.push({
      path: [element.propertyName?.getText(sourceFile) ?? element.name.text],
      typeKind: "unknown",
      optional: Boolean(element.initializer),
      literalValues: []
    });
  }
  return members;
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
  return {
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
  const block = findProgramBlockForNode(sourceFile, node, analysis.blocks, blocksById, expectedKind);
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
    for (const declaration of node.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name)) continue;
      const bindingId = ensureBinding(declaration.name.text, "local", bindingsByName, programBindings);
      if (declaration.initializer) block.operations.push({
        kind: "define",
        bindingId,
        value: toExpression(declaration.initializer, sourceFile, bindingsByName)
      });
    }
    return;
  }
  if (ts.isExpressionStatement(node)) {
    const operation = readExpressionOperation(node.expression, sourceFile, bindingsByName);
    if (operation) {
      block.operations.push(operation);
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
  if (!member || member.path.some((part) => !isFunctionTutorSafeObjectKey(part))) return undefined;
  return { kind: "member", bindingId: member.bindingId, path: member.path };
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
        const constraint = readConstraint(sourceFile, expression, block.id, parameterByName);
        if (constraint) constraints.push(constraint);
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
  return createConstraint(sourceFile, expression, blockId, parameterRef.parameter, parameterRef.path, operator, operand);
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
  if (!member) return undefined;
  const parameter = [...parameterByName.values()].find((candidate) => candidate.bindingId === member.bindingId);
  return parameter ? { parameter, path: member.path } : undefined;
}

/** Reads an identifier/property chain without traversing arbitrary expressions. */
function readBindingMember(
  expression: ts.Expression,
  bindingsByName: Map<string, string>
): { bindingId: string; path: string[] } | undefined {
  const path: string[] = [];
  let current: ts.Expression = expression;
  while (ts.isPropertyAccessExpression(current)) {
    path.unshift(current.name.text);
    current = current.expression;
  }
  if (!ts.isIdentifier(current)) return undefined;
  const bindingId = bindingsByName.get(current.text);
  return bindingId ? { bindingId, path } : undefined;
}

/**
 * Converts a finite expression subset into IR. Recursive descent is bounded by
 * MAX_EXPRESSION_DEPTH and AST nodes are acyclic; unsupported forms terminate
 * as explicit unknowns instead of evaluating source text.
 */
function toExpression(
  expression: ts.Expression,
  sourceFile: ts.SourceFile,
  bindingsByName: Map<string, string>,
  depth = 0
): FunctionTutorExpression {
  if (depth >= MAX_EXPRESSION_DEPTH) return { kind: "unsupported", reason: "depth-budget", summary: "Expression nesting exceeds the Tutor limit." };
  const staticValue = readStaticValue(expression, sourceFile);
  if (staticValue.kind !== "unknown") return { kind: "literal", value: staticValue };
  if (ts.isIdentifier(expression)) {
    const bindingId = bindingsByName.get(expression.text);
    return bindingId
      ? { kind: "binding", bindingId }
      : { kind: "unsupported", reason: "ambiguous-binding", summary: `Untracked binding ${expression.text}.` };
  }
  const member = readBindingMember(expression, bindingsByName);
  if (member) return { kind: "member", object: { kind: "binding", bindingId: member.bindingId }, path: member.path, optional: false };
  if (ts.isParenthesizedExpression(expression)) return toExpression(expression.expression, sourceFile, bindingsByName, depth + 1);
  if (ts.isPrefixUnaryExpression(expression)) {
    const operator = expression.operator === ts.SyntaxKind.ExclamationToken ? "not"
      : expression.operator === ts.SyntaxKind.PlusToken ? "plus"
        : expression.operator === ts.SyntaxKind.MinusToken ? "minus" : undefined;
    return operator
      ? { kind: "unary", operator, operand: toExpression(expression.operand, sourceFile, bindingsByName, depth + 1) }
      : { kind: "unsupported", reason: "unsupported-expression", summary: "Unsupported unary expression." };
  }
  if (ts.isTypeOfExpression(expression)) return { kind: "unary", operator: "typeof", operand: toExpression(expression.expression, sourceFile, bindingsByName, depth + 1) };
  if (ts.isBinaryExpression(expression)) {
    const operator = binaryExpressionOperator(expression.operatorToken.kind);
    if (!operator) return { kind: "unsupported", reason: "unsupported-expression", summary: "Unsupported binary expression." };
    return {
      kind: "binary",
      operator,
      left: toExpression(expression.left, sourceFile, bindingsByName, depth + 1),
      right: toExpression(expression.right, sourceFile, bindingsByName, depth + 1)
    };
  }
  if (ts.isConditionalExpression(expression)) return {
    kind: "conditional",
    condition: toExpression(expression.condition, sourceFile, bindingsByName, depth + 1),
    whenTrue: toExpression(expression.whenTrue, sourceFile, bindingsByName, depth + 1),
    whenFalse: toExpression(expression.whenFalse, sourceFile, bindingsByName, depth + 1)
  };
  if (ts.isArrayLiteralExpression(expression)) return {
    kind: "array",
    items: expression.elements.slice(0, 8).map((element) => ts.isExpression(element)
      ? toExpression(element, sourceFile, bindingsByName, depth + 1)
      : { kind: "unsupported", reason: "unsupported-expression", summary: "Unsupported array spread." })
  };
  if (ts.isObjectLiteralExpression(expression)) return {
    kind: "object",
    entries: expression.properties.slice(0, 8).flatMap((property) => {
      if (!ts.isPropertyAssignment(property)) return [];
      const key = readPropertyName(property.name);
      return key && isFunctionTutorSafeObjectKey(key)
        ? [{ key, value: toExpression(property.initializer, sourceFile, bindingsByName, depth + 1) }]
        : [];
    })
  };
  if (ts.isCallExpression(expression) || ts.isNewExpression(expression)) {
    return { kind: "unsupported", reason: "dynamic-call", summary: "Calls are not executed by Function Guide static input cases." };
  }
  return { kind: "unsupported", reason: "unsupported-expression", summary: "Unsupported source expression." };
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

function binaryExpressionOperator(kind: ts.SyntaxKind): Extract<FunctionTutorExpression, { kind: "binary" }>["operator"] | undefined {
  const byKind = new Map<ts.SyntaxKind, Extract<FunctionTutorExpression, { kind: "binary" }>["operator"]>([
    [ts.SyntaxKind.EqualsEqualsToken, "eq"], [ts.SyntaxKind.EqualsEqualsEqualsToken, "strict-eq"],
    [ts.SyntaxKind.ExclamationEqualsToken, "neq"], [ts.SyntaxKind.ExclamationEqualsEqualsToken, "strict-neq"],
    [ts.SyntaxKind.LessThanToken, "lt"], [ts.SyntaxKind.LessThanEqualsToken, "lte"],
    [ts.SyntaxKind.GreaterThanToken, "gt"], [ts.SyntaxKind.GreaterThanEqualsToken, "gte"],
    [ts.SyntaxKind.PlusToken, "add"], [ts.SyntaxKind.MinusToken, "subtract"], [ts.SyntaxKind.AsteriskToken, "multiply"],
    [ts.SyntaxKind.SlashToken, "divide"], [ts.SyntaxKind.PercentToken, "modulo"], [ts.SyntaxKind.InKeyword, "in"]
  ]);
  return byKind.get(kind);
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
