#!/usr/bin/env python3
"""
================================================================================
  R.E.N.I.S. // DESKTOP GUI CONTROL CENTER (v3.0)
  Native Windows GUI for Server Management, Universal Cloudflare Tunnel Manager,
  Real-time QR Code Generation & Live Console Telemetry.
================================================================================
"""

import os
import sys
import subprocess
import threading
import time
import socket
import json
import re
import urllib.request
import webbrowser
from pathlib import Path
from typing import Optional

# Ensure SERVER_DIR is in sys.path
SERVER_DIR = Path(__file__).resolve().parent
REPO_ROOT = SERVER_DIR.parent
if str(SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(SERVER_DIR))

import tkinter as tk
from tkinter import ttk, messagebox

try:
    from PIL import Image, ImageTk
except ImportError:
    Image, ImageTk = None, None

try:
    import qrcode
except ImportError:
    qrcode = None

# Color Palette: Cyberpunk Obsidian / Neon Crimson / N2O Cyan
COLOR_BG = "#0B0C10"
COLOR_CARD = "#14161D"
COLOR_CARD_HOVER = "#1E212B"
COLOR_CYAN = "#00F0FF"
COLOR_CRIMSON = "#FF0033"
COLOR_GREEN = "#39FF14"
COLOR_TEXT = "#FFFFFF"
COLOR_MUTED = "#8E92A0"
COLOR_BORDER = "#242836"


class RenisDesktopApp(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("RENIS // Desktop Control Center v3.0")
        self.geometry("960x680")
        self.minsize(880, 600)
        self.configure(bg=COLOR_BG)

        self.server_proc: Optional[subprocess.Popen] = None
        self.tunnel_proc: Optional[subprocess.Popen] = None
        self.tunnel_url: str = ""
        self.current_qr_url: str = ""
        self.qr_photo_ref = None

        self.discovered_ips = self.get_lan_ips()
        self.default_port = 8765

        self.setup_styles()
        self.build_ui()
        self.check_cloudflared_status()

        # Handle window close
        self.protocol("WM_DELETE_WINDOW", self.on_exit)

    def get_lan_ips(self):
        ips = []
        try:
            import psutil
            nics = psutil.net_if_addrs()
            for nic, addrs in nics.items():
                for addr in addrs:
                    if addr.family == socket.AF_INET and not addr.address.startswith("127."):
                        ips.append(addr.address)
        except Exception:
            try:
                s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
                s.connect(("8.8.8.8", 80))
                ips.append(s.getsockname()[0])
                s.close()
            except Exception:
                ips.append("127.0.0.1")
        return ips

    def setup_styles(self):
        style = ttk.Style(self)
        style.theme_use("clam")
        style.configure(".", background=COLOR_BG, foreground=COLOR_TEXT)
        style.configure("TFrame", background=COLOR_BG)
        style.configure("Card.TFrame", background=COLOR_CARD, relief="flat")
        style.configure("TLabel", background=COLOR_BG, foreground=COLOR_TEXT, font=("Rajdhani", 10))
        style.configure("Header.TLabel", font=("Orbitron", 14, "bold"), foreground=COLOR_CYAN)
        style.configure("Sub.TLabel", font=("Rajdhani", 9), foreground=COLOR_MUTED)

    def build_ui(self):
        # 1. TOP HEADER BAR
        header = tk.Frame(self, bg=COLOR_CARD, height=54, highlightbackground=COLOR_BORDER, highlightthickness=1)
        header.pack(fill="x", padx=12, pady=(12, 6))

        title_frame = tk.Frame(header, bg=COLOR_CARD)
        title_frame.pack(side="left", padx=16, pady=8)

        lbl_logo = tk.Label(title_frame, text="RENIS", font=("Orbitron", 16, "bold"), fg=COLOR_CYAN, bg=COLOR_CARD)
        lbl_logo.pack(side="left")

        lbl_sub = tk.Label(title_frame, text=" // CONTROL CENTER v3.0", font=("Rajdhani", 11, "bold"), fg=COLOR_MUTED, bg=COLOR_CARD)
        lbl_sub.pack(side="left", padx=(4, 0))

        btn_dash = tk.Button(header, text="🌐 Open Host Dashboard", bg="#1C2130", fg=COLOR_CYAN, font=("Rajdhani", 10, "bold"),
                             relief="flat", cursor="hand2", padx=12, pady=4, activebackground=COLOR_CYAN, activeforeground=COLOR_BG,
                             command=lambda: webbrowser.open(f"http://localhost:{self.default_port}/dashboard"))
        btn_dash.pack(side="right", padx=12, pady=10)

        # 2. MAIN SPLIT BODY
        main_body = tk.Frame(self, bg=COLOR_BG)
        main_body.pack(fill="both", expand=True, padx=12, pady=6)

        # LEFT COLUMN: SERVER & TUNNEL CONTROLS
        left_col = tk.Frame(main_body, bg=COLOR_BG, width=540)
        left_col.pack(side="left", fill="both", expand=True, padx=(0, 6))

        # CARD A: SERVER ENGINE CONTROL
        card_server = tk.Frame(left_col, bg=COLOR_CARD, highlightbackground=COLOR_BORDER, highlightthickness=1)
        card_server.pack(fill="x", pady=(0, 8), padx=2)

        lbl_srv_title = tk.Label(card_server, text="⚡ SYSTEM ACCESS SERVER", font=("Orbitron", 10, "bold"), fg=COLOR_CYAN, bg=COLOR_CARD)
        lbl_srv_title.pack(anchor="w", padx=12, pady=(10, 4))

        srv_row = tk.Frame(card_server, bg=COLOR_CARD)
        srv_row.pack(fill="x", padx=12, pady=4)

        tk.Label(srv_row, text="Port:", font=("Rajdhani", 10), fg=COLOR_MUTED, bg=COLOR_CARD).pack(side="left")
        self.ent_port = tk.Entry(srv_row, width=6, bg="#0B0C10", fg=COLOR_TEXT, insertbackground=COLOR_TEXT, relief="flat", font=("JetBrains Mono", 10))
        self.ent_port.insert(0, str(self.default_port))
        self.ent_port.pack(side="left", padx=(6, 16))

        self.btn_srv_toggle = tk.Button(srv_row, text="🟢 START SERVER", bg="#103318", fg=COLOR_GREEN, font=("Rajdhani", 10, "bold"),
                                        relief="flat", cursor="hand2", padx=14, pady=4, command=self.toggle_server)
        self.btn_srv_toggle.pack(side="left", padx=4)

        self.lbl_srv_status = tk.Label(srv_row, text="● SERVER OFFLINE", font=("JetBrains Mono", 9, "bold"), fg=COLOR_CRIMSON, bg=COLOR_CARD)
        self.lbl_srv_status.pack(side="left", padx=12)

        # CARD B: UNIVERSAL CLOUDFLARE TUNNEL MANAGER
        card_tunnel = tk.Frame(left_col, bg=COLOR_CARD, highlightbackground=COLOR_BORDER, highlightthickness=1)
        card_tunnel.pack(fill="x", pady=(0, 8), padx=2)

        lbl_tun_title = tk.Label(card_tunnel, text="☁️ UNIVERSAL CLOUDFLARE TUNNEL", font=("Orbitron", 10, "bold"), fg=COLOR_CYAN, bg=COLOR_CARD)
        lbl_tun_title.pack(anchor="w", padx=12, pady=(10, 4))

        # Mode Selection
        mode_row = tk.Frame(card_tunnel, bg=COLOR_CARD)
        mode_row.pack(fill="x", padx=12, pady=4)

        self.tunnel_mode_var = tk.StringVar(value="quick")

        rb_quick = tk.Radiobutton(mode_row, text="⚡ Quick Free (trycloudflare)", variable=self.tunnel_mode_var, value="quick",
                                  bg=COLOR_CARD, fg=COLOR_TEXT, selectcolor="#0B0C10", activebackground=COLOR_CARD,
                                  font=("Rajdhani", 10, "bold"), command=self.on_tunnel_mode_change)
        rb_quick.pack(side="left", padx=(0, 10))

        rb_token = tk.Radiobutton(mode_row, text="🔑 Token", variable=self.tunnel_mode_var, value="token",
                                  bg=COLOR_CARD, fg=COLOR_TEXT, selectcolor="#0B0C10", activebackground=COLOR_CARD,
                                  font=("Rajdhani", 10), command=self.on_tunnel_mode_change)
        rb_token.pack(side="left", padx=10)

        rb_named = tk.Radiobutton(mode_row, text="🏷️ Named Tunnel", variable=self.tunnel_mode_var, value="named",
                                  bg=COLOR_CARD, fg=COLOR_TEXT, selectcolor="#0B0C10", activebackground=COLOR_CARD,
                                  font=("Rajdhani", 10), command=self.on_tunnel_mode_change)
        rb_named.pack(side="left", padx=10)

        # Tunnel Param Entry Row
        self.param_row = tk.Frame(card_tunnel, bg=COLOR_CARD)
        self.param_row.pack(fill="x", padx=12, pady=4)

        self.lbl_tunnel_param = tk.Label(self.param_row, text="Option:", font=("Rajdhani", 10), fg=COLOR_MUTED, bg=COLOR_CARD)
        self.lbl_tunnel_param.pack(side="left")

        self.ent_tunnel_param = tk.Entry(self.param_row, bg="#0B0C10", fg=COLOR_TEXT, insertbackground=COLOR_TEXT, relief="flat", font=("JetBrains Mono", 9))
        self.ent_tunnel_param.pack(side="left", fill="x", expand=True, padx=(6, 0))

        # Tunnel Action Buttons Row
        tun_btn_row = tk.Frame(card_tunnel, bg=COLOR_CARD)
        tun_btn_row.pack(fill="x", padx=12, pady=(6, 10))

        self.btn_tunnel_toggle = tk.Button(tun_btn_row, text="☁️ START TUNNEL", bg="#112938", fg=COLOR_CYAN, font=("Rajdhani", 10, "bold"),
                                           relief="flat", cursor="hand2", padx=14, pady=4, command=self.toggle_tunnel)
        self.btn_tunnel_toggle.pack(side="left")

        self.btn_tunnel_copy = tk.Button(tun_btn_row, text="📋 Copy URL", bg="#1C2130", fg=COLOR_TEXT, font=("Rajdhani", 9),
                                         relief="flat", cursor="hand2", padx=8, pady=4, command=self.copy_tunnel_url)
        self.btn_tunnel_copy.pack(side="left", padx=8)

        self.lbl_tunnel_status = tk.Label(tun_btn_row, text="● TUNNEL OFFLINE", font=("JetBrains Mono", 9, "bold"), fg=COLOR_CRIMSON, bg=COLOR_CARD)
        self.lbl_tunnel_status.pack(side="left", padx=8)

        # Helper Install/Login link buttons
        self.helper_row = tk.Frame(card_tunnel, bg=COLOR_CARD)
        self.helper_row.pack(fill="x", padx=12, pady=(0, 8))

        self.btn_install_cf = tk.Button(self.helper_row, text="⬇️ Auto-Install cloudflared", bg="#151A24", fg=COLOR_MUTED, font=("Rajdhani", 8),
                                        relief="flat", cursor="hand2", command=self.auto_install_cloudflared)
        self.btn_install_cf.pack(side="left")

        self.btn_login_cf = tk.Button(self.helper_row, text="🔑 Cloudflare Login Flow", bg="#151A24", fg=COLOR_MUTED, font=("Rajdhani", 8),
                                      relief="flat", cursor="hand2", command=self.login_cloudflared)
        self.btn_login_cf.pack(side="left", padx=8)

        # CARD C: SYSTEM UTILITIES
        card_tools = tk.Frame(left_col, bg=COLOR_CARD, highlightbackground=COLOR_BORDER, highlightthickness=1)
        card_tools.pack(fill="x", pady=(0, 4), padx=2)

        lbl_tools_title = tk.Label(card_tools, text="🛠️ SYSTEM CONTROLS", font=("Orbitron", 10, "bold"), fg=COLOR_CYAN, bg=COLOR_CARD)
        lbl_tools_title.pack(anchor="w", padx=12, pady=(8, 4))

        tools_row = tk.Frame(card_tools, bg=COLOR_CARD)
        tools_row.pack(fill="x", padx=12, pady=(2, 8))

        btn_power = tk.Button(tools_row, text="🌙 Keep Awake on Lid Close", bg="#151A24", fg=COLOR_TEXT, font=("Rajdhani", 9, "bold"),
                              relief="flat", cursor="hand2", padx=10, pady=4, command=self.configure_lid_power)
        btn_power.pack(side="left")

        btn_kill = tk.Button(tools_row, text="🛑 Disconnect All Devices", bg="#381115", fg=COLOR_CRIMSON, font=("Rajdhani", 9, "bold"),
                             relief="flat", cursor="hand2", padx=10, pady=4, command=self.kill_all_sessions)
        btn_kill.pack(side="left", padx=8)

        # RIGHT COLUMN: SCANNABLE QR CODE & QUICK ACCESS
        right_col = tk.Frame(main_body, bg=COLOR_CARD, width=380, highlightbackground=COLOR_BORDER, highlightthickness=1)
        right_col.pack(side="right", fill="both", padx=(6, 0))

        lbl_qr_head = tk.Label(right_col, text="📱 MOBILE QUICK CONNECT", font=("Orbitron", 10, "bold"), fg=COLOR_CYAN, bg=COLOR_CARD)
        lbl_qr_head.pack(anchor="center", pady=(12, 6))

        # QR Canvas Box
        self.qr_canvas = tk.Canvas(right_col, width=200, height=200, bg="#FFFFFF", highlightthickness=0)
        self.qr_canvas.pack(pady=6)

        self.lbl_active_url = tk.Label(right_col, text="No active URL", font=("JetBrains Mono", 8), fg=COLOR_MUTED, bg=COLOR_CARD, wraplength=340)
        self.lbl_active_url.pack(pady=4)

        # Target Selector Radio Buttons
        self.qr_target_var = tk.StringVar(value="lan")
        qr_sel_row = tk.Frame(right_col, bg=COLOR_CARD)
        qr_sel_row.pack(pady=4)

        rb_qr_cf = tk.Radiobutton(qr_sel_row, text="☁️ Tunnel", variable=self.qr_target_var, value="tunnel",
                                  bg=COLOR_CARD, fg=COLOR_TEXT, selectcolor="#0B0C10", command=self.update_qr_display)
        rb_qr_cf.pack(side="left", padx=4)

        rb_qr_lan = tk.Radiobutton(qr_sel_row, text="📶 Local Wi-Fi", variable=self.qr_target_var, value="lan",
                                   bg=COLOR_CARD, fg=COLOR_TEXT, selectcolor="#0B0C10", command=self.update_qr_display)
        rb_qr_lan.pack(side="left", padx=4)

        btn_copy_qr = tk.Button(right_col, text="📋 Copy Active Connect URL", bg="#1C2130", fg=COLOR_CYAN, font=("Rajdhani", 9, "bold"),
                                relief="flat", cursor="hand2", padx=10, pady=4, command=self.copy_active_connect_url)
        btn_copy_qr.pack(pady=8)

        # 3. BOTTOM LOGS CONSOLE
        bottom_box = tk.Frame(self, bg=COLOR_CARD, highlightbackground=COLOR_BORDER, highlightthickness=1)
        bottom_box.pack(fill="both", expand=True, padx=12, pady=(4, 12))

        log_head = tk.Frame(bottom_box, bg=COLOR_CARD)
        log_head.pack(fill="x", padx=8, pady=4)

        tk.Label(log_head, text="📜 SYSTEM & TUNNEL LOGS", font=("Orbitron", 9, "bold"), fg=COLOR_MUTED, bg=COLOR_CARD).pack(side="left")
        tk.Button(log_head, text="Clear", bg="#151A24", fg=COLOR_MUTED, font=("Rajdhani", 8), relief="flat",
                  command=lambda: self.txt_logs.delete("1.0", tk.END)).pack(side="right")

        self.txt_logs = tk.Text(bottom_box, bg="#07080B", fg="#D0D5E0", insertbackground=COLOR_TEXT, font=("JetBrains Mono", 8),
                                relief="flat", height=8, wrap="word")
        self.txt_logs.pack(fill="both", expand=True, padx=8, pady=(0, 6))

        # Initial display
        self.on_tunnel_mode_change()
        self.log("RENIS Desktop Control Center initialized.")
        self.update_qr_display()

        # Auto-start server on GUI launch
        self.after(500, self.start_server)

    def log(self, message: str):
        t_str = time.strftime("[%H:%M:%S] ")
        self.txt_logs.insert(tk.END, t_str + message + "\n")
        self.txt_logs.see(tk.END)

    def on_tunnel_mode_change(self):
        mode = self.tunnel_mode_var.get()
        if mode == "quick":
            self.lbl_tunnel_param.config(text="Mode Info:")
            self.ent_tunnel_param.delete(0, tk.END)
            self.ent_tunnel_param.insert(0, "Auto-generates free public *.trycloudflare.com URL")
            self.ent_tunnel_param.config(state="disabled")
        elif mode == "token":
            self.lbl_tunnel_param.config(text="Token:")
            self.ent_tunnel_param.config(state="normal")
            self.ent_tunnel_param.delete(0, tk.END)
            self.ent_tunnel_param.insert(0, "eyJhIjoi...")
        elif mode == "named":
            self.lbl_tunnel_param.config(text="Tunnel Name:")
            self.ent_tunnel_param.config(state="normal")
            self.ent_tunnel_param.delete(0, tk.END)
            self.ent_tunnel_param.insert(0, "reni")

    def toggle_server(self):
        if self.server_proc and self.server_proc.poll() is None:
            self.stop_server()
        else:
            self.start_server()

    def start_server(self):
        if self.server_proc and self.server_proc.poll() is None:
            return
        port = self.ent_port.get().strip() or str(self.default_port)
        os.environ["RENIS_PORT"] = port
        cmd = [sys.executable, str(SERVER_DIR / "renis_server.py")]
        self.log(f"Starting RENIS Server on port {port}...")
        try:
            self.server_proc = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
                creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == 'win32' else 0
            )
            self.lbl_srv_status.config(text=f"● SERVER ONLINE (Port {port})", fg=COLOR_GREEN)
            self.btn_srv_toggle.config(text="🔴 STOP SERVER", bg="#381115", fg=COLOR_CRIMSON)

            def stream_logs(proc):
                for line in proc.stdout:
                    clean = re.sub(r'\x1b\[[0-9;]*m', '', line).strip()
                    if clean:
                        self.after(0, lambda m=clean: self.log(m))

            threading.Thread(target=stream_logs, args=(self.server_proc,), daemon=True).start()
            self.update_qr_display()
        except Exception as e:
            self.log(f"Failed to start server: {e}")

    def stop_server(self):
        if self.server_proc:
            self.log("Stopping RENIS Server...")
            try:
                self.server_proc.terminate()
                self.server_proc.kill()
            except Exception:
                pass
            self.server_proc = None
        self.lbl_srv_status.config(text="● SERVER OFFLINE", fg=COLOR_CRIMSON)
        self.btn_srv_toggle.config(text="🟢 START SERVER", bg="#103318", fg=COLOR_GREEN)

    def find_cloudflared(self) -> Optional[str]:
        local_bin = SERVER_DIR / "bin" / "cloudflared.exe"
        if local_bin.exists():
            return str(local_bin)
        candidates = [
            r"C:\Program Files (x86)\cloudflared\cloudflared.exe",
            r"C:\Program Files\cloudflared\cloudflared.exe"
        ]
        for c in candidates:
            if os.path.exists(c):
                return c
        import shutil
        return shutil.which("cloudflared")

    def check_cloudflared_status(self):
        bin_path = self.find_cloudflared()
        if bin_path:
            self.btn_install_cf.config(text=f"✓ cloudflared installed", state="disabled")
        else:
            self.btn_install_cf.config(text="⬇️ Auto-Install cloudflared", state="normal")

    def auto_install_cloudflared(self):
        self.log("Downloading cloudflared-windows-amd64.exe from GitHub...")
        bin_dir = SERVER_DIR / "bin"
        bin_dir.mkdir(parents=True, exist_ok=True)
        target = bin_dir / "cloudflared.exe"
        url = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe"

        def do_dl():
            try:
                urllib.request.urlretrieve(url, str(target))
                self.after(0, lambda: self.log("cloudflared binary installed to RENIS/bin/cloudflared.exe"))
                self.after(0, self.check_cloudflared_status)
            except Exception as e:
                self.after(0, lambda: self.log(f"Auto-install failed: {e}"))

        threading.Thread(target=do_dl, daemon=True).start()

    def login_cloudflared(self):
        binary = self.find_cloudflared()
        if not binary:
            messagebox.showerror("Error", "cloudflared is not installed. Please click 'Auto-Install cloudflared' first.")
            return
        self.log("Opening Cloudflare Tunnel login browser window...")
        subprocess.Popen([binary, "tunnel", "login"])

    def toggle_tunnel(self):
        if self.tunnel_proc and self.tunnel_proc.poll() is None:
            self.stop_tunnel()
        else:
            self.start_tunnel()

    def start_tunnel(self):
        binary = self.find_cloudflared()
        if not binary:
            messagebox.showerror("Cloudflared Missing", "cloudflared.exe was not found. Click 'Auto-Install cloudflared' first.")
            return

        mode = self.tunnel_mode_var.get()
        param = self.ent_tunnel_param.get().strip()
        port = self.ent_port.get().strip() or str(self.default_port)

        cmd = [binary, "tunnel"]
        if mode == "quick":
            cmd.extend(["--url", f"http://127.0.0.1:{port}"])
        elif mode == "token":
            if not param or param.startswith("eyJhIjoi"):
                messagebox.showerror("Invalid Token", "Please enter your Cloudflare Tunnel Token.")
                return
            cmd.extend(["run", "--token", param])
        elif mode == "named":
            name = param or "reni"
            cmd.extend(["run", "--url", f"http://127.0.0.1:{port}", name])

        self.log(f"Launching Cloudflare Tunnel ({mode} mode)...")
        try:
            self.tunnel_proc = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                bufsize=1,
                creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == 'win32' else 0
            )
            self.lbl_tunnel_status.config(text="● CONNECTING...", fg=COLOR_CYAN)
            self.btn_tunnel_toggle.config(text="🔴 STOP TUNNEL", bg="#381115", fg=COLOR_CRIMSON)

            def read_tunnel_stream(proc):
                url_pattern = re.compile(r"https://[a-zA-Z0-9-]+\.trycloudflare\.com")
                for line in proc.stderr:
                    clean = line.strip()
                    if clean:
                        match = url_pattern.search(clean)
                        if match:
                            self.tunnel_url = match.group(0)
                            self.after(0, lambda u=self.tunnel_url: self.on_tunnel_connected(u))
                        elif "Registered tunnel connection" in clean:
                            self.after(0, lambda: self.lbl_tunnel_status.config(text="● TUNNEL ONLINE", fg=COLOR_GREEN))
                        self.after(0, lambda m=clean: self.log(f"[TUNNEL] {m}"))

            threading.Thread(target=read_tunnel_stream, args=(self.tunnel_proc,), daemon=True).start()
        except Exception as e:
            self.log(f"Failed to launch tunnel: {e}")

    def on_tunnel_connected(self, url: str):
        self.tunnel_url = url
        self.lbl_tunnel_status.config(text=f"● ONLINE ({url})", fg=COLOR_GREEN)
        self.qr_target_var.set("tunnel")
        self.update_qr_display()

    def stop_tunnel(self):
        if self.tunnel_proc:
            self.log("Stopping Cloudflare Tunnel...")
            try:
                self.tunnel_proc.terminate()
                self.tunnel_proc.kill()
            except Exception:
                pass
            self.tunnel_proc = None
        self.tunnel_url = ""
        self.lbl_tunnel_status.config(text="● TUNNEL OFFLINE", fg=COLOR_CRIMSON)
        self.btn_tunnel_toggle.config(text="☁️ START TUNNEL", bg="#112938", fg=COLOR_CYAN)
        if self.qr_target_var.get() == "tunnel":
            self.qr_target_var.set("lan")
        self.update_qr_display()

    def update_qr_display(self):
        target = self.qr_target_var.get()
        port = self.ent_port.get().strip() or str(self.default_port)

        if target == "tunnel" and self.tunnel_url:
            url = self.tunnel_url
        else:
            ip = self.discovered_ips[0] if self.discovered_ips else "127.0.0.1"
            url = f"http://{ip}:{port}"

        self.current_qr_url = url
        self.lbl_active_url.config(text=url)

        if qrcode and Image and ImageTk:
            try:
                qr = qrcode.QRCode(version=None, box_size=6, border=1)
                qr.add_data(url)
                qr.make(fit=True)
                img = qr.make_image(fill_color="#0B0C10", back_color="#FFFFFF").resize((200, 200))
                self.qr_photo_ref = ImageTk.PhotoImage(img)
                self.qr_canvas.delete("all")
                self.qr_canvas.create_image(100, 100, image=self.qr_photo_ref)
                return
            except Exception as e:
                self.log(f"QR Render Error: {e}")

        # Fallback text in canvas
        self.qr_canvas.delete("all")
        self.qr_canvas.create_text(100, 100, text=f"Scan URL:\n{url}", fill="#0B0C10", font=("JetBrains Mono", 8), width=180)

    def copy_tunnel_url(self):
        if self.tunnel_url:
            self.clipboard_clear()
            self.clipboard_append(self.tunnel_url)
            messagebox.showinfo("Copied", f"Copied Cloudflare Tunnel URL:\n{self.tunnel_url}")
        else:
            messagebox.showwarning("Notice", "Cloudflare Tunnel is not online yet.")

    def copy_active_connect_url(self):
        if self.current_qr_url:
            self.clipboard_clear()
            self.clipboard_append(self.current_qr_url)
            messagebox.showinfo("Copied", f"Copied to clipboard:\n{self.current_qr_url}")

    def configure_lid_power(self):
        if sys.platform == 'win32':
            try:
                os.system("powercfg /setacvalueindex SCHEME_CURRENT SUB_BUTTONS LIDACTION 0")
                os.system("powercfg /change standby-timeout-ac 0")
                os.system("powercfg /setactive SCHEME_CURRENT")
                self.log("PowerCFG Configured: 24/7 Always-On active on AC power.")
                messagebox.showinfo("PowerCFG", "Laptop configured to remain awake when lid is closed on AC power.")
            except Exception as e:
                self.log(f"PowerCFG error: {e}")
        else:
            messagebox.showwarning("Platform", "Available only on Windows host.")

    def kill_all_sessions(self):
        if messagebox.askyesno("Confirm", "Disconnect all remote mobile stream and input control sessions?"):
            try:
                port = self.ent_port.get().strip() or str(self.default_port)
                req = urllib.request.Request(f"http://127.0.0.1:{port}/api/server/kill-sessions", method="POST")
                urllib.request.urlopen(req)
                self.log("All remote sessions disconnected.")
            except Exception as e:
                self.log(f"Kill sessions failed: {e}")

    def on_exit(self):
        self.stop_tunnel()
        self.stop_server()
        self.destroy()


def main():
    app = RenisDesktopApp()
    app.mainloop()


if __name__ == "__main__":
    main()
