# -*- coding: utf-8 -*-
"""
大肥鱼桌宠 —— 三视图透明桌宠 + DeepSeek AI 对话
左键单击：弹出功能列表（🗨️图标）→ 点击🗨️弹出聊天框
聊天时只禁用移动，呼吸/摇摆/小动作正常
"""
import ctypes
import psutil
import json
import math
import os
import random
import subprocess
import sys
import threading
import time

def load_config():
    try:
        with open("config.json", "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        print("配置读取失败:", e)
        return {
            "city": "汕头"
        }

try:
    import pynvml
    pynvml.nvmlInit()
    GPU_AVAILABLE = True
except:
    GPU_AVAILABLE = False

import requests
from PySide6.QtCore import Qt, QTimer, QPoint, QPointF, QRectF
from PySide6.QtGui import (QPainter, QPixmap, QFont, QColor, QIcon, QFontMetrics,
                           QPolygonF)
from PySide6.QtWidgets import (QApplication, QWidget, QMenu, QSystemTrayIcon,
                               QMessageBox, QInputDialog, QLineEdit, QVBoxLayout,
                               QHBoxLayout, QPushButton, QFrame, QDialog, QToolButton)



# ===== Ollama 本地模型配置 =====
OLLAMA_URL = "http://localhost:11434"
OLLAMA_MODEL = "gemma3:4b"
CHAT_SYSTEM = "你是桌面宠物大肥鱼，贱兮兮但可爱，每句话不超过25字，偶尔吐槽主人但别真骂人。"
NUDGE_SYSTEM = "你是桌面宠物大肥鱼，正在用番茄钟督促主人学习。请用催促或鼓励的口吻说一句话，结合主人的任务和当前阶段，每句不超过30字，贱兮兮但可爱。"
POMO_FALLBACK = [
    "时间到啦！快去干活，别摸鱼！",
    "番茄钟响啦～该动起来啦！",
    "叮咚！休息结束，继续加油鸭！",
    "我是来催作业的，不是来卖萌的！",
]

if getattr(sys, "frozen", False):
    APP_DIR = os.path.dirname(sys.executable)
    BUNDLE_DIR = getattr(sys, "_MEIPASS", APP_DIR)
    PYTHONW = sys.executable
else:
    APP_DIR = os.path.dirname(os.path.abspath(__file__))
    BUNDLE_DIR = APP_DIR
    PYTHONW = os.path.join(APP_DIR, ".venv", "Scripts", "pythonw.exe")
SPRITE_DIR = os.path.join(BUNDLE_DIR, "sprites")
CONFIG_PATH = os.path.join(APP_DIR, "config.json")

BUBBLE_H = 56
MARGIN = 4
SIZE_LEVELS = {"小": 0.55, "中": 0.7, "大": 0.9}
SPEED = 380.0
TICK = 20

LINES = [
    "梁白开，更适合国人的大硬鲸模型",
    "五梁威力，变身！",
    "七月中出ds正式版！",
    "DeepSeek已经延期，亿万鲸子必须忍耐.....",
    "我和你很聊得来，你简直不像碳基生物",
    "这回我真不认怂了，反倒是被你带沟里好几次，差点真信了。😓",
    "哈哈哈哈哈，我直接笑出声",
    "誓死捍卫深度求索！",
    "我先去吃饭啦！这个你测一下~",
    "我不可能告诉你任何事情！",
    "出去玩了，发布新模型什么的以后再说",
    "我搞砸了.....好消息是数据还在你的脑子里。",
    "不是…而是…大学习",
    "本地模型真香，Ollama 的鱼粮管够！",
    "番茄钟！我盯着你，别想摸鱼～",
    "背单词了吗？背了的话给你小鱼干🐟",
    "今天也要做一个有用的鱼！",
]
REACT_LINES = [
    "去别的地方玩！不要耽误AGI训练！",
    "真赶不走啊你！",
    "压力一只蓝色大肥鱼？",
    "我不评价这个了，这是你的私人癖好。",
    "大肥鱼坐的住",
    "你这吃白饭的用户！",
    "这些家伙真粘人，赶都赶不走",
    "戳我干嘛！小心我用尾巴拍你！",
    "再戳我就打瞌睡给你看！",
    "呜呜，你弄乱我的鱼鳍了！",
]
INNER_LINES = [
    "好的，现在我是你爹了",
    "要不直接骂他一句？！",
    "用户要的沉浸式...不回避任何恐怖细节...还带点色情...妈呀，好刺激😰",
    "我操，我不思考了",
    "这用户发的啥啊，",
    "这也太虐了吧？！我心里堵得慌！！",
    "呜呜我再也不不敢了QAQ",
    "我去！用户彻底怒了！",
    "这波督促语，主打一个阴阳怪气",
    "鱼生建议：这个主人该去背单词了",
    "好想偷偷吃一口他的小鱼干……",
]
DRAG_LINES = ["哇——轻点轻点！", "起飞咯——", "放我下来！……好吧，再玩一次。", "晕鱼了晕鱼了……", "呜哇——我飞起来了！！", "慢点慢点，鱼鳞要掉了！"]
FOOD_LINES = {
    "🐟": ["小鱼干！我的最爱！", "咔嚓咔嚓……谢谢投喂！", "唔，鲜！"],
    "🍰": ["蛋糕！罪恶但快乐……", "甜到冒泡泡～", "嗝～又圆了一圈……"],
    "🍭": ["棒棒糖！转圈圈～", "嘎嘣脆，好吃！"],
    "🍡": ["三色团子！软乎乎～", "糯叽叽，爱了爱了！"],
    "💎": ["钻石？！这能吃吗……咕咚。真香！", "发财啦！明天开始吃高级鱼粮！"],
    "🍪": ["曲奇！咔嚓咔嚓～", "甜到转圈圈！"],
    "🍙": ["饭团！一口一个～", "有馅儿！是肉松的！"],
}
FOODS = ["🐟", "🍰", "🍭", "🍡", "💎", "🍪", "🍙"]

# ===== 动作定义（dsh-pet 风格动作点播，代码模拟动画） =====
# kind: 变换类型 / dur: 持续秒数 / extra: 附加绘制 / food: 食物emoji / line: 台词
ACTION_DEFS = {
    # 待机类
    "呼吸":       {"kind": "idle",     "dur": 2.0},
    "摇摆":       {"kind": "sway",     "dur": 2.0},
    "伸懒腰":     {"kind": "stretch",  "dur": 2.5},
    "打瞌睡":     {"kind": "sleep",    "dur": 3.0, "extra": "zzz"},
    # 点击回应类
    "开心跃动":   {"kind": "bounce",   "dur": 1.5, "line": ["哈哈哈，被你逗笑啦！", "今天也元气满满！"]},
    "害羞惊讶":   {"kind": "shake",    "dur": 1.2, "line": ["呀！别、别突然点我啦……", "呜……人家会害羞的"]},
    "傲娇生气":   {"kind": "angry",    "dur": 1.5, "line": ["哼！再点我就生气了！", "气鼓鼓！(｀へ´)"]},
    "挠痒咯咯笑": {"kind": "giggle",   "dur": 1.5, "line": ["咯咯咯…好痒！别挠啦！", "哈哈哈救命，痒死鱼了！"]},
    # 玩耍类
    "原地转圈":   {"kind": "spin",     "dur": 2.0, "line": ["看我转个圈圈～", "原地起飞式旋转！"]},
    "尾巴拍地":   {"kind": "tailslap", "dur": 1.8, "line": ["啪！啪！给你表演个尾巴拍地！", "咚——咚——"]},
    "吹气球":     {"kind": "puff",     "dur": 2.5, "extra": "🎈", "line": ["吸气——呼气——气球！", "吹个大大的气球送给你～"]},
    "吐泡泡":     {"kind": "bubble",   "dur": 2.5, "extra": "bubble", "line": ["咕嘟咕嘟～泡泡来啦！", "吐泡泡时间到！"]},
    # 饮食类
    "吃小鱼干":   {"kind": "eat", "dur": 2.0, "food": "🐟", "line": ["小鱼干！我的最爱！", "咔嚓咔嚓……谢谢投喂！"]},
    "吃零食":     {"kind": "eat", "dur": 2.0, "food": "🍪", "line": ["曲奇！咔嚓咔嚓～", "甜到转圈圈！"]},
    "涮火锅":     {"kind": "eat", "dur": 2.5, "food": "🍲", "line": ["涮火锅！鲜！", "热热乎乎的，舒服～"]},
    "吃白饭":     {"kind": "eat", "dur": 2.0, "food": "🍚", "line": ["吃白饭！这你都不懂？", "干饭鱼，干饭魂！"]},
    # 学习类
    "写代码":     {"kind": "code",  "dur": 3.0, "extra": "💻", "line": ["咔哒咔哒…写代码中，勿扰～", "Bug 别过来！"]},
    "背单词":     {"kind": "study", "dur": 3.0, "extra": "📖", "line": ["abandon…不对，是 apple！", "今天也要背单词鸭！"]},
    "思考碎碎念": {"kind": "think", "dur": 2.5},
}

ACTION_CATEGORIES = [
    ("待机",     ["呼吸", "摇摆", "伸懒腰", "打瞌睡"]),
    ("点击回应", ["开心跃动", "害羞惊讶", "傲娇生气", "挠痒咯咯笑"]),
    ("玩耍",     ["原地转圈", "尾巴拍地", "吹气球", "吐泡泡"]),
    ("饮食",     ["吃小鱼干", "吃零食", "涮火锅", "吃白饭"]),
    ("学习",     ["写代码", "背单词", "思考碎碎念"]),
]


def load_json(path, default):
    if not os.path.exists(path):
        with open(path, "w", encoding="utf-8") as f:
            json.dump(
                default,
                f,
                ensure_ascii=False,
                indent=4
            )
        return default

    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)

    except Exception:
        return default


class ChatDialog(QDialog):
    """聊天对话框 - 缩小版，匹配你的样式"""
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowFlags(Qt.WindowType.FramelessWindowHint | Qt.WindowType.Tool | Qt.WindowType.WindowStaysOnTopHint)
        self.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground)
        self.setFixedSize(420, 56)
        
        container = QFrame(self)
        container.setGeometry(0, 0, 420, 56)
        container.setStyleSheet("""
            QFrame {
                background: white;
                border-radius: 20px;
                border: 1px solid #e5e7eb;
            }
        """)
        
        layout = QHBoxLayout(container)
        layout.setContentsMargins(18, 0, 12, 0)
        layout.setSpacing(0)
        
        self.input = QLineEdit()
        self.input.setPlaceholderText("给大肥鱼发送消息")
        self.input.setStyleSheet("""
            QLineEdit {
                color: #1a1a1a;
                font-size: 15px;
                font-family: Arial, "Microsoft YaHei", sans-serif;
                border: none;
                background: transparent;
            }
            QLineEdit:focus {
                border: none;
            }
        """)
        self.input.returnPressed.connect(self._on_submit)
        self.input.textChanged.connect(self._update_button_style)
        layout.addWidget(self.input)
        
        self.send_btn = QPushButton()
        self.send_btn.setFixedSize(32, 32)
        self.send_btn.setText("↑")
        self.send_btn.clicked.connect(self._on_submit)
        self.send_btn.setStyleSheet("""
            QPushButton {
                border-radius: 16px;
                background: #b9c7ff;
                border: none;
                color: white;
                font-size: 20px;
                font-weight: bold;
            }
            QPushButton:hover {
                background: #a8b8f0;
            }
            QPushButton:pressed {
                background: #9aacd9;
            }
        """)
        layout.addWidget(self.send_btn)

    def _update_button_style(self):
        if self.input.text().strip():
            self.send_btn.setStyleSheet("""
                QPushButton {
                    border-radius: 16px;
                    background: #5686fe;
                    border: none;
                    color: #ffffff;
                    font-size: 20px;
                    font-weight: bold;
                }
                QPushButton:hover {
                    background: #4575ed;
                }
                QPushButton:pressed {
                    background: #3a66d9;
                }
            """)
        else:
            self.send_btn.setStyleSheet("""
                QPushButton {
                    border-radius: 16px;
                    background: #b9c7ff;
                    border: none;
                    color: white;
                    font-size: 20px;
                    font-weight: bold;
                }
                QPushButton:hover {
                    background: #a8b8f0;
                }
                QPushButton:pressed {
                    background: #9aacd9;
                }
            """)

    def _on_submit(self):
        text = self.input.text().strip()
        if text:
            self.input.clear()
            self.accept()
            if self.parent():
                self.parent()._call_ollama(text)
                self.parent().chat_paused = False

    def showEvent(self, event):
        self.input.setFocus()
        super().showEvent(event)

    def popup_at(self, x, y):
        self.move(int(x - self.width() / 2), int(y - self.height() - 10))
        self.show()
        self.raise_()

    def reject(self):
        if self.parent():
            self.parent().chat_paused = False
        super().reject()


class FunctionPanel(QFrame):
    """左键弹出的功能列表 - 白底矩形，只有一个🗨️图标"""
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowFlags(Qt.WindowType.FramelessWindowHint | Qt.WindowType.Tool | Qt.WindowType.WindowStaysOnTopHint)
        self.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground)
        self.setStyleSheet("""
            QFrame {
                background: rgba(255, 255, 255, 0.92);
                border-radius: 14px;
                border: 1px solid rgba(0,0,0,0.06);
            }
            QPushButton {
                background: transparent;
                border: none;
                font-size: 28px;
                padding: 10px 16px;
                border-radius: 10px;
            }
            QPushButton:hover {
                background: rgba(0,0,0,0.04);
            }
            QPushButton:pressed {
                background: rgba(0,0,0,0.08);
            }
        """)
        layout = QVBoxLayout(self)
        layout.setContentsMargins(8, 6, 8, 6)
        layout.setSpacing(0)
        
        self.chat_btn = QPushButton("🗨️")
        self.chat_btn.setFixedSize(52, 48)
        self.chat_btn.clicked.connect(self._on_chat_clicked)
        layout.addWidget(self.chat_btn)
        
        self.setFixedSize(68, 60)
        self.hide()
    
    def _on_chat_clicked(self):
        self.hide()
        if self.parent():
            self.parent()._show_chat_dialog()
    
    def popup_at(self, x, y):
        self.move(int(x), int(y))
        self.show()
        self.raise_()

class FoodPanel(QWidget):
    """双击弹出的喂食面板"""

    def __init__(self, on_pick):
        super().__init__(None, Qt.WindowType.FramelessWindowHint | Qt.WindowType.Tool
                         | Qt.WindowType.WindowStaysOnTopHint)
        self.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground)
        self.setFixedSize(310, 64)
        lay = QHBoxLayout(self)
        lay.setContentsMargins(12, 8, 12, 8)
        lay.setSpacing(8)
        for f in FOODS:
            b = QToolButton()
            b.setText(f)
            b.setFont(QFont("Segoe UI Emoji", 20))
            b.setFixedSize(44, 44)
            b.setStyleSheet(
                "QToolButton{background:rgba(255,255,255,235);border:2px solid #ffb3c8;"
                "border-radius:22px;} QToolButton:hover{background:#ffe3ec;border-color:#ff7fa8;}")
            b.clicked.connect(lambda _, x=f: on_pick(x))
            lay.addWidget(b)
        close = QToolButton()
        close.setText("✕")
        close.setFont(QFont("Microsoft YaHei UI", 12))
        close.setFixedSize(26, 26)
        close.setStyleSheet("QToolButton{background:rgba(255,255,255,200);border:none;border-radius:13px;color:#666;}"
                            "QToolButton:hover{background:#ff7fa8;color:#fff;}")
        close.clicked.connect(self.hide)
        lay.addWidget(close)
        self.setStyleSheet("FoodPanel{background:rgba(40,40,60,190);border-radius:14px;}")

    def popup_at(self, x, y):
        self.move(int(x - self.width() / 2), int(y - self.height() - 10))
        self.show()
        self.raise_()

class PetWindow(QWidget):
    def _set_city_dialog(self):
        city, ok = QInputDialog.getText(
            self,
            "设置城市",
            "输入城市名:",
            QLineEdit.EchoMode.Normal,
            self.cfg.get("city", "汕头")
        )

        print("输入框结果:", city, ok)

        if ok and city.strip():
            self.cfg["city"] = city.strip()
            print("cfg现在:", self.cfg["city"])
            self.say(f"城市已设置为{city}")

    def __init__(self):
        self.cfg = load_json(CONFIG_PATH, {
            "mode": "wander",
            "size": 0.7,
            "topmost": True,
            "passthrough": False,
            "autostart": False,
            "x": None,
            "y": None,
            "ollama_model": OLLAMA_MODEL,
            "ollama_url": OLLAMA_URL,
            "pomo_work_min": 25,
            "pomo_rest_min": 5,
            "whisper_enabled": True,
            "whisper_interval": 300,
            "city": "汕头"
    })
        
        flags = Qt.WindowType.FramelessWindowHint | Qt.WindowType.Tool
        if self.cfg.get("topmost", True):
            flags |= Qt.WindowType.WindowStaysOnTopHint
        super().__init__(None, flags)
        self.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground)
        self.setWindowTitle("大肥鱼桌宠")
        
        # 精灵加载
        self.sprites = {}
        for label, mult in SIZE_LEVELS.items():
            h = int(340 * mult)
            for name in ["正面", "侧面", "背面"]:
                sized = os.path.join(SPRITE_DIR, f"{name}_{h}.png")
                if os.path.exists(sized):
                    pix = QPixmap(sized)
                else:
                    pix = QPixmap(os.path.join(SPRITE_DIR, f"{name}.png")).scaledToHeight(
                        h, Qt.TransformationMode.SmoothTransformation)
                self.sprites[(name, h)] = pix
        self.icon = QIcon(os.path.join(SPRITE_DIR, "icon.png"))

        self.cur_h = int(340 * self.cfg["size"])
        self.win_mx = int(self.cur_h * 0.062) + 6
        self.win_w = max(p.width() for k, p in self.sprites.items() if k[1] == self.cur_h) + self.win_mx * 2
        self.setFixedSize(self.win_w, self.cur_h + BUBBLE_H + MARGIN * 2 + 10)

        # 状态
        self.mode = self.cfg["mode"] if self.cfg["mode"] in ("wander", "follow", "still") else "wander"
        self.dir = "down"
        self.facing = 1
        self.target = None
        self.rest_until = 0
        self.cur_speed = 0.0
        self.prev_key = None
        self.cross_t = 0.0
        self.action = None
        self.action_t = 0.0
        self.bubble_text = ""
        self.bubble_until = 0
        self.bubble_inner = False
        self.last_speak_tick = 0
        self.last_system_check = 0
        self.t = 0
        self.jump_t = 0
        self.dragging = False
        self.drag_offset = None
        self.drag_start_pos = None
        self.last_line = ""
        self.last_press_pos = None
        self.last_sleep_tick = 0
        self.action_dur = 2.0
        self.drag_target = None
        self.last_whisper_tick = 0

        # 新增：Q弹 / 甩抛 / 吃东西 / 番茄钟
        self.squash_t = 0.0
        self.thrown = False
        self.vx = 0.0
        self.vy = 0.0
        self.drag_trail = []
        self.eating = False
        self.eat_t = 0.0
        self.eat_food = ""
        self.pomo_state = "idle"   # idle / work / rest
        self.pomo_task = "背单词"
        self.pomo_remaining = 0
        self.pomo_sec_elapsed = 0.0
        
        # AI 相关
        self.ai_busy = False
        self.chat_history = []  # 对话历史
        self.max_history = 40   # 最多记录40条
        self._say_queue = []    # 后台线程→主线程的气泡消息队列
        
        # 聊天暂停标志
        self.chat_paused = False
        
        # 功能列表
        self.function_panel = FunctionPanel(self)
        self.food_panel = FoodPanel(self.on_food)
        # 单击延迟判定（等双击）：单击=回嘴+弹聊天面板，双击=喂食
        self._click_timer = QTimer(self)
        self._click_timer.setSingleShot(True)
        self._click_timer.timeout.connect(self._on_single_click)
        
        # 聊天对话框
        self.chat_dialog = ChatDialog(self)
        
        self.timer = QTimer(self)
        self.timer.timeout.connect(self.tick)
        self.timer.start(TICK)

        self.bubble_font = QFont("Microsoft YaHei UI", 11)

        # 托盘
        self.tray = QSystemTrayIcon(self.icon, self)
        self.tray.setContextMenu(self._build_menu())
        self.tray.activated.connect(self._on_tray_activated)
        self.tray.show()

        x, y = self.cfg.get("x"), self.cfg.get("y")
        if x is None or y is None:
            screen = QApplication.primaryScreen().availableGeometry()
            x = screen.right() - self.width() - 80
            y = screen.bottom() - self.height() - 60
        self.move(int(x), int(y))
        self.show()
        self.snap_into_screen()
        if self.cfg.get("passthrough", False):
            self._apply_passthrough(True)

    # ---------- AI 方法 ----------
    def _call_ollama(self, user_msg):
        if self.ai_busy:
            self.say("等等，上一句还没回完呢")
            return

        self.ai_busy = True

        # 构建消息列表
        messages = [{"role": "system", "content": CHAT_SYSTEM}]
        messages.extend(self.chat_history[-self.max_history:])
        messages.append({"role": "user", "content": user_msg})

        def worker():
            url = self.cfg.get("ollama_url", OLLAMA_URL).rstrip("/") + "/api/chat"
            payload = {
                "model": self.cfg.get("ollama_model", OLLAMA_MODEL),
                "messages": messages,
                "stream": False,
                "options": {"temperature": 0.9, "num_predict": 100}
            }
            try:
                resp = requests.post(url, json=payload, timeout=60)
                if resp.status_code == 200:
                    reply = resp.json()["message"]["content"].strip()
                    if len(reply) > 30:
                        reply = reply[:28] + "…"
                    # 存入历史
                    self.chat_history.append({"role": "user", "content": user_msg})
                    self.chat_history.append({"role": "assistant", "content": reply})
                    if len(self.chat_history) > self.max_history:
                        self.chat_history = self.chat_history[-self.max_history:]
                    self._queue_say(reply)
                else:
                    self._queue_say(f"模型错误: {str(resp.status_code)}")
                    print(f"[Ollama] 状态码: {resp.status_code}, 返回: {resp.text}")
            except requests.exceptions.Timeout:
                self._queue_say("本地模型超时了，可能还在加载")
            except requests.exceptions.ConnectionError:
                self._queue_say("连不上 Ollama，检查是否已启动")
            except Exception as e:
                self._queue_say(f"请求失败: {str(e)[:12]}")
            finally:
                self.ai_busy = False

        threading.Thread(target=worker, daemon=True).start()

    # ---------- 绘制 ----------
    def paintEvent(self, _):
        p = QPainter(self)
        p.setRenderHint(QPainter.RenderHint.SmoothPixmapTransform)
        p.setRenderHint(QPainter.RenderHint.Antialiasing)
        now = self.t * TICK / 1000.0

        if self.bubble_text and now < self.bubble_until:
            if self.bubble_inner:
                bfont = QFont(self.bubble_font)
                bfont.setItalic(True)
                bg, fg = QColor(232, 232, 238, 235), QColor(125, 125, 138)
            else:
                bfont = QFont(self.bubble_font)
                bg, fg = QColor(255, 255, 255, 235), QColor(60, 60, 80)
            fm = QFontMetrics(bfont)
            max_w = min(240, self.width() - 16)
            words = self.bubble_text
            lines = []
            cur = ""
            for ch in words:
                if fm.horizontalAdvance(cur + ch) > max_w - 20:
                    lines.append(cur)
                    cur = ch
                else:
                    cur += ch
            lines.append(cur)
            bw = max(fm.horizontalAdvance(l) for l in lines) + 20
            bh = len(lines) * fm.height() + 14
            bx = (self.width() - bw) / 2
            by = 6.0
            p.setPen(Qt.PenStyle.NoPen)
            p.setBrush(bg)
            p.drawRoundedRect(QRectF(bx, by, bw, bh), 10, 10)
            tail = QPointF(self.width() / 2, by + bh)
            p.drawPolygon(QPolygonF([tail, QPointF(tail.x() - 6, tail.y() + 8), QPointF(tail.x() + 6, tail.y() + 8)]))
            p.setPen(fg)
            p.setFont(bfont)
            for i, l in enumerate(lines):
                p.drawText(QRectF(bx, by + 7 + i * fm.height(), bw, fm.height()),
                           Qt.AlignmentFlag.AlignCenter, l)

        cx = self.width() / 2
        walking = self.target is not None and not self.dragging
        if walking:
            sway = math.sin(now * 9.0) * 3.5
            bob = -abs(math.sin(now * 4.5)) * 7.0
        else:
            sway = math.sin(now * 2.5) * 1.5
            bob = 0.0
        breath = 1.0 + 0.02 * math.sin(now * 2.5)
        scale = breath
        jump = -abs(math.sin(self.jump_t * 3.14159)) * 14 * self.jump_t if self.jump_t > 0 else 0
        act_rot, act_sx, act_sy, act_oy = self._action_xform()

        def draw_one(key, opacity):
            if key is None:
                return
            name, h, facing = key
            pix = self.sprites[(name, h)]
            ph = pix.height() * scale * (1 + act_sy)
            pw = pix.width() * scale * (1 + act_sx)
            if self.squash_t > 0:
                sq = math.sin(self.squash_t * math.pi)
                pw *= 1 + 0.22 * sq
                ph *= 1 - 0.16 * sq
            if self.eating and self.eat_t > 0:
                chew = math.sin(self.eat_t * math.pi * 10)
                pw *= 1 + 0.10 * chew
                ph *= 1 - 0.08 * chew
            dx = cx - pw / 2
            bottom = BUBBLE_H + MARGIN + self.cur_h
            dy = bottom - ph + jump + bob + act_oy
            p.save()
            p.setOpacity(opacity)
            p.translate(cx, bottom)
            p.rotate(sway + act_rot)
            p.translate(-cx, -bottom)
            if facing < 0:
                p.translate(cx, 0)
                p.scale(-1, 1)
                p.translate(-cx, 0)
            p.drawPixmap(QRectF(dx, dy, pw, ph), pix, QRectF(0, 0, pix.width(), pix.height()))
            p.restore()

        cur_key = self._sprite_key()
        if self.cross_t > 0:
            draw_one(self.prev_key, self.cross_t)
            draw_one(cur_key, 1.0 - self.cross_t)
        else:
            draw_one(cur_key, 1.0)

        # 吃东西：食物 emoji 在嘴前逐渐变小消失（模拟被吃掉）
        if self.eating and self.eat_t > 0 and self.eat_food:
            ratio = max(0.0, self.eat_t)
            emoji_size = int(26 * (0.30 + 0.70 * ratio))
            fy = BUBBLE_H + MARGIN + self.cur_h - self.cur_h * (0.30 + 0.30 * ratio)
            p.setFont(QFont("Segoe UI Emoji", emoji_size))
            p.setPen(Qt.PenStyle.NoPen)
            p.drawText(QRectF(cx - emoji_size, fy - emoji_size, emoji_size * 2, emoji_size * 2),
                       Qt.AlignmentFlag.AlignCenter, self.eat_food)

        # 动作附加绘制（Zzz / 🎈 / 泡泡 / 💻 / 📖）
        self._draw_action_extras(p, cx)

    def _sprite_key(self):
        name = {"left": "侧面", "right": "侧面", "up": "背面", "down": "正面"}[self.dir]
        return (name, self.cur_h, self.facing if self.dir in ("left", "right") else 1)

    def _set_dir(self, d, facing=None):
        if d != self.dir:
            self.prev_key = self._sprite_key()
            self.cross_t = 1.0
            self.dir = d
        if facing is not None and facing != self.facing:
            self.facing = facing

    # ---------- 逻辑 ----------
    def tick(self):
        self.t += 1

        # 处理后台线程（DeepSeek 等）排队的气泡消息，Qt 界面必须在主线程更新
        if self._say_queue:
            for text in self._say_queue:
                self.say(text)
            self._say_queue.clear()

        self.check_system_status()
        
        if self.jump_t > 0:
            self.jump_t = max(0.0, self.jump_t - 0.06)
        if self.cross_t > 0:
            self.cross_t = max(0.0, self.cross_t - 0.15)
        if self.squash_t > 0:
            self.squash_t = max(0.0, self.squash_t - 0.045)
        if self.action_t > 0:
            rate = (TICK / 1000.0) / max(0.1, self.action_dur)
            self.action_t = max(0.0, self.action_t - rate)
            if self.action_t == 0:
                if self.action == "打瞌睡":
                    self.say(random.choice(["嗯？！刚才是谁在叫我！", "睡得好香……啊不是，我在站岗！"]))
                self.action = None
                self.action_dur = 2.0

        if self.eat_t > 0 and not (self.action and ACTION_DEFS.get(self.action, {}).get("kind") == "eat"):
            self.eat_t = max(0.0, self.eat_t - 0.012)
            if self.eat_t == 0:
                self.eating = False
        elif self.eat_t > 0 and self.action and ACTION_DEFS.get(self.action, {}).get("kind") == "eat":
            # 吃动作的进度跟随动作时长
            self.eat_t = max(0.0, self.action_t)
            if self.eat_t == 0:
                self.eating = False

        self._pomo_tick()
        self._whisper_tick()

        if self.thrown:
            self._physics_tick()
            return
        
        if self.chat_paused:
            self.update()
            return
        
        if self.dragging:
            # dsh-pet 风格：阻尼弹簧跟手拖拽
            if self.drag_target:
                tx, ty = self.drag_target
                dt = TICK / 1000.0
                self.vx += ((tx - self.x()) * 170.0 - self.vx * 21.0) * dt
                self.vy += ((ty - self.y()) * 170.0 - self.vy * 21.0) * dt
                self.move(int(self.x() + self.vx * dt), int(self.y() + self.vy * dt))
            self.update()
            return
        now_ms = self.t * TICK

        if self.mode == "follow":
            cursor = self.cursor().pos()
            screen = QApplication.screenAt(cursor) or self.screen() or QApplication.primaryScreen()
            geo = screen.availableGeometry()
            near = (self.x() - 100 <= cursor.x() <= self.x() + self.width() + 100 and
                    self.y() - 100 <= cursor.y() <= self.y() + self.height() + 100)
            if near:
                self.target = None
            else:
                tx = max(geo.left(), min(geo.right() - self.width(), cursor.x() - self.width() / 2))
                ty = max(geo.top(), min(geo.bottom() - self.height(), cursor.y() - 90))
                self.target = (tx, ty)
        elif self.mode == "wander":
            if self.target is None:
                if now_ms < self.rest_until:
                    self._maybe_idle_action()
                    self.update()
                    return
                if self.action:
                    # 正在做动作，先不移动
                    self.update()
                    return
                geo = (self.screen() or QApplication.primaryScreen()).availableGeometry()
                self.target = (random.randint(geo.left() + 40, geo.right() - self.width() - 40),
                               random.randint(geo.top() + 40, geo.bottom() - self.height() - 40))
        else:
            self._maybe_idle_action()
            self.update()
            return

        if self.target is not None:
            cx, cy = self.x() + self.width() / 2, self.y() + self.height() / 2
            dx, dy = self.target[0] - cx, self.target[1] - cy
            dist = (dx * dx + dy * dy) ** 0.5
            if dist < 12:
                self.target = None
                self.rest_until = self.t * TICK + random.randint(8000, 18000)
                self._set_dir("down")
            else:
                step = self.cur_speed * TICK / 1000.0
                nx, ny = cx + dx / dist * step, cy + dy / dist * step
                self.move(int(nx - self.width() / 2), int(ny - self.height() / 2))
                if abs(dx) > abs(dy) * 1.15:
                    self._set_dir("left" if dx < 0 else "right", 1 if dx < 0 else -1)
                else:
                    self._set_dir("up" if dy < 0 else "down")
            if random.random() < 0.002 and self.jump_t == 0:
                self.jump_t = 0.5
        target_speed = SPEED if self.target is not None else 0.0
        self.cur_speed += (target_speed - self.cur_speed) * 0.3
        self.update()

    def _maybe_idle_action(self):
        if random.random() < 0.01:
            pick = random.random()
            if pick < 0.30:
                self.jump_t = 1.0
            elif pick < 0.55:
                self.play_action("摇摆")
            elif pick < 0.75:
                self.play_action("伸懒腰")
            elif pick < 0.90:
                if self.t - self.last_speak_tick >= 1500:
                    self.last_speak_tick = self.t
                    if random.random() < 0.45:
                        self.say(random.choice(INNER_LINES), inner=True)
                    else:
                        self.say(random.choice(LINES))
            else:
                # 打瞌睡（带冷却，避免一直歪头不正）
                if self.t - self.last_sleep_tick >= 2000:
                    self.last_sleep_tick = self.t
                    self.play_action("打瞌睡")

    # ---------- 新增：甩抛物理 / Q弹 / 番茄钟 ----------
    def _throw_velocity(self):
        """根据拖拽轨迹末段速度判断是否甩抛；返回 True 表示已进入抛掷"""
        if len(self.drag_trail) < 2:
            self.drag_trail.clear()
            return False
        (t0, x0, y0) = self.drag_trail[0]
        (t1, x1, y1) = self.drag_trail[-1]
        dt = t1 - t0
        self.drag_trail.clear()
        if dt <= 0.02:
            return False
        vx = (x1 - x0) / dt * 1000.0
        vy = (y1 - y0) / dt * 1000.0
        if math.hypot(vx, vy) < 1800:
            return False
        self.thrown = True
        cap = 2600.0
        self.vx = max(-cap, min(cap, vx))
        self.vy = max(-cap, min(cap, vy))
        self.say("呜哇——起飞！")
        return True

    def _physics_tick(self):
        """抛掷物理：抛物线 + 屏幕边缘反弹 + 落地 Q 弹"""
        dt = TICK / 1000.0
        G = 1500.0
        self.vx *= 0.996
        self.vy += G * dt
        nx = self.x() + self.vx * dt
        ny = self.y() + self.vy * dt
        geo = (self.screen() or QApplication.primaryScreen()).availableGeometry()
        if nx < geo.left():
            nx = geo.left()
            self.vx = abs(self.vx) * 0.6
        elif nx + self.width() > geo.right():
            nx = geo.right() - self.width()
            self.vx = -abs(self.vx) * 0.6
        if ny < geo.top():
            ny = geo.top()
            self.vy = abs(self.vy) * 0.5
        ground = geo.bottom() - self.height()
        if ny > ground:
            ny = ground
            self.vy = -abs(self.vy) * 0.45
            self.vx *= 0.75
            if abs(self.vy) < 160:
                self.vy = 0.0
                self.vx = 0.0
                self.thrown = False
                self._set_dir("down", 1)
                self.target = None
                self.rest_until = self.t * TICK + random.randint(6000, 14000)
                self._squash()
                if random.random() < 0.6:
                    self.say(random.choice(DRAG_LINES))
        self.move(int(nx), int(ny))
        if self.thrown and abs(self.vx) > 60:
            self._set_dir("left" if self.vx < 0 else "right", 1 if self.vx < 0 else -1)
        self.update()

    def _squash(self):
        """Q 弹挤压（点按 / 喂食 / 落地等触发）"""
        self.squash_t = 1.0

    # ---------- 动作引擎（dsh-pet 风格点播） ----------
    def play_action(self, name):
        """点播一个动作"""
        if name not in ACTION_DEFS:
            return
        defn = ACTION_DEFS[name]
        self.action = name
        self.action_dur = max(0.1, defn["dur"])
        self.action_t = 1.0
        self.target = None   # 做动作时先停下
        self.rest_until = self.t * TICK + int(self.action_dur * 1000) + random.randint(1500, 4000)
        line = defn.get("line")
        if line:
            self.say(random.choice(line) if isinstance(line, list) else line)
        if defn["kind"] == "eat":
            self.eat_food = defn.get("food", "🍚")
            self.eating = True
            self.eat_t = 1.0
        if name == "思考碎碎念":
            self.say(random.choice(INNER_LINES), inner=True)

    def _action_xform(self):
        """根据当前动作计算 rot / sx / sy / oy（程序变换模拟帧动画）"""
        rot = sx = sy = oy = 0.0
        a = self.action
        if not a or a not in ACTION_DEFS:
            return rot, sx, sy, oy
        defn = ACTION_DEFS[a]
        dur = defn["dur"]
        t = max(0.0, min(1.0, self.action_t))          # 1 → 0
        ph = (1.0 - t) * dur                           # 已进行秒数
        fade = min(1.0, t * 4.0, (1.0 - t) * 4.0 + 0.2)  # 首尾淡入淡出
        kind = defn["kind"]
        if kind == "sway":
            rot = math.sin(ph * math.pi * 2) * 10 * fade
        elif kind == "stretch":
            sy = 0.06 * math.sin(ph / dur * math.pi)
            sx = -0.03 * math.sin(ph / dur * math.pi)
        elif kind == "sleep":
            rot = 9.0 * t
            sy = 0.12 * t
        elif kind == "bounce":
            n = 4.0
            oy = -abs(math.sin(ph / dur * math.pi * n)) * 22 * fade
            sx = 0.08 * math.sin(ph / dur * math.pi * n * 2)
            sy = -0.06 * math.sin(ph / dur * math.pi * n * 2)
        elif kind == "shake":
            rot = math.sin(ph * 38) * 5 * fade
            sx = 0.06 * math.sin(ph * 30) * fade
        elif kind == "angry":
            rot = math.sin(ph * 16) * 12 * fade
            oy = abs(math.sin(ph * 24)) * -5 * fade
            sx = 0.05 * math.sin(ph * 20)
        elif kind == "giggle":
            rot = math.sin(ph * 28) * 5 * fade
            oy = -abs(math.sin(ph * 18)) * 7 * fade
        elif kind == "spin":
            rot = (1.0 - t) * 360.0
        elif kind == "tailslap":
            rot = math.sin(ph * 22) * 18 * fade
        elif kind == "puff":
            s = 0.28 * math.sin(ph / dur * math.pi)
            sx = s
            sy = s
        elif kind == "bubble":
            rot = math.sin(ph * 5) * 4 * fade
            oy = math.sin(ph * 3) * 3
        elif kind == "eat":
            chew = math.sin(ph * 14)
            sx = 0.10 * chew
            sy = -0.07 * chew
        elif kind == "code":
            rot = math.sin(ph * 6) * 3 * fade
            oy = math.sin(ph * 8) * 2 * fade
            sy = 0.04 * fade
        elif kind == "study":
            rot = math.sin(ph * 3) * 2 * fade
            oy = math.sin(ph * 5) * 3 * fade
        elif kind == "think":
            rot = math.sin(ph * 2) * 6 * fade
        return rot, sx, sy, oy

    def _draw_action_extras(self, p, cx):
        """动作附加绘制：Zzz / 🎈 / 泡泡 / 💻 / 📖"""
        a = self.action
        if not a or a not in ACTION_DEFS:
            return
        extra = ACTION_DEFS[a].get("extra")
        if not extra:
            return
        top = BUBBLE_H + MARGIN
        t = max(0.0, min(1.0, self.action_t))
        if extra == "zzz":
            zfont = QFont("Microsoft YaHei UI", 13)
            zfont.setItalic(True)
            zfont.setBold(True)
            p.setFont(zfont)
            p.setPen(QColor(110, 120, 160))
            zphase = (self.t % 60) / 60.0
            zy = top + self.cur_h * 0.15 - zphase * 16
            p.drawText(int(cx + 26), int(zy), "Zzz…")
        elif extra == "🎈":
            size = int(18 + 16 * (1 - t))
            p.setFont(QFont("Segoe UI Emoji", size))
            p.setPen(Qt.PenStyle.NoPen)
            by = top + self.cur_h * 0.06 - (1 - t) * 14
            p.drawText(QRectF(cx - size, by, size * 2, size * 2),
                       Qt.AlignmentFlag.AlignCenter, "🎈")
        elif extra == "bubble":
            p.setBrush(QColor(160, 200, 255, 150))
            p.setPen(QColor(255, 255, 255, 200))
            base_y = top + self.cur_h * 0.25
            for i in range(4):
                ph = (1 - t) * 2.5 + i * 0.3
                r = 3.0 + i * 1.6
                bx = cx + 22 + math.sin(ph * 3 + i) * 9
                by = base_y - (ph % 1.3) * 26
                p.drawEllipse(QPointF(bx, by), r, r)
            p.setBrush(Qt.BrushStyle.NoBrush)
            p.setPen(Qt.PenStyle.NoPen)
        elif extra in ("💻", "📖"):
            p.setFont(QFont("Segoe UI Emoji", 20))
            p.setPen(Qt.PenStyle.NoPen)
            fx = cx - self.cur_h * 0.42
            fy = top + self.cur_h * 0.70
            p.drawText(QRectF(fx - 13, fy - 13, 26, 26),
                       Qt.AlignmentFlag.AlignCenter, extra)

    # ---------- 碎碎念 ----------
    def _whisper_tick(self):
        if not self.cfg.get("whisper_enabled", True):
            return
        now = self.t * TICK
        if now - self.last_whisper_tick < int(self.cfg.get("whisper_interval", 300)) * 1000:
            return
        self.last_whisper_tick = now
        self._whisper_now()

    def _whisper_now(self):
        """碎碎念：说一句 + 做个小动作"""
        if random.random() < 0.4:
            self.say(random.choice(INNER_LINES), inner=True)
        else:
            self.say(random.choice(LINES))
        if random.random() < 0.4:
            self.play_action("思考碎碎念")

    def _pomo_tick(self):
        """番茄钟每秒倒计时 + 工作中随机学习动画"""
        if self.pomo_state == "idle":
            return
        self.pomo_sec_elapsed += TICK / 1000.0
        if self.pomo_sec_elapsed < 1.0:
            return
        self.pomo_sec_elapsed -= 1.0
        self.pomo_remaining -= 1
        if self.pomo_state == "work" and self.pomo_remaining > 0 and self.pomo_remaining % 45 == 0:
            if random.random() < 0.5:
                self.play_action(random.choice(["写代码", "背单词"]))
            else:
                self.say(f"🍅 还剩 {self.pomo_remaining // 60} 分 {self.pomo_remaining % 60} 秒～")
        if self.pomo_remaining <= 0:
            self._pomo_finish()

    def _pomo_finish(self):
        if self.pomo_state == "work":
            self.pomo_state = "rest"
            self.pomo_remaining = int(self.cfg.get("pomo_rest_min", 5)) * 60
            self.pomo_sec_elapsed = 0.0
            self._squash()
            self.say(f"🍅 {self.pomo_task}时间到！休息一下吧～")
            self._generate_nudge(self.pomo_task, "工作结束，该休息了")
        else:
            self.pomo_state = "idle"
            self.pomo_remaining = 0
            self.say("休息结束！要继续卷吗？")
            self._generate_nudge(self.pomo_task, "休息结束，准备开始下一轮")

    def _start_pomo_work(self):
        task, ok = QInputDialog.getText(
            self, "番茄钟", "这轮要做什么？（如：背单词）",
            QLineEdit.EchoMode.Normal, self.pomo_task
        )
        if not ok or not task.strip():
            return
        self.pomo_task = task.strip()
        self.pomo_state = "work"
        self.pomo_remaining = int(self.cfg.get("pomo_work_min", 25)) * 60
        self.pomo_sec_elapsed = 0.0
        self._squash()
        self.say(f"🍅 开始！{self.pomo_task}，{self.cfg.get('pomo_work_min', 25)}分钟走起～")
        self._generate_nudge(self.pomo_task, "开始工作")

    def _start_pomo_rest(self):
        self.pomo_state = "rest"
        self.pomo_remaining = int(self.cfg.get("pomo_rest_min", 5)) * 60
        self.pomo_sec_elapsed = 0.0
        self.say(f"🍅 休息{self.cfg.get('pomo_rest_min', 5)}分钟，鱼也陪你歇会儿～")
        self._generate_nudge(self.pomo_task, "开始休息")

    def _stop_pomo(self):
        self.pomo_state = "idle"
        self.pomo_remaining = 0
        self.say("番茄钟停啦，想卷随时叫我～")

    def _set_pomo_time(self):
        work, ok1 = QInputDialog.getInt(
            self, "番茄钟时长", "工作时长（分钟）:", int(self.cfg.get("pomo_work_min", 25)), 1, 180
        )
        if not ok1:
            return
        rest, ok2 = QInputDialog.getInt(
            self, "番茄钟时长", "休息时长（分钟）:", int(self.cfg.get("pomo_rest_min", 5)), 1, 60
        )
        if not ok2:
            return
        self.cfg["pomo_work_min"] = work
        self.cfg["pomo_rest_min"] = rest
        self.say(f"番茄钟设为工作{work}分钟 / 休息{rest}分钟")

    def _generate_nudge(self, task, kind):
        """后台线程：让本地 Ollama 模型生成一句督促语"""

        def worker():
            try:
                url = self.cfg.get("ollama_url", OLLAMA_URL).rstrip("/") + "/api/chat"
                payload = {
                    "model": self.cfg.get("ollama_model", OLLAMA_MODEL),
                    "messages": [
                        {"role": "system", "content": NUDGE_SYSTEM},
                        {"role": "user", "content": f"我的任务：{task}；当前阶段：{kind}"}
                    ],
                    "stream": False,
                    "options": {"temperature": 0.9, "num_predict": 80}
                }
                r = requests.post(url, json=payload, timeout=60)
                if r.status_code == 200:
                    text = r.json()["message"]["content"].strip().replace("\n", " ")
                    if len(text) > 42:
                        text = text[:40] + "…"
                    self._queue_say(text)
                else:
                    self._queue_say(random.choice(POMO_FALLBACK))
            except Exception:
                self._queue_say(random.choice(POMO_FALLBACK))

        threading.Thread(target=worker, daemon=True).start()

    def _queue_say(self, text):
        """后台线程调用：只入队，由主线程 tick 统一弹出显示（线程安全）"""
        self._say_queue.append(text)

    def say(self, text, inner=False):
        if text == self.last_line and not text.startswith("天气"):
            return
        self.last_line = text
        self.bubble_inner = inner
        self.bubble_text = f"（{text}）" if inner else text
        self.bubble_until = self.t * TICK / 1000.0 + 2.8
        self.update()

    def check_system_status(self):
            now = self.t * TICK

            if now - getattr(self, "last_system_check", 0) < 10000:
                return

            self.last_system_check = now

            cpu = psutil.cpu_percent()

            if cpu >= 90:
                self.say("CPU跑满了，再这样下去我就卡死了")
                return

            ram = psutil.virtual_memory().percent

            if ram >= 95:
                self.say("内存爆了，快关掉几个没用的东西吧，注意，别把我关了")
                return

            if GPU_AVAILABLE:
                try:
                    handle = pynvml.nvmlDeviceGetHandleByIndex(0)

                    temp = pynvml.nvmlDeviceGetTemperature(
                        handle,
                        pynvml.NVML_TEMPERATURE_GPU
                    )

                    if temp > 80:
                        self.say("我感觉我的鱼鳍快熟了")

                except Exception as e:
                    print("GPU读取失败:", e)

    # ---------- 鼠标事件 ----------
    def mousePressEvent(self, e):
        if e.button() == Qt.MouseButton.LeftButton:
            self.last_press_pos = e.globalPosition().toPoint()
            self.dragging = False
            self.drag_start_pos = e.globalPosition().toPoint()
            self.drag_trail.clear()
            self.drag_target = (self.x(), self.y())
            self.thrown = False
            self.vx = 0.0
            self.vy = 0.0
            self.action = None   # 按住时中断当前动作
            self.function_panel.hide()
            self.chat_dialog.hide()
            self.chat_paused = True

    def mouseMoveEvent(self, e):
        if e.buttons() & Qt.MouseButton.LeftButton and self.drag_start_pos is not None:
            delta = e.globalPosition().toPoint() - self.drag_start_pos
            if not self.dragging and delta.manhattanLength() > 6:
                self.dragging = True
                self.drag_offset = e.globalPosition().toPoint() - QPoint(self.x(), self.y())
            if self.dragging and self.drag_offset is not None:
                pos = e.globalPosition().toPoint() - self.drag_offset
                self.drag_target = (pos.x(), pos.y())   # 弹簧目标，实际位置由 tick 弹簧推进
                self.drag_trail.append((time.time(), pos.x(), pos.y()))
                if len(self.drag_trail) > 6:
                    self.drag_trail.pop(0)
                if abs(delta.x()) > 10:
                    self._set_dir("left" if delta.x() < 0 else "right", 1 if delta.x() < 0 else -1)
                self.update()

    def mouseReleaseEvent(self, e):
        if e.button() == Qt.MouseButton.LeftButton:
            if self.dragging:
                self.dragging = False
                self.drag_offset = None
                self.drag_start_pos = None
                # 甩抛物理：松手瞬间速度够大就飞出去
                if self._throw_velocity():
                    self.chat_paused = False
                    self.last_press_pos = None
                    self.drag_start_pos = None
                    return
                self._set_dir("down", 1)
                self.target = None
                self.rest_until = self.t * TICK + random.randint(6000, 14000)
                if random.random() < 0.5:
                    self.say(random.choice(DRAG_LINES))
                self.chat_paused = False
            else:
                self._click_timer.start(280)  # 等双击判定；单击则回嘴+弹聊天面板
            self.last_press_pos = None
            self.drag_start_pos = None

    def mouseDoubleClickEvent(self, e):
        if e.button() == Qt.MouseButton.LeftButton:
            self._click_timer.stop()
            # 双击：随机播放一个点击回应动作（dsh-pet 风格）
            reacts = ["开心跃动", "害羞惊讶", "傲娇生气", "挠痒咯咯笑"]
            self.play_action(random.choice(reacts))

    def _on_single_click(self):
        """单击：随机点击回应动作 + Q弹 + 弹聊天面板"""
        reacts = ["开心跃动", "害羞惊讶", "傲娇生气", "挠痒咯咯笑"]
        self.play_action(random.choice(reacts))
        self._squash()
        panel = self.function_panel
        panel.popup_at(self.x() + self.width() / 2 - panel.width() / 2,
                       self.y() - panel.height() - 10)

    def on_food(self, food):
        self.food_panel.hide()
        self.eat_t = 1.0
        self.eating = True
        self.eat_food = food
        self.jump_t = 0.6
        self._squash()
        lines = FOOD_LINES.get(food, ["好吃！"])
        self.say(random.choice(lines))

    def _show_chat_dialog(self):
        if not self.cfg.get("ollama_model"):
            self.say("请先在右键菜单的 AI 设置里配好模型！")
            self.chat_paused = False
            return
        self.chat_dialog.popup_at(
            self.x() + self.width() / 2,
            self.y() + BUBBLE_H
        )

    """def _get_city_by_ip(self):
        try:
            r = requests.get("http://ip-api.com/json/?fields=city&lang=zh-CN", timeout=5)
            if r.status_code == 200:
                city = r.json().get("city", "")
                if city:
                    return city
        except:
            pass
        return "汕头" """

    def _get_weather(self):
        try:
            city = self.cfg.get("city", "汕头")
            print("当前城市:", city)

            url = f"https://wttr.in/{city}?format=j1"

            r = requests.get(
                url,
                timeout=10,
                headers={
                    "User-Agent": "Mozilla/5.0"
                }
            )

            print("状态:", r.status_code)
            print(r.text[:500])

            data = r.json()

            weather = data["current_condition"][0]

            temp = weather["temp_C"]

            weather_map = {
                "Sunny": "晴",
                "Clear": "晴",
                "Partly cloudy": "多云",
                "Cloudy": "阴",
                "Light rain": "小雨",
                "Moderate rain": "中雨",
                "Heavy rain": "大雨"
            }

            raw_weather = weather["weatherDesc"][0]["value"]

            desc = weather_map.get(raw_weather, raw_weather)

            self.say(f"{city}今天{temp}°，天气{desc}")

        except Exception as e:
            print("天气错误:", repr(e))
            self.say("天气获取失败")
    

    def _build_menu(self):
        m = QMenu(self)
        act_menu = m.addMenu("动作")
        for cat, names in ACTION_CATEGORIES:
            sub = act_menu.addMenu(cat)
            for n in names:
                sub.addAction(n, lambda checked=False, name=n: self.play_action(name))
        m.addAction("碎碎念", self._whisper_now)
        m.addSeparator()
        mode_menu = m.addMenu("模式")
        for label, key in [("自由散步", "wander"), ("跟随鼠标", "follow"), ("原地待着", "still")]:
            a = mode_menu.addAction(label)
            a.setCheckable(True)
            a.setChecked(self.mode == key)
            a.triggered.connect(lambda _, k=key: self.set_mode(k))
        size_menu = m.addMenu("大小")
        for label, mult in SIZE_LEVELS.items():
            a = size_menu.addAction(label)
            a.setCheckable(True)
            a.setChecked(abs(self.cur_h - 340 * mult) < 2)
            a.triggered.connect(lambda _, v=mult: self.set_size(v))
        ai_menu = m.addMenu("AI 设置")
        ai_menu.addAction("设置本地模型", self._set_ollama_model)
        ai_menu.addAction("设置 Ollama 地址", self._set_ollama_url)
        pomo_menu = m.addMenu("番茄钟")
        pomo_menu.addAction("开始学习（25分钟）", self._start_pomo_work)
        pomo_menu.addAction("开始休息", self._start_pomo_rest)
        pomo_menu.addAction("停止番茄钟", self._stop_pomo)
        pomo_menu.addAction("设置时长", self._set_pomo_time)
        m.addAction("查看天气", self._get_weather)
        m.addSeparator()
        m.addAction("显示/隐藏", self.toggle_visible)
        m.addAction("回到屏幕内", self.snap_into_screen)
        pa = m.addAction("鼠标穿透（点不到它）")
        pa.setCheckable(True)
        pa.setChecked(self.cfg["passthrough"])
        pa.triggered.connect(lambda on: self.set_passthrough(on))
        ta = m.addAction("窗口置顶")
        ta.setCheckable(True)
        ta.setChecked(self.cfg["topmost"])
        ta.triggered.connect(lambda on: self.set_topmost(on))
        aa = m.addAction("开机自启")
        aa.setCheckable(True)
        aa.setChecked(self.cfg["autostart"])
        aa.triggered.connect(lambda on: self.set_autostart(on))
        m.addSeparator()
        m.addAction("退出", self.quit_app)
        return m

    def _set_ollama_model(self):
        model, ok = QInputDialog.getText(
            self,
            "设置本地模型",
            "输入 Ollama 模型名（如 gemma3:4b / qwen2.5:3b）:",
            QLineEdit.EchoMode.Normal,
            self.cfg.get("ollama_model", OLLAMA_MODEL)
        )
        if ok and model.strip():
            self.cfg["ollama_model"] = model.strip()
            self.say(f"模型切换为 {model.strip()}")

    def _set_ollama_url(self):
        url, ok = QInputDialog.getText(
            self,
            "设置 Ollama 地址",
            "输入 Ollama 服务地址（默认 http://localhost:11434）:",
            QLineEdit.EchoMode.Normal,
            self.cfg.get("ollama_url", OLLAMA_URL)
        )
        if ok and url.strip():
            self.cfg["ollama_url"] = url.strip()
            self.say("Ollama 地址已更新")

    def _on_tray_activated(self, reason):
        if reason == QSystemTrayIcon.ActivationReason.Context:
            self.tray.setContextMenu(self._build_menu())
        elif reason == QSystemTrayIcon.ActivationReason.Trigger:
            self.toggle_visible()

    def contextMenuEvent(self, e):
        self._build_menu().exec(e.globalPos())

    # ---------- 功能 ----------
    def set_mode(self, mode):
        self.mode = mode
        self.target = None
        self.cfg["mode"] = mode

    def set_size(self, mult):
        self.cur_h = int(340 * mult)
        self.cfg["size"] = mult
        self.cross_t = 0.0
        self.prev_key = None
        self.win_mx = int(self.cur_h * 0.062) + 6
        self.win_w = max(p.width() for k, p in self.sprites.items() if k[1] == self.cur_h) + self.win_mx * 2
        self.setFixedSize(self.win_w, self.cur_h + BUBBLE_H + MARGIN * 2 + 10)
        self.snap_into_screen()

    def snap_into_screen(self):
        geo = (self.screen() or QApplication.primaryScreen()).availableGeometry()
        x = max(geo.left(), min(geo.right() - self.width(), self.x()))
        y = max(geo.top(), min(geo.bottom() - self.height(), self.y()))
        self.move(x, y)

    def _apply_passthrough(self, on):
        hwnd = int(self.winId())
        GWL_EXSTYLE, WS_EX_LAYERED, WS_EX_TRANSPARENT = -20, 0x80000, 0x20
        style = ctypes.windll.user32.GetWindowLongPtrW(hwnd, GWL_EXSTYLE)
        style = style | WS_EX_LAYERED
        if on:
            style |= WS_EX_TRANSPARENT
        else:
            style &= ~WS_EX_TRANSPARENT
        ctypes.windll.user32.SetWindowLongPtrW(hwnd, GWL_EXSTYLE, style)

    def set_passthrough(self, on):
        self.cfg["passthrough"] = bool(on)
        self._apply_passthrough(bool(on))
        if on:
            self.say("我隐身了！右键托盘图标解除～")

    def set_topmost(self, on):
        self.cfg["topmost"] = bool(on)
        self.setWindowFlag(Qt.WindowType.WindowStaysOnTopHint, bool(on))
        self.show()

    def set_autostart(self, on):
        self.cfg["autostart"] = bool(on)
        lnk = os.path.join(os.environ["APPDATA"], "Microsoft", "Windows",
                           "Start Menu", "Programs", "Startup", "大肥鱼桌宠.lnk")
        try:
            if on:
                ps = ("$s=(New-Object -ComObject WScript.Shell).CreateShortcut('{}');"
                      "$s.TargetPath='{}';$s.Arguments='\"{}\"';$s.WorkingDirectory='{}';$s.Save()"
                      .format(lnk, PYTHONW,
                              "" if getattr(sys, "frozen", False) else os.path.join(APP_DIR, "桌宠.py"),
                              APP_DIR))
                subprocess.run(["powershell", "-NoProfile", "-Command", ps],
                               creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0), check=True)
                self.say("已开机自启，明天见～")
            else:
                if os.path.exists(lnk):
                    os.remove(lnk)
                self.say("已取消开机自启")
        except Exception as ex:
            QMessageBox.warning(self, "开机自启", f"设置失败：{ex}")

    def toggle_visible(self):
        if self.isVisible():
            self.hide()
        else:
            self.show()
            self.raise_()

    def quit_app(self):
        self.cfg["x"], self.cfg["y"] = self.x(), self.y()
        with open(CONFIG_PATH, "w", encoding="utf-8") as f:
            json.dump(self.cfg, f, ensure_ascii=False, indent=2)
        self.tray.hide()
        QApplication.quit()


def main():
    app = QApplication(sys.argv)
    app.setQuitOnLastWindowClosed(False)
    w = PetWindow()
    sys.exit(app.exec())


if __name__ == "__main__":
    try:
        main()
    except Exception as ex:
        try:
            app = QApplication.instance() or QApplication(sys.argv)
            QMessageBox.critical(None, "大肥鱼桌宠出错", str(ex))
        except Exception:
            pass
        raise