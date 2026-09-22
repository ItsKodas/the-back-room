import { POINTS, type Throw, type Win, total } from "@backroom/game-craps";
import type { CSSProperties } from "react";
import { DieFace } from "./Dice.js";

/**
 * The furniture round the felt: the puck, and the two boards.
 *
 * The boards answer different questions. One says what the dice have been
 * doing; the other says what that has been worth to the people standing at the
 * table, which is the half of the evening a strip of numbers cannot show.
 *
 * Stacked rather than side by side, the way roulette's are and for the reason
 * `.cr__boards` gives: two strips of small type abreast compete for the same
 * glance, and on a phone one of them would be four characters wide.
 */

const fmt = (n: number) => n.toLocaleString("en-US");

/** What a throw did to the hand, short enough to sit under a pair of dice. */
const SAID: Readonly<Record<"set" | "made" | "sevenOut", string>> = {
  set: "Set",
  made: "Made",
  sevenOut: "Out",
};

export function Rail({
  point,
  history,
  winners,
}: {
  point: number | null;
  history: readonly Throw[];
  winners: readonly Win[];
}) {
  return (
    <div className="cr__rail">
      <Puck point={point} />
      <div className="cr__boards">
        <Rolls history={history} />
        <Winners winners={winners} />
      </div>
    </div>
  );
}

/**
 * The puck: off, or on a number.
 *
 * It slides, and it slides only when the server says the point has moved.
 * That is the whole of it — a puck that travelled on the press, or on the
 * dice arriving, would be announcing a point before the table had one. The
 * numbers under it are the six a point can be, printed the way they are on the
 * rail, so the slide is visibly *to* somewhere rather than a disc drifting.
 */
function Puck({ point }: { point: number | null }) {
  const at = point === null ? 0 : POINTS.indexOf(point) + 1;
  return (
    <div className="cr__puck-rail">
      {/*
        Decorative: the same two facts are said in words on the standing line
        above the felt, and a screen reader spelling out "Off 4 5 6 8 9 10"
        before every hand would be reading the furniture out loud.
      */}
      <span className="cr__puck-slot cr__puck-slot--off" aria-hidden="true">
        Off
      </span>
      {POINTS.map((one) => (
        <span className="cr__puck-slot" key={one} aria-hidden="true">
          {one}
        </span>
      ))}
      <span
        className="cr__puck"
        data-on={point !== null || undefined}
        role="img"
        aria-label={point === null ? "The puck is off" : `The puck is on ${point}`}
        style={{ "--cr-puck-at": at } as CSSProperties}
      >
        {point === null ? "Off" : "On"}
      </span>
    </div>
  );
}

/**
 * The board of recent throws.
 *
 * Every craps table has one and players read it whether or not it means
 * anything; a table that hides its own results feels like one with something
 * to hide. Newest last, the same way the board beside it runs, because the two
 * are read together.
 *
 * Marked where the hand turned, because a strip of totals cannot say which
 * eight was the one that made the point.
 */
function Rolls({ history }: { history: readonly Throw[] }) {
  if (history.length === 0) {
    return null;
  }
  return (
    <ol className="cr__rolls" aria-label="Recent rolls, oldest first">
      {history.map((one, at) => (
        <li
          /*
           * The position is the identity: the same pair comes up again, and
           * what tells two sixes apart is which throw each was. Keying on the
           * distance from the end instead would give the newest entry a key
           * it keeps for ever, and the arrival below would then play once in
           * the life of the board rather than once per throw.
           */
          // biome-ignore lint/suspicious/noArrayIndexKey: a throw has nothing else to be told apart by
          key={`${at}:${one.dice[0]}-${one.dice[1]}`}
          className={`cr__roll${at === history.length - 1 ? " cr__roll--latest" : ""}`}
          data-what={one.what ?? undefined}
        >
          <span className="cr__roll-dice">
            <span className="cr__roll-die">
              <DieFace face={one.dice[0]} />
            </span>
            <span className="cr__roll-die">
              <DieFace face={one.dice[1]} />
            </span>
          </span>
          <span className="cr__roll-total">{total(one.dice)}</span>
          {one.what === null ? null : <span className="cr__roll-what">{SAID[one.what]}</span>}
        </li>
      ))}
    </ol>
  );
}

/**
 * The board of who has been paid.
 *
 * Winners only, and the profit rather than what came back: every bet that
 * comes in pays the stake with it, so "was handed chips" is true of half the
 * table most rolls. Finishing up is the thing somebody would mention.
 */
function Winners({ winners }: { winners: readonly Win[] }) {
  if (winners.length === 0) {
    return null;
  }
  return (
    <ol className="cr__winners" aria-label="Recent winners, oldest first">
      {winners.map((win, at) => (
        <li
          /*
           * The roll and the seat together, because neither is enough on its
           * own: one throw pays several people, and one person is paid by
           * several throws.
           */
          key={`${win.roll}:${win.seatId}`}
          className={`cr__won${at === winners.length - 1 ? " cr__won--latest" : ""}`}
        >
          <span className="cr__won-roll">{total(win.dice)}</span>
          <span className="cr__won-name">{win.name}</span>
          <span className="cr__won-up">+{fmt(win.up)}</span>
        </li>
      ))}
    </ol>
  );
}
