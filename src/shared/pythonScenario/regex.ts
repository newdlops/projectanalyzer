/** Small regular-expression grammar with bounded matching, shared by static Python checks and the webview. */
export function createPythonRegexRuntime() {
  type Atom = { chars: string; min: number; max: number; group?: number; literal: boolean };
  type Pattern = { atoms: Atom[]; groups: number; beforeDigit: boolean; afterDigit: boolean; start: boolean; end: boolean };
  const digit = (text: string) => /^\p{Decimal_Number}$/u.test(text);
  const whitespace = (text: string) => /^[\t-\r\x1c-\x20\x85\xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]$/u.test(text);
  /** Rejects alternation, backreferences, repeated groups and ambiguous unbounded adjacent atoms. */
  function parse(source: string): Pattern | undefined {
    if (source.length > 256) return;
    const pattern: Pattern = { atoms: [], groups: 0, beforeDigit: false, afterDigit: false, start: false, end: false };
    let text = source;
    if (text.startsWith("(?<!\\d)")) { pattern.beforeDigit = true; text = text.slice(7); }
    if (text.endsWith("(?!\\d)")) { pattern.afterDigit = true; text = text.slice(0, -6); }
    if (text.startsWith("^")) { pattern.start = true; text = text.slice(1); }
    if (text.endsWith("$")) { pattern.end = true; text = text.slice(0, -1); }
    let group: number | undefined;
    for (let index = 0; index < text.length;) {
      let character = text[index++];
      if (character === "(") { if (group !== undefined) return; group = pattern.groups++; continue; }
      if (character === ")") { if (group === undefined || /[?*+{]/u.test(text[index] ?? "")) return; group = undefined; continue; }
      let chars = character; let literal = true;
      if (character === "\\") {
        character = text[index++];
        if (character === "d" || character === "s") { chars = character; literal = false; }
        else if (character && ".-()[]{}?*+^$\\".includes(character)) chars = character;
        else return;
      } else if ("[]{}?*+.^$|".includes(character)) return;
      let min = 1; let max = 1;
      if (text[index] === "?") { min = 0; index += 1; }
      else if (text[index] === "*" || text[index] === "+") {
        // Only whitespace repetitions are needed here; matching uses an explicit work budget.
        if (literal || chars !== "s") return;
        min = text[index] === "*" ? 0 : 1; max = 512; index += 1;
      } else if (text[index] === "{") {
        const count = /^\{(\d{1,2})\}/u.exec(text.slice(index));
        if (!count || Number(count[1]) > 32) return;
        min = max = Number(count[1]); index += count[0].length;
      }
      pattern.atoms.push({ chars, min, max, group, literal });
      if (pattern.atoms.length > 64) return;
    }
    if (group !== undefined || !pattern.atoms.length || !pattern.atoms.some((atom) => atom.min > 0)) return;
    return pattern;
  }
  /** Iterative greedy matching; exhaustion is unknown, never a false no-match. */
  function matches(source: string, input: string): Array<{ text: string; groups: string[] }> {
    const pattern = parse(source); if (!pattern || input.length > 512) throw new Error("unsupported-expression");
    const chars = [...input]; const found: Array<{ text: string; groups: string[] }> = [];
    let work = 0;
    for (let start = 0; start < chars.length; start += 1) {
      if (pattern.start && start !== 0) break;
      if (pattern.beforeDigit && start > 0 && digit(chars[start - 1])) continue;
      const queue = [{ atom: 0, offset: start, groups: Array<string>(pattern.groups).fill("") }];
      const visited = new Set<string>();
      while (queue.length) {
        if (++work > 32_768) throw new Error("step-budget");
        const state = queue.pop()!; const key = `${state.atom}:${state.offset}:${JSON.stringify(state.groups)}`;
        if (visited.has(key)) continue; visited.add(key);
        if (state.atom === pattern.atoms.length) {
          if (pattern.afterDigit && state.offset < chars.length && digit(chars[state.offset])) continue;
          if (pattern.end && state.offset !== chars.length && !(state.offset === chars.length - 1 && chars[state.offset] === "\n")) continue;
          found.push({ text: chars.slice(start, state.offset).join(""), groups: state.groups });
          if (found.length > 32) throw new Error("loop-budget");
          start = state.offset - 1; break;
        }
        const atom = pattern.atoms[state.atom]; let count = 0;
        while (count < atom.max && state.offset + count < chars.length) {
          const character = chars[state.offset + count];
          if (!(atom.literal ? character === atom.chars : atom.chars === "d" ? digit(character) : whitespace(character))) break;
          count += 1;
        }
        for (let length = atom.min; length <= count; length += 1) {
          const groups = state.groups.slice();
          if (atom.group !== undefined) groups[atom.group] += chars.slice(state.offset, state.offset + length).join("");
          queue.push({ atom: state.atom + 1, offset: state.offset + length, groups });
        }
      }
    }
    return found;
  }
  /** Builds positive-shape candidates and one-character digit variants without using a function's validation logic. */
  function candidates(source: string): string[] {
    const pattern = parse(source); if (!pattern) return [];
    const result = new Set<string>();
    for (let style = 0; style < 3; style += 1) {
      let digitIndex = 0;
      const base = pattern.atoms.map((atom) => {
        const length = atom.min === 0 ? style === 1 ? 1 : 0 : atom.min;
        return Array.from({ length }, () => atom.literal ? atom.chars : atom.chars === "s" ? " " : String((++digitIndex + style * 2) % 10)).join("");
      }).join("");
      result.add(base);
      const positions = [...base].map((character, index) => digit(character) ? index : -1).filter((index) => index >= 0);
      // Vary the full suffix independently; checksums and fixed-width boundaries are not uniformly spaced text lengths.
      for (const index of positions.slice(-2)) for (let number = 0; number < 10; number += 1) result.add(base.slice(0, index) + number + base.slice(index + 1));
      if (positions.length) { result.add(base.slice(0, -1)); result.add(base + "0"); }
    }
    return [...result];
  }
  return { parse, matches, candidates };
}
