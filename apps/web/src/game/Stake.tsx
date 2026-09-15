import type { RoomView } from "@backroom/shared";
import type { CSSProperties } from "react";
import { useEffect, useId, useRef, useState } from "react";
import { ChipMark } from "../chips/Chip.js";

const fmt = (n: number) => n.toLocaleString("en-US");

/** The most a table can stake, as the server's schema has it. */
export const STAKE_CEILING = 1_000_000;

/** How long a slider rests before its figure goes to the table. */
export const STAKE_SETTLE_MS = 300;

/**
 * The stake: for fun, or any number of chips up to what the host holds.
 *
 * The figure is the host's own choice, so it moves the instant they move it —
 * on the slider or in the box — and goes to the table once it stops moving,
 * rather than as a message for every pixel of a drag. The cap at the host's
 * balance is a courtesy: whether everyone can actually cover it is the
 * server's to decide when the game starts.
 *
 * Only offered when everyone at the table is signed in and there are no bots —
 * a bot has no balance to lose and no account to pay, so letting one into a pot
 * would mint or destroy chips.
 */
export function Stake({
  room,
  editable,
  signedIn,
  chips,
  onSet,
}: {
  room: RoomView;
  editable: boolean;
  signedIn: boolean;
  chips: number;
  onSet: (amount: number) => void;
}) {
  const bots = room.seats.some((seat) => seat.isBot);
  const guests = room.seats.some((seat) => !seat.signedIn);
  const blocked = bots || guests || !signedIn;
  const max = Math.max(0, Math.min(chips, STAKE_CEILING));
  const figureId = useId();

  const [draft, setDraft] = useState(room.buyIn);
  // What is in the box while somebody is typing in it; null otherwise.
  const [typed, setTyped] = useState<string | null>(null);
  const pending = useRef<number | null>(null);
  const sent = useRef(0);

  /*
   * The table's word replaces ours once it speaks. A broadcast arriving straight
   * after our own change can predate it, so a different figure is only taken
   * once the answer has had a moment — and that is also how a refused stake is
   * given up on rather than left showing.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: every broadcast is a new room, which is the trigger
  useEffect(() => {
    if (pending.current !== null) {
      return;
    }
    if (room.buyIn !== draft && Date.now() - sent.current < 1500) {
      return;
    }
    setDraft(room.buyIn);
  }, [room]);

  useEffect(
    () => () => {
      if (pending.current !== null) {
        window.clearTimeout(pending.current);
      }
    },
    [],
  );

  const send = (amount: number, wait: number) => {
    setDraft(amount);
    if (pending.current !== null) {
      window.clearTimeout(pending.current);
    }
    pending.current = window.setTimeout(() => {
      pending.current = null;
      sent.current = Date.now();
      onSet(amount);
    }, wait);
  };

  const clamp = (amount: number) => Math.min(max, Math.max(1, Math.round(amount)));

  const commitTyped = () => {
    if (typed === null) {
      return;
    }
    const digits = typed.replace(/\D/g, "");
    setTyped(null);
    // Nothing typed keeps what was there, rather than guessing at a figure.
    if (digits.length > 0) {
      send(clamp(Number(digits)), 0);
    }
  };

  const onSlider = Math.max(1, Math.min(draft, Math.max(1, max)));
  const along = max > 1 ? ((onSlider - 1) / (max - 1)) * 100 : 0;
  const locked = !editable || max < 1;

  return (
    <section className="housing" aria-labelledby="stake-title">
      <div className="housing__head">
        <h2 className="label" id="stake-title">
          Stake
        </h2>
      </div>
      <div className="housing__body">
        {blocked ? (
          <p className="hint rules__chips">
            {bots
              ? "Bots play for free. Remove them to play for chips."
              : "Everyone has to be signed in to play for chips."}
          </p>
        ) : (
          <div className="stake">
            <div className="stake__top">
              <button
                type="button"
                className="lamp stake__fun"
                aria-pressed={draft === 0}
                disabled={!editable}
                onClick={() => {
                  setTyped(null);
                  send(0, 0);
                }}
              >
                For fun
              </button>
              <label className="stake__figure" htmlFor={figureId}>
                <ChipMark size={16} />
                <input
                  id={figureId}
                  className="input stake__input"
                  inputMode="numeric"
                  autoComplete="off"
                  aria-label="Stake in chips"
                  placeholder={max < 1 ? "No chips" : "Chips"}
                  disabled={locked}
                  value={typed ?? (draft > 0 ? fmt(draft) : "")}
                  onFocus={() => setTyped(draft > 0 ? String(draft) : "")}
                  onChange={(event) => setTyped(event.target.value)}
                  onBlur={commitTyped}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      // Blurring commits, so Enter and clicking away are one path.
                      event.currentTarget.blur();
                    } else if (event.key === "Escape") {
                      setTyped(null);
                      event.currentTarget.blur();
                    }
                  }}
                />
              </label>
            </div>
            <input
              type="range"
              className="stake__range"
              aria-label="Stake"
              aria-valuetext={draft > 0 ? `${fmt(draft)} chips` : "For fun"}
              min={1}
              max={Math.max(1, max)}
              step={1}
              value={onSlider}
              disabled={locked}
              style={{ "--at": `${along}%` } as CSSProperties}
              onChange={(event) => {
                setTyped(null);
                send(Number(event.target.value), STAKE_SETTLE_MS);
              }}
            />
            <p className="stake__scale" aria-hidden="true">
              <span>1</span>
              <span>{fmt(Math.max(1, max))}</span>
            </p>
          </div>
        )}
        {blocked ? null : draft > 0 ? (
          <p className="hint rules__chips">
            Pot of {fmt(draft * room.seats.length)} — winner takes it. Everyone puts in {fmt(draft)} when the game
            starts.
          </p>
        ) : (
          <p className="hint">{max < 1 ? "You have no chips to stake." : "Nobody's chips are at stake."}</p>
        )}
      </div>
    </section>
  );
}
