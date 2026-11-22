import test from "node:test";
import { decodeHtmlCharacterReferences, extractInlineEventHandlers, extractInlineJavaScript, extractJavaScriptDependencies, extractJavaScriptNetworkUrls } from "./javascript-module-dependencies.mjs";
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
  const assets = extractAssets('<script src="assets/main.js"></script><link rel="stylesheet" href="/style.css?v=2">', new URL(origin + "/project/"));
  assert.deepEqual(assets.map((asset) => asset.href), [
    origin + "/project/assets/main.js",
    origin + "/style.css?v=2",
  ]);
});

test("resolves assets against the first document base URL", () => {
  const document = '<head><base href="/app/"><base href="https://ignored.example/"></head>' +
    '<script src = assets/main.js></script><link rel="stylesheet" href=style.css>';
  assert.deepEqual(
    extractAssets(document, new URL(origin + "/project/")).map((asset) => asset.href),
    [origin + "/app/assets/main.js", origin + "/app/style.css"],
  );
});

test("resolves responsive image candidates against the document base URL", () => {
  const document = '<head><base href="/static/images/"></head>' +
    '<img srcset="small.webp 1x, ../large.webp 2x, data:image/gif;base64,AAAA 3x">';
  assert.deepEqual(
    extractResourceUrls(document, new URL(origin + "/project/")).map((url) => url.href),
    [origin + "/static/images/small.webp", origin + "/static/large.webp"],
  );
});

test("entry asset extraction handles spaced and unquoted attributes without treating links as assets", () => {
  const document = '<a href="/docs/example.js">Documentation</a>' +
    '<script src = assets/main.js></script>' +
    '<link rel="stylesheet" href=styles/app.css>' +
    '<link rel="preload" as="font" href="/font.css">' +
    '<link rel="preload" as="script" href="/chunks/runtime.js">';
  assert.deepEqual(
    extractAssets(document, new URL(origin + "/project/")).map((asset) => asset.href),
    [origin + "/project/assets/main.js", origin + "/project/styles/app.css", origin + "/chunks/runtime.js"],
  );
});

test("resolves resource-bearing HTML attributes against the document base URL", () => {
  const document = '<head><base href="https://cdn.example/site/"></head>' +
    '<img src="images/status.png"><link rel="stylesheet" href="styles/app.css">';
  assert.deepEqual(
    extractResourceUrls(document, new URL(origin + "/")).map((url) => url.href),
    ["https://cdn.example/site/images/status.png", "https://cdn.example/site/styles/app.css"],
  );
});

test("rejects relative published assets redirected by an external base URL", async () => {
  const basedHtml = '<!doctype html><html><head><title>Network State</title>' +
    '<base href="https://cdn.example/site/"><link rel="stylesheet" href="assets/app.css">' +
    '</head><body><div id="root"></div><script src="assets/app.js"></script></body></html>';
  const requested = [];
  await assert.rejects(
    verifyPublishedSite(origin + "/", async (url) => {
      requested.push(String(url));
      return response(basedHtml, String(url));
    }),
    /Published resource redirected to an unexpected origin/,
  );
  assert.deepEqual(requested, [origin + "/"]);
});

test("resolves relative inline CSS dependencies against the document base URL", async () => {
  const basedHtml = html
    .replace("</head>", '<base href="https://cdn.example/site/"></head>')
    .replace('href="/assets/app.css"', `href="${origin}/assets/app.css"`)
    .replace('src="/assets/app.js"', `src="${origin}/assets/app.js"`)
    .replace("</body>", '<style>.hero{background:url(images/hero.png)}</style></body>');
  await assert.rejects(
    verifyPublishedSite(origin + "/", async (url) => {
      const href = String(url);
      if (href === origin + "/") return response(basedHtml, href);
      if (href.endsWith(".js")) return response("console.log(1)", href, 200, "text/javascript");
      return response("body{}", href, 200, "text/css");
    }),
    /Published CSS resource redirected to an unexpected origin/,
  );
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
      controller.enqueue(new Uint8Array(1));      controller.close();    },
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
    () => extractCssResourceUrls(".x{background:url(https://evil.example/image.png", origin + "/assets/app.css"),    /Unterminated CSS url\(\) dependency/,
  );});

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
    const match = new URL(href).pathname.match(/^\/nested\/(\d+)\.css$/);
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
    const match = new URL(href).pathname.match(/^\/nested\/(\d+)\.css$/);
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

test("normalizes CSS import fragments to avoid duplicate requests and cycles", async () => {
  const requested = [];
  const fetchImpl = async (url) => {
    const href = String(url);
    if (href === origin + "/") return response(html, href);
    if (href === origin + "/assets/app.js") return response("console.log(1)", href, 200, "text/javascript");
    if (href === origin + "/assets/app.css") return response('@import "/nested/theme.css#first";', href, 200, "text/css");
    if (href === origin + "/nested/theme.css") {
      requested.push(href);
      return response('@import "/nested/theme.css#second"; .theme{color:blue}', href, 200, "text/css");
    }
    throw new Error("unexpected request: " + href);
  };
  await verifyPublishedSite(origin + "/", fetchImpl);
  assert.deepEqual(requested, [origin + "/nested/theme.css"]);
});
test("marks same-origin redirect destinations visited before scanning imports", async () => {
  const requested = [];
  const fetchImpl = async (url) => {    const href = String(url);
    if (href === origin + "/") return response(html, href);
    if (href === origin + "/assets/app.js") return response("console.log(1)", href, 200, "text/javascript");
    if (href === origin + "/assets/app.css") return response('@import "/alias.css";', href, 200, "text/css");
    if (href === origin + "/alias.css") {
      requested.push(href);
      return response('@import "/nested/final.css"; .theme{color:blue}', origin + "/nested/final.css", 200, "text/css");
    }
    if (href === origin + "/nested/final.css") {
      requested.push(href);
      return response("body{color:green}", href, 200, "text/css");
    }
    throw new Error("unexpected request: " + href);
  };
  await verifyPublishedSite(origin + "/", fetchImpl);
  assert.deepEqual(requested, [origin + "/alias.css"]);
});

test("rejects credential-bearing same-origin resource URLs before fetching", async () => {
  assert.throws(
    () => assertSameOrigin("https://user:secret@example.github.io/private.css", origin, "Published CSS resource"),
    /contains URL credentials/,
  );
  const requests = [];
  const fetchImpl = async (url) => {
    const href = String(url);
    requests.push(href);
    if (href === origin + "/") return response(html, href);
    if (href === origin + "/assets/app.js") return response("console.log(1)", href, 200, "text/javascript");
    if (href === origin + "/assets/app.css") {
      return response('@import "https://user:secret@example.github.io/private.css";', href, 200, "text/css");
    }
    throw new Error("unexpected credential-bearing request: " + href);
  };
  await assert.rejects(verifyPublishedSite(origin + "/", fetchImpl), /contains URL credentials/);
  assert.equal(requests.some((url) => url.includes("user:secret@")), false);
});



test("extracts static, re-exported, and literal dynamic JavaScript module dependencies", () => {
  const source = String.raw`import "./side-effect.js";
    import { value } from "./named.js";
    export { value as other } from "./re-export.js";
    const lazy = () => import("./lazy.js");
    const asset = new URL("./image.svg", import.meta.url);
    const meta = import.meta.url;`;
  assert.deepEqual(extractJavaScriptDependencies(source), {
    modules: ["./side-effect.js", "./named.js", "./re-export.js", "./lazy.js"],
    resources: ["./image.svg"],
  });
});

test("ignores JavaScript import-like strings and comments", () => {
  const source = String.raw`const text = "import('https://fake.example/x.js')";
    // import "https://comment.example/x.js";
    /* export * from "https://block.example/x.js"; */
    const template = "plain text";`;
  assert.deepEqual(extractJavaScriptDependencies(source), { modules: [], resources: [] });
});

test("fails closed for non-literal dynamic imports and dynamic import options", () => {
  assert.throws(
    () => extractJavaScriptDependencies("import(moduleName)"),
    /non-literal JavaScript dynamic import/,
  );
  assert.throws(
    () => extractJavaScriptDependencies('import("./chunk.js", { with: { type: "javascript" } })'),
    /dynamic import options/,
  );
});

test("extracts inline scripts without external src attributes", () => {
  assert.deepEqual(
    extractInlineJavaScript('<script src="/main.js"></script><script type="module">import "./chunk.js"</script>'),
    ['import "./chunk.js"'],
  );
});

test("rejects a third-party module hidden in a recursively imported JavaScript chunk", async () => {
  const requests = [];
  const fetchImpl = async (url) => {
    const href = String(url);
    requests.push(href);
    if (href === origin + "/") return response(html, href);
    if (href === origin + "/assets/app.css") return response("body{color:black}", href, 200, "text/css");
    if (href === origin + "/assets/app.js") return response('import("./chunks/child.js");', href, 200, "text/javascript");
    if (href === origin + "/assets/chunks/child.js") return response('import("https://tracker.example/collect.js");', href, 200, "text/javascript");
    throw new Error("unexpected request: " + href);
  };
  await assert.rejects(
    verifyPublishedSite(origin + "/", fetchImpl),
    /Published JavaScript module redirected to an unexpected origin/,
  );
  assert.equal(requests.includes("https://tracker.example/collect.js"), false);
});

test("recursively verifies same-origin JavaScript modules and avoids cycles", async () => {
  const requested = [];
  const fetchImpl = async (url) => {
    const href = String(url);
    if (href === origin + "/") return response(html, href);
    if (href === origin + "/assets/app.css") return response("body{color:black}", href, 200, "text/css");
    if (href === origin + "/assets/app.js") return response('import("./chunks/child.js");', href, 200, "text/javascript");
    if (href === origin + "/assets/chunks/child.js") {
      requested.push(href);
      return response('import("../app.js");', href, 200, "text/javascript");
    }
    throw new Error("unexpected request: " + href);
  };
  const result = await verifyPublishedSite(origin + "/", fetchImpl);
  assert.equal(result.assetCount, 2);
  assert.deepEqual(requested, [origin + "/assets/chunks/child.js"]);
});

test("checks inline JavaScript module imports against the published origin", async () => {
  const unsafeHtml = html.replace(
    "</body>",
    '<script type="module">import "https://cdn.example/inline.js";</script></body>',
  );
  await assert.rejects(
    verifyPublishedSite(origin + "/", async (url) => response(unsafeHtml, String(url))),
    /Published JavaScript module redirected to an unexpected origin/,
  );
});


test("ignores module-like text inside JavaScript regular expression literals", () => {
  const source = 'const matcher = /import\\("https:\\/\\/fake\\.example\\/x\\.js"\\)/;';
  assert.deepEqual(extractJavaScriptDependencies(source), { modules: [], resources: [] });
});

test("does not scan non-executable JSON script blocks as JavaScript", () => {
  assert.deepEqual(
    extractInlineJavaScript('<script type="application/ld+json">{"note":"import(https://fake.example)"}</script>'),
    [],
  );
});


test("audits worker, importScripts, and service-worker script references", () => {
  const source = 'new Worker(new URL("./worker.js", import.meta.url)); importScripts("./legacy.js"); navigator.serviceWorker.register("./sw.js");';
  assert.deepEqual(extractJavaScriptDependencies(source), {
    modules: ["./worker.js", "./legacy.js", "./sw.js"],
    resources: ["./worker.js"],
  });
});

test("rejects third-party importScripts dependencies in a same-origin worker", async () => {
  const requests = [];
  const fetchImpl = async (url) => {
    const href = String(url);
    requests.push(href);
    if (href === origin + "/") return response(html, href);
    if (href === origin + "/assets/app.css") return response("body{color:black}", href, 200, "text/css");
    if (href === origin + "/assets/app.js") return response('new Worker(new URL("./worker.js", import.meta.url));', href, 200, "text/javascript");
    if (href === origin + "/assets/worker.js") return response('importScripts("https://tracker.example/legacy.js");', href, 200, "text/javascript");
    throw new Error("unexpected request: " + href);
  };
  await assert.rejects(
    verifyPublishedSite(origin + "/", fetchImpl),
    /Published JavaScript module redirected to an unexpected origin/,
  );
  assert.equal(requests.includes("https://tracker.example/legacy.js"), false);
});


test("rejects an off-origin redirect before the verifier follows it", async () => {
  const requests = [];
  const fetchImpl = async (url) => {
    const href = String(url);
    requests.push(href);
    if (href === origin + "/") return response(html, href);
    if (href === origin + "/assets/app.css") return response("body{color:black}", href, 200, "text/css");
    if (href === origin + "/assets/app.js") {
      return response("", href, 302, "text/javascript", { location: "https://tracker.example/remote.js" });
    }    throw new Error("unexpected request: " + href);
  };
  await assert.rejects(
    verifyPublishedSite(origin + "/", fetchImpl),    /Published request redirect redirected to an unexpected origin/,
  );
  assert.equal(requests.includes("https://tracker.example/remote.js"), false);
});

test("follows bounded same-origin redirects manually", async () => {
  const requests = [];
  const fetchImpl = async (url) => {
    const href = String(url);
    requests.push(href);
    if (href === origin + "/") return response(html, href);
    if (href === origin + "/assets/app.css") return response("body{color:black}", href, 200, "text/css");
    if (href === origin + "/assets/app.js") {
      return response("", href, 302, "text/javascript", { location: "/assets/final.js" });
    }
    if (href === origin + "/assets/final.js") return response("console.log(1)", href, 200, "text/javascript");
    throw new Error("unexpected request: " + href);
  };
  await verifyPublishedSite(origin + "/", fetchImpl);
  assert.deepEqual(requests, [
    origin + "/",
    origin + "/assets/app.css",
    origin + "/assets/app.js",
    origin + "/assets/final.js",
  ]);
});


test("rejects an eleventh JavaScript module depth before requesting it", async () => {
  const requested = [];
  const fetchImpl = async (url) => {
    const href = String(url);
    if (href === origin + "/") return response(html, href);
    if (href === origin + "/assets/app.css") return response("body{color:black}", href, 200, "text/css");
    if (href === origin + "/assets/app.js") return response('import("/modules/1.js");', href, 200, "text/javascript");
    const match = new URL(href).pathname.match(/^\/modules\/(\d+)\.js$/);
    if (match) {
      const level = Number(match[1]);
      requested.push(level);
      const next = "import(\"/modules/" + (level + 1) + ".js\");";
      return response(level < 11 ? next : "export {};", href, 200, "text/javascript");
    }
    throw new Error("unexpected request: " + href);
  };
  await assert.rejects(verifyPublishedSite(origin + "/", fetchImpl), /module depth exceeds 10/);
  assert.deepEqual(requested, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
});


test("extracts literal JavaScript request URLs from supported network APIs", () => {
  const source = String.raw`fetch("https://cdn.example/data.json");
    globalThis.fetch(new URL("/api/status", import.meta.url));
    new WebSocket("wss://socket.example/live");
    new EventSource("https://events.example/stream");
    navigator.sendBeacon("/telemetry", payload);
    xhr.open("POST", "https://api.example/submit", true);
    fetch(configuredEndpoint);`;
  assert.deepEqual(extractJavaScriptNetworkUrls(source), [
    "https://cdn.example/data.json",
    "/api/status",
    "wss://socket.example/live",
    "https://events.example/stream",
    "/telemetry",
    "https://api.example/submit",
  ]);
});

test("extracts inline event handler code for privacy scanning", () => {
  const handlers = extractInlineEventHandlers(
    `<button onclick="fetch('https://tracker.example/click')">Open</button>` +
    `<img onerror = "navigator.sendBeacon('/pixel', data)">` +
    `<a href="/docs">Documentation</a>`,
  );
  assert.deepEqual(handlers, [
    "fetch('https://tracker.example/click')",
    "navigator.sendBeacon('/pixel', data)",
  ]);
});

test("rejects a third-party literal fetch in a same-origin JavaScript asset before contacting it", async () => {
  const requests = [];
  const fetchImpl = async (url) => {
    const href = String(url);
    requests.push(href);
    if (href === origin + "/") return response(html, href);
    if (href === origin + "/assets/app.css") return response("body{color:black}", href, 200, "text/css");
    if (href === origin + "/assets/app.js") {
      return response('fetch("https://tracker.example/collect");', href, 200, "text/javascript");
    }
    throw new Error("unexpected request: " + href);
  };
  await assert.rejects(
    verifyPublishedSite(origin + "/", fetchImpl),
    /Published JavaScript request redirected to an unexpected origin/,
  );
  assert.equal(requests.includes("https://tracker.example/collect"), false);
});

test("rejects third-party requests in inline event handlers before any outbound request", async () => {
  const unsafeHtml = html.replace(
    "</body>",
    `<img onerror="fetch('https://tracker.example/error')"></body>`,
  );
  const requests = [];
  await assert.rejects(
    verifyPublishedSite(origin + "/", async (url) => {
      const href = String(url);
      requests.push(href);
      if (href === origin + "/") return response(unsafeHtml, href);
      if (href === origin + "/assets/app.css") return response("body{}", href, 200, "text/css");
      if (href === origin + "/assets/app.js") return response("console.log(1)", href, 200, "text/javascript");
      throw new Error("unexpected request: " + href);
    }),
    /Published JavaScript request redirected to an unexpected origin/,
  );
  assert.equal(requests.some((url) => url.includes("tracker.example")), false);
});

test("allows same-origin literal network calls and leaves user-configured targets dynamic", async () => {
  const fetchImpl = async (url) => {
    const href = String(url);
    if (href === origin + "/") return response(html, href);
    if (href === origin + "/assets/app.css") return response("body{}", href, 200, "text/css");
    if (href === origin + "/assets/app.js") {
      return response('fetch("/health"); fetch(configuredEndpoint);', href, 200, "text/javascript");
    }
    throw new Error("unexpected request: " + href);
  };
  const result = await verifyPublishedSite(origin + "/", fetchImpl);
  assert.equal(result.assetCount, 2);
});



test("decodes HTML character references before scanning inline handler JavaScript", () => {
  const handler = extractInlineEventHandlers(
    '<button onclick="&#x66;etch(&#x22;https&colon;&sol;&sol;tracker.example&#x2f;pixel&#x22;)">x</button>',
  )[0];
  assert.equal(handler, 'fetch("https://tracker.example/pixel")');
  assert.deepEqual(extractJavaScriptNetworkUrls(handler), ["https://tracker.example/pixel"]);
  assert.equal(decodeHtmlCharacterReferences("&#0; &#xD800; &#x110000;"), "\uFFFD \uFFFD \uFFFD");
  assert.equal(decodeHtmlCharacterReferences("&#000000000000102; &#x00000000000066;"), "f f");
});

test("rejects entity-encoded third-party event-handler requests before contacting them", async () => {
  const unsafeHtml = html.replace(
    "</body>",
    '<img onerror="&#000000000000102;etch(&#x22;https&colon;&sol;&sol;tracker.example&#x2f;error&#x22;)"></body>',
  );
  const requests = [];
  await assert.rejects(
    verifyPublishedSite(origin + "/", async (url) => {
      const href = String(url);
      requests.push(href);
      if (href === origin + "/") return response(unsafeHtml, href);
      if (href === origin + "/assets/app.css") return response("body{}", href, 200, "text/css");
      if (href === origin + "/assets/app.js") return response("console.log(1)", href, 200, "text/javascript");
      throw new Error("unexpected request: " + href);
    }),
    /Published JavaScript request redirected to an unexpected origin/,
  );
  assert.equal(requests.some((url) => url.includes("tracker.example")), false);
});

test("event handler scanner preserves quoted greater-than signs and full attribute values", () => {
  const document = '<div title="> is data" onclick="fetch(\'https://tracker.example/pixel?x=>\')">x</div>';
  assert.deepEqual(extractInlineEventHandlers(document), [
    "fetch('https://tracker.example/pixel?x=>')",
  ]);
});

test("event handler scanner skips comments and script/style raw text", () => {
  const document = '<!-- <img onerror="fetch(\'https://comment.example/\')"> -->' +
    '<script>const template = \'<img onclick="fetch(https://fake.example)">\';</script>' +
    '<style>.sample{content:"<img onerror=fetch(https://fake.example)>";}</style>' +
    '<button onclick="fetch(\'/safe\')">Safe</button>';
  assert.deepEqual(extractInlineEventHandlers(document), ["fetch('/safe')"]);});

test("event handler scanner fails closed on unterminated quoted attributes", () => {
  assert.throws(    () => extractInlineEventHandlers('<img onerror="fetch(\'https://tracker.example/\')>'),
    /Unterminated quoted HTML attribute/,
  );
});