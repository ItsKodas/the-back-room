/**
 * How long the server keeps a silent socket: socket.io's default ping interval
 * (25s) plus its ping timeout (20s). Past this the server has certainly
 * dropped the connection, so starting a new one loses nothing the old one
 * still had.
 */
export const SERVER_FORGETS_AFTER_MS = 45_000;

export interface Rejoinable {
  readonly connected: boolean;
  connect(): unknown;
  disconnect(): unknown;
}

/**
 * Gets a table's socket back on its feet when the page comes back into view.
 *
 * An installed app is put away far more often than a tab is closed, and a
 * phone freezes it rather than ending it. The socket then comes back believing
 * it is connected to a server that has already let it go, and says nothing
 * until its own ping times out — the better part of a minute of a table that
 * looks live and does not move. A fresh connection runs the hook's own
 * `connect` handler, which reclaims the seat.
 *
 * Returns the way to stop, which has to run before the socket is closed so
 * that a page coming back into view cannot reopen a table somebody has left.
 */
export function rejoinOnReturn(
  socket: Rejoinable,
  page: Document = document,
  now: () => number = Date.now,
): () => void {
  let hiddenAt: number | null = null;

  const changed = () => {
    if (page.visibilityState === "hidden") {
      hiddenAt = now();
      return;
    }
    const away = hiddenAt === null ? 0 : now() - hiddenAt;
    hiddenAt = null;
    if (!socket.connected) {
      socket.connect();
      return;
    }
    if (away >= SERVER_FORGETS_AFTER_MS) {
      socket.disconnect();
      socket.connect();
    }
  };

  page.addEventListener("visibilitychange", changed);
  return () => page.removeEventListener("visibilitychange", changed);
}
