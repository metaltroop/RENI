# PROJECT RENI // REMOTE SYSTEM ACCESS (RENIS & RENIC) v3.0

[![Platform](https://img.shields.io/badge/Platform-Windows%2010%20%7C%2011%20(Elevated)-0078D6?style=for-the-badge&logo=windows)](https://github.com/metaltroop/RENI)
[![Architecture](https://img.shields.io/badge/Architecture-FastAPI%20%7B%7D%20MSS%20%7B%7D%20PWA-FF0033?style=for-the-badge)](https://github.com/metaltroop/RENI)
[![Security](https://img.shields.io/badge/Security-W3C%20WebAuthn%20%7C%20JWT%20%7C%20PBKDF2-00F0FF?style=for-the-badge)](https://github.com/metaltroop/RENI)
[![License](https://img.shields.io/badge/License-MIT-39FF14?style=for-the-badge)](LICENSE)

> **RENI** (*Remote Network Interface*) is a high-performance, secure, self-hosted Remote Desktop and Administrative Control Monorepo engineered specifically for performance workstations and gaming laptops. It delivers low-latency desktop streaming, precision touch control, PUBG-style customizable HUD mouse triggers, zoom lock, elevated UAC bypass architecture, 2-way text & screenshot clipboard synchronization, a native Windows Desktop GUI Control Center, and universal zero-setup Cloudflare Tunnel onboarding with zero third-party cloud dependencies.

---

## ⚡ ARCHITECTURE OVERVIEW (v3.0)

```text
RENI/
├── .gitignore                     # Strict Git rules (protects renis_auth.json, venv, caches)
├── README.md                      # Comprehensive system and deployment documentation
├── setup_renis_admin.bat          # Automated admin setup (Registry UAC, Firewall, Venv, Task)
├── start_reni.bat                 # Launches Desktop GUI Control Center by default (with --cli fallback)
├── RENIS/                         # [Remote Server Engine & Desktop GUI] Windows Host Service
│   ├── requirements.txt           # Python dependencies (FastAPI, MSS, PyAutoGUI, Pillow, qrcode, psutil)
│   ├── renis_gui.py               # Native Windows Desktop GUI Control Center (Obsidian/Cyan aesthetic)
│   ├── renis_server.py            # High-performance ASGI HTTP & WebSocket engine + TunnelManager
│   ├── dashboard.html             # Host machine control panel with interactive Cloudflare Tunnel Manager
│   ├── .env.example               # Environment configuration template
│   └── renis_wol_trigger.py       # Standalone & importable Wake-on-LAN Magic Packet utility
└── RENIC/                         # [Remote Client] Mobile-First PWA
    ├── index.html                 # Mobile shell with circular SVG gauges, PUBG triggers & HUD editor
    ├── style.css                  # Obsidian, carbon-fiber, Neon Crimson & Cyan styling (v3.0)
    ├── app.js                     # Zero-lag canvas stream, PUBG triggers, zoom lock, HUD customizer (v3.0)
    ├── manifest.json              # Standalone fullscreen PWA manifest
    ├── sw.js                      # Service Worker for offline asset caching (v3.0)
    ├── icon-192.png               # High-res PWA launcher icon (192x192)
    └── icon-512.png               # High-res PWA splash icon (512x512)
```# High-res PWA launcher icon (192x192)
    └── icon-512.png               # High-res PWA splash icon (512x512)
```

---

## 🏎️ DESIGN, THEME & EASTER EGGS

The system features an industrial Cyberpunk design optimized for OLED smartphone displays:

* **Obsidian Base:** `#0B0C10` with subtle carbon-fiber micro-grid texturing (`#14161D`).
* **Signature Accents:** Neon Crimson Red (`#FF0033`) by default, shifting to Cyan Glow (`#00F0FF`) during high-frequency mode.
* **Easter Egg (High-Frequency 35 FPS Overclock):** In the `RENIC` mobile header, **triple-tapping the `RENI` logo rapidly** toggles High-Frequency Mode:
  * Dynamic visual pulse across the interface.
  * Theme accent transitions from Crimson Red to Cyan.
  * Stream framerate boosts from **20 FPS to 35 FPS** dynamically over WebSockets.
  * Toast notification confirms stream frequency boost.
* **Telemetry HUD with Circular Gauges:** Live SVG mini-gauges in the mobile header powered by `psutil`:
  * **CPU Load Gauge:** Circular SVG gauge displaying real-time percentage.
  * **RAM Load Gauge:** Circular SVG gauge showing active memory utilization.
  * **Battery & Power:** Live battery level and AC power status (⚡ / 🔋).

---

## 🛡️ CORE CAPABILITIES & SECURITY ARCHITECTURE

### 1. Free Biometric Authentication (WebAuthn + Master PIN)
* **Master PIN Vault:** Stored as a salted PBKDF2-HMAC-SHA256 hash inside `RENIS/renis_auth.json` (git-ignored).
  * **Default initial PIN:** `000000` (system prompts to change this on first login).
* **Hardware Biometrics (W3C WebAuthn):**
  * One-tap registration of smartphone hardware passkeys (Fingerprint / Touch ID / Face ID) bound to your device.
  * Automatic lock upon screen sleep or app backgrounding with instant biometric unlock on return.
  * Includes a built-in Chrome Flags HTTP helper modal (`chrome://flags/#unsafely-treat-insecure-origin-as-secure`) for non-HTTPS local networks.
* **JWT Session Guard:** Every WebSocket connection (`/ws/stream`, `/ws/control`, `/ws/terminal`) strictly validates the 12-hour signed JWT token prior to granting stream access or command execution.

### 2. Cloudflare Tunnel Auto-Launch & Smart Proxy Security
* `start_reni.bat` automatically launches Cloudflare Tunnel alongside `renis_server.py`.
* **Smart Reverse-Proxy Detection:** Server detects `cf-connecting-ip` and `x-forwarded-for` headers:
  * When accessed via Cloudflare Tunnel or LAN IP, the server serves `RENIC/index.html` directly to mobile devices.
  * Direct laptop browser visits to `http://localhost:8765` auto-redirect to `/dashboard`.
  * Public tunnel visitors cannot access `/dashboard` or management endpoints (`/api/server/*`) without authenticated JWT tokens.

### 3. Native Desktop GUI & Universal Cloudflare Tunnel Manager
* **Desktop Control Center (`RENIS/renis_gui.py`):**
  * Built using Tkinter with an Obsidian (`#0B0C10`), Cyan (`#00F0FF`), and Crimson (`#FF0033`) aesthetic.
  * Start and stop the RENIS server on any port with 1 click.
  * Real-time scannable QR code display for quick phone onboarding.
  * Toggle 24/7 lid-closed always-on power mode and terminate active sessions.
  * Live auto-scrolling terminal logs console.
* **Universal 3-Mode Cloudflare Tunnel Manager:**
  * **Mode A: Quick Free Tunnel (Zero Setup):** Runs `cloudflared tunnel --url http://127.0.0.1:8765`, scrapes stderr for the public `https://*.trycloudflare.com` link, and displays the QR code instantly. No Cloudflare account or domain needed!
  * **Mode B: Cloudflare Account Token:** Paste your Cloudflare Zero Trust Tunnel Token directly into the GUI or `/dashboard`.
  * **Mode C: Named Local Tunnel:** Supports named tunnels (`reni`) with automatic browser login authorization (`cloudflared tunnel login`).
  * **Auto-Installer:** If `cloudflared.exe` is missing, a 1-click button downloads the official `cloudflared-windows-amd64.exe` binary directly into `RENIS/bin/cloudflared.exe`.

### 4. Zoom Lock (`🔒` / `🔓`) for Flawless 2-Finger Scrolling
* When 2-finger scrolling on touchscreen devices, accidental pinch gestures can inadvertently zoom the viewport.
* **Zoom Lock (`🔒`) is ON by default:** 2-finger gestures on `#viewport-wrapper` exclusively perform smooth vertical and horizontal mouse scrolling and 2-finger tap right-clicking.
* Toggling to **Unlocked (`🔓`)** enables hardware-accelerated pinch-to-zoom and pan (`0.5x` to `4.0x`).
* Dedicated zoom buttons (`+`, `-`, `1:1`) remain active at all times.

### 5. PUBG-Style Floating Mouse Triggers & Customizable HUD Editor
* Mobile touchscreens now feature tactile, game-style floating mouse triggers:
  * **`L-CLICK` (Primary Left Button):** Tap for instant left click; double-tap for double click; hold and move finger on the trackpad to drag windows, select text, or adjust sliders with effortless precision.
  * **`R-CLICK` (Secondary Right Button):** Instant right click.
  * **`DBL-CLK` (Double Click Button):** 1-tap double-click for opening files, desktop shortcuts, and installers.
  * **`SCROLL ▲ / ▼` Rocker:** Compact rocker button for stepping mouse scroll up and down.
* **Interactive HUD Layout Editor:**
  * Tap **"🎯 Customize Controls (PUBG Layout Editor)"** in Settings or Header to enter layout mode.
  * Drag and position each button anywhere on screen.
  * Adjust button **Size** (50% – 180%) and **Opacity** (20% – 100%).
  * Coordinates persist to `localStorage` as percentages of viewport width and height, adapting automatically to portrait and landscape orientation.

### 6. Stream Performance Presets: Low-Latency & Quality
* **⚡ Low Latency Mode (Default):**
  * `scale: 0.50`, `quality: 42`, `fps: 30`, `subsampling: 2` (JPEG 4:2:0 fast chroma subsampling), and `delta_skip: true`.
  * **Smart Frame Deduplication:** Automatically skips sending duplicate frames when pixels and cursor position haven't changed, reducing idle mobile data usage to near zero while keeping cursor response instantaneous.
* **💎 High Quality Mode:**
  * `scale: 1.0`, `quality: 85`, `fps: 20`, `subsampling: 0` (4:4:4 full chroma subsampling for crisp, readable text and fine installer detail).
* **🎛️ Custom Mode:**
  * Unlocks manual sliders for Resolution Scale (25%–100%), Quality (30%–95%), and FPS (10–35).

### 7. Bidirectional 2-Way Text & Screenshot Clipboard Sync
* **Text Push (Phone ➔ PC):** Send text or links from phone clipboard directly into the PC clipboard.
* **Text Pull (PC ➔ Phone):** Read host clipboard content and copy it into the smartphone system clipboard.
* **Instant Window Injection:** Push text to PC and immediately simulate `Ctrl+V` into whatever application is currently focused on the PC.
* **Screenshot & Image Sync:**
  * One-tap desktop screenshot capture (`/api/clipboard/capture-screen`) sent to phone preview with download and copy options.
  * Upload screenshots or images from phone directly into the PC clipboard as raw bitmaps.

### 8. Dual-Mode Touch & Input Engine (`/ws/control`)
* **Mode 1: Precision Trackpad Mode (Default):**
  * Relative cursor glide with adjustable sensitivity (`0.5x` – `3.0x`).
  * 1-Finger Tap: Left Click (threshold increased to 14px and 320ms for thumb reliability).
  * 1-Finger Drag: Cursor Movement.
  * 1-Finger Double-Tap & Hold: Click & Drag windows, sliders, and files.
  * 2-Finger Tap: Right Click.
  * 2-Finger Vertical Drag: Smooth mouse wheel scrolling.
* **Mode 2: Direct Touch Mode:**
  * Absolute coordinate mapping directly onto Windows desktop coordinates.
* **Scoped Sticky Modifiers:**
  * `CTRL`, `ALT`, `SHIFT` buttons toggle latching on the mobile dock, scoped exclusively to remote input actions without altering the physical laptop keyboard.
* **Tactical Shortcut Dock:**
  * Dedicated macros for **Task View** (`Win+Tab`), **Task Manager** (`Ctrl+Shift+Esc`), `Alt+Tab`, `Alt+F4`, `Enter`, `Esc`, `Tab`, and `Win`.

### 9. Elevated Remote PowerShell Terminal Drawer (`/ws/terminal`)
* Slide-up **Admin Shell Drawer** connected via real-time WebSocket to an elevated Windows `powershell.exe` instance.
* Run software installations (`winget install ...`, `choco`), query processes, manage services, and execute maintenance scripts directly from your phone.
* Includes one-tap macro chips (`winget upgrade`, `top cpu`, `services`, `ipconfig`) and a dedicated `^C` interrupt trigger.

### 10. Windows UAC Bypass Architecture
* Standard remote tools go black when Windows opens a User Account Control elevation prompt on the isolated `Winlogon` desktop.
* `setup_renis_admin.bat` automatically configures:
  ```reg
  HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System -> PromptOnSecureDesktop = 0
  ```
* UAC elevation dialogs render directly on the interactive desktop, allowing full visibility and click-through capability remotely from your phone.

---

## 🚀 INSTALLATION & QUICK START GUIDE

### Step 1: Initial System Setup (Run Once)
Open an elevated terminal (or right-click and run as Administrator):
```cmd
setup_renis_admin.bat
```
This script automatically:
1. Verifies Administrator privileges.
2. Configures `PromptOnSecureDesktop = 0` in the Windows Registry.
3. Adds an inbound Windows Firewall rule allowing TCP port `8765`.
4. Creates a Python virtual environment at `RENIS\venv` and installs all dependencies from `RENIS\requirements.txt`.
5. Registers a Windows Scheduled Task (`RENIS_AutoStart`) configured with `/RL HIGHEST`.

### Step 2: Start the RENI Server
Run the launcher:
```cmd
start_reni.bat
```
The terminal will display the ASCII banner, launch Cloudflare Tunnel (if configured), and open the Host Dashboard at `http://localhost:8765/dashboard`.

### Step 3: Access from Your Smartphone
1. Point your smartphone camera at the QR code displayed on the laptop dashboard.
2. Open the URL in Chrome, Safari, or Firefox.
3. Log in with the default Master PIN: `000000`.
4. Update your Master PIN when prompted.
5. In Settings (`⚙️`), tap **"Register Phone Biometrics"** to enable hardware fingerprint/passkey unlocking for future visits.
6. In browser settings, select **"Add to Home Screen"** to run `RENIC` as a standalone fullscreen app.

---

## 🛠️ CLI & UTILITY USAGE

### Standalone Wake-on-LAN Tool
To wake another computer on your network:
```cmd
python RENIS/renis_wol_trigger.py --mac 00:11:22:33:44:55 --ip 192.168.1.255
```
To view all network interfaces and discovered MAC addresses on the host:
```cmd
python RENIS/renis_wol_trigger.py --info
```

---

## 🔒 SECURITY RECOMMENDATIONS
1. **Firewall & Routing:** Direct port `8765` is bound locally. For remote access across the internet, use Cloudflare Tunnel or Tailscale VPN.
2. **Master PIN & Passkeys:** Change the default PIN `000000` immediately upon first login.
3. **Repository Cleanliness:** `renis_auth.json`, `.cloudflared`, and `.env` are strictly excluded in `.gitignore` to prevent secret leakage.
