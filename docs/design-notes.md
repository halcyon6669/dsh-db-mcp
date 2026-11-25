> **Design notes.** The current-state specification for the plugin: what it
> manages, the data model, the four gates, and the reasoning behind each decision.
> Written in Chinese. For what changed in which version see
> [../CHANGELOG.md](../CHANGELOG.md); for usage start at [../README.md](../README.md)
> and [guide.md](guide.md), for the wire format [reference.md](reference.md).

# DSH 数据库插件 `dsh-db-mcp` 设计说明

> 状态：只描述**当前**的闸门、数据模型、配置项与工具面，随版本修订。
> 逐版本的「改了什么、为什么改」在 [CHANGELOG.md](../CHANGELOG.md)；
> P2 → P7 的建站过程留在 git 历史里（`git log --follow docs/design-notes.md`）。
> 决策来源：D1=SQLite+PostgreSQL+openGauss+MySQL+Oracle；D2=默认只读 + 三道闸门（全局写开关 + 单源只读 + DDL 开关）；D3=插件内 venv + 官方 mcp SDK；D4=页面只做数据源管理，不做手工查询
> 目标读者：需求方（你）+ 后续实现者（我）

---

## 0. 结论摘要

| 项 | 结论 |
|---|---|
| 形态 | DSH 插件包：**Host 半边**（Cordis）+ **Client 半边**（Web 页面）+ **Python MCP 服务** |
| 入口 | 侧栏图标（`sidebar.panellist`，id=`db-mcp`，order=25）+ 主面板（`main`，同 id） |
| 页面职责 | **只管数据源与关系图**：增删改查、连接测试、状态与诊断、表间连接管理。不做 SQL 查询台、不做数据浏览 |
| 查询职责 | 全部交给 AI，经 MCP 工具 `mcp__db__*` 完成 |
| 数据源 | 单一 MCP 服务进程内管理 N 个数据源，工具用 `datasource` 参数寻址 |
| 支持类型 | SQLite / PostgreSQL / **openGauss** / MySQL / Oracle（v1 四种，0.7.5 起五种） |
| 安全基线 | 默认只读；三道闸门：全局写开关 + 单源只读 + DDL 开关；行数/超时硬上限；密码加密后落盘 |
| 状态目录 | `$DSH_HOME/db-mcp/`（注册表 + 加密口令 + 设置 + 会话白名单 + 审计 + venv） |
| 明确不做 | 页面内查询、数据编辑、**图形化** ER 图（节点连线画布）、同步/备份、图表可视化（DDL 自 0.6.0 起作为工具存在，0.9.7 起单独授权；关系图以列表形态管理，见 FR-MCP-7e；追踪页只收一个值，SQL 由服务端拼装，见 FR-MCP-7f） |

> 这张表和下面的第 3、4、5、6、7、11、12 节描述的是**当前状态**，随版本修订；
> 维护规则见最后一节。

---

## 1. 目标与非目标

### 1.1 目标

1. **一个入口配好所有库**：侧栏点开即可管理数据源，不再手改配置文件。
2. **多源并存**：任意数量数据源，类型可混，互不影响。
3. **让模型真正用得上**：标准 MCP 协议暴露工具，模型在对话里直接查数、看结构。
4. **故障自解释**：Python 缺失、驱动缺失、密码错误、MCP 未加载，页面都要说清原因和修复动作。

### 1.2 非目标（v1）

- 页面内 SQL 编辑器、结果表格、数据预览、数据编辑 —— **全部不做**（用户明确：只有 AI 调用 MCP）。
- 数据同步 / ETL / 备份恢复 / 迁移。
- 图形化 ER 图（节点连线画布）、可视化建模、图表。表间连接以**列表形态**的关系图管理（FR-MCP-7e），这是为了回答「什么连接什么」，不是为了画图。追踪页（FR-MCP-7f）同样只是查看与判断，它接收一个值、由服务端按关系图拼装并绑定参数的语句，本身不是 SQL 入口。
- DDL（CREATE/ALTER/DROP）、事务编排、存储过程调试。
- 数据库账号与权限管理、远程多人共享。

> 页面唯一的"非管理"能力保留为**可选 P2**：只读结构概览（表/列清单），用于确认"这个源连对了"。若你希望页面更纯粹，这一项也可以砍掉，不阻塞任何验收。

---

## 2. 角色与场景

| 场景 | 用户动作 | 期望结果 |
|---|---|---|
| S1 首次接入 | 侧栏 → 新建 → 选 SQLite → 选文件 → 测试 → 保存 | 列表出现该源，状态「已连接」，模型立刻可用 |
| S2 日常提问 | 对话里问「orders 表有哪些字段」 | 模型调 `describe_table`，无需用户再提供连接信息 |
| S3 换库 | 新建 PostgreSQL 源并设为默认 | 模型不传 `datasource` 时落到默认源 |
| S4 排错 | 页面显示「oracledb 未安装」 | 点「初始化运行时」，装完自动重连，不用重启 DSH |
| S5 误操作防护 | 只读源上模型尝试 `DELETE` | 服务端拒绝并返回可读原因，页面无感知但审计有记录 |

---

## 3. 总体架构

### 3.1 组件

```
┌──────────────────────── DSH Web GUI（端口每次启动不同）──────────────────────┐
│  Client 半边（dsh.client, platform: web）                                  │
│    · sidebar.panellist: id=db-mcp, order=25, label 走 locale              │
│    · main: id=db-mcp → 数据源管理页（七个标签）                            │
│    · 通过 ctx.connection 的 exact route / RPC 调 Host                     │
└────────────────────────────────┬───────────────────────────────────────────┘
                                 │ 本机回环 HTTP + 登录 Cookie
┌────────────────────────────────▼───────────────────────────────────────────┐
│  Host 半边（Cordis 插件）                                                  │
│    · 注册表 CRUD + 参数校验                                                │
│    · 密码 → AES-256-GCM 信封写进 secrets.json（密钥 secret.key）           │
│    · 设置 / 会话白名单 / 审计日志                                          │
│    · 探测 Python、回写 MCP 行配置、健康检查                                 │
│    · 可启动第二个 Python 进程：Streamable HTTP 端点给外部客户端             │
└────────────────────────────────┬───────────────────────────────────────────┘
                                 │ stdio（MCP JSON-RPC）
┌────────────────────────────────▼───────────────────────────────────────────┐
│  Python MCP 服务（server/，官方 mcp SDK + 五种驱动）                        │
│    · 懒加载、懒建连接、每次调用重读注册表                                  │
│    · 工具：test_connection / list_datasources / list_tables /              │
│            describe_table / list_edges / propose_relation /                 │
│            discover_relations / feedback_relation /                        │
│            set_relation_condition / delete_edge / trace_by_key /           │
│            sample_rows / execute_sql / explain_query / get_ddl              │
│    · 三道闸门、行数上限、超时、错误分级                                     │
└────────────────────────────────────────────────────────────────────────────┘
```

> HTTP 那半个进程回答同一套工具：外部 MCP 客户端（VS Code、Cursor、Claude Code 等）
> 连的是 `http://127.0.0.1:8765/dsh-db-mcp`，走的是同一个 `server/main.py`，读写同一份
> 注册表与设置，因此三道闸门对它们同样生效（见 0.9.6 与 0.9.7 两节）。

### 3.2 三条数据流

1. **配置流**：页面 → Host API → 注册表 + 加密口令 → Python 每次调用时直接读 `datasources.json` / `secrets.json`（**不再派生 `runtime.json`**）。**改完即生效，无需重启 DSH。**
2. **模型流**：模型 → `mcp__db__execute_sql` → MCP client（stdio）→ Python → 目标库 → 结构化结果回对话。
3. **页面流**：页面 → Host API → 短命探测（SQLite 用 `node:sqlite`，其余经 MCP 的 `test_connection`）→ JSON 回包。页面不直连数据库，Node 侧不装任何数据库驱动。

### 3.3 关键取舍

| 取舍 | 采用方案 | 理由 |
|---|---|---|
| MCP 进程模型 | **一个服务 + 工具参数 `datasource`** | 工具面固定；增删数据源不需要动 Loader 行、不需要重启 |
| 页面 ↔ Host | Host 注册 `POST /plugins/db-mcp/api/*`，前端 `fetch` | 纯 JS 包可直接跑，无需代码生成流水线 |
| 密码存放 | AES-256-GCM 信封 + `secret.key`（0600） | 拷贝 `secrets.json` 不能带走口令；换源即解密失败（AAD 绑定源 id） |
| 连接测试位置 | Python 侧（经 MCP `test_connection`） | 驱动只装一份，避免 Node 重复实现五种方言 |
| 外部客户端接入 | 同一个 Python 服务的第二个实例，走 Streamable HTTP | 工具面、闸门、注册表全部复用，不另写一套 |

---

## 4. 功能需求

优先级：**P0** 首个可用版本必须有；**P1** 紧随其后；**P2** 可延后或不做。

### 4.1 页面骨架（FR-UI）

| ID | 需求 | 优先级 |
|---|---|---|
| FR-UI-1 | 侧栏独立图标 + 名称，点击进入主面板；重复点击不重复挂载 | P0 |
| FR-UI-2 | 图标/名称随语言切换（zh/en），文案全部走 locale，组件内不硬编码 | P0 |
| FR-UI-3 | ~~两栏布局：左侧数据源列表（含状态点），右侧详情/表单区~~ **已推翻**：0.6.1–0.6.2 改成「返回会话 + 七个标签」的单栏面板（列表 / 新建 / 导入 / 接入客户端 / 运行时诊断 / 工具 / 审计），同一时刻只显示一个标签的内容 | P0 |
| FR-UI-4 | 空态：无数据源时展示引导 + 各类型的快捷入口 | P0 |
| FR-UI-5 | 跟随 DSH 浅色/深色主题，只用主题 token，不自造色板 | P0 |
| FR-UI-6 | 窄窗口下标签栏换行、表单两列/三列折成一列（标签条早期做横向滚动且隐藏滚动条，结果把最右那个标签的胶囊切一半，已改回换行） | 已实现 |
| FR-UI-7 | 页面只有「数据源管理」一个视图，无查询/编辑入口 | P0 |

### 4.2 数据源管理（FR-DS）

**逻辑字段**

| 字段 | 说明 |
|---|---|
| `id` | 稳定标识 `[a-z0-9-]{1,32}`，创建后不可改（模型工具用它寻址） |
| `name` | 展示名，可改（双击行内改名） |
| `kind` | `sqlite` / `postgres` / `gauss` / `mysql` / `oracle` |
| `config` | 类型相关参数（见下表） |
| `readOnly` | 是否只读，默认 `true` |
| `allowDdl` | 是否允许 DDL，默认 `false`，行上与可写开关并排的独立开关 |
| `group` | 所属分组名，空串即「未分组」 |
| `isDefault` | 保留字段：0.8.0 删掉了「设为默认」动作，省略 `datasource` 时按 `store.resolve()` 先找 `isDefault`、再退回第一项 |
| `tags` | 自由标签（上限 8 个），导入页按此过滤 |
| `lastProbe` | 最近一次测试结果 + 时间 |
| `createdAt`/`updatedAt` | 时间戳 |

**各类型连接参数**

| kind | 必填 | 可选 |
|---|---|---|
| sqlite | `file` | `readOnlyOpen`、`busyTimeoutMs` |
| postgres | `host`、`port`、`database`、`user` | `schema`（默认 public）、`sslMode`（disable/prefer/require/verify-full）、`applicationName` |
| gauss | `host`、`port`、`database`、`user` | `hosts[]`（集群多节点，`{host, port}`）、`sslMode` |
| mysql | `host`、`port`、`database`、`user` | `charset`（默认 utf8mb4）、`ssl`（true/false）、`connectTimeoutMs` |
| oracle | `host`、`port`、`serviceName` 或 `sid`、`user` | `schema`（默认=user）、`mode`（thin/thick，默认 thin）、`walletDir` |

> 密码不在注册表里：`secrets.json` 存的是 `v1.<iv>.<tag>.<ct>` 形式的 AES-256-GCM 信封，
> 数据源 id 作为 AAD 绑定（见 0.9.7 一节）。

| ID | 需求 | 优先级 |
|---|---|---|
| FR-DS-1 | 新建：选类型 → 填参数 → （可选）测试 → 保存 | P0 |
| FR-DS-2 | 编辑：除 `id` 外均可改；密码留空=不修改 | P0 |
| FR-DS-3 | 删除：二次确认，提示「模型工具将立即失去该源」 | P0 |
| FR-DS-4 | 保存前字段级校验（端口范围、必填、路径存在性、id 冲突） | P0 |
| FR-DS-5 | SQLite：路径手填 + 目录浏览；文件不存在时询问「新建空库」或「仅存配置」 | P0 |
| FR-DS-6 | 列表搜索（名称/id/标签）+ 按类型筛选 | P1 |
| FR-DS-7 | 每个字段有样例占位（如 `localhost:5432`、`ORCLPDB1`） | P1 |
| FR-DS-8 | ~~设默认源时自动取消其它，列表有「默认」徽标~~ **已删除**（0.8.0 的 `67c697c`）：省略 `datasource` 时按 `store.resolve()` 先找 `isDefault`、再退回第一项，字段保留但不再有 UI | — |
| FR-DS-9 | 复制为新数据源（同实例多库场景） | P2 |
| FR-DS-10 | 导出/导入数据源清单（**不含密码**） | P2 |

### 4.3 连接测试（FR-TEST）

| ID | 需求 | 优先级 |
|---|---|---|
| FR-TEST-1 | 返回：成功/失败、耗时、服务端版本、当前库/模式 | P0 |
| FR-TEST-2 | 失败分类可读：网络不可达 / 认证失败 / 库不存在 / 驱动缺失 / 超时 / TLS 失败 / 服务名错误 | P0 |
| FR-TEST-3 | 超时默认 10s，可配置；超时必须返回而非挂死 | P0 |
| FR-TEST-4 | 无副作用：只跑 `SELECT 1` 类探针，不建表不写库 | P0 |
| FR-TEST-5 | 列表展示「最近一次结果 + 相对时间」 | P1 |
| FR-TEST-6 | 批量测试全部数据源，汇总结果 | P2 |

### 4.4 结构概览（FR-META，**可选 P2**）

| ID | 需求 | 优先级 |
|---|---|---|
| FR-META-1 | 树形只读浏览：schema → 表/视图（**不含数据行**） | P2 |
| FR-META-2 | 展开表显示列名、类型、可空、主键 | P2 |
| FR-META-3 | 元数据缓存 60s + 手动刷新 | P2 |
| FR-META-4 | 表名模糊过滤 | P2 |

> 该组需求服务于「确认这个源连对了没」，与查询能力无关。若你要页面更纯粹，整组删除不影响后续任何验收项。

### 4.5 页面内查询：**不做**

理由：你的使用方式是「AI 经 MCP 查询」，页面内再放查询台会带来写权限、结果渲染、上下文占用三类额外风险，且与 MCP 路径重复。因此：

- 无 SQL 输入框、无结果表格、无 CSV 导出、无查询历史。
- 页面所有按钮都只操作**配置**，不执行用户 SQL。
- 关系图与追踪页不是查询台的例外：追踪页只接收一个**值**，SQL 由服务端按关系图拼装并参数绑定，面板无法指定表、列或谓词。

### 4.6 MCP 工具面（FR-MCP）

统一约定：

- 服务名 `db` → 工具名 `mcp__db__execute_sql`。
- 所有工具第一个参数 `datasource`（省略时先找 `isDefault`，再退回第一项）。
- 返回结构化结果：`columns[{name,type}]`、`rows[][]`、`rowCount`、`truncated`、`elapsedMs`；写操作返回 `affectedRows`。
- 错误分级：`user_error`（参数错/源不存在/写入被守卫拒绝）、`db_error`（SQL 语法错、权限、表不存在等驱动抛出的错误）、`timeout`（语句超过 `DB_MCP_STATEMENT_TIMEOUT_MS` 被中止）、`infra_error`（驱动没装、venv 坏了、注册表读不了——只留给「插件自己没走到那一步」）。

| ID | 工具 | 作用 | 优先级 |
|---|---|---|---|
| FR-MCP-1 | `list_datasources` | 列出源（id、名称、类型、只读、是否默认），不含敏感信息 | P0 |
| FR-MCP-2 | `list_tables` | 指定源的 schema/表/视图清单，支持名称过滤；0.9.7 起同时返回 `schemas[]` | P0 |
| FR-MCP-3 | `describe_table` | 列定义、主键、索引概要、注释 | P0 |
| FR-MCP-4 | `sample_rows` | 取某表样例（默认 20 行），模型无需自己写 `SELECT *` | P1 |
| FR-MCP-5 | `execute_sql` | 执行**任意单条**语句（不只查询），带 `max_rows`；写语句返回 `affectedRows` | P0 |
| FR-MCP-6 | `explain_query` | 执行计划，按方言降级（Oracle 用 `EXPLAIN PLAN`，MySQL/PG 用 `EXPLAIN`） | P2 |
| FR-MCP-7 | `get_ddl` | 取建表语句（0.6.0 加入） | P1 |
| FR-MCP-7b | `list_edges` / `propose_relation` / `discover_relations` | 关系图：唯一的「什么连什么」来源。`discover_relations` 把目录里声明的外键导进图，`propose_relation` 记下目录没声明的 join，`list_edges` 列出全部边与状态 | P1 |
| FR-MCP-7c | `trace_by_key` | 按值追踪：从一个值出发，沿**已确认**的边跨表走，逐步报告表、条件、SQL、命中行数、耗时与边来源；未确认的边只提示不跟随。「目标列无索引且表估计 ≥100 万行」的步骤不执行，返回 `needs_confirm` 并等 `confirm_slow`；行数或索引未知时不拦 | P1 |
| FR-MCP-7d | `feedback_relation` / `set_relation_condition` / `delete_edge` | 边的状态机：`ok` 确认（三次 + 无拒绝 + 扇出≤5 + 最近至少三次实测都 <200ms → `trusted`；索引只是加分项），`too_many`/`missing` 降为 `stale`，`irrelevant` 进黑名单；条件增删与删除边 | P1 |
| FR-MCP-7e | 面板「关系图」页 | 数据源级边列表：状态角标、来源、确认次数、扇出、目标列有无索引、平均每步耗时；筛选 全部/待确认/已确认/已失效；按状态给出确认、带原因拒绝、加条件、重新打开、删除；已确认/自动信任的边可展开看确认记录。面板只调关系图工具，不接受 SQL | P1 |
| FR-MCP-7f | 面板「追踪」页 | 只收一个**值**（可选入口表/列与方向），SQL 由服务端按关系图拼装并参数绑定；逐步展示序号、表、条件与绑定值、命中行数、耗时、关键列样例、边状态与扇出；断链/截断/警告/中断位置单独列出；`needs_confirm` 步骤给「仍然执行」按钮（带 `confirm_slow` 重跑）；每步可做四选一反馈（对 / 多了+原因 / 漏了 / 无关）并回写对应边。未跟随的 pending 边单列并指回关系图页 | P1 |
| FR-MCP-7g | `mine_relations` | 从审计日志挖掘 join：只读 `execute_sql`/`explain_query` 的语句，解析 `on` 等值对；父子方向由目录定（唯一/主键侧为父），判不出方向的进 `ambiguous` 不入图；导入为 `pending` + `audit_mined`，来源强弱 `fk > manual > audit_mined > inferred` 只升不降 | P1 |
| FR-MCP-7h | `scan_code_relations` | 从 Spring Boot 源码树挖掘 join：只读 mapper XML 的 `select/insert/update/delete/sql`、`@Select/@Insert/@Update/@Delete`、MyBatis-Plus 的 `apply/last/inSql/exists/notExists/having` 片段，其余字符串字面量一律不读；跳过 `build`/`target`/`.git` 等目录；方向与 ambiguous 规则同上；每条边记 `file:line`；只读文件、不执行任何语句 | P1 |
| FR-MCP-7i | 边的代价 | 每条边记目标列有无索引、表行数估计（PG/openGauss `pg_class.reltuples`、MySQL `information_schema.TABLES.TABLE_ROWS`、Oracle `ALL_TABLES.NUM_ROWS`，不跑 `count(*)`）与最近五次实测耗时；`propose_relation`/`feedback_relation` 从目录补索引与行数，每次追踪回写各步耗时；只把单列主键与索引首列算「有索引」 | P1 |
| FR-MCP-8 | `test_connection` | 用保存的源或内联连接串做一次真实登录探测 | P0 |
| FR-MCP-9 | `session_scope` | **Host 侧原生工具**（非 MCP），限制本会话可见的数据源（0.9.0） | P1 |
| FR-MCP-10 | instructions | 服务端说明：先看结构再查数、不要拼接用户输入、结果截断含义 | P1 |
| FR-MCP-11 | 超时 | MCP 行 `toolCallTimeoutMs=60000`；Python 内 `timeout_ms` 上限 120s | P0 |
| FR-MCP-12 | 并发 | 进程内串行；不同数据源不共享连接；单源连接池上限 4 | P0 |

> 前十七项是 Python 服务发布的工具（`server/main.py` 的 `@mcp.tool()`），`session_scope`
> 由 `src/tools.js` 注册在 Host 上 —— 它改的是 Host 的 `sessions.json`，Python 看不到，
> 因此也只对 DSH 智能体生效。工具页可以逐个关掉前十七项，`session_scope` 故意不可关。

**方言要点（实现约束）**

| kind | 行数限制 | 只读判定 | 元数据来源 |
|---|---|---|---|
| sqlite | `LIMIT n` | sqlite3 只读 URI（`mode=ro`） | `sqlite_master` |
| postgres | `LIMIT n` | 事务 `SET TRANSACTION READ ONLY` | `information_schema` + `pg_catalog` |
| gauss | `LIMIT n` | 同 postgres；`py_opengauss` + cursor 适配层 | 同 postgres，过滤 `BIN$` 回收站表 |
| mysql | `LIMIT n` | 会话 `SET SESSION TRANSACTION READ ONLY` | `information_schema` |
| oracle | `FETCH FIRST n ROWS ONLY`（12c+，旧版回退 `ROWNUM`） | 语句白名单 + `SET TRANSACTION READ ONLY` | `ALL_TABLES`/`ALL_TAB_COLUMNS` |

### 4.7 状态与诊断（FR-DIAG）

| ID | 需求 | 优先级 |
|---|---|---|
| FR-DIAG-1 | 显示 Python 解释器路径、版本、是否满足最低版本（≥3.10） | P0 |
| FR-DIAG-2 | 显示依赖状态：`mcp`、`psycopg`、`PyMySQL`、`oracledb` 是否就绪 | P0 |
| FR-DIAG-3 | 「一键初始化运行时」：建插件内 venv + 装依赖，带进度与失败详情 | P1 |
| FR-DIAG-4 | 显示 MCP 行是否加载、已注册工具数（Python 发布 8 个，加上 Host 原生的 `session_scope` 共 9 个；工具页关掉的会从 DSH 的目录里消失） | P0 |
| FR-DIAG-5 | 「重新加载 MCP」按钮，替代手工改 YAML | P1 |
| FR-DIAG-6 | 最近 N 行服务端 stderr 日志（脱敏）可查看 | P1 |
| FR-DIAG-7 | 一键自检：解释器 → 依赖 → 配置 → 各源连通性，输出清单 | P2 |

---

## 5. 数据模型与存储

### 5.1 目录布局（`$DSH_HOME/db-mcp/`）

| 文件 | 权限 | 内容 |
|---|---|---|
| `datasources.json` | 0600 | 注册表（**无密码**），`{schemaVersion, updatedAt, datasources[], groups[]}` |
| `secrets.json` | 0600 | 每个源的**口令信封** `v1.<iv>.<tag>.<ct>`（AAD = 源 id），不再存明文 |
| `secret.key` | 0600 | 32 字节 base64url 密钥，首次使用时生成，从不轮换；**删掉它等于一次性撤销全部口令** |
| `settings.json` | 0600 | 全局写开关、审计开关、HTTP 端点开关与端口、关掉的工具、默认行数 |
| `sessions.json` | 0600 | 每个会话的数据源白名单 `{sessions:{<id>:{ids[],updatedAt}}}`；缺文件或空清单即不限制 |
| `logs/audit.jsonl` | 0600 | 审计日志，超过 512 KB 轮转为 `logs/audit.1.jsonl` |
| `logs/mcp.log` | 0600 | Python stderr |
| `.venv/` | — | 插件自带的 Python 环境（`server/requirements.txt`） |

> 早期设计里的 `runtime.json`（派生文件，含明文口令）已不存在：Python 直接读
> `datasources.json` + `secrets.json`，口令在进程内解密。

### 5.2 约束

- **单一事实来源**：注册表在 Host；Python 只读，不回写。
- **原子写**：临时文件 + rename，禁止半截 JSON；损坏时回退 `.bak`。
- **口令不回显**：API 只返回 `hasSecret`；日志对 `password|token|secret|dsn|wallet` 掩码。
- **口令加密**：Host 每次写 `secrets.json` 都加密，mount 时把旧版明文就地转换；信封打不开的值被丢弃并标记「stored password unreadable」，而不是当作口令交出去。
- **迁移**：`schemaVersion` 升级时自动迁移并留 `.bak`；历史上出现过的 `schemas`（allow/deny）与 `writableSchemas` 两个遗留键在 mount 时直接删除，不再迁移 —— 白名单已整体移除，写入不再按模式收窄。

---

## 6. 插件配置项（Host `Config`）

真正由用户在**面板 → 设置**里改的东西都在 `settings.json`，不在 Cordis config 里。
Host `Config` 只剩引导阶段需要的几项：

| 字段 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `runtimeDir` | string | `''` | 留空=`$DSH_HOME/db-mcp`（`index.js:24`） |
| `pythonPath` | string | `''` | 留空=自动探测（venv → `python` → `python3`） |
| `probeTimeoutMs` | number | 10000 | 连接测试超时（`src/host.js`） |
| `mcpServerName` | string | `db` | MCP 行的 `serverName` |
| `debug` | boolean | false | 打印 `[db-mcp]` 诊断行 |

`settings.json`（面板可改，`src/host.js` 的 `readSettings/writeSettings`）：

| 字段 | 默认 | 说明 |
|---|---|---|
| `allowWrite` | `false` | 全局写开关；翻转时 Host 会**同时**重启 stdio 与 HTTP 两个 Python 子进程 |
| `auditLog` | `true` | 是否写审计 |
| `httpEnabled` | `true` | 插件启动时是否带起 Streamable HTTP 端点 |
| `httpPort` | `8765` | 端点端口，1024–65535；被占用时自动顺延到下一个空闲端口 |
| `disabledTools` | `[]` | 工具页关掉的工具名（只影响 DSH 注册，不影响 Python 发布的工具面） |
| `limits` | `{sampleRows: 20, maxRows: 200}` | 默认行数；上限 `sampleRows ≤ 200`、`maxRows ≤ 2000` |

---

## 7. 非功能需求

### 7.1 安全（NFR-SEC）

1. 默认只读；写要过**三道闸门**，缺一不可：全局 `allowWrite` → 单源 `readOnly=false` → 若是 DDL 则还要 `allowDdl=true`（写入不再按模式收窄，可写即写登录可见的全部模式）。
2. 闸门全在 **Python 侧**（`server/engines.py` 与 `server/writes.py`），所以面板、智能体、外部 MCP 客户端走的是同一套判定。
3. 口令以 AES-256-GCM 加密落盘，密钥单独文件 0600；仅回环访问。
4. Host API 只接受同源、已登录 Peer；写操作额外做来源校验。
5. 日志/错误中禁止出现密码、完整 DSN、结果集内容。
6. 表名过滤走系统表参数化查询，不做字符串拼接 SQL。
7. Python 子进程只拿到短环境白名单（`PATH`/`PYTHON`/`TEMP` + `DB_MCP_*`），不再继承整个 DSH 环境。

### 7.2 性能（NFR-PERF）

| 指标 | 目标 |
|---|---|
| 页面首屏（已配置源） | < 800ms |
| 数据源列表 API | < 100ms |
| 连接测试 | 超时内必返回（默认 10s） |
| MCP 服务冷启动 | < 3s（驱动懒加载） |
| 连续 20 次工具调用 | 无内存线性增长（连接复用） |
| 2000 行结果序列化 | < 500ms |

### 7.3 可靠性（NFR-REL）

- Python 崩溃：MCP client 自动重连；诊断页显示重连次数。
- 单源故障不影响其它源与页面其它区域。
- 卸载插件：不碰用户数据库文件；仅提示可删 `$DSH_HOME/db-mcp`。
- DSH 重启后：源、默认源、只读标记、密码（不回显但可用）全部保持。

### 7.4 兼容性（NFR-COMPAT）

- Windows / macOS / Linux；Windows 路径含空格与中文必须可用（`C:\Users\administor-\...`）。
- Python ≥ 3.10（低于则诊断页拦截并给指引）。
- Oracle 默认 **thin 模式**，免 Instant Client。
- 页面不引 iframe、不写 `document.body`、不 import 私有 UI 实现。

### 7.5 可观测（NFR-OBS）

- Host 结构化日志：`datasource.create/update/delete`、`probe`、`mcp.reload`、`runtime.init`。
- 审计（可选）：时间、源 id、操作类型、SQL 摘要（≤200 字符）、影响行数、结果码。

---

## 8. 错误与边界

| 情况 | 期望行为 |
|---|---|
| Python 未安装 / 版本过低 | 顶部横幅 + 诊断页指引；MCP 工具不注册，页面仍可用 |
| 驱动缺失 | 该源标「缺驱动」，其它源正常；一键安装可修 |
| SQLite 文件被删 | 预览/查询报 `db_error`，配置保留，提示重指路径 |
| 数据源 id 冲突 | 保存拒绝并高亮字段 |
| 密码含特殊字符/中文 | 全链路正常（凭据库 + JSON 转义） |
| 查询超时 | 返回 `timeout`（语句超过 `DB_MCP_STATEMENT_TIMEOUT_MS`），连接回收，无悬挂会话 |
| 结果含二进制 | 以 `<binary N bytes>` 占位，不把二进制塞进上下文 |
| 单元格超长文本 | 截断到 2000 字符并标记 |
| Oracle `serviceName` 写错 | 报「服务名不可用」，不笼统报连接失败 |
| MCP 未加载但用户提问 | 模型侧无工具；诊断页明确指出原因与修复动作 |

---

## 9. 交付阶段与验收

### 阶段

| 阶段 | 内容 | 产出 |
|---|---|---|
| P0 | 本文档定稿 | 需求基线 |
| P1 | 骨架：可安装 bundle、侧栏入口、空页面、Host 健康接口 | 能点开、能看到空态 |
| P2 | 数据源 CRUD + 凭据 + SQLite 连接测试 + 注册表持久化 | 单库配置闭环 |
| P3 | Python MCP 服务 + 6 个工具 + MCP 行自动配置 + 改配置即生效 | 模型能查 SQLite |
| P4 | PostgreSQL / MySQL / Oracle 接入 + 方言适配 | 四类库可用 |
| P5 | 诊断页 + 一键初始化运行时 + 重载 MCP + 审计日志 | 可自愈 |
| P6 | 中英文案、错误打磨、安装/卸载文档、验收矩阵 | 可发布 |
| P7（可选） | 只读结构概览（FR-META） | 锦上添花 |

> 这张表是**当时的计划**，保留原样不回头改。实际交付与它的差异：P3 落地的工具是 6 个，
> 到 0.9.7 变成 8 个 Python 工具 + Host 的 `session_scope`；P4 是三类库加上 0.7.5 的
> openGauss；P5 的诊断页后来拆成「运行时诊断」与「工具」两个标签；P7 的结构概览在
> 0.6.3 就并进了数据源列表标签，作为子视图而不是独立阶段。逐版本的细节见
> [CHANGELOG.md](../CHANGELOG.md)。

### 验收标准

1. 全新机器：安装 → 侧栏 → 新建 SQLite 源 → 测试通过 → 对话问「有哪些表」→ 模型正确调用并答出表名。
2. 同上换 PostgreSQL（本机 docker），密码错时报「认证失败」，不是泛化 500。
3. Oracle thin 模式连本机 XE/PDB，`serviceName` 正确时通过，写错时给出针对性错误。
4. 只读源上模型尝试 `DELETE` 被拒，错误可读且不含连接串/密码。
5. 重启 DSH：源、默认源、只读标记、密码可用性全部保持。
6. 卸载后：`$DSH_HOME/db-mcp` 可安全删除，用户数据库文件未受影响。
7. 页面无「查询」「执行 SQL」入口；深浅色主题下对比度正常；中英文无硬编码残留。

---

## 10. 风险与待验证

| 风险 | 影响 | 缓解 |
|---|---|---|
| Python 环境不确定（未装/版本低/多解释器） | MCP 起不来 | 自动探测 + 诊断页 + 一键 venv |
| `dsh-mcp-client` 行 `command` 需绝对路径 | 换机失效 | Host 启动时探测并幂等回写该行；文档给手工兜底 |
| stdio 先探测再启动，冷启翻倍 | 首次调用慢 | 驱动懒加载，import 控制在 300ms 内 |
| Oracle 驱动体积与 thin 模式兼容性 | 装不上/连不上 | 默认 thin；`oracledb` 单独可选安装；失败降级提示 |
| 派生运行时文件含明文密码 | 同用户其它进程可读 | 已消除：口令 AES-256-GCM 加密后落盘，密钥 0600 |
| 页面↔Host 通道方案未最终验证 | 可能返工 | P1 先做「一个页面 + 一个接口」的最小连通验证 |
| 大结果集拖慢上下文 | 模型上下文被塞满 | 硬上限 2000 行 + 单元格截断 + 明确 `truncated` 标记 |

---

## 11. 已核实的平台事实（实现阶段直接引用）

- **侧栏入口**：Client slot `sidebar.panellist`，注册 `{ id, order, label }`；现有 order：plugins=0、schedules=10、dsh-context=20、mnemon=30 → 本插件取 `25`。
- **主面板**：Client slot `main`（keyed，scope root），id 必须与侧栏一致；已占用 key `conversation`。
- **面板切换**：Client 服务 `layout.selectPanel(id)`。
- **客户端依赖**：现在只用 `@deepseek-ai/dsh-client-locale`（`package.json` 的 `dsh.client.inject`）；早先列出的 connection / ui-sidebar / ui-layout 三个包已不再需要。
- **Host 路由**：`ctx.webServer.register({ path, ... })`，匹配 exact → 最长 prefix → fallback，重复路径抛错。API 前缀一直是 `/plugins/db-mcp/api`。
- **MCP 行配置**（`@deepseek-ai/dsh-mcp-client`）：`serverName`（`^[A-Za-z0-9_-]{1,32}$`）、`transport: stdio`、`command`、`args[]`、`env{}`、`cwd`、`toolCallTimeoutMs`（默认 60000）、`failOnStartupError`、`reconnect{}`。
- **凭据**：不用 `ctx.credentials` —— 口令由插件自己加密存盘（`secrets.json` + `secret.key`），见第 5 节。
- **子进程**：`ctx.subprocess.spawn` / `resolveExecutable`。
- **配置持久化**：`ctx.configEditor.edit(entry, fn)`；禁止手改 `cordis.patch.yml`。
- **安装**：`plugin_manager` action=`install_bundle`，target=包目录绝对路径。
- **面板端口**：DSH 每次启动会选一个空闲端口（本机见过 1629 / 2091 / 11897），面板 API 调用必须带 `Origin: http://127.0.0.1:<该端口>`，否则 401。开发期热重用 `POST /plugins/db-mcp/api/reload`。

---

## 12. 已确认决策

| # | 决策 | 结论 |
|---|---|---|
| D1 | v1 数据库 | **SQLite + PostgreSQL + openGauss + MySQL + Oracle**（openGauss 自 0.7.5） |
| D2 | 写权限 | **默认只读**；三道闸门：全局写开关 + 单源只读 + DDL 开关（白名单已移除：可写=写登录可见的全部模式），全程带审计 |
| D3 | Python 运行时 | **插件内 venv + 官方 `mcp` SDK + 五种驱动** |
| D4 | 页面查询台 | **不做**；页面只有数据源管理与关系图，查询全部走 MCP |
| D5 | 包名 / 侧栏 id / MCP 服务名 | **`dsh-db-mcp` / `db-mcp` / `db`**（已确认） |
| D6 | 结构概览 | **保留**，作为数据源列表的子视图（原 P2 可选项） |
| D7 | 凭据存放 | **不用 `ctx.credentials`**；插件自持 AES-256-GCM 加密的 `secrets.json` + `secret.key` |
| D8 | 外部客户端接入 | **复用同一个 Python 服务**，加一个 Streamable HTTP 实例，不另写工具面 |
| D9 | 工具可关 | 只在 **Host 注册时**过滤；Python 照旧发布全部工具，因此只对 DSH 生效 |

---

## 13. 维护约定

- 本文描述**当前状态**：字段表、闸门、目录布局、配置项跟着代码一起改，不留历史版本快照。
- 面向使用者的版本变更写进 [CHANGELOG.md](../CHANGELOG.md)（Keep a Changelog 形状，
  一版一段）；本文只写**为什么这么设计**。两处不互相复制。
- 某个决定被推翻时，直接改对应小节，不要追加「后来又改成……」—— 需要追溯就查 `git log`。
- 当前测试面（`npm test`）：engines 14 / writes 71 / secretbox 14、selftest 86、
  parse 33、render 156、i18n 14、p5 35、docs.check 14、changelog.check 17 段。
