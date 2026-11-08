# dsh-db-mcp

[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

[English](README.md) | 中文

一个 DSH 插件：在侧边栏加一个 **数据库** 入口，配一个数据源管理面板，背后是 Python 写的 MCP 服务——让智能体通过工具查询这些数据库，而不是在页面里执行 SQL。

- 一个面板管四种引擎：SQLite、PostgreSQL、MySQL、Oracle。
- 一条连接串填满整张表单；口令只存在本机，永不回传给页面。
- 可以把 DBeaver 里已有的连接（连同它加密保存的口令）直接导入。
- 默认只读，两道互相独立的写闸门，加一份审计日志。
- 给智能体的是 8 个 MCP 工具，界面里没有 SQL 编辑器。

需求与阶段计划见 [`docs/requirements.md`](docs/requirements.md)。

## 现在有什么（P7）

- **Host 半边**（`index.js` → `src/host.js`）：一个 Cordis 插件，通过 DSH 的 web server 提供 `/plugins/db-mcp/api`。

  | 路由 | 用途 |
  | ---- | ---- |
  | `GET /health` | 插件版本、Host 信息、Python 探测、运行时路径、注册表状态、MCP 状态、设置 |
  | `GET /datasources` | 注册表，口令字段已剔除 |
  | `GET /schema?datasource=…&table=…[&schema=…]` | 只读结构：表清单，或某张表的列 |
  | `GET /groups` | 已声明的分组，加上所有正在使用的分组名 |
  | `GET /dbeaver/scan` | DBeaver 里已配置的连接 |
  | `GET /mcp/status` | Python 服务所处阶段、工具清单、最后的错误、stderr 尾部 |
  | `GET /settings` · `POST /settings` | 全局写开关与审计开关 |
  | `GET /audit?limit=N` | 工具调用审计日志的末尾若干条 |
  | `GET /python/env` | 解释器、venv 路径、已安装的驱动版本 |
  | `POST /python/setup` | 建 venv 并 `pip install -r server/requirements.txt` |
  | `POST /datasources/save` | 新建或更新数据源（`id` 不可改） |
  | `POST /datasources/delete` | 删除数据源及其口令 |
  | `POST /datasources/test` | 真实登录探测：SQLite 走 `node:sqlite`，其余走 Python 驱动 |
  | `POST /datasources/bulk` | 对一批数据源做 测试 / 只读 / 分组 / 删除 |
  | `POST /groups/save` · `POST /groups/delete` | 新建、重命名、删除分组 |
  | `POST /dbeaver/import` | 把选中的 DBeaver 连接复制进注册表 |
  | `POST /mcp/start` · `POST /mcp/restart` | 启动或重启 Python MCP 服务 |
  | `POST /mcp/call` | 开发辅助：经面板调用某个 MCP 工具 |
  | `POST /reload` | 开发辅助：不重启 DSH 重新导入 `src/host.js` |

- **Client 半边**（`client.js`）：侧边栏入口（`db-mcp`，order 25）加主面板——数据源列表、极简的新建/编辑表单（一条连接串）、测试/删除/设为默认、只读的「结构」浏览、DBeaver 导入流程、「重启 MCP」按钮、运行时诊断卡（工具数、全局写开关、venv 与依赖版本及一键安装）、以及「审计日志」卡。文案经客户端 `locale` 服务做中英本地化。
- **Python 服务**（`server/`）：`main.py`（FastMCP，8 个工具）、`engines.py`（按引擎连接/内省/查询）、`store.py`（读注册表）。插件用 stdio 拉起它，把它的工具以 `mcp__db__*` 发布到 Host 的 `tools` 服务上——**不**经过 `dsh-mcp-client` 的 Loader 行。

### 智能体拿到的工具

| 工具 | 用途 |
| ---- | ---- |
| `mcp__db__list_datasources` | 已登记的数据源（id、类型、目标、是否只读） |
| `mcp__db__list_tables` | 某个数据源的表/视图 |
| `mcp__db__describe_table` | 列、类型、是否可空、主键 |
| `mcp__db__sample_rows` | 某张表的少量样本 |
| `mcp__db__run_query` | 执行一条语句；只读源拒绝写 |
| `mcp__db__explain_query` | 查询计划 |
| `mcp__db__get_ddl` | `CREATE TABLE` 语句（SQLite 取原文，其余按目录重建） |
| `mcp__db__test_connection` | 真实登录、执行 `select 1`、回报服务器/用户/模式 |

`datasource` 处处可选：不填就用默认数据源。

### Python 环境

解释器探测顺序：插件配置 `pythonPath` → `<DSH_HOME>/db-mcp/.venv/Scripts/python.exe` → POSIX 上的同一个 venv → `python` → `python3`。依赖装在运行时 venv 里，不随包分发：

    python -m venv C:\Users\<you>\.dsh\db-mcp\.venv
    C:\Users\<you>\.dsh\db-mcp\.venv\Scripts\python.exe -m pip install -r server\requirements.txt

`mcp` 必须固定在 1.x（2.x 把 `FastMCP` 改名成了 `MCPServer`）。

## 「测试」按钮是真的登录吗？

是。PostgreSQL、MySQL、Oracle 的 **测试** 走 `mcp__db__test_connection`，经 Python MCP 服务执行一次真实认证登录加 `select 1`（Oracle 用 `select 1 from dual`）。列表行随后显示服务器横幅、登录用户与库名、以及登录耗时，例如：

```
Oracle AI Database 26ai Free Release 23.26.3.0.0 · DEMO@FREEPDB1 · select 1 from dual ok
PostgreSQL 15.19 · demo@demo · select version() ok
MySQL 8.0.46 · demo@%@demo · select version() ok
```

口令错误或端口不通时，显示的是驱动自己的信息（`ORA-01017`、`DPY-6005`、`password authentication failed`），而不是笼统的「端口可达」。未保存的表单也能测：`test_connection` 接受 `kind` + `config` + `password`，不需要先写注册表。Python 服务起不来时，探测退回 TCP 检查，并明确说明这一点。

## 一条连接串填完整张表单

新建/编辑表单刻意做得和 DBeaver 的连接对话框一样小：**连接串**、**用户**、**口令**（带「保存密码」勾选），就这些。粘贴 JDBC URL、DSN、Oracle TNS 描述符或 `.db` 路径，类型、主机、端口、库名/服务名、名称与标识符都会自动带出；推导出来的值默认收在「更多设置」里，与模式、SID、SSL 模式、字符集、只读开关放在一起。

支持的写法（完整矩阵见 `dev/parse.test.mjs`）：

```
postgresql://alice:secret@db.example.com:6543/orders?sslmode=require
jdbc:postgresql://localhost:5432/appdb
mysql://root:pw@127.0.0.1:3306/shop?charset=utf8mb4
jdbc:mariadb://10.0.0.5:3307/legacy
oracle://system:oracle@localhost:1521/XEPDB1
jdbc:oracle:thin:@//ora:1521/ORCLPDB1        # 服务名
jdbc:oracle:thin:@ora:1521:ORCL              # SID
(DESCRIPTION=(ADDRESS=(HOST=tns-host)(PORT=1522))(CONNECT_DATA=(SERVICE_NAME=svc1)))
jdbc:sqlite:C:\data\app.db
sqlite:///C:/data/chinook.db
C:\data\app.db          /  /var/lib/app.sqlite3
```

连接串里的口令只发送一次给 `POST /datasources/save`，之后只存在 `secrets.json` 里，永不回显。

写操作一律用 `POST`（同源校验比较 `Origin` 与 `Host`）。口令不会进 `datasources.json`，只存在 `secrets.json`，页面拿到的唯一信号是 `hasSecret`。

## 从 DBeaver 导入

`GET /dbeaver/scan` 会在 `%APPDATA%\DBeaverData\workspace*\General\.dbeaver\` 下找 `data-sources.json`（同时兼容 `General` 布局与 Linux/macOS 位置）。同级存在 `credentials-config.json` 时，用 DBeaver 内置的密钥解密（AES-128-CBC、零 IV、前 16 字节前缀，参考 `Tatsh/dbeaver-creds`）。从未保存过口令的工作区，导入出来的连接口令为空，界面显示「无密码」。

通过 DBeaver 驱动对话框建的连接，往往只有一条 JDBC URL（`configurationType: URL`），既没有 `database` 字段也没有 `user` 字段。导入器因此会自己解析 `jdbc:mysql://host:port/db`、`jdbc:postgresql://…`、`jdbc:oracle:thin:@…`，补上表单字段缺的部分，并在解密凭据里存了用户名时从那里取。导入的数据源按 DBeaver 连接名命名（再 slug 成 id），保持 `readOnly: true`，已存的口令会复制进 `secrets.json`；仍然缺的东西写进 `warnings`。

已经配置过的连接不会被导入两次：每个数据源用 类型 + 主机 + 端口 + 库名/服务名/SID + 用户 做身份（SQLite 用文件路径），命中的 DBeaver 条目会带上 `alreadyImported: true`、`duplicateId`、`duplicateName` 返回。面板把它的复选框禁用并标注「已作为 … 添加」，`POST /dbeaver/import` 则把这类 id 放进 `skipped`，不会建出第二份。

面板用标签栏导航（*数据源列表 / 新建数据源 / 从 DBeaver 导入 / 运行时诊断 / 审计日志*）：当前步骤是纯文本、可回退的步骤是链接，任何页面都不需要额外的「返回列表」按钮。

## 用 Docker 起测试库

宿主机什么都不用装，下面每个引擎都是用完即弃的容器，演示账号 `demo` / `dbmcp-demo`。

```
# PostgreSQL —— 镜像最小、启动最快，推荐第一个试
docker run -d --name dbmcp-pg -p 5432:5432 \
  -e POSTGRES_USER=demo -e POSTGRES_PASSWORD=dbmcp-demo -e POSTGRES_DB=demo \
  postgres:15-alpine

# MySQL
docker run -d --name dbmcp-mysql -p 3306:3306 \
  -e MYSQL_USER=demo -e MYSQL_PASSWORD=dbmcp-demo -e MYSQL_DATABASE=demo \
  -e MYSQL_ROOT_PASSWORD=dbmcp-root mysql:8.0-debian

# Oracle Free —— 镜像好几个 GB，要一两分钟才就绪
docker run -d --name dbmcp-oracle -p 1521:1521 -e ORACLE_PASSWORD=dbmcp-demo \
  gvenzl/oracle-free:23-slim
```

Windows 上 1521 常常落在 Hyper-V 的保留端口段里，`docker run` 会报「尝试访问套接字的方式被其访问权限禁止」。用 `netsh interface ipv4 show excludedportrange protocol=tcp` 查一下，换一个宿主端口发布即可，例如 `-p 11521:1521`，数据源里填 11521。

然后在面板里用对应的连接串建数据源，例如
`postgresql://demo:dbmcp-demo@127.0.0.1:5432/demo`、
`mysql://demo:dbmcp-demo@127.0.0.1:3306/demo` 或
`oracle://system:dbmcp-demo@127.0.0.1:1521/FREEPDB1`。

## 装进一个 profile

```
plugin_manager install_bundle  target=<本目录的绝对路径>
```

或者从 npm 装：

```
dsh plugin add dsh-db-mcp@latest
```

bundle patch（`cordis.patch.yml`）只插入一行 Loader 配置，id 为 `db-mcp`。以链接方式装入的 profile 改文件即生效；Host 模块每个进程只导入一次，所以改完 `src/host.js` 要 `POST /plugins/db-mcp/api/reload`（或重启应用）。

## 面板布局

页面与其它官方面板保持一致的外壳：

- 页头：**‹ 返回会话**（经 `ctx.layout.selectPanel(null)` 关闭面板）、**数据库** 标题，以及连接状态与版本药丸；
- 标签栏 —— **数据源列表 / 新建数据源 / 从 DBeaver 导入 / 运行时诊断 / 审计日志**，当前标签带下划线。

点「新建数据源」或「从 DBeaver 导入」只切换标签下方那张卡片，页头与标签栏不动。编辑复用「新建数据源」标签；结构浏览是「数据源列表」下的子视图，带自己的 `← 数据源` 链接。没有第二排操作栏：**刷新** 与 **重启 MCP** 在数据源列表卡片的头部，分组相关的操作归列表自己管。

## 结构概览

数据源行上的「结构」按钮打开只读浏览器：左边是该源的表（或视图），右边是选中表的列——名称、类型、可空、默认值、主键标记。数据由 `GET /schema` 提供，它只把 `list_tables` / `describe_table` 转发给 MCP 服务，页面本身永远执行不了 SQL。不缓存：每次打开都读实时目录。

## 分组与批量操作

每个数据源带一个可选的**分组**标签（注册表里的 `group`，可在「更多设置」里改）。分组归用户所有：在「新建分组」框里输入名字即可创建，**双击组名改名**（或按删除按钮删组），把数据源行拖到某个组上即可移过去（拖到「未分组」上则清除标签）。双击数据源名只改这一条的名字，id 永不改变。列表按组渲染成若干区块，组名排序、未分组的排最后；没有分组时列表保持原来的平铺样式。

每个组头都有全选复选框，所以组内的数据源和散在外面的完全一样，都能参与批量操作。勾选任意行即出现批量操作条：批量测试、设为只读或允许写、移动到某个分组、或删除（两步确认）。批量移动走 `POST /datasources/bulk`，body 形如 `{ action: 'test' | 'readOnly' | 'group' | 'delete', ids: [...], … }`；分组的增删改走 `GET /groups`、`POST /groups/save`、`POST /groups/delete`。

## 发布

包由 GitHub Actions 通过 [npm trusted publishing](https://docs.npmjs.com/trusted-publishers) 发布：`.github/workflows/publish.yml` 用 workflow 的 OIDC token 换短期发布凭据，因此仓库里没有任何 `NPM_TOKEN` 密钥。

```bash
node dev/bump.mjs 0.6.5      # 同时改 package.json 与 src/host.js
git commit -am "chore: release 0.6.5"
git tag v0.6.5 && git push origin main --tags
```

workflow 会拒绝 tag 与 `package.json` 版本不一致的情况，先跑可移植测试（`npm run test:ci`），再带 `--provenance` 发布，最后轮询 registry 确认版本已出现。首次发布（包还没有 trusted publisher 时）仍可本地 `npm publish`。

## 开发

```
node dev/selftest.mjs     # 在临时端口挂载 src/host.js，46 项断言
node dev/shims.test.mjs   # 挂载 index.js，检查路由、/reload、工具发布
node dev/parse.test.mjs   # 24 项：连接串解析（DSN/JDBC/TNS/路径）
node dev/render.test.mjs  # 37 项：用 stub React 渲染组件
node dev/i18n.test.mjs    # 12 项：中英键集合一致、无死键、无漏译
node dev/p5.test.mjs      # 15 项：设置、审计日志、Python 环境
node dev/mcp.test.mjs     # 19 项：真实 Python 服务走 stdio，真实 SQLite 与 Oracle 登录
```

`npm test` 跑除 `mcp.test.mjs` 之外的全部（后者需要 venv 与 Oracle 容器）。`node dev/bump.mjs 0.6.6` 会同步两处版本号。

## 安全闸门

是否允许写入由两道互相独立的闸门决定：

1. **全局开关** —— `<运行时目录>/settings.json` 的 `allowWrite`，在诊断卡上切换。默认关闭；关闭期间所有写语句都以 `user_error` 拒绝，并给出指向该开关的提示。
2. **单源标记** —— 数据源的 `readOnly`，默认开启。即使全局开关打开，只要不清掉这条标记，该源仍然只读。

Python 服务启动时从环境变量 `DB_MCP_ALLOW_WRITE` 读取全局标记；开关一变，Host 就会重启它。只要引擎支持，只读还会在驱动层再兜一次（SQLite 的 `mode=ro`、PostgreSQL 的 `default_transaction_read_only`、MySQL 的 `SET SESSION TRANSACTION READ ONLY`）。

## 审计日志

每次 MCP 工具调用都会向 `<运行时目录>/logs/audit.jsonl`（0600）追加一行 JSON：时间、工具、数据源、耗时、行数、截断到 2000 字符的 SQL，以及失败时的错误。结果行永不记录。文件超过 512 KiB 轮转为 `audit.1.jsonl`，也可以在 `settings.json` 里用 `auditLog: false` 关掉。面板显示最近十几条，时间按**本机时区**换算——文件里存的是 UTC，这样换机器也仍然可比；卡片会把每条时间戳转成浏览者的时区，并标出所用偏移。

`dev/shims.test.mjs` 还断言 `package.json` 不带 UTF-8 BOM：Host 用 `JSON.parse` 读它，而 `JSON.parse` 会拒绝 BOM，插件随之显示为 `availability: missing`，并不加载。会「添加 BOM」的编辑器会静默弄坏 bundle——如果重启后侧边栏入口消失，先查这一项。

## 阶段表

| 阶段 | 内容 |
| ---- | ---- |
| P1 | 可安装的骨架：侧边栏入口、空面板、Host 健康接口（已完成） |
| P2 | 数据源 CRUD、连接测试、DBeaver 导入（已完成） |
| P3 | Python MCP 服务，工具以 `mcp__db__*` 发布（已完成） |
| P4 | PostgreSQL / MySQL / Oracle 方言（已完成） |
| P5 | 诊断、一键 venv、热重载、审计日志、全局写开关（已完成） |
| P6 | 多语言打磨与文档（已完成） |
| P7 | 只读结构概览、分组、批量操作（已完成） |

## 许可

Apache License 2.0 —— 见 [LICENSE](LICENSE)。

## 运行时目录

```
$DSH_HOME/db-mcp/
  datasources.json   # 数据源档案，不含口令，0600
  secrets.json       # 各源口令，0600，仅 Host 可读
  settings.json      # 全局写开关 + 审计开关，0600
  logs/mcp.log       # 已掩码的日志
  logs/audit.jsonl   # 每次 MCP 工具调用一行，超过 512 KiB 轮转
  .venv/             # 插件内 venv：mcp、psycopg、PyMySQL、oracledb
```
