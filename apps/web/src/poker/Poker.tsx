import type { SeatView, TableView } from "@backroom/game-poker";
import { blindsFor, BUY_IN, STAKES } from "@backroom/game-poker";
import { CODE_ALPHABET, CODE_LENGTH } from "@backroom/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Card, FaceDown } from "../blackjack/Cards.js";
import { Avatar } from "../game/Avatar.js";
import { ChipStack } from "../chips/ChipStack.js";
import { Chat } from "../game/Chat.js";
import { compact } from "../game/money.js";
import type { Account } from "../game/useAccount.js";
import { useAccount } from "../game/useAccount.js";
import { TurnRing } from "../game/TurnRing.js";
import { useNav } from "../nav/NavContext.js";
import { Taken } from "../net/Taken.js";
import { TableSetup } from "../table/TableSetup.js";
import type { TableSocketHook } from "../table/useTableSocket.js";
import { useTableSocket } from "../table/useTableSocket.js";
import { Rankings } from "./Rankings.js";
import { useTableSound } from "./useTableSound.js";
import type { Move } from "./useIntent.js";
import { useIntent } from "./useIntent.js";
import "@backroom/game-blackjack/theme.css";
import "./poker.css";

/**
 * The felt, wired up.
 *
 * Built on the mockup in /style rather than beside it: the same stylesheet
 * draws both, so the table that was approved and the table that deals are the
 * same table. What is added here is everything the mockup could not have — a
 * seat that is somebody, a pot that is real chips, and a turn that runs out.
 */

type Table = TableSocketHook<TableView>;

const fmt = (n: number) => n.toLocaleString("en-US");

/** The five places a board card goes, in the order they are dealt. */
const SLOTS = ["flop1", "flop2", "flop3", "turn", "river"];

/**
 * How long each pot's announcement holds before the next one.
 *
 * Paired with the table's own showdown wait, which grows by the same step for
 * every side pot — if these two disagree the felt clears in the middle of a
 * sentence.
 */
const MOMENT_MS = 2_400;

/**
 * The pots of a finished hand, in the order they should be announced.
 *
 * Grouped rather than listed, because a side pot is a separate thing won by
 * separate people and saying them all at once gives the main pot's winner and
 * a short stack's consolation the same breath.
 */
function potsOf(paid: TableView["paid"]): TableView["paid"][] {
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
function useMoment(paidAt: number | null, count: number): number {
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
const EMPTY: Set<string> = new Set();

/** How a card is named when asking whether it is one of your five. */
const nameOf = (card: { rank: string; suit: string }) => `${card.rank}${card.suit}`;

/**
 * Whether to light this card, dim it, or leave it alone.
 *
 * The third case is the one worth naming. With nothing to point at — before
 * the flop, or once you have folded — every card would take the "not in your
 * hand" class and the whole table would go grey, which reads as the felt
 * having gone out rather than as nothing being highlighted.
 */
function pointing(using: Set<string>, card: { rank: string; suit: string }): string | undefined {
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
const TABLE_CHIPS = [1000, 500, 250, 100, 50, 20, 10];

export function Poker() {
  const navigate = useNavigate();
  const params = useParams();
  const account = useAccount();
  const raw = (params["code"] ?? "").toUpperCase();
  const looksLikeCode =
    raw.length === CODE_LENGTH && [...raw].every((letter) => CODE_ALPHABET.includes(letter));
  const urlCode = looksLikeCode ? raw : "";

  const back = useCallback(() => navigate("/poker"), [navigate]);
  /*
   * The balance in the corner follows the table. Chips leave it when you sit
   * down and come back when you stand up, and neither of those is something
   * the browser asked for at the moment it happens.
   */
  const table = useTableSocket<TableView>("poker", back, account.setChips);
  const { state, seatId } = table;
  useTableSound(state, seatId);

  useNav({
    room: "poker",
    game: "Poker",
    ...(state !== null
      ? {
          table: {
            code: state.code,
            onLeave: table.leave,
            /*
             * Asked twice mid-hand, because leaving one is folding: the
             * chips already in the pot stay there, and the press that
             * gives them up should not be one you can make by accident.
             */
            confirm: state.street !== "waiting",
          },
        }
      : {}),
    connected: table.connected,
  });

  useEffect(() => {
    if (state !== null && state.code !== urlCode) {
      navigate(`/poker/${state.code}`, { replace: true });
    }
  }, [state, urlCode, navigate]);

  if (raw.length > 0 && !looksLikeCode) {
    return <p className="not-found">No table with that code.</p>;
  }

  return (
    // Wider only at the felt: the screen before it is the building's width.
    <main className={state === null ? "play" : "play play--poker"}>
      {table.error !== null ? <p className="play__error">{table.error}</p> : null}
      {state?.lastEvent != null ? <p className="play__event">{state.lastEvent}</p> : null}

      {table.taken !== null ? (
        <Taken message={table.taken} onRetry={table.retry} />
      ) : state === null ? (
        <Sit table={table} invited={urlCode} account={account} />
      ) : (
        <>
          <Felt table={table} state={state} seatId={seatId} />
          <Chat log={table.chat} seatId={seatId} onSay={table.say} />
        </>
      )}
    </main>
  );
}

/* -------------------------------------------------------------- the felt */

export function Felt({
  table,
  state,
  seatId,
}: {
  table: Table;
  state: TableView;
  seatId: string | null;
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

  const [helping, setHelping] = useState(false);

  return (
    <div className="pk">
      <div className="pk__table">
        <div className="pk__felt" />

        {/* Above the felt rather than in the room's own bar: what beats what is
            a fact about this game, and the bar belongs to the building. */}
        <button
          type="button"
          className="pk__helpbtn"
          data-quiet
          aria-label="What beats what"
          title="What beats what"
          onClick={() => setHelping(true)}
        >
          ?
        </button>

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
                  className="pk__gather"
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
          * their seat — the same `--cos`/`--sin` the seat itself is placed
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
                  className="pk__sweep"
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
      </div>

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
      <Rankings open={helping} onClose={() => setHelping(false)} />
      {/*
        * Only at a table playing for nothing, and only for whoever opened it.
        * The server refuses it anywhere else whatever the browser shows —
        * hiding a control is a courtesy, refusing the message is the rule.
        */}
      {state.forFun && state.hostId === seatId ? (
        <div className="pk__bots">
          <span className="pk__bots-label">Deal somebody in</span>
          {(["easy", "normal", "hard"] as const).map((skill) => (
            <button
              key={skill}
              type="button"
              className="pk__bot"
              disabled={table.busy || state.seats.length >= 10}
              onClick={() => table.addBot(skill)}
            >
              {skill}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Where a seat sits, as a fraction of the felt.
 *
 * Counted from the bottom middle and going round, so seat one is always you.
 * Only which way round — how far is in the stylesheet, so a container query
 * can pull the ring in on a narrow felt without React having to measure
 * anything.
 */
function seatAt(index: number, of: number): React.CSSProperties {
  const angle = Math.PI / 2 + (index / of) * Math.PI * 2;
  return {
    "--cos": Math.cos(angle).toFixed(4),
    "--sin": Math.sin(angle).toFixed(4),
  } as React.CSSProperties;
}

/**
 * How far a seat's chips step aside from the middle column.
 *
 * A seat straight above the middle puts its stake in the same column as the
 * pot, and there is no radius that fixes that — pushed out it lands on the
 * seat, pulled in it lands on the pot. So it steps sideways instead, which is
 * where the room actually is. Only the ones near the top: everybody else is
 * far enough round the ellipse to be clear already.
 */
function dodge(index: number, of: number): React.CSSProperties {
  const angle = Math.PI / 2 + (index / of) * Math.PI * 2;
  const upright = Math.sin(angle) < -0.6 ? 1 - Math.abs(Math.cos(angle)) / 0.8 : 0;
  return { "--dodge": `${Math.max(0, upright) * 90}px` } as React.CSSProperties;
}

function Seat({
  seat,
  at,
  of,
  state,
  mine,
  won,
  said,
  pending,
  using,
  spotlit,
}: {
  seat: SeatView;
  at: number;
  of: number;
  state: TableView;
  mine: boolean;
  won: number | null;
  said: string | null;
  pending: { move: Move | null } | null;
  /** The cards in your own best hand, so yours can be pointed at. */
  using: Set<string>;
  /** Whether this seat is the one being announced at this moment. */
  spotlit: boolean;
}) {
  /*
   * A press shows here before the table has answered it, which is the whole of
   * the optimistic bargain: folding is this player's own decision, so the seat
   * can look folded the moment they say so.
   */
  const folded = seat.folded || pending?.move === "fold";
  const acting = state.toAct === seat.id && pending?.move == null;
  const look = won !== null ? "won" : folded ? "folded" : seat.allIn ? "allIn" : acting ? "acting" : "waiting";

  const mark =
    state.button === seat.id
      ? "D"
      : state.smallBlindId === seat.id
        ? "SB"
        : state.bigBlindId === seat.id
          ? "BB"
          : null;

  return (
    <div
      className={`pk__seat pk__seat--${look}${mine ? " pk__seat--you" : ""}${
        seat.connected ? "" : " pk__seat--away"
      }${spotlit ? " pk__seat--spotlit" : ""}`}
      style={seatAt(at, of)}
    >
      <div className="pk__cards">
        {seat.hole.length === 0 || folded ? null : (
          seat.hole.map((one, index) =>
            one === null ? (
              // Not ours to see. A face-down card is the truth, and stays the
              // truth right up until they turn it over.
              // biome-ignore lint/suspicious/noArrayIndexKey: a hole has two places, not two cards
              <FaceDown key={index} deal={index} />
            ) : (
              <span
                key={`${one.rank}${one.suit}`}
                className={pointing(using, one)}
              >
                <Card card={one} deal={index} />
              </span>
            ),
          )
        )}
      </div>
      <div className="pk__who">
        <div className="pk__wholine">
          {/* Who you are actually playing, which a name alone does not say at a
              table of ten. Their own colour rings it, the same one it is
              everywhere else in the building. */}
          <Avatar
            name={seat.name}
            avatar={seat.avatar}
            accentColor={seat.accentColor}
            className="pk__face"
          />
          {/*
            * The clock goes round the face, which is the round thing on a seat
            * and the one that means "who". Around the whole seat it was an
            * ellipse stretched over a column of cards, drawn straight across
            * the hand it was waiting on.
            */}
          {acting ? <TurnRing endsAt={state.turnEndsAt} turnMs={state.turnMs} /> : null}
          <span className="pk__name">
            {seat.name}
            {seat.isBot ? <span className="pk__bot-mark">bot</span> : null}
          </span>
        </div>
        <span className="pk__stack">
          {/*
            * What they have left, as weight rather than only as a figure. Off
            * on a narrow felt, where the seat has no room to spare and the
            * number says it on its own.
            */}
          {seat.stack > 0 ? (
            <span className="pk__pile">
              <ChipStack amount={seat.stack} width={11} ladder={TABLE_CHIPS} most={9} tallest={3} />
            </span>
          ) : null}
          {fmt(seat.stack)}
        </span>
        {seat.committed > 0 ? <span className="pk__wager">bet {fmt(seat.committed)}</span> : null}
      </div>
      {mark === null ? null : (
        <span className={`pk__mark pk__mark--${mark.toLowerCase()}`}>{mark}</span>
      )}
      {said !== null ? <span className="pk__says">{said}</span> : null}
      {/*
        * What they just did, over their head and gone again.
        *
        * Keyed on the moment rather than the words, so two checks in a row are
        * two bubbles rather than one that never moves — React replaces the
        * element and the animation runs again.
        */}
      {seat.spoke != null ? (
        <span className="pk__bubble" key={seat.spoke.at}>
          {seat.spoke.said}
        </span>
      ) : null}
      {said === null && won !== null ? (
        <span className="pk__says">won {fmt(won)}</span>
      ) : null}

    </div>
  );
}

/* ----------------------------------------------------------- the controls */

/**
 * What a pre-selected move means when the turn actually arrives.
 *
 * Armed while somebody else is deciding and spent the moment it is your go.
 * Every one of them can be made impossible by what happens in between — you
 * arm a check and somebody bets — and where that is so the arming is dropped
 * and the decision handed back, rather than turned into the nearest thing that
 * is still legal. Guessing at a move somebody did not make is how a player
 * loses a stack to a button they pressed a minute ago.
 */
export type Pre = "fold" | "checkFold" | "check" | "callAny" | "betPot";

const PRE_CHOICES: Array<{ pre: Pre; label: string; hint: string }> = [
  { pre: "fold", label: "Fold", hint: "Fold as soon as it is your turn" },
  { pre: "checkFold", label: "Check / Fold", hint: "Check if it is free, fold if it is not" },
  { pre: "check", label: "Check", hint: "Check — dropped if somebody bets" },
  { pre: "callAny", label: "Call any", hint: "Call whatever it has come to" },
  { pre: "betPot", label: "Bet pot", hint: "Bet or raise the size of the pot" },
];

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

export function Actions({
  table,
  state,
  me,
  intent,
}: {
  table: Table;
  state: TableView;
  me: SeatView | null;
  intent: ReturnType<typeof useIntent>;
}) {
  const you = state.you;
  const mine = me !== null && state.toAct === me.id;

  /*
   * What has been armed, and which betting round it was armed in.
   *
   * The round is carried along with it rather than cleared by an effect
   * watching the street. A pre-selection is about the decision in front of you,
   * and once the next card is out that is a different decision — so it lapses
   * by simply no longer matching, which needs nothing to remember to clear it.
   */
  const [armed, setArmed] = useState<{ pre: Pre; street: string } | null>(null);
  const live = armed !== null && armed.street === state.street ? armed.pre : null;

  const send = (kind: Move, to: number, action: Record<string, unknown>) => {
    intent.send(kind, to);
    table.act(action);
  };

  /*
   * Held in a ref because the effect below has to fire on the turn arriving and
   * on nothing else. Everything this reads changes on every broadcast, and an
   * effect that listed all of it would run constantly.
   */
  const spend = useRef<() => void>(() => undefined);
  spend.current = () => {
    if (me === null || you === null || live === null) {
      return;
    }
    const callAll = you.toCall >= me.stack;
    const potTo = clamp(
      me.committed + you.toCall + (state.pot + you.toCall),
      you.minRaiseTo,
      you.maxRaiseTo,
    );
    if (live === "fold") {
      send("fold", 0, { type: "fold" });
      return;
    }
    if (live === "checkFold") {
      if (you.toCall === 0) {
        send("check", me.committed, { type: "check" });
      } else {
        send("fold", 0, { type: "fold" });
      }
      return;
    }
    if (live === "check") {
      /*
       * Somebody bet after this was armed, so checking is not a move any more.
       * Handed back rather than turned into a call: a call is a different
       * decision and nobody made it.
       */
      if (you.toCall === 0) {
        send("check", me.committed, { type: "check" });
      }
      return;
    }
    if (live === "callAny") {
      if (you.toCall === 0) {
        send("check", me.committed, { type: "check" });
      } else {
        send("call", me.committed + you.toCall, { type: callAll ? "allIn" : "call" });
      }
      return;
    }
    if (you.canRaise) {
      send(
        potTo >= you.maxRaiseTo ? "allIn" : "raise",
        potTo,
        potTo >= you.maxRaiseTo ? { type: "allIn" } : { type: "raise", amount: potTo },
      );
    }
  };

  /* The turn arriving is the whole trigger, so it is the whole dependency. */
  const ready = mine && live !== null && you !== null;
  useEffect(() => {
    if (ready) {
      setArmed(null);
      spend.current();
    }
  }, [ready]);

  if (me === null) {
    return <p className="pk__note">You are watching this table.</p>;
  }

  /*
   * Nothing in front of you is the one thing to fix before anything else can
   * happen, so it is the only control offered.
   */
  if (me.stack === 0 && me.committed === 0 && !me.folded) {
    return (
      <div className="pk__controls">
        <div className="pk__acts">
          <button
            type="button"
            className="pk__act pk__act--go"
            disabled={table.busy}
            aria-label={`Sit down with ${compact(state.entry)}`}
            onClick={() => table.act({ type: "buyIn" })}
          >
            <span className="pk__act-name">Sit down with</span>
            <span className="pk__act-figure">{compact(state.entry)}</span>
          </button>
        </div>
        <p className="pk__note">
          {state.forFun
            ? "Play money. It lives at this table and is gone when it closes."
            : "Chips come off your balance and go in front of you. Stand up and whatever is still there comes back."}
        </p>
      </div>
    );
  }

  /*
   * A hand nobody could make you turn over.
   *
   * Offered before the waiting notes below, because for the few seconds it is
   * there it is the only thing on this screen worth pressing — and it is the
   * one decision in the game that is purely yours, with nothing riding on it
   * either way.
   */
  if (state.canShow) {
    return (
      <div className="pk__controls">
        <div className="pk__acts">
          <button
            type="button"
            className="pk__act"
            disabled={table.busy}
            onClick={() => table.act({ type: "show" })}
          >
            Show cards
          </button>
        </div>
        <p className="pk__note">
          Nobody can make you. Turn them over if the hand was worth seeing.
        </p>
      </div>
    );
  }

  if (!mine || you === null) {
    /*
     * Somebody else is deciding. A hand you are still in gets the choices you
     * could make in advance; one you are out of gets a line of text, because
     * arming a move for a hand you have folded is arming nothing.
     */
    const inHand = state.street !== "waiting" && !me.folded && me.hole.length > 0;
    if (!inHand) {
      return (
        <div className="pk__controls">
          {/*
            * Between hands your stack is simply yours, so here is the door.
            * Offered only when it is true — mid-hand the table refuses it, and
            * a button that is refused when pressed is worse than no button.
            */}
          {state.canTakeOff ? (
            <div className="pk__acts">
              <button
                type="button"
                className="pk__act"
                disabled={table.busy}
                aria-label={`Take ${fmt(me.stack)} off the table`}
                onClick={() => table.act({ type: "cashOut" })}
              >
                <span className="pk__act-name">Cash out</span>
                <span className="pk__act-figure">{fmt(me.stack)}</span>
              </button>
            </div>
          ) : null}
          <p className="pk__note">
            {state.street === "waiting" ? "Waiting for the next hand." : "Waiting for the others."}
            {state.canTakeOff && !state.forFun
              ? " Your chips go back to your balance, and the seat stays yours."
              : ""}
          </p>
        </div>
      );
    }
    return (
      <div className="pk__controls">
        <div className="pk__pre" role="group" aria-label="Decide in advance">
          {PRE_CHOICES.map(({ pre, label, hint }) => (
            <button
              key={pre}
              type="button"
              className={`pk__prebtn${live === pre ? " pk__prebtn--on" : ""}`}
              aria-pressed={live === pre}
              title={hint}
              onClick={() => setArmed(live === pre ? null : { pre, street: state.street })}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="pk__note">
          {live === null
            ? "Waiting for the others — or decide now, and it plays itself."
            : "Armed. It goes the moment the turn reaches you, and lapses at the next card."}
        </p>
      </div>
    );
  }

  return (
    <OnTurn
      /*
       * Keyed on the decision, so a new one arrives with the amount sitting at
       * the smallest legal raise. A `key` rather than an effect that resets it:
       * React already has one way to say "this is a different one of these",
       * and reaching for a second means two things deciding when it goes back.
       */
      key={`${state.street}:${state.toAct ?? "none"}`}
      you={you}
      me={me}
      pot={state.pot}
      blind={state.bigBlind}
      busy={table.busy}
      onAct={send}
    />
  );
}

/**
 * The controls for a decision that is actually in front of you.
 *
 * Three buttons and, when there is a raise to make, a way to say how much. The
 * amount sits above the buttons rather than beside them: it is what the raise
 * button is going to do, and a figure placed after the control that spends it
 * reads as a footnote to a decision already taken.
 */
function OnTurn({
  you,
  me,
  pot,
  blind,
  busy,
  onAct,
}: {
  you: NonNullable<TableView["you"]>;
  me: SeatView;
  pot: number;
  blind: number;
  busy: boolean;
  onAct: (kind: Move, to: number, action: Record<string, unknown>) => void;
}) {
  const [to, setTo] = useState(you.minRaiseTo);
  const at = clamp(to, you.minRaiseTo, you.maxRaiseTo);
  const all = at >= you.maxRaiseTo;
  const callAll = you.toCall >= me.stack;
  /* Opening the betting is a bet; putting it up over somebody else is a raise. */
  const opening = you.toCall === 0;

  /*
   * A slice of the pot, as a total to raise *to*.
   *
   * The pot a raise is measured against is the one that would exist after the
   * call — what is already in, plus what it costs you to stay. Measuring
   * against the pot as it stands is the usual way to get this wrong, and it
   * comes out short by exactly the call every time.
   */
  const sliceTo = (part: number) =>
    clamp(
      me.committed + you.toCall + Math.round(((pot + you.toCall) * part) / blind) * blind,
      you.minRaiseTo,
      you.maxRaiseTo,
    );

  const span = Math.max(1, you.maxRaiseTo - you.minRaiseTo);

  return (
    /*
     * Keyed on the decision by its caller, so arriving here is arriving at a
     * new turn — which is what makes the flash below run once rather than on
     * every broadcast while you sit thinking.
     */
    <div className="pk__controls pk__controls--yours">
      {you.canRaise ? (
        <div className="pk__amount">
          <div className="pk__dial">
            <button
              type="button"
              className="pk__step"
              aria-label="Less"
              disabled={at <= you.minRaiseTo}
              onClick={() => setTo(clamp(at - blind, you.minRaiseTo, you.maxRaiseTo))}
            >
              −
            </button>
            <span className="pk__figure">
              <span className="pk__figure-label">{opening ? "Bet" : "Raise to"}</span>
              <strong>{fmt(at)}</strong>
            </span>
            <button
              type="button"
              className="pk__step"
              aria-label="More"
              disabled={all}
              onClick={() => setTo(clamp(at + blind, you.minRaiseTo, you.maxRaiseTo))}
            >
              +
            </button>
          </div>

          <input
            type="range"
            className="pk__range"
            aria-label={opening ? "How much to bet" : "How much to raise to"}
            min={you.minRaiseTo}
            max={you.maxRaiseTo}
            step={blind}
            value={at}
            /* How far along the track is filled, which CSS cannot work out for
               itself — a range input has no selector for its own value. */
            style={{ "--at": `${((at - you.minRaiseTo) / span) * 100}%` } as React.CSSProperties}
            onChange={(event) => setTo(Number(event.target.value))}
          />

          <div className="pk__slices">
            <button type="button" className="pk__slice" onClick={() => setTo(you.minRaiseTo)}>
              Min
            </button>
            {(
              [
                [0.5, "½ pot"],
                [0.75, "¾ pot"],
                [1, "Pot"],
              ] as Array<[number, string]>
            ).map(([part, name]) => (
              <button
                key={name}
                type="button"
                className="pk__slice"
                onClick={() => setTo(sliceTo(part))}
              >
                {name}
              </button>
            ))}
            <button type="button" className="pk__slice" onClick={() => setTo(you.maxRaiseTo)}>
              All in
            </button>
          </div>
        </div>
      ) : null}

      <div className="pk__acts">
        <button
          type="button"
          className="pk__act pk__act--fold"
          disabled={busy}
          onClick={() => onAct("fold", 0, { type: "fold" })}
        >
          Fold
        </button>

        {opening ? (
          <button
            type="button"
            className="pk__act"
            disabled={busy}
            onClick={() => onAct("check", me.committed, { type: "check" })}
          >
            Check
          </button>
        ) : (
          <button
            type="button"
            className="pk__act"
            disabled={busy}
            aria-label={
              callAll ? `All in ${fmt(me.stack)}` : `Call ${fmt(you.toCall)}`
            }
            onClick={() =>
              onAct("call", me.committed + you.toCall, { type: callAll ? "allIn" : "call" })
            }
          >
            <span className="pk__act-name">{callAll ? "All in" : "Call"}</span>
            <span className="pk__act-figure">{fmt(callAll ? me.stack : you.toCall)}</span>
          </button>
        )}

        {you.canRaise ? (
          <button
            type="button"
            className="pk__act"
            disabled={busy}
            aria-label={`${all ? "All in" : opening ? "Bet" : "Raise to"} ${fmt(
              all ? me.committed + me.stack : at,
            )}`}
            onClick={() =>
              onAct(
                all ? "allIn" : "raise",
                at,
                all ? { type: "allIn" } : { type: "raise", amount: at },
              )
            }
          >
            <span className="pk__act-name">{all ? "All in" : opening ? "Bet" : "Raise to"}</span>
            <span className="pk__act-figure">{fmt(all ? me.committed + me.stack : at)}</span>
          </button>
        ) : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- the lobby */

function Sit({
  table,
  invited,
  account,
}: {
  table: Table;
  invited: string;
  account: Account;
}) {
  const [entry, setEntry] = useState<number>(BUY_IN);
  const blinds = blindsFor(entry);

  return (
    <TableSetup
      game="poker"
      pitch="Texas hold'em. Everybody plays each other, so nothing is won here that somebody at the table did not put in."
      invited={invited}
      account={account}
      busy={table.busy}
      connected={table.connected}
      onJoin={table.join}
      onWatch={table.watch}
      playsFor={{ fun: "Play money, and you can deal bots in. Anybody can sit down." }}
      options={
        /*
         * What it costs to sit down, which is the same act as choosing the
         * stakes: every level is a hundred big blinds, so one number sets the
         * price of entry and what the table plays for, and the two cannot end
         * up disagreeing.
         */
        <div className="stakes" role="radiogroup" aria-label="What it costs to sit down">
          <span className="stakes__label">Entry</span>
          <div className="stakes__row">
            {STAKES.map((level) => {
              const at = blindsFor(level);
              return (
                <button
                  key={level}
                  type="button"
                  role="radio"
                  aria-checked={entry === level}
                  aria-label={`${compact(level)}, blinds ${at.small} and ${at.big}`}
                  className={`stakes__pick${entry === level ? " stakes__pick--on" : ""}`}
                  onClick={() => setEntry(level)}
                >
                  <span className="stakes__cost">{compact(level)}</span>
                  <span className="stakes__blinds">
                    {at.small}/{at.big}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      }
      note={({ forFun }) => (
        <>
          You get a five-character code to share. Sitting down costs {compact(entry)}
          {forFun ? " in play money, and blinds are " : ", blinds are "}
          {fmt(blinds.small)} and {fmt(blinds.big)}
          {forFun ? "." : ". What is still in front of you comes back when you stand up."}
        </>
      )}
      onCreate={(name, { forFun, maxSeats }) =>
        table.create(name, { game: "poker", forFun, maxSeats, buyIn: entry })
      }
    />
  );
}

export default Poker;
