import type { Face } from "@backroom/game-two-up";
import type { CSSProperties } from "react";
import { FLIGHT, SPIN, WOBBLE, easing, landings } from "./toss.js";
import "./twoup.css";

/**
 * The coin.
 *
 * Drawn procedurally rather than as an image, for the same reason the wheel
 * is: it has to read at a fortieth the size it is here (the room tile) and at
 * the size it actually tosses at, and a raster asset only ever serves one of
 * those well.
 *
 * The edge is what makes this a coin and not a card that says "coin" on it.
 * Twenty flat faces standing round the rim, each its own element in a shared
 * `preserve-3d` space, catch the light differently as the coin turns — a
 * silhouette can't do that, however good the artwork on the flat of it is.
 */

/** How many faces make up the rim. Costs forty elements for the pair, and is
    the whole difference between a coin and a flipping card. */
const EDGE_SEGMENTS = 20;
const EDGE_STEP = 360 / EDGE_SEGMENTS;
const EDGES = Array.from({ length: EDGE_SEGMENTS }, (_, n) => n);

/*
 * The three curves, computed once and handed to the stylesheet.
 *
 * Same reason the wheel does this at module scope: these are constants, and
 * re-deriving an integral every time a coin renders would be a strange way to
 * spend a frame.
 */
const FLIGHT_EASE = easing(FLIGHT);
const TUMBLE_EASE = easing(SPIN);
const WOBBLE_EASE = easing(WOBBLE);

/**
 * A small per-coin tilt, so two coins never read as one rigid thing.
 *
 * Derived from `turns` rather than carried as its own prop — the interface
 * this component is built to already guarantees two coins get different
 * `turns`, so borrowing it here costs nothing and can't drift out of step
 * with the thing that already makes them two objects.
 */
function driftOf(turns: number): number {
  return ((turns % 7) - 3) * 0.6;
}

/**
 * Where the coin ends up, as CSS works it out rather than as a number handed
 * in pre-added.
 *
 * The wheel writes its angles the same way and for the same reason: a whole
 * number of turns plus nought or a half turn, added in JavaScript and printed
 * as a decimal, survives only to about the twelfth place — far too small to
 * see, but enough that "a whole number of turns" stops being exactly true.
 * Written as `calc()`, CSS never sees two separately-rounded numbers to add.
 */
function coinTo(face: Face | null, turns: number): string {
  // A coin still in the air with no face yet decided has nothing to spin
  // toward. The number is never shown or read while this is true — see the
  // edge-on, blank rule below — so an arbitrary resting point costs nothing.
  const half = face === "tail" ? 180 : 0;
  return `calc(${turns} * 360deg + ${half}deg)`;
}

/** One face of the coin, struck rather than flat: a lit edge up-left, a
    shadowed one down-right, so it reads as metal under one light. */
function Struck({ children }: { children: React.ReactNode }) {
  return (
    <>
      <g transform="translate(-1.3,-1.3)" fill="var(--tu-copper-lit)">
        {children}
      </g>
      <g transform="translate(1.3,1.3)" fill="var(--tu-copper-deep)">
        {children}
      </g>
      <g fill="var(--tu-copper)">{children}</g>
    </>
  );
}

/** A head, in profile — the obverse every coin in this room shares. */
function HeadDevice() {
  return (
    <Struck>
      <ellipse cx="46" cy="38" rx="15" ry="17" />
      <path d="M58,30 C64,32 68,38 66,44 C65,48 61,50 57,49 C61,44 60,36 58,30 Z" />
      <path d="M40,52 C48,54 58,52 62,46 C63,53 58,59 51,62 C45,64 40,61 38,56 Z" />
      <path d="M38,60 L64,58 C66,68 68,76 70,84 L28,84 C30,74 34,66 38,60 Z" />
      <circle cx="42" cy="42" r="3.4" />
    </Struck>
  );
}

/** A kangaroo, standing tripod-style on its hind feet and tail — the reverse
    every coin in this room shares. */
function TailDevice() {
  return (
    <Struck>
      <path
        d="M60,22 C68,24 72,32 70,40 C69,44 66,47 62,48
             C66,52 68,58 66,64 C71,66 74,71 73,77
             C72,82 67,85 62,84
             C63,79 61,75 57,73
             C54,79 48,83 41,82
             C43,77 44,72 42,67
             C36,69 30,74 28,81
             C24,79 22,74 24,69
             C27,62 33,57 40,54
             C36,50 34,45 35,39
             C37,30 44,24 52,23
             C55,22 58,21 60,22 Z"
      />
      <circle cx="58" cy="28" r="3.6" />
      <path d="M62,20 L67,12 L64,22 Z" />
    </Struck>
  );
}

/**
 * The face, as a struck disc.
 *
 * A darker recessed field sits between the rim and the device, the way a
 * real coin's field is stamped lower than both — without it the device looks
 * pasted on rather than struck into the metal.
 */
function CoinFace({ tail }: { tail: boolean }) {
  return (
    <svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      <circle cx="50" cy="50" r="49" fill="var(--tu-copper)" />
      <circle cx="50" cy="50" r="43" fill="var(--tu-copper-deep)" opacity="0.35" />
      {tail ? <TailDevice /> : <HeadDevice />}
      {tail ? (
        // What a real two-up school chalks on its tails coin, so the ring can
        // read a throw from across the room — and what lets a player here
        // read the same throw at the top of the arc, not just once it lands.
        <path
          className="tu__chalk"
          d="M24,24 L76,76 M76,24 L24,76"
          stroke="var(--tu-chalk)"
          strokeWidth="4.5"
          strokeLinecap="round"
        />
      ) : null}
    </svg>
  );
}

/** The pair of faces, plus the rim standing between them. */
function CoinBody() {
  return (
    <div className="tu__coin-wobble">
      <div className="tu__coin-face tu__coin-face--heads">
        <CoinFace tail={false} />
      </div>
      <div className="tu__coin-face tu__coin-face--tails">
        <CoinFace tail />
      </div>
      {EDGES.map((n) => (
        // Twenty faces standing round the rim, at n's own angle apart — there
        // is no name for one of them beyond its position, so the position is
        // the key, the same way History.tsx's are. See biome.json's override
        // for this file.
        <div key={n} className="tu__coin-edge" style={{ "--edge-angle": `${n * EDGE_STEP}deg` } as CSSProperties} />
      ))}
    </div>
  );
}

/**
 * One coin.
 *
 * While it is flying the tumble itself is what keeps it unreadable — a coin
 * spinning at this rate shows edge more than either face, the way a real one
 * does. Under `prefers-reduced-motion` there is no tumble to hide behind, so
 * the stylesheet holds it edge-on and blank instead, and only opens the
 * correct face once `flying` goes false.
 */
export function Coin({
  face,
  flying,
  turns,
  delay,
  flightMs,
}: {
  face: Face | null;
  flying: boolean;
  turns: number;
  delay: number;
  flightMs: number;
}) {
  const style = {
    "--coin-to": coinTo(face, turns),
    "--coin-drift": `${driftOf(turns)}deg`,
    "--coin-delay": `${delay}ms`,
    "--flight-ms": `${flightMs}ms`,
    "--flight-ease": FLIGHT_EASE,
    "--tumble-ease": TUMBLE_EASE,
    "--wobble-ease": WOBBLE_EASE,
  } as CSSProperties;

  const label = flying
    ? "A coin in the air."
    : face === "tail"
      ? "Tails."
      : face === "head"
        ? "Heads."
        : // Landed with no face is not a state the felt should ever hand
          // this component, but staying silent about the outcome is the
          // one safe default if it somehow does.
          "A coin in the air.";

  return (
    <div className={`tu__coin${flying ? " tu__coin--flying" : ""}`} style={style} role="img" aria-label={label}>
      <div className="tu__coin-spin">
        <CoinBody />
      </div>
    </div>
  );
}

/**
 * How much earlier the first coin lands, as a share of the flight.
 *
 * Handed to `landings` (Task 10) rather than chosen as a millisecond figure,
 * because a share is what that function actually describes — a fixed offset
 * would drift out of proportion at a different `flightMs`.
 */
const SPREAD = 0.16;

/**
 * Two coins.
 *
 * Nothing at all before a throw exists — a coin only appears once one is in
 * progress, the same way the felt has nothing on it between rounds.
 *
 * Thrown from the same kip, they do not land together: `landings` gives each
 * its own share of the flight, so the first coin's own animation is the
 * shorter of the two rather than the pair sharing one duration and one
 * impact — a single impact reads as one heavy thing landing, not two coins.
 */
export function Coins({
  faces,
  flying,
  flightMs,
}: {
  faces: readonly [Face, Face] | null;
  flying: boolean;
  flightMs: number;
}) {
  if (faces === null) {
    return null;
  }
  const [first, second] = landings(SPREAD);
  return (
    <div className="tu__coins">
      <Coin face={faces[0]} flying={flying} turns={9} delay={0} flightMs={flightMs * first} />
      <Coin face={faces[1]} flying={flying} turns={11} delay={0} flightMs={flightMs * second} />
    </div>
  );
}
