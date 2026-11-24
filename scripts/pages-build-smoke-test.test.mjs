import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { verifyBuildArtifact } from "./pages-build-smoke-test.mjs";

async function fixture(html = '<!doctype html><html><head><title>Network State</title><link rel="stylesheet" href="/network-state/app.css"></head><body><div id="root"></div><script src="/network-state/app.js"></script></body></html>') {
  const directory = await mkdtemp(path.join(os.tmpdir(), "network-state-pages-"));
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "index.html"), html);
  await writeFile(path.join(directory, "app.js"), 'document.querySelector("#root");');
  await writeFile(path.join(directory, "app.css"), "body { font-family: sans-serif; }");
  return directory;
}

test("preflights the built artifact at the GitHub Pages project base path", async () => {
  const directory = await fixture();
  try {
    const result = await verifyBuildArtifact(directory, "/network-state/");
    assert.equal(result.pageUrl, "https://network-state.local/network-state/");
    assert.equal(result.assetCount, 2);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("fails when an entry asset is missing from the build output", async () => {
  const directory = await fixture();
  try {
    await rm(path.join(directory, "app.js"));
    await assert.rejects(verifyBuildArtifact(directory), /HTTP 404/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("rejects unsafe base paths", async () => {
  const directory = await fixture();
  try {
    await assert.rejects(verifyBuildArtifact(directory, "//evil.example/"), /same-origin absolute path/);
    await assert.rejects(verifyBuildArtifact(directory, "/network-state/../other/"), /dot segments/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
