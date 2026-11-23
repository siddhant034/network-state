import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { assertWorkflowPermissions, verifyWorkflowPermissions } from "./check-workflow-permissions.mjs";

const base = `name: CI
on:
  pull_request:
permissions:
  contents: read
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - run: npm test
`;

const newline = String.fromCharCode(10);

test("accepts explicit read-only workflow permissions", () => {
  assert.equal(assertWorkflowPermissions(base), true);
});

test("rejects missing or broad top-level permissions", () => {
  assert.throws(() => assertWorkflowPermissions(base.replace("permissions:" + newline + "  contents: read" + newline, "")), /exactly one top-level permissions/);
  assert.throws(() => assertWorkflowPermissions(base.replace("permissions:" + newline + "  contents: read", "permissions: write-all")), /explicit mapping/);
  assert.throws(() => assertWorkflowPermissions(base.replace("contents: read", "contents: write")), /workflow permissions may only grant contents: read/);
  assert.throws(() => assertWorkflowPermissions(base.replace("contents: read", "contents: read" + newline + "  actions: read")), /workflow permissions may only grant contents: read/);
});

test("rejects pull_request_target even with read-only permissions", () => {
  assert.throws(() => assertWorkflowPermissions(base.replace("pull_request:", "pull_request_target:")), /pull_request_target/);
});

test("allows explicit read-only permissions on a build job", () => {
  const build = base.replace("  verify:", "  build:" + newline + "    permissions:" + newline + "      contents: read" + newline + "  verify:");
  assert.equal(assertWorkflowPermissions(build), true);
});

test("allows only the exact Pages deployment write grants", () => {
  const pages = base + `  deploy:
    permissions:
      pages: write
      id-token: write
`;
  assert.equal(assertWorkflowPermissions(pages), true);
  assert.throws(() => assertWorkflowPermissions(pages.replace("      id-token: write" + newline, "")), /job deploy may grant only contents: read, or Pages deploy's pages: write and id-token: write/);
  assert.throws(() => assertWorkflowPermissions(pages.replace("      pages: write", "      pages: write" + newline + "      contents: write")), /may grant only contents: read, or Pages deploy's pages: write and id-token: write/);
});

test("rejects write permissions outside the Pages deploy job", () => {
  const elevated = base.replace("  verify:", "  verify:" + newline + "    permissions:" + newline + "      contents: write");
  assert.throws(() => assertWorkflowPermissions(elevated), /job verify may grant only contents: read/);
});

test("rejects duplicate and unsupported permission entries", () => {
  const duplicate = base.replace("contents: read", "contents: read" + newline + "  contents: read");
  assert.throws(() => assertWorkflowPermissions(duplicate), /duplicate permission contents/);
  const unsupported = base.replace("contents: read", "contents: write-all");
  assert.throws(() => assertWorkflowPermissions(unsupported), /unsupported permission entry/);
});

test("checks every workflow in the directory", async () => {
  const directory = await mkdtemp(join(tmpdir(), "workflow-permissions-"));
  try {
    await mkdir(join(directory, "nested"));
    await writeFile(join(directory, "ci.yml"), base);
    await writeFile(join(directory, "nested", "pages.yaml"), base);
    assert.equal(await verifyWorkflowPermissions(directory), 2);
    await writeFile(join(directory, "nested", "pages.yaml"), base.replace("contents: read", "contents: write"));
    await assert.rejects(verifyWorkflowPermissions(directory), /workflow permissions may only grant contents: read/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
