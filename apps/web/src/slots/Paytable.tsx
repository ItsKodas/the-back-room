import type { PayingFace } from "@backroom/game-slots";
import {
  BONUS_AWARDS,
  JACKPOT_SHARE,
  MIN_SCATTER,
  PAYING_FACES,
  PAYLINES,
  PAYS,
} from "@backroom/game-slots";
import { useEffect, useRef } from "react";
import { play } from "../game/audio.js";
import { exact } from "../game/money.js";
import { FACE_SIZE, ReelFace } from "./Symbols.js";

/**
 * What the machine pays, as the card on the side of a real cabinet.
 *
 * Every figure is read off the tables the server pays from rather than typed
 * in. The return is tuned by moving those numbers, and a chart that had to be
 * remembered afterwards is a chart that would one day be quietly wrong about
 * the one thing it is for.
 *
 * Drawn with the faces off the reels, because the question somebody opens
 * this with is "what is that one worth?" while looking at it on the glass.
 */

/** Best first: anybody reading this is looking up from a run and wants to know how high it sits. */
const BEST_FIRST: readonly PayingFace[] = [...PAYING_FACES].sort(
  (a, b) => (PAYS[b][3] ?? 0) - (PAYS[a][3] ?? 0),
);

const RUNS = [3, 4, 5] as const;

export function Paytable({
  open,
  onClose,
  stake,
  lineCount,
  jackpot,
}: {
  open: boolean;
  onClose: () => void;
  /** The bet on each line, so a multiplier can be said in chips as well. */
  stake: number;
  /** How many lines are bought, counted from the top of the list. */
  lineCount: number;
  /** What five sevens would pay out of the bank right now. */
  jackpot: number;
}) {
  const box = useRef<HTMLDialogElement | null>(null);

  // The same door as poker's chart: a real modal, opened and shut from state.
  useEffect(() => {
    const dialog = box.current;
    if (dialog === null) {
      return;
    }
    // Sounded here rather than on the buttons: every way in and out ends as
    // this effect, so there is one place for it and no way to miss one.
    if (open && !dialog.open) {
      dialog.showModal();
      play("open");
    } else if (!open && dialog.open) {
      dialog.close();
      play("close");
    }
  }, [open]);

  return (
    <dialog
      className="pt"
      ref={box}
      aria-label="Paytable"
      onClose={onClose}
      /* Escape is handled by hand for the reason Rankings.tsx gives: left to
         the element, it does not reliably close. */
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onClose();
        }
      }}
      onClick={(event) => {
        if (event.target === box.current) {
          onClose();
        }
      }}
    >
      <div className="pt__inner">
        <div className="pt__head">
          <h2 className="pt__title">Paytable</h2>
          <button type="button" className="pt__shut" data-quiet onClick={onClose}>
            Close
          </button>
        </div>

        <p className="pt__rule">
          A line pays for the same face landing left to right, starting on the first reel. A run
          that starts anywhere else does not count, and only lines you have bought pay.
          {stake > 0 ? ` Chips are at your bet of ${exact(stake)} a line.` : null}
        </p>

        {/* A table because it is one: faces down the side, runs across the top.
            Wrapped so a narrow screen scrolls it rather than the page. */}
        <div className="pt__scroll">
          <table className="pt__table">
            <thead>
              <tr>
                <th scope="col">
                  <span className="pt__sr">Face</span>
                </th>
                {RUNS.map((length) => (
                  <th scope="col" key={length}>
                    {length} in a row
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {BEST_FIRST.map((face) => (
                <tr key={face} data-face-row={face}>
                  <th scope="row">
                    <FaceIcon face={face} />
                  </th>
                  {RUNS.map((length) => {
                    const multiplier = PAYS[face][length];
                    return (
                      <td key={length} data-run={length}>
                        {multiplier === null ? (
                          /* Five sevens has no multiplier: it is a share of the bank. */
                          <span className="pt__pay pt__pay--jackpot">
                            <span className="pt__mult">Jackpot</span>
                            <span className="pt__chips">{exact(jackpot)}</span>
                          </span>
                        ) : (
                          <span className="pt__pay">
                            <span className="pt__mult">×{exact(multiplier)}</span>
                            {stake > 0 ? (
                              <span className="pt__chips" data-chips>
                                {exact(multiplier * stake)}
                              </span>
                            ) : null}
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="pt__note">
          Multipliers are of the bet on one line. The jackpot is {Math.round(JACKPOT_SHARE * 100)}%
          of the bank, so it grows as the machine is played.
        </p>

        <h3 className="pt__sub">Bonus</h3>
        <div className="pt__bonus">
          <FaceIcon face="bonus" />
          <ul className="pt__scatters">
            {Object.entries(BONUS_AWARDS).map(([count, spins]) => (
              <li key={count} data-scatter={count}>
                <b>{count}</b> anywhere — {spins} free spins
              </li>
            ))}
          </ul>
        </div>
        <p className="pt__note">
          The one face that ignores lines: {MIN_SCATTER} or more on different reels, in any row.
          Free spins replay the bet that won them, and free spins cannot win more free spins.
        </p>

        <h3 className="pt__sub">Lines</h3>
        <ol className="pt__lines">
          {PAYLINES.map((rows, at) => (
            <li
              // Nine fixed shapes in a fixed order; the index is the identity.
              key={rows.join("")}
              className="pt__line"
              data-payline={at + 1}
              data-bought={at < lineCount ? "true" : "false"}
            >
              <LineShape rows={rows} />
              <span className="pt__line-no">{at + 1}</span>
            </li>
          ))}
        </ol>
      </div>
    </dialog>
  );
}

function FaceIcon({ face }: { face: PayingFace | "bonus" }) {
  return (
    <svg
      className="pt__face"
      viewBox={`0 0 ${FACE_SIZE} ${FACE_SIZE}`}
      role="img"
      aria-label={face}
    >
      <ReelFace face={face} />
    </svg>
  );
}

/** One payline over a five-by-three grid, the way the glass draws it. */
function LineShape({ rows }: { rows: readonly number[] }) {
  return (
    <svg className="pt__shape" viewBox="0 0 50 30" aria-hidden="true" focusable="false">
      {rows.map((_, reel) =>
        [0, 1, 2].map((row) => (
          <rect
            // biome-ignore lint/suspicious/noArrayIndexKey: a fixed grid of cells
            key={`${reel}-${row}`}
            className={rows[reel] === row ? "pt__cell pt__cell--on" : "pt__cell"}
            x={reel * 10 + 1}
            y={row * 10 + 1}
            width={8}
            height={8}
            rx={1.5}
          />
        )),
      )}
      <polyline
        className="pt__path"
        points={rows.map((row, reel) => `${reel * 10 + 5},${row * 10 + 5}`).join(" ")}
      />
    </svg>
  );
}
