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

const PORT = Number(process.argv[2] || process.env.PET_PORT || 8231);
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
    return { json: { ok: true, state: pomo.state, task: pomo.task } };
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

  // 根路径：右键「打开网站」用系统浏览器打开的信息页
  if (pathname === '/' || pathname === '/index.html') {
    const p = pomo.state === 'work' ? '🍅 学习中（' + pomo.task + '）' : pomo.state === 'rest' ? '🍵 休息中' : '⏳ 空闲';
    return {
      html:
        '<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8"><title>大肥鱼桌宠服务</title>' +
        '<style>body{font-family:system-ui,"Microsoft YaHei",sans-serif;background:#f4f6fb;color:#2b2b2b;' +
        'margin:0;padding:40px;max-width:720px;margin:auto}h1{color:#5686fe}p{line-height:1.8}.card{' +
        'background:#fff;border-radius:14px;padding:20px 24px;margin:16px 0;box-shadow:0 6px 20px rgba(0,0,0,.06)}' +
        'code{background:#eef1f8;padding:2px 8px;border-radius:6px;font-size:.92em}</style></head><body>' +
        '<h1>🐋 大肥鱼桌宠 · 本地服务</h1>' +
        '<div class="card"><p><b>运行状态：</b>✅ 正常</p><p><b>番茄钟：</b>' + p + '</p></div>' +
        '<div class="card"><p><b>AI 模型：</b><code>' + aiCfg.model + '</code></p>' +
        '<p><b>Ollama 地址：</b><code>' + aiCfg.url + '</code></p></div>' +
        '<div class="card"><p>桌宠本体在桌面上运行（Electron 透明窗），这里是它的配套服务：负责本地 AI 对话、' +
        '碎碎念、番茄钟督促和动画素材。右键桌宠菜单可随时「AI 设置」切换模型。</p></div>' +
        '</body></html>',
    };
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

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[pet-server] listening on http://127.0.0.1:${PORT}${PREFIX}/`);
  console.log(`[pet-server] config:  http://127.0.0.1:${PORT}${PREFIX}/config`);
  console.log(`[pet-server] assets:  ${WEBM_ROOT}`);
  console.log(`[pet-server] ollama:  ${aiCfg.url}  model=${aiCfg.model}`);
  console.log(`[pet-server] pomo:    ${getPomoCfg().enabled ? 'ON (' + getPomoCfg().task + ' ' + getPomoCfg().workMin + 'min)' : 'OFF'}`);
});
