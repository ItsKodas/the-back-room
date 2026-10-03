import type { Card, Color, Input, Rules, SeatView, TableView } from "@backroom/game-uno";
import { CATEGORIES, COLOR_NAMES, COLORS, describe, isWild, label, officialRules, RULES } from "@backroom/game-uno";
import type { ReactNode } from "react";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { ActivityEntry } from "../table/Activity.js";
import { CardBack, UnoCard } from "./Card.js";
import type { Intent } from "./useIntent.js";

/*
 * The tabletop's table, drawn from the server's view of it.
 *
 * Every piece here is the uploaded tabletop's own — the oval, the seats round
 * its rim, the piles, the hand, the cream pickers, the toasts — rebuilt as
 * components that read a TableView instead of a Game object. Nothing here
 * decides a rule: what is playable, what needs a colour, who can be caught is
 * all the table's word, and a press only ever asks.
 */

const fmt = (n: number) => n.toLocaleString("en-US");

/** The tabletop's seat colours: one hue per place at the table. */
export const hue = (index: number) => (index * 47 + 200) % 360;

/** A seat's name, or "you" when it is yours. */
export const who = (state: TableView, seatId: string | null, of: string | null): string =>
  of !== null && of === seatId ? "you" : (state.seats.find((seat) => seat.id === of)?.name ?? "Somebody");

const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** Whether it is this player's own turn to play or draw. */
export const myTurn = (state: TableView, seatId: string | null) =>
  seatId !== null && state.toAct === seatId && (state.step === "playing" || state.step === "postDraw");

/** The line across the top: what the table is waiting on, in the tabletop's words. */
export function line(state: TableView, seatId: string | null): string {
  if (state.phase === "waiting") {
    if (state.waitingFor === "players") {
      return state.forFun ? "Waiting for somebody to sit down, or deal in a bot." : "Waiting for a second player.";
    }
    const total = state.seats.filter((seat) => seat.connected).length;
    return `${state.readyCount} of ${total} are in.`;
  }
  if (state.phase === "between") {
    return "Round over";
  }
  if (state.phase === "over") {
    return "Game over";
  }
  const mine = state.toAct === seatId;
  const name = who(state, seatId, state.toAct);
  const bot = state.seats.find((seat) => seat.id === state.toAct)?.isBot === true;
  switch (state.step) {
    case "chooseColor":
      return mine ? "Choose the starting colour" : `${name} is choosing a colour…`;
    case "challenge":
      return mine ? "Wild Draw Four! Challenge or accept?" : `${name} is deciding whether to challenge…`;
    case "postDraw":
      return mine ? "You drew a playable card — play it or keep it" : `${name} drew a card…`;
    default:
      if (state.pending > 0) {
        return mine ? `Answer the +${state.pending} with a card, or take it` : `${name} faces +${state.pending}…`;
      }
      if (mine) return "Your turn";
      return bot ? `${name} is thinking…` : `${name}'s turn`;
  }
}

/* -------------------------------------------------------------- avatars */

export function Avatar({ seat, index, small = false }: { seat: SeatView; index: number; small?: boolean }) {
  return (
    <span
      className={`uno-avatar${small ? " uno-avatar--sm" : ""}`}
      style={{ ["--hue" as string]: String(hue(index)) }}
      aria-hidden="true"
    >
      {seat.avatar === null ? (seat.name[0] ?? "?").toUpperCase() : <img src={seat.avatar} alt="" />}
    </span>
  );
}

/* ---------------------------------------------------------------- seats */

/** Where each seat sits round the oval, with yours at the bottom. */
export function seatPosition(place: number, count: number, portrait: boolean): { x: number; y: number } {
  const angle = Math.PI / 2 + (place * 2 * Math.PI) / count;
  return {
    x: 50 + Math.cos(angle) * (portrait ? 34 : 47),
    y: 50 + Math.sin(angle) * (portrait ? 44 : 45),
  };
}

/** Whether the table is taller than it is wide, which is how the tabletop decided where seats go. */
export function usePortrait(): boolean {
  const query = "(orientation: portrait)";
  const [portrait, setPortrait] = useState(() => typeof window !== "undefined" && window.matchMedia?.(query).matches === true);
  useEffect(() => {
    const list = window.matchMedia?.(query);
    if (list === undefined) return;
    const update = () => setPortrait(list.matches);
    update();
    list.addEventListener("change", update);
    return () => list.removeEventListener("change", update);
  }, []);
  return portrait;
}

function stateWord(seat: SeatView, state: TableView): string | null {
  if (!seat.connected) return "gone";
  if (seat.waiting) return "next game";
  if (seat.short) return "short";
  if (state.phase === "waiting") return seat.ready ? "ready" : null;
  return null;
}

export function Seats({
  state,
  seatId,
  portrait,
  catching,
  onCatch,
}: {
  state: TableView;
  seatId: string | null;
  portrait: boolean;
  catching: boolean;
  onCatch: (seat: string) => void;
}) {
  const seats = state.seats;
  const count = seats.length;
  const base = Math.max(
    0,
    seats.findIndex((seat) => seat.id === seatId),
  );
  const canCatch = seatId !== null && state.hand !== null && state.rules.unoPenalty > 0;
  return (
    <ol className="uno-seats" aria-label="Seats">
      {seats.map((seat, index) => {
        const place = (index - base + count) % count;
        const { x, y } = seatPosition(place, count, portrait);
        const current = state.toAct === seat.id;
        const hidden = seat.cards === null;
        const shown = !seat.inGame ? 0 : hidden ? 5 : Math.min(seat.cards ?? 0, 12);
        const word = stateWord(seat, state);
        const dealer = state.dealer === seat.id && seat.inGame;
        const classes = ["uno-seat", current ? "is-current" : "", seat.id === seatId ? "is-me" : "", seat.connected ? "" : "is-gone"]
          .filter((one) => one !== "")
          .join(" ");
        return (
          <li key={seat.id} className={classes} style={{ left: `${x}%`, top: `${y}%`, ["--hue" as string]: String(hue(index)) }}>
            <span className="uno-seat__fan" aria-hidden="true">
              {Array.from({ length: shown }, (_, at) => {
                const angle = shown > 1 ? (at / (shown - 1) - 0.5) * Math.min(60, shown * 7) : 0;
                // biome-ignore lint/suspicious/noArrayIndexKey: a card back is nothing but its place in the fan
                return <CardBack key={at} className="uno-card--mini" style={{ transform: `rotate(${angle}deg)` }} />;
              })}
            </span>
            <span className="uno-seat__plate">
              <Avatar seat={seat} index={index} />
              <span className="uno-seat__info">
                <span className="uno-seat__name">
                  {seat.id === seatId ? "You" : seat.name}
                  {seat.isBot ? <span className="uno-tag">{seat.skill ?? "normal"} bot</span> : null}
                  {dealer ? (
                    <span className="uno-tag uno-tag--dealer" title="Dealer">
                      d
                    </span>
                  ) : null}
                  {word === null ? null : <span className={`uno-tag${word === "ready" ? " uno-tag--ready" : ""}`}>{word}</span>}
                </span>
                <span className="uno-seat__meta">
                  {seat.inGame ? (
                    <>
                      {hidden ? <b>?</b> : <b>{seat.cards}</b>} {seat.cards === 1 ? "card" : "cards"} · {seat.score} pts
                    </>
                  ) : seat.purse !== null ? (
                    `${fmt(seat.purse)} chips`
                  ) : (
                    "At the table"
                  )}
                </span>
              </span>
            </span>
            {seat.uno ? <span className="uno-seat__uno">UNO!</span> : null}
            {canCatch && state.catchable === seat.id && seat.id !== seatId ? (
              <button type="button" className="uno-catch" disabled={catching} onClick={() => onCatch(seat.id)}>
                Catch!
              </button>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

/* --------------------------------------------------------------- centre */

/** A card's place in the scatter, the tabletop's own: stable for as long as it is on the pile. */
export const scatter = (id: number) => ({ r: ((id * 37) % 31) - 15, x: ((id * 13) % 11) - 5, y: ((id * 7) % 9) - 4 });

function Timer({ state }: { state: TableView }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (state.turnEndsAt === null) return;
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [state.turnEndsAt]);
  if (state.turnEndsAt === null) return null;
  const left = Math.max(0, state.turnEndsAt - now);
  const fromMs = Math.max(0, state.turnEndsAt - Date.now());
  return (
    <div className="uno-timer" role="timer" aria-label={`${Math.ceil(left / 1000)} seconds left`}>
      {/* Keyed on the deadline so a new turn starts its drain from where the
          table says it is, not from wherever the last one had got to. */}
      <span
        key={state.turnEndsAt}
        className="uno-timer__bar"
        style={{
          animationDuration: `${Math.round(fromMs)}ms`,
          ["--from" as string]: (fromMs / Math.max(1, state.turnMs)).toFixed(3),
        }}
      />
      <span className="uno-timer__text">{Math.ceil(left / 1000)}s</span>
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
  // The pile as the table has it, with a card you just played already on top.
  const played = intent.played;
  const pile = played === null || state.recent.some((card) => card.id === played.card.id)
    ? state.recent
    : [...state.recent, played.card].slice(-5);
  // A Wild takes the colour you picked; anything else is its own colour.
  const colour =
    played === null
      ? state.color
      : isWild(played.card)
        ? (played.color ?? state.color)
        : (played.card.color as Color);
  const top = pile.at(-1) ?? null;
  // The top card at mount was already there: it does not land again for a page that just opened.
  const already = useRef(top?.id ?? null);
  const canDraw = state.hand?.canDraw === true && !intent.busy && myTurn(state, seatId);
  const drawing = intent.pressed === "draw";

  return (
    <div className="uno-center">
      <div
        className={`uno-dir${state.direction < 0 ? " is-ccw" : ""}`}
        role="img"
        aria-label={state.direction > 0 ? "Play goes clockwise" : "Play goes counter-clockwise"}
      >
        <svg viewBox="0 0 100 100" aria-hidden="true">
          <circle cx="50" cy="50" r="45" fill="none" stroke="currentColor" strokeWidth="1.2" strokeDasharray="22 8" />
          {[0, 120, 240].map((angle) => (
            <path key={angle} transform={`rotate(${angle} 50 50)`} d="M57 5 L51 1.5 L51 8.5 Z" fill="currentColor" />
          ))}
        </svg>
      </div>
      <div className="uno-stack">
        <div className="uno-piles">
          <button
            type="button"
            className={`uno-pile uno-draw-pile${canDraw ? " is-live" : ""}`}
            aria-label={
              canDraw ? (state.pending > 0 ? `Take ${state.pending} cards` : "Draw a card") : `Draw pile, ${state.drawPile} cards`
            }
            aria-keyshortcuts="D"
            aria-disabled={!canDraw}
            onClick={canDraw && !drawing ? onDraw : undefined}
          >
            {state.drawPile > 0 ? (
              <>
                <CardBack style={{ transform: "translate(3px, 3px)" }} />
                <CardBack />
              </>
            ) : (
              <span className="uno-empty-pile" />
            )}
            <span className="uno-draw-pile__count" aria-hidden="true">
              {state.drawPile}
            </span>
          </button>
          <div className="uno-pile uno-discard" data-color={colour ?? "none"}>
            {pile.map((card, at) => {
              const spot = scatter(card.id);
              const isTop = at === pile.length - 1;
              return (
                <span
                  key={card.id}
                  className={`uno-pile__slot${isTop && card.id !== already.current ? " is-enter" : ""}`}
                  style={{ transform: `translate(${spot.x}px, ${spot.y}px) rotate(${spot.r}deg)` }}
                >
                  <UnoCard card={card} />
                </span>
              );
            })}
            {state.pending > 0 ? <span className="uno-pending">+{state.pending}</span> : null}
          </div>
        </div>
        <p className={`uno-color-chip${colour === null ? "" : ` uno-color-chip--${colour}`}`}>
          <span className="uno-color-chip__dot" aria-hidden="true" />
          {colour === null ? "Choose a colour" : COLOR_NAMES[colour]}
        </p>
        <Timer state={state} />
        {state.badges.length > 0 ? (
          <ul className="uno-badges">
            {state.badges.map((badge) => (
              <li key={badge.text} className="uno-badge">
                <span aria-hidden="true">{badge.icon}</span> {badge.text}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- toasts */

interface Toast {
  key: string;
  kind: string;
  text: string;
}

const TOAST_MS = 1_900;

/**
 * What just happened, said big in the middle of the table for a moment —
 * three at most, the oldest giving way. Only effects that arrive while this
 * page is open: a table joined mid-game does not replay its last dozen Skips
 * at whoever just sat down. A refusal is a toast too, in its own colour.
 */
export function Toasts({
  state,
  error,
  errorKey,
  said = null,
}: {
  state: TableView;
  error: string | null;
  errorKey: number;
  /** A refusal the page said itself, before asking: counted, so the same words twice are two toasts. */
  said?: { text: string; n: number } | null;
}) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seen = useRef(state.effects.at(-1)?.seq ?? 0);
  const timers = useRef<number[]>([]);

  useEffect(() => {
    const held = timers.current;
    return () => {
      for (const id of held) window.clearTimeout(id);
    };
  }, []);

  const push = (toast: Toast) => {
    setToasts((was) => [...was, toast].slice(-3));
    timers.current.push(window.setTimeout(() => setToasts((was) => was.filter((one) => one.key !== toast.key)), TOAST_MS));
  };

  const newest = state.effects.at(-1)?.seq ?? 0;
  // biome-ignore lint/correctness/useExhaustiveDependencies: the newest seq is the trigger; the list is read through it
  useEffect(() => {
    for (const effect of state.effects) {
      if (effect.seq > seen.current) {
        push({ key: `e${effect.seq}`, kind: effect.kind, text: effect.text });
      }
    }
    seen.current = Math.max(seen.current, newest);
  }, [newest]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: errorKey is the trigger for a repeat, not a value read
  useEffect(() => {
    if (error !== null) {
      push({ key: `x${errorKey}`, kind: "error", text: error });
    }
  }, [error, errorKey]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the count is the trigger, the words are read through it
  useEffect(() => {
    if (said !== null) {
      push({ key: `s${said.n}`, kind: "error", text: said.text });
    }
  }, [said?.n]);

  return (
    <div className="uno-toasts" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <p key={toast.key} className={`uno-toast uno-toast--${toast.kind}`}>
          {toast.text}
        </p>
      ))}
    </div>
  );
}

/* ----------------------------------------------------------------- hand */

/**
 * Your cards, fanned along the bottom. They overlap as the hand grows so it
 * stays one row inside its own width — the tabletop's layout — and scroll
 * inside themselves past that rather than pushing the page sideways.
 *
 * The playable ones stand up, the rest sit back on your turn, and a card you
 * may jump in with wears a yellow ring. Tapping one you cannot play shakes it.
 */
export function Hand({
  state,
  seatId,
  intent,
  onPick,
  onRefused,
}: {
  state: TableView;
  seatId: string | null;
  intent: Intent;
  onPick: (card: Card, jump: boolean) => void;
  onRefused: (why: string | null) => void;
}) {
  const hand = state.hand;
  const box = useRef<HTMLUListElement | null>(null);
  const [shaking, setShaking] = useState<{ id: number; n: number } | null>(null);
  /*
   * How each card came into the hand, fixed the first time it is drawn so its
   * class never changes under a running animation. A card that arrives while a
   * draw was showing face down turns over instead of arriving again — the back
   * was its arrival, and two would be two cards. The hand on screen when this
   * mounts was already there and does not arrive at all.
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

  const cards = hand === null ? [] : hand.cards.filter((card) => card.id !== intent.played?.card.id);
  const count = cards.length + (pending ? 1 : 0);

  // The overlap: as much gap as fits, down to three quarters of a card under the next.
  useLayoutEffect(() => {
    const element = box.current;
    if (element === null) return;
    const fit = () => {
      const first = element.querySelector<HTMLElement>(".uno-card");
      if (first === null) return;
      const width = first.offsetWidth;
      const style = window.getComputedStyle(element);
      const room = element.clientWidth - Number.parseFloat(style.paddingLeft) - Number.parseFloat(style.paddingRight);
      let gap = 8;
      if (count > 1 && count * width + (count - 1) * gap > room) {
        gap = (room - count * width) / (count - 1);
      }
      element.style.setProperty("--gap", `${Math.max(gap, -width * 0.78)}px`);
    };
    fit();
    if (typeof ResizeObserver === "undefined") return;
    const watch = new ResizeObserver(fit);
    watch.observe(element);
    return () => watch.disconnect();
  }, [count]);

  if (hand === null) {
    return (
      <div className="uno-hand">
        <p className="uno-hand-msg">
          {seatId === null
            ? "Watching. Every hand is hidden from you."
            : state.phase === "waiting"
              ? "Your hand is dealt when the game starts."
              : "You are in for the next game."}
        </p>
      </div>
    );
  }

  const turn = myTurn(state, seatId);
  const playable = new Set(hand.playable);
  const jumpable = new Set(hand.jumpable);

  const press = (card: Card) => {
    if (intent.busy) return;
    if (playable.has(card.id) || jumpable.has(card.id)) {
      onPick(card, jumpable.has(card.id) && !playable.has(card.id));
      return;
    }
    setShaking((was) => ({ id: card.id, n: (was?.n ?? 0) + 1 }));
    onRefused(turn && state.step === "postDraw" ? "You can only play the card you just drew — or keep it." : null);
  };

  return (
    <ul className="uno-hand" ref={box} aria-label="Your hand">
      {cards.map((card) => {
        const kind = kindOf(card.id);
        const can = playable.has(card.id) || jumpable.has(card.id);
        const classes = [
          "uno-hand__card",
          can ? "is-playable" : turn ? "is-dim" : "",
          !playable.has(card.id) && jumpable.has(card.id) ? "is-jump" : "",
          hand.drawn === card.id && turn ? "is-drawn" : "",
          kind === "arriving" ? "is-enter" : kind === "turning" ? "is-turning" : "",
          shaking?.id === card.id ? "is-shake" : "",
        ]
          .filter((one) => one !== "")
          .join(" ");
        return (
          // The shake is restarted by remounting its card, which is what a key change does.
          <li key={shaking?.id === card.id ? `${card.id}:${shaking.n}` : card.id} className={classes}>
            <button
              type="button"
              className="uno-hand__key"
              aria-disabled={!can || intent.busy}
              aria-label={`${label(card)}${can ? "" : ", can't play it now"}`}
              title={label(card)}
              onClick={() => press(card)}
            >
              <UnoCard card={card} />
            </button>
          </li>
        );
      })}
      {pending ? (
        <li className="uno-hand__card is-enter" aria-label="A card on its way">
          <CardBack />
        </li>
      ) : null}
    </ul>
  );
}

/** Above the hand: whose it is, and the three things a hand can do besides play. */
export function HandControls({
  state,
  seatId,
  intent,
  onDraw,
  onPass,
  onUno,
  extra,
}: {
  state: TableView;
  seatId: string | null;
  intent: Intent;
  onDraw: () => void;
  onPass: () => void;
  onUno: () => void;
  /** The ready press and the bot dealer, between games. */
  extra?: ReactNode;
}) {
  const index = state.seats.findIndex((seat) => seat.id === seatId);
  const me = index === -1 ? null : (state.seats[index] ?? null);
  const hand = state.hand;
  const turn = myTurn(state, seatId);
  const held = (which: string) => (intent.pressed === which ? " is-busy" : "");
  return (
    <div className="uno-hand-controls">
      <div className="uno-hc-name">
        {me === null ? (
          <span className="uno-muted">Watching</span>
        ) : (
          <>
            <Avatar seat={me} index={index} small />
            {me.name}
            {turn ? <span className="uno-your-turn">your turn</span> : null}
          </>
        )}
      </div>
      <div className="uno-hc-buttons">
        {extra}
        {hand === null ? null : (
          <>
            <button
              type="button"
              className={`uno-btn${held("draw")}`}
              aria-keyshortcuts="D"
              title="Shortcut: D"
              disabled={!hand.canDraw || !turn || (intent.busy && intent.pressed !== "draw")}
              onClick={intent.pressed === "draw" ? undefined : onDraw}
            >
              {state.pending > 0 && turn ? `Take +${state.pending}` : "Draw"}
            </button>
            {hand.canPass ? (
              <button
                type="button"
                className={`uno-btn${held("pass")}`}
                aria-keyshortcuts="K"
                title="Shortcut: K"
                disabled={intent.busy && intent.pressed !== "pass"}
                onClick={intent.pressed === "pass" ? undefined : onPass}
              >
                Keep card
              </button>
            ) : null}
            <button
              type="button"
              className={`uno-btn uno-btn--uno${hand.canUno && intent.pressed !== "uno" ? " is-armed" : ""}${held("uno")}`}
              aria-keyshortcuts="U"
              title="Shortcut: U"
              disabled={!hand.canUno}
              onClick={intent.pressed === "uno" ? undefined : onUno}
            >
              UNO!
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- modals */

/**
 * The tabletop's cream modal over a dimmed table. A dialog in name as well as
 * look, so a screen reader is told it opened, and Escape backs out of the
 * ones that can be backed out of.
 */
export function Modal({
  title,
  size,
  onClose,
  children,
  label: named,
}: {
  title: ReactNode;
  size?: "small" | "wide";
  onClose?: () => void;
  children: ReactNode;
  /** When the title is not words, what the dialog is called. */
  label?: string;
}) {
  const id = useId();
  const box = useRef<HTMLDivElement | null>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    box.current?.querySelector<HTMLElement>("button")?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && close.current !== undefined) {
        event.preventDefault();
        close.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <div className="uno-backdrop">
      <div
        ref={box}
        className={`uno-modal${size === undefined ? "" : ` uno-modal--${size}`}`}
        role="dialog"
        aria-modal="true"
        {...(named === undefined ? { "aria-labelledby": id } : { "aria-label": named })}
      >
        <h2 id={id}>{title}</h2>
        {children}
      </div>
    </div>
  );
}

function ColourGrid({ onPick }: { onPick: (color: Color) => void }) {
  return (
    <div className="uno-color-grid">
      {COLORS.map((color) => (
        <button key={color} type="button" className={`uno-color-btn uno-color-btn--${color}`} onClick={() => onPick(color)}>
          {COLOR_NAMES[color]}
        </button>
      ))}
    </div>
  );
}

export function ColourModal({ card, onPick, onCancel }: { card: Card; onPick: (color: Color) => void; onCancel: () => void }) {
  return (
    <Modal title="Choose a colour" size="small" onClose={onCancel}>
      <p className="uno-muted">for your {label(card)}</p>
      <ColourGrid onPick={onPick} />
      <div className="uno-modal-actions">
        <button type="button" className="uno-btn uno-btn--ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}

export function TargetModal({
  state,
  seatId,
  card,
  onPick,
  onCancel,
}: {
  state: TableView;
  seatId: string | null;
  card: Card;
  onPick: (seat: string) => void;
  onCancel: () => void;
}) {
  return (
    <Modal title={card.type === "escape" ? "Peek at whose hand?" : "Swap hands with…"} size="small" onClose={onCancel}>
      <div className="uno-target-list">
        {state.seats.map((seat, index) =>
          !seat.inGame || seat.id === seatId ? null : (
            <button key={seat.id} type="button" className="uno-target-btn" onClick={() => onPick(seat.id)}>
              <Avatar seat={seat} index={index} small />
              {seat.name}
              <b>{seat.cards ?? "?"} cards</b>
            </button>
          ),
        )}
      </div>
      <div className="uno-modal-actions">
        <button type="button" className="uno-btn uno-btn--ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}

export function StartColourModal({ onPick }: { onPick: (color: Color) => void }) {
  return (
    <Modal title="The round starts on a Wild" size="small">
      <p className="uno-muted">Pick the first colour.</p>
      <ColourGrid onPick={onPick} />
    </Modal>
  );
}

export function ChallengeModal({
  state,
  seatId,
  busy,
  onAnswer,
}: {
  state: TableView;
  seatId: string | null;
  busy: boolean;
  onAnswer: (challenge: boolean) => void;
}) {
  const by = who(state, seatId, state.challenger);
  const colour = state.challengeColor;
  const stacking = state.rules.stacking !== "off";
  return (
    <Modal title={`${capital(by)} played Wild Draw Four`} size="small">
      <p>
        Do you think {by} had a{" "}
        <b className={colour === null ? "" : `uno-txt-${colour}`}>{colour === null ? "matching" : COLOR_NAMES[colour]}</b> card
        they could have played?
      </p>
      <ul className="uno-small-list">
        <li>
          <b>Challenge:</b> if they were bluffing, they draw 4 and you take your turn. If not, you draw {state.pending + 2}.
        </li>
        <li>
          <b>Accept:</b> {stacking ? `stack a +4 or draw ${state.pending}.` : `draw ${state.pending} and lose your turn.`}
        </li>
      </ul>
      <div className="uno-modal-actions">
        <button type="button" className="uno-btn uno-btn--danger" disabled={busy} onClick={() => onAnswer(true)}>
          Challenge!
        </button>
        <button type="button" className="uno-btn" disabled={busy} onClick={() => onAnswer(false)}>
          Accept
        </button>
      </div>
    </Modal>
  );
}

/** Held back a beat after a round ends, as the tabletop did, so the last card is seen landing. */
const ROUND_DELAY_MS = 1_100;

export function RoundModal({ state, seatId }: { state: TableView; seatId: string | null }) {
  const result = state.lastRound;
  const showing = result !== null && (state.phase === "between" || state.phase === "over");
  const key = showing ? `${result.round}:${state.phase}` : null;
  const [ready, setReady] = useState<string | null>(null);
  useEffect(() => {
    if (key === null) return;
    const id = window.setTimeout(() => setReady(key), ROUND_DELAY_MS);
    return () => window.clearTimeout(id);
  }, [key]);
  if (!showing || ready !== key) return null;

  const champion = result.gameOver ? (state.winnerIds[0] ?? result.champion) : null;
  const rows = state.seats.map((seat, index) => ({ seat, index })).filter(({ seat }) => seat.inGame);
  const name = (of: string | null) => capital(who(state, seatId, of));
  return (
    <Modal
      size="wide"
      label={champion !== null ? "Game over" : `Round ${result.round} over`}
      title={
        <span className="uno-round-title">
          {champion !== null ? (
            <>
              <span className="uno-trophy" aria-hidden="true">
                🏆
              </span>
              {name(champion)} {champion === seatId ? "win" : "wins"} the game!
            </>
          ) : (
            `${name(result.winner)} ${result.winner === seatId ? "win" : "wins"} round ${result.round}!`
          )}
        </span>
      }
    >
      <p className="uno-muted uno-round-title">
        {state.rules.scoringMode === "winner"
          ? "The round winner scores the cards left in everyone else's hands."
          : "Everyone scores their own leftover cards — lowest total wins."}
      </p>
      <div className="uno-table-scroll">
        <table className="uno-scores">
          <thead>
            <tr>
              <th>Player</th>
              <th>Cards left</th>
              <th className="uno-num">Hand</th>
              <th className="uno-num">Round</th>
              <th className="uno-num">Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ seat, index }) => (
              <tr key={seat.id} className={seat.id === result.winner ? "is-win" : ""}>
                <td>
                  <span className="uno-scores__who">
                    <Avatar seat={seat} index={index} small />
                    {seat.id === seatId ? "You" : seat.name}
                  </span>
                </td>
                <td className="uno-scores__hand">
                  {seat.shown.length === 0 ? (
                    <span className="uno-muted">—</span>
                  ) : (
                    seat.shown.map((card) => <UnoCard key={card.id} card={card} className="uno-card--tiny" />)
                  )}
                </td>
                <td className="uno-num">{result.handPoints[seat.id] ?? 0}</td>
                <td className="uno-num">{(result.gained[seat.id] ?? 0) > 0 ? `+${result.gained[seat.id]}` : ""}</td>
                <td className="uno-num uno-total">{seat.score}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="uno-modal-actions">
        <span className="uno-muted">
          {champion === null
            ? "The next round deals itself in a moment."
            : state.pot > 0
              ? `${name(champion)} ${champion === seatId ? "take" : "takes"} the pot of ${fmt(state.pot)}.`
              : "A new game deals once everybody is in."}
        </span>
      </div>
    </Modal>
  );
}

/** Every rule in play, and which ones the host changed from the box. */
export function RulesModal({ rules, onClose }: { rules: Rules; onClose: () => void }) {
  const official = officialRules();
  return (
    <Modal title="Rules in play" size="wide" onClose={onClose}>
      <p className="uno-muted">
        Match the top card by colour, number or symbol, or play a Wild. Can't (or won't) play? Draw a card. Call UNO when you
        play your second-to-last card. First to empty their hand wins the round.
      </p>
      {CATEGORIES.map((category) => (
        <section key={category.id}>
          <h3>{category.name}</h3>
          <ul className="uno-rules-list">
            {RULES.filter((rule) => rule.category === category.id).map((rule) => {
              const custom = rules[rule.id] !== official[rule.id];
              return (
                <li key={rule.id} className={custom ? "is-custom" : ""}>
                  <div>
                    <b>{rule.name}</b>: {describe(rules, rule)}
                    {custom ? <span className="uno-tag">house</span> : null}
                  </div>
                  <div className="uno-muted">{rule.desc}</div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      <p className="uno-muted">Keyboard: D draws, K keeps the drawn card, U calls UNO.</p>
      <div className="uno-modal-actions">
        <button type="button" className="uno-btn uno-btn--primary" onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  );
}

/** Escape's peek, for the player who played it and nobody else. */
export function PeekModal({ state, onClose }: { state: TableView; onClose: () => void }) {
  const peek = state.peek;
  if (peek === null) return null;
  const name = state.seats.find((seat) => seat.id === peek.target)?.name ?? "Their";
  return (
    <Modal title={`${name}'s hand`} size="wide" onClose={onClose}>
      <p className="uno-muted">Only you can see this. Your card count is now hidden.</p>
      <div className="uno-peek">
        {peek.cards.length === 0 ? (
          <span className="uno-muted">Empty</span>
        ) : (
          peek.cards.map((card) => <UnoCard key={card.id} card={card} className="uno-card--small" />)
        )}
      </div>
      <div className="uno-modal-actions">
        <button type="button" className="uno-btn uno-btn--primary" onClick={onClose}>
          Got it
        </button>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ log */

export function LogPanel({ entries, onClose }: { entries: readonly ActivityEntry[]; onClose: () => void }) {
  const list = useRef<HTMLOListElement | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new line is the trigger
  useEffect(() => {
    const box = list.current;
    if (box !== null) box.scrollTop = box.scrollHeight;
  }, [entries.length]);
  return (
    <aside className="uno-log" aria-label="Game log">
      <div className="uno-log__head">
        <h2>Game log</h2>
        <button type="button" className="uno-btn uno-btn--ghost uno-btn--sm" onClick={onClose}>
          Close
        </button>
      </div>
      <ol ref={list}>
        {entries.map((entry) => (
          <li key={entry.id}>{entry.text}</li>
        ))}
      </ol>
    </aside>
  );
}

/* --------------------------------------------------------------- helpers */

/** What a card still needs chosen before it can go, in the order it is asked. */
export function stillNeeds(needs: readonly Input[], chosen: { color?: Color; target?: string }): Input | null {
  if (needs.includes("color") && chosen.color === undefined) return "color";
  if (needs.includes("target") && chosen.target === undefined) return "target";
  return null;
}

/** Whether a card in the hand needs anything chosen, given what the table says it needs. */
export function needsOf(state: TableView, card: Card): readonly Input[] {
  return state.hand?.needs[card.id] ?? (isWild(card) ? ["color"] : []);
}

/** The keyboard: D draws, K keeps, U calls UNO — never while typing, and never under a modal. */
export function useUnoKeys(handlers: { draw?: () => void; pass?: () => void; uno?: () => void }, enabled = true) {
  const ref = useRef(handlers);
  ref.current = handlers;
  const on = useRef(enabled);
  on.current = enabled;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        !on.current ||
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
