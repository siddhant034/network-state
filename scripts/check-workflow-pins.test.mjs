import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { assertImmutableActionPins, findActionReferences, verifyWorkflowDirectory } from "./check-workflow-pins.mjs";

const SHA = "a".repeat(40);

test("accepts full immutable SHAs and local composite actions", () => {
  const source = `steps:
  - uses: actions/checkout@${SHA} # reviewed release
  - uses: ./.github/actions/local
`;
  assert.equal(assertImmutableActionPins(source), 2);
});

test("rejects mutable tags, branches, and abbreviated hashes", () => {
  for (const reference of ["actions/checkout@v4", "owner/action@main", "owner/action@1234567"]) {
    assert.throws(() => assertImmutableActionPins(`steps:\n  - uses: ${reference}\n`), /mutable or invalid action ref/);
  }
});

test("does not mistake prose or run commands for action references", () => {
  const source = `# uses: actions/checkout@v4
steps:
  - run: echo "uses: owner/action@main"
  - uses: owner/action@${SHA}
`;
  assert.deepEqual(findActionReferences(source).map((item) => item.reference), [`owner/action@${SHA}`]);
});

test("checks every YAML workflow in a directory and reports its count", async () => {
  const directory = await mkdtemp(join(tmpdir(), "workflow-pins-"));
  try {
    await mkdir(join(directory, "nested"));
    await writeFile(join(directory, "ci.yml"), `steps:\n  - uses: owner/action@${SHA}\n`);
    await writeFile(join(directory, "nested", "pages.yaml"), "steps:\n  - uses: ./.github/actions/test\n");
    const result = await verifyWorkflowDirectory(directory);
    assert.deepEqual(result, { workflowCount: 2, actionCount: 2 });
    await writeFile(join(directory, "nested", "pages.yaml"), "steps:\n  - uses: owner/action@v1\n");
    await assert.rejects(verifyWorkflowDirectory(directory), /pages.yaml:2/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
