import test from "node:test";
import assert from "node:assert/strict";
import { extractAssets, extractCssImports, extractCssResourceUrls, extractInlineCss, extractResourceUrls, assertSameOrigin, verifyPublishedSite } from "./pages-smoke-test.mjs";

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

test("extracts CSS url and import dependencies and ignores comments/data URLs", async () => {
  const { extractCssResourceUrls } = await import("./pages-smoke-test.mjs");
  const css = '/* url(https://comment.example/x.png) */ @import url("./theme.css"); @import "https://external.example/fonts.css"; .hero{background:url(../images/hero.webp)} .inline{background:url(data:image/png;base64,AAAA)}';
  assert.deepEqual(extractCssResourceUrls(css, origin + "/assets/app.css").map((url) => url.href), [
    origin + "/assets/theme.css", "https://external.example/fonts.css", origin + "/images/hero.webp",
  ]);
});

test("rejects external CSS dependencies in the published stylesheet", async () => {
  const fetchImpl = async (url) => {
    const href = String(url);
    if (href === origin + "/") return response(html, href);
    if (href.endsWith(".js")) return response("console.log(1)", href, 200, "text/javascript");
    return response('@import url("https://fonts.example/font.css"); body{background:url(https://img.example/bg.png)}', href, 200, "text/css");
  };
  await assert.rejects(verifyPublishedSite(origin + "/", fetchImpl), /Published CSS resource redirected to an unexpected origin/);
});


test("decodes CSS escapes before extracting escaped resource functions and hosts", async () => {
  const { decodeCssEscapes, extractCssResourceUrls } = await import("./pages-smoke-test.mjs");
  const css = String.raw`@im\70ort url("https://\65 xternal.example/font.css"); .hero{background:u\72l(https://img.example/bg.png)}`;
  assert.match(decodeCssEscapes(css), /@import url/);
  assert.deepEqual(
    extractCssResourceUrls(css, origin + "/assets/app.css").map((url) => url.href),
    ["https://external.example/font.css", "https://img.example/bg.png"],
  );
});


test("CSS dependency tokenizer ignores URL-like text in strings and comments", async () => {
  const { extractCssResourceUrls } = await import("./pages-smoke-test.mjs");
  const css = String.raw`content: "url(https://fake.example/a.png) /* not a comment */";
    /* @import "https://comment.example/x.css"; */
    .ok { background: url(/* separator */ "https://real.example/image.png"); }`;
  assert.deepEqual(
    extractCssResourceUrls(css, origin + "/assets/app.css").map((url) => url.href),
    ["https://real.example/image.png"],
  );
});

test("CSS tokenizer handles escaped url identifiers and direct imports with comments", async () => {
  const { extractCssResourceUrls } = await import("./pages-smoke-test.mjs");
  const css = String.raw`@import /* comment */ "https://theme.example/base.css";
    .x { background: u\72l(https://image.example/a.png); }`;
  assert.deepEqual(
    extractCssResourceUrls(css, origin + "/assets/app.css").map((url) => url.href),
    ["https://theme.example/base.css", "https://image.example/a.png"],
  );
});

test("removes comments inside unquoted CSS url tokens before origin resolution", async () => {
  const { extractCssResourceUrls } = await import("./pages-smoke-test.mjs");
  const css = String.raw`.x{background:url(https://evil/* comment */.example/image.png)}`;
  assert.deepEqual(
    extractCssResourceUrls(css, origin + "/assets/app.css").map((url) => url.href),
    ["https://evil.example/image.png"],
  );
});

test("extracts image-set string URLs without treating type descriptors as resources", async () => {
  const { extractCssResourceUrls } = await import("./pages-smoke-test.mjs");
  const css = '.hero { background-image: image-set("https://images.example/hero.avif" 1x type("image/avif"), "./hero.png" 2x type("image/png"), url("/fallback.webp") 3x); }';
  assert.deepEqual(
    extractCssResourceUrls(css, origin + "/assets/app.css").map((url) => url.href),
    [
      "https://images.example/hero.avif",
      origin + "/assets/hero.png",
      origin + "/fallback.webp",
    ],
  );
});

test("supports the legacy webkit image-set string syntax", async () => {
  const { extractCssResourceUrls } = await import("./pages-smoke-test.mjs");
  const css = '.hero{background:-webkit-image-set("https://cdn.example/hero.png" 1x, "data:image/png;base64,AAAA" 2x)}';
  assert.deepEqual(
    extractCssResourceUrls(css, origin + "/assets/app.css").map((url) => url.href),
    ["https://cdn.example/hero.png"],
  );
});

test("rejects third-party image-set string candidates in published CSS", async () => {
  const fetchImpl = async (url) => {
    const href = String(url);
    if (href === origin + "/") return response(html, href);
    if (href.endsWith(".js")) return response("console.log(1)", href, 200, "text/javascript");
    return response('.hero{background:image-set("https://images.example/remote.avif" 1x)}', href, 200, "text/css");
  };
  await assert.rejects(
    verifyPublishedSite(origin + "/", fetchImpl),
    /Published CSS resource redirected to an unexpected origin/,
  );
});

test("fails closed on unterminated CSS url dependencies", async () => {
  const { extractCssResourceUrls } = await import("./pages-smoke-test.mjs");
  assert.throws(
    () => extractCssResourceUrls(".x{background:url(https://evil.example/image.png", origin + "/assets/app.css"),
    /Unterminated CSS url\(\) dependency/,
  );
});

test("fails closed on unterminated quoted CSS url dependencies", async () => {
  const { extractCssResourceUrls } = await import("./pages-smoke-test.mjs");
  assert.throws(
    () => extractCssResourceUrls('.x{background:url("https://evil.example/image.png"', origin + "/assets/app.css"),
    /Unterminated CSS url\(\) dependency/,
  );
});


test("covers HTML resource attributes including SVG, object, embed, and responsive preloads", () => {
  const document = '<object data="/embedded.svg"></object>' +
    '<embed src="/movie.swf">' +
    '<input type="image" src="/submit.png">' +
    '<input type="text" src="https://not-a-resource.example/ignored.png">' +
    '<svg><image href="/svg-image.png"></image><use xlink:href="/sprite.svg#status"></use></svg>' +
    '<link rel="preload" as="image" imagesrcset="/hero-small.png 1x, https://images.example/hero-large.png 2x">';
  assert.deepEqual(
    extractResourceUrls(document, new URL(origin + "/")).map((url) => url.href),
    [
      origin + "/embedded.svg",
      origin + "/movie.swf",
      origin + "/submit.png",
      origin + "/svg-image.png",
      origin + "/sprite.svg#status",
      origin + "/hero-small.png",
      "https://images.example/hero-large.png",
    ],
  );
});

test("extracts CSS dependencies from style blocks and HTML style attributes", () => {
  const document = '<style>.banner{background:image-set("https://cdn.example/banner.avif" 1x)}</style>' +
    '<div style="background:url(&quot;https://img.example/card.png&quot;)"></div>';
  assert.deepEqual(
    extractInlineCss(document).flatMap((css) =>
      extractCssResourceUrls(css, origin + "/index.html").map((url) => url.href),
    ),
    ["https://cdn.example/banner.avif", "https://img.example/card.png"],
  );
});

test("rejects external dependencies in inline style blocks and style attributes", async () => {
  for (const unsafeMarkup of [
    '<style>.banner{background:url(https://cdn.example/banner.png)}</style>',
    '<div style="background:url(&quot;https://cdn.example/card.png&quot;)"></div>',
  ]) {
    const unsafeHtml = html.replace("</body>", unsafeMarkup + "</body>");
    await assert.rejects(
      verifyPublishedSite(origin + "/", async (url) => response(unsafeHtml, String(url))),
      /Published CSS resource redirected to an unexpected origin/,
    );
  }
});



test("extracts CSS imports while ignoring strings and comments", () => {
  const css = String.raw`content: '@import "https://fake.example/no.css"';
    /* @import "https://comment.example/no.css"; */
    @import /* gap */ "https://theme.example/base.css" screen;
    @import url(\2f nested\2e css);
    @import url("/nested.css");`;
  assert.deepEqual(extractCssImports(css), [
    "https://theme.example/base.css",
    "/nested.css",
  ]);
});

test("rejects third-party resources hidden in a nested same-origin CSS import", async () => {
  const fetchImpl = async (url) => {
    const href = String(url);
    if (href === origin + "/") return response(html, href);
    if (href === origin + "/assets/app.css") {
      return response('@import "/nested/theme.css"; body{color:black}', href, 200, "text/css");
    }
    if (href === origin + "/nested/theme.css") {
      return response(".theme{background:url(https://tracker.example/pixel.png)}", href, 200, "text/css");
    }
    if (href === origin + "/assets/app.js") return response("console.log(1)", href, 200, "text/javascript");
    throw new Error("unexpected request: " + href);
  };
  await assert.rejects(
    verifyPublishedSite(origin + "/", fetchImpl),
    /Published CSS resource redirected to an unexpected origin/,
  );
});

test("handles cyclic CSS imports without refetching a root stylesheet", async () => {
  const stylesheetRequests = [];
  const nestedRequests = [];
  const fetchImpl = async (url) => {
    const href = String(url);
    if (href === origin + "/") return response(html, href);
    if (href === origin + "/assets/app.css") {
      stylesheetRequests.push(href);
      return response('@import "/nested/theme.css"; body{color:black}', href, 200, "text/css");
    }
    if (href === origin + "/nested/theme.css") {
      nestedRequests.push(href);
      return response('@import "/assets/app.css"; .theme{color:blue}', href, 200, "text/css");
    }
    if (href === origin + "/assets/app.js") return response("console.log(1)", href, 200, "text/javascript");
    throw new Error("unexpected request: " + href);
  };
  const result = await verifyPublishedSite(origin + "/", fetchImpl);
  assert.equal(result.assetCount, 2);
  assert.deepEqual(stylesheetRequests, [origin + "/assets/app.css"]);
  assert.deepEqual(nestedRequests, [origin + "/nested/theme.css"]);
});

test("allows five imported stylesheet levels", async () => {
  const requested = [];
  const fetchImpl = async (url) => {
    const href = String(url);
    if (href === origin + "/") return response(html, href);
    if (href === origin + "/assets/app.js") return response("console.log(1)", href, 200, "text/javascript");
    if (href === origin + "/assets/app.css") return response('@import "/nested/1.css";', href, 200, "text/css");
    const match = href.match(/\\/nested\\/(\\d+)\\.css$/);
    if (match) {
      const level = Number(match[1]);
      requested.push(level);
      return response(level < 5 ? `@import "/nested/${level + 1}.css";` : "body{color:green}", href, 200, "text/css");
    }
    throw new Error("unexpected request: " + href);
  };
  await verifyPublishedSite(origin + "/", fetchImpl);
  assert.deepEqual(requested, [1, 2, 3, 4, 5]);
});

test("rejects a sixth stylesheet import before fetching it", async () => {
  const requested = [];
  const fetchImpl = async (url) => {
    const href = String(url);
    if (href === origin + "/") return response(html, href);
    if (href === origin + "/assets/app.js") return response("console.log(1)", href, 200, "text/javascript");
    if (href === origin + "/assets/app.css") return response('@import "/nested/1.css";', href, 200, "text/css");
    const match = href.match(/\\/nested\\/(\\d+)\\.css$/);
    if (match) {
      const level = Number(match[1]);
      requested.push(level);
      return response(`@import "/nested/${level + 1}.css";`, href, 200, "text/css");
    }
    throw new Error("unexpected request: " + href);
  };
  await assert.rejects(verifyPublishedSite(origin + "/", fetchImpl), /import depth exceeds 5/);
  assert.deepEqual(requested, [1, 2, 3, 4, 5]);
});

test("rejects third-party responsive image preload candidates in published HTML", async () => {
  const unsafeHtml = html.replace(
    "</head>",
    '<link rel="preload" as="image" imagesrcset="/local.png 1x, https://cdn.example/remote.png 2x"></head>',
  );
  await assert.rejects(
    verifyPublishedSite(origin + "/", async (url) => response(unsafeHtml, String(url))),
    /Published resource redirected to an unexpected origin/,
  );
});
