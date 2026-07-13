/**
 * Rust-engine integration fixtures for route-centered semantic flows. These
 * tests guard the JSON contract between framework extraction, callable symbols,
 * and the TypeScript insight builder for the first four backend frameworks.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createSemanticFlowIndex, type SemanticFlow } from "../../insights/semanticFlow";
import type { ProjectGraph } from "../../shared/types";

const projectRoot = path.resolve(__dirname, "../../..");
const engineManifest = path.join(projectRoot, "engine", "analyzer", "Cargo.toml");

test("Rust framework fixtures map Django, FastAPI, Express, and Nest routes to handlers", async () => {
  const fixtureRoot = await mkdtemp(path.join(tmpdir(), "project-analyzer-semantic-flow-"));

  try {
    const fixtures = [
      await createDjangoFixture(path.join(fixtureRoot, "django")),
      await createFastApiFixture(path.join(fixtureRoot, "fastapi")),
      await createExpressFixture(path.join(fixtureRoot, "express")),
      await createNestFixture(path.join(fixtureRoot, "nest"))
    ];
    const expected = [
      {
        framework: "Django",
        routeLabel: "posts/",
        handlerName: "feed",
        importedBindingName: "fetch_feed",
        serviceName: "build_feed",
        serviceFile: "app/services.py"
      },
      {
        framework: "FastAPI",
        routeLabel: "GET /items/{item_id}",
        handlerName: "read_item",
        importedBindingName: "load_item",
        serviceName: "load_item",
        serviceFile: "services.py"
      },
      {
        framework: "Express",
        routeLabel: "GET /users/:id",
        handlerName: "showUser",
        importedBindingName: "loadUser",
        serviceName: "loadUser",
        serviceFile: "userService.ts"
      },
      { framework: "NestJS", routeLabel: "GET /users/:id", handlerName: "findOne" }
    ];

    for (let index = 0; index < fixtures.length; index += 1) {
      const graph = analyzeFixtureWorkspace(fixtures[index]);
      const semanticFlows = createSemanticFlowIndex(graph);
      const flow = findExpectedFlow(semanticFlows.flows, expected[index].framework, expected[index].routeLabel);
      const handler = flow.steps.find((step) => step.kind === "handler" && step.functionId !== undefined);

      assert.ok(handler, `missing mapped handler for ${expected[index].framework}`);
      assert.equal(handler.functionName, expected[index].handlerName);
      assert.equal(flow.coverageGaps.length, 0);

      const serviceName = expected[index].serviceName;
      const serviceFile = expected[index].serviceFile;
      const importedBindingName = expected[index].importedBindingName;
      if (serviceName !== undefined && serviceFile !== undefined && importedBindingName !== undefined) {
        const serviceCall = flow.steps.find((step) =>
          step.kind === "call"
          && step.parentFunctionId === handler.functionId
          && step.functionName === serviceName
        );

        assert.ok(serviceCall, `missing imported service call for ${expected[index].framework}`);
        assert.equal(serviceCall.depth, handler.depth + 1);
        assert.equal(serviceCall.resolution, "concrete");
        assert.equal(serviceCall.confidence, "resolved");
        assert.ok(serviceCall.functionId, `missing service function id for ${expected[index].framework}`);

        const serviceCallable = graph.nodes.find((node) => node.id === serviceCall.functionId);
        assert.ok(serviceCallable, `missing service callable node for ${expected[index].framework}`);
        assert.equal(serviceCallable.kind, "function");
        assert.equal(serviceCallable.name, serviceName);
        assert.ok(
          serviceCallable.filePath.endsWith(serviceFile),
          `expected ${serviceCallable.filePath} to end with ${serviceFile}`
        );

        const unresolvedImportedBinding = flow.steps.find((step) =>
          step.kind === "call"
          && step.parentFunctionId === handler.functionId
          && step.resolution === "unresolved"
          && (step.functionName === importedBindingName || step.name === importedBindingName)
        );
        assert.equal(
          unresolvedImportedBinding,
          undefined,
          `unexpected unresolved placeholder for ${expected[index].framework} import ${importedBindingName}`
        );
      }
    }
  } finally {
    await rm(fixtureRoot, { force: true, recursive: true });
  }
});

/** Runs the current Rust source so integration tests never use a stale binary. */
function analyzeFixtureWorkspace(workspaceRoot: string): ProjectGraph {
  const output = execFileSync(
    "cargo",
    [
      "run",
      "--quiet",
      "--manifest-path",
      engineManifest,
      "--",
      "analyze-workspace",
      "--workspace",
      workspaceRoot,
      "--max-file-size-kb",
      "1024"
    ],
    {
      cwd: projectRoot,
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024
    }
  );

  return JSON.parse(output) as ProjectGraph;
}

/** Finds a route by declared framework and analyzer-provided display label. */
function findExpectedFlow(
  flows: SemanticFlow[],
  framework: string,
  routeLabel: string
): SemanticFlow {
  const flow = flows.find((candidate) =>
    candidate.framework === framework && candidate.name.includes(routeLabel)
  );

  assert.ok(flow, `missing ${framework} route containing ${routeLabel}`);
  return flow;
}

/** Creates a Django cross-file urls.py to async view fixture. */
async function createDjangoFixture(root: string): Promise<string> {
  await writeFixtureFile(root, "requirements.txt", "Django>=4\n");
  await writeFixtureFile(
    root,
    "app/urls.py",
    "from django.urls import path\nfrom . import views\n\nurlpatterns = [\n    path(\"posts/\", views.feed, name=\"feed\"),\n]\n"
  );
  await writeFixtureFile(
    root,
    "app/views.py",
    "from .services import build_feed as fetch_feed\n\nasync def feed(request):\n    return fetch_feed()\n"
  );
  await writeFixtureFile(
    root,
    "app/services.py",
    "def build_feed():\n    return {\"ok\": True}\n"
  );
  return root;
}

/** Creates a FastAPI decorator-to-async-function fixture. */
async function createFastApiFixture(root: string): Promise<string> {
  await writeFixtureFile(root, "requirements.txt", "fastapi==0.111\n");
  await writeFixtureFile(
    root,
    "services.py",
    "def load_item(item_id: int):\n    return {\"item_id\": item_id}\n"
  );
  await writeFixtureFile(
    root,
    "main.py",
    "from fastapi import FastAPI\nfrom services import load_item\n\napp = FastAPI()\n\n@app.get(\"/items/{item_id}\")\nasync def read_item(item_id: int):\n    return load_item(item_id)\n"
  );
  return root;
}

/** Creates an Express named local handler fixture. */
async function createExpressFixture(root: string): Promise<string> {
  await writeFixtureFile(root, "package.json", '{"dependencies":{"express":"^4.18.0"}}');
  await writeFixtureFile(
    root,
    "userService.ts",
    "export function loadUser(id: string) { return { id }; }\n"
  );
  await writeFixtureFile(
    root,
    "server.ts",
    "import express from \"express\";\nimport { loadUser } from \"./userService\";\nconst app = express();\nfunction showUser(req, res) { res.json(loadUser(req.params.id)); }\napp.get(\"/users/:id\", showUser);\n"
  );
  return root;
}

/** Creates a NestJS decorated controller method fixture. */
async function createNestFixture(root: string): Promise<string> {
  await writeFixtureFile(root, "package.json", '{"dependencies":{"@nestjs/core":"^10.0.0"}}');
  await writeFixtureFile(
    root,
    "users.controller.ts",
    "import { Controller, Get } from \"@nestjs/common\";\n\n@Controller(\"users\")\nexport class UsersController {\n  @Get(\":id\")\n  findOne() { return {}; }\n}\n"
  );
  return root;
}

/** Writes one fixture file after creating its parent directory. */
async function writeFixtureFile(root: string, relativePath: string, content: string): Promise<void> {
  const filePath = path.join(root, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");
}
