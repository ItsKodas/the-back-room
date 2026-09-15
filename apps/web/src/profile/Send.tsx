import { useCallback, useEffect, useState } from "react";
import { Avatar } from "../game/Avatar.js";

/**
 * Paying another player.
 *
 * Two steps, and the second one is the point of the arrangement: you search a
 * name, then you pick a *person*. A Discord display name is not unique and two
 * players can share one, so the thing that gets paid is the id behind a face
 * you picked rather than the letters you typed. Sending chips to the wrong Ada
 * is not something the room can undo.
 *
 * Every rule shown here is enforced by the server as well, and that is the
 * arrangement rather than a duplication to tidy away: hiding a control is a
 * courtesy, refusing the request is the rule.
 */

interface Found {
  id: string;
  name: string;
  avatar: string | null;
  accentColor: number | null;
}

export interface TransferRow {
  id: string;
  fromId: string;
  fromName: string;
  toId: string;
  toName: string;
  amount: number;
  at: number;
}

const fmt = (n: number) => n.toLocaleString("en-US");

/** The shortest search the room will answer, matching the server. */
const MIN_SEARCH = 2;

export function Send({
  meId,
  chips,
  onSent,
}: {
  meId: string;
  chips: number;
  /** Called once chips have actually moved, so the page can catch up. */
  onSent: (balance: number) => void;
}) {
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<Found[]>([]);
  const [picked, setPicked] = useState<Found | null>(null);
  const [amount, setAmount] = useState("");
  const [said, setSaid] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ledger, setLedger] = useState<TransferRow[]>([]);
  const [leftToday, setLeftToday] = useState<number | null>(null);

  const load = useCallback(() => {
    void fetch("/api/transfers", { credentials: "include" })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { transfers: TransferRow[]; leftToday: number } | null) => {
        if (body !== null) {
          setLedger(body.transfers);
          setLeftToday(body.leftToday);
        }
      })
      .catch(() => {
        // A ledger that will not load is not a reason to refuse to pay anybody.
      });
  }, []);

  useEffect(load, [load]);

  /*
   * Searching is debounced and cancelled by whatever comes after it. Without
   * the guard, a slow answer to "ad" can land after a fast answer to "adam"
   * and put the wrong list of people under somebody's cursor — which here is a
   * list of people they might pay.
   */
  useEffect(() => {
    const wanted = query.trim();
    if (picked !== null || wanted.length < MIN_SEARCH) {
      setFound([]);
      return;
    }
    let alive = true;
    const timer = setTimeout(() => {
      void fetch(`/api/players?q=${encodeURIComponent(wanted)}`, { credentials: "include" })
        .then((response) => (response.ok ? response.json() : { players: [] }))
        .then((body: { players?: Found[] }) => {
          if (alive) {
            setFound(body.players ?? []);
          }
        })
        .catch(() => {
          if (alive) {
            setFound([]);
          }
        });
    }, 220);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [query, picked]);

  const send = () => {
    const sending = Number(amount);
    if (picked === null) {
      setSaid("Pick who to pay.");
      return;
    }
    if (!Number.isFinite(sending) || !Number.isInteger(sending) || sending < 1) {
      setSaid("That is not an amount of chips.");
      return;
    }
    if (sending > chips) {
      setSaid("You do not have that many.");
      return;
    }
    setBusy(true);
    setSaid(null);
    void fetch("/api/send", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ toId: picked.id, amount: sending }),
    })
      .then(async (response) => ({ ok: response.ok, body: await response.json() }))
      .then(({ ok, body }: { ok: boolean; body: Record<string, unknown> }) => {
        if (!ok) {
          setSaid(String(body["error"] ?? "That was refused."));
          if (typeof body["leftToday"] === "number") {
            setLeftToday(body["leftToday"]);
          }
          return;
        }
        setSaid(`Sent ${fmt(Number(body["amount"]))} to ${picked.name}.`);
        setLeftToday(Number(body["leftToday"]));
        onSent(Number(body["balance"]));
        setPicked(null);
        setQuery("");
        setAmount("");
        load();
      })
      .catch(() => setSaid("Could not reach the room."))
      .finally(() => setBusy(false));
  };

  return (
    <>
      <section className="housing" aria-labelledby="send-title">
        <div className="housing__head">
          <h2 className="label" id="send-title">
            Send chips
          </h2>
        </div>
        <div className="housing__body">
          {picked === null ? (
            <>
              <label className="entry">
                <span className="label">Who to pay</span>
                <input
                  className="input"
                  value={query}
                  placeholder="Their name"
                  onChange={(event) => setQuery(event.target.value)}
                />
              </label>
              {query.trim().length >= MIN_SEARCH && found.length === 0 ? (
                <p className="panel__note">Nobody by that name.</p>
              ) : null}
              <ul className="send__found">
                {found.map((person) => (
                  <li key={person.id}>
                    <button
                      type="button"
                      className="send__person"
                      onClick={() => {
                        setPicked(person);
                        setSaid(null);
                      }}
                    >
                      <Avatar
                        name={person.name}
                        avatar={person.avatar}
                        accentColor={person.accentColor}
                        className="send__face"
                      />
                      <span>{person.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
              <p className="panel__note">
                Names are not unique here, so check the face before you send anything. Chips do
                not come back.
              </p>
            </>
          ) : (
            <>
              <div className="send__picked">
                <Avatar
                  name={picked.name}
                  avatar={picked.avatar}
                  accentColor={picked.accentColor}
                  className="send__face"
                />
                <span className="send__name">{picked.name}</span>
                <button type="button" className="quiet" onClick={() => setPicked(null)}>
                  Change
                </button>
              </div>
              <label className="entry">
                <span className="label">How many chips</span>
                <input
                  className="input"
                  value={amount}
                  inputMode="numeric"
                  placeholder="500"
                  onChange={(event) => setAmount(event.target.value)}
                />
              </label>
              <button
                type="button"
                className={`slab slab--wide${busy ? " is-busy" : ""}`}
                disabled={busy}
                onClick={send}
              >
                {busy ? "Sending…" : `Send to ${picked.name}`}
              </button>
            </>
          )}

          {leftToday === null ? null : (
            <p className="panel__note">
              {leftToday > 0
                ? `${fmt(leftToday)} left to send today.`
                : "You have sent all you can today."}
            </p>
          )}
          {said === null ? null : <p className="panel__note">{said}</p>}
        </div>
      </section>

      <section className="housing" aria-labelledby="send-history">
        <div className="housing__head">
          <h2 className="label" id="send-history">
            Chips sent and received
          </h2>
        </div>
        <div className="housing__body">
          {ledger.length === 0 ? (
            <p className="panel__note">Nothing yet.</p>
          ) : (
            <div className="scroller">
              <table className="history">
                <thead>
                  <tr>
                    <th>Who</th>
                    <th className="history__num">Chips</th>
                  </tr>
                </thead>
                <tbody>
                  {ledger.map((row) => {
                    const mine = row.fromId === meId;
                    return (
                      <tr key={row.id}>
                        <td>{mine ? `To ${row.toName}` : `From ${row.fromName}`}</td>
                        <td className={`history__num ${mine ? "down" : "up"}`}>
                          {mine ? "−" : "+"}
                          {fmt(row.amount)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </>
  );
}
