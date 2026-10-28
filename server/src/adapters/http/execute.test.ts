import { afterEach, describe, expect, it, vi } from "vitest";
import { execute } from "./execute.js";

const dnsLookupMock = vi.hoisted(() =>
  vi.fn(async (_hostname: string, _options?: unknown) => [{ address: "93.184.216.34", family: 4 }]),
);

vi.mock("node:dns/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:dns/promises")>();
  return { ...actual, lookup: dnsLookupMock };
});

afterEach(() => {
  vi.unstubAllGlobals();
  dnsLookupMock.mockClear();
});

describe("http adapter execute", () => {
  it("reports configured request timeout as timed_out", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        });
      })),
    );

    const result = await execute({
      runId: "run-1",
      agent: {
        id: "agent-1",
        companyId: "company-1",
        name: "Agent",
        adapterType: "http",
        adapterConfig: {},
      },
      runtime: {
        sessionId: null,
        sessionParams: null,
        sessionDisplayId: null,
        taskKey: null,
      },
      config: {
        url: "https://example.test/webhook",
        timeoutMs: 1,
      },
      context: {},
      onLog: async () => {},
    });

    expect(result.timedOut).toBe(true);
    expect(result.errorCode).toBe("timeout");
    expect(result.errorMessage).toContain("timed out after 1ms");
  });

  it("refuses to invoke a cloud metadata endpoint", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(execute({
      runId: "run-1",
      agent: {
        id: "agent-1",
        companyId: "company-1",
        name: "Agent",
        adapterType: "http",
        adapterConfig: {},
      },
      runtime: {
        sessionId: null,
        sessionParams: null,
        sessionDisplayId: null,
        taskKey: null,
      },
      config: {
        url: "http://169.254.169.254/latest/meta-data/iam/security-credentials/",
      },
      context: {},
      onLog: async () => {},
    })).rejects.toMatchObject({ code: "remote_http_private_endpoint" });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses to invoke a loopback endpoint", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(execute({
      runId: "run-1",
      agent: {
        id: "agent-1",
        companyId: "company-1",
        name: "Agent",
        adapterType: "http",
        adapterConfig: {},
      },
      runtime: {
        sessionId: null,
        sessionParams: null,
        sessionDisplayId: null,
        taskKey: null,
      },
      config: {
        url: "http://127.0.0.1:3100/api/internal",
      },
      context: {},
      onLog: async () => {},
    })).rejects.toMatchObject({ code: "remote_http_private_endpoint" });

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
