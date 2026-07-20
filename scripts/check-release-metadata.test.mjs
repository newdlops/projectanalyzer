/**
 * Unit coverage for release identity, tag, changelog, and platform artifact
 * guards used by the Marketplace deployment workflow.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  getExpectedArtifactNames,
  getExpectedReleaseTag,
  validateReleaseMetadata
} from "./check-release-metadata.mjs";

const PACKAGE_JSON = Object.freeze({
  license: "MIT",
  name: "project-analyzer",
  publisher: "newdlops",
  repository: {
    type: "git",
    url: "https://github.com/newdlops/projectanalyzer.git"
  },
  version: "1.2.3"
});

const PACKAGE_LOCK = Object.freeze({
  name: "project-analyzer",
  packages: {
    "": {
      name: "project-analyzer",
      version: "1.2.3"
    }
  },
  version: "1.2.3"
});

test("accepts synchronized release metadata and the complete native target set", () => {
  const errors = validateReleaseMetadata({
    artifactNames: getExpectedArtifactNames(PACKAGE_JSON),
    changelog: "# Changelog\n\n## 1.2.3 - 2026-07-20\n",
    packageJson: PACKAGE_JSON,
    packageLock: PACKAGE_LOCK,
    releaseTag: getExpectedReleaseTag(PACKAGE_JSON.version)
  });

  assert.deepEqual(errors, []);
});

test("rejects publisher, license, repository, version, lockfile, tag, and changelog drift", () => {
  const errors = validateReleaseMetadata({
    changelog: "# Changelog\n",
    packageJson: {
      ...PACKAGE_JSON,
      license: "UNLICENSED",
      publisher: "local",
      repository: "https://example.com/repository.git",
      version: "1.2.3-beta.1"
    },
    packageLock: PACKAGE_LOCK,
    releaseTag: "v9.9.9"
  }).join("\n");

  assert.match(errors, /publisher must be newdlops/);
  assert.match(errors, /license must be MIT/);
  assert.match(errors, /repository must be/);
  assert.match(errors, /numeric major\.minor\.patch/);
  assert.match(errors, /package-lock version must match/);
  assert.match(errors, /release tag must be/);
  assert.match(errors, /CHANGELOG\.md must contain/);
});

test("rejects partial and unexpected VSIX artifact sets", () => {
  const expected = getExpectedArtifactNames(PACKAGE_JSON);
  const errors = validateReleaseMetadata({
    artifactNames: [...expected.slice(1), "project-analyzer-1.2.3-web.vsix"],
    changelog: "## 1.2.3\n",
    packageJson: PACKAGE_JSON,
    packageLock: PACKAGE_LOCK,
    releaseTag: "v1.2.3"
  }).join("\n");

  assert.match(errors, new RegExp(`release artifact is missing: ${expected[0]}`));
  assert.match(errors, /unexpected release artifact: project-analyzer-1\.2\.3-web\.vsix/);
});

test("local packaging and release upload follow the current manifest identity", () => {
  const manifest = JSON.parse(readFileSync("package.json", "utf8"));
  const packageScript = readFileSync("scripts/package-extension.mjs", "utf8");
  const workflow = readFileSync(".github/workflows/release.yml", "utf8");

  assert.equal(`${manifest.publisher}.${manifest.name}`, "newdlops.function-analysis");
  assert.match(packageScript, /`\$\{packageJson\.name\}-\$\{packageJson\.version\}-\$\{target\}\.vsix`/u);
  assert.match(workflow, /path: "\*-\$\{\{ matrix\.target \}\}\.vsix"/u);
  assert.match(workflow, /itemName=newdlops\.function-analysis/u);
});
