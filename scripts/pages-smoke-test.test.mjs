import test from "node:test";
import assert from "node:assert/strict";
import { extractAssets, assertSameOrigin, verifyPublishedSite } from "./pages-smoke-test.mjs";

const origin = "https://example.github.io";
const html = '<!doctype html><html><head><title>Network State</title><link href="/assets/app.css" rel="stylesheet"></head><body><div id="root"></div><script src="/assets/app.js"></script></body></html>';

function response(body, url, status = 200, type = "text/html") {
  const result = new Response(body, { status, headers: { "content-type": type } });
  Object.defineProperty(result, "url", { value: url });
  return result;
}

test("extracts JS and CSS assets relative to the published page", () => {
  const assets = extractAssets('<script src="assets/main.js"></script><link href="/style.css?v=2">', new URL(origin + "/project/"));
  assert.deepEqual(assets.map((asset) => asset.href), [
    origin + "/project/assets/main.js",
    origin + "/style.css?v=2",
  ]);
});

test("rejects unexpected origins including redirect destinations", () => {
  assert.throws(() => assertSameOrigin("https://evil.example/file.js", origin, "asset"), /unexpected origin/);
});

test("verifies page and same-origin non-empty JS/CSS assets", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    const href = String(url);
    calls.push(href);
    if (href === origin + "/") return response(html, origin + "/");
    if (href === origin + "/assets/app.js") return response("console.log('ok')", href, 200, "text/javascript");
    if (href === origin + "/assets/app.css") return response("body{}", href, 200, "text/css");
    throw new Error("unexpected request: " + href);
  };
  const result = await verifyPublishedSite(origin + "/", fetchImpl);
  assert.equal(result.assetCount, 2);
  assert.equal(calls.length, 3);
});

test("rejects a published page redirecting off origin", async () => {
  await assert.rejects(
    verifyPublishedSite(origin + "/", async () => response(html, "https://external.example/")),
    /unexpected origin/,
  );
});

test("rejects empty assets and invalid asset content types", async () => {
  const fetchEmpty = async (url) => {
    const href = String(url);
    if (href === origin + "/") return response(html, href);
    if (href.endsWith(".js")) return response("", href, 200, "text/javascript");
    return response("body{}", href, 200, "text/css");
  };
  await assert.rejects(verifyPublishedSite(origin + "/", fetchEmpty), /empty/);

  const fetchWrongType = async (url) => {
    const href = String(url);
    if (href === origin + "/") return response(html, href);
    return response("payload", href, 200, "text/plain");
  };
  await assert.rejects(verifyPublishedSite(origin + "/", fetchWrongType), /unexpected content type/);
});

test("rejects non-HTTPS deployment URLs and missing required markup", async () => {
  await assert.rejects(verifyPublishedSite("http://example.github.io/"), /HTTPS/);
  await assert.rejects(
    verifyPublishedSite(origin + "/", async () => response("<title>Other</title>", origin + "/")),
    /missing the Network State title/,
  );
});
