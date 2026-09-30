# 大肥鱼桌宠 🐋

DeepSeek 二创形象「鲸鱼娘·大肥鱼」的透明桌面宠物。

基于开源项目 [dsh-pet](https://github.com/PC2005-cloud/dsh-pet) 定制，TypeScript + Electron 实现：透明置顶小窗、webm 透明动画、由 AI 后端驱动对话与碎碎念——**默认本机 Ollama，也可切成任意 OpenAI 兼容 API**（OpenAI / DeepSeek / 通义千问 / Moonshot / 硅基流动 等）。

> 说明：第一版 Python + PySide6 实现（`桌宠.py`、`sprites/`、`preprocess.py` 等）已从仓库移除，现仅保留第二版实现。如需旧版代码，请查阅 git 历史。

## 环境要求

| 依赖 | 版本 | 说明 |
|---|---|---|
| Node.js | 18+ | 运行本地宿主服务与构建 |
| npm | 随 Node.js 附带 | 安装依赖 |
| Electron | 43.3.0 | 首次启动自动下载（约 100MB，走 npmmirror 镜像） |
| Ollama | 可选 | 仅「AI 对话」与「碎碎念」功能需要 |

## 快速开始

双击仓库根目录的 **`启动大肥鱼桌宠.bat`**。

启动器会依次完成并逐项反馈状态：

1. 项目结构检查
2. Node.js / npm 环境检查
3. 依赖安装（缺 `node_modules` 时自动 `npm install`）与构建（缺 `lib/` 时自动构建）
4. Electron 运行时检查（缺失时自动下载）
5. Ollama 服务检查（缺失仅告警，不影响启动）
6. 启动本地服务 `pet-server` 并拉起桌宠窗口

任一步失败都会给出明确的错误原因与处理建议，并暂停窗口以便查看。

## 使用方法

桌宠是一只透明置顶的小窗，**对着它点右键**即可打开操作菜单：

| 菜单项           | 用途                                                                                     |
| ---------------- | ---------------------------------------------------------------------------------------- |
| **AI 设置**      | 切换对话 / 碎碎念的 AI 后端：本机 Ollama，或任意 OpenAI 兼容 API（地址 / API Key / 模型名） |
| **对话**         | 和桌宠聊天（`Enter` 发送、`Esc` 关闭）                                                   |
| **番茄钟**       | 开始专注 / 停止 / 设置时长；专注期间宠物头顶显示剩余时间角标                             |
| **端口设置**     | 修改本地服务端口（**重启桌宠后生效**）                                                   |
| **服务控制台**   | 用系统浏览器打开本地服务页面：运行状态 + 番茄钟 + AI 后端 + 端口，同页操作               |

**关掉它**：关闭桌宠窗口即结束宠物本体；本地服务是后台常驻进程，不会随窗口关闭而停止，需要在任务管理器里结束 `node.exe`（详见[插件 README](dsh-pet-ref/dsh-pet/README.md) 的卸载一节）。

### 接入外部 API（不想用本机 Ollama 时）

右键「**AI 设置**」，或点「**服务控制台**」里的「AI 模型」卡片——两处改的是同一份配置，行为一致：

1. **服务类型**选 `OpenAI 兼容 API`；
2. 填 **API 地址**（如 `https://api.deepseek.com/v1`；不带 `/v1` 会自动补上）、**API Key**、**模型名**（如 `deepseek-chat`）；
3. 确定 / 保存，**立即生效**，下一句对话就用新后端；
4. 想切回本机模型：服务类型选回「本机 Ollama」，地址与已装模型列表会自动回来。

覆盖 OpenAI / DeepSeek / 通义千问 / Moonshot / 硅基流动 / 智谱，也支持 LM Studio、vLLM 等本地端点（这类端点 API Key 可留空）。报错会翻译成能照做的提示（`401` → API Key 无效、`404` → 地址可能漏了 `/v1`、`429` → 频率或额度不足）。

## 手动启动

```bash
cd dsh-pet-ref/dsh-pet
npm install
npm run ensure:electron
node scripts/ollama-pet-server.mjs 8231
npm run start:desktop -- http://127.0.0.1:8231/dsh-pet-7340/config
```

## 配置

- **桌宠与对话配置**：`dsh-pet-ref/dsh-pet/assets/config.jsonc`（JSONC，支持注释；字段缺失或非法会在控制台显式报错）
- **服务端口**：默认 `8231`。优先级：启动器传入参数 > 环境变量 `PET_PORT` > `.data/server.json` > `8231`；可右键桌宠 →「端口设置…」写入（**重启后生效**）
- **AI 后端**：默认 **本机 Ollama**（`http://localhost:11434` / `qwen2.5:3b`，环境变量 `OLLAMA_URL`、`OLLAMA_MODEL` 只提供默认值），可切成**任意 OpenAI 兼容 API**。配置存 `.data/ai.json`（`provider` / `url` / `model` / `apiKey`），右键「AI 设置」或「服务控制台」两处可改，**立即生效**；旧配置（只有 `model` + `url`）自动按本机 Ollama 处理，无需迁移
- **番茄钟**：`dsh-pet-ref/dsh-pet/assets/pomo.json`（`enabled` / `task` / `workMin` / `restMin`），或右键桌宠 →「番茄钟 → 设置时长…」
- **运行时数据**：对话记忆、AI 配置、端口配置与服务日志写入 `dsh-pet-ref/dsh-pet/.data/`（可用环境变量 `PET_DATA_DIR` 改路径），不入仓库

各功能图形化入口、配置字段与已知问题详见 **[插件 README](dsh-pet-ref/dsh-pet/README.md)**；HTTP 接口清单见该 README 的「本地服务 HTTP API」节，也可直接右键桌宠 →「**服务控制台**」（系统浏览器打开，可操作番茄钟 / 模型 / 端口）。

## 目录结构

```
dafeiyu/
├── 启动大肥鱼桌宠.bat                 启动器（环境检查 + 启动第二版）
├── dsh-home/                          Electron 运行时（自动下载，不入仓库）
├── dsh-pet-ref/                       第二版实现（dsh-pet 定制）
│   ├── dsh-pet/                       dsh-pet 包本体
│   │   ├── src/                       TypeScript 源码（host / client / shared）
│   │   ├── scripts/                   启动、构建、素材与本地服务脚本
│   │   │   └── ollama-pet-server.mjs  本地宿主服务（不依赖 DSH 宿主）
│   │   ├── runtime/electron-helper/   Electron 透明窗渲染进程
│   │   ├── assets/                    webm 动画、表情包、字体、config.jsonc、pomo.json
│   │   ├── .data/                     运行时数据（对话记忆 / AI 配置 / 端口 / 日志，不入仓库）
│   │   └── README.md                  插件文档（功能 / 安装 / 配置 / API / 已知问题）
│   ├── assets/                        截图等仓库素材
│   └── scripts/                       上游素材处理管线（Python）
└── LICENSE
```

## 上游同步

第二版代码位于 `dsh-pet-ref/`，是上游项目 [PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet) 的**整仓拷贝（vendored）**，本地定制版本为 **0.2.12**（见 `dsh-pet-ref/dsh-pet/package.json`）。

- 本仓库整理时移除了 `dsh-pet-ref/.git`（嵌套仓库），因此工作区不再保留上游 git 历史，也无法反查精确的上游 commit。
- 本地定制点：`dsh-pet-ref/dsh-pet/scripts/ollama-pet-server.mjs`（脱离 DSH 宿主的独立本地服务）、`assets/config.jsonc` 中的形象与文案定制。
- 同步上游新版本的建议流程：
  1. 备份本地定制文件 `dsh-pet-ref/dsh-pet/scripts/ollama-pet-server.mjs`。
  2. 把上游仓库克隆到仓库外的临时目录：`git clone --depth 1 https://github.com/PC2005-cloud/dsh-pet.git`。
  3. 用上游的 `dsh-pet/` 覆盖 `dsh-pet-ref/dsh-pet/`，再把备份的 `ollama-pet-server.mjs` 放回，并重新套用 `assets/config.jsonc` 的定制。
  4. 进入 `dsh-pet-ref/dsh-pet` 执行 `npm install`，再运行 `npm test` 与 `npm run typecheck` 确认无回归。

## 协议与致谢

本项目以 MIT 协议发布。

第二版基于 [dsh-pet](https://github.com/PC2005-cloud/dsh-pet)（MIT）定制，本地宿主服务 `scripts/ollama-pet-server.mjs` 为脱离 DSH 宿主独立运行所作补充。形象与台词取材自 DeepSeek / 鲸鱼娘 / 大肥鱼社区二创，感谢社区整活。

## 变更记录

### 2026-09-29

- **移除第一版实现**：删除 Python + PySide6 版本的全部文件与目录（`桌宠.py`、`preprocess.py`、`preprocess2.py`、`make_zip.py`、`requirements.txt`、`icon.ico`、`桌宠.spec`、`config.json`、`启动桌宠.bat`、`sprites/`、`__pycache__/`）。仓库现仅保留本 README 所述的第二版实现，README 中「双实现」相关的歧义随之消除。
- **重写启动器**：`启动大肥鱼桌宠.bat` 由硬编码路径改为 `%~dp0` 相对定位，新增 6 步环境检查（项目结构 / Node.js 与 npm / 依赖与构建 / Electron 运行时 / Ollama 服务 / 服务与桌宠进程），每步输出状态，失败时给出退出码、原因与补救命令。
- **修复测试与配置契约冲突**：`src/shared/config.test.ts` 曾把**可选**字段 `workStatusTexts` 列入条目级「缺一不可」清单，与 `assets/config.jsonc`「工作状态联动文案已停用」的契约冲突。该字段类型为可选、消费端 `src/client/pet.ts` 已用 `Array.isArray` 防御（缺省 = 只播动画、不弹文案），故将其移出必需清单并加注释说明。回归结果：`npm test` **225/225 通过**、`npm run typecheck` 退出码 0。
- **仓库瘦身与卫生**：`.gitignore` 补齐 `dsh-home/`（Electron 运行时，约 347MB，可由 `ensure-electron.mjs` 重建）、`node_modules/`、`.npm-cache/`、`.loomy-attachments/`、运行时 `.data/` 与 `*.log`；移除 `dsh-pet-ref/.git` 嵌套仓库（129MB）。仓库最大单文件 6.76MB，满足 GitHub 100MB 单文件限制。

### 2026-09-29（第二轮：功能完善与文档）

- **番茄钟可用化**：桌面端右键新增「番茄钟」子菜单（开始专注 / 停止 / 设置时长），任务名与专注·休息分钟数写入 `assets/pomo.json`，服务端按时长自动在专注 ↔ 休息间轮转；运行中宠物头顶常驻**剩余时间角标**（专注暖红 / 休息暖绿），不占用对话气泡——番茄钟与对话、碎碎念可并行。
- **气泡去单占用**：气泡改为按优先级调度（连接告警 > 瞬时消息 > 工作状态 > 余额），单一功能不再长期霸占气泡。
- **模型切换可用化**：新增 `GET /ai/models`（列出本机 Ollama 已装模型）与 `GET|POST /ai/config`；桌面右键「AI 设置」下拉即选即生效，写入 `.data/ai.json`，覆盖环境变量默认值。
- **端口可配置**：新增 `GET|POST /server/port` 与右键「端口设置…」，写入 `.data/server.json` 重启生效；端口优先级为 启动参数 > `PET_PORT` > `.data/server.json` > `8231`。
- **连接失败可见化 + 服务常驻加固**：客户端每 3 秒探测 `/health`，连续 3 次失败弹告警气泡并提示重跑启动器，恢复后自动收起；本地服务改为后台常驻，日志落 `.data/logs/`。
- **「打开网站」→「服务控制台」**：移除用途不明的「打开网站」菜单项，替换为用系统浏览器打开本地服务的**可操作页面**（状态 + 番茄钟 + 模型 + 端口同页操作）。
- **文档更新**：重写插件 README（`dsh-pet-ref/dsh-pet/README.md`）——新增版本与定位表、目录 TOC、双路径安装、桌面端专属配置、已知问题、贡献与许可勘正；根 README 补充配置节、目录结构与本节变更记录，并与插件 README 建立交叉引用。
- **验证结论**：`npm test` **225/225 通过**、`npm run typecheck` 通过、`eslint` 通过；新增端点 `/health`、`/ai/models`、`/ai/config`、`/pomo/status`、`/server/port` 与控制台页面在 8232 端口实测均 200；桌面冒烟自检通过（角标正常、根菜单无「打开网站」、`errors: []`、连接探测正常）。
- **提交**：`5d4d97f`（12 文件，+1026 / −78），已推送 `C2006L/dafeiyu/main`。

### 2026-10-01

- **修复端口设置弹窗「取消 / 保存」点不动**：端口设置与番茄钟设置弹窗漏登记「穿透守卫」——弹窗打开后光标一移上去（不在宠物身体命中区）就被渲染端的命中判定翻回整窗穿透，鼠标事件直接透传到下层窗口，于是「看着正常、点下去没反应」。现为三处自绘弹窗统一登记开启状态，并同时纳入渲染端可交互判定与「正在使用输入」上报两条通道（后者可让主进程兜底轮询强制保持可交互）。
- **修复对话失败提示不可操作**：连不上 Ollama 时 Node 原生 `fetch` 只抛 `fetch failed`，原样透出即气泡里的「对话失败: fetch failed」，用户既不知道是 Ollama 没开、也不知道该做什么。现翻译为可执行提示：给出实际地址、错误码（如 `ECONNREFUSED` / 请求超时）与 `ollama serve`、`ollama pull <当前模型>` 指引。默认后端是本机 Ollama、**不需要任何访问令牌**；克隆后对话不可用一律先查这一步（外部 API 为可选项，见下条）。
- **冒烟自检补充弹窗断言**：桌面冒烟新增 `portDialogSmoke`——打开端口弹窗后把光标移出宠物身体，断言窗口仍可交互、且「取消」能真正关闭弹窗；经反向对照（临时摘掉登记）确认该断言可复现原缺陷，非恒真。
- **文档**：插件 README 与仓库 README 重写（版本与定位、目录、双路径安装、桌面端专属配置、已知问题、贡献、许可三表），版本号统一为 `0.2.12`，外部链接与图片引用实测可达。提交 `9929253`。
- **新增：接入外部 API（AI 后端可切换）**：此前 AI 后端被写死为本机 Ollama（`{url}/api/chat`），控制台只能换模型名，**没有任何填写 API Key / 外部地址的地方**。现在 `.data/ai.json` 增加 `provider` 字段——`ollama`（默认，行为不变）或 `openai`（任意 OpenAI 兼容服务：OpenAI / DeepSeek / 通义千问 / Moonshot / 硅基流动 / 智谱 等）。选 `openai` 时走 `{url}/v1/chat/completions` 并带 `Authorization: Bearer <apiKey>`（地址已含 `/v1` 或 `/v1beta` 则不再重复拼接；Key 可为空以兼容 LM Studio / vLLM 等本地端点）。「服务控制台」的「AI 模型」卡片新增**服务类型 / API 地址 / API Key** 三项输入，保存后立即生效。旧 `ai.json`（只有 `model`+`url`）自动按 `ollama` 处理，无需迁移。HTTP 错误翻译为可照做的说明（`401` → API Key 无效、`404` → 接口地址可能漏了 `/v1`、`429` → 频繁或额度不足）。
- **`/ai/config` 改为局部更新**：只覆盖请求体里出现的字段，便于日后新增字段时的向前兼容（当前两个入口都发全量四项）。
- **`/health` 契约变更**：`ollamaUrl` → `aiUrl`，并新增 `provider`（控制台「运行状态」相应改为「AI 服务」行）。
- **右键「AI 设置」弹窗同步改造**：从「只能填一个模型名」扩为服务类型 / API 地址 / API Key / 模型名四项，与「服务控制台」同一份配置；切换服务类型时只在该地址仍是空或已知默认值时才替换，不会冲掉用户填过的地址；Ollama 连不上报原因、切到外部 API 则提示模型名需手填（都不假装有列表）。弹窗加 `max-height:96vh;overflow-y:auto`——四项输入比原弹窗高，避免按钮被裁到点不到。
- **冒烟自检新增 `aiDialogSmoke`**：断言弹窗挂载、四项字段与标签齐全、`provider` 选项为 `ollama/openai`、API Key 为 `password` 型、切到外部 API 后地址变为该后端默认值且提示改为「手填」、以及**弹窗开着时整窗保持可交互**（`interactiveAwayFromBody`，与端口弹窗同一断言）。实测全绿，`errors` 为空，`portDialogSmoke` 无回归。
- **修复「服务控制台」打开的是旧版网页**：现象是右键「AI 设置」弹窗已是新版，点「服务控制台」跳转到 `http://127.0.0.1:<port>/` 拿到的却还是旧页面（没有服务类型 / API Key 等控件）。**跳转地址本身没问题**——控制台页面确实只挂在 origin 根路径 `/`（`ollama-pet-server.mjs` 的 `pathname === '/'` 分支），`ORIGIN` 也确为服务 origin。真正原因是**端口上还跑着一个两天前启动的旧 `pet-server` 进程**（Node 启动时就把代码读进内存，改源码不影响运行中的进程），而启动器 `:probe_health` 只看 `/health` 是否返回 200、不校验版本，于是判定「已在运行」并**跳过启动**，造成「新版桌宠 + 旧版服务」的新旧混跑，且全程没有任何提示。
  - **服务端**：`ollama-pet-server.mjs` 计算自身源码的 SHA1 前 12 位作为构建指纹，暴露为 `/health` 的 `build` 字段、写入启动日志、并在控制台「运行状态」新增「服务构建」一行——三处一对即可确认看的是不是同一份代码。
  - **启动器**：`:probe_health` 改为「指纹比对」——本地源码 SHA1（纯 .NET 计算，`Get-FileHash` 在 cmd 拉起的 Windows PowerShell 里不可用）与运行实例的 `build` 一致才跳过启动；不一致则**只结束命令行含 `ollama-pet-server.mjs` 的本项目进程**（其它程序一概不碰）后重启，并打印新服务的 `build` 与 AI 后端。实测：一致 → `ERRORLEVEL=0` 走「跳过启动」；把源码换成不匹配的副本做反向对照 → 打印「结束旧版 pet-server（PID …）」、`ERRORLEVEL=1`、端口被释放，两条路径均按预期。
  - 回归：`npm test` **225/225 通过**、`node --check` 通过。
- **文档：新增「使用方法」一节**（本 README）：右键菜单逐项用途、如何关停桌宠与后台服务、以及**接入外部 API 的四步操作**（服务类型 / 地址 / Key / 模型名，两个入口二选一）；「配置」节的 AI 项改写为「AI 后端」，说明默认值与切换方式。
