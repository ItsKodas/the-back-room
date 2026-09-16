import type { Ink, InkRelay, TableView } from "@backroom/game-scribble";
import { INK_REFUSALS } from "@backroom/game-scribble";
import { useCallback, useEffect, useMemo, useRef } from "react";
import type { TableSocketHook } from "../table/useTableSocket.js";
import { InkBook } from "./inkBook.js";

/*
 * How often a line under your finger goes to the server. Twenty a second looks
 * continuous once the other end draws it, and stays inside the action budget
 * with room for undo and clear.
 */
export const FLUSH_MS = 50;

export interface Tool {
  ink: Ink;
  size: number;
  mode: "pen" | "eraser" | "fill";
}

export type InkTable = Pick<TableSocketHook<TableView>, "act" | "onRelay" | "onError">;

export interface InkHandle {
  book: InkBook;
  drawing: boolean;
  subscribe(listener: () => void): () => void;
  begin(tool: Tool, x: number, y: number): void;
  extend(x: number, y: number): void;
  end(): void;
  fill(tool: Tool, x: number, y: number): void;
  undo(): void;
  clear(): void;
}

export function useInk(table: InkTable, state: TableView, seatId: string | null): InkHandle {
  const bookRef = useRef<InkBook | null>(null);
  const bookSeat = useRef<string | null>(null);
  if (bookRef.current === null || bookSeat.current !== seatId) {
    /*
     * A book belongs to whoever is sitting in this seat: rebuilt whenever the
     * seat changes so a mark drawn after sitting down is attributed to the
     * seat that drew it, not whoever this window was watching as before —
     * and so a relay echoing that seat's own hand back is recognised as its
     * own and dropped, rather than drawn a second time.
     */
    bookRef.current = new InkBook(seatId ?? "watching");
    bookSeat.current = seatId;
  }
  const book = bookRef.current;
  const listeners = useRef(new Set<() => void>());
  const notify = useCallback(() => {
    for (const listener of listeners.current) {
      listener();
    }
  }, []);
  const drawing = state.phase === "drawing" && state.you?.drawing === true;
  const { act, onRelay, onError } = table;

  // Every state is the truth about the picture.
  useEffect(() => {
    book.sync(state.ink, drawing);
    notify();
  }, [book, state, drawing, notify]);

  useEffect(
    () =>
      onRelay((relay) => {
        book.applyRelay(relay.seatId, relay.payload as InkRelay);
        notify();
      }),
    [book, onRelay, notify],
  );

  useEffect(
    () =>
      onError((message) => {
        // Every refusal reaches this window, not only ink's — a chat rebuke or
        // some other game's complaint is not the napkin's business to react to.
        if (INK_REFUSALS.includes(message)) {
          book.refused();
          notify();
        }
      }),
    [book, onError, notify],
  );

  const flush = useCallback(() => {
    for (const batch of book.takeBatches()) {
      act({ ...batch });
    }
  }, [act, book]);

  /*
   * No final flush on the way out: the sync effect above already ran
   * sync(ink, false) the moment drawing turned false, and that empties
   * pending outright — so whatever was still unsent when the turn ended
   * mid-stroke is already given up, and there is nothing left here worth
   * sending.
   */
  useEffect(() => {
    if (!drawing) {
      return;
    }
    const timer = setInterval(flush, FLUSH_MS);
    return () => clearInterval(timer);
  }, [drawing, flush]);

  return useMemo<InkHandle>(
    () => ({
      book,
      drawing,
      subscribe(listener) {
        listeners.current.add(listener);
        return () => {
          listeners.current.delete(listener);
        };
      },
      begin(tool, x, y) {
        book.begin(tool.mode === "eraser" ? "paper" : tool.ink, tool.size, x, y);
        notify();
      },
      extend(x, y) {
        book.extend(x, y);
        notify();
      },
      end() {
        book.end();
        flush();
      },
      fill(tool, x, y) {
        act({ ...book.fill(tool.ink, x, y) });
        notify();
      },
      undo() {
        if (book.undo()) {
          act({ type: "undo" });
        }
        notify();
      },
      clear() {
        book.clear();
        act({ type: "clear" });
        notify();
      },
    }),
    [act, book, drawing, flush, notify],
  );
}
