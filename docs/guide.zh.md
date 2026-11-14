[English](guide.md) | 中文

# 使用指南

面板能做的事，按你会遇到的顺序排列。其余内容各有独立页面：

- [safety.zh.md](safety.zh.md) —— 谁能写、写到哪，以及哪些规则在离开 DSH 后仍然生效
- [clients.zh.md](clients.zh.md) —— HTTP 端点、工具清单、自己跑这个服务
- [runtime.zh.md](runtime.zh.md) —— 磁盘上的文件、Python 依赖、Docker 测试库、排错
- [reference.md](reference.md)（英文）—— 协议与文件格式
- [development.md](development.md)（英文）—— 构建、测试与发布

## 流程总览

连接在面板这一侧准备好（左），查询在对话那一侧发生（右）；两边唯一的交接物，是一条已经存在的数据源。

![从 DBeaver 连接到对话里拿到答案](../asset/usage-guide.zh.png)

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

### 在应用里更新

「设置 → 插件」可以直接就地升级。两点要知道：

- 服务端那一半在启动时只导入一次，所以新代码要**重启 DSH** 后才运行；页面上会立刻变成新版，MCP 工具不会。
- 如果对话框停在「停止并移除 <旧版本>」并提示**其他配置仍在使用这个组合包的组件**，正在运行的这个应用本身就算一个「配置」。**重启 DSH 再更新一次**即可，实测这样就够了。
- Windows 上重启还解决另一个问题：运行中的 DSH 占用着包目录里的文件，就地替换会失败（`EPERM … rename`）。

如果不想重启，或者多个 profile 各自留着一份，就完全退出 DSH（不是刷新页面），把每个装过它的 profile 都更到新版：

```powershell
$profiles = 'desktop', 'web'
foreach ($p in $profiles) {
  $file = "$env:USERPROFILE\.dsh\profiles\$p\package.json"
  if ((Test-Path $file) -and ((Get-Content $file -Raw) -match '"dsh-db-mcp"')) {
    dsh plugin --profile $p add dsh-db-mcp
  }
}
```

如果 pnpm 回答 `Already up to date`，写出版本号强制升级：`dsh plugin --profile desktop add dsh-db-mcp@0.9.7`。

你配置的东西不会有风险：数据源、已存口令、设置与审计日志都在 `~/.dsh/db-mcp`，不在包目录里。

如果重启后侧栏入口消失，见 [排错](runtime.zh.md#排错)。

## 面板

侧栏 → **数据库**。页头有 **‹ 返回会话**、标题、连接状态和版本两个药丸，以及一个指向[仓库](https://github.com/halcyon6669/dsh-db-mcp)的 **Star** 链接——文档、issue 和源码都在那里。下面七个标签：

| 标签 | 作用 |
| ---- | ---- |
| 数据源列表 | 注册表：状态条、搜索、分组筛选、分组列表、批量操作、刷新 |
| 新建数据源 | 一条连接串、用户、口令；编辑也复用这个表单 |
| 从 DBeaver 导入 | 扫描、过滤、勾选、导入 |
| 接入其它客户端 | HTTP 端点，以及可以一键写进配置的客户端 |
| 运行时诊断 | Host 与 Python 的实时状态、工具数量、全局写开关、venv 与驱动版本；**重启 MCP** 按钮也在这里 |
| 工具 | Python 服务发布的每个工具，带开关 |
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

连接串里带的密码只发送一次，之后仅保存，永远不会回显。密码里出现 `#`、`?`、`/` 这些 URL 分隔符也没问题：`#` 可以直接写，也可以写成 `%23`，两种都会按原样保存。`id` 创建后不可修改——要改的是 *显示名称*（双击行上的名字）。

openGauss 与 GaussDB 是独立的类型：它们的 SHA256 认证不在 libpq 的协商范围内，所以服务端用纯 Python 的 `py_opengauss` 驱动连接（随其它 Python 依赖一起安装），只在仍用 md5 的集群上回落到 psycopg。粘贴集群 URL 时每个节点都会按顺序保留——面板上显示为 `h1 +2:30100`。结构页里不会列出回收站里的 `BIN$…` 残留表。

## 从 DBeaver 导入

导入器会在 `%APPDATA%\DBeaverData\workspace*\General\.dbeaver\` 下找 `data-sources.json`，同时兼容 `General` 布局与 Linux/macOS 布局。同目录存在 `credentials-config.json` 时，会用 DBeaver 内置密钥解密（AES-128-CBC、零 IV、前 16 字节前缀——参考 [Tatsh/dbeaver-creds](https://github.com/Tatsh/dbeaver-creds)）。勾选的连接被复制进注册表，口令写入 `secrets.json`。

几个细节让真实的 DBeaver 工作区可用：

- 通过驱动对话框创建的连接常常只有一条 JDBC URL（`configurationType: URL`），既没有 `database` 字段也没有 `user`。导入器会从 URL 里解析表单缺失的部分，用户名则取自解密后的凭据。
- openGauss / GaussDB 的驱动类连接在 DBeaver 里常被记成 `generic`（provider 是 generic、驱动是 jar），此时按 URL 的 scheme（`jdbc:opengauss:` / `jdbc:gaussdb:`）识别类型，不再报 `unsupported provider: generic`。
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

目录里的名字可能比左侧栏还长——光 GaussDB 就有 `global_plancache_status` 这类视图。过长的名字会截断并显示省略号，完整值放在悬停提示里；右边的类型药丸宽度不缩。面板窄到放不下两栏时，树会移到列清单上方，而不是把名字挤成两三个字。

树的下方没有开关：读取从不按模式限制。限制的是写入，而且就在数据源行上选择 —— 见 *[可写模式](safety.zh.md#可写模式)*。
