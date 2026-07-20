/**
 * JSX-specific Function Logic extraction for TypeScript-like languages. The
 * module expands source-ordered render structure, JSX choices, list rendering,
 * and event bindings without claiming that framework component code executes
 * as a direct JavaScript call.
 */

import * as ts from "typescript";
import type { SourceRange } from "../../../shared/types";
import {
  findTypeScriptLikeJsxMapCallback,
  readTypeScriptLikeJsxComponentReference
} from "../../languages/typescriptLike/typescriptLikeJsxSyntax";
import {
  createFunctionLogicBlockId
} from "../core/functionLogicSupport";
import {
  appendDirectBlock,
  createStructuredControlEdges,
  type ControlBranch,
  type ControlRecord,
  type InternalBlock,
  type LogicContainer
} from "../core/structuredControlFlow";
import type {
  FunctionLogicBlock,
  FunctionLogicConfidence,
  FunctionLogicEdge,
  FunctionLogicEdgeKind
} from "../types";

/** One transfer that should continue into the enclosing JSX return block. */
export type TypeScriptJsxLogicExit = {
  sourceId: string;
  kind: FunctionLogicEdgeKind;
  label?: string;
  confidence: FunctionLogicConfidence;
};

/** Bounded render-flow fragment ready to splice before a return block. */
export type TypeScriptJsxLogicExpansion = {
  blocks: FunctionLogicBlock[];
  edges: FunctionLogicEdge[];
  entryBlockId?: string;
  exits: TypeScriptJsxLogicExit[];
  omittedBlockCount: number;
};

/** Explicit input keeps parser and graph ownership outside JSX extraction. */
export type TypeScriptJsxLogicInput = {
  sourceFile: ts.SourceFile;
  filePath: string;
  expression: ts.Expression;
  baseDepth: number;
  maxBlocks: number;
};

type PendingJsxTask = {
  node: ts.Node;
  role: "syntax" | "event";
  containerId: string;
  depth: number;
  branchLabel?: string;
  ownerTag?: string;
};

type JsxBranchDraft = {
  role: "then" | "else" | "loopBody";
  edgeKind: FunctionLogicEdgeKind;
  label: string;
  node?: ts.Node;
};

const ROOT_CONTAINER_ID = "logic-container:jsx-root";

/** Returns true only when the returned expression can expose JSX render flow. */
export function hasTypeScriptJsxLogic(expression: ts.Expression): boolean {
  const pending: ts.Node[] = [expression];
  while (pending.length > 0) {
    const node = pending.pop();
    if (!node) {
      continue;
    }
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) {
      return true;
    }
    if (isFunctionBoundary(node)) {
      continue;
    }
    if (ts.isCallExpression(node)) {
      const mapCallback = findTypeScriptLikeJsxMapCallback(node);
      if (mapCallback) {
        pending.push(mapCallback.body);
      }
      pushChildren(pending, node, mapCallback);
      continue;
    }
    pushChildren(pending, node);
  }
  return false;
}

/**
 * Builds an iterative render walk whose condition and loop continuations reuse
 * the language-neutral structured-flow engine. Synthetic boundaries are
 * removed from the result so the caller can connect the fragment to its return.
 */
export function analyzeTypeScriptJsxLogic(
  input: TypeScriptJsxLogicInput
): TypeScriptJsxLogicExpansion {
  const boundedLimit = Number.isFinite(input.maxBlocks)
    ? Math.max(0, Math.floor(input.maxBlocks))
    : 0;
  const containers = new Map<string, LogicContainer>([[ROOT_CONTAINER_ID, {
    id: ROOT_CONTAINER_ID,
    role: "root"
  }]]);
  const directBlockIdsByContainer = new Map<string, string[]>();
  const blocksById = new Map<string, InternalBlock>();
  const controlsByBlockId = new Map<string, ControlRecord>();
  const visibleBlocks: InternalBlock[] = [];
  const pending: PendingJsxTask[] = [{
    node: input.expression,
    role: "syntax",
    containerId: ROOT_CONTAINER_ID,
    depth: input.baseDepth
  }];
  let omittedBlockCount = 0;

  const appendBlock = (
    task: PendingJsxTask,
    node: ts.Node,
    kind: FunctionLogicBlock["kind"],
    label: string,
    detail: string,
    confidence: FunctionLogicConfidence
  ): InternalBlock | undefined => {
    if (visibleBlocks.length >= boundedLimit) {
      omittedBlockCount += 1;
      return undefined;
    }
    const range = toSourceRange(input.sourceFile, node);
    const block: InternalBlock = {
      id: createFunctionLogicBlockId(input.filePath, kind, range, label),
      kind,
      label,
      detail,
      depth: task.depth,
      parentBlockId: containers.get(task.containerId)?.ownerBlockId,
      branchLabel: task.branchLabel,
      confidence,
      filePath: input.filePath,
      range,
      containerId: task.containerId
    };
    visibleBlocks.push(block);
    blocksById.set(block.id, block);
    appendDirectBlock(directBlockIdsByContainer, task.containerId, block.id);
    return block;
  };

  while (pending.length > 0) {
    const task = pending.pop();
    if (!task) {
      continue;
    }
    if (task.role === "event" && ts.isJsxAttribute(task.node)) {
      const eventName = task.node.name.getText(input.sourceFile);
      appendBlock(
        task,
        task.node,
        "event",
        `bind ${eventName}`,
        createEventDetail(input.sourceFile, task.node, eventName),
        "exact"
      );
      continue;
    }

    const node = unwrapTransparentNode(task.node);
    if (ts.isJsxElement(node)) {
      const tag = appendRenderElement(
        input.sourceFile,
        task,
        node.openingElement,
        appendBlock
      );
      scheduleElementContents(
        pending,
        input.sourceFile,
        node.openingElement.attributes.properties,
        node.children,
        task,
        tag
      );
      continue;
    }
    if (ts.isJsxSelfClosingElement(node)) {
      const tag = appendRenderElement(input.sourceFile, task, node, appendBlock);
      scheduleElementContents(
        pending,
        input.sourceFile,
        node.attributes.properties,
        [],
        task,
        tag
      );
      continue;
    }
    if (ts.isJsxFragment(node)) {
      appendBlock(
        task,
        node.openingFragment,
        "render",
        "render Fragment",
        createRenderDetail("Fragment", false, [], task.ownerTag),
        "exact"
      );
      pushSyntaxTasks(pending, node.children, task, "Fragment");
      continue;
    }
    if (ts.isJsxExpression(node)) {
      if (node.expression) {
        pending.push({ ...task, node: node.expression, role: "syntax" });
      }
      continue;
    }
    if (ts.isConditionalExpression(node)) {
      const conditionText = normalizeSourceText(node.condition.getText(input.sourceFile));
      const block = appendBlock(
        task,
        node.condition,
        "condition",
        `render if ${conditionText || "condition"}`,
        "Chooses which JSX value contributes to this render path.",
        "exact"
      );
      if (block) {
        scheduleBranches(pending, containers, controlsByBlockId, block, task, [{
          role: "then",
          edgeKind: "true",
          label: "true",
          node: node.whenTrue
        }, {
          role: "else",
          edgeKind: "false",
          label: "false",
          node: node.whenFalse
        }]);
      }
      continue;
    }
    if (ts.isBinaryExpression(node) && isJsxLogicalOperator(node.operatorToken.kind)) {
      const conditionText = normalizeSourceText(node.left.getText(input.sourceFile));
      const isTruthyRender = node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken;
      const block = appendBlock(
        task,
        node.left,
        "condition",
        `render if ${conditionText || "condition"}`,
        isTruthyRender
          ? "Includes the right-hand JSX value only when the condition is truthy."
          : "Uses the right-hand JSX fallback when the left value does not contribute.",
        "exact"
      );
      if (block) {
        scheduleBranches(pending, containers, controlsByBlockId, block, task, [{
          role: "then",
          edgeKind: "true",
          label: isTruthyRender ? "truthy" : "present",
          node: isTruthyRender ? node.right : undefined
        }, {
          role: "else",
          edgeKind: "false",
          label: node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
            ? "nullish"
            : "falsy",
          node: isTruthyRender ? undefined : node.right
        }]);
      }
      continue;
    }
    if (ts.isCallExpression(node)) {
      const mapCallback = findTypeScriptLikeJsxMapCallback(node);
      if (mapCallback) {
        const receiver = readMapReceiver(input.sourceFile, node);
        const item = normalizeSourceText(
          mapCallback.parameters[0]?.name.getText(input.sourceFile) ?? "item"
        );
        const block = appendBlock(
          task,
          node,
          "loop",
          `render each ${item || "item"} from ${receiver}`,
          "A concise .map callback contributes repeated JSX. Receiver dispatch and item count remain runtime-dependent.",
          "inferred"
        );
        if (block) {
          scheduleBranches(pending, containers, controlsByBlockId, block, task, [{
            role: "loopBody",
            edgeKind: "iterate",
            label: `each ${item || "item"}`,
            node: mapCallback.body
          }], "loop", "inferred");
        }
        continue;
      }
      const callText = normalizeSourceText(node.getText(input.sourceFile)) || "call";
      appendBlock(
        task,
        node,
        "call",
        `evaluate ${callText}`,
        task.ownerTag
          ? `Evaluates this expression while building <${task.ownerTag}> JSX.`
          : "Evaluates this expression while building JSX output.",
        "exact"
      );
      const jsxArguments = node.arguments.filter((argument) => hasTypeScriptJsxLogic(argument));
      pushSyntaxTasks(pending, jsxArguments, task, task.ownerTag);
      continue;
    }
    if (isFunctionBoundary(node)) {
      continue;
    }
    pushSyntaxTasks(pending, getImmediateChildren(node), task, task.ownerTag);
  }

  if (visibleBlocks.length === 0) {
    return { blocks: [], edges: [], exits: [], omittedBlockCount };
  }

  const boundaryRange = toSourceRange(input.sourceFile, input.expression);
  const entryBlock = createBoundaryBlock(
    input.filePath,
    "entry",
    "Enter JSX render flow",
    boundaryRange
  );
  const exitBlock = createBoundaryBlock(
    input.filePath,
    "exit",
    "Leave JSX render flow",
    boundaryRange
  );
  const structuredEdges = createStructuredControlEdges({
    entryBlock,
    exitBlock,
    visibleBlocks,
    blocksById,
    containers,
    controlsByBlockId,
    directBlockIdsByContainer,
    rootContainerId: ROOT_CONTAINER_ID
  });
  const entryBlockId = structuredEdges.find((edge) =>
    edge.sourceId === entryBlock.id && edge.targetId !== exitBlock.id
  )?.targetId;
  const exits = structuredEdges
    .filter((edge) => edge.targetId === exitBlock.id && edge.sourceId !== entryBlock.id)
    .map((edge) => ({
      sourceId: edge.sourceId,
      kind: edge.kind,
      label: edge.label,
      confidence: edge.confidence
    }));
  const edges = structuredEdges.filter((edge) =>
    edge.sourceId !== entryBlock.id && edge.targetId !== exitBlock.id
  );

  return {
    blocks: visibleBlocks.map(({ containerId: _containerId, ...block }) => block),
    edges,
    entryBlockId,
    exits,
    omittedBlockCount
  };
}

/** Appends one custom or intrinsic JSX element as a render step. */
function appendRenderElement(
  sourceFile: ts.SourceFile,
  task: PendingJsxTask,
  element: ts.JsxOpeningLikeElement,
  appendBlock: (
    task: PendingJsxTask,
    node: ts.Node,
    kind: FunctionLogicBlock["kind"],
    label: string,
    detail: string,
    confidence: FunctionLogicConfidence
  ) => InternalBlock | undefined
): string {
  const component = readTypeScriptLikeJsxComponentReference(sourceFile, element);
  const tag = component?.text
    || normalizeSourceText(element.tagName.getText(sourceFile))
    || "element";
  const attributes = readAttributeNames(sourceFile, element.attributes.properties);
  appendBlock(
    task,
    element,
    "render",
    `render <${tag}>`,
    createRenderDetail(tag, Boolean(component), attributes, task.ownerTag),
    "exact"
  );
  return tag;
}

/** Schedules prop evaluation, event binding, then nested JSX children. */
function scheduleElementContents(
  pending: PendingJsxTask[],
  sourceFile: ts.SourceFile,
  attributes: readonly ts.JsxAttributeLike[],
  children: readonly ts.JsxChild[],
  task: PendingJsxTask,
  ownerTag: string
): void {
  const tasks: PendingJsxTask[] = [];
  for (const attribute of attributes) {
    if (ts.isJsxAttribute(attribute)) {
      const name = attribute.name.getText(sourceFile);
      if (isEventAttribute(name)) {
        tasks.push({
          node: attribute,
          role: "event",
          containerId: task.containerId,
          depth: task.depth + 1,
          branchLabel: task.branchLabel,
          ownerTag
        });
        continue;
      }
      const expression = readAttributeExpression(attribute);
      if (expression) {
        tasks.push({
          node: expression,
          role: "syntax",
          containerId: task.containerId,
          depth: task.depth + 1,
          branchLabel: task.branchLabel,
          ownerTag
        });
      }
      continue;
    }
    tasks.push({
      node: attribute.expression,
      role: "syntax",
      containerId: task.containerId,
      depth: task.depth + 1,
      branchLabel: task.branchLabel,
      ownerTag
    });
  }
  for (const child of children) {
    tasks.push({
      node: child,
      role: "syntax",
      containerId: task.containerId,
      depth: task.depth + 1,
      branchLabel: task.branchLabel,
      ownerTag
    });
  }
  pushTasks(pending, tasks);
}

/** Adds structured child containers and queues their expressions source-first. */
function scheduleBranches(
  pending: PendingJsxTask[],
  containers: Map<string, LogicContainer>,
  controlsByBlockId: Map<string, ControlRecord>,
  block: InternalBlock,
  task: PendingJsxTask,
  branches: readonly JsxBranchDraft[],
  kind: ControlRecord["kind"] = "condition",
  confidence: FunctionLogicConfidence = "exact"
): void {
  const controlBranches: ControlBranch[] = [];
  const tasks: PendingJsxTask[] = [];
  for (let index = 0; index < branches.length; index += 1) {
    const branch = branches[index];
    const containerId = `${block.id}:container:${branch.role}:${index}`;
    containers.set(containerId, {
      id: containerId,
      role: branch.role,
      ownerBlockId: block.id,
      parentContainerId: task.containerId,
      label: branch.label
    });
    controlBranches.push({
      containerId,
      edgeKind: branch.edgeKind,
      label: branch.label
    });
    if (branch.node) {
      tasks.push({
        node: branch.node,
        role: "syntax",
        containerId,
        depth: task.depth + 1,
        branchLabel: branch.label,
        ownerTag: task.ownerTag
      });
    }
  }
  controlsByBlockId.set(block.id, { kind, branches: controlBranches, confidence });
  pushTasks(pending, tasks);
}

/** Queues syntax nodes in source order on the shared LIFO work stack. */
function pushSyntaxTasks(
  pending: PendingJsxTask[],
  nodes: readonly ts.Node[],
  task: PendingJsxTask,
  ownerTag?: string
): void {
  const tasks = nodes.map((node): PendingJsxTask => ({
    node,
    role: "syntax",
    containerId: task.containerId,
    depth: task.depth + 1,
    branchLabel: task.branchLabel,
    ownerTag
  }));
  pushTasks(pending, tasks);
}

/** Pushes prebuilt tasks in reverse so their first item is processed first. */
function pushTasks(pending: PendingJsxTask[], tasks: readonly PendingJsxTask[]): void {
  for (let index = tasks.length - 1; index >= 0; index -= 1) {
    pending.push(tasks[index]);
  }
}

/** Produces framework-neutral JSX element detail without runtime claims. */
function createRenderDetail(
  tag: string,
  component: boolean,
  attributes: readonly string[],
  ownerTag?: string
): string {
  const relation = component
    ? `Creates a custom JSX component element for <${tag}>; the framework decides when its code executes.`
    : `Creates JSX structure for <${tag}>.`;
  const attributeDetail = attributes.length > 0
    ? ` Attributes: ${attributes.join(", ")}.`
    : "";
  const ownerDetail = ownerTag ? ` Nested under <${ownerTag}> in source.` : "";
  return `${relation}${attributeDetail}${ownerDetail}`;
}

/** Explains event binding while keeping handler execution off the render path. */
function createEventDetail(
  sourceFile: ts.SourceFile,
  attribute: ts.JsxAttribute,
  eventName: string
): string {
  const expression = readAttributeExpression(attribute);
  if (expression && (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression))) {
    return `Binds an inline ${eventName} callback. Its body runs only after framework event dispatch, not during render.`;
  }
  const value = expression ? normalizeSourceText(expression.getText(sourceFile)) : undefined;
  if (expression && ts.isCallExpression(expression)) {
    return `Evaluates ${value || "a handler factory"} during render, then binds its result to ${eventName}. Later handler execution is event-driven.`;
  }
  return value
    ? `Binds ${value} to ${eventName}. Handler execution is outside the render path.`
    : `Binds ${eventName}. Handler execution is outside the render path.`;
}

/** Reads a bounded attribute-name list for graph detail. */
function readAttributeNames(
  sourceFile: ts.SourceFile,
  attributes: readonly ts.JsxAttributeLike[]
): string[] {
  const names = attributes.map((attribute) => ts.isJsxAttribute(attribute)
    ? attribute.name.getText(sourceFile)
    : "...spread"
  );
  return names.length <= 8
    ? names
    : [...names.slice(0, 8), `+${names.length - 8} more`];
}

/** Returns the JavaScript expression inside one JSX attribute initializer. */
function readAttributeExpression(attribute: ts.JsxAttribute): ts.Expression | undefined {
  const initializer = attribute.initializer;
  return initializer && ts.isJsxExpression(initializer)
    ? initializer.expression
    : undefined;
}

/** Event attributes are explicit bindings, not calls made while rendering. */
function isEventAttribute(name: string): boolean {
  return /^on\p{Lu}/u.test(name);
}

/** Recognizes JSX-level boolean and fallback selection operators. */
function isJsxLogicalOperator(kind: ts.SyntaxKind): boolean {
  return kind === ts.SyntaxKind.AmpersandAmpersandToken
    || kind === ts.SyntaxKind.BarBarToken
    || kind === ts.SyntaxKind.QuestionQuestionToken;
}

/** Extracts the receiver whose `.map` callback contributes JSX. */
function readMapReceiver(sourceFile: ts.SourceFile, call: ts.CallExpression): string {
  const callee = unwrapTransparentNode(call.expression);
  return ts.isPropertyAccessExpression(callee)
    ? normalizeSourceText(callee.expression.getText(sourceFile)) || "items"
    : "items";
}

/** Removes syntax-only wrappers before classifying one JSX task. */
function unwrapTransparentNode(node: ts.Node): ts.Node {
  let current = node;
  while (ts.isParenthesizedExpression(current)
    || ts.isAsExpression(current)
    || ts.isTypeAssertionExpression(current)
    || ts.isNonNullExpression(current)
    || ts.isSatisfiesExpression(current)
    || ts.isAwaitExpression(current)) {
    current = current.expression;
  }
  return current;
}

/** Nested callback bodies stay independent except for the narrow `.map` rule. */
function isFunctionBoundary(node: ts.Node): boolean {
  return ts.isArrowFunction(node)
    || ts.isFunctionExpression(node)
    || ts.isFunctionDeclaration(node)
    || ts.isMethodDeclaration(node);
}

/** Returns immediate compiler children without recursive visitor calls. */
function getImmediateChildren(node: ts.Node): ts.Node[] {
  const children: ts.Node[] = [];
  ts.forEachChild(node, (child) => {
    children.push(child);
    return undefined;
  });
  return children;
}

/** Adds immediate children except a callback handled through an inferred map boundary. */
function pushChildren(
  pending: ts.Node[],
  node: ts.Node,
  excluded?: ts.Node
): void {
  const children = getImmediateChildren(node).filter((child) => child !== excluded);
  for (let index = children.length - 1; index >= 0; index -= 1) {
    pending.push(children[index]);
  }
}

/** Converts TypeScript offsets to the shared zero-based editor range. */
function toSourceRange(sourceFile: ts.SourceFile, node: ts.Node): SourceRange {
  const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
  return {
    startLine: start.line,
    startCharacter: start.character,
    endLine: end.line,
    endCharacter: end.character
  };
}

/** Creates hidden CFG boundaries used only while deriving fragment continuations. */
function createBoundaryBlock(
  filePath: string,
  kind: "entry" | "exit",
  label: string,
  range: SourceRange
): FunctionLogicBlock {
  return {
    id: createFunctionLogicBlockId(filePath, kind, range, label),
    kind,
    label,
    detail: label,
    depth: 0,
    confidence: "exact",
    filePath,
    range
  };
}

/** Normalizes source labels while preserving their complete semantic text. */
function normalizeSourceText(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}
