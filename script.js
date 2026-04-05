let imageBase64 = null;
let imageElement = null;
let cameraStream = null;

const dropZone = document.getElementById('drop-zone');
dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag'));
dropZone.addEventListener('drop', e => {
  e.preventDefault(); dropZone.classList.remove('drag');
  if (e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]);
});

function handleFile(e) { if (e.target.files[0]) loadFile(e.target.files[0]); }

function loadFile(file) {
  const reader = new FileReader();
  reader.onload = ev => {
    imageBase64 = ev.target.result;
    const img = new Image();
    img.onload = () => { imageElement = img; };
    img.src = ev.target.result;
    document.getElementById('preview-img').src = ev.target.result;
    document.getElementById('preview-area').style.display = 'block';
    document.getElementById('analyze-btn').style.display = 'flex';
    document.getElementById('result-card').style.display = 'none';
    document.getElementById('status-bar').style.display = 'none';
  };
  reader.readAsDataURL(file);
}

function toggleCamera() {
  const modal = document.getElementById('camera-modal');
  if (modal.style.display === 'block') { closeCamera(); return; }
  modal.style.display = 'block';
  navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
    .then(s => { cameraStream = s; document.getElementById('cam-video').srcObject = s; })
    .catch(() => { modal.style.display = 'none'; alert('Camera access was denied or unavailable.'); });
}

function closeCamera() {
  if (cameraStream) { cameraStream.getTracks().forEach(t => t.stop()); cameraStream = null; }
  document.getElementById('camera-modal').style.display = 'none';
}

function captureFromCamera() {
  const video = document.getElementById('cam-video');
  const canvas = document.getElementById('cam-canvas');
  canvas.width = video.videoWidth; canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video, 0, 0);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
  imageBase64 = dataUrl;
  const img = new Image();
  img.onload = () => { imageElement = img; };
  img.src = dataUrl;
  document.getElementById('preview-img').src = dataUrl;
  document.getElementById('preview-area').style.display = 'block';
  document.getElementById('analyze-btn').style.display = 'flex';
  document.getElementById('result-card').style.display = 'none';
  closeCamera();
}

// ── Core visual analysis engine (no API) ──

function analyzeImagePixels(img) {
  const canvas = document.createElement('canvas');
  const MAX = 300;
  const scale = Math.min(MAX / img.width, MAX / img.height, 1);
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;

  const w = canvas.width, h = canvas.height;
  let darkPixels = 0, totalPixels = w * h;
  let inkRows = new Array(h).fill(0);
  let inkCols = new Array(w).fill(0);
  let rSum = 0, gSum = 0, bSum = 0;
  let topZone = 0, midZone = 0, botZone = 0;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const r = data[i], g = data[i+1], b = data[i+2];
      const brightness = (r * 0.299 + g * 0.587 + b * 0.114);
      rSum += r; gSum += g; bSum += b;
      if (brightness < 140) {
        darkPixels++;
        inkRows[y]++;
        inkCols[x]++;
        if (y < h / 3) topZone++;
        else if (y < (2 * h) / 3) midZone++;
        else botZone++;
      }
    }
  }

  const inkDensity = darkPixels / totalPixels;
  const avgR = rSum / totalPixels, avgG = gSum / totalPixels, avgB = bSum / totalPixels;

  // Line detection
  const activeRows = inkRows.filter(v => v > w * 0.05).length;
  const lineCount = estimateLineCount(inkRows, w);

  // Column spread (measures left/right margins and overall width of writing)
  const activeCols = inkCols.filter(v => v > h * 0.03);
  const firstCol = inkCols.findIndex(v => v > h * 0.03);
  const lastCol = w - 1 - [...inkCols].reverse().findIndex(v => v > h * 0.03);
  const spreadRatio = activeCols.length / w;

  // Stroke pressure estimate (how dark the ink is)
  let darkCount = 0, veryDarkCount = 0;
  for (let i = 0; i < data.length; i += 4) {
    const brightness = data[i] * 0.299 + data[i+1] * 0.587 + data[i+2] * 0.114;
    if (brightness < 100) veryDarkCount++;
    if (brightness < 140) darkCount++;
  }
  const pressureScore = darkCount > 0 ? Math.min(veryDarkCount / darkCount, 1) : 0;

  // Baseline consistency (variance in row ink distribution)
  const rowDensities = inkRows.map(v => v / w);
  const activeDensities = rowDensities.filter(v => v > 0.02);
  const meanDensity = activeDensities.reduce((a,b) => a+b, 0) / (activeDensities.length || 1);
  const variance = activeDensities.reduce((s, v) => s + Math.pow(v - meanDensity, 2), 0) / (activeDensities.length || 1);
  const baselineConsistency = Math.max(0, 1 - (Math.sqrt(variance) / (meanDensity + 0.001)) * 0.5);

  // Slant: compare left vs right column distribution in ink rows
  let leftHalf = 0, rightHalf = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const brightness = data[i] * 0.299 + data[i+1] * 0.587 + data[i+2] * 0.114;
      if (brightness < 140) {
        if (x < w / 2) leftHalf++; else rightHalf++;
      }
    }
  }
  const slantRatio = rightHalf / (leftHalf + rightHalf + 0.001);

  // Letter size estimate based on average row height of writing
  const rowHeights = [];
  let inLine = false, lineStart = 0;
  for (let y = 0; y < h; y++) {
    if (inkRows[y] > w * 0.05 && !inLine) { inLine = true; lineStart = y; }
    else if (inkRows[y] <= w * 0.05 && inLine) { rowHeights.push(y - lineStart); inLine = false; }
  }
  const avgRowHeight = rowHeights.length ? rowHeights.reduce((a,b)=>a+b,0)/rowHeights.length : h * 0.12;
  const letterSizeScore = Math.min(avgRowHeight / (h * 0.25), 1);

  // Spacing: gap frequency between active columns
  let gapCount = 0;
  let prevActive = inkCols[0] > h * 0.03;
  for (let x = 1; x < w; x++) {
    const active = inkCols[x] > h * 0.03;
    if (!active && prevActive) gapCount++;
    prevActive = active;
  }
  const spacingScore = Math.min(gapCount / (lineCount * 5 + 1), 1);

  // Zone balance: upper/mid/lower zone proportions
  const totalZone = topZone + midZone + botZone + 1;
  const upperRatio = topZone / totalZone;
  const lowerRatio = botZone / totalZone;

  return {
    inkDensity, pressureScore, baselineConsistency,
    slantRatio, letterSizeScore, spacingScore,
    upperRatio, lowerRatio, lineCount, spreadRatio,
    avgR, avgG, avgB, activeRows
  };
}

function estimateLineCount(inkRows, w) {
  let lines = 0, inLine = false;
  for (let y = 0; y < inkRows.length; y++) {
    if (inkRows[y] > w * 0.04 && !inLine) { lines++; inLine = true; }
    else if (inkRows[y] <= w * 0.04) { inLine = false; }
  }
  return Math.max(lines, 1);
}

function clamp(v, mn, mx) { return Math.min(mx, Math.max(mn, v)); }
function pct(v) { return Math.round(clamp(v, 0, 1) * 100); }

function buildProfile(m) {
  // Derive trait scores from pixel metrics
  const conscientiousness = pct(m.baselineConsistency * 0.5 + (1 - m.inkDensity) * 0.2 + m.pressureScore * 0.3);
  const creativity       = pct(m.spacingScore * 0.35 + (1 - m.baselineConsistency) * 0.3 + m.inkDensity * 0.35);
  const confidence       = pct(m.letterSizeScore * 0.45 + m.pressureScore * 0.35 + m.spreadRatio * 0.2);
  const emotionality     = pct(m.lowerRatio * 0.4 + (1 - m.baselineConsistency) * 0.35 + m.pressureScore * 0.25);
  const introversion     = pct((1 - m.spreadRatio) * 0.4 + (1 - m.letterSizeScore) * 0.35 + (1 - m.slantRatio) * 0.25);
  const openness         = pct(m.upperRatio * 0.35 + m.spacingScore * 0.3 + m.spreadRatio * 0.35);

  // Graphological feature labels
  const slantLabel = m.slantRatio > 0.56 ? 'Right-leaning' : m.slantRatio < 0.44 ? 'Left-leaning' : 'Upright';
  const sizeLabel  = m.letterSizeScore > 0.65 ? 'Large' : m.letterSizeScore < 0.35 ? 'Small' : 'Medium';
  const pressLabel = m.pressureScore > 0.6 ? 'Heavy' : m.pressureScore < 0.3 ? 'Light' : 'Moderate';
  const spaceLabel = m.spacingScore > 0.55 ? 'Wide' : m.spacingScore < 0.3 ? 'Narrow' : 'Balanced';
  const baseLabel  = m.baselineConsistency > 0.7 ? 'Steady' : m.baselineConsistency < 0.45 ? 'Irregular' : 'Slightly varied';
  const zoneLabel  = m.upperRatio > 0.38 ? 'Upper-dominant' : m.lowerRatio > 0.38 ? 'Lower-dominant' : 'Balanced zones';

  // Archetype logic
  let archetype, badge;
  const top2 = [
    ['Conscientiousness', conscientiousness],
    ['Creativity', creativity],
    ['Confidence', confidence],
    ['Emotionality', emotionality],
    ['Introversion', introversion],
    ['Openness', openness],
  ].sort((a,b) => b[1]-a[1]).slice(0,2).map(x=>x[0]);

  if (top2.includes('Conscientiousness') && top2.includes('Confidence'))
    { archetype = 'The decisive organiser'; badge = 'Leader type'; }
  else if (top2.includes('Creativity') && top2.includes('Openness'))
    { archetype = 'The imaginative visionary'; badge = 'Creative type'; }
  else if (top2.includes('Emotionality') && top2.includes('Introversion'))
    { archetype = 'The sensitive introspect'; badge = 'Reflective type'; }
  else if (top2.includes('Conscientiousness') && top2.includes('Introversion'))
    { archetype = 'The methodical thinker'; badge = 'Analytical type'; }
  else if (top2.includes('Confidence') && top2.includes('Openness'))
    { archetype = 'The curious trailblazer'; badge = 'Explorer type'; }
  else if (top2.includes('Creativity') && top2.includes('Emotionality'))
    { archetype = 'The expressive artist'; badge = 'Emotional type'; }
  else
    { archetype = 'The balanced realist'; badge = 'Adaptive type'; }

  // Summary text
  const slantDesc = slantLabel === 'Right-leaning'
    ? 'A rightward slant indicates a sociable, forward-looking nature with strong emotional responsiveness.'
    : slantLabel === 'Left-leaning'
    ? 'A leftward slant often reflects introversion, independence, and a tendency to look inward before acting.'
    : 'Upright strokes suggest emotional balance, self-control, and a logical approach to decisions.';

  const sizeDesc = sizeLabel === 'Large'
    ? 'Large letterforms point to confidence, extroversion, and a desire to be noticed.'
    : sizeLabel === 'Small'
    ? 'Small, compact writing suggests concentration, attention to detail, and intellectual focus.'
    : 'Medium-sized letters reflect a grounded, adaptablelet imageBase64 = null;
let imageElement = null;
let cameraStream = null;

const dropZone = document.getElementById('drop-zone');
dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag'));
dropZone.addEventListener('drop', e => {
  e.preventDefault(); dropZone.classList.remove('drag');
  if (e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]);
});

function handleFile(e) { if (e.target.files[0]) loadFile(e.target.files[0]); }

function loadFile(file) {
  const reader = new FileReader();
  reader.onload = ev => {
    imageBase64 = ev.target.result;
    const img = new Image();
    img.onload = () => { imageElement = img; };
    img.src = ev.target.result;
    document.getElementById('preview-img').src = ev.target.result;
    document.getElementById('preview-area').style.display = 'block';
    document.getElementById('analyze-btn').style.display = 'flex';
    document.getElementById('result-card').style.display = 'none';
    document.getElementById('status-bar').style.display = 'none';
  };
  reader.readAsDataURL(file);
}

function toggleCamera() {
  const modal = document.getElementById('camera-modal');
  if (modal.style.display === 'block') { closeCamera(); return; }
  modal.style.display = 'block';
  navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
    .then(s => { cameraStream = s; document.getElementById('cam-video').srcObject = s; })
    .catch(() => { modal.style.display = 'none'; alert('Camera access was denied or unavailable.'); });
}

function closeCamera() {
  if (cameraStream) { cameraStream.getTracks().forEach(t => t.stop()); cameraStream = null; }
  document.getElementById('camera-modal').style.display = 'none';
}

function captureFromCamera() {
  const video = document.getElementById('cam-video');
  const canvas = document.getElementById('cam-canvas');
  canvas.width = video.videoWidth; canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video, 0, 0);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
  imageBase64 = dataUrl;
  const img = new Image();
  img.onload = () => { imageElement = img; };
  img.src = dataUrl;
  document.getElementById('preview-img').src = dataUrl;
  document.getElementById('preview-area').style.display = 'block';
  document.getElementById('analyze-btn').style.display = 'flex';
  document.getElementById('result-card').style.display = 'none';
  closeCamera();
}

// ── Core visual analysis engine (no API) ──

function analyzeImagePixels(img) {
  const canvas = document.createElement('canvas');
  const MAX = 300;
  const scale = Math.min(MAX / img.width, MAX / img.height, 1);
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;

  const w = canvas.width, h = canvas.height;
  let darkPixels = 0, totalPixels = w * h;
  let inkRows = new Array(h).fill(0);
  let inkCols = new Array(w).fill(0);
  let rSum = 0, gSum = 0, bSum = 0;
  let topZone = 0, midZone = 0, botZone = 0;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const r = data[i], g = data[i+1], b = data[i+2];
      const brightness = (r * 0.299 + g * 0.587 + b * 0.114);
      rSum += r; gSum += g; bSum += b;
      if (brightness < 140) {
        darkPixels++;
        inkRows[y]++;
        inkCols[x]++;
        if (y < h / 3) topZone++;
        else if (y < (2 * h) / 3) midZone++;
        else botZone++;
      }
    }
  }

  const inkDensity = darkPixels / totalPixels;
  const avgR = rSum / totalPixels, avgG = gSum / totalPixels, avgB = bSum / totalPixels;

  // Line detection
  const activeRows = inkRows.filter(v => v > w * 0.05).length;
  const lineCount = estimateLineCount(inkRows, w);

  // Column spread (measures left/right margins and overall width of writing)
  const activeCols = inkCols.filter(v => v > h * 0.03);
  const firstCol = inkCols.findIndex(v => v > h * 0.03);
  const lastCol = w - 1 - [...inkCols].reverse().findIndex(v => v > h * 0.03);
  const spreadRatio = activeCols.length / w;

  // Stroke pressure estimate (how dark the ink is)
  let darkCount = 0, veryDarkCount = 0;
  for (let i = 0; i < data.length; i += 4) {
    const brightness = data[i] * 0.299 + data[i+1] * 0.587 + data[i+2] * 0.114;
    if (brightness < 100) veryDarkCount++;
    if (brightness < 140) darkCount++;
  }
  const pressureScore = darkCount > 0 ? Math.min(veryDarkCount / darkCount, 1) : 0;

  // Baseline consistency (variance in row ink distribution)
  const rowDensities = inkRows.map(v => v / w);
  const activeDensities = rowDensities.filter(v => v > 0.02);
  const meanDensity = activeDensities.reduce((a,b) => a+b, 0) / (activeDensities.length || 1);
  const variance = activeDensities.reduce((s, v) => s + Math.pow(v - meanDensity, 2), 0) / (activeDensities.length || 1);
  const baselineConsistency = Math.max(0, 1 - (Math.sqrt(variance) / (meanDensity + 0.001)) * 0.5);

  // Slant: compare left vs right column distribution in ink rows
  let leftHalf = 0, rightHalf = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const brightness = data[i] * 0.299 + data[i+1] * 0.587 + data[i+2] * 0.114;
      if (brightness < 140) {
        if (x < w / 2) leftHalf++; else rightHalf++;
      }
    }
  }
  const slantRatio = rightHalf / (leftHalf + rightHalf + 0.001);

  // Letter size estimate based on average row height of writing
  const rowHeights = [];
  let inLine = false, lineStart = 0;
  for (let y = 0; y < h; y++) {
    if (inkRows[y] > w * 0.05 && !inLine) { inLine = true; lineStart = y; }
    else if (inkRows[y] <= w * 0.05 && inLine) { rowHeights.push(y - lineStart); inLine = false; }
  }
  const avgRowHeight = rowHeights.length ? rowHeights.reduce((a,b)=>a+b,0)/rowHeights.length : h * 0.12;
  const letterSizeScore = Math.min(avgRowHeight / (h * 0.25), 1);

  // Spacing: gap frequency between active columns
  let gapCount = 0;
  let prevActive = inkCols[0] > h * 0.03;
  for (let x = 1; x < w; x++) {
    const active = inkCols[x] > h * 0.03;
    if (!active && prevActive) gapCount++;
    prevActive = active;
  }
  const spacingScore = Math.min(gapCount / (lineCount * 5 + 1), 1);

  // Zone balance: upper/mid/lower zone proportions
  const totalZone = topZone + midZone + botZone + 1;
  const upperRatio = topZone / totalZone;
  const lowerRatio = botZone / totalZone;

  return {
    inkDensity, pressureScore, baselineConsistency,
    slantRatio, letterSizeScore, spacingScore,
    upperRatio, lowerRatio, lineCount, spreadRatio,
    avgR, avgG, avgB, activeRows
  };
}

function estimateLineCount(inkRows, w) {
  let lines = 0, inLine = false;
  for (let y = 0; y < inkRows.length; y++) {
    if (inkRows[y] > w * 0.04 && !inLine) { lines++; inLine = true; }
    else if (inkRows[y] <= w * 0.04) { inLine = false; }
  }
  return Math.max(lines, 1);
}

function clamp(v, mn, mx) { return Math.min(mx, Math.max(mn, v)); }
function pct(v) { return Math.round(clamp(v, 0, 1) * 100); }

function buildProfile(m) {
  // Derive trait scores from pixel metrics
  const conscientiousness = pct(m.baselineConsistency * 0.5 + (1 - m.inkDensity) * 0.2 + m.pressureScore * 0.3);
  const creativity       = pct(m.spacingScore * 0.35 + (1 - m.baselineConsistency) * 0.3 + m.inkDensity * 0.35);
  const confidence       = pct(m.letterSizeScore * 0.45 + m.pressureScore * 0.35 + m.spreadRatio * 0.2);
  const emotionality     = pct(m.lowerRatio * 0.4 + (1 - m.baselineConsistency) * 0.35 + m.pressureScore * 0.25);
  const introversion     = pct((1 - m.spreadRatio) * 0.4 + (1 - m.letterSizeScore) * 0.35 + (1 - m.slantRatio) * 0.25);
  const openness         = pct(m.upperRatio * 0.35 + m.spacingScore * 0.3 + m.spreadRatio * 0.35);

  // Graphological feature labels
  const slantLabel = m.slantRatio > 0.56 ? 'Right-leaning' : m.slantRatio < 0.44 ? 'Left-leaning' : 'Upright';
  const sizeLabel  = m.letterSizeScore > 0.65 ? 'Large' : m.letterSizeScore < 0.35 ? 'Small' : 'Medium';
  const pressLabel = m.pressureScore > 0.6 ? 'Heavy' : m.pressureScore < 0.3 ? 'Light' : 'Moderate';
  const spaceLabel = m.spacingScore > 0.55 ? 'Wide' : m.spacingScore < 0.3 ? 'Narrow' : 'Balanced';
  const baseLabel  = m.baselineConsistency > 0.7 ? 'Steady' : m.baselineConsistency < 0.45 ? 'Irregular' : 'Slightly varied';
  const zoneLabel  = m.upperRatio > 0.38 ? 'Upper-dominant' : m.lowerRatio > 0.38 ? 'Lower-dominant' : 'Balanced zones';

  // Archetype logic
  let archetype, badge;
  const top2 = [
    ['Conscientiousness', conscientiousness],
    ['Creativity', creativity],
    ['Confidence', confidence],
    ['Emotionality', emotionality],
    ['Introversion', introversion],
    ['Openness', openness],
  ].sort((a,b) => b[1]-a[1]).slice(0,2).map(x=>x[0]);

  if (top2.includes('Conscientiousness') && top2.includes('Confidence'))
    { archetype = 'The decisive organiser'; badge = 'Leader type'; }
  else if (top2.includes('Creativity') && top2.includes('Openness'))
    { archetype = 'The imaginative visionary'; badge = 'Creative type'; }
  else if (top2.includes('Emotionality') && top2.includes('Introversion'))
    { archetype = 'The sensitive introspect'; badge = 'Reflective type'; }
  else if (top2.includes('Conscientiousness') && top2.includes('Introversion'))
    { archetype = 'The methodical thinker'; badge = 'Analytical type'; }
  else if (top2.includes('Confidence') && top2.includes('Openness'))
    { archetype = 'The curious trailblazer'; badge = 'Explorer type'; }
  else if (top2.includes('Creativity') && top2.includes('Emotionality'))
    { archetype = 'The expressive artist'; badge = 'Emotional type'; }
  else
    { archetype = 'The balanced realist'; badge = 'Adaptive type'; }

  // Summary text
  const slantDesc = slantLabel === 'Right-leaning'
    ? 'A rightward slant indicates a sociable, forward-looking nature with strong emotional responsiveness.'
    : slantLabel === 'Left-leaning'
    ? 'A leftward slant often reflects introversion, independence, and a tendency to look inward before acting.'
    : 'Upright strokes suggest emotional balance, self-control, and a logical approach to decisions.';

  const sizeDesc = sizeLabel === 'Large'
    ? 'Large letterforms point to confidence, extroversion, and a desire to be noticed.'
    : sizeLabel === 'Small'
    ? 'Small, compact writing suggests concentration, attention to detail, and intellectual focus.'
    : 'Medium-sized letters reflect a grounded, adaptable
