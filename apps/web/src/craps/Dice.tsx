import { total, type Roll } from "@backroom/game-craps";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { FRAME_MS, path } from "./throw.js";

/**
 * Pip positions per face, as [row, column] on a 3x3 grid.
 *
 * The same idea as `game/Die.tsx`'s table, kept separate rather than shared:
 * that one carries $GREED's letters and gems, which mean nothing at a craps
 * table, and a plain white die with red pips is what these two are.
 */
const PIPS: Record<number, ReadonlyArray<readonly [number, number]>> = {
  1: [[2, 2]],
  2: [
    [1, 1],
    [3, 3],
  ],
  3: [
    [1, 1],
    [2, 2],
    [3, 3],
  ],
  4: [
    [1, 1],
    [1, 3],
    [3, 1],
    [3, 3],
  ],
  5: [
    [1, 1],
    [1, 3],
    [2, 2],
    [3, 1],
    [3, 3],
  ],
  6: [
    [1, 1],
    [1, 3],
    [2, 1],
    [2, 3],
    [3, 1],
    [3, 3],
  ],
};

/**
 * One die's face, still.
 *
 * Pulled out so the board beside the felt is drawn from the same pip table
 * the thrown dice are. A second table of dots would be a second thing to get
 * wrong, and a board whose five did not match the felt's five is a board
 * nobody would trust to say what the last twelve rolls were.
 *
 * `null` is the haze a die wears while no face is readable yet, which is a
 * state only a die in flight is ever in.
 */
export function DieFace({ face }: { face: number | null }) {
  if (face === null) {
    return <span className="cr-die__blank" />;
  }
  return (
    <>
      {PIPS[face]?.map(([row, column]) => (
        <span
          className="cr-die__pip"
          key={`${row}-${column}`}
          style={{ gridRow: row, gridColumn: column }}
        />
      ))}
    </>
  );
}

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/**
 * One die, driven by `path`.
 *
 * Walks the same samples `path` handed the test, one at a time, on the same
 * clock they were sampled at — never an interpolation this component invents
 * between them, so what is on screen is always a frame the pure function
 * actually produced. Reduced motion skips straight to the last one: the real
 * face, already at rest, because there is no tumble left to hide it behind.
 */
function Die({ dice, which, thrown, ms }: { dice: Roll; which: 0 | 1; thrown: boolean; ms: number }) {
  const frames = useMemo(() => path(dice, which, ms), [dice[0], dice[1], which, ms]);
  const [index, setIndex] = useState(() => (thrown && !prefersReducedMotion() ? 0 : frames.length - 1));
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (!thrown || prefersReducedMotion()) {
      setIndex(frames.length - 1);
      return;
    }
    setIndex(0);
    let step = 0;
    timer.current = window.setInterval(() => {
      step += 1;
      if (step >= frames.length) {
        if (timer.current !== null) {
          window.clearInterval(timer.current);
          timer.current = null;
        }
        setIndex(frames.length - 1);
        return;
      }
      setIndex(step);
    }, FRAME_MS);
    return () => {
      if (timer.current !== null) {
        window.clearInterval(timer.current);
        timer.current = null;
      }
    };
  }, [thrown, frames]);

  const frame = frames[Math.min(index, frames.length - 1)] as (typeof frames)[number];
  const style = {
    "--cr-die-x": frame.x,
    "--cr-die-y": frame.y,
    "--cr-die-turn": frame.turn,
  } as CSSProperties;

  return (
    <span className={`cr-die${thrown ? " cr-die--thrown" : ""}`} style={style}>
      <DieFace face={frame.face} />
    </span>
  );
}

/**
 * Both dice.
 *
 * Nothing before a roll exists — the same rule the felt's chips follow —
 * and the same two `<span>`s carry a throw all the way from the rail to the
 * felt: `thrown` toggling off never remounts them, because a set of dice
 * that vanished and a second set that appeared is exactly the bug this
 * component is written to avoid.
 */
export function Dice({ dice, thrown, ms }: { dice: Roll | null; thrown: boolean; ms: number }) {
  if (dice === null) {
    return null;
  }
  return (
    <div className="cr-dice">
      <Die dice={dice} which={0} thrown={thrown} ms={ms} />
      <Die dice={dice} which={1} thrown={thrown} ms={ms} />
      <span className="cr-dice__status" role="status">
        {thrown ? "Rolling…" : String(total(dice))}
      </span>
    </div>
  );
}
