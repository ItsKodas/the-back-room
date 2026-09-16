import type { TableView } from "@backroom/game-blackjack";
import { Fragment } from "react";
import { ChipStack } from "../chips/ChipStack.js";
import { Avatar } from "../game/Avatar.js";
import { TurnRing } from "../game/TurnRing.js";
import { Hand } from "./Cards.js";
import type { HandView, SeatView, Tag } from "./hands.js";
import { fmt, handTag, paidOut, seatTag } from "./hands.js";
import { useBumped } from "./useIntent.js";

/** The house, on its own patch at the head of the table. */
export function Dealer({ dealer, watching }: { dealer: TableView["dealer"]; watching: number }) {
  return (
    <div className="bj__dealer">
      <p className="bj__dealer-who">
        Dealer
        {dealer.cards.length > 0 ? <b>{dealer.total}</b> : null}
        {watching > 0 ? (
          <span className="bj__watchers">{watching === 1 ? "1 watching" : `${watching} watching`}</span>
        ) : null}
      </p>
      {/* Everything past the up card arrives when the dealer turns over, so it
          is turned rather than dealt. */}
      {dealer.cards.length === 0 ? (
        <Empty />
      ) : (
        <Hand cards={dealer.cards} hidden={dealer.hidden} turnedFrom={dealer.hidden ? undefined : 1} />
      )}
    </div>
  );
}

/** Where two cards will go, so a hand between deals keeps its height and nothing jumps. */
function Empty() {
  return (
    <span className="bj-hand" aria-hidden="true">
      <span className="bj__slot" />
      <span className="bj__slot" />
    </span>
  );
}

/**
 * Everybody at the table, yours first.
 *
 * Yours is the hand being read, so it gets the big cards; everybody else is a
 * compact plate. The felt scrolls when there are more than fit, never the page.
 */
export function Seats({
  state,
  seatId,
  stake,
  arriving,
}: {
  state: TableView;
  seatId: string | null;
  /** Your stake as shown: your own last press until the table agrees. */
  stake: number;
  /** A card you asked for is in the air. */
  arriving: boolean;
}) {
  const mine = state.seats.find((seat) => seat.id === seatId) ?? null;
  const others = state.seats.filter((seat) => seat.id !== seatId);
  return (
    <div className="bj__seats">
      {mine !== null ? <Plate state={state} seat={mine} mine stake={stake} arriving={arriving} /> : null}
      {others.length > 0 ? (
        <div className="bj__others">
          {others.map((seat) => (
            <Plate key={seat.id} state={state} seat={seat} mine={false} stake={seat.bet} arriving={false} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Plate({
  state,
  seat,
  mine,
  stake,
  arriving,
}: {
  state: TableView;
  seat: SeatView;
  mine: boolean;
  stake: number;
  arriving: boolean;
}) {
  const turn = state.turnSeatId === seat.id;
  const split = seat.hands.length > 1;
  const tag = seatTag(state, seat);
  // Only a stake is this player's to show early; every other figure is the table's.
  const bet = mine && state.phase === "betting" ? stake : seat.bet;
  const hand = seat.hands[0];
  const className = [
    "bj__seat",
    mine ? "bj__seat--mine" : "bj__seat--other",
    turn ? "bj__seat--turn" : "",
    seat.waiting || !seat.connected ? "bj__seat--out" : "",
    mine && split ? "bj__seat--split" : "",
    mine && seat.hands.length > 2 ? "bj__seat--four" : "",
    // Only on the way in. A loss gets nothing, which is quieter to sit through and truer.
    state.phase === "settled" && paidOut(seat) > seat.bet ? "bj__seat--paid" : "",
  ]
    .filter((name) => name !== "")
    .join(" ");

  return (
    <article className={className} aria-label={mine ? `${seat.name} (you)` : seat.name}>
      <header className="bj__seat-head">
        {/* The ring poker draws, round the same thing: how long this seat has
            before the table plays the hand for them. */}
        <span className="bj__face">
          <Avatar name={seat.name} avatar={seat.avatar} accentColor={seat.accentColor} />
          {turn ? <TurnRing endsAt={state.turnEndsAt} turnMs={state.turnMs} /> : null}
        </span>
        <span className="bj__name">
          {seat.name}
          {mine ? " (you)" : ""}
        </span>
        {mine && tag !== null ? <TagMark tag={tag} /> : null}
        {bet > 0 ? (
          <span className="bj__bet">{fmt(bet)}</span>
        ) : state.forFun ? (
          // Play money lives at the table, so the table is the only place to show it.
          <span className="bj__purse">{fmt(seat.purse)}</span>
        ) : null}
      </header>
      {split ? (
        mine ? (
          <Boxes state={state} seat={seat} arriving={arriving} />
        ) : (
          <Minis state={state} seat={seat} />
        )
      ) : hand !== undefined ? (
        <div className="bj__play">
          {mine && bet > 0 ? <Pile amount={bet} /> : null}
          <HandOrEmpty hand={hand} arriving={mine && turn && arriving} />
          {!mine && tag !== null ? <TagMark tag={tag} /> : null}
          <Count hand={hand} />
        </div>
      ) : null}
    </article>
  );
}

/**
 * Your split: one plate, a box per hand.
 *
 * The box the controls act on is lit; the other steps back while it waits,
 * because "your turn" no longer says which cards you are being asked about.
 */
function Boxes({ state, seat, arriving }: { state: TableView; seat: SeatView; arriving: boolean }) {
  const turn = state.turnSeatId === seat.id;
  const four = seat.hands.length > 2;
  return (
    <div className="bj__boxes">
      {seat.hands.map((hand, index) => {
        const live = turn && seat.active === index;
        const tag = handTag(hand);
        return (
          <div
            // Position is the identity: a seat's hands never reorder, and two can hold the same cards.
            // biome-ignore lint/suspicious/noArrayIndexKey: hands are append-only
            key={index}
            className={`bj__box${live ? " bj__box--live" : turn ? " bj__box--wait" : ""}`}
          >
            <span className="bj__box-top">
              {four ? `H${index + 1}` : `Hand ${index + 1}`}
              <b>{fmt(hand.bet)}</b>
            </span>
            <span className="bj__box-play">
              <HandOrEmpty hand={hand} arriving={live && arriving} />
              <Count hand={hand} />
            </span>
            {tag !== null ? <TagMark tag={tag} /> : null}
          </div>
        );
      })}
    </div>
  );
}

/** Somebody else's split, on a compact plate: two little hands and a hairline between. */
function Minis({ state, seat }: { state: TableView; seat: SeatView }) {
  const turn = state.turnSeatId === seat.id;
  return (
    <div className="bj__minis">
      {seat.hands.map((hand, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: hands are append-only
        <Fragment key={index}>
          {index > 0 ? <i aria-hidden="true" /> : null}
          <span className={`bj__mini${turn && seat.active === index ? " bj__mini--live" : ""}`}>
            <Hand cards={hand.cards} />
            <Count hand={hand} />
          </span>
        </Fragment>
      ))}
    </div>
  );
}

function HandOrEmpty({ hand, arriving }: { hand: HandView; arriving: boolean }) {
  if (hand.cards.length === 0 && !arriving) {
    return <Empty />;
  }
  return <Hand cards={hand.cards} arriving={arriving} />;
}

/** The stake as chips, jumping when it grows, so a chip added is a chip seen landing. */
function Pile({ amount }: { amount: number }) {
  const dropped = useBumped(amount, 320);
  return (
    <span className={`bj__pile${dropped ? " bj__pile--dropped" : ""}`}>
      <ChipStack amount={amount} width={30} />
    </span>
  );
}

const TONE: Record<Tag["tone"], string> = {
  quiet: "tag",
  live: "tag tag--live",
  good: "tag bj__tag--good",
  bad: "tag bj__tag--bad",
  chips: "tag tag--chips",
};

function TagMark({ tag }: { tag: Tag }) {
  // Keyed on the words, so a new state arrives rather than being there all along.
  return (
    <span key={tag.text} className={`${TONE[tag.tone]} bj__tag`}>
      {tag.text}
    </span>
  );
}

/**
 * What a hand is worth, beside the cards it is worth it on.
 *
 * Its own component only because it has to notice when it changes: a total
 * that ticks when a card lands is a number you watched become true.
 */
function Count({ hand }: { hand: HandView }) {
  const ticked = useBumped(hand.total);
  if (hand.cards.length === 0) {
    return null;
  }
  // Only two totals are coloured: gone past twenty-one, and paid as a blackjack.
  const tone = hand.bust ? " bj__count--bad" : hand.outcome === "blackjack" ? " bj__count--chip" : "";
  return (
    <p className={`bj__count${tone}${ticked ? " bj__count--ticked" : ""}`}>
      <span className="bj__count-total">{hand.total}</span>
      {hand.soft && !hand.bust ? <span className="bj__count-soft">soft</span> : null}
    </p>
  );
}
