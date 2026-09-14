import type { TableView } from "@backroom/game-death-roll";
import { CEILINGS, lossOdds, STAKES } from "@backroom/game-death-roll";
import { CODE_ALPHABET, CODE_LENGTH } from "@backroom/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Avatar } from "../game/Avatar.js";
import { play, preload, unlock } from "../game/audio.js";
import { Chat } from "../game/Chat.js";
import type { Account } from "../game/useAccount.js";
import { useAccount } from "../game/useAccount.js";
import { Navbar } from "../nav/Navbar.js";
import { Taken } from "../net/Taken.js";
import { PublicTables } from "../table/PublicTables.js";
import type { TableSocketHook } from "../table/useTableSocket.js";
import { useTableSocket } from "../table/useTableSocket.js";
import { Falling } from "./Falling.js";
import type { Intent } from "./useIntent.js";
import { useIntent } from "./useIntent.js";
import "@backroom/game-death-roll/theme.css";
import "./deathroll.css";

/**
 * Death roll, wired up.
 *
 * A duel has no cloth to read and no layout to learn: the whole game is one
 * number and what it costs to hand the roll back rather than face it. So
 * unlike every felt in the building this page has nothing to draw beyond
 * that number, which is what makes it the smallest one here.
 */

type Table = TableSocketHook<TableView>;

const fmt = (n: number) => n.toLocaleString("en-US");

export function DeathRoll() {
  const navigate = useNavigate();
  const params = useParams();
  const account = useAccount();
  const raw = (params["code"] ?? "").toUpperCase();
  const looksLikeCode =
    raw.length === CODE_LENGTH && [...raw].every((letter) => CODE_ALPHABET.includes(letter));
  const urlCode = looksLikeCode ? raw : "";

  const back = useCallback(() => navigate("/death-roll"), [navigate]);
  const table = useTableSocket<TableView>("death-roll", back, account.setChips);
  const { state, seatId } = table;

  useEffect(() => {
    document.documentElement.dataset["game"] = "death-roll";
    return () => {
      delete document.documentElement.dataset["game"];
    };
  }, []);

  useEffect(() => {
    if (state !== null && state.code !== urlCode) {
      navigate(`/death-roll/${state.code}`, { replace: true });
    }
  }, [state, urlCode, navigate]);

  if (raw.length > 0 && !looksLikeCode) {
    return <p className="not-found">No table with that code.</p>;
  }

  return (
    <main className="play play--duel">
      <Navbar
        game="Death Roll"
        {...(state !== null
          ? {
              table: {
                code: state.code,
                onLeave: table.leave,
                // Asked while a duel is running, because the ante is already
                // in the pot and standing up gives it up. Not asked once it
                // has ended: nothing more is owed to a seat that leaves then.
                confirm: state.phase === "dueling",
              },
            }
          : {})}
        account={account}
        connected={table.connected}
      />

      {table.error !== null ? <p className="play__error">{table.error}</p> : null}

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
  const mine = state.you;
  const myTurn = state.phase === "dueling" && seatId !== null && state.toRoll === seatId;
  const intent = useIntent(state, seatId, table.act, table.error);
  useDuelSound(state, seatId);
  // A pass's chips only ever need to land once, right as they are pressed —
  // not for as long as the ask stays outstanding, which is what watching
  // `pending` itself would do.
  const justPaid = usePaidFlourish(intent.pending > 0);

  /*
   * What the big number ought to show. The ceiling everywhere but the one
   * moment a duel ends on a 1 — the table leaves the ceiling exactly where it
   * was for that roll rather than setting it to the number that killed it, so
   * showing it here instead is the only way the felt ever says "1" at all.
   */
  const shown =
    state.phase === "over" && state.lastRoll !== null ? state.lastRoll.result : state.ceiling;

  return (
    <section className="dr" data-game="death-roll">
      <Seats state={state} seatId={seatId} />
      <Bots table={table} state={state} />

      <div className="dr__stage">
        {/* Hidden from assistive tech only between duels: once one is running
            or has just ended, this number is the one fact worth announcing. */}
        <div aria-hidden={state.phase === "waiting"}>
          <Falling value={shown} rolling={intent.rolling} />
        </div>

        {state.phase === "dueling" ? (
          <p className="dr__odds">
            {(lossOdds(state.ceiling) * 100).toFixed(1)}% chance of losing this roll
          </p>
        ) : null}

        <Standing state={state} />

        {/*
          Not shown once a duel is over: the felt already says who takes it,
          and a second line repeating the same figure is a place for a stray
          number to disagree with the sentence beside it. `pending` is added in
          rather than waited for, so a pass lands on the pot the moment it is
          pressed.
        */}
        {state.phase === "dueling" && state.pot + intent.pending > 0 ? (
          <p className="dr__pot">
            <span
              className={`dr__pot-figure${state.forFun ? "" : " dr__pot-figure--chip"}${
                justPaid ? " dr__pot-figure--paid" : ""
              }`}
            >
              {fmt(state.pot + intent.pending)}
            </span>{" "}
            in the pot
          </p>
        ) : null}
      </div>

      {mine === null || !myTurn ? null : (
        <Controls state={state} intent={intent} passed={mine.passed} />
      )}

      <History rolls={state.history} seatName={(id) => nameOf(state, id)} />
    </section>
  );
}

/**
 * Turns a change in the duel into sound, the same way every other table's
 * follows a comparison rather than an event: an opponent's throw earns the
 * same rattle this seat's own got on the press, and a table that only ever
 * made a noise for you would be a table you were playing alone.
 */
function useDuelSound(state: TableView, seatId: string | null): void {
  const previous = useRef<TableView | null>(null);

  // Fetching needs nothing from the browser; playing does. So the files are
  // pulled straight away and the context waits for a touch.
  useEffect(() => {
    void preload();
  }, []);

  useEffect(() => {
    const wake = () => unlock();
    window.addEventListener("pointerdown", wake, { once: true });
    window.addEventListener("keydown", wake, { once: true });
    return () => {
      window.removeEventListener("pointerdown", wake);
      window.removeEventListener("keydown", wake);
    };
  }, []);

  useEffect(() => {
    const before = previous.current;
    previous.current = state;
    if (before === null) {
      return;
    }
    const rolled = state.lastRoll;
    if (rolled === null || rolled === before.lastRoll) {
      return;
    }
    // This seat's own throw was already sounded on the press; an opponent's
    // is heard from nothing at all, so it gets the throw as well as the land.
    if (rolled.seatId !== seatId) {
      play("shake");
    }
    // The closest sound in the building to a die coming up a 1: Greed's own
    // bust, short and low, which is exactly what this roll is for this seat.
    play(rolled.result === 1 ? "farkle" : "land");
  }, [state, seatId]);
}

/**
 * True for a moment right after `active` turns true, and false again on its
 * own. For a class that has to restart a CSS animation exactly once per press
 * rather than for as long as the thing it marks stays true.
 */
function usePaidFlourish(active: boolean, ms = 380): boolean {
  const [flourish, setFlourish] = useState(false);
  const was = useRef(active);

  useEffect(() => {
    const rose = active && !was.current;
    was.current = active;
    if (!rose) {
      return;
    }
    setFlourish(true);
    const id = window.setTimeout(() => setFlourish(false), ms);
    return () => window.clearTimeout(id);
  }, [active, ms]);

  return flourish;
}

/** Somebody's name from their seat id, for a roll history that only kept ids. */
function nameOf(state: TableView, seatId: string): string {
  return state.seats.find((seat) => seat.id === seatId)?.name ?? "Somebody";
}

/**
 * What the table is doing, in one line.
 *
 * The one thing every state has in common: a duel is either waiting on
 * somebody, being played, or already decided, and this is the sentence that
 * says which. Nothing here enforces anything — a table refusing a move
 * refuses it in words of its own, this is only what a player reads.
 */
function Standing({ state }: { state: TableView }) {
  if (state.phase === "waiting") {
    if (state.waitingFor === "funds") {
      return (
        <p className="dr__standing" role="status">
          {nameOf(state, state.shortId ?? "")} is short of the ante.
        </p>
      );
    }
    return (
      <p className="dr__standing" role="status">
        Waiting for an opponent.
      </p>
    );
  }

  if (state.phase === "over") {
    const { loserId, lastRoll, winnerIds } = state;
    if (loserId === null || lastRoll === null) {
      return null;
    }
    const loser = nameOf(state, loserId);
    const winner = winnerIds.length === 0 ? null : nameOf(state, winnerIds[0]);
    return (
      <p className="dr__standing" role="status">
        {loser} rolled a {lastRoll.result} out of {lastRoll.from}
        {winner === null ? "." : ` — ${winner} takes the pot.`}
      </p>
    );
  }

  const toRoll = state.toRoll === null ? null : nameOf(state, state.toRoll);
  return (
    <p className="dr__standing" role="status">
      {toRoll === null ? "" : `${toRoll} to roll.`}
    </p>
  );
}

/** Roll, or hand the roll back at a price. Only ever shown on your turn. */
function Controls({
  state,
  intent,
  passed,
}: {
  state: TableView;
  intent: Intent;
  passed: boolean;
}) {
  // Busy the moment either press lands, not only while the socket itself is —
  // a second click before the table has caught up would ask it something it
  // has already been asked.
  const busy = intent.rolling || intent.pending > 0;
  return (
    <div className="dr__controls">
      <button
        type="button"
        className="btn dr__roll"
        disabled={busy}
        onClick={() => {
          // The rattle of the throw, the instant it leaves this seat's hand —
          // sounded here rather than waited for, the same as the tumble itself.
          play("shake");
          intent.roll();
        }}
      >
        Roll
      </button>
      {/*
        Hidden once spent rather than shown disabled. Hiding it is a courtesy
        — the server refuses a second pass either way — and a button nobody
        may ever press again is not information worth a slot on the felt.
      */}
      {passed ? null : (
        <button
          type="button"
          className="btn btn--ghost dr__pass"
          aria-label={`Pass the roll back for ${fmt(state.passPrice)}`}
          disabled={busy}
          onClick={() => {
            play("bet");
            intent.pass();
          }}
        >
          <span className="dr__pass-name">Pass</span>
          <span className="dr__pass-price">{fmt(state.passPrice)}</span>
        </button>
      )}
    </div>
  );
}

/**
 * Somebody to duel, when there is nobody.
 *
 * A duel needs two and this table has no lobby to wait in, so a for-fun table
 * opened on your own would otherwise sit there for ever — which is the whole
 * reason bots exist in this building. Shown right under the empty seat,
 * because that seat is the thing it fills.
 *
 * Only at a table playing for nothing: chips are only won from real people,
 * and a bot has no account to take them from or pay them to. The table
 * refuses one either way — hiding the control is the courtesy, refusing the
 * message is the rule.
 */
function Bots({ table, state }: { table: Table; state: TableView }) {
  if (!state.forFun || state.seats.length >= state.maxSeats) {
    return null;
  }
  return (
    <div className="dr__bots">
      <span className="dr__bots-label">Deal somebody in</span>
      {(["easy", "normal", "hard"] as const).map((skill) => (
        <button
          key={skill}
          type="button"
          className="dr__bot"
          disabled={table.busy}
          onClick={() => table.addBot(skill)}
        >
          {skill}
        </button>
      ))}
    </div>
  );
}

/** The two seats in the duel, whichever of them have arrived yet. */
function Seats({ state, seatId }: { state: TableView; seatId: string | null }) {
  const slots: (TableView["seats"][number] | null)[] = [...state.seats];
  while (slots.length < 2) {
    slots.push(null);
  }

  return (
    <ul className="dr__seats">
      {slots.map((seat, at) =>
        seat === null ? (
          <li key={`empty-${at}`} className="dr__seat dr__seat--empty">
            <span className="dr__seat-name">Waiting for a player…</span>
          </li>
        ) : (
          <li
            key={seat.id}
            className={`dr__seat${seat.id === state.toRoll ? " dr__seat--turn" : ""}${
              seat.connected ? "" : " dr__seat--away"
            }`}
          >
            <Avatar name={seat.name} avatar={seat.avatar} accentColor={seat.accentColor} />
            <span className="dr__seat-name">
              {seat.name}
              {seat.id === seatId ? " (you)" : ""}
            </span>
            {/* Who you are actually duelling, said on the seat rather than
                left to be guessed from how fast the other side rolls. */}
            {seat.isBot ? <span className="dr__seat-bot">bot</span> : null}
            {seat.passed ? <span className="dr__seat-passed">Passed</span> : null}
            {state.forFun && seat.purse !== null ? (
              <span className="dr__seat-purse">{fmt(seat.purse)} play money</span>
            ) : null}
          </li>
        ),
      )}
    </ul>
  );
}

/** Every roll of the duel, oldest first, in its own scrolling strip. */
function History({
  rolls,
  seatName,
}: {
  rolls: TableView["history"];
  seatName: (id: string) => string;
}) {
  if (rolls.length === 0) {
    return null;
  }
  return (
    <ol className="dr__history" aria-label="Rolls this duel, oldest first">
      {rolls.map((rolled, at) => (
        <li
          // The position is the identity: the same ceiling can come up twice
          // and what tells the two rolls apart is which one happened first.
          key={`${at}:${rolled.seatId}:${rolled.from}:${rolled.result}`}
          className="dr__past"
          title={`${seatName(rolled.seatId)} rolled ${rolled.result} out of ${rolled.from}`}
        >
          {rolled.result}
        </li>
      ))}
    </ol>
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
  const [code, setCode] = useState(invited);
  const ready = code.length === CODE_LENGTH && !table.busy;
  const guest = account.profile === null;
  const [typed, setTyped] = useState("");
  /*
   * Null until the host picks, rather than seeded from `guest`. Seeding
   * freezes the answer at the first render, which happens while the account
   * is still on its way — and a profile that has not arrived looks exactly
   * like a guest.
   */
  const [chosen, setChosen] = useState<boolean | null>(null);
  const forFun = chosen ?? guest;
  const [stake, setStake] = useState<number>(STAKES[1]);
  const [ceiling, setCeiling] = useState<number>(CEILINGS[1]);
  const name = account.profile?.name ?? typed.trim();
  const named = name.length > 0;

  return (
    <div className="join">
      <p className="join__pitch">
        Two people, and a number that only goes down. Roll uniformly under the ceiling or pay a
        tenth of the ante to hand the roll back — whoever rolls a one loses the pot.
      </p>

      {account.loading || !guest ? null : (
        <label className="field">
          <span className="field__label">Your name</span>
          <input
            className="field__input"
            value={typed}
            maxLength={20}
            placeholder="Ada"
            onChange={(event) => setTyped(event.target.value)}
          />
        </label>
      )}

      {account.loading || !guest ? null : (
        <p className="join__warn">
          Playing for fun deals you play money that lives at the table and nowhere else. Sign in
          to play for real chips.
        </p>
      )}

      <div className="join__split">
        <div className="panel">
          <p className="panel__label">Join a table</p>
          <input
            className="field__input field__input--code"
            value={code}
            maxLength={CODE_LENGTH}
            placeholder="XKQ37"
            aria-label="Table code"
            onChange={(event) => setCode(event.target.value.toUpperCase())}
          />
          <button
            type="button"
            className="btn btn--wide"
            disabled={!ready || !named}
            onClick={() => table.join(name, code)}
          >
            Take a seat
          </button>
          <button
            type="button"
            className="btn btn--ghost btn--wide"
            disabled={!ready}
            onClick={() => table.watch(code)}
          >
            Just watch
          </button>
        </div>

        <div className="panel">
          <p className="panel__label">Open your own</p>

          <div className="variants" role="radiogroup" aria-label="What the table plays for">
            {[false, true].map((option) => (
              <button
                key={String(option)}
                type="button"
                role="radio"
                aria-checked={forFun === option}
                disabled={!option && guest}
                className={`variant${forFun === option ? " variant--on" : ""}`}
                onClick={() => setChosen(option)}
              >
                <span className="variant__name">{option ? "For fun" : "For chips"}</span>
                <span className="variant__note">
                  {option
                    ? "Play money, and the table is yours to shape. Anybody can sit down."
                    : guest
                      ? "Sign in to play for real chips."
                      : "Real chips, from your balance."}
                </span>
              </button>
            ))}
          </div>

          {/*
            * What a duel here costs, and where it starts. Both are decisions
            * about the whole evening rather than one player's, the same way a
            * betting window belongs to whoever opens a roulette table — so
            * they are picked here, once, by the host.
            */}
          <div className="dr__pickrow" role="radiogroup" aria-label="What a duel costs">
            <span className="dr__pickrow-label">Ante</span>
            <div className="dr__pick-options">
              {STAKES.map((level) => (
                <button
                  key={level}
                  type="button"
                  role="radio"
                  aria-checked={stake === level}
                  className={`dr__pick${stake === level ? " dr__pick--on" : ""}`}
                  onClick={() => setStake(level)}
                >
                  {fmt(level)}
                </button>
              ))}
            </div>
          </div>

          <div className="dr__pickrow" role="radiogroup" aria-label="Where a duel starts">
            <span className="dr__pickrow-label">Opens at</span>
            <div className="dr__pick-options">
              {CEILINGS.map((level) => (
                <button
                  key={level}
                  type="button"
                  role="radio"
                  aria-checked={ceiling === level}
                  className={`dr__pick${ceiling === level ? " dr__pick--on" : ""}`}
                  onClick={() => setCeiling(level)}
                >
                  {fmt(level)}
                </button>
              ))}
            </div>
          </div>

          <p className="panel__note">
            You get a five-character code to share. Two people, one ante each
            {forFun ? ", and play money that lives at the table." : "."}
          </p>
          <button
            type="button"
            className="btn btn--wide"
            disabled={table.busy || !named}
            onClick={() => table.create(name, { game: "death-roll", forFun, buyIn: stake, ceiling })}
          >
            Open a table
          </button>
        </div>
      </div>

      <PublicTables
        game="death-roll"
        busy={table.busy}
        canSit={named}
        whyNotSit="Put in a name first."
        onJoin={(open) => table.join(name, open)}
        onWatch={(open) => table.watch(open)}
      />
    </div>
  );
}

export default DeathRoll;
