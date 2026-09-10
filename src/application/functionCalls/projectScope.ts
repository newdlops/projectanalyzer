/** Project-owned callable scope for business-call diagrams, independent of the host filesystem. */
import { createPortableProjectPathNormalizer } from "../../shared/portableProjectPath";
import type { SymbolNode } from "../../shared/types";

/** Installed dependency/environment directories never become business function nodes. */
const dependencyDirectories = new Set([
  "site-packages", "dist-packages", "node_modules", ".venv", "venv", ".tox", ".nox", "__pypackages__"
]);

/** Creates a segment-aware predicate shared by projection and lazy source authorization. */
export function createProjectCallableScope(workspaceRoot: string): (node: SymbolNode) => boolean {
  const paths = createPortableProjectPathNormalizer(workspaceRoot);
  const root = paths.normalize().key;
  return (node) => {
    if (!node.filePath?.trim() || !["function", "method", "constructor"].includes(node.kind)) return false;
    const file = paths.normalize(node.filePath);
    return paths.contains(root, file.key)
      && !file.key.split("/").some(segment => dependencyDirectories.has(segment));
  };
}
