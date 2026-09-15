import type { Ink, InkRelay, TableView } from "@backroom/game-scribble";
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

export type InkTable = Pick<TableSocketHook<TableView>, "act" | "error" | "onRelay">;

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
  if (bookRef.current === null) {
    bookRef.current = new InkBook(seatId ?? "watching");
  }
  const book = bookRef.current;
  const listeners = useRef(new Set<() => void>());
  const notify = useCallback(() => {
    for (const listener of listeners.current) {
      listener();
    }
  }, []);
  const drawing = state.phase === "drawing" && state.you?.drawing === true;
  const { act, error, onRelay } = table;

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

  useEffect(() => {
    if (error !== null) {
      book.refused();
      notify();
    }
  }, [book, error, notify]);

  const flush = useCallback(() => {
    for (const batch of book.takeBatches()) {
      act({ ...batch });
    }
  }, [act, book]);

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
