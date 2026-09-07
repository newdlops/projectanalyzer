/**
 * Browser-only safe object-field write helpers for Function Logic Scenario.
 * Writes clone plain own-data containers along a bounded path, never execute
 * getters, and reject prototype-sensitive keys and inferred heap mutations.
 */

/** Returns helpers composed beside the Scenario expression and CFG engines. */
export function getFunctionLogicScenarioObjectWriteBrowserSource(): string {
  return /* js */ `
    const MAX_LOGIC_SCENARIO_MEMBER_WRITE_DEPTH = 24;
    const FUNCTION_LOGIC_SCENARIO_BLOCKED_KEYS = new Set([
      "__proto__", "prototype", "constructor"
    ]);

    /** Applies one exact field/index assignment to a cloned root binding value. */
    function applyFunctionLogicScenarioPropertyChange(
      change,
      previousRoot,
      environment,
      context
    ) {
      const origins = previousRoot?.origins || [];
      if (change.operation === "mutate" || change.confidence === "inferred") {
        return createFunctionLogicScenarioUnknown(
          createFunctionLogicScenarioReason("scenario-reason-inferred-mutation"),
          origins
        );
      }
      if (change.operation === "iterate") {
        return createFunctionLogicScenarioUnknown(
          createFunctionLogicScenarioReason("scenario-reason-static-unsupported"),
          origins
        );
      }
      const path = readFunctionLogicScenarioPropertyPath(change);
      if (!path || path.segments.length === 0) {
        return createFunctionLogicScenarioUnknown(createFunctionLogicScenarioReason("scenario-reason-member-path"), origins);
      }
      if (!previousRoot || previousRoot.kind !== "known") {
        return createFunctionLogicScenarioUnknown(
          previousRoot?.reasonDescriptor || createFunctionLogicScenarioReason("scenario-reason-value-unknown"),
          origins
        );
      }
      const resolved = resolveFunctionLogicScenarioWriteKeys(
        path.segments,
        environment,
        context,
        origins
      );
      if (resolved.errorDescriptor) {
        return createFunctionLogicScenarioUnknown(resolved.errorDescriptor, resolved.origins);
      }
      const prepared = prepareFunctionLogicScenarioObjectWrite(
        previousRoot.value,
        resolved.keys
      );
      if (prepared.errorDescriptor) {
        return createFunctionLogicScenarioUnknown(prepared.errorDescriptor, resolved.origins);
      }
      if (change.operation === "delete") {
        const deleted = deleteFunctionLogicScenarioOwnData(prepared.parent, prepared.key);
        return deleted.errorDescriptor
          ? createFunctionLogicScenarioUnknown(deleted.errorDescriptor, resolved.origins)
          : createFunctionLogicScenarioKnown(prepared.root, resolved.origins);
      }

      const previousField = readFunctionLogicScenarioOwnData(
        prepared.originalParent,
        prepared.key,
        resolved.origins
      );
      let nextField;
      if (change.operator === "++" || change.operator === "--") {
        nextField = applyFunctionLogicScenarioBinary(
          change.operator === "++" ? "+" : "-",
          previousField,
          createFunctionLogicScenarioKnown(1, [])
        );
      } else {
        const right = evaluateFunctionLogicScenarioExpression(
          change.value,
          environment,
          context
        );
        if (change.operator === "=" || change.operation === "initialize"
          || change.operation === "assign") {
          nextField = right;
        } else {
          const compoundOperators = {
            "+=": "+", "-=": "-", "*=": "*", "/=": "/", "%=": "%", "**=": "**",
            "<<=": "<<", ">>=": ">>", ">>>=": ">>>", "&=": "&", "|=": "|", "^=": "^",
            "&&=": "&&", "||=": "||", "??=": "??"
          };
          const operator = compoundOperators[change.operator];
          nextField = operator
            ? applyFunctionLogicScenarioBinary(operator, previousField, right)
            : createFunctionLogicScenarioUnknown(
                createFunctionLogicScenarioReason("scenario-reason-unsupported-operator", { operator: change.operator }),
                [...previousField.origins, ...right.origins]
              );
        }
      }
      if (nextField.kind !== "known") {
        return createFunctionLogicScenarioUnknown(nextField.reasonDescriptor || createFunctionLogicScenarioReason("scenario-reason-value-unknown"), [
          ...resolved.origins,
          ...(nextField.origins || [])
        ]);
      }
      const written = writeFunctionLogicScenarioOwnData(
        prepared.parent,
        prepared.key,
        nextField.value
      );
      return written.errorDescriptor
        ? createFunctionLogicScenarioUnknown(written.errorDescriptor, resolved.origins)
        : createFunctionLogicScenarioKnown(prepared.root, [
            ...resolved.origins,
            ...(nextField.origins || [])
          ]);
    }

    /** Reads the leaf state used by a field-level before/after trace row. */
    function readFunctionLogicScenarioPropertyTransitionState(
      change,
      rootState,
      environment,
      context
    ) {
      if (!rootState || rootState.kind !== "known") return rootState;
      const path = readFunctionLogicScenarioPropertyPath(change);
      if (!path || path.segments.length === 0) return rootState;
      const resolved = resolveFunctionLogicScenarioWriteKeys(
        path.segments,
        environment,
        context,
        rootState.origins
      );
      if (resolved.errorDescriptor) {
        return createFunctionLogicScenarioUnknown(resolved.errorDescriptor, resolved.origins);
      }
      let container = rootState.value;
      for (let index = 0; index < resolved.keys.length - 1; index += 1) {
        const state = readFunctionLogicScenarioOwnData(
          container,
          resolved.keys[index],
          resolved.origins
        );
        if (state.kind !== "known") return state;
        container = state.value;
      }
      const leaf = readFunctionLogicScenarioOwnData(
        container,
        resolved.keys[resolved.keys.length - 1],
        resolved.origins
      );
      return leaf.kind === "unknown" && leaf.reasonDescriptor?.key === "scenario-reason-member-unavailable"
        ? createFunctionLogicScenarioUnset(createFunctionLogicScenarioReason("scenario-reason-field-unassigned"), resolved.origins)
        : leaf;
    }

    /** Resolves literal/dynamic keys and blocks prototype-sensitive paths. */
    function resolveFunctionLogicScenarioWriteKeys(segments, environment, context, origins) {
      if (segments.length > MAX_LOGIC_SCENARIO_MEMBER_WRITE_DEPTH) {
        return { keys: [], origins, errorDescriptor: createFunctionLogicScenarioReason("scenario-reason-object-path-limit") };
      }
      const keys = [];
      let combinedOrigins = normalizeFunctionLogicScenarioOrigins(origins);
      for (const segment of segments) {
        const keyState = segment.kind === "binding"
          ? (environment.get(segment.bindingId) || createFunctionLogicScenarioUnset(createFunctionLogicScenarioReason("scenario-reason-binding-empty"), [segment.bindingId]))
          : segment.kind === "dynamic"
          ? resolveFunctionLogicScenarioBindingState(segment.value, environment, context)
          : createFunctionLogicScenarioKnown(segment.value, []);
        combinedOrigins = normalizeFunctionLogicScenarioOrigins([
          ...combinedOrigins,
          ...(keyState.origins || [])
        ]);
        if (keyState.kind !== "known") {
          return { keys, origins: combinedOrigins, errorDescriptor: keyState.reasonDescriptor || createFunctionLogicScenarioReason("scenario-reason-value-unknown") };
        }
        if (typeof keyState.value !== "string" && typeof keyState.value !== "number") {
          return { keys, origins: combinedOrigins, errorDescriptor: createFunctionLogicScenarioReason("scenario-reason-object-key") };
        }
        if (FUNCTION_LOGIC_SCENARIO_BLOCKED_KEYS.has(String(keyState.value))) {
          return { keys, origins: combinedOrigins, errorDescriptor: createFunctionLogicScenarioReason("scenario-reason-object-prototype", { key: String(keyState.value) }) };
        }
        keys.push(keyState.value);
      }
      return { keys, origins: combinedOrigins };
    }

    /** Reads projected opaque segments first; legacy source text remains a fallback. */
    function readFunctionLogicScenarioPropertyPath(change) {
      const reference = change?.valueRef;
      if (reference?.segments?.length) {
        return {
          base: reference.rootBindingId,
          segments: reference.segments.map((segment) => segment.kind === "binding"
            ? { kind: "binding", bindingId: segment.bindingId }
            : { kind: "literal", value: segment.key })
        };
      }
      return parseFunctionLogicScenarioPath(String(change?.target || "").trim());
    }

    /** Reifies a dynamic key only after its Scenario binding is known and safe. */
    function resolveFunctionLogicScenarioPropertyValueRef(change, environment, context) {
      if (!change?.valueRef) return undefined;
      const path = readFunctionLogicScenarioPropertyPath(change);
      if (!path?.segments?.length) return undefined;
      const resolved = resolveFunctionLogicScenarioWriteKeys(path.segments, environment, context, []);
      if (resolved.errorDescriptor) return undefined;
      return {
        ...change.valueRef,
        path: resolved.keys.map((key) => String(key)),
        segments: resolved.keys.map((key) => ({ kind: "static", key: String(key) }))
      };
    }

    /** Clones only containers on the selected path; no recursive heap walk occurs. */
    function prepareFunctionLogicScenarioObjectWrite(rootValue, keys) {
      const rootClone = cloneFunctionLogicScenarioContainer(rootValue);
      if (rootClone.errorDescriptor) return { errorDescriptor: rootClone.errorDescriptor };
      let originalParent = rootValue;
      let parent = rootClone.value;
      for (let index = 0; index < keys.length - 1; index += 1) {
        const child = readFunctionLogicScenarioOwnData(originalParent, keys[index], []);
        if (child.kind !== "known") return { errorDescriptor: child.reasonDescriptor || createFunctionLogicScenarioReason("scenario-reason-value-unknown") };
        const childClone = cloneFunctionLogicScenarioContainer(child.value);
        if (childClone.errorDescriptor) return { errorDescriptor: childClone.errorDescriptor };
        const attached = writeFunctionLogicScenarioOwnData(parent, keys[index], childClone.value);
        if (attached.errorDescriptor) return { errorDescriptor: attached.errorDescriptor };
        originalParent = child.value;
        parent = childClone.value;
      }
      return {
        root: rootClone.value,
        parent,
        originalParent,
        key: keys[keys.length - 1]
      };
    }

    /** Makes a shallow plain-object/array clone from own data descriptors only. */
    function cloneFunctionLogicScenarioContainer(value) {
      if (!isFunctionLogicScenarioWritableContainer(value)) {
        return { errorDescriptor: createFunctionLogicScenarioReason("scenario-reason-object-container") };
      }
      const clone = Array.isArray(value)
        ? []
        : Object.create(Object.getPrototypeOf(value) === null ? null : Object.prototype);
      try {
        for (const key of Object.getOwnPropertyNames(value)) {
          const descriptor = Object.getOwnPropertyDescriptor(value, key);
          if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, "value")) {
            return { errorDescriptor: createFunctionLogicScenarioReason("scenario-reason-object-accessor") };
          }
          Object.defineProperty(clone, key, {
            value: descriptor.value,
            writable: true,
            enumerable: descriptor.enumerable,
            configurable: key === "length" && Array.isArray(value) ? false : true
          });
        }
      } catch (_error) {
        return { errorDescriptor: createFunctionLogicScenarioReason("scenario-reason-object-clone") };
      }
      return { value: clone };
    }

    /** Restricts writes to JSON-shaped values rather than arbitrary prototypes. */
    function isFunctionLogicScenarioWritableContainer(value) {
      if (Array.isArray(value)) return true;
      if (typeof value !== "object" || value === null) return false;
      const prototype = Object.getPrototypeOf(value);
      return prototype === Object.prototype || prototype === null;
    }

    /** Reads one own data field without walking prototypes or invoking a getter. */
    function readFunctionLogicScenarioOwnData(container, key, origins) {
      if (!isFunctionLogicScenarioWritableContainer(container)) {
        return createFunctionLogicScenarioUnknown(
          createFunctionLogicScenarioReason("scenario-reason-object-container"),
          origins
        );
      }
      const descriptor = Object.getOwnPropertyDescriptor(container, key);
      if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, "value")) {
        return createFunctionLogicScenarioUnknown(createFunctionLogicScenarioReason("scenario-reason-member-unavailable", { member: String(key) }), origins);
      }
      return createFunctionLogicScenarioKnown(descriptor.value, origins);
    }

    /** Defines one own field on a freshly cloned safe container. */
    function writeFunctionLogicScenarioOwnData(container, key, value) {
      try {
        const descriptor = Object.getOwnPropertyDescriptor(container, key);
        if (descriptor && !Object.prototype.hasOwnProperty.call(descriptor, "value")) {
          return { errorDescriptor: createFunctionLogicScenarioReason("scenario-reason-object-accessor") };
        }
        Object.defineProperty(container, key, {
          value,
          writable: true,
          enumerable: descriptor?.enumerable ?? true,
          configurable: descriptor?.configurable ?? true
        });
        return {};
      } catch (_error) {
        return { errorDescriptor: createFunctionLogicScenarioReason("scenario-reason-object-write") };
      }
    }

    /** Deletes only a configurable own data field on the cloned container. */
    function deleteFunctionLogicScenarioOwnData(container, key) {
      const descriptor = Object.getOwnPropertyDescriptor(container, key);
      if (!descriptor) return {};
      if (!Object.prototype.hasOwnProperty.call(descriptor, "value")) {
        return { errorDescriptor: createFunctionLogicScenarioReason("scenario-reason-object-accessor") };
      }
      if (!descriptor.configurable) return { errorDescriptor: createFunctionLogicScenarioReason("scenario-reason-object-configurable") };
      return Reflect.deleteProperty(container, key)
        ? {}
        : { errorDescriptor: createFunctionLogicScenarioReason("scenario-reason-object-delete") };
    }

    /**
     * Applies a projected Tutor member operation without mutating the shared
     * environment object. Tutor paths are already parser-proven static keys.
     */
    function applyFunctionLogicScenarioTutorMemberChange(previousRoot, path, operator, value) {
      const origins = previousRoot?.origins || [];
      if (!previousRoot || previousRoot.kind !== "known" || !Array.isArray(path) || path.length === 0
        || path.length > MAX_LOGIC_SCENARIO_MEMBER_WRITE_DEPTH
        || path.some((key) => FUNCTION_LOGIC_SCENARIO_BLOCKED_KEYS.has(String(key)))) {
        return { root: createFunctionLogicScenarioUnknown(createFunctionLogicScenarioReason("scenario-reason-receiver-unknown"), origins) };
      }
      const prepared = prepareFunctionLogicScenarioObjectWrite(previousRoot.value, path);
      if (prepared.errorDescriptor) return { root: createFunctionLogicScenarioUnknown(prepared.errorDescriptor, origins) };
      const before = readFunctionLogicScenarioOwnData(prepared.originalParent, prepared.key, origins);
      if (before.kind !== "known") return { root: before, before };
      if (operator === "delete") {
        const deleted = deleteFunctionLogicScenarioOwnData(prepared.parent, prepared.key);
        return deleted.errorDescriptor
          ? { root: createFunctionLogicScenarioUnknown(deleted.errorDescriptor, origins), before }
          : { root: createFunctionLogicScenarioKnown(prepared.root, origins), before, after: createFunctionLogicScenarioUnset(createFunctionLogicScenarioReason("scenario-reason-value-deleted"), origins) };
      }
      const next = operator === "set" ? value : applyFunctionLogicScenarioBinary(
        operator === "increment" ? "+" : operator === "decrement" ? "-" : operator,
        before,
        operator === "increment" || operator === "decrement" ? createFunctionLogicScenarioKnown(1, []) : value
      );
      if (!next || next.kind !== "known") return { root: next || createFunctionLogicScenarioUnknown(createFunctionLogicScenarioReason("scenario-reason-value-unknown"), origins), before, after: next };
      const written = writeFunctionLogicScenarioOwnData(prepared.parent, prepared.key, next.value);
      if (written.errorDescriptor) return { root: createFunctionLogicScenarioUnknown(written.errorDescriptor, origins), before };
      return { root: createFunctionLogicScenarioKnown(prepared.root, [...origins, ...(next.origins || [])]), before, after: next };
    }

    /** Resolves projected binding-backed Tutor keys without name dispatch. */
    function resolveFunctionLogicScenarioTutorMemberPath(target, environment) {
      const segments = target?.segments;
      if (!segments?.length) return Array.isArray(target?.path) && target.path.length ? target.path : undefined;
      const path = [];
      for (const segment of segments) {
        const key = segment.kind === "binding" ? environment.get(segment.bindingId) : createFunctionLogicScenarioKnown(segment.key, []);
        if (!key || key.kind !== "known" || (typeof key.value !== "string" && !(typeof key.value === "number" && Number.isInteger(key.value)))) return undefined;
        if (FUNCTION_LOGIC_SCENARIO_BLOCKED_KEYS.has(String(key.value))) return undefined;
        path.push(String(key.value));
      }
      return path;
    }
  `;
}
