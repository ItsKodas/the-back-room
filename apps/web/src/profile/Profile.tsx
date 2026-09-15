import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Avatar } from "../game/Avatar.js";
import { useAccount } from "../game/useAccount.js";
import { Send } from "./Send.js";
import { ChipColumns } from "../chips/ChipColumns.js";
import { Navbar } from "../nav/Navbar.js";
import { bundle, signed } from "./history.js";
import type { PlayedGame } from "./history.js";

const fmt = (n: number) => n.toLocaleString("en-US");

/**
 * What one game calls its own figures.
 *
 * The store keeps them as numbers by name and refuses to know what they mean,
 * which is right — but somebody has to turn `bestTurn` into "best turn", and
 * the honest place is beside the game it belongs to.
 */
const FIGURE_NAMES: Record<string, Record<string, string>> = {
  greed: {
    bestTurn: "best turn",
    farkles: "farkles",
    hotDice: "hot dice",
  },
  tips: {
    taps: "taps",
    chipsTipped: "chips tipped",
    bestNight: "best night",
  },
};

const GAME_NAMES: Record<string, string> = {
  greed: "Greed",
  blackjack: "Blackjack",
  tips: "The Tip Jar",
};

/** A game's key, turned into something safe to put in an id. */
const gameHousingId = (game: string) =>
  `profile-game-${game
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")}`;

export function Profile() {
  const account = useAccount();
  const [history, setHistory] = useState<PlayedGame[]>([]);

  useEffect(() => {
    if (account.profile === null) {
      return;
    }
    let live = true;
    void fetch("/api/games", { credentials: "include" })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { games: PlayedGame[] } | null) => {
        if (live && body !== null) {
          setHistory(body.games);
        }
      })
      .catch(() => {
        // History is the least of what this page is for; without it the rest
        // of the page is still worth showing.
      });
    return () => {
      live = false;
    };
  }, [account.profile]);

  return (
    <main className="room">
      <Navbar account={account} />

      {account.loading ? null : account.profile === null ? (
        <p className="panel__note">
          Sign in to keep a balance, a history, and figures worth arguing about.
        </p>
      ) : (
        <Signed
          profile={account.profile}
          history={history}
          onSignOut={account.signOut}
          onChips={account.setChips}
        />
      )}
    </main>
  );
}

function Signed({
  profile,
  history,
  onSignOut,
  onChips,
}: {
  profile: NonNullable<ReturnType<typeof useAccount>["profile"]>;
  history: PlayedGame[];
  onSignOut: () => void;
  /** The balance after chips have moved, so the purse follows without a reload. */
  onChips: (chips: number) => void;
}) {
  const { rounds, roundsWon, chipsWon } = profile.stats;
  const rate = rounds === 0 ? 0 : Math.round((roundsWon / rounds) * 100);

  return (
    <div className="profile">
      <div className="profile__who">
        <div className="housing">
          <div className="housing__body">
            <div className="who">
              <Avatar
                name={profile.name}
                avatar={profile.avatar}
                accentColor={profile.accentColor}
                className="who__face"
              />
              <span className="who__name">{profile.name}</span>
            </div>
            <div className="purse">
              <b className="purse__count">{fmt(profile.chips)}</b>
              <small>chips</small>
              {/* Racked the way a dealer racks a balance: a short column per
                  denomination, so a large number spreads sideways rather than
                  growing into a tower. The figure above is the exact answer;
                  this is the one you can see the size of. */}
              <ChipColumns amount={profile.chips} unit={30} />
            </div>
            {/* The daily top-up used to live here; the jar on the bar replaced
                it, so this is a way there rather than a claim of its own. */}
            <Link className="key key--wide" to="/tips">
              Short of chips? There is a jar on the bar.
            </Link>
          </div>
        </div>
        <Redeem onRedeemed={() => window.location.reload()} />
        {/* Beside redeeming rather than out on the felt: this is a thing you do
            about your account, not a move at a table. */}
        <Send meId={profile.id} chips={profile.chips} onSent={onChips} />
        {/* The way out, kept with everything else about being you rather than
            sitting in the bar beside the volume. Signing out is rare, and it
            is not a thing to have within a slip of the mouse while playing. */}
        <button type="button" className="quiet quiet--wide profile__out" onClick={onSignOut}>
          Sign out
        </button>
      </div>

      <div className="profile__figures">
        {/* Shared first: these are the four things every game can answer. */}
        <div className="figures">
          <Figure value={fmt(rounds)} label="games played" />
          <Figure value={fmt(roundsWon)} label="won" />
          <Figure value={`${chipsWon >= 0 ? "+" : ""}${fmt(chipsWon)}`} label="chips won" money />
          <Figure value={`${rate}%`} label="win rate" />
        </div>

        {Object.entries(profile.byGame).map(([game, figures]) => {
          const id = gameHousingId(game);
          return (
            <section className="housing" aria-labelledby={id} key={game}>
              <div className="housing__head">
                <h2 className="label" id={id}>
                  {GAME_NAMES[game] ?? game}
                </h2>
              </div>
              <div className="housing__body">
                <div className="figures">
                  {Object.entries(figures).map(([key, value]) => (
                    <Figure
                      key={key}
                      value={fmt(value)}
                      label={FIGURE_NAMES[game]?.[key] ?? key}
                    />
                  ))}
                </div>
              </div>
            </section>
          );
        })}

        <section className="housing" aria-labelledby="profile-history">
          <div className="housing__head">
            <h2 className="label" id="profile-history">
              Recent games
            </h2>
          </div>
          <div className="housing__body">
            {history.length === 0 ? (
              <p className="panel__note">Nothing finished yet.</p>
            ) : (
              <div className="scroller">
                <table className="history">
                  <thead>
                    <tr>
                      <th>Table</th>
                      <th>Game</th>
                      <th>Players</th>
                      <th className="history__num">Chips</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bundle(history, profile.id).map((session) => (
                      <tr key={`${session.code}-${session.endedAt}`}>
                        <td className="history__code">{session.code}</td>
                        <td>
                          {session.rulesetName}
                          {/* Only when there was more than one. A "×1" on every
                              other line would be noise standing in for a fact. */}
                          {session.rounds > 1 ? (
                            <span className="history__rounds">×{session.rounds}</span>
                          ) : null}
                        </td>
                        <td>{session.players}</td>
                        <td
                          className={`history__num ${session.net > 0 ? "up" : session.net < 0 ? "down" : ""}`}
                          title={
                            session.estimated
                              ? "Worked out from the pot: this was played before chips were recorded per player."
                              : undefined
                          }
                        >
                          {signed(session.net)}
                          {session.estimated ? <span className="history__guess">?</span> : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function Figure({ value, label, money }: { value: string; label: string; money?: boolean }) {
  return (
    <div className="figure">
      <b className={money === true ? "figure__money" : undefined}>{value}</b>
      <span>{label}</span>
    </div>
  );
}

/** How a refusal is put to the person who typed the code. */
const REFUSALS: Record<string, string> = {
  "unknown-code": "No code like that.",
  "already-redeemed": "You have already used that one.",
  "used-up": "That code has been used up.",
  expired: "That code has expired.",
  revoked: "That code is no longer good.",
  "too-many": "Too many tries. Give it a minute.",
  "sign-in": "Sign in first.",
};

function Redeem({ onRedeemed }: { onRedeemed: () => void }) {
  const [typed, setTyped] = useState("");
  const [said, setSaid] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const send = () => {
    if (typed.trim().length === 0 || busy) {
      return;
    }
    setBusy(true);
    void fetch("/api/redeem", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: typed }),
    })
      .then((response) => response.json())
      .then((body: { ok: boolean; chips?: number; reason?: string }) => {
        if (body.ok) {
          setSaid(`Redeemed for ${fmt(body.chips ?? 0)} chips.`);
          setTyped("");
          onRedeemed();
        } else {
          setSaid(REFUSALS[body.reason ?? ""] ?? "That did not work.");
        }
      })
      .catch(() => setSaid("Could not reach the room. Try again."))
      .finally(() => setBusy(false));
  };

  return (
    <section className="housing" aria-labelledby="profile-redeem">
      <div className="housing__head">
        <h2 className="label" id="profile-redeem">
          Redeem a code
        </h2>
      </div>
      <div className="housing__body">
        <div className="redeem">
          <input
            className="input redeem__input"
            value={typed}
            maxLength={20}
            placeholder="XXXX-XXXX-XX"
            aria-label="Redemption code"
            onChange={(event) => setTyped(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                send();
              }
            }}
          />
          <button
            type="button"
            className={`slab${busy ? " is-busy" : ""}`}
            disabled={busy}
            onClick={send}
          >
            Redeem
          </button>
        </div>
        {said === null ? (
          <p className="panel__note">Codes come from the Discord. Each works once per player.</p>
        ) : (
          <p className="panel__note">{said}</p>
        )}
      </div>
    </section>
  );
}
