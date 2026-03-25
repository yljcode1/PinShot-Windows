const refs = {
  hotkeyInput: document.getElementById('hotkey-input'),
  hotkeyPill: document.getElementById('hotkey-pill'),
  saveHotkey: document.getElementById('save-hotkey'),
  launchToggle: document.getElementById('launch-toggle'),
  historyList: document.getElementById('history-list'),
  clearHistory: document.getElementById('clear-history'),
  status: document.getElementById('status'),
  captureButtons: [...document.querySelectorAll('[data-capture]')]
};

function setStatus(text, isError = false) {
  refs.status.textContent = text;
  refs.status.style.color = isError ? '#ff8f8f' : '#9ac7ea';
}

function renderHistory(history) {
  refs.historyList.innerHTML = '';

  if (!history.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = '还没有最近截图，先试试上面的快捷操作。';
    refs.historyList.appendChild(empty);
    return;
  }

  for (const item of history) {
    const row = document.createElement('div');
    row.className = 'history-item';
    row.innerHTML = `
      <div>
        <strong>${item.title}</strong>
        <small>${item.sizeLabel}</small>
      </div>
      <button type="button">打开</button>
    `;
    row.querySelector('button').addEventListener('click', async () => {
      await window.pinshot.reopenHistory(item.id);
      setStatus('已重新打开该贴图。');
    });
    refs.historyList.appendChild(row);
  }
}

function hydrate(state) {
  refs.hotkeyInput.value = state.hotkey;
  refs.hotkeyPill.textContent = state.hotkeyLabel;
  refs.launchToggle.checked = state.launchAtLogin;
  renderHistory(state.history);
}

async function bootstrap() {
  const state = await window.pinshot.getSettingsState();
  hydrate(state);
}

refs.captureButtons.forEach((button) => {
  button.addEventListener('click', async () => {
    const mode = button.dataset.capture;
    await window.pinshot.startCapture(mode);
    setStatus(`已开始：${button.dataset.label || button.textContent.trim()}。`);
  });
});

refs.saveHotkey.addEventListener('click', async () => {
  const value = refs.hotkeyInput.value.trim();
  if (!value) {
    setStatus('请输入有效的快捷键。', true);
    return;
  }

  const result = await window.pinshot.setHotkey(value);
  if (!result.ok) {
    setStatus(result.message || '保存快捷键失败。', true);
    return;
  }

  refs.hotkeyPill.textContent = result.label;
  setStatus(`快捷键已更新为 ${result.label}。`);
});

refs.launchToggle.addEventListener('change', async () => {
  await window.pinshot.setLaunchAtLogin(refs.launchToggle.checked);
  setStatus(refs.launchToggle.checked ? '已开启开机启动。' : '已关闭开机启动。');
});

refs.clearHistory.addEventListener('click', async () => {
  await window.pinshot.clearHistory();
  renderHistory([]);
  setStatus('历史记录已清空。');
});

window.pinshot.onSettingsState((state) => {
  hydrate(state);
});

bootstrap().catch((error) => {
  console.error(error);
  setStatus(error.message || '加载设置失败。', true);
});
