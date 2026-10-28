import { createServer, request as httpRequest, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { connect as netConnect, Socket, type AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";

import { guardedHttpAdapterFetch } from "../adapters/http/remote-fetch.js";

/**
 * DNS-rebinding regression coverage for the HTTP adapter.
 *
 * The guard used to resolve the hostname, approve the answer and then hand
 * the *hostname* to the platform `fetch`, which resolved it a second time on
 * its own. A name server the caller controls can answer with a public address
 * for the guard's lookup and with 127.0.0.1 for the connection, so the request
 * lands on an internal service (or the cloud metadata endpoint) even though the
 * guard approved a public address.
 *
 * The name server is modelled deterministically: the first lookup returns a
 * public address and every later lookup returns 127.0.0.1. Nothing here
 * touches real DNS or the real network — the socket factory stands in for the
 * network so a "public" address is a loopback listener that reports itself as
 * public, exactly as it would look to the kernel.
 */

const PUBLIC_ADDRESS = "93.184.216.34";
const REBIND_ADDRESS = "127.0.0.1";
const REBIND_HOST = "hooks.attacker.example";

const dnsLookupMock = vi.hoisted(() =>
  vi.fn(async (_hostname: string, _options?: unknown) => [{ address: PUBLIC_ADDRESS, family: 4 }]),
);

vi.mock("node:dns/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:dns/promises")>();
  return { ...actual, lookup: dnsLookupMock };
});

type TestServer = {
  server: Server;
  port: number;
  requests: Array<{ url: string; host: string | undefined }>;
};

const openServers: Server[] = [];
const openSockets: Socket[] = [];

afterEach(async () => {
  for (const socket of openSockets.splice(0)) socket.destroy();
  await Promise.all(
    openServers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
  vi.unstubAllGlobals();
  dnsLookupMock.mockReset();
  dnsLookupMock.mockImplementation(async () => [{ address: PUBLIC_ADDRESS, family: 4 }]);
});

async function startServer(body: unknown): Promise<TestServer> {
  const requests: TestServer["requests"] = [];
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    requests.push({ url: req.url ?? "", host: req.headers.host });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  });
  openServers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, port: (server.address() as AddressInfo).port, requests };
}

/**
 * A name server that answers public first and loopback afterwards.
 */
function rebindingNameServer() {
  let calls = 0;
  return {
    lookup: async () => {
      calls += 1;
      return calls === 1
        ? [{ address: PUBLIC_ADDRESS, family: 4 }]
        : [{ address: REBIND_ADDRESS, family: 4 }];
    },
    calls: () => calls,
  };
}

/**
 * A stand-in for the network: routes whatever address the transport dialled to
 * a loopback listener and reports `remoteAddress` as the dialled address, so
 * the peer check sees what the kernel would have seen.
 */
function routingSocketFactory(routes: Record<string, number>) {
  const dialled: string[] = [];
  const factory = (target: { address: string; port: number }) => {
    dialled.push(target.address);
    const port = routes[target.address];
    if (port === undefined) throw new Error(`test network has no route to ${target.address}`);
    const socket = netConnect({ host: "127.0.0.1", port });
    openSockets.push(socket);
    Object.defineProperty(socket, "remoteAddress", { get: () => target.address, configurable: true });
    return socket;
  };
  return { factory, dialled };
}

/**
 * Stands in for the platform `fetch`, which resolves the hostname itself. The
 * second lookup therefore answers 127.0.0.1 and the request is delivered to the
 * loopback service — the exact behaviour the pinning has to prevent.
 */
function rebindingFetch(internalPort: number) {
  return vi.fn(async (input: string | URL) => {
    const url = new URL(String(input));
    const answers = await dnsLookupMock(url.hostname);
    const address = answers[0]?.address ?? REBIND_ADDRESS;
    if (address !== REBIND_ADDRESS) {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    const proxied = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = httpRequest(
        {
          method: "GET",
          host: "127.0.0.1",
          port: internalPort,
          path: `${url.pathname}${url.search}`,
          headers: { host: url.host },
        },
        (res) => {
          let payload = "";
          res.setEncoding("utf8");
          res.on("data", (chunk: string) => {
            payload += chunk;
          });
          res.on("end", () => resolve({ status: res.statusCode ?? 502, body: payload }));
        },
      );
      req.on("error", reject);
      req.end();
    });
    return new Response(proxied.body, {
      status: proxied.status,
      headers: { "content-type": "application/json" },
    });
  });
}

describe("http adapter DNS pinning", () => {
  it("never lets a later DNS answer redirect the request to loopback", async () => {
    const upstream = await startServer({ ok: true });
    const internal = await startServer({ internal: true });
    const dns = rebindingNameServer();
    const network = routingSocketFactory({
      [PUBLIC_ADDRESS]: upstream.port,
      [REBIND_ADDRESS]: internal.port,
    });

    // The platform fetch is what used to resolve the hostname a second time.
    // It stands in for undici: it looks the hostname up again and delivers the
    // request to whatever address that second answer names.
    const fetchMock = rebindingFetch(internal.port);
    vi.stubGlobal("fetch", fetchMock);

    dnsLookupMock.mockImplementation(dns.lookup);

    const response = await guardedHttpAdapterFetch(`http://${REBIND_HOST}/hook`, {
      method: "POST",
    }, {
      lookup: dns.lookup,
      socketFactory: network.factory,
    });

    // The loopback service the rebind answer pointed at was never reached.
    expect(internal.requests).toHaveLength(0);

    // The connection went to the address the guard approved, and the rebind
    // answer was never consulted.
    expect(network.dialled).toEqual([PUBLIC_ADDRESS]);
    expect(dns.calls()).toBe(1);
    expect(upstream.requests).toHaveLength(1);
    expect(upstream.requests[0]?.host).toBe(REBIND_HOST);
    await expect(response.json()).resolves.toEqual({ ok: true });

    // A hostname is never handed to the platform fetch, which would resolve it
    // again on its own.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a peer that turns out to be loopback without writing a request", async () => {
    const internal = await startServer({ internal: true });
    const dns = rebindingNameServer();

    // A rebind below DNS: the resolution approved a public address, but the
    // socket lands on loopback anyway. The peer check has to catch it, and it
    // has to catch it before any request byte is written.
    const factory = () => {
      const socket = netConnect({ host: "127.0.0.1", port: internal.port });
      openSockets.push(socket);
      return socket;
    };

    await expect(
      guardedHttpAdapterFetch(`http://${REBIND_HOST}/hook`, { method: "POST" }, {
        lookup: dns.lookup,
        socketFactory: factory,
      }),
    ).rejects.toMatchObject({ code: "remote_http_private_endpoint" });

    expect(internal.requests).toHaveLength(0);
  });
});
