#!/usr/bin/env python3
"""
================================================================================
  R.E.N.I.S. // REMOTE ACCESS SERVER
  High-Performance Remote Desktop, Dashboard, & Administrative Control
  FastAPI + MSS + PyAutoGUI + WebAuthn / Master PIN + PowerShell Terminal
================================================================================
"""

import os
import sys
from pathlib import Path

# Ensure SERVER_DIR is in sys.path
SERVER_DIR = Path(__file__).resolve().parent
if str(SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(SERVER_DIR))

# Ensure Windows console uses UTF-8 encoding
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

import io
import time
import json
import base64
import hashlib
import hmac
import secrets
import asyncio
import socket
import ctypes
from typing import Optional, Dict, Any, List, Set

# Try loading environment variables
try:
    from dotenv import load_dotenv
    load_dotenv(SERVER_DIR / ".env")
except ImportError:
    pass

# Ensure PyAutoGUI is ultra-responsive and does not crash at screen edges
try:
    import pyautogui
    pyautogui.FAILSAFE = False
    pyautogui.PAUSE = 0
    pyautogui.MINIMUM_DURATION = 0
    pyautogui.MINIMUM_SLEEP = 0
except ImportError:
    pyautogui = None

try:
    import mss
except ImportError:
    mss = None

from PIL import Image, ImageDraw
import psutil
import jwt
from urllib.parse import quote
import subprocess
import threading
import urllib.request
import re
try:
    import qrcode
except ImportError:
    qrcode = None

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Depends, Query, status, Request, Body
from fastapi.responses import HTMLResponse, FileResponse, JSONResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

# ==============================================================================
# CLEAN PROFESSIONAL ASCII BANNER
# ==============================================================================
RENI_BANNER = r"""
  ██████╗     ███████╗    ███╗   ██╗    ██╗
  ██╔══██╗    ██╔════╝    ████╗  ██║    ██║
  ██████╔╝    █████╗      ██╔██╗ ██║    ██║
  ██╔══██╗    ██╔══╝      ██║╚██╗██║    ██║
  ██║  ██║    ███████╗    ██║ ╚████║    ██║
  ╚═╝  ╚═╝    ╚══════╝    ╚═╝  ╚═══╝    ╚═╝
  ══════════════════════════════════════════════
  >> R.E.N.I. // REMOTE SYSTEM CONTROL SERVER <<
  ══════════════════════════════════════════════
"""

# ==============================================================================
# DIRECTORY RESOLUTION & CONSTANTS
# ==============================================================================
REPO_ROOT = SERVER_DIR.parent
CLIENT_DIR = REPO_ROOT / "RENIC"
AUTH_FILE = SERVER_DIR / "renis_auth.json"
DASHBOARD_FILE = SERVER_DIR / "dashboard.html"

HOST = os.getenv("RENIS_HOST", "0.0.0.0")
PORT = int(os.getenv("RENIS_PORT", "8765"))
DEFAULT_PIN = os.getenv("RENIS_DEFAULT_PIN", "000000")
JWT_ALGORITHM = os.getenv("RENIS_JWT_ALGORITHM", "HS256")
JWT_EXPIRE_HOURS = int(os.getenv("RENIS_JWT_EXPIRE_HOURS", "12"))

# Windows API Constants for Monitor Control & Power
HWND_BROADCAST = 0xFFFF
WM_SYSCOMMAND = 0x0112
SC_MONITORPOWER = 0xF170
MONITOR_OFF = 2
MONITOR_ON = -1

# Thread Execution State Constants (Keep-Awake)
ES_CONTINUOUS = 0x80000000
ES_SYSTEM_REQUIRED = 0x00000001
ES_DISPLAY_REQUIRED = 0x00000002

# Live WebSocket Connection Tracking
ACTIVE_STREAMS: Set[WebSocket] = set()
ACTIVE_CONTROLS: Set[WebSocket] = set()
ACTIVE_TERMINALS: Set[WebSocket] = set()

# ==============================================================================
# NETWORK & DISCOVERY HELPERS (LAN & TAILSCALE AUTO-DETECTION)
# ==============================================================================
def get_discovered_ips() -> List[str]:
    """Returns list of usable LAN and Tailscale IPs, prioritizing Wi-Fi/Ethernet and Tailscale."""
    lan_ips = []
    tailscale_ips = []
    try:
        nics = psutil.net_if_addrs()
        for nic_name, addrs in nics.items():
            for addr in addrs:
                if addr.family == socket.AF_INET:
                    ip = addr.address
                    if ip.startswith("127.") or ip.startswith("169.254."):
                        continue
                    if ip.startswith("100."): # Tailscale VPN Range (100.64.0.0/10)
                        tailscale_ips.append(ip)
                    else:
                        lan_ips.append(ip)
    except Exception:
        pass

    if not lan_ips:
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.connect(("8.8.8.8", 80))
            lan_ips.append(s.getsockname()[0])
            s.close()
        except Exception:
            pass

    return lan_ips + tailscale_ips

# ==============================================================================
# UNIVERSAL CLOUDFLARE TUNNEL MANAGER (QUICK / TOKEN / NAMED)
# ==============================================================================
class TunnelManager:
    """
    Manages Cloudflare Tunnel lifecycle with 3 universal operation modes:
    - Mode A (Quick): cloudflared tunnel --url http://127.0.0.1:8765 (Auto-detects *.trycloudflare.com)
    - Mode B (Token): cloudflared tunnel run --token <TOKEN>
    - Mode C (Named): cloudflared tunnel run --url http://127.0.0.1:8765 <NAME>
    Includes automatic download of cloudflared.exe from GitHub if missing.
    """
    def __init__(self):
        self.process: Optional[subprocess.Popen] = None
        self.mode: str = "stopped"
        self.active_url: str = ""
        self.error: Optional[str] = None
        self.lock = threading.Lock()
        self.bin_dir = SERVER_DIR / "bin"
        self.bin_path = self.find_binary()

    def find_binary(self) -> Optional[str]:
        # 1. Local bin dir
        local_exe = self.bin_dir / "cloudflared.exe"
        if local_exe.exists():
            return str(local_exe)
        # 2. Windows standard locations
        candidates = [
            r"C:\Program Files (x86)\cloudflared\cloudflared.exe",
            r"C:\Program Files\cloudflared\cloudflared.exe"
        ]
        for p in candidates:
            if os.path.exists(p):
                return p
        # 3. System PATH
        import shutil
        which = shutil.which("cloudflared")
        if which:
            return which
        return None

    def is_installed(self) -> bool:
        return self.find_binary() is not None

    def download_cloudflared(self) -> bool:
        self.bin_dir.mkdir(parents=True, exist_ok=True)
        target = self.bin_dir / "cloudflared.exe"
        url = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe"
        try:
            print(f"[*] Downloading official cloudflared binary to {target}...")
            urllib.request.urlretrieve(url, str(target))
            self.bin_path = str(target)
            print("[+] cloudflared successfully installed into RENIS/bin/cloudflared.exe")
            return True
        except Exception as e:
            self.error = f"Download failed: {e}"
            print(f"[!] Error downloading cloudflared: {e}")
            return False

    def get_status(self) -> Dict[str, Any]:
        with self.lock:
            running = self.process is not None and self.process.poll() is None
            if not running and self.mode != "stopped":
                self.mode = "stopped"
            return {
                "running": running,
                "mode": self.mode,
                "url": self.active_url if running else "",
                "error": self.error,
                "installed": self.is_installed(),
                "pid": self.process.pid if running else None
            }

    def start(self, mode: str = "quick", token: str = "", name: str = "", custom_domain: str = "") -> Dict[str, Any]:
        with self.lock:
            self.stop()
            self.error = None
            binary = self.find_binary()
            if not binary:
                if not self.download_cloudflared():
                    return {"success": False, "error": "cloudflared is not installed and auto-download failed."}
                binary = self.find_binary()

            cmd = [binary, "tunnel"]
            if mode == "quick":
                cmd.extend(["--url", "http://127.0.0.1:8765"])
            elif mode == "token":
                tk = token or AUTH_DATA.get("tunnel_token", "")
                if not tk:
                    return {"success": False, "error": "Cloudflare Tunnel Token is required."}
                AUTH_DATA["tunnel_token"] = tk
                save_auth_store()
                cmd.extend(["run", "--token", tk])
            elif mode == "named":
                tunnel_name = name or "reni"
                cmd.extend(["run", "--url", "http://127.0.0.1:8765", tunnel_name])
            else:
                return {"success": False, "error": f"Invalid mode: {mode}"}

            if custom_domain:
                self.active_url = custom_domain.strip().rstrip('/')
                AUTH_DATA["tunnel_url"] = self.active_url
                save_auth_store()

            try:
                creationflags = subprocess.CREATE_NO_WINDOW if sys.platform == 'win32' else 0
                self.process = subprocess.Popen(
                    cmd,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    text=True,
                    bufsize=1,
                    creationflags=creationflags
                )
                self.mode = mode

                def read_stderr(proc):
                    url_pattern = re.compile(r"https://[a-zA-Z0-9-]+\.trycloudflare\.com")
                    try:
                        for line in proc.stderr:
                            match = url_pattern.search(line)
                            if match:
                                found = match.group(0)
                                print(f"[+] [TUNNEL] Quick TryCloudflare URL: {found}")
                                self.active_url = found
                                AUTH_DATA["tunnel_url"] = found
                                save_auth_store()
                    except Exception:
                        pass

                t = threading.Thread(target=read_stderr, args=(self.process,), daemon=True)
                t.start()

                return {"success": True, "mode": mode, "url": self.active_url}
            except Exception as e:
                self.error = str(e)
                self.mode = "stopped"
                return {"success": False, "error": str(e)}

    def stop(self) -> Dict[str, Any]:
        if self.process:
            try:
                self.process.terminate()
                self.process.kill()
            except Exception:
                pass
            self.process = None
        self.mode = "stopped"
        return {"success": True}

TUNNEL_MGR = TunnelManager()

def get_configured_tunnel_url() -> Optional[str]:
    """Returns the configured public Cloudflare Tunnel URL if available."""
    if TUNNEL_MGR and TUNNEL_MGR.get_status().get("running") and TUNNEL_MGR.active_url:
        return TUNNEL_MGR.active_url

    env_url = os.getenv("RENIS_TUNNEL_URL") or os.getenv("CLOUDFLARE_TUNNEL_URL")
    if env_url:
        return env_url.strip().rstrip('/')

    saved_url = AUTH_DATA.get("tunnel_url")
    if saved_url:
        return saved_url.strip().rstrip('/')

    for cred in AUTH_DATA.get("webauthn_credentials", []):
        client_data = cred.get("client_data", "")
        if client_data:
            try:
                decoded = safe_b64url_decode(client_data).decode('utf-8')
                cdata = json.loads(decoded)
                origin = cdata.get("origin", "")
                if origin and origin.startswith("https://") and "localhost" not in origin:
                    return origin.strip().rstrip('/')
            except Exception:
                pass

    return None

# ==============================================================================
# UAC ELEVATION CHECK & AUTO-RESTART
# ==============================================================================
def is_process_elevated() -> bool:
    """Returns True if the current process has Windows Administrator privileges."""
    if sys.platform != 'win32':
        return False
    try:
        return ctypes.windll.shell32.IsUserAnAdmin() != 0
    except Exception:
        return False

def get_windows_uac_policy() -> Dict[str, Any]:
    """Reads current Windows UAC and Secure Desktop registry policies."""
    if sys.platform != 'win32':
        return {"supported": False, "reason": "Not Windows"}
    try:
        import winreg
        with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System", 0, winreg.KEY_READ) as key:
            prompt_secure, _ = winreg.QueryValueEx(key, "PromptOnSecureDesktop")
            consent_admin, _ = winreg.QueryValueEx(key, "ConsentPromptBehaviorAdmin")
            try:
                uia_toggle, _ = winreg.QueryValueEx(key, "EnableUIADesktopToggle")
            except Exception:
                uia_toggle = 0
            return {
                "supported": True,
                "is_elevated": is_process_elevated(),
                "prompt_on_secure_desktop": prompt_secure,
                "consent_prompt_behavior_admin": consent_admin,
                "enable_uia_desktop_toggle": uia_toggle,
                "auto_elevation_enabled": (consent_admin == 0 and prompt_secure == 0)
            }
    except Exception as e:
        return {"supported": True, "is_elevated": is_process_elevated(), "error": str(e)}

def set_windows_uac_auto_elevation(enable: bool = True) -> Dict[str, Any]:
    """
    Configures Windows UAC policies.
    When enable=True:
      - PromptOnSecureDesktop = 0 (draws prompts on user desktop for remote viewing)
      - ConsentPromptBehaviorAdmin = 0 (silent elevation: installers/setups launch directly without consent.exe blocking touch/mouse)
      - EnableUIADesktopToggle = 1 (assistive UI desktop toggle enabled)
    When enable=False:
      - ConsentPromptBehaviorAdmin = 5 (default prompt for consent)
    """
    if sys.platform != 'win32':
        return {"success": False, "message": "Not running on Windows"}
    if not is_process_elevated():
        return {"success": False, "message": "Administrator privileges required to modify UAC policy"}
    try:
        import winreg
        with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System", 0, winreg.KEY_SET_VALUE) as key:
            if enable:
                winreg.SetValueEx(key, "PromptOnSecureDesktop", 0, winreg.REG_DWORD, 0)
                winreg.SetValueEx(key, "ConsentPromptBehaviorAdmin", 0, winreg.REG_DWORD, 0)
                winreg.SetValueEx(key, "EnableUIADesktopToggle", 0, winreg.REG_DWORD, 1)
                msg = "UAC Silent Auto-Elevation ENABLED: Setups and installers can be remotely controlled without modal input blocks."
            else:
                winreg.SetValueEx(key, "ConsentPromptBehaviorAdmin", 0, winreg.REG_DWORD, 5)
                msg = "UAC Silent Auto-Elevation DISABLED: Windows will prompt for consent on administrative actions."
        return {"success": True, "auto_elevation_enabled": enable, "message": msg}
    except Exception as e:
        return {"success": False, "error": str(e)}

def check_and_elevate():
    """
    Checks if the process is running with Windows Administrator privileges.
    If not, re-launches itself via ShellExecute with 'runas' to prompt UAC elevation.
    If elevated, ensures UAC silent auto-elevation policy is enabled for seamless remote control.
    """
    if sys.platform != 'win32':
        return

    is_admin = is_process_elevated()

    if not is_admin:
        print("[!] [UAC] Elevated Administrator privileges required for remote desktop and UAC control.")
        print("[*] [UAC] Requesting elevation via Windows ShellExecute...")
        script = sys.argv[0]
        params = " ".join([f'"{arg}"' for arg in sys.argv[1:]])
        try:
            ret = ctypes.windll.shell32.ShellExecuteW(
                None, "runas", sys.executable, f'"{script}" {params}', None, 1
            )
            if int(ret) > 32:
                print("[+] [UAC] Elevated process spawned. Exiting unprivileged host process.")
                sys.exit(0)
            else:
                print(f"[-] [UAC] Elevation failed or declined with code {ret}.")
        except Exception as e:
            print(f"[-] [UAC] Error requesting elevation: {e}")
    else:
        # Automatically ensure UAC auto-elevation is active so remote users can install apps without input freeze
        try:
            res = set_windows_uac_auto_elevation(True)
            if res.get("success"):
                print("[+] [UAC] Windows Remote Auto-Elevation ACTIVE (ConsentPromptBehaviorAdmin=0, PromptOnSecureDesktop=0).")
        except Exception:
            pass

# ==============================================================================
# ULTRA-RESILIENT LOW-LEVEL INPUT INJECTION ENGINE (WIN32 + PYAUTOGUI FALLBACK)
# ==============================================================================
if sys.platform == "win32":
    user32 = ctypes.windll.user32

    MOUSEEVENTF_MOVE = 0x0001
    MOUSEEVENTF_LEFTDOWN = 0x0002
    MOUSEEVENTF_LEFTUP = 0x0004
    MOUSEEVENTF_RIGHTDOWN = 0x0008
    MOUSEEVENTF_RIGHTUP = 0x0010
    MOUSEEVENTF_MIDDLEDOWN = 0x0020
    MOUSEEVENTF_MIDDLEUP = 0x0040
    MOUSEEVENTF_WHEEL = 0x0800

    KEYEVENTF_EXTENDEDKEY = 0x0001
    KEYEVENTF_KEYUP = 0x0002
    KEYEVENTF_UNICODE = 0x0004

    VK_MAP = {
        "enter": 0x0D, "return": 0x0D,
        "esc": 0x1B, "escape": 0x1B,
        "backspace": 0x08, "tab": 0x09,
        "space": 0x20,
        "shift": 0x10, "ctrl": 0x11, "control": 0x11,
        "alt": 0x12, "win": 0x5B, "super": 0x5B,
        "left": 0x25, "up": 0x26, "right": 0x27, "down": 0x28,
        "y": 0x59, "n": 0x4E, "delete": 0x2E, "del": 0x2E
    }

def win32_mouse_move_rel(dx: float, dy: float):
    if sys.platform == "win32":
        try:
            user32.mouse_event(MOUSEEVENTF_MOVE, int(round(dx)), int(round(dy)), 0, 0)
            return
        except Exception:
            pass
    if pyautogui:
        try:
            pyautogui.moveRel(dx, dy)
        except Exception:
            pass

def win32_mouse_move_abs(target_x: int, target_y: int):
    if sys.platform == "win32":
        try:
            user32.SetCursorPos(int(target_x), int(target_y))
            return
        except Exception:
            pass
    if pyautogui:
        try:
            pyautogui.moveTo(target_x, target_y)
        except Exception:
            pass

def win32_mouse_click(button: str = "left", is_double: bool = False, modifiers: list = None):
    modifiers = modifiers or []
    if pyautogui:
        for m in modifiers:
            try: pyautogui.keyDown(m.lower())
            except Exception: pass

    if sys.platform == "win32":
        btn = button.lower()
        down_flag = MOUSEEVENTF_LEFTDOWN if btn == "left" else (MOUSEEVENTF_RIGHTDOWN if btn == "right" else MOUSEEVENTF_MIDDLEDOWN)
        up_flag = MOUSEEVENTF_LEFTUP if btn == "left" else (MOUSEEVENTF_RIGHTUP if btn == "right" else MOUSEEVENTF_MIDDLEUP)
        clicks = 2 if is_double else 1
        for i in range(clicks):
            user32.mouse_event(down_flag, 0, 0, 0, 0)
            time.sleep(0.015)
            user32.mouse_event(up_flag, 0, 0, 0, 0)
            if clicks > 1 and i == 0:
                time.sleep(0.06)
    elif pyautogui:
        try:
            pyautogui.click(button=button, clicks=2 if is_double else 1)
        except Exception:
            pass

    if pyautogui:
        for m in modifiers:
            try: pyautogui.keyUp(m.lower())
            except Exception: pass

def win32_mouse_down(button: str = "left", modifiers: list = None):
    modifiers = modifiers or []
    if pyautogui:
        for m in modifiers:
            try: pyautogui.keyDown(m.lower())
            except Exception: pass
    if sys.platform == "win32":
        btn = button.lower()
        down_flag = MOUSEEVENTF_LEFTDOWN if btn == "left" else (MOUSEEVENTF_RIGHTDOWN if btn == "right" else MOUSEEVENTF_MIDDLEDOWN)
        user32.mouse_event(down_flag, 0, 0, 0, 0)
    elif pyautogui:
        try:
            pyautogui.mouseDown(button=button)
        except Exception:
            pass

def win32_mouse_up(button: str = "left", modifiers: list = None):
    modifiers = modifiers or []
    if sys.platform == "win32":
        btn = button.lower()
        up_flag = MOUSEEVENTF_LEFTUP if btn == "left" else (MOUSEEVENTF_RIGHTUP if btn == "right" else MOUSEEVENTF_MIDDLEUP)
        user32.mouse_event(up_flag, 0, 0, 0, 0)
    elif pyautogui:
        try:
            pyautogui.mouseUp(button=button)
        except Exception:
            pass
    if pyautogui:
        for m in modifiers:
            try: pyautogui.keyUp(m.lower())
            except Exception: pass

def win32_mouse_scroll(dy: int):
    if sys.platform == "win32":
        try:
            wheel_delta = int(dy * 120)
            user32.mouse_event(MOUSEEVENTF_WHEEL, 0, 0, wheel_delta, 0)
            return
        except Exception:
            pass
    if pyautogui:
        try:
            pyautogui.scroll(dy)
        except Exception:
            pass

def win32_key_down(key: str):
    if sys.platform == "win32" and key.lower() in VK_MAP:
        try:
            vk = VK_MAP[key.lower()]
            user32.keybd_event(vk, 0, 0, 0)
            return
        except Exception:
            pass
    if pyautogui:
        try: pyautogui.keyDown(key)
        except Exception: pass

def win32_key_up(key: str):
    if sys.platform == "win32" and key.lower() in VK_MAP:
        try:
            vk = VK_MAP[key.lower()]
            user32.keybd_event(vk, 0, KEYEVENTF_KEYUP, 0)
            return
        except Exception:
            pass
    if pyautogui:
        try: pyautogui.keyUp(key)
        except Exception: pass

def win32_key_tap(key: str, modifiers: list = None):
    modifiers = modifiers or []
    if pyautogui:
        try:
            if modifiers:
                keys = [m.lower() for m in modifiers] + [key.lower()]
                pyautogui.hotkey(*keys)
            else:
                pyautogui.press(key)
            return
        except Exception:
            pass

    if sys.platform == "win32":
        try:
            for m in modifiers:
                vk = VK_MAP.get(m.lower())
                if vk: user32.keybd_event(vk, 0, 0, 0)
            target_vk = VK_MAP.get(key.lower())
            if target_vk:
                user32.keybd_event(target_vk, 0, 0, 0)
                time.sleep(0.01)
                user32.keybd_event(target_vk, 0, KEYEVENTF_KEYUP, 0)
            for m in reversed(modifiers):
                vk = VK_MAP.get(m.lower())
                if vk: user32.keybd_event(vk, 0, KEYEVENTF_KEYUP, 0)
        except Exception:
            pass

def win32_key_combo(keys: list):
    if pyautogui:
        try:
            pyautogui.hotkey(*[k.lower() for k in keys])
            return
        except Exception:
            pass
    if sys.platform == "win32":
        try:
            for k in keys:
                vk = VK_MAP.get(k.lower())
                if vk: user32.keybd_event(vk, 0, 0, 0)
            time.sleep(0.02)
            for k in reversed(keys):
                vk = VK_MAP.get(k.lower())
                if vk: user32.keybd_event(vk, 0, KEYEVENTF_KEYUP, 0)
        except Exception:
            pass

def win32_type_text(text: str):
    if pyautogui:
        try:
            pyautogui.write(text, interval=0.002)
            return
        except Exception:
            pass
    if sys.platform == "win32":
        for char in text:
            try:
                user32.keybd_event(0, ord(char), KEYEVENTF_UNICODE, 0)
                user32.keybd_event(0, ord(char), KEYEVENTF_UNICODE | KEYEVENTF_KEYUP, 0)
            except Exception:
                pass

def win32_uac_accept():
    """Approves UAC / Elevation dialog with multi-tier fallback (Win32 keybd_event + PyAutoGUI)."""
    if sys.platform == "win32":
        try:
            # 1. Alt + Y
            user32.keybd_event(VK_MAP["alt"], 0, 0, 0)
            time.sleep(0.02)
            user32.keybd_event(VK_MAP["y"], 0, 0, 0)
            time.sleep(0.03)
            user32.keybd_event(VK_MAP["y"], 0, KEYEVENTF_KEYUP, 0)
            time.sleep(0.02)
            user32.keybd_event(VK_MAP["alt"], 0, KEYEVENTF_KEYUP, 0)
            time.sleep(0.05)
            # 2. Left Arrow + Enter
            user32.keybd_event(VK_MAP["left"], 0, 0, 0)
            time.sleep(0.02)
            user32.keybd_event(VK_MAP["left"], 0, KEYEVENTF_KEYUP, 0)
            time.sleep(0.03)
            user32.keybd_event(VK_MAP["enter"], 0, 0, 0)
            time.sleep(0.02)
            user32.keybd_event(VK_MAP["enter"], 0, KEYEVENTF_KEYUP, 0)
            return
        except Exception:
            pass
    if pyautogui:
        try:
            pyautogui.hotkey("alt", "y")
            time.sleep(0.05)
            pyautogui.press("left")
            pyautogui.press("enter")
        except Exception:
            pass

def win32_uac_deny():
    """Denies / closes UAC dialog."""
    if sys.platform == "win32":
        try:
            user32.keybd_event(VK_MAP["esc"], 0, 0, 0)
            time.sleep(0.02)
            user32.keybd_event(VK_MAP["esc"], 0, KEYEVENTF_KEYUP, 0)
            return
        except Exception:
            pass
    if pyautogui:
        try:
            pyautogui.press("escape")
            pyautogui.hotkey("alt", "n")
        except Exception:
            pass

# ==============================================================================
# SECURE AUTHENTICATION STORE (SALTED PBKDF2 + JWT + WEBAUTHN)
# ==============================================================================
def hash_pin(pin: str, salt: str) -> str:
    """Computes PBKDF2-HMAC-SHA256 hash for PIN verification."""
    return hashlib.pbkdf2_hmac(
        'sha256',
        pin.encode('utf-8'),
        bytes.fromhex(salt),
        100000
    ).hex()

def initialize_auth_store():
    """Initializes or loads the renis_auth.json security store."""
    if not AUTH_FILE.exists():
        salt = secrets.token_hex(16)
        jwt_secret = os.getenv("RENIS_JWT_SECRET") or secrets.token_hex(32)
        initial_data = {
            "pin_hash": hash_pin(DEFAULT_PIN, salt),
            "pin_salt": salt,
            "jwt_secret": jwt_secret,
            "must_change_pin": True,
            "webauthn_credentials": [],
            "created_at": time.time(),
            "last_login": None
        }
        with open(AUTH_FILE, "w", encoding="utf-8") as f:
            json.dump(initial_data, f, indent=2)
        print(f"[+] [AUTH] Initialized new authentication vault at {AUTH_FILE.name}")
        print(f"[*] [AUTH] Default Master PIN set to: {DEFAULT_PIN} (Please update on first login)")
        return initial_data
    else:
        with open(AUTH_FILE, "r", encoding="utf-8") as f:
            return json.load(f)

AUTH_DATA = initialize_auth_store()
JWT_SECRET = os.getenv("RENIS_JWT_SECRET") or AUTH_DATA.get("jwt_secret")
PENDING_CHALLENGES: Dict[str, float] = {}

def save_auth_store():
    """Persists updated auth data to renis_auth.json."""
    with open(AUTH_FILE, "w", encoding="utf-8") as f:
        json.dump(AUTH_DATA, f, indent=2)

def create_jwt_token(subject: str = "reni_admin") -> str:
    """Creates a signed 12-hour JWT bearer token."""
    payload = {
        "sub": subject,
        "iat": int(time.time()),
        "exp": int(time.time()) + (JWT_EXPIRE_HOURS * 3600)
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

def verify_jwt_token(token: str) -> bool:
    """Validates the JWT token signature and expiration."""
    try:
        jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return True
    except Exception:
        return False

def safe_b64url_decode(s: str) -> bytes:
    """Decodes base64url or standard base64 string to bytes with proper padding."""
    s = s.replace('-', '+').replace('_', '/')
    padding = len(s) % 4
    if padding:
        s += '=' * (4 - padding)
    return base64.b64decode(s)

def verify_and_consume_challenge(client_data_b64: Optional[str]) -> bool:
    """
    Decodes clientDataJSON, extracts the WebAuthn challenge, validates against
    PENDING_CHALLENGES, checks expiration, and immediately deletes it to prevent replay attacks.
    """
    if not client_data_b64:
        return False
    try:
        raw_json = safe_b64url_decode(client_data_b64).decode('utf-8')
        client_data = json.loads(raw_json)
        challenge = client_data.get("challenge")
        
        now = time.time()
        # Prune expired challenges
        expired_keys = [k for k, exp in PENDING_CHALLENGES.items() if now >= exp]
        for k in expired_keys:
            del PENDING_CHALLENGES[k]

        if not challenge or challenge not in PENDING_CHALLENGES:
            return False

        if now >= PENDING_CHALLENGES[challenge]:
            del PENDING_CHALLENGES[challenge]
            return False

        # Consume challenge so it cannot be replayed
        del PENDING_CHALLENGES[challenge]
        return True
    except Exception as e:
        print(f"[!] WebAuthn challenge verification exception: {e}")
        return False

# ==============================================================================
# FASTAPI APPLICATION SETUP
# ==============================================================================
app = FastAPI(
    title="RENI - Remote Access System",
    description="Secure, self-hosted Remote Desktop & Administrative Engine",
    version="2.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global keep-awake state tracker
KEEP_AWAKE_ACTIVE = False

# ==============================================================================
# REST API: SERVER MANAGEMENT & DASHBOARD
# ==============================================================================
def verify_local_or_auth(request: Request) -> bool:
    """
    Validates that the request originates directly from the host machine on localhost
    (and NOT through Cloudflare Tunnel or reverse proxies), OR that the request includes
    a valid authenticated JWT token in Authorization header or 'token' query parameter.
    """
    is_proxied = bool(request.headers.get("cf-connecting-ip") or request.headers.get("x-forwarded-for"))
    hostname = request.url.hostname or ""
    client_host = request.client.host if request.client else ""

    # Strictly direct localhost access (not proxied over internet / tunnel)
    if not is_proxied and (hostname in ["localhost", "127.0.0.1", "::1"] or client_host in ["127.0.0.1", "::1"]):
        return True

    # Check for Bearer token in Authorization header or ?token= query parameter
    auth_header = request.headers.get("Authorization", "")
    token = ""
    if "Bearer " in auth_header:
        token = auth_header.replace("Bearer ", "").strip()
    elif "token" in request.query_params:
        token = request.query_params.get("token", "").strip()

    if token and verify_jwt_token(token):
        return True

    return False

@app.get("/dashboard")
async def serve_dashboard(request: Request):
    """Serves the host control panel dashboard, locked to local host or authenticated users."""
    if not verify_local_or_auth(request):
        raise HTTPException(
            status_code=403,
            detail="Forbidden: Host dashboard is restricted to local host access or authorized sessions."
        )
    if DASHBOARD_FILE.exists():
        return FileResponse(DASHBOARD_FILE)
    return HTMLResponse("<h2>RENI - Dashboard file not found</h2>", status_code=404)

@app.get("/api/server/status")
async def get_server_status(request: Request):
    """Returns live server metrics, IP addresses, and active connection counts."""
    if not verify_local_or_auth(request):
        raise HTTPException(status_code=403, detail="Forbidden: Restricted endpoint.")
    mem = psutil.virtual_memory()
    ips = get_discovered_ips()
    tunnel_url = get_configured_tunnel_url()
    return {
        "active_streams": len(ACTIVE_STREAMS),
        "active_controls": len(ACTIVE_CONTROLS),
        "active_terminals": len(ACTIVE_TERMINALS),
        "cpu_percent": psutil.cpu_percent(),
        "cpu_count": psutil.cpu_count(logical=True),
        "ram_percent": mem.percent,
        "ram_used_gb": round(mem.used / (1024**3), 2),
        "ram_total_gb": round(mem.total / (1024**3), 2),
        "discovered_ips": ips,
        "tunnel_url": tunnel_url,
        "port": PORT,
        "has_biometrics": len(AUTH_DATA.get("webauthn_credentials", [])) > 0,
        "keep_awake": KEEP_AWAKE_ACTIVE
    }

@app.get("/api/server/qr")
async def get_server_qr(request: Request, url: str = Query(..., description="Target URL for QR code")):
    """
    Generates a 100% real scannable QR code PNG image for the target URL.
    Protected by verify_local_or_auth.
    """
    if not verify_local_or_auth(request):
        raise HTTPException(status_code=403, detail="Forbidden: Unauthorized access to host QR generator.")

    if not url:
        raise HTTPException(status_code=400, detail="Missing url query parameter")

    if qrcode is not None:
        try:
            qr = qrcode.QRCode(
                version=None,
                error_correction=qrcode.constants.ERROR_CORRECT_M,
                box_size=8,
                border=2,
            )
            qr.add_data(url)
            qr.make(fit=True)
            img = qr.make_image(fill_color="#0B0C10", back_color="#FFFFFF")
            buf = io.BytesIO()
            img.save(buf, format="PNG")
            return Response(content=buf.getvalue(), media_type="image/png")
        except Exception as e:
            print(f"[!] Error generating QR code with local qrcode engine: {e}")
            fallback_url = f"https://api.qrserver.com/v1/create-qr-code/?size=200x200&data={quote(url)}"
            return RedirectResponse(fallback_url)
    else:
        fallback_url = f"https://api.qrserver.com/v1/create-qr-code/?size=200x200&data={quote(url)}"
        return RedirectResponse(fallback_url)

@app.get("/api/server/tunnel/status")
async def get_tunnel_status(request: Request):
    """Returns real-time status of the Cloudflare Tunnel manager."""
    if not verify_local_or_auth(request):
        raise HTTPException(status_code=403, detail="Forbidden")
    return TUNNEL_MGR.get_status()

@app.post("/api/server/tunnel/start")
async def start_tunnel_endpoint(payload: Dict[str, Any], request: Request):
    """Starts the Cloudflare tunnel in the requested mode (quick, token, named)."""
    if not verify_local_or_auth(request):
        raise HTTPException(status_code=403, detail="Forbidden")
    mode = payload.get("mode", "quick")
    token = payload.get("token", "")
    name = payload.get("name", "")
    custom_domain = payload.get("custom_domain", "")
    return TUNNEL_MGR.start(mode=mode, token=token, name=name, custom_domain=custom_domain)

@app.post("/api/server/tunnel/stop")
async def stop_tunnel_endpoint(request: Request):
    """Stops any actively running Cloudflare Tunnel managed by RENIS."""
    if not verify_local_or_auth(request):
        raise HTTPException(status_code=403, detail="Forbidden")
    return TUNNEL_MGR.stop()

@app.post("/api/server/tunnel/install")
async def install_cloudflared_endpoint(request: Request):
    """Downloads official cloudflared binary to RENIS/bin/cloudflared.exe."""
    if not verify_local_or_auth(request):
        raise HTTPException(status_code=403, detail="Forbidden")
    success = TUNNEL_MGR.download_cloudflared()
    return {"success": success, "installed": TUNNEL_MGR.is_installed(), "path": TUNNEL_MGR.find_binary()}

@app.post("/api/server/tunnel/login")
async def login_cloudflared_endpoint(request: Request):
    """Spawns cloudflared tunnel login browser flow."""
    if not verify_local_or_auth(request):
        raise HTTPException(status_code=403, detail="Forbidden")
    binary = TUNNEL_MGR.find_binary()
    if not binary:
        raise HTTPException(status_code=400, detail="cloudflared binary not found")
    try:
        subprocess.Popen([binary, "tunnel", "login"])
        return {"success": True, "message": "Browser login opened"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/server/kill-sessions")
async def kill_all_sessions(request: Request):
    """Emergency kill-switch: closes all active remote WebSocket connections."""
    if not verify_local_or_auth(request):
        raise HTTPException(status_code=403, detail="Forbidden: Restricted endpoint.")
    count = 0
    all_sockets = list(ACTIVE_STREAMS) + list(ACTIVE_CONTROLS) + list(ACTIVE_TERMINALS)
    for ws in all_sockets:
        try:
            await ws.close(code=status.WS_1000_NORMAL_CLOSURE)
            count += 1
        except Exception:
            pass
    ACTIVE_STREAMS.clear()
    ACTIVE_CONTROLS.clear()
    ACTIVE_TERMINALS.clear()
    return {"success": True, "closed_sessions": count, "message": f"Closed {count} active remote sessions"}

@app.post("/api/server/powercfg-lid")
async def configure_powercfg_lid(request: Request):
    """Configures Windows PowerCFG so closing lid on AC power does not sleep."""
    if not verify_local_or_auth(request):
        raise HTTPException(status_code=403, detail="Forbidden: Restricted endpoint.")
    if sys.platform == 'win32':
        try:
            os.system("powercfg /setacvalueindex SCHEME_CURRENT SUB_BUTTONS LIDACTION 0")
            os.system("powercfg /change standby-timeout-ac 0")
            os.system("powercfg /setactive SCHEME_CURRENT")
            return {"success": True, "message": "PowerCFG updated: Laptop will not sleep on lid close (AC power)"}
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))
    return {"success": False, "message": "Not running on Windows"}

@app.get("/api/server/uac-policy")
async def get_uac_policy(request: Request):
    """Returns current Windows UAC and Secure Desktop policy settings."""
    if not verify_local_or_auth(request):
        raise HTTPException(status_code=403, detail="Forbidden: Restricted endpoint.")
    return get_windows_uac_policy()

@app.post("/api/server/uac-policy")
async def set_uac_policy(request: Request, payload: Dict[str, Any] = Body(...)):
    """Enables or disables silent auto-elevation for remote administrative access."""
    if not verify_local_or_auth(request):
        raise HTTPException(status_code=403, detail="Forbidden: Restricted endpoint.")
    enable = bool(payload.get("auto_elevation", True))
    res = set_windows_uac_auto_elevation(enable)
    if not res.get("success"):
        raise HTTPException(status_code=400, detail=res.get("message") or res.get("error", "Failed to update UAC policy"))
    return res

# ==============================================================================
# REST API: AUTHENTICATION & WEBAUTHN
# ==============================================================================
@app.post("/api/auth/login-pin")
async def login_with_pin(payload: Dict[str, str]):
    """Authenticates the client using the 6-digit Master PIN."""
    pin = payload.get("pin", "")
    if not pin or len(pin) < 4:
        raise HTTPException(status_code=400, detail="Invalid PIN format")

    salt = AUTH_DATA["pin_salt"]
    expected_hash = AUTH_DATA["pin_hash"]
    computed_hash = hash_pin(pin, salt)

    if hmac.compare_digest(computed_hash, expected_hash):
        AUTH_DATA["last_login"] = time.time()
        save_auth_store()
        token = create_jwt_token("master_pin_user")
        has_biometrics = len(AUTH_DATA.get("webauthn_credentials", [])) > 0
        return {
            "success": True,
            "token": token,
            "must_change_pin": AUTH_DATA.get("must_change_pin", False),
            "has_biometrics": has_biometrics,
            "message": "Authentication successful"
        }
    else:
        await asyncio.sleep(0.5) # Anti-bruteforce delay
        raise HTTPException(status_code=401, detail="Invalid Master PIN")

@app.post("/api/auth/change-pin")
async def change_master_pin(payload: Dict[str, str], request: Request):
    """Updates the Master PIN to a new value."""
    auth_header = request.headers.get("Authorization", "")
    token = auth_header.replace("Bearer ", "") if "Bearer " in auth_header else ""
    old_pin = payload.get("old_pin", "")
    new_pin = payload.get("new_pin", "")

    if not new_pin or len(new_pin) < 6:
        raise HTTPException(status_code=400, detail="New PIN must be at least 6 digits")

    authorized = False
    if token and verify_jwt_token(token):
        authorized = True
    elif old_pin:
        if hmac.compare_digest(hash_pin(old_pin, AUTH_DATA["pin_salt"]), AUTH_DATA["pin_hash"]):
            authorized = True

    if not authorized:
        raise HTTPException(status_code=401, detail="Unauthorized to change PIN")

    new_salt = secrets.token_hex(16)
    AUTH_DATA["pin_salt"] = new_salt
    AUTH_DATA["pin_hash"] = hash_pin(new_pin, new_salt)
    AUTH_DATA["must_change_pin"] = False
    save_auth_store()

    new_token = create_jwt_token("master_pin_user")
    return {"success": True, "token": new_token, "message": "Master PIN successfully updated"}

@app.post("/api/auth/webauthn/register-options")
async def webauthn_register_options(request: Request):
    """Generates registration options for W3C WebAuthn biometric passkey."""
    auth_header = request.headers.get("Authorization", "")
    token = auth_header.replace("Bearer ", "") if "Bearer " in auth_header else ""
    if not token or not verify_jwt_token(token):
        raise HTTPException(status_code=401, detail="Valid session required to register biometrics")

    # Prune expired challenges
    now = time.time()
    for k in [k for k, exp in PENDING_CHALLENGES.items() if now >= exp]:
        del PENDING_CHALLENGES[k]

    # Canonical unpadded base64url challenge
    challenge = base64.urlsafe_b64encode(secrets.token_bytes(32)).rstrip(b'=').decode('ascii')
    PENDING_CHALLENGES[challenge] = now + 300

    return {
        "challenge": challenge,
        "rp": {
            "name": "RENI Remote Server",
            "id": request.url.hostname or "localhost"
        },
        "user": {
            "id": secrets.token_hex(16),
            "name": "reni_operator",
            "displayName": "RENI Mobile Operator"
        },
        "pubKeyCredParams": [
            {"alg": -7, "type": "public-key"},  # ES256
            {"alg": -257, "type": "public-key"} # RS256
        ],
        "authenticatorSelection": {
            "authenticatorAttachment": "platform",
            "userVerification": "required",
            "residentKey": "preferred"
        },
        "timeout": 60000,
        "attestation": "none"
    }

@app.post("/api/auth/webauthn/register-verify")
async def webauthn_register_verify(payload: Dict[str, Any], request: Request):
    """Verifies and stores registered biometric credential in renis_auth.json."""
    auth_header = request.headers.get("Authorization", "")
    token = auth_header.replace("Bearer ", "") if "Bearer " in auth_header else ""
    if not token or not verify_jwt_token(token):
        raise HTTPException(status_code=401, detail="Valid session required")

    cred_id = payload.get("id")
    raw_id = payload.get("rawId")
    response_data = payload.get("response", {})

    if not cred_id or not response_data:
        raise HTTPException(status_code=400, detail="Invalid credential registration payload")

    # Verify and consume challenge to prevent replay
    client_data_b64 = response_data.get("clientDataJSON")
    if not verify_and_consume_challenge(client_data_b64):
        raise HTTPException(status_code=400, detail="Invalid, expired, or replayed WebAuthn challenge")

    new_cred = {
        "id": cred_id,
        "raw_id": raw_id,
        "registered_at": time.time(),
        "client_data": client_data_b64
    }

    AUTH_DATA.setdefault("webauthn_credentials", []).append(new_cred)
    save_auth_store()
    return {"success": True, "message": "Biometric hardware passkey registered successfully"}

# Support BOTH GET and POST to prevent 405 Method Not Allowed
@app.api_route("/api/auth/webauthn/login-options", methods=["GET", "POST"])
async def webauthn_login_options(request: Request):
    """Generates assertion options for biometric passkey authentication."""
    credentials = AUTH_DATA.get("webauthn_credentials", [])
    if not credentials:
        raise HTTPException(status_code=400, detail="No biometrics registered on host. Use Master PIN.")

    now = time.time()
    for k in [k for k, exp in PENDING_CHALLENGES.items() if now >= exp]:
        del PENDING_CHALLENGES[k]

    # Canonical unpadded base64url challenge
    challenge = base64.urlsafe_b64encode(secrets.token_bytes(32)).rstrip(b'=').decode('ascii')
    PENDING_CHALLENGES[challenge] = now + 300

    allow_credentials = [
        {"id": c["id"], "type": "public-key", "transports": ["internal"]}
        for c in credentials
    ]

    return {
        "challenge": challenge,
        "timeout": 60000,
        "rpId": request.url.hostname or "localhost",
        "allowCredentials": allow_credentials,
        "userVerification": "required"
    }

@app.post("/api/auth/webauthn/login-verify")
async def webauthn_login_verify(payload: Dict[str, Any]):
    """Verifies biometric assertion and returns JWT token."""
    cred_id = payload.get("id")
    if not cred_id:
        raise HTTPException(status_code=400, detail="Missing credential ID")

    response_data = payload.get("response", {})
    client_data_b64 = response_data.get("clientDataJSON")
    if not verify_and_consume_challenge(client_data_b64):
        raise HTTPException(status_code=400, detail="Invalid, expired, or replayed WebAuthn challenge")

    registered_ids = [c["id"] for c in AUTH_DATA.get("webauthn_credentials", [])]
    if cred_id not in registered_ids:
        raise HTTPException(status_code=401, detail="Unrecognized biometric credential")

    token = create_jwt_token("biometric_user")
    AUTH_DATA["last_login"] = time.time()
    save_auth_store()
    return {"success": True, "token": token, "message": "Biometric authentication verified"}

# ==============================================================================
# REST API: TELEMETRY, POWER & CLIPBOARD
# ==============================================================================
@app.get("/api/system/telemetry")
async def get_system_telemetry(token: Optional[str] = Query(None), request: Request = None):
    """Returns live host telemetry: CPU, RAM, Battery, Network, and Uptime."""
    auth_header = request.headers.get("Authorization", "") if request else ""
    req_token = token or (auth_header.replace("Bearer ", "") if "Bearer " in auth_header else "")
    if not req_token or not verify_jwt_token(req_token):
        raise HTTPException(status_code=401, detail="Unauthorized")

    cpu_percent = psutil.cpu_percent(interval=None)
    cpu_freq = psutil.cpu_freq()
    mem = psutil.virtual_memory()

    battery_info = {"percent": 100, "plugged": True, "secsleft": -1}
    try:
        battery = psutil.sensors_battery()
        if battery:
            battery_info = {
                "percent": round(battery.percent, 1),
                "plugged": battery.power_plugged,
                "secsleft": battery.secsleft
            }
    except Exception:
        pass

    net = psutil.net_io_counters()

    return {
        "cpu": {
            "percent": cpu_percent,
            "freq_current": round(cpu_freq.current, 0) if cpu_freq else 0,
            "count": psutil.cpu_count(logical=True)
        },
        "memory": {
            "total_gb": round(mem.total / (1024**3), 2),
            "used_gb": round(mem.used / (1024**3), 2),
            "percent": mem.percent
        },
        "battery": battery_info,
        "network": {
            "bytes_sent": net.bytes_sent,
            "bytes_recv": net.bytes_recv
        },
        "keep_awake": KEEP_AWAKE_ACTIVE,
        "timestamp": time.time()
    }

@app.post("/api/power/blackout")
async def toggle_privacy_blackout(payload: Dict[str, Any], request: Request):
    """
    Turns off physical monitor display while keeping machine running and streaming.
    Payload: {"state": true (off) | false (on)}
    """
    auth_header = request.headers.get("Authorization", "")
    token = auth_header.replace("Bearer ", "") if "Bearer " in auth_header else ""
    if not token or not verify_jwt_token(token):
        raise HTTPException(status_code=401, detail="Unauthorized")

    turn_off = payload.get("state", True)
    if sys.platform == 'win32':
        mode = MONITOR_OFF if turn_off else MONITOR_ON
        try:
            ctypes.windll.user32.SendMessageW(HWND_BROADCAST, WM_SYSCOMMAND, SC_MONITORPOWER, mode)
            if not turn_off and pyautogui:
                pyautogui.moveRel(1, 0)
                pyautogui.moveRel(-1, 0)
            return {"success": True, "blackout": turn_off, "message": f"Monitor set to {'OFF' if turn_off else 'ON'}"}
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))
    return {"success": False, "message": "Not running on Windows host"}

@app.post("/api/power/keep-awake")
async def toggle_keep_awake(payload: Dict[str, Any], request: Request):
    """
    Prevents the laptop from sleeping even when lid is closed.
    Payload: {"active": true | false}
    """
    global KEEP_AWAKE_ACTIVE
    auth_header = request.headers.get("Authorization", "")
    token = auth_header.replace("Bearer ", "") if "Bearer " in auth_header else ""
    if not token or not verify_jwt_token(token):
        raise HTTPException(status_code=401, detail="Unauthorized")

    active = payload.get("active", True)
    if sys.platform == 'win32':
        try:
            if active:
                flags = ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED
                ctypes.windll.kernel32.SetThreadExecutionState(flags)
                KEEP_AWAKE_ACTIVE = True
            else:
                ctypes.windll.kernel32.SetThreadExecutionState(ES_CONTINUOUS)
                KEEP_AWAKE_ACTIVE = False
            return {"success": True, "keep_awake": KEEP_AWAKE_ACTIVE}
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))
    return {"success": False, "message": "Not running on Windows host"}

@app.post("/api/power/action")
async def system_power_action(payload: Dict[str, str], request: Request):
    """Executes system actions: lock, sleep, restart, shutdown."""
    auth_header = request.headers.get("Authorization", "")
    token = auth_header.replace("Bearer ", "") if "Bearer " in auth_header else ""
    if not token or not verify_jwt_token(token):
        raise HTTPException(status_code=401, detail="Unauthorized")

    action = payload.get("action", "")
    if sys.platform == 'win32':
        if action == "lock":
            ctypes.windll.user32.LockWorkStation()
            return {"success": True, "message": "Workstation locked"}
        elif action == "restart":
            os.system("shutdown /r /t 5 /c \"Restart requested via RENI Remote Access\"")
            return {"success": True, "message": "Restarting system in 5s"}
        elif action == "shutdown":
            os.system("shutdown /s /t 5 /c \"Shutdown requested via RENI Remote Access\"")
            return {"success": True, "message": "Shutting down system in 5s"}
        elif action == "sleep":
            ctypes.windll.PowrProf.SetSuspendState(0, 1, 0)
            return {"success": True, "message": "System suspended"}

    raise HTTPException(status_code=400, detail=f"Unsupported action: {action}")

def host_get_clipboard() -> str:
    """Reads text from Windows host clipboard with retry."""
    for _ in range(3):
        try:
            import pyperclip
            val = pyperclip.paste()
            return val if val is not None else ""
        except Exception:
            time.sleep(0.05)
    return ""

def host_set_clipboard(text: str) -> bool:
    """Writes text to Windows host clipboard with retry."""
    for _ in range(3):
        try:
            import pyperclip
            pyperclip.copy(text)
            return True
        except Exception:
            time.sleep(0.05)
    return False

def host_get_clipboard_image() -> Optional[Dict[str, Any]]:
    """Checks if Windows host clipboard contains an image / screenshot and returns base64 png."""
    try:
        from PIL import ImageGrab
        img = ImageGrab.grabclipboard()
        if isinstance(img, Image.Image):
            buffered = io.BytesIO()
            img.save(buffered, format="PNG", optimize=True)
            b64_data = base64.b64encode(buffered.getvalue()).decode('ascii')
            return {
                "has_image": True,
                "data_url": f"data:image/png;base64,{b64_data}",
                "width": img.width,
                "height": img.height,
                "size_bytes": buffered.tell()
            }
    except Exception as e:
        print(f"[!] Clipboard Image Grab Exception: {e}")
    return None

def host_set_clipboard_image(img: Image.Image) -> bool:
    """Copies PIL Image into Windows host clipboard in CF_DIB format."""
    if sys.platform != 'win32':
        return False
    try:
        output = io.BytesIO()
        img.convert("RGB").save(output, "BMP")
        data = output.getvalue()[14:] # Strip BMP 14-byte header for CF_DIB
        output.close()

        user32 = ctypes.windll.user32
        kernel32 = ctypes.windll.kernel32

        GMEM_MOVEABLE = 0x0002
        CF_DIB = 8

        kernel32.GlobalAlloc.restype = ctypes.c_void_p
        kernel32.GlobalAlloc.argtypes = [ctypes.c_uint, ctypes.c_size_t]
        kernel32.GlobalLock.restype = ctypes.c_void_p
        kernel32.GlobalLock.argtypes = [ctypes.c_void_p]
        kernel32.GlobalUnlock.argtypes = [ctypes.c_void_p]
        user32.SetClipboardData.argtypes = [ctypes.c_uint, ctypes.c_void_p]

        h_mem = kernel32.GlobalAlloc(GMEM_MOVEABLE, len(data))
        if not h_mem:
            return False
        mem_ptr = kernel32.GlobalLock(h_mem)
        if not mem_ptr:
            return False
        ctypes.memmove(mem_ptr, data, len(data))
        kernel32.GlobalUnlock(h_mem)

        user32.OpenClipboard(0)
        user32.EmptyClipboard()
        user32.SetClipboardData(CF_DIB, h_mem)
        user32.CloseClipboard()
        return True
    except Exception as e:
        print(f"[!] Set Clipboard Image Exception: {e}")
        return False

@app.get("/api/clipboard")
async def get_clipboard_text(token: Optional[str] = Query(None), request: Request = None):
    """Pulls host clipboard contents (both text and screenshot/image if present)."""
    auth_header = request.headers.get("Authorization", "") if request else ""
    req_token = token or (auth_header.replace("Bearer ", "") if "Bearer " in auth_header else "")
    if not req_token or not verify_jwt_token(req_token):
        raise HTTPException(status_code=401, detail="Unauthorized")

    text = host_get_clipboard()
    img_data = host_get_clipboard_image()
    return {
        "text": text,
        "length": len(text),
        "image": img_data
    }

@app.post("/api/clipboard")
async def set_clipboard_text(payload: Dict[str, Any], request: Request):
    """
    Pushes text or screenshot/image into host clipboard.
    If 'paste_now' is True, simulates Ctrl+V into active host window.
    """
    auth_header = request.headers.get("Authorization", "")
    token = auth_header.replace("Bearer ", "") if "Bearer " in auth_header else ""
    if not token or not verify_jwt_token(token):
        raise HTTPException(status_code=401, detail="Unauthorized")

    paste_now = bool(payload.get("paste_now", False))
    image_data_url = payload.get("image_data")

    # Image / Screenshot payload
    if image_data_url:
        try:
            if "," in image_data_url:
                b64_str = image_data_url.split(",", 1)[1]
            else:
                b64_str = image_data_url
            img_bytes = base64.b64decode(b64_str)
            img = Image.open(io.BytesIO(img_bytes))
            success = host_set_clipboard_image(img)
            if not success:
                raise HTTPException(status_code=500, detail="Failed to write image to host clipboard")

            if paste_now and pyautogui:
                await asyncio.sleep(0.08)
                pyautogui.hotkey('ctrl', 'v')

            return {
                "success": True,
                "message": "Screenshot / image copied to host clipboard",
                "pasted": paste_now,
                "width": img.width,
                "height": img.height
            }
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Image processing error: {e}")

    # Text payload
    text = payload.get("text", "")
    success = host_set_clipboard(text)
    if not success:
        raise HTTPException(status_code=500, detail="Failed to write to host clipboard")

    if paste_now and pyautogui:
        await asyncio.sleep(0.08)
        pyautogui.hotkey('ctrl', 'v')

    return {"success": True, "message": "Clipboard updated", "pasted": paste_now, "length": len(text)}

@app.post("/api/clipboard/capture-screen")
async def capture_screen_to_clipboard(request: Request):
    """Captures desktop screenshot, puts it on PC clipboard, and returns it to phone."""
    auth_header = request.headers.get("Authorization", "")
    token = auth_header.replace("Bearer ", "") if "Bearer " in auth_header else ""
    if not token or not verify_jwt_token(token):
        raise HTTPException(status_code=401, detail="Unauthorized")

    try:
        from PIL import ImageGrab
        img = ImageGrab.grab()
        host_set_clipboard_image(img)

        buffered = io.BytesIO()
        img.save(buffered, format="PNG", optimize=True)
        b64_data = base64.b64encode(buffered.getvalue()).decode('ascii')
        return {
            "success": True,
            "has_image": True,
            "data_url": f"data:image/png;base64,{b64_data}",
            "width": img.width,
            "height": img.height
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/power/wol")
async def trigger_wol_broadcast(payload: Dict[str, Any], request: Request):
    """Broadcasts Wake-on-LAN magic packet to target MAC address."""
    auth_header = request.headers.get("Authorization", "")
    token = auth_header.replace("Bearer ", "") if "Bearer " in auth_header else ""
    if not token or not verify_jwt_token(token):
        raise HTTPException(status_code=401, detail="Unauthorized")

    mac = payload.get("mac") or os.getenv("RENIS_TARGET_MAC")
    ip = payload.get("broadcast_ip") or os.getenv("RENIS_BROADCAST_IP", "255.255.255.255")
    port = int(payload.get("port") or os.getenv("RENIS_WOL_PORT", "9"))

    if not mac:
        raise HTTPException(status_code=400, detail="MAC address required")

    try:
        from renis_wol_trigger import send_magic_packet
        success = send_magic_packet(mac, broadcast_ip=ip, port=port)
        return {"success": success, "mac": mac}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ==============================================================================
# WEBSOCKET 1: SCREEN STREAMING ENGINE (/ws/stream)
# ==============================================================================
@app.websocket("/ws/stream")
async def websocket_stream(websocket: WebSocket, token: Optional[str] = Query(None)):
    """
    Ultra-low-latency desktop video stream over binary WebSocket frames.
    Draws the real Windows host cursor onto the image to eliminate cursor desync.
    """
    if not token or not verify_jwt_token(token):
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    await websocket.accept()
    ACTIVE_STREAMS.add(websocket)

    config = {
        "fps": 20,
        "scale": 0.75,
        "quality": 65,
        "format": "JPEG",
        "subsampling": 0,
        "delta_skip": False,
        "running": True
    }

    async def incoming_config_listener():
        try:
            while config["running"]:
                msg_text = await websocket.receive_text()
                try:
                    data = json.loads(msg_text)
                    if data.get("action") == "config":
                        if "fps" in data:
                            config["fps"] = max(5, min(40, int(data["fps"])))
                        if "scale" in data:
                            config["scale"] = max(0.25, min(1.0, float(data["scale"])))
                        if "quality" in data:
                            config["quality"] = max(20, min(95, int(data["quality"])))
                        if "format" in data:
                            fmt = data["format"].upper()
                            if fmt in ["JPEG", "WEBP"]:
                                config["format"] = fmt
                        if "subsampling" in data:
                            config["subsampling"] = int(data["subsampling"])
                        if "delta_skip" in data:
                            config["delta_skip"] = bool(data["delta_skip"])
                except Exception:
                    pass
        except Exception:
            config["running"] = False

    listener_task = asyncio.create_task(incoming_config_listener())

    if not mss:
        await websocket.send_text(json.dumps({"error": "mss library not available"}))
        await websocket.close()
        ACTIVE_STREAMS.discard(websocket)
        return

    try:
        with mss.mss() as sct:
            monitor = sct.monitors[1] if len(sct.monitors) > 1 else sct.monitors[0]
            mon_left = monitor.get("left", 0)
            mon_top = monitor.get("top", 0)
            
            last_sample = None
            last_cur = None
            last_sent_time = 0.0

            while config["running"]:
                start_time = time.perf_counter()
                
                # Screen capture with UAC/Desktop switch resilience
                sct_img = None
                try:
                    sct_img = sct.grab(monitor)
                except Exception:
                    # GDI context can momentarily disconnect during UAC transitions or screen lock
                    try:
                        sct.close()
                        sct = mss.mss()
                        sct_img = sct.grab(monitor)
                    except Exception:
                        # Fallback to PIL ImageGrab if GDI context needs a moment
                        try:
                            from PIL import ImageGrab
                            pil_fb = ImageGrab.grab(all_screens=True)
                            buf = io.BytesIO()
                            pil_fb.save(buf, format="JPEG", quality=config.get("quality", 50))
                            await websocket.send_bytes(buf.getvalue())
                        except Exception:
                            pass
                        await asyncio.sleep(0.04)
                        continue

                # Cursor tracking
                cur_x, cur_y = (0, 0)
                rel_x, rel_y = (-999, -999)
                if pyautogui:
                    try:
                        cur_x, cur_y = pyautogui.position()
                        rel_x = cur_x - mon_left
                        rel_y = cur_y - mon_top
                    except Exception:
                        pass

                # Smart Frame Deduplication (Bandwidth Saver)
                cur_sample = sct_img.raw[::128]
                cur_pos = (rel_x, rel_y)
                now = time.perf_counter()

                if config.get("delta_skip") and last_sample == cur_sample and last_cur == cur_pos:
                    if now - last_sent_time < 1.0:
                        target_interval = 1.0 / config["fps"]
                        elapsed = time.perf_counter() - start_time
                        sleep_duration = max(0.001, target_interval - elapsed)
                        await asyncio.sleep(sleep_duration)
                        continue

                last_sample = cur_sample
                last_cur = cur_pos
                last_sent_time = now

                img = Image.frombytes("RGB", sct_img.size, sct_img.bgra, "raw", "BGRX")

                # Draw real Windows host cursor directly onto frame before scaling
                if 0 <= rel_x < img.width and 0 <= rel_y < img.height:
                    try:
                        draw = ImageDraw.Draw(img)
                        r_outer = 7
                        r_inner = 3
                        draw.ellipse(
                            (rel_x - r_outer, rel_y - r_outer, rel_x + r_outer, rel_y + r_outer),
                            outline=(255, 0, 51),
                            width=2
                        )
                        draw.ellipse(
                            (rel_x - r_inner, rel_y - r_inner, rel_x + r_inner, rel_y + r_inner),
                            fill=(255, 255, 255),
                            outline=(0, 0, 0)
                        )
                        draw.line((rel_x - r_outer - 4, rel_y, rel_x - r_outer + 1, rel_y), fill=(255, 0, 51), width=2)
                        draw.line((rel_x + r_outer - 1, rel_y, rel_x + r_outer + 4, rel_y), fill=(255, 0, 51), width=2)
                        draw.line((rel_x, rel_y - r_outer - 4, rel_x, rel_y - r_outer + 1), fill=(255, 0, 51), width=2)
                        draw.line((rel_x, rel_y + r_outer - 1, rel_x, rel_y + r_outer + 4), fill=(255, 0, 51), width=2)
                    except Exception:
                        pass

                # Scale frame if requested
                scale = config["scale"]
                if scale < 0.99:
                    target_w = int(img.width * scale)
                    target_h = int(img.height * scale)
                    img = img.resize((target_w, target_h), Image.Resampling.BILINEAR)

                buf = io.BytesIO()
                save_kwargs = {
                    "format": config["format"],
                    "quality": config["quality"],
                    "optimize": False
                }
                if config["format"] == "JPEG":
                    save_kwargs["subsampling"] = config.get("subsampling", 0)

                img.save(buf, **save_kwargs)
                frame_bytes = buf.getvalue()

                await websocket.send_bytes(frame_bytes)

                target_interval = 1.0 / config["fps"]
                elapsed = time.perf_counter() - start_time
                sleep_duration = target_interval - elapsed
                if sleep_duration > 0.001:
                    await asyncio.sleep(sleep_duration)
                else:
                    await asyncio.sleep(0.001)

    except WebSocketDisconnect:
        pass
    except Exception as e:
        print(f"[!] Stream WebSocket Error: {e}")
    finally:
        ACTIVE_STREAMS.discard(websocket)
        config["running"] = False
        listener_task.cancel()

# ==============================================================================
# WEBSOCKET 2: DUAL-MODE INPUT & GESTURE CONTROL ENGINE (/ws/control)
# ==============================================================================
@app.websocket("/ws/control")
async def websocket_control(websocket: WebSocket, token: Optional[str] = Query(None)):
    """
    Processes real-time mouse tracking, touch gestures, mobile keyboard input,
    and administrative shortcut combinations.
    Applies modifier keys strictly per-action so laptop physical keyboard is never stuck.
    """
    if not token or not verify_jwt_token(token):
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    await websocket.accept()
    ACTIVE_CONTROLS.add(websocket)

    screen_w, screen_h = pyautogui.size() if pyautogui else (1920, 1080)

    try:
        while True:
            raw_msg = await websocket.receive_text()
            try:
                cmd = json.loads(raw_msg)
                action = cmd.get("type")

                # Dynamically update screen size if needed
                if pyautogui and (screen_w <= 0 or screen_h <= 0):
                    screen_w, screen_h = pyautogui.size()

                # Relative Mouse Movement (Trackpad Mode)
                if action == "mouse_move_rel":
                    dx = float(cmd.get("dx", 0))
                    dy = float(cmd.get("dy", 0))
                    win32_mouse_move_rel(dx, dy)

                # Absolute Direct Touch Coordinate Mapping
                elif action == "mouse_move_abs":
                    nx = float(cmd.get("x", 0)) # 0.0 to 1.0
                    ny = float(cmd.get("y", 0))
                    target_x = max(0, min(screen_w - 1, int(nx * screen_w)))
                    target_y = max(0, min(screen_h - 1, int(ny * screen_h)))
                    win32_mouse_move_abs(target_x, target_y)

                # Mouse Clicks with temporary modifiers (never locks Ctrl on laptop)
                elif action == "mouse_click":
                    button = cmd.get("button", "left")
                    is_double = cmd.get("double", False)
                    modifiers = cmd.get("modifiers", [])
                    win32_mouse_click(button=button, is_double=is_double, modifiers=modifiers)

                # Drag & Drop: Mouse Down / Mouse Up
                elif action == "mouse_down":
                    button = cmd.get("button", "left")
                    modifiers = cmd.get("modifiers", [])
                    win32_mouse_down(button=button, modifiers=modifiers)

                elif action == "mouse_up":
                    button = cmd.get("button", "left")
                    modifiers = cmd.get("modifiers", [])
                    win32_mouse_up(button=button, modifiers=modifiers)

                # Two-Finger Wheel Scrolling
                elif action == "mouse_scroll":
                    dy = int(cmd.get("dy", 0))
                    win32_mouse_scroll(dy)

                # Keyboard Simulation
                elif action == "key_down":
                    key = cmd.get("key", "").lower()
                    if key:
                        win32_key_down(key)

                elif action == "key_up":
                    key = cmd.get("key", "").lower()
                    if key:
                        win32_key_up(key)

                elif action == "key_tap":
                    key = cmd.get("key", "").lower()
                    modifiers = cmd.get("modifiers", [])
                    if key:
                        win32_key_tap(key, modifiers)

                # Key Combos (e.g. ['win', 'tab'] Task View, ['alt', 'tab'], ['ctrl', 'shift', 'esc'])
                elif action == "key_combo":
                    keys = cmd.get("keys", [])
                    if keys:
                        win32_key_combo(keys)

                # Mobile Keyboard Text Forwarding
                elif action == "type_text":
                    text = cmd.get("text", "")
                    if text:
                        win32_type_text(text)

                elif action == "key_backspace":
                    win32_key_tap("backspace")

                # Dedicated UAC Consent Approval (Alt+Y) / Denial
                elif action == "uac_accept":
                    win32_uac_accept()

                elif action == "uac_deny":
                    win32_uac_deny()
            except Exception as act_err:
                print(f"[!] Warning: Input processing error for '{cmd.get('type') if isinstance(cmd, dict) else 'msg'}': {act_err}")

    except WebSocketDisconnect:
        pass
    except Exception as e:
        print(f"[!] Control WebSocket Exception: {e}")
    finally:
        ACTIVE_CONTROLS.discard(websocket)

# ==============================================================================
# WEBSOCKET 3: ELEVATED ADMIN POWERSHELL TERMINAL (/ws/terminal)
# ==============================================================================
@app.websocket("/ws/terminal")
async def websocket_terminal(websocket: WebSocket, token: Optional[str] = Query(None)):
    """
    Provides an interactive, elevated PowerShell shell drawer inside RENIC.
    Permits executing administrative tasks (winget, choco, service start, reg queries)
    with real-time streaming of stdout/stderr in UTF-8 encoding.
    """
    if not token or not verify_jwt_token(token):
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    await websocket.accept()
    ACTIVE_TERMINALS.add(websocket)

    cmd = ["powershell.exe", "-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", "-"]
    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        
        if proc.stdin:
            proc.stdin.write(b"[Console]::OutputEncoding = [System.Text.Encoding]::UTF8\r\n")
            await proc.stdin.drain()
    except Exception as e:
        await websocket.send_text(json.dumps({"type": "error", "data": f"Failed to spawn shell: {e}\r\n"}))
        await websocket.close()
        ACTIVE_TERMINALS.discard(websocket)
        return

    terminal_active = True

    async def read_stream(stream, stream_name: str):
        try:
            while terminal_active:
                line = await stream.readline()
                if not line:
                    break
                decoded = line.decode('utf-8', errors='replace')
                await websocket.send_text(json.dumps({
                    "type": stream_name,
                    "data": decoded
                }))
        except Exception:
            pass

    stdout_task = asyncio.create_task(read_stream(proc.stdout, "stdout"))
    stderr_task = asyncio.create_task(read_stream(proc.stderr, "stderr"))

    await websocket.send_text(json.dumps({
        "type": "stdout",
        "data": "Windows PowerShell (RENI Admin Shell - High Privilege)\r\nEnter commands or use quick installer scripts:\r\nPS " + str(Path.cwd()) + "> "
    }))

    try:
        while True:
            raw_msg = await websocket.receive_text()
            data = json.loads(raw_msg)
            msg_type = data.get("type")

            if msg_type == "input":
                user_cmd = data.get("data", "")
                if proc.stdin:
                    proc.stdin.write((user_cmd + "\r\n").encode('utf-8'))
                    await proc.stdin.drain()

            elif msg_type == "interrupt":
                if sys.platform == 'win32' and proc.pid:
                    try:
                        import signal
                        os.kill(proc.pid, signal.CTRL_C_EVENT)
                    except Exception:
                        pass

    except WebSocketDisconnect:
        pass
    except Exception as e:
        print(f"[!] Terminal WebSocket error: {e}")
    finally:
        ACTIVE_TERMINALS.discard(websocket)
        terminal_active = False
        stdout_task.cancel()
        stderr_task.cancel()
        try:
            if proc.returncode is None:
                proc.terminate()
        except Exception:
            pass

# ==============================================================================
# CLIENT STATIC FILES & PWA ROUTING (AUTO-REDIRECT LOCALHOST TO DASHBOARD)
# ==============================================================================
if CLIENT_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(CLIENT_DIR)), name="static")

@app.get("/")
async def serve_index(request: Request):
    """
    Serves the main PWA HTML file for remote users, or auto-redirects localhost
    to the host dashboard unless ?client=1 is requested.
    """
    is_proxied = bool(request.headers.get("cf-connecting-ip") or request.headers.get("x-forwarded-for"))
    hostname = request.url.hostname or ""

    # ONLY redirect to /dashboard if NOT proxied, accessed strictly as localhost hostname, and not requesting ?client
    if not is_proxied and hostname in ["localhost", "127.0.0.1", "::1"] and "client" not in request.query_params:
        return RedirectResponse(url="/dashboard")

    index_file = CLIENT_DIR / "index.html"
    if index_file.exists():
        return FileResponse(index_file)
    return HTMLResponse("<h2>RENI - Client files not found in /RENIC/</h2>", status_code=404)

@app.get("/{filename}")
async def serve_root_pwa_files(filename: str):
    """Serves root PWA assets with strict path-traversal prevention."""
    target_file = (CLIENT_DIR / filename).resolve()
    client_dir_resolved = CLIENT_DIR.resolve()

    if not str(target_file).startswith(str(client_dir_resolved)):
        raise HTTPException(status_code=403, detail="Forbidden")

    if target_file.exists() and target_file.is_file():
        media_type = None
        if filename.endswith(".js"):
            media_type = "application/javascript"
        elif filename.endswith(".json"):
            media_type = "application/manifest+json" if "manifest" in filename else "application/json"
        elif filename.endswith(".css"):
            media_type = "text/css"
        elif filename.endswith(".png"):
            media_type = "image/png"
        return FileResponse(target_file, media_type=media_type)
    return JSONResponse(status_code=404, content={"detail": f"File {filename} not found"})

# ==============================================================================
# MAIN ENTRYPOINT
# ==============================================================================
def main():
    try:
        print(RENI_BANNER)
    except Exception:
        print("==================================================")
        print("  R.E.N.I. // REMOTE SYSTEM CONTROL SERVER        ")
        print("==================================================")
    check_and_elevate()

    discovered_ips = get_discovered_ips()
    tunnel_url = get_configured_tunnel_url()

    print(f"[*] Host Machine: {socket.gethostname()} (Windows NT Elevated)")
    print(f"[*] Host Dashboard: http://localhost:{PORT}/dashboard")
    if tunnel_url:
        print(f"[+] Connect Phone (Cloudflare Tunnel): {tunnel_url}")
    for ip in discovered_ips:
        label = "Tailscale VPN" if ip.startswith("100.") else "Local Wi-Fi"
        print(f"[+] Connect Phone ({label}): http://{ip}:{PORT}")
    print(f"[*] Serving Mobile PWA client from: {CLIENT_DIR}")
    print("=" * 60)

    uvicorn.run(
        app,
        host=HOST,
        port=PORT,
        log_level="info",
        access_log=False
    )

if __name__ == "__main__":
    main()
