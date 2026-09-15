import { CODE_LENGTH } from "@backroom/shared";
import type { ReactNode } from "react";
import { useState } from "react";
import { CodeScreen } from "../fittings/CodeScreen.js";
import type { Account } from "../game/useAccount.js";
import { PublicTables } from "./PublicTables.js";
import { SeatCount } from "./SeatCount.js";

/**
 * What a table opens as: what the host chose, or the sensible default until
 * they choose.
 *
 * The default has to be read at render rather than frozen at mount. Whether
 * somebody is a guest is not known when this panel first draws — the account
 * is still on its way — and "not known yet" looks exactly like "guest", so a
 * default captured then is the wrong one for everybody who is signed in.
 */
export function opensForFun(chosen: boolean | null, guest: boolean): boolean {
  return chosen ?? guest;
}

/** The host's choices that every game's table shares. */
export interface SetupChoice {
  forFun: boolean;
  maxSeats: number;
}

/**
 * The screen in front of every game's tables: a code to join by, a panel for
 * opening your own, and the tables already open.
 *
 * One component rather than a copy per game, because the copies drifted — in
 * width, in which buttons waited for the server, in how a guest was asked for
 * a name. What does differ between games is passed in: the pitch, the
 * game's own options for a new table, and what the note under them says.
 */
export function TableSetup({
  game,
  pitch,
  invited,
  account,
  busy,
  connected = true,
  onJoin,
  onWatch,
  onCreate,
  playsFor,
  options,
  note,
  seats,
}: {
  /** The game's id, as the server lists its tables. */
  game: string;
  pitch: ReactNode;
  /** A table code from the address bar, filled into the join field. */
  invited: string;
  account: Account;
  busy: boolean;
  /** Where the page knows it; a table cannot be joined before the socket is up. */
  connected?: boolean;
  onJoin: (name: string, code: string) => void;
  onWatch: (code: string) => void;
  onCreate: (name: string, choice: SetupChoice) => void;
  /**
   * Whether the host picks between play money and chips, and what the play
   * money option says in this game. Left out by a game that decides it some
   * other way.
   */
  playsFor?: {
    fun: string;
    /** Said to a guest, who can only play for fun. */
    guestWarning?: string;
  };
  /** The game's own shape for a new table, between the stakes and the seats. */
  options?: ReactNode;
  /** The line above "Open a table", which usually depends on the stakes. */
  note: (choice: SetupChoice) => ReactNode;
  seats?: { initial?: number; ceiling?: number };
}) {
  const [code, setCode] = useState(invited);
  const [typed, setTyped] = useState("");
  const [chosen, setChosen] = useState<boolean | null>(null);
  const [maxSeats, setMaxSeats] = useState(seats?.initial ?? 6);
  // Which press the server is busy with, so only that button is held down.
  const [pressed, setPressed] = useState<"join" | "create" | null>(null);
  const guest = account.profile === null;
  // A game with no choice of stakes treats everyone the same, so nobody is
  // defaulted into play money by it.
  const forFun = playsFor === undefined ? false : opensForFun(chosen, guest);
  const choice: SetupChoice = { forFun, maxSeats };
  /*
   * A signed-in player's name is the account's and the server uses it whatever
   * is sent. A guest has none, so they type one — which is the only reason the
   * field exists. Held back until we know which they are, rather than shown and
   * snatched away.
   */
  const askName = !account.loading && guest;
  const name = account.profile?.name ?? typed.trim();
  const named = name.length > 0;
  const live = connected && !busy;
  const ready = code.length === CODE_LENGTH && live;

  const held = (which: "join" | "create") => (busy && pressed === which ? " is-busy" : "");

  return (
    <div className="join">
      <p className="join__pitch">{pitch}</p>

      {askName ? (
        <label className="entry join__name">
          <span className="label">Your name</span>
          <input
            className="input"
            value={typed}
            maxLength={20}
            placeholder="Ada"
            onChange={(event) => setTyped(event.target.value)}
          />
        </label>
      ) : null}

      {askName && playsFor !== undefined ? (
        <p className="join__warn">
          {playsFor.guestWarning ??
            "Playing for fun deals you play money that lives at the table and nowhere else. Sign in to play for real chips."}
        </p>
      ) : null}

      <div className="join__split">
        <section className="housing" aria-labelledby="join-title">
          <div className="housing__head">
            <h2 className="label" id="join-title">
              Join a table
            </h2>
          </div>
          <div className="housing__body">
            <CodeScreen
              value={code}
              onChange={setCode}
              onEnter={() => {
                if (ready && named) {
                  setPressed("join");
                  onJoin(name, code);
                }
              }}
            />
            {/* Not gated on signing in: whether a guest may sit depends on what
                the table plays for, which only the server knows. It refuses in
                words. */}
            <button
              type="button"
              className={`slab slab--wide${held("join")}`}
              disabled={!ready || !named}
              onClick={() => {
                setPressed("join");
                onJoin(name, code);
              }}
            >
              Take a seat
            </button>
            {/* Needs no name: a watcher is nobody at the table. */}
            <button type="button" className="key key--wide" disabled={!ready} onClick={() => onWatch(code)}>
              Just watch
            </button>
          </div>
        </section>

        <section className="housing" aria-labelledby="open-title">
          <div className="housing__head">
            <h2 className="label" id="open-title">
              Open your own
            </h2>
          </div>
          <div className="housing__body">
            {playsFor !== undefined ? (
              <div className="plates" role="radiogroup" aria-label="What the table plays for">
                {[false, true].map((option) => (
                  <button
                    key={String(option)}
                    type="button"
                    role="radio"
                    aria-checked={forFun === option}
                    // A guest has nothing real to stake, so the choice is not
                    // offered rather than offered and refused.
                    disabled={!option && guest}
                    className="plate"
                    onClick={() => setChosen(option)}
                  >
                    <span className="plate__name">{option ? "For fun" : "For chips"}</span>
                    <span className="plate__note">
                      {option
                        ? playsFor.fun
                        : guest
                          ? "Sign in to play for real chips."
                          : "Real chips, from your balance."}
                    </span>
                  </button>
                ))}
              </div>
            ) : null}

            {options}

            <SeatCount
              value={maxSeats}
              onChange={setMaxSeats}
              {...(seats?.ceiling !== undefined ? { ceiling: seats.ceiling } : {})}
            />

            <p className="panel__note">{note(choice)}</p>
          </div>
          <div className="housing__foot">
            <button
              type="button"
              className={`slab slab--wide${held("create")}`}
              disabled={!live || !named}
              onClick={() => {
                setPressed("create");
                onCreate(name, choice);
              }}
            >
              Open a table
            </button>
          </div>
        </section>
      </div>

      <PublicTables
        game={game}
        busy={!live}
        canSit={named}
        whyNotSit={askName ? "Put in a name first." : "Waiting for the server…"}
        onJoin={(open) => onJoin(name, open)}
        onWatch={onWatch}
      />

      {!connected ? <p className="join__warn">Waiting for the server…</p> : null}
    </div>
  );
}
