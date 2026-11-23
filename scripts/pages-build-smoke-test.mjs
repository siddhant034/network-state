import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { verifyPublishedSite } from "./pages-smoke-test.mjs";

const MIME_TYPES = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".webp", "image/webp"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
]);

function normalizeBasePath(value) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || /[?#\\\\]/.test(value)) {
    throw new Error("Build base path must be a same-origin absolute path");
  }
  const normalized = value.endsWith("/") ? value : value + "/";
  if (normalized.split("/").some((segment) => segment === "." || segment === "..")) {
    throw new Error("Build base path must not contain dot segments");
  }
  return normalized;
}

function responseFor(body, url, pathname) {
  const response = new Response(body, {
    status: 200,
    headers: { "content-type": MIME_TYPES.get(path.extname(pathname).toLowerCase()) ?? "application/octet-stream" },
  });
  Object.defineProperty(response, "url", { value: url });
  return response;
}

/** Validate the actual Vite output with the same resource/privacy audit used after Pages deployment. */
export async function verifyBuildArtifact(distDirectory, basePath = "/network-state/") {
  const root = path.resolve(distDirectory);
  const base = normalizeBasePath(basePath);
  const siteUrl = new URL(base, "https://network-state.local");

  const fetchArtifact = async (requestedUrl) => {
    const url = new URL(String(requestedUrl));
    if (url.origin !== siteUrl.origin || !url.pathname.startsWith(base)) {
      return responseFor("Unexpected origin or base path", url.href, url.pathname);
    }

    let decodedPath;
    try {
      decodedPath = decodeURIComponent(url.pathname.slice(base.length));
    } catch {
      return responseFor("Malformed asset path", url.href, url.pathname);
    }
    const candidate = path.resolve(root, decodedPath || "index.html");
    if (candidate !== root && !candidate.startsWith(root + path.sep)) {
      return responseFor("Path traversal rejected", url.href, url.pathname);
    }

    try {
      const body = await readFile(candidate);
      return responseFor(body, url.href, candidate);
    } catch {
      return new Response("Not found", {
        status: 404,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }
  };

  return verifyPublishedSite(siteUrl.href, fetchArtifact);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const basePath = process.env.PAGES_BASE_PATH ?? "/network-state/";
    const result = await verifyBuildArtifact(process.argv[2] ?? "dist", basePath);
    console.log(`Pages build preflight passed: ${result.pageUrl} (${result.assetCount} same-origin JS/CSS assets, ${result.resourceCount} same-origin resources)`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
