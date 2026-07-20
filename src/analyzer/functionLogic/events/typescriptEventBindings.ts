/**
 * TypeScript/JavaScript event-binding syntax recognition. The module keeps
 * handler registration separate from synchronous calls and exposes only
 * source-proven handler references to the Function Logic pipeline.
 */

import * as ts from "typescript";
import type { FunctionLogicConfidence } from "../types";

/** Stable named handler that can be resolved to an independently analyzed function. */
export type TypeScriptEventHandlerReference = {
  node: ts.Expression;
  name: string;
  text: string;
};

/** One source-level event boundary and the callback value installed there. */
export type TypeScriptEventBinding = {
  node: ts.Node;
  handlerNode?: ts.Expression;
  handler?: TypeScriptEventHandlerReference;
  handlerText?: string;
  handlerKind: "reference" | "inline" | "factory" | "unknown";
  eventName: string;
  registrationText: string;
  /** Listener API/property name used only to suppress its ordinary call edge. */
  registrationName?: string;
  kind: "jsx" | "listenerCall" | "eventProperty";
  confidence: FunctionLogicConfidence;
};

type ListenerMethodProfile = {
  eventArgument?: number;
  handlerArgument: number;
  confidence: FunctionLogicConfidence;
};

/** Common callback-registration APIs with their event and handler positions. */
const LISTENER_METHODS: Readonly<Record<string, ListenerMethodProfile>> = {
  addEventListener: { eventArgument: 0, handlerArgument: 1, confidence: "exact" },
  addListener: { eventArgument: 0, handlerArgument: 1, confidence: "inferred" },
  on: { eventArgument: 0, handlerArgument: 1, confidence: "inferred" },
  once: { eventArgument: 0, handlerArgument: 1, confidence: "inferred" },
  prependListener: { eventArgument: 0, handlerArgument: 1, confidence: "inferred" },
  prependOnceListener: { eventArgument: 0, handlerArgument: 1, confidence: "inferred" },
  subscribe: { handlerArgument: 0, confidence: "inferred" }
};

/** Lowercase DOM/stream event-property prefixes admitted as inferred bindings. */
const EVENT_PROPERTY_PREFIXES = [
  "abort", "before", "blur", "change", "click", "close", "connect", "data",
  "disconnect", "drag", "drop", "end", "error", "focus", "input", "key",
  "load", "message", "mouse", "open", "pointer", "progress", "ready", "resize",
  "scroll", "submit", "touch", "unload", "wheel"
] as const;

/**
 * Collects event registrations without entering nested function bodies. An
 * explicit stack keeps callback-heavy source bounded and cycle-free.
 */
export function collectTypeScriptEventBindings(
  sourceFile: ts.SourceFile,
  root: ts.Node
): TypeScriptEventBinding[] {
  const bindings: TypeScriptEventBinding[] = [];
  const pending: ts.Node[] = [root];

  while (pending.length > 0) {
    const node = pending.pop();
    if (!node) {
      continue;
    }
    if (node !== root && isFunctionBoundary(node)) {
      continue;
    }
    const binding = readTypeScriptEventBinding(sourceFile, node);
    if (binding) {
      bindings.push(binding);
    }
    const children = getImmediateChildren(node);
    for (let index = children.length - 1; index >= 0; index -= 1) {
      const child = children[index];
      if (binding?.handlerNode === child && binding.handlerKind !== "factory") {
        continue;
      }
      pending.push(child);
    }
  }

  return bindings.sort((left, right) =>
    left.node.getStart(sourceFile) - right.node.getStart(sourceFile)
  );
}

/** Recognizes one JSX attribute, listener call, or event-property assignment. */
export function readTypeScriptEventBinding(
  sourceFile: ts.SourceFile,
  node: ts.Node
): TypeScriptEventBinding | undefined {
  if (ts.isJsxAttribute(node)) {
    return readJsxEventBinding(sourceFile, node);
  }
  if (ts.isCallExpression(node)) {
    return readListenerCallBinding(sourceFile, node);
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
    return readEventPropertyBinding(sourceFile, node);
  }
  return undefined;
}

/** Creates the compact graph label shared by JSX and imperative registrations. */
export function createTypeScriptEventBindingLabel(binding: TypeScriptEventBinding): string {
  const handler = binding.handler?.text
    || (binding.handlerKind === "inline" ? "inline handler" : "handler");
  return completeText(`bind ${binding.eventName} → ${handler}`, "bind event handler", 150);
}

/** Explains the dispatch boundary without presenting the handler as a direct call. */
export function createTypeScriptEventBindingDetail(binding: TypeScriptEventBinding): string {
  if (binding.handlerKind === "inline") {
    return `Binds an inline ${binding.eventName} callback. `
      + "Its body runs only after event dispatch, not in this synchronous flow.";
  }
  if (binding.handlerKind === "factory") {
    const handlerFactory = completeText(
      binding.handlerText || "a handler factory",
      "a handler factory",
      120
    );
    return `Evaluates ${handlerFactory} now and binds its result to ${binding.eventName}. `
      + "Later handler execution is event-driven.";
  }
  const handler = binding.handler?.text || "a handler value";
  const registration = binding.kind === "jsx"
    ? ""
    : ` through ${binding.registrationText}`;
  const evidence = binding.confidence === "exact"
    ? "The registration syntax is explicit."
    : "The API or property name suggests an event registration; verify its runtime type.";
  return `Registers ${handler} for ${binding.eventName}${registration}. ${evidence} `
    + "The handler runs after dispatch and does not return into this function's control path.";
}

/** Reads React-style event attributes while excluding lowercase data props. */
function readJsxEventBinding(
  sourceFile: ts.SourceFile,
  attribute: ts.JsxAttribute
): TypeScriptEventBinding | undefined {
  const eventName = attribute.name.getText(sourceFile);
  if (!/^on\p{Lu}/u.test(eventName)) {
    return undefined;
  }
  const initializer = attribute.initializer;
  const handlerNode = initializer && ts.isJsxExpression(initializer)
    ? initializer.expression
    : undefined;
  return createBinding(
    sourceFile,
    attribute,
    handlerNode,
    eventName,
    eventName,
    "jsx",
    "exact"
  );
}

/** Reads EventTarget, EventEmitter, and subscription-style callback registration. */
function readListenerCallBinding(
  sourceFile: ts.SourceFile,
  call: ts.CallExpression
): TypeScriptEventBinding | undefined {
  const method = readMemberName(call.expression);
  const profile = method ? LISTENER_METHODS[method] : undefined;
  if (!method || !profile) {
    return undefined;
  }
  const handlerNode = call.arguments[profile.handlerArgument];
  if (!handlerNode) {
    return undefined;
  }
  const eventArgument = profile.eventArgument === undefined
    ? undefined
    : call.arguments[profile.eventArgument];
  const eventName = eventArgument
    ? readEventName(sourceFile, eventArgument)
    : "subscription notification";
  return createBinding(
    sourceFile,
    call,
    handlerNode,
    eventName,
    completeText(call.expression.getText(sourceFile), method, 120),
    "listenerCall",
    profile.confidence,
    method
  );
}

/** Reads assignments such as `socket.onmessage = handleMessage`. */
function readEventPropertyBinding(
  sourceFile: ts.SourceFile,
  assignment: ts.BinaryExpression
): TypeScriptEventBinding | undefined {
  const propertyName = readEventPropertyName(assignment.left);
  if (!propertyName || !isLikelyEventProperty(propertyName)) {
    return undefined;
  }
  return createBinding(
    sourceFile,
    assignment,
    assignment.right,
    propertyName,
    completeText(assignment.left.getText(sourceFile), propertyName, 120),
    "eventProperty",
    "inferred",
    propertyName
  );
}

/** Classifies the handler expression and preserves a stable drill target when possible. */
function createBinding(
  sourceFile: ts.SourceFile,
  node: ts.Node,
  handlerNode: ts.Expression | undefined,
  eventName: string,
  registrationText: string,
  kind: TypeScriptEventBinding["kind"],
  confidence: FunctionLogicConfidence,
  registrationName?: string
): TypeScriptEventBinding {
  const unwrapped = handlerNode ? unwrapExpression(handlerNode) : undefined;
  const handler = unwrapped ? readStableHandler(sourceFile, unwrapped) : undefined;
  const handlerKind = handler
    ? "reference"
    : unwrapped && (ts.isArrowFunction(unwrapped) || ts.isFunctionExpression(unwrapped))
      ? "inline"
      : unwrapped && ts.isCallExpression(unwrapped)
        ? "factory"
        : "unknown";
  return {
    node,
    handlerNode,
    handler,
    handlerText: handlerNode
      ? completeText(handlerNode.getText(sourceFile), "handler", 120)
      : undefined,
    handlerKind,
    eventName: completeText(eventName, "event", 80),
    registrationText,
    registrationName,
    kind,
    confidence
  };
}

/** Resolves identifiers, members, string-key members, and `.bind(...)` wrappers. */
function readStableHandler(
  sourceFile: ts.SourceFile,
  expression: ts.Expression
): TypeScriptEventHandlerReference | undefined {
  let current = unwrapExpression(expression);
  if (ts.isCallExpression(current)) {
    const callee = unwrapExpression(current.expression);
    if (!ts.isPropertyAccessExpression(callee) || callee.name.text !== "bind") {
      return undefined;
    }
    current = unwrapExpression(callee.expression);
  }
  if (ts.isIdentifier(current)) {
    return { node: current, name: current.text, text: current.text };
  }
  if (ts.isPropertyAccessExpression(current)) {
    return {
      node: current,
      name: current.name.text,
      text: completeText(normalizeText(current.getText(sourceFile)), current.name.text, 120)
    };
  }
  if (ts.isElementAccessExpression(current)) {
    const argument = current.argumentExpression;
    if (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument)) {
      return {
        node: current,
        name: argument.text,
        text: completeText(normalizeText(current.getText(sourceFile)), argument.text, 120)
      };
    }
  }
  return undefined;
}

/** Extracts a method name only from explicit member access. */
function readMemberName(expression: ts.LeftHandSideExpression): string | undefined {
  const current = unwrapExpression(expression);
  if (ts.isPropertyAccessExpression(current)) {
    return current.name.text;
  }
  if (ts.isElementAccessExpression(current)) {
    const argument = current.argumentExpression;
    return ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument)
      ? argument.text
      : undefined;
  }
  return undefined;
}

/** Retains literal event names and bounded dynamic event expressions. */
function readEventName(sourceFile: ts.SourceFile, expression: ts.Expression): string {
  const current = unwrapExpression(expression);
  if (ts.isStringLiteral(current) || ts.isNoSubstitutionTemplateLiteral(current)) {
    return current.text || "event";
  }
  return completeText(normalizeText(current.getText(sourceFile)), "dynamic event", 80);
}

/** Reads the property portion of an assignment target. */
function readEventPropertyName(expression: ts.Expression): string | undefined {
  const current = unwrapExpression(expression);
  if (ts.isPropertyAccessExpression(current)) {
    return current.name.text;
  }
  if (ts.isElementAccessExpression(current)) {
    const argument = current.argumentExpression;
    return ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument)
      ? argument.text
      : undefined;
  }
  return undefined;
}

/** Keeps property-assignment inference narrow enough to avoid ordinary `once`-style fields. */
function isLikelyEventProperty(name: string): boolean {
  return /^on\p{Lu}/u.test(name)
    || EVENT_PROPERTY_PREFIXES.some((prefix) => name.startsWith(`on${prefix}`));
}

/** Removes syntax-only wrappers around one callback or callee expression. */
function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (ts.isParenthesizedExpression(current)
    || ts.isAsExpression(current)
    || ts.isTypeAssertionExpression(current)
    || ts.isNonNullExpression(current)
    || ts.isSatisfiesExpression(current)) {
    current = current.expression;
  }
  return current;
}

/** Returns immediate syntax children for explicit-stack traversal. */
function getImmediateChildren(node: ts.Node): ts.Node[] {
  const children: ts.Node[] = [];
  ts.forEachChild(node, (child) => {
    children.push(child);
    return undefined;
  });
  return children;
}

/** Nested callbacks are independent event flows rather than registration flow children. */
function isFunctionBoundary(node: ts.Node): boolean {
  return ts.isFunctionDeclaration(node)
    || ts.isFunctionExpression(node)
    || ts.isMethodDeclaration(node)
    || ts.isConstructorDeclaration(node)
    || ts.isGetAccessorDeclaration(node)
    || ts.isSetAccessorDeclaration(node)
    || ts.isArrowFunction(node);
}

/** Normalizes display text without changing the underlying evidence node. */
function normalizeText(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

/** Bounds graph labels while leaving source evidence available for full inspection. */
function completeText(value: string, fallback: string, limit: number): string {
  const normalized = normalizeText(value) || fallback;
  return normalized.length <= limit
    ? normalized
    : `${normalized.slice(0, Math.max(1, limit - 1))}…`;
}
