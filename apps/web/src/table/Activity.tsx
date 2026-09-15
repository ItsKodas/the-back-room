import { useEffect, useRef, useState } from "react";

/** One thing the table said happened. */
export interface ActivityEntry {
  id: number;
  at: number;
  text: string;
}

/** Enough of an evening to scroll back through, and no more. */
const KEEP = 100;

/**
 * What a table says, as a log: which table, its latest line, and a counter that
 * moves on with every action it reports. The counter is what tells the same
 * words twice running ("Koda rolled 5") apart from one broadcast sent twice.
 */
export interface ActivitySource {
  code: string;
  text: string | null;
  seq: number;
}

/**
 * Everything the table has said happened, oldest first.
 *
 * The server only ever sends the latest line, so the history is kept here as
 * lines arrive. A line is new when its words change, or when the counter moves
 * on. The counter starting again (a new turn, at Greed) is not an action, so it
 * adds nothing. A different table is a different log.
 */
export function useActivity(source: ActivitySource | null): ActivityEntry[] {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const last = useRef<{ code: string; text: string | null; seq: number } | null>(null);
  const nextId = useRef(1);
  // Taken apart so a caller building a fresh object each render does not make
  // every render look like news.
  const code = source?.code ?? null;
  const text = source?.text ?? null;
  const seq = source?.seq ?? 0;

  useEffect(() => {
    if (code === null) {
      last.current = null;
      setEntries([]);
      return;
    }
    const prev = last.current;
    last.current = { code, text, seq };

    const sameTable = prev !== null && prev.code === code;
    if (!sameTable) {
      setEntries([]);
    }
    if (text === null) {
      return;
    }
    if (sameTable && prev.text === text && seq <= prev.seq) {
      return;
    }
    const entry = { id: nextId.current, at: Date.now(), text };
    nextId.current += 1;
    setEntries((list) => [...(sameTable ? list : []), entry].slice(-KEEP));
  }, [code, text, seq]);

  return entries;
}

const clock = (at: number) => new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

/**
 * The log itself. Newest at the bottom, where the eye reads to, and kept
 * scrolled there as lines arrive — inside its own box, never the page.
 */
export function ActivityLog({ entries }: { entries: readonly ActivityEntry[] }) {
  const list = useRef<HTMLOListElement | null>(null);

  // A new line is the trigger; the array itself is new on every update.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the count is the real trigger
  useEffect(() => {
    const box = list.current;
    if (box !== null) {
      box.scrollTop = box.scrollHeight;
    }
  }, [entries.length]);

  return (
    <ol className="activity" aria-label="Activity" ref={list}>
      {entries.length === 0 ? (
        <li className="activity__quiet">Nothing has happened yet.</li>
      ) : (
        entries.map((entry) => (
          <li key={entry.id} className="activity__line">
            <time className="activity__at" dateTime={new Date(entry.at).toISOString()}>
              {clock(entry.at)}
            </time>
            <span>{entry.text}</span>
          </li>
        ))
      )}
    </ol>
  );
}
