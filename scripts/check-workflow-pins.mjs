import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const WORKFLOWS_DIR = join(fileURLToPath(new URL("..", import.meta.url)), ".github", "workflows");
const IMMUTABLE_ACTION = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+@[a-f0-9]{40}$/i;

function stripYamlComment(line) {
  let quote = null;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (quote === '"') {
      if (character === "\\" && index + 1 < line.length) index += 1;
      else if (character === '"') quote = null;
    } else if (quote === "'") {
      if (character === "'" && line[index + 1] === "'") index += 1;
      else if (character === "'") quote = null;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === "#" && (index === 0 || /\s/.test(line[index - 1]))) {
      return line.slice(0, index).trimEnd();
    }
  }
  return line.trimEnd();
}

function parseActionScalar(value, file, lineNumber) {
  const trimmed = value.trim();
  if (!trimmed || /^[>|&*!]/.test(trimmed)) {
    throw new Error(file + ":" + lineNumber + " uses unsupported YAML scalar syntax; use a plain or quoted single-line action reference");
  }

  if (trimmed[0] === "'" || trimmed[0] === '"') {
    const quote = trimmed[0];
    if (trimmed.length < 2 || trimmed.at(-1) !== quote) {
      throw new Error(file + ":" + lineNumber + " has an invalid quoted action reference");
    }
    const scalar = trimmed.slice(1, -1);
    if (scalar.includes(quote) || scalar.includes("\\") || (quote === '"' && scalar.includes("'"))) {
      throw new Error(file + ":" + lineNumber + " uses escaped or ambiguous action references; use the literal reference");
    }
    return scalar;
  }

  if (/\s/.test(trimmed) || /[{}\[\],]/.test(trimmed)) {
    throw new Error(file + ":" + lineNumber + " has an unsupported action reference value");
  }
  return trimmed;
}

export function findActionReferences(workflow, file = "workflow") {
  const references = [];
  for (const [index, rawLine] of workflow.split(/\r?\n/).entries()) {
    const line = stripYamlComment(rawLine);
    if (!line.trim()) continue;

    const mapping = line.match(/^\s*(?:-\s*)?(?:"uses"|'uses'|uses)\s*:\s*(.*)$/);
    if (mapping) {
      const lineNumber = index + 1;
      const reference = parseActionScalar(mapping[1], file, lineNumber);
      references.push({ reference, line: lineNumber });
      continue;
    }

    if (/(?:^|[,{])\s*(?:"uses"|'uses'|uses)\s*:/.test(line)) {
      throw new Error(file + ":" + (index + 1) + " uses an inline YAML action mapping; use a block-style step so the pin audit can inspect it");
    }
  }
  return references;
}

function isLocalAction(reference) {
  if (!reference.startsWith("./") || reference.includes("\\") || reference.includes("@") || reference.includes("#")) {
    return false;
  }
  const segments = reference.split("/");
  return segments.length > 1 && segments.every((segment, index) =>
    segment !== "" && segment !== ".." && (index === 0 || segment !== "."),
  );
}

export function assertImmutableActionPins(workflow, file = "workflow") {
  const references = findActionReferences(workflow, file);
  const invalid = references.filter(({ reference }) =>
    !isLocalAction(reference) && !IMMUTABLE_ACTION.test(reference),
  );
  if (invalid.length) {
    const details = invalid.map(({ reference, line }) => file + ":" + line + ' uses mutable or invalid action ref "' + reference + '"');
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

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const result = await verifyWorkflowDirectory();
    console.log("Workflow pin check passed: " + result.actionCount + " immutable action references across " + result.workflowCount + " workflow files");
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
