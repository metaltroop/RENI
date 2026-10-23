/**
 * ==============================================================================
 *  R.E.N.I.S. // REMOTE CLIENT (PWA) v2.0
 *  Collapsible Overlay HUD, Full Landscape Mode, Universal 0.5x-4.0x Zoom,
 *  Scoped Modifiers (Zero Host Keyboard Interference), Task View & Onboarding
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
    deferredPwaPrompt: null,
    
    // Performance & Streaming
    fps: 20,
    scale: 0.75,
    quality: 65,
    highFreqActive: false,
    
    // Touch & Input
    inputMode: 'trackpad', // 'trackpad' | 'direct'
    trackpadSensitivity: 1.5,
    stickyModifiers: new Set(),
    
    // Canvas & Universal Zoom (0.5x to 4.0x)
    canvasWidth: 1920,
    canvasHeight: 1080,
    zoomScale: 1.0,
    panX: 0,
    panY: 0,
    
    // UI State
    hudCollapsed: false,
    enteredPin: '',
    
    // Hidden Easter Egg Tap Counter
    eggTapCount: 0,
    eggLastTapTime: 0
  };

  // DOM Element Selectors
  const dom = {
    appContainer: document.getElementById('app-container'),
    header: document.getElementById('reni-header'),
    connectionStatus: document.getElementById('connection-status'),
    easterEggTrigger: document.getElementById('easter-egg-trigger'),
    
    // Telemetry HUD
    cpuFill: document.getElementById('cpu-fill'),
    cpuVal: document.getElementById('cpu-val'),
    ramFill: document.getElementById('ram-fill'),
    ramVal: document.getElementById('ram-val'),
    batteryIcon: document.getElementById('battery-icon'),
    batteryVal: document.getElementById('battery-val'),
    
    // Header Controls
    btnModeToggle: document.getElementById('btn-mode-toggle'),
    modeIcon: document.getElementById('mode-icon'),
    modeText: document.getElementById('mode-text'),
    btnZoomIn: document.getElementById('btn-zoom-in'),
    btnZoomOut: document.getElementById('btn-zoom-out'),
    btnZoomReset: document.getElementById('btn-zoom-reset'),
    btnMinimizeHud: document.getElementById('btn-minimize-hud'),
    btnOpenTerminal: document.getElementById('btn-open-terminal'),
    btnOpenSettings: document.getElementById('btn-open-settings'),

    // Minimized Floating Action Pill
    fabContainer: document.getElementById('floating-fab-container'),
    btnFabRestore: document.getElementById('btn-fab-restore'),
    fabQuickMode: document.getElementById('fab-quick-mode'),
    fabQuickZoomIn: document.getElementById('fab-quick-zoom-in'),
    fabQuickZoomOut: document.getElementById('fab-quick-zoom-out'),
    fabQuickKey: document.getElementById('fab-quick-key'),

    // Viewport & Canvas
    viewportWrapper: document.getElementById('viewport-wrapper'),
    canvas: document.getElementById('stream-canvas'),
    ctx: document.getElementById('stream-canvas').getContext('2d'),
    streamOverlay: document.getElementById('stream-overlay'),
    streamStatusText: document.getElementById('stream-status-text'),

    // Bottom Tactical Dock
    bottomDock: document.getElementById('bottom-dock'),
    mobileKeyCapture: document.getElementById('mobile-key-capture'),
    btnKeyboardTrigger: document.getElementById('btn-keyboard-trigger'),
    btnClipboardOpen: document.getElementById('btn-clipboard-open'),

    // Onboarding Banners & Modals
    pwaBanner: document.getElementById('pwa-install-banner'),
    btnPwaInstall: document.getElementById('btn-pwa-install'),
    btnPwaDismiss: document.getElementById('btn-pwa-dismiss'),
    firstBioModal: document.getElementById('first-biometrics-modal'),
    btnAcceptBio: document.getElementById('btn-accept-bio-prompt'),
    btnSkipBio: document.getElementById('btn-skip-bio-prompt'),
    btnDismissBio: document.getElementById('btn-dismiss-bio-prompt'),
    httpGuideModal: document.getElementById('http-guide-modal'),
    btnOpenHttpGuide: document.getElementById('btn-open-http-guide'),
    btnCloseHttpGuide: document.getElementById('btn-close-http-guide'),
    btnCloseHttpGuideOk: document.getElementById('btn-close-http-guide-ok'),
    btnCopyFlagsUrl: document.getElementById('btn-copy-flags-url'),

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
  // UNIVERSAL ZOOM & PAN (0.5x to 4.0x)
  // ==============================================================================
  function applyCanvasTransform() {
    state.zoomScale = Math.max(0.5, Math.min(4.0, state.zoomScale));
    if (Math.abs(state.zoomScale - 1.0) < 0.02 && Math.abs(state.panX) < 2 && Math.abs(state.panY) < 2) {
      dom.canvas.style.transform = 'none';
    } else {
      dom.canvas.style.transform = `translate3d(${state.panX}px, ${state.panY}px, 0) scale(${state.zoomScale})`;
    }
    if (dom.btnZoomReset) {
      dom.btnZoomReset.textContent = Math.round(state.zoomScale * 10) / 10 + 'x';
    }
  }

  function resetZoom() {
    state.zoomScale = 1.0;
    state.panX = 0;
    state.panY = 0;
    applyCanvasTransform();
    if (dom.btnZoomReset) dom.btnZoomReset.textContent = '1:1';
  }

  dom.btnZoomIn.addEventListener('click', () => {
    state.zoomScale = Math.min(4.0, state.zoomScale + 0.25);
    applyCanvasTransform();
  });

  dom.btnZoomOut.addEventListener('click', () => {
    state.zoomScale = Math.max(0.5, state.zoomScale - 0.25);
    applyCanvasTransform();
  });

  dom.btnZoomReset.addEventListener('click', () => {
    resetZoom();
    showToast("Zoom Reset (1.0x)");
  });

  // FAB Quick Zoom buttons
  if (dom.fabQuickZoomIn) {
    dom.fabQuickZoomIn.addEventListener('click', () => {
      state.zoomScale = Math.min(4.0, state.zoomScale + 0.25);
      applyCanvasTransform();
    });
  }
  if (dom.fabQuickZoomOut) {
    dom.fabQuickZoomOut.addEventListener('click', () => {
      state.zoomScale = Math.max(0.5, state.zoomScale - 0.25);
      applyCanvasTransform();
    });
  }

  // ==============================================================================
  // COLLAPSIBLE OVERLAY HUD (FULLSCREEN LANDSCAPE MODE)
  // ==============================================================================
  function setHudCollapsed(collapsed) {
    state.hudCollapsed = collapsed;
    if (collapsed) {
      dom.appContainer.classList.add('hud-collapsed');
      dom.fabContainer.classList.remove('hidden');
    } else {
      dom.appContainer.classList.remove('hud-collapsed');
      dom.fabContainer.classList.add('hidden');
    }
  }

  dom.btnMinimizeHud.addEventListener('click', () => {
    setHudCollapsed(true);
    showToast("Fullscreen Active — Tap ⚡ to restore controls", 2500);
  });

  dom.btnFabRestore.addEventListener('click', () => {
    setHudCollapsed(false);
  });

  // Automatically offer compact mode on landscape rotation
  window.addEventListener('resize', () => {
    if (window.innerWidth > window.innerHeight) {
      // Landscape: keep controls responsive
    }
  });

  // ==============================================================================
  // HIDDEN EASTER EGG #1: TRIPLE-TAP RENI LOGO TO TOGGLE 35 FPS HIGH-FREQUENCY MODE
  // ==============================================================================
  dom.easterEggTrigger.addEventListener('click', () => {
    const now = Date.now();
    if (now - state.eggLastTapTime < 600) {
      state.eggTapCount++;
    } else {
      state.eggTapCount = 1;
    }
    state.eggLastTapTime = now;

    if (state.eggTapCount === 3) {
      state.eggTapCount = 0;
      state.highFreqActive = !state.highFreqActive;

      if (state.highFreqActive) {
        document.body.classList.add('theme-overclock');
        state.fps = 35;
        dom.fpsSlider.value = 35;
        dom.fpsLabel.textContent = "35 FPS";
        sendStreamConfig({ fps: 35 });
        showToast("⚡ High-Frequency Stream Active (35 FPS)");
      } else {
        document.body.classList.remove('theme-overclock');
        state.fps = 20;
        dom.fpsSlider.value = 20;
        dom.fpsLabel.textContent = "20 FPS";
        sendStreamConfig({ fps: 20 });
        showToast("Standard Stream Mode (20 FPS)");
      }
    }
  });

  // ==============================================================================
  // ONBOARDING: PWA INSTALL & BIOMETRICS PROMPTS
  // ==============================================================================
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    state.deferredPwaPrompt = e;
    dom.pwaBanner.classList.remove('hidden');
  });

  dom.btnPwaInstall.addEventListener('click', async () => {
    if (state.deferredPwaPrompt) {
      state.deferredPwaPrompt.prompt();
      const choice = await state.deferredPwaPrompt.userChoice;
      state.deferredPwaPrompt = null;
      dom.pwaBanner.classList.add('hidden');
    }
  });

  dom.btnPwaDismiss.addEventListener('click', () => {
    dom.pwaBanner.classList.add('hidden');
  });

  // HTTP Biometrics Flag Guide
  dom.btnOpenHttpGuide.addEventListener('click', () => {
    dom.httpGuideModal.classList.remove('hidden');
  });
  dom.btnCloseHttpGuide.addEventListener('click', () => dom.httpGuideModal.classList.add('hidden'));
  dom.btnCloseHttpGuideOk.addEventListener('click', () => dom.httpGuideModal.classList.add('hidden'));

  dom.btnCopyFlagsUrl.addEventListener('click', () => {
    const textToCopy = `chrome://flags/#unsafely-treat-insecure-origin-as-secure\nAdd origin: ${window.location.origin}`;
    navigator.clipboard.writeText(textToCopy).then(() => {
      showToast("Flag & Origin Copied to Clipboard!");
    });
  });

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
    dom.authFeedback.textContent = "VERIFYING KEY...";
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
        showToast("Connected: Remote Session Active");
        
        if (data.must_change_pin) {
          dom.changePinModal.classList.remove('hidden');
          showToast("Notice: Default Master PIN active. Please change PIN.", 5000);
        } else if (!data.has_biometrics && window.PublicKeyCredential) {
          // First-time biometric onboarding prompt
          setTimeout(() => {
            dom.firstBioModal.classList.remove('hidden');
          }, 800);
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
      showToast("Biometrics not available on this browser/context");
      return;
    }

    try {
      dom.authFeedback.textContent = "Requesting biometric challenge...";
      const optRes = await fetch('/api/auth/webauthn/login-options', { method: 'POST' });
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
      showToast("Biometrics not available on this device/connection");
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
        dom.firstBioModal.classList.add('hidden');
      } else {
        showToast(result.detail || "Registration Failed");
      }
    } catch (err) {
      showToast("Biometric Registration Cancelled");
    }
  }

  dom.btnRegisterPasskey.addEventListener('click', registerBiometrics);
  dom.btnAcceptBio.addEventListener('click', registerBiometrics);
  dom.btnSkipBio.addEventListener('click', () => dom.firstBioModal.classList.add('hidden'));
  dom.btnDismissBio.addEventListener('click', () => dom.firstBioModal.classList.add('hidden'));

  // ==============================================================================
  // TELEMETRY POLLING (psutil)
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
      
      const cpu = Math.round(data.cpu.percent);
      dom.cpuFill.style.width = `${cpu}%`;
      dom.cpuVal.textContent = `${cpu}%`;

      const ram = Math.round(data.memory.percent);
      dom.ramFill.style.width = `${ram}%`;
      dom.ramVal.textContent = `${ram}%`;

      const bat = data.battery;
      dom.batteryVal.textContent = `${bat.percent}%`;
      dom.batteryIcon.textContent = bat.plugged ? '⚡' : '🔋';
      
      dom.toggleKeepawake.checked = !!data.keep_awake;
    } catch (err) {}
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
      dom.streamStatusText.textContent = "SYNCHRONIZING DESKTOP...";
      sendStreamConfig({
        fps: state.fps,
        scale: state.scale,
        quality: state.quality
      });
    };

    state.streamSocket.onmessage = async (event) => {
      if (typeof event.data === 'string') return;

      try {
        const imageBitmap = await createImageBitmap(event.data);
        
        if (dom.canvas.width !== imageBitmap.width || dom.canvas.height !== imageBitmap.height) {
          dom.canvas.width = imageBitmap.width;
          dom.canvas.height = imageBitmap.height;
          state.canvasWidth = imageBitmap.width;
          state.canvasHeight = imageBitmap.height;
        }

        dom.ctx.drawImage(imageBitmap, 0, 0);
        imageBitmap.close();

        if (!dom.streamOverlay.classList.contains('hidden')) {
          dom.streamOverlay.classList.add('hidden');
        }
      } catch (err) {}
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
  // WEBSOCKET 2: DUAL-MODE INPUT & THROTTLED CONTROL ENGINE
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

    state.controlSocket.onclose = () => {
      setTimeout(initControlWebSocket, 2000);
    };
  }

  // Movement Throttling (Sends at most once every ~16ms to avoid WebSocket flood)
  let moveThrottleTimer = null;
  let pendingRelDx = 0;
  let pendingRelDy = 0;
  let pendingAbsPos = null;
  let lastMoveSendTime = 0;

  function flushThrottledMoves() {
    const now = performance.now();
    if (state.inputMode === 'trackpad') {
      if (pendingRelDx !== 0 || pendingRelDy !== 0) {
        sendControl({ type: "mouse_move_rel", dx: pendingRelDx, dy: pendingRelDy });
        pendingRelDx = 0;
        pendingRelDy = 0;
      }
    } else if (state.inputMode === 'direct') {
      if (pendingAbsPos !== null) {
        sendControl({ type: "mouse_move_abs", x: pendingAbsPos.x, y: pendingAbsPos.y });
        pendingAbsPos = null;
      }
    }
    lastMoveSendTime = now;
    moveThrottleTimer = null;
  }

  function queueMouseMoveRel(dx, dy) {
    pendingRelDx += dx;
    pendingRelDy += dy;
    const now = performance.now();
    if (now - lastMoveSendTime >= 16) {
      if (moveThrottleTimer) {
        cancelAnimationFrame(moveThrottleTimer);
        moveThrottleTimer = null;
      }
      flushThrottledMoves();
    } else if (!moveThrottleTimer) {
      moveThrottleTimer = requestAnimationFrame(flushThrottledMoves);
    }
  }

  function queueMouseMoveAbs(normX, normY) {
    pendingAbsPos = { x: normX, y: normY };
    const now = performance.now();
    if (now - lastMoveSendTime >= 16) {
      if (moveThrottleTimer) {
        cancelAnimationFrame(moveThrottleTimer);
        moveThrottleTimer = null;
      }
      flushThrottledMoves();
    } else if (!moveThrottleTimer) {
      moveThrottleTimer = requestAnimationFrame(flushThrottledMoves);
    }
  }

  // Touch & Gesture Tracking
  let touchStartTime = 0;
  let lastTapTime = 0;
  let touchStartPos = { x: 0, y: 0 };
  let lastTouchPos = { x: 0, y: 0 };
  let isDragging = false;
  let isTwoFingerGesture = false;
  let twoFingerStartY = 0;
  let hasMovedSignificantly = false;

  // Universal Pinch-to-zoom tracking (0.5x to 4.0x in BOTH modes)
  let initialPinchDist = 0;
  let initialZoomScale = 1.0;
  let initialMidpoint = { x: 0, y: 0 };
  let initialPan = { x: 0, y: 0 };
  let isPinching = false;

  dom.viewportWrapper.addEventListener('touchstart', (e) => {
    touchStartTime = Date.now();
    hasMovedSignificantly = false;

    if (e.touches.length === 1) {
      const touch = e.touches[0];
      touchStartPos = { x: touch.clientX, y: touch.clientY };
      lastTouchPos = { x: touch.clientX, y: touch.clientY };
      isTwoFingerGesture = false;
      isPinching = false;

      if (state.inputMode === 'trackpad') {
        const timeSinceLastTap = touchStartTime - lastTapTime;
        if (timeSinceLastTap < 280) {
          isDragging = true;
          flushThrottledMoves();
          sendControl({
            type: "mouse_down",
            button: "left",
            modifiers: Array.from(state.stickyModifiers)
          });
        }
      }
    } else if (e.touches.length === 2) {
      isTwoFingerGesture = true;
      isPinching = false;
      twoFingerStartY = (e.touches[0].clientY + e.touches[1].clientY) / 2;

      initialPinchDist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      initialZoomScale = state.zoomScale;
      initialMidpoint = {
        x: (e.touches[0].clientX + e.touches[1].clientX) / 2,
        y: (e.touches[0].clientY + e.touches[1].clientY) / 2
      };
      initialPan = { x: state.panX, y: state.panY };
    }
  }, { passive: false });

  dom.viewportWrapper.addEventListener('touchmove', (e) => {
    e.preventDefault();

    if (e.touches.length === 1 && !isTwoFingerGesture) {
      const touch = e.touches[0];
      const rawDx = (touch.clientX - lastTouchPos.x) * state.trackpadSensitivity;
      const rawDy = (touch.clientY - lastTouchPos.y) * state.trackpadSensitivity;
      
      const distFromStart = Math.hypot(touch.clientX - touchStartPos.x, touch.clientY - touchStartPos.y);
      if (distFromStart > 6) {
        hasMovedSignificantly = true;
      }

      if (state.inputMode === 'trackpad') {
        queueMouseMoveRel(rawDx, rawDy);
      } else {
        const rect = dom.canvas.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          const normX = Math.max(0, Math.min(1, (touch.clientX - rect.left) / rect.width));
          const normY = Math.max(0, Math.min(1, (touch.clientY - rect.top) / rect.height));
          queueMouseMoveAbs(normX, normY);
        }
      }

      lastTouchPos = { x: touch.clientX, y: touch.clientY };
    } else if (e.touches.length === 2 && isTwoFingerGesture) {
      hasMovedSignificantly = true;

      const curDist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      const distDelta = Math.abs(curDist - initialPinchDist);

      // If finger distance changes by > 12px, activate Universal Pinch-to-Zoom
      if (distDelta > 12 || isPinching) {
        isPinching = true;
        const scaleRatio = curDist / (initialPinchDist || 1);
        const newScale = Math.max(0.5, Math.min(4.0, initialZoomScale * scaleRatio));
        
        const curMidpoint = {
          x: (e.touches[0].clientX + e.touches[1].clientX) / 2,
          y: (e.touches[0].clientY + e.touches[1].clientY) / 2
        };

        state.zoomScale = newScale;
        state.panX = initialPan.x + (curMidpoint.x - initialMidpoint.x);
        state.panY = initialPan.y + (curMidpoint.y - initialMidpoint.y);
        applyCanvasTransform();
      } else if (!isPinching) {
        // Parallel two-finger vertical drag: mouse wheel scroll
        const curY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        const deltaY = curY - twoFingerStartY;
        if (Math.abs(deltaY) > 8) {
          const scrollAmount = deltaY > 0 ? 120 : -120;
          sendControl({ type: "mouse_scroll", dy: scrollAmount });
          twoFingerStartY = curY;
        }
      }
    }
  }, { passive: false });

  dom.viewportWrapper.addEventListener('touchend', (e) => {
    const duration = Date.now() - touchStartTime;
    flushThrottledMoves();

    if (isDragging) {
      isDragging = false;
      sendControl({
        type: "mouse_up",
        button: "left",
        modifiers: Array.from(state.stickyModifiers)
      });
      lastTapTime = 0;
      return;
    }

    if (isTwoFingerGesture) {
      if (!hasMovedSignificantly && !isPinching && duration < 300) {
        // Two-Finger Tap: Right Click with scoped modifiers
        sendControl({
          type: "mouse_click",
          button: "right",
          modifiers: Array.from(state.stickyModifiers)
        });
      }
      isTwoFingerGesture = false;
      isPinching = false;
      return;
    }

    if (!hasMovedSignificantly && duration < 250) {
      // Double tap reset zoom if zoomed in/out
      const timeSinceLastTap = Date.now() - lastTapTime;
      if (timeSinceLastTap < 280 && Math.abs(state.zoomScale - 1.0) > 0.05) {
        resetZoom();
        showToast("Zoom Reset (1.0x)");
        lastTapTime = 0;
        return;
      }

      if (state.inputMode === 'direct') {
        const rect = dom.canvas.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          const normX = Math.max(0, Math.min(1, (touchStartPos.x - rect.left) / rect.width));
          const normY = Math.max(0, Math.min(1, (touchStartPos.y - rect.top) / rect.height));
          sendControl({ type: "mouse_move_abs", x: normX, y: normY });
        }
      }

      // Single Tap: Left Click with scoped modifiers
      sendControl({
        type: "mouse_click",
        button: "left",
        modifiers: Array.from(state.stickyModifiers)
      });
      lastTapTime = Date.now();
    }
  });

  // Toggle Input Mode (Touchpad vs Direct Touch)
  function toggleInputMode() {
    if (state.inputMode === 'trackpad') {
      state.inputMode = 'direct';
      dom.modeIcon.textContent = '👆';
      dom.modeText.textContent = 'Touch';
      if (dom.fabQuickMode) dom.fabQuickMode.textContent = '👆';
      showToast("Input Mode: Direct Touch");
    } else {
      state.inputMode = 'trackpad';
      dom.modeIcon.textContent = '🖱️';
      dom.modeText.textContent = 'Touchpad';
      if (dom.fabQuickMode) dom.fabQuickMode.textContent = '🖱️';
      showToast("Input Mode: Trackpad");
    }
  }

  dom.btnModeToggle.addEventListener('click', toggleInputMode);
  if (dom.fabQuickMode) dom.fabQuickMode.addEventListener('click', toggleInputMode);

  // ==============================================================================
  // SCOPED MODIFIERS & SHORTCUT DOCK (DOES NOT AFFECT PHYSICAL LAPTOP KEYBOARD)
  // ==============================================================================
  dom.btnKeyboardTrigger.addEventListener('click', () => {
    dom.mobileKeyCapture.focus();
    dom.mobileKeyCapture.click();
    showToast("Keyboard Active");
  });

  if (dom.fabQuickKey) {
    dom.fabQuickKey.addEventListener('click', () => {
      dom.mobileKeyCapture.focus();
      dom.mobileKeyCapture.click();
    });
  }

  dom.mobileKeyCapture.addEventListener('keydown', (e) => {
    if (e.key === 'Backspace') {
      sendControl({ type: "key_backspace" });
    } else if (e.key === 'Enter') {
      sendControl({
        type: "key_tap",
        key: "enter",
        modifiers: Array.from(state.stickyModifiers)
      });
    }
  });

  dom.mobileKeyCapture.addEventListener('input', (e) => {
    if (e.data) {
      sendControl({ type: "type_text", text: e.data });
    }
    dom.mobileKeyCapture.value = '';
  });

  // Sticky Modifiers (Scoped to remote commands only)
  document.querySelectorAll('.dock-btn.mod-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.getAttribute('data-key');
      if (state.stickyModifiers.has(key)) {
        state.stickyModifiers.delete(key);
        btn.classList.remove('active');
        showToast(`${key.toUpperCase()} Released`);
      } else {
        state.stickyModifiers.add(key);
        btn.classList.add('active');
        showToast(`${key.toUpperCase()} Latched (Applies to next remote action)`);
      }
    });
  });

  // Shortcut & Task View Buttons
  document.querySelectorAll('.dock-btn[data-key]:not(.mod-toggle)').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.getAttribute('data-key');
      sendControl({
        type: "key_tap",
        key,
        modifiers: Array.from(state.stickyModifiers)
      });
    });
  });

  document.querySelectorAll('.dock-btn[data-combo]').forEach(btn => {
    btn.addEventListener('click', () => {
      const keys = btn.getAttribute('data-combo').split(',');
      sendControl({ type: "key_combo", keys });
      showToast(`Macro: ${btn.textContent.trim()}`);
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
        span.className = msg.type === 'stderr' ? 'term-stderr' : 'term-stdout';
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
    if (e.key === 'Enter') dom.btnTermSend.click();
  });

  dom.btnTermClear.addEventListener('click', () => {
    dom.terminalOutput.innerHTML = '';
  });

  dom.btnTermInterrupt.addEventListener('click', () => {
    if (state.terminalSocket && state.terminalSocket.readyState === WebSocket.OPEN) {
      state.terminalSocket.send(JSON.stringify({ type: "interrupt" }));
    }
  });

  document.querySelectorAll('.macro-chip[data-cmd]').forEach(chip => {
    chip.addEventListener('click', () => {
      sendTerminalCommand(chip.getAttribute('data-cmd'));
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

  document.querySelectorAll('.power-btn[data-action]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const action = btn.getAttribute('data-action');
      if (confirm(`Execute host action: ${action.toUpperCase()}?`)) {
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
      showToast(data.success ? "Magic Packet Broadcasted" : "WoL Failed");
    } catch (err) {
      showToast("Error transmitting WoL");
    }
  });

  // Clipboard Sync
  dom.btnClipboardOpen.addEventListener('click', async () => {
    dom.clipboardModal.classList.remove('hidden');
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
      showToast("Pulled from Laptop Clipboard");
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
      showToast("Pushed to Laptop Clipboard");
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
        showToast("Master PIN Updated Successfully!");
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
  }

  // Boot check
  if (state.token) {
    dom.authOverlay.classList.add('hidden');
    initializeSession();
  } else {
    dom.authOverlay.classList.remove('hidden');
  }

  // Service Worker Registration
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    });
  }

})();
