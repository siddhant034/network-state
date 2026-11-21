import { pathToFileURL } from "node:url";

const HTML_LIMIT = 1024 * 1024;
const ASSET_LIMIT = 10 * 1024 * 1024;
const MAX_ASSETS = 20;
const TIMEOUT_MS = 15_000;

export function extractAssets(html, pageUrl) {
  return [...html.matchAll(/(?:src|href)=["']([^"']+\.(?:js|css)(?:\?[^"']*)?)["']/gi)]
    .map((match) => new URL(match[1], pageUrl));
}

export function parseSrcset(srcset) {
  const urls = [];
  let position = 0;

  while (position < srcset.length) {
    while (position < srcset.length && /[\s,]/.test(srcset[position])) position++;
    if (position >= srcset.length) break;

    const start = position;
    // A data URL can contain commas; its URL token ends at whitespace.
    while (position < srcset.length && !/\s/.test(srcset[position])) position++;
    let url = srcset.slice(start, position);
    const endedCandidate = url.endsWith(",");
    while (url.endsWith(",")) url = url.slice(0, -1);
    if (url) urls.push(url);
    if (endedCandidate) continue;

    while (position < srcset.length && srcset[position] !== ",") position++;
    if (srcset[position] === ",") position++;
  }

  return urls;
}

function getAttribute(attributes, name) {
  // Names are selected from this module's fixed allowlist, never from page content.
  const pattern = new RegExp("(?:^|\\s)" + name + "\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s>]+))", "i");
  const match = attributes.match(pattern);
  return match?.[1] ?? match?.[2] ?? match?.[3];
}

export function extractResourceUrls(html, pageUrl) {
  const resources = [];
  const tagPattern = /<(script|img|source|iframe|video|audio|track|link)\b([^>]*)>/gi;
  for (const match of html.matchAll(tagPattern)) {
    const tag = match[1].toLowerCase();
    const attributes = match[2];
    const rel = getAttribute(attributes, "rel")?.toLowerCase().split(/\s+/) ?? [];
    const isResourceLink = tag === "link" && rel.some((value) =>
      ["stylesheet", "preload", "modulepreload", "icon", "manifest", "preconnect", "dns-prefetch"].includes(value),
    );
    if (tag === "link" && !isResourceLink) continue;
    const names = tag === "link" ? ["href"] : tag === "video" ? ["src", "poster"] : ["src"];
    for (const name of names) {
      const value = getAttribute(attributes, name);
      if (value) resources.push(new URL(value, pageUrl));
    }
    if (tag === "img" || tag === "source") {
      const srcset = getAttribute(attributes, "srcset");
      if (srcset) {
        for (const value of parseSrcset(srcset)) {
          if (!value.startsWith("data:")) resources.push(new URL(value, pageUrl));
        }
      }
    }
  }
  return resources;
}

export function decodeCssEscapes(value) {
  return value
    .replace(/\\([0-9a-f]{1,6})(?:\r\n|[\t\n\r\f ])?/gi, (_, hex) => {
      const codePoint = Number.parseInt(hex, 16);
      return codePoint === 0 || codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)
        ? "\uFFFD"
        : String.fromCodePoint(codePoint);
    })
    .replace(/\\([\t\n\r\f])/g, "")
    .replace(/\\([^\r\n\f])/g, "$1");
}

function skipCssTrivia(source, position) {
  let cursor = position;
  while (cursor < source.length) {
    if (/\s/.test(source[cursor])) {
      cursor++;
      continue;
    }
    if (source[cursor] === "/" && source[cursor + 1] === "*") {
      const close = source.indexOf("*/", cursor + 2);
      if (close < 0) return source.length;
      cursor = close + 2;
      continue;
    }
    break;
  }
  return cursor;
}

function readCssEscape(source, position) {
  if (source[position] !== "\\" || position + 1 >= source.length) {
    return { value: source[position] ?? "", next: position + 1 };
  }
  let cursor = position + 1;
  if (/[0-9a-f]/i.test(source[cursor])) {
    const start = cursor;
    while (cursor < source.length && cursor - start < 6 && /[0-9a-f]/i.test(source[cursor])) cursor++;
    const point = Number.parseInt(source.slice(start, cursor), 16);
    if (/\s/.test(source[cursor] ?? "")) cursor++;
    return {
      value: point === 0 || point > 0x10ffff || (point >= 0xd800 && point <= 0xdfff)
        ? "\uFFFD"
        : String.fromCodePoint(point),
      next: cursor,
    };
  }
  if (source[cursor] === "\r" && source[cursor + 1] === "\n") {
    return { value: "", next: cursor + 2 };
  }
  if (/[\r\n\f]/.test(source[cursor])) return { value: "", next: cursor + 1 };
  return { value: source[cursor], next: cursor + 1 };
}

function readCssIdentifier(source, position) {
  let value = "";
  let cursor = position;
  while (cursor < source.length) {
    const character = source[cursor];
    if (character === "\\") {
      const escape = readCssEscape(source, cursor);
      value += escape.value;
      cursor = escape.next;
      continue;
    }
    if (!/[a-z0-9_-]/i.test(character)) break;
    value += character;
    cursor++;
  }
  return { value, next: cursor };
}

function readCssString(source, position) {
  const quote = source[position];
  let value = "";
  let cursor = position + 1;
  while (cursor < source.length) {
    if (source[cursor] === quote) return { value, next: cursor + 1 };
    if (source[cursor] === "\\") {
      const escape = readCssEscape(source, cursor);
      value += escape.value;
      cursor = escape.next;
    } else {
      value += source[cursor++];
    }
  }
  throw new Error("Unterminated CSS string dependency");
}

function collectCssDependencies(source) {
  const values = [];
  let cursor = 0;
  while (cursor < source.length) {
    if (source[cursor] === "/" && source[cursor + 1] === "*") {
      const close = source.indexOf("*/", cursor + 2);
      cursor = close < 0 ? source.length : close + 2;
      continue;
    }
    if (source[cursor] === "'" || source[cursor] === '"') {
      cursor = readCssString(source, cursor).next;
      continue;
    }
    if (source[cursor] === "@") {
      const atRule = readCssIdentifier(source, cursor + 1);
      if (atRule.value.toLowerCase() === "import") {
        const next = skipCssTrivia(source, atRule.next);
        if (source[next] === "'" || source[next] === '"') {
          const imported = readCssString(source, next);
          values.push(imported.value);
          cursor = imported.next;
          continue;
        }
      }
      cursor = Math.max(atRule.next, cursor + 1);
      continue;
    }
    if (/[a-z_-]/i.test(source[cursor]) || source[cursor] === "\\") {
      const identifier = readCssIdentifier(source, cursor);
      if (identifier.value.toLowerCase() === "url") {
        const open = skipCssTrivia(source, identifier.next);
        if (source[open] === "(") {
          let valueStart = skipCssTrivia(source, open + 1);
          if (source[valueStart] === "'" || source[valueStart] === '"') {
            const url = readCssString(source, valueStart);
            values.push(url.value);
            cursor = skipCssTrivia(source, url.next);
            if (source[cursor] !== ")") throw new Error("Unterminated CSS url() dependency");
            cursor++;
            continue;
          }
          let value = "";
          while (valueStart < source.length && source[valueStart] !== ")") {
            if (source[valueStart] === "/" && source[valueStart + 1] === "*") {
              const commentEnd = source.indexOf("*/", valueStart + 2);
              if (commentEnd < 0) throw new Error("Unterminated CSS comment inside url()");
              valueStart = commentEnd + 2;
            } else if (source[valueStart] === "\\") {
              const escape = readCssEscape(source, valueStart);
              value += escape.value;
              valueStart = escape.next;
            } else {
              value += source[valueStart++];
            }
          }
          if (valueStart >= source.length) throw new Error("Unterminated CSS url() dependency");
          values.push(value.trim());
          cursor = valueStart < source.length ? valueStart + 1 : valueStart;
          continue;
        }
      }
      cursor = Math.max(identifier.next, cursor + 1);
      continue;
    }
    cursor++;
  }
  return values;
}

export function extractCssResourceUrls(css, stylesheetUrl) {
  const values = collectCssDependencies(css);
  return [...new Set(values)]
    .map((value) => value.trim())
    .filter((value) => value && !/^data:/i.test(value) && !value.startsWith("#"))
    .map((value) => new URL(value, stylesheetUrl));
}
export function assertSameOrigin(actualUrl, expectedOrigin, label) {
  const actual = new URL(actualUrl);
  if (actual.origin !== expectedOrigin) {
    throw new Error(`${label} redirected to an unexpected origin: ${actual.origin}`);
  }
  return actual;
}

async function readBounded(response, limit, label) {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) {
    throw new Error(`${label} exceeds ${limit} bytes`);
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new Error(`${label} exceeds ${limit} bytes`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

export async function verifyPublishedSite(configuredUrl, fetchImpl = fetch) {
  if (!configuredUrl) throw new Error("Pages deployment did not provide a URL");
  const base = new URL(configuredUrl);
  if (base.protocol !== "https:") throw new Error("Expected an HTTPS Pages URL");

  const request = (url) => fetchImpl(url, {
    redirect: "follow",
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  const pageResponse = await request(base);
  if (!pageResponse.ok) throw new Error(`Published page returned HTTP ${pageResponse.status}`);
  const pageUrl = assertSameOrigin(pageResponse.url, base.origin, "Published page");
  const html = new TextDecoder().decode(await readBounded(pageResponse, HTML_LIMIT, "Published HTML"));
  if (!/<title>Network State/i.test(html)) throw new Error("Published HTML is missing the Network State title");
  if (!/id=["']root["']/.test(html)) throw new Error("Published HTML is missing the application root");

  const resources = extractResourceUrls(html, pageUrl);
  for (const resource of resources) {
    assertSameOrigin(resource.href, pageUrl.origin, "Published resource");
    if (resource.protocol !== "https:") {
      throw new Error(`Published resource uses an unexpected protocol: ${resource.protocol}`);
    }
  }

  const assets = extractAssets(html, pageUrl);
  if (assets.length === 0 || assets.length > MAX_ASSETS) {
    throw new Error(`Unexpected number of published JS/CSS assets: ${assets.length}`);
  }
  if (!assets.some((asset) => asset.pathname.endsWith(".js"))) {
    throw new Error("Published HTML does not reference a JavaScript entry asset");
  }
  if (!assets.some((asset) => asset.pathname.endsWith(".css"))) {
    throw new Error("Published HTML does not reference a CSS asset");
  }

  for (const asset of assets) {
    assertSameOrigin(asset.href, pageUrl.origin, "Published asset");
    const response = await request(asset);
    if (!response.ok) throw new Error(`Published asset returned HTTP ${response.status}: ${asset.pathname}`);
    assertSameOrigin(response.url, pageUrl.origin, "Published asset");
    const type = response.headers.get("content-type") ?? "";
    if (asset.pathname.endsWith(".js") && !/(?:javascript|ecmascript)/i.test(type)) {
      throw new Error(`JavaScript asset has unexpected content type: ${type}`);
    }
    if (asset.pathname.endsWith(".css") && !/text\/css/i.test(type)) {
      throw new Error(`CSS asset has unexpected content type: ${type}`);
    }
    const bytes = await readBounded(response, ASSET_LIMIT, `Published asset ${asset.pathname}`);
    if (bytes.byteLength === 0) throw new Error(`Published asset is empty: ${asset.pathname}`);
    if (asset.pathname.endsWith(".css")) {
      const cssResources = extractCssResourceUrls(new TextDecoder().decode(bytes), response.url || asset.href);
      for (const resource of cssResources) {
        assertSameOrigin(resource.href, pageUrl.origin, "Published CSS resource");
        if (resource.protocol !== "https:") throw new Error(`Published CSS resource uses an unexpected protocol: ${resource.protocol}`);
      }
    }
  }
  return { pageUrl: pageUrl.href, assetCount: assets.length, resourceCount: resources.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await verifyPublishedSite(process.env.PAGES_URL);
    console.log(`Pages smoke test passed: ${result.pageUrl} (${result.assetCount} same-origin JS/CSS assets, ${result.resourceCount} same-origin resources)`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
