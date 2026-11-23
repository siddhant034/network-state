import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { assertWorkflowPermissions, verifyWorkflowPermissions } from "./check-workflow-permissions.mjs";

const base = \`name: CI
on:
  pull_request:
permissions:
  contents: read
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - run: npm test
\`;

const newline = String.fromCharCode(10);

test("accepts explicit read-only workflow permissions", () => {
  assert.equal(assertWorkflowPermissions(base), true);
});

test("rejects missing or broad top-level permissions", () => {
  assert.throws(() => assertWorkflowPermissions(base.replace("permissions:" + newline + "  contents: read" + newline, "")), /exactly one top-level permissions/);
  assert.throws(() => assertWorkflowPermissions(base.replace("permissions:" + newline + "  contents: read", "permissions: write-all")), /explicit permissions mapping/);
  assert.throws(() => assertWorkflowPermissions(base.replace("contents: read", "contents: write")), /may only grant contents: read/);
});

test("rejects pull_request_target even with read-only permissions", () => {
  assert.throws(() => assertWorkflowPermissions(base.replace("pull_request:", "pull_request_target:")), /pull_request_target/);
});

test("allows narrowly scoped Pages deployment permissions", () => {
  const pages = base + \`  deploy:
    permissions:
      pages: write
      id-token: write
\`;
  assert.equal(assertWorkflowPermissions(pages), true);
});

test("rejects permission escalation in other jobs and extra Pages capabilities", () => {
  const otherJob = base + \`  verify:
    permissions:
      contents: write
\`;
  assert.throws(() => assertWorkflowPermissions(otherJob), /only allowed in the Pages deploy job/);
  const excessive = base + \`  deploy:
    permissions:
      contents: write
\`;
  assert.throws(() => assertWorkflowPermissions(excessive), /may grant only pages: write and id-token: write/);
});

test("checks every workflow in the directory", async () => {
  const directory = await mkdtemp(join(tmpdir(), "workflow-permissions-"));
  try {
    await mkdir(join(directory, "nested"));
    await writeFile(join(directory, "ci.yml"), base);
    await writeFile(join(directory, "nested", "pages.yaml"), base);
    assert.equal(await verifyWorkflowPermissions(directory), 2);
    await writeFile(join(directory, "nested", "pages.yaml"), base.replace("contents: read", "contents: write"));
    await assert.rejects(verifyWorkflowPermissions(directory), /may only grant contents: read/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
