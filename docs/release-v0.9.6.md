## v0.9.6 — connect other agents from the panel, switch tools off

### Added

- **Streamable HTTP endpoint** at `http://127.0.0.1:8765/dsh-db-mcp`, started
  automatically with the plugin. The path follows `--path` / `DB_MCP_PATH`, and if
  8765 is taken the next free port is used.
- **Connect tab**: shows the endpoint and its port, starts and stops the service, and
  writes the MCP entry for VS Code, VS Code Insiders, Cursor, Claude Code, Claude
  Desktop and Codex in one click (HTTP for the editor/CLI clients, stdio for Claude
  Desktop and Codex).
- **Tools tab**: lists the nine agent tools with an individual switch, plus a default
  row count for `sample_rows` (20) and `execute_sql` (200). `mcp__db__session_scope`
  is deliberately not switchable — turning it off would strand a limited conversation.
- Python server accepts `--stdio` / `--http` / `--sse` / `--host` / `--port` /
  `--path`, with `DB_MCP_TRANSPORT`, `DB_MCP_HOST`, `DB_MCP_PORT` and `DB_MCP_PATH`
  as equivalents.

### Changed

- READMEs rewritten around the **import → shared registry → shared MCP server** story,
  each opening with a one-page map of the whole flow.
- New bilingual usage map (`asset/usage-guide.en.png`, `usage-guide.zh.png`) with an
  optional “point another agent at the same server” step.
- Docs: “Connect another agent” chapter, `/http/*` and `/clients` routes, and runtime
  requirements — **Node 22.5+** for the in-process SQLite probe, **Python 3.10+** for
  the bundled server (both floors come from the actual dependency metadata).

### Fixed

- The dependency list no longer touches its “Install / repair dependencies” button.
- The row-count fields are centred and align on one column.
- “Default row count saved.” now actually appears after saving a limit (it was posted
  as a bare string and rendered as an empty banner) and a failed save reports its error.
- The Connect tab only lists clients this platform can configure: VS Code paths resolve
  per OS (`APPDATA`, `~/Library/Application Support`, `~/.config`) and Claude Desktop
  is hidden where it does not exist.
- The client button says **Write config** instead of “Auto-configure” — it writes one
  file on click rather than silently configuring anything.

**Install:** `dsh plugin --profile desktop add dsh-db-mcp@0.9.6`
