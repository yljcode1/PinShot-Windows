const path = require('path');
const fs = require('fs');
const {
  app,
  BrowserWindow,
  Menu,
  Tray,
  ipcMain,
  globalShortcut,
  desktopCapturer,
  screen,
  dialog,
  clipboard,
  nativeImage
} = require('electron');
const translate = require('@vitalets/google-translate-api');
const Tesseract = require('tesseract.js');
const store = require('./store');

let tray = null;
let settingsWindow = null;
let captureSessions = new Map();
let pinWindows = new Map();

const APP_NAME = 'PinShot';

function createTrayImage() {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
      <defs>
        <linearGradient id="g" x1="0%" x2="100%" y1="0%" y2="100%">
          <stop offset="0%" stop-color="#34a8ff"/>
          <stop offset="100%" stop-color="#1de0c3"/>
        </linearGradient>
      </defs>
      <rect x="8" y="8" width="48" height="48" rx="16" fill="#0d1723"/>
      <path d="M20 21h17c7 0 11 4 11 10 0 7-5 11-12 11H28v9h-8V21Zm8 14h8c3 0 5-2 5-4 0-2-2-4-5-4h-8v8Z" fill="url(#g)"/>
    </svg>
  `;

  return nativeImage
    .createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`)
    .resize({ width: 16, height: 16 });
}

function resolveRenderer(file) {
  return path.join(__dirname, 'renderer', file);
}

function createWindow(urlFile, options = {}) {
  const win = new BrowserWindow({
    show: false,
    backgroundColor: '#10151b',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    ...options
  });

  win.loadFile(resolveRenderer(urlFile));
  return win;
}

function acceleratorLabel(accelerator) {
  return accelerator
    .replaceAll('CommandOrControl', process.platform === 'win32' ? 'Ctrl' : 'Cmd')
    .replaceAll('+', ' + ');
}

function buildSettingsState() {
  return {
    hotkey: store.getHotkey(),
    hotkeyLabel: acceleratorLabel(store.getHotkey()),
    launchAtLogin: store.getLaunchAtLogin(),
    history: store.getHistory().map((item) => ({
      id: item.id,
      title: item.title,
      createdAt: item.createdAt,
      sizeLabel: item.sizeLabel
    }))
  };
}

function notifySettingsState() {
  if (!settingsWindow || settingsWindow.isDestroyed()) {
    return;
  }

  settingsWindow.webContents.send('settings:state', buildSettingsState());
  updateTray();
}

function createSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show();
    settingsWindow.focus();
    return settingsWindow;
  }

  settingsWindow = createWindow('index.html', {
    width: 980,
    height: 720,
    title: APP_NAME,
    autoHideMenuBar: true
  });

  settingsWindow.once('ready-to-show', () => {
    settingsWindow.show();
    notifySettingsState();
  });

  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });

  return settingsWindow;
}

function applyLaunchAtLogin() {
  app.setLoginItemSettings({
    openAtLogin: store.getLaunchAtLogin()
  });
}

function updateTray() {
  if (!tray) {
    return;
  }

  const historyItems = store.getHistory().slice(0, 6);

  const menu = Menu.buildFromTemplate([
    {
      label: 'Capture Area',
      click: () => startCapture('choose')
    },
    {
      label: 'Capture & Pin',
      click: () => startCapture('pin')
    },
    {
      label: 'Capture & Copy',
      click: () => startCapture('copy')
    },
    { type: 'separator' },
    {
      label: `Hotkey: ${acceleratorLabel(store.getHotkey())}`,
      enabled: false
    },
    {
      label: 'Launch at Login',
      type: 'checkbox',
      checked: store.getLaunchAtLogin(),
      click: (item) => {
        store.setLaunchAtLogin(item.checked);
        applyLaunchAtLogin();
        notifySettingsState();
      }
    },
    { type: 'separator' },
    {
      label: 'Open Settings',
      click: () => createSettingsWindow()
    },
    {
      label: 'Recent Pins',
      submenu: historyItems.length
        ? historyItems.map((item) => ({
            label: item.title,
            click: () => reopenHistory(item.id)
          }))
        : [{ label: 'No recent captures', enabled: false }]
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setContextMenu(menu);
  tray.setToolTip(APP_NAME);
}

function createTray() {
  if (tray) {
    return tray;
  }

  tray = new Tray(createTrayImage());
  tray.on('click', () => createSettingsWindow());
  updateTray();
  return tray;
}

function unregisterHotkey() {
  globalShortcut.unregisterAll();
}

function registerHotkey() {
  unregisterHotkey();
  const hotkey = store.getHotkey();
  const ok = globalShortcut.register(hotkey, () => {
    startCapture('choose');
  });

  if (!ok) {
    return false;
  }

  return true;
}

async function getDisplaySources() {
  const displays = screen.getAllDisplays();
  const maxWidth = Math.max(...displays.map((display) => Math.round(display.bounds.width * display.scaleFactor)));
  const maxHeight = Math.max(...displays.map((display) => Math.round(display.bounds.height * display.scaleFactor)));
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: {
      width: maxWidth,
      height: maxHeight
    },
    fetchWindowIcons: false
  });

  const sourceMap = new Map();
  for (const source of sources) {
    sourceMap.set(String(source.display_id), source);
  }

  return displays.map((display, index) => {
    const source = sourceMap.get(String(display.id)) ?? sources[index];
    return {
      display,
      source,
      sourceSize: source.thumbnail.getSize()
    };
  });
}

function closeCaptureSession(sessionId) {
  const session = captureSessions.get(sessionId);
  if (!session) {
    return;
  }

  for (const win of session.windows) {
    if (!win.isDestroyed()) {
      win.close();
    }
  }

  captureSessions.delete(sessionId);
}

function createCaptureOverlay(sessionId, displayEntry, mode) {
  const { display, source, sourceSize } = displayEntry;
  const overlay = createWindow('capture.html', {
    x: display.bounds.x,
    y: display.bounds.y,
    width: display.bounds.width,
    height: display.bounds.height,
    frame: false,
    transparent: false,
    resizable: false,
    movable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false
  });

  overlay.setAlwaysOnTop(true, 'screen-saver');
  overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  overlay.once('ready-to-show', () => {
    overlay.show();
    overlay.focus();
    overlay.webContents.send('capture:init', {
      sessionId,
      mode,
      display: {
        id: display.id,
        bounds: display.bounds,
        scaleFactor: display.scaleFactor
      },
      imageDataUrl: source.thumbnail.toDataURL(),
      sourceSize
    });
  });

  overlay.on('closed', () => {
    const session = captureSessions.get(sessionId);
    if (!session) {
      return;
    }
    session.windows = session.windows.filter((item) => item !== overlay);
    if (!session.windows.length) {
      captureSessions.delete(sessionId);
    }
  });

  return overlay;
}

async function startCapture(mode) {
  const existingSession = [...captureSessions.keys()][0];
  if (existingSession) {
    closeCaptureSession(existingSession);
  }

  const sessionId = crypto.randomUUID();
  const sources = await getDisplaySources();
  const windows = sources.map((entry) => createCaptureOverlay(sessionId, entry, mode));

  captureSessions.set(sessionId, {
    id: sessionId,
    mode,
    windows,
    displays: sources
  });
}

function clampRect(rect, maxWidth, maxHeight) {
  const x = Math.max(0, Math.min(rect.x, maxWidth - 1));
  const y = Math.max(0, Math.min(rect.y, maxHeight - 1));
  const width = Math.max(1, Math.min(rect.width, maxWidth - x));
  const height = Math.max(1, Math.min(rect.height, maxHeight - y));
  return { x, y, width, height };
}

function buildHistoryEntry(pin) {
  return {
    id: pin.id,
    imageDataUrl: pin.imageDataUrl,
    originalWidth: pin.originalWidth,
    originalHeight: pin.originalHeight,
    title: `${new Date(pin.createdAt).toLocaleTimeString()} · ${pin.originalWidth} × ${pin.originalHeight}`,
    sizeLabel: `${pin.originalWidth} × ${pin.originalHeight}`,
    createdAt: pin.createdAt
  };
}

function copyImageDataUrl(dataUrl) {
  clipboard.writeImage(nativeImage.createFromDataURL(dataUrl));
}

async function saveImageDataUrl(dataUrl, defaultName = `PinShot-${Date.now()}.png`) {
  const { canceled, filePath } = await dialog.showSaveDialog({
    defaultPath: defaultName,
    filters: [{ name: 'PNG Image', extensions: ['png'] }]
  });

  if (canceled || !filePath) {
    return false;
  }

  const pngBuffer = nativeImage.createFromDataURL(dataUrl).toPNG();
  fs.writeFileSync(filePath, pngBuffer);
  return true;
}

function dataUrlToBuffer(dataUrl) {
  const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, '');
  return Buffer.from(base64, 'base64');
}

function createPinWindow(pin) {
  const win = createWindow('pin.html', {
    x: Math.round(pin.bounds.x),
    y: Math.round(pin.bounds.y),
    width: Math.max(140, Math.round(pin.bounds.width)),
    height: Math.max(100, Math.round(pin.bounds.height)),
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false
  });

  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  pin.window = win;
  pinWindows.set(pin.id, pin);

  win.once('ready-to-show', () => {
    win.show();
    win.webContents.send('pin:init', {
      id: pin.id,
      imageDataUrl: pin.imageDataUrl,
      originalWidth: pin.originalWidth,
      originalHeight: pin.originalHeight,
      mode: pin.mode,
      bounds: pin.bounds
    });
  });

  win.on('focus', () => {
    if (!win.isDestroyed()) {
      win.webContents.send('pin:selected', true);
    }
  });

  win.on('blur', () => {
    if (!win.isDestroyed()) {
      win.webContents.send('pin:selected', false);
    }
  });

  win.on('closed', () => {
    stopPinDrag(pin);
    pinWindows.delete(pin.id);
    updateTray();
  });

  store.upsertHistory(buildHistoryEntry(pin));
  updateTray();
  notifySettingsState();
  return pin;
}

function reopenHistory(id) {
  const item = store.getHistory().find((entry) => entry.id === id);
  if (!item) {
    return false;
  }

  createPinWindow({
    id: crypto.randomUUID(),
    imageDataUrl: item.imageDataUrl,
    originalWidth: item.originalWidth,
    originalHeight: item.originalHeight,
    mode: 'pin',
    bounds: {
      x: 120,
      y: 120,
      width: item.originalWidth,
      height: item.originalHeight
    },
    createdAt: Date.now()
  });
  return true;
}

async function finishCapture({ sessionId, displayId, rect, mode }) {
  const session = captureSessions.get(sessionId);
  if (!session) {
    return { ok: false, message: 'Capture session expired' };
  }

  const entry = session.displays.find((item) => String(item.display.id) === String(displayId));
  closeCaptureSession(sessionId);

  if (!entry) {
    return { ok: false, message: 'Display not found' };
  }

  const { display, source, sourceSize } = entry;
  const scaleX = sourceSize.width / display.bounds.width;
  const scaleY = sourceSize.height / display.bounds.height;
  const cropRect = clampRect({
    x: Math.round(rect.x * scaleX),
    y: Math.round(rect.y * scaleY),
    width: Math.round(rect.width * scaleX),
    height: Math.round(rect.height * scaleY)
  }, sourceSize.width, sourceSize.height);

  const image = source.thumbnail.crop(cropRect);
  const imageDataUrl = image.toDataURL();

  if (mode === 'copy') {
    copyImageDataUrl(imageDataUrl);
    return { ok: true, copied: true };
  }

  createPinWindow({
    id: crypto.randomUUID(),
    imageDataUrl,
    originalWidth: cropRect.width,
    originalHeight: cropRect.height,
    mode,
    bounds: {
      x: display.bounds.x + rect.x,
      y: display.bounds.y + rect.y,
      width: rect.width,
      height: rect.height
    },
    createdAt: Date.now()
  });

  return { ok: true };
}

function ensurePin(pinId) {
  return pinWindows.get(pinId);
}

function stopPinDrag(pin) {
  if (!pin?.dragInterval) {
    return;
  }

  clearInterval(pin.dragInterval);
  pin.dragInterval = null;
  pin.dragOffset = null;
}

function snapWindowBounds(bounds) {
  const display = screen.getDisplayMatching(bounds);
  const area = display.workArea;
  const threshold = 18;
  const snapped = { ...bounds };

  if (Math.abs(bounds.x - area.x) <= threshold) {
    snapped.x = area.x;
  }

  if (Math.abs(bounds.y - area.y) <= threshold) {
    snapped.y = area.y;
  }

  const rightGap = Math.abs((bounds.x + bounds.width) - (area.x + area.width));
  if (rightGap <= threshold) {
    snapped.x = area.x + area.width - bounds.width;
  }

  const bottomGap = Math.abs((bounds.y + bounds.height) - (area.y + area.height));
  if (bottomGap <= threshold) {
    snapped.y = area.y + area.height - bounds.height;
  }

  return snapped;
}

function startPinDrag(pinId, cursor) {
  const pin = ensurePin(pinId);
  if (!pin?.window || pin.window.isDestroyed()) {
    return false;
  }

  stopPinDrag(pin);

  const bounds = pin.window.getBounds();
  pin.dragOffset = {
    x: Math.round(cursor.x - bounds.x),
    y: Math.round(cursor.y - bounds.y)
  };

  pin.dragInterval = setInterval(() => {
    if (!pin.window || pin.window.isDestroyed() || !pin.dragOffset) {
      stopPinDrag(pin);
      return;
    }

    const point = screen.getCursorScreenPoint();
    pin.window.setBounds(snapWindowBounds({
      ...pin.window.getBounds(),
      x: Math.round(point.x - pin.dragOffset.x),
      y: Math.round(point.y - pin.dragOffset.y)
    }));
  }, 8);

  return true;
}

function movePin(pinId, delta) {
  const pin = ensurePin(pinId);
  if (!pin?.window || pin.window.isDestroyed()) {
    return false;
  }

  const bounds = pin.window.getBounds();
  pin.window.setBounds(snapWindowBounds({
    ...bounds,
    x: Math.round(bounds.x + delta.x),
    y: Math.round(bounds.y + delta.y)
  }));
  return true;
}

function resizePin(pinId, size) {
  const pin = ensurePin(pinId);
  if (!pin?.window || pin.window.isDestroyed()) {
    return false;
  }

  const bounds = pin.window.getBounds();
  pin.window.setBounds({
    ...bounds,
    width: Math.max(140, Math.round(size.width)),
    height: Math.max(100, Math.round(size.height))
  });
  return true;
}

function focusPin(pinId) {
  const pin = ensurePin(pinId);
  if (!pin?.window || pin.window.isDestroyed()) {
    return false;
  }

  pin.window.show();
  pin.window.focus();
  pin.window.moveTop();
  return true;
}

function closePin(pinId) {
  const pin = ensurePin(pinId);
  if (!pin?.window || pin.window.isDestroyed()) {
    return false;
  }
  pin.window.close();
  return true;
}

function installIpc() {
  ipcMain.handle('settings:get-state', () => buildSettingsState());

  ipcMain.handle('settings:start-capture', async (_event, mode) => {
    await startCapture(mode);
    return { ok: true };
  });

  ipcMain.handle('settings:set-hotkey', (_event, hotkey) => {
    const previous = store.getHotkey();
    try {
      unregisterHotkey();
      const ok = globalShortcut.register(hotkey, () => startCapture('choose'));
      if (!ok) {
        throw new Error('Shortcut registration failed');
      }
      globalShortcut.unregister(hotkey);
      store.setHotkey(hotkey);
      registerHotkey();
      notifySettingsState();
      return { ok: true, label: acceleratorLabel(hotkey) };
    } catch (error) {
      store.setHotkey(previous);
      registerHotkey();
      return { ok: false, message: error.message };
    }
  });

  ipcMain.handle('settings:set-launch-at-login', (_event, enabled) => {
    store.setLaunchAtLogin(enabled);
    applyLaunchAtLogin();
    notifySettingsState();
    return { ok: true };
  });

  ipcMain.handle('settings:reopen-history', (_event, id) => ({ ok: reopenHistory(id) }));
  ipcMain.handle('settings:clear-history', () => {
    store.clearHistory();
    updateTray();
    notifySettingsState();
    return { ok: true };
  });

  ipcMain.handle('capture:commit', async (_event, payload) => finishCapture(payload));
  ipcMain.handle('capture:cancel', (_event, sessionId) => {
    closeCaptureSession(sessionId);
    return { ok: true };
  });

  ipcMain.handle('pin:move', (_event, pinId, delta) => ({ ok: movePin(pinId, delta) }));
  ipcMain.handle('pin:start-drag', (_event, pinId, cursor) => ({ ok: startPinDrag(pinId, cursor) }));
  ipcMain.handle('pin:stop-drag', (_event, pinId) => {
    const pin = ensurePin(pinId);
    if (!pin) {
      return { ok: false };
    }

    stopPinDrag(pin);
    return { ok: true };
  });
  ipcMain.handle('pin:resize', (_event, pinId, size) => ({ ok: resizePin(pinId, size) }));
  ipcMain.handle('pin:focus', (_event, pinId) => ({ ok: focusPin(pinId) }));
  ipcMain.handle('pin:close', (_event, pinId) => ({ ok: closePin(pinId) }));
  ipcMain.handle('pin:copy-image', (_event, _pinId, dataUrl) => {
    copyImageDataUrl(dataUrl);
    return { ok: true };
  });
  ipcMain.handle('pin:save-image', async (_event, _pinId, dataUrl) => {
    const saved = await saveImageDataUrl(dataUrl);
    return { ok: saved };
  });
  ipcMain.handle('pin:update-history', (_event, entry) => {
    store.upsertHistory(entry);
    updateTray();
    notifySettingsState();
    return { ok: true };
  });
  ipcMain.handle('pin:copy-text', (_event, text) => {
    clipboard.writeText(text ?? '');
    return { ok: true };
  });
  ipcMain.handle('ocr:recognize', async (_event, imageDataUrl) => {
    const result = await Tesseract.recognize(
      dataUrlToBuffer(imageDataUrl),
      'eng+chi_sim',
      {
        logger: () => {}
      }
    );

    return {
      ok: true,
      text: result.data.text ?? '',
      words: (result.data.words ?? []).map((word) => ({
        text: word.text,
        confidence: word.confidence,
        bbox: word.bbox
      }))
    };
  });
  ipcMain.handle('translate:text', async (_event, text, targetLanguage) => {
    const result = await translate(text, { to: targetLanguage });
    return { ok: true, text: result.text };
  });
}

app.whenReady().then(() => {
  app.setAppUserModelId('com.pinshot.windows');
  createTray();
  createSettingsWindow();
  applyLaunchAtLogin();
  registerHotkey();
  installIpc();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createSettingsWindow();
  }
});

app.on('window-all-closed', (event) => {
  if (!app.isQuitting) {
    event.preventDefault();
  }
});

app.on('will-quit', () => {
  unregisterHotkey();
});
