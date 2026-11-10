# dsh-db-mcp

[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![npm](https://img.shields.io/npm/v/dsh-db-mcp.svg)](https://www.npmjs.com/package/dsh-db-mcp)

[English](README.md) | 中文

一个 [DSH](https://github.com/deepseek-ai/deepseek-harness) 插件，把数据库交给智能体：侧栏多出一个**数据库**面板，登记过的每个数据源都会变成 `mcp__db__*` 工具。

**零配置。** 不需要改 DSH 里的任何文件，也不用手工抄一遍连接信息——直接把 DBeaver 里已有的连接导进来，然后开口问就行。

## 三个方面都不用配

- **不用改 DSH 文件。** bundle 的 patch 只插入一行 Loader 记录；插件自己用 stdio 拉起 Python MCP 服务，并把工具注册到 Host 的 `tools` 服务上——不需要 `dsh-mcp-client` 那一行，也不用编辑 JSON、导环境变量。
- **不用填数据源。** 导入器读取 DBeaver 工作区的 `data-sources.json`，再用 DBeaver 自带的密钥解密 `credentials-config.json`，主机、端口、库名、用户、已存口令一次到位。勾一个框就是全部配置工作。
- **不用准备 Python。** 面板会自己找解释器、建 venv、装四个驱动包，入口在 **运行时诊断 → 安装 / 修复依赖**。

## 运行

```sh
dsh plugin --profile desktop add dsh-db-mcp   # 桌面端
dsh plugin --profile web add dsh-db-mcp       # Web 端
```

`--profile` 指定装进哪个 profile（随 DSH 提供的是 `desktop` 与 `web`，其它名字首次使用时自动创建）。卸载用
`dsh plugin --profile desktop remove dsh-db-mcp`。

然后：

1. 侧栏 → **数据库**。
2. **从 DBeaver 导入** → 勾选连接 → **导入所选**。
3. 问智能体一句：*「我的 Chinook 库里有哪些表？」*

如果某条连接在 DBeaver 里没保存口令，卡片会显示**无密码**；打开该数据源补一次即可——口令只写进 `secrets.json`，不会再回到页面上。

想从零开始也行：**新建数据源**里粘一条连接串（`postgresql://user:pw@host:5432/db`、JDBC URL、Oracle TNS 描述符或 `.db` 路径），表单会自动填好。

## 智能体拿到的工具

| 工具 | 作用 |
| ---- | ---- |
| `mcp__db__list_datasources` | 已登记的数据源：id、类型、目标、是否只读 |
| `mcp__db__list_tables` | 某个源里的表与视图 |
| `mcp__db__describe_table` | 列、类型、可空、主键 |
| `mcp__db__sample_rows` | 取几行样本 |
| `mcp__db__execute_sql` | 执行一条语句——查询，或在允许写入时执行写入 |
| `mcp__db__explain_query` | 执行计划 |
| `mcp__db__get_ddl` | `CREATE TABLE` 语句 |
| `mcp__db__test_connection` | 真实登录 + `select 1`，回报服务器/用户/schema |
| `mcp__db__session_scope` | 把本会话限制在部分数据源，或解除限制 |

`datasource` 在所有工具里都是可选的，省略时回落到标着 `isDefault` 的那条（没有就取注册表里的第一条）。查询发生在**对话里**，面板只负责管理连接，不是 SQL 控制台。

## 安全

- **默认只读**，两道互相独立的闸门：全局写开关 + 单源标记，两者都打开才允许写入。
- **口令不出本机。** 存在 `secrets.json`（`0600`）；任何 HTTP 接口都不返回它，Python 子进程拿到的也只是很短的环境变量白名单，而不是整个 DSH 环境。
- **每次工具调用都有审计**，写入 `logs/audit.jsonl`——工具、数据源、耗时、行数、SQL；结果行永不记录。
- **面板不会执行 SQL。** 结构浏览只转发 `list_tables` 与 `describe_table`。

## 文档

| 文档 | 内容 |
| ---- | ---- |
| [docs/guide.zh.md](docs/guide.zh.md) | 面板操作、连接串、分组、Docker 测试库、排错（中文） |
| [docs/reference.md](docs/reference.md) | HTTP 接口、工具契约、注册表与设置文件、插件配置（英文） |
| [docs/development.md](docs/development.md) | 目录结构、热重载、测试套件、发布流程（英文） |
| [docs/design-notes.md](docs/design-notes.md) | 设计日志（P1 → P7）与决策记录（英文） |

## 许可

Apache License 2.0 —— 见 [LICENSE](LICENSE)。
