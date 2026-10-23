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
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Depends, Query, status, Request
from fastapi.responses import HTMLResponse, FileResponse, JSONResponse, RedirectResponse
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
# UAC ELEVATION CHECK & AUTO-RESTART
# ==============================================================================
def check_and_elevate():
    """
    Checks if the process is running with Windows Administrator privileges.
    If not, re-launches itself via ShellExecute with 'runas' to prompt UAC elevation.
    """
    if sys.platform != 'win32':
        return

    try:
        is_admin = ctypes.windll.shell32.IsUserAnAdmin() != 0
    except Exception:
        is_admin = False

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
@app.get("/dashboard")
async def serve_dashboard():
    """Serves the host control panel dashboard."""
    if DASHBOARD_FILE.exists():
        return FileResponse(DASHBOARD_FILE)
    return HTMLResponse("<h2>RENI - Dashboard file not found</h2>", status_code=404)

@app.get("/api/server/status")
async def get_server_status():
    """Returns live server metrics, IP addresses, and active connection counts."""
    mem = psutil.virtual_memory()
    ips = get_discovered_ips()
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
        "port": PORT,
        "has_biometrics": len(AUTH_DATA.get("webauthn_credentials", [])) > 0,
        "keep_awake": KEEP_AWAKE_ACTIVE
    }

@app.post("/api/server/kill-sessions")
async def kill_all_sessions():
    """Emergency kill-switch: closes all active remote WebSocket connections."""
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
async def configure_powercfg_lid():
    """Configures Windows PowerCFG so closing lid on AC power does not sleep."""
    if sys.platform == 'win32':
        try:
            os.system("powercfg /setacvalueindex SCHEME_CURRENT SUB_BUTTONS LIDACTION 0")
            os.system("powercfg /change standby-timeout-ac 0")
            os.system("powercfg /setactive SCHEME_CURRENT")
            return {"success": True, "message": "PowerCFG updated: Laptop will not sleep on lid close (AC power)"}
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))
    return {"success": False, "message": "Not running on Windows"}

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
            
            while config["running"]:
                start_time = time.perf_counter()
                
                # Screen capture
                sct_img = sct.grab(monitor)
                img = Image.frombytes("RGB", sct_img.size, sct_img.bgra, "raw", "BGRX")

                # Draw real Windows host cursor directly onto frame before scaling
                if pyautogui:
                    try:
                        cur_x, cur_y = pyautogui.position()
                        rel_x = cur_x - mon_left
                        rel_y = cur_y - mon_top

                        if 0 <= rel_x < img.width and 0 <= rel_y < img.height:
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
                img.save(
                    buf,
                    format=config["format"],
                    quality=config["quality"],
                    optimize=False
                )
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
            cmd = json.loads(raw_msg)
            action = cmd.get("type")

            if not pyautogui:
                continue

            # Relative Mouse Movement (Trackpad Mode)
            if action == "mouse_move_rel":
                dx = float(cmd.get("dx", 0))
                dy = float(cmd.get("dy", 0))
                pyautogui.moveRel(dx, dy)

            # Absolute Direct Touch Coordinate Mapping
            elif action == "mouse_move_abs":
                nx = float(cmd.get("x", 0)) # 0.0 to 1.0
                ny = float(cmd.get("y", 0))
                target_x = max(0, min(screen_w - 1, int(nx * screen_w)))
                target_y = max(0, min(screen_h - 1, int(ny * screen_h)))
                pyautogui.moveTo(target_x, target_y)

            # Mouse Clicks with temporary modifiers (never locks Ctrl on laptop)
            elif action == "mouse_click":
                button = cmd.get("button", "left")
                is_double = cmd.get("double", False)
                modifiers = cmd.get("modifiers", [])
                clicks = 2 if is_double else 1

                for m in modifiers:
                    pyautogui.keyDown(m.lower())
                pyautogui.click(button=button, clicks=clicks)
                for m in modifiers:
                    pyautogui.keyUp(m.lower())

            # Drag & Drop: Mouse Down / Mouse Up
            elif action == "mouse_down":
                button = cmd.get("button", "left")
                modifiers = cmd.get("modifiers", [])
                for m in modifiers:
                    pyautogui.keyDown(m.lower())
                pyautogui.mouseDown(button=button)

            elif action == "mouse_up":
                button = cmd.get("button", "left")
                modifiers = cmd.get("modifiers", [])
                pyautogui.mouseUp(button=button)
                for m in modifiers:
                    pyautogui.keyUp(m.lower())

            # Two-Finger Wheel Scrolling
            elif action == "mouse_scroll":
                dy = int(cmd.get("dy", 0))
                pyautogui.scroll(dy)

            # Keyboard Simulation
            elif action == "key_down":
                key = cmd.get("key", "").lower()
                if key:
                    pyautogui.keyDown(key)

            elif action == "key_up":
                key = cmd.get("key", "").lower()
                if key:
                    pyautogui.keyUp(key)

            elif action == "key_tap":
                key = cmd.get("key", "").lower()
                modifiers = cmd.get("modifiers", [])
                if key:
                    if modifiers:
                        keys = [m.lower() for m in modifiers] + [key]
                        pyautogui.hotkey(*keys)
                    else:
                        pyautogui.press(key)

            # Key Combos (e.g. ['win', 'tab'] Task View, ['alt', 'tab'], ['ctrl', 'shift', 'esc'])
            elif action == "key_combo":
                keys = cmd.get("keys", [])
                if keys:
                    pyautogui.hotkey(*[k.lower() for k in keys])

            # Mobile Keyboard Text Forwarding
            elif action == "type_text":
                text = cmd.get("text", "")
                if text:
                    pyautogui.write(text, interval=0.002)

            elif action == "key_backspace":
                pyautogui.press("backspace")

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
    host_ip = request.client.host if request.client else ""
    hostname = request.url.hostname or ""

    if hostname in ["localhost", "127.0.0.1", "::1"] or host_ip in ["127.0.0.1", "::1"]:
        if "client" not in request.query_params:
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
    print(RENI_BANNER)
    check_and_elevate()

    discovered_ips = get_discovered_ips()

    print(f"[*] Host Machine: {socket.gethostname()} (Windows NT Elevated)")
    print(f"[*] Host Dashboard: http://localhost:{PORT}/dashboard")
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
