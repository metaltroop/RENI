/**
 * ==============================================================================
 *  R.E.N.I.S. // REMOTE NITRO CLIENT (PWA)
 *  Dual-Mode Touch Engine, Low-Latency Canvas Stream, PowerShell Terminal Drawer,
 *  WebAuthn + Master PIN Auth, Nitro Sense HUD & N2O Overclock
 * ==============================================================================
 */

(function() {
  'use strict';

  // State Management
  const state = {
    token: localStorage.getItem('reni_jwt_token') || '',
    streamSocket: null,
    controlSocket: null,
    terminalSocket: null,
    telemetryTimer: null,
    
    // Performance & Streaming
    fps: 20,
    scale: 0.75,
    quality: 65,
    overclockActive: false,
    
    // Touch & Input
    inputMode: 'trackpad', // 'trackpad' | 'direct'
    trackpadSensitivity: 1.5,
    virtualCursor: { x: window.innerWidth / 2, y: window.innerHeight / 2 },
    stickyModifiers: new Set(),
    
    // Canvas & Video Resolution
    canvasWidth: 1920,
    canvasHeight: 1080,
    zoomScale: 1.0,
    panX: 0,
    panY: 0,
    
    // Auth UI
    enteredPin: '',
    
    // Easter Egg #2 Tap Counter
    n2oTapCount: 0,
    n2oLastTapTime: 0
  };

  // DOM Element Selectors
  const dom = {
    // Header & HUD
    header: document.getElementById('nitro-header'),
    connectionStatus: document.getElementById('connection-status'),
    n2oBadge: document.getElementById('n2o-badge'),
    cpuFill: document.getElementById('cpu-fill'),
    cpuVal: document.getElementById('cpu-val'),
    ramFill: document.getElementById('ram-fill'),
    ramVal: document.getElementById('ram-val'),
    batteryIcon: document.getElementById('battery-icon'),
    batteryVal: document.getElementById('battery-val'),
    btnModeToggle: document.getElementById('btn-mode-toggle'),
    modeIcon: document.getElementById('mode-icon'),
    btnOpenTerminal: document.getElementById('btn-open-terminal'),
    btnOpenSettings: document.getElementById('btn-open-settings'),

    // Viewport & Canvas
    viewportWrapper: document.getElementById('viewport-wrapper'),
    canvas: document.getElementById('stream-canvas'),
    ctx: document.getElementById('stream-canvas').getContext('2d'),
    virtualCursor: document.getElementById('virtual-cursor'),
    streamOverlay: document.getElementById('stream-overlay'),
    streamStatusText: document.getElementById('stream-status-text'),

    // Bottom Tactical Dock
    bottomDock: document.getElementById('bottom-dock'),
    mobileKeyCapture: document.getElementById('mobile-key-capture'),
    btnKeyboardTrigger: document.getElementById('btn-keyboard-trigger'),
    btnClipboardOpen: document.getElementById('btn-clipboard-open'),

    // Drawers
    terminalDrawer: document.getElementById('terminal-drawer'),
    btnCloseTerminal: document.getElementById('btn-close-terminal'),
    terminalOutput: document.getElementById('terminal-output'),
    terminalInput: document.getElementById('terminal-input'),
    btnTermSend: document.getElementById('btn-term-send'),
    btnTermClear: document.getElementById('btn-term-clear'),
    btnTermInterrupt: document.getElementById('btn-term-interrupt'),

    settingsDrawer: document.getElementById('settings-drawer'),
    btnCloseSettings: document.getElementById('btn-close-settings'),
    btnRegisterPasskey: document.getElementById('btn-register-passkey'),
    btnOpenPinChange: document.getElementById('btn-open-pin-change'),
    toggleBlackout: document.getElementById('toggle-blackout'),
    toggleKeepawake: document.getElementById('toggle-keepawake'),
    scaleSlider: document.getElementById('stream-scale-slider'),
    scaleLabel: document.getElementById('scale-label'),
    qualitySlider: document.getElementById('stream-quality-slider'),
    qualityLabel: document.getElementById('quality-label'),
    fpsSlider: document.getElementById('stream-fps-slider'),
    fpsLabel: document.getElementById('fps-label'),
    sensSlider: document.getElementById('trackpad-sens-slider'),
    sensLabel: document.getElementById('sens-label'),
    wolMacInput: document.getElementById('wol-mac-input'),
    btnTriggerWol: document.getElementById('btn-trigger-wol'),
    btnLogout: document.getElementById('btn-logout'),

    // Modals
    clipboardModal: document.getElementById('clipboard-modal'),
    btnCloseClipboard: document.getElementById('btn-close-clipboard'),
    clipboardTextarea: document.getElementById('clipboard-textarea'),
    btnClipPull: document.getElementById('btn-clip-pull'),
    btnClipPush: document.getElementById('btn-clip-push'),

    changePinModal: document.getElementById('change-pin-modal'),
    btnClosePinModal: document.getElementById('btn-close-pin-modal'),
    inputOldPin: document.getElementById('input-old-pin'),
    inputNewPin: document.getElementById('input-new-pin'),
    btnSaveNewPin: document.getElementById('btn-save-new-pin'),

    // Auth Overlay & Keypad
    authOverlay: document.getElementById('auth-overlay'),
    btnBiometricLogin: document.getElementById('btn-biometric-login'),
    btnKeypadClear: document.getElementById('btn-keypad-clear'),
    btnKeypadBack: document.getElementById('btn-keypad-back'),
    authFeedback: document.getElementById('auth-feedback'),

    toast: document.getElementById('nitro-toast')
  };

  // ==============================================================================
  // TOAST NOTIFICATION UTILITY
  // ==============================================================================
  let toastTimer = null;
  function showToast(message, duration = 3000) {
    if (toastTimer) clearTimeout(toastTimer);
    dom.toast.textContent = message;
    dom.toast.classList.remove('hidden');
    toastTimer = setTimeout(() => {
      dom.toast.classList.add('hidden');
    }, duration);
  }

  // ==============================================================================
  // AUTHENTICATION & PIN KEYPAD
  // ==============================================================================
  function updatePinDisplay() {
    for (let i = 0; i < 6; i++) {
      const dot = document.getElementById(`pdot-${i}`);
      if (dot) {
        if (i < state.enteredPin.length) {
          dot.classList.add('filled');
        } else {
          dot.classList.remove('filled');
        }
      }
    }
  }

  async function submitMasterPin() {
    dom.authFeedback.textContent = "VERIFYING NITRO CORE KEY...";
    try {
      const res = await fetch('/api/auth/login-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: state.enteredPin })
      });
      const data = await res.json();
      
      if (res.ok && data.success) {
        state.token = data.token;
        localStorage.setItem('reni_jwt_token', data.token);
        dom.authFeedback.textContent = "";
        dom.authOverlay.classList.add('hidden');
        showToast("Access Granted: Nitro Core Connected");
        
        if (data.must_change_pin) {
          dom.changePinModal.classList.remove('hidden');
          showToast("Notice: Default Master PIN active. Please change PIN.", 5000);
        }

        initializeSession();
      } else {
        dom.authFeedback.textContent = data.detail || "Authentication Failed";
        shakePinDots();
      }
    } catch (err) {
      dom.authFeedback.textContent = "Connection Error to Server";
      shakePinDots();
    }
  }

  function shakePinDots() {
    state.enteredPin = '';
    updatePinDisplay();
  }

  // Keypad event listeners
  document.querySelectorAll('.keypad-btn[data-val]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (state.enteredPin.length < 6) {
        state.enteredPin += btn.getAttribute('data-val');
        updatePinDisplay();
        if (state.enteredPin.length === 6) {
          submitMasterPin();
        }
      }
    });
  });

  dom.btnKeypadClear.addEventListener('click', () => {
    state.enteredPin = '';
    updatePinDisplay();
  });

  dom.btnKeypadBack.addEventListener('click', () => {
    if (state.enteredPin.length > 0) {
      state.enteredPin = state.enteredPin.slice(0, -1);
      updatePinDisplay();
    }
  });

  // ==============================================================================
  // W3C WEBAUTHN BIOMETRIC PASSKEY FLOW
  // ==============================================================================
  function bufferToBase64Url(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  }

  function base64UrlToBuffer(base64Url) {
    let str = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    while (str.length % 4) str += '=';
    const binary = atob(str);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }

  async function loginWithBiometrics() {
    if (!window.PublicKeyCredential) {
      showToast("WebAuthn not supported on this browser/context");
      return;
    }

    try {
      dom.authFeedback.textContent = "Requesting biometric challenge...";
      const optRes = await fetch('/api/auth/webauthn/login-options');
      if (!optRes.ok) {
        const err = await optRes.json();
        dom.authFeedback.textContent = err.detail || "No biometrics registered";
        return;
      }

      const options = await optRes.json();
      options.challenge = base64UrlToBuffer(options.challenge);
      if (options.allowCredentials) {
        options.allowCredentials = options.allowCredentials.map(c => ({
          ...c,
          id: base64UrlToBuffer(c.id)
        }));
      }

      const assertion = await navigator.credentials.get({ publicKey: options });
      if (!assertion) return;

      const payload = {
        id: assertion.id,
        rawId: bufferToBase64Url(assertion.rawId),
        response: {
          clientDataJSON: bufferToBase64Url(assertion.response.clientDataJSON),
          authenticatorData: bufferToBase64Url(assertion.response.authenticatorData),
          signature: bufferToBase64Url(assertion.response.signature)
        }
      };

      const verifyRes = await fetch('/api/auth/webauthn/login-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await verifyRes.json();

      if (verifyRes.ok && data.success) {
        state.token = data.token;
        localStorage.setItem('reni_jwt_token', data.token);
        dom.authOverlay.classList.add('hidden');
        showToast("Biometric Authenticated: Session Active");
        initializeSession();
      } else {
        dom.authFeedback.textContent = data.detail || "Biometric validation failed";
      }
    } catch (err) {
      dom.authFeedback.textContent = "Biometric prompt cancelled or failed";
    }
  }

  dom.btnBiometricLogin.addEventListener('click', loginWithBiometrics);

  async function registerBiometrics() {
    if (!window.PublicKeyCredential) {
      showToast("Biometrics not supported on this device/connection");
      return;
    }

    try {
      const optRes = await fetch('/api/auth/webauthn/register-options', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${state.token}` }
      });
      if (!optRes.ok) throw new Error("Failed to get registration options");
      const options = await optRes.json();

      options.challenge = base64UrlToBuffer(options.challenge);
      options.user.id = base64UrlToBuffer(options.user.id);

      const credential = await navigator.credentials.create({ publicKey: options });
      if (!credential) return;

      const payload = {
        id: credential.id,
        rawId: bufferToBase64Url(credential.rawId),
        response: {
          clientDataJSON: bufferToBase64Url(credential.response.clientDataJSON),
          attestationObject: bufferToBase64Url(credential.response.attestationObject)
        }
      };

      const verifyRes = await fetch('/api/auth/webauthn/register-verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${state.token}`
        },
        body: JSON.stringify(payload)
      });
      const result = await verifyRes.json();

      if (verifyRes.ok && result.success) {
        showToast("Phone Biometric Passkey Registered Successfully!");
      } else {
        showToast(result.detail || "Registration Failed");
      }
    } catch (err) {
      showToast("Biometric Registration Cancelled");
    }
  }

  dom.btnRegisterPasskey.addEventListener('click', registerBiometrics);

  // ==============================================================================
  // EASTER EGG #2: "N2O OVERCLOCK" MODE (TAP [N2O] 3 TIMES)
  // ==============================================================================
  dom.n2oBadge.addEventListener('click', () => {
    const now = Date.now();
    if (now - state.n2oLastTapTime < 600) {
      state.n2oTapCount++;
    } else {
      state.n2oTapCount = 1;
    }
    state.n2oLastTapTime = now;

    if (state.n2oTapCount === 3) {
      state.n2oTapCount = 0;
      state.overclockActive = !state.overclockActive;
      
      if (state.overclockActive) {
        document.body.classList.add('theme-overclock');
        dom.n2oBadge.classList.add('overclock-active');
        state.fps = 35;
        dom.fpsSlider.value = 35;
        dom.fpsLabel.textContent = "35 FPS (N2O)";
        sendStreamConfig({ fps: 35 });
        showToast("N2O Injected: Maximum Telemetry Engaged (35 FPS)");
      } else {
        document.body.classList.remove('theme-overclock');
        dom.n2oBadge.classList.remove('overclock-active');
        state.fps = 20;
        dom.fpsSlider.value = 20;
        dom.fpsLabel.textContent = "20 FPS";
        sendStreamConfig({ fps: 20 });
        showToast("N2O Standard Mode Restored (20 FPS)");
      }
    }
  });

  // ==============================================================================
  // EASTER EGG #3: NITRO SENSE TELEMETRY HUD (psutil)
  // ==============================================================================
  async function fetchTelemetry() {
    if (!state.token) return;
    try {
      const res = await fetch(`/api/system/telemetry?token=${encodeURIComponent(state.token)}`);
      if (res.status === 401) {
        handleSessionExpired();
        return;
      }
      if (!res.ok) return;

      const data = await res.json();
      
      // Update CPU
      const cpu = Math.round(data.cpu.percent);
      dom.cpuFill.style.width = `${cpu}%`;
      dom.cpuVal.textContent = `${cpu}%`;

      // Dynamic gauge warning colors
      if (cpu > 85) {
        dom.cpuFill.style.background = '#FF0033';
      } else if (state.overclockActive) {
        dom.cpuFill.style.background = '#00F0FF';
      } else {
        dom.cpuFill.style.background = '#FF0033';
      }

      // Update RAM
      const ram = Math.round(data.memory.percent);
      dom.ramFill.style.width = `${ram}%`;
      dom.ramVal.textContent = `${ram}%`;

      // Update Battery
      const bat = data.battery;
      dom.batteryVal.textContent = `${bat.percent}%`;
      dom.batteryIcon.textContent = bat.plugged ? '⚡' : '🔋';
      
      // Keep awake sync
      dom.toggleKeepawake.checked = !!data.keep_awake;
    } catch (err) {
      // Background telemetry failed
    }
  }

  function startTelemetryPolling() {
    if (state.telemetryTimer) clearInterval(state.telemetryTimer);
    fetchTelemetry();
    state.telemetryTimer = setInterval(fetchTelemetry, 1500);
  }

  // ==============================================================================
  // WEBSOCKET 1: SCREEN STREAMING ENGINE
  // ==============================================================================
  function sendStreamConfig(cfg) {
    if (state.streamSocket && state.streamSocket.readyState === WebSocket.OPEN) {
      state.streamSocket.send(JSON.stringify({ action: "config", ...cfg }));
    }
  }

  function initStreamWebSocket() {
    if (!state.token) return;
    if (state.streamSocket) {
      try { state.streamSocket.close(); } catch(e){}
    }

    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${proto}//${location.host}/ws/stream?token=${encodeURIComponent(state.token)}`;
    state.streamSocket = new WebSocket(wsUrl);
    state.streamSocket.binaryType = 'blob';

    state.streamSocket.onopen = () => {
      dom.connectionStatus.classList.remove('disconnected');
      dom.streamStatusText.textContent = "SYNCHRONIZING NITRO DESKTOP...";
      sendStreamConfig({
        fps: state.fps,
        scale: state.scale,
        quality: state.quality
      });
    };

    state.streamSocket.onmessage = async (event) => {
      if (typeof event.data === 'string') return; // Config/error message

      try {
        const imageBitmap = await createImageBitmap(event.data);
        
        // Auto-scale canvas resolution to match source monitor aspect
        if (dom.canvas.width !== imageBitmap.width || dom.canvas.height !== imageBitmap.height) {
          dom.canvas.width = imageBitmap.width;
          dom.canvas.height = imageBitmap.height;
          state.canvasWidth = imageBitmap.width;
          state.canvasHeight = imageBitmap.height;
        }

        dom.ctx.drawImage(imageBitmap, 0, 0);
        imageBitmap.close();

        // Dismiss loading overlay on first rendered frame
        if (!dom.streamOverlay.classList.contains('hidden')) {
          dom.streamOverlay.classList.add('hidden');
        }
      } catch (err) {
        // Frame decode error
      }
    };

    state.streamSocket.onclose = () => {
      dom.connectionStatus.classList.add('disconnected');
      dom.streamOverlay.classList.remove('hidden');
      dom.streamStatusText.textContent = "STREAM DISCONNECTED // RECONNECTING...";
      setTimeout(initStreamWebSocket, 2000);
    };

    state.streamSocket.onerror = () => {
      dom.connectionStatus.classList.add('disconnected');
    };
  }

  // ==============================================================================
  // WEBSOCKET 2: DUAL-MODE INPUT & CONTROL ENGINE
  // ==============================================================================
  function sendControl(payload) {
    if (state.controlSocket && state.controlSocket.readyState === WebSocket.OPEN) {
      state.controlSocket.send(JSON.stringify(payload));
    }
  }

  function initControlWebSocket() {
    if (!state.token) return;
    if (state.controlSocket) {
      try { state.controlSocket.close(); } catch(e){}
    }

    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${proto}//${location.host}/ws/control?token=${encodeURIComponent(state.token)}`;
    state.controlSocket = new WebSocket(wsUrl);

    state.controlSocket.onopen = () => {
      // Control channel ready
    };

    state.controlSocket.onclose = () => {
      setTimeout(initControlWebSocket, 2000);
    };
  }

  // Touch & Gesture Engine Implementation
  let touchStartTime = 0;
  let lastTapTime = 0;
  let touchStartPos = { x: 0, y: 0 };
  let lastTouchPos = { x: 0, y: 0 };
  let isDragging = false;
  let isTwoFingerTouch = false;
  let twoFingerStartY = 0;
  let hasMovedSignificantly = false;

  function updateVirtualCursor(clientX, clientY) {
    state.virtualCursor.x = Math.max(0, Math.min(window.innerWidth, clientX));
    state.virtualCursor.y = Math.max(0, Math.min(window.innerHeight, clientY));
    dom.virtualCursor.style.transform = `translate3d(${state.virtualCursor.x}px, ${state.virtualCursor.y}px, 0)`;
  }

  // Mode 1: Precision Trackpad Mode & Mode 2: Direct Touch
  dom.viewportWrapper.addEventListener('touchstart', (e) => {
    touchStartTime = Date.now();
    hasMovedSignificantly = false;

    if (e.touches.length === 1) {
      const touch = e.touches[0];
      touchStartPos = { x: touch.clientX, y: touch.clientY };
      lastTouchPos = { x: touch.clientX, y: touch.clientY };
      isTwoFingerTouch = false;

      if (state.inputMode === 'trackpad') {
        dom.virtualCursor.classList.remove('hidden');
        // Check for double-tap-to-drag
        const timeSinceLastTap = touchStartTime - lastTapTime;
        if (timeSinceLastTap < 280) {
          isDragging = true;
          sendControl({ type: "mouse_down", button: "left" });
        }
      }
    } else if (e.touches.length === 2) {
      isTwoFingerTouch = true;
      twoFingerStartY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
    }
  }, { passive: false });

  dom.viewportWrapper.addEventListener('touchmove', (e) => {
    e.preventDefault();

    if (e.touches.length === 1 && !isTwoFingerTouch) {
      const touch = e.touches[0];
      const dx = (touch.clientX - lastTouchPos.x) * state.trackpadSensitivity;
      const dy = (touch.clientY - lastTouchPos.y) * state.trackpadSensitivity;
      
      const distFromStart = Math.hypot(touch.clientX - touchStartPos.x, touch.clientY - touchStartPos.y);
      if (distFromStart > 6) {
        hasMovedSignificantly = true;
      }

      if (state.inputMode === 'trackpad') {
        sendControl({ type: "mouse_move_rel", dx, dy });
        updateVirtualCursor(state.virtualCursor.x + dx, state.virtualCursor.y + dy);
      } else {
        // Direct Touch absolute mapping
        const rect = dom.canvas.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          const normX = Math.max(0, Math.min(1, (touch.clientX - rect.left) / rect.width));
          const normY = Math.max(0, Math.min(1, (touch.clientY - rect.top) / rect.height));
          sendControl({ type: "mouse_move_abs", x: normX, y: normY });
        }
      }

      lastTouchPos = { x: touch.clientX, y: touch.clientY };
    } else if (e.touches.length === 2 && isTwoFingerTouch) {
      hasMovedSignificantly = true;
      const curY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      const deltaY = curY - twoFingerStartY;
      if (Math.abs(deltaY) > 8) {
        const scrollAmount = deltaY > 0 ? 120 : -120;
        sendControl({ type: "mouse_scroll", dy: scrollAmount });
        twoFingerStartY = curY;
      }
    }
  }, { passive: false });

  dom.viewportWrapper.addEventListener('touchend', (e) => {
    const duration = Date.now() - touchStartTime;

    if (isDragging) {
      isDragging = false;
      sendControl({ type: "mouse_up", button: "left" });
      lastTapTime = 0;
      return;
    }

    if (isTwoFingerTouch) {
      if (!hasMovedSignificantly && duration < 300) {
        // Two-Finger Single Tap: Right Click
        sendControl({ type: "mouse_click", button: "right" });
      }
      isTwoFingerTouch = false;
      return;
    }

    if (!hasMovedSignificantly && duration < 250) {
      // 1-Finger Single Tap: Left Click
      if (state.inputMode === 'direct') {
        const rect = dom.canvas.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          const normX = Math.max(0, Math.min(1, (touchStartPos.x - rect.left) / rect.width));
          const normY = Math.max(0, Math.min(1, (touchStartPos.y - rect.top) / rect.height));
          sendControl({ type: "mouse_move_abs", x: normX, y: normY });
        }
      }
      sendControl({ type: "mouse_click", button: "left" });
      lastTapTime = Date.now();
    }
  });

  // Toggle Input Mode (Trackpad vs Direct)
  dom.btnModeToggle.addEventListener('click', () => {
    if (state.inputMode === 'trackpad') {
      state.inputMode = 'direct';
      dom.modeIcon.textContent = '👆';
      dom.virtualCursor.classList.add('hidden');
      showToast("Input Mode: Direct Touch Enabled");
    } else {
      state.inputMode = 'trackpad';
      dom.modeIcon.textContent = '🖱️';
      dom.virtualCursor.classList.remove('hidden');
      showToast("Input Mode: Trackpad Precision Enabled");
    }
  });

  // ==============================================================================
  // MOBILE KEYBOARD & DOCK SHORTCUT DECK
  // ==============================================================================
  dom.btnKeyboardTrigger.addEventListener('click', () => {
    dom.mobileKeyCapture.focus();
    dom.mobileKeyCapture.click();
    showToast("Mobile Keyboard Active");
  });

  dom.mobileKeyCapture.addEventListener('keydown', (e) => {
    if (e.key === 'Backspace') {
      sendControl({ type: "key_backspace" });
    } else if (e.key === 'Enter') {
      sendControl({ type: "key_tap", key: "enter" });
    }
  });

  dom.mobileKeyCapture.addEventListener('input', (e) => {
    if (e.data) {
      sendControl({ type: "type_text", text: e.data });
    }
    dom.mobileKeyCapture.value = '';
  });

  // Sticky Modifiers Toggle (Ctrl, Alt, Shift)
  document.querySelectorAll('.dock-btn.mod-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.getAttribute('data-key');
      if (state.stickyModifiers.has(key)) {
        state.stickyModifiers.delete(key);
        btn.classList.remove('active');
        sendControl({ type: "key_up", key });
      } else {
        state.stickyModifiers.add(key);
        btn.classList.add('active');
        sendControl({ type: "key_down", key });
      }
    });
  });

  // Shortcut Buttons
  document.querySelectorAll('.dock-btn[data-key]:not(.mod-toggle)').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.getAttribute('data-key');
      sendControl({ type: "key_tap", key });
    });
  });

  document.querySelectorAll('.dock-btn[data-combo]').forEach(btn => {
    btn.addEventListener('click', () => {
      const keys = btn.getAttribute('data-combo').split(',');
      sendControl({ type: "key_combo", keys });
      showToast(`Macro Triggered: ${btn.textContent.trim()}`);
    });
  });

  // ==============================================================================
  // WEBSOCKET 3: ELEVATED POWERSHELL TERMINAL DRAWER
  // ==============================================================================
  function initTerminalWebSocket() {
    if (!state.token) return;
    if (state.terminalSocket) {
      try { state.terminalSocket.close(); } catch(e){}
    }

    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${proto}//${location.host}/ws/terminal?token=${encodeURIComponent(state.token)}`;
    state.terminalSocket = new WebSocket(wsUrl);

    state.terminalSocket.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        const span = document.createElement('span');
        if (msg.type === 'stderr') {
          span.className = 'term-stderr';
        } else {
          span.className = 'term-stdout';
        }
        span.textContent = msg.data;
        dom.terminalOutput.appendChild(span);
        dom.terminalOutput.scrollTop = dom.terminalOutput.scrollHeight;
      } catch (e) {
        dom.terminalOutput.textContent += event.data;
      }
    };
  }

  function sendTerminalCommand(cmdText) {
    if (state.terminalSocket && state.terminalSocket.readyState === WebSocket.OPEN) {
      state.terminalSocket.send(JSON.stringify({ type: "input", data: cmdText }));
    }
  }

  dom.btnOpenTerminal.addEventListener('click', () => {
    dom.terminalDrawer.classList.add('open');
    if (!state.terminalSocket || state.terminalSocket.readyState !== WebSocket.OPEN) {
      initTerminalWebSocket();
    }
    setTimeout(() => dom.terminalInput.focus(), 300);
  });

  dom.btnCloseTerminal.addEventListener('click', () => {
    dom.terminalDrawer.classList.remove('open');
  });

  dom.btnTermSend.addEventListener('click', () => {
    const cmd = dom.terminalInput.value.trim();
    if (cmd) {
      sendTerminalCommand(cmd);
      dom.terminalInput.value = '';
    }
  });

  dom.terminalInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      dom.btnTermSend.click();
    }
  });

  dom.btnTermClear.addEventListener('click', () => {
    dom.terminalOutput.innerHTML = '';
  });

  dom.btnTermInterrupt.addEventListener('click', () => {
    if (state.terminalSocket && state.terminalSocket.readyState === WebSocket.OPEN) {
      state.terminalSocket.send(JSON.stringify({ type: "interrupt" }));
    }
  });

  // Macro chips
  document.querySelectorAll('.macro-chip[data-cmd]').forEach(chip => {
    chip.addEventListener('click', () => {
      const cmd = chip.getAttribute('data-cmd');
      sendTerminalCommand(cmd);
    });
  });

  // ==============================================================================
  // SETTINGS DRAWER & SYSTEM ACTIONS
  // ==============================================================================
  dom.btnOpenSettings.addEventListener('click', () => {
    dom.settingsDrawer.classList.add('open');
  });

  dom.btnCloseSettings.addEventListener('click', () => {
    dom.settingsDrawer.classList.remove('open');
  });

  // Privacy Blackout Toggle
  dom.toggleBlackout.addEventListener('change', async () => {
    try {
      const res = await fetch('/api/power/blackout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${state.token}`
        },
        body: JSON.stringify({ state: dom.toggleBlackout.checked })
      });
      const data = await res.json();
      showToast(data.message || "Monitor Blackout Toggled");
    } catch (err) {
      showToast("Failed to toggle monitor power");
    }
  });

  // Keep-Awake Toggle
  dom.toggleKeepawake.addEventListener('change', async () => {
    try {
      const res = await fetch('/api/power/keep-awake', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${state.token}`
        },
        body: JSON.stringify({ active: dom.toggleKeepawake.checked })
      });
      const data = await res.json();
      showToast(data.keep_awake ? "Keep-Awake Active" : "Keep-Awake Disabled");
    } catch (err) {
      showToast("Failed to update keep-awake state");
    }
  });

  // Power Action Buttons
  document.querySelectorAll('.power-btn[data-action]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const action = btn.getAttribute('data-action');
      if (confirm(`Execute host system action: ${action.toUpperCase()}?`)) {
        try {
          const res = await fetch('/api/power/action', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${state.token}`
            },
            body: JSON.stringify({ action })
          });
          const data = await res.json();
          showToast(data.message || `Action ${action} dispatched`);
        } catch (err) {
          showToast("Failed to execute power action");
        }
      }
    });
  });

  // Stream Sliders
  dom.scaleSlider.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    dom.scaleLabel.textContent = `${Math.round(val * 100)}%`;
    state.scale = val;
    sendStreamConfig({ scale: val });
  });

  dom.qualitySlider.addEventListener('input', (e) => {
    const val = parseInt(e.target.value);
    dom.qualityLabel.textContent = `${val}%`;
    state.quality = val;
    sendStreamConfig({ quality: val });
  });

  dom.fpsSlider.addEventListener('input', (e) => {
    const val = parseInt(e.target.value);
    dom.fpsLabel.textContent = `${val} FPS`;
    state.fps = val;
    sendStreamConfig({ fps: val });
  });

  dom.sensSlider.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    dom.sensLabel.textContent = `${val}x`;
    state.trackpadSensitivity = val;
  });

  // Wake-on-LAN Broadcast
  dom.btnTriggerWol.addEventListener('click', async () => {
    const mac = dom.wolMacInput.value.trim();
    try {
      const res = await fetch('/api/power/wol', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${state.token}`
        },
        body: JSON.stringify({ mac })
      });
      const data = await res.json();
      showToast(data.success ? "Magic Packet Broadcasted" : "WoL Broadcast Failed");
    } catch (err) {
      showToast("Error transmitting Magic Packet");
    }
  });

  // Clipboard Sync
  dom.btnClipboardOpen.addEventListener('click', async () => {
    dom.clipboardModal.classList.remove('hidden');
    // Pull automatically on open
    dom.btnClipPull.click();
  });

  dom.btnCloseClipboard.addEventListener('click', () => {
    dom.clipboardModal.classList.add('hidden');
  });

  dom.btnClipPull.addEventListener('click', async () => {
    try {
      const res = await fetch(`/api/clipboard?token=${encodeURIComponent(state.token)}`);
      const data = await res.json();
      dom.clipboardTextarea.value = data.text || '';
      showToast("Pulled from Host Clipboard");
    } catch (err) {
      showToast("Failed to read clipboard");
    }
  });

  dom.btnClipPush.addEventListener('click', async () => {
    const text = dom.clipboardTextarea.value;
    try {
      const res = await fetch('/api/clipboard', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${state.token}`
        },
        body: JSON.stringify({ text })
      });
      const data = await res.json();
      showToast("Pushed to Host Clipboard");
    } catch (err) {
      showToast("Failed to write clipboard");
    }
  });

  // Change Master PIN
  dom.btnOpenPinChange.addEventListener('click', () => {
    dom.changePinModal.classList.remove('hidden');
  });

  dom.btnClosePinModal.addEventListener('click', () => {
    dom.changePinModal.classList.add('hidden');
  });

  dom.btnSaveNewPin.addEventListener('click', async () => {
    const old_pin = dom.inputOldPin.value.trim();
    const new_pin = dom.inputNewPin.value.trim();
    if (new_pin.length < 6) {
      showToast("New PIN must be 6 digits");
      return;
    }

    try {
      const res = await fetch('/api/auth/change-pin', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${state.token}`
        },
        body: JSON.stringify({ old_pin, new_pin })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        state.token = data.token;
        localStorage.setItem('reni_jwt_token', data.token);
        dom.changePinModal.classList.add('hidden');
        showToast("Master PIN Successfully Updated!");
      } else {
        showToast(data.detail || "PIN update failed");
      }
    } catch (err) {
      showToast("Error updating PIN");
    }
  });

  // Logout
  dom.btnLogout.addEventListener('click', () => {
    localStorage.removeItem('reni_jwt_token');
    state.token = '';
    location.reload();
  });

  function handleSessionExpired() {
    showToast("Session Expired: Please Login");
    dom.authOverlay.classList.remove('hidden');
    state.token = '';
    localStorage.removeItem('reni_jwt_token');
    if (state.streamSocket) state.streamSocket.close();
    if (state.controlSocket) state.controlSocket.close();
    if (state.terminalSocket) state.terminalSocket.close();
    if (state.telemetryTimer) clearInterval(state.telemetryTimer);
  }

  // ==============================================================================
  // SESSION INITIALIZATION
  // ==============================================================================
  function initializeSession() {
    initStreamWebSocket();
    initControlWebSocket();
    startTelemetryPolling();
    updateVirtualCursor(window.innerWidth / 2, window.innerHeight / 2);
  }

  // Boot check
  if (state.token) {
    dom.authOverlay.classList.add('hidden');
    initializeSession();
  } else {
    dom.authOverlay.classList.remove('hidden');
  }

  // PWA Service Worker Registration
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    });
  }

})();
