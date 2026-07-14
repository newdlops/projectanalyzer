/**
 * Unit tests for portable Project Reading Guide root normalization.
 * Fixtures deliberately mix host-independent path families so Linux/macOS
 * Extension Hosts normalize analyzer output produced for Windows workspaces.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { createPortableProjectPathNormalizer } from "../../insights/projectReadingGuide/portableRootPath";

test("normalizes POSIX roots, relative paths, dot segments, and trailing slashes", () => {
  const paths = createPortableProjectPathNormalizer("/workspace/project/./");

  assert.deepEqual(paths.normalize(), {
    key: "/workspace/project",
    displayPath: "."
  });
  assert.deepEqual(paths.normalize("./apps//api/../web/"), {
    key: "/workspace/project/apps/web",
    displayPath: "apps/web"
  });
  assert.deepEqual(paths.normalize("/workspace/project/src/core/../shared/"), {
    key: "/workspace/project/src/shared",
    displayPath: "src/shared"
  });
  assert.deepEqual(paths.normalize("../shared"), {
    key: "/workspace/shared",
    displayPath: "/workspace/shared"
  });
});

test("keeps POSIX casing and uses segment boundaries for containment", () => {
  const paths = createPortableProjectPathNormalizer("/Workspace/Project");
  const parent = paths.normalize("src/API").key;
  const child = paths.normalize("src/API/client.ts").key;

  assert.equal(parent, "/Workspace/Project/src/API");
  assert.equal(paths.contains(parent, child), true);
  assert.equal(paths.contains(parent, paths.normalize("src/Application").key), false);
  assert.equal(paths.contains(parent.toLowerCase(), child), false);
  assert.equal(paths.depth("/Workspace/Project/src/API"), 4);
  assert.equal(paths.depth("/"), 0);
});

test("normalizes Windows drive paths with case-folded keys", () => {
  const paths = createPortableProjectPathNormalizer("C:\\Repo\\Project\\");

  assert.deepEqual(paths.normalize(".\\Apps\\API\\..\\Web\\"), {
    key: "c:/repo/project/apps/web",
    displayPath: "Apps/Web"
  });
  assert.deepEqual(paths.normalize("c:/REPO/PROJECT/Src/Main.ts"), {
    key: "c:/repo/project/src/main.ts",
    displayPath: "Src/Main.ts"
  });
  assert.deepEqual(paths.normalize("C:\\Repo\\Project"), {
    key: "c:/repo/project",
    displayPath: "."
  });
  assert.equal(
    paths.contains("C:/REPO/PROJECT", "c:\\repo\\project\\src\\main.ts"),
    true
  );
  assert.equal(paths.contains("c:/repo/app", "c:/repo/application"), false);
  assert.equal(paths.depth("C:/Repo/Project/src"), 3);
  assert.equal(paths.depth("c:/"), 0);
});

test("clamps Windows drive traversal at the volume root", () => {
  const paths = createPortableProjectPathNormalizer("C:/Repo");

  assert.deepEqual(paths.normalize("../../../Outside"), {
    key: "c:/outside",
    displayPath: "C:/Outside"
  });
});

test("normalizes UNC shares independently from the host operating system", () => {
  const paths = createPortableProjectPathNormalizer("\\\\Server\\Share\\Repo\\");

  assert.deepEqual(paths.normalize("src\\..\\Apps\\Api"), {
    key: "//server/share/repo/apps/api",
    displayPath: "Apps/Api"
  });
  assert.deepEqual(paths.normalize("//SERVER/SHARE/REPO/Lib"), {
    key: "//server/share/repo/lib",
    displayPath: "Lib"
  });
  assert.equal(
    paths.contains("//SERVER/SHARE/Repo", "\\\\server\\share\\repo\\Apps"),
    true
  );
  assert.equal(paths.contains("//server/share", "//server/other/path"), false);
  assert.equal(paths.depth("//server/share"), 0);
  assert.equal(paths.depth("//server/share/Repo/Apps"), 2);
});

test("supports a relative workspace without consulting the filesystem", () => {
  const paths = createPortableProjectPathNormalizer("repo/./project");

  assert.deepEqual(paths.normalize("src/../app"), {
    key: "repo/project/app",
    displayPath: "app"
  });
  assert.equal(paths.contains("repo/project", "repo/project/app"), true);
  assert.equal(paths.contains("repo/project", "repo/project-old"), false);
});
