/* Perfect Circle — sketchy/cartoon build
   - Fixed white center dot (universal)
   - Exclusion zone around dot (cannot draw too close)
   - Free brush, smooth, low-latency, no auto-improve
   - Rainbow-by-accuracy stroke recoloring on result
   - Detects "you took too long" and "u can not change direction"
   - Shows ONLY the user-drawn circle on the result screen
*/

(() => {
  "use strict";

  const canvas = document.getElementById("canvas");
  const ctx = canvas.getContext("2d", { alpha: true, desynchronized: true });

  const hintEl = document.getElementById("hint");
  const resultEl = document.getElementById("result");
  const scoreEl = document.getElementById("score");
  const scoreLabelEl = document.getElementById("score-label");
  const retryBtn = document.getElementById("retry");
  const copyBtn = document.getElementById("copy");
  const copyLabelEl = document.getElementById("copy-label");
  const bestEl = document.getElementById("best-value");
  const messageEl = document.getElementById("message");
  const messageScoreEl = document.getElementById("message-score");
  const messageTextEl = document.getElementById("message-text");

  // ───── Tunables ─────
  const BRUSH_WIDTH = 6;
  const BRUSH_COLOR = "#ffffff";
  const CENTER_DOT_RADIUS = 4.5;     // small white dot
  const NO_DRAW_RADIUS = 36;         // exclusion zone (cannot draw inside)
  const MIN_RADIUS = 50;             // ignore tiny scribbles
  const MAX_DRAW_TIME_MS = 6000;     // "you took too long"
  const DIRECTION_LOCK_ANGLE = Math.PI * 0.35;
  const DIRECTION_REVERSE_ANGLE = Math.PI * 0.55;

  // ───── State ─────
  let dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 3));
  let width = 0, height = 0;
  let centerX = 0, centerY = 0;

  let drawing = false;
  let points = [];
  let lastDrawIndex = 0;
  let rafId = null;

  let drawStartTime = 0;
  let direction = 0;
  let cumulativeAngle = 0;
  let prevAngle = 0;
  let aborted = false;

  let messageTimeoutId = null;
  let resultMode = false;       // when true, draw rainbow stroke instead of white
  let resultRadius = 0;
  let resultErrors = [];        // per-segment error normalized 0..1

  // Best score (persistent)
  const BEST_KEY = "perfect_circle_best_v3";
  let bestScore = parseFloat(localStorage.getItem(BEST_KEY) || "0") || 0;
  updateBestUI();

  // ───── Canvas sizing ─────
  function resize() {
    dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 3));
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = width + "px";
    canvas.style.height = height + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    centerX = width / 2;
    centerY = height / 2;
    redrawAll();
  }
  window.addEventListener("resize", resize, { passive: true });
  window.addEventListener("orientationchange", resize, { passive: true });

  // ───── Helpers ─────
  function getPoint(e) {
    let x, y;
    if (e.touches && e.touches[0]) {
      x = e.touches[0].clientX; y = e.touches[0].clientY;
    } else if (e.changedTouches && e.changedTouches[0]) {
      x = e.changedTouches[0].clientX; y = e.changedTouches[0].clientY;
    } else {
      x = e.clientX; y = e.clientY;
    }
    return { x, y, t: performance.now() };
  }

  function clearCanvas() {
    ctx.clearRect(0, 0, width, height);
  }

  function drawCenterDot() {
    ctx.save();
    // tiny soft glow
    const grad = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, 12);
    grad.addColorStop(0, "rgba(255, 255, 255, 0.35)");
    grad.addColorStop(1, "rgba(255, 255, 255, 0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(centerX, centerY, 12, 0, Math.PI * 2);
    ctx.fill();
    // solid white dot
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(centerX, centerY, CENTER_DOT_RADIUS, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function redrawAll() {
    clearCanvas();
    if (resultMode && points.length > 1) {
      drawRainbowPath(points);
    } else if (points.length > 1) {
      drawSmoothPath(points, BRUSH_COLOR, BRUSH_WIDTH);
    }
    drawCenterDot();
  }

  // ───── Smooth quadratic stroke ─────
  function drawSmoothPath(pts, color, lineWidth) {
    if (pts.length < 2) return;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.shadowColor = "rgba(255, 255, 255, 0.18)";
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    if (pts.length === 2) {
      ctx.lineTo(pts[1].x, pts[1].y);
    } else {
      for (let i = 1; i < pts.length - 1; i++) {
        const xc = (pts[i].x + pts[i + 1].x) / 2;
        const yc = (pts[i].y + pts[i + 1].y) / 2;
        ctx.quadraticCurveTo(pts[i].x, pts[i].y, xc, yc);
      }
      const last = pts[pts.length - 1];
      ctx.lineTo(last.x, last.y);
    }
    ctx.stroke();
    ctx.restore();
  }

  // Incremental drawing while user moves
  function drawIncremental() {
    if (points.length < 3) return;
    const startIdx = Math.max(1, lastDrawIndex);
    if (startIdx >= points.length - 1) return;

    ctx.save();
    ctx.strokeStyle = BRUSH_COLOR;
    ctx.lineWidth = BRUSH_WIDTH;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.shadowColor = "rgba(255, 255, 255, 0.18)";
    ctx.shadowBlur = 10;
    ctx.beginPath();
    const prev = points[startIdx - 1];
    ctx.moveTo((prev.x + points[startIdx].x) / 2, (prev.y + points[startIdx].y) / 2);
    for (let i = startIdx; i < points.length - 1; i++) {
      const xc = (points[i].x + points[i + 1].x) / 2;
      const yc = (points[i].y + points[i + 1].y) / 2;
      ctx.quadraticCurveTo(points[i].x, points[i].y, xc, yc);
    }
    ctx.stroke();
    ctx.restore();
    // re-stamp center dot on top
    drawCenterDot();
    lastDrawIndex = points.length - 1;
  }

  // ───── Rainbow accuracy stroke (final) ─────
  function errorToColor(err) {
    // err is normalized 0..1 (0 perfect, 1 bad)
    // map to red(0deg) -> yellow(60) -> green(120)
    const e = Math.min(1, Math.max(0, err));
    const hue = (1 - e) * 130; // 0..130
    return `hsl(${hue.toFixed(0)}, 95%, 58%)`;
  }

  function drawRainbowPath(pts) {
    if (pts.length < 2 || resultErrors.length !== pts.length) return;
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = BRUSH_WIDTH;
    ctx.shadowColor = "rgba(255, 255, 255, 0.15)";
    ctx.shadowBlur = 14;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      const e = (resultErrors[i - 1] + resultErrors[i]) * 0.5;
      ctx.strokeStyle = errorToColor(e);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    ctx.restore();
  }

  // ───── Direction tracking ─────
  function updateDirectionTracking(p) {
    const a = Math.atan2(p.y - centerY, p.x - centerX);
    if (points.length === 1) {
      prevAngle = a;
      cumulativeAngle = 0;
      direction = 0;
      return;
    }
    let da = a - prevAngle;
    if (da > Math.PI) da -= 2 * Math.PI;
    else if (da < -Math.PI) da += 2 * Math.PI;
    cumulativeAngle += da;
    prevAngle = a;

    if (direction === 0) {
      if (Math.abs(cumulativeAngle) >= DIRECTION_LOCK_ANGLE) {
        direction = cumulativeAngle > 0 ? 1 : -1;
      }
    } else {
      if (direction === 1 && cumulativeAngle <= -DIRECTION_REVERSE_ANGLE) {
        return abortRun("u can not change direction");
      }
      if (direction === -1 && cumulativeAngle >= DIRECTION_REVERSE_ANGLE) {
        return abortRun("u can not change direction");
      }
    }
  }

  function abortRun(msg) {
    if (aborted) return;
    aborted = true;
    drawing = false;
    document.body.classList.remove("drawing");
    showMessage(msg);
    setTimeout(() => reset(true), 1300);
  }

  // ───── Pointer handlers ─────
  function start(e) {
    if (e.cancelable) e.preventDefault();

    const p = getPoint(e);
    const dist = Math.hypot(p.x - centerX, p.y - centerY);

    // can't start inside the no-draw zone
    if (dist < NO_DRAW_RADIUS) {
      showMessage("too close to dot");
      return;
    }

    aborted = false;
    resultMode = false;
    resultErrors = [];
    points = [];
    lastDrawIndex = 0;
    cumulativeAngle = 0;
    direction = 0;
    drawing = true;
    drawStartTime = performance.now();
    document.body.classList.add("drawing");
    hideResult();
    hintEl.classList.add("hidden");
    hideMessage();
    redrawAll();

    points.push(p);
    prevAngle = Math.atan2(p.y - centerY, p.x - centerX);
  }

  function move(e) {
    if (!drawing || aborted) return;
    if (e.cancelable) e.preventDefault();

    const now = performance.now();
    if (now - drawStartTime > MAX_DRAW_TIME_MS) {
      return abortRun("you took too long");
    }

    const p = getPoint(e);

    // can't cross into the exclusion zone
    if (Math.hypot(p.x - centerX, p.y - centerY) < NO_DRAW_RADIUS) {
      return abortRun("too close to dot");
    }

    const last = points[points.length - 1];
    if (last) {
      const dx = p.x - last.x;
      const dy = p.y - last.y;
      if (dx * dx + dy * dy < 1.0) return;
    }
    points.push(p);
    updateDirectionTracking(p);
    if (aborted) return;

    if (!rafId) {
      rafId = requestAnimationFrame(() => {
        rafId = null;
        drawIncremental();
      });
    }
  }

  function end(e) {
    if (!drawing || aborted) {
      drawing = false;
      return;
    }
    if (e && e.cancelable) e.preventDefault();
    drawing = false;
    document.body.classList.remove("drawing");

    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }

    redrawAll();

    const radius = computeRadius(points);
    if (radius < MIN_RADIUS || points.length < 12) {
      reset(true);
      return;
    }

    // compute score + per-point errors for rainbow
    const { score, errors } = computeScoreAndErrors(points, radius);
    resultErrors = errors;
    resultRadius = radius;
    resultMode = true;
    redrawAll();
    showResult(score);
  }

  // ───── Scoring ─────
  function computeRadius(pts) {
    let sum = 0;
    for (const p of pts) sum += Math.hypot(p.x - centerX, p.y - centerY);
    return sum / pts.length;
  }

  function computeScoreAndErrors(pts, radius) {
    if (pts.length < 12 || radius < MIN_RADIUS) return { score: 0, errors: [] };

    let errSum = 0;
    const errors = new Array(pts.length);
    let maxErr = 0;
    for (let i = 0; i < pts.length; i++) {
      const d = Math.hypot(pts[i].x - centerX, pts[i].y - centerY);
      const e = Math.abs(d - radius);
      errors[i] = e;
      errSum += e;
      if (e > maxErr) maxErr = e;
    }
    const meanErr = errSum / pts.length;
    const normalized = meanErr / radius;

    // Per-point errors normalized for color (relative to radius)
    const colorScale = Math.max(radius * 0.18, 8);
    for (let i = 0; i < errors.length; i++) {
      errors[i] = Math.min(1, errors[i] / colorScale);
    }

    const closure = Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].y - pts[pts.length - 1].y) / radius;
    const closurePenalty = Math.min(closure * 0.18, 0.3);

    const sweep = Math.min(Math.abs(cumulativeAngle) / (2 * Math.PI), 1.05);
    const coveragePenalty = sweep < 0.9 ? (0.9 - sweep) * 0.7 : 0;

    let score = 100 - normalized * 100 - closurePenalty * 100 - coveragePenalty * 100;
    if (!isFinite(score)) score = 0;
    score = Math.max(0, Math.min(100, score));
    return { score, errors };
  }

  // ───── Messages ─────
  function showMessage(text) {
    if (messageTimeoutId) {
      clearTimeout(messageTimeoutId);
      messageTimeoutId = null;
    }
    messageTextEl.textContent = text;
    messageEl.classList.add("show");
    messageEl.setAttribute("aria-hidden", "false");
    messageTimeoutId = setTimeout(hideMessage, 1500);
  }

  function hideMessage() {
    messageEl.classList.remove("show");
    messageEl.setAttribute("aria-hidden", "true");
  }

  // ───── Result UI ─────
  let lastScore = 0;
  function showResult(score) {
    lastScore = score;
    animateScoreCount(score);
    resultEl.classList.remove("tier-low", "tier-mid", "tier-high");
    if (score >= 90) resultEl.classList.add("tier-high");
    else if (score >= 70) resultEl.classList.add("tier-mid");
    else resultEl.classList.add("tier-low");

    resultEl.classList.add("show");
    resultEl.setAttribute("aria-hidden", "false");

    if (score > bestScore) {
      bestScore = score;
      try { localStorage.setItem(BEST_KEY, String(bestScore)); } catch (_) {}
      updateBestUI();
      scoreLabelEl.textContent = "new best";
    } else {
      scoreLabelEl.textContent = "tap retry";
    }
  }

  function hideResult() {
    resultEl.classList.remove("show");
    resultEl.setAttribute("aria-hidden", "true");
  }

  function animateScoreCount(target) {
    const dur = 700;
    const startT = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - startT) / dur);
      const eased = 1 - Math.pow(1 - t, 3);
      const v = target * eased;
      scoreEl.innerHTML = v.toFixed(1) + "<i>%</i>";
      if (t < 1) requestAnimationFrame(tick);
      else scoreEl.innerHTML = target.toFixed(1) + "<i>%</i>";
    };
    requestAnimationFrame(tick);
  }

  function updateBestUI() {
    bestEl.textContent = bestScore > 0 ? bestScore.toFixed(1) + "%" : "—";
  }

  // ───── Reset ─────
  function reset(showHint = true) {
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    points = [];
    lastDrawIndex = 0;
    drawing = false;
    aborted = false;
    cumulativeAngle = 0;
    direction = 0;
    resultMode = false;
    resultErrors = [];
    document.body.classList.remove("drawing");
    redrawAll();
    hideResult();
    if (showHint) hintEl.classList.remove("hidden");
  }

  // ───── Events ─────
  if (window.PointerEvent) {
    canvas.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      try { canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId); } catch (_) {}
      start(e);
    });
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", end);
    canvas.addEventListener("pointercancel", end);
    canvas.addEventListener("pointerleave", (e) => { if (drawing) end(e); });
  } else {
    canvas.addEventListener("mousedown", start);
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", end);
    canvas.addEventListener("touchstart", start, { passive: false });
    canvas.addEventListener("touchmove", move, { passive: false });
    canvas.addEventListener("touchend", end, { passive: false });
    canvas.addEventListener("touchcancel", end, { passive: false });
  }

  canvas.addEventListener("contextmenu", (e) => e.preventDefault());

  retryBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    reset(true);
  });

  copyBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    const text = `${lastScore.toFixed(1)}% — Perfect Circle`;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement("textarea");
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      const old = copyLabelEl.textContent;
      copyLabelEl.textContent = "Copied";
      setTimeout(() => { copyLabelEl.textContent = old || "Copy"; }, 1100);
    } catch (_) {
      copyLabelEl.textContent = "Failed";
      setTimeout(() => { copyLabelEl.textContent = "Copy"; }, 1100);
    }
  });

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" || e.key === " " || e.key === "Enter") {
      if (resultEl.classList.contains("show")) {
        e.preventDefault();
        reset(true);
      }
    }
  });

  // ───── Boot ─────
  resize();
})();
