import { useEffect, useState } from "react";
import { adminGet, fmt } from "./api.js";

/** `AdminLogEntry`, as the page receives it. Redeclared: this bundle cannot import the economy. */
export interface LogEntry {
  id: string;
  at: number;
  by: string;
  byName: string;
  kind: "add" | "remove" | "set" | "reset" | "float" | "empty-banks" | "delete-emote";
  amount: number;
  affected: number;
  target: "all" | string[];
  parts: string[] | null;
  subject: string | null;
  note: string;
}

const PAGE = 50;

function whom(entry: LogEntry): string {
  if (entry.target === "all") {
    return `everyone (${fmt(entry.affected)})`;
  }
  return entry.affected === 1 ? "1 player" : `${fmt(entry.affected)} players`;
}

function list(words: string[]): string {
  return words.length < 2 ? words.join("") : `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`;
}

/** One act, said the way somebody would say what they did. */
export function describeEntry(entry: LogEntry): string {
  const chips = `${fmt(entry.amount)} chips`;
  switch (entry.kind) {
    case "add":
      return `Gave ${chips} to ${whom(entry)}`;
    case "remove":
      return `Took ${chips} from ${whom(entry)}`;
    case "set":
      return entry.target === "all"
        ? `Set everyone's balance to ${chips} (${fmt(entry.affected)})`
        : `Set ${whom(entry)}'s balance to ${chips}`;
    case "reset":
      return `Reset ${list(entry.parts ?? [])} for ${whom(entry)}`;
    case "float":
      return `Floated ${chips} into the ${entry.subject ?? "unknown"} bank`;
    case "empty-banks":
      return `Emptied the banks of ${chips}`;
    case "delete-emote":
      return `Deleted the emote ${entry.subject ?? ""}`.trim();
  }
}

const when = (at: number) =>
  new Date(at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export function Log() {
  const [entries, setEntries] = useState<LogEntry[] | null>(null);
  // A read that failed and a read that has not landed yet both leave
  // `entries` null, so this is what tells them apart: without it, a broken
  // log and an empty one both say "Nothing yet.", which is a lie the first
  // way — the log is not empty, it just could not be read.
  const [failed, setFailed] = useState(false);
  const [more, setMore] = useState(false);
  // A failed "Load older" does not touch `entries` — the page already shown
  // stays put — so this is its own flag rather than reusing `failed`.
  const [olderFailed, setOlderFailed] = useState(false);
  // Guards a second press while the first page is still in flight: two
  // requests for the same `before` both append, and the page comes back
  // twice. Checked and set before the fetch goes out, not after it lands, so
  // a second press arriving before the first response does too is refused
  // rather than merely discouraged.
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    void adminGet<{ entries: LogEntry[] }>("/api/admin/log").then((body) => {
      setFailed(body === null);
      setEntries(body === null ? null : body.entries);
      setMore(body !== null && body.entries.length === PAGE);
    });
  }, []);

  const older = () => {
    if (loadingMore) {
      return;
    }
    const last = entries?.at(-1);
    if (last === undefined) {
      return;
    }
    setOlderFailed(false);
    setLoadingMore(true);
    // The id as well as the time: two acts can share a millisecond, and the
    // time alone would skip whichever fell on the far side of this page.
    void adminGet<{ entries: LogEntry[] }>(
      `/api/admin/log?before=${last.at}&beforeId=${encodeURIComponent(last.id)}`,
    )
      .then((body) => {
        if (body === null) {
          // The server's refusal, not a quiet stop: the entries already on
          // screen are kept exactly as they were.
          setOlderFailed(true);
          return;
        }
        setEntries((current) => [...(current ?? []), ...body.entries]);
        setMore(body.entries.length === PAGE);
      })
      .finally(() => setLoadingMore(false));
  };

  return (
    <section className="housing" aria-labelledby="log-title">
      <div className="housing__head">
        <h2 className="label" id="log-title">
          What has been done
        </h2>
      </div>
      <div className="housing__body">
        {entries === null ? (
          <p className="panel__note">{failed ? "Could not read the log." : "Loading…"}</p>
        ) : entries.length === 0 ? (
          <p className="panel__note">Nothing yet.</p>
        ) : (
          <ul className="desk__log">
            {entries.map((entry) => (
              <li key={entry.id} className="desk__log-line">
                <span className="desk__log-what">{describeEntry(entry)}</span>
                <span className="desk__log-who">
                  {entry.byName} · {when(entry.at)}
                </span>
                {entry.note === "" ? null : <span className="desk__log-note">{entry.note}</span>}
              </li>
            ))}
          </ul>
        )}
        {more ? (
          <div className="desk__buttons">
            <button type="button" className="key key--small" disabled={loadingMore} onClick={older}>
              {loadingMore ? "Loading…" : "Load older"}
            </button>
          </div>
        ) : null}
        {olderFailed ? (
          <p className="panel__note desk__bad" role="status">
            Could not load older entries.
          </p>
        ) : null}
      </div>
    </section>
  );
}
