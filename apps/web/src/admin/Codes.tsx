import { useCallback, useEffect, useState } from "react";
import { adminGet, adminPost, fmt } from "./api.js";

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

export function Codes() {
  const [codes, setCodes] = useState<Code[] | null>(null);

  const load = useCallback(() => {
    // Left as null on a refusal or no connection, same as `codes` starts —
    // so a failed read still reads "Could not read it." rather than settling
    // on an empty list and telling an admin there is nothing here to see.
    void adminGet<{ codes: Code[] }>("/api/admin/codes").then((body) => setCodes(body?.codes ?? null));
  }, []);

  useEffect(load, [load]);

  return (
    <>
      <Mint onMinted={load} />
      <section className="panel">
        <p className="panel__label">Codes</p>
        {codes === null ? (
          <p className="panel__note">Could not read it.</p>
        ) : codes.length === 0 ? (
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
    </>
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
              void adminPost(`/api/admin/codes/${entry.code}/revoke`, {}).then(onRevoked);
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
    // Blank means anyone, once each — the campaign case. Anything else has to
    // be a whole number said on purpose: a typo like "1o" is NaN, which
    // JSON sends as null, and null is exactly "anyone" — an uncapped code.
    const people = uses.trim();
    if (people !== "" && !/^\d+$/.test(people)) {
      setSaid("People must be a whole number, 1 or more — or blank for anyone.");
      return;
    }
    const cap = people === "" ? null : Number(people);
    if (cap !== null && cap < 1) {
      setSaid("People must be a whole number, 1 or more — or blank for anyone.");
      return;
    }
    void adminPost<{ code: Code }>("/api/admin/codes", {
      chips: Math.floor(amount),
      maxRedemptions: cap,
      note,
    }).then((answer) => {
      setSaid(answer.ok ? `Minted ${answer.body.code.code}` : answer.error);
      setNote("");
      onMinted();
    });
  };

  return (
    <section className="panel">
      <p className="panel__label">New code</p>
      <form
        className="desk__row"
        onSubmit={(event) => {
          event.preventDefault();
          mint();
        }}
      >
        <label className="field">
          <span className="field__label">Chips</span>
          <input className="field__input" value={chips} inputMode="numeric" onChange={(event) => setChips(event.target.value)} />
        </label>
        <label className="field">
          <span className="field__label">People (blank: anyone, once each)</span>
          <input className="field__input" value={uses} inputMode="numeric" placeholder="anyone" onChange={(event) => setUses(event.target.value)} />
        </label>
        <label className="field desk__grow">
          <span className="field__label">What it is for</span>
          <input className="field__input" value={note} maxLength={120} placeholder="Launch weekend" onChange={(event) => setNote(event.target.value)} />
        </label>
        <button type="submit" className="btn">Mint</button>
      </form>
      {said === null ? null : <p className="panel__note" role="status">{said}</p>}
    </section>
  );
}
