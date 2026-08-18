---
name: ink-on-paper-kit
description: 选定纸墨风格后，设计阶段选型 UI、开发阶段写前端、检查阶段核对视觉一致性时 read；按这里的三支墨纪律与组件复用，不发明平行组件，不违反蓝黑墨配给。
---

[定位]
    Kit 名称：纸墨 INKSET（Ink on Paper）。一张纸、三支墨、发丝线。
    风格库入口见 `../kits.md`；本包在 plugin.yaml 的 ui.kit = ink-on-paper 时启用。
    五件套：tokens.css（--ip-* 变量）、components.css（组件类）、components.js（行为）、demo.html（全组件样张 + 十二类场景 + 八状态）、本文件。
    语法源流：明度即层级、实心不发光、家具撑密度、快进快停不弹跳。

[三支墨纪律]
    - 黑墨 = 常规：正文、主按钮、选中态、实心填充，界面 95% 的墨。
    - 蓝黑墨 = Agent 专属：只标注 AI 写的、AI 正在动的；人类操作的任何地方不许出现蓝。
    - 校对红 = 破坏与错误：删除、冲突、校验失败；不做强调色，不做品牌色。
    - Agent 三条硬规则：蓝墨只出现在 Agent 产出 / 进度 / 可撤销范围上；Agent 删除用校对红删除线，删除永远归红笔管；人一旦接手编辑，蓝立刻退成黑。
    - 除此之外没有颜色：重要性走墨梯，类别走形状（实心 / 空心 / 虚线 / 斜纹），色盲与黑白打印下语义不丢。

[铁律]
    - 只有一张纸和三支墨；结构靠发丝线不靠阴影；数值与视觉严格成正比（68% 就画 68%，断轴即毁约）。
    - 卡片无边框无阴影；线是留白不足的补丁，不是默认装饰；墨卡整屏最多一张。
    - 悬停不许位移；动效 quarticOut 快进快停，入场 220ms 内结束。
    - 演示数据用确定性伪随机，禁止 Math.random。

[token 速查]
    纸：--ip-desk / --ip-paper / --ip-paper-hi / --ip-well
    墨梯八级：--ip-ink 与 --ip-ink-1..7（ink-5 仅禁用占位，ink-6/7 仅非文字）
    线：--ip-rule / --ip-rule-soft / --ip-rule-ink
    三支墨：--ip-blue / --ip-blue-soft（Agent）、--ip-red / --ip-red-soft（破坏与错误）
    排印：--ip-font / --ip-mono；几何：--ip-r-card 20 / --ip-r-box 10 / --ip-r-ctl 7 / --ip-r-pill 999 / --ip-hair
    动效：--ip-ease / --ip-fast .12s / --ip-base .22s / --ip-slow .42s；遮罩：--ip-scrim
    双主题：html data-theme = paper（默认亮）/ carbon（夜纸，整梯反转语义不变）

[组件清单]
    排印：ink-display / ink-h1..h3 / ink-body / ink-lede / ink-note / ink-label（--ink）/ ink-src / ink-num（跳动数字必用）/ ink-figure / ink-code / ink-kbd / ink-quiet / ink-strike
    线与家具：ink-rule（--ink / --dash / --v）/ ink-ledger / ink-graph / ink-dotgrid / ink-ticks / ink-leader
    容器：ink-card（--ruled / --ink）/ ink-panel / ink-well / ink-head / ink-toolbar（--flush）/ ink-group / ink-stack / ink-row / ink-spread
    控件：ink-btn（--solid / --quiet / --danger / --sm / --lg / --icon，五态）/ ink-seg / ink-field（is-bad / --num）/ ink-scrub / ink-switch / ink-check（--radio）/ ink-range / ink-formrow
    标记与导航：ink-badge（--solid / --dash / --red / --blue）/ ink-chip / ink-dot（--done 实心 / --idle 空心 / --warn 斜纹 / --bad 红 / --run 蓝呼吸）/ ink-tabs / ink-crumb / ink-tree / ink-list / ink-menu / ink-table（.n / .rownum）/ ink-cell-edit
    反馈与浮层：ink-bar（--blue / --red / --indet）/ ink-meter / ink-skel / ink-tip（--note）/ ink-toast（--ink）/ ink-scrim + ink-modal / ink-note-block（--red / --blue）
    Agent：ink-agent（蓝墨内环）/ ink-agent-tag / ink-agent-run（沿纸边扫动）/ ink-agent-caret / ink-agent-diff
    场景原语：ink-canvas / ink-ruler / ink-track / ink-clip（--ghost / --hatch）/ ink-playhead（时间线）；ink-wave / ink-selection（音频）；ink-node（data-state = agent / bad）/ ink-port（工作流与节点编辑）；ink-plate / ink-bbox（--red / --dash）/ ink-handle（故事板 / PPT / 标注审核）；ink-thumb / ink-drop / ink-slot / ink-resizer（素材轨 / 表单设计器 / 分栏）
    组合配方（无专属类的场景）：3D 视口 = ink-graph 地面 + 内联 SVG 线框 + ink-scrub + ink-tree；仪表盘 = ink-figure + 发丝折线 / 点阵华夫 / 刻度条；数据库 = ink-tree + ink-table + ink-cell-edit + ink-well；Prompt 调试 = ink-well 等宽 + ink-strike 红删 + ink-agent-diff 蓝增
    行为：inkTheme() 切 paper / carbon、inkToast()、inkModal.open / close；demo 内另示范 seg / tabs / tree / scrub / range 的 aria 交互模式

[八种界面状态]
    空 / Loading / Agent 工作中 / 成功 / 错误 / 冲突 / 离线 / 权限被拒——demo.html 状态矩阵全部用既有组件拼成，照抄结构即可。

[使用规则]
    - Design 阶段：Visual 章节以本 Kit 为基线，只登记偏离项，不从零描述视觉。
    - Builder 阶段：优先复用组件类；Kit 没有的组件按迁移三步先补进 Kit 再用——拆纸 / 墨 / 尺三层，用明度和形状替换颜色，删掉阴影与位移。
    - 生成的插件不引外网字体：--ip-font 自带 system-ui 与中文回退，直接用回退栈；demo.html 里的 Google Fonts 链接仅供样张预览。
    - Checker 阶段：对照 demo.html 与三支墨纪律检查；偏离必须能在 Plugin-Design.md 找到登记。
