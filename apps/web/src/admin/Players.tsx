import { useCallback, useEffect, useState } from "react";
import { Avatar } from "../game/Avatar.js";
import { adminGet, fmt } from "./api.js";
import { ChipsDialog, ResetDialog } from "./dialogs.js";
import type { Who } from "./dialogs.js";

interface Row {
  id: string;
  name: string;
  avatar: string | null;
  accentColor: number | null;
  chips: number;
  rounds: number;
  createdAt: number;
}

const PAGE = 50;

type Open =
  | { kind: "add" | "remove" | "set"; who: Who; count: number | "everyone" }
  | { kind: "reset"; who: Who; count: number | "everyone" }
  | null;

const joined = (at: number) =>
  at > 0 ? new Date(at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—";

/**
 * Everybody with an account, and what an admin may do to them.
 *
 * Selection is by id and survives paging and searching, so an admin can
 * gather a handful of people from different pages and act on them once.
 */
export function Players() {
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<{ rows: Row[]; total: number } | null>(null);
  // A read that failed and a read that has not landed yet both leave `page`
  // null, so this is what tells them apart: without it, a 500 from the
  // server and an empty room read the same — "Nobody by that name." — which
  // is a lie the first time and merely unhelpful the second.
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState<Map<string, string>>(new Map());
  const [open, setOpen] = useState<Open>(null);
  const [said, setSaid] = useState<string | null>(null);

  const load = useCallback(() => {
    const q = encodeURIComponent(query.trim());
    void adminGet<{ rows: Row[]; total: number }>(`/api/admin/users?q=${q}&offset=${offset}`).then((body) => {
      if (body === null) {
        setFailed(true);
        setPage(null);
      } else {
        setFailed(false);
        setPage(body);
      }
    });
  }, [query, offset]);

  useEffect(load, [load]);

  const toggle = (row: Row) => {
    setSelected((current) => {
      const next = new Map(current);
      if (next.has(row.id)) {
        next.delete(row.id);
      } else {
        next.set(row.id, row.name);
      }
      return next;
    });
  };

  const picked: Who = { ids: [...selected.keys()] };
  const close = () => setOpen(null);
  const done = (what: string) => () => {
    setOpen(null);
    setSaid(what);
    load();
  };

  return (
    <>
      <div className="desk__row desk__players-head">
        <label className="entry desk__grow">
          <span className="label">Find a player</span>
          <input
            className="input"
            type="search"
            value={query}
            placeholder="Name"
            onChange={(event) => {
              setQuery(event.target.value);
              setOffset(0);
            }}
          />
        </label>
        <button type="button" className="key" onClick={() => setOpen({ kind: "add", who: { all: true }, count: "everyone" })}>
          Give everyone…
        </button>
        <button
          type="button"
          className="key key--danger"
          onClick={() => setOpen({ kind: "reset", who: { all: true }, count: "everyone" })}
        >
          Reset everyone…
        </button>
      </div>

      {said === null ? null : (
        <p className="panel__note" role="status">
          {said}
        </p>
      )}

      <section className="housing">
        <div className="housing__body">
          {page === null ? (
            <p className="panel__note">{failed ? "Could not read the players." : "Loading…"}</p>
          ) : page.rows.length === 0 ? (
            <p className="panel__note">Nobody by that name.</p>
          ) : (
            <ul className="desk__people">
              {page.rows.map((row) => (
                <li key={row.id} className={`desk__person${selected.has(row.id) ? " desk__person--on" : ""}`}>
                  <label className="desk__pick">
                    <input type="checkbox" aria-label={`Select ${row.name}`} checked={selected.has(row.id)} onChange={() => toggle(row)} />
                  </label>
                  <Avatar name={row.name} avatar={row.avatar} accentColor={row.accentColor} className="desk__face" />
                  <span className="desk__name">{row.name}</span>
                  <span className="desk__chips code__chips">{fmt(row.chips)}</span>
                  <span className="desk__meta">
                    {fmt(row.rounds)} {row.rounds === 1 ? "round" : "rounds"} · joined {joined(row.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {page !== null && page.total > PAGE ? (
            <div className="desk__buttons">
              <button
                type="button"
                className="key key--small"
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - PAGE))}
              >
                Previous
              </button>
              <span className="panel__note">
                {fmt(offset + 1)}–{fmt(Math.min(offset + PAGE, page.total))} of {fmt(page.total)}
              </span>
              <button type="button" className="key key--small" disabled={offset + PAGE >= page.total} onClick={() => setOffset(offset + PAGE)}>
                Next
              </button>
            </div>
          ) : null}
        </div>
      </section>

      {selected.size === 0 ? null : (
        <section className="desk__bar" aria-label="Selected players">
          <span className="desk__count">{fmt(selected.size)} selected</span>
          <button type="button" className="key key--small" onClick={() => setSelected(new Map())}>
            Clear
          </button>
          <span className="desk__spacer" />
          {/* Three actions in one bar, none of them the one thing this bar is
              for — a slab per bar, none is needed here. */}
          {(["add", "remove", "set"] as const).map((kind) => (
            <button key={kind} type="button" className="key key--small" onClick={() => setOpen({ kind, who: picked, count: selected.size })}>
              {kind === "add" ? "Add" : kind === "remove" ? "Remove" : "Set"}
            </button>
          ))}
          <button type="button" className="key key--small key--danger" onClick={() => setOpen({ kind: "reset", who: picked, count: selected.size })}>
            Reset…
          </button>
        </section>
      )}

      {open === null ? null : open.kind === "reset" ? (
        <ResetDialog who={open.who} count={open.count} onClose={close} onDone={done("Reset done.")} />
      ) : (
        <ChipsDialog op={open.kind} who={open.who} count={open.count} onClose={close} onDone={done("Done.")} />
      )}
    </>
  );
}
