/**
 * Portable lexical path normalization for Project Reading Guide scopes.
 *
 * The module deliberately avoids host-OS `path` semantics: analyzer payloads
 * can contain POSIX, Windows drive, or UNC roots regardless of the Extension
 * Host platform. Canonical keys support scope identity and containment, while
 * display paths stay relative to the analyzed workspace whenever possible.
 */

/** One canonical project path and its workspace-oriented display value. */
export type PortableProjectPath = {
  key: string;
  displayPath: string;
};

/** Public lexical operations shared by scope aggregation and lazy projection. */
export type PortableProjectPathNormalizer = {
  /** Resolves one optional path and returns its canonical key and display path. */
  normalize(input?: string): PortableProjectPath;
  /** Tests canonical ancestry at path-segment boundaries, including equality. */
  contains(parentKey: string, childKey: string): boolean;
  /** Counts path segments below the POSIX, drive, UNC share, or relative root. */
  depth(key: string): number;
};

type PortablePathKind = "posix" | "windowsDrive" | "unc" | "relative";

/** Internal path form keeps display casing separate from identity casing. */
type ParsedPortablePath = {
  kind: PortablePathKind;
  absolute: boolean;
  windowsCaseInsensitive: boolean;
  rootKey: string;
  rootDisplay: string;
  keySegments: string[];
  displaySegments: string[];
};

type PortablePathRoot = Omit<ParsedPortablePath, "keySegments" | "displaySegments"> & {
  remainder: string;
};

/**
 * Creates one workspace-bound lexical normalizer.
 *
 * Relative inputs resolve against the normalized workspace. No filesystem
 * access is performed, and `..` never traverses above an absolute volume root.
 */
export function createPortableProjectPathNormalizer(
  workspaceRoot: string
): PortableProjectPathNormalizer {
  /** Canonical workspace identity used by every relative normalization call. */
  const workspace = parsePortablePath(workspaceRoot);

  return {
    normalize(input?: string): PortableProjectPath {
      const value = input?.trim();
      const parsed = !value ? workspace : parsePortablePath(value, workspace);

      return {
        key: formatKey(parsed),
        displayPath: createWorkspaceDisplayPath(workspace, parsed)
      };
    },

    contains(parentKey: string, childKey: string): boolean {
      const parent = parsePortablePath(parentKey);
      const child = parsePortablePath(childKey);
      return containsParsedPath(parent, child);
    },

    depth(key: string): number {
      return parsePortablePath(key).keySegments.length;
    }
  };
}

/** Parses an absolute path or resolves one relative path against a base. */
function parsePortablePath(
  input: string,
  relativeBase?: ParsedPortablePath
): ParsedPortablePath {
  const normalizedSlashes = input.trim().replace(/\\/gu, "/");
  const root = parsePortableRoot(normalizedSlashes);

  if (root.kind === "relative" && relativeBase) {
    const segments = reduceSegments(
      relativeBase.displaySegments,
      relativeBase.keySegments,
      splitSegments(root.remainder),
      relativeBase.windowsCaseInsensitive,
      relativeBase.absolute
    );

    return {
      kind: relativeBase.kind,
      absolute: relativeBase.absolute,
      windowsCaseInsensitive: relativeBase.windowsCaseInsensitive,
      rootKey: relativeBase.rootKey,
      rootDisplay: relativeBase.rootDisplay,
      keySegments: segments.keySegments,
      displaySegments: segments.displaySegments
    };
  }

  const segments = reduceSegments(
    [],
    [],
    splitSegments(root.remainder),
    root.windowsCaseInsensitive,
    root.absolute
  );

  return {
    kind: root.kind,
    absolute: root.absolute,
    windowsCaseInsensitive: root.windowsCaseInsensitive,
    rootKey: root.rootKey,
    rootDisplay: root.rootDisplay,
    keySegments: segments.keySegments,
    displaySegments: segments.displaySegments
  };
}

/** Identifies POSIX, drive, UNC, and relative lexical roots. */
function parsePortableRoot(input: string): PortablePathRoot {
  const unc = input.match(/^\/{2,}([^/]+)\/+([^/]+)(?:\/+([\s\S]*))?$/u);

  if (unc) {
    const server = unc[1];
    const share = unc[2];
    return {
      kind: "unc",
      absolute: true,
      windowsCaseInsensitive: true,
      rootKey: `//${server.toLowerCase()}/${share.toLowerCase()}`,
      rootDisplay: `//${server}/${share}`,
      remainder: unc[3] ?? ""
    };
  }

  const drive = input.match(/^([A-Za-z]):(?:\/+([\s\S]*))?$/u);

  if (drive) {
    const driveName = drive[1];
    return {
      kind: "windowsDrive",
      absolute: true,
      windowsCaseInsensitive: true,
      rootKey: `${driveName.toLowerCase()}:/`,
      rootDisplay: `${driveName}:/`,
      remainder: drive[2] ?? ""
    };
  }

  if (input.startsWith("/")) {
    return {
      kind: "posix",
      absolute: true,
      windowsCaseInsensitive: false,
      rootKey: "/",
      rootDisplay: "/",
      remainder: input.replace(/^\/+/, "")
    };
  }

  return {
    kind: "relative",
    absolute: false,
    windowsCaseInsensitive: false,
    rootKey: "",
    rootDisplay: "",
    remainder: input
  };
}

/** Splits path components without retaining repeated or trailing separators. */
function splitSegments(remainder: string): string[] {
  return remainder.split("/").filter((segment) => segment.length > 0);
}

/**
 * Reduces `.` and `..` with an explicit stack.
 *
 * Display and key stacks move together so Windows keys can case-fold without
 * discarding source casing used by workspace-relative labels.
 */
function reduceSegments(
  initialDisplaySegments: readonly string[],
  initialKeySegments: readonly string[],
  incomingSegments: readonly string[],
  windowsCaseInsensitive: boolean,
  absolute: boolean
): { keySegments: string[]; displaySegments: string[] } {
  const displaySegments = [...initialDisplaySegments];
  const keySegments = [...initialKeySegments];

  for (const segment of incomingSegments) {
    if (segment === ".") {
      continue;
    }

    if (segment === "..") {
      const lastSegment = displaySegments.at(-1);

      if (lastSegment !== undefined && lastSegment !== "..") {
        displaySegments.pop();
        keySegments.pop();
      } else if (!absolute) {
        displaySegments.push(segment);
        keySegments.push(segment);
      }

      continue;
    }

    displaySegments.push(segment);
    keySegments.push(windowsCaseInsensitive ? segment.toLowerCase() : segment);
  }

  return { keySegments, displaySegments };
}

/** Creates the stable identity used for scope grouping and cache requests. */
function formatKey(path: ParsedPortablePath): string {
  const suffix = path.keySegments.join("/");

  if (path.kind === "posix") {
    return suffix ? `/${suffix}` : "/";
  }

  if (path.kind === "windowsDrive") {
    return suffix ? `${path.rootKey}${suffix}` : path.rootKey;
  }

  if (path.kind === "unc") {
    return suffix ? `${path.rootKey}/${suffix}` : path.rootKey;
  }

  return suffix || ".";
}

/** Formats a canonical absolute or standalone relative path for display. */
function formatDisplayPath(path: ParsedPortablePath): string {
  const suffix = path.displaySegments.join("/");

  if (path.kind === "posix") {
    return suffix ? `/${suffix}` : "/";
  }

  if (path.kind === "windowsDrive") {
    return suffix ? `${path.rootDisplay}${suffix}` : path.rootDisplay;
  }

  if (path.kind === "unc") {
    return suffix ? `${path.rootDisplay}/${suffix}` : path.rootDisplay;
  }

  return suffix || ".";
}

/** Returns a compact workspace-relative label when the path is contained. */
function createWorkspaceDisplayPath(
  workspace: ParsedPortablePath,
  path: ParsedPortablePath
): string {
  if (!containsParsedPath(workspace, path)) {
    return formatDisplayPath(path);
  }

  const relativeSegments = path.displaySegments.slice(workspace.displaySegments.length);
  return relativeSegments.join("/") || ".";
}

/** Performs root-aware, segment-boundary containment without string prefixes. */
function containsParsedPath(parent: ParsedPortablePath, child: ParsedPortablePath): boolean {
  if (parent.kind !== child.kind || parent.rootKey !== child.rootKey) {
    return false;
  }

  if (parent.keySegments.length > child.keySegments.length) {
    return false;
  }

  for (let index = 0; index < parent.keySegments.length; index += 1) {
    if (parent.keySegments[index] !== child.keySegments[index]) {
      return false;
    }
  }

  return true;
}
