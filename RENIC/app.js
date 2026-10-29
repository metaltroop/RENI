/**
 * ==============================================================================
 *  R.E.N.I.S. // REMOTE CLIENT (PWA) v2.1
 *  Auto-Biometric Authentication on Screen Lock / App Foreground,
 *  Graceful WebSocket Disconnect Handling, Universal Zoom & Scoped Modifiers
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
    reconnectTimer: null,
    deferredPwaPrompt: null,
    
    // Performance & Streaming
    fps: 30,
    scale: 0.50,
    quality: 42,
    subsampling: 2, // 2 for 4:2:0 fast subsampling, 0 for 4:4:4 quality
    delta_skip: true, // skip sending duplicate frames if screen hasn't changed
    streamPreset: 'low', // 'low' | 'quality' | 'custom'
    highFreqActive: false,
    
    // Touch & Input
    inputMode: 'trackpad', // 'trackpad' | 'direct'
    trackpadSensitivity: 1.5,
    stickyModifiers: new Set(),
    isHoldingLClick: false,
    
    // Canvas & Universal Zoom (0.5x to 4.0x)
    canvasWidth: 1920,
    canvasHeight: 1080,
    zoomScale: 1.0,
    panX: 0,
    panY: 0,
    zoomLocked: true, // locked by default for flawless 2-finger scrolling!
    
    // UI & HUD State
    hudCollapsed: false,
    enteredPin: '',
    currentClipboardImage: null,
    hudConfig: {
      visible: true,
      size: 100,
      opacity: 85,
      elements: {
        lclick: { left: 8, top: 62 },
        rclick: { left: 8, top: 48 },
        dblclick: { left: 8, top: 36 },
        scroll: { left: 88, top: 52 }
      }
    },
    
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
    
    // Telemetry HUD: Circular Gauges & Percentage
    cpuCircleFill: document.getElementById('cpu-circle-fill'),
    cpuFill: document.getElementById('cpu-fill'),
    cpuVal: document.getElementById('cpu-val'),
    ramCircleFill: document.getElementById('ram-circle-fill'),
    ramFill: document.getElementById('ram-fill'),
    ramVal: document.getElementById('ram-val'),
    batteryIcon: document.getElementById('battery-icon'),
    batteryVal: document.getElementById('battery-val'),
    
    // Header Controls
    btnModeToggle: document.getElementById('btn-mode-toggle'),
    modeIcon: document.getElementById('mode-icon'),
    modeText: document.getElementById('mode-text'),
    btnZoomLock: document.getElementById('btn-zoom-lock'),
    btnZoomIn: document.getElementById('btn-zoom-in'),
    btnZoomOut: document.getElementById('btn-zoom-out'),
    btnZoomReset: document.getElementById('btn-zoom-reset'),
    btnMinimizeHud: document.getElementById('btn-minimize-hud'),
    btnOpenTerminal: document.getElementById('btn-open-terminal'),
    btnOpenSettings: document.getElementById('btn-open-settings'),

    // Minimized Floating Action Pill
    fabContainer: document.getElementById('floating-fab-container'),
    btnFabRestore: document.getElementById('btn-fab-restore'),
    fabQuickZoomLock: document.getElementById('fab-quick-zoom-lock'),
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

    // PUBG-Style HUD Triggers Layer
    hudTriggersLayer: document.getElementById('hud-triggers-layer'),
    hudTriggerLClick: document.getElementById('hud-trigger-lclick'),
    hudTriggerRClick: document.getElementById('hud-trigger-rclick'),
    hudTriggerDblClick: document.getElementById('hud-trigger-dblclick'),
    hudTriggerScroll: document.getElementById('hud-trigger-scroll'),
    hudScrollUp: document.getElementById('hud-scroll-up'),
    hudScrollDown: document.getElementById('hud-scroll-down'),
    toggleHudTriggers: document.getElementById('toggle-hud-triggers'),
    btnOpenHudEditor: document.getElementById('btn-open-hud-editor'),

    // PUBG HUD Layout Customizer Overlay
    hudEditorOverlay: document.getElementById('hud-editor-overlay'),
    hudSizeSlider: document.getElementById('hud-size-slider'),
    hudSizeVal: document.getElementById('hud-size-val'),
    hudOpacitySlider: document.getElementById('hud-opacity-slider'),
    hudOpacityVal: document.getElementById('hud-opacity-val'),
    hudVisibleToggle: document.getElementById('hud-visible-toggle'),
    btnHudReset: document.getElementById('btn-hud-reset'),
    btnHudSave: document.getElementById('btn-hud-save'),
    btnHudClose: document.getElementById('btn-hud-close'),

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
    presetLow: document.getElementById('preset-low-latency'),
    presetQuality: document.getElementById('preset-quality'),
    presetCustom: document.getElementById('preset-custom'),
    customStreamControls: document.getElementById('custom-stream-controls'),
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
    clipCharCount: document.getElementById('clip-char-count'),
    btnClipPhoneToPc: document.getElementById('btn-clip-phone-to-pc'),
    btnClipPcToPhone: document.getElementById('btn-clip-pc-to-phone'),
    btnClipPasteActive: document.getElementById('btn-clip-paste-active'),
    btnClipCopyLocal: document.getElementById('btn-clip-copy-local'),
    btnClipPushCustom: document.getElementById('btn-clip-push-custom'),
    btnClipClear: document.getElementById('btn-clip-clear'),
    btnSettingsOpenClip: document.getElementById('btn-settings-open-clip'),
    tabClipText: document.getElementById('tab-clip-text'),
    tabClipImg: document.getElementById('tab-clip-img'),
    clipPaneText: document.getElementById('clip-pane-text'),
    clipPaneImg: document.getElementById('clip-pane-img'),
    btnClipSnapPc: document.getElementById('btn-clip-snap-pc'),
    btnClipPickImg: document.getElementById('btn-clip-pick-img'),
    clipFileInput: document.getElementById('clip-file-input'),
    btnClipPasteImgActive: document.getElementById('btn-clip-paste-img-active'),
    clipImgCard: document.getElementById('clip-img-card'),
    clipImgPreview: document.getElementById('clip-img-preview'),
    clipImgDims: document.getElementById('clip-img-dims'),
    clipImgSize: document.getElementById('clip-img-size'),
    btnClipDownloadImg: document.getElementById('btn-clip-download-img'),
    btnClipCopyImg: document.getElementById('btn-clip-copy-img'),
    btnClipPushImg: document.getElementById('btn-clip-push-img'),
    clipImgEmpty: document.getElementById('clip-img-empty'),

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

  function setZoomLocked(locked) {
    state.zoomLocked = locked;
    const icon = locked ? '🔒' : '🔓';
    const title = locked ? 'Zoom Locked (2-Finger Scroll Active)' : 'Zoom Unlocked (Pinch-to-Zoom Active)';
    if (dom.btnZoomLock) {
      dom.btnZoomLock.textContent = icon;
      dom.btnZoomLock.title = title;
      if (locked) dom.btnZoomLock.classList.add('active');
      else dom.btnZoomLock.classList.remove('active');
    }
    if (dom.fabQuickZoomLock) {
      dom.fabQuickZoomLock.textContent = icon;
      dom.fabQuickZoomLock.title = title;
      if (locked) dom.fabQuickZoomLock.classList.add('active');
      else dom.fabQuickZoomLock.classList.remove('active');
    }
  }

  if (dom.btnZoomLock) {
    dom.btnZoomLock.addEventListener('click', () => {
      setZoomLocked(!state.zoomLocked);
      showToast(state.zoomLocked ? "🔒 Zoom Locked — Smooth 2-Finger Scroll" : "🔓 Zoom Unlocked — Pinch-to-Zoom Active");
    });
  }
  if (dom.fabQuickZoomLock) {
    dom.fabQuickZoomLock.addEventListener('click', () => {
      setZoomLocked(!state.zoomLocked);
      showToast(state.zoomLocked ? "🔒 Zoom Locked" : "🔓 Zoom Unlocked");
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
  // AUTHENTICATION & AUTO-LOCK / FINGERPRINT ON SCREEN SLEEP
  // ==============================================================================
  function lockAppSession() {
    if (state.streamSocket) {
      try { state.streamSocket.close(); } catch(e){}
      state.streamSocket = null;
    }
    if (state.controlSocket) {
      try { state.controlSocket.close(); } catch(e){}
      state.controlSocket = null;
    }
    if (state.telemetryTimer) {
      clearInterval(state.telemetryTimer);
      state.telemetryTimer = null;
    }
    if (state.reconnectTimer) {
      clearTimeout(state.reconnectTimer);
      state.reconnectTimer = null;
    }

    dom.authOverlay.classList.remove('hidden');
    dom.streamOverlay.classList.remove('hidden');
    dom.streamStatusText.textContent = "SESSION LOCKED";
    state.enteredPin = '';
    updatePinDisplay();
  }

  // Auto-lock when phone screen turns off / app minimized, and auto-prompt fingerprint on wake
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      lockAppSession();
    } else {
      dom.authOverlay.classList.remove('hidden');
      setTimeout(() => {
        loginWithBiometrics(true);
      }, 350);
    }
  });

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

  async function loginWithBiometrics(isAutoPrompt = false) {
    if (!window.PublicKeyCredential) {
      if (!isAutoPrompt) showToast("Biometrics not available on this browser/context");
      return;
    }

    try {
      if (!isAutoPrompt) dom.authFeedback.textContent = "Requesting biometric challenge...";
      const optRes = await fetch('/api/auth/webauthn/login-options', { method: 'POST' });
      if (!optRes.ok) {
        if (!isAutoPrompt) {
          const err = await optRes.json();
          dom.authFeedback.textContent = err.detail || "No biometrics registered";
        }
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
      } else if (!isAutoPrompt) {
        dom.authFeedback.textContent = data.detail || "Biometric validation failed";
      }
    } catch (err) {
      if (!isAutoPrompt) dom.authFeedback.textContent = "Biometric prompt cancelled";
    }
  }

  dom.btnBiometricLogin.addEventListener('click', () => loginWithBiometrics(false));

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
      if (dom.cpuCircleFill) dom.cpuCircleFill.setAttribute('stroke-dasharray', `${cpu}, 100`);
      if (dom.cpuFill) dom.cpuFill.style.width = `${cpu}%`;
      if (dom.cpuVal) dom.cpuVal.textContent = `${cpu}%`;

      const ram = Math.round(data.memory.percent);
      if (dom.ramCircleFill) dom.ramCircleFill.setAttribute('stroke-dasharray', `${ram}, 100`);
      if (dom.ramFill) dom.ramFill.style.width = `${ram}%`;
      if (dom.ramVal) dom.ramVal.textContent = `${ram}%`;

      const bat = data.battery;
      dom.batteryVal.textContent = `${bat.percent}%`;
      dom.batteryIcon.textContent = bat.plugged ? '⚡' : '🔋';
      
      dom.toggleKeepawake.checked = !!data.keep_awake;
      if (dom.toggleBlackout && document.activeElement !== dom.toggleBlackout) {
        dom.toggleBlackout.checked = !!data.blackout;
      }
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
    if (!state.token) {
      handleSessionExpired();
      return;
    }
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
        quality: state.quality,
        subsampling: state.subsampling,
        delta_skip: state.delta_skip
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

    state.streamSocket.onclose = (event) => {
      dom.connectionStatus.classList.add('disconnected');
      
      // If server rejected token (1008 / Policy Violation), immediately expire session and show login
      if (event.code === 1008 || event.code === 4401) {
        handleSessionExpired();
        return;
      }

      // Reconnect only if we still have an authenticated session and not locked
      if (state.token && dom.authOverlay.classList.contains('hidden')) {
        dom.streamOverlay.classList.remove('hidden');
        dom.streamStatusText.textContent = "STREAM RECONNECTING...";
        if (!state.reconnectTimer) {
          state.reconnectTimer = setTimeout(() => {
            state.reconnectTimer = null;
            if (state.token && dom.authOverlay.classList.contains('hidden')) {
              initStreamWebSocket();
            }
          }, 2000);
        }
      }
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

    state.controlSocket.onclose = (event) => {
      if (event.code === 1008) {
        handleSessionExpired();
        return;
      }
      if (state.token && dom.authOverlay.classList.contains('hidden')) {
        setTimeout(initControlWebSocket, 500);
      }
    };

    state.controlSocket.onerror = (err) => {
      console.warn("Control WebSocket error:", err);
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
      if (distFromStart > 14) {
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

      if (state.zoomLocked) {
        // Locked mode: Flawless smooth 2-finger scrolling, pinch zoom completely disabled!
        isPinching = false;
        const curY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        const deltaY = curY - twoFingerStartY;
        if (Math.abs(deltaY) > 8) {
          const scrollAmount = deltaY > 0 ? 120 : -120;
          sendControl({ type: "mouse_scroll", dy: scrollAmount });
          twoFingerStartY = curY;
        }
      } else {
        // Unlocked mode (🔓): Pinch-to-zoom and pan active
        const curDist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        const distDelta = Math.abs(curDist - initialPinchDist);

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
          const curY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
          const deltaY = curY - twoFingerStartY;
          if (Math.abs(deltaY) > 8) {
            const scrollAmount = deltaY > 0 ? 120 : -120;
            sendControl({ type: "mouse_scroll", dy: scrollAmount });
            twoFingerStartY = curY;
          }
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

    if (!hasMovedSignificantly && duration < 320) {
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

      sendControl({
        type: "mouse_click",
        button: "left",
        modifiers: Array.from(state.stickyModifiers)
      });
      lastTapTime = Date.now();
    }
  });

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

  const btnUacYes = document.getElementById('btn-uac-yes');
  if (btnUacYes) {
    btnUacYes.addEventListener('click', () => {
      sendControl({ type: "uac_accept" });
      showToast("🛡️ Approved Administrator Permission (Alt+Y)");
    });
  }

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

  // ==============================================================================
  // STREAM PRESETS: ⚡ LOW LATENCY, 💎 QUALITY, & 🎛️ CUSTOM
  // ==============================================================================
  function applyStreamPreset(preset, notify = true) {
    state.streamPreset = preset;
    [dom.presetLow, dom.presetQuality, dom.presetCustom].forEach(b => {
      if (b) b.classList.remove('active');
    });

    if (preset === 'low') {
      if (dom.presetLow) dom.presetLow.classList.add('active');
      if (dom.customStreamControls) dom.customStreamControls.classList.add('hidden');
      state.scale = 0.50;
      state.quality = 42;
      state.fps = 30;
      state.subsampling = 2; // 4:2:0 fast subsampling
      state.delta_skip = true; // smart frame deduplication

      dom.scaleSlider.value = 0.50;
      dom.scaleLabel.textContent = "50%";
      dom.qualitySlider.value = 42;
      dom.qualityLabel.textContent = "42%";
      dom.fpsSlider.value = 30;
      dom.fpsLabel.textContent = "30 FPS";

      sendStreamConfig({
        scale: 0.50,
        quality: 42,
        fps: 30,
        subsampling: 2,
        delta_skip: true
      });
      if (notify) showToast("⚡ Low-Latency Active (30 FPS, Bandwidth Saver)");
    } else if (preset === 'quality') {
      if (dom.presetQuality) dom.presetQuality.classList.add('active');
      if (dom.customStreamControls) dom.customStreamControls.classList.add('hidden');
      state.scale = 1.0;
      state.quality = 85;
      state.fps = 20;
      state.subsampling = 0; // 4:4:4 crisp text edges
      state.delta_skip = false;

      dom.scaleSlider.value = 1.0;
      dom.scaleLabel.textContent = "100%";
      dom.qualitySlider.value = 85;
      dom.qualityLabel.textContent = "85%";
      dom.fpsSlider.value = 20;
      dom.fpsLabel.textContent = "20 FPS";

      sendStreamConfig({
        scale: 1.0,
        quality: 85,
        fps: 20,
        subsampling: 0,
        delta_skip: false
      });
      if (notify) showToast("💎 High-Quality Active (100% Scale, 4:4:4 Sharp Text)");
    } else if (preset === 'custom') {
      if (dom.presetCustom) dom.presetCustom.classList.add('active');
      if (dom.customStreamControls) dom.customStreamControls.classList.remove('hidden');
      sendStreamConfig({
        scale: state.scale,
        quality: state.quality,
        fps: state.fps,
        subsampling: state.subsampling,
        delta_skip: state.delta_skip
      });
      if (notify) showToast("🎛️ Custom Stream Tuning Active");
    }
  }

  if (dom.presetLow) dom.presetLow.addEventListener('click', () => applyStreamPreset('low'));
  if (dom.presetQuality) dom.presetQuality.addEventListener('click', () => applyStreamPreset('quality'));
  if (dom.presetCustom) dom.presetCustom.addEventListener('click', () => applyStreamPreset('custom'));

  // If user adjusts manual sliders while on a preset, auto-shift to custom
  [dom.scaleSlider, dom.qualitySlider, dom.fpsSlider].forEach(slider => {
    slider.addEventListener('input', () => {
      if (state.streamPreset !== 'custom') {
        state.streamPreset = 'custom';
        [dom.presetLow, dom.presetQuality, dom.presetCustom].forEach(b => {
          if (b) b.classList.remove('active');
        });
        if (dom.presetCustom) dom.presetCustom.classList.add('active');
        if (dom.customStreamControls) dom.customStreamControls.classList.remove('hidden');
      }
    });
  });

  // ==============================================================================
  // PUBG-STYLE FLOATING MOUSE TRIGGERS & CUSTOMIZABLE HUD EDITOR
  // ==============================================================================
  const DEFAULT_HUD_CONFIG = {
    visible: true,
    size: 100,
    opacity: 85,
    elements: {
      lclick: { left: 8, top: 62 },
      rclick: { left: 8, top: 48 },
      dblclick: { left: 8, top: 36 },
      scroll: { left: 88, top: 52 }
    }
  };

  // Load layout from localStorage
  try {
    const savedHud = localStorage.getItem('reni_custom_hud_v3');
    if (savedHud) {
      const parsed = JSON.parse(savedHud);
      state.hudConfig = {
        visible: parsed.visible !== undefined ? parsed.visible : true,
        size: parsed.size || 100,
        opacity: parsed.opacity || 85,
        elements: Object.assign({}, DEFAULT_HUD_CONFIG.elements, parsed.elements || {})
      };
    }
  } catch (err) {
    state.hudConfig = JSON.parse(JSON.stringify(DEFAULT_HUD_CONFIG));
  }

  function applyHudLayout() {
    if (!dom.hudTriggersLayer) return;

    dom.hudTriggersLayer.style.display = state.hudConfig.visible ? 'block' : 'none';
    dom.hudTriggersLayer.style.opacity = (state.hudConfig.opacity / 100).toString();

    const scaleFactor = state.hudConfig.size / 100;
    const elementsMap = {
      lclick: dom.hudTriggerLClick,
      rclick: dom.hudTriggerRClick,
      dblclick: dom.hudTriggerDblClick,
      scroll: dom.hudTriggerScroll
    };

    Object.keys(elementsMap).forEach(key => {
      const el = elementsMap[key];
      const pos = state.hudConfig.elements[key];
      if (el && pos) {
        el.style.left = `${pos.left}%`;
        el.style.top = `${pos.top}%`;
        el.style.transform = `scale(${scaleFactor})`;
      }
    });

    if (dom.toggleHudTriggers) dom.toggleHudTriggers.checked = state.hudConfig.visible;
    if (dom.hudVisibleToggle) dom.hudVisibleToggle.checked = state.hudConfig.visible;
    if (dom.hudSizeSlider) {
      dom.hudSizeSlider.value = state.hudConfig.size;
      dom.hudSizeVal.textContent = `${state.hudConfig.size}%`;
    }
    if (dom.hudOpacitySlider) {
      dom.hudOpacitySlider.value = state.hudConfig.opacity;
      dom.hudOpacityVal.textContent = `${state.hudConfig.opacity}%`;
    }
  }

  // Trigger Interactions (Hold-drag capable Left-click, Instant Right-click, 1-tap Double-click, Scroll)
  let lclickStartTime = 0;
  let lastLClickTapTime = 0;
  let isHudEditing = false;
  let draggingHudKey = null;

  function bindHudTriggerActions() {
    // L-CLICK: Tap (click), Double-tap (double-click), Hold (mouse_down) + Move on trackpad (drag)
    if (dom.hudTriggerLClick) {
      const handleDown = (e) => {
        if (isHudEditing) return;
        e.preventDefault();
        e.stopPropagation();
        lclickStartTime = Date.now();
        state.isHoldingLClick = true;
        dom.hudTriggerLClick.classList.add('active');
        sendControl({
          type: "mouse_down",
          button: "left",
          modifiers: Array.from(state.stickyModifiers)
        });
      };

      const handleUp = (e) => {
        if (isHudEditing) return;
        e.preventDefault();
        e.stopPropagation();
        state.isHoldingLClick = false;
        dom.hudTriggerLClick.classList.remove('active');
        sendControl({
          type: "mouse_up",
          button: "left",
          modifiers: Array.from(state.stickyModifiers)
        });

        const elapsed = Date.now() - lclickStartTime;
        const now = Date.now();
        if (elapsed < 280) {
          if (now - lastLClickTapTime < 320) {
            sendControl({
              type: "mouse_click",
              button: "left",
              double: true,
              modifiers: Array.from(state.stickyModifiers)
            });
            lastLClickTapTime = 0;
          } else {
            lastLClickTapTime = now;
          }
        }
      };

      dom.hudTriggerLClick.addEventListener('touchstart', handleDown, { passive: false });
      dom.hudTriggerLClick.addEventListener('touchend', handleUp, { passive: false });
      dom.hudTriggerLClick.addEventListener('mousedown', handleDown);
      dom.hudTriggerLClick.addEventListener('mouseup', handleUp);
    }

    // R-CLICK: Instant Right Click
    if (dom.hudTriggerRClick) {
      const handleRClick = (e) => {
        if (isHudEditing) return;
        e.preventDefault();
        e.stopPropagation();
        sendControl({
          type: "mouse_click",
          button: "right",
          modifiers: Array.from(state.stickyModifiers)
        });
        dom.hudTriggerRClick.classList.add('active');
        setTimeout(() => dom.hudTriggerRClick.classList.remove('active'), 120);
      };
      dom.hudTriggerRClick.addEventListener('touchstart', handleRClick, { passive: false });
      dom.hudTriggerRClick.addEventListener('click', handleRClick);
    }

    // DBL-CLK: Dedicated 1-Tap Double Click
    if (dom.hudTriggerDblClick) {
      const handleDblClick = (e) => {
        if (isHudEditing) return;
        e.preventDefault();
        e.stopPropagation();
        sendControl({
          type: "mouse_click",
          button: "left",
          double: true,
          modifiers: Array.from(state.stickyModifiers)
        });
        dom.hudTriggerDblClick.classList.add('active');
        setTimeout(() => dom.hudTriggerDblClick.classList.remove('active'), 120);
      };
      dom.hudTriggerDblClick.addEventListener('touchstart', handleDblClick, { passive: false });
      dom.hudTriggerDblClick.addEventListener('click', handleDblClick);
    }

    // SCROLL ▲ / ▼ ROCKER
    if (dom.hudScrollUp) {
      const handleScrollUp = (e) => {
        if (isHudEditing) return;
        e.preventDefault();
        e.stopPropagation();
        sendControl({ type: "mouse_scroll", dy: -120 });
      };
      dom.hudScrollUp.addEventListener('touchstart', handleScrollUp, { passive: false });
      dom.hudScrollUp.addEventListener('click', handleScrollUp);
    }

    if (dom.hudScrollDown) {
      const handleScrollDown = (e) => {
        if (isHudEditing) return;
        e.preventDefault();
        e.stopPropagation();
        sendControl({ type: "mouse_scroll", dy: 120 });
      };
      dom.hudScrollDown.addEventListener('touchstart', handleScrollDown, { passive: false });
      dom.hudScrollDown.addEventListener('click', handleScrollDown);
    }
  }

  // HUD Layout Customizer Drag & Drop Mode
  function enterHudEditMode() {
    isHudEditing = true;
    if (dom.hudEditorOverlay) dom.hudEditorOverlay.classList.remove('hidden');
    if (dom.hudTriggersLayer) {
      dom.hudTriggersLayer.classList.add('in-edit-mode');
      dom.hudTriggersLayer.style.display = 'block';
    }
    if (dom.settingsDrawer) dom.settingsDrawer.classList.remove('open');
    showToast("🎯 Drag triggers anywhere to customize layout");
  }

  function exitHudEditMode() {
    isHudEditing = false;
    if (dom.hudEditorOverlay) dom.hudEditorOverlay.classList.add('hidden');
    if (dom.hudTriggersLayer) {
      dom.hudTriggersLayer.classList.remove('in-edit-mode');
      dom.hudTriggersLayer.style.display = state.hudConfig.visible ? 'block' : 'none';
    }
  }

  function setupHudDragHandlers() {
    const triggerMap = {
      lclick: dom.hudTriggerLClick,
      rclick: dom.hudTriggerRClick,
      dblclick: dom.hudTriggerDblClick,
      scroll: dom.hudTriggerScroll
    };

    Object.keys(triggerMap).forEach(key => {
      const el = triggerMap[key];
      if (!el) return;

      const onStart = (e) => {
        if (!isHudEditing) return;
        e.preventDefault();
        e.stopPropagation();
        draggingHudKey = key;
        el.classList.add('selected');
      };

      el.addEventListener('touchstart', onStart, { passive: false });
      el.addEventListener('mousedown', onStart);
    });

    const onMove = (e) => {
      if (!isHudEditing || !draggingHudKey) return;
      e.preventDefault();

      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;

      const leftPct = Math.max(2, Math.min(94, (clientX / window.innerWidth) * 100));
      const topPct = Math.max(5, Math.min(94, (clientY / window.innerHeight) * 100));

      state.hudConfig.elements[draggingHudKey] = {
        left: Math.round(leftPct),
        top: Math.round(topPct)
      };
      applyHudLayout();
    };

    const onEnd = () => {
      if (draggingHudKey) {
        const el = triggerMap[draggingHudKey];
        if (el) el.classList.remove('selected');
        draggingHudKey = null;
      }
    };

    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('mousemove', onMove);
    window.addEventListener('touchend', onEnd);
    window.addEventListener('mouseup', onEnd);
  }

  // HUD Editor UI Controls
  if (dom.btnOpenHudEditor) dom.btnOpenHudEditor.addEventListener('click', enterHudEditMode);
  if (dom.btnHudClose) dom.btnHudClose.addEventListener('click', exitHudEditMode);

  if (dom.btnHudSave) {
    dom.btnHudSave.addEventListener('click', () => {
      try {
        localStorage.setItem('reni_custom_hud_v3', JSON.stringify(state.hudConfig));
        showToast("💾 Custom HUD Layout Saved");
      } catch (e) {}
      exitHudEditMode();
    });
  }

  if (dom.btnHudReset) {
    dom.btnHudReset.addEventListener('click', () => {
      state.hudConfig = JSON.parse(JSON.stringify(DEFAULT_HUD_CONFIG));
      applyHudLayout();
      try {
        localStorage.setItem('reni_custom_hud_v3', JSON.stringify(state.hudConfig));
      } catch (e) {}
      showToast("↺ Reset to Default Layout");
    });
  }

  if (dom.hudSizeSlider) {
    dom.hudSizeSlider.addEventListener('input', (e) => {
      state.hudConfig.size = parseInt(e.target.value);
      dom.hudSizeVal.textContent = `${state.hudConfig.size}%`;
      applyHudLayout();
    });
  }

  if (dom.hudOpacitySlider) {
    dom.hudOpacitySlider.addEventListener('input', (e) => {
      state.hudConfig.opacity = parseInt(e.target.value);
      dom.hudOpacityVal.textContent = `${state.hudConfig.opacity}%`;
      applyHudLayout();
    });
  }

  if (dom.hudVisibleToggle) {
    dom.hudVisibleToggle.addEventListener('change', (e) => {
      state.hudConfig.visible = e.target.checked;
      applyHudLayout();
    });
  }

  if (dom.toggleHudTriggers) {
    dom.toggleHudTriggers.addEventListener('change', (e) => {
      state.hudConfig.visible = e.target.checked;
      applyHudLayout();
      try {
        localStorage.setItem('reni_custom_hud_v3', JSON.stringify(state.hudConfig));
      } catch (e) {}
    });
  }

  bindHudTriggerActions();
  setupHudDragHandlers();
  applyHudLayout();

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

  // ==============================================================================
  // BIDIRECTIONAL CLIPBOARD SHARING (PHONE ⇄ PC)
  // ==============================================================================
  function updateClipCounter() {
    if (dom.clipCharCount && dom.clipboardTextarea) {
      dom.clipCharCount.textContent = `${dom.clipboardTextarea.value.length} chars`;
    }
  }

  if (dom.clipboardTextarea) {
    dom.clipboardTextarea.addEventListener('input', updateClipCounter);
  }

  async function fetchHostClipboard(notify = false) {
    if (!state.token) return '';
    try {
      const res = await fetch(`/api/clipboard?token=${encodeURIComponent(state.token)}`);
      const data = await res.json();
      const text = data.text || '';
      if (dom.clipboardTextarea) {
        dom.clipboardTextarea.value = text;
        updateClipCounter();
      }

      // Check if PC clipboard has a screenshot/image
      if (data.image && data.image.has_image) {
        renderClipboardImage(data.image.data_url, data.image.width, data.image.height, data.image.size_bytes);
      }

      if (notify) showToast(`Pulled ${text.length} chars from PC`);
      return text;
    } catch (err) {
      if (notify) showToast("Failed to read PC clipboard");
      return '';
    }
  }

  function renderClipboardImage(dataUrl, width, height, sizeBytes) {
    state.currentClipboardImage = dataUrl;
    if (dom.clipImgPreview) dom.clipImgPreview.src = dataUrl;
    if (dom.clipImgDims) dom.clipImgDims.textContent = `${width || ''} × ${height || ''} px`;
    if (dom.clipImgSize) dom.clipImgSize.textContent = sizeBytes ? `${Math.round(sizeBytes / 1024)} KB` : 'PNG Screenshot';
    if (dom.clipImgCard) dom.clipImgCard.classList.remove('hidden');
    if (dom.clipImgEmpty) dom.clipImgEmpty.classList.add('hidden');
  }

  function switchClipTab(tab) {
    if (tab === 'text') {
      if (dom.tabClipText) dom.tabClipText.classList.add('active');
      if (dom.tabClipImg) dom.tabClipImg.classList.remove('active');
      if (dom.clipPaneText) dom.clipPaneText.classList.remove('hidden');
      if (dom.clipPaneImg) dom.clipPaneImg.classList.add('hidden');
    } else {
      if (dom.tabClipImg) dom.tabClipImg.classList.add('active');
      if (dom.tabClipText) dom.tabClipText.classList.remove('active');
      if (dom.clipPaneImg) dom.clipPaneImg.classList.remove('hidden');
      if (dom.clipPaneText) dom.clipPaneText.classList.add('hidden');
    }
  }

  // 1. PC ➔ Phone: Read PC clipboard and copy directly into phone system clipboard
  async function copyPcToPhone() {
    showToast("Reading PC clipboard...", 1500);
    const text = await fetchHostClipboard(false);
    if (!text) {
      showToast("PC clipboard is empty");
      return;
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        showToast("Copied PC Clipboard to Phone! (Ready to paste anywhere)", 3500);
        return;
      } catch (err) {}
    }

    // Fallback: select textarea for easy manual copy
    if (dom.clipboardTextarea) {
      dom.clipboardTextarea.focus();
      dom.clipboardTextarea.select();
    }
    showToast("Fetched PC text — Tap 'Copy to Phone' button below", 3500);
  }

  // 2. Phone ➔ PC: Read phone system clipboard and push into PC clipboard
  async function sendPhoneToPc() {
    let text = '';
    if (navigator.clipboard && navigator.clipboard.readText) {
      try {
        text = await navigator.clipboard.readText();
      } catch (err) {}
    }

    if (!text && dom.clipboardTextarea) {
      text = dom.clipboardTextarea.value.trim();
    }

    if (!text) {
      showToast("Phone clipboard is empty. Type or paste text into the box first.");
      if (dom.clipboardTextarea) dom.clipboardTextarea.focus();
      return;
    }

    if (dom.clipboardTextarea) {
      dom.clipboardTextarea.value = text;
      updateClipCounter();
    }

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
      if (res.ok && data.success) {
        showToast(`Sent Phone Clipboard to PC! (${text.length} chars) 💻`, 3000);
      } else {
        showToast(data.detail || "Failed to push to PC");
      }
    } catch (err) {
      showToast("Error sending clipboard to PC");
    }
  }

  // 3. Instant Paste: Push to PC and simulate Ctrl+V into active PC window immediately
  async function pasteIntoPcActiveWindow() {
    let text = '';
    if (navigator.clipboard && navigator.clipboard.readText) {
      try {
        text = await navigator.clipboard.readText();
      } catch (err) {}
    }

    if (!text && dom.clipboardTextarea) {
      text = dom.clipboardTextarea.value.trim();
    }

    if (!text) {
      showToast("Nothing to paste. Copy text on phone or type in box first.");
      if (dom.clipboardTextarea) dom.clipboardTextarea.focus();
      return;
    }

    if (dom.clipboardTextarea) {
      dom.clipboardTextarea.value = text;
      updateClipCounter();
    }

    try {
      const res = await fetch('/api/clipboard', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${state.token}`
        },
        body: JSON.stringify({ text, paste_now: true })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showToast("⚡ Injected & Pasted into Active PC Window!", 3000);
        dom.clipboardModal.classList.add('hidden');
      } else {
        showToast(data.detail || "Injection failed");
      }
    } catch (err) {
      showToast("Failed to paste into PC");
    }
  }

  // 4. Capture Fresh PC Desktop Screenshot to Clipboard
  async function snapPcScreenshot() {
    showToast("Capturing PC desktop screenshot...", 2000);
    try {
      const res = await fetch('/api/clipboard/capture-screen', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${state.token}` }
      });
      const data = await res.json();
      if (res.ok && data.success && data.has_image) {
        renderClipboardImage(data.data_url, data.width, data.height);
        switchClipTab('img');
        showToast("Captured PC Desktop Screenshot! 📸", 3000);
      } else {
        showToast(data.detail || "Screenshot capture failed");
      }
    } catch (err) {
      showToast("Error capturing PC screenshot");
    }
  }

  // 5. Push Image/Screenshot to PC Clipboard
  async function pushImageToPc() {
    if (!state.currentClipboardImage) {
      showToast("No screenshot or image loaded to send");
      return;
    }
    showToast("Pushing screenshot to PC clipboard...", 1500);
    try {
      const res = await fetch('/api/clipboard', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${state.token}`
        },
        body: JSON.stringify({ image_data: state.currentClipboardImage })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showToast("Screenshot pushed to PC clipboard! 💻 Ready to Ctrl+V", 3500);
      } else {
        showToast(data.detail || "Failed to push screenshot");
      }
    } catch (err) {
      showToast("Error sending screenshot to PC");
    }
  }

  // 6. Paste Image into Active PC Window
  async function pasteImageIntoPcActiveWindow() {
    if (!state.currentClipboardImage) {
      showToast("No screenshot or image loaded to paste");
      return;
    }
    showToast("Pasting screenshot into PC active window...", 1500);
    try {
      const res = await fetch('/api/clipboard', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${state.token}`
        },
        body: JSON.stringify({ image_data: state.currentClipboardImage, paste_now: true })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showToast("⚡ Screenshot Pasted into PC Active Window!", 3500);
        dom.clipboardModal.classList.add('hidden');
      } else {
        showToast(data.detail || "Failed to paste screenshot");
      }
    } catch (err) {
      showToast("Error pasting screenshot into PC");
    }
  }

  // 7. Download Screenshot/Image to Phone
  function downloadImageToPhone() {
    if (!state.currentClipboardImage) {
      showToast("No image to download");
      return;
    }
    const a = document.createElement('a');
    a.href = state.currentClipboardImage;
    a.download = `reni_screenshot_${Date.now()}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    showToast("Downloading screenshot to phone...");
  }

  // 8. Copy Image to Phone Clipboard
  async function copyImageToPhoneClipboard() {
    if (!state.currentClipboardImage) {
      showToast("No image to copy");
      return;
    }
    try {
      const response = await fetch(state.currentClipboardImage);
      const blob = await response.blob();
      if (navigator.clipboard && navigator.clipboard.write) {
        await navigator.clipboard.write([
          new ClipboardItem({ 'image/png': blob })
        ]);
        showToast("Copied screenshot to Phone clipboard!");
      } else {
        downloadImageToPhone();
      }
    } catch (err) {
      downloadImageToPhone();
    }
  }

  // Event Listeners for Clipboard Modal & Triggers
  if (dom.btnClipboardOpen) {
    dom.btnClipboardOpen.addEventListener('click', () => {
      dom.clipboardModal.classList.remove('hidden');
      fetchHostClipboard(false);
    });
  }

  if (dom.btnSettingsOpenClip) {
    dom.btnSettingsOpenClip.addEventListener('click', () => {
      dom.settingsDrawer.classList.remove('open');
      dom.clipboardModal.classList.remove('hidden');
      fetchHostClipboard(false);
    });
  }

  if (dom.btnCloseClipboard) {
    dom.btnCloseClipboard.addEventListener('click', () => {
      dom.clipboardModal.classList.add('hidden');
    });
  }

  if (dom.tabClipText) dom.tabClipText.addEventListener('click', () => switchClipTab('text'));
  if (dom.tabClipImg) dom.tabClipImg.addEventListener('click', () => switchClipTab('img'));

  if (dom.btnClipPhoneToPc) {
    dom.btnClipPhoneToPc.addEventListener('click', sendPhoneToPc);
  }

  if (dom.btnClipPcToPhone) {
    dom.btnClipPcToPhone.addEventListener('click', copyPcToPhone);
  }

  if (dom.btnClipPasteActive) {
    dom.btnClipPasteActive.addEventListener('click', pasteIntoPcActiveWindow);
  }

  if (dom.btnClipSnapPc) {
    dom.btnClipSnapPc.addEventListener('click', snapPcScreenshot);
  }

  if (dom.btnClipPickImg && dom.clipFileInput) {
    dom.btnClipPickImg.addEventListener('click', () => dom.clipFileInput.click());
    dom.clipFileInput.addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (event) => {
        const dataUrl = event.target.result;
        const img = new Image();
        img.onload = () => {
          renderClipboardImage(dataUrl, img.width, img.height, file.size);
          switchClipTab('img');
          showToast("Loaded phone image into preview! 🖼️");
        };
        img.src = dataUrl;
      };
      reader.readAsDataURL(file);
    });
  }

  if (dom.btnClipPushImg) dom.btnClipPushImg.addEventListener('click', pushImageToPc);
  if (dom.btnClipPasteImgActive) dom.btnClipPasteImgActive.addEventListener('click', pasteImageIntoPcActiveWindow);
  if (dom.btnClipDownloadImg) dom.btnClipDownloadImg.addEventListener('click', downloadImageToPhone);
  if (dom.btnClipCopyImg) dom.btnClipCopyImg.addEventListener('click', copyImageToPhoneClipboard);

  if (dom.btnClipCopyLocal) {
    dom.btnClipCopyLocal.addEventListener('click', async () => {
      const text = dom.clipboardTextarea ? dom.clipboardTextarea.value : '';
      if (!text) {
        showToast("Text box is empty");
        return;
      }
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(text);
          showToast("Copied to Phone Clipboard!");
        } else {
          dom.clipboardTextarea.select();
          document.execCommand('copy');
          showToast("Copied to Phone Clipboard!");
        }
      } catch (err) {
        dom.clipboardTextarea.select();
        document.execCommand('copy');
        showToast("Copied to Phone Clipboard!");
      }
    });
  }

  if (dom.btnClipPushCustom) {
    dom.btnClipPushCustom.addEventListener('click', async () => {
      const text = dom.clipboardTextarea ? dom.clipboardTextarea.value : '';
      if (!text) {
        showToast("Text box is empty");
        return;
      }
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
        if (res.ok && data.success) {
          showToast("Pushed text to PC Clipboard 🖥️");
        } else {
          showToast(data.detail || "Failed to push");
        }
      } catch (err) {
        showToast("Failed to push to PC");
      }
    });
  }

  if (dom.btnClipClear) {
    dom.btnClipClear.addEventListener('click', () => {
      if (dom.clipboardTextarea) {
        dom.clipboardTextarea.value = '';
        updateClipCounter();
        showToast("Cleared clipboard box");
      }
    });
  }

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
    handleSessionExpired();
  });

  function handleSessionExpired() {
    state.token = '';
    localStorage.removeItem('reni_jwt_token');
    if (state.streamSocket) {
      try { state.streamSocket.close(); } catch(e){}
      state.streamSocket = null;
    }
    if (state.controlSocket) {
      try { state.controlSocket.close(); } catch(e){}
      state.controlSocket = null;
    }
    if (state.terminalSocket) {
      try { state.terminalSocket.close(); } catch(e){}
      state.terminalSocket = null;
    }
    if (state.telemetryTimer) clearInterval(state.telemetryTimer);
    if (state.reconnectTimer) clearTimeout(state.reconnectTimer);

    dom.authOverlay.classList.remove('hidden');
    dom.streamOverlay.classList.add('hidden');
    state.enteredPin = '';
    updatePinDisplay();
  }

  // ==============================================================================
  // SESSION INITIALIZATION
  // ==============================================================================
  function initializeSession() {
    initStreamWebSocket();
    initControlWebSocket();
    startTelemetryPolling();
  }

  // Boot check & automatic biometric prompt
  if (state.token) {
    // Validate existing token
    fetch(`/api/system/telemetry?token=${encodeURIComponent(state.token)}`)
      .then(res => {
        if (res.ok) {
          // On fresh visit, lock app and prompt for fingerprint
          lockAppSession();
          setTimeout(() => loginWithBiometrics(true), 350);
        } else {
          handleSessionExpired();
          setTimeout(() => loginWithBiometrics(true), 350);
        }
      })
      .catch(() => {
        lockAppSession();
        setTimeout(() => loginWithBiometrics(true), 350);
      });
  } else {
    dom.authOverlay.classList.remove('hidden');
    setTimeout(() => loginWithBiometrics(true), 350);
  }

  // Service Worker Registration
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    });
  }

})();
