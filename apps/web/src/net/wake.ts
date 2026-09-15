/**
 * How long the server waits for a ping to be answered before giving up on the
 * socket: socket.io's default ping interval (25s) plus its ping timeout
 * (20s). A socket that has gone this long since its last ping has certainly
 * been dropped by the server, so starting a new one loses nothing the old one
 * still had.
 */
export const SERVER_FORGETS_AFTER_MS = 45_000;

export interface Rejoinable {
  readonly connected: boolean;
  connect(): unknown;
  disconnect(): unknown;
  /**
   * The engine.io Manager, which keeps emitting `"ping"` for as long as the
   * transport is actually alive — hidden tab or not. That is what tells a
   * merely backgrounded page apart from one the OS froze outright.
   */
  readonly io: {
    on(event: "ping", listener: () => void): unknown;
    off(event: "ping", listener: () => void): unknown;
  };
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
 * Time hidden is not the test for that, because plenty of pages stay fully
 * alive while hidden — a desktop tab, or an Android tab for its first
 * minute or so — and keep answering the server's pings the whole time. A
 * client-side `disconnect()` on a socket like that sends a real disconnect
 * packet, and the server treats it exactly like a player leaving: a hand
 * folded, a turn given up, a stake left on the felt. So the only thing that
 * justifies forcing a reconnect is evidence the server has actually gone
 * quiet — no ping heard in longer than the server would wait before giving up
 * on it.
 *
 * Returns the way to stop, which has to run before the socket is closed so
 * that a page coming back into view cannot reopen a table somebody has left.
 */
export function rejoinOnReturn(
  socket: Rejoinable,
  page: Document = document,
  now: () => number = Date.now,
): () => void {
  let lastPing = now();
  const ping = () => {
    lastPing = now();
  };
  socket.io.on("ping", ping);

  const changed = () => {
    if (page.visibilityState === "hidden") {
      return;
    }
    if (!socket.connected) {
      // Not a guaranteed prompt reconnect: if socket.io is already mid-backoff
      // from an earlier drop, `connect()` is a no-op and the next attempt
      // still waits out whatever delay it was already on. It only opens a
      // connection right away when nothing was already retrying.
      socket.connect();
      return;
    }
    if (now() - lastPing >= SERVER_FORGETS_AFTER_MS) {
      socket.disconnect();
      socket.connect();
    }
  };

  page.addEventListener("visibilitychange", changed);
  return () => {
    page.removeEventListener("visibilitychange", changed);
    socket.io.off("ping", ping);
  };
}
