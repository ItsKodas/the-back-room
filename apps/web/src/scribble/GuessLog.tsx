import type { TableView } from "@backroom/game-scribble";
import { normalise } from "@backroom/game-scribble";
import type { ChatMessage } from "@backroom/shared";
import { useEffect, useRef, useState } from "react";

/* Long enough for a slow connection, short enough that a lost guess does not sit there forever. */
export const PENDING_MS = 8_000;

interface Pending {
  id: number;
  text: string;
}

function Line({ message, seatId }: { message: ChatMessage; seatId: string | null }) {
  const mine = message.seatId === seatId;
  const who = <span className={`sc-log__who${mine ? " sc-log__who--you" : ""}`}>{mine ? "You" : message.name}</span>;
  switch (message.kind) {
    case "got":
      // The table sends "got it" and never the word: the name is all there is to show.
      return <li className="sc-log__got">{mine ? "You got it" : `${message.name} got it`}</li>;
    case "close":
      return (
        <li className="sc-log__close">
          <b>{message.text}</b>: you're close. Only you see this.
        </li>
      );
    case "pair":
      return (
        <li className="sc-log__pair">
          {who}
          {message.text}
        </li>
      );
    case "aside":
      return (
        <li className="sc-log__aside">
          {who}
          {message.text}
        </li>
      );
    default:
      return (
        <li>
          {who}
          {message.text}
        </li>
      );
  }
}

export function GuessLog({
  log,
  seatId,
  state,
  error,
  onSay,
}: {
  log: ChatMessage[];
  seatId: string | null;
  state: TableView;
  error: string | null;
  onSay: (text: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<Pending[]>([]);
  const next = useRef(0);
  const read = useRef(log.length);
  const list = useRef<HTMLUListElement | null>(null);

  // A line of yours coming back from the table replaces the guess shown for it.
  useEffect(() => {
    const fresh = log.slice(read.current);
    read.current = log.length;
    for (const message of fresh) {
      if (message.seatId !== seatId) {
        continue;
      }
      setPending((waiting) => {
        const at =
          message.kind === "got" ? 0 : waiting.findIndex((one) => normalise(one.text) === normalise(message.text));
        return at === -1 || waiting.length === 0 ? waiting : waiting.filter((_, index) => index !== at);
      });
    }
  }, [log, seatId]);

  useEffect(() => {
    if (error !== null) {
      setPending([]);
    }
  }, [error]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: a new line is the trigger, not its contents
  useEffect(() => {
    list.current?.scrollTo?.({ top: list.current.scrollHeight });
  }, [log.length, pending.length]);

  const you = state.you;
  const live = state.phase === "picking" || state.phase === "drawing";
  const drawer = live && you?.drawing === true;
  const partner = drawer ? (state.seats.find((one) => one.drawing && one.id !== seatId)?.name ?? null) : null;

  const send = () => {
    const text = draft.trim();
    if (text.length === 0) {
      return;
    }
    const id = next.current;
    next.current += 1;
    setPending((waiting) => [...waiting, { id, text }]);
    setTimeout(() => setPending((waiting) => waiting.filter((one) => one.id !== id)), PENDING_MS);
    onSay(text);
    setDraft("");
  };

  const placeholder =
    partner !== null
      ? `Say something to ${partner}`
      : you?.guessed
        ? "Talk to everyone who's got it"
        : state.phase === "drawing"
          ? "Type your guess"
          : "Say something";

  return (
    <section className="housing sc-guesses" aria-label="Guesses">
      <header className="housing__head">
        <span className="label">{live ? "Guesses" : "Table talk"}</span>
      </header>
      <div className="housing__body">
        <ul className="sc-log" ref={list}>
          {log.map((message) => (
            <Line key={`${message.at}-${message.seatId}-${message.text}`} message={message} seatId={seatId} />
          ))}
          {pending.map((one) => (
            <li key={`pending-${one.id}`} className="sc-log__pending">
              <span className="sc-log__who sc-log__who--you">You</span>
              {one.text}
            </li>
          ))}
        </ul>
        {drawer && partner === null ? (
          <p className="hint">You're drawing. Nothing to type until the word is out.</p>
        ) : (
          <div className="sc-send">
            <input
              className="input"
              id="scribble-guess"
              value={draft}
              maxLength={200}
              placeholder={placeholder}
              aria-label={placeholder}
              autoComplete="off"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  send();
                }
              }}
            />
            <button type="button" className="slab" disabled={draft.trim().length === 0} onClick={send}>
              {state.phase === "drawing" && !drawer && !you?.guessed ? "Guess" : "Send"}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
