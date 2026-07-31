/**
 * Safe scalar-expression grammar for browser-only Function Logic scenarios.
 * It uses token, operator, and value stacks; no source text is dynamically
 * compiled, and member reads are restricted to own data properties.
 */

/** Returns expression parsing helpers consumed by the Scenario CFG evaluator. */
export function getFunctionLogicScenarioExpressionBrowserSource(): string {
  return /* js */ `
    const MAX_LOGIC_SCENARIO_EXPRESSION_LENGTH = 420;
    const MAX_LOGIC_SCENARIO_TOKENS = 180;

    /** Decodes a quoted scalar without invoking JavaScript parsing facilities. */
    function readFunctionLogicScenarioStringLiteral(text) {
      if (text.length < 2) return { ok: false };
      const quote = text[0];
      if (![34, 39, 96].includes(quote.charCodeAt(0))
        || text[text.length - 1] !== quote) {
        return { ok: false };
      }
      if (quote.charCodeAt(0) === 96 && text.includes("$" + "{")) {
        return { ok: false };
      }
      let value = "";
      for (let index = 1; index < text.length - 1; index += 1) {
        const character = text[index];
        if (character.charCodeAt(0) !== 92) {
          if (character === quote) return { ok: false };
          value += character;
          continue;
        }
        index += 1;
        if (index >= text.length - 1) return { ok: false };
        const escaped = text[index];
        const escapeValues = {
          n: String.fromCharCode(10),
          r: String.fromCharCode(13),
          t: String.fromCharCode(9),
          b: String.fromCharCode(8),
          f: String.fromCharCode(12),
          v: String.fromCharCode(11),
          "0": String.fromCharCode(0)
        };
        if (Object.prototype.hasOwnProperty.call(escapeValues, escaped)) {
          value += escapeValues[escaped];
        } else if (escaped === "u") {
          const hexadecimal = text.slice(index + 1, index + 5);
          if (!/^[0-9a-fA-F]{4}$/u.test(hexadecimal)) return { ok: false };
          value += String.fromCharCode(Number.parseInt(hexadecimal, 16));
          index += 4;
        } else {
          value += escaped;
        }
      }
      return { ok: true, value };
    }

    /** Evaluates a bounded source expression through token and operator stacks. */
    function evaluateFunctionLogicScenarioExpression(expression, environment, context) {
      const sourceExpression = String(expression || "").trim();
      if (sourceExpression.length <= MAX_LOGIC_SCENARIO_EXPRESSION_LENGTH
        && ((sourceExpression.startsWith("{") && sourceExpression.endsWith("}"))
          || (sourceExpression.startsWith("[") && sourceExpression.endsWith("]")))) {
        const composite = parseFunctionLogicScenarioInput(sourceExpression, "");
        if (composite.kind === "known" && typeof composite.value === "object") {
          return composite;
        }
      }
      const tokenization = tokenizeFunctionLogicScenarioExpression(expression);
      const dependencyOrigins = collectFunctionLogicScenarioDependencyOrigins(
        tokenization.error
          ? collectFunctionLogicScenarioIdentifierHints(expression)
          : tokenization.identifiers,
        environment,
        context
      );
      if (tokenization.error) {
        return createFunctionLogicScenarioUnknown(tokenization.error, dependencyOrigins);
      }
      const rpn = createFunctionLogicScenarioRpn(tokenization.tokens);
      if (rpn.error) {
        return createFunctionLogicScenarioUnknown(rpn.error, dependencyOrigins);
      }
      const stack = [];
      for (const token of rpn.tokens) {
        if (token.type === "literal") {
          stack.push(createFunctionLogicScenarioKnown(token.value, []));
          continue;
        }
        if (token.type === "identifier") {
          stack.push(resolveFunctionLogicScenarioIdentifier(token.text, environment, context));
          continue;
        }
        const descriptor = readFunctionLogicScenarioOperator(token.text);
        if (!descriptor || stack.length < descriptor.arity) {
          return createFunctionLogicScenarioUnknown(createFunctionLogicScenarioReason("scenario-reason-incomplete-expression"), dependencyOrigins);
        }
        if (descriptor.arity === 1) {
          stack.push(applyFunctionLogicScenarioUnary(token.text, stack.pop()));
        } else if (descriptor.arity === 2) {
          const right = stack.pop();
          stack.push(applyFunctionLogicScenarioBinary(token.text, stack.pop(), right));
        } else {
          const whenFalse = stack.pop();
          const whenTrue = stack.pop();
          stack.push(applyFunctionLogicScenarioTernary(stack.pop(), whenTrue, whenFalse));
        }
      }
      return stack.length === 1
        ? stack[0]
        : createFunctionLogicScenarioUnknown(createFunctionLogicScenarioReason("scenario-reason-unsupported-expression"), dependencyOrigins);
    }

    /** Tokenizes literals, safe member paths, operators, and nested ternaries. */
    function tokenizeFunctionLogicScenarioExpression(rawExpression) {
      const expression = String(rawExpression || "").trim();
      const tokens = [];
      const identifiers = [];
      if (!expression) return { tokens, identifiers, error: createFunctionLogicScenarioReason("scenario-reason-expression-missing") };
      if (expression.length > MAX_LOGIC_SCENARIO_EXPRESSION_LENGTH) {
        return { tokens, identifiers, error: createFunctionLogicScenarioReason("scenario-reason-expression-limit") };
      }
      let cursor = 0;
      let expectingOperand = true;
      while (cursor < expression.length) {
        const character = expression[cursor];
        if (isFunctionLogicScenarioWhitespace(character)) {
          cursor += 1;
          continue;
        }
        if (tokens.length >= MAX_LOGIC_SCENARIO_TOKENS) {
          return { tokens, identifiers, error: createFunctionLogicScenarioReason("scenario-reason-token-limit") };
        }
        if ([34, 39, 96].includes(character.charCodeAt(0))) {
          const quoted = readFunctionLogicScenarioQuotedToken(expression, cursor);
          if (!quoted.ok) return { tokens, identifiers, error: quoted.error };
          const parsed = readFunctionLogicScenarioStringLiteral(quoted.text);
          if (!parsed.ok) return { tokens, identifiers, error: createFunctionLogicScenarioReason("scenario-reason-invalid-string") };
          tokens.push({ type: "literal", value: parsed.value });
          cursor = quoted.end;
          expectingOperand = false;
          continue;
        }
        if (isFunctionLogicScenarioDigit(character)
          || (character === "." && isFunctionLogicScenarioDigit(expression[cursor + 1]))) {
          const numberToken = readFunctionLogicScenarioNumberToken(expression, cursor);
          const parsed = parseFunctionLogicScenarioInput(numberToken.text, "");
          if (parsed.kind !== "known" || typeof parsed.value !== "number") {
            return { tokens, identifiers, error: createFunctionLogicScenarioReason("scenario-reason-invalid-number") };
          }
          tokens.push({ type: "literal", value: parsed.value });
          cursor = numberToken.end;
          expectingOperand = false;
          continue;
        }
        if (isFunctionLogicScenarioIdentifierStart(character)) {
          const path = readFunctionLogicScenarioPathToken(expression, cursor);
          const keyword = path.text;
          cursor = path.end;
          if (["true", "True"].includes(keyword)) {
            tokens.push({ type: "literal", value: true });
          } else if (["false", "False"].includes(keyword)) {
            tokens.push({ type: "literal", value: false });
          } else if (["null", "None"].includes(keyword)) {
            tokens.push({ type: "literal", value: null });
          } else if (keyword === "undefined") {
            tokens.push({ type: "literal", value: undefined });
          } else if (["and", "or", "not"].includes(keyword)) {
            const normalized = keyword === "and" ? "&&" : keyword === "or" ? "||" : "u!";
            if (normalized !== "u!" && expectingOperand) {
              return { tokens, identifiers, error: createFunctionLogicScenarioReason("scenario-reason-incomplete-expression") };
            }
            tokens.push({ type: "operator", text: normalized });
            expectingOperand = true;
            continue;
          } else {
            let lookahead = cursor;
            while (isFunctionLogicScenarioWhitespace(expression[lookahead])) lookahead += 1;
            if (expression[lookahead] === "(") {
              identifiers.push(readFunctionLogicScenarioBaseName(keyword));
              return { tokens, identifiers, error: createFunctionLogicScenarioReason("scenario-reason-calls-static") };
            }
            tokens.push({ type: "identifier", text: keyword });
            identifiers.push(readFunctionLogicScenarioBaseName(keyword));
          }
          expectingOperand = false;
          continue;
        }
        if (character === "(") {
          if (!expectingOperand) return { tokens, identifiers, error: createFunctionLogicScenarioReason("scenario-reason-calls-static") };
          tokens.push({ type: "leftParen" });
          cursor += 1;
          expectingOperand = true;
          continue;
        }
        if (character === ")") {
          if (expectingOperand) return { tokens, identifiers, error: createFunctionLogicScenarioReason("scenario-reason-empty-group") };
          tokens.push({ type: "rightParen" });
          cursor += 1;
          expectingOperand = false;
          continue;
        }
        if (character === "?") {
          if (expectingOperand || expression[cursor + 1] === "?" || expression[cursor + 1] === ".") {
            const operator = expression[cursor + 1] === "?" ? "??" : "";
            if (!operator) return { tokens, identifiers, error: createFunctionLogicScenarioReason("scenario-reason-optional-access") };
            tokens.push({ type: "operator", text: operator });
            cursor += 2;
            expectingOperand = true;
          } else {
            tokens.push({ type: "question" });
            cursor += 1;
            expectingOperand = true;
          }
          continue;
        }
        if (character === ":") {
          if (expectingOperand) return { tokens, identifiers, error: createFunctionLogicScenarioReason("scenario-reason-incomplete-ternary") };
          tokens.push({ type: "colon" });
          cursor += 1;
          expectingOperand = true;
          continue;
        }
        const operator = readFunctionLogicScenarioOperatorToken(expression, cursor, expectingOperand);
        if (!operator) {
          return { tokens, identifiers, error: createFunctionLogicScenarioReason("scenario-reason-unsupported-token", { token: character }) };
        }
        tokens.push({ type: "operator", text: operator.text });
        cursor = operator.end;
        expectingOperand = true;
      }
      if (expectingOperand) return { tokens, identifiers, error: createFunctionLogicScenarioReason("scenario-reason-expression-operator-end") };
      return { tokens, identifiers };
    }

    /** Converts infix tokens to RPN using explicit stacks, including nested ?: operators. */
    function createFunctionLogicScenarioRpn(tokens) {
      const output = [];
      const operators = [];
      for (const token of tokens) {
        if (token.type === "literal" || token.type === "identifier") {
          output.push(token);
          continue;
        }
        if (token.type === "leftParen") {
          operators.push(token);
          continue;
        }
        if (token.type === "rightParen") {
          while (operators.length > 0 && operators[operators.length - 1].type !== "leftParen") {
            const operator = operators.pop();
            if (operator.type === "question") return { tokens: output, error: createFunctionLogicScenarioReason("scenario-reason-incomplete-ternary") };
            output.push(operator);
          }
          if (operators.length === 0) return { tokens: output, error: createFunctionLogicScenarioReason("scenario-reason-unmatched-closing-paren") };
          operators.pop();
          continue;
        }
        if (token.type === "question") {
          while (operators.length > 0
            && operators[operators.length - 1].type === "operator"
            && operators[operators.length - 1].text !== "?:") {
            output.push(operators.pop());
          }
          operators.push(token);
          continue;
        }
        if (token.type === "colon") {
          while (operators.length > 0 && operators[operators.length - 1].type !== "question") {
            if (operators[operators.length - 1].type === "leftParen") {
              return { tokens: output, error: createFunctionLogicScenarioReason("scenario-reason-ternary-separator") };
            }
            output.push(operators.pop());
          }
          if (operators.length === 0) {
            return { tokens: output, error: createFunctionLogicScenarioReason("scenario-reason-ternary-separator") };
          }
          operators.pop();
          operators.push({ type: "operator", text: "?:" });
          continue;
        }
        const descriptor = readFunctionLogicScenarioOperator(token.text);
        if (!descriptor) return { tokens: output, error: createFunctionLogicScenarioReason("scenario-reason-unsupported-operator", { operator: token.text }) };
        while (operators.length > 0 && operators[operators.length - 1].type === "operator") {
          const previous = readFunctionLogicScenarioOperator(operators[operators.length - 1].text);
          if (!previous) break;
          const shouldPop = descriptor.associativity === "left"
            ? descriptor.precedence <= previous.precedence
            : descriptor.precedence < previous.precedence;
          if (!shouldPop) break;
          output.push(operators.pop());
        }
        operators.push(token);
      }
      while (operators.length > 0) {
        const operator = operators.pop();
        if (operator.type === "leftParen") return { tokens: output, error: createFunctionLogicScenarioReason("scenario-reason-unmatched-opening-paren") };
        if (operator.type === "question") return { tokens: output, error: createFunctionLogicScenarioReason("scenario-reason-incomplete-ternary") };
        output.push(operator);
      }
      return { tokens: output };
    }

    /** Returns precedence, associativity, and arity for the safe scalar grammar. */
    function readFunctionLogicScenarioOperator(operator) {
      const descriptors = {
        "u!": [15, "right", 1], "u+": [15, "right", 1],
        "u-": [15, "right", 1], "u~": [15, "right", 1],
        "**": [14, "right", 2], "*": [13, "left", 2],
        "/": [13, "left", 2], "%": [13, "left", 2],
        "+": [12, "left", 2], "-": [12, "left", 2],
        "<<": [11, "left", 2], ">>": [11, "left", 2], ">>>": [11, "left", 2],
        "<": [10, "left", 2], "<=": [10, "left", 2],
        ">": [10, "left", 2], ">=": [10, "left", 2],
        "==": [9, "left", 2], "!=": [9, "left", 2],
        "===": [9, "left", 2], "!==": [9, "left", 2],
        "&": [8, "left", 2], "^": [7, "left", 2], "|": [6, "left", 2],
        "&&": [5, "left", 2], "??": [4, "left", 2], "||": [3, "left", 2],
        "?:": [2, "right", 3]
      };
      const descriptor = descriptors[operator];
      return descriptor
        ? { precedence: descriptor[0], associativity: descriptor[1], arity: descriptor[2] }
        : undefined;
    }

    /** Reads one supported operator and normalizes prefix unary variants. */
    function readFunctionLogicScenarioOperatorToken(expression, cursor, expectingOperand) {
      const candidates = ["===", "!==", ">>>", "**", "<=", ">=", "==", "!=", "&&", "||", "<<", ">>", "+", "-", "*", "/", "%", "<", ">", "&", "|", "^", "!", "~"];
      for (const candidate of candidates) {
        if (!expression.startsWith(candidate, cursor)) continue;
        if (expectingOperand) {
          if (!["+", "-", "!", "~"].includes(candidate)) return undefined;
          return {
            text: candidate === "+" ? "u+" : candidate === "-" ? "u-" : candidate === "!" ? "u!" : "u~",
            end: cursor + candidate.length
          };
        }
        return { text: candidate, end: cursor + candidate.length };
      }
      return undefined;
    }

    /** Applies one side-effect-free unary operation to a known operand. */
    function applyFunctionLogicScenarioUnary(operator, operand) {
      if (!operand || operand.kind !== "known") {
        return createFunctionLogicScenarioUnknown(
          operand?.reasonDescriptor || createFunctionLogicScenarioReason("scenario-reason-value-unknown"),
          operand?.origins || []
        );
      }
      try {
        if (operator === "u!") return createFunctionLogicScenarioKnown(!operand.value, operand.origins);
        if (operator === "u+") return createFunctionLogicScenarioKnown(+operand.value, operand.origins);
        if (operator === "u-") return createFunctionLogicScenarioKnown(-operand.value, operand.origins);
        if (operator === "u~") return createFunctionLogicScenarioKnown(~operand.value, operand.origins);
      } catch (_error) {
        return createFunctionLogicScenarioUnknown(createFunctionLogicScenarioReason("scenario-reason-unary-failed"), operand.origins);
      }
      return createFunctionLogicScenarioUnknown(createFunctionLogicScenarioReason("scenario-reason-unsupported-operator", { operator: operator }), operand.origins);
    }

    /** Applies arithmetic, comparison, or logical operations without side effects. */
    function applyFunctionLogicScenarioBinary(operator, left, right) {
      const origins = normalizeFunctionLogicScenarioOrigins([
        ...(left?.origins || []),
        ...(right?.origins || [])
      ]);
      if (operator === "&&" && left?.kind === "known" && !left.value) {
        return createFunctionLogicScenarioKnown(left.value, origins);
      }
      if (operator === "||" && left?.kind === "known" && left.value) {
        return createFunctionLogicScenarioKnown(left.value, origins);
      }
      if (operator === "??" && left?.kind === "known"
        && left.value !== null && left.value !== undefined) {
        return createFunctionLogicScenarioKnown(left.value, origins);
      }
      if (!left || !right || left.kind !== "known" || right.kind !== "known") {
        return createFunctionLogicScenarioUnknown(
          left?.kind !== "known" ? left?.reasonDescriptor || createFunctionLogicScenarioReason("scenario-reason-value-unknown") : right?.reasonDescriptor || createFunctionLogicScenarioReason("scenario-reason-value-unknown"),
          origins
        );
      }
      try {
        let value;
        if (operator === "+") value = left.value + right.value;
        else if (operator === "-") value = left.value - right.value;
        else if (operator === "*") value = left.value * right.value;
        else if (operator === "/") value = left.value / right.value;
        else if (operator === "%") value = left.value % right.value;
        else if (operator === "**") value = left.value ** right.value;
        else if (operator === "<") value = left.value < right.value;
        else if (operator === "<=") value = left.value <= right.value;
        else if (operator === ">") value = left.value > right.value;
        else if (operator === ">=") value = left.value >= right.value;
        else if (operator === "==" || operator === "===") value = left.value === right.value;
        else if (operator === "!=" || operator === "!==") value = left.value !== right.value;
        else if (operator === "&") value = left.value & right.value;
        else if (operator === "|") value = left.value | right.value;
        else if (operator === "^") value = left.value ^ right.value;
        else if (operator === "<<") value = left.value << right.value;
        else if (operator === ">>") value = left.value >> right.value;
        else if (operator === ">>>") value = left.value >>> right.value;
        else if (operator === "&&" || operator === "||" || operator === "??") value = right.value;
        else return createFunctionLogicScenarioUnknown(createFunctionLogicScenarioReason("scenario-reason-unsupported-operator", { operator: operator }), origins);
        return createFunctionLogicScenarioKnown(value, origins);
      } catch (_error) {
        return createFunctionLogicScenarioUnknown(createFunctionLogicScenarioReason("scenario-reason-binary-failed"), origins);
      }
    }

    /** Selects only the chosen nested-ternary branch once its condition is known. */
    function applyFunctionLogicScenarioTernary(condition, whenTrue, whenFalse) {
      const origins = normalizeFunctionLogicScenarioOrigins(condition?.origins || []);
      if (!condition || condition.kind !== "known") {
        return createFunctionLogicScenarioUnknown(
          condition?.reasonDescriptor || createFunctionLogicScenarioReason("scenario-reason-value-unknown"),
          [...origins, ...(whenTrue?.origins || []), ...(whenFalse?.origins || [])]
        );
      }
      return addFunctionLogicScenarioOrigins(condition.value ? whenTrue : whenFalse, origins);
    }

    /** Resolves a lexical binding and own-data member path from the environment. */
    function resolveFunctionLogicScenarioIdentifier(path, environment, context) {
      const parsed = parseFunctionLogicScenarioPath(path);
      if (!parsed) return createFunctionLogicScenarioUnknown(createFunctionLogicScenarioReason("scenario-reason-member-path"), []);
      let state = resolveFunctionLogicScenarioBindingState(
        parsed.base,
        environment,
        context
      );
      for (const segment of parsed.segments) {
        if (state.kind !== "known") return state;
        const keyState = segment.kind === "dynamic"
          ? resolveFunctionLogicScenarioBindingState(segment.value, environment, context)
          : createFunctionLogicScenarioKnown(segment.value, []);
        const origins = normalizeFunctionLogicScenarioOrigins([
          ...state.origins,
          ...(keyState.origins || [])
        ]);
        if (keyState.kind !== "known") {
          return createFunctionLogicScenarioUnknown(keyState.reasonDescriptor || createFunctionLogicScenarioReason("scenario-reason-value-unknown"), origins);
        }
        const container = state.value;
        const key = keyState.value;
        if ((typeof container !== "object" || container === null)
          && typeof container !== "string") {
          return createFunctionLogicScenarioUnknown(createFunctionLogicScenarioReason("scenario-reason-member-container"), origins);
        }
        if (key === "length" && (Array.isArray(container) || typeof container === "string")) {
          state = createFunctionLogicScenarioKnown(container.length, origins);
          continue;
        }
        const descriptor = Object.getOwnPropertyDescriptor(Object(container), key);
        if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, "value")) {
          return createFunctionLogicScenarioUnknown(createFunctionLogicScenarioReason("scenario-reason-member-unavailable", { member: String(key) }), origins);
        }
        state = createFunctionLogicScenarioKnown(descriptor.value, origins);
      }
      return state;
    }

    /** Resolves one lexical name without recursively traversing member syntax. */
    function resolveFunctionLogicScenarioBindingState(name, environment, context) {
      const bindingIds = context.bindingsByName.get(name) || [];
      if (bindingIds.length === 0) {
        return createFunctionLogicScenarioUnknown(createFunctionLogicScenarioReason("scenario-reason-unresolved-identifier", { name: name }), []);
      }
      const candidates = bindingIds.map((bindingId) =>
        environment.get(bindingId) || createFunctionLogicScenarioUnset(createFunctionLogicScenarioReason("scenario-reason-binding-empty"), [bindingId])
      );
      let state = candidates[0];
      for (let index = 1; index < candidates.length; index += 1) {
        state = mergeFunctionLogicScenarioStates(state, candidates[index]);
      }
      return state;
    }

    /** Parses dot and simple bracket segments iteratively; getters are never invoked. */
    function parseFunctionLogicScenarioPath(path) {
      let cursor = 0;
      if (!isFunctionLogicScenarioIdentifierStart(path[cursor])) return undefined;
      cursor += 1;
      while (isFunctionLogicScenarioIdentifierPart(path[cursor])) cursor += 1;
      const base = path.slice(0, cursor);
      const segments = [];
      while (cursor < path.length) {
        if (path[cursor] === ".") {
          const start = cursor + 1;
          cursor = start;
          if (!isFunctionLogicScenarioIdentifierStart(path[cursor])) return undefined;
          cursor += 1;
          while (isFunctionLogicScenarioIdentifierPart(path[cursor])) cursor += 1;
          segments.push({ kind: "literal", value: path.slice(start, cursor) });
          continue;
        }
        if (path[cursor] !== "[") return undefined;
        const closing = path.indexOf("]", cursor + 1);
        if (closing < 0) return undefined;
        const content = path.slice(cursor + 1, closing).trim();
        const stringValue = readFunctionLogicScenarioStringLiteral(content);
        if (stringValue.ok) segments.push({ kind: "literal", value: stringValue.value });
        else if (/^(?:0|[1-9]\\d*)$/u.test(content)) {
          segments.push({ kind: "literal", value: Number(content) });
        } else if (isFunctionLogicScenarioIdentifierText(content)) {
          segments.push({ kind: "dynamic", value: content });
        } else return undefined;
        cursor = closing + 1;
      }
      return { base, segments };
    }

    /** Reads a complete safe member path token, including literal brackets. */
    function readFunctionLogicScenarioPathToken(expression, start) {
      let cursor = start + 1;
      while (isFunctionLogicScenarioIdentifierPart(expression[cursor])) cursor += 1;
      while (cursor < expression.length) {
        if (expression[cursor] === "."
          && isFunctionLogicScenarioIdentifierStart(expression[cursor + 1])) {
          cursor += 2;
          while (isFunctionLogicScenarioIdentifierPart(expression[cursor])) cursor += 1;
          continue;
        }
        if (expression[cursor] !== "[") break;
        let closing = cursor + 1;
        let quote = "";
        while (closing < expression.length) {
          const character = expression[closing];
          if (quote && character.charCodeAt(0) === 92) {
            closing += 2;
            continue;
          }
          if (quote) {
            if (character === quote) quote = "";
          } else if (character.charCodeAt(0) === 34 || character.charCodeAt(0) === 39) {
            quote = character;
          } else if (character === "]") break;
          closing += 1;
        }
        if (closing >= expression.length || quote) break;
        const candidate = expression.slice(start, closing + 1);
        if (!parseFunctionLogicScenarioPath(candidate)) break;
        cursor = closing + 1;
      }
      return { text: expression.slice(start, cursor), end: cursor };
    }

    /** Reads a number without consuming a following binary plus or minus. */
    function readFunctionLogicScenarioNumberToken(expression, start) {
      let cursor = start;
      let previous = "";
      while (cursor < expression.length) {
        const character = expression[cursor];
        const accepted = isFunctionLogicScenarioDigit(character)
          || "abcdefABCDEFxXbBoO._".includes(character)
          || ((character === "+" || character === "-") && (previous === "e" || previous === "E"));
        if (!accepted) break;
        previous = character;
        cursor += 1;
      }
      return { text: expression.slice(start, cursor), end: cursor };
    }

    /** Reads one quoted token while respecting escaped delimiters. */
    function readFunctionLogicScenarioQuotedToken(expression, start) {
      const quote = expression[start];
      let cursor = start + 1;
      while (cursor < expression.length) {
        if (expression[cursor].charCodeAt(0) === 92) {
          cursor += 2;
          continue;
        }
        if (expression[cursor] === quote) {
          return { ok: true, text: expression.slice(start, cursor + 1), end: cursor + 1 };
        }
        cursor += 1;
      }
      return { ok: false, error: createFunctionLogicScenarioReason("scenario-reason-invalid-string") };
    }

    /** Collects origins even when parsing stops at an unsupported call/token. */
    function collectFunctionLogicScenarioDependencyOrigins(names, environment, context) {
      const origins = [];
      for (const name of names || []) {
        for (const bindingId of context.bindingsByName.get(name) || []) {
          origins.push(bindingId);
          origins.push(...(environment.get(bindingId)?.origins || []));
        }
      }
      return normalizeFunctionLogicScenarioOrigins(origins);
    }

    /** Recovers lexical names for provenance after an unsupported syntax stop. */
    function collectFunctionLogicScenarioIdentifierHints(expression) {
      const names = [];
      const text = String(expression || "");
      let cursor = 0;
      while (cursor < text.length) {
        if (!isFunctionLogicScenarioIdentifierStart(text[cursor])) {
          cursor += 1;
          continue;
        }
        const start = cursor;
        cursor += 1;
        while (isFunctionLogicScenarioIdentifierPart(text[cursor])) cursor += 1;
        const name = text.slice(start, cursor);
        if (!names.includes(name)) names.push(name);
      }
      return names;
    }

    /** Character helpers keep tokenizer behavior explicit across browsers. */
    function isFunctionLogicScenarioWhitespace(character) {
      return character === " " || character === String.fromCharCode(9)
        || character === String.fromCharCode(10) || character === String.fromCharCode(13);
    }

    function isFunctionLogicScenarioDigit(character) {
      return Boolean(character) && character >= "0" && character <= "9";
    }

    function isFunctionLogicScenarioIdentifierStart(character) {
      if (!character) return false;
      const code = character.charCodeAt(0);
      return character === "_" || character === "$"
        || (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
    }

    function isFunctionLogicScenarioIdentifierPart(character) {
      return isFunctionLogicScenarioIdentifierStart(character)
        || isFunctionLogicScenarioDigit(character);
    }

    function isFunctionLogicScenarioIdentifierText(text) {
      if (!text || !isFunctionLogicScenarioIdentifierStart(text[0])) return false;
      for (let index = 1; index < text.length; index += 1) {
        if (!isFunctionLogicScenarioIdentifierPart(text[index])) return false;
      }
      return true;
    }

    /** Reads the lexical root from a plain or member target. */
    function readFunctionLogicScenarioBaseName(value) {
      const text = String(value || "").trim();
      let end = 0;
      while (end < text.length && isFunctionLogicScenarioIdentifierPart(text[end])) end += 1;
      return text.slice(0, end);
    }
  `;
}
