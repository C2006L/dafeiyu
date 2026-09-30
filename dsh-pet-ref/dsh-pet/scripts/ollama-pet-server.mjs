#!/usr/bin/env node
/**
 * ollama-pet-server.mjs —— dafeiyu 独立宿主服务器（无 DSH 版）
 *
 * 让 dsh-pet 的桌面模式（Electron 透明窗）完全脱离 DeepSeek Harness 运行：
 *   - 素材 / 配置：直接读本包 assets/
 *   - 碎碎念 / 对话：调用 AI 后端（默认本机 Ollama，也可切到任意 OpenAI 兼容服务）
 *   - 番茄钟：独立状态机，通过 /work-status 档位动画 + 督促语气泡驱动
 *
 * 契约对齐 src/host/index.ts 的 handlePetRoute + scripts/dev/mock-server.mjs。
 *
 * 用法：node scripts/ollama-pet-server.mjs [port]
 * 配合：npm run start:desktop -- http://127.0.0.1:<port>/dsh-pet-7340/config
 *
 * 环境变量：
 *   OLLAMA_URL        Ollama 地址（默认 http://localhost:11434）
 *   OLLAMA_MODEL      模型名（默认 qwen2.5:3b）
 *   PET_DATA_DIR      数据目录（记忆/番茄钟配置，默认本包 .data）
 *
 * AI 后端（.data/ai.json；服务控制台「AI 模型」卡片或右键「AI 设置」弹窗可改；env 只提供默认值）：
 *   provider  'ollama'（默认）：打本机 `{url}/api/chat`
 *             'openai'        ：打 `{url}/v1/chat/completions`，带 `Authorization: Bearer {apiKey}`
 *                               —— 覆盖 OpenAI / DeepSeek / 通义千问 / Moonshot / 硅基流动 等
 *   url / model / apiKey
 */
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { join, resolve, normalize, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------- 进程级兜底（服务必须常驻：崩溃即"桌宠失联"，客户端只能靠探测发现） ----------
// 单个请求/定时器里的未捕获异常此前会直接带走整个进程，用户侧表现为"桌宠开着但所有功能没反应"。
process.on('uncaughtException', (e) => {
  console.error('[pet-server] 未捕获异常（进程继续运行）：', e);
});
process.on('unhandledRejection', (e) => {
  console.error('[pet-server] 未处理的 Promise 拒绝（进程继续运行）：', e);
});

// ---------- 路径 ----------
const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(HERE, '..');
const WEBM_ROOT = join(PACKAGE_ROOT, 'assets', 'webm');
const CONFIG_FILE = join(PACKAGE_ROOT, 'assets', 'config.jsonc');
const PIC_DIR = join(PACKAGE_ROOT, 'assets', 'pic');
const MEMES_DIR = join(PACKAGE_ROOT, 'assets', 'memes');
const FONTS_DIR = join(PACKAGE_ROOT, 'assets', 'fonts');
const POMO_FILE = join(PACKAGE_ROOT, 'assets', 'pomo.json');
const DATA_DIR = process.env.PET_DATA_DIR || join(PACKAGE_ROOT, '.data');
const MEMORY_FILE = join(DATA_DIR, 'memory.json');
const AI_CFG_FILE = join(DATA_DIR, 'ai.json');
const SERVER_CFG_FILE = join(DATA_DIR, 'server.json');

// ---------- 构建标识（识别「在跑的是哪一份代码」） ----------
// Node 在启动时把代码读进内存，**之后文件怎么改都不会影响已在运行的进程**。所以「桌宠是新的、网页
// 却是旧的」这类问题的根因几乎总是：旧进程还占着端口，而启动器只要 /health 返回 200 就判定「已在
// 运行」并跳过启动，于是新旧混跑且毫无提示。
// 把本文件内容的 SHA1 前 12 位当构建标识暴露出去（/health 的 build 字段 + 控制台页脚），
// 启动器据此比对本地源码，就能发现「端口上跑的不是当前这份代码」并接管。
const BUILD = (() => {
  try {
    return createHash('sha1').update(readFileSync(fileURLToPath(import.meta.url))).digest('hex').slice(0, 12);
  } catch {
    return 'unknown'; // 读不到自身源码（打包/裁剪场景）：不阻塞启动，只是失去比对能力
  }
})();

// 端口优先级：命令行参数 > 环境变量 PET_PORT > .data/server.json（右键「端口设置」写入）> 8231
function readConfiguredPort() {
  try {
    const n = Number(JSON.parse(readFileSync(SERVER_CFG_FILE, 'utf8')).port);
    if (Number.isInteger(n) && n > 0 && n < 65536) return n;
  } catch {
    /* 未配置：交给下一级默认值 */
  }
  return 0;
}

const PORT = Number(process.argv[2] || process.env.PET_PORT || 0) || readConfiguredPort() || 8231;
const PREFIX = '/dsh-pet-7340';
const OLLAMA_URL = (process.env.OLLAMA_URL || 'http://localhost:11434').replace(/\/$/, '');
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen2.5:3b';

// ---------- 配置 ----------
const stripJsonc = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^\\:])\/\/.*$/gm, '$1')
    .trim();

let configCache = null;
let configMtime = 0;
function getConfig() {
  const st = statSync(CONFIG_FILE);
  if (!configCache || st.mtimeMs !== configMtime) {
    configMtime = st.mtimeMs;
    configCache = JSON.parse(stripJsonc(readFileSync(CONFIG_FILE, 'utf8')));
  }
  return configCache;
}

// ---------- 番茄钟配置（独立文件，renderer 不校验，不影响 dsh-pet 配置） ----------
function getPomoCfg() {
  try {
    return JSON.parse(readFileSync(POMO_FILE, 'utf8'));
  } catch {
    return { enabled: false, task: '背单词', workMin: 25, restMin: 5 };
  }
}

// ---------- 记忆（对话上下文，按宠物 id 存） ----------
mkdirSync(DATA_DIR, { recursive: true });
function loadMemory() {
  try {
    return JSON.parse(readFileSync(MEMORY_FILE, 'utf8'));
  } catch {
    return {};
  }
}
function saveMemory(mem) {
  try {
    writeFileSync(MEMORY_FILE, JSON.stringify(mem, null, 2), 'utf8');
  } catch (e) {
    console.error('[pet-server] save memory failed:', String(e));
  }
}

// ---------- AI 配置（可运行时切换，持久化 .data/ai.json） ----------
// provider：'ollama' = 本机 Ollama（默认），'openai' = 任意 OpenAI 兼容服务。
// 归一化：旧版 ai.json 只有 {model,url}，没有 provider —— 这里补成 'ollama'，
// 老配置无缝继续用（不会因为升级就把用户的本机模型配置弄丢）。
let aiCfg = { provider: 'ollama', model: OLLAMA_MODEL, url: OLLAMA_URL, apiKey: '' };
try {
  aiCfg = Object.assign(aiCfg, JSON.parse(readFileSync(AI_CFG_FILE, 'utf8')));
} catch { /* 首次运行，用默认 */ }
if (aiCfg.provider !== 'openai') aiCfg.provider = 'ollama';
function saveAiCfg() {
  try {
    writeFileSync(AI_CFG_FILE, JSON.stringify(aiCfg, null, 2), 'utf8');
  } catch (e) {
    console.error('[pet-server] save ai cfg failed:', String(e));
  }
}

// ---------- AI 调用（两种 AI 后端：本机 Ollama / OpenAI 兼容服务） ----------

/** 当前 AI 后端是否 OpenAI 兼容协议 */
const isOpenAi = () => aiCfg.provider === 'openai';
/** 用户可读的后端名（错误提示、控制台展示共用） */
const providerName = () => (isOpenAi() ? 'AI 服务' : 'Ollama');

/**
 * OpenAI 兼容服务的对话端点。用户填 `https://api.deepseek.com`、
 * `https://api.openai.com/v1`、`https://.../v1beta` 都应该能直接用，
 * 所以按后缀补全，而不是硬拼 `/v1/chat/completions`（那会把带 /v1 的地址拼成 /v1/v1/...）。
 */
function openAiEndpoint(base) {
  const u = base.replace(/\/$/, '');
  if (/\/chat\/completions$/.test(u)) return u;
  if (/\/v\d+(?:beta)?$/i.test(u)) return u + '/chat/completions';
  return u + '/v1/chat/completions';
}

/**
 * 把"连不上 AI 后端"翻译成用户能照着做的提示。
 * Node 原生 fetch 在连接层失败时只抛 `TypeError: fetch failed`（真因埋在 e.cause.code），
 * 原样透到气泡就是「对话失败：fetch failed」——用户既不知道是 Ollama 没开，也不知道该做什么。
 */
function aiDownMessage(e) {
  const cause = e && e.cause;
  // Node 各版本对连接错误的包装不一致：低版本给 cause.code（ECONNREFUSED），
  // Node 24 的 cause 可能是个只有 message 的裸 Error（如 "bad port"），故逐层兜底。
  const code =
    (e && e.name === 'TimeoutError' && '请求超时') ||
    (cause && cause.code) ||
    (cause && Array.isArray(cause.errors) && cause.errors[0] && cause.errors[0].code) ||
    (cause && cause.message) ||
    '握手失败';
  if (isOpenAi()) {
    return (
      '连不上 AI 服务（' +
      aiCfg.url +
      '，' +
      code +
      '）。\n请检查 API 地址是否可访问、网络是否通畅，以及 API Key 是否正确。'
    );
  }
  return (
    '连不上 Ollama（' +
    aiCfg.url +
    '，' +
    code +
    '）。\n请先启动 Ollama（ollama serve），并确认模型已拉取（ollama pull ' +
    aiCfg.model +
    '）。'
  );
}

/** HTTP 错误码 → 用户能懂的一句话（外部 API 的 401/404/429 光看状态码没法排查） */
function explainHttpError(status, bodyText) {
  const hit = {
    400: '请求参数不被服务端接受（检查模型名是否存在）',
    401: 'API Key 无效或未填写',
    402: '账户额度不足',
    403: '无权限访问该模型',
    404: '接口地址不对（检查是否漏了或多了 /v1）',
    422: '模型名或参数不合法',
    429: '请求过于频繁或额度不足',
  }[status];
  let detail = '';
  try {
    detail = String(JSON.parse(bodyText)?.error?.message || '').trim();
  } catch {
    /* 非 JSON 响应：detail 留空，退回原始文本 */
  }
  const msg = [hit, detail && '（' + detail.slice(0, 120) + '）'].filter(Boolean).join('');
  return msg || bodyText.slice(0, 120) || '未知错误';
}

/** 本机 Ollama：POST {url}/api/chat，回复在 data.message.content */
async function ollamaChat(messages, opts = {}) {
  let res;
  try {
    res = await fetch(aiCfg.url + '/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: aiCfg.model,
        messages,
        stream: false,
        options: {
          temperature: opts.temperature ?? 0.9,
          num_predict: opts.num_predict ?? 100,
        },
      }),
      signal: AbortSignal.timeout(opts.timeout ?? 90000),
    });
  } catch (e) {
    throw new Error(aiDownMessage(e));
  }
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Ollama HTTP ${res.status}: ${txt.slice(0, 80)}`);
  }
  const data = await res.json();
  const text = String(data?.message?.content ?? '').trim();
  if (!text) throw new Error('Ollama 未返回文本');
  return text;
}

/** OpenAI 兼容服务：POST {base}[/v1]/chat/completions，回复在 data.choices[0].message.content */
async function openAiChat(messages, opts = {}) {
  const endpoint = openAiEndpoint(aiCfg.url);
  const headers = { 'content-type': 'application/json' };
  // 允许空 Key：LM Studio / vLLM 等本地 OpenAI 兼容端点通常不校验鉴权
  if (aiCfg.apiKey) headers.authorization = 'Bearer ' + aiCfg.apiKey;
  let res;
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: aiCfg.model,
        messages,
        stream: false,
        temperature: opts.temperature ?? 0.9,
        max_tokens: opts.num_predict ?? 100,
      }),
      signal: AbortSignal.timeout(opts.timeout ?? 90000),
    });
  } catch (e) {
    throw new Error(aiDownMessage(e));
  }
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`AI 服务 HTTP ${res.status}：${explainHttpError(res.status, txt)}`);
  }
  const data = await res.json().catch(() => null);
  const text = String(data?.choices?.[0]?.message?.content ?? '').trim();
  if (!text) throw new Error('AI 服务未返回文本（检查模型名是否可用）');
  return text;
}

/** 统一入口：按 aiCfg.provider 选后端。碎碎念与对话都走这里 */
function chatCompletion(messages, opts = {}) {
  return isOpenAi() ? openAiChat(messages, opts) : ollamaChat(messages, opts);
}

const WHISPER_SYSTEM = () => getConfig().whisperPrompt || '你是桌面上的小桌宠，会碎碎念一句。';
const NUDGE_SYSTEM =
  '你是桌面宠物大肥鱼，正在用番茄钟督促主人学习。请用催促或鼓励的口吻说一句话，结合主人的任务和当前阶段，每句不超过30字，贱兮兮但可爱，不要用标点堆砌。';

// ---------- 碎碎念缓存（ts 变化才播） ----------
let whisperCache = { ts: 0, text: '' };
let whisperLock = false;

async function generateWhisper(manual = false) {
  if (whisperLock) return whisperCache;
  whisperLock = true;
  try {
    const text = await chatCompletion([
      { role: 'system', content: WHISPER_SYSTEM() },
      { role: 'user', content: '随便说一句日常碎碎念，一句就好，20字以内。' },
    ], { num_predict: 40 });
    whisperCache = { ts: Date.now(), text };
    console.log('[pet-server] whisper:', text);
  } catch (e) {
    console.error('[pet-server] whisper failed:', e.message);
    if (manual) whisperCache = { ts: Date.now(), text: '（本地模型走神了，稍后再念叨～）' };
  } finally {
    whisperLock = false;
  }
  return whisperCache;
}

// ---------- 番茄钟状态机（驱动 /work-status + 督促语） ----------
const pomo = { state: 'idle', task: '背单词', endsAt: 0, ts: 0 };
let workStatus = { state: null, task: null, ts: Date.now() };
let pomoTimer = null;

function startPomo(cfg, manualTask, manualWorkMin, manualRestMin) {
  const task = manualTask || cfg.task || '背单词';
  pomo.task = task;
  pomo.state = 'work';
  pomo.endsAt = Date.now() + (manualWorkMin || cfg.workMin || 25) * 60_000;
  pomo.ts = Date.now();
  workStatus = { state: 'working', task: task, ts: pomo.ts };
  console.log(`[pet-server] 🍅 pomo work start: ${task}`);
  schedulePomo();
}

function stopPomo() {
  pomo.state = 'idle';
  pomo.endsAt = 0;
  pomo.ts = Date.now();
  workStatus = { state: null, task: null, ts: pomo.ts };
  if (pomoTimer) clearTimeout(pomoTimer);
  pomoTimer = null;
  console.log('[pet-server] 🍅 pomo stopped');
}

function schedulePomo() {
  if (pomoTimer) clearTimeout(pomoTimer);
  const cfg = getPomoCfg();
  const waitMs = Math.max(1000, pomo.endsAt - Date.now());
  pomoTimer = setTimeout(() => {
    if (pomo.state === 'work') {
      // 工作结束 → 成功动画 + 督促语 → 休息
      workStatus = { state: 'success', task: pomo.task, ts: Date.now() };
      whisperCache = { ts: Date.now(), text: '' };
      const restMin = cfg.restMin || 5;
      const task = pomo.task;
      void chatCompletion([
        { role: 'system', content: NUDGE_SYSTEM },
        { role: 'user', content: `我的任务：${task}；当前阶段：工作结束，该休息了` },
      ], { num_predict: 60 }).then((t) => {
        whisperCache = { ts: Date.now(), text: t.replace(/\n/g, ' ') };
        console.log('[pet-server] 🍅 nudge:', t);
      }).catch(() => {
        whisperCache = { ts: Date.now(), text: `🍅 ${task}时间到！休息${restMin}分钟吧～` };
      });
      setTimeout(() => {
        pomo.state = 'rest';
        pomo.endsAt = Date.now() + restMin * 60_000;
        pomo.ts = Date.now();
        workStatus = { state: null, task: null, ts: pomo.ts };
        console.log(`[pet-server] 🍅 pomo rest start: ${restMin}min`);
        schedulePomo();
      }, 4000); // 成功动画播 4 秒
    } else if (pomo.state === 'rest') {
      // 休息结束 → 督促语 → 自动下一轮工作
      const cfg2 = getPomoCfg();
      pomo.state = 'work';
      pomo.endsAt = Date.now() + (cfg2.workMin || 25) * 60_000;
      pomo.ts = Date.now();
      workStatus = { state: 'working', task: pomo.task, ts: pomo.ts };
      void chatCompletion([
        { role: 'system', content: NUDGE_SYSTEM },
        { role: 'user', content: `我的任务：${pomo.task}；当前阶段：休息结束，准备开始下一轮` },
      ], { num_predict: 60 }).then((t) => {
        whisperCache = { ts: Date.now(), text: t.replace(/\n/g, ' ') };
      }).catch(() => {
        whisperCache = { ts: Date.now(), text: `🍅 休息结束，继续${pomo.task}！` };
      });
      console.log(`[pet-server] 🍅 pomo work again: ${pomo.task}`);
      schedulePomo();
    }
  }, waitMs);
}

// 启动时若配置开启番茄钟，自动开始
const POMO_CFG = getPomoCfg();
if (POMO_CFG.enabled) {
  setTimeout(() => startPomo(POMO_CFG), 3000);
}

// 番茄钟剩余时间轻提醒：工作期间每 5 分钟冒一句（不到点不打扰）
let lastRemindMin = -1;
setInterval(() => {
  if (pomo.state !== 'work') {
    lastRemindMin = -1;
    return;
  }
  const remainMin = Math.ceil((pomo.endsAt - Date.now()) / 60000);
  if (remainMin > 0 && remainMin < 25 && remainMin % 5 === 0 && remainMin !== lastRemindMin) {
    lastRemindMin = remainMin;
    whisperCache = { ts: Date.now(), text: `🍅 ${pomo.task}还剩 ${remainMin} 分钟～` };
    console.log(`[pet-server] 🍅 remind: ${remainMin}min`);
  }
}, 30000);

// ---------- 静态文件（安全路径校验） ----------
function serveFile(res, file, contentType, cache = 'public, max-age=3600') {
  if (!existsSync(file)) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('not found');
    return;
  }
  const { size } = statSync(file);
  res.writeHead(200, {
    'content-type': contentType,
    'content-length': size,
    'cache-control': cache,
  });
  createReadStream(file).pipe(res);
}

/** 把相对路径安全解析到 root 内（防目录穿越），越界返回 null */
function safeResolve(root, rel) {
  const candidate = normalize(join(root, rel));
  const rootWithSep = root.endsWith(sep) ? root : root + sep;
  if (candidate !== root && !candidate.startsWith(rootWithSep)) return null;
  return candidate;
}

/**
 * 服务控制台页面（右键「服务控制台」用系统浏览器打开）。
 * 此前这里只是一张只读信息页，用户点开看不到能做什么 —— 故升级为**可操作**的控制台：
 * 状态只读 + 番茄钟 / AI 模型 / 服务端口可直接操作，与桌宠右键菜单同源同一批 API。
 * 视觉：日本简约（Japandi）+ Kawaii 微调 —— 暖纸底、圆角胶囊、单一暖陶土色点缀，无表情化角色。
 */
function consolePage() {
  return `<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>大肥鱼桌宠 · 服务控制台</title>
<style>
:root{--bg:#f7f3ee;--card:#fffdfa;--ink:#4a4038;--muted:#9c9086;--line:#eae1d7;--accent:#c98b6b;--accent-soft:#f6ece4;}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);line-height:1.7;
  font-family:"Microsoft YaHei UI","Microsoft YaHei",system-ui,sans-serif;-webkit-font-smoothing:antialiased}
.wrap{max-width:760px;margin:0 auto;padding:36px 20px 60px}
header{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:20px}
.brand{font-size:22px;font-weight:700;letter-spacing:.5px}
.brand .sub{display:block;font-size:12px;font-weight:400;color:var(--muted);letter-spacing:2px;margin-top:2px}
.dot{font-size:13px;color:var(--muted);background:var(--card);border:1px solid var(--line);border-radius:999px;padding:6px 14px}
.dot.ok{color:#6f8f6a}
.dot.bad{color:#b3352a}
.card{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:20px 22px;margin-bottom:16px;
  box-shadow:0 6px 20px rgba(140,120,100,.07)}
.card h2{margin:0 0 12px;font-size:15px;font-weight:700;letter-spacing:1px}
.card h2::before{content:"";display:inline-block;width:8px;height:8px;border-radius:999px;background:var(--accent);
  margin-right:8px;vertical-align:1px}
.rows{display:grid;gap:8px}
.row{display:flex;justify-content:space-between;gap:12px;font-size:13px;border-bottom:1px dashed var(--line);padding-bottom:8px}
.row:last-child{border-bottom:none;padding-bottom:0}
.row span{color:var(--muted);flex:none}
.row b{font-weight:600;text-align:right;word-break:break-all}
.hint{margin:0 0 12px;font-size:12px;color:var(--muted)}
label{display:flex;flex-direction:column;gap:6px;font-size:12px;color:var(--muted)}
input,select{font:inherit;font-size:14px;color:var(--ink);background:#fff;border:1px solid var(--line);
  border-radius:12px;padding:9px 12px;outline:none;transition:border-color .2s}
input:focus,select:focus{border-color:var(--accent)}
.grid3{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px}
.actions{display:flex;gap:10px;margin-top:12px;flex-wrap:wrap;align-items:center}
.grow{flex:1;min-width:160px}
.btn{font:inherit;font-size:13px;border-radius:999px;padding:9px 20px;border:1px solid var(--line);background:#fff;
  color:var(--ink);cursor:pointer;transition:border-color .2s,color .2s,filter .2s}
.btn:hover{border-color:var(--accent);color:var(--accent)}
.btn.primary{background:var(--accent);border-color:var(--accent);color:#fff}
.btn.primary:hover{filter:brightness(.95);color:#fff}
.btn.ghost{background:var(--accent-soft);border-color:transparent;color:var(--accent)}
.btn:disabled{opacity:.5;cursor:not-allowed;border-color:var(--line);color:var(--muted)}
.msg{margin:10px 0 0;font-size:12.5px;min-height:18px;color:var(--muted)}
.msg.ok{color:#6f8f6a}
.msg.warn{color:#b3352a}
footer{margin-top:24px;font-size:12px;color:var(--muted);text-align:center}
</style></head><body>
<div class="wrap">
  <header>
    <div class="brand">大肥鱼桌宠<span class="sub">本地服务控制台</span></div>
    <div id="dot" class="dot">连接中…</div>
  </header>

  <section class="card">
    <h2>运行状态</h2>
    <div class="rows">
      <div class="row"><span>服务地址</span><b id="s-addr">—</b></div>
      <div class="row"><span>服务端口</span><b id="s-port">—</b></div>
      <div class="row"><span>服务构建</span><b id="s-build">—</b></div>
      <div class="row"><span>已运行</span><b id="s-uptime">—</b></div>
      <div class="row"><span>AI 服务</span><b id="s-ai">—</b></div>
      <div class="row"><span>当前模型</span><b id="s-model">—</b></div>
      <div class="row"><span>番茄钟</span><b id="s-pomo">—</b></div>
    </div>
  </section>

  <section class="card">
    <h2>番茄钟</h2>
    <p class="hint">开始后桌宠头顶会出现剩余时间角标；专注结束自动进入休息，休息结束回到下一轮专注。</p>
    <div class="grid3">
      <label>任务名<input id="p-task" type="text" placeholder="专注"></label>
      <label>专注（分钟）<input id="p-work" type="number" min="1" max="600" placeholder="25"></label>
      <label>休息（分钟）<input id="p-rest" type="number" min="1" max="600" placeholder="5"></label>
    </div>
    <div class="actions">
      <button id="p-start" class="btn primary">开始专注</button>
      <button id="p-stop" class="btn">停止</button>
      <button id="p-save" class="btn ghost">保存设置</button>
    </div>
    <p class="msg" id="p-msg"></p>
  </section>

  <section class="card">
    <h2>AI 模型</h2>
    <p class="hint">可接本机 Ollama，也可接任意 OpenAI 兼容服务（OpenAI / DeepSeek / 通义千问 / Moonshot / 硅基流动 等）。保存后立即生效，下一句对话即用新配置。</p>
    <div class="grid3">
      <label>服务类型
        <select id="a-provider">
          <option value="ollama">本机 Ollama</option>
          <option value="openai">OpenAI 兼容 API</option>
        </select>
      </label>
      <label>API 地址
        <input id="a-url" type="text" placeholder="http://localhost:11434">
      </label>
      <label>API Key
        <input id="a-key" type="password" placeholder="本地 Ollama 可留空">
      </label>
    </div>
    <div class="actions">
      <select id="m-select" class="grow"></select>
      <button id="m-reload" class="btn ghost">刷新列表</button>
    </div>
    <div class="actions">
      <input id="m-input" type="text" class="grow" placeholder="模型名，如 qwen2.5:3b">
      <button id="m-save" class="btn primary">保存并切换</button>
    </div>
    <p class="msg" id="m-msg"></p>
  </section>

  <section class="card">
    <h2>服务端口</h2>
    <p class="hint">写入 .data/server.json，重启桌宠后生效（端口被占用时启动器会给出日志提示）。</p>
    <div class="actions">
      <input id="o-port" type="number" min="1" max="65535" class="grow">
      <button id="o-save" class="btn primary">保存</button>
    </div>
    <p class="msg" id="o-msg"></p>
  </section>

  <footer>右键桌宠可快速操作：AI 设置 / 番茄钟 / 端口设置 / 对话</footer>
</div>
<script>
var PREFIX = '/dsh-pet-7340';
function $(id){ return document.getElementById(id); }
function get(path){ return fetch(PREFIX + path, {cache:'no-store'}).then(function(r){ return r.json(); }); }
function post(path, body){
  return fetch(PREFIX + path, {method:'POST', headers:{'content-type':'application/json'},
    body: JSON.stringify(body || {}), cache:'no-store'}).then(function(r){ return r.json(); });
}
function say(el, text, ok){
  el.textContent = text || '';
  el.className = 'msg' + (text ? (ok ? ' ok' : ' warn') : '');
}
function fmtUptime(ms){
  var s = Math.floor((ms || 0) / 1000);
  return Math.floor(s / 3600) + ' 小时 ' + Math.floor((s % 3600) / 60) + ' 分 ' + (s % 60) + ' 秒';
}
function fmtRemain(ms){
  var s = Math.max(0, Math.ceil((ms || 0) / 1000));
  return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2);
}
function applyStatus(d){
  var dot = $('dot');
  dot.textContent = '● 服务正常';
  dot.className = 'dot ok';
  $('s-addr').textContent = location.origin + PREFIX;
  $('s-port').textContent = d.port;
  $('s-build').textContent = d.build ? (d.build + '（本次进程加载的代码）') : '—';
  $('s-uptime').textContent = fmtUptime(d.uptimeMs);
  $('s-ai').textContent = (d.provider === 'openai' ? 'OpenAI 兼容 · ' : 'Ollama · ') + (d.aiUrl || '—');
  $('s-model').textContent = d.model || '—';
  var p = d.pomo || {};
  $('s-pomo').textContent = p.state === 'work' ? ('专注中 · ' + (p.task || '') + ' · 剩余 ' + fmtRemain(p.remainMs))
    : p.state === 'rest' ? ('休息中 · 剩余 ' + fmtRemain(p.remainMs)) : '空闲';
  if (document.activeElement !== $('o-port')) $('o-port').value = d.port || '';
  if (document.activeElement !== $('p-task')) $('p-task').value = p.task || '';
}
function tick(){
  get('/health').then(applyStatus).catch(function(){
    var dot = $('dot');
    dot.textContent = '● 连不上本地服务';
    dot.className = 'dot bad';
  });
}
function loadPomoCfg(){
  get('/pomo/config').then(function(d){
    if (d && d.ok && d.config){
      $('p-task').value = d.config.task || '';
      $('p-work').value = d.config.workMin || 25;
      $('p-rest').value = d.config.restMin || 5;
    }
  });
}
function loadModels(auto){
  // 模型列表只有 Ollama 能枚举：OpenAI 兼容模式下不做无意义的探测，直接提示手填
  if ($('a-provider').value === 'openai'){
    var sel0 = $('m-select');
    sel0.innerHTML = '';
    var o0 = document.createElement('option');
    o0.value = '';
    o0.textContent = '（OpenAI 兼容模式：模型名请手动填写）';
    sel0.appendChild(o0);
    sel0.disabled = true;
    say($('m-msg'), '模型名请按服务商文档填写，例如 deepseek-chat / gpt-4o-mini');
    return Promise.resolve();
  }
  if (!auto) say($('m-msg'), '正在读取模型列表…');
  return get('/ai/models').then(function(d){
    var sel = $('m-select');
    sel.innerHTML = '';
    if (d && d.ok && d.models && d.models.length){
      for (var i = 0; i < d.models.length; i++){
        var o = document.createElement('option');
        o.value = d.models[i];
        o.textContent = d.models[i];
        if (d.models[i] === d.current) o.selected = true;
        sel.appendChild(o);
      }
      sel.disabled = false;
      $('m-input').value = d.current || sel.value;
      say($('m-msg'), '共 ' + d.models.length + ' 个已安装模型', true);
    } else {
      var o2 = document.createElement('option');
      o2.value = '';
      o2.textContent = '（拿不到列表）';
      sel.appendChild(o2);
      sel.disabled = true;
      $('m-input').value = (d && d.current) || '';
      say($('m-msg'), '⚠ ' + ((d && d.message) || '拿不到模型列表') +
        '。请确认已运行 ollama serve；仍可在下方手动输入模型名切换。');
    }
  }).catch(function(e){ say($('m-msg'), '⚠ 读取失败：' + e.message); });
}
// 两种后端的差异只在提示与"能否枚举模型"上，其余输入项完全共用
var PROVIDER_HINT = {
  ollama: { url: 'http://localhost:11434', key: '本地 Ollama 可留空' },
  openai: { url: 'https://api.deepseek.com/v1', key: 'sk-…（按服务商要求填写）' }
};
function applyAiProvider(){
  var p = $('a-provider').value === 'openai' ? 'openai' : 'ollama';
  $('a-url').placeholder = PROVIDER_HINT[p].url;
  $('a-key').placeholder = PROVIDER_HINT[p].key;
  // Ollama 才有可枚举的模型列表；OpenAI 兼容模式刷新按钮与下拉框都无意义
  $('m-reload').disabled = (p !== 'ollama');
  if (p === 'openai') $('m-select').disabled = true;
}
function loadAiCfg(){
  get('/ai/config').then(function(d){
    if (!d || !d.ok){ say($('m-msg'), '⚠ 读取 AI 配置失败'); return; }
    $('a-provider').value = d.provider === 'openai' ? 'openai' : 'ollama';
    $('a-url').value = d.url || '';
    $('a-key').value = d.apiKey || '';
    $('m-input').value = d.model || '';
    applyAiProvider();
    loadModels(true);
  }).catch(function(e){ say($('m-msg'), '⚠ 读取 AI 配置失败：' + e.message); });
}
function isKnownDefaultUrl(v){
  return !v || v === PROVIDER_HINT.ollama.url || v === PROVIDER_HINT.openai.url;
}
$('a-provider').onchange = function(){
  var p = $('a-provider').value === 'openai' ? 'openai' : 'ollama';
  // 只在地址还是"空/已知默认值"时换成新后端的默认地址，避免冲掉用户自己填过的地址
  if (isKnownDefaultUrl($('a-url').value.trim())) $('a-url').value = PROVIDER_HINT[p].url;
  applyAiProvider();
  say($('m-msg'), '');
  loadModels(true);
};
$('p-start').onclick = function(){
  post('/pomo/start', {
    task: $('p-task').value.trim() || undefined,
    workMin: Number($('p-work').value) || undefined,
    restMin: Number($('p-rest').value) || undefined
  }).then(function(d){
    say($('p-msg'), d && d.ok ? ('已开始专注：' + (d.task || '')) : ('失败：' + ((d && d.message) || '未知错误')), !!(d && d.ok));
    tick();
  }).catch(function(e){ say($('p-msg'), '失败：' + e.message); });
};
$('p-stop').onclick = function(){
  post('/pomo/stop').then(function(d){
    say($('p-msg'), d && d.ok ? '番茄钟已停止' : ('失败：' + ((d && d.message) || '未知错误')), !!(d && d.ok));
    tick();
  }).catch(function(e){ say($('p-msg'), '失败：' + e.message); });
};
$('p-save').onclick = function(){
  post('/pomo/config', {
    task: $('p-task').value.trim() || '专注',
    workMin: Number($('p-work').value) || 25,
    restMin: Number($('p-rest').value) || 5
  }).then(function(d){
    say($('p-msg'), d && d.ok ? '设置已保存（下次开始生效）' : ('失败：' + ((d && d.message) || '未知错误')), !!(d && d.ok));
  }).catch(function(e){ say($('p-msg'), '失败：' + e.message); });
};
$('m-select').onchange = function(){ $('m-input').value = $('m-select').value; };
$('m-reload').onclick = function(){ loadModels(false); };
$('m-save').onclick = function(){
  var provider = $('a-provider').value === 'openai' ? 'openai' : 'ollama';
  var url = $('a-url').value.trim();
  var model = $('m-input').value.trim();
  if (!url){ say($('m-msg'), '请填写 API 地址'); $('a-url').focus(); return; }
  if (!model){ say($('m-msg'), '请先选择或输入模型名'); $('m-input').focus(); return; }
  post('/ai/config', {provider: provider, url: url, model: model, apiKey: $('a-key').value.trim()})
    .then(function(d){
      if (d && d.ok){
        tick();
        // 先刷新列表，再把保存结果作为最终提示——否则「已保存」会被紧接着的「共 N 个已安装模型」盖掉
        loadModels(true).then(function(){
          say($('m-msg'), '已保存：' + (d.provider === 'openai' ? 'OpenAI 兼容' : 'Ollama') + ' · ' + d.model, true);
        });
      } else {
        say($('m-msg'), '保存失败：' + ((d && d.message) || '未知错误'));
      }
    }).catch(function(e){ say($('m-msg'), '保存失败：' + e.message); });
};
$('o-save').onclick = function(){
  var port = Number($('o-port').value);
  if (!(port >= 1 && port <= 65535)){ say($('o-msg'), '端口必须是 1-65535 之间的整数'); return; }
  post('/server/port', {port: port}).then(function(d){
    if (d && d.ok){
      say($('o-msg'), d.restartRequired ? ('已保存为 ' + port + '，重启桌宠后生效') : ('端口已是 ' + port + '，无需改动'), true);
    } else {
      say($('o-msg'), '保存失败：' + ((d && d.message) || '未知错误'));
    }
  }).catch(function(e){ say($('o-msg'), '保存失败：' + e.message); });
};
tick();
loadPomoCfg();
loadAiCfg();
setInterval(tick, 2000);
</script>
</body></html>`;
}

// ---------- 路由 ----------
const sendJson = (res, status, body) => {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
  });
  res.end(payload);
};

async function handleRoute(url, method, bodyText) {
  const u = new URL(url, 'http://localhost');
  const pathname = decodeURIComponent(u.pathname);
  const pet = u.searchParams.get('pet') || 'main';

  // 配置
  if (pathname === PREFIX + '/config' || pathname === PREFIX + '/config.jsonc') {
    return { json: { main: getConfig() } };
  }

  // 番茄钟控制（第二阶段菜单用）
  if (pathname === PREFIX + '/pomo/start' && method === 'POST') {
    try {
      const body = JSON.parse(bodyText || '{}');
      const cfg = getPomoCfg();
      const task = (typeof body.task === 'string' && body.task.trim()) ? body.task.trim() : (cfg.task || '背单词');
      startPomo(cfg, task, Number(body.workMin) || 0, Number(body.restMin) || 0);
      return { json: { ok: true, state: pomo.state, task: pomo.task } };
    } catch (e) {
      return { json: { ok: false, message: String(e.message || e) } };
    }
  }
  if (pathname === PREFIX + '/pomo/stop' && method === 'POST') {
    stopPomo();
    return { json: { ok: true } };
  }
  if (pathname === PREFIX + '/pomo/status') {
    const cfg = getPomoCfg();
    const running = pomo.state === 'work' || pomo.state === 'rest';
    return {
      json: {
        ok: true,
        state: pomo.state,
        task: pomo.task,
        endsAt: pomo.endsAt,
        remainMs: running ? Math.max(0, pomo.endsAt - Date.now()) : 0,
        enabled: cfg.enabled === true,
        workMin: cfg.workMin || 25,
        restMin: cfg.restMin || 5,
      },
    };
  }
  // 番茄钟配置（右键「番茄钟 → 设置时长」写入 assets/pomo.json）
  // 注意：enabled 只决定下次启动是否自动开始，不影响当前这一轮
  if (pathname === PREFIX + '/pomo/config') {
    if (method === 'POST') {
      try {
        const body = JSON.parse(bodyText || '{}');
        const cfg = getPomoCfg();
        if (typeof body.task === 'string' && body.task.trim()) cfg.task = body.task.trim();
        for (const k of ['workMin', 'restMin']) {
          const n = Number(body[k]);
          if (Number.isFinite(n) && n > 0 && n <= 600) cfg[k] = Math.round(n);
        }
        if (typeof body.enabled === 'boolean') cfg.enabled = body.enabled;
        writeFileSync(POMO_FILE, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
        console.log('[pet-server] 番茄钟配置更新: ' + JSON.stringify(cfg));
        return { json: { ok: true, config: cfg } };
      } catch (e) {
        return { json: { ok: false, message: String(e.message || e) } };
      }
    }
    return { json: { ok: true, config: getPomoCfg() } };
  }

  // 健康检查：客户端 3s 探测一次，连续失败即在气泡上告警（连接失败必须可见，不再静默）
  if (pathname === PREFIX + '/health') {
    const running = pomo.state === 'work' || pomo.state === 'rest';
    return {
      json: {
        ok: true,
        port: PORT,
        build: BUILD,
        uptimeMs: Math.round(process.uptime() * 1000),
        model: aiCfg.model,
        provider: aiCfg.provider,
        aiUrl: aiCfg.url,
        pomo: {
          enabled: getPomoCfg().enabled === true,
          state: pomo.state,
          task: pomo.task,
          remainMs: running ? Math.max(0, pomo.endsAt - Date.now()) : 0,
        },
      },
    };
  }

  // AI 配置（服务控制台「AI 模型」卡片 / 右键「AI 设置」换模型用）
  // 局部更新语义：只覆盖 body 里出现的字段——右键弹窗只发 {model}，不会把 provider/url/apiKey 冲掉。
  if (pathname === PREFIX + '/ai/config') {
    if (method === 'POST') {
      try {
        const body = JSON.parse(bodyText || '{}');
        if (body.provider === 'ollama' || body.provider === 'openai') aiCfg.provider = body.provider;
        if (typeof body.model === 'string' && body.model.trim()) aiCfg.model = body.model.trim();
        if (typeof body.url === 'string' && body.url.trim()) aiCfg.url = body.url.trim().replace(/\/$/, '');
        // apiKey 允许传空串：从外部 API 切回本机 Ollama 时要能把它清掉
        if (typeof body.apiKey === 'string') aiCfg.apiKey = body.apiKey.trim();
        saveAiCfg();
        console.log(
          '[pet-server] AI 配置更新: provider=' + aiCfg.provider + ' model=' + aiCfg.model + ' url=' + aiCfg.url,
        );
        return { json: { ok: true, provider: aiCfg.provider, model: aiCfg.model, url: aiCfg.url, apiKey: aiCfg.apiKey } };
      } catch (e) {
        return { json: { ok: false, message: String(e.message || e) } };
      }
    }
    // GET 回传真实 apiKey：服务只监听 127.0.0.1，且控制台要把当前 Key 回填进输入框才能修改
    return { json: { ok: true, provider: aiCfg.provider, model: aiCfg.model, url: aiCfg.url, apiKey: aiCfg.apiKey } };
  }

  // 已安装模型列表（右键「AI 设置」下拉用）：代理 Ollama GET /api/tags。
  // Ollama 不可达时返回 ok:false + 中文原因（弹窗据此提示"Ollama 没起来"），绝不伪造空列表——
  // 空列表会让用户以为"本地没有模型"，而真正的原因是服务没启动。
  if (pathname === PREFIX + '/ai/models') {
    // 模型列表只有 Ollama 能枚举；OpenAI 兼容服务的可用模型名各家不同（且 /v1/models 支持情况不一），
    // 如实说明并让用户按服务商文档手填，不去猜一个可能不存在的列表。
    if (isOpenAi()) {
      return {
        json: {
          ok: false,
          provider: 'openai',
          current: aiCfg.model,
          url: aiCfg.url,
          message: '当前使用 OpenAI 兼容服务，模型名请按服务商文档手动填写',
        },
      };
    }
    try {
      const res = await fetch(aiCfg.url + '/api/tags', { signal: AbortSignal.timeout(4000) });
      if (!res.ok) {
        return { json: { ok: false, current: aiCfg.model, message: 'Ollama HTTP ' + res.status } };
      }
      const data = await res.json();
      const models = (Array.isArray(data.models) ? data.models : [])
        .map((m) => (m && typeof m.name === 'string' ? m.name : ''))
        .filter(Boolean);
      return { json: { ok: true, current: aiCfg.model, url: aiCfg.url, models } };
    } catch (e) {
      return {
        json: {
          ok: false,
          current: aiCfg.model,
          url: aiCfg.url,
          message: '连不上 Ollama（' + aiCfg.url + '）：' + (e && e.message ? e.message : String(e)),
        },
      };
    }
  }

  // 服务端口：GET 读当前生效端口 + 配置文件里的端口；POST 写入 .data/server.json（**重启后生效**）。
  // 端口是进程启动参数，运行期无法热改——POST 只落盘，返回 restartRequired 让客户端如实告知用户。
  if (pathname === PREFIX + '/server/port') {
    if (method === 'POST') {
      try {
        const body = JSON.parse(bodyText || '{}');
        const n = Number(body.port);
        if (!Number.isInteger(n) || n <= 0 || n > 65535) {
          return { json: { ok: false, message: '端口必须是 1-65535 之间的整数' } };
        }
        writeFileSync(SERVER_CFG_FILE, JSON.stringify({ port: n }, null, 2), 'utf8');
        console.log('[pet-server] 端口配置已写入 ' + SERVER_CFG_FILE + '：' + n + '（重启后生效）');
        return { json: { ok: true, port: PORT, configured: n, restartRequired: n !== PORT } };
      } catch (e) {
        return { json: { ok: false, message: String(e.message || e) } };
      }
    }
    return { json: { ok: true, port: PORT, configured: readConfiguredPort() || PORT } };
  }

  // 碎碎念
  if (pathname === PREFIX + '/whisper' || pathname === PREFIX + '/whisper/trigger') {
    const manual = pathname.endsWith('/trigger');
    await generateWhisper(manual);
    if (!whisperCache.text) {
      return { json: { ok: false, reason: 'generate-error', message: '本地模型暂不可用' } };
    }
    return { json: { ok: true, text: whisperCache.text, ts: whisperCache.ts } };
  }

  // 对话
  if (pathname === PREFIX + '/chat') {
    if (method === 'POST') {
      let text = '';
      try {
        text = String(JSON.parse(bodyText || '{}').text || '').trim();
      } catch {
        return { json: { ok: false, reason: 'bad-request', message: '请求体非法' } };
      }
      if (!text) return { json: { ok: false, reason: 'bad-request', message: '空消息' } };
      const mem = loadMemory();
      const history = (mem[pet] || []).slice(-(getConfig().chatMemoryRounds || 5) * 2);
      const messages = [{ role: 'system', content: WHISPER_SYSTEM() }];
      for (const m of history) messages.push({ role: m.role, content: m.content });
      messages.push({ role: 'user', content: text });
      try {
        const reply = await chatCompletion(messages, { num_predict: 200 });
        const list = mem[pet] || [];
        list.push({ role: 'user', content: text, ts: Date.now() });
        list.push({ role: 'assistant', content: reply, ts: Date.now() });
        mem[pet] = list.slice(-200);
        saveMemory(mem);
        console.log('[pet-server] chat reply:', reply.slice(0, 40));
        return { json: { ok: true, reply, ts: Date.now() } };
      } catch (e) {
        return { json: { ok: false, reason: 'generate-error', message: String(e.message || e) } };
      }
    }
    // GET：返回最近记忆窗口（renderer 兼容用）
    const mem = loadMemory();
    return { json: { ok: true, messages: (mem[pet] || []).slice(-10) } };
  }

  // 气泡广播（/chat 命令用；我们无命令系统，恒空）
  if (pathname === PREFIX + '/broadcast') {
    return { json: { ok: true, ts: 0 } };
  }

  // 工作状态（番茄钟驱动）
  if (pathname === PREFIX + '/work-status') {
    return { json: workStatus };
  }

  // 余额（关闭，固定返回；balanceEnabled=false 时 renderer 不轮询）
  if (pathname === PREFIX + '/balance') {
    return { json: { ok: true, provider: 'deepseek', kind: 'deepseek', data: { currency: 'CNY', total: '0.00', granted: '0.00', toppedUp: '0.00' } } };
  }
  if (pathname === PREFIX + '/balance/trigger') {
    return { json: { count: 0 } };
  }

  // 表情包池（配图开关已关，renderer 基本不请求）
  if (pathname === PREFIX + '/memes') {
    return { json: { ok: true, memes: {} } };
  }

  // 通知（浏览器半侧能力，桌面不用）
  if (pathname === PREFIX + '/notify') {
    return { json: { ok: true, ts: 0 } };
  }

  // 动画素材：/thumb/<petId>/<file>.webm
  if (pathname.startsWith(PREFIX + '/thumb/')) {
    let rel = pathname.slice((PREFIX + '/thumb/').length);
    const slash = rel.indexOf('/');
    rel = slash >= 0 ? rel.slice(slash + 1) : rel;
    if (!rel || !/\.(webm|mov)$/i.test(rel)) {
      return { text: 'bad path', status: 400 };
    }
    const file = safeResolve(WEBM_ROOT, rel);
    if (!file) return { text: 'bad path', status: 400 };
    if (!existsSync(file)) return { text: 'asset not found', status: 404 };
    return { file, contentType: 'video/webm' };
  }

  // 通知图标 / 表情包：/pic/<file> 与 /pic/memes/<name>.png
  if (pathname.startsWith(PREFIX + '/pic/')) {
    let rel = pathname.slice((PREFIX + '/pic/').length);
    if (rel.startsWith('memes/')) {
      const file = safeResolve(MEMES_DIR, rel.slice('memes/'.length));
      if (!file) return { text: 'bad path', status: 400 };
      return { file, contentType: 'image/png' };
    }
    const file = safeResolve(PIC_DIR, rel);
    if (!file) return { text: 'bad path', status: 400 };
    const type = /\.png$/i.test(file) ? 'image/png' : /\.svg$/i.test(file) ? 'image/svg+xml' : 'application/octet-stream';
    return { file, contentType: type };
  }

  // 字体：/font/<file>
  if (pathname.startsWith(PREFIX + '/font/')) {
    const rel = pathname.slice((PREFIX + '/font/').length);
    const file = safeResolve(FONTS_DIR, rel);
    if (!file) return { text: 'bad path', status: 400 };
    const type = /\.(woff2?|ttf|otf)$/i.test(file)
      ? (/\.woff2$/i.test(file) ? 'font/woff2' : /\.woff$/i.test(file) ? 'font/woff' : 'font/ttf')
      : 'application/octet-stream';
    return { file, contentType: type };
  }

  // 根路径：右键「服务控制台」用系统浏览器打开（可操作番茄钟 / 模型 / 端口，见 consolePage）
  if (pathname === '/' || pathname === '/index.html') {
    return { html: consolePage() };
  }

  return { text: `pet-server: not found ${pathname}`, status: 404 };
}

// ---------- HTTP 服务器 ----------
const server = createServer(async (req, res) => {
  // CORS：桌面 renderer 是 file:// 页面，fetch JSON 必须放行跨源（视频/字体不受此限）
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  let bodyText = '';
  if (req.method === 'POST' || req.method === 'PUT') {
    for await (const chunk of req) bodyText += chunk;
  }
  try {
    const result = await handleRoute(req.url ?? '/', req.method ?? 'GET', bodyText);
    if (result?.json) sendJson(res, 200, result.json);
    else if (result?.file) serveFile(res, result.file, result.contentType);
    else if (result?.html) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(result.html);
    } else res.writeHead(result?.status ?? 404, { 'content-type': 'text/plain; charset=utf-8' }).end(result?.text ?? 'not found');
  } catch (e) {
    console.error('[pet-server] route error:', e);
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' }).end('pet-server error: ' + String(e.message || e));
  }
});

// 启动失败要让启动器与用户看得懂：端口被占是最常见的一种
server.on('error', (e) => {
  if (e && e.code === 'EADDRINUSE') {
    console.error(`[pet-server] 端口 ${PORT} 已被占用（可能已有一个 pet-server 在运行，或该端口被其它程序占用）。`);
    console.error('[pet-server] 处理：关闭占用该端口的程序，或在右键菜单「端口设置」中改用其它端口后重启。');
  } else {
    console.error('[pet-server] 服务器错误：', e);
  }
  process.exit(1);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[pet-server] listening on http://127.0.0.1:${PORT}${PREFIX}/`);
  // 构建标识：日志里能直接看出"这个进程加载的是哪份源码"，排查新旧混跑时不用再猜
  console.log(`[pet-server] build:    ${BUILD}（本进程启动时加载的源码指纹）`);
  console.log(`[pet-server] config:  http://127.0.0.1:${PORT}${PREFIX}/config`);
  console.log(`[pet-server] assets:  ${WEBM_ROOT}`);
  console.log(
    `[pet-server] ai:      ${providerName()}(${aiCfg.provider}) ${aiCfg.url}  model=${aiCfg.model}` +
      (aiCfg.apiKey ? '  key=已配置' : ''),
  );
  console.log(`[pet-server] pomo:    ${getPomoCfg().enabled ? 'ON (' + getPomoCfg().task + ' ' + getPomoCfg().workMin + 'min)' : 'OFF'}`);
});
