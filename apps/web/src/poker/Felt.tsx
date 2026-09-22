import type { TableView } from "@backroom/game-poker";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { TableIcon } from "../blackjack/Icons.js";
import { Card } from "../blackjack/Cards.js";
import { ChipStack } from "../chips/ChipStack.js";
import { Sheet } from "../table/Sheet.js";
import type { TableSocketHook } from "../table/useTableSocket.js";
import { Actions } from "./Controls.js";
import { POKER_SHEET_ID } from "./PokerSheet.js";
import { Readout, readoutFor } from "./Readout.js";
import { Rankings, RULES_SHEET_ID } from "./Rankings.js";
import { Seat } from "./Seat.js";
import { useIntent } from "./useIntent.js";

export type Table = TableSocketHook<TableView>;

export const fmt = (n: number) => n.toLocaleString("en-US");

/** The five places a board card goes, in the order they are dealt. */
export const SLOTS = ["flop1", "flop2", "flop3", "turn", "river"];

/**
 * How long each pot's announcement holds before the next one.
 *
 * Paired with the table's own showdown wait, which grows by the same step for
 * every side pot — if these two disagree the felt clears in the middle of a
 * sentence.
 */
export const MOMENT_MS = 2_400;

/**
 * The pots of a finished hand, in the order they should be announced.
 *
 * Grouped rather than listed, because a side pot is a separate thing won by
 * separate people and saying them all at once gives the main pot's winner and
 * a short stack's consolation the same breath.
 */
export function potsOf(paid: TableView["paid"]): TableView["paid"][] {
  const byPot = new Map<number, TableView["paid"]>();
  for (const one of paid) {
    const already = byPot.get(one.pot);
    if (already === undefined) {
      byPot.set(one.pot, [one]);
    } else {
      already.push(one);
    }
  }
  return [...byPot.entries()].sort(([a], [b]) => a - b).map(([, winners]) => winners);
}

/**
 * Which pot is being announced right now.
 *
 * Walks forward on its own clock and stops at the last one, so the final
 * announcement stays up for the rest of the showdown rather than vanishing.
 * Restarted by the moment the hand paid, which is the one thing that makes
 * this a different hand's sequence rather than the same one continuing.
 */
export function useMoment(paidAt: number | null, count: number): number {
  const [at, setAt] = useState(0);

  useEffect(() => {
    setAt(0);
    if (paidAt === null || count <= 1) {
      return;
    }
    const timers: number[] = [];
    for (let step = 1; step < count; step += 1) {
      timers.push(window.setTimeout(() => setAt(step), step * MOMENT_MS));
    }
    return () => {
      for (const timer of timers) {
        window.clearTimeout(timer);
      }
    };
  }, [paidAt, count]);

  return Math.min(at, Math.max(0, count - 1));
}

/** Nobody else's hand is pointed at, and one empty set does for all of them. */
export const EMPTY: Set<string> = new Set();

/** How a card is named when asking whether it is one of your five. */
export const nameOf = (card: { rank: string; suit: string }) => `${card.rank}${card.suit}`;

/**
 * Whether to light this card, dim it, or leave it alone.
 *
 * The third case is the one worth naming. With nothing to point at — before
 * the flop, or once you have folded — every card would take the "not in your
 * hand" class and the whole table would go grey, which reads as the felt
 * having gone out rather than as nothing being highlighted.
 */
export function pointing(using: Set<string>, card: { rank: string; suit: string }): string | undefined {
  if (using.size === 0) {
    return undefined;
  }
  return using.has(nameOf(card)) ? "pk__using" : "pk__spare";
}

/**
 * What a poker table counts in.
 *
 * Down to the small blind, which the betting tray's plates do not reach: this
 * game's numbers are multiples of ten, and counted in hundreds every bet on
 * the felt would come out as one odd chip standing for the remainder. With
 * tens and twenties in the ladder every amount here lands on real plates.
 */
export const TABLE_CHIPS = [1000, 500, 250, 100, 50, 20, 10];

/* -------------------------------------------------------------- the felt */

export function Felt({
  table,
  state,
  seatId,
  isHost = false,
  talkKey,
  rulesOpen = false,
  onToggleRules,
  onCloseRules,
  hostOpen = false,
  onToggleHost,
}: {
  table: Table;
  state: TableView;
  seatId: string | null;
  /**
   * Whose table it is, computed once by the caller (the same way blackjack's
   * parent computes it and threads it down) rather than worked out again
   * here — one answer to who may see the host's key, not two that could
   * disagree.
   */
  isHost?: boolean;
  /** The talk key, rendered into the felt's own corner rather than the bar. */
  talkKey?: ReactNode;
  /** Whether the "what beats what" sheet is open. */
  rulesOpen?: boolean;
  onToggleRules?: () => void;
  onCloseRules?: () => void;
  /** Whether the host's table sheet is open — only its key lives here. */
  hostOpen?: boolean;
  onToggleHost?: () => void;
}) {
  const intent = useIntent(state, seatId, table.error, table.errorKey);
  const me = state.seats.find((seat) => seat.id === seatId) ?? null;

  /*
   * Your seat at the bottom, everybody else round from it in dealing order.
   *
   * Rotated rather than sorted: the order seats come in is the order the table
   * plays in, and losing it would put the player to your left somewhere other
   * than on your left. Somebody watching has no seat to rotate to, so they get
   * the table as it is.
   */
  const seats = useMemo(() => {
    const mine = state.seats.findIndex((seat) => seat.id === seatId);
    return mine < 0
      ? state.seats
      : [...state.seats.slice(mine), ...state.seats.slice(0, mine)];
  }, [state.seats, seatId]);

  /*
   * What each seat took overall, for the mark on the seat itself. Summed here
   * because the payouts are per pot now, and somebody who won two of them won
   * the total rather than whichever happened to be last in the list.
   */
  const won = useMemo(() => {
    const totals = new Map<string, { chips: number; said: string | null }>();
    for (const one of state.paid) {
      const already = totals.get(one.seatId);
      totals.set(one.seatId, {
        chips: (already?.chips ?? 0) + one.chips,
        said: one.said ?? already?.said ?? null,
      });
    }
    return totals;
  }, [state.paid]);

  /* The pots, in the order they are announced, and which one is up now. */
  const moments = useMemo(() => potsOf(state.paid), [state.paid]);
  const moment = useMoment(state.paidAt, moments.length);
  const showing = moments[moment] ?? [];
  const spotlit = useMemo(() => new Set(showing.map((one) => one.seatId)), [showing]);

  /*
   * Which cards on the table are in your hand, held by name rather than by
   * position: a card is a rank and a suit, and the same card is in your hand
   * whether it came out of the deck third or fifth.
   */
  const using = useMemo(() => {
    /*
     * Nothing is pointed at once you have folded. The table still knows what
     * your two cards would have made — it keeps them until the hand is cleared
     * — but a hand you are no longer in is not a hand, and lighting up the
     * board for it says you are still playing.
     */
    const folded = state.seats.find((seat) => seat.id === seatId)?.folded ?? false;
    const cards = folded ? [] : (state.you?.hand?.using ?? []);
    return new Set(cards.map(nameOf));
  }, [state.you, state.seats, seatId]);

  return (
    <div className="pk">
      {/*
        * The felt's own "read" grid area, above the cloth rather than pushed
        * into it — the one figure this player is deciding about, worked out
        * once here so it stays whatever `state.you` the table has sent, the
        * same way every other piece of this screen reads off `state` rather
        * than guessing.
        */}
      <Readout model={readoutFor({ state, seatId })} />

      <div className="pk__table">
        <div className="pk__felt" />

        {/*
          * The other corner from talk: what beats what is a fact about this
          * game rather than the building's, so it lives on the table rather
          * than the room's own bar. The host's key sits beside it and only
          * the host ever sees it — the courtesy the bare `.pk__bots` row used
          * to pay for itself, now paid by the key that opens the sheet
          * `.pk__bots` moved into.
          */}
        <div className="pk__corner">
          <button
            type="button"
            className="key key--icon pk__help"
            aria-label="What beats what"
            aria-controls={RULES_SHEET_ID}
            aria-expanded={rulesOpen}
            onClick={onToggleRules}
          >
            ?
          </button>
          {isHost ? (
            <button
              type="button"
              className="key key--icon pk__host"
              aria-label="Table"
              aria-controls={POKER_SHEET_ID}
              aria-expanded={hostOpen}
              onClick={onToggleHost}
            >
              <TableIcon />
            </button>
          ) : null}
        </div>

        {talkKey !== undefined ? <div className="table-talk-corner">{talkKey}</div> : null}

        <div className="pk__middle">
          <p className="pk__pot">
            <span className="pk__pot-label">Pot</span>
            <strong>{fmt(state.pot)}</strong>
            {state.pot > 0 ? (
              <span className="pk__pot-chips">
                {/*
                  * Shorter stacks than anywhere else, so the pot reads as a
                  * heap rather than as one tall column. It is the biggest pile
                  * on the table and the only one nobody owns — a spread of
                  * stacks is what that looks like, and what a dealer would
                  * actually have left in the middle.
                  */}
                <ChipStack
                  amount={state.pot}
                  width={19}
                  ladder={TABLE_CHIPS}
                  most={18}
                  tallest={3}
                />
              </span>
            ) : null}
          </p>
          <div className="pk__board">
            {state.board.map((one, at) => (
              <span
                key={`${one.rank}${one.suit}`}
                /* A wrapper that takes no room of its own — the card stays a
                   flex item of the board, and this is only somewhere to hang
                   the fact that it is one of your five. */
                className={pointing(using, one)}
              >
                <Card card={one} deal={at} />
              </span>
            ))}
            {/* The streets still to come, so the board keeps its width and
                nothing shuffles sideways when a card lands. */}
            {SLOTS.slice(state.board.length).map((slot) => (
              <span className="pk__gap" key={slot} />
            ))}
          </div>
          {/*
            * Who took it, said in the middle where the pot was.
            *
            * The seat says "won 1,240" too, but a seat is small and there are
            * ten of them; this is the one line somebody who looked away for a
            * moment can come back to and read.
            */}
          {state.street === "waiting" ? (
            <p className="pk__waiting">
              {state.seats.filter((seat) => seat.stack > 0).length < 2
                ? "Waiting for another player."
                : "Next hand shortly."}
            </p>
          ) : null}
        </div>

        {seats.map((seat, at) => (
          <Seat
            key={seat.id}
            seat={seat}
            at={at}
            of={seats.length}
            state={state}
            mine={seat.id === seatId}
            won={won.get(seat.id)?.chips ?? null}
            said={won.get(seat.id)?.said ?? null}
            /* Whose moment it is right now, which is not the same as who won:
               at a hand with side pots several seats won and they are announced
               one at a time. */
            spotlit={spotlit.has(seat.id)}
            /* What this player asked for, until the table answers. */
            pending={seat.id === seatId ? intent : null}
            /* Only your own hand is pointed at: it is the only one you know. */
            using={seat.id === seatId ? using : EMPTY}
          />
        ))}

        {/*
          * The street's stakes going into the middle.
          *
          * A betting round ends by sweeping every stake in, which is a thing
          * that happens rather than a state anything is left in — a moment
          * later every seat reads zero. So the table records what it swept and
          * the felt draws it going, from each seat's own place on the chip ring
          * to the pot, which is the way the chips actually travel.
          */}
        {state.sweptAt != null
          ? state.swept.map((one) => {
              const at = seats.findIndex((seat) => seat.id === one.seatId);
              if (at < 0) {
                return null;
              }
              return (
                <span
                  /* Marked the same way `.pk__bet` is: on a phone your own
                     seat is pinned to the bottom rather than spread with the
                     rest, and this stake has to gather from wherever that is. */
                  className={`pk__gather${one.seatId === seatId ? " pk__gather--yours" : ""}`}
                  key={`${state.sweptAt}:${one.seatId}`}
                  style={seatAt(at, seats.length)}
                  aria-hidden="true"
                >
                  <ChipStack
                    amount={one.chips}
                    width={16}
                    ladder={TABLE_CHIPS}
                    most={12}
                    tallest={4}
                  />
                </span>
              );
            })
          : null}

        {/*
          * The pot going where it went.
          *
          * One heap per winner, starting in the middle and travelling out to
          * their seat — the same `--seat`/`--of` the seat itself is placed
          * with, so it lands on them rather than near them. Split pots send
          * one to each, which is the clearest way to say a pot was split.
          *
          * Keyed on the moment the hand paid, so it runs once per hand and is
          * allowed to finish: two identical hands in a row would otherwise be
          * one element that never moves.
          */}
        {state.paidAt != null
          ? showing.map((one) => {
              const at = seats.findIndex((seat) => seat.id === one.seatId);
              if (at < 0) {
                return null;
              }
              return (
                <span
                  /* Same reason `.pk__gather` is marked: the winner's own
                     seat is pinned rather than spread on a phone, and the pot
                     has to arrive where that seat actually is. */
                  className={`pk__sweep${one.seatId === seatId ? " pk__sweep--yours" : ""}`}
                  key={`${state.paidAt}:${one.pot}:${one.seatId}`}
                  style={seatAt(at, seats.length)}
                  aria-hidden="true"
                >
                  <ChipStack
                    amount={one.chips}
                    width={19}
                    ladder={TABLE_CHIPS}
                    most={18}
                    tallest={3}
                  />
                </span>
              );
            })
          : null}

        {seats.map((seat, at) => {
          const chips =
            seat.id === seatId && intent.committed !== null ? intent.committed : seat.committed;
          return chips > 0 ? (
            <span
              /*
               * Your own is marked, because it is the one that has to dodge
               * something: your cards are drawn several times the size of
               * anybody else's, and on a wide felt they grow into the space
               * this ring passes through.
               */
              className={`pk__bet${seat.id === seatId ? " pk__bet--yours" : ""}`}
              /*
               * Keyed on the amount as well as the seat, so a stake that grows
               * is a new element that slides out again rather than a number
               * quietly changing in place. Putting chips in is the commonest
               * thing that happens at a table; it should look like something.
               */
              key={`bet-${seat.id}:${chips}`}
              style={{ ...seatAt(at, seats.length), ...dodge(at, seats.length) }}
            >
              {/*
                * Chips and the figure, not one or the other. The pile is what
                * is read across a table — two chips against nine says who is
                * in for what before either number has been — and the figure is
                * what settles it once you care about the exact amount.
                */}
              <ChipStack amount={chips} width={16} ladder={TABLE_CHIPS} most={12} tallest={4} />
              <span className="pk__bet-figure">{fmt(chips)}</span>
            </span>
          ) : null;
        })}

        {/* Over the felt alone, not the whole page — same reason blackjack's
            equivalent sheet lives inside its own felt rather than beside it. */}
        <Sheet
          id={RULES_SHEET_ID}
          label="What beats what"
          open={rulesOpen}
          onClose={() => onCloseRules?.()}
          className="sheet--felt"
        >
          <Rankings />
        </Sheet>
      </div>

      {/*
        * Everything under the felt, in its own grid area ("controls") — the
        * hand you are holding, the buttons, and the bots row all belong to the
        * one place a player's thumb actually reaches, and they stack inside it
        * exactly as they did before this was a grid: normal flow, so the
        * negative margin below still pulls the reading pill up over the row
        * above it.
        */}
      <div className="pk__below">
        {/*
          * What you are holding, said plainly and kept on screen for as long as
          * you hold it. Reading your own hand off five cards is the one thing
          * that stands between somebody new and the game, and it is a thing the
          * table already knows the answer to.
          */}
        {/*
          * Who took the pot, in the same place the hand you are holding is
          * announced — one headline slot under the table rather than two.
          *
          * Outside the felt on purpose. Every part of the cloth is spoken for at
          * a showdown: the board is what everybody is reading, the middle is
          * where the pot was, and below it is your own hand. A banner anywhere on
          * it covers something somebody is looking at, and this is the moment
          * they are looking hardest.
          */}
        {state.paid.length > 0 && state.paidAt != null ? (
          <p
              className="pk__won"
              /* Keyed on the pot as well as the hand, so each announcement is a
                 new element that lands rather than text swapping in place. */
              key={`${state.paidAt}:${moment}`}
              /*
               * A live region, which is both what this is and what lets it carry
               * a label: a plain paragraph has no role to be named, and a win is
               * exactly the kind of thing somebody not watching the felt should
               * be told about when it happens.
               */
              role="status"
              aria-live="polite"
              /*
               * Said once, as a sentence. The spans below are laid out with a
               * gap rather than separated by spaces, so read straight off the
               * markup this comes out as "Pocketswins 520kings and 3s".
               */
              aria-label={showing
                .map(
                  (one) =>
                    `${one.name} wins ${fmt(one.chips)}${one.said === null ? "" : ` with ${one.said}`}`,
                )
                .join(", and ")}
            >
              {showing.map((one, index) => (
                <span className="pk__won-one" key={one.seatId}>
                  {index > 0 ? <span className="pk__won-and">and</span> : null}
                  <strong>{one.name}</strong>
                  <span className="pk__won-chips">wins {fmt(one.chips)}</span>
                  {one.said === null ? null : <span className="pk__won-with">{one.said}</span>}
                </span>
              ))}
            </p>
        ) : state.you?.hand != null && me !== null && !me.folded ? (
          <p
            /* Keyed on what it says, so a hand that becomes a different hand is
               a different element — which is what makes it land rather than
               quietly changing its own text. */
            key={state.you.hand.title + state.you.hand.said}
            className="pk__reading"
          >
            <strong>{state.you.hand.title}</strong>
            <span>{state.you.hand.said}</span>
          </p>
        ) : null}

        <Actions table={table} state={state} me={me} intent={intent} />
      </div>

      {/* The side column's own copy, standing rather than behind a key — a
          desk has the room for it, and the key that would open the same
          sheet is hidden there so there is only ever one way to reach it. */}
      <aside className="pk__rules" aria-label="What beats what">
        <h2 className="pk__panel-title">What beats what</h2>
        <Rankings />
      </aside>
    </div>
  );
}

/**
 * Which seat this is, and how many there are.
 *
 * Only that. The angle is the stylesheet's to work out, which is what lets a
 * container query change the arrangement — a phone opens the ring into a
 * horseshoe — without React having to measure anything or know it happened.
 */
export function seatAt(index: number, of: number): React.CSSProperties {
  return { "--seat": String(index), "--of": String(of) } as React.CSSProperties;
}

/**
 * How far a seat's chips step aside from the middle column.
 *
 * A seat straight above the middle puts its stake in the same column as the
 * pot, and there is no radius that fixes that — pushed out it lands on the
 * seat, pulled in it lands on the pot. So it steps sideways instead, which is
 * where the room actually is. Only the ones near the top: everybody else is
 * far enough round the ellipse to be clear already.
 *
 * Still worked out in JavaScript rather than carried over to `--seat`/`--of`
 * in CSS: this only ever reaches the cloth's oval arrangement (`.pk__bet` is
 * hidden outright on the phone's horseshoe), which this task leaves
 * unchanged, and the threshold this steers by has no equivalent without a
 * CSS conditional the platform does not have yet.
 */
export function dodge(index: number, of: number): React.CSSProperties {
  const angle = Math.PI / 2 + (index / of) * Math.PI * 2;
  const upright = Math.sin(angle) < -0.6 ? 1 - Math.abs(Math.cos(angle)) / 0.8 : 0;
  return { "--dodge": `${Math.max(0, upright) * 90}px` } as React.CSSProperties;
}
