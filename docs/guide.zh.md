[English](guide.md) | 中文

# 使用指南

面板能做的事，按你会遇到的顺序排列。协议与文件格式见 [reference.md](reference.md)（英文）；构建与发布见 [development.md](development.md)（英文）。

## 安装与升级

`dsh plugin` 会把参数原样转给 profile 目录里的 pnpm，所以 `--profile` 必须写在 pnpm 动词之前：

```sh
dsh plugin --profile desktop add dsh-db-mcp     # 全新安装，桌面端
dsh plugin --profile web add dsh-db-mcp         # Web 界面的 profile
dsh plugin --profile desktop add dsh-db-mcp@0.8.0     # 锁定某个版本
dsh plugin --profile desktop remove dsh-db-mcp         # 卸载
dsh plugin --profile desktop why dsh-db-mcp            # 当前装的是哪个版本
```

`desktop` 与 `web` 随 DSH 自带；其它名字会在首次使用时自动创建（`--profile scratch add dsh-db-mcp`）。查看某个 profile 装了什么：`dsh plugin --profile desktop list dsh-db-mcp`。

从源码目录安装则传目录路径，profile 会以链接方式接入，改代码即时生效：

```sh
dsh plugin --profile desktop add C:\path\to\dsh-db-mcp
```

升级有三点要注意：

- pnpm 会缓存包的元数据。刚发布几分钟的版本可能还不在 dist-tag 里；直接写出版本号可以绕过。
- pnpm 对新版本有冷却期（`minimumReleaseAge`，默认 1440 分钟），避免刚发布、可能已被投毒的新版本被自动解析。点名具体版本时，pnpm 会把该版本记进 profile 的 `pnpm-workspace.yaml` 里的 `minimumReleaseAgeExclude`，这就是你看到的 `Added 1 entry to minimumReleaseAgeExclude …`。这不是错误：豁免只针对那一个版本，只放行这一次 pin。想改成先询问，在 profile 的 `pnpm-workspace.yaml` 里设 `minimumReleaseAgeStrict: true`；想清理过期条目，设 `minimumReleaseAgeExcludePrune: true`。
- 升级要么写精确版本，要么先删掉 lock 条目：只要依赖还满足原有范围，`add` 不会动它。

如果重启后侧栏入口消失，见 [排错](#排错)。

## 面板

侧栏 → **数据库**。页头有 **‹ 返回会话**、标题，以及连接状态和版本两个药丸。下面五个标签：

| 标签 | 作用 |
| ---- | ---- |
| 数据源列表 | 注册表：状态条、搜索、分组筛选、分组列表、批量操作、刷新 |
| 新建数据源 | 一条连接串、用户、口令；编辑也复用这个表单 |
| 从 DBeaver 导入 | 扫描、过滤、勾选、导入 |
| 运行时诊断 | Host 与 Python 的实时状态、工具数量、全局写开关、venv 与驱动版本；**重启 MCP** 按钮也在这里 |
| 审计日志 | 最近十几次工具调用，按你的时区显示 |

**新建数据源** 与 **从 DBeaver 导入** 只替换标签下方那张卡片——页头和标签保持不动，之前所在的位置始终只隔一个标签。

列表顶部是一条状态条，第一行是 MCP 服务是否就绪、数据源总数、探测正常的有几个、异常的有几个（并列出名字），右侧是搜索框；第二行是筛选 chip——**全部**、每个分组一个、**未分组**、**仅看异常**。搜索匹配名称、标识符、主机、类型和最近一次探测的消息；chip 与搜索框会同时收窄列表；探测失败的数据源无论怎么筛，都保持红色行与可展开的 **错误详情**。

每条数据源的连接目标下面，停着一个 **标识符** 药丸：它就是智能体调用 MCP 工具时要传的 `datasource` 值，所以单独做成一个可点的 chip，而不是缩在目标行末尾。点一下复制纯标识符，直接粘进对话（「查一下 `chinook` 这个源」）；太长被省略时，悬停可看到完整值。

## 新增数据源

表单和 DBeaver 的连接对话框一样精简：**连接串**、**用户**、**口令**（带 *保存密码* 勾选）。连接串输入框标着 *支持智能解析*，粘贴时就会填出类型、主机、端口、库名/服务名、显示名称与标识符；推导出来的值只出现在 **更多设置** 里——名称、分组、标识符排一行，下面才是类型、连接字段和只读开关。

除 SQLite（只要文件路径）外，连接串、用户与口令都是必填：缺任何一项时保存会停在表单里，把空着的那个框标红，已经填好的内容不会丢。表单底部的 **测试** 可以先验一次登录而不保存，结果就显示在按钮上方。编辑已有数据源时口令可以留空，表示沿用已保存的口令。

同一个 **主机 + 端口 + 库名 + 用户** 只允许一条（SQLite 按文件路径）：重复新建会返回 409，并把已有那条的标识符告诉你，避免列表里出现两条智能体分不清的记录。这个规则对 DBeaver 导入同样生效。

底部一行说明保存后的去向：立即在面板生效，并注册到本地 MCP 服务，智能体无需重启即可使用。

可接受的写法——DSN、JDBC URL、Oracle TNS 描述符、JDBC thin 描述符，或者干脆一个数据库文件路径：

```
postgresql://alice:secret@db.example.com:6543/orders?sslmode=require
jdbc:postgresql://localhost:5432/appdb
mysql://root:pw@127.0.0.1:3306/shop?charset=utf8mb4
jdbc:mariadb://10.0.0.5:3307/legacy
oracle://system:oracle@localhost:1521/XEPDB1
jdbc:oracle:thin:@//ora:1521/ORCLPDB1        # 服务名
jdbc:oracle:thin:@ora:1521:ORCL              # SID
(DESCRIPTION=(ADDRESS=(HOST=tns-host)(PORT=1522))(CONNECT_DATA=(SERVICE_NAME=svc1)))
jdbc:oracle:thin:@(DESCRIPTION_LIST=(DESCRIPTION=(ADDRESS_LIST=(ADDRESS=(PROTOCOL=TCP)(HOST=rac-1)(PORT=1521)))(CONNECT_DATA=(SERVICE_NAME=ORCLPDB1))))
jdbc:opengauss://h1:30100,h2:30100,h3:30100/demo?targetServerType=master
jdbc:sqlite:C:\data\app.db
sqlite:///C:/data/chinook.db
C:\data\app.db
/var/lib/app.sqlite3
```

连接串里带的密码只发送一次，之后仅保存，永远不会回显。`id` 创建后不可修改——要改的是 *显示名称*（双击行上的名字）。

openGauss 与 GaussDB 是独立的类型：它们的 SHA256 认证不在 libpq 的协商范围内，所以服务端用纯 Python 的 `py_opengauss` 驱动连接（随其它 Python 依赖一起安装），只在仍用 md5 的集群上回落到 psycopg。粘贴集群 URL 时每个节点都会按顺序保留——面板上显示为 `h1 +2:30100`。

## 从 DBeaver 导入

导入器会在 `%APPDATA%\DBeaverData\workspace*\General\.dbeaver\` 下找 `data-sources.json`，同时兼容 `General` 布局与 Linux/macOS 布局。同目录存在 `credentials-config.json` 时，会用 DBeaver 内置密钥解密（AES-128-CBC、零 IV、前 16 字节前缀——参考 [Tatsh/dbeaver-creds](https://github.com/Tatsh/dbeaver-creds)）。勾选的连接被复制进注册表，口令写入 `secrets.json`。

三个细节让真实的 DBeaver 工作区可用：

- 通过驱动对话框创建的连接常常只有一条 JDBC URL（`configurationType: URL`），既没有 `database` 字段也没有 `user`。导入器会从 URL 里解析表单缺失的部分，用户名则取自解密后的凭据。
- 已经配置过的连接不会重复出现。数据源按 类型 + 主机 + 端口 + 库名/服务名/SID + 用户 识别（SQLite 用文件路径）；命中时返回 `alreadyImported`，复选框被禁用，行上写着 *已作为 … 添加*；即使绕过界面直接调用导入接口，也只会进 `skipped`。
- 列表带过滤框（按名称、主机或用户），操作栏固定在视图顶部，工作区再长 **导入所选** 也一直在手边。

从未保存过口令的工作区也没问题：连接会以空口令导入，行上显示 **无密码**。补填一次就会一直保留。

## 测试连接

**测试** 执行的是真实登录：SQLite 通过 `node:sqlite` 以只读方式打开，其它引擎走 Python 驱动，完成认证并执行 `select 1`（Oracle 是 `select 1 from dual`）。之后行上会显示版本横幅、用户、数据库，以及登录耗时：

```
Oracle AI Database 26ai Free Release 23.26.3.0.0 · DEMO@FREEPDB1 · select 1 from dual ok
PostgreSQL 15.19 · demo@demo · select version() ok
MySQL 8.0.46 · demo@%@demo · select version() ok
```

口令错误现在会直接显示驱动自己的报错（`ORA-01017`、`DPY-6005`、`password authentication failed`），而不是笼统的「端口可达」。还没保存的表单也能测试。Python 服务起不来时，探测会退化成 TCP 检查，并明确说明这一点。

失败的信息只留在那一行里：点右侧 `⌄` 展开驱动原文，或点 **复制** 把整份报告放进剪贴板：

```
datasource: mysql
id: mysql
kind: mysql
target: 127.0.0.1:3306/demo
at: 2026-11-09 21:41:06 UTC+08:00
error: MySQL connection failed: (2003, "Can't connect to MySQL server on '127.0.0.1' …")
plugin: dsh-db-mcp 0.8.0
```

测试失败不会再弹到标签页上方的横幅——那条横幅只留给保存、删除、安装依赖这类面板操作。

## 分组与批量操作

每个数据源都可以带一个可选的 **分组** 标签，在 *更多设置* 里编辑。

- **新建** —— 在 **新建分组** 里输入名字。
- **重命名** —— 双击组名；**删除** 只解除该组下成员的标签。
- **折叠** —— 组名旁的三角可以收起这一组；空分组也仍然显示，因为它就是拖放的落点。
- **移动** —— 把数据源行拖到某个分组上，拖到 **未分组** 即清除标签。
- **排序** —— 把一行拖到另一行上：落在目标上半部分就排在它前面，落在下半部分就排在它后面；跨组拖拽会一次性完成换组和定位。
- **重命名数据源** —— 双击它的名字；`id` 永远不变。
- **选择** —— 每个组头都有全选框，分组内的数据源和散落的一样能参与批量操作；行本身用复选框选中（正文不再切换选中，双击才留给重命名）。

选中之后，批量条可以测试、切换只读、移入分组，或删除（两步确认）。

## 结构浏览

数据源行上的 **结构** 会打开只读视图：左边是表和视图，右边是所选表的列（名称、类型、可空、默认值、主键标记）。表按模式分组，每组可以折叠展开；树上方有过滤框，同时匹配表名与模式名。请求时会带上表所属的模式，因此不同模式下的同名表不会混淆。它由 `GET /schema` 提供，该接口只把 `list_tables` / `describe_table` 转发给 MCP 服务——页面无法执行 SQL，也不做缓存。视图顶部一行同时给出返回列表的按钮、连接目标和同一个 **标识符** chip，看表的时候就能顺手把句柄交给智能体。

## 两道安全闸门

两条独立的闸门决定一条语句能不能写入：

1. **全局开关** —— `<runtime>/settings.json` 里的 `allowWrite`，在 *运行时诊断* 标签切换。默认关闭；关闭期间所有写入都会以 `user_error` 拒绝，并提示去打开开关。
2. **单源开关** —— 数据源上的 `readOnly`，默认开启。点行上的 *只读* / *读写* 药丸可一键切换；该源允许写入时药丸变成琥珀色。

Python 服务在启动时读取全局开关，开关一动 Host 就重启它。在引擎允许的地方，只读还会在驱动层再拦一次（SQLite 用 `mode=ro`，PostgreSQL 用 `default_transaction_read_only`，MySQL 用 `SET SESSION TRANSACTION READ ONLY`）。

## 限制单个会话能访问的数据源

可以把这个会话限制在部分数据源上。直接用自然语言说 —— *「本会话只用 pg-demo 和 oracle-demo」* —— 智能体会用这些标识符调用 `mcp__db__session_scope` 工具。不用填表，也不用改文件；标识符就是列表里每个名称下方显示的那一串。

该会话存在限制时：

- `list_datasources` 只返回允许的那几条；
- 调用里写了别的数据源，会以 `user_error` 拒绝；
- 调用里不写 `datasource`，会在只有一个允许项时自动用它，否则提示可用的标识符；
- `test_connection` 不能用内联的连接串，否则会绕过名单。

说 *「取消本会话的限制」*（或让工具用 `all: true`）即可解除。没有保存限制的会话仍然能访问全部数据源；*运行时诊断* 标签会列出被限制的会话，一眼可见。这个限制是会话级的便利开关，不是安全边界：运行时目录里的文件对你自己的账号始终可读。

## 审计日志

每次 MCP 工具调用都会往 `<runtime>/logs/audit.jsonl`（0600）追加一行 JSON：时间、工具、数据源、耗时、行数、截断到 2000 字符的 SQL，以及失败时的错误。结果行本身从不记录。文件到 512 KiB 会轮转为 `audit.1.jsonl`，日志可用 `auditLog: false` 关闭。

面板按 **你本机的时钟** 显示最近十几次记录，**带日期**，昨天和一小时前的调用不会混在一起；文件里保存的是 UTC，以便跨机器比较。悬停时显示同一时刻与时区。

## 运行时目录

```
$DSH_HOME/db-mcp/
  datasources.json   # 数据源与分组，从不含口令，0600
  secrets.json       # 每个数据源的口令，0600，仅 Host 可读
  settings.json      # 全局写开关 + 审计开关，0600
  sessions.json      # 按会话的数据源限制，0600
  logs/mcp.log       # 脱敏日志
  logs/audit.jsonl   # 每次 MCP 工具调用一行，512 KiB 轮转
  .venv/             # 插件内 venv：mcp、psycopg、PyMySQL、oracledb
```

## 用 Docker 起测试库

本机什么都不用装；下面每个引擎都是一个用完即弃的容器，带演示账号（`demo` / `dbmcp-demo`）。

```sh
# PostgreSQL —— 镜像最小、启动最快，推荐先试它
docker run -d --name dbmcp-pg -p 5432:5432 \
  -e POSTGRES_USER=demo -e POSTGRES_PASSWORD=dbmcp-demo -e POSTGRES_DB=demo \
  postgres:15-alpine

# MySQL
docker run -d --name dbmcp-mysql -p 3306:3306 \
  -e MYSQL_USER=demo -e MYSQL_PASSWORD=dbmcp-demo -e MYSQL_DATABASE=demo \
  -e MYSQL_ROOT_PASSWORD=dbmcp-root mysql:8.0-debian

# Oracle Free —— 几个 GB，需要一两分钟才健康
docker run -d --name dbmcp-oracle -p 1521:1521 -e ORACLE_PASSWORD=dbmcp-demo \
  gvenzl/oracle-free:23-slim
```

在 Windows 上，1521 常常落在 Hyper-V 的保留端口段里，`docker run` 会报 *"An attempt was made to access a socket in a way forbidden by its access permissions"*。用 `netsh interface ipv4 show excludedportrange protocol=tcp` 确认，然后映射到别的宿主端口，例如 `-p 11521:1521`，再把数据源指向 11521。

然后用对应的连接串导入或新建数据源：

```
postgresql://demo:dbmcp-demo@127.0.0.1:5432/demo
mysql://demo:dbmcp-demo@127.0.0.1:3306/demo
oracle://system:dbmcp-demo@127.0.0.1:1521/FREEPDB1
```

## 排错

| 现象 | 原因 | 处理 |
| ---- | ---- | ---- |
| 侧栏入口消失，插件卡片显示 *未安装* | `package.json` 带 UTF-8 BOM，Host 的 `JSON.parse` 失败，整个 bundle 被静默跳过 | 用编辑器另存为「UTF-8 无 BOM」，再到 **插件** 面板把插件关掉再打开 |
| 面板显示 *Host 接口未连接* | Host 半边没挂载（插件被禁用，或 bundle 加载失败） | 检查插件卡片，然后刷新页面 |
| 改了 `src/host.js` 但没有变化 | Cordis 入口在每个进程里只导入一次 | `POST /plugins/db-mcp/api/reload`；改过 `index.js` 则需重启 DSH |
| 智能体看不到工具 | Python 服务没起来 | *运行时诊断* 里看工具数与错误，然后点 **重启 MCP** |
| 重启后立刻报 `unknown tool "mcp__db__…"` | 工具注册随旧进程被释放 | 重启一次 DSH，之后的重启都用 **重启 MCP** |
| Oracle 登录报 `DPY-6005` | 监听不可达，或主机/端口不对 | `docker ps` 确认容器，再点 *测试* |
| 首次写入报 `ORA-01950` | Oracle 用户没有表空间配额 | `alter user <用户> quota unlimited on users` |
| 导入行标红：*incomplete host/database* | 该 DBeaver 条目既没有字段也没有可解析的 URL | 先用 DBeaver 打开一次这个连接，或手工新建数据源 |
