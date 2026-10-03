import type { Card, Color, Input, SeatView, TableView } from "@backroom/game-uno";
import { COLOR_NAMES, COLORS, isWild } from "@backroom/game-uno";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { Avatar } from "../game/Avatar.js";
import { useCountdown } from "../game/useCountdown.js";
import { CardBack, UnoCard } from "./Card.js";
import type { Intent } from "./useIntent.js";

const fmt = (n: number) => n.toLocaleString("en-US");

/** A seat's name, or "you" when it is yours. */
export const who = (state: TableView, seatId: string | null, of: string | null): string =>
  of !== null && of === seatId ? "you" : (state.seats.find((seat) => seat.id === of)?.name ?? "Somebody");

/** The one line under the felt: what the table is waiting on, in words. */
export function line(state: TableView, seatId: string | null): string {
  if (state.phase === "waiting") {
    if (state.waitingFor === "players") {
      return state.forFun ? "Waiting for somebody to sit down, or deal in a bot." : "Waiting for a second player.";
    }
    const total = state.seats.filter((seat) => seat.connected).length;
    return `${state.readyCount} of ${total} are in.`;
  }
  if (state.phase === "between") {
    return `${who(state, seatId, state.lastRound?.winner ?? null)} won round ${state.round}. Next deal coming.`;
  }
  if (state.phase === "over") {
    const champ = state.winnerIds[0] ?? null;
    return champ === seatId ? "You win the game!" : `${who(state, seatId, champ)} wins the game.`;
  }
  const mine = state.toAct === seatId;
  const name = who(state, seatId, state.toAct);
  switch (state.step) {
    case "chooseColor":
      return mine ? "The first card is a Wild. Pick the colour." : `${name} is picking the colour.`;
    case "challenge":
      return mine
        ? `${who(state, seatId, state.challenger)} played a Wild Draw Four. Challenge it, or take +${state.pending}?`
        : `${name} is deciding whether to challenge.`;
    case "postDraw":
      return mine ? "Play the card you drew, or keep it." : `${name} drew a card.`;
    default:
      if (mine) {
        return state.pending > 0 ? `Answer the +${state.pending}, or take it.` : "Your turn.";
      }
      return `${name}'s turn.`;
  }
}

/* ---------------------------------------------------------------- seats */

function SeatPlate({ seat, state, seatId }: { seat: SeatView; state: TableView; seatId: string | null }) {
  const classes = ["uno__seat"];
  if (state.toAct === seat.id) classes.push("is-turn");
  if (seat.id === seatId) classes.push("is-you");
  if (seat.isBot) classes.push("is-bot");
  let word: string | null = null;
  if (!seat.connected) {
    classes.push("is-gone");
    word = "Gone";
  } else if (seat.waiting) {
    classes.push("is-waiting");
    word = "Next game";
  } else if (seat.short) {
    classes.push("is-short");
    word = "Short";
  } else if (state.phase === "waiting" && seat.ready) {
    classes.push("is-ready");
    word = "Ready";
  }
  const count = seat.cards;
  const fan = count === null ? 3 : Math.min(count, 7);
  return (
    <li className={classes.join(" ")}>
      <Avatar name={seat.name} avatar={seat.avatar} accentColor={seat.accentColor} className="uno__face" />
      <span className="uno__seat-name">{seat.name}</span>
      {seat.inGame ? (
        <span className="uno__seat-hand">
          <span className="uno__fan" aria-hidden="true">
            {Array.from({ length: fan }, (_, at) => (
              // Card backs have no identity beyond their place in the fan.
              // biome-ignore lint/suspicious/noArrayIndexKey: position is the identity
              <CardBack key={at} className="uno-card--mini" />
            ))}
          </span>
          <span className="uno__seat-count">{count === null ? "? cards" : `${count} card${count === 1 ? "" : "s"}`}</span>
        </span>
      ) : null}
      {seat.inGame && state.rules.gameMode === "points" ? (
        <span className="uno__seat-score">{seat.score} pts</span>
      ) : null}
      {seat.uno ? <span className="tag uno__uno-tag">UNO!</span> : null}
      {word === null ? null : <span className="tag uno__seat-state">{word}</span>}
    </li>
  );
}

export function Seats({ state, seatId }: { state: TableView; seatId: string | null }) {
  return (
    <ol className="uno__rail" aria-label="The table">
      {state.seats.map((seat) => (
        <SeatPlate key={seat.id} seat={seat} state={state} seatId={seatId} />
      ))}
    </ol>
  );
}

/* --------------------------------------------------------------- centre */

function Clock({ state }: { state: TableView }) {
  const left = useCountdown(state.turnEndsAt);
  if (state.turnEndsAt === null || left === null) {
    return null;
  }
  const remaining = Math.max(0, state.turnEndsAt - Date.now());
  return (
    <div className="uno__clock" role="timer" aria-label={`${left} seconds left`}>
      {/* Keyed on the deadline so a new turn restarts the drain from where the
          table says it is, not from wherever the last one had got to. */}
      <span
        key={state.turnEndsAt}
        className="uno__clock-bar"
        style={{
          animationDuration: `${remaining}ms`,
          ["--uno-from" as string]: String(Math.min(1, remaining / Math.max(1, state.turnMs))),
        }}
      />
      <span className="uno__clock-text">{left}s</span>
    </div>
  );
}

export function Centre({
  state,
  seatId,
  intent,
  onDraw,
}: {
  state: TableView;
  seatId: string | null;
  intent: Intent;
  onDraw: () => void;
}) {
  const shownTop = intent.played?.card ?? state.top;
  const colour = intent.played === null ? state.color : (intent.played.color ?? state.color);
  const mine = intent.played !== null || state.effects.at(-1)?.seat === seatId;
  const canDraw = state.hand?.canDraw === true && !intent.busy;
  return (
    <div className="uno__centre">
      <div className={`uno__direction${state.direction === -1 ? " is-back" : ""}`} role="img" aria-label={state.direction === 1 ? "Play goes clockwise" : "Play goes anticlockwise"}>
        <svg viewBox="0 0 100 100" aria-hidden="true">
          <circle cx="50" cy="50" r="45" fill="none" stroke="currentColor" strokeWidth="1.4" strokeDasharray="22 8" />
          {[0, 120, 240].map((angle) => (
            <path key={angle} transform={`rotate(${angle} 50 50)`} d="M57 5 L51 1.5 L51 8.5 Z" fill="currentColor" />
          ))}
        </svg>
      </div>
      <div className="uno__piles">
        <button
          type="button"
          className={`uno__pile uno__draw${canDraw ? " is-live" : ""}`}
          aria-label={
            canDraw
              ? state.pending > 0
                ? `Take ${state.pending} cards`
                : "Draw a card"
              : `Draw pile, ${state.drawPile} cards`
          }
          aria-keyshortcuts="D"
          disabled={!canDraw}
          onClick={onDraw}
        >
          <CardBack className="uno-card--pile uno-card--under" />
          <CardBack className="uno-card--pile" />
          <span className="uno__pile-count">{state.drawPile}</span>
        </button>
        <div className="uno__pile uno__discard" data-color={colour ?? "none"}>
          {shownTop === null ? null : (
            <UnoCard
              key={shownTop.id}
              card={shownTop}
              className={`uno-card--pile uno-card--land ${mine ? "uno-card--from-below" : "uno-card--from-above"}`}
            />
          )}
          {state.pending > 0 ? <span className="uno__pending">+{state.pending}</span> : null}
        </div>
      </div>
      <p className={`uno__colour${colour === null ? "" : ` uno__colour--${colour}`}`}>
        <span className="uno__colour-dot" aria-hidden="true" />
        {colour === null ? "No colour yet" : COLOR_NAMES[colour]}
      </p>
      {state.badges.length > 0 ? (
        <ul className="uno__badges">
          {state.badges.map((badge) => (
            <li key={badge.text} className="tag uno__badge">
              <span aria-hidden="true">{badge.icon}</span> {badge.text}
            </li>
          ))}
        </ul>
      ) : null}
      <Clock state={state} />
    </div>
  );
}

/**
 * The newest thing that happened, said big for a moment.
 *
 * Only effects that arrive while this page is open: a table joined mid-game
 * does not replay the last dozen Skips at whoever just sat down.
 */
export function Moment({ state }: { state: TableView }) {
  const newest = state.effects.at(-1) ?? null;
  const first = useRef(newest?.seq ?? 0);
  if (newest === null || newest.seq <= first.current) {
    return null;
  }
  return (
    <p key={newest.seq} className={`uno__moment uno__moment--${newest.kind}`} role="status">
      {newest.text}
    </p>
  );
}

/* ----------------------------------------------------------------- hand */

/**
 * Your cards, in a row that scrolls inside itself rather than pushing the page
 * sideways. The ones you may play now stand up; the rest sit back.
 */
export function Hand({
  state,
  intent,
  onPick,
}: {
  state: TableView;
  intent: Intent;
  onPick: (card: Card, jump: boolean) => void;
}) {
  const hand = state.hand;
  /*
   * How each card came into the hand, fixed the first time it is drawn so the
   * class never changes under a running animation. A card that arrives while
   * a draw was showing face down turns over instead of arriving again — the
   * back was its arrival, and two would be two cards. The hand on the screen
   * when this mounts was already there, and does not arrive at all.
   */
  const how = useRef<Map<number, "arriving" | "turning" | "here"> | null>(null);
  const drawn = useRef(false);
  const pending = hand !== null && intent.drawing !== null && hand.cards.length <= intent.drawing;
  const ids = hand?.cards.map((card) => card.id).join(",") ?? "";
  const kindOf = (id: number) =>
    how.current === null ? "here" : (how.current.get(id) ?? (drawn.current ? "turning" : "arriving"));
  // Recorded after the commit, so a render React throws away cannot eat an arrival.
  // biome-ignore lint/correctness/useExhaustiveDependencies: ids is the hand, read through kindOf
  useEffect(() => {
    const next = new Map<number, "arriving" | "turning" | "here">();
    for (const id of ids === "" ? [] : ids.split(",").map(Number)) {
      next.set(id, kindOf(id));
    }
    how.current = next;
    drawn.current = pending;
  }, [ids, pending]);
  if (hand === null) {
    return null;
  }
  const cards = hand.cards.filter((card) => card.id !== intent.played?.card.id);
  const playable = new Set(hand.playable);
  const jumpable = new Set(hand.jumpable);
  return (
    <div className="uno__hand table-scroll" role="group" aria-label="Your hand">
      <ul className="uno__cards">
        {cards.map((card) => {
          const kind = kindOf(card.id);
          const can = !intent.busy && (playable.has(card.id) || jumpable.has(card.id));
          const classes = [
            "uno__in-hand",
            playable.has(card.id) ? "is-playable" : "",
            jumpable.has(card.id) ? "is-jump" : "",
            hand.drawn === card.id ? "is-drawn" : "",
            kind === "here" ? "" : `is-${kind}`,
          ]
            .filter((one) => one !== "")
            .join(" ");
          return (
            <li key={card.id} className={classes}>
              <button
                type="button"
                className="uno__card-key"
                disabled={!can}
                onClick={() => onPick(card, jumpable.has(card.id))}
              >
                <UnoCard card={card} />
              </button>
            </li>
          );
        })}
        {pending ? (
          <li className="uno__in-hand is-arriving" aria-label="A card on its way">
            <CardBack />
          </li>
        ) : null}
      </ul>
    </div>
  );
}

/* -------------------------------------------------------------- pickers */

export function ColourPicker({ onPick, onCancel }: { onPick: (color: Color) => void; onCancel?: () => void }) {
  return (
    <div className="uno__picker" role="group" aria-label="Pick a colour">
      {COLORS.map((color) => (
        <button
          key={color}
          type="button"
          className={`key uno__colour-key uno__colour-key--${color}`}
          onClick={() => onPick(color)}
        >
          {COLOR_NAMES[color]}
        </button>
      ))}
      {onCancel === undefined ? null : (
        <button type="button" className="key" onClick={onCancel}>
          Back
        </button>
      )}
    </div>
  );
}

export function TargetPicker({
  state,
  seatId,
  onPick,
  onCancel,
}: {
  state: TableView;
  seatId: string | null;
  onPick: (seat: string) => void;
  onCancel: () => void;
}) {
  return (
    <div className="uno__picker" role="group" aria-label="Pick a player">
      {state.seats
        .filter((seat) => seat.inGame && seat.id !== seatId)
        .map((seat) => (
          <button key={seat.id} type="button" className="key" onClick={() => onPick(seat.id)}>
            {seat.name} · {seat.cards ?? "?"}
          </button>
        ))}
      <button type="button" className="key" onClick={onCancel}>
        Back
      </button>
    </div>
  );
}

/** What a card still needs chosen before it can go, in the order it is asked. */
export function stillNeeds(needs: readonly Input[], chosen: { color?: Color; target?: string }): Input | null {
  if (needs.includes("color") && chosen.color === undefined) return "color";
  if (needs.includes("target") && chosen.target === undefined) return "target";
  return null;
}

/* ------------------------------------------------------------- overlays */

/** Escape's peek, for the player who played it and nobody else. */
export function PeekCard({ state, onClose }: { state: TableView; onClose: () => void }) {
  const peek = state.peek;
  if (peek === null) return null;
  return (
    <div className="uno__overlay" role="dialog" aria-label="A peek at a hand">
      <p className="uno__overlay-title">{state.seats.find((seat) => seat.id === peek.target)?.name ?? "Their"}'s hand</p>
      <div className="uno__shown">
        {peek.cards.map((card) => (
          <UnoCard key={card.id} card={card} className="uno-card--small" />
        ))}
      </div>
      <button type="button" className="key" onClick={onClose}>
        Got it
      </button>
    </div>
  );
}

/**
 * A finished round, every hand face up, and what each was worth.
 *
 * Up for as long as the table holds the round, which is the table's clock and
 * not this component's.
 */
export function RoundOver({ state, seatId }: { state: TableView; seatId: string | null }) {
  const result = state.lastRound;
  if (result === null || (state.phase !== "between" && state.phase !== "over")) {
    return null;
  }
  const champion = state.winnerIds[0] ?? null;
  const rows = state.seats.filter((seat) => seat.inGame);
  return (
    <div className="uno__overlay uno__overlay--result" role="status">
      <p className="uno__overlay-title">
        {result.gameOver && champion !== null
          ? `${who(state, seatId, champion) === "you" ? "You win" : `${who(state, seatId, champion)} wins`} the game!`
          : `${who(state, seatId, result.winner) === "you" ? "You win" : `${who(state, seatId, result.winner)} wins`} round ${result.round}`}
      </p>
      {result.gameOver && state.pot > 0 ? (
        <p className="uno__overlay-pot">
          Takes the pot: <span className="uno__chips">{fmt(state.pot)}</span>
        </p>
      ) : null}
      <ul className="uno__results">
        {rows.map((seat) => (
          <li key={seat.id} className={`uno__result${seat.id === result.winner ? " is-winner" : ""}`}>
            <span className="uno__result-name">{seat.id === seatId ? "You" : seat.name}</span>
            <span className="uno__result-cards">
              {seat.shown.map((card) => (
                <UnoCard key={card.id} card={card} className="uno-card--tiny" />
              ))}
            </span>
            <span className="uno__result-pts">
              {(result.gained[seat.id] ?? 0) > 0 ? `+${result.gained[seat.id]}` : ""}
              {state.rules.gameMode === "points" ? ` · ${seat.score}` : ""}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------- controls */

export function Controls({
  state,
  seatId,
  intent,
  picking,
  onDraw,
  onPass,
  onUno,
  onCatch,
  onChallenge,
  onColour,
  onReady,
  keys,
}: {
  state: TableView;
  seatId: string | null;
  intent: Intent;
  /** A colour or target picker for a card being played, which takes the row. */
  picking: ReactNode;
  onDraw: () => void;
  onPass: () => void;
  onUno: () => void;
  onCatch: (seat: string) => void;
  onChallenge: (challenge: boolean) => void;
  onColour: (color: Color) => void;
  onReady: (ready: boolean) => void;
  /** Help, a bot, a taunt: the keys that are always there. */
  keys: ReactNode;
}) {
  const hand = state.hand;
  const mine = state.toAct !== null && state.toAct === seatId;
  const held = (which: string) => (intent.pressed === which ? " is-busy" : "");
  const say = <p className="uno__line">{line(state, seatId)}</p>;

  if (picking !== null) {
    return <div className="uno__controls">{picking}</div>;
  }

  if (state.phase === "waiting") {
    const ready = intent.ready ?? state.you?.ready ?? false;
    return (
      <div className="uno__controls">
        {say}
        <div className="uno__keys">
          {keys}
          <button
            type="button"
            className="slab uno__go"
            disabled={seatId === null || state.you === null}
            onClick={() => onReady(!ready)}
          >
            {ready ? "Waiting…" : "I'm in"}
          </button>
        </div>
      </div>
    );
  }

  if (mine && state.step === "chooseColor") {
    return (
      <div className="uno__controls">
        {say}
        <ColourPicker onPick={onColour} />
      </div>
    );
  }

  if (mine && state.step === "challenge") {
    return (
      <div className="uno__controls">
        {say}
        <div className="uno__keys">
          {keys}
          <button type="button" className={`key${held("challenge")}`} disabled={intent.busy} onClick={() => onChallenge(true)}>
            Challenge
          </button>
          <button type="button" className={`slab uno__go${held("accept")}`} disabled={intent.busy} onClick={() => onChallenge(false)}>
            Take +{state.pending}
          </button>
        </div>
      </div>
    );
  }

  const catchable = state.catchable !== null && state.catchable !== seatId && state.rules.unoPenalty > 0 && hand !== null;
  return (
    <div className="uno__controls">
      {say}
      <div className="uno__keys">
        {keys}
        {catchable ? (
          <button
            type="button"
            className={`key uno__catch${held("catch")}`}
            disabled={intent.busy}
            onClick={() => onCatch(state.catchable as string)}
          >
            Catch {who(state, seatId, state.catchable)}!
          </button>
        ) : null}
        {hand?.canUno ? (
          <button
            type="button"
            className={`key uno__uno${held("uno")}`}
            aria-keyshortcuts="U"
            disabled={intent.pressed === "uno"}
            onClick={onUno}
          >
            UNO!
          </button>
        ) : null}
        {hand?.canPass ? (
          <button type="button" className={`key${held("pass")}`} aria-keyshortcuts="K" disabled={intent.busy} onClick={onPass}>
            Keep it
          </button>
        ) : null}
        {mine && hand?.canDraw ? (
          <button
            type="button"
            className={`slab uno__go${held("draw")}`}
            aria-keyshortcuts="D"
            disabled={intent.busy}
            onClick={onDraw}
          >
            {state.pending > 0 ? `Take +${state.pending}` : "Draw"}
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** Whether a card in the hand needs anything chosen, given what the table says it needs. */
export function needsOf(state: TableView, card: Card): readonly Input[] {
  return state.hand?.needs[card.id] ?? (isWild(card) ? ["color"] : []);
}

/** The keyboard: D draws, K keeps, U calls UNO — never while typing. */
export function useUnoKeys(handlers: { draw?: () => void; pass?: () => void; uno?: () => void }) {
  const ref = useRef(handlers);
  ref.current = handlers;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        (target !== null && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)))
      ) {
        return;
      }
      const key = event.key.toLowerCase();
      const run = key === "d" ? ref.current.draw : key === "k" ? ref.current.pass : key === "u" ? ref.current.uno : undefined;
      if (run !== undefined) {
        event.preventDefault();
        run();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

/** Which peeks this player has already put away. */
export function usePeekSeen(state: TableView): [boolean, () => void] {
  const [seen, setSeen] = useState(0);
  const seq = state.peek?.seq ?? 0;
  return [seq > seen, () => setSeen(seq)];
}
