const refs = {
  root: document.getElementById('pin-root'),
  surface: document.getElementById('surface'),
  visualLayer: document.getElementById('visual-layer'),
  baseImage: document.getElementById('base-image'),
  annotationCanvas: document.getElementById('annotation-canvas'),
  textCanvas: document.getElementById('text-canvas'),
  toolbar: document.getElementById('toolbar'),
  chooser: document.getElementById('chooser'),
  inspector: document.getElementById('inspector'),
  toast: document.getElementById('toast'),
  ocrText: document.getElementById('ocr-text'),
  translatedText: document.getElementById('translated-text'),
  translationGroup: document.getElementById('translation-group'),
  translationLabel: document.getElementById('translation-label'),
  opacitySlider: document.getElementById('opacity-slider'),
  opacityLabel: document.getElementById('opacity-label'),
  closeInspector: document.getElementById('close-inspector'),
  copyText: document.getElementById('copy-text'),
  translateText: document.getElementById('translate-text')
};

const state = {
  id: null,
  mode: 'pin',
  selected: false,
  originalWidth: 0,
  originalHeight: 0,
  zoom: 1,
  opacity: 0.96,
  tool: 'none',
  color: '#ef3b34',
  annotations: [],
  draft: null,
  draggingPin: null,
  pointerDown: null,
  showToolbar: false,
  showChooser: false,
  showInspector: false,
  toastTimer: null,
  ocrText: 'Recognizing text...',
  ocrWords: [],
  translatedText: '',
  translationLabel: '',
  imageDataUrl: '',
  imageElement: new Image()
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function showToast(message) {
  clearTimeout(state.toastTimer);
  refs.toast.textContent = message;
  refs.toast.classList.remove('hidden');
  state.toastTimer = setTimeout(() => {
    refs.toast.classList.add('hidden');
  }, 1800);
}

function setSurfaceOpacity() {
  refs.visualLayer.style.opacity = String(state.opacity);
  refs.opacityLabel.textContent = `${Math.round(state.opacity * 100)}%`;
}

function currentScale() {
  return refs.surface.clientWidth / state.originalWidth;
}

function syncCanvasSize() {
  const rect = refs.surface.getBoundingClientRect();
  for (const canvas of [refs.annotationCanvas, refs.textCanvas]) {
    canvas.width = Math.max(1, Math.round(rect.width));
    canvas.height = Math.max(1, Math.round(rect.height));
  }
  render();
}

function imagePointFromEvent(event) {
  const rect = refs.surface.getBoundingClientRect();
  return {
    x: clamp(((event.clientX - rect.left) / rect.width) * state.originalWidth, 0, state.originalWidth),
    y: clamp(((event.clientY - rect.top) / rect.height) * state.originalHeight, 0, state.originalHeight)
  };
}

function toCanvasRect(rect, scale) {
  return {
    x: rect.x * scale,
    y: rect.y * scale,
    width: rect.width * scale,
    height: rect.height * scale
  };
}

function normalizeRect(start, end) {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y)
  };
}

function intersects(a, b) {
  return a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y;
}

function wordRect(word) {
  return {
    x: word.bbox.x0,
    y: word.bbox.y0,
    width: word.bbox.x1 - word.bbox.x0,
    height: word.bbox.y1 - word.bbox.y0
  };
}

function renderToolbarState() {
  refs.toolbar.classList.toggle('hidden', !state.showToolbar);
  refs.chooser.classList.toggle('hidden', !state.showChooser);
  refs.inspector.classList.toggle('hidden', !state.showInspector);

  document.querySelectorAll('[data-tool]').forEach((button) => {
    button.classList.toggle('active', button.dataset.tool === state.tool);
  });

  document.querySelectorAll('[data-color]').forEach((button) => {
    button.classList.toggle('active', button.dataset.color === state.color);
  });

  refs.ocrText.textContent = state.ocrText || 'No text recognized.';
  refs.translatedText.textContent = state.translatedText || 'Translated text will appear here.';
  refs.translationLabel.textContent = state.translationLabel || 'Translation';
  refs.translationGroup.classList.toggle('hidden', !state.translatedText);
  refs.translateText.disabled = !state.ocrText || state.ocrText === 'Recognizing text...';
}

function drawArrow(ctx, start, end) {
  const angle = Math.atan2(end.y - start.y, end.x - start.x);
  const size = 12;
  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  ctx.lineTo(end.x, end.y);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(end.x, end.y);
  ctx.lineTo(end.x - size * Math.cos(angle - Math.PI / 6), end.y - size * Math.sin(angle - Math.PI / 6));
  ctx.lineTo(end.x - size * Math.cos(angle + Math.PI / 6), end.y - size * Math.sin(angle + Math.PI / 6));
  ctx.closePath();
  ctx.fill();
}

function drawMosaic(ctx, rect, scale) {
  const canvasRect = toCanvasRect(rect, scale);
  const temp = document.createElement('canvas');
  temp.width = Math.max(1, Math.round(canvasRect.width / 12));
  temp.height = Math.max(1, Math.round(canvasRect.height / 12));
  const tempCtx = temp.getContext('2d');
  tempCtx.imageSmoothingEnabled = false;
  tempCtx.drawImage(
    state.imageElement,
    rect.x,
    rect.y,
    rect.width,
    rect.height,
    0,
    0,
    temp.width,
    temp.height
  );

  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(temp, 0, 0, temp.width, temp.height, canvasRect.x, canvasRect.y, canvasRect.width, canvasRect.height);
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = 1;
  ctx.strokeRect(canvasRect.x, canvasRect.y, canvasRect.width, canvasRect.height);
  ctx.restore();
}

function drawAnnotation(ctx, annotation, scale) {
  ctx.save();
  ctx.strokeStyle = annotation.color;
  ctx.fillStyle = annotation.color;
  ctx.lineWidth = annotation.lineWidth * scale;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  switch (annotation.type) {
    case 'freehand':
      if (annotation.points.length < 2) {
        break;
      }
      ctx.beginPath();
      annotation.points.forEach((point, index) => {
        const x = point.x * scale;
        const y = point.y * scale;
        if (index === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      });
      ctx.stroke();
      break;
    case 'rectangle': {
      const rect = toCanvasRect(annotation.rect, scale);
      ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
      break;
    }
    case 'arrow':
      drawArrow(ctx, {
        x: annotation.start.x * scale,
        y: annotation.start.y * scale
      }, {
        x: annotation.end.x * scale,
        y: annotation.end.y * scale
      });
      break;
    case 'text':
      ctx.font = `${Math.max(16, 22 * scale)}px "Segoe UI", "Microsoft YaHei UI", sans-serif`;
      ctx.fillText(annotation.text, annotation.origin.x * scale, annotation.origin.y * scale);
      break;
    case 'mosaic':
      drawMosaic(ctx, annotation.rect, scale);
      break;
    default:
      break;
  }

  ctx.restore();
}

function renderAnnotations() {
  const ctx = refs.annotationCanvas.getContext('2d');
  const scale = currentScale();
  ctx.clearRect(0, 0, refs.annotationCanvas.width, refs.annotationCanvas.height);

  for (const annotation of state.annotations) {
    drawAnnotation(ctx, annotation, scale);
  }

  if (state.draft) {
    drawAnnotation(ctx, state.draft, scale);
  }
}

function renderTextOverlay() {
  const ctx = refs.textCanvas.getContext('2d');
  const scale = currentScale();
  ctx.clearRect(0, 0, refs.textCanvas.width, refs.textCanvas.height);

  if (state.tool === 'selectText') {
    ctx.save();
    for (const word of state.ocrWords) {
      const rect = toCanvasRect(wordRect(word), scale);
      ctx.fillStyle = 'rgba(80, 172, 255, 0.08)';
      ctx.strokeStyle = 'rgba(80, 172, 255, 0.22)';
      ctx.lineWidth = 1;
      ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
      ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
    }

    if (state.pointerDown?.selectionRect) {
      const rect = toCanvasRect(state.pointerDown.selectionRect, scale);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.92)';
      ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
      ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    }
    ctx.restore();
  }
}

function render() {
  renderAnnotations();
  renderTextOverlay();
  renderToolbarState();
  refs.surface.classList.toggle('selected', state.selected);
}

function setTool(tool) {
  state.tool = tool;
  if (tool !== 'none') {
    state.showToolbar = true;
  }

  const messages = {
    none: 'Normal mode: drag the pin or toggle the toolbar.',
    selectText: 'OCR selection mode: drag to select words inside the image.',
    pen: 'Pen mode: draw directly on the pin.',
    rectangle: 'Rectangle mode: drag to highlight an area.',
    arrow: 'Arrow mode: drag to point at content.',
    text: 'Text mode: click where you want to place text.',
    mosaic: 'Mosaic mode: drag to pixelate sensitive regions.'
  };

  showToast(messages[tool] || 'Tool changed.');
  render();
}

function annotationColor() {
  return state.color;
}

function lineWidth() {
  return 3;
}

function exportAnnotatedImage() {
  const canvas = document.createElement('canvas');
  canvas.width = state.originalWidth;
  canvas.height = state.originalHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(state.imageElement, 0, 0, state.originalWidth, state.originalHeight);

  for (const annotation of state.annotations) {
    drawAnnotation(ctx, annotation, 1);
  }

  return canvas.toDataURL('image/png');
}

async function handleCopy(closeAfter = false) {
  const image = exportAnnotatedImage();
  await window.pinshot.copyImage(state.id, image);
  showToast('Copied to clipboard.');
  if (closeAfter) {
    setTimeout(() => void window.pinshot.closePin(state.id), 120);
  }
}

async function handleSave() {
  const image = exportAnnotatedImage();
  const result = await window.pinshot.saveImage(state.id, image);
  showToast(result.ok ? 'Image saved.' : 'Save canceled.');
}

async function runOCR() {
  try {
    state.ocrText = 'Recognizing text...';
    render();
    const result = await window.pinshot.recognizeText(state.imageDataUrl);
    state.ocrText = (result.text || '').trim() || 'No text recognized.';
    state.ocrWords = result.words || [];
    render();
  } catch (error) {
    console.error(error);
    state.ocrText = 'OCR failed.';
    render();
  }
}

function detectTranslationTarget(text) {
  const hasChinese = /[\u3400-\u9fff]/.test(text);
  return hasChinese
    ? { target: 'en', label: 'Chinese -> English' }
    : { target: 'zh-CN', label: 'Auto -> Chinese (Simplified)' };
}

async function handleTranslate() {
  const text = state.ocrText?.trim();
  if (!text || text === 'Recognizing text...' || text === 'No text recognized.' || text === 'OCR failed.') {
    showToast('No OCR text to translate.');
    return;
  }

  const target = detectTranslationTarget(text);
  refs.translateText.disabled = true;
  refs.translateText.textContent = 'Translating...';

  try {
    const result = await window.pinshot.translateText(text, target.target);
    state.translatedText = result.text || '';
    state.translationLabel = target.label;
    state.showInspector = true;
    render();
    showToast('Translation complete.');
  } catch (error) {
    console.error(error);
    showToast('Translation failed.');
  } finally {
    refs.translateText.disabled = false;
    refs.translateText.textContent = 'Translate';
  }
}

async function copySelectedWords(rect) {
  const words = state.ocrWords
    .filter((word) => intersects(wordRect(word), rect))
    .sort((a, b) => {
      if (Math.abs(a.bbox.y0 - b.bbox.y0) > 10) {
        return a.bbox.y0 - b.bbox.y0;
      }
      return a.bbox.x0 - b.bbox.x0;
    });

  const text = words.map((word) => word.text).join(' ').trim();
  if (!text) {
    showToast('No OCR words selected.');
    return;
  }

  await window.pinshot.copyText(text);
  state.showInspector = true;
  showToast('Selected OCR text copied.');
}

function handleToolbarAction(action) {
  switch (action) {
    case 'toggle-inspector':
      state.showInspector = !state.showInspector;
      render();
      break;
    case 'undo':
      state.annotations.pop();
      render();
      break;
    case 'clear':
      state.annotations = [];
      render();
      break;
    case 'copy':
      void handleCopy(false);
      break;
    case 'save':
      void handleSave();
      break;
    case 'close':
      void window.pinshot.closePin(state.id);
      break;
    default:
      break;
  }
}

function handleChooserAction(action) {
  switch (action) {
    case 'quick-edit':
      state.showChooser = false;
      state.showToolbar = true;
      setTool('none');
      render();
      break;
    case 'pin':
      state.showChooser = false;
      state.showToolbar = false;
      render();
      break;
    case 'copy':
      void handleCopy(true);
      break;
    default:
      break;
  }
}

async function handlePointerDown(event) {
  await window.pinshot.focusPin(state.id);
  state.selected = true;
  render();

  const point = imagePointFromEvent(event);
  state.pointerDown = {
    point,
    startScreenX: event.screenX,
    startScreenY: event.screenY,
    lastScreenX: event.screenX,
    lastScreenY: event.screenY,
    moved: false,
    selectionRect: null
  };

  if (state.tool === 'pen') {
    state.draft = {
      type: 'freehand',
      points: [point],
      color: annotationColor(),
      lineWidth: lineWidth()
    };
  } else if (state.tool === 'rectangle') {
    state.draft = {
      type: 'rectangle',
      rect: { x: point.x, y: point.y, width: 0, height: 0 },
      color: annotationColor(),
      lineWidth: lineWidth()
    };
  } else if (state.tool === 'arrow') {
    state.draft = {
      type: 'arrow',
      start: point,
      end: point,
      color: annotationColor(),
      lineWidth: lineWidth()
    };
  } else if (state.tool === 'mosaic') {
    state.draft = {
      type: 'mosaic',
      rect: { x: point.x, y: point.y, width: 0, height: 0 },
      color: annotationColor(),
      lineWidth: lineWidth()
    };
  }

  render();
}

function handlePointerMove(event) {
  if (!state.pointerDown) {
    return;
  }

  const point = imagePointFromEvent(event);
  const deltaX = event.screenX - state.pointerDown.lastScreenX;
  const deltaY = event.screenY - state.pointerDown.lastScreenY;

  if (state.tool === 'none') {
    if (Math.abs(deltaX) > 0 || Math.abs(deltaY) > 0) {
      state.pointerDown.moved = true;
      void window.pinshot.movePin(state.id, { x: deltaX, y: deltaY });
      state.pointerDown.lastScreenX = event.screenX;
      state.pointerDown.lastScreenY = event.screenY;
    }
  } else if (state.tool === 'pen' && state.draft) {
    state.draft.points.push(point);
  } else if ((state.tool === 'rectangle' || state.tool === 'mosaic') && state.draft) {
    state.draft.rect = normalizeRect(state.pointerDown.point, point);
  } else if (state.tool === 'arrow' && state.draft) {
    state.draft.end = point;
  } else if (state.tool === 'selectText') {
    state.pointerDown.selectionRect = normalizeRect(state.pointerDown.point, point);
  }

  render();
}

function finishDraft() {
  if (!state.draft) {
    return;
  }

  if (state.draft.type === 'rectangle' || state.draft.type === 'mosaic') {
    if (state.draft.rect.width < 4 || state.draft.rect.height < 4) {
      state.draft = null;
      render();
      return;
    }
  }

  if (state.draft.type === 'arrow') {
    const width = Math.abs(state.draft.end.x - state.draft.start.x);
    const height = Math.abs(state.draft.end.y - state.draft.start.y);
    if (width < 4 && height < 4) {
      state.draft = null;
      render();
      return;
    }
  }

  state.annotations.push(state.draft);
  state.draft = null;
  render();
}

async function handlePointerUp() {
  if (!state.pointerDown) {
    return;
  }

  if (state.tool === 'none' && !state.pointerDown.moved) {
    state.showToolbar = !state.showToolbar;
  } else if (state.tool === 'text') {
    const text = window.prompt('Text to place on the pin');
    if (text) {
      state.annotations.push({
        type: 'text',
        text,
        origin: state.pointerDown.point,
        color: annotationColor(),
        lineWidth: lineWidth()
      });
    }
  } else if (state.tool === 'selectText' && state.pointerDown.selectionRect) {
    await copySelectedWords(state.pointerDown.selectionRect);
  } else if (state.tool !== 'none') {
    finishDraft();
  }

  state.pointerDown = null;
  state.draft = null;
  render();
}

function handleWheel(event) {
  if (!event.ctrlKey && !event.metaKey) {
    return;
  }

  event.preventDefault();
  const factor = event.deltaY > 0 ? 0.92 : 1.08;
  state.zoom = clamp(state.zoom * factor, 0.24, 4);
  void window.pinshot.resizePin(state.id, {
    width: state.originalWidth * state.zoom,
    height: state.originalHeight * state.zoom
  });
  showToast(`Zoom ${Math.round(state.zoom * 100)}%`);
}

function updateHistory() {
  return window.pinshot.updateHistory({
    id: state.id,
    imageDataUrl: state.imageDataUrl,
    originalWidth: state.originalWidth,
    originalHeight: state.originalHeight,
    title: `${new Date().toLocaleTimeString()} · ${state.originalWidth}×${state.originalHeight}`,
    sizeLabel: `${state.originalWidth} × ${state.originalHeight}`,
    createdAt: Date.now()
  });
}

function bindEvents() {
  refs.surface.addEventListener('pointerdown', (event) => void handlePointerDown(event));
  window.addEventListener('pointermove', handlePointerMove);
  window.addEventListener('pointerup', () => void handlePointerUp());
  window.addEventListener('wheel', handleWheel, { passive: false });
  window.addEventListener('resize', syncCanvasSize);
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if (state.tool !== 'none') {
        setTool('none');
        return;
      }
      state.showToolbar = false;
      state.showInspector = false;
      render();
    }

    if ((event.key === 'Delete' || event.key === 'Backspace') && state.annotations.length) {
      state.annotations.pop();
      render();
    }
  });

  refs.toolbar.addEventListener('click', (event) => {
    const target = event.target.closest('button');
    if (!target) {
      return;
    }

    if (target.dataset.tool) {
      setTool(target.dataset.tool);
      return;
    }

    if (target.dataset.color) {
      state.color = target.dataset.color;
      render();
      return;
    }

    if (target.dataset.action) {
      handleToolbarAction(target.dataset.action);
    }
  });

  refs.chooser.addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (button?.dataset.chooser) {
      handleChooserAction(button.dataset.chooser);
    }
  });

  refs.closeInspector.addEventListener('click', () => {
    state.showInspector = false;
    render();
  });

  refs.copyText.addEventListener('click', async () => {
    await window.pinshot.copyText(state.ocrText);
    showToast('OCR text copied.');
  });

  refs.translateText.addEventListener('click', () => void handleTranslate());

  refs.opacitySlider.addEventListener('input', () => {
    state.opacity = Number(refs.opacitySlider.value) / 100;
    setSurfaceOpacity();
  });
}

window.pinshot.onPinSelected((selected) => {
  state.selected = selected;
  render();
});

window.pinshot.onPinInit(async (payload) => {
  state.id = payload.id;
  state.mode = payload.mode;
  state.originalWidth = payload.originalWidth;
  state.originalHeight = payload.originalHeight;
  state.imageDataUrl = payload.imageDataUrl;
  state.showChooser = payload.mode === 'choose';
  state.showToolbar = false;
  refs.opacitySlider.value = String(Math.round(state.opacity * 100));
  setSurfaceOpacity();
  refs.baseImage.src = payload.imageDataUrl;
  state.imageElement.src = payload.imageDataUrl;

  state.imageElement.onload = () => {
    syncCanvasSize();
    render();
  };

  await updateHistory();
  void runOCR();
});

bindEvents();
