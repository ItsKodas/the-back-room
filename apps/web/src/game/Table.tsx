import type { Combo } from "@backroom/rules";
import { bustProbability, scoreSelection } from "@backroom/rules";
import type { RoomView } from "@backroom/shared";
import type { CSSProperties, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { play } from "./audio.js";
import { Die, LETTERS } from "./Die.js";
import { Lanes } from "./Lanes.js";
import { ScoreCard } from "./ScoreCard.js";
import { useCountdown } from "./useCountdown.js";
import type { PendingRoll } from "./useRollAnimation.js";
import { ROLL_SETTLE_MS, useRollAnimation } from "./useRollAnimation.js";
import type { RoomActions } from "./useRoom.js";
import { isScoringStraight } from "./useSound.js";
import "./greed.css";

const fmt = (n: number) => n.toLocaleString("en-US");

/** A turn clock, the way a table reads one out. */
const clockText = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

function greedLine(skin: string): string {
  return skin === "letters" ? "$GREED — one of every face." : "A straight — one of every face.";
}

/** One scoring combination, named the way its tag on the felt names it. */
function comboName(combo: Combo, letters: boolean): string {
  switch (combo.kind) {
    case "straight":
      return letters ? "$GREED" : "Straight";
    case "three-pairs":
      return "Three pairs";
    case "two-triplets":
      return "Two triplets";
    case "four-plus-pair":
      return "Four and a pair";
    default:
      return `${combo.size}×${combo.face === null ? "" : letters ? LETTERS[combo.face] : combo.face}`;
  }
}

interface TableProps {
  room: RoomView;
  seatId: string;
  actions: RoomActions;
  /** This player's picks, while they are ahead of the server. */
  heldLocally: boolean[] | null;
  /** A throw asked for whose dice have not come back yet. */
  pendingRoll: PendingRoll | null;
  /** The taunt key, offered while somebody else has the dice. */
  taunt?: ReactNode;
  /** Table talk's sheet, laid over the table when it is open. */
  talk?: ReactNode;
  /** What the table has said happened, shown under the card at a desk. */
  activity?: ReactNode;
  /** The key that opens talk, pinned to the felt's corner opposite the score card's. */
  talkKey?: ReactNode;
}

export function Table({
  room,
  seatId,
  actions,
  heldLocally,
  pendingRoll,
  taunt,
  talk,
  activity,
  talkKey,
}: TableProps) {
  const turn = room.turn;
  const over = room.status === "over";
  const yours = turn !== null && turn.seatId === seatId && !over;
  const active = room.seats.find((seat) => seat.id === turn?.seatId);
  const letters = room.ruleset.skin === "letters";
  const [cardOpen, setCardOpen] = useState(false);

  /*
   * Which dice are picked up, and what that is worth.
   *
   * Both are the server's to decide, and both are shown from this player's own
   * clicks until the server's answer arrives — a round trip later. The score is
   * worked out here with the very same function the server runs, from the same
   * rules the room was dealt with, so what is shown early is not a guess and
   * cannot disagree with what follows.
   */
  const held = heldLocally ?? turn?.held ?? [];
  const ahead = heldLocally !== null && turn !== null;
  const picked = turn === null ? [] : turn.dice.filter((_, index) => held[index] === true);
  const localScore = ahead ? scoreSelection(picked, room.ruleset) : null;
  const selection = localScore?.points ?? turn?.selection ?? 0;
  const selectionValid = localScore?.valid ?? turn?.selectionValid ?? false;
  /*
   * What the pick is made of. The server sends the points and not the
   * combinations, so this is worked out here even when its figure is the one
   * shown — by the same function, from the same rules, so the tags and the lit
   * card cannot disagree with the number beside them.
   */
  const breakdown: readonly Combo[] = selectionValid
    ? (localScore ?? scoreSelection(picked, room.ruleset)).breakdown
    : [];
  const keptCount = held.filter(Boolean).length;
  const nextRollCount = ahead
    ? // Clearing the table earns all six back; that is the hot-dice rule and it
      // is worth showing without waiting to be told.
      turn.dice.length - keptCount === 0
      ? 6
      : turn.dice.length - keptCount
    : (turn?.nextRollCount ?? 0);

  // Cached behind a table keyed on the ruleset, so this costs nothing after
  // the first call and can follow the local count rather than lag behind it.
  const bustChance =
    ahead && nextRollCount >= 1 && nextRollCount <= 6
      ? bustProbability(nextRollCount, room.ruleset)
      : (turn?.bustChance ?? 0);

  const canAct = yours && turn.phase === "selecting" && selectionValid;
  const canRollFresh = yours && turn.phase === "awaiting_roll";
  const total = turn === null ? 0 : turn.kept + selection;
  const left = useCountdown(over ? null : (turn?.endsAt ?? null));
  // One tumble, from the press until the dice land. It owns both halves — the
  // wait for the reply and the throw itself — because handing over between two
  // animations is what made the dice stutter and change count mid-air.
  const { rolling, faces } = useRollAnimation(turn?.dice ?? [], turn?.rollSeq ?? 0, pendingRoll);
  const shown = rolling ? faces : (turn?.dice ?? []);
  const busted = !rolling && turn?.phase === "farkled";
  // Held down from the press until the dice land, so a slow reply reads as the
  // table working rather than as a button that did nothing.
  const busy = rolling || pendingRoll !== null;

  const canRoll = !busy && (canRollFresh || canAct);
  const rollNow = () => {
    play("shake");
    actions.roll(nextRollCount);
  };

  /*
   * Space rolls and B banks, whenever Roll or Bank itself could be pressed.
   * Read through refs so the listeners are bound once rather than on every pick.
   *
   * Left alone: a key pressed in a field and anything inside a sheet, so a b
   * typed into talk is a letter rather than a bank. Space also leaves a focused
   * key that is not a die to its own activation. A die somebody clicked is the
   * exception on purpose: pick a die, press space, is the whole rhythm of a
   * turn, and toggling that die back is never what was meant. A die reached by
   * keyboard keeps its own space, since pressing it is how a keyboard picks
   * dice at all. B has no meaning on a button, so it banks wherever focus is.
   */
  const keyRoll = useRef<(() => void) | null>(null);
  keyRoll.current = canRoll ? rollNow : null;
  const keyBank = useRef<(() => void) | null>(null);
  keyBank.current = canAct && !busy ? actions.bank : null;
  useEffect(() => {
    const typing = (target: EventTarget | null) =>
      target instanceof Element &&
      target.closest("input, textarea, select, [contenteditable], [role='dialog']") !== null;
    /*
     * The die a pointer last went down on. Remembered here rather than asked of
     * the browser: Chrome reports a clicked button as :focus-visible the moment
     * any key goes down on it, which is exactly when this needs to know. Focus
     * arriving anywhere else, a Tab included, forgets it.
     */
    let clicked: Element | null = null;

    const onDown = (event: KeyboardEvent) => {
      // A modifier makes it somebody else's shortcut; a held key is one press.
      if (event.repeat || event.altKey || event.ctrlKey || event.metaKey) {
        return;
      }
      const target = event.target;
      if (typing(target)) {
        return;
      }
      if (event.key === "b" || event.key === "B") {
        keyBank.current?.();
        return;
      }
      if (event.key !== " " || event.shiftKey) {
        return;
      }
      if (
        target instanceof Element &&
        (target.closest("a, button:not(.die)") !== null || (target.matches(".die") && target !== clicked))
      ) {
        return;
      }
      const roll = keyRoll.current;
      if (roll === null) {
        return;
      }
      // Not the page scrolling, and not the focused die toggling on key-up.
      event.preventDefault();
      roll();
    };
    const onPointer = (event: PointerEvent) => {
      clicked = event.target instanceof Element ? event.target.closest(".die") : null;
    };
    const onFocus = (event: FocusEvent) => {
      if (event.target !== clicked) {
        clicked = null;
      }
    };

    window.addEventListener("keydown", onDown);
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("focusin", onFocus);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("focusin", onFocus);
    };
  }, []);

  // The rarest thing in the game — 720 of the 46,656 six-dice rolls — so it
  // gets a moment of its own once the dice have settled.
  const [celebrating, setCelebrating] = useState(false);
  const greeded = turn !== null && isScoringStraight(turn.dice, room);
  const seq = turn?.rollSeq ?? 0;
  // The celebration belongs to one roll, so it keys on the roll counter
  // rather than on the room.
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the roll counter by design
  useEffect(() => {
    if (!greeded) {
      setCelebrating(false);
      return;
    }
    const begin = window.setTimeout(() => setCelebrating(true), ROLL_SETTLE_MS);
    const end = window.setTimeout(() => setCelebrating(false), ROLL_SETTLE_MS + 1800);
    return () => {
      window.clearTimeout(begin);
      window.clearTimeout(end);
    };
  }, [seq, greeded]);

  /*
   * Where banking now would put the player rolling, for their lane. Only once
   * a bank would count: an invalid pick banks nothing, and a first bank under
   * the entry threshold does not get anybody on the board.
   */
  const projected =
    active !== undefined &&
    !over &&
    turn?.phase === "selecting" &&
    selectionValid &&
    (active.onBoard || total >= room.ruleset.entryThreshold)
      ? active.score + total
      : null;

  const limit = room.ruleset.turnTimerSeconds;
  const clock = left !== null && limit !== null && limit > 0 ? Math.min(100, (left / limit) * 100) : null;
  const low = left !== null && left <= 15;
  const winners = room.seats
    .filter((seat) => room.winnerIds.includes(seat.id))
    .map((seat) => seat.name)
    .join(" and ");

  const say = rolling
    ? "Rolling…"
    : celebrating
      ? greedLine(room.ruleset.skin)
      : busted
        ? "Farkle — nothing scores. The turn is lost."
        : over
          ? "Game over."
          : yours && turn?.phase === "selecting"
            ? selectionValid
              ? `Worth ${fmt(selection)}. Roll ${nextRollCount} more, or bank ${fmt(total)}.`
              : held.some(Boolean)
                ? "One of those dice scores nothing."
                : "Tap the dice you want to keep."
            : yours
              ? "Your turn — roll to begin."
              : active !== undefined
                ? turn?.phase === "selecting"
                  ? `${active.name} is picking dice.`
                  : `Waiting on ${active.name}.`
                : "";

  return (
    <section className="gt" aria-label="The table">
      <div className="gt__in">
        <Lanes room={room} seatId={seatId} projected={projected} />

        <div
          className={`gt__felt${celebrating ? " gt__felt--greed" : ""}${busted ? " gt__felt--bust" : ""}`}
        >
          <div className="gt__cloth">
            {shown.length > 0 ? (
              <div className={`gt__dice${rolling ? " gt__dice--rolling" : ""}`}>
                {/*
                  * What is on the table: the dice in the air while they are in
                  * the air, and the dice that landed once they have. The first
                  * throw of a turn has no dice to show yet, so following the
                  * turn here would leave the felt empty for the whole throw.
                  */}
                {shown.map((face, index) => (
                  <Die
                    // A die is its slot. Position is its whole identity — it is what the
                    // server toggles, and dice never reorder except on a fresh roll, where
                    // being treated as the same slots is exactly what the animation needs.
                    // noArrayIndexKey is switched off for this file in biome.json.
                    key={`slot-${index}`}
                    face={face}
                    skin={room.ruleset.skin}
                    held={!rolling && held[index] === true}
                    dead={!rolling && turn?.dead[index] === true}
                    rolling={rolling}
                    index={index}
                    celebrating={celebrating}
                    interactive={!rolling && yours && turn.phase === "selecting"}
                    onClick={() => {
                      // Sounded here rather than off the state that comes back,
                      // so a die answers the finger that moved it. useSound
                      // leaves our own seat's picks alone for this reason.
                      play(held[index] === true ? "drop" : "pick");
                      actions.toggle(index);
                    }}
                  />
                ))}
              </div>
            ) : null}
            <p className="gt__say" aria-live="polite">
              {say}
            </p>
            <div className="gt__combo">
              {breakdown.map((combo, at) => (
                <span className="tag" key={`${combo.kind}-${combo.face}-${combo.size}-${at}`}>
                  {comboName(combo, letters)} {fmt(combo.points)}
                </span>
              ))}
            </div>
          </div>

          {celebrating ? (
            <p className="gt__banner" aria-hidden="true">
              {letters ? "$GREED" : "Straight"}
            </p>
          ) : null}
          {busted ? (
            <p className="gt__stamp" aria-hidden="true">
              Farkle
            </p>
          ) : null}

          {talkKey !== undefined ? <div className="table-talk-corner">{talkKey}</div> : null}
          <button
            type="button"
            className="key key--icon gt__help"
            aria-label="What scores"
            aria-expanded={cardOpen}
            onClick={() => setCardOpen((was) => !was)}
          >
            ?
          </button>
          {cardOpen ? (
            <div className="gt__sheet" role="dialog" aria-label="What scores">
              <div className="gt__sheet-head">
                <h2 className="gt__sheet-title">What scores</h2>
                <button
                  type="button"
                  className="key key--icon"
                  aria-label="Close what scores"
                  onClick={() => setCardOpen(false)}
                >
                  ×
                </button>
              </div>
              <ScoreCard rules={room.ruleset} lit={breakdown} />
            </div>
          ) : null}
        </div>

        <div className="gt__read readout">
          {clock !== null ? (
            <span
              className={`gt__clock${low ? " gt__clock--low" : ""}`}
              style={{ "--t": `${clock}%` } as CSSProperties}
            />
          ) : null}
          <div className="gt__big">
            <span className="gt__label">
              {over ? "Game over" : yours || active === undefined ? "If you bank" : `${active.name} would bank`}
            </span>
            {over ? (
              <span className="gt__winner">{winners.length > 0 ? `${winners} won` : "Nobody won"}</span>
            ) : busted ? (
              <span className="gt__figure gt__figure--bust">
                0{total > 0 ? <s>{fmt(total)}</s> : null}
              </span>
            ) : (
              <span className={`gt__figure${total > 0 ? " gt__figure--good" : ""}`}>{fmt(total)}</span>
            )}
          </div>
          <dl className="gt__stats">
            <div>
              <dt>Set aside</dt>
              <dd>{fmt(turn?.kept ?? 0)}</dd>
            </div>
            <div>
              <dt>Selected</dt>
              <dd>{fmt(selection)}</dd>
            </div>
            {left !== null ? (
              <div>
                <dt>{yours ? "You have" : "They have"}</dt>
                <dd className={low ? "gt__low" : undefined}>{clockText(left)}</dd>
              </div>
            ) : (
              <div>
                <dt>Target</dt>
                <dd>{fmt(room.ruleset.targetScore)}</dd>
              </div>
            )}
          </dl>
        </div>

        <aside className="gt__card" aria-label="What scores">
          <h2 className="gt__sheet-title">What scores</h2>
          <ScoreCard rules={room.ruleset} lit={breakdown} />
        </aside>

        {activity !== undefined ? (
          <aside className="gt__activity" aria-label="Activity">
            <h2 className="gt__sheet-title">Activity</h2>
            {activity}
          </aside>
        ) : null}

        <div className={`gt__controls${yours || over ? "" : " gt__controls--wait"}`}>
          {seatId === "" ? (
            // No seat, so no controls — offering buttons that cannot do anything
            // is worse than saying plainly what you are.
            <p className="gt__watching">
              You are watching this table. Leave and take a seat to play the next game.
            </p>
          ) : over ? (
            <>
              <button type="button" className="key" onClick={actions.leave}>
                Leave the table
              </button>
              <button type="button" className="slab" onClick={actions.playAgain}>
                Play again
              </button>
            </>
          ) : yours ? (
            <>
              <button
                type="button"
                className="key"
                disabled={!canAct}
                aria-keyshortcuts="B"
                onClick={actions.bank}
              >
                <small>Bank</small>
                <b>{fmt(total)}</b>
              </button>
              <button
                type="button"
                className={`slab${busy ? " is-busy" : ""}`}
                disabled={!canRoll}
                aria-keyshortcuts="Space"
                onClick={rollNow}
              >
                {/* The count worked out here, not the one last heard from the
                    server — otherwise the button offers six and throws five. */}
                {canRollFresh ? "Roll 6" : `Roll ${nextRollCount}`}
                <small>{Math.round(bustChance * 100)}% bust</small>
              </button>
            </>
          ) : (
            <>
              <button type="button" className="slab" disabled>
                {active !== undefined ? `${active.name}'s turn` : "Waiting"}
                {left !== null ? <small>{clockText(left)}</small> : null}
              </button>
              {taunt}
            </>
          )}
        </div>
      </div>
      {talk}
    </section>
  );
}
