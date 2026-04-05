let imageBase64 = null;
let cameraStream = null;

// Drag and drop
const dropZone = document.getElementById('drop-zone');
dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag'));
dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.classList.remove('drag');
  const f = e.dataTransfer.files[0];
  if (f) loadFile(f);
});

function handleFile(e) {
  if (e.target.files[0]) loadFile(e.target.files[0]);
}

function loadFile(file) {
  const reader = new FileReader();
  reader.onload = ev => {
    imageBase64 = ev.target.result.split(',')[1];
    document.getElementById('preview-img').src = ev.target.result;
    document.getElementById('preview-area').style.display = 'block';
    document.getElementById('analyze-btn').style.display = 'block';
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
    .then(s => {
      cameraStream = s;
      document.getElementById('cam-video').srcObject = s;
    })
    .catch(() => {
      modal.style.display = 'none';
      alert('Camera access was denied or is unavailable.');
    });
}

function closeCamera() {
  if (cameraStream) {
    cameraStream.getTracks().forEach(t => t.stop());
    cameraStream = null;
  }
  document.getElementById('camera-modal').style.display = 'none';
}

function captureFromCamera() {
  const video = document.getElementById('cam-video');
  const canvas = document.getElementById('cam-canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video, 0, 0);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
  imageBase64 = dataUrl.split(',')[1];
  document.getElementById('preview-img').src = dataUrl;
  document.getElementById('preview-area').style.display = 'block';
  document.getElementById('analyze-btn').style.display = 'block';
  document.getElementById('result-card').style.display = 'none';
  closeCamera();
}

async function runAnalysis() {
  if (!imageBase64) return;

  const statusBar = document.getElementById('status-bar');
  const statusText = document.getElementById('status-text');
  statusBar.className = 'status-bar loading';
  statusBar.style.display = 'flex';
  statusText.textContent = 'Analysing handwriting…';
  document.getElementById('result-card').style.display = 'none';
  document.getElementById('analyze-btn').disabled = true;

  const prompt = `You are an expert graphologist and personality analyst. Analyse the handwriting in this image and respond ONLY with a JSON object (no markdown, no extra text).

The JSON must follow this exact structure:
{
  "archetype": "A 2-3 word personality archetype label (e.g. 'The Methodical Thinker')",
  "traits": [
    { "name": "Conscientiousness", "value": 72, "description": "Very organised" },
    { "name": "Creativity", "value": 85, "description": "Highly expressive" },
    { "name": "Openness", "value": 60, "description": "Moderately open" },
    { "name": "Confidence", "value": 78, "description": "Self-assured" },
    { "name": "Emotional depth", "value": 55, "description": "Balanced affect" },
    { "name": "Introversion", "value": 40, "description": "Slightly extroverted" }
  ],
  "summary": "A 3-4 sentence paragraph summarising the personality based on specific graphological features observed: letter slant, pressure, spacing, size, baseline, loops, and connectors."
}

Base the trait values (0-100) and summary on actual visual characteristics of the handwriting. If no handwriting is visible, still return valid JSON but note it in the summary.`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: 'image/jpeg', data: imageBase64 }
            },
            { type: 'text', text: prompt }
          ]
        }]
      })
    });

    const data = await res.json();
    const raw = data.content.map(b => b.text || '').join('');
    const clean = raw.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);
    renderResult(parsed);

  } catch (err) {
    statusBar.className = 'status-bar error';
    statusText.textContent = 'Analysis failed. Please try again.';
    console.error(err);
  }

  document.getElementById('analyze-btn').disabled = false;
}

function renderResult(data) {
  document.getElementById('status-bar').style.display = 'none';
  document.getElementById('result-archetype').textContent = data.archetype || 'Unknown archetype';
  document.getElementById('summary-text').textContent = data.summary || '';

  const grid = document.getElementById('traits-grid');
  grid.innerHTML = '';
  (data.traits || []).forEach(t => {
    const div = document.createElement('div');
    div.className = 'trait';
    const val = Math.min(100, Math.max(0, t.value));
    div.innerHTML = `
      <div class="trait-name">${t.name}</div>
      <div class="trait-val">${t.description}</div>
      <div class="trait-bar">
        <div class="trait-fill" data-w="${val}%"></div>
      </div>
    `;
    grid.appendChild(div);
  });

  document.getElementById('result-card').style.display = 'block';

  // Animate bars after paint
  setTimeout(() => {
    document.querySelectorAll('.trait-fill').forEach(el => {
      el.style.width = el.dataset.w;
    });
  }, 80);
}
