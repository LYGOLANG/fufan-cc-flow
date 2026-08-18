---
name: plugin-prototype-gate
description: 设计阶段判定 UI Complexity Class 时 read；Class C 必须先做可运行低保真 Prototype 或关键交互 Spike，才允许进入完整开发。
---

[目的]
    Prototype 不是为了提前美化，而是用最少代码验证最可能让整个 Plugin 失败的交互、性能和宿主假设。

[Class A · 简单面板]
    特征：
    - 单一表单、列表、结果预览或配置器。
    - 对象少，状态关系简单。
    - 无复杂拖拽、空间坐标、时间轴、3D、媒体同步。
    - UI → Agent 触发点清晰。

    要求：
    - 可用静态线框、状态图或 Storybook 替代 runnable Spike。
    - 仍需走查空、Loading、Success、Error 和重开恢复。

[Class B · 多区工作台]
    特征：
    - 多个面板、对象、历史、筛选、局部编辑或多步骤工作流。
    - 存在拖拽 / 排序 / 选择，但不是专业级编辑器。
    - 有并发任务或较复杂状态同步。

    要求：
    - 至少做交互线框。
    - 命中高风险项时做局部 runnable Spike。
    - 验证关键对象模型、选择、保存和结果更新。

[Class C · 直接操作编辑器]
    命中任一即可：
    - 无限画布、节点图或复杂空间坐标。
    - 视频 / 音频时间线、多轨、波形、播放同步。
    - 3D / WebGL / 大量 Canvas 渲染。
    - 多选、框选、图层、对齐、快捷键、撤销栈等专业编辑器语法。
    - 大文件、代理媒体、缩略图或资源生命周期。
    - 自定义 iframe / embed / HTML 编辑。

    要求：
    - 必须 runnable Spike。
    - 只验证 1-3 个最高风险假设。
    - 必须记录环境、样本、步骤、结果、限制和 Design 决定。
    - 未通过不得标记 DESIGN_READY。

[风险评分]
    每个未知按 1-3 分：

    ```text
    Risk = Technical Uncertainty × User-flow Criticality × Cost of Late Discovery
    ```

    最高分优先进入 Spike。

[常见 Spike]
    - 画布：选择 / 框选 / 缩放 / 大图资源加载 / 状态序列化。
    - 时间线：拖动 Clip、播放头同步、缩放、波形或代理视频。
    - 3D：模型加载、交互帧率、宿主 sandbox / GPU 限制。
    - Host Bridge：UI 触发当前 Agent、Agent Tool 写回后 UI 刷新。
    - 大文件：不传 Base64，验证路径引用、缩略图或代理生成。
    - HTML embed：CSP、sandbox、资源注入、编辑与导出。

[Spike 产物]
    放在：

    ```text
    <plugin-name>/spikes/<spike-id>/
    evidence/design/<spike-id>/
    ```

    Evidence 至少包含：
    - README.md：假设、环境、样本、步骤、判定标准。
    - 可运行最小代码。
    - 日志 / 截图 / 性能记录。
    - Verdict：PASS / PASS_WITH_LIMIT / FAIL。
    - Design Impact：因此保留、修改或放弃什么。

[禁止]
    - 把 Spike 扩张成半个产品。
    - 只做视觉静态图却声称验证了交互或性能。
    - Spike 失败后把限制藏起来继续按原设计开发。
    - 直接把未经整理的 Spike 代码复制成生产架构。
