import { useCallback, useEffect, useState } from "react";
import { Emotes } from "./Emotes.js";
import { useAccount } from "../game/useAccount.js";
import { Navbar } from "../nav/Navbar.js";

interface Code {
  code: string;
  chips: number;
  maxRedemptions: number | null;
  redemptions: number;
  expiresAt: number | null;
  note: string;
  createdAt: number;
  revoked: boolean;
}

const fmt = (n: number) => n.toLocaleString("en-US");

/**
 * The code desk.
 *
 * Reachable only by the Discord ids in the allowlist, and invisible to anyone
 * else — the server answers "not found" rather than "not allowed", so whether
 * this page exists is not something a visitor learns by asking.
 */
export function Admin() {
  const account = useAccount();
  const [codes, setCodes] = useState<Code[] | null>(null);
  const [allowed, setAllowed] = useState<boolean | null>(null);

  const load = useCallback(() => {
    void fetch("/api/admin/codes", { credentials: "include" })
      .then((response) => {
        setAllowed(response.ok);
        return response.ok ? response.json() : null;
      })
      .then((body: { codes: Code[] } | null) => {
        if (body !== null) {
          setCodes(body.codes);
        }
      })
      .catch(() => setAllowed(false));
  }, []);

  useEffect(load, [load]);

  return (
    <main className="room">
      <Navbar account={account} />

      {allowed === null ? null : allowed ? (
        <div className="profile">
          {BANKS.map((bank) => (
            <Bank key={bank.game} game={bank.game} label={bank.label} per={bank.per} />
          ))}
          <Mint onMinted={load} />
          <Emotes />
          <section className="panel">
            <p className="panel__label">Codes</p>
            {codes === null || codes.length === 0 ? (
              <p className="panel__note">None minted yet.</p>
            ) : (
              <div className="scroller">
                <table className="history">
                  <thead>
                    <tr>
                      <th>Code</th>
                      <th>For</th>
                      <th className="history__num">Chips</th>
                      <th className="history__num">Used</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {codes.map((entry) => (
                      <Row key={entry.code} entry={entry} onRevoked={load} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      ) : (
        <p className="not-found">No such page.</p>
      )}
    </main>
  );
}

/**
 * A game's bank.
 *
 * The only way chips enter one from outside play, which is why it sits behind
 * the same allowlist as minting a code: it is the same power. It is a
 * deliberate act rather than something automatic because an empty bank offers
 * a stake of zero — a game cannot open itself, and somebody has to strike the
 * match.
 */
/**
 * The games that keep a bank, and what each calls the thing it deals.
 *
 * Every bank the economy keeps has to be here, and the wheel's was missing for
 * a while: the store held it, the route served it and the felt asked it for
 * headroom — there was simply no panel to put the first chips in, and a bank
 * at zero refuses every bet on the cloth. `Admin.test.tsx` holds this list
 * against the economy's own now.
 *
 * The wording stays here rather than being read off that list, because it is
 * the wording that has to be the game's own: a machine takes a stake on a
 * spin, a felt on a hand, and a wheel's cap is what one chip may sit on a
 * single number for.
 */
export const BANKS = [
  { game: "slots", label: "Slots", per: "a spin" },
  { game: "blackjack", label: "Blackjack", per: "a hand" },
  { game: "roulette", label: "Roulette", per: "straight up" },
  { game: "two-up", label: "Two-up", per: "a five-odds chip" },
] as const;

function Bank({ game, label, per }: { game: string; label: string; per: string }) {
  const [held, setHeld] = useState<{ bank: number; maxStake: number } | null>(null);
  const [amount, setAmount] = useState("50000");
  const [said, setSaid] = useState<string | null>(null);

  const load = useCallback(() => {
    void fetch(`/api/admin/bank?game=${game}`, { credentials: "include" })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { bank: number; maxStake: number } | null) => setHeld(body))
      .catch(() => setHeld(null));
  }, [game]);

  useEffect(load, [load]);

  const float = () => {
    const chips = Number(amount);
    if (!Number.isFinite(chips) || chips < 1) {
      setSaid("Give it an amount.");
      return;
    }
    void fetch("/api/admin/bank", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ amount: Math.floor(chips), game }),
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { bank: number; maxStake: number } | null) => {
        if (body === null) {
          setSaid("That was refused.");
          return;
        }
        setHeld(body);
        setSaid(`Bank now holds ${fmt(body.bank)}.`);
      })
      .catch(() => setSaid("Could not reach the room."));
  };

  return (
    <section className="panel">
      <p className="panel__label">{label} bank</p>
      {held === null ? (
        <p className="panel__note">Could not read it.</p>
      ) : (
        <p className="bank__held">
          <strong className="code__chips">{fmt(held.bank)}</strong>
          <span className="panel__note">
            {held.maxStake < 1
              ? `Empty, so ${label.toLowerCase()} will not take a stake at all.`
              : `Covers a stake of ${fmt(held.maxStake)} ${per}.`}
          </span>
        </p>
      )}
      <label className="field">
        <span className="field__label">Add a float</span>
        <input
          className="field__input"
          value={amount}
          inputMode="numeric"
          onChange={(event) => setAmount(event.target.value)}
        />
      </label>
      <button type="button" className="btn btn--wide" onClick={float}>
        Put it in the bank
      </button>
      <p className="panel__note">
        Players fill this from then on, chip for chip, and every win comes back out of it. This
        is the only other way in. Each game keeps its own — a shared one would be whichever game
        keeps the most quietly paying for the one that keeps the least.
      </p>
      {said === null ? null : <p className="panel__note">{said}</p>}
    </section>
  );
}

function Row({ entry, onRevoked }: { entry: Code; onRevoked: () => void }) {
  const used =
    entry.maxRedemptions === null
      ? fmt(entry.redemptions)
      : `${fmt(entry.redemptions)} of ${fmt(entry.maxRedemptions)}`;

  return (
    <tr className={entry.revoked ? "code--dead" : undefined}>
      <td className="history__code">{entry.code}</td>
      <td>{entry.revoked ? `${entry.note} — revoked` : entry.note}</td>
      <td className="history__num code__chips">{fmt(entry.chips)}</td>
      <td className="history__num">{used}</td>
      <td className="history__num">
        {entry.revoked ? null : (
          <button
            type="button"
            className="btn btn--ghost btn--small"
            onClick={() => {
              void fetch(`/api/admin/codes/${entry.code}/revoke`, {
                method: "POST",
                credentials: "include",
              }).then(onRevoked);
            }}
          >
            Revoke
          </button>
        )}
      </td>
    </tr>
  );
}

function Mint({ onMinted }: { onMinted: () => void }) {
  const [chips, setChips] = useState("5000");
  const [uses, setUses] = useState("");
  const [note, setNote] = useState("");
  const [said, setSaid] = useState<string | null>(null);

  const mint = () => {
    const amount = Number(chips);
    if (!Number.isFinite(amount) || amount < 1) {
      setSaid("Give it an amount worth redeeming.");
      return;
    }
    void fetch("/api/admin/codes", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chips: Math.floor(amount),
        // Blank means anyone, once each — the campaign case.
        maxRedemptions: uses.trim() === "" ? null : Math.floor(Number(uses)),
        note,
      }),
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { code: Code } | null) => {
        setSaid(body === null ? "That was refused." : `Minted ${body.code.code}`);
        setNote("");
        onMinted();
      })
      .catch(() => setSaid("Could not reach the room."));
  };

  return (
    <section className="panel">
      <p className="panel__label">New code</p>
      <label className="field">
        <span className="field__label">Chips</span>
        <input
          className="field__input"
          value={chips}
          inputMode="numeric"
          onChange={(event) => setChips(event.target.value)}
        />
      </label>
      <label className="field">
        <span className="field__label">How many people (blank for anyone, once each)</span>
        <input
          className="field__input"
          value={uses}
          inputMode="numeric"
          placeholder="anyone"
          onChange={(event) => setUses(event.target.value)}
        />
      </label>
      <label className="field">
        <span className="field__label">What it is for</span>
        <input
          className="field__input"
          value={note}
          maxLength={120}
          placeholder="Launch weekend"
          onChange={(event) => setNote(event.target.value)}
        />
      </label>
      <button type="button" className="btn btn--wide" onClick={mint}>
        Mint code
      </button>
      {said === null ? null : <p className="panel__note">{said}</p>}
    </section>
  );
}
