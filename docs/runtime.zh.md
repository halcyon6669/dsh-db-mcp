[English](runtime.md) | 中文

# 运行时

文件放在哪、Python 那一半怎么装，以及出问题的时候先看哪里。

## 运行时目录

```
$DSH_HOME/db-mcp/
  datasources.json   # 数据源与分组，从不含口令，0600
  secrets.json       # 每个数据源的口令信封，0600，仅 Host 可读
  secret.key         # 这些信封的密钥，0600，首次使用时生成
  settings.json      # 全局写开关 + 审计开关，0600
  sessions.json      # 按会话的数据源限制，0600
  logs/mcp.log       # 脱敏日志
  logs/audit.jsonl   # 每次 MCP 工具调用一行，512 KiB 轮转
  .venv/             # 插件内 venv：mcp、psycopg、py-opengauss、PyMySQL、oracledb、cryptography
```

### 手工安装 Python 依赖

*运行时诊断* 卡片里的 **安装 / 修复依赖** 按钮执行的就是下面两步。如果 Host
访问不了包索引（比如代理只配在了你自己的终端里），或者你想看完整的 `pip`
输出而不是最后几行，就自己跑这两条命令。

```bat
REM cmd.exe —— venv 只需建一次，之后重复执行 pip 安装
python -m venv %USERPROFILE%\.dsh\db-mcp\.venv
%USERPROFILE%\.dsh\db-mcp\.venv\Scripts\python.exe -m pip install --disable-pip-version-check -r %USERPROFILE%\.dsh\profiles\desktop\node_modules\dsh-db-mcp\server\requirements.txt
```

```powershell
# PowerShell —— 同样两步
python -m venv "$env:USERPROFILE\.dsh\db-mcp\.venv"
& "$env:USERPROFILE\.dsh\db-mcp\.venv\Scripts\python.exe" -m pip install --disable-pip-version-check -r "$env:USERPROFILE\.dsh\profiles\desktop\node_modules\dsh-db-mcp\server\requirements.txt"
```

第一行每台机器只需要跑一次；升级之后值得重跑的是 `pip install` 那行。装在
`web` profile 下就把路径里的 `desktop` 换成 `web`。如果你是用
`dsh plugin add <源码目录>` 链接的开发版本，包目录就是那个源码目录，把 `-r`
指向 `<源码目录>\server\requirements.txt` 即可 —— venv 仍然在
`$DSH_HOME\db-mcp` 下。

装完在同一张卡片点 **重启 MCP**（按钮会自动重启），依赖行应显示六个版本号、
没有 `missing`。

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
