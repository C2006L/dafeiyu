#!/usr/bin/env node
/**
 * ollama-pet-server.mjs —— dafeiyu 独立宿主服务器（无 DSH 版）
 *
 * 让 dsh-pet 的桌面模式（Electron 透明窗）完全脱离 DeepSeek Harness 运行：
 *   - 素材 / 配置：直接读本包 assets/
 *   - 碎碎念 / 对话：调用本地 Ollama（默认 qwen2.5:3b）
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
 */
import { createServer } from 'node:http';
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
let aiCfg = { model: OLLAMA_MODEL, url: OLLAMA_URL };
try {
  aiCfg = Object.assign(aiCfg, JSON.parse(readFileSync(AI_CFG_FILE, 'utf8')));
} catch { /* 首次运行，用默认 */ }
function saveAiCfg() {
  try {
    writeFileSync(AI_CFG_FILE, JSON.stringify(aiCfg, null, 2), 'utf8');
  } catch (e) {
    console.error('[pet-server] save ai cfg failed:', String(e));
  }
}

// ---------- Ollama 调用 ----------
async function ollamaChat(messages, opts = {}) {
  const res = await fetch(aiCfg.url + '/api/chat', {
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
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Ollama HTTP ${res.status}: ${txt.slice(0, 80)}`);
  }
  const data = await res.json();
  const text = String(data?.message?.content ?? '').trim();
  if (!text) throw new Error('Ollama 未返回文本');
  return text;
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
    const text = await ollamaChat([
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
      void ollamaChat([
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
      void ollamaChat([
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
      <div class="row"><span>已运行</span><b id="s-uptime">—</b></div>
      <div class="row"><span>Ollama 地址</span><b id="s-ollama">—</b></div>
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
    <p class="hint">列表来自本机 Ollama，切换后立即生效（下一句对话即用新模型）。</p>
    <div class="actions">
      <select id="m-select" class="grow"></select>
      <button id="m-reload" class="btn ghost">刷新列表</button>
    </div>
    <div class="actions">
      <input id="m-input" type="text" class="grow" placeholder="模型名，如 qwen2.5:3b">
      <button id="m-save" class="btn primary">切换</button>
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
  $('s-uptime').textContent = fmtUptime(d.uptimeMs);
  $('s-ollama').textContent = d.ollamaUrl || '—';
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
  if (!auto) say($('m-msg'), '正在读取模型列表…');
  get('/ai/models').then(function(d){
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
  var model = $('m-input').value.trim();
  if (!model){ say($('m-msg'), '请先选择或输入模型名'); return; }
  post('/ai/config', {model: model}).then(function(d){
    if (d && d.ok){
      say($('m-msg'), '模型已切换为 ' + d.model, true);
      tick();
      loadModels(true);
    } else {
      say($('m-msg'), '切换失败：' + ((d && d.message) || '未知错误'));
    }
  }).catch(function(e){ say($('m-msg'), '切换失败：' + e.message); });
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
loadModels(true);
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
        uptimeMs: Math.round(process.uptime() * 1000),
        model: aiCfg.model,
        ollamaUrl: aiCfg.url,
        pomo: {
          enabled: getPomoCfg().enabled === true,
          state: pomo.state,
          task: pomo.task,
          remainMs: running ? Math.max(0, pomo.endsAt - Date.now()) : 0,
        },
      },
    };
  }

  // AI 配置（右键「AI 设置」换模型用）
  if (pathname === PREFIX + '/ai/config') {
    if (method === 'POST') {
      try {
        const body = JSON.parse(bodyText || '{}');
        if (typeof body.model === 'string' && body.model.trim()) aiCfg.model = body.model.trim();
        if (typeof body.url === 'string' && body.url.trim()) aiCfg.url = body.url.trim().replace(/\/$/, '');
        saveAiCfg();
        console.log('[pet-server] AI 配置更新: model=' + aiCfg.model + ' url=' + aiCfg.url);
        return { json: { ok: true, model: aiCfg.model, url: aiCfg.url } };
      } catch (e) {
        return { json: { ok: false, message: String(e.message || e) } };
      }
    }
    return { json: { ok: true, model: aiCfg.model, url: aiCfg.url } };
  }

  // 已安装模型列表（右键「AI 设置」下拉用）：代理 Ollama GET /api/tags。
  // Ollama 不可达时返回 ok:false + 中文原因（弹窗据此提示"Ollama 没起来"），绝不伪造空列表——
  // 空列表会让用户以为"本地没有模型"，而真正的原因是服务没启动。
  if (pathname === PREFIX + '/ai/models') {
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
        const reply = await ollamaChat(messages, { num_predict: 200 });
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
  console.log(`[pet-server] config:  http://127.0.0.1:${PORT}${PREFIX}/config`);
  console.log(`[pet-server] assets:  ${WEBM_ROOT}`);
  console.log(`[pet-server] ollama:  ${aiCfg.url}  model=${aiCfg.model}`);
  console.log(`[pet-server] pomo:    ${getPomoCfg().enabled ? 'ON (' + getPomoCfg().task + ' ' + getPomoCfg().workMin + 'min)' : 'OFF'}`);
});
