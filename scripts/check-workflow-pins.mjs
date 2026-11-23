import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const WORKFLOWS_DIR = join(fileURLToPath(new URL("..", import.meta.url)), ".github", "workflows");
const IMMUTABLE_ACTION = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+@[a-f0-9]{40}$/i;

export function findActionReferences(workflow) {
  const references = [];
  for (const [index, line] of workflow.split(/\r?\n/).entries()) {
    const match = line.match(/^\s*uses:\s*([^\s#]+)(?:\s+#.*)?\s*$/);
    if (match) references.push({ reference: match[1], line: index + 1 });
  }
  return references;
}

export function assertImmutableActionPins(workflow, file = "workflow") {
  const references = findActionReferences(workflow);
  const invalid = references.filter(({ reference }) =>
    !reference.startsWith("./") && !IMMUTABLE_ACTION.test(reference),
  );
  if (invalid.length) {
    const details = invalid.map(({ reference, line }) => `${file}:${line} uses mutable or invalid action ref "${reference}"`);
    throw new Error(details.join("\n"));
  }
  return references.length;
}

async function workflowFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await workflowFiles(path));
    else if (/\.ya?ml$/i.test(entry.name)) files.push(path);
  }
  return files;
}

export async function verifyWorkflowDirectory(directory = WORKFLOWS_DIR) {
  const files = await workflowFiles(directory);
  if (!files.length) throw new Error("No GitHub Actions workflow files were found");
  let actionCount = 0;
  for (const path of files) {
    const source = await readFile(path, "utf8");
    actionCount += assertImmutableActionPins(source, relative(directory, path));
  }
  return { workflowCount: files.length, actionCount };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const result = await verifyWorkflowDirectory();
    console.log(`Workflow pin check passed: ${result.actionCount} immutable action references across ${result.workflowCount} workflow files`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
