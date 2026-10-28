import { afterEach, describe, expect, it, vi } from "vitest";
import {
  guardedHttpAdapterFetch,
  httpAdapterPrivateEndpointAllowlist,
} from "../adapters/http/remote-fetch.js";

const dnsLookupMock = vi.hoisted(() =>
  vi.fn(async (_hostname: string, _options?: unknown) => [{ address: "93.184.216.34", family: 4 }]),
);

vi.mock("node:dns/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:dns/promises")>();
  return { ...actual, lookup: dnsLookupMock };
});

afterEach(() => {
  vi.unstubAllGlobals();
  dnsLookupMock.mockReset();
  dnsLookupMock.mockImplementation(async () => [{ address: "93.184.216.34", family: 4 }]);
});

describe("http adapter endpoint guard", () => {
  it("rejects cloud metadata endpoints without opening a socket", async () => {
    const socketFactory = vi.fn(() => {
      throw new Error("must not dial");
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      guardedHttpAdapterFetch("http://169.254.169.254/latest/meta-data/iam/security-credentials/", {
        method: "POST",
      }, { socketFactory }),
    ).rejects.toMatchObject({ code: "remote_http_private_endpoint" });

    expect(socketFactory).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    "http://127.0.0.1:8080/hook",
    "http://10.0.0.5/hook",
    "http://172.16.4.4/hook",
    "http://192.168.1.10/hook",
    "http://[::1]/hook",
  ])("rejects the private endpoint %s", async (url) => {
    const socketFactory = vi.fn(() => {
      throw new Error("must not dial");
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(guardedHttpAdapterFetch(url, { method: "POST" }, { socketFactory })).rejects.toMatchObject({
      code: "remote_http_private_endpoint",
    });

    expect(socketFactory).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a hostname that resolves to a private address", async () => {
    dnsLookupMock.mockImplementation(async () => [{ address: "10.1.2.3", family: 4 }]);
    const socketFactory = vi.fn(() => {
      throw new Error("must not dial");
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      guardedHttpAdapterFetch("https://hooks.example.com/hook", { method: "POST" }, { socketFactory }),
    ).rejects.toMatchObject({ code: "remote_http_private_endpoint" });

    expect(socketFactory).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("allows a public endpoint and never follows redirects", async () => {
    // An IP literal cannot be rebound, so the platform fetch handles it.
    // Redirects must stay manual so a public endpoint cannot redirect the
    // adapter into a private address.
    const unpinnedFetch = vi.fn(async () => new Response(null, { status: 204 }));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await guardedHttpAdapterFetch("https://93.184.216.34/hook", {
      method: "POST",
    }, { unpinnedFetch });

    expect(response.status).toBe(204);
    expect(unpinnedFetch).toHaveBeenCalledTimes(1);
    expect(unpinnedFetch.mock.calls[0]?.[1]).toMatchObject({ redirect: "manual" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("allows an operator-allowlisted private origin", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await guardedHttpAdapterFetch(
      "http://10.0.0.5:8080/hook",
      { method: "POST" },
      { privateEndpointAllowlist: new Set(["http://10.0.0.5:8080"]) },
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not allow a sibling port of an allowlisted private origin", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      guardedHttpAdapterFetch(
        "http://10.0.0.5:8081/hook",
        { method: "POST" },
        { privateEndpointAllowlist: new Set(["http://10.0.0.5:8080"]) },
      ),
    ).rejects.toMatchObject({ code: "remote_http_private_endpoint" });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("still blocks the metadata endpoint for an allowlisted origin", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      guardedHttpAdapterFetch(
        "http://169.254.169.254/latest-meta-data/",
        { method: "POST" },
        { privateEndpointAllowlist: new Set(["http://169.254.169.254"]) },
      ),
    ).rejects.toMatchObject({ code: "remote_http_private_endpoint" });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects endpoints that do not use http or https", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(guardedHttpAdapterFetch("file:///etc/passwd", { method: "POST" })).rejects.toMatchObject({
      code: "mcp_remote_url_invalid",
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("parses the private endpoint allowlist into exact origins", () => {
    const allowlist = httpAdapterPrivateEndpointAllowlist(
      "http://10.0.0.5:8080, https://internal.example.com/ , not-a-url, http://10.0.0.5:8080/path",
    );

    expect([...allowlist].sort()).toEqual(["http://10.0.0.5:8080", "https://internal.example.com"]);
  });
});
