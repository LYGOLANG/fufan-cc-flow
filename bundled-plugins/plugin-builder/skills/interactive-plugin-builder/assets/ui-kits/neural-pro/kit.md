---
name: neural-pro-kit
description: 设计阶段选型 UI、开发阶段写前端、检查阶段核对视觉一致性时 read；按这里的 token 与组件复用，不发明平行组件，不违反极光配给纪律。
---

[定位]
    Kit 名称：Neural Pro。细字、深空、一线极光。
    风格库入口见 `../kits.md`；本包在 plugin.yaml 的 ui.kit = neural-pro 时启用。
    本目录是该风格下插件前端的视觉单一真相源：tokens.css（变量）、components.css（组件类）、components.js（行为）、demo.html（全组件样张）。
    scaffold 自动把三个代码文件复制进生成插件的 ui/kit/；demo.html 是人和 Agent 的对照基准。

[核心纪律]
    - 中性为体：按钮、卡片、文字全部无彩色；主按钮是 ink 反色（黑白高对比）。
    - 极光唯一：青→蓝→玫瑰渐变（--pk-aurora）只属于 Agent——状态光带、进度条、选中光环、连线能量。禁止用在按钮、背景、标题上。
    - 语义色只做状态：ok / warn / bad / info 四色徽标与文字，不参与装饰。
    - 细字显层级：展示层字重 200，强调 550，正文 400；不用 700 粗黑标题。
    - 发丝线分层：深度靠 --pk-line 边框与表面亮度阶梯；阴影只给卡片和浮层。
    - 悬停不位移：专业工具元素密集，hover 只改明度、边线与背景，不做 transform 抬升。
    - 状态语义优先靠形状：实心 / 空心 / 虚线 / 斜纹先行，颜色只是冗余通道。
    - 双主题同名变量：html 标签 data-theme 切换；暗色是画布/剪辑/节点/仪表盘默认，亮色是展板/审核台默认。

[token 速查]
    表面：--pk-canvas / --pk-panel / --pk-card / --pk-inset
    线条：--pk-line / --pk-line-strong / --pk-line-soft（网格与点阵底纹）
    文字：--pk-ink / --pk-ink-2 / --pk-ink-3 / --pk-on-ink / --pk-on-au（极光面上的深色字）
    语义：--pk-ok / --pk-warn / --pk-bad / --pk-info
    极光：--pk-au-a / --pk-au-b / --pk-au-c / --pk-aurora / --pk-halo / --pk-glow
    几何：--pk-r-ctl 9px / --pk-r-card 14px / --pk-r-panel 18px
    字体：--pk-font（系统栈含中文回退）/ --pk-mono（数据、ID、时间码）
    动效：--pk-dur-fast 150ms / --pk-dur-base 200ms / --pk-dur-panel 300ms
    阴影：--pk-shadow（卡片）/ --pk-shadow-float（浮层）

[组件清单]
    排印：pk-display（细字大标题）/ pk-title / pk-label（全大写宽字距）/ pk-muted / pk-mono / pk-note（12.5px 注记）/ pk-num（tabular-nums 等宽数位）/ pk-figure（仪表盘大数值，字重 200）/ pk-code（内联代码，inset 底）/ pk-strike（删除线，bad 色——删除语义归 bad 管）
    家具：pk-grid（网格底纹）/ pk-dotgrid（点阵底纹）/ pk-ticks（刻度导轨，5n+1 大刻度）/ pk-leader（旁注虚线引线）/ pk-divider + --v 竖线 / --dash 虚线
    按钮：pk-btn + --primary / --outline / --quiet / --danger / --sm / --lg / --icon，含 hover、active、focus-visible、disabled
    表单：pk-field（输入与下拉，is-bad 校验失败）/ pk-switch / pk-seg（分段控件，aria-selected 浮起）/ pk-scrub（可拖拽标签数值框，标签 ew-resize）/ pk-check + --radio（checked / focus / disabled）/ pk-range（滑杆）/ pk-formrow（96px 标签 + 值的字段行）
    状态：pk-pill + --ok / --warn / --bad / --info / --line；pk-chip（筛选，data-pk-toggle）；pk-dot + --done 实心 / --idle 空心 / --warn 斜纹 / --bad 红 / --run 极光呼吸（run 是 Agent 态）
    容器：pk-card / pk-panel / pk-toolbar / pk-head（卡片头：标题行 + 底线）/ pk-group（按钮拼组，内部发丝分隔）/ pk-well（凹槽块，inset 底）/ pk-stack / pk-row / pk-spread（纵排 / 横排 / 两端对齐）/ pk-divider
    数据：pk-prop（属性行）/ pk-table（32px 行高）/ pk-cell-edit（单元格编辑环）/ pk-kbd
    导航：pk-tabs / pk-tab（data-pk-tab 切换）/ pk-crumb（面包屑）/ pk-tree（层级树，aria-selected）/ pk-list（发丝分隔列表）/ pk-menu（下拉菜单，含 kbd 与危险项）
    浮层：pk-tooltip（data-tip）/ pk-modal-backdrop + pk-modal / pk-toast
    反馈：pk-empty / pk-skeleton / pk-progress（Agent 进度，+ --indet 不确定扫动）/ pk-meter（可数格量表，一格 5%）/ pk-note-block + --bad 错误 / --agent 极光边 / pk-glowbar（Agent 状态条）/ pk-selected（Agent 选中光环）
    Agent：pk-agent（极光内环容器）/ pk-agent-tag（AGENT 徽标）/ pk-agent-run（极光沿边扫动）/ pk-agent-caret（逐字闪烁光标）/ pk-agent-diff（极光底线 + 淡光底）
    场景原语：pk-canvas（画布外框）/ pk-ruler（标尺）/ pk-track（轨道行，奇偶提亮）/ pk-clip + --ghost 空心 / --hatch 斜纹（aria-selected 双环）/ pk-playhead（播放头）/ pk-wave（波形条，i.sel 选中）/ pk-selection（选区罩）/ pk-node（参数节点卡，data-state agent 极光 / bad 红）/ pk-port（端口）/ pk-plate（视口底板）/ pk-bbox + --bad / --dash（角标签）/ pk-handle（角把手）/ pk-thumb(aria-selected) / pk-drop（拖放导轨）/ pk-slot（虚线空槽）/ pk-resizer（分栏把手）
    行为：pkTheme() 切主题 / pkToast() / pkModal.open、close() / pkRand(i, k) 确定性伪随机 / seg·tree·thumb 选中与 scrub 拖拽已内建委托

[场景组合配方]
    3D 视口 = pk-grid + 内联 SVG + pk-scrub + pk-tree
    仪表盘 = pk-figure + pk-num + 发丝折线 + pk-meter
    数据库 = pk-tree + pk-table + pk-cell-edit + pk-well
    Prompt 调试 = pk-well 等宽 + pk-strike 删 + pk-agent-diff 增

[使用规则]
    - Design 阶段：Visual 章节以本 Kit 为基线，只登记偏离项，不从零描述视觉。
    - Builder 阶段：优先复用组件类；Kit 没有的组件先补进 Kit 再用，不写平行样式。
    - Checker 阶段：对照 demo.html 与本纪律检查；偏离必须能在 Plugin-Design.md 找到登记。
    - 载体红线：无 CDN、无外部字体；大面积禁 backdrop-filter；动画只用 transform / opacity。
