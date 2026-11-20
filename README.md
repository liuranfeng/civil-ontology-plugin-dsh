# 民事法律关系本体 · civil-ontology-dsh

一个 DSH 插件（bundle），把民事法律关系本体、82 项已确认审查方法、合同审查／法律咨询／类案检索三条办理路径，以及按周确认回写的会话记忆闭环，装进同一个包。

## 用法

安装后无需额外操作：

1. **自动启用**：提出合同审查、法律咨询、类案检索或民事法律研究问题时，模型先用 `civil_open_case` 登记事实与材料，同一份本体贯穿三个任务；`civil_task_tool` 只列出本案可用的专用工具。
2. **命令入口**：在会话输入框键入 `/`，可用

   | 命令 | 作用 |
   |---|---|
   | `/civil` | 查看本体台账、四类增量计数、周报时间与本会话案件 |
   | `/civil-week 18:30` | 把周报改到指定时间；`/civil-week off` 关闭 |
   | `/civil-digest` | 立即汇总本期待确认增量 |
   | `/civil-apply all` | 确认并把增量写回本体（也可只给条目编号） |
   | `/civil-drop m-xxxxxxxx` | 本次不采纳 |
   | `/civil-confirm` / `/procurement-confirm` | 沿用原跨案经验确认与采购候选发布流程 |
   | `/civil-market` | 查看插件市场索引地址，并把本机索引源加回市场 |

3. **记忆闭环**：会话中的用户原话自动记为「待归类」；办理过程中模型用 `civil_memory_note` 把 **事实／成果／技能／取舍** 连同原句记入台账。每周五 18:00（可用 `/civil-week` 改），插件在那次会话里推送一期周报：分四类列出编号与摘要，用户确认后写回本体，同一场景、立场、时点、业务类型的新案开案时自动带出。台账、周报与本体记录都保存在 `~/.dsh/civil-contract-review/`。

## 数据位置

| 内容 | 路径 |
|---|---|
| 会话台账 | `~/.dsh/civil-contract-review/memory/ledger.json` |
| 周报存档 | `~/.dsh/civil-contract-review/memory/digests/*.md` |
| 周报时间设置 | `~/.dsh/civil-contract-review/memory/weekly.json` |
| 写回本体的经验 | `~/.dsh/civil-contract-review/catalog-review/*.json` |
| 案件与审查意见 | `~/.dsh/civil-contract-review/cases/`、`reports/` |

## 插件市场

包内自带格式 1 的市场索引，通过本机 Web 服务提供：`http://127.0.0.1:<端口>/civil-ontology/market/index.json`（`/civil-market` 会打印实际地址并加入索引源）。插件市场「发现」页按该索引显示标题、说明、图标与本机安装状态。

公开分发需要把包发布到 npm（`npm publish`，需账号令牌）或上架到公开 git 仓库；索引条目里的 `source` 目前是 npm，未发布前在市场里安装会失败，本机已安装的版本会显示为已安装。

## 开发

```bash
node --test          # 全部测试
node memory.test.mjs # 记忆闭环单测
```

`civil/` 存放本体关系、民法典条文、方法快照与审批回执；`skills/` 是注入模型的办理说明；`word/` 的第三方来源与许可见 `word/NOTICE.md`。
