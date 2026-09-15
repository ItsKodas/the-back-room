# Mobile Animation Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make animation smooth on phones — the room's haze and the slot reels above all — without changing what anything looks like or how anything moves.

**Architecture:** Three changes to where the work happens, none to what is drawn. The haze stops re-reading the cascade every frame, draws its soft clouds into a half-resolution canvas the browser scales up, keeps its clouds when a phone's address bar resizes the window, and stops redrawing a picture that is not moving. The room's background moves off `body` (where `background-attachment: fixed` repaints on every scroll) onto the fixed haze element that already covers the window. The slot strip that moves during a spin becomes an HTML layer holding one drawing, so the GPU slides a picture painted once instead of the main thread repainting five reels of vector art every frame.

**Tech Stack:** React 18, Canvas 2D, SVG, Web Animations API, CSS, Vitest (jsdom) + Testing Library, Biome, Chrome DevTools remote debugging.

**Spec:** None written separately — agreed in conversation, with the condition that quality is not affected. Summarised under **Design** below.

## Global Constraints

- **No change in quality.** Nothing a player sees at rest may change, and no motion may change its path, timing, easing or overshoot. The one permitted difference is on iOS: Safari ignores `background-attachment: fixed`, so the room's background currently scrolls with the page there; after Task 4 it stays put, as it already does on desktop and Android.
- If a before/after comparison (Task 6) shows any visible difference, the change that caused it is adjusted or reverted — never accepted as "close enough".
- Out of scope unless Task 6's traces point at them: Death Roll's animated `filter: blur` (`deathroll.css` `dr-tumble`/`dr-settle`) and Two-Up's `backdrop-filter` (`twoup.css:612`). Removing a blur changes the look.
- Every keyframe keeps its `prefers-reduced-motion` off switch; the reduced-motion reel (`.reel__blur` bands) is untouched.
- Read `CLAUDE.md` before starting. Comments say why, not what, in the voice of the surrounding code.
- Before adding CSS, confirm the stylesheet is imported: `global.css` from `apps/web/src/main.tsx`; `slots.css` from `apps/web/src/slots/Slots.tsx`.
- After editing: `npx biome format --write <files you touched>` — **never** `biome check --write`.
- `npm test`, `npm run typecheck`, `npm run lint` clean before each commit.
- Commit messages end with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

## Design

- **Haze colour.** Every game page sets `document.documentElement.dataset.game` on mount and deletes it on unmount, and the theme files re-light `:root[data-game="…"]`. So the air colour can only change when that attribute does. Read it once on mount and again from a `MutationObserver` on `data-game`, instead of `getComputedStyle` sixty times a second.
- **Haze resolution.** The canvas backing store drops from up to 1.5× device pixels to 0.5× CSS pixels (`BACKING_SCALE`). Every shape on it is a radial gradient over a hundred-plus CSS pixels in radius, so the browser's upscale is indistinguishable — and it is nine times fewer pixels to fill each frame on a modern phone. Task 6 compares it by eye; if anything differs, raise `BACKING_SCALE` to `0.75`.
- **Haze resize.** A phone fires `resize` whenever the address bar slides in or out. The canvas is resized but the clouds are kept, instead of being thrown away and re-seeded — which also removes a visible jump.
- **Haze standing still.** With reduced motion on, the clouds do not move, but the loop repainted the same picture every frame. It now draws once, and again only on resize, room change or a change of preference.
- **Room background.** The room's gradients move from `body` to `.haze`, the fixed full-window element already behind the page. A canvas cleared to transparent shows its own CSS background, and the canvas's `lighter` blending only ever applied between clouds inside the bitmap, so the composite is the same picture.
- **Reels.** While turning, the strip renders as `div.reel__window > div.reel__strip > svg.reel__drawing`. The drawing has the same faces, the same `viewBox` scale (one `FACE_SIZE` per face across the reel's width) and the same `data-landing` markers. Offsets are expressed as a percentage of the strip's own height, so motion is still counted in faces and `FACE_MS` per face; the loop, the cruise, the brake and the overshoot keyframes are the same numbers converted. Settled faces, the resting reel and the reduced-motion bands stay in `svg.reel__glass` exactly as they are.

---

## File map

| File | Responsibility |
|---|---|
| `apps/web/src/atmosphere/Haze.tsx` | Colour read on room change, `BACKING_SCALE`, keep clouds on resize, draw once when still |
| `apps/web/src/atmosphere/Haze.test.tsx` (new) | Haze tests against a fake 2D context and a manual frame clock |
| `apps/web/src/global.css` | Background off `body`, onto `.haze` |
| `apps/web/src/global.css.test.ts` (new) | The background rule, read from source |
| `apps/web/src/slots/Reel.tsx` | Moving strip as an HTML layer; percentage keyframes |
| `apps/web/src/slots/Reel.test.tsx` | The strip is HTML; it is animated; loop and landing keyframes |
| `apps/web/src/slots/slots.css` | `.reel__window`, `.reel__drawing` |

---

### Task 1: Measure before touching anything

No code. This is the "before" that Task 6 is judged against, so it has to exist first.

- [ ] **Step 1: Build and serve the current code**

```bash
npm run build
npm start -w @backroom/server
```

The server logs `listening on http://localhost:3001`.

- [ ] **Step 2: Screenshots for visual comparison**

In desktop Chrome DevTools, device toolbar at **375×812**, then again at **1280×800**, save a screenshot (⋮ → Capture screenshot) of each:
- `/` (the room)
- `/slots` idle, before any pull
- `/slots` right after a spin that won a line, with the lines lit
- `/blackjack`
- `/slots` with DevTools → Rendering → **Emulate CSS prefers-reduced-motion: reduce**, mid-spin

Save them to a folder outside the repository, named `before-<page>-<width>.png`. They are for comparison, not for committing.

- [ ] **Step 3: A trace from a real phone**

An Android phone on the same network as the dev machine, with USB debugging on:
1. Run `npm run dev` and open `http://<this machine's LAN IP>:5173/slots` on the phone.
2. Plug the phone in, open `chrome://inspect#devices` on the desktop, and click **inspect** under the phone's tab.
3. In that DevTools window, go to Performance → Record, pull the lever three times, and stop.
4. Note the frame rate during the spins and the share of dropped frames, from the Frames track.
5. Do the same on `/` for ten idle seconds.
6. Rendering → **Paint flashing** on, spin once, and note whether the reels flash green on every frame.

Write the numbers down. They go in the PR description with the "after" numbers.

---

### Task 2: The haze reads its colour when the room changes, not every frame

**Files:**
- Modify: `apps/web/src/atmosphere/Haze.tsx:94-108` (the `accent` helper), `:126` (its call in `draw`), `:203-214` (setup and cleanup)
- Test: `apps/web/src/atmosphere/Haze.test.tsx` (new)

**Interfaces:**
- Consumes: `document.documentElement.dataset.game`, set by each game page.
- Produces: nothing exported yet. The test harness in this file is extended by Task 3.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/atmosphere/Haze.test.tsx`:

```tsx
// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Haze } from "./Haze.js";

/**
 * The haze, run on a clock this file turns by hand.
 *
 * jsdom has no canvas, so the context is a fake that only remembers where it
 * was asked to draw — which is enough, because what matters here is how much
 * work each frame does, not what the pixels are.
 */

let frames: FrameRequestCallback[] = [];
let arcs: Array<{ x: number; y: number }> = [];
let reduced = false;

function fakeContext() {
  return {
    globalCompositeOperation: "source-over",
    fillStyle: "",
    clearRect: () => {},
    setTransform: () => {},
    beginPath: () => {},
    fill: () => {},
    arc: (x: number, y: number) => {
      arcs.push({ x, y });
    },
    createRadialGradient: () => ({ addColorStop: () => {} }),
  };
}

/** Runs the frames that are due, `count` times over. */
function runFrames(count: number) {
  for (let turn = 0; turn < count; turn += 1) {
    const due = frames;
    frames = [];
    for (const callback of due) {
      callback(performance.now() + 16 * (turn + 1));
    }
  }
}

function set(name: string, value: unknown) {
  Object.defineProperty(window, name, { configurable: true, writable: true, value });
}

/** How many times the air's colour has been read off the cascade. */
function colourReads(spy: { mock: { calls: unknown[][] } }): number {
  return spy.mock.calls.filter(([name]) => name === "--gr-color-air-hi").length;
}

beforeEach(() => {
  frames = [];
  arcs = [];
  reduced = false;
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    () => fakeContext() as unknown as CanvasRenderingContext2D,
  );
  set("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  });
  set("cancelAnimationFrame", () => {
    frames = [];
  });
  set("matchMedia", () => ({
    matches: reduced,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  set("devicePixelRatio", 3);
  set("innerWidth", 400);
  set("innerHeight", 800);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  delete document.documentElement.dataset["game"];
});

describe("the colour of the air", () => {
  it("is read once, not on every frame", () => {
    /*
     * Reading the cascade makes the browser settle every style on the page
     * first — sixty times a second, on every page, for a colour that only
     * changes when somebody walks into another room.
     */
    const reads = vi.spyOn(CSSStyleDeclaration.prototype, "getPropertyValue");
    render(<Haze />);
    runFrames(30);

    expect(colourReads(reads)).toBe(1);
  });

  it("is read again when somebody walks into another room", async () => {
    const reads = vi.spyOn(CSSStyleDeclaration.prototype, "getPropertyValue");
    render(<Haze />);
    runFrames(5);

    document.documentElement.dataset["game"] = "slots";
    // A MutationObserver reports on a microtask.
    await act(async () => {});
    runFrames(5);

    expect(colourReads(reads)).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/web/src/atmosphere/Haze.test.tsx`
Expected: FAIL — `expected 30 to be 1` and `expected 10 to be 2`: the old haze reads the colour once per frame.

- [ ] **Step 3: Implement**

In `apps/web/src/atmosphere/Haze.tsx`, replace the `accent` helper (the JSDoc block starting "What the air is lit by" and the `const accent = () => { … };` under it) with:

```ts
    /**
     * What the air is lit by, read from the cascade so a game change re-tints.
     *
     * The room's own light rather than its sign. Those are the same thing in
     * the building, where the sign is the only light there is, and different
     * in a card room lit low over a green floor — which was being shown
     * through blue air until this stopped asking the tube.
     *
     * Read when the room changes rather than on every frame. Asking the
     * cascade makes the browser settle every style on the page first, and
     * the only thing that re-lights the air is a page setting data-game on
     * the document — which is what the observer below is watching for.
     */
    let colour = { core: "#7ba9ff", deep: "#2e7bff" };
    const readColour = () => {
      const styles = window.getComputedStyle(document.documentElement);
      colour = {
        core: styles.getPropertyValue("--gr-color-air-hi").trim() || "#7ba9ff",
        deep: styles.getPropertyValue("--gr-color-air").trim() || "#2e7bff",
      };
    };
```

In `draw`, delete the line:

```ts
      const colour = accent();
```

Replace the setup and cleanup at the end of the effect:

```ts
    size();
    start();
    window.addEventListener("resize", size);
    document.addEventListener("visibilitychange", visibility);
    lessMotion.addEventListener("change", preference);

    return () => {
      stop();
      window.removeEventListener("resize", size);
      document.removeEventListener("visibilitychange", visibility);
      lessMotion.removeEventListener("change", preference);
    };
```

with:

```ts
    const room = new MutationObserver(readColour);

    readColour();
    size();
    start();
    window.addEventListener("resize", size);
    document.addEventListener("visibilitychange", visibility);
    lessMotion.addEventListener("change", preference);
    room.observe(document.documentElement, { attributes: true, attributeFilter: ["data-game"] });

    return () => {
      stop();
      room.disconnect();
      window.removeEventListener("resize", size);
      document.removeEventListener("visibilitychange", visibility);
      lessMotion.removeEventListener("change", preference);
    };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run apps/web/src/atmosphere/Haze.test.tsx`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
npx biome format --write apps/web/src/atmosphere/Haze.tsx apps/web/src/atmosphere/Haze.test.tsx
npm run typecheck
npm run lint
git add apps/web/src/atmosphere/Haze.tsx apps/web/src/atmosphere/Haze.test.tsx
git commit -m "perf(web): read the haze's colour when the room changes, not every frame" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: The haze does less work for the same picture

**Files:**
- Modify: `apps/web/src/atmosphere/Haze.tsx` (`HAZE` constants area, `size`, the end of `draw`, `preference`, listener setup and cleanup)
- Test: `apps/web/src/atmosphere/Haze.test.tsx`

**Interfaces:**
- Consumes: the harness and `readColour`/`room` from Task 2.
- Produces: `export const BACKING_SCALE = 0.5` from `Haze.tsx`.

- [ ] **Step 1: Write the failing tests**

Change the import in `apps/web/src/atmosphere/Haze.test.tsx` to:

```tsx
import { BACKING_SCALE, Haze } from "./Haze.js";
```

and append:

```tsx
describe("the work each frame does", () => {
  it("fills a canvas a fraction the size of the window, whatever the screen's density", () => {
    /*
     * Every shape on it is a gradient a hundred pixels and more across, which
     * a browser scales up without a visible seam. At a phone's density the old
     * backing store was nine times the pixels for the same picture.
     */
    const { container } = render(<Haze />);
    const canvas = container.querySelector("canvas") as HTMLCanvasElement;

    expect(canvas.width).toBe(Math.round(400 * BACKING_SCALE));
    expect(canvas.height).toBe(Math.round(800 * BACKING_SCALE));
  });

  it("keeps its clouds where they were when a phone's address bar changes the height", () => {
    // That resize fires on every scroll that shows or hides the bar, and
    // re-seeding on it threw every cloud somewhere new mid-scroll.
    render(<Haze />);
    runFrames(1);
    const before = arcs.slice(0, 6);

    arcs = [];
    set("innerHeight", 740);
    window.dispatchEvent(new Event("resize"));
    runFrames(1);
    const after = arcs.slice(0, 6);

    expect(after).toHaveLength(6);
    after.forEach((cloud, index) => {
      expect(Math.abs(cloud.x - (before[index]?.x ?? Number.NaN))).toBeLessThan(5);
      expect(Math.abs(cloud.y - (before[index]?.y ?? Number.NaN))).toBeLessThan(5);
    });
  });

  it("draws once and stops when motion is turned off, and redraws only when something changes", () => {
    reduced = true;
    render(<Haze />);
    runFrames(1);

    expect(arcs).toHaveLength(6);
    expect(frames).toHaveLength(0);

    window.dispatchEvent(new Event("resize"));
    expect(frames).toHaveLength(1);
    runFrames(1);
    expect(arcs).toHaveLength(12);
    expect(frames).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run apps/web/src/atmosphere/Haze.test.tsx`
Expected: FAIL — `BACKING_SCALE` is undefined (an import error or `NaN`); the resize test reports cloud positions hundreds of pixels apart; the still test reports `expected [ … ] to have a length of 0 but got 1`.

- [ ] **Step 3: Implement**

In `apps/web/src/atmosphere/Haze.tsx`, add below the `HAZE` constant:

```ts
/**
 * Canvas pixels per CSS pixel.
 *
 * Below one on purpose. Everything on this canvas is a radial gradient over a
 * hundred-odd CSS pixels, and a browser scaling that up is indistinguishable
 * from drawing it full size — while filling it at a phone's own density was
 * nine times the pixels, every frame, on every page. If the haze ever gains
 * anything with an edge, this is the number that has to come back up.
 */
export const BACKING_SCALE = 0.5;
```

Replace the whole `size` function (the JSDoc-commented block that begins `const size = () => {`) with:

```ts
    const size = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.max(1, Math.round(width * BACKING_SCALE));
      canvas.height = Math.max(1, Math.round(height * BACKING_SCALE));
      // Setting a canvas's size resets its transform, so this comes after.
      context.setTransform(BACKING_SCALE, 0, 0, BACKING_SCALE, 0, 0);
      /*
       * Seeded once. A phone resizes the window every time its address bar
       * slides in or out, and re-seeding on that threw every cloud somewhere
       * new in the middle of a scroll. A cloud left outside a smaller window
       * simply wraps back in, the way one drifting off the edge always has.
       */
      if (clouds.length === 0) {
        seed();
      }
    };
```

At the end of `draw`, replace:

```ts
      context.globalCompositeOperation = "source-over";
      frame = window.requestAnimationFrame(draw);
    };
```

with:

```ts
      context.globalCompositeOperation = "source-over";
      // Air that is not moving is one picture, not sixty a second of the same one.
      frame = moving ? window.requestAnimationFrame(draw) : 0;
    };
```

Replace `preference`:

```ts
    const preference = () => {
      moving = !lessMotion.matches;
    };
```

with:

```ts
    const preference = () => {
      moving = !lessMotion.matches;
      start();
    };

    /** Anything that changes the picture asks for one more frame of it. */
    const resized = () => {
      size();
      start();
    };
```

Change the observer from Task 2:

```ts
    const room = new MutationObserver(readColour);
```

to:

```ts
    const room = new MutationObserver(() => {
      readColour();
      start();
    });
```

In the listener setup and cleanup, replace both `"resize", size` with `"resize", resized`:

```ts
    window.addEventListener("resize", resized);
```

```ts
      window.removeEventListener("resize", resized);
```

`start` is already a no-op while a frame is pending, so these calls cost nothing while the air is moving.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run apps/web/src/atmosphere/Haze.test.tsx apps/web/src/App.test.tsx`
Expected: PASS — 5 haze tests, and the app test, which renders the haze with no canvas at all.

- [ ] **Step 5: Commit**

```bash
npx biome format --write apps/web/src/atmosphere/Haze.tsx apps/web/src/atmosphere/Haze.test.tsx
npm run typecheck
npm run lint
git add apps/web/src/atmosphere/Haze.tsx apps/web/src/atmosphere/Haze.test.tsx
git commit -m "perf(web): draw the haze at half resolution, keep it on resize, stop when still" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: The room's background stops repainting on scroll

**Files:**
- Modify: `apps/web/src/global.css:25-36` (`body`) and `:58-66` (`.haze`)
- Test: `apps/web/src/global.css.test.ts` (new)

**Interfaces:**
- Consumes: `.haze`, the fixed full-window canvas from `Haze.tsx`, rendered at the top of `App.tsx`.
- Produces: nothing code-level.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/global.css.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Where the room's own light is painted.
 *
 * Read from source: the failure is a phone repainting the whole window on
 * every scroll, which nothing in jsdom can see.
 */
const css = readFileSync(fileURLToPath(new URL("./global.css", import.meta.url)), "utf8");

/** The declarations of the first rule whose selector is exactly `selector`. */
function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? "";
}

describe("the room's background", () => {
  it("is not a fixed background on the page, which a phone repaints on every scroll", () => {
    expect(css).not.toMatch(/background-attachment:\s*fixed/);
  });

  it("is painted on the fixed layer already behind everything, so it still does not move", () => {
    const haze = rule(".haze");
    expect(haze).toContain("var(--gr-color-felt)");
    expect(haze).toContain("var(--gr-color-smoke-lit)");
    expect(haze).toContain("var(--gr-color-night)");
  });

  it("leaves the page itself the room's plain dark, for the moment before anything draws", () => {
    expect(rule("body")).toMatch(/background:\s*var\(--gr-color-night\);/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/web/src/global.css.test.ts`
Expected: FAIL, 3 tests.

- [ ] **Step 3: Implement**

In `apps/web/src/global.css`, replace the `body` comment and rule:

```css
/*
 * The room you are standing in.
 *
 * Not one flat colour: the floor comes up from below and the light from the
 * sign falls across one upper corner, which is what makes a page read as
 * somewhere rather than as a dark rectangle. The same two washes the tiles on
 * the front page are painted with, so walking into a room looks like the tile
 * you walked in through.
 *
 * Fixed rather than scrolling, so a long page does not drag the floor up past
 * the ceiling — and painted on the body itself, under the haze, which sits a
 * layer above it.
 */
body {
  margin: 0;
  background:
    radial-gradient(85% 62% at 50% 104%, var(--gr-color-felt) 0%, transparent 78%),
    radial-gradient(62% 46% at 4% -6%, var(--gr-color-smoke-lit) 0%, transparent 76%),
    var(--gr-color-night);
  background-attachment: fixed;
  color: var(--gr-color-ink);
```

with:

```css
/*
 * The page under everything: the room's plain dark, which is what shows for
 * the moment before the haze has mounted. The room's light is painted on the
 * haze itself, below.
 */
body {
  margin: 0;
  background: var(--gr-color-night);
  color: var(--gr-color-ink);
```

and replace the `.haze` rule:

```css
.haze {
  position: fixed;
  inset: 0;
  z-index: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  display: block;
}
```

with:

```css
/*
 * The room you are standing in, painted on the air.
 *
 * Not one flat colour: the floor comes up from below and the light from the
 * sign falls across one upper corner, which is what makes a page read as
 * somewhere rather than as a dark rectangle. The same two washes the tiles on
 * the front page are painted with, so walking into a room looks like the tile
 * you walked in through.
 *
 * On this layer rather than on body. It has to stay put while the page
 * scrolls, and `background-attachment: fixed` — how body did that — makes a
 * phone repaint the whole window on every scroll, while iOS ignores it and
 * dragged the floor up past the ceiling anyway. This element is already fixed
 * and already the size of the window, and a canvas cleared to nothing shows
 * its own background, so the clouds are drawn over exactly what was there.
 */
.haze {
  position: fixed;
  inset: 0;
  z-index: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  display: block;
  background:
    radial-gradient(85% 62% at 50% 104%, var(--gr-color-felt) 0%, transparent 78%),
    radial-gradient(62% 46% at 4% -6%, var(--gr-color-smoke-lit) 0%, transparent 76%),
    var(--gr-color-night);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run apps/web/src/global.css.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Look at it**

`npm run dev`, open `http://localhost:5173/` and `/slots` at 375px and 1280px, and compare against the Task 1 screenshots. The background must be identical, including the violet of the slots room — its colours come from `:root[data-game="slots"]`, which `.haze` inherits exactly as `body` did. Scroll a long page (`/leaderboard`): the floor stays at the bottom of the window.

- [ ] **Step 6: Commit**

```bash
npx biome format --write apps/web/src/global.css.test.ts
git add apps/web/src/global.css apps/web/src/global.css.test.ts
git commit -m "perf(web): paint the room on the fixed haze layer instead of a fixed body background" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: The slot strip slides as one picture

**Files:**
- Modify: `apps/web/src/slots/Reel.tsx:152` (`strip` ref), `:236-282` (the animation effect), `:284-352` (the returned markup)
- Modify: `apps/web/src/slots/slots.css:866-882` (reel glass and strip rules)
- Test: `apps/web/src/slots/Reel.test.tsx`

**Interfaces:**
- Consumes: `FACE_SIZE`, `ReelFace` from `./Symbols.js`; the `FaceDefs` gradients and clips, already mounted once in `.slots__glass` by `Slots.tsx` and referenced by id from any SVG in the document.
- Produces: no change to `Reel`'s props or exports. The DOM changes only while turning: `.reel__window > .reel__strip > svg.reel__drawing[role=img][aria-label=Spinning]`.

- [ ] **Step 1: Write the failing tests**

In `apps/web/src/slots/Reel.test.tsx`, add `import { FACE_SIZE } from "./Symbols.js";` below the `Reel` import, and append:

```tsx
describe("the strip going past", () => {
  let animate: ReturnType<typeof vi.fn>;
  /** The element each `animate` call was made on, in order. */
  let targets: Element[];

  beforeEach(() => {
    // jsdom has no Web Animations; this records what the reel asks for, and of what.
    targets = [];
    animate = vi.fn(function (this: Element) {
      targets.push(this);
      return { cancel: () => {} };
    });
    Object.defineProperty(HTMLElement.prototype, "animate", { configurable: true, value: animate });
  });

  afterEach(() => {
    Reflect.deleteProperty(HTMLElement.prototype, "animate");
  });

  it("is an HTML layer rather than a group inside the drawing, so a phone can slide it without repainting it", () => {
    /*
     * A group inside an SVG has no layer of its own. Every frame of a spin
     * repainted all five reels' faces, gradients and clips on the main thread,
     * which a desktop absorbs and a phone shows as a stutter.
     */
    const { container } = render(<Reel column={undefined} spinning index={0} />);
    const strip = container.querySelector(".reel__strip");

    expect(strip?.namespaceURI).toBe("http://www.w3.org/1999/xhtml");
    expect(strip?.closest("svg")).toBeNull();
    expect(targets[0]).toBe(strip);
  });

  it("draws the faces going past at the same scale as the ones that land", () => {
    const { container } = render(<Reel column={undefined} spinning index={0} />);
    const drawing = container.querySelector(".reel__strip svg");
    const faces = container.querySelectorAll(".reel__strip [data-face]").length;

    expect(faces).toBeGreaterThan(0);
    expect(drawing?.getAttribute("viewBox")).toBe(`0 0 ${FACE_SIZE} ${faces * FACE_SIZE}`);
  });

  it("still tells a screen reader it is spinning", () => {
    const { getByRole } = render(<Reel column={undefined} spinning index={0} />);
    expect(getByRole("img", { name: "Spinning" })).not.toBeNull();
  });

  it("loops by exactly one run of faces, so the wrap has no seam", () => {
    render(<Reel column={undefined} spinning index={0} />);
    const [keyframes, options] = animate.mock.calls[0] as [Keyframe[], KeyframeAnimationOptions];

    // The strip is that run twice over, so one run is half its height.
    expect(keyframes.map((frame) => frame.transform)).toEqual(["translateY(0%)", "translateY(-50%)"]);
    expect(options.iterations).toBe(Number.POSITIVE_INFINITY);
  });

  it("lands past the mark and settles back onto it, the way it always has", () => {
    const { rerender } = render(<Reel column={undefined} spinning index={0} />);
    rerender(<Reel column={column} spinning={false} index={0} />);

    const landing = animate.mock.calls.at(-1) as [Keyframe[], KeyframeAnimationOptions];
    const [keyframes, options] = landing;
    const along = (frame: Keyframe) => Number(/translateY\((-?[\d.]+)%\)/.exec(String(frame.transform))?.[1]);

    expect(keyframes).toHaveLength(4);
    expect(options.fill).toBe("forwards");
    const overshoot = along(keyframes[2] as Keyframe);
    const settled = along(keyframes[3] as Keyframe);
    // Further along the strip is further negative.
    expect(overshoot).toBeLessThan(settled);
    expect(settled).toBeLessThan(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run apps/web/src/slots/Reel.test.tsx`
Expected: FAIL. The strip's namespace is `http://www.w3.org/2000/svg`, and `animate` is never called because the strip is an SVG group, not an `HTMLElement`, so the remaining new tests fail on `undefined`. The 12 existing tests still pass.

- [ ] **Step 3: Change the ref type**

In `apps/web/src/slots/Reel.tsx`, replace:

```ts
  const strip = useRef<SVGGElement | null>(null);
```

with:

```ts
  const strip = useRef<HTMLDivElement | null>(null);
```

- [ ] **Step 4: Express the motion in faces**

Replace the animation effect — from `const isLanding = runUp !== null;` through the effect's closing `}, [isLanding, runUpCount, landingMs, still]);` — with:

```ts
  const isLanding = runUp !== null;
  const runUpCount = landing?.runUp ?? 0;
  const landingMs = landing?.ms ?? 0;
  const stripLength = passing?.length ?? 0;
  useEffect(() => {
    const element = strip.current;
    /*
     * `animate` is missing in jsdom, where these components are tested. The
     * reel is still correct without it — the strip is drawn, the timer still
     * lands it — so this is a guard rather than a bail-out.
     */
    if (element === null || still || stripLength === 0 || typeof element.animate !== "function") {
      return;
    }
    /*
     * A distance along the strip, counted in faces.
     *
     * As a share of the strip's own height rather than in pixels, because a
     * face is as tall as the reel is wide and the reel is as wide as the
     * cabinet lets it be. The same faces per millisecond at any size, and the
     * same numbers the reel always moved by, only counted in faces.
     */
    const along = (faces: number) => `translateY(${(-faces / stripLength) * 100}%)`;

    if (!isLanding) {
      const animation = element.animate([{ transform: along(0) }, { transform: along(LOOP_FACES) }], {
        duration: LOOP_FACES * FACE_MS,
        iterations: Number.POSITIVE_INFINITY,
        easing: "linear",
      });
      return () => animation.cancel();
    }

    if (landingMs < LANDING_FLOOR_MS) {
      return; // No room to land in; it simply arrives.
    }
    // Far enough to bring the run-up through and leave the last three in the
    // window, which is exactly the length of the run-up.
    const brake = Math.min(landingMs * BRAKE_SHARE, BRAKE_MS);
    const cruise = Math.max(0, landingMs - brake);
    const held = cruise / landingMs;
    const animation = element.animate(
      [
        // Still at full tilt: the reel has not been told to stop yet, and this
        // is the stretch that makes it read as one still turning.
        { transform: along(0), offset: 0, easing: "linear" },
        { transform: along(cruise / FACE_MS), offset: held, easing: "ease-out" },
        // Past the mark and back, because a reel on a spring does not stop
        // dead on the number it was heading for.
        { transform: along(runUpCount + OVERSHOOT / FACE_SIZE), offset: 0.94 },
        { transform: along(runUpCount), offset: 1 },
      ],
      { duration: landingMs, fill: "forwards" },
    );
    return () => animation.cancel();
  }, [isLanding, runUpCount, landingMs, still, stripLength]);
```

This is the same motion. The old cruise was `speed * cruise` pixels with `speed = FACE_SIZE / FACE_MS`, which is `cruise / FACE_MS` faces. The old overshoot target was `-runUpCount * FACE_SIZE - OVERSHOOT` pixels, which is `runUpCount + OVERSHOOT / FACE_SIZE` faces. `-0` formats as `0`, so the loop's first keyframe reads `translateY(0%)`.

- [ ] **Step 5: Render the strip as a layer**

Replace the whole `return ( … );` of `Reel` with:

```tsx
  return (
    <div
      className={`reel${turning ? " reel--spinning" : ""}${atRest === undefined ? "" : " reel--resting"}`}
    >
      {settled === undefined && !still ? (
        /*
         * The strip going past, as an HTML layer holding one drawing.
         *
         * It used to be a group inside the glass below, and a group inside an
         * SVG has no layer of its own: every frame of a spin repainted all
         * five reels — faces, gradients, clips — on the main thread. A desktop
         * absorbs that; a phone shows it as a stutter. A layer is painted once
         * and slid by the GPU. The drawing in it is the same faces at the same
         * scale, so nothing about how the reel looks has changed.
         */
        <div className="reel__window">
          <div className="reel__strip" ref={strip}>
            <svg
              className="reel__drawing"
              viewBox={`0 0 ${FACE_SIZE} ${FACE_SIZE * (passing ?? []).length}`}
              role="img"
              aria-label="Spinning"
            >
              {(passing ?? []).map((face, step) => (
                <g
                  // Position on the strip is the identity here: it is a fixed
                  // run of cells that never reorder, and the same face turns up
                  // several times over in it — keying by face would collide.
                  // biome-ignore lint/suspicious/noArrayIndexKey: the strip is positional
                  key={`${step}-${face}`}
                  transform={`translate(0 ${step * FACE_SIZE})`}
                  /*
                   * Not data-final. These are the server's faces, but they are
                   * moving into place rather than presented as the answer —
                   * `final` means resting under the payline, and a test holds
                   * that line.
                   */
                  {...(runUp !== null && step >= runUpCount ? { "data-landing": "" } : {})}
                >
                  <ReelFace face={face} />
                </g>
              ))}
            </svg>
          </div>
        </div>
      ) : (
        <svg
          className="reel__glass"
          viewBox={`0 0 ${FACE_SIZE} ${FACE_SIZE * ROWS.length}`}
          role="img"
          aria-label={turning ? "Spinning" : (settled ?? []).join(", ")}
        >
          {settled !== undefined ? (
            settled.map((face, row) => (
              <g
                key={ROWS[row] ?? row}
                transform={`translate(0 ${row * FACE_SIZE})`}
                data-final=""
                // Absent rather than "false": a face that did not win should
                // match nothing, and [data-won] matches an empty attribute.
                data-won={won?.[row] === true ? "" : undefined}
              >
                <ReelFace face={face} />
              </g>
            ))
          ) : (
            /*
             * Motion turned off. The strip is not drawn at all rather than drawn
             * standing still: three faces sitting there unmoving read as a
             * result, and this reel does not have one yet.
             */
            <g className="reel__blur">
              {[0, 1, 2, 3].map((band) => (
                <rect
                  key={band}
                  x="8"
                  y={band * FACE_SIZE * 0.75 + 6}
                  width={FACE_SIZE - 16}
                  height={FACE_SIZE * 0.42}
                  rx="8"
                  fill="currentColor"
                  opacity={0.16 + (band % 2) * 0.06}
                />
              ))}
            </g>
          )}
        </svg>
      )}
    </div>
  );
```

The conditions are the ones the old markup had: `settled` is undefined exactly when `turning` is true, so the first branch is "turning with motion on", the glass's first branch is "settled or resting", and its second is "turning with motion off".

- [ ] **Step 6: Style the window**

In `apps/web/src/slots/slots.css`, replace:

```css
/*
 * The strip going past.
 *
 * Moved by the Web Animations API rather than from here, because where it has
 * to stop is not known until the server answers — a keyframe would have to be
 * written per landing. What is left here is only that it must not be caught by
 * anything else that transitions.
 */
.reel__strip {
  will-change: transform;
}
```

with:

```css
/*
 * The reel's window while it turns: the same three faces tall as the glass
 * (FACE_SIZE × 3 rows in Reel.tsx, so 1 : 3), clipping the strip the way the
 * glass's own viewBox does.
 */
.reel__window {
  position: relative;
  width: 100%;
  aspect-ratio: 1 / 3;
  overflow: hidden;
}

/*
 * The strip going past.
 *
 * Moved by the Web Animations API rather than from here, because where it has
 * to stop is not known until the server answers — a keyframe would have to be
 * written per landing. `will-change` is what makes it a layer of its own, and
 * this is an HTML element precisely so that it can be one: the drawing inside
 * is painted once per spin and slid by the GPU, where a group inside an SVG
 * was repainted every frame.
 */
.reel__strip {
  will-change: transform;
}

/* One face per reel's width, exactly as the glass draws them. */
.reel__drawing {
  display: block;
  width: 100%;
  height: auto;
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx vitest run apps/web/src/slots apps/web/src/room`
Expected: PASS — all of `Reel.test.tsx` (12 existing, 5 new), `Symbols.test.tsx`, the slots page tests, and the room tests that draw the same faces in `TileArt`.

- [ ] **Step 8: Look at it**

`npm run dev`, open `/slots` at 1280px and 375px:
- Pull several times. The spin, the left-to-right landing, the overshoot and settle, and the face under the payline look as they did.
- The first frame of a spin has no jump or blank reel.
- A winning line animates as in the Task 1 screenshot. Those effects hang on `[data-won]` in the glass, which is unchanged.
- With **Emulate prefers-reduced-motion: reduce**, a spin shows the bands, matching the Task 1 screenshot.
- Resize the window mid-spin: the strip stays aligned, because its offsets are percentages.

- [ ] **Step 9: Commit**

```bash
npx biome format --write apps/web/src/slots/Reel.tsx apps/web/src/slots/Reel.test.tsx
npm run typecheck
npm run lint
git add apps/web/src/slots/Reel.tsx apps/web/src/slots/Reel.test.tsx apps/web/src/slots/slots.css
git commit -m "perf(slots): slide the spinning strip as an HTML layer instead of repainting the SVG" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Measure after, and compare what it looks like

No code, unless a comparison fails.

- [ ] **Step 1: Full suite**

Run: `npm test`, `npm run typecheck`, `npm run lint`
Expected: all clean.

- [ ] **Step 2: The same screenshots**

Repeat Task 1 Step 2 exactly, naming the files `after-<page>-<width>.png`, and compare each pair side by side, at 100% zoom and zoomed in on the haze:
- The background and haze match. If the haze looks softer, blockier or banded anywhere, set `BACKING_SCALE` to `0.75` in `Haze.tsx`, rebuild, and compare again. The test reads the constant, so it still passes.
- The slot faces at rest and the lit winning line match.
- The reduced-motion spin matches.

Any difference that is not the iOS scrolling note in **Global Constraints** is a failure: fix it before continuing.

- [ ] **Step 3: The same trace on the same phone**

Repeat Task 1 Step 3 on the same Android phone. Record:
- frame rate and dropped frames during three spins, and during ten idle seconds on `/`
- with paint flashing on: the reels no longer flash green on every frame during a spin (a flash when the strip first appears, or when it lands, is expected)

- [ ] **Step 4: The long spin**

On the phone, play until a reel is held on the brake (`holdMs`, e.g. two sevens on the first reels). The long strip must still slide smoothly and land cleanly. This is the tallest layer the reel ever makes.

- [ ] **Step 5: iPhone, if one is available**

Open `/slots` and `/` in Safari:
- the spin is smooth
- the faces are sharp, not blurry, while moving and at rest
- the background stays put while scrolling a long page (the one intended difference)

- [ ] **Step 6: Decide on the rest**

In the "after" trace, check whether Death Roll's dice (`filter: blur` keyframes) or Two-Up's bar (`backdrop-filter`) still drop frames. If they do, write that down as its own follow-up. Fixing either changes how it looks, so it needs its own decision.

- [ ] **Step 7: Record**

Put the before and after numbers, and the result of each comparison, in the PR description.
