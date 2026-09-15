import type { Face } from "@backroom/game-slots";
import { STRIP } from "@backroom/game-slots";
import { useEffect, useRef, useState } from "react";
import { FACE_SIZE, ReelFace } from "./Symbols.js";

/**
 * One column, and how it stops.
 *
 * A reel is a loop of faces that turns and then slows onto one of them, and
 * that is what this draws. The strip runs past too fast to read; when the
 * answer is in, the machine is handed a landing — a run-up ending in the three
 * faces the server actually sent — and slows across whatever time is left so
 * the last of them arrives under the payline exactly when the reel was always
 * going to stop.
 *
 * None of that invents a result. What goes past mid-spin is the same strip
 * painted on the reel, so the machine is not showing one reel while it turns
 * and a different one when it stops. The only faces presented as an answer are
 * the server's, and they carry `data-final` so a test can hold that line.
 *
 * Two floors keep the timing honest. A reel spins for at least SPIN_UP_MS
 * however fast the reply, because one that stops before it has visibly started
 * reads as a machine that had the answer ready. And each waits a further
 * REEL_STAGGER_MS per place to its right, so the row settles left to right and
 * the last reel is the one worth holding your breath for.
 */

/**
 * The shortest a reel may spin, however quickly the answer lands.
 *
 * Just under a second. It was three hundred milliseconds, which is long enough
 * to see and far too short to feel: the row had settled before the player's
 * hand was off the lever, and a machine that answers that fast reads as one
 * that had the answer ready — which it did, but it should not look like it.
 */
export const SPIN_UP_MS = 950;

/**
 * How much longer each reel spins than the one to its left.
 *
 * Wide enough that the reels land as five separate events rather than one
 * ripple. Five at this spacing put the last a shade over two seconds after the
 * lever, which is about where a real cabinet sits.
 */
export const REEL_STAGGER_MS = 280;

/**
 * The window the cabinet shows, named rather than counted.
 *
 * A reel has exactly these three cells and they never move; what changes is
 * the face in one. Naming them gives each cell a stable identity for React,
 * which an array index only looks like.
 */
const ROWS = ["top", "middle", "bottom"] as const;

/**
 * How many faces of run-up a free-running reel shows before it wraps.
 *
 * Only for the loop; a landing works out its own length from the time it has,
 * which is the whole trick to making one look like a reel slowing down.
 */
const LOOP_FACES = 9;

/** How long the deceleration takes, at most, and how much of the time it may eat. */
const BRAKE_MS = 620;
const BRAKE_SHARE = 0.5;

/** How long one face takes to pass while the reel is at speed. */
const FACE_MS = 42;

/** How far past the mark a reel swings before it settles back. */
const OVERSHOOT = 9;

/** The shortest landing worth animating; below this the reel simply arrives. */
const LANDING_FLOOR_MS = 60;

/**
 * A stretch of the reel, starting anywhere along it.
 *
 * The real strip rather than a handful of faces picked out: what goes past
 * mid-spin should be what is painted on the reel, or the machine is showing a
 * different reel while it turns than the one it stops on.
 */
function stretch(from: number, count: number): Face[] {
  return Array.from({ length: count }, (_, step) => STRIP[(from + step) % STRIP.length] as Face);
}

export function Reel({
  column,
  spinning,
  index,
  resting,
  holdMs = 0,
  won,
  onStop,
}: {
  /** What the server said is on this reel, or nothing while it is still out. */
  column: Face[] | undefined;
  /** Whether a pull is in the air. */
  spinning: boolean;
  /** Which reel this is, left to right. */
  index: number;
  /**
   * What to show before anybody has pulled anything.
   *
   * Not a result and never presented as one — dimmed, with nothing lit and
   * nothing said. A cabinet standing idle shows faces; one showing a blur
   * before you have touched it looks like it is already running.
   */
  resting?: Face[];
  /**
   * Longer on the brake, for a reel the answer is still riding on.
   *
   * The server has already said what every reel holds, so this invents
   * nothing — it only chooses how long to take saying it. Which is what a
   * machine does when the first three reels have come up sevens.
   */
  holdMs?: number;
  /**
   * Which of this reel's three rows are on a line that paid.
   *
   * Undefined until the lines light, and cleared with them. The reel does not
   * work this out: which lines paid is the table's answer, not something five
   * separate reels should each be deriving from the same grid.
   */
  won?: boolean[];
  /** Called the moment this reel actually settles, for the sound. */
  onStop?: () => void;
}) {
  /*
   * What is on the glass at rest. A reel with nothing here is a reel turning,
   * so this is the whole of the component's state: no separate "am I spinning"
   * flag to fall out of step with it.
   */
  const [shown, setShown] = useState<Face[] | undefined>(column);
  /**
   * The answer, once it is in, worked out as a landing.
   *
   * The run-up is measured rather than fixed. A reel that has to cross nine
   * faces in whatever time is left crosses them in the first third of it and
   * then crawls — which reads as stopping the instant the server answered,
   * because that is very nearly what it did. Sizing the run-up to the time
   * available lets it hold speed and brake at the end, like a reel.
   */
  const [landing, setLanding] = useState<{ faces: Face[]; runUp: number; ms: number } | null>(
    null,
  );
  const startedAt = useRef(Date.now());
  const wasSpinning = useRef(spinning);
  /** Whether this reel has ever been asked to turn, which ends the rest state. */
  const everSpun = useRef(false);
  const strip = useRef<HTMLDivElement | null>(null);
  /*
   * Held in a ref so a caller that rebuilds the callback each render does not
   * restart the timer underneath a spin that is already in the air.
   */
  const stopped = useRef(onStop);
  stopped.current = onStop;

  /*
   * Read once. Asking the media query every render would be one more thing
   * changing mid-spin, and this cannot change in any way worth reacting to
   * while five reels are in the air.
   */
  const [still] = useState(() => {
    try {
      return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch {
      return false;
    }
  });

  useEffect(() => {
    if (spinning && !wasSpinning.current) {
      // A new pull. Clear the glass and start the clock.
      everSpun.current = true;
      startedAt.current = Date.now();
      setShown(undefined);
      setLanding(null);
    }
    wasSpinning.current = spinning;
  }, [spinning]);

  useEffect(() => {
    if (column === undefined || shown !== undefined) {
      return;
    }
    /*
     * However long is left of this reel's spin, and no less than nothing: an
     * answer that took longer than the floor lands the reel at once rather
     * than adding a wait nobody asked for.
     */
    const floor = SPIN_UP_MS + index * REEL_STAGGER_MS + holdMs;
    const left = Math.max(0, floor - (Date.now() - startedAt.current));
    /*
     * Far enough to hold speed for as long as there is, then brake. Distance
     * is the cruise at full tilt plus the braking distance, which for a even
     * slowdown is half of what the same time at speed would cover.
     */
    const speed = FACE_SIZE / FACE_MS;
    const brake = Math.min(left * BRAKE_SHARE, BRAKE_MS);
    const cruise = Math.max(0, left - brake);
    const reach = speed * cruise + speed * brake * 0.5;
    setLanding({
      faces: column,
      runUp: Math.max(ROWS.length, Math.round(reach / FACE_SIZE)),
      ms: left,
    });
    const timer = window.setTimeout(() => {
      setShown(column);
      stopped.current?.();
    }, left);
    return () => window.clearTimeout(timer);
  }, [column, shown, index, holdMs]);

  /*
   * At rest only before the first pull. After that an empty reel means one
   * still out, and showing anything but the strip turning would be guessing at
   * the answer.
   */
  const atRest = shown === undefined && !spinning && !everSpun.current ? resting : undefined;
  const turning = shown === undefined && atRest === undefined;
  const settled = shown ?? atRest;

  /*
   * Started at a different place per reel, or all five turn in lockstep and
   * the row reads as one object rather than as five.
   */
  const from = index * 7;
  const runUp =
    turning && landing !== null ? [...stretch(from, landing.runUp), ...landing.faces] : null;
  /* Twice over while free-running, so the loop wraps without a seam. */
  const passing =
    runUp ?? (turning ? [...stretch(from, LOOP_FACES), ...stretch(from, LOOP_FACES)] : null);

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
              viewBox={`0 0 ${FACE_SIZE} ${FACE_SIZE * stripLength}`}
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
}
