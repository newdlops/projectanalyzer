/** Stores validated model prose in private temporary pages, with race-safe lifecycle cleanup. */
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { isFunctionNarrative, type FunctionNarrativePageStore } from "../../shared/functionNarratives";

/** Construction is inert. First write creates a private directory; disposal revokes and removes every page. */
export function createFunctionNarrativePageStore(options: { temporaryRoot?: string } = {}): FunctionNarrativePageStore {
  let directory: Promise<string> | undefined;
  let closed = false;
  let writes: Promise<void> = Promise.resolve();
  const pageName = (index: number) => {
    if (!Number.isSafeInteger(index) || index < 0) throw new Error("Invalid narrative page");
    return `${index}.json`;
  };
  return {
    async write(index, narrative) {
      if (closed || !isFunctionNarrative(narrative)) throw new Error("Narrative page store is unavailable");
      const name = pageName(index);
      directory ??= mkdtemp(join(options.temporaryRoot ?? tmpdir(), "function-scenario-pages-"));
      const current = writes.then(async () => {
        const folder = await directory!;
        if (closed) throw new Error("Narrative page store was disposed");
        await writeFile(join(folder, name), JSON.stringify(narrative), { encoding: "utf8", mode: 0o600 });
      });
      writes = current.catch(() => {});
      await current;
    },
    async read(index) {
      const name = pageName(index);
      if (closed || !directory) return undefined;
      await writes;
      const folder = await directory;
      if (closed) return undefined;
      try {
        const value: unknown = JSON.parse(await readFile(join(folder, name), "utf8"));
        return !closed && isFunctionNarrative(value) ? value : undefined;
      } catch { return undefined; }
    },
    async dispose() {
      closed = true;
      await writes;
      if (directory) await rm(await directory, { recursive: true, force: true });
    }
  };
}
