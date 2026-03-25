const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pinshot', {
  getSettingsState: () => ipcRenderer.invoke('settings:get-state'),
  onSettingsState: (callback) => {
    ipcRenderer.on('settings:state', (_event, payload) => callback(payload));
  },
  startCapture: (mode) => ipcRenderer.invoke('settings:start-capture', mode),
  setHotkey: (hotkey) => ipcRenderer.invoke('settings:set-hotkey', hotkey),
  setLaunchAtLogin: (enabled) => ipcRenderer.invoke('settings:set-launch-at-login', enabled),
  reopenHistory: (id) => ipcRenderer.invoke('settings:reopen-history', id),
  clearHistory: () => ipcRenderer.invoke('settings:clear-history'),

  onCaptureInit: (callback) => {
    ipcRenderer.on('capture:init', (_event, payload) => callback(payload));
  },
  commitCapture: (payload) => ipcRenderer.invoke('capture:commit', payload),
  cancelCapture: (sessionId) => ipcRenderer.invoke('capture:cancel', sessionId),

  onPinInit: (callback) => {
    ipcRenderer.on('pin:init', (_event, payload) => callback(payload));
  },
  onPinSelected: (callback) => {
    ipcRenderer.on('pin:selected', (_event, selected) => callback(selected));
  },
  movePin: (pinId, delta) => ipcRenderer.invoke('pin:move', pinId, delta),
  resizePin: (pinId, size) => ipcRenderer.invoke('pin:resize', pinId, size),
  focusPin: (pinId) => ipcRenderer.invoke('pin:focus', pinId),
  closePin: (pinId) => ipcRenderer.invoke('pin:close', pinId),
  copyImage: (pinId, dataUrl) => ipcRenderer.invoke('pin:copy-image', pinId, dataUrl),
  saveImage: (pinId, dataUrl) => ipcRenderer.invoke('pin:save-image', pinId, dataUrl),
  updateHistory: (entry) => ipcRenderer.invoke('pin:update-history', entry),
  copyText: (text) => ipcRenderer.invoke('pin:copy-text', text),
  recognizeText: (imageDataUrl) => ipcRenderer.invoke('ocr:recognize', imageDataUrl),
  translateText: (text, targetLanguage) => ipcRenderer.invoke('translate:text', text, targetLanguage)
});
