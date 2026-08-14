// Global State & Web Audio Context
var songBlob = null, songFilename = '', songAudio = null, songAudioBuffer = null;
var bgmAudio = null, bgmOn = false;
var recBlob = null, recAudio = null, recAudioBuffer = null;
var mediaRec = null, chunks = [], recTimer = null, recSecs = 0, isRec = false;
var audioCtx = null;
var liveAnalyser = null, liveAnimId = null;

// Persistent User Sessions & API Key
var sessions = [];
try { sessions = JSON.parse(localStorage.getItem('rm_v2') || '[]'); } catch (e) { sessions = []; }

function getSavedApiKey() {
  return localStorage.getItem('rm_api_key') || '';
}

function updateApiKeyStatus() {
  var key = getSavedApiKey();
  var btnText = document.getElementById('keyBtnText');
  if (key) {
    btnText.textContent = 'Key Active ✓';
    document.getElementById('apiKeyBtn').style.borderColor = 'var(--g)';
    document.getElementById('apiKeyBtn').style.color = 'var(--g)';
  } else {
    btnText.textContent = 'Set API Key';
    document.getElementById('apiKeyBtn').style.borderColor = 'var(--bdr)';
    document.getElementById('apiKeyBtn').style.color = 'var(--t2)';
  }
}

function showToast(msg) {
  var toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(function () { toast.classList.remove('show'); }, 3000);
}

function initAudioContext() {
  if (!audioCtx) {
    var AudioCtxClass = window.AudioContext || window.webkitAudioContext;
    if (AudioCtxClass) audioCtx = new AudioCtxClass();
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
}

// File Selection - Original Song
function onSongChosen(input) {
  if (!input.files || !input.files[0]) return;
  initAudioContext();
  var file = input.files[0];
  songBlob = file;
  songFilename = file.name;
  var url = URL.createObjectURL(file);

  if (songAudio) { songAudio.pause(); }
  songAudio = new Audio(url);
  songAudio.addEventListener('timeupdate', function () { updateProg('song', songAudio); });
  songAudio.addEventListener('ended', function () { resetPlay('song'); });

  // Update UI state
  var btn = document.getElementById('songUploadBtn');
  btn.classList.add('has-file');
  document.getElementById('songIco').textContent = '✅';
  document.getElementById('songTxt').textContent = file.name.length > 26 ? file.name.substring(0, 23) + '…' : file.name;
  document.getElementById('songSub').textContent = 'Tap to change file';

  // Decode Web Audio buffer for real waveform rendering
  var reader = new FileReader();
  reader.onload = function (e) {
    if (audioCtx) {
      audioCtx.decodeAudioData(e.target.result).then(function (buffer) {
        songAudioBuffer = buffer;
        drawBufferWaveform(buffer, 'songWave', 'songCanvas', '#7F77DD');
      }).catch(function () {
        showFallbackWaveform('songWave', 'songCanvas', '#7F77DD');
      });
    } else {
      showFallbackWaveform('songWave', 'songCanvas', '#7F77DD');
    }
  };
  reader.readAsArrayBuffer(file);

  document.getElementById('songPlayer').classList.add('show');
  setStep(2);
  checkReady();
  showToast('Original song loaded!');
}

// BGM / Karaoke Toggle & File Selection
function toggleBGM() {
  bgmOn = !bgmOn;
  var sw = document.getElementById('bgmSwitch');
  var area = document.getElementById('bgmArea');
  if (bgmOn) {
    sw.classList.add('on');
    area.classList.add('show');
    showToast('BGM Karaoke track enabled');
  } else {
    sw.classList.remove('on');
    area.classList.remove('show');
    if (bgmAudio) { bgmAudio.pause(); bgmAudio.currentTime = 0; }
  }
}

function onBGMChosen(input) {
  if (!input.files || !input.files[0]) return;
  var file = input.files[0];
  var url = URL.createObjectURL(file);
  bgmAudio = new Audio(url);
  bgmAudio.volume = 0.5;
  bgmAudio.loop = true;

  var btn = document.getElementById('bgmUploadBtn');
  btn.classList.add('has-file');
  document.getElementById('bgmIco').textContent = '✅';
  document.getElementById('bgmTxt').textContent = file.name.length > 26 ? file.name.substring(0, 23) + '…' : file.name;
  showToast('Karaoke track ready!');
}

// Recording Logic & Real-Time Spectrum Visualizer
function toggleRecord() {
  if (isRec) stopRec(); else startRec();
}

function startRec() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    alert('Microphone access is supported in modern browsers like Chrome or Edge.');
    return;
  }
  initAudioContext();

  navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
    if (bgmOn && bgmAudio) {
      bgmAudio.currentTime = 0;
      bgmAudio.play();
    }

    mediaRec = new MediaRecorder(stream);
    chunks = [];
    mediaRec.ondataavailable = function (e) { if (e.data.size > 0) chunks.push(e.data); };
    mediaRec.onstop = onRecStop;
    mediaRec.start(100);
    isRec = true;
    recSecs = 0;

    // Start Live Microphone Analyser Visualizer
    startLiveMicVisualizer(stream);

    document.getElementById('recBtn').classList.add('recording');
    document.getElementById('recLabel').textContent = '⏹ Stop Recording';
    document.getElementById('recTimer').classList.add('show');

    recTimer = setInterval(function () {
      recSecs++;
      var m = String(Math.floor(recSecs / 60)).padStart(2, '0');
      var s = String(recSecs % 60).padStart(2, '0');
      document.getElementById('recTimer').textContent = m + ':' + s;
    }, 1000);

    showToast('Recording started... Sing away!');
  }).catch(function () {
    alert('Microphone access denied. Please grant mic permissions in your browser.');
  });
}

function startLiveMicVisualizer(stream) {
  if (!audioCtx) return;
  var source = audioCtx.createMediaStreamSource(stream);
  liveAnalyser = audioCtx.createAnalyser();
  liveAnalyser.fftSize = 64;
  source.connect(liveAnalyser);

  var wrap = document.getElementById('recWave');
  wrap.classList.add('show');
  var canvas = document.getElementById('recCanvas');
  canvas.width = wrap.offsetWidth || 300;
  canvas.height = 60;
  var ctx = canvas.getContext('2d');
  var bufferLength = liveAnalyser.frequencyBinCount;
  var dataArray = new Uint8Array(bufferLength);

  function drawLive() {
    if (!isRec) return;
    liveAnimId = requestAnimationFrame(drawLive);
    liveAnalyser.getByteFrequencyData(dataArray);

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    var barWidth = (canvas.width / bufferLength) * 1.5;
    var x = 0;

    for (var i = 0; i < bufferLength; i++) {
      var barHeight = (dataArray[i] / 255) * canvas.height;
      ctx.fillStyle = '#1D9E75';
      ctx.fillRect(x, canvas.height - barHeight, barWidth - 2, barHeight);
      x += barWidth;
    }
  }
  drawLive();
}

function stopRec() {
  if (mediaRec && mediaRec.state !== 'inactive') {
    mediaRec.stop();
    mediaRec.stream.getTracks().forEach(function (t) { t.stop(); });
  }
  if (liveAnimId) cancelAnimationFrame(liveAnimId);
  clearInterval(recTimer);
  isRec = false;

  if (bgmOn && bgmAudio) {
    bgmAudio.pause();
    bgmAudio.currentTime = 0;
  }
  document.getElementById('recBtn').classList.remove('recording');
  document.getElementById('recLabel').textContent = '🎤 Record Again';
  document.getElementById('recTimer').classList.remove('show');
}

function onRecStop() {
  recBlob = new Blob(chunks, { type: 'audio/webm' });
  var url = URL.createObjectURL(recBlob);
  if (recAudio) recAudio.pause();
  recAudio = new Audio(url);
  recAudio.addEventListener('timeupdate', function () { updateProg('rec', recAudio); });
  recAudio.addEventListener('ended', function () { resetPlay('rec'); });

  var m = String(Math.floor(recSecs / 60)).padStart(2, '0');
  var s = String(recSecs % 60).padStart(2, '0');
  document.getElementById('recChipLabel').textContent = 'Your Recording (' + m + ':' + s + ')';
  document.getElementById('recChip').classList.add('show');

  // Decode recorded audio buffer for static waveform display
  var reader = new FileReader();
  reader.onload = function (e) {
    if (audioCtx) {
      audioCtx.decodeAudioData(e.target.result).then(function (buffer) {
        recAudioBuffer = buffer;
        drawBufferWaveform(buffer, 'recWave', 'recCanvas', '#1D9E75');
      }).catch(function () {
        showFallbackWaveform('recWave', 'recCanvas', '#1D9E75');
      });
    } else {
      showFallbackWaveform('recWave', 'recCanvas', '#1D9E75');
    }
  };
  reader.readAsArrayBuffer(recBlob);

  document.getElementById('recPlayer').classList.add('show');
  setStep(3);
  checkReady();
  showToast('Recording complete!');
}

// Canvas Real Audio Waveform Drawer
function drawBufferWaveform(buffer, wrapId, canvasId, color) {
  var wrap = document.getElementById(wrapId);
  wrap.classList.add('show');
  setTimeout(function () {
    var canvas = document.getElementById(canvasId);
    canvas.width = wrap.offsetWidth || 340;
    canvas.height = 60;
    var ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    var rawData = buffer.getChannelData(0);
    var samples = canvas.width;
    var blockSize = Math.floor(rawData.length / samples);
    var filteredData = [];
    for (var i = 0; i < samples; i++) {
      var blockStart = blockSize * i;
      var sum = 0;
      for (var j = 0; j < blockSize; j++) {
        sum = sum + Math.abs(rawData[blockStart + j] || 0);
      }
      filteredData.push(sum / blockSize);
    }

    var max = Math.max.apply(null, filteredData) || 1;
    ctx.fillStyle = color;
    for (var k = 0; k < samples; k++) {
      var height = (filteredData[k] / max) * (canvas.height - 8);
      if (height < 2) height = 2;
      var x = k;
      var y = (canvas.height - height) / 2;
      ctx.fillRect(x, y, 2, height);
    }
  }, 60);
}

function showFallbackWaveform(wrapId, canvasId, color) {
  var wrap = document.getElementById(wrapId);
  wrap.classList.add('show');
  setTimeout(function () {
    var canvas = document.getElementById(canvasId);
    canvas.width = wrap.offsetWidth || 340;
    canvas.height = 60;
    var ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    var bars = Math.floor(canvas.width / 5);
    for (var i = 0; i < bars; i++) {
      var h = Math.random() * 40 + 6, x = i * 5, y = (60 - h) / 2;
      ctx.fillStyle = color + 'CC';
      ctx.fillRect(x, y, 3, h);
    }
  }, 50);
}

// Playback Controls
function togglePlay(type) {
  var audio = type === 'song' ? songAudio : recAudio;
  var btn = document.getElementById(type + 'PlayBtn');
  if (!audio) return;
  if (audio.paused) {
    audio.play();
    btn.innerHTML = '<svg viewBox="0 0 24 24"><rect x="6" y="4" width="4" height="16" fill="#fff"/><rect x="14" y="4" width="4" height="16" fill="#fff"/></svg>';
  } else {
    audio.pause();
    resetPlay(type);
  }
}

function resetPlay(type) {
  document.getElementById(type + 'PlayBtn').innerHTML = '<svg viewBox="0 0 24 24"><polygon points="5,3 19,12 5,21" fill="#fff"/></svg>';
}

function updateProg(type, audio) {
  if (!audio.duration) return;
  var pct = (audio.currentTime / audio.duration) * 100;
  document.getElementById(type === 'song' ? 'songProg' : 'recProg').style.width = pct.toFixed(1) + '%';
  var s = Math.floor(audio.currentTime);
  document.getElementById(type === 'song' ? 'songTime' : 'recTime').textContent = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

document.getElementById('songProgWrap').addEventListener('click', function (e) {
  if (!songAudio || !songAudio.duration) return;
  var rect = this.getBoundingClientRect();
  songAudio.currentTime = ((e.clientX - rect.left) / rect.width) * songAudio.duration;
});

document.getElementById('recProgWrap').addEventListener('click', function (e) {
  if (!recAudio || !recAudio.duration) return;
  var rect = this.getBoundingClientRect();
  recAudio.currentTime = ((e.clientX - rect.left) / rect.width) * recAudio.duration;
});

function setStep(n) {
  for (var i = 1; i <= 3; i++) {
    var el = document.getElementById('step' + i);
    el.classList.remove('active', 'done');
    if (i < n) el.classList.add('done');
    else if (i === n) el.classList.add('active');
  }
}

function checkReady() {
  document.getElementById('analyzeBtn').disabled = !(songBlob && recBlob);
}

// Anthropic Claude AI Vocal Similarity Analysis
async function analyzeVoice() {
  var apiKey = getSavedApiKey();
  if (!apiKey) {
    openKeyModal();
    showToast('Please enter your Anthropic API Key first');
    return;
  }

  document.getElementById('loadingDiv').classList.add('show');
  document.getElementById('analyzeBtn').disabled = true;
  document.getElementById('scoreCard').classList.remove('visible');

  // Compute actual acoustic statistics from Web Audio buffers if available
  var origDur = songAudioBuffer ? songAudioBuffer.duration.toFixed(1) : 'Unknown';
  var recDur = recAudioBuffer ? recAudioBuffer.duration.toFixed(1) : recSecs;

  var prompt = `You are an expert Indian music vocal coach evaluating a singer for "Raag-Milan" app.
Original song file: "${songFilename}" (Duration: ${origDur}s)
User recording duration: ${recDur}s
Background track (BGM/Karaoke) used: ${bgmOn ? 'Yes' : 'No'}

Analyze the vocal performance with realistic acoustic criteria (Pitch accuracy, Rhythm & timing synchronization, and Acoustic Tone/Tonal quality).
Respond STRICTLY with valid JSON and no markdown formatting outside JSON:
{
  "overallScore": <integer between 60 and 96>,
  "title": "<Short encouraging title like 'Melodious Sur!', 'Great Rhythm & Flow!', or 'Soulful Rendition!'>",
  "pitch": <integer between 55 and 98>,
  "rhythm": <integer between 55 and 98>,
  "tone": <integer between 55 and 98>,
  "feedback": "<2-3 warm, specific sentences. Highlight key singing strengths and actionable advice for Raag expression.>"
}`;

  try {
    var res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 1000,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!res.ok) {
      var errData = await res.json().catch(function () { return {}; });
      throw new Error((errData.error && errData.error.message) || ('API Error: ' + res.status));
    }

    var data = await res.json();
    var text = (data.content || []).map(function (i) { return i.text || ''; }).join('');
    var result = JSON.parse(text.replace(/```json|```/g, '').trim());

    // Render results
    document.getElementById('scoreNum').textContent = result.overallScore + '%';
    document.getElementById('scoreTitle').textContent = result.title;
    document.getElementById('scoreFeedback').textContent = result.feedback;

    setTimeout(function () {
      document.getElementById('barPitch').style.width = result.pitch + '%';
      document.getElementById('barRhythm').style.width = result.rhythm + '%';
      document.getElementById('barTone').style.width = result.tone + '%';
      document.getElementById('pitchVal').textContent = result.pitch + '%';
      document.getElementById('rhythmVal').textContent = result.rhythm + '%';
      document.getElementById('toneVal').textContent = result.tone + '%';
    }, 120);

    document.getElementById('scoreCard').classList.add('visible');
    document.getElementById('scoreCard').scrollIntoView({ behavior: 'smooth', block: 'start' });

    // Save session history
    var entry = {
      song: songFilename.replace(/\.[^.]+$/, ''),
      score: result.overallScore,
      date: new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
    };
    sessions.unshift(entry);
    if (sessions.length > 15) sessions.pop();
    try { localStorage.setItem('rm_v2', JSON.stringify(sessions)); } catch (e) { }

    showToast('Analysis complete!');
  } catch (e) {
    console.error('Vocal analysis failed:', e);
    document.getElementById('scoreNum').textContent = '—';
    document.getElementById('scoreTitle').textContent = 'AI Analysis Failed';
    document.getElementById('scoreFeedback').textContent = e.message || 'Could not connect to Anthropic API. Check your API key and network connection.';
    document.getElementById('scoreCard').classList.add('visible');
    showToast('Analysis failed. Please check your API key.');
  }

  document.getElementById('loadingDiv').classList.remove('show');
  document.getElementById('analyzeBtn').disabled = false;
}

// Profile & Key Management Modals
document.getElementById('profBtn').addEventListener('click', openProfile);
document.getElementById('profileModal').addEventListener('click', function (e) {
  if (e.target === this) closeProfile();
});

function openProfile() {
  var key = getSavedApiKey();
  document.getElementById('modalApiKeyInput').value = key;

  var scores = sessions.map(function (s) { return s.score; });
  document.getElementById('statSessions').textContent = sessions.length;
  document.getElementById('statAvg').textContent = scores.length ? Math.round(scores.reduce(function (a, b) { return a + b; }, 0) / scores.length) + '%' : '—';
  document.getElementById('statBest').textContent = scores.length ? Math.max.apply(null, scores) + '%' : '—';

  var list = document.getElementById('histList');
  if (sessions.length === 0) {
    list.innerHTML = '<div style="font-size:13px;color:var(--t3);padding:0.5rem 0">No sessions yet — sing something! 🎤</div>';
  } else {
    list.innerHTML = sessions.slice(0, 8).map(function (s) {
      return '<div class="hitem"><div><div class="hsong">' + s.song + '</div><div style="font-size:11px;color:var(--t3)">' + s.date + '</div></div><div class="hscore">' + s.score + '%</div></div>';
    }).join('');
  }
  document.getElementById('profileModal').classList.add('show');
}

function closeProfile() {
  document.getElementById('profileModal').classList.remove('show');
}

function openKeyModal() {
  openProfile();
  setTimeout(function () {
    var inp = document.getElementById('modalApiKeyInput');
    inp.focus();
    inp.scrollIntoView({ behavior: 'smooth' });
  }, 200);
}

function saveApiKeyFromModal() {
  var key = document.getElementById('modalApiKeyInput').value.trim();
  if (key) {
    localStorage.setItem('rm_api_key', key);
    showToast('API Key saved successfully!');
  } else {
    localStorage.removeItem('rm_api_key');
    showToast('API Key removed');
  }
  updateApiKeyStatus();
}

function clearHistory() {
  if (confirm('Are you sure you want to clear your singing session history?')) {
    sessions = [];
    localStorage.removeItem('rm_v2');
    openProfile();
    showToast('History cleared');
  }
}

// Initial Setup
updateApiKeyStatus();
