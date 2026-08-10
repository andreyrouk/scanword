// A confetti burst for the moment a puzzle is solved.
//
// Hand-rolled rather than a library: the whole thing is ~80 lines, and the
// app has no build step and has to work offline, so an extra network
// dependency would cost more than it saves.
//
// Two cannons firing inward from the lower corners rather than confetti
// raining from the top. A burst reads as a reaction to what the player just
// did; rain reads as weather.

const CONFETTI_COLORS = [
  "#2e7d46", // the app's green
  "#ffe066", // the focused-cell yellow
  "#fff3b0",
  "#005bbb", // and the flag, which is the point of this project
  "#ffd500",
  "#ffffff",
];

const CONFETTI_DURATION_MS = 2200;
const CONFETTI_PER_CANNON = 60;
const GRAVITY = 0.00075; // px per ms squared
const DRAG = 0.9985;

let confettiCanvas = null;
let confettiFrame = null;

function prefersReducedMotion() {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch (err) {
    return false;
  }
}

function ensureCanvas() {
  if (!confettiCanvas) {
    confettiCanvas = document.createElement("canvas");
    confettiCanvas.className = "confetti";
    // aria-hidden and pointer-events:none (in CSS): decoration only, and it
    // must never sit between the player and the buttons underneath it.
    confettiCanvas.setAttribute("aria-hidden", "true");
    document.body.appendChild(confettiCanvas);
  }
  const dpr = Math.min(window.devicePixelRatio || 1, 2); // cap: 3x on a phone is a lot of pixels for decoration
  confettiCanvas.width = Math.floor(window.innerWidth * dpr);
  confettiCanvas.height = Math.floor(window.innerHeight * dpr);
  const ctx = confettiCanvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

function makeParticles() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const particles = [];
  // One cannon per lower corner, aimed up and inward.
  [
    { x: 0, dir: 1 },
    { x: w, dir: -1 },
  ].forEach(({ x, dir }) => {
    for (let i = 0; i < CONFETTI_PER_CANNON; i++) {
      const speed = 0.5 + Math.random() * 0.75;
      const angle = (Math.random() * 50 + 40) * (Math.PI / 180); // 40-90 degrees from horizontal
      particles.push({
        x,
        y: h,
        vx: Math.cos(angle) * speed * dir,
        vy: -Math.sin(angle) * speed,
        size: 5 + Math.random() * 6,
        color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
        rot: Math.random() * Math.PI,
        vrot: (Math.random() - 0.5) * 0.012,
        // A mix of rectangles and circles reads as paper rather than pixels.
        round: Math.random() < 0.3,
      });
    }
  });
  return particles;
}

function stopConfetti() {
  if (confettiFrame !== null) {
    cancelAnimationFrame(confettiFrame);
    confettiFrame = null;
  }
  if (confettiCanvas) {
    confettiCanvas.remove();
    confettiCanvas = null;
  }
}

// Fires a burst. Safe to call again mid-flight: the previous one is
// cancelled rather than the two overlapping into a mess.
function burstConfetti() {
  stopConfetti();
  // Motion sensitivity is a real accessibility need, and the results panel
  // conveys everything on its own - the confetti is pure garnish.
  if (prefersReducedMotion()) return false;

  const ctx = ensureCanvas();
  const particles = makeParticles();
  const started = performance.now();
  let last = started;

  const step = (now) => {
    const dt = Math.min(now - last, 48); // clamp: a backgrounded tab hands back a huge delta
    last = now;
    const elapsed = now - started;
    const fade = Math.max(0, 1 - elapsed / CONFETTI_DURATION_MS);

    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    ctx.globalAlpha = fade;

    particles.forEach((p) => {
      p.vy += GRAVITY * dt;
      p.vx *= DRAG;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vrot * dt;

      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      if (p.round) {
        ctx.beginPath();
        ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // Squashed vertically and spinning, so it flutters like a strip.
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      }
      ctx.restore();
    });

    if (elapsed < CONFETTI_DURATION_MS) confettiFrame = requestAnimationFrame(step);
    else stopConfetti();
  };

  confettiFrame = requestAnimationFrame(step);
  return true;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { burstConfetti, stopConfetti, CONFETTI_COLORS, CONFETTI_DURATION_MS };
}
