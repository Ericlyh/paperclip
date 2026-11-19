import fs from "node:fs/promises";
import path from "node:path";
import { constants } from "node:zlib";
import { brotliCompress, gzip } from "node:zlib";
import { promisify } from "node:util";
import type { RequestHandler } from "express";

const gzipAsync = promisify(gzip);
const brotliCompressAsync = promisify(brotliCompress);

/** Below this size the compression headers cost more than they save. */
const MIN_COMPRESS_BYTES = 1024;

/**
 * Brotli quality 5. The entry bundle is a few MB; quality 11 would spend
 * seconds of CPU on the first request to save a few percent of bytes.
 */
const BROTLI_QUALITY = 5;

/**
 * Only text-ish assets are worth compressing — images, fonts and archives are
 * already compressed and gzipping them wastes CPU for no gain.
 */
const CONTENT_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".wasm": "application/wasm",
};

type Encoding = "br" | "gzip";

type Variants = {
  gzip: Buffer;
  br: Buffer;
};

type CacheEntry = {
  /** size + mtime of the source file, so a rebuilt asset invalidates the cache */
  signature: string;
  pending: Promise<Variants>;
};

/**
 * Pick the best encoding the client accepts.
 *
 * `Accept-Encoding: br` on its own means "br and nothing else" for a browser
 * that cannot read gzip, and a plain `*` means "anything". Both gzip and br
 * are only used when the client lists them with q > 0.
 */
export function selectAssetEncoding(acceptEncoding: string | undefined): Encoding | null {
  if (!acceptEncoding) return null;
  const weights = new Map<string, number>();
  for (const part of acceptEncoding.split(",")) {
    const [rawName, ...params] = part.trim().split(";");
    const name = rawName.trim().toLowerCase();
    if (!name) continue;
    let q = 1;
    for (const param of params) {
      const match = param.trim().match(/^q=([0-9.]+)$/i);
      if (match) {
        const parsed = Number.parseFloat(match[1]);
        if (Number.isFinite(parsed)) q = parsed;
      }
    }
    weights.set(name, q);
  }
  const wildcard = weights.get("*") ?? 0;
  const brQ = weights.get("br") ?? wildcard;
  const gzipQ = weights.get("gzip") ?? wildcard;
  if (brQ <= 0 && gzipQ <= 0) return null;
  if (brQ > 0 && brQ >= gzipQ) return "br";
  return "gzip";
}

/**
 * Compress the hashed UI assets that `express.static` serves.
 *
 * The Vite entry bundle was 23 MB and went out over the wire uncompressed —
 * `express.static` does not negotiate `Accept-Encoding`, and the API
 * compression middleware only covers `/api`. On a phone reaching the instance
 * over Tailscale that single file dominated page load.
 *
 * Assets under `/assets` are content-hashed and therefore immutable, so each
 * one is compressed once and kept in memory.
 */
export function staticAssetCompression(assetsDir: string): RequestHandler {
  const resolvedAssetsDir = path.resolve(assetsDir);
  const cache = new Map<string, CacheEntry>();

  async function variantsFor(filePath: string, signature: string): Promise<Variants> {
    const existing = cache.get(filePath);
    if (existing && existing.signature === signature) return existing.pending;
    const pending = (async () => {
      const raw = await fs.readFile(filePath);
      const [gzipped, brotlied] = await Promise.all([
        gzipAsync(raw, { level: 6 }),
        brotliCompressAsync(raw, {
          params: { [constants.BROTLI_PARAM_QUALITY]: BROTLI_QUALITY },
        }),
      ]);
      return { gzip: gzipped, br: brotlied };
    })();
    cache.set(filePath, { signature, pending });
    return pending;
  }

  return async (req, res, next) => {
    try {
      if (req.method !== "GET" && req.method !== "HEAD") {
        next();
        return;
      }
      const encoding = selectAssetEncoding(req.headers["accept-encoding"]);
      if (!encoding) {
        next();
        return;
      }
      const relative = decodeURIComponent(req.path || "");
      const filePath = path.resolve(resolvedAssetsDir, `.${relative}`);
      // Never serve anything outside the assets directory.
      if (filePath !== resolvedAssetsDir && !filePath.startsWith(resolvedAssetsDir + path.sep)) {
        next();
        return;
      }
      const contentType = CONTENT_TYPES[path.extname(filePath).toLowerCase()];
      if (!contentType) {
        next();
        return;
      }
      const stats = await fs.stat(filePath).catch(() => null);
      if (!stats || !stats.isFile() || stats.size < MIN_COMPRESS_BYTES) {
        next();
        return;
      }
      const variants = await variantsFor(filePath, `${stats.size}:${stats.mtimeMs}`);
      const body = variants[encoding];
      res.setHeader("Content-Type", contentType);
      res.setHeader("Content-Encoding", encoding);
      res.setHeader("Content-Length", String(body.length));
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      res.vary("Accept-Encoding");
      res.status(200);
      if (req.method === "HEAD") {
        res.end();
        return;
      }
      res.end(body);
    } catch (error) {
      next(error);
    }
  };
}
