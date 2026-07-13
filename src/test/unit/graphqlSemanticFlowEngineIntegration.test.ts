/**
 * End-to-end GraphQL fixtures for the Rust analyzer, semantic-flow domain,
 * and summary-first Function Explorer projection. These tests protect the
 * operation-level dispatch that replaces a single undifferentiated endpoint.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createDefaultSemanticFlowExpandedRowIds,
  createSemanticFlowRows,
  REQUEST_FLOW_ROWS_ROOT_ID
} from "../../application/functionExplorer/semanticFlowRows";
import {
  createSemanticFlowIndex,
  type SemanticFlow,
  type SemanticFlowIndex
} from "../../insights/semanticFlow";
import type { FunctionExplorerRow } from "../../protocol/functionExplorer";
import type { ProjectGraph } from "../../shared/types";

const projectRoot = path.resolve(__dirname, "../../..");
const engineManifest = path.join(projectRoot, "engine", "analyzer", "Cargo.toml");
const graphqlFrameworkRowId = `${REQUEST_FLOW_ROWS_ROOT_ID}:framework:GraphQL`;

test("NestJS GraphQL operations map to resolver methods and stay summary-first in rows", async () => {
  const fixtureRoot = await mkdtemp(path.join(tmpdir(), "project-analyzer-nest-graphql-flow-"));

  try {
    await createNestGraphQLFixture(fixtureRoot);
    const graph = analyzeFixtureWorkspace(fixtureRoot);
    const index = createSemanticFlowIndex(graph);

    assertGraphQLOperationSummary(index, 4);
    assert.deepEqual(
      index.flows.map((flow) => flow.name).sort(),
      ["createUser", "user", "userCreated", "users"]
    );
    assert.equal(index.flows.some((flow) => flow.name === "profile"), false);

    for (const flow of index.flows) {
      assertConcreteResolver(flow);
    }

    assertSummaryFirstRows(index, { Query: 2, Mutation: 1, Subscription: 1 });
  } finally {
    await rm(fixtureRoot, { force: true, recursive: true });
  }
});

test("Strawberry operations map sync and async resolvers plus an imported service call", async () => {
  const fixtureRoot = await mkdtemp(path.join(tmpdir(), "project-analyzer-strawberry-flow-"));

  try {
    await createStrawberryFixture(fixtureRoot);
    const graph = analyzeFixtureWorkspace(fixtureRoot);
    const index = createSemanticFlowIndex(graph);

    assertGraphQLOperationSummary(index, 4);
    assert.deepEqual(
      index.flows.map((flow) => flow.name).sort(),
      ["hello", "notifications", "rename_user", "viewer"]
    );

    for (const flow of index.flows) {
      assertConcreteResolver(flow);
    }

    const viewerFlow = requireFlow(index, "viewer");
    const resolver = requireConcreteResolver(viewerFlow);
    const serviceCall = viewerFlow.steps.find((step) =>
      step.kind === "call"
      && step.parentFunctionId === resolver.functionId
      && step.functionName === "load_viewer"
    );

    assert.ok(serviceCall, "missing imported Strawberry service call");
    assert.equal(serviceCall.resolution, "concrete");
    assert.equal(serviceCall.confidence, "resolved");
    assert.ok(serviceCall.functionId);
    assert.ok(serviceCall.filePath.endsWith("services.py"));
    assert.equal(
      viewerFlow.steps.some((step) =>
        step.kind === "call"
        && step.parentFunctionId === resolver.functionId
        && step.name === "load_viewer"
        && step.resolution === "unresolved"
      ),
      false
    );
  } finally {
    await rm(fixtureRoot, { force: true, recursive: true });
  }
});

/** Runs the current Rust source so the contract test cannot use a stale binary. */
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

/** Verifies that GraphQL operation counts stay separate from HTTP routes. */
function assertGraphQLOperationSummary(index: SemanticFlowIndex, operationCount: number): void {
  assert.equal(index.summary.entrypointCount, operationCount);
  assert.equal(index.summary.operationCount, operationCount);
  assert.equal(index.summary.routeCount, 0);
  assert.equal(index.summary.mappedHandlerCount, operationCount);
  assert.equal(index.coverageGaps.length, 0);
  assert.equal(index.flows.every((flow) => flow.entrypointKind === "graphqlOperation"), true);
}

/** Requires one direct, source-backed resolver method for an operation flow. */
function assertConcreteResolver(flow: SemanticFlow): void {
  const resolver = requireConcreteResolver(flow);

  assert.equal(resolver.role, "resolver");
  assert.equal(resolver.functionName, flow.name);
  assert.equal(flow.coverageGaps.length, 0);
}

/** Returns the uniquely mapped resolver stage for downstream assertions. */
function requireConcreteResolver(flow: SemanticFlow) {
  const resolver = flow.steps.find((step) =>
    step.kind === "handler"
    && step.resolution === "concrete"
    && step.functionId !== undefined
  );

  assert.ok(resolver, `missing concrete resolver for ${flow.name}`);
  return resolver;
}

/** Finds one operation flow by its analyzer-provided operation name. */
function requireFlow(index: SemanticFlowIndex, name: string): SemanticFlow {
  const flow = index.flows.find((candidate) => candidate.name === name);
  assert.ok(flow, `missing GraphQL operation ${name}`);
  return flow;
}

/**
 * Verifies that large GraphQL schemas reveal only one bounded hierarchy level
 * per expansion instead of rendering every resolver at once.
 */
function assertSummaryFirstRows(
  index: SemanticFlowIndex,
  expectedCounts: Readonly<Record<"Query" | "Mutation" | "Subscription", number>>
): void {
  const defaultRows = createSemanticFlowRows(index, {
    expandedRowIds: createDefaultSemanticFlowExpandedRowIds(index)
  });
  const frameworkRow = requireRow(defaultRows, graphqlFrameworkRowId);

  assert.equal(frameworkRow.detail, "4 operations / 4 resolvers");
  assert.equal(frameworkRow.expanded, false);
  assert.equal(defaultRows.some(isOperationRow), false);
  assert.equal(defaultRows.some(isGraphQLOperationTypeBucket), false);

  const frameworkRows = createSemanticFlowRows(index, {
    expandedRowIds: [REQUEST_FLOW_ROWS_ROOT_ID, graphqlFrameworkRowId]
  });

  for (const operationType of ["Query", "Mutation", "Subscription"] as const) {
    const bucketId = createOperationTypeBucketId(operationType);
    const bucket = requireRow(frameworkRows, bucketId);

    assert.equal(bucket.detail, `${expectedCounts[operationType]} operations`);
    assert.equal(bucket.expanded, false);
  }
  assert.equal(frameworkRows.filter(isGraphQLOperationTypeBucket).length, 3);
  assert.equal(frameworkRows.some(isOperationRow), false);

  const queryRows = createSemanticFlowRows(index, {
    expandedRowIds: [
      REQUEST_FLOW_ROWS_ROOT_ID,
      graphqlFrameworkRowId,
      createOperationTypeBucketId("Query")
    ]
  });
  assert.equal(queryRows.filter(isOperationRow).length, expectedCounts.Query);
}

/** Creates a Nest resolver with four root operations and one excluded field resolver. */
async function createNestGraphQLFixture(root: string): Promise<void> {
  await writeFixtureFile(
    root,
    "package.json",
    '{"dependencies":{"@nestjs/graphql":"^12.0.0","graphql":"^16.0.0"}}'
  );
  await writeFixtureFile(
    root,
    "src/users.resolver.ts",
    "import { Mutation, Query, ResolveField, Resolver, Subscription } from \"@nestjs/graphql\";\n\n@Resolver(() => User)\nexport class UsersResolver {\n  @Query(() => [User])\n  users() { return []; }\n\n  @Query(() => User)\n  async user() { return {}; }\n\n  @Mutation(() => User)\n  createUser() { return {}; }\n\n  @Subscription(() => User)\n  userCreated() { return {}; }\n\n  @ResolveField(() => Profile)\n  profile() { return {}; }\n}\n"
  );
}

/** Creates Strawberry root types with a cross-file bare imported service call. */
async function createStrawberryFixture(root: string): Promise<void> {
  await writeFixtureFile(root, "requirements.txt", "strawberry-graphql==0.235\n");
  await writeFixtureFile(
    root,
    "services.py",
    "def load_viewer():\n    return \"viewer\"\n"
  );
  await writeFixtureFile(
    root,
    "schema.py",
    "import strawberry\nfrom services import load_viewer\n\n@strawberry.type\nclass Query:\n    @strawberry.field\n    def hello(self) -> str:\n        return \"hello\"\n\n    @strawberry.field\n    async def viewer(self) -> str:\n        return load_viewer()\n\n@strawberry.type\nclass Mutation:\n    @strawberry.mutation\n    def rename_user(self) -> str:\n        return \"renamed\"\n\n@strawberry.type\nclass Subscription:\n    @strawberry.subscription\n    async def notifications(self) -> str:\n        return \"notification\"\n"
  );
}

/** Writes one fixture file after creating its parent directory. */
async function writeFixtureFile(root: string, relativePath: string, content: string): Promise<void> {
  const filePath = path.join(root, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");
}

/** Returns one expected explorer row or fails with its stable identity. */
function requireRow(rows: FunctionExplorerRow[], rowId: string): FunctionExplorerRow {
  const row = rows.find((candidate) => candidate.id === rowId);
  assert.ok(row, `missing row ${rowId}`);
  return row;
}

/** Recreates the adapter's stable GraphQL operation-type bucket identity. */
function createOperationTypeBucketId(operationType: string): string {
  return `${graphqlFrameworkRowId}:graphql:${operationType.toLowerCase()}`;
}

/** Identifies GraphQL type buckets without depending on their visible labels. */
function isGraphQLOperationTypeBucket(row: FunctionExplorerRow): boolean {
  return typeof row.metadata?.graphqlOperationType === "string";
}

/** Identifies only concrete operation rows, excluding resolver child rows. */
function isOperationRow(row: FunctionExplorerRow): boolean {
  return row.metadata?.entrypointKind === "graphqlOperation";
}
