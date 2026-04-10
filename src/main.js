const LANES = ["LEFT", "UP", "DOWN", "RIGHT", "FIST", "V_SIGN", "THUMBS_UP"];
const DIRS = new Set(["LEFT", "UP", "DOWN", "RIGHT"]);
const LABELS = {
  LEFT: "왼쪽",
  UP: "위",
  DOWN: "아래",
  RIGHT: "오른쪽",
  FIST: "주먹",
  V_SIGN: "브이",
  THUMBS_UP: "엄지척",
  WAITING: "대기 중",
};
const KEYS = {
  ArrowLeft: "LEFT",
  ArrowUp: "UP",
  ArrowDown: "DOWN",
  ArrowRight: "RIGHT",
  z: "FIST",
  Z: "FIST",
  x: "V_SIGN",
  X: "V_SIGN",
  c: "THUMBS_UP",
  C: "THUMBS_UP",
};
const SAMPLE_BPM = 116;
const APPROACH = 2200;
const PERFECT = 120;
const GOOD = 220;
const STABLE = 3;
const CAMERA_COOLDOWN = 240;

const $ = (s) => document.querySelector(s);
const scoreEl = $("#score");
const comboEl = $("#combo");
const accuracyEl = $("#accuracy");
const cameraEl = $("#camera");
const overlayCanvas = $("#camera-overlay");
const cameraBtn = $("#camera-button");
const cameraSel = $("#camera-select");
const refreshBtn = $("#refresh-cameras");
const audioFileEl = $("#audio-file");
const useSampleBtn = $("#use-sample-button");
const trackStatusEl = $("#track-status");
const cameraStatusEl = $("#camera-status");
const gestureEl = $("#gesture-label");
const judgeEl = $("#judge-text");
const missionEl = $("#mission-text");
const notesLayer = $("#notes-layer");
const overlayEl = $("#overlay");
const overlayMsgEl = $("#overlay-message");
const startBtn = $("#start-button");
const restartBtn = $("#restart-button");
const songStatusEl = $("#song-status");

let score = 0;
let combo = 0;
let bestCombo = 0;
let running = false;
let startAt = 0;
let rafId = 0;
let audio = null;
let hands = null;
let cameraController = null;
let media = null;
let devices = [];
let selectedDeviceId = "";
let gestureHistory = [];
let lastCameraGesture = "";
let lastCameraGestureAt = 0;
let currentSource = null;
let currentTrackMode = "sample";
let currentTrackName = "샘플 곡";
let uploadedBuffer = null;
let notes = createSampleBeatmap();
const noteEls = new Map();
const stats = { perfect: 0, good: 0, miss: 0 };

buildStage();
renderHud();
setupAudio();
setupCamera();
setupInputs();
showOverlay("스페이스바 또는 시작 버튼으로 플레이", false);

function createSampleBeatmap() {
  const seq = ["LEFT", "UP", "DOWN", "RIGHT", "FIST", "LEFT", "UP", "V_SIGN", "DOWN", "RIGHT", "LEFT", "THUMBS_UP", "UP", "DOWN", "FIST", "RIGHT"];
  const gap = (60000 / SAMPLE_BPM) / 2;
  const intro = 1800;
  return Array.from({ length: 32 }, (_, i) => makeNote(`sample-${i}`, seq[i % seq.length], intro + i * gap));
}

function makeNote(id, lane, time) {
  return { id, lane, time, judged: false, result: null };
}

function buildStage() {
  notesLayer.replaceChildren();
  noteEls.clear();
  for (const note of notes) {
    const el = document.createElement("div");
    el.className = `note ${DIRS.has(note.lane) ? "note--direction" : "note--gesture"}`;
    el.textContent = formatLane(note.lane);
    notesLayer.appendChild(el);
    noteEls.set(note.id, el);
  }
}

function setupInputs() {
  document.addEventListener("keydown", (event) => {
    if (event.code === "Space") {
      event.preventDefault();
      if (!running) startGame();
      return;
    }
    const lane = KEYS[event.key];
    if (!lane) return;
    event.preventDefault();
    registerInput(lane, "keyboard");
  });

  startBtn.addEventListener("click", startGame);
  restartBtn.addEventListener("click", startGame);

  audioFileEl.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    await loadUploadedTrack(file);
  });

  useSampleBtn.addEventListener("click", () => {
    stopPlayback();
    currentTrackMode = "sample";
    currentTrackName = "샘플 곡";
    uploadedBuffer = null;
    notes = createSampleBeatmap();
    buildStage();
    resetGame();
    trackStatusEl.textContent = "샘플 곡이 다시 선택되었습니다.";
    songStatusEl.textContent = "샘플 비트맵 준비 완료. 카메라 없이도 키보드로 플레이할 수 있습니다.";
    showOverlay("스페이스바 또는 시작 버튼으로 플레이", false);
  });
}

async function loadUploadedTrack(file) {
  try {
    resumeAudio();
    trackStatusEl.textContent = `${file.name} 분석 중...`;
    const arrayBuffer = await file.arrayBuffer();
    const buffer = await decodeAudio(arrayBuffer);
    const analyzedNotes = createBeatmapFromAudio(buffer);

    uploadedBuffer = buffer;
    currentTrackMode = "upload";
    currentTrackName = file.name;
    notes = analyzedNotes;
    buildStage();
    resetGame();
    trackStatusEl.textContent = `${file.name} 분석 완료: 노트 ${notes.length}개 생성`;
    songStatusEl.textContent = `${file.name} 준비 완료. 시작 버튼으로 재생하세요.`;
    missionEl.textContent = "업로드한 음악의 피크를 분석해 자동 노트맵을 생성했습니다.";
    showOverlay(`${file.name} 로드 완료`, false);
  } catch (error) {
    console.error(error);
    trackStatusEl.textContent = "음악 분석에 실패했습니다. 다른 파일을 시도해 주세요.";
  }
}

function startGame() {
  resetGame();
  resumeAudio();
  running = true;
  startAt = performance.now();
  overlayEl.hidden = true;
  songStatusEl.textContent = `${currentTrackName} 재생 중. 히트 라인에 맞춰 손동작을 입력하세요.`;
  missionEl.textContent = currentTrackMode === "upload"
    ? "업로드된 음악의 피크를 따라 생성된 노트를 맞춰 보세요."
    : "Perfect를 노리려면 노트가 히트 라인에 닿는 순간 입력하세요.";
  startPlayback();
  rafId = requestAnimationFrame(loop);
}

function resetGame() {
  cancelAnimationFrame(rafId);
  stopPlayback();
  running = false;
  score = 0;
  combo = 0;
  bestCombo = 0;
  stats.perfect = 0;
  stats.good = 0;
  stats.miss = 0;
  for (const note of notes) {
    note.judged = false;
    note.result = null;
  }
  for (const el of noteEls.values()) {
    el.hidden = false;
    el.classList.remove("note--hit");
  }
  judgeEl.textContent = "Ready";
  renderHud();
}

function loop() {
  const elapsed = performance.now() - startAt;
  drawNotes(elapsed);
  markMisses(elapsed);
  renderHud();
  if (elapsed > notes.at(-1).time + APPROACH) return endGame();
  rafId = requestAnimationFrame(loop);
}

function drawNotes(elapsed) {
  const height = notesLayer.clientHeight || 600;
  const hitY = height - 88;
  const laneWidth = notesLayer.clientWidth / LANES.length;
  for (const note of notes) {
    const el = noteEls.get(note.id);
    if (!el) continue;
    const t = note.time - elapsed;
    const p = clamp(1 - t / APPROACH, -0.15, 1.15);
    const x = LANES.indexOf(note.lane) * laneWidth;
    const y = p * hitY;
    const scale = 0.82 + Math.max(0, p) * 0.25;
    const opacity = note.judged ? 0.12 : clamp(0.35 + p * 0.9, 0.25, 1);
    el.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
    el.style.opacity = String(opacity);
    if (note.judged) {
      el.classList.add("note--hit");
      el.hidden = elapsed - note.time > 260;
    } else {
      el.classList.remove("note--hit");
      el.hidden = false;
    }
  }
}

function registerInput(lane, source) {
  gestureEl.textContent = LABELS[lane] ?? LABELS.WAITING;
  cameraStatusEl.textContent = source === "camera" ? `${LABELS[lane]} 입력 감지` : `${lane} 키 입력 감지`;
  if (!running) return;

  const elapsed = performance.now() - startAt;
  const note = notes.find((n) => !n.judged && n.lane === lane && Math.abs(elapsed - n.time) <= GOOD);
  if (!note) {
    combo = 0;
    judgeEl.textContent = "Miss";
    missionEl.textContent = "해당 타이밍에 맞는 노트가 없었습니다.";
    return;
  }

  note.judged = true;
  const delta = Math.abs(elapsed - note.time);
  if (delta <= PERFECT) {
    note.result = "PERFECT";
    score += 300;
    combo += 1;
    bestCombo = Math.max(bestCombo, combo);
    stats.perfect += 1;
    judgeEl.textContent = "Perfect";
    missionEl.textContent = `${LABELS[lane]} 입력이 완벽하게 맞았습니다.`;
    beep(840, 0.05, 0.08);
  } else {
    note.result = "GOOD";
    score += 150;
    combo += 1;
    bestCombo = Math.max(bestCombo, combo);
    stats.good += 1;
    judgeEl.textContent = "Good";
    missionEl.textContent = `${LABELS[lane]} 입력이 안정적으로 들어왔습니다.`;
    beep(560, 0.06, 0.08);
  }
}

function markMisses(elapsed) {
  for (const note of notes) {
    if (!note.judged && elapsed - note.time > GOOD) {
      note.judged = true;
      note.result = "MISS";
      combo = 0;
      stats.miss += 1;
      judgeEl.textContent = "Miss";
      missionEl.textContent = `${LABELS[note.lane]} 노트를 놓쳤습니다.`;
    }
  }
}

function endGame() {
  running = false;
  cancelAnimationFrame(rafId);
  stopPlayback();
  songStatusEl.textContent = `${currentTrackName} 종료. 최고 콤보 ${bestCombo}`;
  showOverlay(`곡 종료 - Score ${score}`, false);
}

function renderHud() {
  const total = stats.perfect + stats.good + stats.miss;
  const acc = total === 0 ? 100 : Math.round((stats.perfect * 100 + stats.good * 70) / total);
  scoreEl.textContent = String(score);
  comboEl.textContent = String(combo);
  accuracyEl.textContent = `${acc}%`;
}

function showOverlay(message, hidden) {
  overlayMsgEl.textContent = message;
  overlayEl.hidden = hidden;
}

function setupAudio() {
  window.addEventListener("pointerdown", resumeAudio, { passive: true });
  window.addEventListener("keydown", resumeAudio);
}

function resumeAudio() {
  if (!audio) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    audio = new Ctx();
  }
  if (audio.state === "suspended") audio.resume().catch(() => {});
}

async function decodeAudio(arrayBuffer) {
  if (!audio) resumeAudio();
  return audio.decodeAudioData(arrayBuffer.slice(0));
}

function startPlayback() {
  if (!audio || audio.state !== "running") return;
  if (currentTrackMode === "upload" && uploadedBuffer) {
    const source = audio.createBufferSource();
    source.buffer = uploadedBuffer;
    source.connect(audio.destination);
    source.start(audio.currentTime + 0.08);
    currentSource = source;
    return;
  }
  scheduleSampleTrack();
}

function stopPlayback() {
  if (currentSource) {
    try {
      currentSource.stop();
    } catch {}
    currentSource.disconnect?.();
    currentSource = null;
  }
}

function scheduleSampleTrack() {
  const step = (60 / SAMPLE_BPM) / 2;
  const base = audio.currentTime + 0.08;
  for (let i = 0; i < notes.length + 8; i += 1) {
    const down = i % 2 === 0;
    beep(down ? 140 : 220, down ? 0.11 : 0.06, down ? 0.12 : 0.06, base + i * step);
  }
}

function beep(freq, dur, gain, when = audio?.currentTime ?? 0) {
  if (!audio || audio.state !== "running") return;
  const osc = audio.createOscillator();
  const g = audio.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, when);
  g.gain.exponentialRampToValueAtTime(gain, when + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
  osc.connect(g);
  g.connect(audio.destination);
  osc.start(when);
  osc.stop(when + dur);
}

function createBeatmapFromAudio(buffer) {
  const mono = mixToMono(buffer);
  const sampleRate = buffer.sampleRate;
  const windowSize = Math.max(1024, Math.floor(sampleRate * 0.05));
  const energies = [];
  for (let start = 0; start < mono.length; start += windowSize) {
    let sum = 0;
    const end = Math.min(start + windowSize, mono.length);
    for (let i = start; i < end; i += 1) sum += mono[i] * mono[i];
    energies.push(Math.sqrt(sum / Math.max(1, end - start)));
  }

  const avg = energies.reduce((a, b) => a + b, 0) / Math.max(1, energies.length);
  const threshold = Math.max(avg * 1.45, 0.025);
  const minGapWindows = Math.max(3, Math.round(0.22 / (windowSize / sampleRate)));
  const peaks = [];
  let lastPeakIndex = -minGapWindows;

  for (let i = 1; i < energies.length - 1; i += 1) {
    const current = energies[i];
    if (current < threshold) continue;
    if (current < energies[i - 1] || current < energies[i + 1]) continue;
    if (i - lastPeakIndex < minGapWindows) continue;
    peaks.push(i);
    lastPeakIndex = i;
  }

  const lanePattern = ["LEFT", "UP", "DOWN", "RIGHT", "FIST", "LEFT", "RIGHT", "V_SIGN", "UP", "DOWN", "THUMBS_UP"];
  const baseOffset = 600;
  let chosenPeaks = peaks.slice(0, 72);
  if (chosenPeaks.length < 12) {
    chosenPeaks = [];
    const gap = Math.max(0.38, buffer.duration / 20);
    for (let t = 0.9; t < buffer.duration - 0.5; t += gap) {
      chosenPeaks.push(Math.floor((t * sampleRate) / windowSize));
    }
  }

  return chosenPeaks.map((peak, index) => {
    const timeSeconds = (peak * windowSize) / sampleRate;
    return makeNote(`upload-${index}`, lanePattern[index % lanePattern.length], baseOffset + timeSeconds * 1000);
  });
}

function mixToMono(buffer) {
  const mono = new Float32Array(buffer.length);
  const channels = buffer.numberOfChannels;
  for (let channel = 0; channel < channels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < buffer.length; i += 1) mono[i] += data[i] / channels;
  }
  return mono;
}

function setupCamera() {
  if (!window.Hands || !window.Camera || !navigator.mediaDevices) {
    cameraBtn.disabled = true;
    cameraStatusEl.textContent = "이 브라우저에서는 손 추적을 사용할 수 없습니다.";
    return;
  }
  cameraBtn.addEventListener("click", () => startCamera().catch(() => { cameraStatusEl.textContent = "카메라 권한을 확인해 주세요."; }));
  cameraSel.addEventListener("change", () => {
    selectedDeviceId = cameraSel.value;
    if (selectedDeviceId) startCamera({ force: true }).catch(() => {});
  });
  refreshBtn.addEventListener("click", () => refreshDevices({ ask: true }).catch(() => {}));
  navigator.mediaDevices.addEventListener?.("devicechange", () => refreshDevices().catch(() => {}));
  startCamera().catch(() => { cameraStatusEl.textContent = "자동 카메라 시작이 차단되었습니다."; });
}

async function startCamera(options = {}) {
  if (cameraController && !options.force) return;
  await stopCamera();
  cameraBtn.disabled = true;
  if (!hands) hands = makeHands(overlayCanvas.getContext("2d"));
  media = await getCameraStream();
  cameraEl.srcObject = media;
  await cameraEl.play();
  cameraController = new window.Camera(cameraEl, {
    onFrame: async () => hands.send({ image: cameraEl }),
  });
  await cameraController.start();
  await refreshDevices();
  cameraBtn.disabled = false;
  cameraBtn.textContent = "카메라 연결됨";
  cameraStatusEl.textContent = `${currentCameraLabel()}로 손 입력 추적 중`;
}

function makeHands(ctx) {
  const h = new window.Hands({
    locateFile(file) {
      return `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`;
    },
  });
  h.setOptions({ maxNumHands: 1, modelComplexity: 1, minDetectionConfidence: 0.7, minTrackingConfidence: 0.6 });
  h.onResults((results) => {
    syncCanvas(results.image);
    drawHands(ctx, results);
    onHands(results);
  });
  return h;
}

function syncCanvas(src) {
  const w = src.videoWidth ?? src.width;
  const h = src.videoHeight ?? src.height;
  if (!w || !h) return;
  if (overlayCanvas.width !== w || overlayCanvas.height !== h) {
    overlayCanvas.width = w;
    overlayCanvas.height = h;
  }
}

function drawHands(ctx, results) {
  ctx.save();
  ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
  for (const lm of results.multiHandLandmarks ?? []) {
    window.drawConnectors(ctx, lm, window.HAND_CONNECTIONS, { color: "#7ce6ff", lineWidth: 4 });
    window.drawLandmarks(ctx, lm, { color: "#fff5a8", lineWidth: 1, radius: 4 });
  }
  ctx.restore();
}

function onHands(results) {
  const lm = results.multiHandLandmarks?.[0];
  if (!lm) {
    gestureEl.textContent = LABELS.WAITING;
    lastCameraGesture = "";
    return;
  }
  const raw = classify(lm);
  const stable = stableGesture(raw);
  if (!stable || stable === "WAITING") return;
  const now = performance.now();
  if (stable === lastCameraGesture && now - lastCameraGestureAt < CAMERA_COOLDOWN) return;
  lastCameraGesture = stable;
  lastCameraGestureAt = now;
  registerInput(stable, "camera");
}

function stableGesture(next) {
  gestureHistory.push(next);
  if (gestureHistory.length > STABLE) gestureHistory.shift();
  if (gestureHistory.length < STABLE) return null;
  return gestureHistory.every((v) => v === next) ? next : null;
}

function classify(lm) {
  const palm = palmSize(lm);
  const fingers = fingerStates(lm, palm);
  if (!fingers.thumb && !fingers.index && !fingers.middle && !fingers.ring && !fingers.pinky) return "FIST";
  if (!fingers.thumb && fingers.index && fingers.middle && !fingers.ring && !fingers.pinky && Math.abs(lm[8].x - lm[12].x) > 0.05) return "V_SIGN";
  if (fingers.thumb && !fingers.index && !fingers.middle && !fingers.ring && !fingers.pinky && lm[4].y < lm[2].y - palm * 0.15) return "THUMBS_UP";
  return detectDir(lm, palm);
}

function detectDir(lm, palm = palmSize(lm)) {
  const wrist = lm[0];
  const tip = lm[8];
  const dx = tip.x - wrist.x;
  const dy = tip.y - wrist.y;
  if (dist(tip, wrist) / palm < 1.1) return "WAITING";
  if (Math.abs(dx) > Math.abs(dy) * 0.9) return dx > 0 ? "RIGHT" : "LEFT";
  return dy > 0 ? "DOWN" : "UP";
}

function fingerStates(lm, palm) {
  return {
    thumb: thumbExtended(lm, palm),
    index: fingerExtended(lm, 5, 6, 8, palm),
    middle: fingerExtended(lm, 9, 10, 12, palm),
    ring: fingerExtended(lm, 13, 14, 16, palm),
    pinky: fingerExtended(lm, 17, 18, 20, palm),
  };
}

function fingerExtended(lm, mcpI, pipI, tipI, palm) {
  const mcp = lm[mcpI];
  const pip = lm[pipI];
  const tip = lm[tipI];
  return dist(tip, mcp) / palm > Math.max(0.72, (dist(pip, mcp) / palm) * 1.18);
}

function thumbExtended(lm, palm) {
  return dist(lm[4], lm[2]) / palm > Math.max(0.55, (dist(lm[3], lm[2]) / palm) * 1.14);
}

function palmSize(lm) {
  return Math.max((dist(lm[0], lm[5]) + dist(lm[0], lm[17]) + dist(lm[5], lm[17])) / 3, 0.08);
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

async function getCameraStream() {
  const video = selectedDeviceId
    ? { deviceId: { exact: selectedDeviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }
    : { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ? "user" : undefined };
  const stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
  const settings = stream.getVideoTracks()[0]?.getSettings?.() ?? {};
  if (settings.deviceId) selectedDeviceId = settings.deviceId;
  return stream;
}

async function stopCamera() {
  if (cameraController?.stop) await cameraController.stop();
  cameraController = null;
  if (media) media.getTracks().forEach((t) => t.stop());
  media = null;
  cameraEl.srcObject = null;
}

async function refreshDevices(options = {}) {
  if (!navigator.mediaDevices?.enumerateDevices) return fillDevices([]);
  if (options.ask && !media) {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      s.getTracks().forEach((t) => t.stop());
    } catch {}
  }
  devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "videoinput");
  if (!selectedDeviceId) selectedDeviceId = preferredCamera(devices)?.deviceId ?? "";
  fillDevices(devices);
}

function fillDevices(list) {
  cameraSel.replaceChildren();
  if (!list.length) {
    const o = document.createElement("option");
    o.value = "";
    o.textContent = "사용 가능한 카메라 없음";
    cameraSel.appendChild(o);
    cameraSel.disabled = true;
    return;
  }
  cameraSel.disabled = false;
  list.forEach((d, i) => {
    const o = document.createElement("option");
    o.value = d.deviceId;
    o.textContent = d.label || `카메라 ${i + 1}`;
    cameraSel.appendChild(o);
  });
  if (!list.some((d) => d.deviceId === selectedDeviceId)) selectedDeviceId = preferredCamera(list)?.deviceId ?? list[0].deviceId;
  cameraSel.value = selectedDeviceId;
}

function preferredCamera(list) {
  const p = [/camo/i, /iphone/i, /ios/i, /continuity/i, /epoccam/i];
  return list.find((d) => p.some((re) => re.test(d.label))) ?? list.find((d) => /front|facetime/i.test(d.label)) ?? list[0] ?? null;
}

function currentCameraLabel() {
  return devices.find((d) => d.deviceId === selectedDeviceId)?.label ?? preferredCamera(devices)?.label ?? "선택한 카메라";
}

function formatLane(lane) {
  return lane === "V_SIGN" ? "V" : lane === "THUMBS_UP" ? "THUMB" : lane;
}

function clamp(v, min, max) {
  return Math.min(Math.max(v, min), max);
}
