import type { RoomView } from "@backroom/shared";
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
 * Everything the table has said happened, oldest first.
 *
 * The server only ever sends the latest line, so the history is kept here as
 * lines arrive. A line is new when its words change, or when a throw lands —
 * the same words twice running ("Koda rolled 5") are two throws, and the roll
 * counter moving on is what tells them apart. The counter starting again at a
 * new turn is not a throw, so it adds nothing. A different table is a
 * different log.
 */
export function useActivity(room: RoomView | null): ActivityEntry[] {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const last = useRef<{ code: string; text: string | null; seq: number } | null>(null);
  const nextId = useRef(1);

  useEffect(() => {
    if (room === null) {
      last.current = null;
      setEntries([]);
      return;
    }
    const seq = room.turn?.rollSeq ?? 0;
    const prev = last.current;
    last.current = { code: room.code, text: room.lastEvent, seq };

    const sameTable = prev !== null && prev.code === room.code;
    if (!sameTable) {
      setEntries([]);
    }
    if (room.lastEvent === null) {
      return;
    }
    if (sameTable && prev.text === room.lastEvent && seq <= prev.seq) {
      return;
    }
    const entry = { id: nextId.current, at: Date.now(), text: room.lastEvent };
    nextId.current += 1;
    setEntries((list) => [...(sameTable ? list : []), entry].slice(-KEEP));
  }, [room]);

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
