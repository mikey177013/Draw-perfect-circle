/* Perfect Circle — premium build
   - Fixed center dot anchor
   - Free, smooth, low-latency brush (no auto-improve)
   - Detects "took too long" and "changed direction"
   - Shows ONLY the user-drawn circle on the result screen
*/

(() => {
  "use strict";

  const canvas = document.getElementById("canvas");
  const ctx = canvas.getContext("2d", { alpha: true, desynchronized: true });

  const hintEl = document.getElementById("hint");
  const resultEl = document.getElementById("result");
  const scoreEl = document.getElementById("score");
  const retryBtn = document.getElementById("retry");
  const bestEl = document.getElementById("best-value");
  const messageEl = document.getElementById("message");
  const messageTextEl = document.getElementById("message-text");

  // ───── Tunables ─────
  const BRUSH_WIDTH = 5.5;          // thicker brush
  const BRUSH_COLOR = "#ffffff";
  const CENTER_DOT_RADIUS = 6;
  const CENTER_DOT_HALO = 14;
  const MIN_RADIUS = 28;            // ignore tiny scribbles
  const MAX_DRAW_TIME_MS = 6000;    // "you took too long"
  const DIRECTION_LOCK_ANGLE = Math.PI * 0.35; // ~63° net rotation before locking
  const DIRECTION_REVERSE_ANGLE = Math.PI * 0.55; // reverse threshold
  const START_RADIUS_TOLERANCE = 90; // user must start near the center dot

  // ───── State ─────
  let dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 3));
  let width = 0;
  let height = 0;
  let centerX = 0;
  let centerY = 0;

  let drawing = false;
  let points = [];                  // {x, y, t}
  let lastDrawIndex = 0;
  let rafId = null;

  let drawStartTime = 0;
  let direction = 0;                // 0 unknown, +1 ccw (positive in math), -1 cw
  let cumulativeAngle = 0;
  let prevAngle = 0;
  let aborted = false;

  let messageTimeoutId = null;

  // Best score (persistent)
  const BEST_KEY = "perfect_circle_best_v2";
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
      x = e.touches[0].clientX;
      y = e.touches[0].clientY;
    } else if (e.changedTouches && e.changedTouches[0]) {
      x = e.changedTouches[0].clientX;
      y = e.changedTouches[0].clientY;
    } else {
      x = e.clientX;
      y = e.clientY;
    }
    return { x, y, t: performance.now() };
  }

  function clearCanvas() {
    ctx.clearRect(0, 0, width, height);
  }

  function drawCenterDot() {
    // Soft halo
    const grad = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, CENTER_DOT_HALO);
    grad.addColorStop(0, "rgba(255, 209, 102, 0.55)");
    grad.addColorStop(1, "rgba(255, 209, 102, 0)");
    ctx.save();
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(centerX, centerY, CENTER_DOT_HALO, 0, Math.PI * 2);
    ctx.fill();

    // Solid dot
    ctx.fillStyle = "#ffd166";
    ctx.beginPath();
    ctx.arc(centerX, centerY, CENTER_DOT_RADIUS, 0, Math.PI * 2);
    ctx.fill();

    // Inner highlight
    ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
    ctx.beginPath();
    ctx.arc(centerX - 1.3, centerY - 1.3, 1.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function redrawAll() {
    clearCanvas();
    drawCenterDot();
    if (points.length > 1) {
      drawSmoothPath(points, BRUSH_COLOR, BRUSH_WIDTH);
    }
  }

  // ───── Smooth quadratic stroke (full re-draw) ─────
  function drawSmoothPath(pts, color, lineWidth) {
    if (pts.length < 2) return;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.shadowColor = "rgba(255, 255, 255, 0.12)";
    ctx.shadowBlur = 8;
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

  // Incremental drawing while user moves — keeps things buttery
  function drawIncremental() {
    if (points.length < 3) return;
    const startIdx = Math.max(1, lastDrawIndex);
    if (startIdx >= points.length - 1) return;

    ctx.save();
    ctx.strokeStyle = BRUSH_COLOR;
    ctx.lineWidth = BRUSH_WIDTH;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.shadowColor = "rgba(255, 255, 255, 0.12)";
    ctx.shadowBlur = 8;
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
    lastDrawIndex = points.length - 1;
  }

  // ───── Direction & timing checks ─────
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
      // Once locked, if user reverses far enough, abort
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
    // Quick flash, then reset
    setTimeout(() => {
      reset(false);
    }, 1200);
  }

  // ───── Pointer handlers ─────
  function start(e) {
    if (e.cancelable) e.preventDefault();

    const p = getPoint(e);
    const dx = p.x - centerX;
    const dy = p.y - centerY;
    const dist = Math.hypot(dx, dy);

    // Must start near the center dot
    if (dist > START_RADIUS_TOLERANCE) {
      showMessage("start from the center dot");
      return;
    }

    // Reset any previous run
    aborted = false;
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

    // Time check
    const now = performance.now();
    if (now - drawStartTime > MAX_DRAW_TIME_MS) {
      return abortRun("you took too long");
    }

    const p = getPoint(e);
    const last = points[points.length - 1];
    if (last) {
      const dx = p.x - last.x;
      const dy = p.y - last.y;
      // Smaller dedupe threshold = smoother, but still efficient
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

    // Final clean redraw
    redrawAll();

    const score = computeScore(points);
    const radius = computeRadius(points);

    if (radius < MIN_RADIUS || points.length < 12) {
      // too small — silent reset
      reset(true);
      return;
    }

    showResult(score);
  }

  // ───── Scoring ─────
  function computeRadius(pts) {
    let sum = 0;
    for (const p of pts) sum += Math.hypot(p.x - centerX, p.y - centerY);
    return sum / pts.length;
  }

  function computeScore(pts) {
    if (pts.length < 12) return 0;
    const radius = computeRadius(pts);
    if (radius < MIN_RADIUS) return 0;

    // Mean absolute radial deviation, normalized
    let errSum = 0;
    for (const p of pts) {
      const d = Math.hypot(p.x - centerX, p.y - centerY);
      errSum += Math.abs(d - radius);
    }
    const meanErr = errSum / pts.length;
    const normalized = meanErr / radius;

    // Closure: distance between first and last point relative to radius
    const closure = Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].y - pts[pts.length - 1].y) / radius;
    const closurePenalty = Math.min(closure * 0.18, 0.3);

    // Coverage: total signed angular sweep should be ~2π
    const sweep = Math.min(Math.abs(cumulativeAngle) / (2 * Math.PI), 1.05);
    const coveragePenalty = sweep < 0.9 ? (0.9 - sweep) * 0.7 : 0;

    let score = 100 - normalized * 100 - closurePenalty * 100 - coveragePenalty * 100;
    if (!isFinite(score)) score = 0;
    return Math.max(0, Math.min(100, score));
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
    messageTimeoutId = setTimeout(() => {
      hideMessage();
    }, 1600);
  }

  function hideMessage() {
    messageEl.classList.remove("show");
    messageEl.setAttribute("aria-hidden", "true");
  }

  // ───── Result UI ─────
  function showResult(score) {
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
      scoreEl.textContent = v.toFixed(1);
      if (t < 1) requestAnimationFrame(tick);
      else scoreEl.textContent = target.toFixed(1);
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
    canvas.addEventListener("pointerleave", (e) => {
      if (drawing) end(e);
    });
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
