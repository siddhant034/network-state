import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const WORKFLOWS_DIR = join(fileURLToPath(new URL("..", import.meta.url)), ".github", "workflows");

function stripComment(line) {
  let quote = null;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (quote === '"') {
      if (c === "\\" && i + 1 < line.length) i += 1;
      else if (c === '"') quote = null;
    } else if (quote === "'") {
      if (c === "'" && line[i + 1] === "'") i += 1;
      else if (c === "'") quote = null;
    } else if (c === '"' || c === "'") quote = c;
    else if (c === "#" && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i).trimEnd();
  }
  return line.trimEnd();
}

export function assertWorkflowPermissions(source, file = "workflow") {
  const lines = source.split(/\r?\n/).map(stripComment);
  const unsafeTrigger = lines.findIndex((line) =>
    /^\s*(?:["']?pull_request_target["']?)\s*:/.test(line) ||
    /^\s*on\s*:\s*.*(?:\[|,|\s)pull_request_target(?:\s|,|\])/.test(line),
  );
  if (unsafeTrigger !== -1) {
    throw new Error(file + ":" + (unsafeTrigger + 1) + " uses pull_request_target; use pull_request with read-only permissions");
  }

  const rootPermissions = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (/^permissions\s*:/.test(lines[i])) rootPermissions.push(i);
  }
  if (rootPermissions.length !== 1) {
    throw new Error(file + " must declare exactly one top-level permissions block");
  }

  const start = rootPermissions[0];
  if (lines[start].trim() !== "permissions:") {
    throw new Error(file + ":" + (start + 1) + " must use an explicit permissions mapping, not a broad permission preset");
  }

  let contentsRead = false;
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim()) continue;
    const indent = line.match(/^\s*/)[0].length;
    if (indent === 0) break;
    if (indent !== 2) continue;
    const entry = line.trim().match(/^([A-Za-z0-9_-]+)\s*:\s*(read|write)$/);
    if (!entry || entry[1] !== "contents" || entry[2] !== "read") {
      throw new Error(file + ":" + (i + 1) + " top-level permissions may only grant contents: read; scope write permissions to a job");
    }
    contentsRead = true;
  }
  if (!contentsRead) {
    throw new Error(file + ":" + (start + 1) + " must explicitly grant contents: read at workflow scope");
  }

  // Job-level write permissions are allowed only for the Pages deployment job,
  // and only for the two capabilities required by the deployment action.
  let currentJob = null;
  let inJobs = false;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^jobs:\s*$/.test(line)) {
      inJobs = true;
      continue;
    }
    const job = line.match(/^  ([A-Za-z0-9_-]+):\s*$/);
    if (inJobs && job) currentJob = job[1];

    if (/^      permissions\s*:/.test(line)) {
      if (currentJob !== "deploy") {
        throw new Error(file + ":" + (i + 1) + " job-level permission escalation is only allowed in the Pages deploy job");
      }
      for (let j = i + 1; j < lines.length; j += 1) {
        const permissionLine = lines[j];
        if (!permissionLine.trim()) continue;
        const indent = permissionLine.match(/^\s*/)[0].length;
        if (indent < 8) break;
        if (indent !== 8) continue;
        const permission = permissionLine.trim().match(/^(pages|id-token)\s*:\s*write$/);
        if (!permission) {
          throw new Error(file + ":" + (j + 1) + " Pages deploy may grant only pages: write and id-token: write");
        }
      }
    }
  }
  return true;
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

export async function verifyWorkflowPermissions(directory = WORKFLOWS_DIR) {
  const files = await workflowFiles(directory);
  if (!files.length) throw new Error("No GitHub Actions workflow files were found");
  for (const path of files) {
    assertWorkflowPermissions(await readFile(path, "utf8"), relative(directory, path));
  }
  return files.length;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const count = await verifyWorkflowPermissions();
    console.log("Workflow permissions check passed for " + count + " workflow files");
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
