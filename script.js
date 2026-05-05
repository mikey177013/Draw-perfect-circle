/* Perfect Circle — minimal premium build
   - Crisp DPR-aware canvas
   - Smooth quadratic curve drawing
   - Accurate circle scoring (radial deviation)
   - Animated overlay of the ideal circle
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

  // ───── State ─────
  let dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 3));
  let width = 0;
  let height = 0;

  let drawing = false;
  let points = [];        // raw points {x, y, t}
  let lastDrawIndex = 0;  // index of last point that was rendered to ctx
  let rafId = null;

  // Final state animation
  let overlay = null;     // {cx, cy, r, progress, score}
  let overlayRafId = null;

  // Best score (persistent)
  const BEST_KEY = "perfect_circle_best_v1";
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
    redrawAll();
  }
  window.addEventListener("resize", resize, { passive: true });
  window.addEventListener("orientationchange", resize, { passive: true });

  // ───── Helpers ─────
  function getPoint(e) {
    const t = e.touches && e.touches[0];
    const x = t ? t.clientX : e.clientX;
    const y = t ? t.clientY : e.clientY;
    return { x, y, t: performance.now() };
  }

  function clearCanvas() {
    ctx.clearRect(0, 0, width, height);
  }

  function redrawAll() {
    clearCanvas();
    if (points.length > 1) {
      drawSmoothPath(points, "#ffffff", 2.4, 1);
    }
    if (overlay) {
      drawOverlay(overlay);
    }
  }

  // ───── Smooth quadratic stroke ─────
  function drawSmoothPath(pts, color, width, alpha = 1) {
    if (pts.length < 2) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length - 1; i++) {
      const xc = (pts[i].x + pts[i + 1].x) / 2;
      const yc = (pts[i].y + pts[i + 1].y) / 2;
      ctx.quadraticCurveTo(pts[i].x, pts[i].y, xc, yc);
    }
    const last = pts[pts.length - 1];
    ctx.lineTo(last.x, last.y);
    ctx.stroke();
    ctx.restore();
  }

  // Incremental drawing while user moves (avoids re-rendering whole stroke each frame)
  function drawIncremental() {
    if (points.length < 3) return;
    const startIdx = Math.max(1, lastDrawIndex);
    ctx.save();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2.4;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    // Begin from previously drawn midpoint to keep continuity
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

  // ───── Scoring ─────
  function computeCenter(pts) {
    let sx = 0, sy = 0;
    for (const p of pts) { sx += p.x; sy += p.y; }
    return { x: sx / pts.length, y: sy / pts.length };
  }

  function computeRadius(pts, center) {
    let sum = 0;
    for (const p of pts) {
      const dx = p.x - center.x;
      const dy = p.y - center.y;
      sum += Math.hypot(dx, dy);
    }
    return sum / pts.length;
  }

  // Mean absolute radial deviation, normalized by radius
  function computeScore(pts) {
    if (pts.length < 12) return { score: 0, center: null, radius: 0 };

    const center = computeCenter(pts);
    const radius = computeRadius(pts, center);
    if (radius < 12) return { score: 0, center, radius };

    let errSum = 0;
    for (const p of pts) {
      const d = Math.hypot(p.x - center.x, p.y - center.y);
      errSum += Math.abs(d - radius);
    }
    const meanErr = errSum / pts.length;
    const normalized = meanErr / radius; // 0 = perfect

    // Closure penalty: distance between first and last point relative to radius
    const closure = Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].y - pts[pts.length - 1].y) / radius;
    const closurePenalty = Math.min(closure * 0.15, 0.25); // cap at 25 pts

    // Coverage check: total signed angular sweep should be ~2π (full revolution)
    let totalAngle = 0;
    let prevAng = Math.atan2(pts[0].y - center.y, pts[0].x - center.x);
    for (let i = 1; i < pts.length; i++) {
      const a = Math.atan2(pts[i].y - center.y, pts[i].x - center.x);
      let da = a - prevAng;
      if (da > Math.PI) da -= 2 * Math.PI;
      else if (da < -Math.PI) da += 2 * Math.PI;
      totalAngle += da;
      prevAng = a;
    }
    const sweep = Math.min(Math.abs(totalAngle) / (2 * Math.PI), 1.05);
    const coveragePenalty = sweep < 0.9 ? (0.9 - sweep) * 0.6 : 0; // big penalty if not closed

    let score = 100 - normalized * 100 - closurePenalty * 100 - coveragePenalty * 100;
    if (!isFinite(score)) score = 0;
    score = Math.max(0, Math.min(100, score));

    return { score, center, radius };
  }

  // ───── Pointer handlers ─────
  function start(e) {
    if (e.cancelable) e.preventDefault();
    // Reset any previous run
    cancelOverlayAnim();
    overlay = null;
    points = [];
    lastDrawIndex = 0;
    drawing = true;
    document.body.classList.add("drawing");
    hideResult();
    hintEl.classList.add("hidden");
    clearCanvas();

    points.push(getPoint(e));
  }

  function move(e) {
    if (!drawing) return;
    if (e.cancelable) e.preventDefault();

    const p = getPoint(e);
    const last = points[points.length - 1];
    // Dedupe close points to keep array efficient and smooth
    if (last) {
      const dx = p.x - last.x;
      const dy = p.y - last.y;
      if (dx * dx + dy * dy < 1.5) return;
    }
    points.push(p);

    // Throttle render to next animation frame
    if (!rafId) {
      rafId = requestAnimationFrame(() => {
        rafId = null;
        drawIncremental();
      });
    }
  }

  function end(e) {
    if (!drawing) return;
    if (e && e.cancelable) e.preventDefault();
    drawing = false;
    document.body.classList.remove("drawing");

    // Final clean redraw with smooth curves
    redrawAll();

    const { score, center, radius } = computeScore(points);

    if (!center || radius < 20 || points.length < 20) {
      // Too small / too short — silent reset, show hint again
      hintEl.classList.remove("hidden");
      points = [];
      lastDrawIndex = 0;
      clearCanvas();
      return;
    }

    showResult(score);
    animateOverlay(center, radius, score);
  }

  // ───── Overlay (perfect circle) animation ─────
  function animateOverlay(center, radius, score) {
    overlay = { cx: center.x, cy: center.y, r: radius, progress: 0, score };
    const start = performance.now();
    const dur = 650;

    const tick = (now) => {
      const t = Math.min(1, (now - start) / dur);
      // easeOutCubic
      const eased = 1 - Math.pow(1 - t, 3);
      overlay.progress = eased;
      redrawAll();
      if (t < 1) {
        overlayRafId = requestAnimationFrame(tick);
      } else {
        overlayRafId = null;
      }
    };
    overlayRafId = requestAnimationFrame(tick);
  }

  function cancelOverlayAnim() {
    if (overlayRafId) {
      cancelAnimationFrame(overlayRafId);
      overlayRafId = null;
    }
  }

  function drawOverlay(o) {
    ctx.save();
    // Color by score
    const color = scoreColor(o.score);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = 0.85;
    ctx.setLineDash([]);
    ctx.beginPath();
    const startAng = -Math.PI / 2;
    ctx.arc(o.cx, o.cy, o.r, startAng, startAng + Math.PI * 2 * o.progress);
    ctx.stroke();

    // tiny center dot
    if (o.progress > 0.1) {
      ctx.globalAlpha = 0.5 * o.progress;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(o.cx, o.cy, 1.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function scoreColor(s) {
    // monochrome premium: just white tones, slight tint at extremes
    if (s >= 95) return "#7CFFB2";   // mint
    if (s >= 85) return "#ffffff";
    if (s >= 70) return "#ffffff";
    return "#ff8a8a"; // soft red for poor
  }

  // ───── Result UI ─────
  function showResult(score) {
    const display = score.toFixed(1);
    animateScoreCount(score);
    resultEl.classList.remove("tier-low", "tier-mid", "tier-high");
    if (score >= 90) resultEl.classList.add("tier-high");
    else if (score >= 70) resultEl.classList.add("tier-mid");
    else resultEl.classList.add("tier-low");

    resultEl.classList.add("show");
    resultEl.setAttribute("aria-hidden", "false");

    // Best score handling
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
    const start = performance.now();
    const from = 0;
    const tick = (now) => {
      const t = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - t, 3);
      const v = from + (target - from) * eased;
      scoreEl.textContent = v.toFixed(1);
      if (t < 1) requestAnimationFrame(tick);
      else scoreEl.textContent = target.toFixed(1);
    };
    requestAnimationFrame(tick);
  }

  function updateBestUI() {
    if (bestScore > 0) {
      bestEl.textContent = bestScore.toFixed(1) + "%";
    } else {
      bestEl.textContent = "—";
    }
  }

  // ───── Events ─────
  // Pointer events cover mouse + touch + pen on modern browsers
  if (window.PointerEvent) {
    canvas.addEventListener("pointerdown", (e) => {
      // Only primary button for mouse
      if (e.pointerType === "mouse" && e.button !== 0) return;
      canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId);
      start(e);
    });
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", end);
    canvas.addEventListener("pointercancel", end);
    canvas.addEventListener("pointerleave", (e) => {
      if (drawing) end(e);
    });
  } else {
    // Fallback
    canvas.addEventListener("mousedown", start);
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", end);
    canvas.addEventListener("touchstart", start, { passive: false });
    canvas.addEventListener("touchmove", move, { passive: false });
    canvas.addEventListener("touchend", end, { passive: false });
    canvas.addEventListener("touchcancel", end, { passive: false });
  }

  // Prevent context menu on long-press
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());

  retryBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    reset();
  });

  // Click anywhere outside the retry button after a result resets too
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" || e.key === " " || e.key === "Enter") {
      if (resultEl.classList.contains("show")) {
        e.preventDefault();
        reset();
      }
    }
  });

  function reset() {
    cancelOverlayAnim();
    overlay = null;
    points = [];
    lastDrawIndex = 0;
    drawing = false;
    clearCanvas();
    hideResult();
    hintEl.classList.remove("hidden");
  }

  // ───── Boot ─────
  resize();
})();
