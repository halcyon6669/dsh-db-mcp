[English](clients.md) | 中文

# 接入其它客户端

Python 服务是一个标准 MCP 服务，DSH 只是它的一个客户端。这一页讲第二个客户端。

外部客户端能做什么、不能做什么，见 [safety.zh.md](safety.zh.md#哪些规则在-dsh-之外仍然生效) 里的表格。

## 接入其它客户端

Python 服务是标准 MCP stdio 服务，DSH 只是它的一个客户端。面板里的 **接入其它客户端** 标签会展示可用的连接地址，并替你把配置写进对方的配置文件。

默认地址是 `http://127.0.0.1:8765/dsh-db-mcp`，随插件启动；端口可在该标签里改，地址带复制按钮。如果 Windows 拒绝首选端口，服务会自动换到下一个可用端口，标签里显示实际地址。

**它只监听回环地址，而且没有鉴权。** 绑定地址写死为 `127.0.0.1`——启动动作只接受端口，不接受 host——所以别的机器连不上。但在本机上，任何能开 TCP 连接的进程都能调用 Python 服务发布的所有工具，包括 `execute_sql`。这就是本设计假定的信任边界，也正因如此，面板自己的请求才不需要 token。因此：不写数据时把全局写入开关关着，没有外部客户端连着时就在该标签里把端点停掉。只读标记与 DDL 开关对从这里进来的调用照样生效，因为两者都在 Python 服务里强制执行。

每个客户端一行有两个按钮——**写入 stdio** 和 **写入 HTTP**——由你选择传输方式，面板不再替你猜：

| 客户端 | 文件 | 配置段 |
| --- | --- | --- |
| Visual Studio Code | Windows `%APPDATA%\Code\User\mcp.json`、macOS `~/Library/Application Support/Code/User/mcp.json`、Linux `~/.config/Code/User/mcp.json` | `servers` |
| VS Code Insiders | 同上，目录换成 `Code - Insiders` | `servers` |
| Cursor | `~/.cursor/mcp.json` | `mcpServers` |
| JetBrains Air | `~/.jetbrains/mcp/mcp.json` | `mcpServers` |
| Claude Code | `~/.claude.json` | `mcpServers` |
| Claude Desktop | `%APPDATA%\Claude\claude_desktop_config.json` | `mcpServers` |
| Codex CLI | `~/.codex/config.toml` | `[mcp_servers.dsh-db-mcp]` |

**写入 stdio** 写入 `command` / `args` / `env` 条目（python + `server/main.py`），把本服务作为子进程启动，不需要监听端口，HTTP 端点停掉也能用。**写入 HTTP** 写入共享端点地址，需要先启动该端点——没启动时会报错并给出提示。两种方式写进同一个文件时会互相替换，已配置标签会显示当前是哪一种（`stdio` 按缩写惯例保持小写，`HTTP` 大写）。所有客户端读同一份 `datasources.json` 与 `secrets.json`，在面板里加的数据源不用在客户端里重填（但要让 MCP 服务重启一次才会读到）。

面板只列出「这个平台上确实有配置文件」的客户端，所以在 Linux 上不会出现 Claude Desktop，VS Code 的路径落在 `~/.config` 下。

只有一样东西是 DSH 专属、这些客户端拿不到：会话级访问限制（它依赖 DSH 的会话 id）。审计日志曾经也在这一列，现在不是了：HTTP 子进程自己记录调用，所以外部客户端的工具调用同样落在面板读的那份 `logs/audit.jsonl` 里。只读限制照旧生效，因为它写在 Python 里。

**工具** 标签里有一张 **AI 可用的工具** 卡片：一个工具一行、带开关。把开关关掉，插件就不再把它发布给模型，模型完全看不到它；Python 服务本身仍然通过 stdio/HTTP 提供这些工具，所以这个开关收窄的是 DSH 智能体的工具列表，而不是数据库的能力。`mcp__db__session_scope` 不在列表里：关掉它会让已经有范围限制的会话没法再解除限制。

其中两行右侧带一个小数字框：`sample_rows` 与 `execute_sql`，表示模型没指定行数时的默认值（出厂 `20` 与 `200`，上限 `200` 与 `2000`）。模型仍然可以按上限之内要更大的数字，所以这是默认值而不是硬限制——硬上限在 Python 服务里（`DB_MCP_MAX_ROWS_HARD`）。

想自己跑服务时，`server/main.py` 支持 `--stdio`（默认）、`--http`、`--sse`、`--host`、`--port`、`--path`（streamable-HTTP 路径，默认 `/dsh-db-mcp`），也认 `DB_MCP_TRANSPORT`、`DB_MCP_HOST`、`DB_MCP_PORT`、`DB_MCP_PATH`。
