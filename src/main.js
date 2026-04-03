import {
  GRID_SIZE,
  createInitialState,
  queueDirection,
  restartGame,
  stepGame,
} from "./gameLogic.js";

const TICK_MS = 140;
const TURBO_TICK_MS = 80;
const BOOST_SCORE_PER_FOOD = 20;
const NORMAL_SCORE_PER_FOOD = 10;
const RPS_WIN_BONUS_SCORE = 30;
const RPS_BONUS_TURBO_MS = 8000;
const KEY_TO_DIRECTION = {
  ArrowUp: "UP",
  ArrowDown: "DOWN",
  ArrowLeft: "LEFT",
  ArrowRight: "RIGHT",
  w: "UP",
  W: "UP",
  s: "DOWN",
  S: "DOWN",
  a: "LEFT",
  A: "LEFT",
  d: "RIGHT",
  D: "RIGHT",
};
const GESTURE_LABELS = {
  UP: "위",
  DOWN: "아래",
  LEFT: "왼쪽",
  RIGHT: "오른쪽",
  FIST: "주먹",
  V_SIGN: "브이",
  THUMBS_UP: "엄지척",
  OPEN_HAND: "손바닥",
  WAITING: "대기 중",
};
const GESTURE_HOLD_MS = 180;
const STABLE_POSE_FRAMES = 4;
const STABLE_DIRECTION_FRAMES = 3;
const HAND_KEYS = ["Left", "Right"];
const RPS_POSES = ["FIST", "V_SIGN", "OPEN_HAND"];
const RPS_LABELS = {
  FIST: "바위",
  V_SIGN: "가위",
  OPEN_HAND: "보",
};

const boardElement = document.querySelector("#board");
const scoreElement = document.querySelector("#score");
const overlayElement = document.querySelector("#overlay");
const overlayMessageElement = document.querySelector("#overlay-message");
const restartButtonElement = document.querySelector("#restart-button");
const restartInlineElement = document.querySelector("#restart-inline");
const cameraElement = document.querySelector("#camera");
const cameraOverlayElement = document.querySelector("#camera-overlay");
const cameraButtonElement = document.querySelector("#camera-button");
const cameraSelectElement = document.querySelector("#camera-select");
const refreshCamerasElement = document.querySelector("#refresh-cameras");
const cameraStatusElement = document.querySelector("#camera-status");
const gestureLabelElement = document.querySelector("#gesture-label");
const handednessLabelElement = document.querySelector("#handedness-label");
const modeLabelElement = document.querySelector("#mode-label");
const rpsStatusElement = document.querySelector("#rps-status");
const bonusStatusElement = document.querySelector("#bonus-status");
const leftHandPoseElement = document.querySelector("#left-hand-pose");
const rightHandPoseElement = document.querySelector("#right-hand-pose");

let state = createInitialState({ gridSize: GRID_SIZE });
let intervalId = null;
let cameraController = null;
let handsInstance = null;
let currentMediaStream = null;
let audioContext = null;
let activeGesture = null;
let lastGestureAt = 0;
let handledActionGesture = null;
let countdownTimeoutId = null;
let turboTimeoutId = null;
let isPaused = false;
let manualTurboEnabled = false;
let bonusTurboEnabled = false;
let hasStarted = false;
let activeHandedness = "손 정보 대기 중";
let rpsWinnerSignature = null;
let previousGameOver = false;
let selectedCameraDeviceId = "";
let availableCameras = [];
const handTrackers = {
  Left: createHandTracker(),
  Right: createHandTracker(),
};

buildBoard(state.gridSize);
render(state);
setupCameraControls();
setupFeedbackControls();

document.addEventListener("keydown", (event) => {
  if (!hasStarted && event.key === "Enter") {
    event.preventDefault();
    startGameFromStandby();
    return;
  }

  const nextDirection = KEY_TO_DIRECTION[event.key];
  if (!nextDirection) {
    return;
  }

  event.preventDefault();

  if (!hasStarted || isPaused || state.isGameOver) {
    return;
  }

  state = queueDirection(state, nextDirection);
});

restartButtonElement.addEventListener("click", startGameFromStandby);
restartInlineElement.addEventListener("click", startGameFromStandby);

function startGameFromStandby() {
  stopCountdown();
  stopTurboBonus();
  state = restartGame({ gridSize: GRID_SIZE });
  isPaused = false;
  manualTurboEnabled = false;
  bonusTurboEnabled = false;
  hasStarted = true;
  rpsWinnerSignature = null;
  render(state);
  startLoop();
  cameraStatusElement.textContent = "게임을 시작했습니다. 손 방향이나 키보드로 움직여 보세요.";
  bonusStatusElement.textContent = "보너스 대기 중";
  playToneSequence([440, 660], 0.08);
  vibrate([35, 20, 45]);
}

function startLoop() {
  if (isPaused || !hasStarted) {
    stopLoop();
    return;
  }

  stopLoop();
  intervalId = window.setInterval(() => {
    state = stepGame(state, {
      scorePerFood: isTurboActive() ? BOOST_SCORE_PER_FOOD : NORMAL_SCORE_PER_FOOD,
    });
    render(state);

    if (state.isGameOver) {
      stopLoop();
    }
  }, getTickMs());
}

function stopLoop() {
  if (intervalId !== null) {
    window.clearInterval(intervalId);
    intervalId = null;
  }
}

function buildBoard(gridSize) {
  const fragment = document.createDocumentFragment();
  boardElement.style.gridTemplateColumns = `repeat(${gridSize}, 1fr)`;

  for (let index = 0; index < gridSize * gridSize; index += 1) {
    const cell = document.createElement("div");
    cell.className = "cell";
    cell.setAttribute("role", "gridcell");
    fragment.appendChild(cell);
  }

  boardElement.replaceChildren(fragment);
}

function render(nextState) {
  const cells = boardElement.children;
  const snakeLookup = new Map(nextState.snake.map((cell, index) => [toCellKey(cell), index]));
  const foodKey = toCellKey(nextState.food);

  for (let y = 0; y < nextState.gridSize; y += 1) {
    for (let x = 0; x < nextState.gridSize; x += 1) {
      const key = `${x},${y}`;
      const cellIndex = y * nextState.gridSize + x;
      const cellElement = cells[cellIndex];

      cellElement.className = "cell";
      if (key === foodKey) {
        cellElement.classList.add("cell--food");
      }

      if (snakeLookup.has(key)) {
        cellElement.classList.add("cell--snake");
        if (snakeLookup.get(key) === 0) {
          cellElement.classList.add("cell--head");
        }
      }
    }
  }

  scoreElement.textContent = String(nextState.score);

  if (!hasStarted) {
    overlayMessageElement.textContent = "엄지척 또는 Enter로 시작";
    overlayElement.hidden = false;
  } else if (isPaused) {
    overlayMessageElement.textContent = isTurboActive() ? "일시정지 - 부스트 모드" : "일시정지";
    overlayElement.hidden = false;
  } else if (nextState.isGameOver) {
    overlayMessageElement.textContent = `게임 오버 - 점수 ${nextState.score}`;
    overlayElement.hidden = false;
    restartButtonElement.focus();
  } else {
    overlayElement.hidden = true;
  }

  if (nextState.isGameOver && !previousGameOver) {
    playToneSequence([240, 180], 0.12);
    vibrate([80, 30, 120]);
  }

  previousGameOver = nextState.isGameOver;
}

function toCellKey(cell) {
  return `${cell.x},${cell.y}`;
}

function setupCameraControls() {
  if (!window.Hands || !window.Camera) {
    cameraStatusElement.textContent =
      "손 인식 라이브러리를 불러오지 못했습니다. 인터넷 연결을 확인하거나 키보드로 플레이해 주세요.";
    cameraButtonElement.disabled = true;
    return;
  }

  cameraButtonElement.addEventListener("click", () => {
    startCamera().catch((error) => {
      console.error(error);
      cameraButtonElement.disabled = false;
      cameraStatusElement.textContent =
        "카메라에 접근하지 못했습니다. 브라우저 권한을 허용한 뒤 다시 시도해 주세요.";
    });
  });

  cameraSelectElement.addEventListener("change", () => {
    selectedCameraDeviceId = cameraSelectElement.value;
    if (!selectedCameraDeviceId) {
      return;
    }

    startCamera({ forceRestart: true }).catch((error) => {
      console.error(error);
      cameraStatusElement.textContent =
        "선택한 카메라로 전환하지 못했습니다. 다시 시도해 주세요.";
    });
  });

  refreshCamerasElement.addEventListener("click", () => {
    refreshCameraDevices({ requestPermission: true }).catch((error) => {
      console.error(error);
      cameraStatusElement.textContent =
        "카메라 목록을 새로고침하지 못했습니다. 권한을 확인해 주세요.";
    });
  });

  navigator.mediaDevices?.addEventListener?.("devicechange", () => {
    refreshCameraDevices().catch(() => {});
  });

  startCamera().catch(() => {
    cameraButtonElement.disabled = false;
    cameraStatusElement.textContent =
      "자동 카메라 시작이 브라우저에서 차단되었습니다. 버튼을 눌러 시작해 주세요.";
  });
}

async function startCamera(options = {}) {
  const forceRestart = options.forceRestart ?? false;
  if (cameraController && !forceRestart) {
    return;
  }

  cameraStatusElement.textContent = "카메라와 손 추적 모델을 준비하고 있습니다...";
  cameraButtonElement.disabled = true;
  await stopCameraStream();

  const overlayContext = cameraOverlayElement.getContext("2d");
  if (!handsInstance) {
    handsInstance = createHandsInstance(overlayContext);
  }

  currentMediaStream = await requestCameraStream();
  cameraElement.srcObject = currentMediaStream;
  await cameraElement.play();

  cameraController = new window.Camera(cameraElement, {
    onFrame: async () => {
      await handsInstance.send({ image: cameraElement });
    },
  });

  await cameraController.start();
  await refreshCameraDevices();
  cameraButtonElement.textContent = "카메라 연결됨";
  cameraStatusElement.textContent = getSelectedCameraStatus();
  playToneSequence([520, 720], 0.05);
  cameraButtonElement.disabled = false;
}

function syncCanvasSize(source) {
  const width = source.videoWidth ?? source.width;
  const height = source.videoHeight ?? source.height;

  if (!width || !height) {
    return;
  }

  if (
    cameraOverlayElement.width === width &&
    cameraOverlayElement.height === height
  ) {
    return;
  }

  cameraOverlayElement.width = width;
  cameraOverlayElement.height = height;
}

function drawResults(context, results) {
  context.save();
  context.clearRect(0, 0, cameraOverlayElement.width, cameraOverlayElement.height);

  if (results.multiHandLandmarks?.length) {
    for (const landmarks of results.multiHandLandmarks) {
      window.drawConnectors(context, landmarks, window.HAND_CONNECTIONS, {
        color: "#7dc4ff",
        lineWidth: 4,
      });
      window.drawLandmarks(context, landmarks, {
        color: "#fff0a8",
        lineWidth: 1,
        radius: 4,
      });
    }
  }

  context.restore();
}

function createHandsInstance(overlayContext) {
  const hands = new window.Hands({
    locateFile(file) {
      return `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`;
    },
  });

  hands.setOptions({
    maxNumHands: 2,
    modelComplexity: 1,
    minDetectionConfidence: 0.7,
    minTrackingConfidence: 0.6,
  });

  hands.onResults((results) => {
    syncCanvasSize(results.image);
    drawResults(overlayContext, results);
    updateGestureFromResults(results);
  });

  return hands;
}

async function requestCameraStream() {
  const constraints = {
    audio: false,
    video: selectedCameraDeviceId
      ? {
          deviceId: { exact: selectedCameraDeviceId },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        }
      : {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: isMobileDevice() ? "user" : undefined,
        },
  };

  const stream = await navigator.mediaDevices.getUserMedia(constraints);
  const track = stream.getVideoTracks()[0];
  const settings = track.getSettings?.() ?? {};
  if (settings.deviceId) {
    selectedCameraDeviceId = settings.deviceId;
  }
  return stream;
}

async function stopCameraStream() {
  if (cameraController?.stop) {
    await cameraController.stop();
  }
  cameraController = null;

  if (currentMediaStream) {
    for (const track of currentMediaStream.getTracks()) {
      track.stop();
    }
    currentMediaStream = null;
  }

  if (cameraElement.srcObject) {
    cameraElement.srcObject = null;
  }
}

async function refreshCameraDevices(options = {}) {
  const requestPermission = options.requestPermission ?? false;
  if (!navigator.mediaDevices?.enumerateDevices) {
    populateCameraOptions([]);
    return;
  }

  if (requestPermission && !currentMediaStream) {
    try {
      const permissionStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      permissionStream.getTracks().forEach((track) => track.stop());
    } catch (error) {
      console.error(error);
    }
  }

  const devices = await navigator.mediaDevices.enumerateDevices();
  availableCameras = devices.filter((device) => device.kind === "videoinput");
  if (!selectedCameraDeviceId) {
    const preferredCamera = pickPreferredCamera(availableCameras);
    selectedCameraDeviceId = preferredCamera?.deviceId ?? "";
  }
  populateCameraOptions(availableCameras);
}

function populateCameraOptions(devices) {
  cameraSelectElement.replaceChildren();

  if (!devices.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "사용 가능한 카메라 없음";
    cameraSelectElement.appendChild(option);
    cameraSelectElement.disabled = true;
    return;
  }

  cameraSelectElement.disabled = false;
  for (const [index, device] of devices.entries()) {
    const option = document.createElement("option");
    option.value = device.deviceId;
    option.textContent = device.label || `카메라 ${index + 1}`;
    cameraSelectElement.appendChild(option);
  }

  if (!devices.some((device) => device.deviceId === selectedCameraDeviceId)) {
    selectedCameraDeviceId = pickPreferredCamera(devices)?.deviceId ?? devices[0].deviceId;
  }

  cameraSelectElement.value = selectedCameraDeviceId;
}

function pickPreferredCamera(devices) {
  const preferredPatterns = [/camo/i, /iphone/i, /ios/i, /continuity/i, /epoccam/i];
  return (
    devices.find((device) => preferredPatterns.some((pattern) => pattern.test(device.label))) ??
    devices.find((device) => /front|facetime/i.test(device.label)) ??
    devices[0] ??
    null
  );
}

function getSelectedCameraStatus() {
  const currentCamera =
    availableCameras.find((device) => device.deviceId === selectedCameraDeviceId) ??
    pickPreferredCamera(availableCameras);

  if (!currentCamera) {
    return "손이 보이면 방향을 인식합니다. 검지 방향을 크게 움직여 보세요.";
  }

  return `${currentCamera.label || "선택한 카메라"}로 연결되었습니다. 손이 보이면 방향을 인식합니다.`;
}

function updateGestureFromResults(results) {
  const landmarksList = results.multiHandLandmarks ?? [];
  const handednessList = results.multiHandedness ?? [];

  if (!landmarksList.length) {
    resetHandTrackingUi();
    return;
  }

  const detections = landmarksList.map((landmarks, index) =>
    buildHandDetection(landmarks, handednessList[index]?.label, index)
  );
  resetMissingHandTrackers(detections);

  syncHandPanels(detections);

  if (handleRpsMode(detections)) {
    return;
  }

  modeLabelElement.textContent = "싱글 핸드 조작 모드";
  rpsStatusElement.textContent = "한 손으로 방향과 액션 제스처를 조작하고 있습니다.";

  const primaryHand = selectPrimaryHand(detections);
  if (!primaryHand) {
    gestureLabelElement.textContent = GESTURE_LABELS.WAITING;
    activeGesture = null;
    handledActionGesture = null;
    return;
  }

  activeHandedness = `${primaryHand.displayName} 제어 중`;
  handednessLabelElement.textContent = activeHandedness;
  gestureLabelElement.textContent = GESTURE_LABELS[primaryHand.label] ?? GESTURE_LABELS.WAITING;

  if (primaryHand.label === "FIST") {
    maybeTriggerGestureAction("FIST", togglePause);
    return;
  }

  if (primaryHand.label === "V_SIGN") {
    maybeTriggerGestureAction("V_SIGN", toggleBoostMode);
    return;
  }

  if (primaryHand.label === "THUMBS_UP") {
    maybeTriggerGestureAction("THUMBS_UP", handleThumbsUp);
    return;
  }

  if (primaryHand.label === "WAITING" || !primaryHand.direction) {
    activeGesture = null;
    handledActionGesture = null;
    return;
  }

  applyDirectionGesture(primaryHand.direction);
}

function buildHandDetection(landmarks, handednessLabel, index) {
  const handKey = normalizeHandKey(handednessLabel, index);
  const tracker = handTrackers[handKey];
  const rawHandPose = classifyHandPose(landmarks);
  const stablePoseLabel = getStableValue(tracker.poseHistory, rawHandPose.label, STABLE_POSE_FRAMES);
  const stableDirection = rawHandPose.direction
    ? getStableValue(tracker.directionHistory, rawHandPose.direction, STABLE_DIRECTION_FRAMES)
    : clearDirectionHistory(tracker);

  return {
    handKey,
    displayName: formatHandedness(handKey),
    label: stablePoseLabel ?? "WAITING",
    direction: stableDirection,
  };
}

function applyDirectionGesture(nextGesture) {
  const now = performance.now();
  if (nextGesture !== activeGesture) {
    activeGesture = nextGesture;
    lastGestureAt = now;
    return;
  }

  if (now - lastGestureAt < GESTURE_HOLD_MS) {
    return;
  }

  cameraStatusElement.textContent = getModeStatusMessage();
  if (hasStarted && !isPaused && !state.isGameOver) {
    state = queueDirection(state, nextGesture);
  }
  lastGestureAt = now;
}

function maybeTriggerGestureAction(label, action) {
  if (activeGesture !== label) {
    activeGesture = label;
    handledActionGesture = null;
    return;
  }

  if (handledActionGesture === label) {
    return;
  }

  handledActionGesture = label;
  action();
}

function getStableValue(history, nextValue, requiredFrames) {
  history.push(nextValue);
  if (history.length > requiredFrames) {
    history.shift();
  }

  if (history.length < requiredFrames) {
    return null;
  }

  return history.every((value) => value === nextValue) ? nextValue : null;
}

function clearDirectionHistory(tracker) {
  tracker.directionHistory = [];
  return null;
}

function createHandTracker() {
  return {
    poseHistory: [],
    directionHistory: [],
  };
}

function resetHandTrackingUi() {
  activeGesture = null;
  handledActionGesture = null;
  lastGestureAt = 0;
  activeHandedness = "손 정보 대기 중";
  rpsWinnerSignature = null;

  for (const handKey of HAND_KEYS) {
    handTrackers[handKey] = createHandTracker();
  }

  gestureLabelElement.textContent = GESTURE_LABELS.WAITING;
  handednessLabelElement.textContent = activeHandedness;
  modeLabelElement.textContent = "싱글 핸드 조작 모드";
  rpsStatusElement.textContent = "양손이 잡히면 가위바위보 판정이 시작됩니다.";
  bonusStatusElement.textContent = "보너스 대기 중";
  leftHandPoseElement.textContent = "왼손: 대기 중";
  rightHandPoseElement.textContent = "오른손: 대기 중";
}

function resetMissingHandTrackers(detections) {
  for (const handKey of HAND_KEYS) {
    if (!detections.some((detection) => detection.handKey === handKey)) {
      handTrackers[handKey] = createHandTracker();
    }
  }
}

function normalizeHandKey(handednessLabel, index) {
  if (handednessLabel === "Left" || handednessLabel === "Right") {
    return handednessLabel;
  }

  return HAND_KEYS[index] ?? "Right";
}

function syncHandPanels(detections) {
  const leftHand = detections.find((detection) => detection.handKey === "Left");
  const rightHand = detections.find((detection) => detection.handKey === "Right");
  const summary = detections
    .map((detection) => `${detection.displayName}: ${describePose(detection.label, detection.direction)}`)
    .join(" / ");

  activeHandedness = summary || "손 정보 확인 중";
  handednessLabelElement.textContent = activeHandedness;
  leftHandPoseElement.textContent = `왼손: ${describePose(leftHand?.label ?? "WAITING", leftHand?.direction ?? null)}`;
  rightHandPoseElement.textContent = `오른손: ${describePose(rightHand?.label ?? "WAITING", rightHand?.direction ?? null)}`;
}

function describePose(label, direction) {
  if (RPS_POSES.includes(label)) {
    return RPS_LABELS[label];
  }

  if (label === "WAITING") {
    return "대기 중";
  }

  return GESTURE_LABELS[direction ?? label] ?? "대기 중";
}

function selectPrimaryHand(detections) {
  return (
    detections.find((detection) => detection.handKey === "Right" && detection.label !== "WAITING") ??
    detections.find((detection) => detection.handKey === "Left" && detection.label !== "WAITING") ??
    null
  );
}

function handleRpsMode(detections) {
  const rpsHands = detections.filter((detection) => RPS_POSES.includes(detection.label));
  if (rpsHands.length < 2) {
    rpsWinnerSignature = null;
    return false;
  }

  const leftHand = rpsHands.find((detection) => detection.handKey === "Left") ?? rpsHands[0];
  const rightHand = rpsHands.find((detection) => detection.handKey === "Right") ?? rpsHands[1];
  if (!leftHand || !rightHand || leftHand === rightHand) {
    return false;
  }

  const result = decideRpsWinner(leftHand.label, rightHand.label);
  const signature = `${leftHand.label}:${rightHand.label}:${result}`;
  modeLabelElement.textContent = "듀얼 핸드 가위바위보 모드";
  rpsStatusElement.textContent = buildRpsStatus(leftHand.label, rightHand.label, result);
  gestureLabelElement.textContent = "가위바위보";
  handednessLabelElement.textContent = `${leftHand.displayName} vs ${rightHand.displayName}`;
  activeGesture = null;
  handledActionGesture = null;

  if (signature !== rpsWinnerSignature) {
    rpsWinnerSignature = signature;
    const statusMessage = buildRpsStatus(leftHand.label, rightHand.label, result);
    cameraStatusElement.textContent = statusMessage;
    applyRpsBonus(result, statusMessage);
  }

  return true;
}

function decideRpsWinner(leftLabel, rightLabel) {
  if (leftLabel === rightLabel) {
    return "DRAW";
  }

  const leftWins =
    (leftLabel === "FIST" && rightLabel === "V_SIGN") ||
    (leftLabel === "V_SIGN" && rightLabel === "OPEN_HAND") ||
    (leftLabel === "OPEN_HAND" && rightLabel === "FIST");

  return leftWins ? "LEFT" : "RIGHT";
}

function buildRpsStatus(leftLabel, rightLabel, winner) {
  const leftName = RPS_LABELS[leftLabel];
  const rightName = RPS_LABELS[rightLabel];

  if (winner === "DRAW") {
    return `왼손 ${leftName}, 오른손 ${rightName}. 비겼습니다.`;
  }

  return winner === "LEFT"
    ? `왼손 ${leftName}, 오른손 ${rightName}. 왼손 승리입니다.`
    : `왼손 ${leftName}, 오른손 ${rightName}. 오른손 승리입니다.`;
}

function classifyHandPose(landmarks) {
  const palmSize = getPalmSize(landmarks);
  const fingerStates = getFingerStates(landmarks, palmSize);
  const thumbExtended = fingerStates.thumb;
  const indexExtended = fingerStates.index;
  const middleExtended = fingerStates.middle;
  const ringExtended = fingerStates.ring;
  const pinkyExtended = fingerStates.pinky;

  if (!thumbExtended && !indexExtended && !middleExtended && !ringExtended && !pinkyExtended) {
    return { label: "FIST", direction: null };
  }

  if (!thumbExtended && indexExtended && middleExtended && !ringExtended && !pinkyExtended) {
    const spread = Math.abs(landmarks[8].x - landmarks[12].x);
    if (spread > 0.05) {
      return { label: "V_SIGN", direction: null };
    }
  }

  if (
    thumbExtended &&
    !indexExtended &&
    !middleExtended &&
    !ringExtended &&
    !pinkyExtended &&
    landmarks[4].y < landmarks[2].y - palmSize * 0.15
  ) {
    return { label: "THUMBS_UP", direction: null };
  }

  if (thumbExtended && indexExtended && middleExtended && ringExtended && pinkyExtended) {
    return { label: "OPEN_HAND", direction: detectDirection(landmarks, palmSize) };
  }

  const direction = detectDirection(landmarks, palmSize);
  return { label: direction, direction };
}

function detectDirection(landmarks, palmSize = getPalmSize(landmarks)) {
  const wrist = landmarks[0];
  const indexBase = landmarks[5];
  const indexTip = landmarks[8];
  const dx = indexTip.x - wrist.x;
  const dy = indexTip.y - wrist.y;
  const extensionRatio = distance(indexTip, wrist) / palmSize;

  if (extensionRatio < 1.15) {
    return state.direction;
  }

  if (Math.abs(dx) > Math.abs(dy) * 0.9) {
    return dx > 0 ? "RIGHT" : "LEFT";
  }

  return dy > 0 ? "DOWN" : "UP";
}

function getFingerStates(landmarks, palmSize) {
  return {
    thumb: isThumbExtended(landmarks, palmSize),
    index: isFingerExtended(landmarks, 5, 6, 8, palmSize),
    middle: isFingerExtended(landmarks, 9, 10, 12, palmSize),
    ring: isFingerExtended(landmarks, 13, 14, 16, palmSize),
    pinky: isFingerExtended(landmarks, 17, 18, 20, palmSize),
  };
}

function isFingerExtended(landmarks, mcpIndex, pipIndex, tipIndex, palmSize) {
  const mcp = landmarks[mcpIndex];
  const pip = landmarks[pipIndex];
  const tip = landmarks[tipIndex];
  const tipDistance = distance(tip, mcp) / palmSize;
  const pipDistance = distance(pip, mcp) / palmSize;

  return tipDistance > Math.max(0.72, pipDistance * 1.18);
}

function isThumbExtended(landmarks, palmSize) {
  const thumbTip = landmarks[4];
  const thumbIp = landmarks[3];
  const thumbMcp = landmarks[2];
  const reach = distance(thumbTip, thumbMcp) / palmSize;
  const bend = distance(thumbIp, thumbMcp) / palmSize;

  return reach > Math.max(0.55, bend * 1.14);
}

function getPalmSize(landmarks) {
  const baseSpan =
    distance(landmarks[0], landmarks[5]) +
    distance(landmarks[0], landmarks[17]) +
    distance(landmarks[5], landmarks[17]);

  return Math.max(baseSpan / 3, 0.08);
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function setupFeedbackControls() {
  const resumeAudio = () => {
    ensureAudioContext();
    if (audioContext?.state === "suspended") {
      audioContext.resume().catch(() => {});
    }
  };

  window.addEventListener("pointerdown", resumeAudio, { passive: true });
  window.addEventListener("keydown", resumeAudio);
}

function ensureAudioContext() {
  if (!audioContext) {
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) {
      return null;
    }

    audioContext = new AudioContextCtor();
  }

  return audioContext;
}

function playToneSequence(frequencies, durationSeconds) {
  const context = ensureAudioContext();
  if (!context || context.state !== "running") {
    return;
  }

  let startTime = context.currentTime;
  for (const frequency of frequencies) {
    const oscillator = context.createOscillator();
    const gainNode = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = frequency;
    gainNode.gain.setValueAtTime(0.0001, startTime);
    gainNode.gain.exponentialRampToValueAtTime(0.08, startTime + 0.01);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, startTime + durationSeconds);
    oscillator.connect(gainNode);
    gainNode.connect(context.destination);
    oscillator.start(startTime);
    oscillator.stop(startTime + durationSeconds);
    startTime += durationSeconds + 0.03;
  }
}

function vibrate(pattern) {
  if (navigator.vibrate) {
    navigator.vibrate(pattern);
  }
}

function formatHandedness(label) {
  if (label === "Left") {
    return "왼손";
  }

  if (label === "Right") {
    return "오른손";
  }

  return "손 정보 확인 중";
}

function isMobileDevice() {
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

function togglePause() {
  if (!hasStarted) {
    cameraStatusElement.textContent = "게임 시작 전입니다. 엄지척으로 먼저 시작해 주세요.";
    return;
  }

  if (state.isGameOver) {
    cameraStatusElement.textContent = "게임 오버 상태에서는 엄지척으로 다시 시작해 주세요.";
    return;
  }

  if (isPaused) {
    beginResumeCountdown();
    return;
  }

  stopCountdown();
  isPaused = true;
  render(state);
  cameraStatusElement.textContent = isTurboActive()
    ? "주먹을 인식해 일시정지했습니다. 현재 부스트 모드가 켜져 있습니다."
    : "주먹을 인식해 일시정지했습니다.";
  stopLoop();
  playToneSequence([320], 0.12);
  vibrate([60]);
}

function toggleBoostMode() {
  if (!hasStarted) {
    cameraStatusElement.textContent = "게임 시작 전입니다. 엄지척으로 먼저 시작해 주세요.";
    return;
  }

  manualTurboEnabled = !manualTurboEnabled;
  render(state);

  if (!isPaused && !state.isGameOver) {
    startLoop();
  }

  cameraStatusElement.textContent = isTurboActive()
    ? "브이를 인식해 부스트 모드를 켰습니다. 먹이를 먹으면 20점을 얻습니다."
    : "브이를 인식해 일반 모드로 전환했습니다. 먹이는 다시 10점입니다.";
  bonusStatusElement.textContent = isTurboActive() ? "부스트 활성화" : "기본 속도";
  playToneSequence(isTurboActive() ? [760, 920] : [420], 0.08);
  vibrate(isTurboActive() ? [35, 15, 35] : [30]);
}

function handleThumbsUp() {
  if (!hasStarted || state.isGameOver) {
    startGameFromStandby();
    return;
  }

  cameraStatusElement.textContent = "엄지척은 시작 대기 화면이나 게임 오버 상태에서 재시작할 때 사용합니다.";
}

function getTickMs() {
  return isTurboActive() ? TURBO_TICK_MS : TICK_MS;
}

function getModeStatusMessage() {
  if (!hasStarted) {
    return "엄지척 또는 Enter를 누르면 게임이 시작됩니다.";
  }

  if (isPaused) {
    return isTurboActive() ? "일시정지 중입니다. 현재 부스트 모드가 켜져 있습니다." : "일시정지 중입니다.";
  }

  if (isTurboActive()) {
    return "손이 보이면 방향을 인식합니다. 현재 부스트 모드이며 먹이는 20점입니다.";
  }

  return "손이 보이면 방향을 인식합니다. 검지 방향을 크게 움직여 보세요.";
}

function beginResumeCountdown() {
  stopCountdown();
  let count = 3;
  overlayMessageElement.textContent = `${count}초 후 재개`;
  overlayElement.hidden = false;
  cameraStatusElement.textContent = "주먹을 다시 인식해 3초 카운트다운을 시작했습니다.";

  countdownTimeoutId = window.setInterval(() => {
    count -= 1;

    if (count > 0) {
      overlayMessageElement.textContent = `${count}초 후 재개`;
      return;
    }

    stopCountdown();
    isPaused = false;
    render(state);
    startLoop();
    cameraStatusElement.textContent = isTurboActive()
      ? "카운트다운이 끝나 게임을 재개했습니다. 현재 부스트 모드입니다."
      : "카운트다운이 끝나 게임을 재개했습니다.";
    playToneSequence([520, 620, 720], 0.06);
    vibrate([30, 20, 30, 20, 50]);
  }, 1000);
}

function stopCountdown() {
  if (countdownTimeoutId !== null) {
    window.clearInterval(countdownTimeoutId);
    countdownTimeoutId = null;
  }
}

function applyRpsBonus(result, statusMessage) {
  if (!hasStarted || state.isGameOver || result === "DRAW") {
    bonusStatusElement.textContent = result === "DRAW" ? "보너스 없음: 비김" : "보너스 대기 중";
    if (result === "DRAW") {
      playToneSequence([380, 380], 0.05);
      vibrate([25, 20, 25]);
    }
    return;
  }

  state = {
    ...state,
    score: state.score + RPS_WIN_BONUS_SCORE,
  };
  bonusTurboEnabled = true;
  scheduleTurboBonusEnd();
  render(state);
  if (!isPaused) {
    startLoop();
  }

  bonusStatusElement.textContent = `가위바위보 승리 보너스: +${RPS_WIN_BONUS_SCORE}점, ${RPS_BONUS_TURBO_MS / 1000}초 부스트`;
  cameraStatusElement.textContent = `${statusMessage} 보너스 점수와 부스트를 적용했습니다.`;
  playToneSequence([660, 880, 1040], 0.07);
  vibrate([45, 20, 45, 20, 70]);
}

function scheduleTurboBonusEnd() {
  stopTurboBonus();
  turboTimeoutId = window.setTimeout(() => {
    turboTimeoutId = null;
    if (!bonusTurboEnabled) {
      return;
    }

    bonusTurboEnabled = false;
    bonusStatusElement.textContent = "가위바위보 보너스 종료";
    if (!isPaused && hasStarted && !state.isGameOver) {
      startLoop();
    }
    playToneSequence([360, 300], 0.06);
  }, RPS_BONUS_TURBO_MS);
}

function stopTurboBonus() {
  if (turboTimeoutId !== null) {
    window.clearTimeout(turboTimeoutId);
    turboTimeoutId = null;
  }
}

function isTurboActive() {
  return manualTurboEnabled || bonusTurboEnabled;
}
