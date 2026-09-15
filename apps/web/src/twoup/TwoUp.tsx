import type { BetOn, Outcome, TableView } from "@backroom/game-two-up";
import { CHIPS, FLIGHT_MS, headroom, MIN_CHIP, toBets, WINDOWS } from "@backroom/game-two-up";
import { CODE_ALPHABET, CODE_LENGTH } from "@backroom/shared";
import type { CSSProperties } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Chip } from "../chips/Chip.js";
import { Avatar } from "../game/Avatar.js";
import { Chat } from "../game/Chat.js";
import { exact } from "../game/money.js";
import type { Account } from "../game/useAccount.js";
import { useAccount } from "../game/useAccount.js";
import { useCountdown } from "../game/useCountdown.js";
import { Navbar } from "../nav/Navbar.js";
import { Taken } from "../net/Taken.js";
import { TableSetup } from "../table/TableSetup.js";
import type { TableSocketHook } from "../table/useTableSocket.js";
import { useTableSocket } from "../table/useTableSocket.js";
import { Board } from "./Board.js";
import { Coins } from "./Coin.js";
import { Ring } from "./Ring.js";
import { easing, FLIGHT, landings, rattle } from "./toss.js";
import { useCalledSound, useTossSound } from "./useTossSound.js";
import "@backroom/game-two-up/theme.css";
import "./twoup.css";

/**
 * The felt: two coins, a kip, and the two games they can be thrown for.
 *
 * Built the way `Roulette.tsx` is — the same socket plumbing, the same
 * taken-window handling, the same optimistic bargain `useIntent.ts` makes for
 * blackjack — because none of that changes from one banked table to the next.
 * What is new here is the camera that pulls back while the coins are up, and
 * a felt that draws one of two rulesets rather than one fixed layout.
 */

type Table = TableSocketHook<TableView>;

/*
 * `Coin.tsx`'s `Coins` derives its own landing split from a private `SPREAD`
 * it does not export — out of scope to change here (see the task brief).
 * `useTossSound` needs the same split so the rattle lands when the coin does,
 * so it is duplicated rather than threaded through a prop that would only
 * ever carry this one constant.
 */
const SOUND_SPREAD = 0.16;
const LANDINGS = landings(SOUND_SPREAD);
/** Computed once: the same run of knock times for every throw this page plays. */
const RATTLE = rattle();

/*
 * The camera's own timing, built from the same profile the coins rise on
 * (`toss.ts`'s `FLIGHT`) rather than a duration chosen by eye — so the push-in
 * takes exactly as long as the flight it is announcing, whatever `FLIGHT_MS`
 * is tuned to later.
 */
const FLIGHT_EASE = easing(FLIGHT);

export function TwoUp() {
  const navigate = useNavigate();
  const params = useParams();
  const account = useAccount();
  const raw = (params["code"] ?? "").toUpperCase();
  const looksLikeCode =
    raw.length === CODE_LENGTH && [...raw].every((letter) => CODE_ALPHABET.includes(letter));
  const urlCode = looksLikeCode ? raw : "";

  const back = useCallback(() => navigate("/two-up"), [navigate]);
  const table = useTableSocket<TableView>("two-up", back, account.setChips);
  const { state, seatId } = table;

  useEffect(() => {
    document.documentElement.dataset["game"] = "two-up";
    return () => {
      delete document.documentElement.dataset["game"];
    };
  }, []);

  useEffect(() => {
    if (state !== null && state.code !== urlCode) {
      navigate(`/two-up/${state.code}`, { replace: true });
    }
  }, [state, urlCode, navigate]);

  if (raw.length > 0 && !looksLikeCode) {
    return <p className="not-found">No table with that code.</p>;
  }

  return (
    <main className="play play--twoup">
      <Navbar
        game="Two-up"
        {...(state !== null
          ? {
              table: {
                code: state.code,
                onLeave: table.leave,
                /*
                 * Asked only in the casino school and only while chips are on
                 * the cloth. A ring's stake — a centre or a cover — is already
                 * contested by the time it is down, the same reason roulette
                 * only asks during its own betting window.
                 */
                confirm:
                  state.school === "casino" &&
                  state.phase === "betting" &&
                  (state.you?.staked ?? 0) > 0,
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
  const [chip, setChip] = useState<number>(CHIPS[CHIPS.length - 1]);
  const mine = state.you;

  /*
   * The optimistic stake, on both schools' felts.
   *
   * A stake is a number this player chose, so it is shown the moment it is
   * chosen — CLAUDE.md's own words — and replaced or given up on once the
   * table has spoken. Cleared on three signals: the table's own count for
   * this player moves (it caught up), an error arrives (it was refused), or
   * neither happens and the figure simply sits there being true a little
   * longer than it needed to, which costs nobody anything.
   */
  const [pending, setPending] = useState<Partial<Record<BetOn, number>>>({});
  const myStaked = mine?.staked ?? 0;
  const lastStaked = useRef(myStaked);
  useEffect(() => {
    if (myStaked !== lastStaked.current) {
      lastStaked.current = myStaked;
      setPending({});
    }
  }, [myStaked]);

  const [pendingCentre, setPendingCentre] = useState(0);
  const [pendingCover, setPendingCover] = useState(0);
  const myCentreServer = state.centre?.seatId === seatId ? state.centre.chips : 0;
  const myCoverServer = state.covers.find((one) => one.seatId === seatId)?.chips ?? 0;
  const lastCentre = useRef(myCentreServer);
  const lastCover = useRef(myCoverServer);
  useEffect(() => {
    if (myCentreServer !== lastCentre.current) {
      lastCentre.current = myCentreServer;
      setPendingCentre(0);
    }
  }, [myCentreServer]);
  useEffect(() => {
    if (myCoverServer !== lastCover.current) {
      lastCover.current = myCoverServer;
      setPendingCover(0);
    }
  }, [myCoverServer]);

  /*
   * A refusal is `room:error`, not a reply to any one press — `game:action`'s
   * ack carries nothing (see `packages/shared/src/protocol.ts`). So this is
   * the one place every optimistic figure on this felt gives up at once,
   * whichever of them the table was actually refusing.
   */
  useEffect(() => {
    if (table.error !== null) {
      setPending({});
      setPendingCentre(0);
      setPendingCover(0);
    }
  }, [table.error]);

  /* -------------------------------------------------------------- the kip */

  const [swung, setSwung] = useState(false);
  // A phase change is the table catching up either way — landing the throw
  // or refusing the press outright — so the swing has nothing left to hold.
  // biome-ignore lint/correctness/useExhaustiveDependencies: fires on the phase changing, which is the point
  useEffect(() => {
    setSwung(false);
  }, [state.phase]);
  useEffect(() => {
    if (table.error !== null) {
      setSwung(false);
    }
  }, [table.error]);

  const canThrow = state.phase === "kip" && seatId !== null && seatId === state.spinnerId;
  const onThrow = () => {
    if (!canThrow) {
      return;
    }
    setSwung(true);
    table.act({ type: "throw" });
  };

  /* ---------------------------------------------------------- casino bets */

  const bets = useMemo(() => toBets(state.placed), [state.placed]);
  const room = useCallback((on: BetOn) => headroom(state.bank, bets, on), [state.bank, bets]);
  const canBet =
    state.school === "casino" && state.phase === "betting" && !state.lastCall && mine !== null;

  const mineOn = useMemo(() => {
    const out: Record<BetOn, number> = { heads: 0, tails: 0, fiveOdds: 0 };
    for (const one of state.placed) {
      if (one.seatId === seatId) {
        out[one.on] += one.chips;
      }
    }
    for (const on of Object.keys(out) as BetOn[]) {
      out[on] += pending[on] ?? 0;
    }
    return out;
  }, [state.placed, seatId, pending]);

  const spotDisabled = useCallback((on: BetOn) => !canBet || chip > room(on), [canBet, chip, room]);

  const onPlace = (on: BetOn) => {
    if (spotDisabled(on)) {
      return;
    }
    setPending((current) => ({ ...current, [on]: (current[on] ?? 0) + chip }));
    table.act({ type: "place", on, chips: chip });
  };

  const onTake = (on: BetOn) => {
    if (!canBet || (mineOn[on] ?? 0) === 0) {
      return;
    }
    table.act({ type: "take", on, chips: chip });
  };

  /* --------------------------------------------------------- ring wagers */

  const canSetCentre =
    state.school === "school" &&
    state.phase === "centre" &&
    !state.lastCall &&
    seatId !== null &&
    seatId === state.spinnerId;
  const onCentre = () => {
    if (!canSetCentre) {
      return;
    }
    setPendingCentre((current) => current + chip);
    table.act({ type: "centre", chips: chip });
  };

  const canCover =
    state.school === "school" &&
    state.phase === "covering" &&
    !state.lastCall &&
    seatId !== null &&
    seatId !== state.centre?.seatId &&
    state.uncovered >= MIN_CHIP;
  const onCover = () => {
    if (!canCover) {
      return;
    }
    // Never more than what is actually left to contest — the same courtesy
    // the server's own `cover()` enforces, worked out here so a press never
    // shows a chip it already knows would be refused.
    const most = Math.min(chip, state.uncovered);
    setPendingCover((current) => current + most);
    table.act({ type: "cover", chips: most });
  };

  const myCentre = myCentreServer + pendingCentre;
  const myCover = myCoverServer + pendingCover;

  /* ------------------------------------------------------------ the toss */

  const flying = state.phase === "spinning";
  const lastOutcome = state.throws.length > 0 ? (state.throws[state.throws.length - 1] ?? null) : null;
  useTossSound(flying, FLIGHT_MS, { landings: LANDINGS, rattle: RATTLE });
  useCalledSound(lastOutcome, flying);

  return (
    // A fragment rather than one wrapping section: the rail below has to sit
    // outside `.tu` (see the note over it) so its sticky range runs the
    // length of the whole page, chat included, rather than stopping wherever
    // `.tu`'s own last child happens to end.
    <>
      <section className="tu" data-game="two-up">
        <Standing state={state} seatId={seatId} />

        {/*
          The camera. `.tu__felt--away` is added and dropped by nothing but
          `flying` — a `transform`/`filter` pair in twoup.css, never a layout
          property, which is what keeps it from moving anything at 375px
          while it plays. The ring stays inside this element rather than
          beside it: other people's stakes are half the reason to watch this
          table, and a push-in that hid them would be a better shot and a
          worse game.
        */}
        <div
          className={`tu__felt${flying ? " tu__felt--away" : ""}`}
          style={{ "--flight-ms": `${FLIGHT_MS}ms`, "--flight-ease": FLIGHT_EASE } as CSSProperties}
        >
          <Ring
            state={state}
            seatId={seatId}
            mineOn={mineOn}
            spotDisabled={spotDisabled}
            onPlace={onPlace}
            onTake={onTake}
            myCentre={myCentre}
            myCover={myCover}
            canSetCentre={canSetCentre}
            canCover={canCover}
            onCentre={onCentre}
            onCover={onCover}
            canThrow={canThrow}
            swung={swung}
            coinsShowing={state.faces !== null}
            onThrow={onThrow}
          />
          <div className="tu__toss">
            <Coins faces={state.faces} flying={flying} flightMs={FLIGHT_MS} />
          </div>
        </div>

        <Board throws={state.history} />

        <Seats state={state} seatId={seatId} />
      </section>

      {mine === null ? (
        <p className="tu__watching">{state.watching} watching. Take a seat to play.</p>
      ) : (
        <Rail table={table} state={state} chip={chip} onChip={setChip} />
      )}
    </>
  );
}

const OUTCOME_WORD: Record<Outcome, string> = { heads: "Heads.", tails: "Tails.", odds: "Odds." };

/** What the last throw said, once there has been one. */
function lastOutcomeWord(state: TableView): string {
  const at = state.throws[state.throws.length - 1];
  return at === undefined ? "" : OUTCOME_WORD[at];
}

/** What a finished round decided, whichever school played it. */
function settledWord(state: TableView): string {
  if (state.school === "casino") {
    if (state.called === "fiveOdds") {
      return "Five odds.";
    }
    return state.called === null ? "" : OUTCOME_WORD[state.called];
  }
  switch (state.decided) {
    case "spinner":
      return "The spinner is in.";
    case "ring":
      return "The ring takes it.";
    case "oddedOut":
      return "Odded out.";
    default:
      return "";
  }
}

/**
 * What the table is doing, and how long it is doing it for.
 *
 * Silent while the ring is holding — `Ring` says why, and a second line
 * saying the same thing above it would be the page repeating itself.
 */
function Standing({ state, seatId }: { state: TableView; seatId: string | null }) {
  const left = useCountdown(state.deadline);

  if (state.holding) {
    return null;
  }

  /*
   * A bank with nothing in it is said before anybody presses anything, the
   * same courtesy roulette's cloth gives an empty bank — an unstaffed control
   * that silently refuses every press looks like a broken table rather than
   * an honest one.
   */
  if (state.school === "casino" && state.phase === "betting" && state.bank <= 0) {
    return (
      <p className="tu__standing tu__standing--last" role="status">
        The bank is empty — nothing to play for yet.
      </p>
    );
  }

  const spinnerName = state.seats.find((seat) => seat.id === state.spinnerId)?.name ?? "the spinner";
  const youAreSpinner = state.spinnerId === seatId;
  const clock = left === null ? "" : ` — ${left}s`;

  switch (state.phase) {
    case "betting":
      return (
        <p className={`tu__standing${state.lastCall ? " tu__standing--last" : ""}`} role="status">
          {state.lastCall ? "Last call" : "Place your bets"}
          {clock}
        </p>
      );
    case "centre":
      return (
        <p className="tu__standing" role="status">
          {youAreSpinner ? "Set the centre." : `Waiting on ${spinnerName}.`}
          {clock}
        </p>
      );
    case "covering":
      return (
        <p className={`tu__standing${state.lastCall ? " tu__standing--last" : ""}`} role="status">
          {state.lastCall ? "Last call to cover" : "Cover the centre"}
          {clock}
        </p>
      );
    case "kip":
      return (
        <p className="tu__standing" role="status">
          {youAreSpinner ? "Press the kip." : `Come in, ${spinnerName}.`}
        </p>
      );
    case "spinning":
      return (
        <p className="tu__standing tu__standing--shut" role="status">
          The coins are up.
        </p>
      );
    case "reading":
      return (
        <p className="tu__standing" role="status">
          {lastOutcomeWord(state)}
        </p>
      );
    case "settled":
      return (
        <p className="tu__standing" role="status">
          {settledWord(state)} Paying out.
        </p>
      );
    default:
      return null;
  }
}

/** The tray, and the two ways a casino stake comes back off the cloth. */
function Rail({
  table,
  state,
  chip,
  onChip,
}: {
  table: Table;
  state: TableView;
  chip: number;
  onChip: (value: number) => void;
}) {
  const purse = state.you?.purse ?? null;
  const down = state.you?.staked ?? 0;
  const open = state.school === "casino" && state.phase === "betting" && !state.lastCall;

  return (
    <div className="tu__rail">
      <div className="tu__tray" role="radiogroup" aria-label="What to bet with">
        {CHIPS.map((value) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={chip === value}
            aria-label={`Bet with ${exact(value)}`}
            className={`tu__chip${chip === value ? " tu__chip--picked" : ""}`}
            disabled={purse !== null && value > purse}
            onClick={() => onChip(value)}
          >
            <Chip amount={value} />
          </button>
        ))}
      </div>

      {state.school === "casino" ? (
        <div className="tu__acts">
          <button
            type="button"
            className="tu__act"
            aria-label="Undo the last chip you put down"
            disabled={!open || down === 0 || table.busy}
            onClick={() => table.act({ type: "undo" })}
          >
            <span className="tu__act-name">Undo</span>
            <span className="tu__act-note">The last chip down</span>
          </button>
          <button
            type="button"
            className="tu__act"
            aria-label="Take back everything you have on the cloth"
            disabled={!open || down === 0 || table.busy}
            onClick={() => table.act({ type: "clear" })}
          >
            <span className="tu__act-name">Clear</span>
            <span className="tu__act-note">Everything you have on</span>
          </button>
        </div>
      ) : null}

      <p className="tu__note">
        {down > 0 ? (
          <>
            <strong className="tu__note-figure">{exact(down)}</strong> on the cloth.{" "}
          </>
        ) : null}
        {purse === null ? null : (
          <>
            <strong className="tu__note-figure">{exact(purse)}</strong> in play money left.{" "}
          </>
        )}
        Right-click a side, or press and hold, to take a chip back off.
      </p>
    </div>
  );
}

/** Everybody at the table, and what the last round did to them. */
function Seats({ state, seatId }: { state: TableView; seatId: string | null }) {
  return (
    <ul className="tu__seats">
      {state.seats.map((seat) => {
        const paid = state.paid.find((one) => one.seatId === seat.id);
        const up = paid === undefined ? null : paid.back - paid.staked;
        return (
          <li
            key={seat.id}
            className={`tu__seat${seat.id === seatId ? " tu__seat--you" : ""}${
              seat.connected ? "" : " tu__seat--away"
            }${seat.id === state.spinnerId ? " tu__seat--spinner" : ""}`}
          >
            <Avatar name={seat.name} avatar={seat.avatar} accentColor={seat.accentColor} />
            <span className="tu__seat-name">{seat.name}</span>
            {seat.staked > 0 ? <span className="tu__seat-down">{exact(seat.staked)}</span> : null}
            {up === null || state.phase !== "settled" ? null : (
              <span className={`tu__seat-up${up >= 0 ? "" : " tu__seat-up--down"}`}>
                {up >= 0 ? `+${exact(up)}` : exact(up)}
              </span>
            )}
          </li>
        );
      })}
    </ul>
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
  const [window, setWindow] = useState<number>(WINDOWS[1]);
  const [ruleset, setRuleset] = useState<"casino" | "school">("casino");

  return (
    <TableSetup
      game="two-up"
      pitch="Two coins, tossed from a kip. Back heads or tails against the house, or stand in the ring and cover another player's centre — the same toss, two different games."
      invited={invited}
      account={account}
      busy={table.busy}
      connected={table.connected}
      onJoin={table.join}
      onWatch={table.watch}
      playsFor={{ fun: "Play money, and you can deal bots in. Anybody can sit down." }}
      options={
        <>
          <div className="plates" role="radiogroup" aria-label="Which school">
            {(["casino", "school"] as const).map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={ruleset === option}
                className="plate"
                onClick={() => setRuleset(option)}
              >
                <span className="plate__name">
                  {option === "casino" ? "Casino" : "Traditional"}
                </span>
                <span className="plate__note">
                  {option === "casino"
                    ? "Back heads, tails or five odds against the house."
                    : "A spinner and a ring, covering each other's chips."}
                </span>
              </button>
            ))}
          </div>

          {/*
            * How long the felt stays open, or how long a centre stays up
            * waiting to be covered. A decision about everybody's evening
            * rather than one player's, so it is the host's — same reasoning
            * as roulette's own window picker.
            */}
          <div className="tu__window" role="radiogroup" aria-label="How long bets stay open">
            <span className="tu__window-label">Betting</span>
            <div className="tu__window-row">
              {WINDOWS.map((level) => (
                <button
                  key={level}
                  type="button"
                  role="radio"
                  aria-checked={window === level}
                  aria-label={`${level / 1000} seconds a round`}
                  className={`tu__window-pick${window === level ? " tu__window-pick--on" : ""}`}
                  onClick={() => setWindow(level)}
                >
                  <span className="tu__window-cost">{level / 1000}s</span>
                </button>
              ))}
            </div>
          </div>
        </>
      }
      note={({ forFun }) =>
        `You get a five-character code to share. ${
          ruleset === "school"
            ? "The ring needs two real players before it deals; a lone host waits."
            : `The kip comes round on its own every ${window / 1000} seconds.`
        } ${forFun ? "Play money lives at the table." : "Chips leave your balance as they go down."}`
      }
      onCreate={(name, { forFun, maxSeats }) =>
        table.create(name, { game: "two-up", forFun, maxSeats, window, ruleset })
      }
    />
  );
}

export default TwoUp;
