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
    /** Top-level tabs of the panel. `sources` also hosts the create/edit/import/structure views. */
    const TABS = [
      { id: 'list' },
      { id: 'create' },
      { id: 'import' },
      { id: 'runtime' },
      { id: 'clients' },
      { id: 'tools' },
      { id: 'audit' },
    ]

    /** Tab labels stay literal so the i18n check can see every key. */
    function tabLabel(t, id) {
      if (id === 'create') return t('tab.create')
      if (id === 'import') return t('tab.import')
      if (id === 'runtime') return t('tab.runtime')
      if (id === 'clients') return t('tab.clients')
      if (id === 'tools') return t('tab.tools')
      if (id === 'audit') return t('tab.audit')
      return t('tab.list')
    }

    /** The tab that owns a view; the form and the schema browser live under a tab. */
    function tabOfMode(mode) {
      if (mode === 'create' || mode === 'edit') return 'create'
      if (mode === 'import') return 'import'
      if (mode === 'runtime') return 'runtime'
      if (mode === 'clients') return 'clients'
      if (mode === 'tools') return 'tools'
      if (mode === 'audit') return 'audit'
      return 'list'
    }
    const API = '/plugins/db-mcp/api'
    // Kept in step with `repository.url` in package.json: the masthead links here
    // for the docs, the issues and the star button alike.
    const REPO_URL = 'https://github.com/halcyon6669/dsh-db-mcp'
    const KINDS = ['sqlite', 'postgres', 'gauss', 'mysql', 'oracle']
    const DEFAULT_PORTS = { postgres: '5432', gauss: '5432', mysql: '3306', oracle: '1521' }

    /** Set by apply(); bind() reads the active locale at call time, so only the
     *  re-render subscription has to live on the component side. */
    let localeService = null
    let layoutService = null

    const DICT = {
      en: {
        'panel.title': 'Database',
        'panel.subtitle': 'Manage the database connections this agent can reach through MCP tools.',
        'action.refresh': 'Refresh',
        'action.star': 'Star',
        'action.starHint': 'Star dsh-db-mcp on GitHub — the docs and the issues live there too',
        'action.restartMcp': 'Restart MCP',
        'action.restartMcpHint': 'Restart the Python MCP server and re-publish its tools',
        'action.new': 'New data source',
        'action.import': 'Import from DBeaver',
        'action.save': 'Save',
        'action.saving': 'Saving…',
        'action.edit': 'Edit',
        'action.test': 'Test',
        'action.testing': 'Testing…',
        'action.delete': 'Delete',
        'action.deleteConfirm': 'Delete for real',
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
        'notice.imported': 'Imported {n} data source(s).',
        'notice.importedSkipped': 'Imported {n} data source(s); skipped {m} already configured.',
        'notice.probeOk': '{name}: connection OK ({ms} ms).',
        'notice.mcpReady': 'MCP server is up with {count} tool(s).',
        'notice.httpOn': 'HTTP endpoint is running; other agents can connect now.',
        'notice.httpOff': 'HTTP endpoint stopped.',
        'notice.clientReady': '{name} now points at this server over {transport}.',
        'clients.title': 'Connect another agent',
        'clients.hint': 'Point VS Code, Cursor, Claude Code, Claude Desktop or Codex at this MCP server. Everyone shares the same data sources, so nothing has to be typed twice.',
        'clients.running': 'running',
        'clients.stopped': 'stopped',
        'clients.copy': 'Copy',
        'clients.copied': 'Copied',
        'clients.port': 'Port',
        'clients.start': 'Start',
        'clients.stop': 'Stop',
        'clients.configure': 'Write config',
        'clients.working': 'Writing…',
        'clients.configured': 'configured',
        'clients.notConfigured': 'not configured yet',
        'clients.noFile': 'not detected',
        'clients.stdioNote': 'Claude Desktop and Codex get a stdio entry (python + this server), so they keep working even when the HTTP endpoint is stopped.',
        'tools.title': 'Tools the agent sees',
        'tools.hint': 'Uncheck a tool to take it away from the model; the switch applies on the next restart of the MCP server.',
        'tools.offCount': '{n} tool(s) switched off.',
        'tools.on': '{name} is on.',
        'tools.off': '{name} is off.',
      'tools.rows': 'rows',
      'tools.limitLabel': 'Default rows for {argument}',
      'tools.limitHint': 'Rows used when the agent does not ask for a number (1-{max}).',
      'tools.limitSaved': 'Default row count saved.',
        'sources.count': '{n} configured',
        'sources.empty.title': 'No data source yet',
        'sources.empty.body': 'Add one here, or import the connections DBeaver already keeps on this machine. The agent queries real data through MCP tools, never through this page.',
        'sources.readonly': 'read-only',
        'sources.readwrite': 'writable',
        'sources.default': 'default',
        'sources.hasPassword': 'password saved',
        'sources.noPassword': 'no password',
        'sources.writable': 'writable {names}',
        'sources.writableHint': 'May only write to: {names}',
        'sources.secretBroken': 'stored password unreadable',
        'sources.neverProbed': 'never tested',
        'sources.idChip': 'ID',
        'sources.idChipHint': 'this is the identifier every MCP tool takes as its datasource argument — click to copy',
        'sources.idCopied': 'copied',
        'form.edit': 'Edit {name}',
        'form.name': 'Display name',
        'form.id': 'Identifier',
        'form.idHint': 'lowercase letters, digits and dashes; used by MCP tools and never changes',
        'form.paste': 'Connection string',
        'form.pasteHintShort':
          'Paste a JDBC URL, a DSN or the path of a .db file. Type, host, port, database and the identifier are derived from it.',
        'form.savePassword': 'Save password',
        'form.more': 'More settings',
        'form.moreHint': 'name, group, identifier and database settings',
        'form.smart': 'Smart parsing',
        'form.autoApply': 'Saved sources take effect immediately and are registered with the local MCP server.',
        'form.probeOk': '{name}: connection OK ({ms} ms).',
        'form.probeFail': 'Connection failed:',
        'form.probeUnknown': 'no message',
        'form.duplicate': 'A data source already uses this connection and user: {name}. Open that row instead of adding a second one.',
        'form.userPlaceholder': 'e.g. root or postgres',
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
        'form.schemaAccess': 'Writable schemas',
        'form.schemaAccessHint': 'chosen when you allow writes; reads stay unrestricted',
        'form.allowDdl': 'Allow DDL',
        'form.allowDdlHint': 'lets this source run create, alter, drop and truncate inside the writable schemas',
        'form.schemaNames': 'Schemas',
        'form.schemaNamesHint': 'comma separated, for example sales, billing',
        'form.schemaBroken': 'The stored password cannot be decrypted any more. Type it again to save it with the current key.',
        'form.invalid': 'Fill the required fields first.',
        'form.requiredHint': 'The connection string, user and password are required: fill them, then save.',
        'import.body': 'Reads data-sources.json from the DBeaver workspace and decrypts credentials-config.json when it exists.',
        'import.empty': 'No DBeaver connection found on this machine.',
        'import.file': 'File',
        'import.credentialsFound': 'found and decrypted',
        'import.already': 'already added',
        'import.alreadyAs': 'already added as {name}',
        'import.searchPlaceholder': 'Filter by name, host or user',
        'import.noMatch': 'No DBeaver connection matches this filter.',
        'import.matches': '{n} of {total}',
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
        'diag.scopes': 'Conversation limits',
        'diag.scopesNone': 'No limit: every conversation can use every data source',
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
        'audit.tz': 'Times follow your computer clock ({zone}); the log file keeps UTC.',
        'action.lockSource': 'Click to make this source read-only',
        'action.unlockSource': 'Click to allow writes on this source',
        'notice.nowReadOnly': '{name} is read-only now.',
        'notice.nowWritable': '{name} accepts writes now.',
        'notice.nowWritableLocked': '{name} accepts writes now, but the global write switch is still off — turn it on under Runtime.',
        'notice.bulkNeedsSchemas': 'Those sources name no writable schema yet. Switch them on one at a time to pick the schemas.',
        'unlock.title': 'Where may {name} write?',
        'unlock.hint': 'Reads stay unrestricted. A write that names any other schema is refused before it reaches the database.',
        'unlock.loading': 'Reading the schema list…',
        'unlock.error': 'Could not read the schema list.',
        'unlock.retry': 'Try again',
        'unlock.none': 'Tick at least one schema.',
        'unlock.empty': 'This source reported no schema. Test the connection first, then try again.',
        'unlock.selected': '{n} selected',
        'unlock.confirm': 'Allow writes',
        'unlock.cancel': 'Cancel',
        'unlock.ddl': 'Also allow DDL (create / alter / drop)',
        'unlock.ddlHint': 'Off means the tables keep their shape: only insert, update and delete go through. Either way the target schema must be one of the schemas ticked above.',
        'sources.ddl': 'DDL allowed',
        'sources.ddlHint': 'This source accepts create, alter and drop inside the schemas it may write to.',
        'sources.ddlBlocked': 'DDL blocked',
        'sources.ddlBlockedHint': 'This source accepts insert, update and delete, but refuses create, alter and drop.',
        'action.schema': 'Structure',
        'action.backToSources': 'Data sources',
        'tab.list': 'Data source list',
        'tab.create': 'New data source',
        'tab.import': 'Import from DBeaver',
        'tab.runtime': 'Runtime',
        'tab.clients': 'Connect',
      'tab.tools': 'Tools',
        'tab.audit': 'Audit log',
        'header.backToChat': 'Back to chat',
        'form.group': 'Group',
        'form.groupHint': 'Sources sharing a group are listed together',
        'group.unassigned': 'Ungrouped',
        'group.count': '{n}',
        'group.new': 'New group',
        'group.newPlaceholder': 'Group name',
        'group.add': 'Add group',
        'group.renameHint': 'Double-click to rename',
        'group.save': 'Save',
        'group.cancel': 'Cancel',
        'group.delete': 'Delete',
        'group.deleteConfirm': 'Delete group?',
        'group.selectAll': 'Select every source in this group',
        'group.dragHint': 'Drag onto a group to move it',
        'group.empty': 'Drop a source here',
        'bulk.selected': '{n} selected',
        'bulk.test': 'Test selected',
        'bulk.readonly': 'Make read-only',
        'bulk.readwrite': 'Allow writes',
        'bulk.group': 'Move to group',
        'bulk.groupPlaceholder': 'group name (empty clears it)',
        'bulk.apply': 'Apply',
        'bulk.delete': 'Delete selected',
        'bulk.deleteConfirm': 'Confirm delete {n}',
        'bulk.clear': 'Clear',
        'notice.bulkDone': 'Updated {n} data source(s).',
        'notice.bulkGrouped': 'Moved {n} data source(s) into “{group}”.',
        'notice.groupSaved': 'Group “{name}” saved.',
        'notice.groupDeleted': 'Group “{name}” deleted.',
        'notice.moved': 'Moved into “{group}”.',
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
        'schema.matching': '{n} match(es)',
        'schema.search': 'Filter tables',
        'schema.noMatch': 'No table matches this filter.',
        'schema.defaultSchema': 'default schema',
        'schema.readonlyNote': 'Read-only view: this page never runs SQL.',
        'status.mcpOk': 'MCP server healthy',
        'status.mcpDown': 'MCP server down',
        'status.total': 'Total {n}',
        'status.healthy': '{n} healthy',
        'status.failing': '{n} failing',
        'status.failingNames': '({names})',
        'filter.all': 'All',
        'filter.failed': 'Only failures',
        'sources.searchPlaceholder': 'Search data sources…',
        'sources.noMatch': 'No data source matches this filter.',
        'sources.failedLine': 'Connection failed: {message}',
        'group.expand': 'Expand this group',
        'group.collapse': 'Collapse this group',
        'action.copyError': 'Copy',
        'action.copied': 'Copied',
        'action.copyErrorHint': 'Copy the whole failure report',
      },
      zh: {
        'panel.title': '数据库',
        'panel.subtitle': '管理 AI 可以通过 MCP 工具访问的数据库连接。',
        'action.refresh': '刷新',
        'action.star': 'Star',
        'action.starHint': '在 GitHub 上给 dsh-db-mcp 加星——文档和 issue 也都在那里',
        'action.restartMcp': '重启 MCP',
        'action.restartMcpHint': '重启 Python MCP 服务并重新发布工具',
        'action.new': '新建数据源',
        'action.import': '从 DBeaver 导入',
        'action.save': '保存',
        'action.saving': '保存中…',
        'action.edit': '编辑',
        'action.test': '测试',
        'action.testing': '测试中…',
        'action.delete': '删除',
        'action.deleteConfirm': '确认删除',
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
        'notice.imported': '已导入 {n} 个数据源。',
        'notice.importedSkipped': '已导入 {n} 个数据源，跳过 {m} 个已存在的。',
        'notice.probeOk': '{name}：连接正常（{ms} ms）。',
        'notice.mcpReady': 'MCP 服务已就绪，共 {count} 个工具。',
        'notice.httpOn': 'HTTP 端点已启动，其它 agent 现在可以接入。',
        'notice.httpOff': 'HTTP 端点已停止。',
        'notice.clientReady': '已把 {name} 配置为通过 {transport} 使用本服务。',
        'clients.title': '接入其它客户端',
        'clients.hint': '把 VS Code、Cursor、Claude Code、Claude Desktop 或 Codex 指向这个 MCP 服务。它们共用同一份数据源，不用重复填。',
        'clients.running': '运行中',
        'clients.stopped': '已停止',
        'clients.copy': '复制',
        'clients.copied': '已复制',
        'clients.port': '端口',
        'clients.start': '启动',
        'clients.stop': '停止',
        'clients.configure': '写入配置',
        'clients.working': '写入中…',
        'clients.configured': '已配置',
        'clients.notConfigured': '尚未配置',
        'clients.noFile': '未检测到',
        'clients.stdioNote': 'Claude Desktop 与 Codex 写入的是 stdio 配置（python + 本服务），所以即使 HTTP 端点停掉它们也能用。',
        'tools.title': 'AI 可用的工具',
        'tools.hint': '取消勾选就把这个工具从模型的工具列表里摘掉，下次重启 MCP 服务后生效。',
        'tools.offCount': '已关闭 {n} 个工具。',
        'tools.on': '已开启 {name}。',
        'tools.off': '已关闭 {name}。',
      'tools.rows': '行',
      'tools.limitLabel': '{argument} 的默认行数',
      'tools.limitHint': '模型没指定行数时默认返回多少行（1-{max}）。',
      'tools.limitSaved': '默认行数已保存。',
        'sources.count': '已配置 {n} 个',
        'sources.empty.title': '还没有数据源',
        'sources.empty.body': '可以在这里新增，也可以直接导入这台机器上 DBeaver 已有的连接。AI 通过 MCP 工具查询真实数据，不会在这个页面里执行 SQL。',
        'sources.readonly': '只读',
        'sources.readwrite': '可写',
        'sources.default': '默认',
        'sources.hasPassword': '已存密码',
        'sources.noPassword': '无密码',
        'sources.writable': '可写 {names}',
        'sources.writableHint': '仅可写：{names}',
        'sources.secretBroken': '已存口令无法解密',
        'sources.neverProbed': '尚未测试',
        'sources.idChip': '标识符',
        'sources.idChipHint': '智能体调用 MCP 工具时，用 datasource 参数传这个标识符 · 点击复制',
        'sources.idCopied': '已复制',
        'form.edit': '编辑 {name}',
        'form.name': '显示名称',
        'form.id': '标识符',
        'form.idHint': '小写字母、数字和短横线，供 MCP 工具引用，创建后不可修改',
        'form.paste': '连接串',
        'form.pasteHintShort': '粘贴 JDBC URL、DSN 或 .db 文件路径，类型、主机、端口、库名和标识符都会自动带出。',
        'form.savePassword': '保存密码',
        'form.more': '更多设置',
        'form.moreHint': '名称、分组、标识符及数据库配置',
        'form.smart': '支持智能解析',
        'form.autoApply': '配置将自动生效并注册至本地 MCP 服务节点',
        'form.probeOk': '{name}：连接正常（{ms} ms）',
        'form.probeFail': '连接失败：',
        'form.probeUnknown': '无返回信息',
        'form.duplicate': '已经有一个数据源在用同一个地址和用户：{name}。直接用那一条即可，不必重复添加。',
        'form.userPlaceholder': '例如 root 或 postgres',
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
        'form.schemaAccess': '可写模式',
        'form.schemaAccessHint': '允许写入时才需要选择；读取不受限制',
        'form.allowDdl': '允许 DDL',
        'form.allowDdlHint': '允许此数据源在可写模式内执行 create、alter、drop、truncate',
        'form.schemaNames': '模式名',
        'form.schemaNamesHint': '用逗号分隔，例如 sales, billing',
        'form.schemaBroken': '已存口令无法再用当前密钥解密，请重新输入一次口令以按新密钥保存。',
        'form.invalid': '请先填写必填字段。',
        'form.requiredHint': '连接串、用户与口令都是必填项：填好之后再保存。',
        'import.body': '读取 DBeaver 工作区里的 data-sources.json；存在 credentials-config.json 时一并解密口令。',
        'import.empty': '这台机器上没有找到 DBeaver 连接。',
        'import.file': '文件',
        'import.credentialsFound': '已找到并解密',
        'import.already': '已添加',
        'import.alreadyAs': '已作为 {name} 添加',
        'import.searchPlaceholder': '按名称、主机或用户过滤',
        'import.noMatch': '没有匹配该过滤条件的 DBeaver 连接。',
        'import.matches': '{n} / {total}',
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
        'diag.scopes': '会话访问范围',
        'diag.scopesNone': '未设置：任何会话都能访问全部数据源',
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
        'audit.tz': '时间按本机时区显示（{zone}），日志文件里存的是 UTC。',
        'action.lockSource': '点击改为只读',
        'action.unlockSource': '点击允许写',
        'notice.nowReadOnly': '{name} 已改为只读。',
        'notice.nowWritable': '{name} 现在允许写。',
        'notice.nowWritableLocked': '{name} 现在允许写，但全局写开关还关着——到「运行时诊断」里打开它。',
        'notice.bulkNeedsSchemas': '这些数据源还没有指定可写模式。请逐个打开开关，选择允许写的模式。',
        'unlock.title': '{name} 可以写哪些模式？',
        'unlock.hint': '读取不受限制。点名其它模式的写语句会在到达数据库之前被拒绝。',
        'unlock.loading': '正在读取模式列表…',
        'unlock.error': '无法读取模式列表。',
        'unlock.retry': '重试',
        'unlock.none': '至少勾选一个模式。',
        'unlock.empty': '这个数据源没有报出任何模式。先测试一下连接，再回来试。',
        'unlock.selected': '已选 {n} 个',
        'unlock.confirm': '允许写',
        'unlock.cancel': '取消',
        'unlock.ddl': '同时允许 DDL（create / alter / drop）',
        'unlock.ddlHint': '关闭时表结构保持不变，只放行 insert、update、delete。无论开关如何，目标模式都必须在上方勾选的模式里。',
        'sources.ddl': '允许 DDL',
        'sources.ddlHint': '此数据源在其可写模式内接受 create、alter、drop。',
        'sources.ddlBlocked': '禁止 DDL',
        'sources.ddlBlockedHint': '此数据源接受 insert、update、delete，但拒绝 create、alter、drop。',
        'action.schema': '结构',
        'action.backToSources': '数据源',
        'tab.list': '数据源列表',
        'tab.create': '新建数据源',
        'tab.import': '从 DBeaver 导入',
        'tab.runtime': '运行时诊断',
        'tab.clients': '接入其它客户端',
      'tab.tools': '工具',
        'tab.audit': '审计日志',
        'header.backToChat': '返回会话',
        'form.group': '分组',
        'form.groupHint': '同一分组的数据源会列在一起',
        'group.unassigned': '未分组',
        'group.count': '{n} 个',
        'group.new': '新建分组',
        'group.newPlaceholder': '分组名称',
        'group.add': '新建',
        'group.renameHint': '双击重命名',
        'group.save': '保存',
        'group.cancel': '取消',
        'group.delete': '删除',
        'group.deleteConfirm': '确认删除分组？',
        'group.selectAll': '全选该分组的数据源',
        'group.dragHint': '拖到分组上即可移动',
        'group.empty': '把数据源拖到这里',
        'bulk.selected': '已选 {n} 个',
        'bulk.test': '批量测试',
        'bulk.readonly': '设为只读',
        'bulk.readwrite': '允许写',
        'bulk.group': '移动到分组',
        'bulk.groupPlaceholder': '分组名（留空表示清除）',
        'bulk.apply': '应用',
        'bulk.delete': '删除所选',
        'bulk.deleteConfirm': '确认删除 {n} 个',
        'bulk.clear': '清空',
        'notice.bulkDone': '已更新 {n} 个数据源。',
        'notice.bulkGrouped': '已把 {n} 个数据源移动到「{group}」。',
        'notice.groupSaved': '已保存分组「{name}」。',
        'notice.groupDeleted': '已删除分组「{name}」。',
        'notice.moved': '已移动到「{group}」。',
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
        'schema.matching': '匹配 {n} 个',
        'schema.search': '过滤表名',
        'schema.noMatch': '没有匹配的表。',
        'schema.defaultSchema': '默认模式',
        'schema.readonlyNote': '只读视图：这个页面不会执行任何 SQL。',
        'status.mcpOk': 'MCP 服务正常',
        'status.mcpDown': 'MCP 服务未就绪',
        'status.total': '总连接 {n}',
        'status.healthy': '{n} 正常',
        'status.failing': '{n} 异常',
        'status.failingNames': '({names})',
        'filter.all': '全部',
        'filter.failed': '仅看异常',
        'sources.searchPlaceholder': '搜索数据源…',
        'sources.noMatch': '没有符合条件的数据源。',
        'sources.failedLine': '连接失败：{message}',
        'group.expand': '展开该分组',
        'group.collapse': '折叠该分组',
        'action.copyError': '复制',
        'action.copied': '已复制',
        'action.copyErrorHint': '复制完整报错信息',
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
      .dbmcp-masthead {
        display: flex;
        align-items: baseline;
        flex-wrap: wrap;
        gap: 10px;
        margin: 0 0 4px;
      }
      .dbmcp-masthead h1 {
        margin: 0;
        font-size: 19px;
        font-weight: 600;
        letter-spacing: 0.01em;
        color: var(--dsw-alias-label-primary);
      }
      .dbmcp-masthead-spacer {
        flex: 1 1 auto;
      }
      .dbmcp-back {
        appearance: none;
        display: inline-flex;
        align-items: center;
        gap: 4px;
        border: 0;
        background: none;
        padding: 2px 6px 2px 0;
        font: inherit;
        font-size: 13px;
        color: var(--dsw-alias-label-secondary);
        cursor: pointer;
        border-radius: 6px;
      }
      .dbmcp-back:hover {
        color: var(--dsw-alias-label-primary);
      }
      .dbmcp-back-caret {
        font-size: 15px;
        line-height: 1;
      }
      .dbmcp-tabs {
        display: flex;
        align-items: stretch;
        gap: 22px;
        margin: 14px 0 0;
        border-bottom: 1px solid var(--dsw-alias-border-l1);
      }
      .dbmcp-tab {
        appearance: none;
        border: 0;
        background: none;
        padding: 0 0 9px;
        margin-bottom: -1px;
        font: inherit;
        font-size: 13px;
        line-height: 1.4;
        color: var(--dsw-alias-label-secondary);
        cursor: pointer;
        border-bottom: 2px solid transparent;
        white-space: nowrap;
      }
      .dbmcp-tab:hover {
        color: var(--dsw-alias-label-primary);
      }
      .dbmcp-tab.is-active {
        color: var(--dsw-alias-label-primary);
        font-weight: 500;
        border-bottom-color: var(--dsw-alias-brand-primary);
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
        margin: 16px 0 18px;
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
        padding: 4px 2px;
        font: inherit;
        color: var(--dsw-alias-brand-primary);
        cursor: pointer;
        border-radius: 4px;
        border-bottom: 2px solid transparent;
      }
      .dbmcp-crumb:hover {
        text-decoration: underline;
      }
      .dbmcp-crumb.is-current {
        color: var(--dsw-alias-label-primary);
        cursor: default;
        font-weight: 500;
        text-decoration: none;
        border-bottom-color: var(--dsw-alias-brand-primary);
      }
      .dbmcp-crumb-sep {
        color: var(--dsw-alias-label-secondary);
      }
      .dbmcp-title-switch {
        appearance: none;
        border: 0;
        background: none;
        padding: 0;
        font: inherit;
        color: inherit;
        cursor: pointer;
        border-radius: 4px;
      }
      .dbmcp-title-switch:hover {
        color: var(--dsw-alias-brand-primary);
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
      .dbmcp-btn.is-plain {
        border-color: transparent;
        background: transparent;
        color: var(--dsw-alias-label-secondary);
        padding: 3px 8px;
      }
      .dbmcp-btn.is-plain:hover:not(:disabled) {
        border-color: transparent;
        background: var(--dsw-alias-bg-layer-2);
        color: var(--dsw-alias-label-primary);
      }
      .dbmcp-btn.is-plain.is-danger {
        color: var(--dsw-alias-state-error-primary);
      }
      .dbmcp-btn.is-plain.is-danger:hover:not(:disabled) {
        background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 12%, transparent);
        color: var(--dsw-alias-state-error-primary);
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
      /* An anchor styled as a pill: the star sits next to the connection state,
         and the whole thing is a link out to the repository. */
      a.dbmcp-pill.dbmcp-star {
        text-decoration: none;
        cursor: pointer;
        transition: color 120ms ease, border-color 120ms ease;
      }
      a.dbmcp-pill.dbmcp-star:hover {
        color: var(--dsw-alias-brand-primary);
        border-color: var(--dsw-alias-brand-primary);
      }
      /* The star glyph carries the meaning; the word stays so the pill still
         reads as a link when the glyph is missing from the font. */
      .dbmcp-star-mark {
        font-size: 13px;
        line-height: 1;
      }
      /* A row used to carry half a dozen bordered pills, one of which was the
         only thing that could be clicked and looked exactly like the rest. The
         state words are plain text now; the switch below is the only chrome on
         the row, so what can be operated is what looks operable. */
      .dbmcp-note {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        border: 0;
        padding: 0;
        font-size: 12px;
        font-weight: 400;
        color: var(--dsw-alias-label-secondary);
      }
      .dbmcp-note.is-writable {
        color: var(--dsw-alias-brand-primary);
      }
      .dbmcp-note.is-broken {
        color: var(--dsw-alias-state-warn-primary);
      }
      /* DDL on a writable source is the widest permission the panel hands out,
         so it reads differently from "writable" and its opposite is visible
         too: the row should say which of the two is in force, not stay silent. */
      .dbmcp-note.is-ddl {
        color: var(--dsw-alias-brand-primary);
        font-weight: 600;
      }
      .dbmcp-note.is-ddl-off {
        color: var(--dsw-alias-label-secondary);
      }
      .dbmcp-item-name .dbmcp-note + .dbmcp-note::before {
        content: '·';
        margin-right: 2px;
        color: var(--dsw-alias-border-l1);
      }
      /* The read-only / writable flip. A 22x12 track reads as a control at a
         glance, which is the one thing a pill with a status word on it never
         did — the word beside it still spells out which way the switch is. */
      .dbmcp-switch {
        display: inline-flex;
        align-items: center;
        gap: 7px;
        flex: 0 0 auto;
        padding: 0;
        border: 0;
        background: transparent;
        font-family: inherit;
        font-size: 12px;
        font-weight: 400;
        color: var(--dsw-alias-label-secondary);
        cursor: pointer;
      }
      .dbmcp-switch-track {
        position: relative;
        flex: 0 0 auto;
        width: 22px;
        height: 12px;
        border-radius: 999px;
        background: color-mix(in srgb, var(--dsw-alias-label-secondary) 40%, transparent);
        transition: background 140ms ease;
      }
      .dbmcp-switch-knob {
        position: absolute;
        top: 2px;
        left: 2px;
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: var(--dsw-alias-bg-base);
        transition: transform 140ms ease;
      }
      .dbmcp-switch:hover:not(:disabled),
      .dbmcp-switch.is-on {
        color: var(--dsw-alias-brand-primary);
      }
      .dbmcp-switch.is-on .dbmcp-switch-track {
        background: var(--dsw-alias-brand-primary);
      }
      .dbmcp-switch.is-on .dbmcp-switch-knob {
        transform: translateX(10px);
      }
      .dbmcp-switch:disabled {
        cursor: default;
        opacity: 0.55;
      }
      .dbmcp-switch:focus-visible .dbmcp-switch-track {
        outline: 2px solid var(--dsw-alias-brand-primary);
        outline-offset: 2px;
      }
      .dbmcp-hint.is-warn {
        color: var(--dsw-alias-state-warn-primary);
      }
      /* The identifier is the handle every MCP tool takes as its datasource
         argument, so it gets a chip of its own instead of trailing the target
         string: the label says what it is, the mono value is what gets pasted
         into chat. */
      .dbmcp-idchip {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        max-width: 100%;
        padding: 1px 9px;
        border: 1px solid color-mix(in srgb, var(--dsw-alias-brand-primary) 32%, transparent);
        border-radius: 999px;
        background: color-mix(in srgb, var(--dsw-alias-brand-primary) 8%, transparent);
        color: var(--dsw-alias-brand-primary);
        font-family: inherit;
        font-size: 11px;
        line-height: 1.6;
        cursor: pointer;
        transition: border-color 120ms ease, background 120ms ease, color 120ms ease;
      }
      .dbmcp-idchip:hover {
        border-color: var(--dsw-alias-brand-primary);
        background: color-mix(in srgb, var(--dsw-alias-brand-primary) 14%, transparent);
      }
      .dbmcp-idchip-key {
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.02em;
        text-transform: uppercase;
        opacity: 0.75;
        white-space: nowrap;
      }
      .dbmcp-idchip-value {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 12px;
        font-weight: 600;
      }
      .dbmcp-idchip.is-copied {
        border-color: color-mix(in srgb, var(--dsw-alias-state-success-primary) 55%, transparent);
        background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 10%, transparent);
        color: var(--dsw-alias-state-success-primary);
      }
      .dbmcp-idchip-mark {
        font-size: 11px;
        line-height: 1;
      }
      .dbmcp-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
        gap: 16px;
        align-items: start;
      }
      .dbmcp-grid.is-single {
        grid-template-columns: minmax(0, 1fr);
      }
      .dbmcp-card {
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 12px;
        background: var(--dsw-alias-bg-layer-1);
        padding: 8px 12px 10px;
        min-width: 0;
      }
      .dbmcp-audit-list {
        display: flex;
        flex-direction: column;
        gap: 3px;
      }
      .dbmcp-audit {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 6px;
        padding: 3px 8px;
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 8px;
        background: var(--dsw-alias-bg-layer-1);
        font-size: 13px;
        min-width: 0;
      }
      .dbmcp-audit-time {
        color: var(--dsw-alias-label-secondary);
        font-variant-numeric: tabular-nums;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 12px;
        white-space: nowrap;
      }
      .dbmcp-audit-tool {
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 12px;
        color: var(--dsw-alias-label-primary);
        padding: 1px 7px;
        border-radius: 999px;
        border: 1px solid var(--dsw-alias-border-l1);
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
        /* The panel is a sidebar, so its own width — not the viewport's — decides
           whether two columns still fit. The wrapper is the container because an
           element cannot answer a query about its own size. */
        container-type: inline-size;
      }
      .dbmcp-schema {
        display: grid;
        grid-template-columns: minmax(160px, 220px) minmax(0, 1fr);
        gap: 18px;
        align-items: start;
      }
      /* One column when the panel is narrow: the rail keeps its own scroll box
         above the column list instead of squeezing the names to two characters. */
      @container (max-width: 560px) {
        .dbmcp-schema {
          grid-template-columns: minmax(0, 1fr);
        }
        .dbmcp-schema-groups {
          max-height: 300px;
        }
      }
      .dbmcp-schema-side {
        display: flex;
        flex-direction: column;
        gap: 8px;
        min-width: 0;
        padding: 12px;
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 10px;
        background: var(--dsw-alias-bg-layer-1);
      }
      .dbmcp-schema-main {
        min-width: 0;
      }
      /* Sub-view header row: where you came from, which connection it is, and
         the identifier to hand to the agent — all on one line. */
      .dbmcp-view-bar {
        display: flex;
        align-items: center;
        gap: 10px;
        flex-wrap: wrap;
        min-width: 0;
        margin-bottom: 12px;
      }
      .dbmcp-view-target {
        min-width: 0;
        color: var(--dsw-alias-label-secondary);
        font-size: 12px;
        word-break: break-all;
      }
      .dbmcp-schema-head {
        display: flex;
        align-items: baseline;
        gap: 10px;
        font-size: 12px;
        font-weight: 600;
        color: var(--dsw-alias-label-secondary);
      }
      /* The qualified name of the open table: the same truncation rule as the
         rail, so a long name cannot push the column count out of the card. */
      .dbmcp-schema-title {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: var(--dsw-alias-label-primary);
      }
      .dbmcp-schema-head .dbmcp-hint {
        flex: 0 0 auto;
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
      .dbmcp-schema-groups {
        display: flex;
        flex-direction: column;
        gap: 10px;
        max-height: 460px;
        overflow: auto;
      }
      .dbmcp-schema-group {
        display: flex;
        flex-direction: column;
        gap: 4px;
        min-width: 0;
      }
      .dbmcp-schema-group-head {
        display: flex;
        align-items: center;
        gap: 6px;
        width: 100%;
        padding: 4px 6px;
        border: 0;
        border-radius: 6px;
        background: transparent;
        color: var(--dsw-alias-label-secondary);
        font: inherit;
        font-size: 12px;
        font-weight: 600;
        text-align: left;
        cursor: pointer;
      }
      .dbmcp-schema-group-head:hover {
        background: var(--dsw-alias-bg-layer-1);
      }
      .dbmcp-schema-caret {
        width: 12px;
        flex: 0 0 auto;
        color: var(--dsw-alias-label-secondary);
      }
      .dbmcp-schema-group-name {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .dbmcp-schema-table {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        width: 100%;
        padding: 6px 8px;
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 8px;
        background: var(--dsw-alias-bg-base);
        color: var(--dsw-alias-label-primary);
        font: inherit;
        font-size: 13px;
        text-align: left;
        cursor: pointer;
      }
      /* A GaussDB catalog hands out names like
         global_plancache_status_global_recovery_status — longer than the rail is
         wide. The name gets the room, truncates with an ellipsis, and keeps the
         full value in its title; the kind pill never shrinks. */
      .dbmcp-schema-name {
        min-width: 0;
        flex: 1 1 auto;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .dbmcp-schema-table .dbmcp-pill {
        flex: 0 0 auto;
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
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 10px;
        overflow: hidden;
      }
      .dbmcp-schema-tablegrid th,
      .dbmcp-schema-tablegrid td {
        text-align: left;
        padding: 4px 8px;
        border-bottom: 1px solid var(--dsw-alias-border-l1);
        vertical-align: top;
      }
      .dbmcp-schema-tablegrid tr:last-child td {
        border-bottom: none;
      }
      .dbmcp-schema-tablegrid th {
        font-weight: 600;
        font-size: 12px;
        color: var(--dsw-alias-label-secondary);
        background: var(--dsw-alias-bg-layer-1);
      }
      .dbmcp-schema-note {
        margin-top: 10px;
      }
      .dbmcp-mono {
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 12px;
      }
      .dbmcp-endpoint {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
        margin: 6px 0 10px;
      }
      .dbmcp-endpoint-url {
        flex: 1 1 240px;
        min-width: 0;
        padding: 5px 10px;
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 8px;
        background: var(--dsw-alias-bg-layer-1);
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 12px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .dbmcp-port {
        flex: 0 0 92px;
        width: 92px;
      }
      .dbmcp-clients {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .dbmcp-client {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 5px 8px;
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 8px;
        background: var(--dsw-alias-bg-layer-1);
      }
      .dbmcp-client-main {
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
        flex: 1 1 auto;
      }
      .dbmcp-client-name {
        font-size: 13px;
        font-weight: 500;
      }
      .dbmcp-client-main .dbmcp-hint {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .dbmcp-tools-head {
        display: flex;
        align-items: baseline;
        gap: 10px;
        margin: 14px 0 6px;
        flex-wrap: wrap;
      }
      .dbmcp-tools-title {
        margin: 0;
        font-size: 13px;
        font-weight: 600;
        color: var(--dsw-alias-label-primary);
      }
      .dbmcp-tools {
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      .dbmcp-tool {
        display: flex;
        align-items: flex-start;
        gap: 8px;
        padding: 5px 8px;
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 8px;
        background: var(--dsw-alias-bg-layer-1);
        cursor: pointer;
        min-width: 0;
      }
      .dbmcp-tool:hover {
        background: var(--dsw-alias-bg-layer-2);
      }
      .dbmcp-tool.is-off {
        opacity: 0.6;
      }
      .dbmcp-tool-pick {
        margin: 2px 0 0;
        flex: 0 0 auto;
      }
          .dbmcp-tool-limit {
        flex: 0 0 96px;
        display: inline-flex;
        align-items: center;
        justify-content: flex-end;
        gap: 6px;
        margin-left: auto;
      }
      .dbmcp-tool-limit .dbmcp-limit {
        width: 72px;
        padding: 3px 6px;
        font-size: 12px;
        text-align: center;
        font-variant-numeric: tabular-nums;
      }
      .dbmcp-limit-unit { font-size: 12px; color: var(--dsw-alias-label-secondary); }
  .dbmcp-tool-main {
        display: flex;
        flex-direction: column;
        gap: 1px;
        min-width: 0;
        flex: 1 1 auto;
      }
      .dbmcp-tool-name {
        font-family: var(--dbmcp-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
        font-size: 12px;
        color: var(--dsw-alias-label-primary);
      }
      .dbmcp-tool-desc {
        font-size: 12px;
        color: var(--dsw-alias-label-secondary);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .dbmcp-card-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        margin-bottom: 6px;
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
        display: flex;
        flex-direction: column;
        gap: 3px;
        font-size: 13px;
        line-height: 1.5;
      }
      .dbmcp-scope-list {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        min-width: 0;
      }
      .dbmcp-scope {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 1px 8px;
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 8px;
        background: var(--dsw-alias-bg-base);
        min-width: 0;
      }
      .dbmcp-scope-id {
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 12px;
        color: var(--dsw-alias-label-secondary);
      }
      .dbmcp-row {
        display: grid;
        grid-template-columns: 116px minmax(0, 1fr);
        column-gap: 10px;
        align-items: baseline;
        padding: 3px 8px;
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 8px;
        background: var(--dsw-alias-bg-layer-1);
        min-width: 0;
      }
      .dbmcp-k {
        color: var(--dsw-alias-label-secondary);
      }
      .dbmcp-v {
        color: var(--dsw-alias-label-primary);
        word-break: break-all;
      }
      /* A value made of text plus a control needs its own breathing room. */
      .dbmcp-inline {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 10px;
        min-width: 0;
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
        gap: 3px;
        margin: 0;
        padding: 0;
        list-style: none;
      }
      .dbmcp-item {
        display: flex;
        flex-direction: column;
        gap: 4px;
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 10px;
        background: var(--dsw-alias-bg-layer-2);
        padding: 5px 8px;
        font-size: 13px;
      }
      .dbmcp-item-row {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 10px;
      }
      .dbmcp-grip {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 18px;
        height: 26px;
        flex: 0 0 18px;
        padding: 0;
        border: none;
        background: transparent;
        cursor: grab;
        user-select: none;
        border-radius: 4px;
      }
      .dbmcp-grip-dots {
        display: block;
        width: 12px;
        height: 15px;
        background-image: radial-gradient(circle, currentColor 1.5px, transparent 1.6px);
        background-size: 6px 5px;
        background-position: 0 0;
        background-repeat: repeat;
        color: var(--dsw-alias-label-secondary);
        opacity: 0.45;
      }
      .dbmcp-grip:hover .dbmcp-grip-dots {
        opacity: 0.85;
      }
      .dbmcp-grip:active {
        cursor: grabbing;
      }
      .dbmcp-kind-badge {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 30px;
        height: 30px;
        flex: 0 0 30px;
        border-radius: 9px;
        border: 1px solid var(--dsw-alias-border-l1);
        background: var(--dsw-alias-bg-layer-2);
        color: var(--dsw-alias-label-primary);
        font-size: 10px;
        font-weight: 700;
        line-height: 1;
        letter-spacing: 0.02em;
        text-transform: uppercase;
        overflow: hidden;
      }
      .dbmcp-item.is-failed {
        border-color: var(--dsw-alias-state-error-primary);
        border-left-width: 3px;
        background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 8%, var(--dsw-alias-bg-layer-2));
      }
      .dbmcp-item-failure {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
        color: var(--dsw-alias-state-error-primary);
      }
      .dbmcp-fail-tri {
        flex: 0 0 auto;
        font-size: 13px;
        line-height: 1;
      }
      .dbmcp-fail-text {
        flex: 1 1 260px;
        min-width: 0;
        font-size: 12px;
        overflow-wrap: anywhere;
      }
      .dbmcp-status {
        display: flex;
        flex-direction: column;
        gap: 4px;
        margin-bottom: 6px;
        padding: 5px 10px;
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 10px;
        background: var(--dsw-alias-bg-layer-1);
      }
      .dbmcp-status-row {
        display: flex;
        align-items: center;
        gap: 6px;
        flex-wrap: wrap;
        font-size: 12px;
        min-height: 24px;
      }
      .dbmcp-status-row.is-filters {
        gap: 12px;
      }
      .dbmcp-stats {
        display: inline-flex;
        align-items: center;
        gap: 14px;
        padding: 4px 14px;
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 999px;
        color: var(--dsw-alias-label-secondary);
        white-space: nowrap;
      }
      .dbmcp-stat {
        display: inline-flex;
        align-items: center;
        gap: 6px;
      }
      .dbmcp-stat::before {
        content: none;
      }
      .dbmcp-stat.is-ok::before,
      .dbmcp-stat.is-error::before {
        content: '';
        width: 6px;
        height: 6px;
        flex: 0 0 6px;
        border-radius: 50%;
        background: currentColor;
      }
      .dbmcp-stat.is-ok {
        color: var(--dsw-alias-state-success-primary);
      }
      .dbmcp-stat.is-error {
        color: var(--dsw-alias-state-error-primary);
      }
      .dbmcp-stat-sep {
        width: 1px;
        height: 11px;
        background: var(--dsw-alias-border-l2);
      }
      .dbmcp-status-spacer {
        flex: 1 1 auto;
      }
      .dbmcp-status-label {
        font-weight: 600;
        color: var(--dsw-alias-label-primary);
      }
      .dbmcp-status-sep {
        width: 1px;
        height: 12px;
        background: var(--dsw-alias-border-l2);
      }
      .dbmcp-status-dot {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        color: var(--dsw-alias-label-secondary);
      }
      .dbmcp-status-dot::before {
        content: '';
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: currentColor;
      }
      .dbmcp-status-dot.is-ok {
        color: var(--dsw-alias-state-success-primary);
      }
      .dbmcp-status-dot.is-error {
        color: var(--dsw-alias-state-error-primary);
      }
      .dbmcp-chips {
        display: flex;
        align-items: center;
        gap: 10px;
        flex-wrap: wrap;
      }
      .dbmcp-chip-icon {
        font-size: 12px;
        line-height: 1;
      }
      .dbmcp-chip {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 999px;
        background: transparent;
        color: var(--dsw-alias-label-secondary);
        font-family: inherit;
        font-size: 12px;
        padding: 4px 13px;
        cursor: pointer;
        transition: color 120ms ease, border-color 120ms ease, background 120ms ease;
      }
      .dbmcp-chip:hover {
        color: var(--dsw-alias-label-primary);
        border-color: var(--dsw-alias-label-secondary);
      }
      .dbmcp-chip.is-active {
        background: var(--dsw-alias-label-primary);
        border-color: var(--dsw-alias-label-primary);
        color: var(--dsw-alias-bg-base);
      }
      .dbmcp-chip.is-warn {
        color: var(--dsw-alias-state-error-primary);
        border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 35%, transparent);
      }
      .dbmcp-chip.is-warn.is-active {
        background: var(--dsw-alias-state-error-primary);
        border-color: var(--dsw-alias-state-error-primary);
        color: var(--dsw-alias-bg-base);
      }
      .dbmcp-chip-count {
        opacity: 0.7;
      }
      .dbmcp-status-search {
        flex: 0 0 auto;
        width: 300px;
        max-width: 100%;
      }
      .dbmcp-status-search .dbmcp-input {
        width: 100%;
      }
      .dbmcp-item.is-selected {
        border-color: var(--dsw-alias-brand-primary);
        background: var(--dsw-alias-bg-layer-1);
      }
      .dbmcp-item-pick {
        display: flex;
        align-items: center;
        padding-top: 2px;
        cursor: pointer;
      }
      .dbmcp-item-pick input {
        width: 14px;
        height: 14px;
        accent-color: var(--dsw-alias-brand-primary);
        cursor: pointer;
      }
      .dbmcp-groups {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .dbmcp-group {
        display: flex;
        flex-direction: column;
        gap: 3px;
      }
      .dbmcp-group-head {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 0 2px;
      }
      .dbmcp-group-name {
        font-size: 12px;
        font-weight: 600;
        color: var(--dsw-alias-label-primary);
        letter-spacing: 0.02em;
      }
      .dbmcp-card-head > .dbmcp-pill {
        margin-left: auto;
      }
      .dbmcp-list-head {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
        margin-bottom: 6px;
      }
      .dbmcp-list-head .dbmcp-card-title {
        margin-right: 4px;
      }
      .dbmcp-list-spacer {
        flex: 1 1 auto;
      }
      .dbmcp-fold {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 14px;
        height: 18px;
        flex: 0 0 14px;
        padding: 0;
        border: none;
        border-radius: 4px;
        background: transparent;
        color: var(--dsw-alias-label-secondary);
        cursor: pointer;
      }
      .dbmcp-fold::before {
        content: '';
        display: block;
        width: 0;
        height: 0;
        border-style: solid;
        border-width: 4.5px 0 4.5px 6.5px;
        border-color: transparent transparent transparent currentColor;
        transition: transform 130ms ease;
      }
      .dbmcp-fold:hover {
        color: var(--dsw-alias-label-primary);
      }
      .dbmcp-fold.is-open::before {
        transform: rotate(90deg);
      }
      .dbmcp-card-actions {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-left: 4px;
      }
      .dbmcp-group-actions {
        display: flex;
        align-items: center;
        gap: 4px;
        margin-left: auto;
      }
      .dbmcp-group-edit {
        display: flex;
        align-items: center;
        gap: 6px;
        flex: 0 1 auto;
      }
      .dbmcp-group-edit .dbmcp-input {
        width: 170px;
      }
      .dbmcp-group-edit .dbmcp-btn,
      .dbmcp-item-rename .dbmcp-btn {
        flex: 0 0 auto;
        white-space: nowrap;
        padding: 3px 10px;
      }
      .dbmcp-group.is-over {
        outline: 1px dashed var(--dsw-alias-brand-primary);
        outline-offset: 3px;
        border-radius: 6px;
      }
      .dbmcp-item.is-dragging {
        opacity: 0.55;
      }
      .dbmcp-item.is-drop-before {
        box-shadow: 0 -2px 0 0 var(--dsw-alias-brand-primary);
      }
      .dbmcp-item.is-drop-after {
        box-shadow: 0 2px 0 0 var(--dsw-alias-brand-primary);
      }
      .dbmcp-item.is-taken {
        opacity: 0.6;
      }
      .dbmcp-item {
        cursor: default;
      }
      .dbmcp-item.is-selected {
        cursor: default;
      }
      .dbmcp-group-create {
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .dbmcp-group-create .dbmcp-input {
        width: 170px;
        max-width: 220px;
      }
      .dbmcp-group-pick {
        width: 14px;
        height: 14px;
        accent-color: var(--dsw-alias-brand-primary);
        cursor: pointer;
      }
      .dbmcp-bulk {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 8px;
        margin-bottom: 6px;
        padding: 4px 8px;
        border: 1px solid var(--dsw-alias-brand-primary);
        border-radius: 10px;
        background: var(--dsw-alias-bg-layer-1);
      }
      .dbmcp-bulk-count {
        font-size: 12px;
        font-weight: 600;
        color: var(--dsw-alias-brand-primary);
      }
      .dbmcp-bulk-group {
        display: flex;
        align-items: center;
        gap: 6px;
        flex: 1 1 220px;
        min-width: 220px;
      }
      .dbmcp-bulk-group .dbmcp-input {
        flex: 1 1 auto;
        min-width: 120px;
      }
      .dbmcp-bulk .dbmcp-btn {
        flex: 0 0 auto;
        white-space: nowrap;
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
      .dbmcp-item-meta {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
        min-width: 0;
        margin-top: 3px;
      }
      .dbmcp-item-target {
        color: var(--dsw-alias-label-secondary);
        font-size: 12px;
        word-break: break-all;
        margin-top: 2px;
      }
      .dbmcp-item-meta > .dbmcp-item-target {
        margin-top: 0;
      }
      .dbmcp-item-name > .is-renamable,
      .dbmcp-group-name.is-renamable {
        cursor: text;
      }
      .dbmcp-item-rename {
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .dbmcp-item-rename .dbmcp-input {
        flex: 0 0 200px;
        width: 200px;
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
      .dbmcp-form.is-page {
        display: flex;
        flex-direction: column;
        gap: 8px;
        width: 100%;
        max-width: none;
        box-sizing: border-box;
        font-size: 13px;
      }
      .dbmcp-form-section {
        display: flex;
        flex-direction: column;
        gap: 8px;
        min-width: 0;
      }
      .dbmcp-form-section.is-two,
      .dbmcp-form-section.is-three {
        display: grid;
        gap: 16px;
        align-items: start;
      }
      .dbmcp-form-section.is-two {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
      .dbmcp-form-section.is-three {
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }
      .dbmcp-form-cell {
        display: flex;
        flex-direction: column;
        gap: 6px;
        min-width: 0;
      }
      .dbmcp-form-head {
        display: flex;
        align-items: center;
        gap: 10px;
        min-height: 20px;
      }
      .dbmcp-form-head .dbmcp-check {
        margin-left: auto;
        font-size: 12px;
        color: var(--dsw-alias-label-secondary);
      }
      .dbmcp-form-label {
        color: var(--dsw-alias-label-primary);
        font-size: 13px;
        font-weight: 500;
      }
      .dbmcp-form-note {
        display: flex;
        align-items: flex-start;
        gap: 6px;
        margin: 0;
        font-size: 12px;
        line-height: 1.5;
        color: var(--dsw-alias-label-secondary);
      }
      .dbmcp-form-mark {
        flex: none;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 14px;
        height: 14px;
        margin-top: 1px;
        border: 1px solid var(--dsw-alias-border-l2);
        border-radius: 50%;
        font-size: 9px;
        font-style: normal;
        line-height: 1;
        text-transform: lowercase;
        color: var(--dsw-alias-label-secondary);
      }
      .dbmcp-tag {
        margin-left: auto;
        border: 1px solid color-mix(in srgb, var(--dsw-alias-brand-primary) 35%, transparent);
        border-radius: 6px;
        background: color-mix(in srgb, var(--dsw-alias-brand-primary) 10%, transparent);
        color: var(--dsw-alias-brand-primary);
        font-size: 11px;
        line-height: 1;
        padding: 4px 8px;
        white-space: nowrap;
      }
      .dbmcp-form.is-page .dbmcp-input,
      .dbmcp-form.is-page .dbmcp-select {
        padding: 8px 10px;
      }
      .dbmcp-form.is-page .dbmcp-input::placeholder {
        color: var(--dsw-alias-label-secondary);
        opacity: 0.75;
      }
      .dbmcp-form-inner {
        display: flex;
        flex-direction: column;
        gap: 18px;
        padding: 2px 2px 0;
      }
      .dbmcp-advanced.is-page {
        background: transparent;
        padding: 0;
      }
      .dbmcp-advanced.is-page > summary {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 6px 10px;
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 8px;
        font-size: 13px;
      }
      .dbmcp-advanced.is-page[open] > summary {
        margin-bottom: 16px;
      }
      .dbmcp-advanced-title {
        color: var(--dsw-alias-label-primary);
        font-weight: 500;
      }
      .dbmcp-advanced-hint {
        margin-left: auto;
        font-size: 12px;
        color: var(--dsw-alias-label-secondary);
        font-weight: 400;
      }
      .dbmcp-readonly {
        display: flex;
        flex-direction: column;
        gap: 4px;
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 8px;
        background: var(--dsw-alias-bg-layer-2);
        padding: 12px 14px;
      }
      .dbmcp-readonly .dbmcp-check {
        font-size: 13px;
      }
      .dbmcp-readonly .dbmcp-hint {
        padding-left: 24px;
      }
      /* Schema policy sits next to the read-only switch: both narrow what the
         agent may do, so they share one bordered block instead of looking like
         two unrelated fields. */
      .dbmcp-policy {
        display: flex;
        flex-direction: column;
        gap: 12px;
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 8px;
        background: var(--dsw-alias-bg-layer-2);
        padding: 12px 14px;
      }
      .dbmcp-policy-head {
        display: flex;
        align-items: baseline;
        gap: 10px;
        flex-wrap: wrap;
      }
      .dbmcp-policy .dbmcp-form-section {
        gap: 12px;
      }
      .dbmcp-policy .dbmcp-hint {
        font-size: 12px;
      }
      /* Unlock dialog: the one question asked before a source may accept
         writes. It sits over the panel rather than in a tab, because the
         answer decides what the write guard will let through afterwards. */
      .dbmcp-unlock {
        position: fixed;
        inset: 0;
        z-index: 40;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 24px;
        background: rgba(8, 10, 14, 0.45);
      }
      .dbmcp-unlock-card {
        display: flex;
        flex-direction: column;
        gap: 12px;
        width: min(520px, 100%);
        max-height: min(80vh, 640px);
        overflow: auto;
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 10px;
        background: var(--dsw-alias-bg-layer-1);
        box-shadow: 0 18px 48px rgba(0, 0, 0, 0.32);
        padding: 16px 18px;
      }
      .dbmcp-unlock-head {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .dbmcp-unlock-title {
        font-size: 14px;
        font-weight: 600;
        color: var(--dsw-alias-label-primary);
      }
      .dbmcp-unlock-list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 2px;
        max-height: 260px;
        overflow: auto;
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 8px;
        padding: 6px;
      }
      .dbmcp-unlock-row {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 4px 6px;
        border-radius: 6px;
        font-size: 12px;
        color: var(--dsw-alias-label-primary);
        cursor: pointer;
      }
      .dbmcp-unlock-row:hover {
        background: var(--dsw-alias-bg-layer-2);
      }
      .dbmcp-unlock-row:disabled {
        cursor: default;
        opacity: 0.7;
      }
      .dbmcp-unlock-name {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .dbmcp-unlock-foot {
        display: flex;
        align-items: center;
        gap: 8px;
        justify-content: flex-end;
        flex-wrap: wrap;
      }
      .dbmcp-unlock-foot .dbmcp-hint {
        margin-right: auto;
      }
      /* The DDL switch sits between the schema list and the footer: it is the
         second half of the same answer, so it reads as one block with the list. */
      .dbmcp-unlock-ddl {
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding: 10px 12px;
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 8px;
        background: var(--dsw-alias-bg-layer-2);
      }
      .dbmcp-unlock-ddl .dbmcp-hint {
        font-size: 12px;
        padding-left: 22px;
      }
      .dbmcp-help {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 14px;
        height: 14px;
        border: 1px solid var(--dsw-alias-border-l2);
        border-radius: 50%;
        font-size: 9px;
        line-height: 1;
        color: var(--dsw-alias-label-secondary);
        cursor: help;
      }
      .dbmcp-btn.is-save {
        min-width: 104px;
        padding: 8px 18px;
      }
      .dbmcp-form-foot-hint {
        margin-left: auto;
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
      .dbmcp-input.is-invalid {
        border-color: var(--dsw-alias-state-error-primary);
      }
      .dbmcp-input.is-invalid:focus {
        border-color: var(--dsw-alias-state-error-primary);
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
      .dbmcp-scan-bar {
        position: sticky;
        top: 0;
        z-index: 2;
        display: flex;
        align-items: center;
        gap: 10px;
        flex-wrap: wrap;
        margin: 0 0 14px;
        padding: 10px 12px;
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 10px;
        background: var(--dsw-alias-bg-layer-1);
      }
      .dbmcp-scan-bar .dbmcp-input {
        flex: 1 1 240px;
        min-width: 180px;
      }
      .dbmcp-scan-bar .dbmcp-btn {
        margin-left: auto;
        flex: 0 0 auto;
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

    /* ---------- theme-aware solid surfaces ----------
       A custom theme may paint translucent surfaces over a wallpaper: cards then
       dissolve into the picture and labels lose contrast. Re-derive solid
       equivalents of the alias tokens from the active palette and overlay them
       on the panel subtree, so the panel reads the same on white, black and
       wallpapered themes. */

    let themeService = null
    const themeSubs = new Set()
    const NO_PALETTE = Object.freeze({})
    let paletteCache = NO_PALETTE
    let paletteKey = ''

    function parseColor(value) {
      if (typeof value !== 'string') return null
      const text = value.trim()
      let match = /^#([0-9a-f]{3,8})$/i.exec(text)
      if (match) {
        let hex = match[1]
        if (hex.length === 3 || hex.length === 4) hex = hex.split('').map((part) => part + part).join('')
        if (hex.length !== 6 && hex.length !== 8) return null
        return {
          r: parseInt(hex.slice(0, 2), 16),
          g: parseInt(hex.slice(2, 4), 16),
          b: parseInt(hex.slice(4, 6), 16),
          a: hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1,
        }
      }
      match = /^rgba?\(([^)]+)\)$/i.exec(text)
      if (!match) return null
      const parts = match[1].split(/[\s,/]+/).filter(Boolean).map(Number)
      if (parts.length < 3 || parts.slice(0, 3).some((item) => !Number.isFinite(item))) return null
      const alpha = parts.length > 3 && Number.isFinite(parts[3]) ? parts[3] : 1
      return { r: parts[0], g: parts[1], b: parts[2], a: Math.max(0, Math.min(1, alpha)) }
    }

    function composite(color, base) {
      const alpha = Math.max(0, Math.min(1, color.a))
      return {
        r: color.r * alpha + base.r * (1 - alpha),
        g: color.g * alpha + base.g * (1 - alpha),
        b: color.b * alpha + base.b * (1 - alpha),
        a: 1,
      }
    }

    function mixColor(from, to, weight) {
      return {
        r: from.r + (to.r - from.r) * weight,
        g: from.g + (to.g - from.g) * weight,
        b: from.b + (to.b - from.b) * weight,
        a: 1,
      }
    }

    function drift(a, b) {
      return Math.max(Math.abs(a.r - b.r), Math.abs(a.g - b.g), Math.abs(a.b - b.b))
    }

    function toCss(color) {
      const channel = (value) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0')
      return '#' + channel(color.r) + channel(color.g) + channel(color.b)
    }

    function paletteOf(snapshot) {
      const active = (snapshot && snapshot.active) || {}
      const tokens = active.tokens || {}
      const dark = active.colorScheme === 'dark'
      const floor = dark ? { r: 12, g: 12, b: 14, a: 1 } : { r: 255, g: 255, b: 255, a: 1 }
      const token = (name) => parseColor(tokens[name])

      const baseRaw = token('--dsw-alias-bg-base')
      const canvas = baseRaw ? composite(baseRaw, floor) : floor

      const layerRaw = token('--dsw-alias-bg-layer-1')
      let surface = layerRaw ? composite(layerRaw, canvas) : canvas
      const layer2Raw = token('--dsw-alias-bg-layer-2')
      let surface2 = layer2Raw ? composite(layer2Raw, surface) : surface

      const inkRaw = token('--dsw-alias-label-primary') || (dark ? { r: 232, g: 232, b: 236, a: 1 } : { r: 26, g: 26, b: 30, a: 1 })
      const ink = composite(inkRaw, canvas)

      /* On a pure black or pure white scheme the theme's layers collapse onto the
         canvas; lift them a little so cards still separate from the page. */
      if (drift(surface, canvas) < 8) surface = mixColor(canvas, ink, dark ? 0.14 : 0.05)
      if (drift(surface2, surface) < 8) surface2 = mixColor(surface, ink, dark ? 0.2 : 0.07)

      const secondRaw = token('--dsw-alias-label-secondary')
      const ink2 = secondRaw ? composite(secondRaw, surface) : mixColor(surface, ink, 0.45)

      const lineRaw = token('--dsw-alias-border-l1')
      let line = lineRaw ? composite(lineRaw, surface) : mixColor(surface, ink, 0.16)
      if (drift(line, surface) < 10) line = mixColor(surface, ink, 0.18)
      const line2Raw = token('--dsw-alias-border-l2')
      let line2 = line2Raw ? composite(line2Raw, surface2) : mixColor(surface2, ink, 0.24)
      if (drift(line2, surface2) < 10) line2 = mixColor(surface2, ink, 0.26)

      const accent = (name, fallback) => {
        const raw = token(name)
        if (!raw) return fallback
        return raw.a >= 0.999 ? raw : composite(raw, surface)
      }

      return {
        '--dsw-alias-bg-base': toCss(canvas),
        '--dsw-alias-bg-layer-1': toCss(surface),
        '--dsw-alias-bg-layer-2': toCss(surface2),
        '--dsw-alias-bg-overlay': toCss(surface2),
        '--dsw-alias-border-l1': toCss(line),
        '--dsw-alias-border-l2': toCss(line2),
        '--dsw-alias-label-primary': toCss(ink),
        '--dsw-alias-label-secondary': toCss(ink2),
        '--dsw-alias-brand-primary': toCss(accent('--dsw-alias-brand-primary', { r: 36, g: 123, b: 191, a: 1 })),
        '--dsw-alias-state-success-primary': toCss(accent('--dsw-alias-state-success-primary', { r: 38, g: 158, b: 92, a: 1 })),
        '--dsw-alias-state-warn-primary': toCss(accent('--dsw-alias-state-warn-primary', { r: 191, g: 128, b: 20, a: 1 })),
        '--dsw-alias-state-error-primary': toCss(accent('--dsw-alias-state-error-primary', { r: 213, g: 68, b: 68, a: 1 })),
        '--dsw-alias-state-idle-primary': toCss(accent('--dsw-alias-state-idle-primary', mixColor(surface, ink, 0.4))),
      }
    }

    function paletteSnapshot() {
      const service = themeService
      if (!service || typeof service.getTheme !== 'function') return NO_PALETTE
      let snapshot = null
      try {
        snapshot = service.getTheme()
      } catch (error) {
        return NO_PALETTE
      }
      const key = `${(snapshot && snapshot.revision) || ''}:${(snapshot && snapshot.preference) || ''}`
      if (key !== paletteKey) {
        paletteKey = key
        paletteCache = paletteOf(snapshot)
      }
      return paletteCache
    }

    function subscribeTheme(onChange) {
      themeSubs.add(onChange)
      return () => {
        themeSubs.delete(onChange)
      }
    }

    function useThemePalette() {
      return React.useSyncExternalStore(subscribeTheme, paletteSnapshot, paletteSnapshot)
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
          props.title == null ? null : h('h2', { className: 'dbmcp-card-title' }, props.title),
          props.aside == null ? null : h('span', { className: 'dbmcp-pill' }, props.aside),
          props.actions == null ? null : h('div', { className: 'dbmcp-card-actions' }, props.actions),
        ),
        props.children,
      )
    }

    /** One card per line, matching the audit entries below it. */
    function Row(props) {
      return h(
        'div',
        { className: 'dbmcp-row' },
        h('span', { key: 'k', className: 'dbmcp-k' }, props.label),
        h('div', { key: 'v', className: 'dbmcp-v' }, props.children),
      )
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

    /**
     * A track switch, for the one setting on a source row that can be flipped.
     *
     * The row used to carry a line of identical bordered pills, and the only
     * clickable one was a status word among status words: nothing said where to
     * press until the pointer happened to rest on it. A track reads as something
     * to operate before it is touched, and the state word stays beside it so the
     * direction is spelled out rather than inferred from the knob's position.
     */
    function Switch(props) {
      const on = props.checked === true
      return h(
        'button',
        {
          type: 'button',
          className: 'dbmcp-switch' + (on ? ' is-on' : ''),
          role: 'switch',
          'aria-checked': on ? 'true' : 'false',
          title: props.title || undefined,
          disabled: props.disabled === true,
          onClick: (event) => {
            event.stopPropagation()
            if (props.disabled === true) return
            props.onChange(!on)
          },
        },
        h(
          'span',
          { className: 'dbmcp-switch-track', 'aria-hidden': 'true' },
          h('span', { className: 'dbmcp-switch-knob' }),
        ),
        props.label == null ? null : h('span', null, props.label),
      )
    }

    function TextInput(props) {
      return h('input', {
        className: 'dbmcp-input' + (props.invalid ? ' is-invalid' : ''),
        type: props.type || 'text',
        value: props.value == null ? '' : props.value,
        placeholder: props.placeholder || '',
        autoComplete: props.autoComplete || 'off',
        autoFocus: props.autoFocus === true,
        spellCheck: false,
        disabled: props.disabled === true,
        title: props.title || undefined,
        'aria-invalid': props.invalid ? 'true' : undefined,
        onChange: (event) => props.onChange(event.target.value),
        onKeyDown: props.onKeyDown || undefined,
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
      // `new URL` reads `#` and `?` inside a password as fragment and query
      // markers, and rejects a comma-separated node list, so the string is
      // split by hand: credentials up to the last `@`, then the node list up to
      // the first `/`, then the path, then the query.
      let rest = body.startsWith('//') ? body.slice(2) : body
      const infoAt = rest.lastIndexOf('@')
      let info = ''
      if (infoAt >= 0) {
        info = rest.slice(0, infoAt)
        rest = rest.slice(infoAt + 1)
      }
      const slash = rest.indexOf('/')
      const authority = slash >= 0 ? rest.slice(0, slash) : rest
      const tail = slash >= 0 ? rest.slice(slash) : ''
      const mark = tail.indexOf('?')
      const path = mark >= 0 ? tail.slice(0, mark) : tail
      const query = parseQueryString(mark >= 0 ? tail.slice(mark) : '')
      const database = decodePart(path.replace(/^\/+/, ''))

      const nodes = authority
        .split(',')
        .map((piece) => /^(\[[^\]]+\]|[^:]+)(?::(\d+))?$/.exec(piece.trim()))
        .filter(Boolean)
        .map((match) => ({
          host: match[1].replace(/^\[|\]$/g, ''),
          port: match[2] ? Number(match[2]) : null,
        }))
      if (!nodes.length) return { ok: false, code: 'url' }

      const config = baseConfig(kind)
      config.host = nodes[0].host
      // Form fields hold strings; the node list keeps numbers for the driver.
      config.port = nodes[0].port ? String(nodes[0].port) : DEFAULT_PORTS[kind] || ''
      if (nodes.length > 1) {
        config.hosts = nodes.map((node) => ({ host: node.host, port: node.port || Number(config.port) || null }))
        config.host = nodes.map((node) => node.host).join(',')
      }
      const colon = info.indexOf(':')
      config.user = decodePart(colon >= 0 ? info.slice(0, colon) : info) || query.user || query.username || ''
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
      // The password stays raw here; `canonicalUrl` never renders it back.
      const password = colon >= 0 ? decodePart(info.slice(colon + 1)) : ''
      const name = kind === 'oracle' ? config.serviceName || config.sid : config.database || config.host
      return { ok: true, kind, config, password, name: name || kind }
    }

    function parseTns(text) {
      const config = baseConfig('oracle')
      /**
       * `DESCRIPTION_LIST` wraps `ADDRESS_LIST` wraps `ADDRESS`, so the values are
       * found by scanning for the named parameter instead of matching a shape.
       * Quotes are optional in TNS, and `PORT` may sit next to its `HOST`.
       */
      const param = (name) => {
        const match = new RegExp(`\\(\\s*${name}\\s*=\\s*([^()]+?)\\s*\\)`, 'i').exec(text)
        return match ? stripQuotes(match[1].trim()) : ''
      }
      config.host = param('HOST') || 'localhost'
      config.port = param('PORT') || '1521'
      config.serviceName = param('SERVICE_NAME')
      config.sid = param('SID')
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
        if (restLower.startsWith('oracle:thin:@')) {
          const body = rest.slice('oracle:thin:@'.length)
          return /^\s*\(/.test(body) ? parseTns(body) : parseOracleThin(body)
        }
        if (restLower.startsWith('postgresql://')) return fromUrl('postgres', rest.slice('postgresql:'.length))
        if (restLower.startsWith('opengauss://')) return fromUrl('gauss', rest.slice('opengauss:'.length))
        if (restLower.startsWith('gaussdb://')) return fromUrl('gauss', rest.slice('gaussdb:'.length))
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
        if (name === 'opengauss' || name === 'gaussdb' || name === 'gauss') return fromUrl('gauss', body)
        if (name === 'mysql' || name === 'mariadb') return fromUrl('mysql', body)
        return { ok: false, code: 'scheme' }
      }

      if (/^@?\s*\(/.test(raw)) return parseTns(raw)
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

    /** Tool descriptions run to several paragraphs; a list row shows the first sentence. */
    function firstLine(value) {
      const text = String(value || '').replace(/\s+/g, ' ').trim()
      if (!text) return ''
      const stop = text.search(/[.!?]\s/)
      const head = stop > 20 ? text.slice(0, stop + 1) : text
      return head.length > 140 ? `${head.slice(0, 137)}…` : head
    }

    /** Conversation ids are long uuids; the panel only needs to tell them apart. */
    function shortSession(value) {
      const text = String(value || '')
      return text.length > 10 ? `…${text.slice(-8)}` : text || '—'
    }

    /** UTC offset of the viewer's clock, e.g. "UTC+08:00". */
    function zoneLabel() {
      const offset = -new Date().getTimezoneOffset()
      const sign = offset >= 0 ? '+' : '-'
      const abs = Math.abs(offset)
      const pad = (part) => String(part).padStart(2, '0')
      return `UTC${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
    }

    /**
     * The audit log keeps UTC ISO stamps so the file stays comparable across
     * machines; the panel shows them on the viewer's clock instead. Rows can span
     * days and weeks, so the date travels with the time.
     */
    function localClock(value) {
      const text = String(value || '')
      const at = Date.parse(text)
      if (!Number.isFinite(at)) {
        // A stamp we cannot parse is still worth showing: an ISO string keeps its
        // date and time, anything else is printed as it came.
        return text.length >= 19 ? text.slice(0, 19).replace('T', ' ') : text
      }
      const date = new Date(at)
      const pad = (part) => String(part).padStart(2, '0')
      const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
      return `${day} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
    }

    /** Full local timestamp with the zone, used as the hover title of an audit row. */
    function localStamp(value) {
      const at = Date.parse(String(value || ''))
      if (!Number.isFinite(at)) return String(value || '')
      return `${localClock(value)} ${zoneLabel()}`
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
        group: '',
        kind: 'sqlite',
        readOnly: true,
        config: baseConfig('sqlite'),
        // Only consulted once writes are allowed: a writable source may write to
        // these schemas and no others. Reads are never restricted.
        writableSchemas: '',
        // DDL is a separate permission from writing rows: `create table` and
        // `drop table` change what everybody else reads, so they are opted into.
        allowDdl: false,
        password: '',
        hasSecret: false,
        secretBroken: false,
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
      draft.group = (source && source.group) || ''
      draft.kind = source.kind || 'sqlite'
      draft.readOnly = source.readOnly !== false
      draft.hasSecret = source.hasSecret === true
      draft.secretBroken = source.secretBroken === true
      const declared = Array.isArray(source && source.writableSchemas) ? source.writableSchemas : []
      draft.writableSchemas = declared.join(', ')
      draft.allowDdl = source.allowDdl === true
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
      // openGauss URLs carry the scheme the driver expects, and every node.
      if (draft.kind === 'gauss') {
        if (!config.database) return ''
        const nodes = Array.isArray(config.hosts) && config.hosts.length > 1
          ? config.hosts.map((node) => `${node.host}${node.port ? `:${node.port}` : ''}`).join(',')
          : `${host}${port}`
        return `opengauss://${user}${nodes}/${config.database}`
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
      const [probing, setProbing] = React.useState(false)
      const [probeResult, setProbeResult] = React.useState(null)
      const [error, setError] = React.useState(null)
      // Required fields stay unmarked until the first save attempt, so the form
      // does not open in a red state.
      const [missing, setMissing] = React.useState({})
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
          // Deleting a recognised connection string also drops what it filled
          // in; editing keeps the identifier and group the source already owns.
          setDraft((prev) => {
            const fresh = emptyDraft()
            if (!editing) return fresh
            return {
              ...fresh,
              id: prev.id,
              nameTouched: prev.nameTouched,
              idTouched: prev.idTouched,
              group: prev.group,
              readOnly: prev.readOnly,
            }
          })
          setMissing({})
          setProbeResult(null)
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
        // The connection string, the user and the password are what a source
        // cannot work without, so they are checked before anything is sent.
        const needsCredentials = draft.kind !== 'sqlite'
        const gaps = {
          url: !raw.trim(),
          user: needsCredentials && !String(draft.config.user || '').trim(),
          password: needsCredentials && !editing && !draft.hasSecret && !draft.password.trim(),
        }
        setMissing(gaps)
        if (gaps.url || gaps.user || gaps.password) {
          setError(t('form.requiredHint'))
          return
        }
        const needsTarget =
          draft.kind === 'oracle' ? !draft.config.serviceName.trim() && !draft.config.sid.trim() : !draft.config.database.trim()
        const incomplete = draft.kind === 'sqlite' ? !draft.config.file.trim() : !draft.config.host.trim() || needsTarget
        if (incomplete) {
          setError(t('form.invalid'))
          return
        }
        setBusy(true)
        try {
          const body = {
            id: draft.id.trim(),
            name: draft.name.trim() || draft.id || t('form.untitled'),
            group: (draft.group || '').trim(),
            kind: draft.kind,
            readOnly: draft.readOnly,
            config: { ...draft.config, port: draft.config.port ? Number(draft.config.port) : undefined },
            writableSchemas: String(draft.writableSchemas || '')
              .split(',')
              .map((name) => name.trim())
              .filter(Boolean),
            allowDdl: draft.allowDdl === true,
            password: saveSecret && draft.password !== '' ? draft.password : undefined,
          }
          if (!body.id) delete body.id
          const data = await apiPost('/datasources/save', body)
          props.onSaved(data.datasource)
        } catch (caught) {
          const existingId = caught && caught.payload && caught.payload.existingId
          setError(existingId ? fmt(t('form.duplicate'), { name: existingId }) : String((caught && caught.message) || caught))
        } finally {
          setBusy(false)
        }
      }

      /** Probes the draft as typed, before it is saved. */
      const testDraft = async () => {
        setError(null)
        setProbeResult(null)
        const needsTarget =
          draft.kind === 'oracle' ? !String(draft.config.serviceName || '').trim() && !String(draft.config.sid || '').trim() : !String(draft.config.database || '').trim()
        const incomplete = draft.kind === 'sqlite' ? !String(draft.config.file || '').trim() : !String(draft.config.host || '').trim() || needsTarget
        if (incomplete) {
          setError(t('form.invalid'))
          return
        }
        setProbing(true)
        try {
          const body = {
            kind: draft.kind,
            config: { ...draft.config, port: draft.config.port ? Number(draft.config.port) : undefined },
          }
          if (draft.id && props.editing) body.id = draft.id.trim()
          if (draft.password !== '') body.password = draft.password
          const data = await apiPost('/datasources/test', body)
          setProbeResult({
            ok: Boolean(data.probe && data.probe.ok),
            message: (data.probe && data.probe.message) || t('form.probeUnknown'),
            ms: data.probe && data.probe.latencyMs,
          })
        } catch (caught) {
          setProbeResult({ ok: false, message: String((caught && caught.message) || caught) })
        } finally {
          setProbing(false)
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
      if (draft.kind === 'postgres' || draft.kind === 'gauss') {
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

      const note = (text, extra) =>
        h(
          'p',
          { className: 'dbmcp-form-note' },
          h('span', { className: 'dbmcp-form-mark', 'aria-hidden': 'true' }, 'i'),
          h('span', null, text),
          extra || null,
        )

      return h(
        'div',
        { className: 'dbmcp-form is-page' },
        error
          ? h(
              'div',
              { className: 'dbmcp-notice is-error' },
              h('span', null, error),
              h('button', { type: 'button', className: 'dbmcp-btn is-small', onClick: () => setError(null) }, '×'),
            )
          : null,
        h(
          'section',
          { className: 'dbmcp-form-section' },
          h(
            'div',
            { className: 'dbmcp-form-head' },
            h('span', { className: 'dbmcp-form-label' }, t('form.paste')),
            h('span', { className: 'dbmcp-tag' }, t('form.smart')),
          ),
          h(TextInput, {
            value: raw,
            onChange: (value) => {
              onRawChange(value)
              if (missing.url) setMissing((prev) => ({ ...prev, url: false }))
            },
            invalid: missing.url === true,
            placeholder: t('form.pastePlaceholder'),
            autoFocus: !editing,
          }),
          note(
            editing ? t('form.pasteHintEdit') : t('form.pasteHintShort'),
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
          'section',
          { className: 'dbmcp-form-section is-two' },
          h(
            'div',
            { className: 'dbmcp-form-cell' },
            h('label', { className: 'dbmcp-form-label' }, t('form.user')),
            h(TextInput, {
              value: draft.config.user,
              placeholder: t('form.userPlaceholder'),
              onChange: (value) => {
                patchConfig({ user: value })
                if (missing.user) setMissing((prev) => ({ ...prev, user: false }))
              },
              invalid: missing.user === true,
              autoComplete: 'off',
            }),
          ),
          h(
            'div',
            { className: 'dbmcp-form-cell' },
            h(
              'div',
              { className: 'dbmcp-form-head' },
              h('label', { className: 'dbmcp-form-label' }, t('form.password')),
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
            h(TextInput, {
              type: 'password',
              value: draft.password,
              autoComplete: 'new-password',
              invalid: missing.password === true,
              placeholder: draft.hasSecret ? '********' : t('form.passwordEmpty'),
              onChange: (value) => {
                patch({ password: value })
                if (missing.password && value.trim()) setMissing((prev) => ({ ...prev, password: false }))
              },
            }),
            draft.hasSecret ? h('span', { className: 'dbmcp-hint' }, t('form.passwordKeep')) : null,
            draft.secretBroken ? h('span', { className: 'dbmcp-hint is-warn' }, t('form.schemaBroken')) : null,
          ),
        ),
        h(
          'details',
          { className: 'dbmcp-advanced is-page' },
          h(
            'summary',
            null,
            h('span', { className: 'dbmcp-advanced-title' }, t('form.more')),
            h('span', { className: 'dbmcp-advanced-hint' }, t('form.moreHint')),
          ),
          h(
            'div',
            { className: 'dbmcp-form-inner' },
            h(
              'div',
              { className: 'dbmcp-form-section is-three' },
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
                { key: 'group', label: t('form.group'), hint: t('form.groupHint') },
                h(TextInput, {
                  value: draft.group || '',
                  placeholder: t('group.unassigned'),
                  onChange: (value) => patch({ group: value }),
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
            ),
            h(
              'div',
              { className: 'dbmcp-form-section is-two' },
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
            ),
            h('div', { className: 'dbmcp-form-section is-two' }, manual),
            h(
              'div',
              { className: 'dbmcp-policy' },
              h(
                'div',
                { className: 'dbmcp-policy-head' },
                h('span', { className: 'dbmcp-form-label' }, t('form.schemaAccess')),
                h('span', { className: 'dbmcp-hint' }, t('form.schemaAccessHint')),
              ),
              h(
                'div',
                { className: 'dbmcp-form-section' },
                h(
                  Field,
                  { key: 'writableSchemas', label: t('form.schemaNames'), hint: t('form.schemaNamesHint') },
                  h(TextInput, {
                    value: draft.writableSchemas,
                    placeholder: 'sales, billing',
                    onChange: (value) => patch({ writableSchemas: value }),
                  }),
                ),
              ),
              // The unlock dialog asks the same question; both write `allowDdl`,
              // so a source created as writable can still be given DDL later.
              h(
                'label',
                { className: 'dbmcp-check' },
                h('input', {
                  type: 'checkbox',
                  checked: draft.allowDdl === true,
                  onChange: (event) => patch({ allowDdl: event.target.checked }),
                }),
                h('span', null, t('form.allowDdl')),
                h('span', { className: 'dbmcp-help', title: t('form.allowDdlHint'), 'aria-hidden': 'true' }, '?'),
              ),
            ),
            h(
              'div',
              { className: 'dbmcp-readonly' },
              h(
                'label',
                { className: 'dbmcp-check' },
                h('input', {
                  type: 'checkbox',
                  checked: draft.readOnly,
                  onChange: (event) => patch({ readOnly: event.target.checked }),
                }),
                h('span', null, t('form.readOnly')),
                h('span', { className: 'dbmcp-help', title: t('form.readOnlyHint'), 'aria-hidden': 'true' }, '?'),
              ),
              h('span', { className: 'dbmcp-hint' }, t('form.readOnlyHint')),
            ),
          ),
        ),
        probeResult
          ? h(
              'div',
              { className: 'dbmcp-notice' + (probeResult.ok ? '' : ' is-error') },
              h(
                'span',
                null,
                probeResult.ok
                  ? fmt(t('form.probeOk'), { name: draft.name || draft.id || draft.kind, ms: probeResult.ms == null ? '—' : probeResult.ms })
                  : `${t('form.probeFail')} ${probeResult.message}`,
              ),
              h('button', { type: 'button', className: 'dbmcp-btn is-small', onClick: () => setProbeResult(null) }, '×'),
            )
          : null,
        h(
          'div',
          { className: 'dbmcp-form-foot' },
          h(
            'button',
            { type: 'button', className: 'dbmcp-btn', disabled: busy || probing, onClick: testDraft },
            probing ? t('action.testing') : t('action.test'),
          ),
          h(
            'button',
            { type: 'button', className: 'dbmcp-btn is-primary is-save', disabled: busy || probing, onClick: submit },
            busy ? t('action.saving') : t('action.save'),
          ),
          h('span', { className: 'dbmcp-form-foot-hint' }, t('form.autoApply')),
        ),
      )
    }

    /** Tables grouped by schema; the group order is stable and alphabetical. */
    /** Brand colours keep the four engines readable without an icon font. */
const KIND_BADGE = {
  postgres: { label: 'PG', color: '#336791' },
  gauss: { label: 'GS', color: '#00a3a3' },
  mysql: { label: 'MY', color: '#00758f' },
  oracle: { label: 'OR', color: '#c74634' },
  sqlite: { label: 'SQ', color: '#003b5c' },
}

const kindBadge = (kind) => {
  const key = String(kind || '').trim().toLowerCase()
  if (KIND_BADGE[key]) return KIND_BADGE[key]
  const label = key ? key.slice(0, 2).toUpperCase() : '?'
  return { label, color: 'var(--dsw-alias-label-secondary)' }
}

/**
 * The identifier is the value every MCP tool takes as its `datasource`
 * argument, which is why it is a labelled chip and not a tail on the target
 * line: click it to copy the exact token the user has to type in chat.
 */
function IdChip(props) {
  const { t, id, copied, onCopy } = props
  if (!id) return null
  return h(
    'button',
    {
      type: 'button',
      className: 'dbmcp-idchip' + (copied ? ' is-copied' : ''),
      title: copied ? t('sources.idCopied') : `${id} — ${t('sources.idChipHint')}`,
      'aria-label': `${t('sources.idChip')}: ${id}`,
      onClick: (event) => {
        event.stopPropagation()
        if (typeof onCopy === 'function') onCopy(id)
      },
    },
    h('span', { className: 'dbmcp-idchip-key' }, t('sources.idChip')),
    h('code', { className: 'dbmcp-idchip-value' }, id),
    copied ? h('span', { className: 'dbmcp-idchip-mark', 'aria-hidden': 'true' }, '✓') : null,
  )
}

/** Clipboard write that still works when the async API is blocked by the host shell. */
async function copyText(text) {
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(text)
      return
    } catch (error) {
      /* fall through to the textarea trick */
    }
  }
  const holder = document.createElement('textarea')
  holder.value = text
  holder.setAttribute('readonly', 'readonly')
  holder.style.position = 'fixed'
  holder.style.top = '-1000px'
  holder.style.opacity = '0'
  document.body.appendChild(holder)
  holder.select()
  const done = document.execCommand('copy')
  document.body.removeChild(holder)
  if (!done) throw new Error('the clipboard is not available')
}

/** A stored probe that ended in failure is what the red row is about. */
const probeFailed = (source) => Boolean(source && source.lastProbe && source.lastProbe.ok === false)

/** Older registries still carry `host:port / database`; a pasted report wants no padding. */
const reportTarget = (source) => {
  const raw = String((source && source.target) || '').trim()
  if (!raw) return '-'
  return raw.replace(/\s+\/\s+/g, '/')
}

/** Whole failure report for one source, so it can be pasted straight into an issue. */
const probeReport = (source, plugin) => {
  const probeInfo = (source && source.lastProbe) || {}
  return [
    `datasource: ${source.name || source.id}`,
    `id: ${source.id}`,
    `kind: ${source.kind}`,
    `target: ${reportTarget(source)}`,
    probeInfo.at ? `at: ${localStamp(probeInfo.at)}` : '',
    `error: ${probeInfo.message || '-'}`,
    plugin ? `plugin: ${plugin.name} ${plugin.version}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

const sourceMatches = (source, needle) => {
  const text = String(needle || '').trim().toLowerCase()
  if (!text) return true
  const hay = [source.name, source.id, source.kind, source.target, source.group, source.lastProbe && source.lastProbe.message]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  return hay.includes(text)
}

/** Schemas a writable source may write to; empty means it is not writable yet. */
const writableNames = (source) => {
  const names = source && Array.isArray(source.writableSchemas) ? source.writableSchemas : []
  return names.filter((name) => typeof name === 'string' && name.trim() !== '')
}

/**
 * Whether a row shows its writable-schemas pill.
 *
 * The list outlives a switch back to read-only, because it is the next unlock's
 * starting point. Showing it on a locked row would read as a permission that is
 * not in force, so the pill only appears once the source is actually writable.
 */
const showsWritable = (source) => Boolean(source) && source.readOnly === false && writableNames(source).length > 0

/**
 * Section order for the list. "Ungrouped" is a bucket like any other, but it is
 * not a declared group, so it has to be added here — otherwise filtering on it
 * renders nothing.
 */
function sectionOrder(groupNames, sources, narrowing) {
  const names = groupNames.slice()
  const loose = sources.some((source) => !String(source.group || '').trim())
  if (loose) names.push('')
  if (!narrowing) return names.indexOf('') === -1 ? [...names, ''] : names
  return names.filter((name) => sources.some((source) => String(source.group || '').trim() === name))
}

function groupTables(tables) {
      const buckets = new Map()
      for (const table of tables || []) {
        const key = table.schema || ''
        if (!buckets.has(key)) buckets.set(key, [])
        buckets.get(key).push(table)
      }
      return Array.from(buckets.entries()).sort((left, right) => (left[0] || '').localeCompare(right[0] || ''))
    }

    function tableMatches(table, needle) {
      if (!needle) return true
      return (
        String(table.name || '').toLowerCase().includes(needle) ||
        String(table.schema || '').toLowerCase().includes(needle)
      )
    }

    function connectionMatches(item, needle) {
      if (!needle) return true
      return [item.name, item.id, item.target, item.user, item.kind].some((value) =>
        String(value || '').toLowerCase().includes(needle),
      )
    }

    function ImportView(props) {
      const t = props.t
      const [state, setState] = React.useState({ status: 'loading', data: null, error: null })
      const [selected, setSelected] = React.useState([])
      const [busy, setBusy] = React.useState(false)
      const [filter, setFilter] = React.useState('')

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

      const needle = filter.trim().toLowerCase()
      const files = (all || [])
        .map((source) => ({ ...source, connections: (source.connections || []).filter((item) => connectionMatches(item, needle)) }))
        .filter((source) => source.connections.length > 0)
      const totalConnections = (all || []).reduce((sum, source) => sum + (source.connections || []).length, 0)
      const visibleConnections = files.reduce((sum, source) => sum + source.connections.length, 0)

      if (state.status === 'loading') return h('div', { className: 'dbmcp-empty' }, t('loading'))
      if (state.status === 'error') {
        return h('div', { className: 'dbmcp-error' }, h('div', null, state.error))
      }

      return h(
        'div',
        { className: 'dbmcp-scan' },
        // The bar stays put while the list scrolls, so the action never leaves
        // the viewport no matter how many connections DBeaver knows about.
        h(
          'div',
          { className: 'dbmcp-scan-bar' },
          h(TextInput, {
            value: filter,
            placeholder: t('import.searchPlaceholder'),
            label: t('import.searchPlaceholder'),
            onChange: setFilter,
          }),
          h('span', { className: 'dbmcp-hint' }, fmt(t('import.matches'), { n: visibleConnections, total: totalConnections })),
          h(
            'button',
            { type: 'button', className: 'dbmcp-btn is-primary', disabled: busy || selected.length === 0, onClick: runImport },
            busy ? t('action.importing') : `${t('action.importSelected')} (${selected.length})`,
          ),
        ),
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
          : visibleConnections === 0
            ? h('div', { className: 'dbmcp-empty' }, t('import.noMatch'))
            : files.map((source) =>
              h(
                'div',
                { key: source.file },
                h(Card, { title: t('import.file'), aside: source.credentialsFound ? t('import.credentialsFound') : t('import.credentialsMissing') },
                  h('div', { className: 'dbmcp-scan-file' }, source.file),
                  h(
                    'ul',
                    { className: 'dbmcp-list', style: { marginTop: '10px' } },
                    source.connections.map((item) => {
                      const duplicate = item.alreadyImported === true
                      const taken = duplicate || existing.includes(item.id)
                      return h(
                        'li',
                        { className: 'dbmcp-item' + (duplicate ? ' is-taken' : ''), key: item.id },
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
                                  title: duplicate ? t('import.already') : undefined,
                                  onChange: () => toggle(item.id),
                                })
                              : null,
                            h('span', null, item.name || item.id),
                            item.kind ? h('span', { className: 'dbmcp-pill' }, item.kind) : null,
                            duplicate ? h('span', { className: 'dbmcp-pill' }, t('import.already')) : null,
                          ),
                          h(
                            'div',
                            { className: 'dbmcp-item-target' },
                            duplicate
                              ? t('import.alreadyAs').replace('{name}', item.duplicateName || item.duplicateId || '')
                              : [item.importable ? item.target : item.reason, item.user].filter(Boolean).join(' · '),
                          ),
                          duplicate
                            ? null
                            : h(
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
      )
    }

    /** P7: read-only structure browser. Only lists tables and columns. */
    function SchemaView(props) {
      const { t, source, onBack } = props
      const [tables, setTables] = React.useState(null)
      // A table is identified by schema + name: the same name can live in two
      // schemas, and describe_table needs the schema to find the right one.
      const [picked, setPicked] = React.useState(null)
      const [detail, setDetail] = React.useState(null)
      const [error, setError] = React.useState(null)
      const [busy, setBusy] = React.useState(true)
      const [filter, setFilter] = React.useState('')
      const [collapsed, setCollapsed] = React.useState({})

      const refresh = React.useCallback(async () => {
        const data = await apiGet(`/schema?datasource=${encodeURIComponent(source.id)}`)
        if (!data.ok) {
          const failure = data.error || {}
          const error = new Error(failure.message || t('schema.error'))
          error.payload = failure
          throw error
        }
        return data
      }, [source.id, t])

      React.useEffect(() => {
        let alive = true
        setBusy(true)
        ;(async () => {
          try {
            const data = await refresh()
            if (alive) {
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
      }, [refresh])

      const pickedSchema = picked ? picked.schema || '' : ''
      const pickedName = picked ? picked.name : ''

      React.useEffect(() => {
        if (!picked) {
          setDetail(null)
          return undefined
        }
        let alive = true
        setDetail({ loading: true })
        ;(async () => {
          try {
            const schemaPart = picked.schema ? `&schema=${encodeURIComponent(picked.schema)}` : ''
            const data = await apiGet(
              `/schema?datasource=${encodeURIComponent(source.id)}&table=${encodeURIComponent(picked.name)}${schemaPart}`,
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
      }, [pickedSchema, pickedName, source.id])

      const groups = React.useMemo(() => groupTables(tables), [tables])

      const needle = filter.trim().toLowerCase()
      const visible = groups
        .map(([schema, items]) => [schema, items.filter((table) => tableMatches(table, needle))])
        .filter(([, items]) => items.length > 0)
      const visibleCount = visible.reduce((sum, [, items]) => sum + items.length, 0)
      const groupLabel = (schema) => (schema ? schema : t('schema.defaultSchema'))

      const side = h(
        'div',
        { className: 'dbmcp-schema-side' },
        h(
          'div',
          { className: 'dbmcp-schema-head' },
          h('span', null, fmt(t('schema.tables'), { n: tables ? tables.length : 0 })),
          needle ? h('span', { className: 'dbmcp-hint' }, fmt(t('schema.matching'), { n: visibleCount })) : null,
        ),
        h(TextInput, {
          value: filter,
          placeholder: t('schema.search'),
          label: t('schema.search'),
          onChange: setFilter,
        }),
        !tables || tables.length === 0
          ? h('div', { className: 'dbmcp-empty' }, t('schema.empty'))
          : visibleCount === 0
            ? h('div', { className: 'dbmcp-empty' }, t('schema.noMatch'))
            : h(
                'div',
                { className: 'dbmcp-schema-groups' },
                visible.map(([schema, items]) => {
                  const closed = collapsed[schema] === true
                  return h(
                    'section',
                    { key: `group-${schema || '_'}`, className: 'dbmcp-schema-group' },
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'dbmcp-schema-group-head',
                        'aria-expanded': closed ? 'false' : 'true',
                        onClick: () => setCollapsed({ ...collapsed, [schema]: !closed }),
                      },
                      h('span', { className: 'dbmcp-schema-caret', 'aria-hidden': 'true' }, closed ? '▸' : '▾'),
                      h('span', { className: 'dbmcp-schema-group-name', title: groupLabel(schema) }, groupLabel(schema)),
                      h('span', { className: 'dbmcp-hint' }, String(items.length)),
                    ),
                    closed
                      ? null
                      : h(
                          'ul',
                          { className: 'dbmcp-schema-tables' },
                          items.map((table) => {
                            const active = pickedName === table.name && pickedSchema === (table.schema || '')
                            return h(
                              'li',
                              { key: `${table.schema || ''}.${table.name}` },
                              h(
                                'button',
                                {
                                  type: 'button',
                                  className: 'dbmcp-schema-table' + (active ? ' is-active' : ''),
                                  onClick: () => setPicked({ schema: table.schema || '', name: table.name }),
                                },
                                h('span', { className: 'dbmcp-schema-name', title: table.name }, table.name),
                                table.type ? h('span', { className: 'dbmcp-pill' }, table.type) : null,
                              ),
                            )
                          }),
                        ),
                  )
                }),
              ),
      )

      let content
      if (busy && !tables) {
        content = h('div', { className: 'dbmcp-empty' }, t('schema.loading'))
      } else if (error) {
        content = h('div', { className: 'dbmcp-error' }, h('div', null, t('schema.error')), h('code', null, error))
      } else {
        content = h(
          'div',
          { className: 'dbmcp-schema' },
          side,
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
                          h(
                            'span',
                            { className: 'dbmcp-schema-title', title: pickedSchema ? `${pickedSchema}.${detail.table}` : detail.table },
                            pickedSchema ? `${pickedSchema}.${detail.table}` : detail.table,
                          ),
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

      return h('div', { className: 'dbmcp-schema-wrap' }, content)
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

    /** Quiet strip above the list: bridge health, totals, filters and search. */
  function StatusStrip(props) {
    const { t, data, sources, failedSources, groupNames, filter, setFilter, query, setQuery } = props
    if (!data) return null
    const mcpReady = Boolean(data.mcp && data.mcp.phase === 'ready')
    const failed = failedSources.length
    const healthy = Math.max(sources.length - failed, 0)
    const chips = [{ id: 'all', label: t('filter.all'), count: sources.length }]
    for (const name of groupNames) {
      const count = sources.filter((source) => String(source.group || '').trim() === name).length
      chips.push({ id: 'group:' + name, label: name, count })
    }
    const loose = sources.filter((source) => !String(source.group || '').trim()).length
    if (loose > 0) chips.push({ id: 'group:', label: t('group.unassigned'), count: loose })
    if (failed > 0) chips.push({ id: 'failed', label: t('filter.failed'), count: failed, warn: true })
    return h(
      'div',
      { className: 'dbmcp-status' },
      h(
        'div',
        { className: 'dbmcp-status-row' },
        h('span', { className: 'dbmcp-dot ' + (mcpReady ? 'is-ok' : 'is-error') }),
        h('span', { className: 'dbmcp-status-label' }, mcpReady ? t('status.mcpOk') : t('status.mcpDown')),
        h(
          'span',
          { className: 'dbmcp-stats' },
          h('span', { className: 'dbmcp-stat' }, t('status.total').replace('{n}', String(sources.length))),
          h('span', { className: 'dbmcp-stat-sep' }),
          h(
            'span',
            { className: 'dbmcp-stat is-ok' },
            t('status.healthy').replace('{n}', String(healthy)),
          ),
          failed > 0 ? h('span', { className: 'dbmcp-stat-sep' }) : null,
          failed > 0
            ? h(
                'span',
                { className: 'dbmcp-stat is-error' },
                t('status.failing').replace('{n}', String(failed)),
                ' ',
                t('status.failingNames').replace(
                  '{names}',
                  failedSources.map((source) => source.name || source.id).join(', '),
                ),
              )
            : null,
        ),
        h('span', { className: 'dbmcp-status-spacer' }),
        h('div', { className: 'dbmcp-status-search' }, h(TextInput, {
          value: query,
          onChange: setQuery,
          placeholder: t('sources.searchPlaceholder'),
          title: t('sources.searchPlaceholder'),
        })),
      ),
      h(
        'div',
        { className: 'dbmcp-status-row is-filters' },
        h(
          'div',
          { className: 'dbmcp-chips' },
          chips.map((chip) =>
            h(
              'button',
              {
                key: chip.id,
                type: 'button',
                className: 'dbmcp-chip' + (filter === chip.id ? ' is-active' : '') + (chip.warn ? ' is-warn' : ''),
                onClick: () => setFilter(filter === chip.id ? 'all' : chip.id),
              },
              chip.warn ? h('span', { className: 'dbmcp-chip-icon', 'aria-hidden': 'true' }, '⚠') : null,
              chip.label,
              h('span', { className: 'dbmcp-chip-count' }, String(chip.count)),
            ),
          ),
        ),
      ),
    )
  }

  function MainPanel() {
      const service = useLocale()
      const palette = useThemePalette()
      const t = React.useMemo(() => (service ? service.bind(NS) : (key) => key), [service])
      const [state, setState] = React.useState({ status: 'loading', data: null, error: null })
      const [busy, setBusy] = React.useState(false)
      const [view, setView] = React.useState({ mode: 'list' })
      const tab = tabOfMode(view.mode)
      const [notice, setNotice] = React.useState(null)
      const [probing, setProbing] = React.useState(null)
      const [pendingDelete, setPendingDelete] = React.useState(null)
      // The unlock dialog: { source, picked, manual, catalog, busy, error }.
      // Switching a source to writable goes through here, because a source
      // that accepts writes must first say which schemas it may write to.
      const [unlock, setUnlock] = React.useState(null)
      const [selected, setSelected] = React.useState([])
      const [bulkGroup, setBulkGroup] = React.useState('')
      const [pendingBulkDelete, setPendingBulkDelete] = React.useState(false)
      const [groupDraft, setGroupDraft] = React.useState('')
      const [editingGroup, setEditingGroup] = React.useState(null)
      const [pendingGroupDelete, setPendingGroupDelete] = React.useState(null)
      const [draggingId, setDraggingId] = React.useState(null)
      const [dragOverGroup, setDragOverGroup] = React.useState(null)
      const [dropMark, setDropMark] = React.useState(null)
      const [renamingSource, setRenamingSource] = React.useState(null)
      const [query, setQuery] = React.useState('')
      const [filter, setFilter] = React.useState('all')
      const [copiedId, setCopiedId] = React.useState(null)
      const [copiedEndpoint, setCopiedEndpoint] = React.useState(false)
      const [copiedChip, setCopiedChip] = React.useState(null)
      const [collapsed, setCollapsed] = React.useState([])

      const toggleFolded = (name) => {
        setCollapsed((prev) => (prev.includes(name) ? prev.filter((item) => item !== name) : prev.concat(name)))
      }

      /** Switching a tab only swaps the card below; the chrome never moves. */
      const selectTab = (id) => {
        setView({ mode: id })
      }

      const backToChat = () => {
        const layout = layoutService
        if (!layout || typeof layout.selectPanel !== 'function') return
        try {
          layout.selectPanel(null)
        } catch (error) {
          /* older shells may not expose selectPanel; staying on the panel is fine */
        }
      }
      const [settings, setSettings] = React.useState(null)
      const [audit, setAudit] = React.useState({ entries: [], file: null })
      const [env, setEnv] = React.useState(null)
      const [installing, setInstalling] = React.useState(false)
      const [scopes, setScopes] = React.useState(null)
      const [http, setHttp] = React.useState(null)
      const [clients, setClients] = React.useState(null)
      const [tools, setTools] = React.useState(null)
      const [portDraft, setPortDraft] = React.useState('')
      const [clientBusy, setClientBusy] = React.useState('')

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
          void apiGet('/scopes')
            .then((payload) => setScopes(payload.sessions || []))
            .catch(() => {})
          void apiGet('/http/status')
            .then((payload) => setHttp(payload))
            .catch(() => {})
          void apiGet('/clients')
            .then((payload) => setClients(payload))
            .catch(() => {})
          void apiGet('/tools')
            .then((payload) => setTools(payload))
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

      const toggleSelected = (id) => {
        setPendingBulkDelete(false)
        setSelected((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]))
      }

      const runBulk = async (action, extra = {}) => {
        if (selected.length === 0) return
        setBusy(true)
        try {
          const payload = await apiPost('/datasources/bulk', { action, ids: selected, ...extra })
          const affected = Number(payload && payload.affected) || selected.length
          setSelected([])
          setPendingBulkDelete(false)
          setBulkGroup('')
          if (action === 'group') {
            const name = String(extra.group || '').trim() || t('group.unassigned')
            finish(t('notice.bulkGrouped').replace('{n}', String(affected)).replace('{group}', name), false)
          } else {
            finish(t('notice.bulkDone').replace('{n}', String(affected)), false)
          }
        } catch (error) {
          setNotice({ message: String((error && error.message) || error), isError: true })
        } finally {
          setBusy(false)
        }
      }

      /**
       * Flip one source between read-only and writable from its row switch.
       *
       * Going read-only is immediate. Going writable first asks which schemas
       * may be written to: a source that accepts writes without saying where is
       * exactly the thing this guard exists to prevent.
       */
      const toggleReadOnly = async (source) => {
        if (source.readOnly === false) {
          await setReadOnly(source, true)
          return
        }
        openUnlock(source)
      }

      /** POST the flag; `writableSchemas` rides along when unlocking. */
      const setReadOnly = async (source, readOnly, writableSchemas, allowDdl) => {
        const name = source.name || source.id
        setBusy(true)
        try {
          const body = { action: 'readOnly', ids: [source.id], readOnly }
          if (writableSchemas !== undefined) body.writableSchemas = writableSchemas
          if (allowDdl !== undefined) body.allowDdl = allowDdl === true
          await apiPost('/datasources/bulk', body)
          const globalOpen = Boolean(settings && settings.allowWrite)
          const message = readOnly
            ? t('notice.nowReadOnly').replace('{name}', name)
            : globalOpen
              ? t('notice.nowWritable').replace('{name}', name)
              : t('notice.nowWritableLocked').replace('{name}', name)
          setNotice({ message, isError: false })
          load()
        } catch (error) {
          setNotice({ message: String((error && error.message) || error), isError: true })
          throw error
        } finally {
          setBusy(false)
        }
      }

      const bulkDelete = async () => {
        if (selected.length === 0) return
        if (!pendingBulkDelete) {
          setPendingBulkDelete(true)
          return
        }
        await runBulk('delete')
      }

      /** Read the schema list once, when the dialog opens. */
      const openUnlock = (source) => {
        // The DDL switch is preselected from what the source already allows, so
        // reopening the dialog shows the choice that is in force, not a default.
        setUnlock({ source, picked: {}, catalog: null, busy: true, error: null, ddl: source.allowDdl === true })
        ;(async () => {
          try {
            const data = await apiGet(`/schema?datasource=${encodeURIComponent(source.id)}`)
            if (!data.ok) {
              const failure = data.error || {}
              throw new Error(failure.message || t('unlock.error'))
            }
            // `schemas` is the catalog's own list. A Host from before the field
            // existed only sends the tables, so derive the list from their
            // schema names rather than showing an empty dialog with no way out.
            const listed = Array.isArray(data.schemas) && data.schemas.length > 0
              ? data.schemas
              : (Array.isArray(data.tables) ? data.tables : []).map((table) => table && table.schema)
            const declared = Array.isArray(source.writableSchemas) ? source.writableSchemas : []
            // Names the source already writes to stay on the list even when the
            // catalog no longer shows them, so the choice can always be kept.
            const names = Array.from(new Set(listed.concat(declared).filter((name) => typeof name === 'string' && name.trim() !== '')))
            const picked = {}
            for (const name of declared) {
              if (names.includes(name)) picked[name] = true
            }
            setUnlock((prev) => (prev && prev.source.id === source.id ? { ...prev, picked, catalog: names, busy: false } : prev))
          } catch (failure) {
            setUnlock((prev) =>
              prev && prev.source.id === source.id
                ? { ...prev, busy: false, error: String((failure && failure.message) || failure) }
                : prev,
            )
          }
        })()
      }

      /** The names the dialog would submit: the ticked boxes. */
      const unlockNames = (state) => {
        if (!state) return []
        return Object.keys(state.picked || {}).filter((name) => state.picked[name])
      }

      const probe = async (source) => {        setProbing(source.id)
        try {
          const result = await apiPost('/datasources/test', { id: source.id })
          const probeInfo = result.probe || {}
          if (probeInfo.ok) {
            setNotice({ message: fmt(t('notice.probeOk'), { name: source.name, ms: probeInfo.latencyMs }), isError: false })
          } else {
            /* the failing row already carries the message; a banner on top would just repeat it */
            setNotice(null)
          }
          load()
        } catch (error) {
          setNotice({ message: String((error && error.message) || error), isError: true })
        } finally {
          setProbing(null)
        }
      }

      const restartMcp = async () => {
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
      }

      const copyProbe = async (source) => {
        try {
          await copyText(probeReport(source, data.plugin))
          setCopiedId(source.id)
          setTimeout(() => setCopiedId((prev) => (prev === source.id ? null : prev)), 1600)
        } catch (error) {
          setNotice({ message: String((error && error.message) || error), isError: true })
        }
      }

      /** The chip copies the bare id: that is the token the user pastes in chat. */
      const copyId = async (id) => {
        try {
          await copyText(id)
          setCopiedChip(id)
          setTimeout(() => setCopiedChip((prev) => (prev === id ? null : prev)), 1600)
        } catch (error) {
          setNotice({ message: String((error && error.message) || error), isError: true })
        }
      }

      /** Copy the MCP endpoint, ready to paste into another agent's settings. */
      const copyEndpoint = async (url) => {
        if (!url) return
        try {
          await copyText(url)
          setCopiedEndpoint(true)
          setTimeout(() => setCopiedEndpoint(false), 1600)
        } catch (error) {
          setNotice({ message: String((error && error.message) || error), isError: true })
        }
      }

      const toggleWrite = async (next) => {        try {
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

      /** Start or stop the HTTP endpoint other agents connect to. */
      const controlHttp = async (action) => {
        setBusy(true)
        try {
          const port = Number(portDraft || (http && http.port) || (settings && settings.httpPort) || 8765)
          const payload = await apiPost(`/http/${action}`, action === 'start' ? { port } : {})
          if (payload && payload.http) setHttp(payload.http)
          setNotice({
            message: payload && payload.http && payload.http.running ? t('notice.httpOn') : t('notice.httpOff'),
            isError: !(payload && payload.ok !== false),
          })
          await load()
        } catch (error) {
          setNotice({ message: String((error && error.message) || error), isError: true })
        } finally {
          setBusy(false)
        }
      }

      /** Write this server into one client's own configuration file. */
      const configureClient = async (client) => {
        setClientBusy(client.id)
        setNotice(null)
        try {
          const payload = await apiPost('/clients/configure', { client: client.id })
          setNotice({
            message: fmt(t('notice.clientReady'), { name: client.label, transport: payload.transport || 'http' }),
            isError: false,
          })
          await load()
        } catch (error) {
          const body = (error && error.payload) || {}
          const hint = body.hint ? ` ${body.hint}` : ''
          setNotice({ message: `${String((error && error.message) || error)}${hint}`, isError: true })
        } finally {
          setClientBusy('')
        }
      }

      /** Publish or withdraw one tool for the agent. */
      const [limitDraft, setLimitDraft] = React.useState({})

      /** Save one default row count; the server clamps it to its own cap. */
      const commitLimit = async (limit) => {
        const raw = Number(limitDraft[limit.key])
        if (!Number.isInteger(raw) || raw < limit.min || raw > limit.max) {
          setLimitDraft({ ...limitDraft, [limit.key]: String(limit.value) })
          return
        }
        if (raw === limit.value) return
        const next = { ...((tools && tools.limits) || {}), [limit.key]: raw }
        try {
          await apiPost('/settings', { limits: next })
          setLimitDraft({ ...limitDraft, [limit.key]: undefined })
          setNotice({ message: t('tools.limitSaved'), isError: false })
          await load()
        } catch (error) {
          setLimitDraft({ ...limitDraft, [limit.key]: String(limit.value) })
          setNotice({ message: String((error && error.message) || error), isError: true })
        }
      }

      const toggleTool = async (name, on) => {
        const current = (tools && Array.isArray(tools.disabled) ? tools.disabled : []).filter((item) => item !== name)
        const next = on ? current : [...current, name]
        setBusy(true)
        setNotice(null)
        try {
          await apiPost('/settings', { disabledTools: next })
          setNotice({ message: on ? fmt(t('tools.on'), { name }) : fmt(t('tools.off'), { name }), isError: false })
          await load()
        } catch (error) {
          setNotice({ message: String((error && error.message) || error), isError: true })
        } finally {
          setBusy(false)
        }
      }

      /** Declared groups plus any group that a source already carries. */
      const groupNames = (() => {
        const seen = new Set()
        const declared = data && Array.isArray(data.groups) ? data.groups : []
        for (const name of declared) {
          const key = String(name || '').trim()
          if (key) seen.add(key)
        }
        for (const source of sources) {
          const key = String(source.group || '').trim()
          if (key) seen.add(key)
        }
        return [...seen].sort((a, b) => a.localeCompare(b))
      })()

      const reportError = (error) => {
        setNotice({ message: String((error && error.message) || error), isError: true })
      }

      const createGroup = async () => {
        const name = groupDraft.trim()
        if (!name) return
        try {
          await apiPost('/groups/save', { name })
          setGroupDraft('')
          setNotice({ message: t('notice.groupSaved').replace('{name}', name), isError: false })
          load()
        } catch (error) {
          reportError(error)
        }
      }

      const renameGroup = async () => {
        if (!editingGroup) return
        const name = String(editingGroup.name || '').trim()
        if (!name) return
        try {
          await apiPost('/groups/save', { name, from: editingGroup.from })
          setEditingGroup(null)
          setNotice({ message: t('notice.groupSaved').replace('{name}', name), isError: false })
          load()
        } catch (error) {
          reportError(error)
        }
      }

      /** A source keeps its id; double-clicking the name only changes the label. */
      const renameSource = async () => {
        if (!renamingSource) return
        const name = String(renamingSource.name || '').trim()
        const source = sources.find((item) => item.id === renamingSource.id)
        if (!source || !name) {
          setRenamingSource(null)
          return
        }
        try {
          await apiPost('/datasources/save', {
            id: source.id,
            name,
            kind: source.kind,
            readOnly: source.readOnly,
            isDefault: source.isDefault,
            tags: source.tags,
            group: source.group,
            config: source.config,
          })
          setRenamingSource(null)
          setNotice({ message: t('notice.saved').replace('{name}', name), isError: false })
          load()
        } catch (error) {
          reportError(error)
        }
      }

      const removeGroup = async (name) => {
        if (pendingGroupDelete !== name) {
          setPendingGroupDelete(name)
          return
        }
        setPendingGroupDelete(null)
        try {
          await apiPost('/groups/delete', { name })
          setNotice({ message: t('notice.groupDeleted').replace('{name}', name), isError: false })
          load()
        } catch (error) {
          reportError(error)
        }
      }

      const moveToGroup = async (id, name) => {
        try {
          await apiPost('/datasources/bulk', { action: 'group', ids: [id], group: name })
          const label = name || t('group.unassigned')
          setNotice({ message: t('notice.moved').replace('{group}', label), isError: false })
          load()
        } catch (error) {
          reportError(error)
        }
      }

      /** Dropping a row onto another row: adopt its group, then sit above or below it. */
      const dropOnRow = async (draggedId, target, after = false) => {
        const dragged = sources.find((item) => item.id === draggedId)
        if (!dragged || dragged.id === target.id) return
        try {
          if (String(dragged.group || '').trim() !== String(target.group || '').trim()) {
            await apiPost('/datasources/bulk', { action: 'group', ids: [draggedId], group: String(target.group || '').trim() })
          }
          const ids = sources.map((item) => item.id).filter((id) => id !== draggedId)
          const at = ids.indexOf(target.id)
          ids.splice(at < 0 ? ids.length : at + (after ? 1 : 0), 0, draggedId)
          await apiPost('/datasources/reorder', { ids })
          setDraggingId(null)
          load()
        } catch (error) {
          reportError(error)
        }
      }

      const toggleGroup = (items) => {
        const ids = items.map((item) => item.id)
        const allChecked = ids.length > 0 && ids.every((id) => selected.includes(id))
        setPendingBulkDelete(false)
        setSelected((prev) => (allChecked ? prev.filter((id) => !ids.includes(id)) : [...new Set([...prev, ...ids])]))
      }

      /** Everything the strip and the list need to know about health. */
      const failedSources = sources.filter(probeFailed)

      const visibleSources = sources.filter((source) => {
        if (filter === 'failed' && !probeFailed(source)) return false
        if (filter.indexOf('group:') === 0 && String(source.group || '').trim() !== filter.slice(6)) return false
        return sourceMatches(source, query)
      })

      const renderItem = (source) => {
        const probeInfo = source.lastProbe
        const failed = probeFailed(source)
        const checked = selected.includes(source.id)
        const badge = kindBadge(source.kind)
        return h(
          'li',
          {
            className:
              'dbmcp-item' +
              (checked ? ' is-selected' : '') +
              (draggingId === source.id ? ' is-dragging' : '') +
              (dropMark && dropMark.id === source.id ? (dropMark.after ? ' is-drop-after' : ' is-drop-before') : '') +
              (failed ? ' is-failed' : ''),
            key: source.id,
            onDragOver: (event) => {
              if (!draggingId || draggingId === source.id) return
              event.preventDefault()
              event.stopPropagation()
              /* Landing below the middle of a row means "after this one". */
              const rect = event.currentTarget.getBoundingClientRect()
              const after = event.clientY > rect.top + rect.height / 2
              if (!dropMark || dropMark.id !== source.id || dropMark.after !== after) {
                setDropMark({ id: source.id, after })
              }
            },
            onDragLeave: () => setDropMark((prev) => (prev && prev.id === source.id ? null : prev)),
            onDrop: (event) => {
              event.preventDefault()
              event.stopPropagation()
              const after = Boolean(dropMark && dropMark.id === source.id && dropMark.after)
              setDropMark(null)
              if (!draggingId || draggingId === source.id) return
              void dropOnRow(draggingId, source, after)
            },
          },
          h(
            'div',
            { className: 'dbmcp-item-row' },
            h(
              'span',
              {
                className: 'dbmcp-grip',
                title: t('group.dragHint'),
                draggable: true,
                onDragStart: (event) => {
                  setDraggingId(source.id)
                  try {
                    event.dataTransfer.setData('text/plain', source.id)
                    event.dataTransfer.effectAllowed = 'move'
                    const row = event.currentTarget.closest('.dbmcp-item')
                    if (row) event.dataTransfer.setDragImage(row, 16, 16)
                  } catch (error) {
                    /* some shells hand out a read-only dataTransfer; draggingId still carries the id */
                  }
                },
                onDragEnd: () => setDraggingId(null),
              },
              h('span', { className: 'dbmcp-grip-dots', 'aria-hidden': 'true' }),
            ),
            h(
              'label',
              { className: 'dbmcp-item-pick', title: source.name || source.id },
              h('input', {
                type: 'checkbox',
                checked,
                onChange: () => toggleSelected(source.id),
                'aria-label': source.name || source.id,
              }),
            ),
            h(
              'span',
              {
                className: 'dbmcp-kind-badge',
                style: {
                  color: badge.color,
                  background: `color-mix(in srgb, ${badge.color} 12%, transparent)`,
                  borderColor: `color-mix(in srgb, ${badge.color} 26%, transparent)`,
                },
                title: source.kind,
              },
              badge.label,
            ),
            h(
              'div',
              { className: 'dbmcp-item-main' },
              renamingSource && renamingSource.id === source.id
                ? h(
                    'form',
                    {
                      className: 'dbmcp-item-rename',
                      onClick: (event) => event.stopPropagation(),
                      onSubmit: (event) => {
                        event.preventDefault()
                        void renameSource()
                      },
                    },
                    h(TextInput, {
                      value: renamingSource.name,
                      onChange: (value) => setRenamingSource({ id: source.id, name: value }),
                      autoFocus: true,
                      onKeyDown: (event) => {
                        if (event.key === 'Escape') setRenamingSource(null)
                      },
                    }),
                    h('button', { type: 'submit', className: 'dbmcp-btn is-small is-primary' }, t('group.save')),
                    h(
                      'button',
                      { type: 'button', className: 'dbmcp-btn is-small', onClick: () => setRenamingSource(null) },
                      t('group.cancel'),
                    ),
                  )
                : h(
                    'div',
                    { className: 'dbmcp-item-name' },
                    h(
                      'span',
                      {
                        className: 'is-renamable',
                        title: t('group.renameHint'),
                        onDoubleClick: (event) => {
                          event.stopPropagation()
                          setRenamingSource({ id: source.id, name: source.name || source.id })
                        },
                      },
                      source.name || source.id,
                    ),
                    /* The engine already shows as the kind badge to the left of
                       the row, so the name line no longer repeats it. */
                    h(Switch, {
                      checked: source.readOnly === false,
                      label: source.readOnly === false ? t('sources.readwrite') : t('sources.readonly'),
                      title: source.readOnly === false ? t('action.lockSource') : t('action.unlockSource'),
                      disabled: busy,
                      onChange: () => {
                        void toggleReadOnly(source)
                      },
                    }),
                    // The list is kept on a read-only source (it is the next
                    // unlock's starting point), but showing it there reads as a
                    // permission that is not in force: it only earns a note once
                    // the source is actually writable.
                    showsWritable(source)
                      ? h(
                          'span',
                          {
                            className: 'dbmcp-note is-writable',
                            title: fmt(t('sources.writableHint'), { names: writableNames(source).join(', ') }),
                          },
                          fmt(t('sources.writable'), { names: writableNames(source).join(', ') }),
                        )
                      : null,
                    source.secretBroken === true
                      ? h('span', { className: 'dbmcp-note is-broken' }, t('sources.secretBroken'))
                      : null,
                    // The DDL switch only means something while the source is
                    // writable; on a locked row it would read as a permission
                    // that is not in force, exactly like the schema list.
                    showsWritable(source)
                      ? source.allowDdl === true
                        ? h('span', { className: 'dbmcp-note is-ddl', title: t('sources.ddlHint') }, t('sources.ddl'))
                        : h('span', { className: 'dbmcp-note is-ddl-off', title: t('sources.ddlBlockedHint') }, t('sources.ddlBlocked'))
                      : null,
                  ),
              h(
                'div',
                { className: 'dbmcp-item-meta' },
                source.target ? h('span', { className: 'dbmcp-item-target' }, source.target) : null,
                h(IdChip, { t, id: source.id, copied: copiedChip === source.id, onCopy: copyId }),
              ),
              failed
                ? null
                : h(
                    'div',
                    { className: 'dbmcp-probe ' + (probeInfo ? (probeInfo.ok ? 'is-ok' : 'is-error') : '') },
                    probeInfo ? '● ' + probeInfo.message : t('sources.neverProbed'),
                  ),
            ),
            h(
              'div',
              { className: 'dbmcp-item-actions', onClick: (event) => event.stopPropagation() },
              h(
                'button',
                { type: 'button', className: 'dbmcp-btn is-small is-plain', disabled: probing === source.id, onClick: () => probe(source) },
                probing === source.id ? t('action.testing') : t('action.test'),
              ),
              h('button', { type: 'button', className: 'dbmcp-btn is-small is-plain', onClick: () => setView({ mode: 'schema', source }) }, t('action.schema')),
              h('button', { type: 'button', className: 'dbmcp-btn is-small is-plain', onClick: () => setView({ mode: 'edit', source }) }, t('action.edit')),
              h(
                'button',
                {
                  type: 'button',
                  className: 'dbmcp-btn is-small is-plain is-danger',
                  onClick: () => remove(source),
                  onBlur: () => setPendingDelete((prev) => (prev === source.id ? null : prev)),
                },
                pendingDelete === source.id ? t('action.deleteConfirm') : t('action.delete'),
              ),
            ),
          ),
          failed
            ? h(
                'div',
                { className: 'dbmcp-item-failure' },
                h('span', { className: 'dbmcp-fail-tri', 'aria-hidden': 'true' }, '⚠'),
                h(
                  'span',
                  { className: 'dbmcp-fail-text' },
                  fmt(t('sources.failedLine'), { message: (probeInfo && probeInfo.message) || t('state.failed') }),
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'dbmcp-btn is-small is-plain',
                    title: t('action.copyErrorHint'),
                    onClick: (event) => {
                      event.stopPropagation()
                      void copyProbe(source)
                    },
                  },
                  copiedId === source.id ? t('action.copied') : t('action.copyError'),
                ),
              )
            : null,
        )
      }

      /** One group: a chevron, a select-all box and rename/delete, plus a drop zone. */
      const renderGroup = (name, items) => {
        const allChecked = items.length > 0 && items.every((item) => selected.includes(item.id))
        const renaming = editingGroup !== null && editingGroup.from === name
        const dropTarget = name
        const folded = collapsed.includes(name)
        return h(
          'section',
          {
            className: 'dbmcp-group' + (dragOverGroup === dropTarget ? ' is-over' : ''),
            key: name || '__none',
            onDragOver: (event) => {
              event.preventDefault()
              if (dragOverGroup !== dropTarget) setDragOverGroup(dropTarget)
            },
            onDragLeave: () => setDragOverGroup((prev) => (prev === dropTarget ? null : prev)),
            onDrop: (event) => {
              event.preventDefault()
              setDragOverGroup(null)
              let id = draggingId
              try {
                id = event.dataTransfer.getData('text/plain') || id
              } catch (error) {
                /* fall back to the id remembered on dragstart */
              }
              setDraggingId(null)
              if (id) void moveToGroup(id, name)
            },
          },
          h(
            'header',
            { className: 'dbmcp-group-head' },
            h('input', {
              type: 'checkbox',
              className: 'dbmcp-group-pick',
              checked: allChecked,
              onChange: () => toggleGroup(items),
              title: t('group.selectAll'),
              'aria-label': t('group.selectAll'),
            }),
            h('button', {
              type: 'button',
              className: 'dbmcp-fold' + (folded ? '' : ' is-open'),
              'aria-expanded': !folded,
              'aria-label': name || t('group.unassigned'),
              title: folded ? t('group.expand') : t('group.collapse'),
              onClick: () => toggleFolded(name),
            }),
            renaming
              ? h(
                  'form',
                  {
                    className: 'dbmcp-group-edit',
                    onSubmit: (event) => {
                      event.preventDefault()
                      void renameGroup()
                    },
                  },
                  h(TextInput, {
                    value: editingGroup.name,
                    onChange: (value) => setEditingGroup({ from: name, name: value }),
                    autoFocus: true,
                    onKeyDown: (event) => {
                      if (event.key === 'Escape') setEditingGroup(null)
                    },
                  }),
                  h('button', { type: 'submit', className: 'dbmcp-btn is-small is-primary' }, t('group.save')),
                  h('button', { type: 'button', className: 'dbmcp-btn is-small', onClick: () => setEditingGroup(null) }, t('group.cancel')),
                )
              : h(
                  'span',
                  {
                    className: 'dbmcp-group-name' + (name ? ' is-renamable' : ''),
                    title: name ? t('group.renameHint') : undefined,
                    onDoubleClick: () => {
                      if (name) setEditingGroup({ from: name, name })
                    },
                  },
                  name || t('group.unassigned'),
                ),
            h('span', { className: 'dbmcp-hint' }, t('group.count').replace('{n}', String(items.length))),
            name === '' || renaming
              ? null
              : h(
                  'span',
                  { className: 'dbmcp-group-actions' },
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'dbmcp-btn is-small is-plain is-danger',
                      onClick: () => void removeGroup(name),
                      onBlur: () => setPendingGroupDelete((prev) => (prev === name ? null : prev)),
                    },
                    pendingGroupDelete === name ? t('group.deleteConfirm') : t('group.delete'),
                  ),
                ),
          ),
          folded || items.length === 0
            ? folded
              ? null
              : h('div', { className: 'dbmcp-hint dbmcp-group-empty' }, t('group.empty'))
            : h('ul', { className: 'dbmcp-list' }, items.map(renderItem)),
        )
      }

      const renderGroupCreate = () =>
        h(
          'form',
          {
            className: 'dbmcp-group-create',
            onSubmit: (event) => {
              event.preventDefault()
              void createGroup()
            },
          },
          h(TextInput, {
            value: groupDraft,
            onChange: setGroupDraft,
            placeholder: t('group.newPlaceholder'),
            title: t('group.new'),
          }),
          h('button', { type: 'submit', className: 'dbmcp-btn is-small', disabled: !groupDraft.trim() }, t('group.add')),
        )

      const renderList = () => {
        if (sources.length === 0 && groupNames.length === 0) {
          return h(
            'div',
            { className: 'dbmcp-empty' },
            h('strong', null, t('sources.empty.title')),
            h('p', null, t('sources.empty.body')),
          )
        }
        if (visibleSources.length === 0) {
          return h('div', { className: 'dbmcp-empty' }, h('strong', null, t('sources.noMatch')))
        }
        const buckets = new Map()
        for (const name of groupNames) buckets.set(name, [])
        for (const source of visibleSources) {
          const key = String(source.group || '').trim()
          if (!buckets.has(key)) buckets.set(key, [])
          buckets.get(key).push(source)
        }
        /* An empty group still earns its section: it is the drop target for "put this here". */
        const narrowing = filter !== 'all' || query.trim() !== ''
        const order = sectionOrder(groupNames, visibleSources, narrowing)
        const loose = buckets.get('') || []
        /* A single unnamed bucket with rows in it needs no heading. */
        if (order.length === 1 && !order[0] && loose.length > 0) {
          return h('ul', { className: 'dbmcp-list' }, loose.map(renderItem))
        }
        return h(
          'div',
          { className: 'dbmcp-groups' },
          order.map((name) => renderGroup(name, buckets.get(name) || [])),
        )
      }

      const renderBulk = () => {
        if (selected.length === 0) return null
        const count = selected.length
        return h(
          'div',
          { className: 'dbmcp-bulk' },
          h('span', { className: 'dbmcp-bulk-count' }, t('bulk.selected').replace('{n}', String(count))),
          h('button', { type: 'button', className: 'dbmcp-btn is-small', disabled: busy, onClick: () => runBulk('test') }, t('bulk.test')),
          h(
            'button',
            { type: 'button', className: 'dbmcp-btn is-small', disabled: busy, onClick: () => runBulk('readOnly', { readOnly: true }) },
            t('bulk.readonly'),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'dbmcp-btn is-small',
              disabled: busy,
              onClick: () => {
                /* A source may only become writable once it names the schemas it
                   may write to, and that answer is per source — so a selection
                   without one is asked about instead of being rejected blind. */
                const chosen = selected.map((id) => sources.find((item) => item.id === id)).filter(Boolean)
                const pending = chosen.filter((item) => writableNames(item).length === 0)
                if (pending.length === 0) {
                  void runBulk('readOnly', { readOnly: false })
                  return
                }
                if (chosen.length === 1) {
                  openUnlock(chosen[0])
                  return
                }
                setNotice({ message: t('notice.bulkNeedsSchemas'), isError: true })
              },
            },
            t('bulk.readwrite'),
          ),
          h(
            'div',
            { className: 'dbmcp-bulk-group' },
            h(TextInput, {
              value: bulkGroup,
              onChange: setBulkGroup,
              placeholder: t('bulk.groupPlaceholder'),
              title: t('bulk.group'),
            }),
            h(
              'button',
              { type: 'button', className: 'dbmcp-btn is-small', disabled: busy, onClick: () => runBulk('group', { group: bulkGroup }) },
              t('bulk.apply'),
            ),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'dbmcp-btn is-small is-danger',
              disabled: busy,
              onClick: () => bulkDelete(),
              onBlur: () => setPendingBulkDelete(false),
            },
            pendingBulkDelete ? t('bulk.deleteConfirm').replace('{n}', String(count)) : t('bulk.delete'),
          ),
          h(
            'button',
            { type: 'button', className: 'dbmcp-btn is-small', onClick: () => setSelected([]) },
            t('bulk.clear'),
          ),
        )
      }

      const renderStatus = () =>
        h(StatusStrip, { t, data, sources, failedSources, groupNames, filter, setFilter, query, setQuery })

      /** One row per supported outside client: detected, configured, one click away. */
      const renderClientRow = (client) =>
        h(
          'div',
          { className: 'dbmcp-client', key: client.id },
          h(
            'div',
            { className: 'dbmcp-client-main' },
            h('span', { className: 'dbmcp-client-name' }, client.label),
            h('span', { className: 'dbmcp-hint dbmcp-mono' }, client.file || ''),
          ),
          client.configured
            ? h('span', { className: 'dbmcp-pill is-open' }, t('clients.configured'))
            : h('span', { className: 'dbmcp-hint' }, client.exists ? t('clients.notConfigured') : t('clients.noFile')),
          h(
            'button',
            {
              type: 'button',
              className: 'dbmcp-btn is-small',
              disabled: clientBusy === client.id,
              onClick: () => configureClient(client),
            },
            clientBusy === client.id ? t('clients.working') : t('clients.configure'),
          ),
        )

      /** The HTTP card: the URL to paste, the port, and who is already wired up. */
      const renderClients = () =>
        h(
          Card,
          {
            title: t('clients.title'),
            aside: h(
              'span',
              { className: http && http.running ? 'dbmcp-pill is-open' : 'dbmcp-pill' },
              http && http.running ? t('clients.running') : t('clients.stopped'),
            ),
          },
          h('p', { className: 'dbmcp-hint' }, t('clients.hint')),
          h(
            'div',
            { className: 'dbmcp-endpoint' },
            h('code', { className: 'dbmcp-endpoint-url' }, (http && http.url) || (clients && clients.url) || '—'),
            h(
              'button',
              {
                type: 'button',
                className: 'dbmcp-btn is-small',
                onClick: () => copyEndpoint((http && http.url) || (clients && clients.url) || ''),
              },
              copiedEndpoint ? t('clients.copied') : t('clients.copy'),
            ),
            h('input', {
              className: 'dbmcp-input dbmcp-port',
              inputMode: 'numeric',
              placeholder: String((settings && settings.httpPort) || 8765),
              value: portDraft,
              'aria-label': t('clients.port'),
              onChange: (event) => setPortDraft(event.target.value),
            }),
            h(
              'button',
              {
                type: 'button',
                className: 'dbmcp-btn is-small',
                disabled: busy,
                onClick: () => controlHttp(http && http.running ? 'stop' : 'start'),
              },
              http && http.running ? t('clients.stop') : t('clients.start'),
            ),
          ),
          http && http.error ? h('p', { className: 'dbmcp-hint is-error' }, http.error) : null,
          h(
            'div',
            { className: 'dbmcp-clients' },
            (clients && clients.clients ? clients.clients : []).map(renderClientRow),
          ),
          h('p', { className: 'dbmcp-hint' }, t('clients.stdioNote')),
        )

      /** Which tools the agent can see at all; the Python server still serves all of them. */
      const renderTools = () =>
        h(
          Card,
          {
            title: t('tools.title'),
            aside: h(
              'span',
              { className: 'dbmcp-pill' },
              `${tools && tools.tools ? tools.tools.filter((tool) => tool.enabled !== false).length : 0} / ${tools && tools.tools ? tools.tools.length : 0}`,
            ),
          },
          h('p', { className: 'dbmcp-hint' }, t('tools.hint')),
          h(
            'div',
            { className: 'dbmcp-tools' },
            (tools && tools.tools ? tools.tools : []).map((tool) =>
              h(
                'label',
                {
                  key: tool.name,
                  className: tool.enabled ? 'dbmcp-tool' : 'dbmcp-tool is-off',
                  title: tool.description || tool.name,
                },
                h('input', {
                  type: 'checkbox',
                  className: 'dbmcp-tool-pick',
                  checked: tool.enabled !== false,
                  disabled: busy,
                  onChange: (event) => toggleTool(tool.name, event.target.checked),
                }),
                h(
                  'div',
                  { className: 'dbmcp-tool-main' },
                  h('code', { className: 'dbmcp-tool-name' }, tool.full || tool.name),
                  h('span', { className: 'dbmcp-tool-desc' }, firstLine(tool.description)),
                ),
                tool.limit
                  ? h(
                      'span',
                      {
                        className: 'dbmcp-tool-limit',
                        title: fmt(t('tools.limitHint'), { max: tool.limit.max }),
                      },
                      h('input', {
                        type: 'number',
                        className: 'dbmcp-input dbmcp-limit',
                        min: tool.limit.min,
                        max: tool.limit.max,
                        step: 1,
                        value: limitDraft[tool.limit.key] !== undefined ? limitDraft[tool.limit.key] : tool.limit.value,
                        'aria-label': fmt(t('tools.limitLabel'), { argument: tool.limit.argument }),
                        disabled: busy,
                        onChange: (event) => setLimitDraft({ ...limitDraft, [tool.limit.key]: event.target.value }),
                        onBlur: () => commitLimit(tool.limit),
                        onKeyDown: (event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault()
                            event.currentTarget.blur()
                          }
                        },
                      }),
                      h('span', { className: 'dbmcp-limit-unit' }, t('tools.rows')),
                    )
                  : null,
              ),
            ),
          ),
          tools && tools.disabled && tools.disabled.length
            ? h('p', { className: 'dbmcp-hint' }, fmt(t('tools.offCount'), { n: tools.disabled.length }))
            : null,
        )

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
        body = h(Card, { title: null }, h(SourceForm, {
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
        body = h(Card, { title: fmt(t('schema.title'), { name: view.source.name || view.source.id }) },
          h(
            'div',
            { className: 'dbmcp-view-bar' },
            h(
              'button',
              { type: 'button', className: 'dbmcp-btn is-small', onClick: () => setView({ mode: 'list' }) },
              `← ${t('action.backToSources')}`,
            ),
            view.source.target ? h('span', { className: 'dbmcp-view-target' }, view.source.target) : null,
            h(IdChip, {
              t,
              id: view.source.id,
              copied: copiedChip === view.source.id,
              onCopy: copyId,
            }),
          ),
          h(SchemaView, {
            t,
            source: view.source,
            onBack: () => setView({ mode: 'list' }),
          }),
        )
      } else if (view.mode === 'import') {
        body = h(Card, { title: null }, h(ImportView, {
          t,
          existingIds: sources.map((item) => item.id),
          onImported: (payload) => {
            const count = (payload.imported || []).length
            const skippedCount = (payload.skipped || []).length
            const message =
              skippedCount > 0
                ? t('notice.importedSkipped').replace('{n}', String(count)).replace('{m}', String(skippedCount))
                : fmt(t('notice.imported'), { n: count })
            finish(message, false)
          },
          onCancel: () => setView({ mode: 'list' }),
        }))
      } else {
        body = h(
          'div',
          { className: 'dbmcp-grid is-single' },
          tab === 'list' ? renderStatus() : null,
          tab === 'list'
            ? h(
                Card,
                { title: null },
                h(
                  'header',
                  { className: 'dbmcp-list-head' },
                  h('h2', { className: 'dbmcp-card-title' }, t('tab.list')),
                  renderGroupCreate(),
                  h('span', { className: 'dbmcp-list-spacer' }),
                  h('span', { className: 'dbmcp-pill' }, t('sources.count').replace('{n}', String(sources.length))),
                  h('button', { type: 'button', className: 'dbmcp-btn is-small', disabled: busy, onClick: load }, t('action.refresh')),
                ),
                renderBulk(),
                renderList(),
              )
            : null,
          tab !== 'runtime'
            ? null
            : h(
            Card,
            {
              title: t('diag.title'),
              actions: h(
                'button',
                {
                  type: 'button',
                  className: 'dbmcp-btn is-small',
                  disabled: busy,
                  title: t('action.restartMcpHint'),
                  onClick: restartMcp,
                },
                t('action.restartMcp'),
              ),
            },
            h(
              'div',
              { className: 'dbmcp-rows' },
              h(Row, { label: t('diag.hostApi') }, h('span', { className: 'dbmcp-dot is-ok' }), t('state.connected')),
              h(Row, { label: t('diag.node') }, (data.host && data.host.node) || '-'),
              h(Row, { label: t('diag.plugin') }, `${data.plugin.name} ${data.plugin.version}`),
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
                { label: t('diag.scopes') },
                scopes && scopes.length
                  ? h(
                      'span',
                      { className: 'dbmcp-scope-list' },
                      scopes.map((entry) =>
                        h(
                          'span',
                          { className: 'dbmcp-scope', key: entry.session, title: entry.session },
                          h('span', { className: 'dbmcp-scope-id' }, shortSession(entry.session)),
                          h('span', { className: 'dbmcp-hint' }, (entry.ids || []).join(', ')),
                        ),
                      ),
                    )
                  : h('span', { className: 'dbmcp-hint' }, t('diag.scopesNone')),
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
                h(
                  'span',
                  { className: 'dbmcp-inline' },
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
              ),
              data.mcp && data.mcp.phase === 'failed' && /tools`? service/.test(String(data.mcp.error || ''))
                ? h(Row, { label: t('diag.tip') }, h('span', { className: 'dbmcp-hint' }, t('diag.restartNeeded')))
                : null,
              h(Row, { label: t('diag.uptime') }, formatUptime(data.host && data.host.uptimeMs)),
            ),
          ),
          tab !== 'clients' ? null : renderClients(),
          tab !== 'tools' ? null : renderTools(),
          tab !== 'audit'
            ? null
            : h(            Card,
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
                      h(
                        'span',
                        { className: 'dbmcp-audit-time', title: localStamp(entry.at) },
                        localClock(entry.at),
                      ),
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
              h('p', { className: 'dbmcp-hint' }, t('audit.tz').replace('{zone}', zoneLabel())),
              audit.file ? h('p', { className: 'dbmcp-hint' }, `${t('audit.file')}: ${audit.file}`) : null,
            ),
          ),
        )
      }

      /* Sub-views get the same full-width column the list uses: a bare Card in
         the panel's flex row would shrink to the intrinsic width of its inputs. */
      if (view.mode === 'create' || view.mode === 'edit' || view.mode === 'schema' || view.mode === 'import') {
        body = h('div', { className: 'dbmcp-grid is-single' }, body)
      }

      /* The unlock dialog. It asks the one question the write guard needs an
         answer to, and it refuses to close with an empty answer. */
      const unlockDialog = !unlock
        ? null
        : (() => {
            const names = unlockNames(unlock)
            const toggle = (name) =>
              setUnlock((prev) =>
                prev ? { ...prev, picked: { ...prev.picked, [name]: !prev.picked[name] } } : prev,
              )
            const confirm = async () => {
              if (names.length === 0) return
              const source = unlock.source
              const ddl = unlock.ddl === true
              setUnlock(null)
              try {
                await setReadOnly(source, false, names, ddl)
              } catch (error) {
                /* setReadOnly already raised the banner */
              }
            }
            return h(
              'div',
              { className: 'dbmcp-unlock', role: 'dialog', 'aria-modal': 'true' },
              h(
                'div',
                { className: 'dbmcp-unlock-card' },
                h(
                  'div',
                  { className: 'dbmcp-unlock-head' },
                  h('span', { className: 'dbmcp-unlock-title' }, fmt(t('unlock.title'), { name: unlock.source.name || unlock.source.id })),
                  h('span', { className: 'dbmcp-hint' }, t('unlock.hint')),
                ),
                unlock.busy
                  ? h('div', { className: 'dbmcp-empty' }, t('unlock.loading'))
                  : unlock.error
                    ? h(
                        'div',
                        { className: 'dbmcp-error' },
                        h('div', null, t('unlock.error')),
                        h('code', null, unlock.error),
                        h(
                          'button',
                          { type: 'button', className: 'dbmcp-btn is-small', onClick: () => openUnlock(unlock.source) },
                          t('unlock.retry'),
                        ),
                      )
                    : (unlock.catalog || []).length === 0
                      ? h('div', { className: 'dbmcp-empty' }, t('unlock.empty'))
                      : h(
                          'ul',
                          { className: 'dbmcp-unlock-list' },
                          (unlock.catalog || []).map((name) =>
                            h(
                              'li',
                              { key: `unlock-${name}` },
                              h(
                                'label',
                                { className: 'dbmcp-unlock-row' },
                                h('input', {
                                  type: 'checkbox',
                                  checked: unlock.picked[name] === true,
                                  onChange: () => toggle(name),
                                }),
                                h('span', { className: 'dbmcp-unlock-name' }, name),
                              ),
                            ),
                          ),
                        ),
                !unlock.busy && !unlock.error && (unlock.catalog || []).length > 0
                  ? h(
                      'div',
                      { className: 'dbmcp-unlock-ddl' },
                      h(
                        'label',
                        { className: 'dbmcp-check' },
                        h('input', {
                          type: 'checkbox',
                          checked: unlock.ddl === true,
                          onChange: (event) =>
                            setUnlock((prev) => (prev ? { ...prev, ddl: event.target.checked } : prev)),
                        }),
                        h('span', null, t('unlock.ddl')),
                      ),
                      h('span', { className: 'dbmcp-hint' }, t('unlock.ddlHint')),
                    )
                  : null,
                h(
                  'div',
                  { className: 'dbmcp-unlock-foot' },
                  h(
                    'span',
                    { className: 'dbmcp-hint' + (names.length === 0 ? ' is-warn' : '') },
                    names.length === 0 ? t('unlock.none') : fmt(t('unlock.selected'), { n: names.length }),
                  ),
                  h('button', { type: 'button', className: 'dbmcp-btn', onClick: () => setUnlock(null) }, t('unlock.cancel')),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'dbmcp-btn is-primary',
                      disabled: names.length === 0 || unlock.busy,
                      onClick: () => void confirm(),
                    },
                    t('unlock.confirm'),
                  ),
                ),
              ),
            )
          })()

      return h(
        'div',
        { className: 'dbmcp-page', style: palette },
        h('style', null, CSS),
        h(
          'header',
          { className: 'dbmcp-masthead' },
          h(
            'button',
            { type: 'button', className: 'dbmcp-back', onClick: backToChat },
            h('span', { className: 'dbmcp-back-caret', 'aria-hidden': 'true' }, '‹'),
            t('header.backToChat'),
          ),
          h('h1', null, t('panel.title')),
          h('span', { className: 'dbmcp-sub' }, t('panel.subtitle')),
          h('span', { className: 'dbmcp-masthead-spacer' }),
          h(
            'span',
            { className: 'dbmcp-pill' },
            h('span', { className: 'dbmcp-dot ' + (apiOk ? 'is-ok' : state.status === 'error' ? 'is-error' : '') }),
            apiOk ? t('state.connected') : state.status === 'loading' ? t('state.loading') : t('state.failed'),
          ),
          h(
            'a',
            {
              className: 'dbmcp-pill dbmcp-star',
              href: REPO_URL,
              target: '_blank',
              rel: 'noreferrer noopener',
              title: t('action.starHint'),
            },
            h('span', { className: 'dbmcp-star-mark', 'aria-hidden': 'true' }, '★'),
            t('action.star'),
          ),
          data && data.plugin ? h('span', { className: 'dbmcp-pill' }, `${data.plugin.name} ${data.plugin.version}`) : null,
        ),
        h(
          'nav',
          { className: 'dbmcp-tabs', role: 'tablist' },
          TABS.map((entry) =>
            h(
              'button',
              {
                key: entry.id,
                type: 'button',
                role: 'tab',
                'aria-selected': tab === entry.id,
                className: 'dbmcp-tab' + (tab === entry.id ? ' is-active' : ''),
                onClick: () => selectTab(entry.id),
              },
              tabLabel(t, entry.id),
            ),
          ),
        ),
        notice
          ? h(
              'div',
              { className: 'dbmcp-notice' + (notice.isError ? ' is-error' : '') },
              h('span', null, notice.message || notice),
              h('button', { type: 'button', className: 'dbmcp-btn is-small', onClick: () => setNotice(null) }, '×'),
            )
          : null,
        body,
        unlockDialog,
      )
    }

    return {
      inject: ['slots', 'locale', 'layout', 'theme'],
      /** Parser and components exposed for the offline tests in dev/. */
      __test: {
        TABS,
        tabLabel,
        parseConnectionText,
        uniqueId,
        slugId,
        canonicalUrl,
        emptyDraft,
        draftFromSource,
        SourceForm,
        SchemaView,
        ImportView,
        groupTables,
        tableMatches,
        connectionMatches,
        localClock,
        localStamp,
        TextInput,
        Switch,
        Breadcrumbs,
        MainPanel,
        IdChip,
        kindBadge,
        probeFailed,
        probeReport,
        reportTarget,
        StatusStrip,
        sourceMatches,
        writableNames,
        showsWritable,
        sectionOrder,
        paletteOf,
        parseColor,
      },
      apply(ctx) {
        localeService = ctx.locale
        layoutService = ctx.layout || null
        themeService = ctx.theme || null
        /* Two ways the active theme can change under us: the service tells its
           own subscribers, and the host echoes a theme/change event. Listen to
           both; either one invalidates the cached palette. */
        const refreshPalette = () => {
          paletteKey = ''
          themeSubs.forEach((notify) => notify())
        }
        if (themeService && typeof themeService.subscribe === 'function') {
          ctx.effect(() => themeService.subscribe(refreshPalette))
        }
        if (typeof ctx.on === 'function') {
          ctx.effect(() => ctx.on('theme/change', refreshPalette))
        }
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
