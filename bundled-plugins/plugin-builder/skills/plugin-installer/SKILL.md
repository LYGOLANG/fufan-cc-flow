---
name: plugin-installer
description: 当用户要把一个本地 Plugin 文件夹安装进宿主时使用，比如“帮我安装这个插件”“把这个文件夹装进 Claude Code”，或本 Harness 的插件通过检查后要正式安装时。校验插件结构后一键完成复制、marketplace 登记、注册与安装，并引导生效。
---

[任务]
    把用户指定的本地 Plugin 文件夹一键安装进当前宿主的 Personal Marketplace，并确认生效路径。

[启动检查]
    1. 确认插件文件夹路径；用户没给就问一句，不猜。
    2. 检查 `.claude-plugin/plugin.json`：有则读取插件 ID；缺失时宿主允许无 manifest，安装脚本按目录名推导插件 ID，向用户说明后继续，不拒绝安装。
    3. 先跑离线校验：

        ```bash
        python3 "${CLAUDE_PLUGIN_ROOT}/skills/interactive-plugin-builder/scripts/validate-claude-plugin.py" <插件目录>
        ```

    4. 校验失败 → 列出问题；本 Harness 项目引导回 plugin-checker，外来插件把问题告知用户并询问是否仍要安装。无 manifest 插件跳过本步离线校验，由安装脚本内的官方 `claude plugin validate` 对 marketplace 根整体把关。

[执行]
    运行一键安装脚本，全部步骤由脚本完成（复制到 marketplace、合并登记、validate、注册、安装或更新）：

    ```bash
    python3 "${CLAUDE_PLUGIN_ROOT}/skills/interactive-plugin-builder/scripts/install-plugin.py" <插件目录>
    ```

    默认 marketplace 在 `~/claude-plugins`，名称 personal；用户有既有 marketplace 时用 `--marketplace-root` 与 `--marketplace-name` 对齐，不另起炉灶。

[完成标准]
    - 安装脚本退出码为 0，`claude plugin list` 能看到 `<插件 ID>@personal`。
    - 已提醒用户 `/reload-plugins` 或开新会话生效，并给出一句可用性自测（如触发该插件的一个 Skill）。
    - 用户的 marketplace.json 中既有条目原样保留。
    - 已提示用户：安装确认弹窗的 Will install 清单会列出全部 hooks 与 MCP server；付费分发时可在安装说明里主动展示该清单降低信任门槛。

[禁止]
    - 对校验失败的目录不告知就强行安装
    - 覆盖或删除 marketplace.json 里其他插件的条目
    - 没跑真实命令就声称安装成功
    - 把开发态 `--plugin-dir` 加载说成已安装
