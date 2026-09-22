import type { TableView } from "@backroom/game-liars-dice";
import { ANTE, DICE, DICE_LEVELS, STAKES } from "@backroom/game-liars-dice";
import { CODE_ALPHABET, CODE_LENGTH } from "@backroom/shared";
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { Account } from "../game/useAccount.js";
import { useAccount } from "../game/useAccount.js";
import { useNav } from "../nav/NavContext.js";
import { Taken } from "../net/Taken.js";
import { Refusal } from "../table/Refusal.js";
import { TableSetup } from "../table/TableSetup.js";
import type { TableSocketHook } from "../table/useTableSocket.js";
import { useTableSocket } from "../table/useTableSocket.js";
import { useTablePeek } from "../table/useTablePeek.js";
import { DiscordIcon } from "../blackjack/Icons.js";
import "@backroom/game-liars-dice/theme.css";
import "./liarsdice.css";

type Table = TableSocketHook<TableView>;

const fmt = (n: number) => n.toLocaleString("en-US");

/**
 * Liar's Dice, wired up.
 *
 * Ten seats is what shapes everything here: the felt shows every hand as a
 * count and only your own as faces, and the controls have to build a bid with
 * a thumb. The felt itself arrives in a later commit; this is the door.
 */
export function LiarsDice() {
  const navigate = useNavigate();
  const params = useParams();
  const account = useAccount();
  const raw = (params["code"] ?? "").toUpperCase();
  const looksLikeCode =
    raw.length === CODE_LENGTH && [...raw].every((letter) => CODE_ALPHABET.includes(letter));
  const urlCode = looksLikeCode ? raw : "";

  const back = useCallback(() => navigate("/liars-dice"), [navigate]);
  const table = useTableSocket<TableView>("liars-dice", back, account.setChips);
  const { state } = table;

  useNav({
    room: "liars-dice",
    game: "Liar's Dice",
    ...(state !== null
      ? {
          table: {
            code: state.code,
            onLeave: table.leave,
            // Asked while a game is running, because the ante is already in the
            // pot and standing up gives it up.
            confirm: state.phase === "playing",
          },
        }
      : {}),
    connected: table.connected,
  });

  useEffect(() => {
    if (state !== null && state.code !== urlCode) {
      navigate(`/liars-dice/${state.code}`, { replace: true });
    }
  }, [state, urlCode, navigate]);

  if (raw.length > 0 && !looksLikeCode) {
    return <p className="not-found">No table with that code.</p>;
  }

  const atTable = table.taken === null && state !== null;

  return (
    <main className={`play${atTable ? " play--fit play--liars" : ""}`} data-game="liars-dice">
      {atTable ? (
        <Refusal message={table.error} id={table.errorKey} />
      ) : table.error !== null ? (
        <p className="play__error">{table.error}</p>
      ) : null}

      {table.taken !== null ? (
        <Taken message={table.taken} onRetry={table.retry} />
      ) : state === null ? (
        <Sit table={table} invited={urlCode} account={account} />
      ) : (
        // The felt lands in the commit that builds it.
        <p className="play__error">Table {state.code}</p>
      )}
    </main>
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
  const back = `/auth/discord?to=${encodeURIComponent(`/liars-dice/${code}`)}`;

  return (
    <div className="join join--gate">
      <section className="housing gate" aria-labelledby="gate-title">
        <div className="housing__head">
          <p className="label">Table {code}</p>
        </div>
        <div className="housing__body">
          <h2 className="gate__title" id="gate-title">
            This one plays for chips
          </h2>
          <p className="gate__note">
            Chips come from an account, so there is one step before you sit down. Sign in and you
            will land back at this table.
          </p>
          <a className="slab slab--wide slab--discord" href={back}>
            <DiscordIcon />
            <span>Sign in with Discord</span>
          </a>
          <button type="button" className="key key--wide" onClick={onWatch}>
            Just watch this one
          </button>
          <p className="panel__note">
            Or <Link to="/liars-dice">open a table of your own</Link> — a for-fun one deals play
            money and anybody can sit down.
          </p>
        </div>
      </section>
    </div>
  );
}

/** The stake and the dice, which are the host's two choices beyond the seats. */
function Shape({
  stake,
  onStake,
  dice,
  onDice,
}: {
  stake: number;
  onStake: (stake: number) => void;
  dice: number;
  onDice: (dice: number) => void;
}) {
  return (
    <>
      <div className="lamps ld__pick" role="radiogroup" aria-label="What it costs to sit down">
        {STAKES.map((level) => (
          <button
            key={level}
            type="button"
            role="radio"
            aria-checked={stake === level}
            className="lamp lamp--chips"
            onClick={() => onStake(level)}
          >
            {fmt(level)}
          </button>
        ))}
      </div>
      <div className="lamps ld__pick" role="radiogroup" aria-label="How many dice each">
        {DICE_LEVELS.map((level) => (
          <button
            key={level}
            type="button"
            role="radio"
            aria-checked={dice === level}
            className="lamp lamp--word"
            onClick={() => onDice(level)}
          >
            {level} dice
          </button>
        ))}
      </div>
    </>
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
  const [stake, setStake] = useState<number>(ANTE);
  const [dice, setDice] = useState<number>(DICE);
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
      game="liars-dice"
      pitch="Five dice under a cup each. Say there are more fives on the table than anybody believes, and hope nobody calls it."
      invited={invited}
      account={account}
      busy={table.busy}
      connected={table.connected}
      onJoin={table.join}
      onWatch={table.watch}
      seats={{ initial: 6, ceiling: 10 }}
      playsFor={{
        fun: "Play money that lives at the table. Anybody can sit down, and bots will fill the seats.",
        guestWarning:
          "Playing for fun deals you ten thousand chips that live at the table and nowhere else. Sign in to play for real ones.",
      }}
      options={<Shape stake={stake} onStake={setStake} dice={dice} onDice={setDice} />}
      note={({ forFun }) =>
        forFun
          ? `${dice} dice each, and the pot is play money that dies with the table.`
          : `Everybody puts ${fmt(stake)} in, ${dice} dice each, and the last one holding dice takes the lot.`
      }
      onCreate={(name, { forFun, maxSeats }) =>
        table.create(name, { game: "liars-dice", forFun, maxSeats, buyIn: stake, dice })
      }
    />
  );
}
