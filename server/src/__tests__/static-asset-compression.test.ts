import express from "express";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createServer, request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import { brotliDecompressSync, gunzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { selectAssetEncoding, staticAssetCompression } from "../middleware/static-asset-compression.js";

type RawResponse = {
  statusCode: number;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
};

const openServers: Array<ReturnType<typeof createServer>> = [];
let assetsDir: string;

beforeEach(async () => {
  assetsDir = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-assets-"));
  await fs.writeFile(
    path.join(assetsDir, "index-abc123.js"),
    `console.log("${"x".repeat(4096)}");\n`,
  );
  await fs.writeFile(path.join(assetsDir, "tiny.css"), "a{}");
  await fs.writeFile(path.join(assetsDir, "logo.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
});

afterEach(async () => {
  await Promise.all(openServers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
    server.close((err) => err ? reject(err) : resolve());
  })));
  await fs.rm(assetsDir, { recursive: true, force: true });
});

async function requestRaw(app: express.Express, urlPath: string, headers: Record<string, string> = {}): Promise<RawResponse> {
  const server = createServer(app);
  openServers.push(server);
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;

  return await new Promise<RawResponse>((resolve, reject) => {
    const req = httpRequest({
      host: "127.0.0.1",
      port: address.port,
      path: urlPath,
      headers,
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      res.on("end", () => {
        resolve({
          statusCode: res.statusCode ?? 0,
          headers: res.headers,
          body: Buffer.concat(chunks),
        });
      });
    });
    req.on("error", reject);
    req.end();
  });
}

function buildApp() {
  const app = express();
  app.use("/assets", staticAssetCompression(assetsDir));
  app.use("/assets", express.static(assetsDir, { maxAge: "1y", immutable: true }));
  return app;
}

describe("static asset compression", () => {
  it("negotiates brotli over gzip", () => {
    expect(selectAssetEncoding("br, gzip")).toBe("br");
    expect(selectAssetEncoding("gzip, deflate, br")).toBe("br");
    expect(selectAssetEncoding("gzip, deflate")).toBe("gzip");
    expect(selectAssetEncoding("deflate")).toBeNull();
    expect(selectAssetEncoding("identity")).toBeNull();
    expect(selectAssetEncoding(undefined)).toBeNull();
  });

  it("ignores encodings the client refused with q=0", () => {
    expect(selectAssetEncoding("br;q=0, gzip")).toBe("gzip");
    expect(selectAssetEncoding("br;q=0, gzip;q=0")).toBeNull();
  });

  it("serves brotli and decompresses to the original bytes", async () => {
    const res = await requestRaw(buildApp(), "/assets/index-abc123.js", {
      "Accept-Encoding": "br, gzip",
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-encoding"]).toBe("br");
    expect(String(res.headers.vary)).toContain("Accept-Encoding");
    expect(String(res.headers["content-type"])).toContain("javascript");
    expect(res.headers["cache-control"]).toContain("immutable");
    const decoded = brotliDecompressSync(res.body).toString("utf8");
    expect(decoded).toContain("console.log");
    expect(decoded.length).toBe(4096 + "console.log(\"".length + "\");\n".length);
  });

  it("serves gzip when the client does not accept brotli", async () => {
    const res = await requestRaw(buildApp(), "/assets/index-abc123.js", {
      "Accept-Encoding": "gzip",
    });
    expect(res.headers["content-encoding"]).toBe("gzip");
    expect(gunzipSync(res.body).toString("utf8")).toContain("console.log");
  });

  it("leaves the response uncompressed when the client accepts no encoding", async () => {
    const res = await requestRaw(buildApp(), "/assets/index-abc123.js", {
      "Accept-Encoding": "identity",
    });
    expect(res.headers["content-encoding"]).toBeUndefined();
    expect(res.body.toString("utf8")).toContain("console.log");
  });

  it("leaves already-compressed and tiny files alone", async () => {
    const png = await requestRaw(buildApp(), "/assets/logo.png", { "Accept-Encoding": "br, gzip" });
    expect(png.headers["content-encoding"]).toBeUndefined();
    expect(png.statusCode).toBe(200);

    const tiny = await requestRaw(buildApp(), "/assets/tiny.css", { "Accept-Encoding": "br, gzip" });
    expect(tiny.headers["content-encoding"]).toBeUndefined();
    expect(tiny.statusCode).toBe(200);
  });

  it("does not serve files outside the assets directory", async () => {
    const res = await requestRaw(buildApp(), "/assets/../../etc/passwd", {
      "Accept-Encoding": "br, gzip",
    });
    expect(res.headers["content-encoding"]).toBeUndefined();
  });
});
