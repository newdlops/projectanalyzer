/** Source scope guard allows nested control blocks only when all bindings remain at function-body scope. */

/** Linear lexical scan excludes comments/strings and rejects nested declarations, loops and exception transfers. */
export function hasSimplePrimitiveScopes(source: string, kotlin = false, checkedLoopRoute = false, plainHeader = false): boolean {
  let depth = 0, roots = 0, quote = "", lineComment = false, commentDepth = 0;
  for (let index = 0; index < source.length; index++) {
    const char = source[index], next = source[index + 1];
    if (lineComment) { if (char === "\n") lineComment = false; continue; }
    if (commentDepth) {
      if (kotlin && char === "/" && next === "*") { if (++commentDepth > 32) return false; index++; }
      else if (char === "*" && next === "/") { commentDepth--; index++; }
      continue;
    }
    if (quote) { if (char === "\\") index++; else if (char === quote) quote = ""; continue; }
    if (char === "/" && next === "/") { lineComment = true; index++; continue; }
    if (char === "/" && next === "*") { commentDepth = 1; index++; continue; }
    if (["\"", "'", "`"].includes(char)) { quote = char; continue; }
    if (plainHeader && depth === 0 && char === "=") return false; // Defaults/arrow setup are not body-only graph operations.
    if (char === "{") { if (depth === 0) roots++; if (++depth > 32 || roots > 1) return false; continue; }
    if (char === "}") { if (--depth < 0) return false; continue; }
    if (/[\p{L}_$]/u.test(char)) {
      const start = index;
      while (index + 1 < source.length && /[\p{L}\p{N}_$]/u.test(source[index + 1])) index++;
      const word = source.slice(start, index + 1);
      if (["try", "catch", "throw", "defer", "with"].includes(word) || !checkedLoopRoute && ["for", "while", "do"].includes(word)
        || depth >= 1 && ["function", "fun", "class", "object", "interface", "enum"].includes(word)
        || depth > 1 && ["val", "var", "let", "const"].includes(word)) return false;
    }
  }
  return roots === 1 && depth === 0 && !quote && !commentDepth;
}
