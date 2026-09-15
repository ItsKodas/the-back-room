import type { ChatMessage } from "@backroom/shared";
import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Seg } from "../fittings/Seg.js";
import { Chat } from "./Chat.js";

const SHEET_ID = "table-talk";

/**
 * Whether table talk is open, and how much somebody else has said since this
 * player last had it open.
 *
 * Counted from what arrived while it was shut rather than kept as a flag, so
 * the key can say "3" instead of only "something". Your own lines are not news
 * to you and are left out.
 */
export function useTalk(log: readonly ChatMessage[], seatId: string | null) {
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState(log.length);

  useEffect(() => {
    if (open) {
      setSeen(log.length);
    }
  }, [open, log.length]);

  // A log shorter than what was seen is a different table's, so start over.
  const since = seen > log.length ? 0 : seen;
  const unread = open ? 0 : log.slice(since).filter((message) => message.seatId !== seatId).length;

  const toggle = useCallback(() => setOpen((was) => !was), []);
  const close = useCallback(() => setOpen(false), []);
  return { open, unread, toggle, close };
}

/** The key on the bar that opens talk, carrying the unread count. */
export function TalkKey({
  open,
  unread,
  onToggle,
}: {
  open: boolean;
  unread: number;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className="key key--icon talk-key"
      aria-expanded={open}
      aria-controls={SHEET_ID}
      aria-label={unread > 0 ? `Table talk, ${unread} unread` : "Table talk"}
      onClick={onToggle}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M4 5h16v11H9l-5 4z" />
      </svg>
      {unread > 0 && !open ? (
        <span className="talk-key__count" aria-hidden="true">
          {unread > 9 ? "9+" : unread}
        </span>
      ) : null}
    </button>
  );
}

/**
 * Table talk, as a sheet over the table rather than a panel under it.
 *
 * A panel beside the felt was a quarter of a phone spent on something most
 * turns nobody is using. Opened, it stops short of the lanes, so the race is
 * still in view while you type.
 */
export function TalkSheet({
  open,
  onClose,
  log,
  seatId,
  onSay,
  activity,
}: {
  open: boolean;
  onClose: () => void;
  log: ChatMessage[];
  seatId: string | null;
  onSay: (text: string) => void;
  /** The table's activity log, as the sheet's second tab. */
  activity?: ReactNode;
}) {
  const panel = useRef<HTMLDivElement | null>(null);
  // Talk first: it is what the key on the bar is named for and counts.
  const [tab, setTab] = useState<"talk" | "activity">("talk");

  useEffect(() => {
    if (!open) {
      return;
    }
    panel.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      // Back to the key that opened it, so a keyboard is not left nowhere.
      document.querySelector<HTMLElement>(`[aria-controls="${SHEET_ID}"]`)?.focus();
    };
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  return (
    <>
      <button
        type="button"
        className="talk__scrim"
        tabIndex={-1}
        aria-label="Close table talk"
        onClick={onClose}
      />
      <div id={SHEET_ID} className="talk" role="dialog" aria-label="Table talk" ref={panel} tabIndex={-1}>
        <div className="talk__head">
          {activity === undefined ? (
            <h2 className="talk__title">Table talk</h2>
          ) : (
            <Seg
              label="Talk or activity"
              options={[
                { value: "talk", text: "Talk" },
                { value: "activity", text: "Activity" },
              ]}
              value={tab}
              onChange={setTab}
            />
          )}
          <button type="button" className="key key--icon" aria-label="Close table talk" onClick={onClose}>
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        {activity !== undefined && tab === "activity" ? (
          <div className="talk__activity">{activity}</div>
        ) : (
          <Chat log={log} seatId={seatId} onSay={onSay} />
        )}
      </div>
    </>
  );
}

/**
 * The same talk, standing on the page rather than laid over a table.
 *
 * A lobby has the room for it, and nothing there to cover, so it is a panel
 * — but in the sheet's own dress, so talk looks like one thing from the lobby
 * to the felt.
 */
export function TalkPanel({
  log,
  seatId,
  onSay,
}: {
  log: ChatMessage[];
  seatId: string | null;
  onSay: (text: string) => void;
}) {
  return (
    // A plain box rather than a second region: the chat inside already is one,
    // named "Table talk", and two landmarks of the same name is noise to a
    // screen reader.
    <div className="housing talk-panel">
      <div className="housing__head">
        <h2 className="label">Table talk</h2>
      </div>
      <Chat log={log} seatId={seatId} onSay={onSay} />
    </div>
  );
}
