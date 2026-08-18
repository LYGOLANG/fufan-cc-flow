---
name: plugin-threat-model
description: 设计阶段写 Threat Model、检查阶段执行安全 negative test 时 read；按这里的资产与攻击面清单逐项建模。
---

[原则]
    安全不是 Checker 最后补的一栏。每个能力在 Design 阶段先写资产、攻击面、边界、缓解和验证。

[Threat Table 字段]

    ```text
    THR ID
    Asset
    Entry Point
    Threat
    Impact
    Mitigation
    Verification
    Related SEC / DATA / HOST ID
    ```

[文件系统]
    检查：
    - `../` 与绝对路径穿越。
    - symlink 把项目内路径指向项目外。
    - TOCTOU：校验后文件被替换。
    - 文件名注入、保留名和跨平台路径。
    - 覆盖、删除、递归删除和临时文件泄露。
    - 大文件 / 压缩炸弹 / 恶意媒体。

    缓解：
    - resolve 后做真实父目录边界检查。
    - 对 symlink 使用 lstat / realpath 策略。
    - 白名单扩展名、MIME 与最大体积。
    - 原子写、唯一文件名、备份或显式确认。
    - Plugin 安装目录只读，用户状态写项目目录或批准目录。

[命令执行]
    检查：
    - shell injection。
    - 参数拼接、环境变量和工作目录污染。
    - 任意命令 Tool。
    - 继承过多权限。

    缓解：
    - exec argv，不拼 shell 字符串。
    - 命令与参数白名单。
    - 固定 cwd、最小 env、timeout、输出上限。
    - 高风险命令明确确认。

[网络与 SSRF]
    检查：
    - 任意 URL、localhost / metadata service、内网扫描。
    - redirect 绕过域名白名单。
    - 上传敏感项目文件。
    - 下载恶意内容。

    缓解：
    - 明确域名和协议白名单。
    - 每次 redirect 重新校验。
    - 禁止 file://、非必要私网 / loopback；Chrome 142+ / Edge 143+ 的 Local Network Access 把 file:// 页面与 LAN 页面回连 127.0.0.1 视为需授权的 local→loopback 请求，loopback→loopback 豁免。
    - 请求大小、响应大小、超时、内容类型限制。
    - UI CSP 与服务端网络规则都要有。

[Secret]
    检查：
    - 写入仓库、前端 bundle、日志、Tool output。
    - 传给不相关域名或 Agent context。

    缓解：
    - 使用宿主 / 环境安全配置。
    - 服务端读取，UI 只知道配置状态。
    - 日志与错误脱敏。
    - 最小权限和轮换说明。

[UI、iframe 与 postMessage]
    检查：
    - 未验证 message source / origin。
    - 任意 Tool Call bridge 暴露。
    - iframe sandbox 过宽。
    - 外部脚本、frame、资源域名无限制。
    - Clickjacking、焦点劫持和跨 frame 数据泄露。

    缓解：
    - 使用宿主提供的标准 Bridge，不自造无认证全局接口。
    - 最小 CSP、sandbox 和 capability 检测。
    - 消息 Schema、source、instance / request ID 验证。
    - App-only Tool 仍做服务端参数和权限校验。

[HTML 与内容注入]
    检查：
    - 用户 / Agent 生成 HTML 中的 script、event handler、URL、CSS exfiltration。
    - Markdown / SVG / data URL 注入。
    - srcDoc 与 same-origin 组合风险。

    缓解：
    - 默认纯文本或安全 renderer。
    - 必须执行 HTML 时使用独立 sandbox、资源重写和明确白名单。
    - 不把任意生成 HTML 置于拥有宿主 Bridge 的同一权限层。

[状态与并发]
    检查：
    - 旧 Agent 结果覆盖用户新修改。
    - 重复点击产生重复收费、文件或副作用。
    - 部分写入导致工程损坏。
    - 任务重连后重复应用。

    缓解：
    - requestId、projectVersion、expectedVersion。
    - 幂等表 / request log。
    - 原子事务或临时文件 rename。
    - stale result 进入待确认，不自动覆盖。

[日志与隐私]
    检查：
    - Prompt、文件内容、路径、Secret 和个人数据进入日志。
    - 日志无限增长。

    缓解：
    - 结构化、分级、脱敏和保留期限。
    - 默认只记录 ID、状态、耗时和安全错误摘要。
    - 用户可清理。

[供应链与更新]
    检查：
    - 首次运行自动 npm install 未锁版本。
    - 远程脚本与 postinstall。
    - Plugin 更新导致旧状态不兼容。

    缓解：
    - lockfile、clean build、依赖审计、最小依赖。
    - 发布前预构建，不依赖最终用户现场构建（除明确开发模式）。
    - schemaVersion、迁移、备份、回滚和卸载清理。

[Design Gate]
    以下命中即必须有 THR：
    - project 外文件访问
    - 网络或外部 API
    - Secret
    - 任意用户 / Agent 生成 HTML
    - 命令执行
    - 删除 / 覆盖 / 发布
    - 大文件 / 媒体解析
    - iframe / postMessage / Bridge
    - 长任务和并发写回
