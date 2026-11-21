import test from "node:test";
import assert from "node:assert/strict";
import { extractAssets, extractResourceUrls, assertSameOrigin, verifyPublishedSite } from "./pages-smoke-test.mjs";

const origin = "https://example.github.io";
const html = '<!doctype html><html><head><title>Network State</title><link href="/assets/app.css" rel="stylesheet"></head><body><div id="root"></div><script src="/assets/app.js"></script></body></html>';

function response(body, url, status = 200, type = "text/html", headers = {}) {
  const result = new Response(body, { status, headers: { "content-type": type, ...headers } });
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

test("rejects pages with missing entry assets or an excessive asset count", async () => {
  const noCss = html.replace('<link href="/assets/app.css" rel="stylesheet">', "");
  await assert.rejects(
    verifyPublishedSite(origin + "/", async (url) => {
      const href = String(url);
      return response(href === origin + "/" ? noCss : "console.log('ok')", href, 200,
        href.endsWith(".js") ? "text/javascript" : "text/html");
    }),
    /CSS asset/,
  );

  const manyAssets = '<title>Network State</title><div id="root"></div>' +
    Array.from({ length: 21 }, (_, i) => `<script src="/assets/${i}.js"></script>`).join("") +
    '<link href="/assets/app.css" rel="stylesheet">';
  await assert.rejects(
    verifyPublishedSite(origin + "/", async (url) => {
      const href = String(url);
      if (href === origin + "/") return response(manyAssets, href);
      return response("asset", href, 200, href.endsWith(".css") ? "text/css" : "text/javascript");
    }),
    /Unexpected number/,
  );
});

test("rejects declared and streamed responses that exceed size budgets", async () => {
  await assert.rejects(
    verifyPublishedSite(origin + "/", async (url) => response(
      html, String(url), 200, "text/html", { "content-length": String(1024 * 1024 + 1) },
    )),
    /exceeds 1048576 bytes/,
  );

  const oversizedStream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(1024 * 1024));
      controller.enqueue(new Uint8Array(1));
      controller.close();
    },
  });
  const streamed = new Response(oversizedStream, {
    headers: { "content-type": "text/html" },
  });
  Object.defineProperty(streamed, "url", { value: origin + "/" });
  await assert.rejects(
    verifyPublishedSite(origin + "/", async () => streamed),
    /exceeds 1048576 bytes/,
  );
});


test("extracts resource-bearing tags but ignores ordinary external navigation links", () => {
  const document = '<link rel="stylesheet" href="/app.css">' +
    '<link rel="preconnect" href="https://fonts.example">' +
    '<script src="/app.js"></script><img src="icons/status.svg">' +
    '<video poster="/preview.png"></video>' +
    '<img srcset="/small.png 1x, https://img.example/large.png 2x">' +
    '<a href="https://docs.example/">Docs</a>';
  assert.deepEqual(
    extractResourceUrls(document, new URL(origin + "/")),
    [origin + "/app.css", "https://fonts.example/", origin + "/app.js", origin + "/icons/status.svg", origin + "/preview.png", origin + "/small.png", "https://img.example/large.png"]
      .map((url) => new URL(url)),
  );
});

test("rejects third-party stylesheet, font, image, or script references in published HTML", async () => {
  const unsafeHtml = html.replace(
    "</head>",
    '<link rel="stylesheet" href="https://fonts.example/styles.css">' +
      '<link rel="preconnect" href="https://fonts.example">' +
      '<script src="https://cdn.example/app.js"></script></head>',
  );
  await assert.rejects(
    verifyPublishedSite(origin + "/", async (url) =>
      response(unsafeHtml, String(url)),
    ),
    /Published resource redirected to an unexpected origin/,
  );
});

test("parses srcset data URLs without treating their comma as a separator", () => {
  const document = '<img srcset="data:image/png;base64,AAAA 1x, /small.png 2x, /large.png 3x">';
  assert.deepEqual(
    extractResourceUrls(document, new URL(origin + "/")).map((url) => url.href),
    [origin + "/small.png", origin + "/large.png"],
  );
});

test("parses srcset candidates with and without descriptors", () => {
  const document = '<img srcset="/one.png, /two.png 2x">';
  assert.deepEqual(
    extractResourceUrls(document, new URL(origin + "/")).map((url) => url.href),
    [origin + "/one.png", origin + "/two.png"],
  );
});


test("extracts quoted and unquoted resource attributes with whitespace around equals", () => {
  const document = '<script src = "/bundle.js"></script>' +
    '<link rel = stylesheet href = https://cdn.example/theme.css>' +
    '<img src = /status.png>';
  assert.deepEqual(
    extractResourceUrls(document, new URL(origin + "/")).map((url) => url.href),
    [origin + "/bundle.js", "https://cdn.example/theme.css", origin + "/status.png"],
  );
});

test("does not miss a third-party resource when its attributes contain whitespace", async () => {
  const unsafeHtml = html.replace(
    "</body>",
    '<script src = "https://cdn.example/remote.js"></script></body>',
  );
  await assert.rejects(
    verifyPublishedSite(origin + "/", async (url) => response(unsafeHtml, String(url))),
    /Published resource redirected to an unexpected origin/,
  );
});
