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
    else if (c === "#" && (i === 0 || /\\s/.test(line[i - 1]))) return line.slice(0, i).trimEnd();
  }
  return line.trimEnd();
}

function parsePermissionBlock(lines, start, file, scope) {
  if (!/^\\s*permissions\\s*:\\s*$/.test(lines[start])) {
    throw new Error(file + ":" + (start + 1) + " permissions must use an explicit mapping");
  }
  const entries = new Map();
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim()) continue;
    const indent = line.match(/^\\s*/)[0].length;
    const expectedIndent = scope === "workflow" ? 2 : 6;
    if (indent < expectedIndent) break;
    if (indent !== expectedIndent) {
      throw new Error(file + ":" + (i + 1) + " unsupported nested permission syntax");
    }
    const match = line.trim().match(/^([A-Za-z0-9_-]+)\\s*:\\s*(read|write|none)\\s*$/);
    if (!match) throw new Error(file + ":" + (i + 1) + " unsupported permission entry");
    if (entries.has(match[1])) throw new Error(file + ":" + (i + 1) + " duplicate permission " + match[1]);
    entries.set(match[1], match[2]);
  }
  if (!entries.size) throw new Error(file + ":" + (start + 1) + " permissions mapping must not be empty");
  return entries;
}

export function assertWorkflowPermissions(source, file = "workflow") {
  const lines = source.split(/\\r?\\n/).map(stripComment);
  const unsafeTrigger = lines.findIndex((line) =>
    /^\\s*(?:["']?pull_request_target["']?)\\s*:/.test(line) ||
    /^\\s*on\\s*:\\s*.*(?:\\[|,|\\s)pull_request_target(?:\\s|,|\\])/.test(line),
  );
  if (unsafeTrigger !== -1) {
    throw new Error(file + ":" + (unsafeTrigger + 1) + " uses pull_request_target; use pull_request with read-only permissions");
  }

  const rootPermissions = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (/^permissions\\s*:/.test(lines[i])) rootPermissions.push(i);
  }
  if (rootPermissions.length !== 1) {
    throw new Error(file + " must declare exactly one top-level permissions block");
  }
  const root = parsePermissionBlock(lines, rootPermissions[0], file, "workflow");
  if (root.size !== 1 || root.get("contents") !== "read") {
    throw new Error(file + ":" + (rootPermissions[0] + 1) + " workflow permissions may only grant contents: read");
  }

  // Job-level grants are parsed as complete mappings. Read-only contents access
  // is safe for build jobs; Pages write capabilities are restricted to deploy.
  let inJobs = false;
  let currentJob = null;
  let deployPermissions = null;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^jobs:\\s*$/.test(line)) {
      inJobs = true;
      continue;
    }
    if (!inJobs) continue;
    if (/^\\S/.test(line)) {
      inJobs = false;
      currentJob = null;
      continue;
    }
    const job = line.match(/^  ([A-Za-z0-9_-]+):\\s*$/);
    if (job) currentJob = job[1];

    if (/^    permissions\\s*:/.test(line)) {
      if (!currentJob) throw new Error(file + ":" + (i + 1) + " job permissions appear outside a job");
      const entries = parsePermissionBlock(lines, i, file, "job");
      const isReadOnly = entries.size === 1 && entries.get("contents") === "read";
      const isPages = currentJob === "deploy" &&
        entries.size === 2 && entries.get("pages") === "write" && entries.get("id-token") === "write";
      if (!isReadOnly && !isPages) {
        throw new Error(file + ":" + (i + 1) + " job " + currentJob + " may grant only contents: read, or Pages deploy's pages: write and id-token: write");
      }
      if (currentJob === "deploy") deployPermissions = entries;
    }
  }

  if (deployPermissions && (deployPermissions.get("pages") !== "write" || deployPermissions.get("id-token") !== "write")) {
    throw new Error(file + " deploy job must grant pages: write and id-token: write");
  }
  return true;
}

async function workflowFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await workflowFiles(path));
    else if (/\\.ya?ml$/i.test(entry.name)) files.push(path);
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
