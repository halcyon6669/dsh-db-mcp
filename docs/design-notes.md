> **Design log.** The working record of the design and the P1 → P7 build, written in
> Chinese as the project ran. It is kept for the decisions and the edge cases behind
> them, not as user documentation: start at [../README.md](../README.md), or
> [guide.md](guide.md) for usage and [reference.md](reference.md) for the wire format.

# DSH 数据库插件（暂名 `dsh-db-mcp`）需求细化 v0.2

> 状态：需求已按你的选择定稿，代码尚未开始
> 决策来源：D1=SQLite+PostgreSQL+MySQL+Oracle；D2=默认只读+双开关；D3=插件内 venv + 官方 mcp SDK；D4=页面只做数据源管理，不做手工查询
> 目标读者：需求方（你）+ 后续实现者（我）

---

## 0. 结论摘要

| 项 | 结论 |
|---|---|
| 形态 | DSH 插件包：**Host 半边**（Cordis）+ **Client 半边**（Web 页面）+ **Python MCP 服务** |
| 入口 | 侧栏图标（`sidebar.panellist`，id=`db-mcp`，order=25）+ 主面板（`main`，同 id） |
| 页面职责 | **只管数据源**：增删改查、连接测试、状态与诊断。不做 SQL 查询台、不做数据浏览 |
| 查询职责 | 全部交给 AI，经 MCP 工具 `mcp__db__*` 完成 |
| 数据源 | 单一 MCP 服务进程内管理 N 个数据源，工具用 `datasource` 参数寻址 |
| 支持类型 | SQLite / PostgreSQL / MySQL / Oracle（v1 四种） |
| 安全基线 | 默认只读；写需「全局 + 单源」双开关；行数/超时硬上限；密码只进凭据库 |
| 状态目录 | `$DSH_HOME/db-mcp/`（注册表 + 派生运行时配置 + 日志 + venv） |
| 明确不做 | 页面内查询、数据编辑、ER 图、DDL、同步/备份、图表可视化 |

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
- ER 图、可视化建模、图表。
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
┌──────────────────────── DSH Web GUI（http://127.0.0.1:10341）──────────────┐
│  Client 半边（dsh.client, platform: web）                                  │
│    · sidebar.panellist: id=db-mcp, order=25, label 走 locale              │
│    · main: id=db-mcp → 数据源管理页                                        │
│    · 通过 ctx.connection 的 exact route / RPC 调 Host                     │
└────────────────────────────────┬───────────────────────────────────────────┘
                                 │ 本机回环 HTTP + 登录 Cookie
┌────────────────────────────────▼───────────────────────────────────────────┐
│  Host 半边（Cordis 插件）                                                  │
│    · 注册表 CRUD + 参数校验                                                │
│    · 密码 → ctx.credentials 记录（按数据源 id 隔离）                        │
│    · 生成 0600 运行时配置给 Python                                         │
│    · 短命 Python 子进程：--probe（连接测试）/ --meta（结构概览）           │
│    · Python 探测、MCP 行配置回写、健康检查                                  │
└────────────────────────────────┬───────────────────────────────────────────┘
                                 │ stdio（MCP JSON-RPC）
┌────────────────────────────────▼───────────────────────────────────────────┐
│  Python MCP 服务（server/，官方 mcp SDK + 四种驱动）                        │
│    · 懒加载、懒建连接、每次调用重读运行时配置                              │
│    · 工具：list_datasources / list_tables / describe_table /               │
│            sample_rows / run_query / explain_query                         │
│    · 只读守卫、行数上限、超时、错误分级                                     │
└────────────────────────────────────────────────────────────────────────────┘
```

### 3.2 三条数据流

1. **配置流**：页面 → Host API → 注册表 + 凭据库 → 派生 `runtime.json` → Python 每次调用时读取。**改完即生效，无需重启 DSH。**
2. **模型流**：模型 → `mcp__db__run_query` → MCP client（stdio）→ Python → 目标库 → 结构化结果回对话。
3. **页面流**：页面 → Host API → **短命** Python 子进程（`--probe`/`--meta`）→ JSON 回包。页面不直连数据库，Node 侧不装任何数据库驱动。

### 3.3 关键取舍

| 取舍 | 采用方案 | 理由 |
|---|---|---|
| MCP 进程模型 | **一个服务 + 工具参数 `datasource`** | 工具面固定；增删数据源不需要动 Loader 行、不需要重启 |
| 页面 ↔ Host | Host 注册 `POST /plugins/db-mcp/api/*`，前端 `fetch` | 纯 JS 包可直接跑，无需代码生成流水线 |
| 密码存放 | `ctx.credentials` 为准 + 派生 0600 运行时文件 | 符合平台规范，可轮换；明文只在本机 0600 文件短暂存在 |
| 连接测试位置 | Python 侧（`--probe`） | 驱动只装一份，避免 Node 重复实现四种方言 |

---

## 4. 功能需求

优先级：**P0** 首个可用版本必须有；**P1** 紧随其后；**P2** 可延后或不做。

### 4.1 页面骨架（FR-UI）

| ID | 需求 | 优先级 |
|---|---|---|
| FR-UI-1 | 侧栏独立图标 + 名称，点击进入主面板；重复点击不重复挂载 | P0 |
| FR-UI-2 | 图标/名称随语言切换（zh/en），文案全部走 locale，组件内不硬编码 | P0 |
| FR-UI-3 | 两栏布局：左侧数据源列表（含状态点），右侧详情/表单区 | P0 |
| FR-UI-4 | 空态：无数据源时展示引导 + 四种类型的快捷入口 | P0 |
| FR-UI-5 | 跟随 DSH 浅色/深色主题，只用主题 token，不自造色板 | P0 |
| FR-UI-6 | 窄窗口时列表折叠为下拉选择 | P2 |
| FR-UI-7 | 页面只有「数据源管理」一个视图，无查询/编辑入口 | P0 |

### 4.2 数据源管理（FR-DS）

**逻辑字段**

| 字段 | 说明 |
|---|---|
| `id` | 稳定标识 `[a-z0-9-]{1,32}`，创建后不可改（模型工具用它寻址） |
| `name` | 展示名，可改 |
| `kind` | `sqlite` / `postgres` / `mysql` / `oracle` |
| `config` | 类型相关参数（见下表） |
| `readOnly` | 是否只读，默认 `true` |
| `isDefault` | 默认源，全局唯一 |
| `tags` | 自由标签，用于筛选 |
| `secretRef` | 凭据引用，不存明文 |
| `lastProbe` | 最近一次测试结果 + 时间 |
| `createdAt`/`updatedAt` | 时间戳 |

**各类型连接参数**

| kind | 必填 | 可选 |
|---|---|---|
| sqlite | `file` | `readOnlyOpen`、`busyTimeoutMs` |
| postgres | `host`、`port`、`database`、`user` | `schema`（默认 public）、`sslMode`（disable/prefer/require/verify-full）、`applicationName` |
| mysql | `host`、`port`、`database`、`user` | `charset`（默认 utf8mb4）、`ssl`（true/false）、`connectTimeoutMs` |
| oracle | `host`、`port`、`serviceName` 或 `sid`、`user` | `schema`（默认=user）、`mode`（thin/thick，默认 thin）、`walletDir` |

| ID | 需求 | 优先级 |
|---|---|---|
| FR-DS-1 | 新建：选类型 → 填参数 → （可选）测试 → 保存 | P0 |
| FR-DS-2 | 编辑：除 `id` 外均可改；密码留空=不修改 | P0 |
| FR-DS-3 | 删除：二次确认，提示「模型工具将立即失去该源」 | P0 |
| FR-DS-4 | 保存前字段级校验（端口范围、必填、路径存在性、id 冲突） | P0 |
| FR-DS-5 | SQLite：路径手填 + 目录浏览；文件不存在时询问「新建空库」或「仅存配置」 | P0 |
| FR-DS-6 | 列表搜索（名称/id/标签）+ 按类型筛选 | P1 |
| FR-DS-7 | 每个字段有样例占位（如 `localhost:5432`、`ORCLPDB1`） | P1 |
| FR-DS-8 | 设默认源时自动取消其它，列表有「默认」徽标 | P1 |
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

### 4.6 MCP 工具面（FR-MCP）

统一约定：

- 服务名 `db` → 工具名 `mcp__db__run_query`。
- 所有工具第一个参数 `datasource`（有默认源时可省略）。
- 返回结构化结果：`columns[{name,type}]`、`rows[][]`、`rowCount`、`truncated`、`elapsedMs`。
- 错误分级：`user_error`（参数错/源不存在）、`db_error`（SQL/权限）、`infra_error`（驱动/超时/进程）。

| ID | 工具 | 作用 | 优先级 |
|---|---|---|---|
| FR-MCP-1 | `list_datasources` | 列出源（id、名称、类型、只读、是否默认），不含敏感信息 | P0 |
| FR-MCP-2 | `list_tables` | 指定源的 schema/表/视图清单，支持名称过滤 | P0 |
| FR-MCP-3 | `describe_table` | 列定义、主键、索引概要、注释 | P0 |
| FR-MCP-4 | `sample_rows` | 取某表样例（默认 20 行），模型无需自己写 `SELECT *` | P1 |
| FR-MCP-5 | `run_query` | 执行 SQL，参数化，带 `max_rows`/`timeout_ms` | P0 |
| FR-MCP-6 | `explain_query` | 执行计划，按方言降级（Oracle 用 `EXPLAIN PLAN`，MySQL/PG 用 `EXPLAIN`） | P2 |
| FR-MCP-7 | instructions | 服务端说明：先看结构再查数、不要拼接用户输入、结果截断含义 | P1 |
| FR-MCP-8 | 超时 | MCP 行 `toolCallTimeoutMs=60000`；Python 内 `timeout_ms` 上限 120s | P0 |
| FR-MCP-9 | 并发 | 进程内串行；不同数据源不共享连接；单源连接池上限 4 | P0 |

**方言要点（实现约束）**

| kind | 行数限制 | 只读判定 | 元数据来源 |
|---|---|---|---|
| sqlite | `LIMIT n` | sqlite3 只读 URI（`mode=ro`） | `sqlite_master` |
| postgres | `LIMIT n` | 事务 `SET TRANSACTION READ ONLY` | `information_schema` + `pg_catalog` |
| mysql | `LIMIT n` | 会话 `SET SESSION TRANSACTION READ ONLY` | `information_schema` |
| oracle | `FETCH FIRST n ROWS ONLY`（12c+，旧版回退 `ROWNUM`） | 语句白名单 + `SET TRANSACTION READ ONLY` | `ALL_TABLES`/`ALL_TAB_COLUMNS` |

### 4.7 状态与诊断（FR-DIAG）

| ID | 需求 | 优先级 |
|---|---|---|
| FR-DIAG-1 | 显示 Python 解释器路径、版本、是否满足最低版本（≥3.10） | P0 |
| FR-DIAG-2 | 显示依赖状态：`mcp`、`psycopg`、`PyMySQL`、`oracledb` 是否就绪 | P0 |
| FR-DIAG-3 | 「一键初始化运行时」：建插件内 venv + 装依赖，带进度与失败详情 | P1 |
| FR-DIAG-4 | 显示 MCP 行是否加载、已注册工具数（期望 6 个） | P0 |
| FR-DIAG-5 | 「重新加载 MCP」按钮，替代手工改 YAML | P1 |
| FR-DIAG-6 | 最近 N 行服务端 stderr 日志（脱敏）可查看 | P1 |
| FR-DIAG-7 | 一键自检：解释器 → 依赖 → 配置 → 各源连通性，输出清单 | P2 |

---

## 5. 数据模型与存储

### 5.1 目录布局（`$DSH_HOME/db-mcp/`）

| 文件 | 权限 | 内容 |
|---|---|---|
| `datasources.json` | 0600 | 注册表（**无密码**），带 `schemaVersion` |
| `runtime.json` | 0600 | 派生文件：注册表 + 解析出的密码，供 Python 读；原子替换 |
| `logs/mcp.log` | 0600 | Python stderr，按大小轮转 |
| `.venv/` | — | 可选运行时环境 |

### 5.2 约束

- **单一事实来源**：注册表在 Host；Python 只读，不回写。
- **原子写**：临时文件 + rename，禁止半截 JSON；损坏时回退 `.bak`。
- **口令不回显**：API 只返回 `hasSecret`；日志对 `password|token|secret|dsn|wallet` 掩码。
- **迁移**：`schemaVersion` 升级时自动迁移并留 `.bak`。

---

## 6. 插件配置项（Host `Config`）

| 字段 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `enabled` | boolean | true | 总开关 |
| `pythonPath` | string | `''` | 留空=自动探测（`py -3` → `python` → `python3`） |
| `runtimeDir` | string | `''` | 留空=`$DSH_HOME/db-mcp` |
| `defaultMaxRows` | number | 200 | 单次结果默认行数 |
| `maxRows` | number | 2000 | 硬上限，工具参数不可越过 |
| `queryTimeoutMs` | number | 30000 | 默认查询超时 |
| `maxQueryTimeoutMs` | number | 120000 | 超时硬上限 |
| `probeTimeoutMs` | number | 10000 | 连接测试超时 |
| `allowWrite` | boolean | false | 全局写开关（单源还要各自打开） |
| `auditLog` | boolean | true | 写操作与敏感查询记录元信息 |
| `mcpServerName` | string | `db` | MCP 行的 `serverName` |

---

## 7. 非功能需求

### 7.1 安全（NFR-SEC）

1. 默认只读；写需「全局 `allowWrite` + 单源 `readOnly=false`」双开关，页面有风险提示。
2. 只读守卫在 **Python 侧**：语句白名单 + 拒绝多语句 + 拒绝 DDL/事务控制 + 连接层只读事务。
3. 凭据只进 `ctx.credentials`；派生文件 0600；仅回环访问。
4. Host API 只接受同源、已登录 Peer；写操作额外做来源校验。
5. 日志/错误中禁止出现密码、完整 DSN、结果集内容。
6. 表名过滤走系统表参数化查询，不做字符串拼接 SQL。

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
| 查询超时 | 返回 `infra_error: timeout`，连接回收，无悬挂会话 |
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
| 派生运行时文件含明文密码 | 同用户其它进程可读 | 0600 + 回环 API + 文档说明；后续可换 keyring |
| 页面↔Host 通道方案未最终验证 | 可能返工 | P1 先做「一个页面 + 一个接口」的最小连通验证 |
| 大结果集拖慢上下文 | 模型上下文被塞满 | 硬上限 2000 行 + 单元格截断 + 明确 `truncated` 标记 |

---

## 11. 已核实的平台事实（实现阶段直接引用）

- **侧栏入口**：Client slot `sidebar.panellist`，注册 `{ id, order, label }`；现有 order：plugins=0、schedules=10、dsh-context=20、mnemon=30 → 本插件取 `25`。
- **主面板**：Client slot `main`（keyed，scope root），id 必须与侧栏一致；已占用 key `conversation`。
- **面板切换**：Client 服务 `layout.selectPanel(id)`。
- **Client 依赖**：`package.json` 的 `dsh.client.inject` 需 `@deepseek-ai/dsh-client-connection`、`@deepseek-ai/dsh-client-locale`、`@deepseek-ai/dsh-client-ui-sidebar`、`@deepseek-ai/dsh-client-ui-layout`。
- **Host 路由**：`ctx.webServer.register({ path, ... })`，匹配 exact → 最长 prefix → fallback，重复路径抛错。
- **MCP 行配置**（`@deepseek-ai/dsh-mcp-client`）：`serverName`（`^[A-Za-z0-9_-]{1,32}$`）、`transport: stdio`、`command`、`args[]`、`env{}`、`cwd`、`toolCallTimeoutMs`（默认 60000）、`failOnStartupError`、`reconnect{}`。
- **凭据**：`ctx.credentials.modifyRecord/readRecord/describe`，配置只放键名。
- **子进程**：`ctx.subprocess.spawn` / `resolveExecutable`。
- **配置持久化**：`ctx.configEditor.edit(entry, fn)`；禁止手改 `cordis.patch.yml`。
- **安装**：`plugin_manager` action=`install_bundle`，target=包目录绝对路径。

---

## 12. 已确认决策

| # | 决策 | 结论 |
|---|---|---|
| D1 | v1 数据库 | **SQLite + PostgreSQL + MySQL + Oracle** |
| D2 | 写权限 | **默认只读，全局 + 单源双开关，带审计** |
| D3 | Python 运行时 | **插件内 venv + 官方 `mcp` SDK + 四种驱动** |
| D4 | 页面查询台 | **不做**；页面只有数据源管理，查询全部走 MCP |
| D5 | 包名 / 侧栏 id / MCP 服务名 | **`dsh-db-mcp` / `db-mcp` / `db`**（已确认） |
| D6 | 结构概览（原 P2 可选） | **保留**，顺延为 P7 |

---

## 13. P2 实现纪要（2026-11-07）

### 13.1 文件结构

```
dsh-db-mcp/
  index.js          Cordis 入口：注册路由 + POST /reload，实现按需动态导入
  src/host.js       createHost({dir, config}) → { version, handle }，全部读写逻辑
  client.js         浏览器侧模块：侧栏图标 + 管理面板（列表/表单/导入/诊断）
  dev/selftest.mjs  24 项自检，挂载 src/host.js 到临时端口
  dev/shims.test.mjs 校验 index.js 的路由形态与 /reload
```

### 13.2 存储

- `$DSH_HOME/db-mcp/datasources.json`：`{schemaVersion, updatedAt, datasources[]}`，原子写（tmp + rename），0600，**无口令**。
- `$DSH_HOME/db-mcp/secrets.json`：`{schemaVersion, secrets{id:{password}}}`，0600，只被 Host 读取；页面只看到 `hasSecret`。

### 13.3 HTTP 接口（前缀 `/plugins/db-mcp/api`，同源校验：POST 的 `Origin` 必须等于 `Host`）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/health` | 版本、Host、Python 探测、运行时路径、DBeaver 根目录、数据源列表 |
| GET | `/datasources` | 注册表（口令投影掉） |
| GET | `/dbeaver/scan` | 扫描 DBeaver 工作区，返回可导入连接（含 hasPassword） |
| POST | `/datasources/save` | 新建或更新；`id` 创建后不可改；`password` 省略=保留，空串=清除 |
| POST | `/datasources/delete` | 删除源与口令，默认源自动顺延 |
| POST | `/datasources/test` | SQLite 用 `node:sqlite` 只读打开并列出表；其余库做 TCP 连通探测（认证握手留到 P3/P4 的 Python 驱动） |
| POST | `/dbeaver/import` | 按 DBeaver connection id 导入，slug 化 id，冲突自动加序号 |
| POST | `/reload` | 开发期热重载：`import('./src/host.js?v=N')` 后重建 host 实例 |

### 13.4 DBeaver 导入

- 扫描 `%APPDATA%\DBeaverData\workspace*\General\.dbeaver\data-sources.json`（兼容 `General` 布局与 Linux/macOS 路径）。
- `credentials-config.json` 存在时用 DBeaver 内置密钥解密：`aes-128-cbc`，key=`babb4a9f774ab853c96c2d653dfe544a`，IV 全 0，解密后丢弃前 16 字节，再 JSON.parse。
- 本机实测：DBeaver 未保存口令（`secure_storage` 为空），导入后 `hasSecret=false`，页面提示「无密码」，可后续在编辑表单里补。
- provider 映射：`sqlite*`→sqlite，`postgres*`→postgres，`mysql*`/`mariadb*`→mysql，`oracle*`→oracle；解析 `jdbc:oracle:thin:@//host:port/service` 兜底 serviceName。

### 13.5 验证

- `node dev/selftest.mjs`：24/24 通过（CRUD、口令不外泄、SQLite 探针、越权 POST 403、方法 405、未知路由 404、导入+探针、删除清口令、关闭端口报 ECONNREFUSED）。
- `node dev/shims.test.mjs`：index.js 注册 exact `/reload` + prefix `/api`，动态导入 `?v=N` 生效，reload 后 health 版本仍 0.2.0。
- 运行中的 DSH 进程仍加载 P1 代码（Host 半只导入一次），需重启应用一次；此后改 `src/host.js` 用 `POST /plugins/db-mcp/api/reload` 即可，无需重启。

### 13.6 平台经验（写给后续阶段）

- Cordis Loader 对插件入口是**一次导入、进程级缓存**；`entry.update()` 不会重新执行模块。因此把实现放进可缓存破坏的 `src/host.js`，入口只留路由壳。
- `webServer` 的 `resource` 形态只允许 GET/HEAD；要用 POST 必须用 `handler(req,res)` 原始形态（本插件已采用）。
- `connection.fetch.register` 只支持 GET/HEAD/POST 三种方法，且需要走 Connection 的鉴权；本轮改用 webServer 原始 handler + 同源校验，降低耦合。

### 13.7 连接串解析与紧凑表单（0.2.1）

用户反馈「字段太分散、希望一个连接串就带出全部信息」后的改造：

- 表单顶部新增**连接串**输入框，粘贴即解析并回填：类型、主机、端口、库名/服务名、用户、口令、显示名称、标识符。
- 支持形态：`postgresql://user:pass@host:5432/db?sslmode=require`、`jdbc:postgresql://…`、`mysql://…`、`jdbc:mariadb://…`、`oracle://user@host:1521/service`、`jdbc:oracle:thin:@//host:1521/service`、`jdbc:oracle:thin:@host:1521:SID`、TNS 描述符 `(DESCRIPTION=…)`、`jdbc:sqlite:C:\…\x.db`、`sqlite:///C:/…/x.db`、裸路径 `.db/.sqlite/.sqlite3`（含空格与中文）。
- 布局改为自适应多列（每格 ≥210px），标签在输入框上方；`schema`、`SID`、`SSL 模式`、`字符集` 收进「高级选项」折叠区；SQLite 不显示无关字段。
- 显示名称与标识符在用户未手动改过时自动跟随解析结果；标识符冲突自动加 `-2/-3`。
- 编辑模式下连接串框回显当前连接（不含口令）；标识符锁死。
- 解析器随客户端一起走，不增加 Host 接口；口令仍只经 `POST /datasources/save` 写入 `secrets.json`，不回显。
- 新增离线测试：`dev/parse.test.mjs`（21 项，覆盖上表全部形态与错误分支）、`dev/render.test.mjs`（29 项，用 stub React 跑组件渲染，验证字段数量、标签、高级区、编辑态锁定）。

### 13.8 极简表单（0.2.2）

用户要求「页面做得不好，优化一下，只要图1红色部分的元素就行」，参照 DBeaver 的「连接到数据库」弹窗，把新建/编辑表单压缩成：

1. **连接串**（JDBC URL Template 等价物）
2. **用户名**
3. **密码** + ☑ 保存密码

其余全部下沉到「更多设置」折叠区（默认收起）：显示名称、标识符、类型、主机、端口、库名/服务名/SID、模式、SSL 模式、字符集、只读开关。

- 类型、主机、端口、库名/服务名、名称、标识符从连接串推导；用户不用再逐个填。
- 「保存密码」取消勾选时，本次输入的口令不写入 `secrets.json`。
- 校验仍在提交时做：缺主机/库名（Oracle 缺服务名与 SID 两者）时提示「请先填写必填字段」，并展开提示而不静默失败。
- 列表页、诊断卡不变；仍只做数据源管理，不做 SQL 查询台。

## 14. P3 实现纪要（2026-11-07）

### 14.1 架构变更：自持 MCP 客户端，不写 Loader 行

原计划由 Host 自动写入一条 `@deepseek-ai/dsh-mcp-client` 行，实测不可行也不必要：

- bundle 的 `cordis.patch.yml` 是静态 YAML，无法表达「本机 venv 里 python 的绝对路径 + 包目录下 `server/main.py`」；Loader 的 `!!js` 只能在 config 内求值、拿不到包目录。
- Host 没有 mcp-client 类服务（Service 目录只有 `mcpResources`），无法在运行时新增 Loader 行；`configEditor` 只能编辑已存在的 entry。

改为：**插件 Host 半边自己 spawn Python 子进程，说 MCP stdio 协议，再把 `tools/list` 的结果用 `ctx.tools.register` 发布成 `mcp__db__*`**。

收益：路径全是运行时算出来的；数据源变更可重启服务；状态能显示在面板上；不依赖 Loader 行的持久化。

### 14.2 文件结构（新增）

```
dsh-db-mcp/
  server/main.py         FastMCP 服务，6 个工具，stdio
  server/engines.py      按引擎连接、内省、执行、只读守卫
  server/store.py        读取 datasources.json / secrets.json，解析默认源
  server/requirements.txt mcp>=1.9,<2 + psycopg[binary] + PyMySQL + oracledb
  src/mcp.js             MCP stdio 客户端（JSON-RPC 2.0，按行分隔）
  src/tools.js           Python 进程管理 + 工具发布（mcp__db__<tool>）
```

### 14.3 工具面

| 工具 | 参数 | 说明 |
|---|---|---|
| `mcp__db__list_datasources` | — | id / kind / target / readOnly / isDefault |
| `mcp__db__list_tables` | `datasource?`, `schema?` | 表与视图 |
| `mcp__db__describe_table` | `table`, `datasource?`, `schema?` | 列、类型、可空、默认值、主键 |
| `mcp__db__sample_rows` | `table`, `datasource?`, `limit?=20`, `schema?` | 抽样 |
| `mcp__db__run_query` | `sql`, `datasource?`, `max_rows?=200` | 返回 columns/rows/rowCount/truncated/elapsedMs |
| `mcp__db__explain_query` | `sql`, `datasource?` | 执行计划 |

- `datasource` 省略时用默认源（`isDefault`，否则第一个）；未知源返回 `user_error` 并列出已知 id。
- 只读源在 Python 侧做语句白名单（select/with/show/describe/desc/explain/pragma/values/table/set），并在连接层加只读事务；被拒时返回 `user_error`，不触达数据库。
- 行数上限：默认 200，硬上限 2000（env `DB_MCP_MAX_ROWS` / `DB_MCP_MAX_ROWS_HARD`）。
- 单元格：Decimal/日期/二进制转换；超长文本截到 4000 字符。

### 14.4 进程与工具发布

- 解释器探测顺序：`config.pythonPath` → `<runtimeDir>/.venv/Scripts/python.exe` → `.venv/bin/python` → `python` → `python3`。
- 服务从**包目录**的 `server/main.py` 启动（`cwd=server/`），数据目录通过 `DB_MCP_RUNTIME` 传入，venv 在数据目录下。
- 每个候选解释器试跑：握手成功且工具注册成功才算就绪；失败逐个回退，最终把原因写进 `/mcp/status`。
- 工具名带 `mcp__db__` 前缀；参数 schema 会剥离 MCP 生成的 `anyOf[type,null]`、`title`、`default:null` 噪声。
- 数据源保存/删除后自动重启服务；面板有「重启 MCP」按钮；Mount 时即预热（不必打开页面）。
- 生命周期：`bootEpoch` 计数防止旧进程在 reload/重启后把工具注册进已销毁的 host；`POST /reload` 会先 `dispose()` 停掉子进程。

### 14.5 缓存破坏（重要）

`index.js` 只在进程启动时导入一次，所以热重载靠 `import('./src/host.js?v=N')`；但 `host.js` 静态导入 `./tools.js`、`tools.js` 静态导入 `./mcp.js` 会被 Node 按 URL 缓存，**改了也不生效**。现改为：

```js
const GENERATION = new URL(import.meta.url).searchParams.get('v') || '0'
const { createBridge } = await import(new URL(`./tools.js?v=${GENERATION}`, import.meta.url).href)
```

`tools.js` 里对 `mcp.js` 同样处理。

### 14.6 验证

- `node dev/mcp.test.mjs`：15/15——真实 Python 服务 + 真实 SQLite（Chinook）：握手、6 工具、列表、表清单、结构、抽样、count 查询、只读拒写、未知源报错。
- `node dev/shims.test.mjs`：路由、`/reload`、`/mcp/start` 后 6 个 `mcp__db__*` 工具确实注册（stub `tools` 服务），schema 简化正确。
- `node dev/selftest.mjs` 24/24、`dev/parse.test.mjs` 24/24、`dev/render.test.mjs` 26/26。
- 运行中的 DSH 仍是旧 `index.js`（进程级缓存），**需要重启一次**才能把 ctx 传给 Host 半、进而发布工具；此后改 `src/*.js` 或 `server/*.py` 只需 `POST /plugins/db-mcp/api/reload`（Python 侧重启用 `/mcp/restart`）。

### 14.7 环境事实

- `mcp` 必须固定在 1.x：2.x 把 `FastMCP` 改名为 `MCPServer`，`mcp.server.fastmcp` 不再存在。
- 本机 venv：`C:\Users\administor-\.dsh\db-mcp\.venv`（mcp 1.30.0、psycopg 3.3.8、PyMySQL 1.2.3、oracledb 26.1.0）。

### 下一步

P4：PostgreSQL / MySQL / Oracle 的真实连接与方言打磨（认证握手、错误分级、schema 浏览、`FETCH FIRST`、Oracle 大小写与 `ALL_TAB_COLUMNS`）。
## 15. P4 progress (2026-11-07)

All four engines now answer real queries against real servers; three of them run
as throwaway Docker containers on this machine.

| source id | engine | how it runs |
| --- | --- | --- |
| dbeaver-sample-database-sqlite-1 | SQLite | DBeaver sample Chinook.db, 11 tables |
| pg-demo | PostgreSQL 15 | dbmcp-pg on 127.0.0.1:5432, db/users demo, seeded customers/orders |
| mysql-demo | MySQL 8.0 | dbmcp-mysql on 127.0.0.1:3306, db/users demo, seeded products |
| oracle-demo | Oracle Free 23 | dbmcp-oracle on 127.0.0.1:11521 (1521 is inside a Windows excluded port range), service FREEPDB1, user demo, schema DEMO, seeded employees |

Defects found and fixed while wiring the real servers (version 0.3.1):

1. **PostgreSQL list_tables** used (%s is null or table_schema = %s); psycopg sends
   untyped parameters, so the planner failed with
   *IndeterminateDatatype: could not determine data type of parameter `$1`.
   The filter is now built conditionally instead of relying on a null bind.
2. **Oracle list_tables** repeated :1 twice while binding one value —
   *DPY-4009: 2 positional bind values are required but 1 were provided*.
   It binds [owner, owner] now.
3. **Column type text** appended precision to every type (integer(32,0));
   only numeric/decimal/number carry it now.
4. **POST /mcp/call dropped its datasource argument** — `bridge.call()` takes
   (name, args), so the third parameter was ignored and every call hit the
   default source. The handler merges datasource into `args` before calling.
5. **Restarting the Python process unregistered and re-registered the six tools**,
   which made a live agent call fail with unknown tool "mcp__db__list_tables"
   even though /mcp/status said `ready`. Registrations are now kept across
   restarts (the tool catalog is stable) and execute() follows the current
   client, restarting it through ensure() when the process died.

Read-only enforcement is verified on all engines (the panel's per-source flag
plus a read-only session on PostgreSQL/MySQL and mode=ro on SQLite).

## 16. P5 实现纪要（2026-11-07，版本 0.4.0）

### 16.1 全局写开关（双闸门）

写权限由两道互相独立的闸门决定，缺一不可：

1. **全局闸门** `$DSH_HOME/db-mcp/settings.json` 的 `allowWrite`（默认 `false`），
   面板「运行时诊断」里的复选框切换。关闭时 Python 端对所有非读语句直接报
   `user_error: writes are disabled for the whole plugin`，hint 指向面板开关。
2. **单源闸门** 数据源的 `readOnly`（默认 `true`）。全局开关打开后，源仍然只读，
   直到用户自己取消该源的只读勾选。

实现细节：Host 在启动 Python 子进程时注入 `DB_MCP_ALLOW_WRITE=1|0`；切换开关会
`POST /settings` → 写文件 → `bridge.restart()`，因此无需重启 DSH。读语句
（select/with/show/describe/desc/explain/pragma/values/table/set）永远放行。

### 16.2 审计日志

每次 MCP 工具调用由 Host 侧 `invoke()` 记一行 JSON 到
`$DSH_HOME/db-mcp/logs/audit.jsonl`（0600）：`at`、`tool`（`mcp__db__*`）、
`datasource`、`ok`、`ms`、`rows`、`sql`（截断 2000 字符）、`error`。
查询结果本身不入日志。文件超过 512 KiB 时轮转为 `audit.1.jsonl`；
`settings.json` 的 `auditLog: false` 可整体关闭。面板第三张卡片显示最近 12 条，
`GET /audit?limit=N`（上限 200）给程序用。

### 16.3 诊断与一键依赖

- `GET /python/env` 返回解释器、venv 路径、`server/requirements.txt` 是否存在、
  以及四个依赖的实际版本（`mcp=1.30.0;psycopg=3.3.8;…`）。
- `POST /python/setup`：没有 venv 就 `python -m venv <runtime>/.venv`，然后
  `pip install --disable-pip-version-check -r server/requirements.txt`（600s 超时），
  成功后自动重启 MCP 服务。面板上是一个「安装 / 修复依赖」按钮，安装期间按钮禁用。
- 诊断卡新增三行：全局写权限（复选框 + 说明）、Python 虚拟环境路径、依赖版本。

### 16.4 验证

- 六套离线测试全绿：selftest 24/24、parse 24/24、render 26/26、mcp 15/15、
  shims ok、新增 `dev/p5.test.mjs` 15/15（settings 默认值、落盘、审计解析与
  排序、limit、venv 缺失提示、requirements 探测、非布尔 allowWrite 收敛为 false）。
- 线上验证（127.0.0.1:2073，版本 0.4.0，reload generation 6）：
  `POST /mcp/call {tool:'list_tables', datasource:'pg-demo'}` 返回 PostgreSQL 的
  2 张表，随后 `GET /audit?limit=5` 出现对应条目
  `{"tool":"mcp__db__list_tables","datasource":"pg-demo","ok":true,"ms":290}`；
  `GET /settings` 为 `allowWrite:false, auditLog:true`；
  `GET /python/env` 报 `mcp=1.30.0;psycopg=3.3.8;PyMySQL=1.2.3;oracledb=26.1.0`。

### 16.5 下一步

P6：i18n 收尾（中英文案审校、`meta.title/description`）与文档整理；
P7：可选只读结构概览（表/列浏览，不执行 SQL）。

## 17. P5 追加：连接测试改为真实登录（0.4.1，2026-11-07）

用户要求：「让 Oracle 真实登录，然后真实进行查询」。原 P2 的测试按钮对
PostgreSQL/MySQL/Oracle 只做 TCP 端口探测，无法证明口令与服务的正确性。

### 17.1 新增工具 `test_connection`

`mcp__db__test_connection(datasource?, kind?, config?, password?, read_only?)`：

- 传 `datasource` 时按注册表解析（口令取 secrets.json）；
- 传 `kind` + `config`（+ 可选 `password`/`read_only`）时构造内联 profile，
  **用于测试尚未保存的表单**，不写注册表；
- 实现为 `engines.probe()`：真正建立连接 → 读取身份 → 执行一次
  `select 1`（Oracle 为 `select 1 from dual`）→ 关闭连接；
- 身份读取：SQLite `sqlite_version()`；PostgreSQL `version()` +
  `current_database()/current_user/current_schema()`；MySQL `version()` +
  `database()/current_user()`；Oracle `v$version` 首行（去掉 ` - ` 之后的
  促销文案，读不到时降级为 `Oracle`）+ `USERENV` 的 DB_NAME/CURRENT_SCHEMA/
  SESSION_USER；
- 返回 `{ok, kind, latencyMs, message, detail:{stage:'login', server, database,
  user, schema}, datasource}`；失败仍走统一错误体（`db_error` / `user_error`
  / `infra_error` + hint），宿主把它显示在数据源卡片的 `lastProbe.message`。

### 17.2 宿主侧接线

- `testProfile(profile, secret, options)` 增加 `options.remote`：非 SQLite 时
  先走 `bridge.call('test_connection', …, {audit:false})`（探测不写审计），
  成功或返回结构化失败即采用；Python 服务起不来时退回 TCP 探测并在文案里
  说明「认证登录未执行」。
- SQLite 仍用 `node:sqlite` 快速探测（能顺带报告表数量）。
- 结果写入 `lastProbe`（`{ok, message, latencyMs, at, detail}`），面板列表
  直接显示服务器版本 + `user@database`。

### 17.3 验证

- 真实登录（Docker 三库）：Oracle `Oracle AI Database 26ai Free Release
  23.26.3.0.0 · DEMO@FREEPDB1 · select 1 from dual ok`；
  PostgreSQL `PostgreSQL 15.19 · demo@demo · select version() ok`；
  MySQL `MySQL 8.0.46 · demo@%@demo · select version() ok`。
- 真实查询（Oracle，经 `mcp__db__run_query`）：
  `select id, name, dept, salary from employees order by id` 返回 3 行
  （Ada Lovelace/Grace Hopper/Alan Turing），`rowCount=3`、8ms。
- `dev/mcp.test.mjs` 扩到 19 项：新增 SQLite 真实登录、Oracle 真实登录、
  Oracle `select 1 from dual`、以及「错误口令 + 关闭端口 → `db_error`」。
- 其余套件保持全绿：selftest 24/24、parse 24/24、render 26/26、p5 15/15、
  shims ok（工具数由 6 改为 7）。



## 18. P6 实现纪要（0.5.0）

### 18.1 i18n 收尾

- 客户端文案全部经 `locale` 服务的 `t()` 取值，en/zh 两本字典各 135 条；
  删除了 6 条死键（`form.pasteHint`、`form.advanced`、`form.required`、
  `import.credentials`、`import.alreadyPresent`、`action.recheck`），
  并把「返回列表」改用早已存在的 `action.back`。
- 包元数据 `locale/en.json` / `locale/zh.json` 的 `meta.title`、`meta.description`
  收敛为「数据库 / Database」「管理 AI 可以通过 MCP 工具访问的数据库连接」。
- 新增 `dev/i18n.test.mjs`（12 项）：en/zh 键集合完全一致、`t('…')` 用到的键
  必须两本都有、不许有死键、`zh` 字典之外不许出现中文字符、两个 locale JSON
  不许带 BOM 且必须有 title/description。这条测试同时防住「文案绕过字典」的
  回归。

### 18.2 文档整理

- `README.md` 重写为面向使用者的说明：能力清单、路由表、七个工具、Python
  环境、连接串填表、DBeaver 导入、Docker 测试库、安装、开发与测试命令、
  双闸门与审计、阶段表、运行时目录、License。
- 需求文档随仓库发布（`docs/requirements.md`），README 顶部链接指向它，
  不再依赖工作区外的相对路径。

## 19. P7 实现纪要（0.5.0）

### 19.1 目标

只读结构概览：让用户在不写 SQL、不经过模型的情况下，看清某个数据源里
有什么表、每张表有哪些列。它必须是只读的——页面本身不提供查询入口。

### 19.2 Host 侧

新增 `GET /schema`：

| 参数 | 含义 |
| --- | --- |
| `datasource` | 必填，数据源 id |
| `table` | 可选；缺省时返回表清单 |
| `schema` | 可选，覆盖数据源自带的默认模式 |

- 缺 `datasource` → `400 datasource is required`；
- 未知 id → `404 unknown datasource: <id>`；
- 实现只调用 MCP 的 `list_tables` / `describe_table`（`{audit:false}`，
  浏览结构不写审计日志），因此不可能执行任意 SQL；
- 表清单返回 `{ok, datasource, target, tables:[{name, schema, type}]}`；
- 单表返回 `{ok, datasource, target, table, schema, columns:[{name, type,
  nullable, default, primaryKey}], primaryKey}`；
- MCP 服务未启动时返回 `503`，带 `hint: start the MCP server from the panel`。

### 19.3 Client 侧

- 列表每行的操作区新增「结构 / Structure」按钮，进入 `view.mode === 'schema'`。
- `SchemaView` 左侧表清单（带 table/view 标签、当前项高亮），右侧列网格
  （列名、类型、可空、默认值、主键标记），底部一行说明「只读视图：这个页面
  不会执行任何 SQL」；顶部「返回列表」。
- 全部颜色走 `--dsw-alias-*` token，类名前缀 `dbmcp-schema*`、`dbmcp-mono`。

### 19.4 验证

- `dev/selftest.mjs` 增加两项：`/schema` 缺参数 400、未知源 404 → 26/26。
- 线上（reload 后 generation 10、`0.5.0`、phase `P7`、7 个工具）：
  - SQLite：`/schema?datasource=dbeaver-sample-database-sqlite-1` → 11 张表；
    `&table=Album` → 3 列，主键 `AlbumId`。
  - Oracle：`/schema?datasource=oracle-demo` → `EMPLOYEES`；
    `&table=EMPLOYEES` → `ID NUMBER pk / NAME VARCHAR2(60) / DEPT VARCHAR(20)
    / SALARY NUMBER(10,2)`。
- 其它套件全绿：parse 24/24、render 28/28、i18n 12/12、p5 15/15、mcp 19/19、
  shims ok。

## 20. 发布（0.5.0）

- 许可证：MIT（`LICENSE`），`package.json` 增加 `license`、`repository`、
  `bugs`、`homepage`、`keywords`、`scripts.test`，`files` 补齐 `server/*.py`、
  `server/requirements.txt`、`docs/*.md`、`LICENSE`。
- 仓库：<https://github.com/halcyon6669/dsh-db-mcp>，只提交插件目录本身
  （`.venv/`、`logs/`、`__pycache__/`、`node_modules/` 由 `.gitignore` 排除）。
- 版本同步：`node dev/bump.mjs <x.y.z>` 同时改 `package.json` 与
  `src/host.js` 的 `PLUGIN_VERSION`，避免手工改版本号时的正则事故。

## 21. 0.5.1：DBeaver 导入补齐与面包屑导航

### 21.1 问题

- 通过 DBeaver「驱动属性 / JDBC URL」对话框建的连接，`data-sources.json` 里只有
  `configuration.host`、`configuration.port`、`configuration.url`，**没有 `database`，
  也没有 `user`**（`configurationType: "URL"`）。旧实现只读字段，于是导入列表里显示
  `incomplete host/database in the DBeaver entry`，无法导入。
- 即使导入成功，口令也进不了 `secrets.json`：`scanDBeaver()` 只回 `hasPassword` 布尔值，
  而 `importDatasources()` 读的是 `found.password`，恒为 `undefined`。

### 21.2 服务端（0.5.1）

- 新增 `parseJdbcUrl(url)`：去掉 `jdbc:` 前缀后按
  `scheme://[user[:password]@]host[:port][/database]` 解析，支持 IPv6 方括号主机与
  `;param=value` 尾巴。
- `mapDBeaverConnection()` 改为「字段 + URL 合并」：`configurationType === 'URL'` 时 URL
  的值优先，否则字段优先、URL 兜底；host / port / database / user 四者都按这个顺序取。
  Oracle 走 `parseOracleUrl()`，逻辑不变。
- 错误文案带上实际读到的值：
  `incomplete host/database in the DBeaver entry (host=?, database=?, url=…)`。
- `scanDBeaver({ withSecrets })`：只有导入路径传 `withSecrets: true`，扫描接口永远不会把
  口令送回浏览器；用户字段缺失时用 `credentials-config.json` 里的 `user` 回填。
- `importDatasources()` 生成的 id 改用连接**显示名**做 slug（`mysql` 而不是
  `mysql8-1a1b66e47b5-12104…`），冲突时照旧加 `-2`、`-3`。
- 响应新增 `warnings: [{id, message}]`：没有 user、没有保存口令时给出可操作的提示。
- `createHost()` 的返回值新增 `__test: { parseJdbcUrl, mapDBeaverConnection }` 供自检调用。

### 21.3 客户端（0.5.1）

- 新增 `Breadcrumbs` 组件与 `crumbLabel(t, view)`：进入新建/编辑/导入/结构视图后，标题下方
  显示 `数据库 / 新建数据源` 这类面包屑；最后一步是纯文本，前面的每一步都是可点击的
  `button.dbmcp-crumb`。
- 删除 `SchemaView` 的「返回列表」按钮与对应的 `action.back` 词条（i18n 死键检查要求
  词条与用法一一对应），返回动作统一由面包屑承担。
- 新增样式 `.dbmcp-crumbs`、`.dbmcp-crumb`、`.dbmcp-crumb.is-current`、
  `.dbmcp-crumb-sep`、`.dbmcp-schema-head`，颜色全部走 `--dsw-alias-*`。

### 21.4 验证

- `dev/selftest.mjs` 增加 3 项（URL-only 条目可映射、host/port/database 解析、
  `jdbc:postgresql://` 的 user/port/database）→ 29/29。
- `dev/render.test.mjs` 把「返回按钮存在」改为「不再有页面级返回按钮」并新增 3 项
  面包屑断言 → 32/32。
- 线上：`POST /reload` → `0.5.1`；`GET /dbeaver/scan` 的 mysql 条目变为
  `user=demo, hasPassword=true, target=127.0.0.1:3306 / demo`；
  `POST /dbeaver/import {ids:[…]}` 建出 `id=mysql` 的源（`hasSecret: true`），
  `POST /datasources/test {id:'mysql'}` 返回
  `MySQL 8.0.46 · demo@%@demo · select version() ok`。
- 其余套件全绿：parse 24/24、render 32/32、i18n 12/12、p5 15/15、mcp 19/19、shims ok。

## 22. 0.5.2：标题即导航、去掉取消按钮、改为 Apache-2.0

### 22.1 交互

- 面板标题在非列表视图（新建 / 编辑 / 导入 / 结构）时渲染成 `button.dbmcp-title-switch`，点击回到数据源列表；样式继承 h1 字号，hover 变品牌色，与 dsh-mnemon 的标签式页头一致。
- 面包屑向标签观感靠拢：`.dbmcp-crumb` 增加 `padding: 4px 2px` 与 2px 透明下边框，当前段用 `border-bottom-color: var(--dsw-alias-brand-primary)` + `font-weight: 500` 表示选中，前面的段落 hover 加下划线。
- 删除 `SourceForm` 与 `ImportView` 里的「取消」按钮：返回列表统一由标题和面包屑承担，表单一屏内只留主操作，减少一次点击。

### 22.2 许可

- `LICENSE` 换成 Apache License 2.0 原文（11358 字节，无 BOM），`package.json` 的 `license` 字段改为 `Apache-2.0`，README 顶部徽章与 License 段落同步更新。
- 说明：Apache 软件基金会没有 3.0 版本的 Apache License，当前最新即 2.0，因此按 Apache-2.0 处理。

### 22.3 验证

- `dev/i18n.test.mjs` 12/12（`action.cancel` 词条已随用法一并删除，死键检查仍然通过）。
- `dev/render.test.mjs` 32/32、`dev/selftest.mjs` 29/29、`parse` 24/24、`p5` 15/15、`shims` ok。
- `dev/mcp.test.mjs` 19/19：Oracle 段的真实登录改为先探测 `target` 里的 host:port，容器未启动时记为 skip 而不是失败，避免本机环境让整套测试变红。
- `POST /plugins/db-mcp/api/reload` → `0.5.2`、phase P7。

## 23. 0.6.0：DDL 工具、分组与批量操作

### 23.1 DDL 工具

- `server/engines.py` 新增 `table_ddl(profile, connection, table, schema=None)`：
  - SQLite 读 `sqlite_master.sql`，原样返回建表语句（保留约束、外键、默认值），`source: "sqlite_master"`；
  - PostgreSQL / MySQL / Oracle 用 `describe_table` 的列元数据重建 `create table … (…)`，`source: "columns"`，因此会丢失索引、检查约束等目录外信息——这是有意的取舍：不依赖各库专有的 DDL 导出函数，也不执行任何 SQL。
- 新工具 `mcp__db__get_ddl`（必填 `table`，可选 `datasource` / `schema`），工具总数由 7 变 8。
- `src/tools.js` 的 `renderResult` 遇到 `ddl` 字段时直接返回纯文本，模型看到的是可读的建表语句而不是 JSON 包装。
- 实测：SQLite `Album`、Oracle `DEMO.EMPLOYEES`、MySQL `products` 三库均返回正确 DDL。

### 23.2 分组

- 数据源新增可选字段 `group`（≤48 字符，`publicProfile` 暴露，`normalizeInput` 校验并保留原值），面板的「更多设置」里有输入框。
- 列表按组渲染：组名排序、未分组排最后；只有一个空组时保持原来的平铺样式，避免单源数据出现空壳分组。
- 组内显示数量，组头与列表之间用一条细分割线区分。

### 23.3 批量操作

- 每行加复选框，选中后出现批量工具条：批量测试、设为只读、允许写、移动到分组（输入框 + 应用）、删除所选（两步确认）、清空选择。
- 服务端 `POST /datasources/bulk`：`{action: 'test' | 'readOnly' | 'group' | 'delete', ids: [...], readOnly?, group?}`，返回 `{ok, action, affected, datasources, results?}`；批量测试复用真实登录探针并把结果写回 `lastProbe`；删除同时清理 `secrets.json`。
- 一次请求完成整批，避免前端串行 N 次调用；校验失败返回 400，未知数据源返回 404。

### 23.4 导航

- 列表视图也常驻面包屑（`数据库 / 数据源`），子视图里显示 `数据库 / <当前>`，第一段可点击回列表。
- 子视图的工具栏左侧固定一个「← 数据源」按钮，与标题点击、面包屑三者等价，满足「随时回面板」的直觉。

### 23.5 验证

- `dev/selftest.mjs` 36/36（新增分组保存、组名超长、批量分组/只读/删除、空 ids、未知 action 七项）。
- `dev/render.test.mjs` 36/36、`dev/i18n.test.mjs` 12/12、`dev/parse.test.mjs` 24/24、`dev/p5.test.mjs` 15/15、`dev/shims.test.mjs` ok（8 工具）。
- `dev/mcp.test.mjs` 19/19（工具数断言改为 8 并包含 `get_ddl`）。
- 线上：`POST /reload` → `0.6.1`、8 工具；`POST /mcp/call {"tool":"get_ddl","datasource":"oracle-demo","arguments":{"table":"EMPLOYEES"}}` 返回 `create table "DEMO"."EMPLOYEES" (…)`；`POST /datasources/bulk {action:"group", ids:[…], group:"docker"}` 把三个演示源归组成功。

## 24. 0.6.1：面板头部改为「返回会话 + 标签页」风格

### 24.1 结构

- 页头（masthead）：左侧 `‹ 返回会话` 按钮（`ctx.layout.selectPanel(null)`，与 dsh-mnemon 的返回行为一致），中间 `数据库` 标题与副标题，右侧保留连接状态与版本药丸。
- 标签栏（`nav.dbmcp-tabs`，`role="tablist"`）：**数据源 / 运行时诊断 / 审计日志**，当前项用 2px 品牌色下边框 + 500 字重，与 dsh-mnemon 顶部导航同一观感。
- 操作栏只属于「数据源」标签：新建、从 DBeaver 导入、刷新、重启 MCP；其它标签不显示。
- 新建 / 编辑 / 导入 / 结构 是「数据源」标签下的子视图：标签保持选中，`← 数据源` 与标签点击都能回到列表。

### 24.2 实现要点

- `MainPanel` 新增 `tab` 状态与 `selectTab(id)`；子视图切换时若切到别的标签，列表状态复位到 `mode: 'list'`。
- 三张卡片（数据源 / 运行时诊断 / 审计日志）改为按标签条件渲染，容器加 `is-single` 类把网格收成一列。
- 客户端 `inject` 增加 `layout`，模块级 `layoutService` 保存 `ctx.layout`，取不到 `selectPanel` 时静默跳过（老壳兼容）。
- 标签文案由 `tabLabel(t, id)` 返回，保持 `t('tab.…')` 字面量，让 i18n 死键检查能识别。

### 24.3 验证

- `dev/render.test.mjs` 36/36（新增：三个 tab、首个 tab 选中态、`dbmcp-back` 按钮存在、面包屑已从页头移除）。
- `dev/i18n.test.mjs` 12/12（新增 `tab.sources` / `tab.runtime` / `tab.audit` / `header.backToChat` 四条，中英齐全，无死键）。
- 其余套件不变：selftest 36/36、parse 24/24、p5 15/15、mcp 19/19、shims ok。
- 线上：`POST /reload` → generation 9、`0.6.1`、8 工具。


## 25. 0.6.2：数据源列表独立成标签，新建/导入只切换内容区

### 25.1 交互

- 标签栏固定为五项：**数据源列表 / 新建数据源 / 从 DBeaver 导入 / 运行时诊断 / 审计日志**。
- 点击「新建数据源」「从 DBeaver 导入」只替换下方卡片内容，页头、标签栏、操作栏都不移动，也不再需要「← 数据源」返回按钮。
- 数据源卡片标题按用户要求改名为「数据源列表」；新建与导入卡片不再重复标题（标签已经表明当前位置）。
- 编辑与结构视图仍归属「数据源列表」之外的既有语义：编辑落在「新建数据源」标签（表单复用），结构落在「数据源列表」标签内的子视图，卡片内提供 `← 数据源` 返回。
- 操作栏（新建 / 导入 / 刷新 / 重启 MCP）在所有标签常显，不再随视图隐藏。

### 25.2 实现要点

- 去掉独立的 `tab` state，改为由 `view.mode` 推导：`tabOfMode(mode)` 把 create/edit → create、import → import、runtime/audit 各自映射，其余归 list。
- `selectTab(id)` 直接 `setView({ mode: id })`，因此点击当前标签也能从子视图回到该标签的根视图。
- `Card` 支持 `title: null`（不渲染 `h2`），用于新建/导入两张卡。
- 词典同步：新增 `tab.list` / `tab.create` / `tab.import`，删除 `tab.sources`、`sources.title`、`form.new`、`import.title`。

### 25.3 验证

- `dev/render.test.mjs` 36/36（标签数断言 3 → 5，首个标签选中态、返回会话按钮、面包屑已移除）。
- `dev/i18n.test.mjs` 12/12（新旧键替换后无死键、中英一致）。
- 其余不变：selftest 36/36、parse 24/24、p5 15/15、mcp 19/19、shims ok。
- 线上：`POST /reload` → generation 10、`0.6.2`。

## 25. 0.6.3：去掉第二排按钮、用户自建分组与拖拽

### 25.1 页面只保留一排导航
- 删除标签行下方的工具栏（新建数据源 / 从 DBeaver 导入 / 刷新 / 重启 MCP）：新建与导入本来就有独立标签页，重复按钮只会让人多点一次。
- **刷新** 与 **重启 MCP** 移到「数据源列表」卡片头部右侧（`Card` 新增 `actions` 插槽），只有在看得见列表时才出现。

### 25.2 分组归用户所有
- 注册表新增顶层 `groups` 数组（`schemaVersion` 不变，向后兼容）：`readRegistry()` 返回声明组与数据源 `group` 字段的并集，`writeRegistry(list, groups)` 省略 groups 时保留文件里已有的值。
- 接口：`GET /groups`、`POST /groups/save`（`{name, from?}`，from 存在即重命名并改写成员）、`POST /groups/delete`（成员回到「未分组」）。
- 页面：`新建分组` 输入框 + 组头 ✎ 重命名 / 删除（两步确认），空分组也会渲染成一个可投放的区块。

### 25.3 拖拽与组内选择
- 行 `draggable`，`dragstart` 写入 `text/plain` 的源 id（并用 state 兜底，部分壳会拒绝写 dataTransfer）；组区块 `dragover` 显示虚线高亮、`drop` 调 `POST /datasources/bulk {action:'group'}` 完成移动，「未分组」同样可投放。
- 组头新增全选复选框，行文本可点击切换选中，因此分组内的数据源和散落的源一样能进入批量操作。

### 25.4 验证
- `dev/selftest.mjs` 42/42（新增 6 项分组断言）、`dev/render.test.mjs` 37/37（新增「没有第二排导航」断言）、i18n 12/12、parse 24/24、p5 15/15、mcp 17 passed + 1 skipped（Docker 未起，Oracle 段按设计跳过）、shims ok。
- 线上：`POST /reload` 到 0.6.3，`GET /health` 返回 `groups: ["docker"]`、四个源中三个归入 docker；`/groups/save` 建组、改名、`/groups/delete` 删除均实测通过。

## 26. 0.6.4：重复连接不再重复导入（2026-11-07）

需求（m03798）：用户名与 URL 都相同的连接，不允许再导入一次。

### 26.1 身份定义
- 新增 `sourceIdentity(kind, config, user)`：SQLite 用文件路径（Windows 上小写）；其余用 `kind|host|port|database(或 serviceName/SID)|user`，host、库名、用户名统一小写，端口缺省用各引擎默认值。
- 同一身份即视为同一个数据源，与显示名、id 无关。

### 26.2 扫描与导入
- `scanDBeaver({ existing })` 接收调用方传入的注册表快照，命中既有源时返回 `alreadyImported` + `duplicateId` + `duplicateName`；同一批里重复的 DBeaver 条目也会被标记。
- `importDatasources` 对命中的 id 记入 `skipped: [{id, existingId}]`，不再建新源，也不重复写 secrets；返回值新增 `skipped`。
- 扫描接口仍不返回口令（`withSecrets` 只在导入路径使用）。

### 26.3 界面
- 导入页对重复项：复选框禁用并带 tooltip、名称后显示「已添加」药丸、目标行改成「已作为 X 添加」、不再显示口令行、整行 `is-taken` 半透明。
- 导入成功后提示区分「导入 n 个 / 跳过 m 个」。

### 26.4 验证
- `dev/selftest.mjs` 新增 5 项断言，共 **46/46**：扫描标记重复、重复导入被跳过、删掉重复项后可再次导入、第二次导入被跳过、`sourceIdentity` 对大小写与端口字符串不敏感。
- 其余：render 37/37、parse 24/24、i18n 12/12、p5 15/15、mcp 19/19、shims ok。
- 线上：`GET /dbeaver/scan` 两条连接均为 `alreadyImported: true`（sqlite → `dbeaver-sample-database-sqlite-1`，mysql → `mysql`）。

## 27. 0.6.5：双击重命名（分组与数据源）

### 27.0 0.6.5 修订
- 首次实现保留了「点正文即选中」，结果是双击组名/数据源名会先切换选中、再进入编辑，观感是「双击只选中了，没重命名」。现已移除行正文的 `onClick`，选中统一由复选框负责。


### 27.1 交互
- 分组头不再有「重命名」按钮，只保留「删除」。双击组名进入内联编辑，回车保存、Esc 取消。
- 数据源名称同理：双击名称进入内联编辑，只改显示名称，id 不变；提交走 `POST /datasources/save`，其余字段原样带回（口令仍由 secrets.json 持有，不参与往返）。
- 「未分组」是投放目标，不是真实分组，因此不可重命名。
- 行正文不再承担「点一下就选中」的职责：选中只走复选框（含组头全选），否则双击必然先触发两次 `click`，与重命名抢事件。

### 27.2 实现
- `TextInput` 增加 `onKeyDown` 透传，用于 Escape 取消。
- `renderGroup` 的组名改为 `span.dbmcp-group-name.is-renamable` + `onDoubleClick`，标题提示用 `group.renameHint`。
- `renderItem` 在 `renamingSource.id === source.id` 时渲染 `form.dbmcp-item-rename`（输入框 + 保存），否则渲染可双击的名称。
- 新增状态 `renamingSource`；新增 `renameSource()`；CSS 增加 `.is-renamable { cursor: text }` 与 `.dbmcp-item-rename` 布局。
- 字典：删除 `group.rename`（按钮文案），新增 `group.renameHint`（`Double-click to rename` / `双击重命名`），避免死键。

### 27.3 验证
- `node --check client.js` 通过；i18n 12/12（无死键）、render 37/37、selftest 46/46、parse 24/24、p5 15/15、shims ok。
- 版本 0.6.5。
