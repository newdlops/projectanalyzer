/**
 * Validates owner-controlled Marketplace metadata, release tags, and the exact
 * platform package set before a Project Analyzer release can be published.
 */

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXPECTED_LICENSE = "MIT";
const EXPECTED_PUBLISHER = "newdlops";
const EXPECTED_REPOSITORY = "https://github.com/newdlops/projectanalyzer.git";

/** Native desktop targets built on matching GitHub-hosted runner architectures. */
export const RELEASE_TARGETS = Object.freeze([
  "darwin-arm64",
  "darwin-x64",
  "linux-arm64",
  "linux-x64",
  "win32-arm64",
  "win32-x64"
]);

/** Returns the immutable tag expected for one manifest version. */
export function getExpectedReleaseTag(version) {
  return `v${version}`;
}

/** Returns the deterministic VSIX names expected from the release matrix. */
export function getExpectedArtifactNames(packageJson) {
  return RELEASE_TARGETS.map(
    (target) => `${packageJson.name}-${packageJson.version}-${target}.vsix`
  );
}

/**
 * Checks the release identity shared by npm, VS Code Marketplace, the changelog,
 * and GitHub. Artifact names are optional so this also supports pre-build checks.
 */
export function validateReleaseMetadata({
  artifactNames,
  changelog,
  packageJson,
  packageLock,
  releaseTag
}) {
  const errors = [];
  const lockRoot = packageLock.packages?.[""];
  const repositoryUrl = typeof packageJson.repository === "string"
    ? packageJson.repository
    : packageJson.repository?.url;

  if (packageJson.publisher !== EXPECTED_PUBLISHER) {
    errors.push(
      `publisher must be ${EXPECTED_PUBLISHER}, received ${String(packageJson.publisher)}`
    );
  }
  if (packageJson.license !== EXPECTED_LICENSE) {
    errors.push(`license must be ${EXPECTED_LICENSE}, received ${String(packageJson.license)}`);
  }
  if (repositoryUrl !== EXPECTED_REPOSITORY) {
    errors.push(
      `repository must be ${EXPECTED_REPOSITORY}, received ${String(repositoryUrl)}`
    );
  }
  if (!isStableMarketplaceVersion(packageJson.version)) {
    errors.push(`version must use numeric major.minor.patch form: ${String(packageJson.version)}`);
  }
  if (packageLock.name !== packageJson.name || lockRoot?.name !== packageJson.name) {
    errors.push("package-lock name must match package.json");
  }
  if (
    packageLock.version !== packageJson.version ||
    lockRoot?.version !== packageJson.version
  ) {
    errors.push("package-lock version must match package.json");
  }

  const expectedTag = getExpectedReleaseTag(packageJson.version);
  if (releaseTag !== undefined && releaseTag !== expectedTag) {
    errors.push(`release tag must be ${expectedTag}, received ${releaseTag}`);
  }

  const changelogHeading = new RegExp(
    `^## ${escapeRegExp(packageJson.version)}(?:\\s+-|$)`,
    "m"
  );
  if (!changelogHeading.test(changelog)) {
    errors.push(`CHANGELOG.md must contain a ${packageJson.version} release heading`);
  }

  if (artifactNames !== undefined) {
    errors.push(...validateArtifactNames(artifactNames, packageJson));
  }

  return errors;
}

/** Ensures the publish job cannot silently release a partial or mixed target set. */
function validateArtifactNames(artifactNames, packageJson) {
  const errors = [];
  const actual = [...artifactNames].sort();
  const expected = getExpectedArtifactNames(packageJson).sort();
  const actualSet = new Set(actual);
  const expectedSet = new Set(expected);

  for (const expectedName of expected) {
    if (!actualSet.has(expectedName)) {
      errors.push(`release artifact is missing: ${expectedName}`);
    }
  }
  for (const actualName of actual) {
    if (!expectedSet.has(actualName)) {
      errors.push(`unexpected release artifact: ${actualName}`);
    }
  }
  if (actualSet.size !== actual.length) {
    errors.push("release artifact names must be unique");
  }

  return errors;
}

/** Marketplace versions intentionally exclude prerelease/build suffixes. */
function isStableMarketplaceVersion(version) {
  return typeof version === "string" && /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(version);
}

/** Quotes a manifest version before using it in a changelog expression. */
function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Loads repository files and performs the release check as a CLI command. */
async function main() {
  const releaseTag = process.argv[2];
  const artifactDirectory = process.argv[3];
  const [packageText, lockText, changelog] = await Promise.all([
    readFile(path.join(projectRoot, "package.json"), "utf8"),
    readFile(path.join(projectRoot, "package-lock.json"), "utf8"),
    readFile(path.join(projectRoot, "CHANGELOG.md"), "utf8")
  ]);
  const packageJson = JSON.parse(packageText);
  const packageLock = JSON.parse(lockText);
  const artifactNames = artifactDirectory === undefined
    ? undefined
    : (await readdir(path.resolve(projectRoot, artifactDirectory))).filter((name) => name.endsWith(".vsix"));
  const errors = validateReleaseMetadata({
    artifactNames,
    changelog,
    packageJson,
    packageLock,
    releaseTag
  });

  if (errors.length > 0) {
    console.error("Release metadata check failed:");
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exitCode = 1;
    return;
  }

  const artifactSummary = artifactNames === undefined
    ? "metadata only"
    : `${artifactNames.length} platform packages`;
  console.log(
    `Release metadata check passed: ${packageJson.publisher}.${packageJson.name} ` +
      `${packageJson.version} (${artifactSummary})`
  );
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : undefined;
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
