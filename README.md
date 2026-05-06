# Draw a Perfect Circle

A sketchy, cartoon-styled take on the "draw a perfect circle" challenge.
Aim around the white dot, draw freely, and get scored on precision.

## Highlights

- **Sketchy cartoon UI** — `Caveat Brush` for hand-drawn text, `Press Start 2P` pixel arcade
  font for the score, hand-wobbled rounded buttons
- **Universal white dot** — fixed center marker, with a no-draw exclusion zone around it
  so the user must orbit, not scribble across it
- **Free brush** — thicker, smooth, low-latency stroke; no auto-correct
- **Rainbow result stroke** — on completion the stroke recolors red to green based on
  per-point accuracy (matches the reference design)
- **Rules** — `you took too long`, `u can not change direction`, `too close to dot`
- **Fits any screen** — full-bleed canvas, mobile-friendly, no overflow
- **Vercel-ready** — pure static, zero build step, zero errors

## Run locally

```bash
npm start
# or
npx serve .
```

Open http://localhost:3000

## Deploy to Vercel

```bash
npx vercel --prod
```

No build step. `vercel.json` handles caching and security headers.

## How scoring works

1. Mean radius from the **fixed center dot** is computed across all sampled points.
2. Mean absolute radial deviation is computed and normalized by the radius.
3. Small penalties for poor closure and incomplete sweep (< 360°).
4. Per-point error is mapped to a hue (red to green) for the final rainbow stroke.

```
score = 100 − (meanError / radius × 100) − closurePenalty − coveragePenalty
```

## Controls

- Press near the white dot, draw your circle around it, release
- `Retry` button or press `Esc` / `Space` / `Enter`
- `Copy` copies your score

## Files

- `index.html` — markup
- `style.css` — styling, sketchy cartoon UI
- `script.js` — canvas, free brush, scoring, rainbow recoloring, rules
- `vercel.json` — caching & security headers
- `package.json` — local dev script

## License

MIT
