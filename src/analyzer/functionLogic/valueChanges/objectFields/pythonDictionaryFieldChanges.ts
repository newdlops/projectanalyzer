/**
 * Python dictionary-field expansion for Lezer syntax. Literal keys become
 * nested property evidence, while dictionary unpacking remains an inferred
 * receiver change because its concrete key set is runtime-dependent.
 */

import type { SyntaxNode } from "@lezer/common";
import {
  getLezerChildren,
  type LezerSource
} from "../../../core/lezerSource";
import type {
  FunctionLogicValueChange,
  FunctionLogicValueChangeOperation
} from "../types";
import {
  createFunctionLogicValueChange,
  normalizeValueChangeText
} from "../valueChangeSupport";
import {
  appendObjectFieldLiteralTarget,
  isStableObjectFieldOwner,
  isStaticObjectFieldKeyLiteral
} from "./objectFieldTarget";

type DictionaryExpansion = {
  operation: FunctionLogicValueChangeOperation;
  operator: string;
  confidence: FunctionLogicValueChange["confidence"];
};

type DictionaryEntry =
  | { kind: "field"; key: string; value: SyntaxNode }
  | { kind: "spread"; value: SyntaxNode };

type DictionaryTask = {
  owner: string;
  entry: DictionaryEntry;
  expansion: DictionaryExpansion;
};

/** Expands literal-key dictionary entries with an iterative nested walk. */
export function collectPythonDictionaryFieldChanges(
  source: LezerSource,
  owner: string,
  dictionary: SyntaxNode,
  expansion: DictionaryExpansion
): FunctionLogicValueChange[] {
  if (dictionary.name !== "DictionaryExpression" || !isStableObjectFieldOwner(owner)) {
    return [];
  }
  const values: FunctionLogicValueChange[] = [];
  const pending: DictionaryTask[] = [];
  pushDictionaryTasks(source, pending, owner, dictionary, expansion);

  while (pending.length > 0) {
    const task = pending.pop();
    if (!task) continue;
    if (task.entry.kind === "spread") {
      const spread = createFunctionLogicValueChange({
        target: task.owner,
        targetKind: "receiver",
        operation: "mutate",
        operator: "** unpack",
        value: nodeText(source, task.entry.value),
        confidence: "inferred"
      });
      if (spread) values.push(spread);
      continue;
    }
    const target = appendObjectFieldLiteralTarget(task.owner, task.entry.key);
    const change = createFunctionLogicValueChange({
      target,
      targetKind: "property",
      operation: task.expansion.operation,
      operator: task.expansion.operator,
      value: nodeText(source, task.entry.value),
      confidence: task.expansion.confidence
    });
    if (change) values.push(change);
    if (task.entry.value.name === "DictionaryExpression") {
      pushDictionaryTasks(source, pending, target, task.entry.value, task.expansion);
    }
  }
  return values;
}

/** Pushes entries in reverse so nested stack traversal preserves source order. */
function pushDictionaryTasks(
  source: LezerSource,
  pending: DictionaryTask[],
  owner: string,
  dictionary: SyntaxNode,
  expansion: DictionaryExpansion
): void {
  const entries = readDictionaryEntries(source, dictionary);
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    pending.push({ owner, entry: entries[index], expansion });
  }
}

/** Reads direct `key: value` and `**mapping` entries without evaluating keys. */
function readDictionaryEntries(
  source: LezerSource,
  dictionary: SyntaxNode
): DictionaryEntry[] {
  const children = getLezerChildren(dictionary);
  const entries: DictionaryEntry[] = [];
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];
    if (child.name === "**" && children[index + 1]) {
      entries.push({ kind: "spread", value: children[index + 1] });
      index += 1;
      continue;
    }
    const colon = children[index + 1];
    const value = children[index + 2];
    if (colon?.name !== ":" || !value) continue;
    const key = nodeText(source, child);
    if (isStaticObjectFieldKeyLiteral(key)) {
      entries.push({ kind: "field", key, value });
    }
    index += 2;
  }
  return entries;
}

/** Normalizes a parser-owned source slice without interpreting Python values. */
function nodeText(source: LezerSource, node: SyntaxNode): string {
  return normalizeValueChangeText(source.text.slice(node.from, node.to));
}
