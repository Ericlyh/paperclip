#!/usr/bin/env node
/**
 * minimax-cu-sidecar — an Electron-sidecar bridge that exposes MiniMax Code's
 * Computer Use MCP server over plain HTTP, for agents that need the `desktop_*`
 * tools without the standalone `minimax` CLI (removed in MiniMax Code 3.0.48).
 *
 * Why this exists
 * ---------------
 * MiniMax Code 3.0.68 no longer ships a reachable daemon port. The app's only
 * TCP listener is the Squirrel auto-updater proxy (it answers `/` with
 * `401 Invalid Authentication Credentials` and 404s everything else — a decoy
 * that a naive port scan mistakes for the runtime API). The Computer Use MCP
 * server does exist, but only in-process: the Electron app imports
 * `@mavis/local-runtime`, whose `api/cu-mcp.js` mounts `POST/GET/DELETE
 * /mavis/mcp/cu` behind `routeLocalApiHostEntryRequest()`.
 *
 * `@mavis/local-runtime` is a *pure-JS npm package* that ships inside
 * `app.asar`, and its Computer Use implementation (`services/cu/native.ts`)
 * documents that it deliberately runs in a plain Node process: it drives
 * `@nut-tree/nut-js` (libnut), which does not require Electron. So the bridge
 * does not need MiniMax to publish a port (the "Phase 1 escape hatch" the
 * original issue asked the vendor for) — it can host the very same MCP server
 * itself, as a sidecar.
 *
 * How it works
 * ------------
 * 1. `--prepare` (also run automatically) extracts the app's `node_modules`
 *    out of `app.asar` / `app.asar.unpacked` into a cache directory, verifying
 *    every file against the SHA-256 integrity hash recorded in the asar index.
 * 2. The server is launched by the *app's own* Electron binary with
 *    `ELECTRON_RUN_AS_NODE=1`, because the Computer Use native bindings
 *    (`libnut.node`, `permissions.node`) are built for Electron's ABI, not
 *    system Node's.
 * 3. It serves the same contract the renderer sees:
 *      - `GET  /mavis/health`          — liveness + CU state
 *      - `GET  /mavis/api/cu/status`    — CU gate snapshot
 *      - `PUT  /mavis/api/cu/enabled`   — flip the Computer Use gate
 *      - `POST /mavis/mcp/cu`           — MCP (JSON-RPC 2.0) over Streamable HTTP
 *
 * Usage
 * -----
 *   node scripts/minimax-cu-sidecar.mjs --prepare        # extract + verify deps
 *   node scripts/minimax-cu-sidecar.mjs --serve          # boot (foreground)
 *   node scripts/minimax-cu-sidecar.mjs --selftest       # boot + probe, then exit
 *
 *   CACHE_DIR   override the extraction cache (default ~/.minimax/cu-bridge)
 *   PORT        override the listen port (default: ephemeral, 127.0.0.1)
 *
 * Client note: the MCP transport requires BOTH accept types —
 *   Accept: application/json, text/event-stream
 * — and `initialize` before `tools/list`.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const APP = '/Applications/MiniMax Code.app';
const ASAR = path.join(APP, 'Contents/Resources/app.asar');
const ASAR_UNPACKED = path.join(APP, 'Contents/Resources/app.asar.unpacked');
const ELECTRON = path.join(APP, 'Contents/MacOS/MiniMax Code');
const CACHE_DIR = process.env.CACHE_DIR || path.join(os.homedir(), '.minimax/cu-bridge');
const SERVER_FILE = 'server.mjs';

const args = process.argv.slice(2);
const has = (f) => args.includes(f);

// ── asar reader ─────────────────────────────────────────────────────────────

/** Parse an asar header: 4-byte pickle payload sizes, then the JSON file tree. */
function readAsarIndex(asarPath) {
  const fd = fs.openSync(asarPath, 'r');
  try {
    const head = Buffer.alloc(8);
    fs.readSync(fd, head, 0, 8, 0);
    const headerSize = head.readUInt32LE(4);
    const hb = Buffer.alloc(headerSize);
    fs.readSync(fd, hb, 0, headerSize, 8);
    const jsonLen = hb.readUInt32LE(4);
    const tree = JSON.parse(hb.toString('utf8', 8, 8 + jsonLen));
    const files = {};
    (function walk(node, prefix) {
      for (const [name, ent] of Object.entries(node.files || {})) {
        const p = prefix + '/' + name;
        if (ent.files) walk(ent, p);
        else files[p] = ent;
      }
    })(tree, '');
    return { files, base: 8 + headerSize };
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Extract the app's node_modules into CACHE_DIR.
 * Every packed file is verified against the SHA-256 in the asar index; unpacked
 * files are copied from app.asar.unpacked. Idempotent — an existing,
 * already-verified tree is left alone.
 */
function prepare() {
  if (!fs.existsSync(ASAR)) throw new Error(`MiniMax Code not found at ${APP}`);
  const { files, base } = readAsarIndex(ASAR);
  const fd = fs.openSync(ASAR, 'r');
  let packed = 0;
  let unpacked = 0;
  let skipped = 0;
  try {
    for (const [p, ent] of Object.entries(files)) {
      if (!p.startsWith('/node_modules/')) continue;
      const dest = path.join(CACHE_DIR, p.slice(1));
      if (ent.unpacked) {
        const src = path.join(ASAR_UNPACKED, p.slice(1));
        if (!fs.existsSync(src)) { skipped++; continue; }
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(src, dest);
        unpacked++;
        continue;
      }
      if (ent.offset === undefined) { skipped++; continue; }
      const buf = Buffer.alloc(ent.size);
      fs.readSync(fd, buf, 0, ent.size, base + Number(ent.offset));
      const expected = ent.integrity && ent.integrity.hash;
      if (expected) {
        const actual = crypto.createHash('sha256').update(buf).digest('hex');
        if (actual !== expected) throw new Error(`integrity mismatch for ${p}`);
      }
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, buf);
      packed++;
    }
  } finally {
    fs.closeSync(fd);
  }
  return { packed, unpacked, skipped };
}

// ── the MCP sidecar server (runs under the app's Electron) ─────────────────

const SERVER_SOURCE = String.raw`
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const cacheDir = process.env.CACHE_DIR;
const lr = path.join(cacheDir, 'node_modules/@mavis/local-runtime/dist');
const { handleCuMcpRequest } = await import(pathToFileURL(path.join(lr, 'api/cu-mcp.js')).href);
const cu = await import(pathToFileURL(path.join(lr, 'services/cu/index.js')).href);

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const send = (code, obj) => {
    const b = Buffer.from(JSON.stringify(obj));
    res.writeHead(code, { 'content-type': 'application/json', 'content-length': b.length });
    res.end(b);
  };
  if (url.pathname === '/mavis/health') {
    return send(200, { status: 'ok', runtime: 'cu-sidecar', cu: cu.snapshot() });
  }
  if (url.pathname === '/mavis/api/cu/status') return send(200, cu.snapshot());
  if (url.pathname === '/mavis/api/cu/enabled' && req.method === 'PUT') {
    const body = JSON.parse((await readBody(req)).toString() || '{}');
    const r = cu.setEnabled(body.enabled !== false, body.workspaceDir);
    return send(200, { ok: true, ...r, snapshot: cu.snapshot() });
  }
  if (url.pathname === '/mavis/api/cu/abort' && req.method === 'POST') {
    return send(200, { ok: true, aborted: cu.abortAll('abort requested') });
  }
  if (url.pathname === '/mavis/mcp/cu') {
    const raw = await readBody(req);
    const headers = {};
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers[k] = v;
    const request = new Request('http://127.0.0.1/mavis/mcp/cu', {
      method: req.method,
      headers,
      ...(raw.length ? { body: raw } : {}),
    });
    const response = await handleCuMcpRequest(request);
    const buf = Buffer.from(await response.arrayBuffer());
    const outHeaders = {};
    response.headers.forEach((v, k) => { outHeaders[k] = v; });
    res.writeHead(response.status, outHeaders);
    res.end(buf);
    return;
  }
  send(404, { error: 'not found' });
});

const port = Number(process.env.PORT || 0);
server.listen(port, '127.0.0.1', () => {
  console.log('[cu-sidecar] listening on 127.0.0.1:' + server.address().port);
});
`;

function writeServerFile() {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const file = path.join(CACHE_DIR, SERVER_FILE);
  fs.writeFileSync(file, SERVER_SOURCE);
  return file;
}

/** Boot the sidecar under the app's Electron (ELECTRON_RUN_AS_NODE). */
function serve({ port = 0 } = {}) {
  const file = writeServerFile();
  const child = spawn(ELECTRON, [file], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      MAVIS_DATA_DIR: process.env.MAVIS_DATA_DIR || path.join(os.homedir(), '.minimax'),
      CACHE_DIR,
      PORT: String(port),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => process.stdout.write(`[cu-sidecar] ${d}`));
  child.stderr.on('data', (d) => {
    const s = String(d);
    if (!s.includes('codesign_util')) process.stderr.write(`[cu-sidecar] ${s}`);
  });
  return child;
}

async function waitForPort(child, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const line = await new Promise((resolve) => {
      const onData = (d) => { resolve(String(d)); };
      child.stdout.once('data', onData);
      setTimeout(() => resolve(''), 500);
    });
    const m = line.match(/listening on 127\.0\.0\.1:(\d+)/);
    if (m) return Number(m[1]);
    if (child.exitCode !== null) throw new Error('sidecar exited during startup');
  }
  throw new Error('sidecar did not report a port in time');
}

async function mcp(port, payload) {
  const res = await fetch(`http://127.0.0.1:${port}/mavis/mcp/cu`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify(payload),
  });
  return res.json();
}

async function selftest() {
  const child = serve();
  try {
    const port = await waitForPort(child);
    const init = await mcp(port, {
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'selftest', version: '1' } },
    });
    const list = await mcp(port, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    const tools = (list.result && list.result.tools) || [];
    await fetch(`http://127.0.0.1:${port}/mavis/api/cu/enabled`, {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled: true }),
    });
    const call = await mcp(port, {
      jsonrpc: '2.0', id: 3, method: 'tools/call',
      params: { name: 'desktop_cursor_position', arguments: {} },
    });
    const out = {
      port,
      serverInfo: init.result && init.result.serverInfo,
      toolCount: tools.length,
      nativeCallOk: !!(call.result && call.result.isError === false),
      nativeCall: (call.result && call.result.content && call.result.content[0] && call.result.content[0].text) || null,
    };
    console.log(JSON.stringify(out, null, 2));
    if (!out.nativeCallOk) process.exitCode = 1;
  } finally {
    child.kill('SIGKILL');
  }
}

// ── entrypoint ──────────────────────────────────────────────────────────────

if (!fs.existsSync(path.join(CACHE_DIR, 'node_modules/@mavis/local-runtime/package.json'))) {
  const stats = prepare();
  console.error(`[cu-sidecar] prepared cache at ${CACHE_DIR} (${stats.packed} packed, ${stats.unpacked} unpacked)`);
}

if (has('--prepare')) {
  const stats = prepare();
  console.log(JSON.stringify({ cacheDir: CACHE_DIR, ...stats }, null, 2));
} else if (has('--selftest')) {
  await selftest();
} else {
  serve({ port: Number(process.env.PORT || 0) });
}
