import type { TableView } from "@backroom/game-blackjack";
import { LAST_CALL_MS, value, WINDOWS } from "@backroom/game-blackjack";
import { CODE_ALPHABET, CODE_LENGTH } from "@backroom/shared";
import { useCallback, useEffect } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Chip, ChipMark, MINTED } from "../chips/Chip.js";
import { ChipStack } from "../chips/ChipStack.js";
import { Avatar } from "../game/Avatar.js";
import { Digits } from "../game/Digits.js";
import { play } from "../game/audio.js";
import { compact } from "../game/money.js";
import { Chat } from "../game/Chat.js";
import type { Account } from "../game/useAccount.js";
import { useAccount } from "../game/useAccount.js";
import { TurnRing } from "../game/TurnRing.js";
import { useCountdown } from "../game/useCountdown.js";
import { Navbar } from "../nav/Navbar.js";
import { Taken } from "../net/Taken.js";
import { TableSetup } from "../table/TableSetup.js";
import { TauntPicker } from "../taunt/TauntPicker.js";
import { TauntStage } from "../taunt/TauntStage.js";
import type { TableSocketHook } from "../table/useTableSocket.js";
import { useTablePeek } from "../table/useTablePeek.js";
import { useTableSocket } from "../table/useTableSocket.js";
import { Hand } from "./Cards.js";
import {
  ClockIcon,
  DealIcon,
  DiscordIcon,
  DoubleIcon,
  HitIcon,
  SplitIcon,
  StandIcon,
  UndoIcon,
} from "./Icons.js";
import { useCardSound } from "./useCardSound.js";
import type { Move } from "./useIntent.js";
import { useBumped, useIntent } from "./useIntent.js";
import "@backroom/game-blackjack/theme.css";
import "./blackjack.css";

type Table = TableSocketHook<TableView>;

const fmt = (n: number) => n.toLocaleString("en-US");
/*
 * Denominations you can stack, not amounts you can pick from — smallest first,
 * because the tray reads left to right.
 *
 * Taken from MINTED rather than listed again here. It was listed again here,
 * and a second list of what a player may bet with is a second thing to keep in
 * step with the chips that actually exist.
 */
const CHIPS = [...MINTED].reverse();

export function Blackjack() {
  const navigate = useNavigate();
  const params = useParams();
  const account = useAccount();
  const raw = (params["code"] ?? "").toUpperCase();
  const looksLikeCode =
    raw.length === CODE_LENGTH && [...raw].every((letter) => CODE_ALPHABET.includes(letter));
  const urlCode = looksLikeCode ? raw : "";

  const back = useCallback(() => navigate("/blackjack"), [navigate]);
  // The balance in the corner follows the hand: the stake goes as the chips
  // are pushed out and the payout lands on the table's own clock, neither of
  // which the browser asked for.
  const table = useTableSocket<TableView>("blackjack", back, account.setChips);
  const { state, seatId } = table;
  useCardSound(state, seatId);

  /*
   * Which room you are standing in, on the document rather than this element:
   * the page's background lives on body, so a game repainting only its own
   * subtree would sit in the building's colours with a green rectangle in it.
   */
  useEffect(() => {
    document.documentElement.dataset["game"] = "blackjack";
    return () => {
      delete document.documentElement.dataset["game"];
    };
  }, []);

  // The address bar follows the table, so the link can be shared and a refresh
  // lands back at the same one.
  useEffect(() => {
    if (state !== null && state.code !== urlCode) {
      navigate(`/blackjack/${state.code}`, { replace: true });
    }
  }, [state, urlCode, navigate]);

  if (raw.length > 0 && !looksLikeCode) {
    return <p className="not-found">No table with that code.</p>;
  }

  return (
    <main className="play">
      <Navbar
        game="Blackjack"
        {...(state !== null
          ? {
              table: {
                code: state.code,
                onLeave: table.leave,
                confirm: state.phase === "playing",
              },
            }
          : {})}
        account={account}
        connected={table.connected}
      />

      {table.error !== null ? <p className="play__error">{table.error}</p> : null}
      {state?.lastEvent != null ? <p className="play__event">{state.lastEvent}</p> : null}

      {table.taken !== null ? (
        <Taken message={table.taken} onRetry={table.retry} />
      ) : state === null ? (
        <Sit table={table} invited={urlCode} account={account} />
      ) : (
        <>
          <Felt table={table} state={state} seatId={seatId} chips={account.profile?.chips ?? null} />
          <div className="play__talk">
            <Chat log={table.chat} seatId={seatId} onSay={table.say} />
            <TauntPicker
              seats={state.seats}
              seatId={seatId}
              chips={account.profile?.chips ?? null}
              stakes={table.stakes}
              onThrow={(emote, at) => {
                // The cost leaves the corner on the press: it is the player's
                // own number, so showing it at once invents nothing.
                if (account.profile !== null) {
                  account.setChips(account.profile.chips - emote.cost);
                }
                table.taunt(emote.id, at, (result) => {
                  if (result.ok) {
                    account.setChips(result.chips);
                  } else {
                    account.refresh();
                  }
                });
              }}
            />
          </div>
          {/* Over the felt, because a taunt belongs to the table and not to
              the cards. */}
          <TauntStage landed={table.landed} />
        </>
      )}
    </main>
  );
}

function Felt({
  table,
  state,
  seatId,
  chips,
}: {
  table: Table;
  state: TableView;
  seatId: string | null;
  /** What the player has to bet with, or null for a guest. */
  chips: number | null;
}) {
  const me = state.seats.find((seat) => seat.id === seatId) ?? null;
  /*
   * What this player has asked for, before the table has answered.
   *
   * A move is a round trip, and a round trip is long enough for a button to
   * feel broken. So a press changes the felt at once and the table's answer
   * replaces it — never inventing anything, only showing what was asked for.
   */
  const intent = useIntent(state, seatId, table.error);
  // The hand you are actually being asked about, which after a split is one of
  // two — every control below acts on this one and not on the seat.
  const myHand = me?.hands[me.active];
  const myTurn = state.turnSeatId === seatId && seatId !== null;
  const sent = intent.move !== null;
  /**
   * Sends a move, and shows it as sent.
   *
   * Both in one place so the two can never disagree — a move that reached the
   * table without the felt knowing would leave the buttons live for a second
   * hand on the same cards.
   */
  const move = (kind: Move) => {
    intent.send(kind);
    table.act({ type: kind });
  };
  const isHost = state.hostId === seatId && seatId !== null;

  return (
    <div className="bj">
      <section className="bj__dealer">
        <p className="bj__whose">Dealer</p>
        {/* Everything past the up card arrives when the dealer turns over,
            so it is turned rather than dealt. */}
        <Hand
          cards={state.dealer.cards}
          hidden={state.dealer.hidden}
          turnedFrom={state.dealer.hidden ? undefined : 1}
        />
        <span className="bj__total">
          {state.dealer.cards.length === 0
            ? "—"
            : state.dealer.hidden
              ? `showing ${state.dealer.total}`
              : state.dealer.total}
        </span>
      </section>

      <div className="bj__floor">
      <div className="bj__seats">
        {state.seats.map((seat) => (
          <article
            key={seat.id}
            className={`bj__seat${state.turnSeatId === seat.id ? " bj__seat--turn" : ""}${
              seat.waiting ? " bj__seat--waiting" : ""
            }${seat.connected ? "" : " bj__seat--gone"}${
              /* Only on the way in. A loss gets nothing, which is quieter to
                 sit through and truer to how a table treats one. */
              state.phase === "settled" && paidOut(seat) > seat.bet ? " bj__seat--paid" : ""
            }`}
          >
            <header className="bj__who">
              {/*
                * The same ring poker draws, round the same thing: how long this
                * seat has before the table plays the hand for them. It was a
                * clock the server kept and the player could not see, which is a
                * clock that stands them up without warning.
                */}
              <span className="bj__face">
                <Avatar
                  name={seat.name}
                  avatar={seat.avatar}
                  accentColor={seat.accentColor}
                  className="seat__avatar"
                />
                {state.turnSeatId === seat.id ? (
                  <TurnRing endsAt={state.turnEndsAt} turnMs={state.turnMs} />
                ) : null}
              </span>
              <span className="seat__name">
                {seat.name}
                {seat.id === seatId ? " (you)" : ""}
              </span>
              {seat.bet > 0 ? <span className="bj__bet">{fmt(seat.bet)}</span> : null}
              {/* Play money lives on the table and nowhere else, so the table
                  is the only place it can be shown. Real chips are in the bar
                  already and would only be a second, disagreeing copy. */}
              {state.forFun && seat.bet === 0 ? (
                <span className="bj__purse">{fmt(seat.purse)}</span>
              ) : null}
            </header>
            {/* One block per hand. Usually one; two after a split, and then
                the live one is marked, because "your turn" is no longer enough
                to say which cards you are being asked about. */}
            <div className={`bj__hands${seat.hands.length > 1 ? " bj__hands--split" : ""}`}>
              {seat.hands.map((hand, index) => (
                <div
                  // Position is the identity: hands are appended and never
                  // reordered, and two split hands can hold the same cards.
                  // biome-ignore lint/suspicious/noArrayIndexKey: hands are append-only
                  key={index}
                  className={`bj__hand${
                    seat.hands.length > 1 && state.turnSeatId === seat.id && seat.active === index
                      ? " bj__hand--live"
                      : ""
                  }`}
                >
                  <div className="bj__felt">
                    {/* What they have riding on it, as chips. A number says the
                        amount; a pile says the weight of it, which is what
                        anybody actually reads across a table. */}
                    {hand.bet > 0 ? <ChipStack amount={hand.bet} width={40} /> : null}
                    {/* A card asked for shows as one on its way, face down,
                        until the table says what it is. */}
                    <Hand
                      cards={hand.cards}
                      arriving={
                        seat.id === seatId &&
                        seat.active === index &&
                        (intent.move === "hit" || intent.move === "double")
                      }
                    />
                    {/* Beside the cards it counts, the way the dealer's sits
                        beside theirs — and large, because at a card table the
                        number is what you look at and everything else on the
                        row is what you look at afterwards. */}
                    <Count hand={hand} />
                  </div>
                  {/* Keyed on the outcome so the line arrives when the hand
                      does, rather than being there all along. */}
                  <footer
                    key={hand.outcome ?? "live"}
                    className={`bj__result${outcomeTone(hand.outcome)}`}
                  >
                    {handLine(seat, hand, state.phase)}
                    {seat.hands.length > 1 && hand.bet > 0 ? (
                      <span className="bj__stake-small">{fmt(hand.bet)}</span>
                    ) : null}
                  </footer>
                </div>
              ))}
            </div>
          </article>
        ))}
      </div>
      {/* Outside the seat grid, not in it.
          It used to be a grid child spanning every column, and an item that
          spans "1 / -1" makes the grid resolve all of its columns — which
          stopped auto-fit collapsing the empty ones, so a table with one
          player at it showed that player plus two seats nobody could see. */}
      {state.watching > 0 ? (
        <p className="bj__watchers">
          {state.watching === 1 ? "1 person watching" : `${state.watching} people watching`}
        </p>
      ) : null}
      </div>

      <aside className="bj__actions panel">
        {seatId === null ? (
          <>
            <p className="panel__label">Watching</p>
            <p className="panel__note">
              You are stood behind the table. Take a seat between hands to play.
            </p>
          </>
        ) : state.phase === "betting" ? (
          <Betting
            table={table}
            mine={intent.bet ?? me?.bet ?? 0}
            min={state.minBet}
            max={state.maxBet}
            isHost={isHost}
            seats={state.seats.length}
            listed={table.listed}
            deadline={state.deadline}
            windowMs={state.bettingMs}
            onStake={intent.place}
            forFun={state.forFun}
            chips={chips}
            me={me}
          />
        ) : state.phase === "settled" ? (
          <>
            <p className="panel__label">Hand over</p>
            <p className="panel__note">{settledLine(me)}</p>
            {/* Nobody has to start the next one, so the only useful thing to
                say here is how long you have got to read this one. */}
            <Countdown endsAt={state.deadline} verb="Next hand in" />
          </>
        ) : (
          <>
            <p className="panel__label">{myTurn ? "Your move" : "Waiting"}</p>
            {/* Hit and stand are the whole game and are always both there;
                double and split are answers to a particular hand, so they sit
                below as a pair and go quiet when the hand is not one. */}
            {/* Once a move has gone, the whole set goes quiet rather than
                each button separately: a second move on the same hand is not
                a thing to allow while the first is still in the air. */}
            <div className={`bj__moves${sent ? " bj__moves--sent" : ""}`}>
              <button
                type="button"
                className="btn btn--move"
                disabled={!myTurn || sent}
                onClick={() => move("hit")}
              >
                <HitIcon />
                <span>Hit</span>
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--move"
                disabled={!myTurn || sent}
                onClick={() => move("stand")}
              >
                <StandIcon />
                <span>Stand</span>
              </button>
            </div>
            <div className={`bj__moves${sent ? " bj__moves--sent" : ""}`}>
              <button
                type="button"
                className="btn btn--ghost btn--move"
                // First two cards only: that is the rule, and also the only
                // point at which doubling is a decision.
                disabled={!myTurn || sent || (myHand?.cards.length ?? 0) !== 2}
                onClick={() => move("double")}
              >
                <DoubleIcon />
                <span>Double</span>
                <em className="btn__cost">{fmt(myHand?.bet ?? 0)}</em>
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--move"
                disabled={!myTurn || sent || myHand === undefined || !splittable(myHand)}
                onClick={() => move("split")}
              >
                <SplitIcon />
                <span>Split</span>
                <em className="btn__cost">{fmt(myHand?.bet ?? 0)}</em>
              </button>
            </div>
          </>
        )}
      </aside>
    </div>
  );
}

/** What one hand's line says, which depends on how far it has got. */
function handLine(
  seat: TableView["seats"][number],
  hand: TableView["seats"][number]["hands"][number],
  phase: TableView["phase"],
): string | null {
  if (seat.waiting) {
    return "In on the next hand";
  }
  if (!seat.connected) {
    return "Dropped out";
  }
  if (hand.cards.length === 0) {
    if (phase !== "betting") {
      return "Sitting this one out";
    }
    return hand.bet > 0 ? "Ready" : "Yet to bet";
  }
  /*
   * What happened, not what it came to. The total is drawn beside the cards
   * now, so saying "bust on twenty-two" here would be the same number twice on
   * one row — and the one in the smaller, dimmer type at that.
   */
  switch (hand.outcome) {
    case "blackjack":
      return `Blackjack — ${fmt(hand.returned)}`;
    case "won":
      return `Won ${fmt(hand.returned - hand.bet)}`;
    case "push":
      return "Push";
    case "lost":
      return "Lost";
    case "bust":
      return "Bust";
    default:
      // Nothing to add while it is still being played: the count says it all.
      return null;
  }
}

/**
 * What colour the count is.
 *
 * Only two are worth colouring: gone past twenty-one, and dealt twenty-one.
 * Every other total is a number you are still deciding about, and colouring
 * those would be the table telling you what it thinks of your hand.
 */
/** Everything a seat got back, across however many hands it played. */
function paidOut(seat: TableView["seats"][number]): number {
  return seat.hands.reduce((total, hand) => total + hand.returned, 0);
}

function countTone(hand: TableView["seats"][number]["hands"][number]): string {
  if (hand.bust) {
    return " bj__count--bad";
  }
  return hand.outcome === "blackjack" ? " bj__count--chip" : "";
}

/** Whether a hand is two cards of the same value, and so may still be split. */
function splittable(hand: TableView["seats"][number]["hands"][number]): boolean {
  const [first, second] = hand.cards;
  if (hand.fromSplit || first === undefined || second === undefined || hand.cards.length !== 2) {
    return false;
  }
  // By value, not by rank: a king and a queen are a pair, which is the rule
  // the table plays by and so the rule the button has to agree with.
  return value([first]).total === value([second]).total;
}

function outcomeTone(
  outcome: TableView["seats"][number]["hands"][number]["outcome"],
): string {
  if (outcome === "won" || outcome === "blackjack") {
    return " bj__result--good";
  }
  if (outcome === "lost" || outcome === "bust") {
    return " bj__result--bad";
  }
  return "";
}

function settledLine(me: TableView["seats"][number] | null): string {
  if (me === null || me.bet === 0) {
    return "You sat that one out.";
  }
  // Across every hand. A split that wins one and loses the other is one deal
  // with one answer, and reporting the halves separately would be two.
  const back = me.hands.reduce((total, hand) => total + hand.returned, 0);
  const net = back - me.bet;
  if (net > 0) {
    return `You are up ${fmt(net)}.`;
  }
  if (net === 0) {
    return "Your stake came back.";
  }
  return `That one cost you ${fmt(-net)}.`;
}

/**
 * What a hand is worth, beside the cards it is worth it on.
 *
 * Its own component only because it has to notice when it changes: a total
 * that ticks when a card lands is the difference between a number that is
 * true and a number you watched become true.
 */
function Count({
  hand,
}: {
  hand: TableView["seats"][number]["hands"][number];
}) {
  const ticked = useBumped(hand.total);
  if (hand.cards.length === 0) {
    return null;
  }
  return (
    <p className={`bj__count${countTone(hand)}${ticked ? " bj__count--ticked" : ""}`}>
      <span className="bj__count-total">{hand.total}</span>
      {hand.soft && !hand.bust ? <span className="bj__count-soft">soft</span> : null}
    </p>
  );
}

/**
 * What the table is waiting on, in seconds.
 *
 * A table that runs itself has to say so, or it reads as a table that has
 * stopped: the difference between "nothing is happening" and "something is
 * about to" is the only thing this line carries, which is why it is here even
 * while it says one second.
 */
function Countdown({ endsAt, verb }: { endsAt: number | null; verb: string }) {
  const left = useCountdown(endsAt);
  if (left === null) {
    return null;
  }
  return (
    <p className="bj__clock">
      <ClockIcon />
      <span>
        {verb} {left}s
      </span>
    </p>
  );
}

/**
 * Stacking a stake.
 *
 * Chips add rather than replace, the way they do on a real felt, and the whole
 * stack comes back off in one go — a stake you cannot take back before the
 * cards are out would make a misclick cost a hand.
 */
function Betting({
  table,
  mine,
  min,
  max,
  isHost,
  seats,
  listed,
  deadline,
  windowMs,
  onStake,
  forFun,
  chips,
  me,
}: {
  table: Table;
  mine: number;
  min: number;
  max: number;
  isHost: boolean;
  seats: number;
  listed: boolean;
  deadline: number | null;
  windowMs: number;
  /** Tells the felt what was asked for, so it can show it before the reply. */
  onStake: (amount: number) => void;
  /** True at a table playing for nothing, which is the only kind bots sit at. */
  forFun: boolean;
  /** What the player has to bet with, or null for a guest. */
  chips: number | null;
  /** This player's own seat, for the things only it knows about itself. */
  me: TableView["seats"][number] | null;
}) {
  const stake = (amount: number) => {
    // Sounded and shown on the press rather than on the state coming back: the
    // whole point of a chip is that it lands under your finger. The number is
    // this player's own, so showing it early is not a guess.
    play("bet");
    onStake(amount);
    table.act({ type: "bet", amount });
  };
  // The pile jumps when it grows, so a chip you added is a chip you saw land.
  const dropped = useBumped(mine, 320);

  /*
   * The clock is read here rather than handed to Countdown, because the same
   * number has two jobs on this panel: it is what the line says, and it is
   * what the chips are locked by. Two clocks would eventually disagree by a
   * tick, and a chip that refuses itself a second before the line says so is
   * the table lying about its own rule.
   */
  const left = useCountdown(deadline);
  const lastCall = left !== null && left <= LAST_CALL_MS / 1000;

  return (
    <>
      <div className="panel__head">
        <p className="panel__label">Your bet</p>
        {/*
          * What there is to bet with, next to the thing being bet. Deciding
          * how much to put down is the one moment it actually matters, and
          * until now it was only in the navbar at the top of the page — the
          * far corner from where the chips are.
          *
          * Not at a for-fun table: the purse there was never anybody's, so
          * showing an account balance beside it would be answering a question
          * nobody asked with a number that has nothing to do with the game.
          */}
        {chips !== null && !forFun ? (
          <span className="bj__bank" title={`${fmt(chips)} chips`}>
            <ChipMark />
            <Digits value={compact(chips)} />
          </span>
        ) : null}
      </div>
      {left === null ? null : (
        <p className={`bj__clock${lastCall ? " bj__clock--last" : ""}`}>
          <ClockIcon />
          <span>
            {lastCall ? "Last call" : "Cards out in"} {left}s
          </span>
        </p>
      )}
      <div className="bj__chips" data-quiet>
        {CHIPS.map((amount) => (
          <button
            key={amount}
            type="button"
            className="bj__chip"
            disabled={lastCall || mine + amount > max}
            title={lastCall ? "Too late to add to a stake" : `Add ${fmt(amount)}`}
            onClick={() => stake(mine + amount)}
          >
            <Chip amount={amount} />
          </button>
        ))}
      </div>
      {/*
        * Done deciding.
        *
        * The window is a clock everybody waits out, and most of the time
        * everybody made their mind up long before it ran down. Saying so lets
        * the table get on with it — and it takes nobody else's time away,
        * because it only ends the window once every seat has said it.
        */}
      <button
        type="button"
        className={`bj__ready${mine > 0 && me?.ready === true ? " bj__ready--on" : ""}`}
        disabled={mine < min && mine > 0}
        onClick={() => table.act({ type: "ready", ready: me?.ready !== true })}
      >
        {me?.ready === true ? "Waiting for the others" : "Ready"}
      </button>

      {/* The pile you have built, beside the figure. The number is the exact
          answer; the stack is the one you can read without counting. */}
      <div
        className={`bj__stake${mine > 0 ? " bj__stake--on" : ""}${
          dropped && mine > 0 ? " bj__stake--dropped" : ""
        }`}
      >
        {mine > 0 ? (
          <>
            <ChipStack amount={mine} width={64} />
            <span className="bj__stake-total">{fmt(mine)}</span>
          </>
        ) : (
          <span>nothing yet — {fmt(min)} minimum</span>
        )}
      </div>
      <button
        type="button"
        className="btn btn--ghost btn--wide btn--icon"
        disabled={mine === 0}
        onClick={() => stake(0)}
      >
        <UndoIcon />
        <span>Take it back</span>
      </button>
      {isHost ? (
        <>
          {/* Not what starts a round — the clock does that. This is for a
              table that has finished betting and would rather not sit out the
              rest of the window. */}
          <button
            type="button"
            className="btn btn--wide btn--icon"
            onClick={() => table.act({ type: "deal" })}
          >
            <DealIcon />
            <span>Deal now</span>
          </button>
          {/* How long everybody gets to bet. Takes effect at the next
              round rather than this one: the deal is already scheduled
              against the clock that is running, and moving that out from
              under it deals a hand somebody had not finished betting on. */}
          <div className="bots">
            <span className="bots__label">Time to bet</span>
            <div className="bots__row">
              {WINDOWS.map((ms) => (
                <button
                  key={ms}
                  type="button"
                  role="radio"
                  aria-checked={windowMs === ms}
                  className={`btn btn--small${windowMs === ms ? "" : " btn--ghost"}`}
                  onClick={() => table.act({ type: "window", ms })}
                >
                  {ms / 1000}s
                </button>
              ))}
            </div>
            <p className="bots__hint">Takes effect on the next hand.</p>
          </div>
          {/* Public by default: a table nobody can find is one you have to
              arrange before you can play at it. The code still works either
              way — private only means it is not advertised. */}
          <div className="bots">
            <span className="bots__label">Who can find it</span>
            <div className="bots__row">
              {[true, false].map((option) => (
                <button
                  key={String(option)}
                  type="button"
                  role="radio"
                  aria-checked={listed === option}
                  className={`btn btn--small${listed === option ? "" : " btn--ghost"}`}
                  onClick={() => table.setListed(option)}
                >
                  {option ? "Public" : "Private"}
                </button>
              ))}
            </div>
          </div>
          {/* Bots only ever sit at a table playing for nothing: chips are
              only won from real people. The server refuses either way — this
              just stops offering something that would be turned down. */}
          {seats < 6 && forFun ? (
            <div className="bots">
              <span className="bots__label">Add a player</span>
              <div className="bots__row">
                {(["easy", "normal", "hard"] as const).map((skill) => (
                  <button
                    key={skill}
                    type="button"
                    className="btn btn--ghost btn--small"
                    onClick={() => table.addBot(skill)}
                  >
                    {skill}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </>
      ) : (
        <p className="panel__note">
          The table deals itself. Anything on the felt when the clock runs out
          is in the hand — and the last few seconds take nothing more, though
          you can still pull your chips off.
        </p>
      )}
    </>
  );
}

/**
 * A table you have to be somebody to sit at.
 *
 * Reached by following a link to a table that plays for chips without an
 * account. The link is not broken and this is not a refusal — it is the one
 * step between them and the seat, with the seat still named so they can see
 * they are in the right place.
 */
function SignInToJoin({ code, onWatch }: { code: string; onWatch: () => void }) {
  // Back to this table once Discord is done, rather than the front door: the
  // whole point of following a link is arriving where it pointed.
  const back = `/auth/discord?to=${encodeURIComponent(`/blackjack/${code}`)}`;

  return (
    <div className="join join--gate">
      <div className="panel gate">
        <p className="panel__label">Table {code}</p>
        <h2 className="gate__title">This one plays for chips</h2>
        <p className="gate__note">
          Chips come from an account, so there is one step before you sit down. Sign in and you
          will land back at this table.
        </p>
        <a className="btn btn--wide btn--icon gate__in" href={back}>
          <DiscordIcon />
          <span>Sign in with Discord</span>
        </a>
        <button type="button" className="btn btn--ghost btn--wide" onClick={onWatch}>
          Just watch this one
        </button>
        <p className="panel__note">
          Or <Link to="/blackjack">open a table of your own</Link> — a for-fun one deals play
          money and anybody can sit down.
        </p>
      </div>
    </div>
  );
}

function Sit({
  table,
  invited,
  account,
}: {
  table: Table;
  invited: string;
  account: Account;
}) {
  /*
   * What the link they followed actually leads to.
   *
   * Asked before they touch anything, because a table playing for chips needs
   * an account and the useful thing to say then is "sign in", not a form for
   * opening a table of your own.
   */
  const peek = useTablePeek(invited);
  const waiting = peek.table;
  if (waiting !== null && !waiting.forFun && account.profile === null && !account.loading) {
    return <SignInToJoin code={waiting.code} onWatch={() => table.watch(waiting.code)} />;
  }

  return (
    <TableSetup
      game="blackjack"
      pitch="Beat the dealer to twenty-one without going past it. Blackjack pays three to two, the dealer stands on seventeen."
      invited={invited}
      account={account}
      busy={table.busy}
      connected={table.connected}
      onJoin={table.join}
      onWatch={table.watch}
      playsFor={{
        fun: "Play money that lives at the table. Anybody can sit down.",
        guestWarning:
          "Playing for fun deals you five thousand chips that live at the table and nowhere else. Sign in to play for real ones.",
      }}
      note={() =>
        "You get a five-character code to share. Everybody plays the dealer rather than each other."
      }
      onCreate={(name, { forFun, maxSeats }) =>
        table.create(name, { game: "blackjack", forFun, maxSeats })
      }
    />
  );
}
