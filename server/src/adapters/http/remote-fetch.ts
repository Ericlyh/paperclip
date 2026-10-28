import {
  assertPublicRemoteHttpEndpoint,
  parseRemoteHttpEndpoint,
} from "../../services/remote-http-endpoint-guard.js";

const PRIVATE_ENDPOINT_ALLOWLIST_ENV = "PAPERCLIP_HTTP_ADAPTER_PRIVATE_ENDPOINT_ALLOWLIST";

export class HttpAdapterEndpointError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = "HttpAdapterEndpointError";
    this.code = code;
  }
}

function endpointError(message: string, code: string) {
  return new HttpAdapterEndpointError(
    message
      .replaceAll("Remote MCP connection", "HTTP adapter endpoint")
      .replaceAll("Remote MCP endpoint", "HTTP adapter endpoint"),
    code,
  );
}

function normalizeAllowlistedOrigin(value: string): string | null {
  let endpoint: URL;
  try {
    endpoint = new URL(value);
  } catch {
    return null;
  }
  if (endpoint.protocol !== "http:" && endpoint.protocol !== "https:") return null;
  if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash) return null;
  if (endpoint.pathname !== "/") return null;
  return endpoint.origin.toLowerCase();
}

/**
 * Exact origins an operator trusts to live on a private network. A private
 * HTTP-adapter endpoint is only reachable when its origin is listed here.
 */
export function httpAdapterPrivateEndpointAllowlist(
  raw = process.env[PRIVATE_ENDPOINT_ALLOWLIST_ENV] ?? "",
): ReadonlySet<string> {
  return new Set(
    raw
      .split(",")
      .map((entry) => normalizeAllowlistedOrigin(entry.trim()))
      .filter((entry): entry is string => entry !== null),
  );
}

type HttpAdapterFetchOptions = {
  privateEndpointAllowlist?: ReadonlySet<string>;
};

/**
 * Guard every HTTP-adapter request before the socket is opened.
 *
 * The adapter URL comes from agent configuration, so an unguarded `fetch`
 * lets an agent reach cloud metadata endpoints, loopback and RFC1918 hosts
 * from the Paperclip server. The shared remote-endpoint guard resolves the
 * hostname and rejects private, loopback, link-local and metadata targets;
 * an operator-trusted origin may opt into private networking, but link-local
 * and metadata addresses stay blocked even then.
 *
 * Redirects are never followed: a public endpoint that redirects to a private
 * address would otherwise re-open the path the guard just closed.
 */
export async function guardedHttpAdapterFetch(
  url: string | URL,
  init: RequestInit,
  options: HttpAdapterFetchOptions = {},
): Promise<Response> {
  const endpoint = parseRemoteHttpEndpoint(url.toString(), endpointError);
  const allowlist = options.privateEndpointAllowlist ?? httpAdapterPrivateEndpointAllowlist();
  await assertPublicRemoteHttpEndpoint(
    endpoint,
    {
      allowPrivateNetwork: allowlist.has(endpoint.origin.toLowerCase()),
      denyLinkLocal: true,
    },
    endpointError,
  );
  return fetch(endpoint.toString(), { ...init, redirect: "manual" });
}
