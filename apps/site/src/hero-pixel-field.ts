/*
 * Adapted from omacom/omarchy-site src/components/HeroPixelField.tsx,
 * revision 47711270650b9c78c7bfa996cdd0b6050c79566f.
 * https://github.com/omacom/omarchy-site/blob/47711270650b9c78c7bfa996cdd0b6050c79566f/src/components/HeroPixelField.tsx
 * Preserves its lattice, seeded noise, Bayer dithering, ink bands, sprite,
 * cursor glow and click stamps. Uses a DOM lifecycle instead of React;
 * radio-spectrum and etch integrations are not part of this product page.
 * Upstream authors retain their rights; no additional license is asserted.
 */
import {
  WORDMARK_HEIGHT,
  WORDMARK_ROWS,
  WORDMARK_WIDTH,
} from "./wordmark-bitmap";

const BAYER = [
  0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26, 12, 44, 4, 36,
  14, 46, 6, 38, 60, 28, 52, 20, 62, 30, 54, 22, 3, 35, 11, 43, 1, 33, 9, 41,
  51, 19, 59, 27, 49, 17, 57, 25, 15, 47, 7, 39, 13, 45, 5, 37, 63, 31, 55, 23,
  61, 29, 53, 21,
];
const LOGO_ROWS = [
  "111111111111111",
  "100000010000001",
  "101111110001101",
  "101000000000101",
  "101000000000101",
  "101000000000101",
  "101000000000101",
  "111000000000101",
  "101000000000101",
  "101000000000101",
  "101000000000101",
  "101000000000101",
  "101111111111101",
  "100000010000001",
  "111111110111111",
];
const INK_BANDS = [
  "crest",
  "crest",
  "crest",
  "crest",
  "crest",
  "hover",
  "hover",
  "lit",
  "lit",
  "lit",
  "lit",
  "mid",
  "mid",
  "mid",
  "dim",
  "dim",
  "dim",
  "dim",
  "dim",
] as const;
const NOISE_SIZE = 128;
type Palette = Record<"bg" | "dim" | "mid" | "lit" | "hover" | "crest", string>;
type Glow = { x: number; y: number; strength: number };
type Stamp = {
  x: number;
  y: number;
  born: number;
  from: number;
  to: number;
  life: number;
  cell: number;
  amp: number;
};
type Hold = { x: number; y: number; start: number };

function seeded(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function buildNoise() {
  const random = seeded(0x9ece6a);
  let field = Float32Array.from({ length: NOISE_SIZE * NOISE_SIZE }, random);
  for (let pass = 0; pass < 2; pass++) {
    const next = new Float32Array(field.length);
    for (let y = 0; y < NOISE_SIZE; y++) {
      for (let x = 0; x < NOISE_SIZE; x++) {
        let sum = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            sum +=
              field[
                ((y + dy + NOISE_SIZE) % NOISE_SIZE) * NOISE_SIZE +
                  ((x + dx + NOISE_SIZE) % NOISE_SIZE)
              ]!;
          }
        }
        next[y * NOISE_SIZE + x] = sum / 9;
      }
    }
    field = next;
  }
  let min = Infinity;
  let max = -Infinity;
  for (const value of field) {
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  const span = max - min || 1;
  for (let i = 0; i < field.length; i++) field[i] = (field[i]! - min) / span;
  return field;
}

function sample(field: Float32Array, x: number, y: number) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const x0 = ((xi % NOISE_SIZE) + NOISE_SIZE) % NOISE_SIZE;
  const y0 = ((yi % NOISE_SIZE) + NOISE_SIZE) % NOISE_SIZE;
  const x1 = (x0 + 1) % NOISE_SIZE;
  const y1 = (y0 + 1) % NOISE_SIZE;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  // Wrapped coordinates are always within the allocated 128 × 128 tile.
  return (
    (field[y0 * NOISE_SIZE + x0]! * (1 - sx) +
      field[y0 * NOISE_SIZE + x1]! * sx) *
      (1 - sy) +
    (field[y1 * NOISE_SIZE + x0]! * (1 - sx) +
      field[y1 * NOISE_SIZE + x1]! * sx) *
      sy
  );
}

/** Returns the complete cleanup; the CSS wordmark remains if Canvas is unavailable. */
export function mountHeroPixelField(
  canvas: HTMLCanvasElement,
  slot: HTMLElement,
): () => void {
  const ctx = canvas.getContext("2d", { alpha: false });
  const host = canvas.parentElement;
  if (!ctx || !host) return () => {};
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  const finePointer = matchMedia("(hover: hover) and (pointer: fine)");
  const noise = buildNoise();
  const jitter = Float32Array.from({ length: 4096 }, seeded(0x0a1f14));
  const pointer: Glow = { x: -10000, y: -10000, strength: 0 };
  const sprite: Glow = { x: -10000, y: -10000, strength: 0 };
  const glows = [pointer, sprite];
  const stamps: Stamp[] = [];
  let holding: Hold | null = null;
  let spriteHold: (Hold & { charge: number }) | null = null;
  let spriteStampAt = Infinity;
  let palette: Palette;
  let restInks: string[];
  let painted = false;
  let targetStrength = 0;
  let width = 0;
  let height = 0;
  let dpr = 1;
  let wmX = 0;
  let wmY = 0;
  let cw = 1;
  let ch = 1;
  let cMin = 0;
  let rMin = 0;
  let cols = 0;
  let rows = 0;
  let ramp = new Float32Array(0);
  let quietBoxes: Array<{
    left: number;
    top: number;
    right: number;
    bottom: number;
  }> = [];
  let frame = 0;
  let lastDraw = 0;
  let visible = true;
  let disposed = false;
  const motionEnabled = () =>
    !reducedMotion.matches && canvas.dataset.paused !== "true";
  const readPalette = () => {
    const style = getComputedStyle(document.documentElement);
    const token = (name: string) =>
      style.getPropertyValue(`--t-field-${name}`).trim();
    palette = {
      bg: token("bg"),
      dim: token("dim"),
      mid: token("mid"),
      lit: token("lit"),
      hover: token("hover"),
      crest: token("crest"),
    };
    restInks = INK_BANDS.map((ink) => palette[ink]);
  };
  readPalette();

  const measure = () => {
    const box = host.getBoundingClientRect();
    const mark = slot.getBoundingClientRect();
    if (!box.width || !box.height || !mark.width || !mark.height) return false;
    dpr = Math.min(devicePixelRatio || 1, 2);
    width = Math.round(box.width * dpr);
    height = Math.round(box.height * dpr);
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    wmX = (mark.left - box.left) * dpr;
    wmY = (mark.top - box.top) * dpr;
    cw = (mark.width * dpr) / WORDMARK_WIDTH;
    ch = (mark.height * dpr) / WORDMARK_HEIGHT;
    cMin = -Math.ceil(wmX / cw) - 1;
    rMin = -Math.ceil(wmY / ch) - 1;
    cols = Math.ceil((width - wmX) / cw) - cMin + 1;
    rows = Math.ceil((height - wmY) / ch) - rMin + 1;
    ramp = new Float32Array(cols * rows);
    for (let r = 0; r < rows; r++) {
      const y = wmY + (rMin + r + 0.5) * ch;
      const ny = (y / height) * 2 - 1;
      const clear = Math.min(1, Math.max(0.16, (y / dpr - 24) / 130));
      for (let c = 0; c < cols; c++) {
        const x = wmX + (cMin + c + 0.5) * cw;
        const nx = (x / width) * 2 - 1;
        const rr = Math.sqrt(nx * nx + ny * ny * 0.82);
        const eased = Math.min(1, Math.max(0, (rr - 0.42) / 0.85));
        ramp[r * cols + c] = eased * eased * clear;
      }
    }
    quietBoxes = Array.from(
      host.querySelectorAll<HTMLElement>("[data-hero-quiet]"),
    ).map((element) => {
      const rect = element.getBoundingClientRect();
      return {
        left: (rect.left - box.left) * dpr,
        top: (rect.top - box.top) * dpr,
        right: (rect.right - box.left) * dpr,
        bottom: (rect.bottom - box.top) * dpr,
      };
    });
    return true;
  };

  const strengthAt = (x: number, y: number) => {
    let nearest = Infinity;
    for (const box of quietBoxes) {
      const dx = Math.max(box.left - x, 0, x - box.right);
      const dy = Math.max(box.top - y, 0, y - box.bottom);
      nearest = Math.min(nearest, Math.hypot(dx, dy));
    }
    return Math.min(1, (nearest / (96 * dpr)) ** 3);
  };
  const chargeOf = (now: number, start: number) =>
    Math.min((now - start) / 1100, 1);
  const launch = (x: number, y: number, charge: number, now: number) => {
    if (stamps.length >= 4) stamps.shift();
    const from = 0.45 + 1.6 * charge;
    stamps.push({
      x,
      y,
      born: now,
      from,
      to: (from + 1 + 3.2 * charge) * (0.92 + Math.random() * 0.16),
      life: (0.65 + 0.55 * charge) * (0.92 + Math.random() * 0.16),
      cell: 0,
      amp: 0,
    });
  };
  const chargedAt = (hold: Hold | null, x: number, y: number) => {
    if (!hold) return 0;
    const cell = cw * (0.45 + 1.6 * chargeOf(lastDraw, hold.start));
    const col = Math.floor((x - hold.x) / cell + 7.5);
    const row = Math.floor((y - hold.y) / cell + 7.5);
    return col >= 0 &&
      col < 15 &&
      row >= 0 &&
      row < 15 &&
      LOGO_ROWS[row]![col] === "1"
      ? 0.9
      : 0;
  };
  const stampAt = (x: number, y: number) => {
    let amount = 0;
    for (const stamp of stamps) {
      const col = Math.floor((x - stamp.x) / stamp.cell + 7.5);
      const row = Math.floor((y - stamp.y) / stamp.cell + 7.5);
      if (
        col >= 0 &&
        col < 15 &&
        row >= 0 &&
        row < 15 &&
        LOGO_ROWS[row]![col] === "1"
      )
        amount = Math.max(amount, stamp.amp);
    }
    return Math.max(
      amount,
      chargedAt(holding, x, y),
      chargedAt(spriteHold, x, y),
    );
  };
  const glowAt = (x: number, y: number) => {
    let amount = 0;
    for (const glow of glows) {
      if (glow.strength <= 0.01) continue;
      const reach = 12 * cw * (0.45 + 0.55 * glow.strength);
      const distance = Math.hypot(x - glow.x, y - glow.y);
      if (distance < reach)
        amount = Math.max(amount, (1 - distance / reach) ** 2 * glow.strength);
    }
    return amount;
  };

  const draw = (time: number) => {
    if (!width || !height || disposed) return;
    const animated = motionEnabled();
    const t = reducedMotion.matches ? 0 : time / 1000;
    if (animated) {
      sprite.x =
        width *
        (0.5 + 0.44 * (1 + 0.1 * Math.sin(t * 0.11)) * Math.sin(t * 0.65));
      sprite.y =
        height *
        (0.48 +
          0.38 * (1 + 0.1 * Math.sin(t * 0.09 + 2)) * Math.sin(t * 0.39 + 1.1));
      let goal = strengthAt(sprite.x, sprite.y) * 0.7;
      if (spriteStampAt === Infinity)
        spriteStampAt = time + 1000 + Math.random() * 1000;
      if (!spriteHold && time >= spriteStampAt)
        spriteHold = {
          x: sprite.x,
          y: sprite.y,
          start: time,
          charge: Math.random() * 0.2,
        };
      if (spriteHold) {
        spriteHold.x = sprite.x;
        spriteHold.y = sprite.y;
        goal *= 0.4;
        if (chargeOf(time, spriteHold.start) >= spriteHold.charge) {
          launch(spriteHold.x, spriteHold.y, spriteHold.charge, time);
          spriteHold = null;
          spriteStampAt = time + 2000 + Math.random() * 1000;
        }
      }
      sprite.strength += (goal - sprite.strength) * 0.08;
      pointer.strength += (targetStrength - pointer.strength) * 0.3;
    }
    for (let i = stamps.length - 1; i >= 0; i--) {
      const stamp = stamps[i]!;
      const age = (time - stamp.born) / (1000 * stamp.life);
      if (age >= 1) {
        stamps.splice(i, 1);
        continue;
      }
      stamp.cell =
        cw * (stamp.from + (stamp.to - stamp.from) * (1 - (1 - age) ** 3));
      stamp.amp = (1 - age) ** 1.7;
    }
    ctx.fillStyle = palette.bg;
    ctx.fillRect(0, 0, width, height);
    const hasStamps =
      stamps.length > 0 || holding !== null || spriteHold !== null;
    for (let r = 0; r < rows; r++) {
      const row = rMin + r;
      const yTop = wmY + row * ch;
      const y = Math.round(yTop);
      const cellHeight = Math.round(yTop + ch) - y;
      const cy = yTop + ch / 2;
      for (let c = 0; c < cols; c++) {
        const col = cMin + c;
        if (
          col >= 0 &&
          col < WORDMARK_WIDTH &&
          row >= 0 &&
          row < WORDMARK_HEIGHT &&
          WORDMARK_ROWS[row]![col] === "1"
        )
          continue;
        const shade = ramp[r * cols + c]!;
        let lum = 0;
        if (shade > 0.002) {
          const u = col / 9;
          const v = row / 9;
          const base =
            0.6 * sample(noise, u + t * 0.14, v - t * 0.055) +
            0.4 * sample(noise, u * 0.55 - t * 0.08, v * 0.55 + t * 0.06);
          const twinkle =
            0.5 +
            0.5 *
              Math.sin(t * 1.1 + jitter[(row * 37 + col * 11) & 4095]! * 6.283);
          lum = shade * (0.3 + 0.52 * base * base + 0.18 * twinkle) * 0.62;
        }
        const xLeft = wmX + col * cw;
        const cx = xLeft + cw / 2;
        const glow = glowAt(cx, cy);
        const stamp = hasStamps ? stampAt(cx, cy) : 0;
        lum += glow * 0.6 + stamp * 1.15;
        const threshold =
          0.78 * ((BAYER[(row & 7) * 8 + (col & 7)]! + 0.5) / 64) +
          0.22 * jitter[(row & 63) * 64 + (col & 63)]!;
        if (lum <= threshold) continue;
        const heat = Math.max(glow, stamp);
        ctx.fillStyle =
          heat > 0.34 ? palette.lit : heat > 0.1 ? palette.mid : palette.dim;
        const x = Math.round(xLeft);
        ctx.fillRect(x, y, Math.round(xLeft + cw) - x, cellHeight);
      }
    }
    const activeOnWord =
      hasStamps ||
      glows.some(
        (glow) =>
          glow.strength > 0.01 &&
          glow.x > wmX - 12 * cw &&
          glow.x < wmX + WORDMARK_WIDTH * cw + 12 * cw &&
          glow.y > wmY - 12 * cw &&
          glow.y < wmY + WORDMARK_HEIGHT * ch + 12 * cw,
      );
    for (let row = 0; row < WORDMARK_HEIGHT; row++) {
      const bits = WORDMARK_ROWS[row]!;
      const yTop = wmY + row * ch;
      const y = Math.round(yTop);
      const rowHeight = Math.round(yTop + ch) - y;
      ctx.fillStyle = restInks[row]!;
      if (!activeOnWord) {
        let run = 0;
        for (let col = 0; col <= WORDMARK_WIDTH; col++) {
          if (bits[col] === "1") {
            run++;
            continue;
          }
          if (run) {
            const x = Math.round(wmX + (col - run) * cw);
            ctx.fillRect(x, y, Math.round(wmX + col * cw) - x, rowHeight);
            run = 0;
          }
        }
      } else {
        for (let col = 0; col < WORDMARK_WIDTH; col++) {
          if (bits[col] !== "1") continue;
          const xLeft = wmX + col * cw;
          const cx = xLeft + cw / 2;
          const cy = yTop + ch / 2;
          const crest = Math.max(
            glowAt(cx, cy),
            hasStamps ? stampAt(cx, cy) : 0,
          );
          ctx.fillStyle =
            crest > 0.45
              ? palette.crest
              : crest > 0.12
                ? palette.hover
                : restInks[row]!;
          const x = Math.round(xLeft);
          ctx.fillRect(x, y, Math.round(xLeft + cw) - x, rowHeight);
        }
      }
    }
    if (!painted) {
      host.classList.add("field-ready");
      painted = true;
    }
  };

  const loop = (time: number) => {
    if (disposed || !visible || document.hidden || !motionEnabled()) {
      frame = 0;
      return;
    }
    frame = requestAnimationFrame(loop);
    if (time - lastDraw < 1000 / 30) return;
    lastDraw = time;
    draw(time);
  };
  const syncMotion = () => {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    if (disposed) return;
    if (!motionEnabled()) {
      stamps.length = 0;
      holding = null;
      spriteHold = null;
      pointer.strength = 0;
      sprite.strength = 0;
    }
    draw(lastDraw);
    if (visible && !document.hidden && motionEnabled())
      frame = requestAnimationFrame(loop);
  };
  const locate = (event: PointerEvent) => {
    const box = host.getBoundingClientRect();
    return {
      x: (event.clientX - box.left) * dpr,
      y: (event.clientY - box.top) * dpr,
    };
  };
  const onMove = (event: PointerEvent) => {
    if (!finePointer.matches || !motionEnabled()) return;
    const point = locate(event);
    pointer.x = point.x;
    pointer.y = point.y;
    targetStrength = holding ? 0 : strengthAt(point.x, point.y);
  };
  const onLeave = () => {
    targetStrength = 0;
  };
  const onDown = (event: PointerEvent) => {
    if (
      !motionEnabled() ||
      event.button !== 0 ||
      (event.target instanceof Element &&
        event.target.closest("a,button,input,select,textarea,label"))
    )
      return;
    const point = locate(event);
    holding = { ...point, start: performance.now() };
    targetStrength = 0;
  };
  const onUp = () => {
    if (!holding) return;
    const now = performance.now();
    launch(holding.x, holding.y, chargeOf(now, holding.start), now);
    holding = null;
  };
  const onCancel = () => {
    holding = null;
    targetStrength = 0;
  };
  host.addEventListener("pointermove", onMove, { passive: true });
  host.addEventListener("pointerleave", onLeave, { passive: true });
  host.addEventListener("pointerdown", onDown, { passive: true });
  window.addEventListener("pointerup", onUp, { passive: true });
  window.addEventListener("pointercancel", onCancel, { passive: true });
  host.addEventListener("contextmenu", onCancel, { passive: true });
  document.addEventListener("visibilitychange", syncMotion);
  reducedMotion.addEventListener("change", syncMotion);
  const resize = new ResizeObserver(() => {
    if (measure()) syncMotion();
  });
  resize.observe(host);
  resize.observe(slot);
  const content = host.querySelector(".hero-content");
  if (content) resize.observe(content);
  const visibility = new IntersectionObserver(([entry]) => {
    if (!entry) return;
    visible = entry.isIntersecting;
    syncMotion();
  });
  visibility.observe(host);
  const theme = new MutationObserver(() => {
    readPalette();
    syncMotion();
  });
  theme.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
  const pause = new MutationObserver(syncMotion);
  pause.observe(canvas, { attributes: true, attributeFilter: ["data-paused"] });
  if (measure()) syncMotion();
  return () => {
    disposed = true;
    cancelAnimationFrame(frame);
    resize.disconnect();
    visibility.disconnect();
    theme.disconnect();
    pause.disconnect();
    host.removeEventListener("pointermove", onMove);
    host.removeEventListener("pointerleave", onLeave);
    host.removeEventListener("pointerdown", onDown);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onCancel);
    host.removeEventListener("contextmenu", onCancel);
    document.removeEventListener("visibilitychange", syncMotion);
    reducedMotion.removeEventListener("change", syncMotion);
    host.classList.remove("field-ready");
  };
}
