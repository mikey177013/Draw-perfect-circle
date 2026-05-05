# Draw a Perfect Circle

A premium, smooth, fixed-center take on the classic "draw a perfect circle" challenge.
Anchor your stroke at the glowing center dot, draw freely, and get scored on precision.

> Live: deploy with one click to Vercel — pure static site, zero build step.

---

## What's new in this build

- **Funky cartoon display font** — `Bagel Fat One` for the headline & score, `Space Grotesk` for UI
- **Fixed center anchor** — a glowing dot marks the circle's center; every stroke must start there
- **Free brush** — no auto-correct, no smoothing magic; you draw exactly what you draw
- **Thicker, smoother stroke** — quadratic Bézier curves with incremental rendering for zero lag
- **Direction lock** — switching from clockwise to counter-clockwise (or vice versa) shows
  `u can not change direction`
- **Time limit** — taking longer than 6 seconds shows `you took too long`
- **Clean result screen** — only the user-drawn circle is shown (no "ideal" overlay)
- **Polished UI** — gradient typography, glassy chrome, no emoji (SVG icons only)

## Run locally

```bash
npm start
# or
npx serve .
```

Then open http://localhost:3000

## Deploy to Vercel

This is a pure static site. Push to GitHub and import on Vercel, or:

```bash
npx vercel --prod
```

No build step is required. Zero errors, zero config beyond `vercel.json` for caching headers.

## How scoring works

1. Mean radius from the **fixed center dot** is computed across all sampled points.
2. Mean absolute radial deviation is computed and normalized by the radius.
3. Small penalties are applied for poor closure (start ≠ end) and incomplete sweep (< 360°).
4. Result is clamped to 0–100.

```
score = 100 − (meanError / radius × 100) − closurePenalty − coveragePenalty
```

## Controls

- **Mouse / touch / pen**: press near the center dot, draw your circle, release
- **Try again**: button on the result screen, or press `Esc` / `Space` / `Enter`

## Files

- `index.html` — markup
- `style.css` — styling, typography, glass UI
- `script.js` — canvas, drawing, scoring, direction & timing checks
- `vercel.json` — caching/security headers
- `package.json` — local dev script

## License

MIT
