# 变更记录

## [v1.10] - 2026-07-09
### 新增
- F1.15 外部拖入路径识别：从资源管理器拖文件/文件夹进窗口自动插入绝对路径（Tauri onDragDropEvent）；浏览器模式回退为附件上传。

---

## [v1.9] - 2026-07-09
### 新增
- F1.14 桌面应用自动升级：tauri-plugin-updater 签名更新，设置页「应用更新」面板一键检查/下载/重启；发布脚本 scripts/release-update.mjs。
### 修复
- F1.1 输入框：修复中文输入法无法输入——Enter 缺少 IME 组词防护（isComposing），打拼音选词的回车被误当发送。

---

## [v1.8] - 2026-07-09
### 修复
- F3.2 后台任务管理：修复「workflow 正在执行但 GUI 看不到」——SDK 的 task_started / task_notification / background_tasks_changed 消息此前在 dispatch 被静默丢弃，现经 background_task_event 接入「工作流」运行中区块、「后台任务」状态同步与「审计」时间线。

---

## [v1.7] - 2026-07-09
### 新增（SDK 能力补齐，源自 SDK vs CLI 差异分析）
- F1.10 模型自动降级：官方端点任务失败自动降级备用模型（opus→sonnet→haiku）。
- F1.11 扩展思考预算：自适应/8K/16K/32K 档位，经 SDK `thinking.budgetTokens` 注入。
- F1.12 MCP 配置即时生效：MCP 面板改动纳入进程指纹，下一轮自动换进程生效。
- F1.13 Hooks 审计时间线：SDK 进程内 hooks 只读订阅生命周期事件，Agent 面板新增「审计」标签页。

---

## [v1.6] - 2026-07-09
### 新增
- F1.8 Plan Mode 计划审核卡片：`ExitPlanMode` 特殊渲染为计划审核卡片（Markdown 计划正文 + 批准/驳回），复用 HIL 通道。
- F1.9 Codex 图片输入：图片附件通过 `codex exec --image` 原生传入，支持多模态视觉（Spark 纯文本模型自动回退）。
### 说明
- 调研核对后确认 Skills 面板、Workflow 管理、Hooks/Plugin/Marketplace 面板已存在于现有实现，无需重复开发；Computer Use 因 CLI 侧仅支持 macOS 暂缓；Artifacts viewer 与 Workflow 运行进度树列入后续迭代。

---

## [v1.5] - 2026-07-09
### 新增
- F1.7 任务退出保护与中断提醒：关闭程序时优雅停止运行中任务并落盘记录，重启后横幅提醒上次被中止的任务。
### 修改
- F1.6 模型切换：官方模型列表过滤不可用旧代模型；所有模型标注真实上下文窗口；ContextBar 按所选模型真实窗口计算；Codex 推理力度补 `minimal` 档（与 Codex CLI 五档对齐）。

---

## [v1.4] - 2026-07-08
### 修改
- 简化顶部 Project Picker：移除独立的“打开已有项目”按钮，只保留 `+` 添加项目入口，并由该入口统一执行项目初始化。

---

## [v1.3] - 2026-07-08
### 修改
- 调整顶部 Project Picker 入口语义：**添加项目** 和 **打开已有项目** 均执行项目初始化，确保选择已有目录时也会复制缺失模板项。

---

## [v1.2] - 2026-07-08
### 修改
- 调整顶部 Project Picker 入口语义：**添加项目** 默认执行项目初始化并复制模板，另保留 **打开已有项目** 入口用于只切换项目。

---

## [v1.1] - 2026-07-08
### 新增
- 新增顶部 Project Picker 的“新建项目初始化”需求：用户选择目标目录后，系统从 `fufan-cc-flow` 根目录复制 `.claude`、`.codex`、`.agents`、`AGENTS.md`。
- 新增冲突逐项确认规则：目标目录已有同名项时，弹窗逐项选择覆盖或跳过，默认跳过。
- 新增项目初始化 API 规划：`POST /api/projects/init/preview` 用于预检查，`POST /api/projects/init` 用于执行复制。

### 修改
- 调整后续计划中的“多项目快速切换”，补充其包含顶部 Project Picker 的新建项目初始化能力。

---

## [v1.0] - 2026-03
- 初始版本需求文档 `REQUIREMENTS.md`。
