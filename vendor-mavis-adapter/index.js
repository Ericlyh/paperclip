// @paperclipai/adapter-mavis-local
// Top-level entry: exports `createServerAdapter()` which the Paperclip
// hot-install endpoint (`POST /api/adapters/install`) calls to obtain
// a fully-formed `ServerAdapterModule` (type, execute, testEnvironment,
// listSkills, models, agentConfigurationDoc). The execute + helpers
// live in ./server.js.

import { execute, testEnvironment, listSkills } from "./server.js";

const MODEL = "minimax/MiniMax-M3";

export function createServerAdapter() {
  return {
    type: "mavis_local",
    label: "MiniMax Code (mavis daemon, local)",
    models: [{ id: MODEL, label: "MiniMax-M3 (default)" }],
    agentConfigurationDoc: `# mavis_local agent configuration

Adapter: mavis_local

Drives the mavis daemon (the engine behind MiniMax Code) via its CLI. The
daemon must be running on the host (typically at localhost:15321); this
adapter calls the \`mavis\` CLI, not its HTTP API.

Core fields:
- mmcAgent (string, optional): which mavis agent to use. One of: general, coder, verifier, mavis. Defaults to "general".
- mmcBin (string, optional): path to the mavis binary. Defaults to /Users/molt/.mavis/bin/MiniMax.
- timeoutSec (number, optional): run timeout in seconds (covers create + poll + reads). Defaults to 600 (10 min).
- pollIntervalMs (number, optional): how often to poll \`mavis session info <sid>\` while the daemon processes the task. Defaults to 3000.
- env (object, optional): KEY=VALUE environment variables for the mavis subprocess.

Notes:
- Spawn flow: \`mmcBin session new <mmcAgent> --from root --prompt <task>\` → poll until status=finished → read messages → return last assistant content.
- Cost event attribution: provider=minimax, model=MiniMax-M3. Set directly in the adapter (not parsed from the daemon's output).
- The mavis daemon's general agent is subject to a 5-hour Token Plan Starter quota (3M tokens). Heavy use may hit the cap; the daemon will return a 42212 error code on quota exhaustion.
- The adapter's cwd is the per-issue workspace (e.g. /paperclip/instances/default/projects/<projectId>/<issueId>/_default); the mavis subprocess inherits this and the agent sees it as the session workspace.
`,
    execute,
    testEnvironment,
    listSkills,
  };
}
