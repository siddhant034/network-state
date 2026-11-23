import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { assertImmutableActionPins, findActionReferences, verifyWorkflowDirectory } from "./check-workflow-pins.mjs";

const SHA = "a".repeat(40);

test("accepts full immutable SHAs, safe local composite actions, and quoted keys", () => {
  const source = "steps:\n" +
    "  - uses: actions/checkout@" + SHA + " # reviewed release\n" +
    "  - uses: ./.github/actions/local\n" +
    "  - name: quoted action\n" +
    "    uses: 'actions/setup-node@" + SHA + "'\n" +
    "  - \"uses\": \"owner/action@" + SHA + "\" # comment\n";
  assert.equal(assertImmutableActionPins(source), 4);
});

test("rejects mutable refs, abbreviated hashes, and unsafe local paths", () => {
  for (const reference of [
    "actions/checkout@v4",
    "owner/action@main",
    "owner/action@1234567",
    "./../outside",
    "./local/../outside",
    "./local@mutable",
  ]) {
    assert.throws(() => assertImmutableActionPins("steps:\n  - uses: " + reference + "\n"), /mutable or invalid action ref/);
  }
});

test("rejects YAML scalar forms the dependency-free scanner cannot parse", () => {
  const cases = [
    "steps:\n  - uses: >-\n      owner/action@" + SHA + "\n",
    "steps:\n  - uses: *pinned\n",
    "steps:\n  - uses: &pinned owner/action@" + SHA + "\n",
    "steps:\n  - uses:\n      owner/action@" + SHA + "\n",
  ];
  for (const source of cases) {
    assert.throws(() => assertImmutableActionPins(source), /unsupported YAML scalar syntax/);
  }
});

test("fails closed on flow-style action mappings instead of skipping them", () => {
  const source = "steps:\n  - { name: checkout, uses: actions/checkout@v4 }\n";
  assert.throws(() => assertImmutableActionPins(source, ".github/workflows/ci.yml"), /\.github\/workflows\/ci\.yml:2.*inline YAML action mapping/);
});

test("does not mistake prose or run commands for action references", () => {
  const source = "# uses: actions/checkout@v4\n" +
    "steps:\n" +
    "  - run: echo \"uses: owner/action@main\"\n" +
    "  - uses: owner/action@" + SHA + "\n";
  assert.deepEqual(findActionReferences(source).map((item) => item.reference), ["owner/action@" + SHA]);
});

test("checks every YAML workflow in a directory and reports its count", async () => {
  const directory = await mkdtemp(join(tmpdir(), "workflow-pins-"));
  try {
    await mkdir(join(directory, "nested"));
    await writeFile(join(directory, "ci.yml"), "steps:\n  - uses: owner/action@" + SHA + "\n");
    await writeFile(join(directory, "nested", "pages.yaml"), "steps:\n  - uses: ./.github/actions/test\n");
    const result = await verifyWorkflowDirectory(directory);
    assert.deepEqual(result, { workflowCount: 2, actionCount: 2 });
    await writeFile(join(directory, "nested", "pages.yaml"), "steps:\n  - uses: owner/action@v1\n");
    await assert.rejects(verifyWorkflowDirectory(directory), /pages.yaml:2/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
