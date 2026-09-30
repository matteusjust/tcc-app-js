(function () {
  "use strict";

  const MAX_DIM = 4096;

  const els = {
    dropzone: document.getElementById('dropzone'),
    fileInput: document.getElementById('fileInput'),
    regenBtn: document.getElementById('regenBtn'),
    gallery: document.getElementById('gallery'),
    sigmaRange: document.getElementById('sigmaRange'),
    sigmaValue: document.getElementById('sigmaValue'),
    thresholdRange: document.getElementById('thresholdRange'),
    thresholdValue: document.getElementById('thresholdValue'),
    runsRange: document.getElementById('runsRange'),
    runsValue: document.getElementById('runsValue'),
    runBtn: document.getElementById('runBtn'),
    statusNote: document.getElementById('statusNote'),
    resultsGrid: document.getElementById('resultsGrid'),
    resultsTableBody: document.getElementById('resultsTableBody'),
  };

  const STAGES = [
    { key: 'original', label: 'Original', dotColor: 'var(--ink-faint)' },
    { key: 'gray', label: 'Escala de cinza', dotColor: '#6B7A8A' },
    { key: 'blur', label: 'Desfoque gaussiano', dotColor: '#3E7CB8' },
    { key: 'sobel', label: 'Sobel (bordas)', dotColor: 'var(--accent)' },
  ];

  const state = {
    images: [],        
    busy: false,
  };


  function toGrayscale(imageData) {
    const { width: w, height: h, data: src } = imageData;
    const out = new Uint8ClampedArray(src.length);
    for (let i = 0; i < src.length; i += 4) {
      const y = 0.299 * src[i] + 0.587 * src[i + 1] + 0.114 * src[i + 2];
      out[i] = y; out[i + 1] = y; out[i + 2] = y; out[i + 3] = src[i + 3];
    }
    return new ImageData(out, w, h);
  }

  function gaussianKernel1D(sigma, radius) {
    const size = radius * 2 + 1;
    const kernel = new Float32Array(size);
    let sum = 0;
    for (let i = -radius; i <= radius; i++) {
      const v = Math.exp(-(i * i) / (2 * sigma * sigma));
      kernel[i + radius] = v;
      sum += v;
    }
    for (let i = 0; i < size; i++) kernel[i] /= sum;
    return kernel;
  }

  function gaussianBlur(imageData, sigma) {
    const radius = Math.min(24, Math.max(1, Math.round(sigma * 3)));
    const kernel = gaussianKernel1D(sigma, radius);
    const { width: w, height: h, data: src } = imageData;
    const tmp = new Float32Array(w * h * 4);

    for (let y = 0; y < h; y++) {
      const rowBase = y * w;
      for (let x = 0; x < w; x++) {
        let r = 0, g = 0, b = 0, a = 0;
        for (let k = -radius; k <= radius; k++) {
          let xx = x + k;
          if (xx < 0) xx = 0; else if (xx >= w) xx = w - 1;
          const idx = (rowBase + xx) * 4;
          const wgt = kernel[k + radius];
          r += src[idx] * wgt; g += src[idx + 1] * wgt; b += src[idx + 2] * wgt; a += src[idx + 3] * wgt;
        }
        const oidx = (rowBase + x) * 4;
        tmp[oidx] = r; tmp[oidx + 1] = g; tmp[oidx + 2] = b; tmp[oidx + 3] = a;
      }
    }

    const out = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let r = 0, g = 0, b = 0, a = 0;
        for (let k = -radius; k <= radius; k++) {
          let yy = y + k;
          if (yy < 0) yy = 0; else if (yy >= h) yy = h - 1;
          const idx = (yy * w + x) * 4;
          const wgt = kernel[k + radius];
          r += tmp[idx] * wgt; g += tmp[idx + 1] * wgt; b += tmp[idx + 2] * wgt; a += tmp[idx + 3] * wgt;
        }
        const oidx = (y * w + x) * 4;
        out[oidx] = r; out[oidx + 1] = g; out[oidx + 2] = b; out[oidx + 3] = a;
      }
    }
    return new ImageData(out, w, h);
  }

  const SOBEL_GX = [-1, 0, 1, -2, 0, 2, -1, 0, 1];
  const SOBEL_GY = [-1, -2, -1, 0, 0, 0, 1, 2, 1];

  function sobelEdges(imageData, threshold) {
    const { width: w, height: h, data: src } = imageData;
    const gray = new Float32Array(w * h);
    for (let i = 0, p = 0; i < src.length; i += 4, p++) {
      gray[p] = 0.299 * src[i] + 0.587 * src[i + 1] + 0.114 * src[i + 2];
    }
    const out = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let sx = 0, sy = 0, k = 0;
        for (let j = -1; j <= 1; j++) {
          let yy = y + j;
          if (yy < 0) yy = 0; else if (yy >= h) yy = h - 1;
          for (let i = -1; i <= 1; i++) {
            let xx = x + i;
            if (xx < 0) xx = 0; else if (xx >= w) xx = w - 1;
            const v = gray[yy * w + xx];
            sx += v * SOBEL_GX[k]; sy += v * SOBEL_GY[k]; k++;
          }
        }
        let mag = Math.sqrt(sx * sx + sy * sy);
        if (threshold > 0) mag = mag >= threshold ? 255 : 0;
        const idx = (y * w + x) * 4;
        out[idx] = mag; out[idx + 1] = mag; out[idx + 2] = mag; out[idx + 3] = 255;
      }
    }
    return new ImageData(out, w, h);
  }


  function stats(times) {
    const n = times.length;
    const avg = times.reduce((a, b) => a + b, 0) / n;
    const min = Math.min(...times);
    const max = Math.max(...times);
    const variance = times.reduce((a, b) => a + (b - avg) ** 2, 0) / n;
    return { avg, min, max, std: Math.sqrt(variance), n };
  }

  function benchmark(fn, imageData, args, runs) {
    const times = [];
    let result = null;
    for (let i = 0; i < runs; i++) {
      const t0 = performance.now();
      result = fn(imageData, ...args);
      const t1 = performance.now();
      times.push(t1 - t0);
    }
    return { result, ...stats(times) };
  }

  const fmt = (n) => (n < 0.005 ? '< 0.01' : n.toFixed(2));

  function generateSampleImage(w, h, seed) {
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    let s = seed;
    const rand = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return (s / 0x7fffffff); };

    const grad = ctx.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, `hsl(${Math.floor(rand() * 360)}, 45%, 88%)`);
    grad.addColorStop(1, `hsl(${Math.floor(rand() * 360)}, 55%, 62%)`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    const shapes = 6 + Math.floor(rand() * 4);
    for (let i = 0; i < shapes; i++) {
      ctx.fillStyle = `hsla(${Math.floor(rand() * 360)}, 70%, ${30 + rand() * 35}%, 0.85)`;
      const cx = rand() * w, cy = rand() * h, r = 20 + rand() * (Math.min(w, h) * 0.18);
      const kind = Math.floor(rand() * 3);
      ctx.beginPath();
      if (kind === 0) {
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
      } else if (kind === 1) {
        ctx.rect(cx - r, cy - r * 0.6, r * 2, r * 1.2);
      } else {
        ctx.moveTo(cx, cy - r);
        ctx.lineTo(cx + r, cy + r);
        ctx.lineTo(cx - r, cy + r);
        ctx.closePath();
      }
      ctx.fill();
    }

    ctx.strokeStyle = 'rgba(20,20,25,0.25)';
    ctx.lineWidth = 1.5;
    const spacing = Math.max(24, Math.round(w / 20));
    for (let x = spacing; x < w; x += spacing) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    }

    const imgData = ctx.getImageData(0, 0, w, h);
    const d = imgData.data;
    for (let i = 0; i < d.length; i += 4) {
      const n = (rand() - 0.5) * 22;
      d[i] = Math.min(255, Math.max(0, d[i] + n));
      d[i + 1] = Math.min(255, Math.max(0, d[i + 1] + n));
      d[i + 2] = Math.min(255, Math.max(0, d[i + 2] + n));
    }
    ctx.putImageData(imgData, 0, 0);

    ctx.fillStyle = 'rgba(15,15,20,0.55)';
    ctx.font = `600 ${Math.round(h * 0.09)}px "IBM Plex Mono", monospace`;
    ctx.fillText('TEST', w * 0.06, h * 0.92);

    return canvas;
  }

  function addImage(source, name, w, h) {
    const thumbCanvas = document.createElement('canvas');
    const tw = 96, th = 96;
    thumbCanvas.width = tw; thumbCanvas.height = th;
    const tctx = thumbCanvas.getContext('2d');
    const scale = Math.max(tw / w, th / h);
    const sw = tw / scale, sh = th / scale;
    tctx.drawImage(source, (w - sw) / 2, (h - sh) / 2, sw, sh, 0, 0, tw, th);

    const entry = {
      id: 'img_' + Math.random().toString(36).slice(2, 10),
      name, source, width: w, height: h,
      thumbUrl: thumbCanvas.toDataURL('image/png'),
    };
    state.images.push(entry);
    state.selectedId = entry.id;
    renderGallery();
    renderOriginal();
    clearResults();
  }

  function loadFile(file) {
    if (!file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => addImage(img, file.name, img.naturalWidth, img.naturalHeight);
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }


  function buildGrid() {
    els.resultsGrid.innerHTML = '';
    STAGES.forEach((stage, i) => {
      const card = document.createElement('div');
      card.className = 'card';
      card.innerHTML = `
        <div class="card-head">
          <h3>${stage.label}</h3>
          <span class="step-num">${i === 0 ? 'entrada' : '0' + i}</span>
        </div>
        <div class="card-canvas-wrap" id="wrap-${stage.key}">
          <span class="placeholder">Nenhuma imagem processada ainda</span>
        </div>
        <div class="card-foot">
          <span id="dims-${stage.key}">—</span>
          <span class="time-badge idle" id="time-${stage.key}">${i === 0 ? '' : 'não processado'}</span>
        </div>
      `;
      els.resultsGrid.appendChild(card);
    });
  }

  function paintStage(key, imageData) {
    const wrap = document.getElementById('wrap-' + key);
    wrap.innerHTML = '';
    const canvas = document.createElement('canvas');
    canvas.width = imageData.width;
    canvas.height = imageData.height;
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', key + ' resultado do processamento, ' + imageData.width + ' por ' + imageData.height + ' pixels');
    canvas.getContext('2d').putImageData(imageData, 0, 0);
    wrap.appendChild(canvas);
    document.getElementById('dims-' + key).textContent = imageData.width + ' × ' + imageData.height + ' px';
  }

  function renderOriginal() {
    const img = getSelected();
    if (!img) return;
    buildGrid();
    const canvas = document.createElement('canvas');
    canvas.width = img.width; canvas.height = img.height;
    canvas.getContext('2d').drawImage(img.source, 0, 0, img.width, img.height);
    const wrap = document.getElementById('wrap-original');
    wrap.innerHTML = '';
    wrap.appendChild(canvas);
    document.getElementById('dims-original').textContent = img.width + ' × ' + img.height + ' px';
    document.getElementById('time-original').textContent = img.name;
    document.getElementById('time-original').classList.add('idle');
  }

  function renderGallery() {
    els.gallery.innerHTML = '';
    state.images.forEach((img) => {
      const btn = document.createElement('button');
      btn.className = 'thumb' + (img.id === state.selectedId ? ' active' : '');
      btn.type = 'button';
      btn.setAttribute('aria-label', 'Selecionar ' + img.name);
      btn.innerHTML = `<img src="${img.thumbUrl}" alt=""><span class="thumb-tag">${img.width}×${img.height}</span>`;
      btn.addEventListener('click', () => {
        state.selectedId = img.id;
        renderGallery();
        renderOriginal();
        clearResults();
      });
      els.gallery.appendChild(btn);
    });
  }

  function clearResults() {
    els.resultsTableBody.innerHTML = '<tr class="empty-row"><td colspan="6">Clique em “Processar imagem” para medir os três algoritmos.</td></tr>';
    ['gray', 'blur', 'sobel'].forEach((key) => {
      const wrap = document.getElementById('wrap-' + key);
      if (wrap) wrap.innerHTML = '<span class="placeholder">Nenhuma imagem processada ainda</span>';
      const t = document.getElementById('time-' + key);
      if (t) { t.textContent = 'não processado'; t.classList.add('idle'); }
      const d = document.getElementById('dims-' + key);
      if (d) d.textContent = '—';
    });
  }

  function getSelected() {
    return state.images.find((i) => i.id === state.selectedId) || null;
  }

  function setStatus(text, busy) {
    els.statusNote.innerHTML = (busy ? '<span class="dot"></span>' : '') + text;
    els.statusNote.classList.toggle('busy', !!busy);
  }

  function getScaledImageData(img) {
    let { width: w, height: h } = img;
    if (Math.max(w, h) > MAX_DIM) {
      const scale = MAX_DIM / Math.max(w, h);
      w = Math.round(w * scale); h = Math.round(h * scale);
    }
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img.source, 0, 0, w, h);
    return ctx.getImageData(0, 0, w, h);
  }

  function addTableRow(label, dotColor, s) {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td><span class="algo-name"><span class="algo-dot" style="background:${dotColor}"></span>${label}</span></td>
      <td class="num">${fmt(s.avg)}</td>
      <td class="num">${fmt(s.min)}</td>
      <td class="num">${fmt(s.max)}</td>
      <td class="num">${fmt(s.std)}</td>
      <td class="num">${s.n}</td>
    `;
    els.resultsTableBody.appendChild(row);
  }

  function yieldFrame() {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }

  async function runPipeline() {
    const img = getSelected();
    if (!img || state.busy) return;
    state.busy = true;
    els.runBtn.disabled = true;
    els.resultsTableBody.innerHTML = '';

    const runs = parseInt(els.runsRange.value, 10);
    const sigma = parseFloat(els.sigmaRange.value);
    const threshold = parseInt(els.thresholdRange.value, 10);

    setStatus('Carregando pixels da imagem…', true);
    await yieldFrame();
    const base = getScaledImageData(img);

    setStatus('Executando escala de cinza (' + runs + '×)…', true);
    await yieldFrame();
    const grayRes = benchmark(toGrayscale, base, [], runs);
    paintStage('gray', grayRes.result);
    document.getElementById('time-gray').textContent = fmt(grayRes.avg) + ' ms';
    document.getElementById('time-gray').classList.remove('idle');
    addTableRow('Escala de cinza', '#6B7A8A', grayRes);
    await yieldFrame();

    setStatus('Executando desfoque gaussiano (' + runs + '×)…', true);
    await yieldFrame();
    const blurRes = benchmark(gaussianBlur, base, [sigma], runs);
    paintStage('blur', blurRes.result);
    document.getElementById('time-blur').textContent = fmt(blurRes.avg) + ' ms';
    document.getElementById('time-blur').classList.remove('idle');
    addTableRow('Desfoque gaussiano (σ=' + sigma.toFixed(1) + ')', '#3E7CB8', blurRes);
    await yieldFrame();

    setStatus('Executando detecção de bordas — Sobel (' + runs + '×)…', true);
    await yieldFrame();
    const sobelRes = benchmark(sobelEdges, base, [threshold], runs);
    paintStage('sobel', sobelRes.result);
    document.getElementById('time-sobel').textContent = fmt(sobelRes.avg) + ' ms';
    document.getElementById('time-sobel').classList.remove('idle');
    addTableRow('Sobel (bordas)', 'var(--accent)', sobelRes);

    const total = grayRes.avg + blurRes.avg + sobelRes.avg;
    setStatus('Concluído — ' + base.width + '×' + base.height + ' px · pipeline completo em ' + fmt(total) + ' ms (médias somadas).', false);

    state.busy = false;
    els.runBtn.disabled = false;
  }


  els.dropzone.addEventListener('click', () => els.fileInput.click());
  els.dropzone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); els.fileInput.click(); }
  });
  els.dropzone.setAttribute('tabindex', '0');

  ['dragenter', 'dragover'].forEach((evt) => {
    els.dropzone.addEventListener(evt, (e) => { e.preventDefault(); els.dropzone.classList.add('drag-over'); });
  });
  ['dragleave', 'drop'].forEach((evt) => {
    els.dropzone.addEventListener(evt, (e) => { e.preventDefault(); els.dropzone.classList.remove('drag-over'); });
  });
  els.dropzone.addEventListener('drop', (e) => {
    const files = Array.from(e.dataTransfer.files || []);
    files.forEach(loadFile);
  });
  els.fileInput.addEventListener('change', (e) => {
    Array.from(e.target.files || []).forEach(loadFile);
    els.fileInput.value = '';
  });

  els.regenBtn.addEventListener('click', () => {
    const seed = Math.floor(Math.random() * 1e9) || 1;
    const canvas = generateSampleImage(640, 480, seed);
    addImage(canvas, 'Padrão de teste (gerado)', 640, 480);
  });

  els.sigmaRange.addEventListener('input', () => {
    els.sigmaValue.textContent = parseFloat(els.sigmaRange.value).toFixed(1);
  });
  els.thresholdRange.addEventListener('input', () => {
    const v = parseInt(els.thresholdRange.value, 10);
    els.thresholdValue.textContent = v === 0 ? '0 (desativado)' : String(v);
  });
  els.runsRange.addEventListener('input', () => {
    els.runsValue.textContent = els.runsRange.value;
  });

  els.runBtn.addEventListener('click', runPipeline);


  buildGrid();
  const sample = generateSampleImage(640, 480, 42);
  addImage(sample, 'Imagem de exemplo (gerada)', 640, 480);
})();
