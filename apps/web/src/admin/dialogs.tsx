import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { adminPost, fmt } from "./api.js";

export type Who = { all: true } | { ids: string[] };

const PARTS = [
  { id: "balance", label: "Balance", hint: "back to the starting 10,000" },
  { id: "stats", label: "Stats", hint: "totals and every game's figures" },
  { id: "jar", label: "Tip jar", hint: "level, favours and tonight's pay" },
  { id: "history", label: "History", hint: "transfers, redeemed codes, past games" },
] as const;

type Part = (typeof PARTS)[number]["id"];

function whom(count: number | "everyone"): string {
  return count === "everyone" ? "everyone" : count === 1 ? "1 player" : `${fmt(count)} players`;
}

/** What pressing the button will do, said before it is pressed. */
export function chipsSentence(op: "add" | "remove" | "set", amount: number, count: number | "everyone"): string {
  switch (op) {
    case "add":
      return `Give ${fmt(amount)} chips to ${whom(count)}.`;
    case "remove":
      return `Take up to ${fmt(amount)} chips from ${whom(count)}.`;
    case "set":
      return count === "everyone"
        ? `Set everyone's balance to ${fmt(amount)} chips.`
        : `Set ${whom(count)}'s balance to ${fmt(amount)} chips.`;
  }
}

function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const box = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    box.current?.querySelector<HTMLElement>("input, button")?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="desk__scrim">
      {/* A real button rather than a click handler on the backdrop div: it
          takes the dismiss with a press or a keyboard activation for free,
          and never has to guess a click on the dialog wasn't meant for it. */}
      <button type="button" className="desk__scrim-backdrop" aria-label="Close" onClick={onClose} />
      <div ref={box} className="panel desk__dialog" role="dialog" aria-modal="true" aria-label={title}>
        <p className="panel__label">{title}</p>
        {children}
      </div>
    </div>
  );
}

const VERB = { add: "Give", remove: "Take", set: "Set" } as const;
const TITLE = { add: "Give chips", remove: "Take chips", set: "Set balance" } as const;

export function ChipsDialog({
  op,
  who,
  count,
  onClose,
  onDone,
}: {
  op: "add" | "remove" | "set";
  who: Who;
  count: number | "everyone";
  onClose: () => void;
  onDone: () => void;
}) {
  const [amount, setAmount] = useState(op === "set" ? "10000" : "1000");
  const [note, setNote] = useState("");
  const [said, setSaid] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const chips = Math.floor(Number(amount));
  const valid = Number.isFinite(chips) && chips >= (op === "set" ? 0 : 1) && chips <= 10_000_000;

  const go = () => {
    setBusy(true);
    void adminPost<{ affected: number; moved: number }>("/api/admin/chips", {
      op,
      amount: chips,
      target: who,
      note: note.trim(),
    }).then((answer) => {
      setBusy(false);
      if (!answer.ok) {
        setSaid(answer.error);
        return;
      }
      onDone();
    });
  };

  return (
    <Dialog title={TITLE[op]} onClose={onClose}>
      <form
        className="desk__form"
        onSubmit={(event) => {
          event.preventDefault();
          if (valid && !busy) {
            go();
          }
        }}
      >
        <label className="field">
          <span className="field__label">Chips</span>
          <input className="field__input" inputMode="numeric" value={amount} onChange={(event) => setAmount(event.target.value)} />
        </label>
        <label className="field">
          <span className="field__label">Note</span>
          <input className="field__input" maxLength={120} value={note} placeholder="Why" onChange={(event) => setNote(event.target.value)} />
        </label>
        <p className="panel__note">{valid ? chipsSentence(op, chips, count) : "A whole number, up to 10,000,000."}</p>
        {said === null ? null : (
          <p className="panel__note desk__bad" role="alert">
            {said}
          </p>
        )}
        <div className="desk__buttons">
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn" disabled={!valid || busy}>
            {VERB[op]}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function ResetDialog({
  who,
  count,
  onClose,
  onDone,
}: {
  who: Who;
  count: number | "everyone";
  onClose: () => void;
  onDone: () => void;
}) {
  const everyone = "all" in who;
  const [parts, setParts] = useState<Set<Part>>(new Set(["balance"]));
  const [emptyBanks, setEmptyBanks] = useState(false);
  const [typed, setTyped] = useState("");
  const [note, setNote] = useState("");
  const [said, setSaid] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Resetting everybody is the one press on this desk that cannot be taken
  // back by another press, so it asks for more than a click.
  const ready = parts.size > 0 && (!everyone || typed === "RESET") && !busy;

  const flip = (part: Part) => {
    setParts((current) => {
      const next = new Set(current);
      if (next.has(part)) {
        next.delete(part);
      } else {
        next.add(part);
      }
      return next;
    });
  };

  const go = () => {
    setBusy(true);
    void adminPost<{ affected: number }>("/api/admin/reset", {
      target: who,
      parts: PARTS.map((part) => part.id).filter((id) => parts.has(id)),
      ...(everyone ? { emptyBanks } : {}),
      note: note.trim(),
    }).then((answer) => {
      setBusy(false);
      if (!answer.ok) {
        setSaid(answer.error);
        return;
      }
      onDone();
    });
  };

  return (
    <Dialog title={everyone ? "Reset everyone" : `Reset ${whom(count)}`} onClose={onClose}>
      <form
        className="desk__form"
        onSubmit={(event) => {
          event.preventDefault();
          if (ready) {
            go();
          }
        }}
      >
        <fieldset className="desk__parts">
          <legend className="field__label">What to wipe</legend>
          {PARTS.map((part) => (
            <label key={part.id} className="desk__check">
              <input type="checkbox" checked={parts.has(part.id)} onChange={() => flip(part.id)} />
              <span>
                {part.label} <small>{part.hint}</small>
              </span>
            </label>
          ))}
        </fieldset>
        {everyone ? (
          <>
            <label className="desk__check">
              <input
                type="checkbox"
                aria-label="Also empty the banks"
                checked={emptyBanks}
                onChange={(event) => setEmptyBanks(event.target.checked)}
              />
              <span>Also empty the banks</span>
            </label>
            <label className="field">
              <span className="field__label">Type RESET to confirm</span>
              <input className="field__input" value={typed} autoComplete="off" onChange={(event) => setTyped(event.target.value)} />
            </label>
          </>
        ) : null}
        <label className="field">
          <span className="field__label">Note</span>
          <input className="field__input" maxLength={120} value={note} placeholder="Why" onChange={(event) => setNote(event.target.value)} />
        </label>
        <p className="panel__note">Players stay signed in. Nobody seated at a table can be reset until they leave it.</p>
        {said === null ? null : (
          <p className="panel__note desk__bad" role="alert">
            {said}
          </p>
        )}
        <div className="desk__buttons">
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn desk__danger" disabled={!ready}>
            Reset
          </button>
        </div>
      </form>
    </Dialog>
  );
}
