const refs = {
  screenshot: document.getElementById('screenshot'),
  selection: document.getElementById('selection'),
  modeLabel: document.getElementById('mode-label')
};

const state = {
  sessionId: null,
  displayId: null,
  mode: 'choose',
  dragging: false,
  startPoint: null
};

function modeText(mode) {
  switch (mode) {
    case 'pin':
      return '截图并贴图';
    case 'copy':
      return '截图并复制';
    default:
      return '框选截图';
  }
}

function normalizeRect(start, end) {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y)
  };
}

function updateSelection(rect) {
  refs.selection.classList.remove('hidden');
  refs.selection.style.left = `${rect.x}px`;
  refs.selection.style.top = `${rect.y}px`;
  refs.selection.style.width = `${rect.width}px`;
  refs.selection.style.height = `${rect.height}px`;
}

function viewportPoint(event) {
  return {
    x: Math.max(0, Math.min(window.innerWidth, event.clientX)),
    y: Math.max(0, Math.min(window.innerHeight, event.clientY))
  };
}

window.pinshot.onCaptureInit((payload) => {
  state.sessionId = payload.sessionId;
  state.displayId = payload.display.id;
  state.mode = payload.mode;
  refs.modeLabel.textContent = modeText(payload.mode);
  refs.screenshot.src = payload.imageDataUrl;
});

window.addEventListener('mousedown', (event) => {
  if (!state.sessionId || event.button !== 0) {
    return;
  }

  state.dragging = true;
  state.startPoint = viewportPoint(event);
  updateSelection({ ...state.startPoint, width: 0, height: 0 });
});

window.addEventListener('mousemove', (event) => {
  if (!state.dragging || !state.startPoint) {
    return;
  }

  updateSelection(normalizeRect(state.startPoint, viewportPoint(event)));
});

window.addEventListener('mouseup', async (event) => {
  if (!state.dragging || event.button !== 0) {
    return;
  }

  state.dragging = false;
  const rect = normalizeRect(state.startPoint, viewportPoint(event));

  if (rect.width < 8 || rect.height < 8) {
    refs.selection.classList.add('hidden');
    return;
  }

  await window.pinshot.commitCapture({
    sessionId: state.sessionId,
    displayId: state.displayId,
    rect,
    mode: state.mode
  });
});

window.addEventListener('keydown', async (event) => {
  if (event.key === 'Escape' && state.sessionId) {
    await window.pinshot.cancelCapture(state.sessionId);
  }
});

window.addEventListener('contextmenu', (event) => {
  event.preventDefault();
});
