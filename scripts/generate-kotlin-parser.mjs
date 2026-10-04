/** Regenerates the vendored Kotlin TypeScript parser; never runs during compile or installation. */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const kotlinRoot = path.join(repoRoot, "src/analyzer/languages/kotlin/internal");
const manifest = JSON.parse(await readFile(path.join(kotlinRoot, "grammar/manifest.json"), "utf8"));
const jarPath = process.env.ANTLR_JAR;
if (!jarPath) {
  throw new Error("Set ANTLR_JAR to the ANTLR 4.13.2 complete JAR. Set JAVA if java is not on PATH.");
}
const jarHash = createHash("sha256").update(await readFile(jarPath)).digest("hex");
if (jarHash !== manifest.generator.sha256) {
  throw new Error("ANTLR_JAR does not match the pinned ANTLR generator checksum.");
}
const workDir = await mkdtemp(path.join(tmpdir(), "project-analyzer-kotlin-parser-"));
for (const name of manifest.grammarFiles) {
  const original = await readFile(path.join(kotlinRoot, "grammar", name), "utf8");
  if (createHash("sha256").update(original).digest("hex") !== manifest.grammarSha256[name]) {
    throw new Error(`${name} differs from the pinned upstream grammar checksum.`);
  }
  // The official grammar explicitly requires translating its single Java lexer
  // action to the selected target. Preserve the original vendored source.
  let adapted = name === "KotlinLexer.g4"
    ? original.replace("if (!_modeStack.isEmpty()) { popMode(); }", "if (this._modeStack.length > 0) { this.popMode(); }")
    : original;
  if (name === "UnicodeClasses.g4") {
    // Upstream's UnicodeData First/Last entries are emitted as two singleton
    // alternatives. Restore their existing range bounds; no Unicode-version
    // upgrade or expansion beyond the pinned source's endpoints is performed.
    for (const [first, last] of [["3400", "4DB5"], ["4E00", "9FCC"], ["AC00", "D7A3"]]) {
      adapted = adapted.replace(`'\\u${first}' |\n\t'\\u${last}'`, `'\\u${first}'..'\\u${last}'`);
    }
  }
  await writeFile(path.join(workDir, name), adapted);
}
const result = spawnSync(process.env.JAVA || "java", [
  "-jar", path.resolve(jarPath), "-Dlanguage=TypeScript", "-no-listener",
  "KotlinLexer.g4", "KotlinParser.g4"
], { cwd: workDir, encoding: "utf8" });
if (result.status !== 0) {
  throw new Error(result.stderr || result.error?.message || "ANTLR generation failed.");
}
for (const name of await readdir(workDir)) {
  if (!name.endsWith(".ts")) continue;
  const code = await readFile(path.join(workDir, name), "utf8");
  // ANTLR output conflicts with noUnused*/noImplicitOverride. Runtime behavior
  // stays generated; hand-written adapters compile under all strict flags.
  await writeFile(path.join(kotlinRoot, "generated", name),
    `// @ts-nocheck\n// Generated from Kotlin/kotlin-spec ${manifest.sourceRevision}; Apache-2.0.\n${code}`);
}
console.log(`Generated Kotlin parser with ANTLR ${manifest.generator.version}.`);
