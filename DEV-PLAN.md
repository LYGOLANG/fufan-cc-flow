# Development Plan — Fufan-CC Flow

> 本文件记录项目的开发阶段划分、当前进度和剩余工作。
> 新 session 启动时应首先阅读此文件，了解项目状态后再继续开发。

当前进度：Phase 1、Phase 2 已于 2026-07-08 完成开发并通过编译与服务层冒烟测试。

---

## Phase 1: 项目初始化后端 API

**交付内容**：
- 实现项目初始化预检查接口，返回模板源缺失项、目标目录冲突项和可复制项。
- 实现项目初始化执行接口，只复制用户确认的 `.claude`、`.codex`、`.agents`、`AGENTS.md`。
- 保证目标目录路径安全，拒绝不存在、非目录或不可写目标。
- 保证冲突项默认不覆盖，覆盖目录时只替换同名文件，不删除目标目录额外文件。

**关键文件**：
- `server/src/services/projectInitService.ts` — 封装模板项检测、冲突预览、复制执行和路径校验。
- `server/src/routes/projects.ts` — 暴露 `/api/projects/init/preview` 与 `/api/projects/init`。
- `server/src/index.ts` — 注册项目管理路由。

**验收标准**：
- `POST /api/projects/init/preview` 能返回四个模板项的 `missing/conflict/ready` 状态。
- `POST /api/projects/init` 能按用户选择复制目标项，未选择项不复制。
- 目标目录不可写、模板源缺失、目标不是目录时返回明确错误。

---

## Phase 2: Project Picker 添加并初始化项目入口

**交付内容**：
- 在顶部 Project Picker 只保留 `+` 添加项目入口。
- 让 `+` 入口执行完整初始化流程：选择目录、预检查、复制缺失模板项、冲突逐项确认、切换项目。
- 复用现有目录浏览能力选择目标目录。
- 当目标目录存在冲突项时展示逐项确认弹窗，每项支持覆盖或跳过，默认跳过。
- 初始化成功后切换当前项目到目标目录，并刷新文件树、终端工作目录和会话上下文。

**关键文件**：
- `client/src/components/layout/ProjectTabs.tsx` — 增加新建项目入口与初始化弹窗。
- `client/src/services/api.ts` — 增加项目初始化 API 客户端方法和类型。
- `client/src/stores/uiStore.ts` — 复用或补齐当前项目切换状态。
- `client/src/stores/fileStore.ts` — 复用或触发文件树刷新。

**验收标准**：
- 用户能从 Project Picker 打开新建项目流程。
- 用户选择目标目录后能看到冲突项并逐项选择覆盖或跳过。
- 用户确认后能完成复制，并自动切换到新项目目录。
- 取消目录选择或确认弹窗不会改变当前项目。

---

## 技术栈

| 层级 | 技术 | 版本 | 说明 |
|------|------|------|------|
| 包管理 | pnpm workspace | 现有项目配置 | 保持现有 monorepo 工作流 |
| 前端 | React | 19.0.0 | 复用现有组件和 Zustand store |
| 前端构建 | Vite | 6.0.0 | 沿用现有开发与构建工具 |
| 后端 | Express | 5.0.1 | 复用现有 REST route 结构 |
| 文件系统 | Node.js `fs/promises` | Node 18+ 兼容 | 使用内置 `cp`/`stat`/`access`，不新增依赖 |
| 类型系统 | TypeScript | 5.7.0 | 保持 strict 类型约束 |

## 数据库表

| 表名 | 所属 Phase | 用途 |
|------|-----------|------|
| 无 | 无 | 本功能不引入数据库，状态来自文件系统和现有前端 store |

## 开发规则

- 每完成一个 Phase 执行四步走：Code Review → 测试完整性 → 编译验证 → 功能测试。
- 四步走全部通过后才能 commit。
- Commit message 用 feat、fix、refactor、chore 前缀。
- 包管理器：pnpm。
