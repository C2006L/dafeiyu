# 大肥鱼桌宠 🐋

DeepSeek 二创形象「鲸鱼娘·大肥鱼」的透明桌面宠物。

基于开源项目 [dsh-pet](https://github.com/PC2005-cloud/dsh-pet) 定制，TypeScript + Electron 实现：透明置顶小窗、webm 透明动画、由本地 Ollama 驱动对话与碎碎念。

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
- **服务端口**：默认 `8231`（启动器中为 `PET_PORT`）
- **Ollama 地址与模型**：环境变量 `OLLAMA_URL`（默认 `http://localhost:11434`）、`OLLAMA_MODEL`（默认 `qwen2.5:3b`）
- **运行时数据**：对话记忆等写入 `dsh-pet-ref/dsh-pet/.data/`，不入仓库

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
│   │   └── assets/                    webm 动画、表情包、字体、config.jsonc
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
