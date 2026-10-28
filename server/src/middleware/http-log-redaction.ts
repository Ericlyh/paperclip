export const HTTP_LOG_REDACT_PATHS = [
  "req.headers.authorization",
  'req.headers["proxy-authorization"]',
  "req.headers.cookie",
  // "set-cookie" is normally a response header; keep the request-side
  // path as defensive coverage in case a proxy forwards it inbound.
  'req.headers["set-cookie"]',
  'res.headers["set-cookie"]',
  // Credential- and session-paired headers with no debugging value.
  'req.headers["x-csrf-token"]',
  'req.headers["x-xsrf-token"]',
  'req.headers["x-api-key"]',
  // Cloud proxy credentials authorize tenant access. The tenant token is a
  // shared secret minted by the cloud control plane, so it must never reach a
  // log line.
  'req.headers["x-paperclip-cloud-tenant-token"]',
  // Server-owned shared-secret headers. Each one unlocks a privileged read or
  // an outbound gateway call, so logging the value leaks the credential.
  'req.headers["x-paperclip-workspace-readiness-token"]',
  'req.headers["x-paperclip-tool-gateway-token"]',
  'req.headers["x-paperclip-dev-server-status-token"]',
] as const;
