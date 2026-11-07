/**
 * dsh-db-mcp — Client half.
 *
 * A plain browser bundle loaded through window.__ModuleLoader__ (same shape as
 * the skill's UI template): no imports of Harness client packages, no iframes,
 * no DOM work outside the component tree, styles from --dsw-alias-* tokens only.
 *
 * The panel owns the data-source registry: create, edit, test, delete, and an
 * importer that reads DBeaver's workspace files. Querying is never done here —
 * the agent reaches these sources through the Python MCP server (P3).
 */
window.__ModuleLoader__.load({
  id: 'dsh-db-mcp',
  factory(require) {
    'use strict'

    const React = require('react')
    const h = React.createElement

    const NS = 'db-mcp'
    const API = '/plugins/db-mcp/api'
    const KINDS = ['sqlite', 'postgres', 'mysql', 'oracle']
    const DEFAULT_PORTS = { postgres: '5432', mysql: '3306', oracle: '1521' }

    /** Set by apply(); bind() reads the active locale at call time, so only the
     *  re-render subscription has to live on the component side. */
    let localeService = null

    const DICT = {
      en: {
        'panel.title': 'Database',
        'panel.subtitle': 'Manage the database connections this agent can reach through MCP tools.',
        'action.refresh': 'Refresh',
        'action.restartMcp': 'Restart MCP',
        'action.restartMcpHint': 'Restart the Python MCP server and re-publish its tools',
        'action.new': 'New data source',
        'action.import': 'Import from DBeaver',
        'action.save': 'Save',
        'action.saving': 'Saving…',
        'action.cancel': 'Cancel',
        'action.edit': 'Edit',
        'action.test': 'Test',
        'action.testing': 'Testing…',
        'action.delete': 'Delete',
        'action.deleteConfirm': 'Delete for real',
        'action.makeDefault': 'Make default',
        'action.importSelected': 'Import selected',
        'action.importing': 'Importing…',
        'state.connected': 'connected',
        'state.failed': 'failed',
        'state.loading': 'checking…',
        'python.missing': 'no python on PATH',
        'loading': 'Checking the Host…',
        'error.title': 'Host API unreachable',
        'error.retry': 'Retry',
        'notice.saved': 'Saved {name}.',
        'notice.deleted': 'Removed {name}.',
        'notice.default': '{name} is now the default source.',
        'notice.imported': 'Imported {n} data source(s).',
        'notice.probeOk': '{name}: connection OK ({ms} ms).',
        'notice.probeFail': '{name}: {message}',
        'notice.mcpReady': 'MCP server is up with {count} tool(s).',
        'sources.title': 'Data sources',
        'sources.count': '{n} configured',
        'sources.empty.title': 'No data source yet',
        'sources.empty.body': 'Add one here, or import the connections DBeaver already keeps on this machine. The agent queries real data through MCP tools, never through this page.',
        'sources.readonly': 'read-only',
        'sources.readwrite': 'writable',
        'sources.default': 'default',
        'sources.hasPassword': 'password saved',
        'sources.noPassword': 'no password',
        'sources.neverProbed': 'never tested',
        'form.new': 'New data source',
        'form.edit': 'Edit {name}',
        'form.name': 'Display name',
        'form.id': 'Identifier',
        'form.idHint': 'lowercase letters, digits and dashes; used by MCP tools and never changes',
        'form.paste': 'Connection string',
        'form.pasteHintShort':
          'Paste a JDBC URL, a DSN or the path of a .db file. Type, host, port, database and the identifier are derived from it.',
        'form.savePassword': 'Save password',
        'form.more': 'More settings',
        'form.pasteHintEdit': 'Paste a new connection string to overwrite the fields below; the identifier stays fixed.',
        'form.pastePlaceholder': 'postgresql://user:pass@localhost:5432/app',
        'form.parseOk': 'recognized',
        'form.parseBad': 'not recognized',
        'form.optional': 'optional',
        'form.sidHint': 'only for the old SID style; wins over the service name when filled',
        'form.untitled': 'Untitled source',
        'form.kind': 'Type',
        'form.file': 'SQLite file',
        'form.fileHint': 'absolute path, for example C:\\data\\app.db',
        'form.host': 'Host',
        'form.port': 'Port',
        'form.database': 'Database',
        'form.user': 'User',
        'form.schema': 'Default schema',
        'form.schemaHint': "Empty uses the connection user's own schema.",
        'form.charset': 'Charset',
        'form.sslMode': 'SSL mode',
        'form.serviceName': 'Service name',
        'form.sid': 'SID',
        'form.password': 'Password',
        'form.passwordKeep': 'leave blank to keep the stored password',
        'form.passwordEmpty': 'no password stored yet',
        'form.readOnly': 'Read-only (recommended)',
        'form.readOnlyHint': 'blocks writes for this source unless the global write switch is on',
        'form.invalid': 'Fill the required fields first.',
        'import.title': 'Import from DBeaver',
        'import.body': 'Reads data-sources.json from the DBeaver workspace and decrypts credentials-config.json when it exists.',
        'import.empty': 'No DBeaver connection found on this machine.',
        'import.file': 'File',
        'import.credentialsFound': 'found and decrypted',
        'import.credentialsMissing': 'not present — the password has to be typed in manually later',
        'diag.title': 'Runtime diagnostics',
        'diag.hostApi': 'Host API',
        'diag.node': 'Node',
        'diag.plugin': 'Plugin',
        'diag.python': 'Python',
        'diag.runtimeDir': 'Runtime dir',
        'diag.registry': 'Registry file',
        'diag.sources': 'Data sources',
        'diag.mcp': 'MCP server',
        'diag.mcpPending': 'not wired yet',
        'diag.mcpLive': '{count} tool(s) live',
        'diag.mcpFailed': 'failed:',
        'diag.uptime': 'Host uptime',
        'diag.tip': 'Tip',
        'diag.restartNeeded': 'Restart the DSH desktop app once — the plugin entry is imported at process start, so the tool bridge only activates after a restart.',
        'diag.write': 'Global write access',
        'diag.writeOn': 'on — a source must still allow writes itself',
        'diag.writeOff': 'off — every write statement is refused',
        'diag.venv': 'Python venv',
        'diag.packages': 'Python packages',
        'diag.venvMissing': 'not created yet',
        'diag.venvHint': 'One click creates <runtime>/.venv and installs server/requirements.txt with that interpreter.',
        'action.installDeps': 'Install / repair deps',
        'action.installing': 'Installing…',
        'notice.depsOk': 'Dependencies are installed.',
        'notice.depsFail': 'Dependency install failed — see the diagnostics output.',
        'notice.writeOn': 'Global writes are on. Sources still stay read-only until you clear their own flag.',
        'notice.writeOff': 'Global writes are off. Every write statement is refused.',
        'audit.title': 'Audit log',
        'audit.empty': 'No tool call has been recorded yet.',
        'audit.file': 'Log file',
        'audit.ok': 'ok',
        'audit.err': 'failed',
        'audit.hint': 'One line per MCP tool call: tool, source, duration and outcome. Query results are never logged.',
        'audit.rows': '{n} row(s)',
        'action.schema': 'Structure',
        'schema.title': 'Structure of {name}',
        'schema.tables': 'Tables ({n})',
        'schema.pick': 'Pick a table on the left to see its columns.',
        'schema.empty': 'This source reports no table.',
        'schema.loading': 'Reading the catalog…',
        'schema.error': 'Could not read the catalog.',
        'schema.column': 'Column',
        'schema.type': 'Type',
        'schema.nullable': 'Null',
        'schema.default': 'Default',
        'schema.pk': 'PK',
        'schema.yes': 'yes',
        'schema.no': 'no',
        'schema.columns': '{n} column(s)',
        'schema.readonlyNote': 'Read-only view: this page never runs SQL.',
      },
      zh: {
        'panel.title': '数据库',
        'panel.subtitle': '管理 AI 可以通过 MCP 工具访问的数据库连接。',
        'action.refresh': '刷新',
        'action.restartMcp': '重启 MCP',
        'action.restartMcpHint': '重启 Python MCP 服务并重新发布工具',
        'action.new': '新建数据源',
        'action.import': '从 DBeaver 导入',
        'action.save': '保存',
        'action.saving': '保存中…',
        'action.cancel': '取消',
        'action.edit': '编辑',
        'action.test': '测试',
        'action.testing': '测试中…',
        'action.delete': '删除',
        'action.deleteConfirm': '确认删除',
        'action.makeDefault': '设为默认',
        'action.importSelected': '导入所选',
        'action.importing': '导入中…',
        'state.connected': '已连接',
        'state.failed': '失败',
        'state.loading': '检查中…',
        'python.missing': 'PATH 上未找到 python',
        'loading': '正在检查 Host…',
        'error.title': '无法访问 Host 接口',
        'error.retry': '重试',
        'notice.saved': '已保存 {name}。',
        'notice.deleted': '已删除 {name}。',
        'notice.default': '{name} 已设为默认数据源。',
        'notice.imported': '已导入 {n} 个数据源。',
        'notice.probeOk': '{name}：连接正常（{ms} ms）。',
        'notice.probeFail': '{name}：{message}',
        'notice.mcpReady': 'MCP 服务已就绪，共 {count} 个工具。',
        'sources.title': '数据源',
        'sources.count': '已配置 {n} 个',
        'sources.empty.title': '还没有数据源',
        'sources.empty.body': '可以在这里新增，也可以直接导入这台机器上 DBeaver 已有的连接。AI 通过 MCP 工具查询真实数据，不会在这个页面里执行 SQL。',
        'sources.readonly': '只读',
        'sources.readwrite': '可写',
        'sources.default': '默认',
        'sources.hasPassword': '已存密码',
        'sources.noPassword': '无密码',
        'sources.neverProbed': '尚未测试',
        'form.new': '新建数据源',
        'form.edit': '编辑 {name}',
        'form.name': '显示名称',
        'form.id': '标识符',
        'form.idHint': '小写字母、数字和短横线，供 MCP 工具引用，创建后不可修改',
        'form.paste': '连接串',
        'form.pasteHintShort': '粘贴 JDBC URL、DSN 或 .db 文件路径，类型、主机、端口、库名和标识符都会自动带出。',
        'form.savePassword': '保存密码',
        'form.more': '更多设置',
        'form.pasteHintEdit': '粘贴新的连接串会覆盖下面的字段；标识符保持不变。',
        'form.pastePlaceholder': 'postgresql://用户:密码@localhost:5432/库名',
        'form.parseOk': '已识别',
        'form.parseBad': '无法识别',
        'form.optional': '可选',
        'form.sidHint': '仅老式 SID 连接需要；填了会优先用 SID',
        'form.untitled': '未命名数据源',
        'form.kind': '类型',
        'form.file': 'SQLite 文件',
        'form.fileHint': '绝对路径，例如 C:\\data\\app.db',
        'form.host': '主机',
        'form.port': '端口',
        'form.database': '数据库',
        'form.user': '用户',
        'form.schema': '默认模式',
        'form.schemaHint': '不填则用连接用户自己的模式（Oracle 里模式就是用户）',
        'form.charset': '字符集',
        'form.sslMode': 'SSL 模式',
        'form.serviceName': '服务名',
        'form.sid': 'SID',
        'form.password': '口令',
        'form.passwordKeep': '留空表示保留已存口令',
        'form.passwordEmpty': '尚未保存口令',
        'form.readOnly': '只读（推荐）',
        'form.readOnlyHint': '未打开全局写开关时，此数据源拒绝写操作',
        'form.invalid': '请先填写必填字段。',
        'import.title': '从 DBeaver 导入',
        'import.body': '读取 DBeaver 工作区里的 data-sources.json；存在 credentials-config.json 时一并解密口令。',
        'import.empty': '这台机器上没有找到 DBeaver 连接。',
        'import.file': '文件',
        'import.credentialsFound': '已找到并解密',
        'import.credentialsMissing': '不存在——口令需要稍后手动填写',
        'diag.title': '运行时诊断',
        'diag.hostApi': 'Host 接口',
        'diag.node': 'Node',
        'diag.plugin': '插件',
        'diag.python': 'Python',
        'diag.runtimeDir': '运行时目录',
        'diag.registry': '注册表文件',
        'diag.sources': '数据源数量',
        'diag.mcp': 'MCP 服务名',
        'diag.mcpPending': '尚未接入',
        'diag.mcpLive': '{count} 个工具已就绪',
        'diag.mcpFailed': '启动失败：',
        'diag.uptime': 'Host 已运行',
        'diag.tip': '提示',
        'diag.restartNeeded': '需要重启一次 DSH 桌面应用：插件入口只在进程启动时导入，重启后工具桥接才会生效。',
        'diag.write': '全局写权限',
        'diag.writeOn': '已开启（单个数据源仍须自己允许写）',
        'diag.writeOff': '已关闭（所有写语句都会被拒绝）',
        'diag.venv': 'Python 虚拟环境',
        'diag.packages': 'Python 依赖',
        'diag.venvMissing': '尚未创建',
        'diag.venvHint': '一键在 <运行时目录>/.venv 建虚拟环境，并用它安装 server/requirements.txt。',
        'action.installDeps': '安装 / 修复依赖',
        'action.installing': '正在安装…',
        'notice.depsOk': '依赖已安装。',
        'notice.depsFail': '依赖安装失败，见诊断信息。',
        'notice.writeOn': '全局写权限已开启。数据源仍保持只读，直到你取消它自己的只读勾选。',
        'notice.writeOff': '全局写权限已关闭。所有写语句都会被拒绝。',
        'audit.title': '审计日志',
        'audit.empty': '还没有工具调用记录。',
        'audit.file': '日志文件',
        'audit.ok': '成功',
        'audit.err': '失败',
        'audit.hint': '每次 MCP 工具调用记一行：工具、数据源、耗时与结果。查询结果不会被记录。',
        'audit.rows': '{n} 行',
        'action.schema': '结构',
        'schema.title': '{name} 的结构',
        'schema.tables': '表（{n}）',
        'schema.pick': '在左侧选一张表查看它的列。',
        'schema.empty': '这个数据源没有返回任何表。',
        'schema.loading': '正在读取结构…',
        'schema.error': '读取结构失败。',
        'schema.column': '列名',
        'schema.type': '类型',
        'schema.nullable': '可空',
        'schema.default': '默认值',
        'schema.pk': '主键',
        'schema.yes': '是',
        'schema.no': '否',
        'schema.columns': '{n} 列',
        'schema.readonlyNote': '只读视图：这个页面不会执行任何 SQL。',
      },
    }

    const CSS = `
      .dbmcp-page {
        height: 100%;
        overflow: auto;
        box-sizing: border-box;
        padding: 24px 28px 40px;
        color: var(--dsw-alias-label-primary);
        background: var(--dsw-alias-bg-base);
        font: inherit;
      }
      .dbmcp-head h1 {
        margin: 0;
        font-size: 18px;
        font-weight: 600;
        line-height: 1.4;
        letter-spacing: 0.01em;
      }
      .dbmcp-sub {
        margin: 6px 0 0;
        font-size: 13px;
        line-height: 1.6;
        color: var(--dsw-alias-label-secondary);
      }
      .dbmcp-toolbar {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 10px;
        margin: 18px 0;
      }
      .dbmcp-crumbs {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 8px;
        margin: 14px 0 0;
        font-size: 13px;
      }
      .dbmcp-crumb {
        appearance: none;
        border: 0;
        background: none;
        padding: 0;
        font: inherit;
        color: var(--dsw-alias-brand-primary);
        cursor: pointer;
        border-radius: 4px;
      }
      .dbmcp-crumb:hover {
        text-decoration: underline;
      }
      .dbmcp-crumb.is-current {
        color: var(--dsw-alias-label-primary);
        cursor: default;
        font-weight: 500;
        text-decoration: none;
      }
      .dbmcp-crumb-sep {
        color: var(--dsw-alias-label-secondary);
      }
      .dbmcp-schema-head {
        margin-bottom: 10px;
      }
      .dbmcp-btn {
        appearance: none;
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 8px;
        background: var(--dsw-alias-bg-layer-2);
        color: var(--dsw-alias-label-primary);
        font: inherit;
        font-size: 13px;
        padding: 6px 14px;
        cursor: pointer;
      }
      .dbmcp-btn:hover {
        border-color: var(--dsw-alias-border-l2);
      }
      .dbmcp-btn:disabled {
        opacity: 0.6;
        cursor: default;
      }
      .dbmcp-btn.is-primary {
        border-color: var(--dsw-alias-brand-primary);
        color: var(--dsw-alias-brand-primary);
      }
      .dbmcp-btn.is-danger {
        border-color: var(--dsw-alias-state-error-primary);
        color: var(--dsw-alias-state-error-primary);
      }
      .dbmcp-btn.is-small {
        font-size: 12px;
        padding: 3px 9px;
        border-radius: 7px;
      }
      .dbmcp-pill {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 999px;
        padding: 2px 9px;
        font-size: 12px;
        color: var(--dsw-alias-label-secondary);
      }
      .dbmcp-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
        gap: 16px;
        align-items: start;
      }
      .dbmcp-card {
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 12px;
        background: var(--dsw-alias-bg-layer-1);
        padding: 16px 18px 18px;
        min-width: 0;
      }
      .dbmcp-audit-list {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .dbmcp-audit {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 8px;
        padding: 8px 0;
        border-top: 1px solid var(--dsw-alias-border-l1);
        font-size: 13px;
        min-width: 0;
      }
      .dbmcp-audit:first-child {
        border-top: none;
        padding-top: 0;
      }
      .dbmcp-audit-time {
        color: var(--dsw-alias-label-secondary);
        font-variant-numeric: tabular-nums;
        font-size: 12px;
      }
      .dbmcp-audit-tool {
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 12px;
        color: var(--dsw-alias-label-primary);
      }
      .dbmcp-audit-ok {
        font-size: 12px;
      }
      .dbmcp-audit-ok.is-ok {
        color: var(--dsw-alias-state-success-primary);
      }
      .dbmcp-audit-ok.is-error {
        color: var(--dsw-alias-state-error-primary);
      }
      .dbmcp-audit-sql {
        display: block;
        width: 100%;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        font-size: 12px;
        color: var(--dsw-alias-label-secondary);
      }
      .dbmcp-audit-sql.is-error {
        color: var(--dsw-alias-state-error-primary);
      }
      .dbmcp-schema-wrap {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .dbmcp-schema {
        display: grid;
        grid-template-columns: minmax(160px, 220px) minmax(0, 1fr);
        gap: 18px;
        align-items: start;
      }
      .dbmcp-schema-side {
        display: flex;
        flex-direction: column;
        gap: 8px;
        min-width: 0;
      }
      .dbmcp-schema-main {
        min-width: 0;
      }
      .dbmcp-schema-head {
        display: flex;
        align-items: baseline;
        gap: 10px;
        font-size: 12px;
        font-weight: 600;
        color: var(--dsw-alias-label-secondary);
      }
      .dbmcp-schema-tables {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 2px;
        max-height: 420px;
        overflow: auto;
      }
      .dbmcp-schema-table {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        width: 100%;
        padding: 6px 8px;
        border: 1px solid transparent;
        border-radius: 6px;
        background: transparent;
        color: var(--dsw-alias-label-primary);
        font: inherit;
        font-size: 13px;
        text-align: left;
        cursor: pointer;
      }
      .dbmcp-schema-table:hover {
        background: var(--dsw-alias-bg-layer-2);
      }
      .dbmcp-schema-table.is-active {
        border-color: var(--dsw-alias-brand-primary);
        background: var(--dsw-alias-bg-layer-2);
      }
      .dbmcp-schema-tablegrid {
        width: 100%;
        border-collapse: collapse;
        font-size: 13px;
        margin-top: 6px;
      }
      .dbmcp-schema-tablegrid th,
      .dbmcp-schema-tablegrid td {
        text-align: left;
        padding: 6px 8px;
        border-bottom: 1px solid var(--dsw-alias-border-l1);
        vertical-align: top;
      }
      .dbmcp-schema-tablegrid th {
        font-weight: 600;
        font-size: 12px;
        color: var(--dsw-alias-label-secondary);
      }
      .dbmcp-schema-note {
        margin-top: 10px;
      }
      .dbmcp-mono {
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 12px;
      }
      .dbmcp-card-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        margin-bottom: 12px;
      }
      .dbmcp-card-title {
        margin: 0;
        font-size: 13px;
        font-weight: 600;
      }
      .dbmcp-empty {
        padding: 26px 10px;
        text-align: center;
        color: var(--dsw-alias-label-secondary);
        font-size: 13px;
        line-height: 1.7;
      }
      .dbmcp-empty strong {
        display: block;
        margin-bottom: 6px;
        color: var(--dsw-alias-label-primary);
        font-weight: 600;
      }
      .dbmcp-empty p {
        margin: 0 auto;
        max-width: 34em;
      }
      .dbmcp-rows {
        display: grid;
        grid-template-columns: 104px minmax(0, 1fr);
        row-gap: 10px;
        column-gap: 12px;
        font-size: 13px;
        line-height: 1.5;
      }
      .dbmcp-k {
        color: var(--dsw-alias-label-secondary);
      }
      .dbmcp-v {
        color: var(--dsw-alias-label-primary);
        word-break: break-all;
      }
      .dbmcp-dot {
        display: inline-block;
        width: 6px;
        height: 6px;
        border-radius: 50%;
        margin-right: 6px;
        background: var(--dsw-alias-state-idle-primary);
      }
      .dbmcp-dot.is-ok {
        background: var(--dsw-alias-state-success-primary);
      }
      .dbmcp-dot.is-error {
        background: var(--dsw-alias-state-error-primary);
      }
      .dbmcp-error {
        border: 1px solid var(--dsw-alias-state-error-primary);
        border-radius: 12px;
        padding: 16px 18px;
        color: var(--dsw-alias-label-primary);
        font-size: 13px;
        line-height: 1.6;
      }
      .dbmcp-error code {
        display: block;
        margin: 8px 0 12px;
        color: var(--dsw-alias-label-secondary);
        font-size: 12px;
        word-break: break-all;
      }
      .dbmcp-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin: 0;
        padding: 0;
        list-style: none;
      }
      .dbmcp-item {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 12px;
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 10px;
        background: var(--dsw-alias-bg-layer-2);
        padding: 10px 12px;
        font-size: 13px;
      }
      .dbmcp-item-main {
        min-width: 0;
        flex: 1 1 auto;
      }
      .dbmcp-item-name {
        display: flex;
        align-items: center;
        gap: 8px;
        font-weight: 600;
        flex-wrap: wrap;
      }
      .dbmcp-item-target {
        color: var(--dsw-alias-label-secondary);
        font-size: 12px;
        word-break: break-all;
        margin-top: 2px;
      }
      .dbmcp-item-actions {
        display: flex;
        align-items: center;
        gap: 6px;
        flex-wrap: wrap;
        justify-content: flex-end;
      }
      .dbmcp-probe {
        margin-top: 6px;
        font-size: 12px;
        color: var(--dsw-alias-label-secondary);
      }
      .dbmcp-probe.is-ok {
        color: var(--dsw-alias-state-success-primary);
      }
      .dbmcp-probe.is-error {
        color: var(--dsw-alias-state-error-primary);
      }
      .dbmcp-notice {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 10px;
        padding: 9px 12px;
        margin-bottom: 12px;
        font-size: 13px;
        background: var(--dsw-alias-bg-layer-2);
      }
      .dbmcp-notice.is-error {
        border-color: var(--dsw-alias-state-error-primary);
      }
      .dbmcp-form {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
        gap: 12px 16px;
        align-items: start;
        font-size: 13px;
      }
      .dbmcp-form.is-compact {
        grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
        gap: 14px 18px;
        max-width: 860px;
      }
      .dbmcp-form.is-compact .dbmcp-paste .dbmcp-check {
        flex: none;
        white-space: nowrap;
        font-size: 12px;
        color: var(--dsw-alias-label-secondary);
      }
      .dbmcp-cell {
        display: flex;
        flex-direction: column;
        gap: 4px;
        min-width: 0;
      }
      .dbmcp-cell.dbmcp-wide {
        grid-column: 1 / -1;
      }
      .dbmcp-label {
        color: var(--dsw-alias-label-secondary);
        font-size: 12px;
        line-height: 1.4;
      }
      .dbmcp-paste {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .dbmcp-paste .dbmcp-input {
        flex: 1 1 auto;
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 12px;
      }
      .dbmcp-parse {
        flex: none;
        font-size: 12px;
        white-space: nowrap;
      }
      .dbmcp-parse.is-ok {
        color: var(--dsw-alias-state-success-primary);
      }
      .dbmcp-parse.is-bad {
        color: var(--dsw-alias-state-warn-primary);
      }
      .dbmcp-advanced {
        grid-column: 1 / -1;
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 8px;
        background: var(--dsw-alias-bg-layer-2);
        padding: 8px 12px 12px;
      }
      .dbmcp-advanced > summary {
        cursor: pointer;
        font-size: 12px;
        color: var(--dsw-alias-label-secondary);
        padding: 2px 0;
      }
      .dbmcp-advanced[open] > summary {
        margin-bottom: 10px;
      }
      .dbmcp-input,
      .dbmcp-select {
        width: 100%;
        box-sizing: border-box;
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 8px;
        background: var(--dsw-alias-bg-base);
        color: var(--dsw-alias-label-primary);
        font: inherit;
        font-size: 13px;
        padding: 6px 9px;
      }
      .dbmcp-input:focus,
      .dbmcp-select:focus {
        outline: none;
        border-color: var(--dsw-alias-brand-primary);
      }
      .dbmcp-hint {
        font-size: 12px;
        color: var(--dsw-alias-label-secondary);
        line-height: 1.4;
      }
      .dbmcp-check {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 13px;
      }
      .dbmcp-form-foot {
        grid-column: 1 / -1;
        display: flex;
        align-items: center;
        gap: 10px;
        margin-top: 8px;
      }
      .dbmcp-scan {
        display: flex;
        flex-direction: column;
        gap: 14px;
      }
      .dbmcp-scan-file {
        font-size: 12px;
        color: var(--dsw-alias-label-secondary);
        word-break: break-all;
      }
    `

    /** Re-render on locale switch / late dictionary registration. */
    function useLocale() {
      const service = localeService
      const subscribe = React.useCallback(
        (onChange) => (typeof service?.subscribe === 'function' ? service.subscribe(onChange) : () => {}),
        [service],
      )
      const getSnapshot = React.useCallback(
        () => (typeof service?.getSnapshot === 'function' ? service.getSnapshot() : 0),
        [service],
      )
      React.useSyncExternalStore(subscribe, getSnapshot)
      return service
    }

    function fmt(text, values) {
      return String(text).replace(/\{(\w+)\}/g, (all, key) => (values && values[key] !== undefined ? String(values[key]) : all))
    }

    async function apiGet(path) {
      const response = await fetch(API + path, { credentials: 'same-origin', headers: { accept: 'application/json' } })
      const data = await response.json().catch(() => null)
      if (!response.ok || !data) {
        const payload = data || null
        const message = (payload && (payload.error || payload.message)) || `HTTP ${response.status}`
        const error = new Error(String(message))
        error.payload = payload
        throw error
      }
      return data
    }

    async function apiPost(path, body) {
      const response = await fetch(API + path, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify(body || {}),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok || !data) {
        const message = (data && data.error) || `HTTP ${response.status}`
        const error = new Error(message)
        error.payload = data
        throw error
      }
      return data
    }

    /** Sidebar icon: a stacked-database glyph drawn with currentColor. */
    function SidebarIcon(props) {
      const size = props && typeof props.size === 'number' ? props.size : 20
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.6,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
          focusable: 'false',
        },
        h('ellipse', { cx: 12, cy: 5.5, rx: 7.5, ry: 3 }),
        h('path', { d: 'M4.5 5.5v6c0 1.66 3.36 3 7.5 3s7.5-1.34 7.5-3v-6' }),
        h('path', { d: 'M4.5 11.5v6c0 1.66 3.36 3 7.5 3s7.5-1.34 7.5-3v-6' }),
      )
    }

    function Card(props) {
      return h(
        'section',
        { className: 'dbmcp-card' },
        h(
          'header',
          { className: 'dbmcp-card-head' },
          h('h2', { className: 'dbmcp-card-title' }, props.title),
          props.aside == null ? null : h('span', { className: 'dbmcp-pill' }, props.aside),
        ),
        props.children,
      )
    }

    /** Two grid cells: label + value. */
    function Row(props) {
      return [
        h('span', { key: 'k', className: 'dbmcp-k' }, props.label),
        h('span', { key: 'v', className: 'dbmcp-v' }, props.children),
      ]
    }

    function Field(props) {
      return h(
        'div',
        { className: 'dbmcp-cell' + (props.wide ? ' dbmcp-wide' : '') },
        h('label', { className: 'dbmcp-label' }, props.label),
        props.children,
        props.hint ? h('div', { className: 'dbmcp-hint' }, props.hint) : null,
      )
    }

    function TextInput(props) {
      return h('input', {
        className: 'dbmcp-input',
        type: props.type || 'text',
        value: props.value == null ? '' : props.value,
        placeholder: props.placeholder || '',
        autoComplete: props.autoComplete || 'off',
        autoFocus: props.autoFocus === true,
        spellCheck: false,
        disabled: props.disabled === true,
        onChange: (event) => props.onChange(event.target.value),
      })
    }

    function stripQuotes(value) {
      return String(value == null ? '' : value).trim().replace(/^["']|["']$/g, '')
    }

    function slugId(value) {
      return String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 32)
    }

    function baseConfig(kind) {
      return {
        file: '',
        host: kind === 'sqlite' ? '' : 'localhost',
        port: DEFAULT_PORTS[kind] || '',
        database: '',
        user: '',
        schema: '',
        serviceName: '',
        sid: '',
        charset: kind === 'mysql' ? 'utf8mb4' : '',
        sslMode: '',
      }
    }

    function fileStem(file) {
      const name = String(file || '').split(/[\\/]/).pop() || ''
      return name.replace(/\.(db|sqlite3?|db3)$/i, '')
    }

    function decodePart(value) {
      try {
        return decodeURIComponent(value || '')
      } catch (error) {
        return String(value || '')
      }
    }

    function parseQueryString(search) {
      const out = {}
      const text = String(search || '').replace(/^\?/, '')
      if (!text) return out
      text.split('&').forEach((pair) => {
        if (!pair) return
        const index = pair.indexOf('=')
        const key = decodePart(index < 0 ? pair : pair.slice(0, index)).trim().toLowerCase()
        if (!key) return
        out[key] = index < 0 ? '' : decodePart(pair.slice(index + 1))
      })
      return out
    }

    function fromUrl(kind, body) {
      let url
      try {
        url = new URL('db:' + (body.startsWith('//') ? body : '//' + body))
      } catch (error) {
        return { ok: false, code: 'url' }
      }
      const query = parseQueryString(url.search)
      const database = decodePart(url.pathname.replace(/^\/+/, ''))
      const config = baseConfig(kind)
      config.host = url.hostname || 'localhost'
      config.port = url.port || DEFAULT_PORTS[kind] || ''
      config.user = decodePart(url.username) || query.user || query.username || ''
      if (kind === 'oracle') {
        config.serviceName = database || query.servicename || query.service || ''
        config.sid = query.sid || ''
      } else {
        config.database = database || query.database || query.dbname || ''
      }
      if (query.sslmode) config.sslMode = query.sslmode
      if (query.charset || query.characterencoding) config.charset = query.charset || query.characterencoding
      if (query.schema || query.currentschema || query.searchpath) {
        config.schema = query.schema || query.currentschema || query.searchpath
      }
      const password = decodePart(url.password)
      const name = kind === 'oracle' ? config.serviceName || config.sid : config.database || config.host
      return { ok: true, kind, config, password, name: name || kind }
    }

    function parseTns(text) {
      const config = baseConfig('oracle')
      const host = /\(\s*HOST\s*=\s*([^)]+)\)/i.exec(text)
      const port = /\(\s*PORT\s*=\s*([^)]+)\)/i.exec(text)
      const service = /\(\s*SERVICE_NAME\s*=\s*([^)]+)\)/i.exec(text)
      const sid = /\(\s*SID\s*=\s*([^)]+)\)/i.exec(text)
      config.host = host ? host[1].trim() : 'localhost'
      config.port = port ? port[1].trim() : '1521'
      config.serviceName = service ? service[1].trim() : ''
      config.sid = sid ? sid[1].trim() : ''
      if (!config.serviceName && !config.sid) return { ok: false, code: 'tns' }
      return { ok: true, kind: 'oracle', config, password: '', name: config.serviceName || config.sid }
    }

    function parseOracleThin(text) {
      const body = String(text || '').replace(/^@/, '').trim()
      const config = baseConfig('oracle')
      if (body.startsWith('//')) {
        const match = /^\/\/([^/:]+)(?::(\d+))?\/(.+)$/.exec(body)
        if (!match) return { ok: false, code: 'url' }
        config.host = match[1]
        config.port = match[2] || '1521'
        config.serviceName = match[3].split(/[?#]/)[0]
      } else {
        const match = /^([^:]+)(?::(\d+))?:(.+)$/.exec(body)
        if (!match) return { ok: false, code: 'url' }
        config.host = match[1]
        config.port = match[2] || '1521'
        const target = match[3].split(/[?#]/)[0]
        if (target.includes('/') || target.includes('.')) config.serviceName = target
        else config.sid = target
      }
      if (!config.serviceName && !config.sid) return { ok: false, code: 'url' }
      return { ok: true, kind: 'oracle', config, password: '', name: config.serviceName || config.sid }
    }

    function parseSqliteFile(text) {
      let file = stripQuotes(String(text || '').replace(/^file:/i, ''))
      if (/^\/+[A-Za-z]:/.test(file)) file = file.replace(/^\/+/, '')
      else if (/^\/{2,}/.test(file)) file = '/' + file.replace(/^\/+/, '')
      if (!file || file === '/') return { ok: false, code: 'file' }
      const config = baseConfig('sqlite')
      config.file = file
      return { ok: true, kind: 'sqlite', config, password: '', name: fileStem(file) || 'sqlite' }
    }

    /**
     * Accepts a DSN, a JDBC URL, an Oracle TNS descriptor, or a SQLite file path.
     * Returns { ok, kind, config, password, name } so the form can fill itself.
     */
    function parseConnectionText(input) {
      const raw = stripQuotes(input)
      if (!raw) return { ok: false, code: 'empty' }
      if (/^\(\s*DESCRIPTION/i.test(raw)) return parseTns(raw)

      const lower = raw.toLowerCase()
      if (lower.startsWith('jdbc:')) {
        const rest = raw.slice(5)
        const restLower = rest.toLowerCase()
        if (restLower.startsWith('sqlite:')) return parseSqliteFile(rest.slice('sqlite:'.length))
        if (restLower.startsWith('oracle:thin:@')) return parseOracleThin(rest.slice('oracle:thin:@'.length))
        if (restLower.startsWith('postgresql://')) return fromUrl('postgres', rest.slice('postgresql:'.length))
        if (restLower.startsWith('mysql://')) return fromUrl('mysql', rest.slice('mysql:'.length))
        if (restLower.startsWith('mariadb://')) return fromUrl('mysql', rest.slice('mariadb:'.length))
        return { ok: false, code: 'jdbc' }
      }

      const scheme = /^([a-z][a-z0-9+.-]*):\/\/(.*)$/i.exec(raw)
      if (scheme) {
        const name = scheme[1].toLowerCase()
        const body = '//' + scheme[2]
        if (name === 'sqlite' || name === 'sqlite3' || name === 'file') return parseSqliteFile(body.slice(2))
        if (name === 'oracle') return fromUrl('oracle', body)
        if (name === 'postgres' || name === 'postgresql' || name === 'psql') return fromUrl('postgres', body)
        if (name === 'mysql' || name === 'mariadb') return fromUrl('mysql', body)
        return { ok: false, code: 'scheme' }
      }

      if (raw.startsWith('@') || /^[\w.-]+:\d{2,5}[:/]/.test(raw)) return parseOracleThin(raw)
      if (!raw.includes('://') && /\.(db|sqlite3?|db3)$/i.test(raw)) return parseSqliteFile(raw)
      if (/^([a-z]:[\\/]|\\\\|\/)/i.test(raw)) return parseSqliteFile(raw)
      return { ok: false, code: 'unrecognized' }
    }

    /** Append -2, -3, ... until the id is free; the registry requires unique ids. */
    function uniqueId(base, taken) {
      const seed = slugId(base) || 'source'
      const used = new Set((taken || []).map((value) => String(value || '').toLowerCase()))
      if (!used.has(seed)) return seed
      for (let index = 2; index < 100; index += 1) {
        const candidate = `${seed.slice(0, 28)}-${index}`
        if (!used.has(candidate)) return candidate
      }
      return seed
    }

    function formatUptime(ms) {
      const total = Math.max(0, Math.floor((ms || 0) / 1000))
      if (total < 60) return `${total}s`
      const minutes = Math.floor(total / 60)
      if (minutes < 60) return `${minutes}m`
      const hours = Math.floor(minutes / 60)
      return `${hours}h ${minutes % 60}m`
    }

    function pythonLabel(t, python) {
      if (!python) return '-'
      if (python.ok) return `${python.command} ${python.version}`
      return `${t('state.failed')} · ${t('python.missing')}`
    }

    function emptyDraft() {
      return {
        id: '',
        name: '',
        kind: 'sqlite',
        readOnly: true,
        config: baseConfig('sqlite'),
        password: '',
        hasSecret: false,
        nameTouched: false,
        idTouched: false,
      }
    }

    function draftFromSource(source) {
      const config = (source && source.config) || {}
      const draft = emptyDraft()
      const fallback = baseConfig(source.kind || 'sqlite')
      draft.id = source.id
      draft.name = source.name || ''
      draft.kind = source.kind || 'sqlite'
      draft.readOnly = source.readOnly !== false
      draft.hasSecret = source.hasSecret === true
      draft.config = {
        ...fallback,
        file: config.file || '',
        host: config.host || fallback.host,
        port: config.port == null ? fallback.port : String(config.port),
        database: config.database || '',
        user: config.user || '',
        schema: config.schema || '',
        serviceName: config.serviceName || '',
        sid: config.sid || '',
        charset: config.charset || fallback.charset,
        sslMode: config.sslMode || '',
      }
      return draft
    }

    /** Render the current draft back to a connection string (never includes the password). */
    function canonicalUrl(draft) {
      const config = draft.config || {}
      if (draft.kind === 'sqlite') return config.file || ''
      const user = config.user ? `${config.user}@` : ''
      const port = config.port ? `:${config.port}` : ''
      const host = config.host || 'localhost'
      if (draft.kind === 'oracle') {
        // Service name and SID are different address forms: only the SID form
        // round-trips through `jdbc:oracle:thin:@host:port:sid`.
        if (config.serviceName) return `oracle://${user}${host}${port}/${config.serviceName}`
        if (config.sid && config.port) return `jdbc:oracle:thin:@${host}${port}:${config.sid}`
        return ''
      }
      return config.database ? `${draft.kind}://${user}${host}${port}/${config.database}` : ''
    }

    function SourceForm(props) {
      const t = props.t
      const [draft, setDraft] = React.useState(props.draft)
      const [raw, setRaw] = React.useState(() => (props.editing ? canonicalUrl(props.draft) : ''))
      const [parsed, setParsed] = React.useState(null)
      const [saveSecret, setSaveSecret] = React.useState(true)
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState(null)
      const editing = props.editing

      const patch = (changes) => setDraft((prev) => ({ ...prev, ...changes }))
      const patchConfig = (changes) => setDraft((prev) => ({ ...prev, config: { ...prev.config, ...changes } }))

      const fillFrom = (result) => {
        setDraft((prev) => {
          const next = { ...prev, kind: result.kind, config: { ...prev.config, ...result.config } }
          if (result.password) next.password = result.password
          if (result.name && (!prev.nameTouched || !prev.name.trim())) next.name = result.name
          if (!editing && (!prev.idTouched || !prev.id.trim())) {
            next.id = uniqueId(result.name || result.kind, props.takenIds)
          }
          return next
        })
      }

      const onRawChange = (value) => {
        setRaw(value)
        if (!value.trim()) {
          setParsed(null)
          return
        }
        const result = parseConnectionText(value)
        setParsed({ ok: result.ok, code: result.code || null })
        if (result.ok) fillFrom(result)
      }

      const changeKind = (kind) => {
        setDraft((prev) => ({
          ...prev,
          kind,
          config: { ...baseConfig(kind), file: prev.config.file, user: prev.config.user, database: prev.kind === 'oracle' ? '' : prev.config.database },
        }))
      }

      const submit = async () => {
        setError(null)
        const needsTarget =
          draft.kind === 'oracle' ? !draft.config.serviceName.trim() && !draft.config.sid.trim() : !draft.config.database.trim()
        const missing = draft.kind === 'sqlite' ? !draft.config.file.trim() : !draft.config.host.trim() || needsTarget
        if (missing) {
          setError(t('form.invalid'))
          return
        }
        setBusy(true)
        try {
          const body = {
            id: draft.id.trim(),
            name: draft.name.trim() || draft.id || t('form.untitled'),
            kind: draft.kind,
            readOnly: draft.readOnly,
            config: { ...draft.config, port: draft.config.port ? Number(draft.config.port) : undefined },
            password: saveSecret && draft.password !== '' ? draft.password : undefined,
          }
          if (!body.id) delete body.id
          const data = await apiPost('/datasources/save', body)
          props.onSaved(data.datasource)
        } catch (caught) {
          setError(String((caught && caught.message) || caught))
        } finally {
          setBusy(false)
        }
      }

      const manual = []
      if (draft.kind === 'sqlite') {
        manual.push(
          h(
            Field,
            { key: 'file', wide: true, label: t('form.file'), hint: t('form.fileHint') },
            h(TextInput, { value: draft.config.file, onChange: (value) => patchConfig({ file: value }) }),
          ),
        )
      } else {
        manual.push(
          h(
            Field,
            { key: 'host', label: t('form.host') },
            h(TextInput, { value: draft.config.host, onChange: (value) => patchConfig({ host: value }) }),
          ),
          h(
            Field,
            { key: 'port', label: t('form.port') },
            h(TextInput, {
              value: draft.config.port,
              placeholder: DEFAULT_PORTS[draft.kind] || '',
              onChange: (value) => patchConfig({ port: value.replace(/[^\d]/g, '') }),
            }),
          ),
        )
        if (draft.kind === 'oracle') {
          manual.push(
            h(
              Field,
              { key: 'serviceName', label: t('form.serviceName') },
              h(TextInput, { value: draft.config.serviceName, onChange: (value) => patchConfig({ serviceName: value }) }),
            ),
            h(
              Field,
              { key: 'sid', label: t('form.sid'), hint: t('form.sidHint') },
              h(TextInput, { value: draft.config.sid, onChange: (value) => patchConfig({ sid: value }) }),
            ),
          )
        } else {
          manual.push(
            h(
              Field,
              { key: 'database', label: t('form.database') },
              h(TextInput, { value: draft.config.database, onChange: (value) => patchConfig({ database: value }) }),
            ),
          )
        }
        manual.push(
          h(
            Field,
            { key: 'schema', label: t('form.schema'), hint: t('form.schemaHint') },
            h(TextInput, { value: draft.config.schema, onChange: (value) => patchConfig({ schema: value }) }),
          ),
        )
      }
      if (draft.kind === 'postgres') {
        manual.push(
          h(
            Field,
            { key: 'sslMode', label: t('form.sslMode') },
            h(
              'select',
              {
                className: 'dbmcp-select',
                value: draft.config.sslMode || '',
                onChange: (event) => patchConfig({ sslMode: event.target.value }),
              },
              h('option', { value: '' }, 'default'),
              h('option', { value: 'disable' }, 'disable'),
              h('option', { value: 'prefer' }, 'prefer'),
              h('option', { value: 'require' }, 'require'),
            ),
          ),
        )
      }
      if (draft.kind === 'mysql') {
        manual.push(
          h(
            Field,
            { key: 'charset', label: t('form.charset') },
            h(TextInput, { value: draft.config.charset, onChange: (value) => patchConfig({ charset: value }) }),
          ),
        )
      }

      return h(
        'div',
        null,
        error
          ? h(
              'div',
              { className: 'dbmcp-notice is-error' },
              h('span', null, error),
              h('button', { type: 'button', className: 'dbmcp-btn is-small', onClick: () => setError(null) }, '×'),
            )
          : null,
        h(
          'div',
          { className: 'dbmcp-form is-compact' },
          h(
            Field,
            {
              key: 'raw',
              wide: true,
              label: t('form.paste'),
              hint: editing ? t('form.pasteHintEdit') : t('form.pasteHintShort'),
            },
            h(
              'div',
              { className: 'dbmcp-paste' },
              h(TextInput, {
                value: raw,
                onChange: onRawChange,
                placeholder: t('form.pastePlaceholder'),
                autoFocus: !editing,
              }),
              parsed
                ? h(
                    'span',
                    { className: 'dbmcp-parse ' + (parsed.ok ? 'is-ok' : 'is-bad') },
                    parsed.ok ? t('form.parseOk') : t('form.parseBad'),
                  )
                : null,
            ),
          ),
          h(
            Field,
            { key: 'user', label: t('form.user') },
            h(TextInput, {
              value: draft.config.user,
              onChange: (value) => patchConfig({ user: value }),
              autoComplete: 'off',
            }),
          ),
          h(
            Field,
            { key: 'password', label: t('form.password'), hint: draft.hasSecret ? t('form.passwordKeep') : null },
            h(
              'div',
              { className: 'dbmcp-paste' },
              h(TextInput, {
                type: 'password',
                value: draft.password,
                autoComplete: 'new-password',
                placeholder: draft.hasSecret ? '********' : t('form.passwordEmpty'),
                onChange: (value) => patch({ password: value }),
              }),
              h(
                'label',
                { className: 'dbmcp-check' },
                h('input', {
                  type: 'checkbox',
                  checked: saveSecret,
                  onChange: (event) => setSaveSecret(event.target.checked),
                }),
                h('span', null, t('form.savePassword')),
              ),
            ),
          ),
          h(
            'details',
            { key: 'more', className: 'dbmcp-advanced' },
            h('summary', null, t('form.more')),
            h(
              'div',
              { className: 'dbmcp-form' },
              h(
                Field,
                { key: 'name', label: t('form.name'), hint: t('form.optional') },
                h(TextInput, {
                  value: draft.name,
                  placeholder: draft.id || '',
                  onChange: (value) => patch({ name: value, nameTouched: true }),
                }),
              ),
              h(
                Field,
                { key: 'id', label: t('form.id'), hint: editing ? null : t('form.idHint') },
                h(TextInput, {
                  value: draft.id,
                  disabled: Boolean(editing),
                  placeholder: 'prod-main',
                  onChange: (value) =>
                    patch({ id: value.toLowerCase().replace(/[^a-z0-9-]/g, ''), idTouched: true }),
                }),
              ),
              h(
                Field,
                { key: 'kind', label: t('form.kind') },
                h(
                  'select',
                  {
                    className: 'dbmcp-select',
                    value: draft.kind,
                    disabled: Boolean(editing),
                    onChange: (event) => changeKind(event.target.value),
                  },
                  KINDS.map((kind) => h('option', { key: kind, value: kind }, kind)),
                ),
              ),
              manual,
              h(
                Field,
                { key: 'readOnly', label: t('form.readOnly'), hint: t('form.readOnlyHint') },
                h(
                  'label',
                  { className: 'dbmcp-check' },
                  h('input', {
                    type: 'checkbox',
                    checked: draft.readOnly,
                    onChange: (event) => patch({ readOnly: event.target.checked }),
                  }),
                  h('span', null, draft.readOnly ? t('sources.readonly') : t('sources.readwrite')),
                ),
              ),
            ),
          ),
          h(
            'div',
            { className: 'dbmcp-form-foot' },
            h(
              'button',
              { type: 'button', className: 'dbmcp-btn is-primary', disabled: busy, onClick: submit },
              busy ? t('action.saving') : t('action.save'),
            ),
            h(
              'button',
              { type: 'button', className: 'dbmcp-btn', disabled: busy, onClick: props.onCancel },
              t('action.cancel'),
            ),
          ),
        ),
      )
    }

    function ImportView(props) {
      const t = props.t
      const [state, setState] = React.useState({ status: 'loading', data: null, error: null })
      const [selected, setSelected] = React.useState([])
      const [busy, setBusy] = React.useState(false)

      React.useEffect(() => {
        let alive = true
        apiGet('/dbeaver/scan')
          .then((data) => {
            if (alive) setState({ status: 'ready', data, error: null })
          })
          .catch((error) => {
            if (alive) setState({ status: 'error', data: null, error: String((error && error.message) || error) })
          })
        return () => {
          alive = false
        }
      }, [])

      const existing = props.existingIds || []
      const all = state.data ? state.data.sources : []

      const toggle = (id) =>
        setSelected((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]))

      const runImport = async () => {
        setBusy(true)
        try {
          const data = await apiPost('/dbeaver/import', { ids: selected })
          props.onImported(data)
        } catch (error) {
          setState((prev) => ({ ...prev, error: String((error && error.message) || error) }))
        } finally {
          setBusy(false)
        }
      }

      if (state.status === 'loading') return h('div', { className: 'dbmcp-empty' }, t('loading'))
      if (state.status === 'error') {
        return h('div', { className: 'dbmcp-error' }, h('div', null, state.error))
      }

      return h(
        'div',
        { className: 'dbmcp-scan' },
        h('p', { className: 'dbmcp-sub' }, t('import.body')),
        all.length === 0
          ? h(
              'div',
              { className: 'dbmcp-empty' },
              h('strong', null, t('import.empty')),
              h(
                'p',
                null,
                state.data.roots.join(' · '),
              ),
            )
          : all.map((source) =>
              h(
                'div',
                { key: source.file },
                h(Card, { title: t('import.file'), aside: source.credentialsFound ? t('import.credentialsFound') : t('import.credentialsMissing') },
                  h('div', { className: 'dbmcp-scan-file' }, source.file),
                  h(
                    'ul',
                    { className: 'dbmcp-list', style: { marginTop: '10px' } },
                    source.connections.map((item) => {
                      const taken = existing.includes(item.id) || existing.includes(item.id)
                      return h(
                        'li',
                        { className: 'dbmcp-item', key: item.id },
                        h(
                          'div',
                          { className: 'dbmcp-item-main' },
                          h(
                            'div',
                            { className: 'dbmcp-item-name' },
                            item.importable
                              ? h('input', {
                                  type: 'checkbox',
                                  checked: selected.includes(item.id),
                                  disabled: taken,
                                  onChange: () => toggle(item.id),
                                })
                              : null,
                            h('span', null, item.name || item.id),
                            item.kind ? h('span', { className: 'dbmcp-pill' }, item.kind) : null,
                          ),
                          h(
                            'div',
                            { className: 'dbmcp-item-target' },
                            [item.importable ? item.target : item.reason, item.user].filter(Boolean).join(' · '),
                          ),
                          h(
                            'div',
                            { className: 'dbmcp-item-target' },
                            item.importable ? (item.hasPassword ? t('sources.hasPassword') : t('sources.noPassword')) : '',
                          ),
                        ),
                      )
                    }),
                  ),
                ),
              ),
            ),
        h(
          'div',
          { className: 'dbmcp-toolbar' },
          h(
            'button',
            { type: 'button', className: 'dbmcp-btn is-primary', disabled: busy || selected.length === 0, onClick: runImport },
            busy ? t('action.importing') : `${t('action.importSelected')} (${selected.length})`,
          ),
          h('button', { type: 'button', className: 'dbmcp-btn', disabled: busy, onClick: props.onCancel }, t('action.cancel')),
        ),
      )
    }

    /** P7: read-only structure browser. Only lists tables and columns. */
    function SchemaView(props) {
      const { t, source, onBack } = props
      const [tables, setTables] = React.useState(null)
      const [picked, setPicked] = React.useState(null)
      const [detail, setDetail] = React.useState(null)
      const [error, setError] = React.useState(null)
      const [busy, setBusy] = React.useState(true)

      React.useEffect(() => {
        let alive = true
        setBusy(true)
        ;(async () => {
          try {
            const data = await apiGet(`/schema?datasource=${encodeURIComponent(source.id)}`)
            if (!alive) return
            if (!data.ok) {
              const failure = data.error || {}
              setError(failure.hint ? `${failure.message || t('schema.error')} — ${failure.hint}` : failure.message || t('schema.error'))
              setTables([])
            } else {
              setTables(data.tables || [])
              setError(null)
            }
          } catch (failure) {
            if (!alive) return
            const payload = (failure && failure.payload) || {}
            setError(payload.hint ? `${payload.error || failure.message} — ${payload.hint}` : String((failure && failure.message) || failure))
            setTables([])
          } finally {
            if (alive) setBusy(false)
          }
        })()
        return () => {
          alive = false
        }
      }, [source.id])

      React.useEffect(() => {
        if (!picked) {
          setDetail(null)
          return undefined
        }
        let alive = true
        setDetail({ loading: true })
        ;(async () => {
          try {
            const data = await apiGet(
              `/schema?datasource=${encodeURIComponent(source.id)}&table=${encodeURIComponent(picked)}`,
            )
            if (alive) setDetail(data)
          } catch (failure) {
            const payload = (failure && failure.payload) || {}
            if (alive) setDetail({ ok: false, error: { message: payload.error || String((failure && failure.message) || failure) } })
          }
        })()
        return () => {
          alive = false
        }
      }, [picked, source.id])

      let content
      if (busy && !tables) {
        content = h('div', { className: 'dbmcp-empty' }, t('schema.loading'))
      } else if (error) {
        content = h('div', { className: 'dbmcp-error' }, h('div', null, t('schema.error')), h('code', null, error))
      } else if (!tables || tables.length === 0) {
        content = h('div', { className: 'dbmcp-empty' }, t('schema.empty'))
      } else {
        content = h(
          'div',
          { className: 'dbmcp-schema' },
          h(
            'div',
            { className: 'dbmcp-schema-side' },
            h('div', { className: 'dbmcp-schema-head' }, fmt(t('schema.tables'), { n: tables.length })),
            h(
              'ul',
              { className: 'dbmcp-schema-tables' },
              tables.map((table) =>
                h(
                  'li',
                  { key: `${table.schema || ''}.${table.name}` },
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'dbmcp-schema-table' + (picked === table.name ? ' is-active' : ''),
                      onClick: () => setPicked(table.name),
                    },
                    h('span', null, table.name),
                    table.type ? h('span', { className: 'dbmcp-pill' }, table.type) : null,
                  ),
                ),
              ),
            ),
          ),
          h(
            'div',
            { className: 'dbmcp-schema-main' },
            !picked
              ? h('div', { className: 'dbmcp-empty' }, t('schema.pick'))
              : detail && detail.loading
                ? h('div', { className: 'dbmcp-empty' }, t('schema.loading'))
                : detail && detail.ok === false
                  ? h(
                      'div',
                      { className: 'dbmcp-error' },
                      h('code', null, (detail.error && detail.error.message) || t('schema.error')),
                    )
                  : detail && detail.ok
                    ? h(
                        'div',
                        null,
                        h(
                          'div',
                          { className: 'dbmcp-schema-head' },
                          h('span', null, detail.table),
                          h('span', { className: 'dbmcp-hint' }, fmt(t('schema.columns'), { n: (detail.columns || []).length })),
                        ),
                        h(
                          'table',
                          { className: 'dbmcp-schema-tablegrid' },
                          h(
                            'thead',
                            null,
                            h(
                              'tr',
                              null,
                              h('th', null, t('schema.column')),
                              h('th', null, t('schema.type')),
                              h('th', null, t('schema.nullable')),
                              h('th', null, t('schema.default')),
                              h('th', null, t('schema.pk')),
                            ),
                          ),
                          h(
                            'tbody',
                            null,
                            (detail.columns || []).map((column) =>
                              h(
                                'tr',
                                { key: column.name },
                                h('td', null, column.name),
                                h('td', { className: 'dbmcp-mono' }, column.type || ''),
                                h('td', null, column.nullable ? t('schema.yes') : t('schema.no')),
                                h('td', { className: 'dbmcp-mono' }, column.default === null || column.default === undefined ? '' : String(column.default)),
                                h('td', null, column.primaryKey ? '●' : ''),
                              ),
                            ),
                          ),
                        ),
                        h('div', { className: 'dbmcp-hint dbmcp-schema-note' }, t('schema.readonlyNote')),
                      )
                    : null,
          ),
        )
      }

      return h(
        'div',
        { className: 'dbmcp-schema-wrap' },
        h('div', { className: 'dbmcp-schema-head' }, h('span', { className: 'dbmcp-hint' }, fmt(t('schema.title'), { name: source.name || source.id }))),
        content,
      )
    }

    function crumbLabel(t, view) {
      if (view.mode === 'schema' && view.source) return view.source.name || view.source.id
      if (view.mode === 'create') return t('action.new')
      if (view.mode === 'edit' && view.source) return fmt(t('form.edit'), { name: view.source.name || view.source.id })
      if (view.mode === 'import') return t('action.import')
      return t('panel.title')
    }

    function Breadcrumbs({ t, trail }) {
      const items = []
      trail.forEach((step, index) => {
        if (index > 0) items.push(h('span', { key: `sep-${index}`, className: 'dbmcp-crumb-sep' }, '/'))
        if (typeof step.onSelect === 'function') {
          items.push(
            h('button', { key: `step-${index}`, type: 'button', className: 'dbmcp-crumb', onClick: step.onSelect }, step.label),
          )
        } else {
          items.push(h('span', { key: `step-${index}`, className: 'dbmcp-crumb is-current' }, step.label))
        }
      })
      return h('nav', { className: 'dbmcp-crumbs', 'aria-label': t('panel.title') }, items)
    }

    function MainPanel() {
      const service = useLocale()
      const t = React.useMemo(() => (service ? service.bind(NS) : (key) => key), [service])
      const [state, setState] = React.useState({ status: 'loading', data: null, error: null })
      const [busy, setBusy] = React.useState(false)
      const [view, setView] = React.useState({ mode: 'list' })
      const [notice, setNotice] = React.useState(null)
      const [probing, setProbing] = React.useState(null)
      const [pendingDelete, setPendingDelete] = React.useState(null)
      const [settings, setSettings] = React.useState(null)
      const [audit, setAudit] = React.useState({ entries: [], file: null })
      const [env, setEnv] = React.useState(null)
      const [installing, setInstalling] = React.useState(false)

      const load = React.useCallback(async () => {
        setBusy(true)
        try {
          const data = await apiGet('/health')
          setState({ status: 'ready', data, error: null })
          if (data.settings) setSettings(data.settings)
          void apiGet('/audit?limit=12')
            .then((payload) => setAudit({ entries: payload.entries || [], file: payload.file || null }))
            .catch(() => {})
          void apiGet('/python/env')
            .then((payload) => setEnv(payload))
            .catch(() => {})
        } catch (error) {
          setState({ status: 'error', data: null, error: String((error && error.message) || error) })
        } finally {
          setBusy(false)
        }
      }, [])

      React.useEffect(() => {
        load()
      }, [load])

      const data = state.data
      const apiOk = state.status === 'ready' && data && data.ok === true
      const sources = (data && data.datasources) || []

      const finish = (message, isError) => {
        setNotice({ message, isError: Boolean(isError) })
        setView({ mode: 'list' })
        load()
      }

      const save = (source) => finish(fmt(t('notice.saved'), { name: source.name || source.id }), false)

      const remove = async (source) => {
        if (pendingDelete !== source.id) {
          setPendingDelete(source.id)
          return
        }
        setPendingDelete(null)
        try {
          await apiPost('/datasources/delete', { id: source.id })
          finish(fmt(t('notice.deleted'), { name: source.name || source.id }), false)
        } catch (error) {
          setNotice({ message: String((error && error.message) || error), isError: true })
        }
      }

      const makeDefault = async (source) => {
        try {
          await apiPost('/datasources/save', {
            id: source.id,
            name: source.name,
            kind: source.kind,
            readOnly: source.readOnly,
            isDefault: true,
            config: source.config,
          })
          finish(fmt(t('notice.default'), { name: source.name || source.id }), false)
        } catch (error) {
          setNotice({ message: String((error && error.message) || error), isError: true })
        }
      }

      const probe = async (source) => {        setProbing(source.id)
        try {
          const result = await apiPost('/datasources/test', { id: source.id })
          const probeInfo = result.probe || {}
          setNotice({
            message: probeInfo.ok
              ? fmt(t('notice.probeOk'), { name: source.name, ms: probeInfo.latencyMs })
              : fmt(t('notice.probeFail'), { name: source.name, message: probeInfo.message }),
            isError: !probeInfo.ok,
          })
          load()
        } catch (error) {
          setNotice({ message: String((error && error.message) || error), isError: true })
        } finally {
          setProbing(null)
        }
      }

      const toggleWrite = async (next) => {
        try {
          const payload = await apiPost('/settings', { allowWrite: next })
          setSettings(payload.settings || { allowWrite: next })
          setNotice({ message: next ? t('notice.writeOn') : t('notice.writeOff'), isError: false })
          load()
        } catch (error) {
          setNotice({ message: String((error && error.message) || error), isError: true })
        }
      }

      const installDeps = async () => {
        setInstalling(true)
        setNotice(null)
        try {
          const payload = await apiPost('/python/setup', {})
          if (payload && payload.python) setEnv(payload.python)
          setNotice({ message: payload && payload.ok ? t('notice.depsOk') : t('notice.depsFail'), isError: !(payload && payload.ok) })
          load()
        } catch (error) {
          setNotice({ message: `${t('notice.depsFail')} ${String((error && error.message) || error)}`, isError: true })
        } finally {
          setInstalling(false)
        }
      }

      const renderList = () => {
        if (sources.length === 0) {
          return h(
            'div',
            { className: 'dbmcp-empty' },
            h('strong', null, t('sources.empty.title')),
            h('p', null, t('sources.empty.body')),
          )
        }
        return h(
          'ul',
          { className: 'dbmcp-list' },
          sources.map((source) => {
            const probeInfo = source.lastProbe
            return h(
              'li',
              { className: 'dbmcp-item', key: source.id },
              h(
                'div',
                { className: 'dbmcp-item-main' },
                h(
                  'div',
                  { className: 'dbmcp-item-name' },
                  h('span', null, source.name || source.id),
                  h('span', { className: 'dbmcp-pill' }, source.kind),
                  source.isDefault ? h('span', { className: 'dbmcp-pill' }, t('sources.default')) : null,
                  h('span', { className: 'dbmcp-pill' }, source.readOnly ? t('sources.readonly') : t('sources.readwrite')),
                ),
                h('div', { className: 'dbmcp-item-target' }, [source.target, source.id].filter(Boolean).join(' · ')),
                h(
                  'div',
                  { className: 'dbmcp-probe ' + (probeInfo ? (probeInfo.ok ? 'is-ok' : 'is-error') : '') },
                  probeInfo
                    ? `${probeInfo.ok ? '●' : '○'} ${probeInfo.message}`
                    : t('sources.neverProbed'),
                ),
              ),
              h(
                'div',
                { className: 'dbmcp-item-actions' },
                h(
                  'button',
                  { type: 'button', className: 'dbmcp-btn is-small', disabled: probing === source.id, onClick: () => probe(source) },
                  probing === source.id ? t('action.testing') : t('action.test'),
                ),
                h('button', { type: 'button', className: 'dbmcp-btn is-small', onClick: () => setView({ mode: 'schema', source }) }, t('action.schema')),
                h('button', { type: 'button', className: 'dbmcp-btn is-small', onClick: () => setView({ mode: 'edit', source }) }, t('action.edit')),
                source.isDefault
                  ? null
                  : h('button', { type: 'button', className: 'dbmcp-btn is-small', onClick: () => makeDefault(source) }, t('action.makeDefault')),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'dbmcp-btn is-small is-danger',
                    onClick: () => remove(source),
                    onBlur: () => setPendingDelete((prev) => (prev === source.id ? null : prev)),
                  },
                  pendingDelete === source.id ? t('action.deleteConfirm') : t('action.delete'),
                ),
              ),
            )
          }),
        )
      }

      let body
      if (state.status === 'loading') {
        body = h('div', { className: 'dbmcp-empty' }, t('loading'))
      } else if (state.status === 'error') {
        body = h(
          'div',
          { className: 'dbmcp-error' },
          h('div', null, t('error.title')),
          h('code', null, state.error),
          h('button', { type: 'button', className: 'dbmcp-btn', onClick: load }, t('error.retry')),
        )
      } else if (view.mode === 'create') {
        body = h(Card, { title: t('form.new') }, h(SourceForm, {
          t,
          draft: emptyDraft(),
          editing: null,
          takenIds: sources.map((item) => item.id),
          onSaved: save,
          onCancel: () => setView({ mode: 'list' }),
        }))
      } else if (view.mode === 'edit') {
        body = h(Card, {
          title: fmt(t('form.edit'), { name: view.source.name || view.source.id }),
          children: h(SourceForm, {
            t,
            draft: draftFromSource(view.source),
            editing: view.source,
            takenIds: sources.map((item) => item.id),
            onSaved: save,
            onCancel: () => setView({ mode: 'list' }),
          }),
        })
      } else if (view.mode === 'schema') {
        body = h(Card, { title: fmt(t('schema.title'), { name: view.source.name || view.source.id }) }, h(SchemaView, {
          t,
          source: view.source,
          onBack: () => setView({ mode: 'list' }),
        }))
      } else if (view.mode === 'import') {
        body = h(Card, { title: t('import.title') }, h(ImportView, {
          t,
          existingIds: sources.map((item) => item.id),
          onImported: (payload) => finish(fmt(t('notice.imported'), { n: (payload.imported || []).length }), false),
          onCancel: () => setView({ mode: 'list' }),
        }))
      } else {
        body = h(
          'div',
          { className: 'dbmcp-grid' },
          h(
            Card,
            { title: t('sources.title'), aside: t('sources.count').replace('{n}', String(sources.length)) },
            renderList(),
          ),
          h(
            Card,
            { title: t('diag.title') },
            h(
              'div',
              { className: 'dbmcp-rows' },
              h(Row, { label: t('diag.hostApi') }, h('span', { className: 'dbmcp-dot is-ok' }), t('state.connected')),
              h(Row, { label: t('diag.node') }, (data.host && data.host.node) || '-'),
              h(Row, { label: t('diag.plugin') }, `${data.plugin.name} ${data.plugin.version} · ${data.plugin.phase}`),
              h(Row, { label: t('diag.python') }, pythonLabel(t, data.python)),
              h(Row, { label: t('diag.runtimeDir') }, (data.runtime && data.runtime.dir) || '-'),
              h(
                Row,
                { label: t('diag.registry') },
                data.runtime && data.runtime.registryError
                  ? `${data.runtime.registryFile} — ${data.runtime.registryError}`
                  : (data.runtime && data.runtime.registryFile) || '-',
              ),
              h(Row, { label: t('diag.sources') }, String(sources.length)),
              h(
                Row,
                { label: t('diag.mcp') },
                `${data.mcp.serverName} · ${
                  data.mcp.wired
                    ? t('diag.mcpLive').replace('{count}', String((data.mcp.tools || []).length))
                    : data.mcp.phase === 'failed'
                      ? `${t('diag.mcpFailed')} ${data.mcp.error || ''}`.trim()
                      : t('diag.mcpPending')
                }`,
              ),
              h(
                Row,
                { label: t('diag.write') },
                h('input', {
                  type: 'checkbox',
                  className: 'dbmcp-check',
                  checked: Boolean(settings && settings.allowWrite),
                  onChange: (event) => toggleWrite(event.target.checked),
                }),
                h(
                  'span',
                  { className: 'dbmcp-hint' },
                  settings && settings.allowWrite ? t('diag.writeOn') : t('diag.writeOff'),
                ),
              ),
              h(
                Row,
                { label: t('diag.venv') },
                env && env.venvPython ? env.venvPython : h('span', { className: 'dbmcp-hint' }, t('diag.venvMissing')),
              ),
              h(
                Row,
                { label: t('diag.packages') },
                h('span', { className: 'dbmcp-hint' }, (env && env.packages) || '—'),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'dbmcp-btn is-small',
                    disabled: installing,
                    title: t('diag.venvHint'),
                    onClick: installDeps,
                  },
                  installing ? t('action.installing') : t('action.installDeps'),
                ),
              ),
              data.mcp && data.mcp.phase === 'failed' && /tools`? service/.test(String(data.mcp.error || ''))
                ? h(Row, { label: t('diag.tip') }, h('span', { className: 'dbmcp-hint' }, t('diag.restartNeeded')))
                : null,
              h(Row, { label: t('diag.uptime') }, formatUptime(data.host && data.host.uptimeMs)),
            ),
          ),
          h(
            Card,
            { title: t('audit.title'), aside: audit.entries.length ? String(audit.entries.length) : null },
            h(
              'div',
              { className: 'dbmcp-audit-list' },
              audit.entries.length === 0
                ? h('div', { className: 'dbmcp-empty' }, t('audit.empty'))
                : audit.entries.map((entry, index) =>
                    h(
                      'div',
                      { className: 'dbmcp-audit', key: `${entry.at || 'entry'}-${index}` },
                      h('span', { className: 'dbmcp-audit-time' }, String(entry.at || '').slice(11, 19)),
                      h('span', { className: 'dbmcp-audit-tool' }, entry.tool || '?'),
                      h('span', { className: 'dbmcp-pill' }, entry.datasource || t('sources.default')),
                      h('span', { className: 'dbmcp-hint' }, `${entry.ms ?? 0}ms`),
                      h(
                        'span',
                        { className: entry.ok ? 'dbmcp-audit-ok is-ok' : 'dbmcp-audit-ok is-error' },
                        entry.ok ? t('audit.ok') : t('audit.err'),
                      ),
                      typeof entry.rows === 'number'
                        ? h('span', { className: 'dbmcp-hint' }, t('audit.rows').replace('{n}', String(entry.rows)))
                        : null,
                      entry.sql ? h('code', { className: 'dbmcp-audit-sql' }, entry.sql) : null,
                      entry.error ? h('code', { className: 'dbmcp-audit-sql is-error' }, entry.error) : null,
                    ),
                  ),
              h('p', { className: 'dbmcp-hint' }, t('audit.hint')),
              audit.file ? h('p', { className: 'dbmcp-hint' }, `${t('audit.file')}: ${audit.file}`) : null,
            ),
          ),
        )
      }

      return h(
        'div',
        { className: 'dbmcp-page' },
        h('style', null, CSS),
        h('header', { className: 'dbmcp-head' }, h('h1', null, t('panel.title')), h('p', { className: 'dbmcp-sub' }, t('panel.subtitle'))),
        view.mode === 'list'
          ? null
          : h(Breadcrumbs, {
              t,
              trail: [
                { label: t('panel.title'), onSelect: () => setView({ mode: 'list' }) },
                { label: crumbLabel(t, view) },
              ],
            }),
        h(
          'div',
          { className: 'dbmcp-toolbar' },
          view.mode === 'list'
            ? h('button', { type: 'button', className: 'dbmcp-btn is-primary', onClick: () => setView({ mode: 'create' }) }, t('action.new'))
            : null,
          view.mode === 'list'
            ? h('button', { type: 'button', className: 'dbmcp-btn', onClick: () => setView({ mode: 'import' }) }, t('action.import'))
            : null,
          view.mode === 'list'
            ? h('button', { type: 'button', className: 'dbmcp-btn', disabled: busy, onClick: load }, t('action.refresh'))
            : null,
          view.mode === 'list'
            ? h(
                'button',
                {
                  type: 'button',
                  className: 'dbmcp-btn',
                  disabled: busy,
                  title: t('action.restartMcpHint'),
                  onClick: async () => {
                    setBusy(true)
                    try {
                      const result = await apiPost('/mcp/restart', {})
                      setNotice({
                        message: result.ok
                          ? t('notice.mcpReady').replace('{count}', String((result.tools || []).length))
                          : `${t('diag.mcpFailed')} ${result.error || ''}`,
                        isError: !result.ok,
                      })
                      await load()
                    } catch (error) {
                      setNotice({ message: String((error && error.message) || error), isError: true })
                    } finally {
                      setBusy(false)
                    }
                  },
                },
                t('action.restartMcp'),
              )
            : null,
          h(
            'span',
            { className: 'dbmcp-pill' },
            h('span', { className: 'dbmcp-dot ' + (apiOk ? 'is-ok' : state.status === 'error' ? 'is-error' : '') }),
            apiOk ? t('state.connected') : state.status === 'loading' ? t('state.loading') : t('state.failed'),
          ),
          data && data.plugin ? h('span', { className: 'dbmcp-pill' }, `${data.plugin.name} ${data.plugin.version}`) : null,
        ),
        notice
          ? h(
              'div',
              { className: 'dbmcp-notice' + (notice.isError ? ' is-error' : '') },
              h('span', null, notice.message),
              h('button', { type: 'button', className: 'dbmcp-btn is-small', onClick: () => setNotice(null) }, '×'),
            )
          : null,
        body,
      )
    }

    return {
      inject: ['slots', 'locale'],
      /** Parser and components exposed for the offline tests in dev/. */
      __test: { parseConnectionText, uniqueId, slugId, canonicalUrl, emptyDraft, draftFromSource, SourceForm, SchemaView, Breadcrumbs, MainPanel },
      apply(ctx) {
        localeService = ctx.locale
        ctx.effect(() => ctx.locale.register(NS, 'en', DICT.en))
        ctx.effect(() => ctx.locale.register(NS, 'zh', DICT.zh))

        const t = ctx.locale.bind(NS)

        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            { name: 'sidebar.panellist', id: 'db-mcp', order: 25, label: () => t('panel.title') },
            SidebarIcon,
          ),
        )

        ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'db-mcp' }, MainPanel))
      },
    }
  },
})
