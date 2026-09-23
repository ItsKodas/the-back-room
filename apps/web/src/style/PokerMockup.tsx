import { useState } from "react";
/*
 * The deck's own card, so the mockup shows the cards the building actually
 * deals rather than a drawing of some. Poker's own deck is a different list —
 * two low, ace high, no soft ace — but a card is a rank and a suit either way,
 * and this is what the felt will be built on.
 */
import { Card, FaceDown } from "../cards/Cards.js";
import type { Card as CardData } from "../cards/deck.js";
import { ChipStack } from "../chips/ChipStack.js";
// The felt's own stylesheet, which the real table shares: see poker.css.
import "../poker/poker.css";

/**
 * A poker table, before there is one.
 *
 * A mockup and nothing else: no server, no rules, no chips that exist. It is
 * here to answer the questions the engine cannot, and which are much harder to
 * change once a felt is built on top of them — where ten seats go, what a seat
 * looks like when it has folded, and whether any of it survives a phone.
 *
 * Ten is the case to design for and the one a six-handed sketch would flatter.
 * The seats go round an ellipse rather than a circle because a table is wider
 * than it is tall, and the player's own seat is pinned to the bottom middle:
 * every other seat is somebody you are looking at, and yours is the one you
 * are looking from.
 */

/** How the deck writes a card; the mockup deals a few by hand. */
const card = (text: string): CardData => {
  const suits = { s: "spades", h: "hearts", d: "diamonds", c: "clubs" } as const;
  return {
    rank: text.slice(0, -1) as CardData["rank"],
    suit: suits[text.slice(-1) as keyof typeof suits],
  };
};

type SeatState = "waiting" | "acting" | "folded" | "allIn" | "won";

interface MockSeat {
  name: string;
  stack: number;
  bet: number;
  state: SeatState;
  /**
   * The button, or a blind this seat is posting.
   *
   * Worth drawing even in a mockup: the button is what tells a player whose
   * turn comes first and how the next hand will shift, and a felt without one
   * is a felt where the order of play is a mystery.
   */
  mark?: "D" | "SB" | "BB";
  /** Shown face up only at a showdown, or when it is your own seat. */
  hole?: [CardData, CardData];
  /** The seat the player is sitting in, which is drawn larger than the rest. */
  you?: boolean;
  says?: string;
}

/**
 * Which seat this is, and how many there are — the mockup's own copy of
 * `seatAt` from `Felt.tsx`, kept in step because it shares `poker.css` with
 * the real table (see the import above) and the stylesheet now expects this
 * shape rather than a `--cos`/`--sin` pair.
 *
 * Only which seat, and how many. The angle — and with it, the arrangement —
 * is the stylesheet's to work out: seat one is always you, and CSS is what
 * decides whether "the rest fill round the table" means an oval or a
 * horseshoe opened at the bottom.
 */
function seatAt(index: number, of: number): React.CSSProperties {
  return { "--seat": String(index), "--of": String(of) } as React.CSSProperties;
}

/** The felt at a given size, in a given moment of a hand. */
function Table({
  seats,
  board,
  pot,
  side,
}: {
  seats: MockSeat[];
  board: CardData[];
  pot: number;
  side?: number;
}) {
  return (
    <div className="pk">
      {/*
       * The rail and the felt are two elements because they are two materials.
       * Seats sit against the rail rather than inside the felt: at a real
       * table the players are the other side of the wood, and a seat drawn on
       * the cloth reads as something lying on the table rather than somebody
       * sitting at it.
       */}
      <div className="pk__table">
        <div className="pk__felt" />

        <div className="pk__middle">
          <p className="pk__pot">
            <span className="pk__pot-label">Pot</span>
            <strong>{pot.toLocaleString("en-US")}</strong>
            <span className="pk__pot-chips">
              <ChipStack amount={pot} width={19} ladder={TABLE_CHIPS} most={15} tallest={5} />
            </span>
            {side === undefined ? null : (
              <span className="pk__side">side {side.toLocaleString("en-US")}</span>
            )}
          </p>
          <div className="pk__board">
            {board.map((one, at) => (
              <Card key={`${one.rank}${one.suit}`} card={one} deal={at} />
            ))}
            {/* The street that has not come yet, so the board keeps its width
                and nothing shuffles sideways when a card lands. */}
            {/*
              * Named by the street the card would come on rather than by
              * index. A board fills from the left, so the gaps that remain are
              * always the last ones — sliced from where the board got to, so
              * each gap keeps its own name right up until a card lands on it.
              */}
            {SLOTS.slice(board.length).map((slot) => (
              <span className="pk__gap" key={slot} />
            ))}
          </div>
        </div>

        {seats.map((seat, at) => (
          <div
            className={`pk__seat pk__seat--${seat.state}${seat.you === true ? " pk__seat--you" : ""}`}
            key={seat.name}
            style={seatAt(at, seats.length)}
          >
            <div className="pk__cards">
              {seat.hole === undefined ? (
                <>
                  <FaceDown />
                  <FaceDown deal={1} />
                </>
              ) : (
                seat.hole.map((one, index) => (
                  <Card key={`${one.rank}${one.suit}`} card={one} deal={index} />
                ))
              )}
            </div>
            <div className="pk__who">
              <span className="pk__name">{seat.name}</span>
              <span className="pk__stack">
                {seat.stack > 0 ? (
                  <span className="pk__pile">
                    <ChipStack amount={seat.stack} width={11} ladder={TABLE_CHIPS} most={9} tallest={3} />
                  </span>
                ) : null}
                {seat.stack.toLocaleString("en-US")}
              </span>
              {/*
                * The same number as the chips on the ring, and only one of the
                * two is ever shown. On a wide table the chips sit out on the
                * cloth where they belong; on a phone there is no room for a
                * third ring between the seats and the board, so the amount
                * comes and sits in the seat instead.
                */}
              {seat.bet > 0 ? (
                <span className="pk__wager">bet {seat.bet.toLocaleString("en-US")}</span>
              ) : null}
            </div>
            {seat.mark === undefined ? null : (
              <span className={`pk__mark pk__mark--${seat.mark.toLowerCase()}`}>{seat.mark}</span>
            )}
            {seat.says === undefined ? null : <span className="pk__says">{seat.says}</span>}
          </div>
        ))}

        {/*
          * The chips, on their own ring inside the seats.
          *
          * Not part of a seat, because a seat is a thing on the edge of the
          * table and its chips are a thing in the middle of it. Hung off the
          * seat they had nowhere to go: pushed towards the pot from a seat
          * above the middle, towards the pot is downwards, and downwards is
          * where that player's own name already is.
          */}
        {seats.map((seat, at) =>
          seat.bet > 0 ? (
            <span
              className="pk__bet"
              key={`bet-${seat.name}`}
              data-owner={seat.name}
              style={seatAt(at, seats.length)}
            >
              <ChipStack amount={seat.bet} width={16} ladder={TABLE_CHIPS} most={12} tallest={4} />
              <span className="pk__bet-figure">{seat.bet.toLocaleString("en-US")}</span>
            </span>
          ) : null,
        )}
      </div>
    </div>
  );
}

/**
 * The controls, in both of the states they have.
 *
 * On your turn there is an amount to choose and three things to do with it;
 * while somebody else is deciding there are the moves you can leave ready. Both
 * are here because the second is easy to forget about and is on screen for most
 * of a hand — at a full table you are waiting nine times as often as acting.
 */
function Actions({ turn }: { turn: boolean }) {
  const [raise, setRaise] = useState(300);
  const [armed, setArmed] = useState<string | null>(null);
  const span = 2400 - 200;

  if (!turn) {
    return (
      <div className="pk__controls">
        <div className="pk__pre" role="group" aria-label="Decide in advance">
          {["Fold", "Check / Fold", "Check", "Call any", "Bet pot"].map((label) => (
            <button
              key={label}
              type="button"
              className={`pk__prebtn${armed === label ? " pk__prebtn--on" : ""}`}
              aria-pressed={armed === label}
              onClick={() => setArmed(armed === label ? null : label)}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="pk__note">
          {armed === null
            ? "Waiting for the others — or decide now, and it plays itself."
            : "Armed. It goes the moment the turn reaches you, and lapses at the next card."}
        </p>
      </div>
    );
  }

  return (
    <div className="pk__controls">
      <div className="pk__amount">
        <div className="pk__dial">
          <button
            type="button"
            className="pk__step"
            aria-label="Less"
            onClick={() => setRaise(Math.max(200, raise - 50))}
          >
            −
          </button>
          <span className="pk__figure">
            <span className="pk__figure-label">Raise to</span>
            <strong>{raise.toLocaleString("en-US")}</strong>
          </span>
          <button
            type="button"
            className="pk__step"
            aria-label="More"
            onClick={() => setRaise(Math.min(2400, raise + 50))}
          >
            +
          </button>
        </div>
        <input
          type="range"
          className="pk__range"
          aria-label="How much to raise to"
          min={200}
          max={2400}
          step={50}
          value={raise}
          style={{ "--at": `${((raise - 200) / span) * 100}%` } as React.CSSProperties}
          onChange={(event) => setRaise(Number(event.target.value))}
        />
        <div className="pk__slices">
          {(
            [
              ["Min", 200],
              ["½ pot", 750],
              ["¾ pot", 1100],
              ["Pot", 1450],
              ["All in", 2400],
            ] as Array<[string, number]>
          ).map(([name, amount]) => (
            <button key={name} type="button" className="pk__slice" onClick={() => setRaise(amount)}>
              {name}
            </button>
          ))}
        </div>
      </div>

      <div className="pk__acts">
        <button type="button" className="pk__act pk__act--fold">
          Fold
        </button>
        <button type="button" className="pk__act">
          <span className="pk__act-name">Call</span>
          <span className="pk__act-figure">100</span>
        </button>
        <button type="button" className="pk__act">
          <span className="pk__act-name">Raise to</span>
          <span className="pk__act-figure">{raise.toLocaleString("en-US")}</span>
        </button>
      </div>
    </div>
  );
}

const YOU: [CardData, CardData] = [card("As"), card("Kd")];

/** Ten seats, mid-hand, with somebody to act. */
const FULL: MockSeat[] = [
  { name: "You", stack: 4_250, bet: 100, state: "acting", hole: YOU, you: true },
  { name: "Bo", stack: 8_100, bet: 100, state: "waiting", mark: "D" },
  { name: "Cass", stack: 0, bet: 2_400, state: "allIn", says: "all in" },
  { name: "Dev", stack: 3_300, bet: 0, state: "folded", mark: "SB" },
  { name: "Eli", stack: 12_400, bet: 100, state: "waiting", mark: "BB" },
  { name: "Fern", stack: 900, bet: 0, state: "folded" },
  { name: "Gus", stack: 5_600, bet: 100, state: "waiting" },
  { name: "Hana", stack: 2_050, bet: 0, state: "folded" },
  { name: "Ira", stack: 7_700, bet: 100, state: "waiting" },
  { name: "Jo", stack: 1_400, bet: 0, state: "folded" },
];

const SIX: MockSeat[] = FULL.slice(0, 6);

const HEADS_UP: MockSeat[] = [
  { name: "You", stack: 6_000, bet: 400, state: "won", hole: YOU, says: "two pair", you: true },
  { name: "Bo", stack: 3_600, bet: 400, state: "waiting", hole: [card("Qh"), card("Qc")], mark: "D" },
];

const BOARD = [card("Ah"), card("Kc"), card("7d"), card("2s"), card("9h")];

/** The five places a board card goes, in the order they are dealt. */
const SLOTS = ["flop1", "flop2", "flop3", "turn", "river"];

/** What a poker table counts in, down to the small blind. */
const TABLE_CHIPS = [1000, 500, 250, 100, 50, 20, 10];

export function PokerMockup() {
  const [seats, setSeats] = useState(10);
  const [street, setStreet] = useState(3);

  const at = seats === 2 ? HEADS_UP : seats === 6 ? SIX : FULL;
  const board = BOARD.slice(0, street);

  return (
    <section className="gallery__section" data-game="poker">
      <h2 className="gallery__heading">The felt</h2>
      <p className="gallery__note">
        A table before there is one. Nothing here is wired to anything — no rules, no server, no
        chips that exist. It is here to settle the parts the engine cannot: where ten seats go,
        what a seat looks like once it has folded, and whether any of it survives a phone.
      </p>

      <div className="mock__row">
        <div className="picker" role="radiogroup" aria-label="How many at the table">
          <span className="picker__label">Seats</span>
          <div className="picker__row">
            {[2, 6, 10].map((count) => (
              <button
                key={count}
                type="button"
                role="radio"
                aria-checked={seats === count}
                className={`picker__pick${seats === count ? " picker__pick--on" : ""}`}
                onClick={() => setSeats(count)}
              >
                {count}
              </button>
            ))}
          </div>
        </div>

        <div className="picker" role="radiogroup" aria-label="Which street">
          <span className="picker__label">Board</span>
          <div className="picker__row">
            {[
              [0, "Preflop"],
              [3, "Flop"],
              [4, "Turn"],
              [5, "River"],
            ].map(([count, name]) => (
              <button
                key={name as string}
                type="button"
                role="radio"
                aria-checked={street === count}
                className={`picker__pick${street === count ? " picker__pick--on" : ""}`}
                onClick={() => setStreet(count as number)}
              >
                {name}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* The felt grows to fill whatever flex column it is placed in — see
          `.mock__felt` in gallery.css for why this page has to supply one. */}
      <div className="mock__felt">
        <Table seats={at} board={board} pot={2_900} {...(seats === 10 ? { side: 1_200 } : {})} />
      </div>
      <Actions turn />
      <p className="gallery__note">
        And what is on screen for most of a hand, which is somebody else's turn.
      </p>
      <Actions turn={false} />

      <p className="gallery__note">
        Your seat is pinned to the bottom, because every other seat is somebody you are looking at
        and yours is the one you are looking from. A folded seat keeps its chair and loses its
        cards — it has to still be there, or a table would appear to empty out every hand.
      </p>
    </section>
  );
}
