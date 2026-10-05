/** Discovers only preinstalled llama.cpp executables; setup never installs or starts a daemon. */
import * as path from "node:path";
import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { FunctionNarrativeError } from "../../application/functionNarratives";

/** Validates an executable before any large model transfer; GUI Homebrew PATH gaps are handled explicitly. */
export async function resolveLocalBinary(configured: string): Promise<string> {
  const name = configured || (process.platform === "win32" ? "llama-completion.exe" : "llama-completion");
  const candidates = configured && (path.isAbsolute(configured) || configured.includes(path.sep)) ? [configured]
    : [...(!configured ? ["/opt/homebrew/bin/llama-completion", "/usr/local/bin/llama-completion"] : []),
      ...(process.env.PATH ?? "").split(path.delimiter).filter(Boolean).flatMap((directory) => {
        const extensions = process.platform === "win32" && !path.extname(name) ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";") : [""];
        return extensions.map((extension) => path.join(directory, name + extension));
      })];
  for (const candidate of candidates) {
    try {
      await access(candidate, process.platform === "win32" ? constants.F_OK : constants.X_OK);
      if ((await stat(candidate)).isFile()) return candidate;
    } catch { /* Try the next preinstalled executable; failures are presented in the Guide. */ }
  }
  throw new FunctionNarrativeError("unavailable");
}
