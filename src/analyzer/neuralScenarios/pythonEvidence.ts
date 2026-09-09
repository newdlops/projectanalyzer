/** Conservative provenance hints from parser-owned Python bytecode; hints generate candidates, never verified outcomes. */
import type { PythonInstruction, PythonScenarioProgram } from "../../shared/pythonScenario";
import type { NeuralInputEvidence } from "./types";

type Facts = { owners: Set<string>; strings: Set<string>; numbers: Set<number> };
const empty = (): Facts => ({ owners: new Set(), strings: new Set(), numbers: new Set() });
/** Bounded unions deliberately overapproximate branch assignments without claiming runtime state. */
function merge(items: Facts[]): Facts {
  return { owners: new Set(items.flatMap((item) => [...item.owners]).slice(0, 32)),
    strings: new Set(items.flatMap((item) => [...item.strings]).slice(0, 64)),
    numbers: new Set(items.flatMap((item) => [...item.numbers]).slice(0, 64)) };
}

/** Follows assignments, operands and statically named helper arguments; return-only labels are excluded. */
export function collectPythonNeuralEvidence(program: PythonScenarioProgram): Map<string, NeuralInputEvidence> {
  const summaries = new Map<string, Map<string, Facts>>();
  const returnFacts = new Map<string, Facts>();
  const functions = new Map(program.functions.map((fn) => [fn.id, fn]));
  const globalFacts = new Map<string, Facts>();
  for (const global of program.globals) {
    globalFacts.set(global.name, global.instructions.some((item) => item.name === "@regex") ? empty() : literals(global.instructions));
  }
  // Callees may occur after their caller. Monotone, bounded passes propagate hints
  // through the existing maximum of eight functions without recursive expansion.
  for (let pass = 0; pass < Math.min(8, program.functions.length); pass += 1) {
    for (const fn of program.functions) {
      const locals = new Map(fn.parameters.map((name) => [name, { ...empty(), owners: new Set([name]) }]));
      const evidence = new Map(fn.parameters.map((name) => [name, empty()]));
      const stack: Facts[] = []; const iterators = new Map<string, Facts>(); const returns: Facts[] = [];
      const pop = () => stack.pop() ?? empty();
      const record = (facts: Facts) => {
        for (const owner of facts.owners) if (evidence.has(owner)) evidence.set(owner, merge([evidence.get(owner)!, facts]));
      };
      for (const instruction of fn.instructions.slice(0, 2048)) {
        const name = instruction.name ?? "";
        if (instruction.op === "literal") stack.push(literals([instruction]));
        else if (instruction.op === "load") stack.push(locals.get(name) ?? globalFacts.get(name) ?? empty());
        else if (instruction.op === "store") { const value = pop(); record(value); locals.set(name, merge([locals.get(name) ?? empty(), value])); }
        else if (instruction.op === "binary") { const facts = merge([pop(), pop()]); record(facts); stack.push(facts); }
        else if (instruction.op === "unary") { const facts = pop(); record(facts); stack.push(facts); }
        else if (instruction.op === "branch") { const facts = instruction.keep ? stack.at(-1) ?? empty() : pop(); record(facts); }
        else if (instruction.op === "pop") pop();
        else if (instruction.op === "return") { const facts = pop(); returns.push(facts); if (facts.owners.size) record(facts); stack.length = 0; }
        else if (instruction.op === "iterate") iterators.set(name, pop());
        else if (instruction.op === "next") stack.push(iterators.get(name) ?? empty());
        else if (instruction.op === "unpack") { const facts = pop(); for (let i = 0; i < Math.min(32, instruction.count ?? 0); i += 1) stack.push(facts); }
        else if (instruction.op === "list") { const count = instruction.count ?? 0; stack.push(merge(count ? stack.splice(-count, count) : [])); }
        else if (instruction.op === "index" || instruction.op === "slice") { const parts = [pop(), pop()]; if (instruction.op === "slice") parts.push(pop()); const facts = merge(parts); record(facts); stack.push(facts); }
        else if (instruction.op === "call" || instruction.op === "method") {
          const count = instruction.count ?? 0; const args = count ? stack.splice(-count, count) : [];
          const callee = instruction.op === "call" ? functions.get(name) : undefined;
          if (callee) {
            const facts = returnFacts.get(name) ?? empty(); const mapped: Facts[] = [];
            for (let i = 0; i < callee.parameters.length; i += 1) {
              const hint = summaries.get(name)?.get(callee.parameters[i]); const arg = args[i] ?? empty();
              if (hint) record({ ...merge([arg, hint]), owners: arg.owners });
              if (facts.owners.has(callee.parameters[i])) mapped.push(arg);
            }
            stack.push({ ...merge([...mapped, facts]), owners: merge(mapped).owners });
          } else {
            if (instruction.op === "method") args.unshift(pop());
            const facts = merge(args); record(facts); stack.push(facts);
          }
        }
        if (stack.length > 256) stack.length = 0;
      }
      summaries.set(fn.id, evidence); returnFacts.set(fn.id, merge(returns.filter((facts) => facts.owners.size > 0)));
    }
  }
  return new Map([...(summaries.get(program.root) ?? [])].map(([name, facts]) => [name, {
    strings: [...facts.strings].filter((value) => value.length <= 512),
    lengths: [...facts.numbers].filter((value) => Number.isInteger(value) && value >= 0 && value <= 512)
  }]));
}

/** Extracts literal values only, excluding instruction names, locations and regex text. */
function literals(instructions: PythonInstruction[]): Facts {
  const facts = empty();
  for (const instruction of instructions) {
    if (instruction.op !== "literal") continue;
    if (typeof instruction.value === "string") facts.strings.add(instruction.value);
    else if (typeof instruction.value === "number") facts.numbers.add(instruction.value);
  }
  return facts;
}
