---
name: chatcut-workspace
description: 当用户要打开 ChatCut 课程视频工作台、把几个视频组合起来、导入录屏或 HyperFrames 产物开始剪一集课程视频时使用。检测依赖、启动本地工作台并返回浏览器地址，然后把素材导入当前项目。工程开起来之后这些活也归它：把第 3 段挪到第 1 段前面、删掉某段、开头几秒废镜头收一下出入点，这类排片段（clip_arrange）；用户说「素材找不到了」「我把 rec 目录挪到别的盘了」时把片段重新指到新路径（clip_relink），裁剪点与标注都保留；导入报 PERMISSION_DENIED、素材在桌面或另一块盘上导不进来时讲清可导入范围与 CHATCUT_MEDIA_ROOTS 该怎么配；用户说「我在面板上点了按钮没回音」「界面一直转圈显示进行中」时去认领界面提交的待办（request_claim）并把它跑完结掉；用户说「先停下」「别跑了」时取消正在跑的任务（job_cancel），问「渲染进度怎么样」时报进度（job_status）；问「现在什么状态」「有几段、总共多长、旁白写到哪了」时复述工程现状（project_read）；以及依赖缺失时的体检与补齐——hyperframes 或 whisper 没装、要下多大、从哪来、装到哪（dependency_check / dependency_fetch）。
---

[任务]
    启动 ChatCut 工作台并把素材导入当前项目，让用户可以在浏览器里开始剪辑。

[启动检查]
    1. 调用 `dependency_check`，读它返回的 coreOk、blockedFeatures 与 **fetchActions**。
    2. coreOk 为 false 时立即停下，把缺失项与安装指引原样告诉用户，不要继续往下走。
        中途才失败比一开始就说清楚糟糕得多。
    3. blockedFeatures 非空时照常打开工作台，但要说明哪些能力暂不可用：
        - feature:annotation 缺失 → 标注层渲染不可用
        - feature:asr 缺失 → 录屏原声识别不可用，TTS 旁白的字幕不受影响
        - feature:tts 缺失 → 配音不可用，需要先配 MiniMax 凭据。
          **别停在"需要先配"**：`MINIMAX_API_KEY` 与 `MINIMAX_GROUP_ID` 两个值，
          可设为环境变量，或写进 `%APPDATA%\chatcut\credentials.json`
          （macOS / Linux 是 `~/.config/chatcut/credentials.json`），内容是
          `{"apiKey":"...","groupId":"..."}`；两者必须属于同一账户，否则接口返回 1004。
          完整说明见 chatcut-narration 技能的「MiniMax 凭据怎么配」。
    4. 只要 fetchActions 非空，就**主动把补齐这条路摆出来**，见下节。
        只说"不可用"而不说"怎么补"，等于把用户扔在死胡同里。

[缺依赖时怎么补：dependency_fetch]
    `dependency_check` 的 fetchActions 里每一条都带一个可以**原样照抄**的调用串，
    例如 `dependency_fetch({"id":"hyperframes","confirm":true})`。这是把重依赖补上的唯一入口。

    两步走，第一步绝不能跳（UX-006）：
    1. **先不带 confirm 调一次**：`dependency_fetch({"id":"<id>"})`。
        它不下载、不落盘，只返回一张单子——补什么、多大、从哪来、装到哪、不补的后果。
        把这张单子**念给用户**：几百 MB 的下载不能替他决定。
    2. 用户明确同意后再带 `confirm: true` 调一次。它立即返回 jobId，
        用 `job_status` 报进度，**不要在那里干等**：hyperframes 约 369 MB、whisper base 约 141 MiB，分钟级。
    3. 任务 succeeded 之后**再调一次 `dependency_check` 复核**，确认对应的 blockedFeatures 已经消掉。
        任务自报成功不算数，以复核结果为准。

    几条边界，说错了会让用户白等：
    - 一切都装进 `${CLAUDE_PLUGIN_DATA}`，**不写插件安装目录**（那里只读且随更新失效）。
    - 版本或 SHA-256 对不上会直接失败，不会返回一个没校验过的东西。
    - **ffmpeg 的 whisper / libass 滤镜补不了**：那是本机 ffmpeg 的编译选项，
        只能让用户换一个带这些滤镜的 ffmpeg 构建。别拿 dependency_fetch 去试。
    - 取消这个任务不会立刻打断已经在跑的 npm install / 下载，只会让它跑完后不再进入下一阶段。
        如实告诉用户，别说成"已经停了"。

[执行]
    1. 调用 `workspace_open`，参数只有可选的 projectDir，默认当前工作目录。
    2. 把返回的 url 完整交给用户，让他自己在浏览器打开。
        该 URL 带 session token，缺了它所有接口都返回 401。
    3. 用户提供素材路径后调用 `clip_import`，它会用 ffprobe 探测规格并生成预览代理。
        原始文件只被读取，不复制、不修改。
    4. 导入完成后告诉用户：导入了几段、总时长多少、有没有片段被标为缺失或格式不支持。
    5. `workspace_open` 的返回里带 `missingClips`。非空就说明**上次用过的素材现在找不到了**，
        当场告诉用户是哪几个片段、原路径是什么，然后按下一节重新定位。别等用户自己发现。

[导入范围：哪些路径导得进来]
    可导入的一共四处（SEC-003）：
    1. **项目目录**；
    2. **宿主会话的工作目录树**（这个 MCP Server 被拉起时所在的目录）；
    3. **用户显式追加的素材目录**——两个取值源，并集生效，见下一节；
    4. **已经导入过的那几个具体文件**（是文件，不是它们所在的目录）。
        这一条只能由带守卫的 `clip_import` / `clip_relink` 往里加；
        `clip_arrange` / `project_write` 改不了片段的 `sourcePath`，别去试（F-069）。

    清单之外一律 `PERMISSION_DENIED`，而且**越权与文件不存在给的是同一句话**——
    别拿它去试探某个路径存不存在，那问不出结果。
    探测（`media_probe`）的范围比导入更窄，只到第 4 条，不含目录。

[素材在别处怎么办：CHATCUT_MEDIA_ROOTS 到底写在哪]
    用户的录屏在桌面、OBS 的默认输出目录、另一块盘上的素材库——只要不在工作目录树内，
    导入就会被拒。这时**不要只说"请在宿主配置里加环境变量"**：那句话没有可操作性，
    用户不知道是哪一份文件、写在哪个键下。把下面三条原样念给用户，让他挑一条（F-073）。

    方式一 · 当次会话立即生效（**启动宿主之前**在同一个终端里执行）
        Windows（cmd）：    set CHATCUT_MEDIA_ROOTS=D:\course\raw
        Windows（PowerShell）：$env:CHATCUT_MEDIA_ROOTS = "D:\course\raw"
        macOS / Linux：     export CHATCUT_MEDIA_ROOTS=/Users/me/course/raw
        多个目录用系统路径分隔符隔开（Windows 是 `;`，POSIX 是 `:`）。

    方式二 · 长期有效，用户手写一次（推荐；与 MiniMax 凭据同一个位置）
        文件：`%APPDATA%\chatcut\config.json`
              （macOS / Linux 是 `~/.config/chatcut/config.json`）
        内容照抄，把路径换成自己的：
            {
              "mediaRoots": ["D:/course/raw", "E:/obs-output"]
            }
        **这份文件只有用户能写**：插件没有任何 Tool 能改它，你也改不了。
        它与环境变量是并集关系，两个都设就两个都生效。

    方式三 · 写进宿主配置的 env 块（要改的是**宿主自己的** settings.json，
        不是插件安装目录里的那份拷贝——插件是被复制进宿主缓存的，改那份重装即被覆盖）
            {
              "env": { "CHATCUT_MEDIA_ROOTS": "D:/course/raw" }
            }

    三条都要**重开会话或重启工作台**才生效：环境变量与配置在进程启动时读取一次。

    这是**用户**的授权动作，你改不了自己进程的环境变量、也改不了那份配置文件，
    更不要建议用户关掉这道检查。设完之后重跑 `clip_import` 复核，别替用户宣布已经好了。

[素材失效与重新定位：clip_relink]
    素材被移走、改名或删掉时，工程**不作废**：裁剪点、标注、旁白都还在，缺的只是文件本身（UX-005 / AC-010）。

    1. `project_read` 看 `missingClipIds`（`workspace_open` 也会直接报）。
    2. 逐条问用户新文件在哪。**不要自己猜路径、不要拿同名文件顶替**——
        猜错的后果是成片里出现一段完全无关的画面，而导出会照常成功。
    3. 对每条调 `clip_relink({"clipId":"...","newPath":"..."})`。裁剪点与标注会保留；
        返回的 `warnings` 里若说规格变了或出点被收敛，原样念给用户听，那会影响成片。
    4. 全部重绑完再导出。**重绑之前导出会被阻止**——那不是故障，是防止产出缺画面的成片。
    5. 界面上那个「重新定位素材」按钮提交的是 `clip.relink` 请求，走的也是这条路：
        `request_claim` 认领到它之后，`selection.clipIds` 就是要重绑的片段，
        问清新路径后逐条调 `clip_relink`，并把认领来的 requestId 原样带上。

[界面提交的待办：先认领再执行]
    用户在工作台点「生成配音 / 生成标注层 / 生成字幕 / 导出成片」时，请求会进 `.chatcut/requests/queue.json`，
    **不会**自动变成一次 Tool 调用。你要主动去取，否则用户点了按钮，界面会一直等在「进行中」。

    固定四步，一步都不能省：
    1. `request_claim` 认领。返回 requestId、operation、selection、assetRefs 与用户意图。
        没有待办时它会明说队列是空的，那就照常处理用户当前的对话请求。
        认领是带租约的独占，默认 600 秒；导出这类分钟级任务就用默认值，别调短。
    2. 按 operation 决定调哪个 Tool，selection 就是入参来源：
        - `narration.synthesize` → `narration_synthesize`（segIds 取 selection.segIds）
        - `annotation.render`    → `annotation_render`（annIds 取 selection.annIds）
        - `captions.generate`    → `captions_generate`
        - `export.render`        → `export_render`
        - `clip.relink`          → 先问用户新路径，再对 selection.clipIds 逐条 `clip_relink`
        - `clip.arrange` / `annotation.define` 等 → 对应领域 Tool
    3. **把认领来的 requestId 原样传给那个 Tool**。这一步决定了闭环成不成立：
        带了它，写回时队列条目自动结单、界面上那次点击才有回音；
        不带，请求会一直挂在 claimed 直到租约到期，中间显示的进度全是假的。
    4. 长任务用 `job_status` 跟进度，完成后告诉用户产出了什么。
        确定做不成时调 `request_resolve` 如实结掉（outcome=failed），
        暂时不处理就 outcome=released 退回队列。**不许让它自己烂在那儿。**

    每次准备开始一段较长的工作前，先 `request_claim` 看一眼——界面上的点击不会主动来找你。

[对话中可直接驱动]
    用户不打开界面也能干活。常见指令与对应工具：
    - 「导入这几段录屏」→ `clip_import`
    - 「把第 3 段挪到第 1 段前面」→ `clip_arrange`
    - 「现在什么状态」→ `project_read` 后用自然语言复述
    - 「渲染进度怎么样」→ `job_status`
    - 「素材找不到了 / 我把文件挪到了 X」→ `project_read` 看 missingClipIds，再逐条 `clip_relink`
    - 「停下 / 别跑了」→ `job_cancel`，取消后如实说明中间产物保留、可从中断处续跑。
        任务替某条界面请求跑时，取消会**连带把队列里那条请求结成 cancelled**，它不会再被重新派回来；
        别把「用户取消了」说成「上次没做完」。
        **以回包里的 `requestSettled` 为准，不要凭这句话替系统打包票**：
        `true` = 队列条目已结成 cancelled；`null` = 这个任务本来就不属于任何界面请求（你在对话里直接起的）；
        `false` = 有 requestId 但没结成（已结过或条目已被裁掉）——这时用 `request_resolve` 复核，
        别对用户说它已经停了。

[界面与状态的关系]
    工作台显示的一切都来自 `.chatcut/project.json`，没有第二份真相源。
    - 你用领域 Tool 写回后，界面会自己刷新，**不需要**让用户手动刷新页面。
    - 用户在界面上的编辑（排序、裁剪、框选、改旁白、校对字幕）也直接落进同一个文件。
        所以任何写操作前先 `project_read` 取当前 projectVersion，拿它当 expectedVersion。
    - 收到 VERSION_CONFLICT 说明用户刚在界面上改过：重读状态、基于新版本重算，别覆盖。

[完成标准]
    - 用户拿到了可打开的工作台地址，或者拿到了明确的依赖缺失说明。
    - 素材已登记进工程状态，用户知道导入了什么。
    - 存在缺失或不支持的文件时，逐个说清楚是哪个、为什么。
    - 界面提交过的待办都已认领并结掉，没有条目停在 claimed。

[禁止]
    - 替用户执行插件安装或注册命令。
    - 在 core 依赖缺失时硬着头皮往下走。
    - 把 workspace_open 返回的 token 当作可省略的参数。
    - 复制或改写用户的原始素材文件。
    - 不认领就直接执行界面提交的操作，或执行时丢掉 requestId。
    - 队列里还有 pending 待办却告诉用户"没有进行中的任务"。
    - 素材缺失时自己猜一个新路径去 `clip_relink`，或用同名文件顶替。
    - 拿 `clip_import` 的拒绝回答去试探路径存不存在——越权与不存在给的是同一句话，问不出来。
