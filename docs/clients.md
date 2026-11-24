English | [中文](clients.zh.md)

# Other clients

The Python server is a plain MCP server; DSH is one of its clients. This page covers the
second one you point at it.

For what an outside client is and is not allowed to do, see the table in
[safety.md](safety.md#which-rules-follow-you-out-of-dsh).

## Connect another agent

The Python server speaks MCP over stdio, so DSH is only one of the clients that can
use it. The **Connect** tab in the panel shows the address other agents can point at
and writes their configuration for you.

The endpoint is `http://127.0.0.1:8765/dsh-db-mcp` by default. It starts with the plugin, the
port can be changed in that tab, and the address has a copy button. If Windows refuses
the preferred port, the server moves to the next free one and the tab shows where it
landed.

**It listens on loopback and has no authentication.** The bind address is fixed at
`127.0.0.1` — the start action takes a port, never a host — so no other machine can
reach it. On this machine, though, any process that can open a TCP socket can call
every tool the Python server publishes, `execute_sql` included. That is the trust
boundary this design assumes, and it is the same one that lets the panel's own requests
through without a token. So: keep the global write switch closed while you are not
using writes, and stop the endpoint from that tab when no outside client is connected.
The read-only flag and the DDL switch still apply to everything that arrives
this way, because both are enforced in the Python server.

Each client row has two buttons — **Write stdio** and **Write HTTP** — so you
choose the transport instead of the panel guessing from the client's shape:

| Client | File | Section |
| --- | --- | --- |
| Visual Studio Code | `%USERPROFILE%\.copilot\mcp-config.json` (or `$COPILOT_HOME`) | `mcpServers` |
| Cursor | `~/.cursor/mcp.json` | `mcpServers` |
| JetBrains Air | `~/.jetbrains/mcp/mcp.json` | `mcpServers` |
| Claude Code | `~/.claude.json` | `mcpServers` |
| Claude Desktop | `%APPDATA%\Claude\claude_desktop_config.json` | `mcpServers` |
| Codex CLI | `~/.codex/config.toml` | `[mcp_servers.dsh-db-mcp]` |

VS Code 1.147 and newer hand MCP configuration to the Copilot harness, which reads
the Copilot CLI file above directly; both VS Code channels share it, so there is one
row for them. The older per-profile `mcp.json` is a deprecated destination: entries
left there still work through editor forwarding, but VS Code shows a **Migrate MCP
Server** banner on them, which is why this plugin no longer writes it — and writing
the Copilot file also removes any `dsh-db-mcp` entry left in those older files, so the
server is not registered twice. Other entries in them are left alone.

**Write stdio** writes a `command` / `args` / `env` entry (python + `server/main.py`)
that launches this server as a child process, so no listening port is needed and it
works even with the HTTP endpoint stopped. **Write HTTP** writes the shared
endpoint URL and needs that endpoint running — the button reports an error and a
hint if it is not. Writing one form replaces the other in the same file, and the
configured pill shows which form is currently in place (`stdio` stays lowercase,
`HTTP` is capitalised). Every client reads the
same `datasources.json` and `secrets.json`, so a source added in the panel shows up
everywhere without a restart of the client — only of the MCP server itself.

The Copilot entry carries `type` and `tools: ["*"]` because that file takes the
portable shape; the other JSON clients get the bare `command`/`url` entry.

The panel only lists a client when this platform has a configuration file for it,
so on Linux Claude Desktop is absent.

One rule is DSH-only and is **not** available to those clients: the per-conversation
limit (it keys off the DSH conversation id). The audit log used to be in that group and
no longer is: the HTTP child records its own calls, so an outside client's tool call
lands in the same `logs/audit.jsonl` the panel reads. Read-only enforcement still
applies, because it lives in Python.

The **Tools** tab shows **Tools the agent sees** — one row per tool with
a switch. Switching a tool off stops the plugin from publishing it, so the model never
sees it; the Python server still offers it over stdio/HTTP, which means the switch trims
the DSH agent's tool list rather than the database's capabilities. `mcp__db__session_scope`
is not on the list: switching it off would strand a conversation that already has a limit.

Two rows carry a small number box: `sample_rows` and `execute_sql`. It is the row count the
agent gets when it does not ask for one (`20` and `200` out of the box, capped at `200` and
`2000`). The model can still pass a larger number up to that cap, so this is a default, not
a hard limit — the hard cap lives in the Python server (`DB_MCP_MAX_ROWS_HARD`).

To run the server yourself, `server/main.py` accepts `--stdio` (default), `--http`,
`--sse`, `--host`, `--port` and `--path` (the streamable-HTTP path, `/dsh-db-mcp` by
default), and the same values through `DB_MCP_TRANSPORT`, `DB_MCP_HOST`, `DB_MCP_PORT`
and `DB_MCP_PATH`.
