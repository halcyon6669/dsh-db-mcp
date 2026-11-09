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
    const TABS = [{ id: 'list' }, { id: 'create' }, { id: 'import' }, { id: 'runtime' }, { id: 'audit' }]

    /** Tab labels stay literal so the i18n check can see every key. */
    function tabLabel(t, id) {
      if (id === 'create') return t('tab.create')
      if (id === 'import') return t('tab.import')
      if (id === 'runtime') return t('tab.runtime')
      if (id === 'audit') return t('tab.audit')
      return t('tab.list')
    }

    /** The tab that owns a view; the form and the schema browser live under a tab. */
    function tabOfMode(mode) {
      if (mode === 'create' || mode === 'edit') return 'create'
      if (mode === 'import') return 'import'
      if (mode === 'runtime') return 'runtime'
      if (mode === 'audit') return 'audit'
      return 'list'
    }
    const API = '/plugins/db-mcp/api'
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
        'notice.importedSkipped': 'Imported {n} data source(s); skipped {m} already configured.',
        'notice.probeOk': '{name}: connection OK ({ms} ms).',
        'notice.probeFail': '{name}: {message}',
        'notice.mcpReady': 'MCP server is up with {count} tool(s).',
        'sources.count': '{n} configured',
        'sources.empty.title': 'No data source yet',
        'sources.empty.body': 'Add one here, or import the connections DBeaver already keeps on this machine. The agent queries real data through MCP tools, never through this page.',
        'sources.readonly': 'read-only',
        'sources.readwrite': 'writable',
        'sources.default': 'default',
        'sources.hasPassword': 'password saved',
        'sources.noPassword': 'no password',
        'sources.neverProbed': 'never tested',
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
        'action.schema': 'Structure',
        'action.backToSources': 'Data sources',
        'tab.list': 'Data source list',
        'tab.create': 'New data source',
        'tab.import': 'Import from DBeaver',
        'tab.runtime': 'Runtime',
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
        'sources.failedExpand': '(click to expand)',
        'sources.failedCollapse': '(click to collapse)',
        'sources.detail': 'Error details',
        'action.diagnose': 'Diagnose',
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
        'notice.importedSkipped': '已导入 {n} 个数据源，跳过 {m} 个已存在的。',
        'notice.probeOk': '{name}：连接正常（{ms} ms）。',
        'notice.probeFail': '{name}：{message}',
        'notice.mcpReady': 'MCP 服务已就绪，共 {count} 个工具。',
        'sources.count': '已配置 {n} 个',
        'sources.empty.title': '还没有数据源',
        'sources.empty.body': '可以在这里新增，也可以直接导入这台机器上 DBeaver 已有的连接。AI 通过 MCP 工具查询真实数据，不会在这个页面里执行 SQL。',
        'sources.readonly': '只读',
        'sources.readwrite': '可写',
        'sources.default': '默认',
        'sources.hasPassword': '已存密码',
        'sources.noPassword': '无密码',
        'sources.neverProbed': '尚未测试',
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
        'action.schema': '结构',
        'action.backToSources': '数据源',
        'tab.list': '数据源列表',
        'tab.create': '新建数据源',
        'tab.import': '从 DBeaver 导入',
        'tab.runtime': '运行时诊断',
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
        'sources.failedExpand': '（点击展开详情）',
        'sources.failedCollapse': '（点击收起详情）',
        'sources.detail': '错误详情',
        'action.diagnose': '诊断报错',
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
      button.dbmcp-pill {
        font-family: inherit;
        background: transparent;
        cursor: pointer;
        transition: color 120ms ease, border-color 120ms ease;
      }
      button.dbmcp-pill:hover {
        color: var(--dsw-alias-brand-primary);
        border-color: var(--dsw-alias-brand-primary);
      }
      button.dbmcp-pill.is-open {
        color: var(--dsw-alias-state-warn-primary);
        border-color: var(--dsw-alias-state-warn-primary);
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
        white-space: nowrap;
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
        flex-direction: column;
        gap: 8px;
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 10px;
        background: var(--dsw-alias-bg-layer-2);
        padding: 10px 12px;
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
      .dbmcp-grip-dot {
        display: block;
        width: 3px;
        height: 3px;
        border-radius: 50%;
        background: currentColor;
        color: var(--dsw-alias-label-secondary);
        opacity: 0.45;
      }
      .dbmcp-grip {
        display: grid;
        grid-template-columns: repeat(2, 3px);
        grid-template-rows: repeat(3, 3px);
        gap: 3px;
        justify-content: center;
        align-content: center;
      }
      .dbmcp-grip:hover .dbmcp-grip-dot {
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
        cursor: pointer;
        color: var(--dsw-alias-state-error-primary);
      }
      .dbmcp-fail-tri {
        flex: 0 0 auto;
        font-size: 13px;
        line-height: 1;
      }
      .dbmcp-fail-caret {
        flex: 0 0 auto;
        font-size: 12px;
        line-height: 1;
        transition: transform 120ms ease;
      }
      .dbmcp-fail-caret.is-open {
        transform: rotate(180deg);
      }
      .dbmcp-fail-text {
        flex: 1 1 260px;
        min-width: 0;
        font-size: 12px;
        overflow-wrap: anywhere;
      }
      .dbmcp-fail-detail {
        border-radius: 8px;
        border: 1px solid var(--dsw-alias-border-l1);
        background: var(--dsw-alias-bg-layer-1);
        padding: 8px 10px;
      }
      .dbmcp-fail-detail-head {
        font-size: 11px;
        font-weight: 600;
        color: var(--dsw-alias-label-secondary);
        margin-bottom: 4px;
      }
      .dbmcp-fail-detail pre {
        margin: 0;
        font-size: 11px;
        line-height: 1.5;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        color: var(--dsw-alias-label-primary);
      }
      .dbmcp-status {
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin-bottom: 14px;
        padding: 10px 12px;
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 10px;
        background: var(--dsw-alias-bg-layer-1);
      }
      .dbmcp-status-row {
        display: flex;
        align-items: center;
        gap: 10px;
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
        gap: 16px;
      }
      .dbmcp-group {
        display: flex;
        flex-direction: column;
        gap: 8px;
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
        margin-bottom: 14px;
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
        width: 18px;
        height: 18px;
        flex: 0 0 18px;
        padding: 0;
        border: none;
        border-radius: 5px;
        background: transparent;
        color: var(--dsw-alias-label-secondary);
        font-family: inherit;
        font-size: 12px;
        line-height: 1;
        cursor: pointer;
        transition: transform 120ms ease, color 120ms ease;
      }
      .dbmcp-fold:hover {
        color: var(--dsw-alias-label-primary);
      }
      .dbmcp-fold.is-folded {
        transform: rotate(-90deg);
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
        margin-bottom: 12px;
        padding: 8px 10px;
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
        min-width: 180px;
      }
      .dbmcp-bulk-group .dbmcp-input {
        min-width: 120px;
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
        margin: 0 0 12px;
        padding: 10px 0;
        background: var(--dsw-alias-bg-layer-1);
        border-bottom: 1px solid var(--dsw-alias-border-l1);
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
      const source = body.startsWith('//') ? body : '//' + body
      // `new URL` rejects a comma-separated authority, so the cluster list is
      // peeled off first and only the first node is handed to the URL parser.
      const cluster = /^\/\/([^/?#]+)/.exec(source)
      const authorityText = cluster ? cluster[1] : ''
      const at = authorityText.lastIndexOf('@')
      const hostList = at >= 0 ? authorityText.slice(at + 1) : authorityText
      const single = hostList.includes(',') ? hostList.split(',')[0] : hostList
      const normalized = cluster
        ? `//${at >= 0 ? authorityText.slice(0, at + 1) : ''}${single}${source.slice(cluster[0].length)}`
        : source
      let url
      try {
        url = new URL('db:' + normalized)
      } catch (error) {
        return { ok: false, code: 'url' }
      }
      const query = parseQueryString(url.search)
      const database = decodePart(url.pathname.replace(/^\/+/, ''))
      const config = baseConfig(kind)
      // openGauss lists every node before the path (`h1:1,h2:2`); the URL parser
      // keeps the first one, so split the original authority for the rest.
      config.host = url.hostname || 'localhost'
      config.port = url.port || DEFAULT_PORTS[kind] || ''
      if (cluster && hostList.includes(',')) {
        const nodes = hostList
          .split(',')
          .map((piece) => /^([^:]+)(?::(\d+))?$/.exec(piece.trim()))
          .filter(Boolean)
          .map((match) => ({ host: match[1], port: match[2] ? Number(match[2]) : Number(config.port) || null }))
        if (nodes.length > 1) {
          config.hosts = nodes
          config.host = nodes.map((node) => node.host).join(',')
        }
      }
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
      draft.group = (source && source.group) || ''
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
                onChange: (value) => {
                  onRawChange(value)
                  if (missing.url) setMissing((prev) => ({ ...prev, url: false }))
                },
                invalid: missing.url === true,
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
              onChange: (value) => {
                patchConfig({ user: value })
                if (missing.user) setMissing((prev) => ({ ...prev, user: false }))
              },
              invalid: missing.user === true,
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
                invalid: missing.password === true,
                placeholder: draft.hasSecret ? '********' : t('form.passwordEmpty'),
                onChange: (value) => {
                  patch({ password: value })
                  if (missing.password && value.trim()) setMissing((prev) => ({ ...prev, password: false }))
                },
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
          ),
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

/** A stored probe that ended in failure is what the red row is about. */
const probeFailed = (source) => Boolean(source && source.lastProbe && source.lastProbe.ok === false)

const sourceMatches = (source, needle) => {
  const text = String(needle || '').trim().toLowerCase()
  if (!text) return true
  const hay = [source.name, source.id, source.kind, source.target, source.group, source.lastProbe && source.lastProbe.message]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  return hay.includes(text)
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

      let content
      if (busy && !tables) {
        content = h('div', { className: 'dbmcp-empty' }, t('schema.loading'))
      } else if (error) {
        content = h('div', { className: 'dbmcp-error' }, h('div', null, t('schema.error')), h('code', null, error))
      } else if (!tables || tables.length === 0) {
        content = h('div', { className: 'dbmcp-empty' }, t('schema.empty'))
      } else {
        const side = h(
          'div',
          { className: 'dbmcp-schema-side' },
          h(
            'div',
            { className: 'dbmcp-schema-head' },
            h('span', null, fmt(t('schema.tables'), { n: tables.length })),
            needle ? h('span', { className: 'dbmcp-hint' }, fmt(t('schema.matching'), { n: visibleCount })) : null,
          ),
          h(TextInput, {
            value: filter,
            placeholder: t('schema.search'),
            label: t('schema.search'),
            onChange: setFilter,
          }),
          visibleCount === 0
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
                      h('span', { className: 'dbmcp-schema-group-name' }, groupLabel(schema)),
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
                                h('span', null, table.name),
                                table.type ? h('span', { className: 'dbmcp-pill' }, table.type) : null,
                              ),
                            )
                          }),
                        ),
                  )
                }),
              ),
        )

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
                          h('span', null, pickedSchema ? `${pickedSchema}.${detail.table}` : detail.table),
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
      const t = React.useMemo(() => (service ? service.bind(NS) : (key) => key), [service])
      const [state, setState] = React.useState({ status: 'loading', data: null, error: null })
      const [busy, setBusy] = React.useState(false)
      const [view, setView] = React.useState({ mode: 'list' })
      const tab = tabOfMode(view.mode)
      const [notice, setNotice] = React.useState(null)
      const [probing, setProbing] = React.useState(null)
      const [pendingDelete, setPendingDelete] = React.useState(null)
      const [selected, setSelected] = React.useState([])
      const [bulkGroup, setBulkGroup] = React.useState('')
      const [pendingBulkDelete, setPendingBulkDelete] = React.useState(false)
      const [groupDraft, setGroupDraft] = React.useState('')
      const [editingGroup, setEditingGroup] = React.useState(null)
      const [pendingGroupDelete, setPendingGroupDelete] = React.useState(null)
      const [draggingId, setDraggingId] = React.useState(null)
      const [dragOverGroup, setDragOverGroup] = React.useState(null)
      const [renamingSource, setRenamingSource] = React.useState(null)
      const [query, setQuery] = React.useState('')
      const [filter, setFilter] = React.useState('all')
      const [expandedFail, setExpandedFail] = React.useState(null)
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

      /** Flip one source between read-only and writable by clicking its pill. */
      const toggleReadOnly = async (source) => {
        const wasWritable = source.readOnly === false
        const nowWritable = !wasWritable
        const name = source.name || source.id
        setBusy(true)
        try {
          await apiPost('/datasources/bulk', { action: 'readOnly', ids: [source.id], readOnly: !nowWritable })
          const globalOpen = Boolean(settings && settings.allowWrite)
          const message = !nowWritable
            ? t('notice.nowReadOnly').replace('{name}', name)
            : globalOpen
              ? t('notice.nowWritable').replace('{name}', name)
              : t('notice.nowWritableLocked').replace('{name}', name)
          setNotice({ message, isError: false })
          load()
        } catch (error) {
          setNotice({ message: String((error && error.message) || error), isError: true })
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
        const expanded = expandedFail === source.id
        const toggleDetail = () => setExpandedFail(expanded ? null : source.id)
        return h(
          'li',
          {
            className:
              'dbmcp-item' +
              (checked ? ' is-selected' : '') +
              (draggingId === source.id ? ' is-dragging' : '') +
              (failed ? ' is-failed' : ''),
            key: source.id,
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
              [0, 1, 2, 3, 4, 5].map((dot) => h('i', { key: dot, className: 'dbmcp-grip-dot' })),
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
                    h('span', { className: 'dbmcp-pill' }, source.kind),
                    source.isDefault ? h('span', { className: 'dbmcp-pill' }, t('sources.default')) : null,
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'dbmcp-pill is-toggle ' + (source.readOnly === false ? 'is-open' : 'is-locked'),
                        title: source.readOnly === false ? t('action.lockSource') : t('action.unlockSource'),
                        'aria-pressed': source.readOnly === false,
                        onClick: (event) => {
                          event.stopPropagation()
                          void toggleReadOnly(source)
                        },
                      },
                      source.readOnly === false ? t('sources.readwrite') : t('sources.readonly'),
                    ),
                  ),
              h('div', { className: 'dbmcp-item-target' }, [source.target, source.id].filter(Boolean).join(' · ')),
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
              source.isDefault
                ? null
                : h('button', { type: 'button', className: 'dbmcp-btn is-small is-plain', onClick: () => makeDefault(source) }, t('action.makeDefault')),
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
                { className: 'dbmcp-item-failure', onClick: toggleDetail },
                h('span', { className: 'dbmcp-fail-tri', 'aria-hidden': 'true' }, '⚠'),
                h(
                  'span',
                  { className: 'dbmcp-fail-text' },
                  fmt(t('sources.failedLine'), { message: (probeInfo && probeInfo.message) || t('state.failed') }),
                ),
                h('span', { className: 'dbmcp-hint' }, expanded ? t('sources.failedCollapse') : t('sources.failedExpand')),
                h('span', { className: 'dbmcp-fail-caret' + (expanded ? ' is-open' : ''), 'aria-hidden': 'true' }, '⌄'),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'dbmcp-btn is-small',
                    onClick: (event) => {
                      event.stopPropagation()
                      toggleDetail()
                    },
                  },
                  t('action.diagnose'),
                ),
              )
            : null,
          failed && expanded
            ? h(
                'div',
                { className: 'dbmcp-fail-detail' },
                h('div', { className: 'dbmcp-fail-detail-head' }, t('sources.detail')),
                h('pre', null, (probeInfo && probeInfo.message) || t('state.failed')),
                probeInfo && probeInfo.at ? h('div', { className: 'dbmcp-hint' }, localStamp(probeInfo.at)) : null,
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
            h(
              'button',
              {
                type: 'button',
                className: 'dbmcp-fold' + (folded ? ' is-folded' : ''),
                'aria-expanded': !folded,
                title: folded ? t('sources.failedExpand') : t('sources.failedCollapse'),
                onClick: () => toggleFolded(name),
              },
              '⌄',
            ),
            h('input', {
              type: 'checkbox',
              className: 'dbmcp-group-pick',
              checked: allChecked,
              onChange: () => toggleGroup(items),
              title: t('group.selectAll'),
              'aria-label': t('group.selectAll'),
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
        const order = groupNames.filter((name) => (buckets.get(name) || []).length > 0)
        const loose = buckets.get('') || []
        if (loose.length > 0) order.push('')
        if (order.length === 1 && !order[0]) {
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
            { type: 'button', className: 'dbmcp-btn is-small', disabled: busy, onClick: () => runBulk('readOnly', { readOnly: false }) },
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
            { className: 'dbmcp-schema-head' },
            h(
              'button',
              { type: 'button', className: 'dbmcp-btn is-small', onClick: () => setView({ mode: 'list' }) },
              `← ${t('action.backToSources')}`,
            ),
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
                  selected.length > 0
                    ? h('span', { className: 'dbmcp-hint' }, t('bulk.selected').replace('{n}', String(selected.length)))
                    : null,
                  selected.length > 0
                    ? h(
                        'button',
                        {
                          type: 'button',
                          className: 'dbmcp-btn is-small is-danger',
                          disabled: busy,
                          onClick: () => bulkDelete(),
                          onBlur: () => setPendingBulkDelete(false),
                        },
                        pendingBulkDelete
                          ? t('bulk.deleteConfirm').replace('{n}', String(selected.length))
                          : t('bulk.delete'),
                      )
                    : null,
                  h('button', { type: 'button', className: 'dbmcp-btn is-small', disabled: busy, onClick: load }, t('action.refresh')),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'dbmcp-btn is-small',
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
                  ),
                ),
                renderBulk(),
                renderList(),
              )
            : null,
          tab !== 'runtime'
            ? null
            : h(
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
          tab !== 'audit'
            ? null
            : h(
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

      return h(
        'div',
        { className: 'dbmcp-page' },
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
              h('span', null, notice.message),
              h('button', { type: 'button', className: 'dbmcp-btn is-small', onClick: () => setNotice(null) }, '×'),
            )
          : null,
        body,
      )
    }

    return {
      inject: ['slots', 'locale', 'layout'],
      /** Parser and components exposed for the offline tests in dev/. */
      __test: {
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
        Breadcrumbs,
        MainPanel,
        kindBadge,
        probeFailed,
        StatusStrip,
        sourceMatches,
      },
      apply(ctx) {
        localeService = ctx.locale
        layoutService = ctx.layout || null
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
