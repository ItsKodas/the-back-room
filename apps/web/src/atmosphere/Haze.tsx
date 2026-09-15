import { useEffect, useRef } from "react";

/**
 * The air in the room.
 *
 * A few enormous, very faint clouds drifting behind everything, lit in
 * whatever colour the room is lit in. It is atmosphere and nothing else: it
 * takes no pointer events, occupies no space in the layout, and can be turned
 * off without a pixel moving.
 *
 * Kept deliberately dim. This building already promises that anything glowing
 * is happening now, and haze bright enough to notice on its own would start
 * spending that promise — at this brightness it reads as the room having
 * depth rather than as a light doing something.
 */

/** The settled recipe. Every number here was chosen by eye against the page. */
const HAZE = {
  /** Pixels a second, before each cloud's own pace. */
  speed: 30,
  /** How sharply a cloud may turn. Zero would be six straight lines. */
  wander: 0.6,
  count: 6,
  /** Multiplier on a radius taken from the window's diagonal. */
  size: 0.85,
  /** Peak opacity at the centre of a cloud. */
  brightness: 0.12,
};

interface Cloud {
  x: number;
  y: number;
  /**
   * A heading rather than a fixed velocity.
   *
   * Each cloud turns at its own rate, so the field never drifts as a block and
   * never loops back to an arrangement you have already seen — which a simple
   * sway does within about a minute.
   */
  heading: number;
  turnRate: number;
  pace: number;
  scale: number;
  breath: number;
}

export function Haze() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d") ?? null;
    if (canvas === null || context === null) {
      return;
    }

    let width = 0;
    let height = 0;
    let clouds: Cloud[] = [];
    let frame = 0;
    let last = performance.now();

    const lessMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let moving = !lessMotion.matches;

    const seed = () => {
      clouds = Array.from({ length: HAZE.count }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        heading: Math.random() * Math.PI * 2,
        turnRate: (Math.random() * 2 - 1) * 0.6,
        pace: 0.6 + Math.random() * 0.8,
        scale: 0.7 + Math.random() * 0.6,
        breath: Math.random() * Math.PI * 2,
      }));
    };

    const size = () => {
      /*
       * Capped below the real device ratio. This canvas covers the whole
       * window, and there is nothing on it but soft gradients — detail a
       * retina buffer would render at four times the fill cost and no
       * visible gain, because the thing being drawn is a blur.
       */
      const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.max(1, Math.round(width * ratio));
      canvas.height = Math.max(1, Math.round(height * ratio));
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      seed();
    };

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

    const rgba = (hex: string, alpha: number): string => {
      let value = hex.replace("#", "");
      if (value.length === 3) {
        value = `${value[0]}${value[0]}${value[1]}${value[1]}${value[2]}${value[2]}`;
      }
      const number = Number.parseInt(value, 16);
      const red = (number >> 16) & 255;
      const green = (number >> 8) & 255;
      const blue = number & 255;
      return `rgba(${red},${green},${blue},${alpha.toFixed(3)})`;
    };

    const draw = (now: number) => {
      const step = Math.min((now - last) / 1000, 0.05);
      last = now;

      const base = Math.hypot(width, height) * 0.26 * HAZE.size;
      context.clearRect(0, 0, width, height);
      context.globalCompositeOperation = "lighter";

      for (const cloud of clouds) {
        const radius = base * cloud.scale;

        if (moving) {
          cloud.heading += cloud.turnRate * HAZE.wander * step;
          const travel = HAZE.speed * cloud.pace * step;
          cloud.x += Math.cos(cloud.heading) * travel;
          cloud.y += Math.sin(cloud.heading) * travel;
          cloud.breath += step * 0.4;
        }

        // Wrapped only once the whole cloud is clear of the edge, so nothing
        // is ever seen arriving or leaving.
        if (cloud.x < -radius) cloud.x = width + radius;
        if (cloud.x > width + radius) cloud.x = -radius;
        if (cloud.y < -radius) cloud.y = height + radius;
        if (cloud.y > height + radius) cloud.y = -radius;

        const alpha = HAZE.brightness * (1 + 0.12 * Math.sin(cloud.breath));
        const gradient = context.createRadialGradient(
          cloud.x,
          cloud.y,
          0,
          cloud.x,
          cloud.y,
          radius,
        );
        gradient.addColorStop(0, rgba(colour.core, alpha));
        gradient.addColorStop(0.4, rgba(colour.deep, alpha * 0.55));
        gradient.addColorStop(1, rgba(colour.deep, 0));

        context.fillStyle = gradient;
        context.beginPath();
        context.arc(cloud.x, cloud.y, radius, 0, Math.PI * 2);
        context.fill();
      }

      context.globalCompositeOperation = "source-over";
      frame = window.requestAnimationFrame(draw);
    };

    const start = () => {
      if (frame === 0) {
        last = performance.now();
        frame = window.requestAnimationFrame(draw);
      }
    };

    const stop = () => {
      if (frame !== 0) {
        window.cancelAnimationFrame(frame);
        frame = 0;
      }
    };

    /*
     * Nothing to draw for somebody who is not looking. requestAnimationFrame
     * is already throttled in a hidden tab, but stopping outright means a
     * table left open in a background tab costs nothing at all.
     */
    const visibility = () => {
      if (document.hidden) {
        stop();
      } else {
        start();
      }
    };

    const preference = () => {
      moving = !lessMotion.matches;
    };

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
  }, []);

  /*
   * No role and no aria-hidden, both deliberately.
   *
   * A canvas counts as focusable for the purposes of aria-hidden and as
   * interactive for the purposes of a presentational role, so it can be given
   * neither. It needs neither: there is nothing inside it, so there is nothing
   * for a screen reader to reach or to announce. The empty element is already
   * the accurate description.
   */
  return <canvas className="haze" ref={canvasRef} />;
}
