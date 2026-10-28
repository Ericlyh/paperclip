import { describe, expect, it } from "vitest";
import { assertPublicRemoteHttpEndpoint } from "../services/remote-http-endpoint-guard.js";

function guardError(message: string, code: string) {
  return Object.assign(new Error(message), { code });
}

describe("remote HTTP endpoint guard", () => {
  it("blocks hostnames that resolve to private network addresses", async () => {
    await expect(assertPublicRemoteHttpEndpoint(
      new URL("https://metadata.example/mcp"),
      { lookup: async () => [{ address: "10.0.0.12", family: 4 }] },
      guardError,
    )).rejects.toMatchObject({ code: "remote_http_private_endpoint" });
  });

  it("allows hostnames when every resolved address is public", async () => {
    await expect(assertPublicRemoteHttpEndpoint(
      new URL("https://public.example/mcp"),
      { lookup: async () => [{ address: "93.184.216.34", family: 4 }] },
      guardError,
    )).resolves.toBeUndefined();
  });

  it.each([
    "http://[2001::1]/mcp",
    "http://[2001:20::1]/mcp",
    "http://[2001:2f::1]/mcp",
    "http://[64:ff9b:1::1]/mcp",
  ])("rejects reserved IPv6 endpoint %s", async (url) => {
    await expect(assertPublicRemoteHttpEndpoint(
      new URL(url),
      {},
      guardError,
    )).rejects.toMatchObject({ code: "remote_http_private_endpoint" });
  });

  it("denies the metadata address even when private networking is allowed", async () => {
    await expect(assertPublicRemoteHttpEndpoint(
      new URL("http://169.254.169.254/latest/meta-data/"),
      { allowPrivateNetwork: true, denyLinkLocal: true },
      guardError,
    )).rejects.toMatchObject({ code: "remote_http_private_endpoint" });
  });

  it("denies hostnames that resolve to a link-local address", async () => {
    await expect(assertPublicRemoteHttpEndpoint(
      new URL("https://metadata.example/mcp"),
      {
        allowPrivateNetwork: true,
        denyLinkLocal: true,
        lookup: async () => [{ address: "169.254.169.254", family: 4 }],
      },
      guardError,
    )).rejects.toMatchObject({ code: "remote_http_private_endpoint" });
  });

  it("keeps allowing private addresses when link-local egress is denied", async () => {
    await expect(assertPublicRemoteHttpEndpoint(
      new URL("http://10.0.0.12/mcp"),
      { allowPrivateNetwork: true, denyLinkLocal: true },
      guardError,
    )).resolves.toBeUndefined();
  });
});
