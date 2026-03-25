const Store = require('electron-store').default;

const store = new Store({
  defaults: {
    hotkey: 'CommandOrControl+Shift+2',
    launchAtLogin: true,
    history: []
  }
});

function getHotkey() {
  return store.get('hotkey');
}

function setHotkey(hotkey) {
  store.set('hotkey', hotkey);
}

function getLaunchAtLogin() {
  return Boolean(store.get('launchAtLogin'));
}

function setLaunchAtLogin(enabled) {
  store.set('launchAtLogin', Boolean(enabled));
}

function getHistory() {
  return store.get('history', []);
}

function upsertHistory(entry) {
  const history = getHistory().filter((item) => item.id !== entry.id);
  history.unshift(entry);
  store.set('history', history.slice(0, 12));
}

function removeHistory(id) {
  const history = getHistory().filter((item) => item.id !== id);
  store.set('history', history);
}

function clearHistory() {
  store.set('history', []);
}

module.exports = {
  getHotkey,
  setHotkey,
  getLaunchAtLogin,
  setLaunchAtLogin,
  getHistory,
  upsertHistory,
  removeHistory,
  clearHistory
};
