---
name: chatcut-annotate
description: 当用户要在视频画面上做标注、圈一下某个按钮、加箭头或高亮框、把某处放大强调、给操作步骤加说明卡片时使用。把标注定义编译成 HyperFrames 透明层并合成到画面上。
---

[任务]
    把用户想强调的画面区域变成成片上的标注，并保证它出现在正确的时刻和正确的位置。

[启动检查]
    1. **先 `request_claim`**。用户在工作台点「生成标注层」时请求进的是 `.chatcut/requests/queue.json`，
        **不会**自动变成一次 Tool 调用；不认领就动手，界面上那次点击永远等不到回音，
        请求会一直挂在 pending / claimed 直到租约到期。
        认领拿到的 requestId **原样传给后续每一个 Tool**（`annotation_render` 的 requestId 参数），
        写回时队列条目才自动结单。做不成就 `request_resolve`（failed）或退回（released），不许让它烂在那儿。
        队列是空的它会明说，那就照常处理用户当前的对话请求。
    2. 调用 `dependency_check`，确认 blockedFeatures 里没有 feature:annotation。
        缺 HyperFrames 时不要硬着头皮往下走，也不要只丢一句"不可用"——
        `fetchActions` 里已经带着可以照抄的补齐动作：
        a. 先 `dependency_fetch({"id":"hyperframes"})` 出单子（不下载、不落盘），
           把「约 369 MB、来自 registry.npmjs.org、装到 ${CLAUDE_PLUGIN_DATA}、
           不补只影响标注层渲染」念给用户；
        b. 用户同意后 `dependency_fetch({"id":"hyperframes","confirm":true})`，
           立即拿到 jobId，用 `job_status` 报进度，别在那里干等；
        c. 装完**再调一次 `dependency_check` 复核** feature:annotation 已经消掉，再开始渲染。
        另外提醒用户：首次渲染时 hyperframes 还会自行拉取 chrome-headless-shell 约 272 MB。
    3. 确认工程里有片段。没有画面就无从标注。

[执行]
    1. 用户在界面上框选时，调用 `get_current_selection` 拿到稳定 ID 与归一化坐标。
        用户在对话里说「圈一下那个保存按钮」时，先问清是哪一段的第几秒——
        坐标必须来自用户框选，不要自己猜像素位置。
    2. 调用 `annotation_define` 写入标注定义：归一化 bbox、样式、文案、起止时刻。
        四种样式：highlight-rect 矩形高亮、arrow 箭头指向、zoom-focus 放大聚焦、callout-card 要点卡片。
    3. 调用 `annotation_render` 渲染透明层，**带上启动检查里认领来的 requestId**。
        这是长任务，用 `job_status` 汇报阶段与计数。
        未改动的标注会命中缓存直接跳过，不要为了保险而全量重渲。
    4. 汇报：渲了几条、复用了几条、耗时多少。

[坐标与时间的纪律]
    - bbox 存归一化值，与渲染分辨率解耦。换输出规格不需要重画。
    - 标注挂在片段上时随片段移动；时间轴按配音时长重排后，标注的时刻会跟着变。
    - 时间区间是半开的：声明 2 到 3 秒，成片上就是第 2.000 秒到第 2.967 秒共 30 帧。

[性能边界]
    单条标注约 9 秒固定开销，并行 6 路。首版软上限 30 条，实测冷渲染约 2 分钟。
    远超 30 条时耗时近似线性增长，事先告诉用户，不要让他等着才发现。
    zoom-focus 需要压暗框外整幅画面，按全屏渲染，成本高于其他三种样式。

[完成标准]
    - 标注出现在正确时刻，位置与用户框选的偏差在画面宽度 1% 以内。
    - 非标注时段画面上没有残留。
    - 渲染结论有像素级判据支撑，不是只看命令有没有报错。

[禁止]
    - 不 `request_claim` 就直接执行界面提交的标注渲染，或调 `annotation_render` 时丢掉 requestId。
    - 凭截图猜坐标替用户下框。模型看图定位小目标不可靠，位置必须来自框选。
    - 用命令退出码判断渲染成功。透明通道被丢弃时 ffmpeg 照样返回 0，画面却糊上一块黑板。
    - 某条标注渲染失败就跳过它、产出一个少了标注的成片。
