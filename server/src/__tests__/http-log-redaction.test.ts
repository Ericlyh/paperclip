import { createServer, request } from "node:http";
import { Writable } from "node:stream";
import pino from "pino";
import { pinoHttp } from "pino-http";
import { describe, expect, it } from "vitest";
import { HTTP_LOG_REDACT_PATHS } from "../middleware/http-log-redaction.js";

describe("HTTP logger redaction", () => {
  it("defines the HTTP auth and cookie header paths that must be redacted", () => {
    expect(HTTP_LOG_REDACT_PATHS).toContain("req.headers.authorization");
    expect(HTTP_LOG_REDACT_PATHS).toContain("req.headers.cookie");
    expect(HTTP_LOG_REDACT_PATHS).toContain('req.headers["set-cookie"]');
    expect(HTTP_LOG_REDACT_PATHS).toContain('res.headers["set-cookie"]');
    expect(HTTP_LOG_REDACT_PATHS).toContain('req.headers["proxy-authorization"]');
    expect(HTTP_LOG_REDACT_PATHS).toContain('req.headers["x-csrf-token"]');
    expect(HTTP_LOG_REDACT_PATHS).toContain('req.headers["x-xsrf-token"]');
    expect(HTTP_LOG_REDACT_PATHS).toContain('req.headers["x-api-key"]');
  });

  it("defines the credential-bearing server header paths that must be redacted", () => {
    expect(HTTP_LOG_REDACT_PATHS).toContain('req.headers["x-paperclip-cloud-tenant-token"]');
    expect(HTTP_LOG_REDACT_PATHS).toContain('req.headers["x-paperclip-workspace-readiness-token"]');
    expect(HTTP_LOG_REDACT_PATHS).toContain('req.headers["x-paperclip-tool-gateway-token"]');
    expect(HTTP_LOG_REDACT_PATHS).toContain('req.headers["x-paperclip-dev-server-status-token"]');
  });

  it("redacts request and response header secrets from pino-http output", async () => {
    const chunks: string[] = [];
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(chunk.toString());
        callback();
      },
    });
    const logger = pino({ redact: [...HTTP_LOG_REDACT_PATHS] }, stream);
    const httpLogger = pinoHttp({ logger });
    const server = createServer((req, res) => {
      httpLogger(req, res);
      res.setHeader("set-cookie", "sid=response-secret");
      res.end("ok");
    });

    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => resolve());
      });
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Expected server to listen on an ephemeral TCP port");
      }

      await new Promise<void>((resolve, reject) => {
        const client = request(
          {
            hostname: "127.0.0.1",
            port: address.port,
            path: "/redaction-check",
            headers: {
              authorization: "Bearer auth-secret",
              cookie: "sid=request-secret",
              "set-cookie": "proxy-secret",
            },
          },
          (res) => {
            res.resume();
            res.on("end", resolve);
          },
        );
        client.on("error", reject);
        client.end();
      });

      await new Promise((resolve) => setImmediate(resolve));
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }

    const output = chunks.join("");
    expect(output).not.toMatch(/auth-secret|request-secret|proxy-secret|response-secret/);

    const log = JSON.parse(output.trim()) as {
      req: { headers: Record<string, string> };
      res: { headers: Record<string, string> };
    };
    expect(log.req.headers.authorization).toBe("[Redacted]");
    expect(log.req.headers.cookie).toBe("[Redacted]");
    expect(log.req.headers["set-cookie"]).toBe("[Redacted]");
    expect(log.res.headers["set-cookie"]).toBe("[Redacted]");
  });

  it("redacts server-owned credential headers from pino-http output", async () => {
    const credentialHeaders = {
      "x-paperclip-cloud-tenant-token": "cloud-tenant-token-canary",
      "x-paperclip-workspace-readiness-token": "workspace-readiness-canary",
      "x-paperclip-tool-gateway-token": "tool-gateway-canary",
      "x-paperclip-dev-server-status-token": "dev-server-status-canary",
    };
    const chunks: string[] = [];
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(chunk.toString());
        callback();
      },
    });
    const logger = pino({ redact: [...HTTP_LOG_REDACT_PATHS] }, stream);
    const httpLogger = pinoHttp({ logger });
    const server = createServer((req, res) => {
      httpLogger(req, res);
      res.end("ok");
    });

    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => resolve());
      });
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Expected server to listen on an ephemeral TCP port");
      }

      await new Promise<void>((resolve, reject) => {
        const client = request(
          {
            hostname: "127.0.0.1",
            port: address.port,
            path: "/credential-header-check",
            headers: { ...credentialHeaders },
          },
          (res) => {
            res.resume();
            res.on("end", resolve);
          },
        );
        client.on("error", reject);
        client.end();
      });

      await new Promise((resolve) => setImmediate(resolve));
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }

    const output = chunks.join("");
    for (const secret of Object.values(credentialHeaders)) {
      expect(output).not.toContain(secret);
    }

    const log = JSON.parse(output.trim()) as {
      req: { method: string; url: string; headers: Record<string, string> };
      res: { statusCode: number };
    };
    for (const header of Object.keys(credentialHeaders)) {
      expect(log.req.headers[header]).toBe("[Redacted]");
    }
    // The diagnostic context operators need must survive redaction.
    expect(log.req.method).toBe("GET");
    expect(log.req.url).toBe("/credential-header-check");
    expect(log.res.statusCode).toBe(200);
  });
});
