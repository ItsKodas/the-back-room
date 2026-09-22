import type { TableView } from "@backroom/game-poker";
import { blindsFor, BUY_IN, STAKES } from "@backroom/game-poker";
import { CODE_ALPHABET, CODE_LENGTH } from "@backroom/shared";
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Chat } from "../game/Chat.js";
import { compact } from "../game/money.js";
import type { Account } from "../game/useAccount.js";
import { useAccount } from "../game/useAccount.js";
import { useNav } from "../nav/NavContext.js";
import { Taken } from "../net/Taken.js";
import { TableSetup } from "../table/TableSetup.js";
import { useTableSocket } from "../table/useTableSocket.js";
import { Felt, fmt } from "./Felt.js";
import type { Table } from "./Felt.js";
import { useTableSound } from "./useTableSound.js";
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
