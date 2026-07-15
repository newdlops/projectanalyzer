/**
 * Safe source-location presentation shared by bounded Webview payload adapters.
 * Absolute host paths stay behind the Extension Host boundary; consumers see
 * workspace-relative paths or, for out-of-root evidence, a filename fallback.
 */

import {
  createPortableProjectPathNormalizer,
  type PortableProjectPathNormalizer
} from "../../insights/projectReadingGuide";
import type { SourceRange } from "../../shared/types";

/** Character cap preventing one unusual path from dominating a payload. */
const SOURCE_DISPLAY_CHARACTER_LIMIT = 160;

/** Reusable formatter bound to one workspace root. */
export type SourceDisplayFormatter = {
  path(filePath: string): string | undefined;
  location(filePath: string, range?: Pick<SourceRange, "startLine">): string | undefined;
};

/** Creates a safe, portable source formatter without exposing its host root. */
export function createSourceDisplayFormatter(workspaceRoot: string): SourceDisplayFormatter {
  const sourcePaths = createPortableProjectPathNormalizer(workspaceRoot);

  return {
    path: (filePath) => createSafeSourceDisplayPath(filePath, sourcePaths),
    location(filePath, range) {
      const displayPath = createSafeSourceDisplayPath(filePath, sourcePaths);
      if (!displayPath) {
        return undefined;
      }

      const startLine = range?.startLine;
      const lineSuffix = startLine !== undefined
        && Number.isSafeInteger(startLine)
        && startLine >= 0
        ? `:${startLine + 1}`
        : "";
      return boundSourceDisplayText(`${displayPath}${lineSuffix}`);
    }
  };
}

/** Returns a workspace-relative path or only the basename for out-of-root input. */
function createSafeSourceDisplayPath(
  filePath: string,
  sourcePaths: PortableProjectPathNormalizer
): string | undefined {
  const value = filePath.trim();
  if (!value) {
    return undefined;
  }

  const workspace = sourcePaths.normalize();
  const normalized = sourcePaths.normalize(value);
  const displayPath = sourcePaths.contains(workspace.key, normalized.key)
    ? normalized.displayPath
    : getPortableBaseName(value);
  return displayPath ? boundSourceDisplayText(displayPath) : undefined;
}

/** Extracts one filename without consulting host-specific path semantics. */
function getPortableBaseName(filePath: string): string | undefined {
  const normalized = filePath.replace(/\\/gu, "/").replace(/\/+$/u, "");
  const baseName = normalized.slice(normalized.lastIndexOf("/") + 1).trim();
  return baseName && baseName !== "." && baseName !== ".." ? baseName : undefined;
}

/** Retains the filename-side tail when source display text exceeds its budget. */
function boundSourceDisplayText(value: string): string {
  if (value.length <= SOURCE_DISPLAY_CHARACTER_LIMIT) {
    return value;
  }

  return `…${value.slice(-(SOURCE_DISPLAY_CHARACTER_LIMIT - 1))}`;
}
