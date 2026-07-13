/**
 * Removes compiled output before a full TypeScript build. This prevents deleted
 * source modules and test artifacts from surviving into a later VSIX package.
 */

import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

await rm(path.join(projectRoot, "out"), { force: true, recursive: true });
