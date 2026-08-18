---
name: ui-kits-index
description: 设计阶段做界面风格选型时先 read；列出全部预制风格包与选型规则，选定后再 read 对应风格包的 kit.md。
---

[选型规则]
    - 界面风格是 User Decision：每套风格给一句气质定位和 demo.html 样张，结合同类产品调研给默认推荐，用户可否决。
    - 选定结果写入 plugin.yaml 的 ui.kit，并登记进 Plugin-Design.md 的 Decision Register。
    - 库里只有一套风格时不问，直接采用。
    - 每套风格包固定五件套：tokens.css / components.css / components.js / demo.html / kit.md；scaffold 按 ui.kit 把前三个复制进生成插件的 ui/kit/。
    - 共同纪律（任何风格必须满足）：明暗双主题、正文 AA 对比度、Agent 活动有专属视觉语言且不外借给普通组件、八种界面状态齐全。
    - mcp-app 的 widget 同样用所选风格包：token 与组件样式内联进单文件 `ui://` Resource，不引外链（宿主 iframe 默认 deny-by-default CSP）；明暗主题跟随宿主信号。

[风格清单]
    - neural-pro「极光」：细字、深空灰、发丝线分层；唯一彩色是青→蓝→玫瑰极光，只属于 Agent。适合暗色工作台与工具感界面。
    - ink-on-paper「纸墨」：一张纸三支墨，明度即层级、实心不发光、结构靠发丝线；蓝黑墨专属 Agent，校对红只做破坏与错误。适合亮色案头工具、文档感与标注审核类界面，自带十二类专业场景原语（波形 / 3D / 仪表盘 / 表单 / 工作流 / 数据库 / PPT / 节点 / 故事板 / Prompt 调试 / 标注）。
