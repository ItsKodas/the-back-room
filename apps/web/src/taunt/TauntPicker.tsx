import type { EmoteView, TauntStake } from "@backroom/shared";
import { useEffect, useRef, useState } from "react";
import { useEmotes } from "./useEmotes.js";

/**
 * Choosing something rude, and who to aim it at.
 *
 * Two steps rather than one, in that order: pick the picture, then pick the
 * face. It reads the way the thing itself does — you decide you want to mock
 * somebody before you decide who deserves it — and it keeps the second screen
 * showing what each throw will actually cost.
 *
 * Every rule shown here is also enforced by the server, and that is the point
 * of the arrangement rather than a duplication to be tidied away: hiding a
 * control is a courtesy, refusing the message is the rule.
 */

/** Somebody who can be taunted, as this picker needs to know them. */
export interface Target {
  id: string;
  name: string;
  isBot: boolean;
  signedIn: boolean;
}

export interface TauntPickerProps {
  seats: readonly Target[];
  /** This player's own seat, which is not a thing they may throw at. */
  seatId: string | null;
  /** Null for a guest, who has no account to spend from. */
  chips: number | null;
  stakes: readonly TauntStake[];
  /**
   * The whole emote rather than its id, so a caller can show the cost leaving
   * on the press without going back to the catalogue to find out what it was.
   */
  onThrow: (emote: EmoteView, seatId: string) => void;
  /** How the opening button is dressed, for a table built from the fittings. */
  openClassName?: string;
}

const fmt = (n: number) => n.toLocaleString("en-US");

export function TauntPicker({
  seats,
  seatId,
  chips,
  stakes,
  onThrow,
  openClassName = "btn btn--ghost",
}: TauntPickerProps) {
  const emotes = useEmotes();
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<EmoteView | null>(null);
  const panel = useRef<HTMLDivElement | null>(null);

  /*
   * Anyone but you, and only people the chips can actually reach. A bot is not
   * a real person and a guest has no account, so neither can be either end of
   * a stake — the same rule the server states, said again in what is offered.
   */
  const targets = seats.filter(
    (seat) => seat.id !== seatId && !seat.isBot && seat.signedIn,
  );

  // Closing on Escape, because a panel over the felt is in the way of a game.
  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        setChosen(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Nothing to throw, or nobody to throw it at, means no button at all rather
  // than a button that explains itself.
  if (emotes.length === 0 || seatId === null) {
    return null;
  }

  const staked = (id: string) => stakes.find((stake) => stake.seatId === id)?.chips ?? 0;
  const afford = (cost: number) => chips !== null && chips >= cost;

  return (
    <div className="taunt-picker">
      <button
        type="button"
        className={`${openClassName} taunt-picker__open`}
        aria-expanded={open}
        onClick={() => {
          setOpen((was) => !was);
          setChosen(null);
        }}
      >
        Taunt
      </button>

      {!open ? null : (
        <div className="taunt-picker__panel" ref={panel}>
          {chips === null ? (
            <p className="panel__note">Sign in to throw one of these.</p>
          ) : targets.length === 0 ? (
            <p className="panel__note">Nobody here to taunt yet.</p>
          ) : chosen === null ? (
            <>
              <p className="panel__label">What to throw</p>
              <ul className="taunt-picker__emotes">
                {emotes.map((emote) => (
                  <li key={emote.id}>
                    <button
                      type="button"
                      className="taunt-picker__emote"
                      disabled={!afford(emote.cost)}
                      onClick={() => setChosen(emote)}
                    >
                      <img
                        className="taunt-picker__art"
                        src={emote.image}
                        alt=""
                        loading="lazy"
                      />
                      <span className="taunt-picker__name">{emote.name}</span>
                      <span className="taunt-picker__cost">{fmt(emote.cost)}</span>
                    </button>
                  </li>
                ))}
              </ul>
              <p className="panel__note">
                It is staked on whoever you throw it at. If they win the hand they take the
                chips and it comes straight back at you.
              </p>
            </>
          ) : (
            <>
              <p className="panel__label">Aim {chosen.name} at</p>
              <ul className="taunt-picker__targets">
                {targets.map((seat) => (
                  <li key={seat.id}>
                    <button
                      type="button"
                      className="btn btn--wide taunt-picker__target"
                      onClick={() => {
                        onThrow(chosen, seat.id);
                        setOpen(false);
                        setChosen(null);
                      }}
                    >
                      <span>{seat.name}</span>
                      <span className="taunt-picker__riding">
                        {staked(seat.id) > 0 ? `${fmt(staked(seat.id))} riding` : ""}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                className="btn btn--ghost btn--small"
                onClick={() => setChosen(null)}
              >
                Back
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
