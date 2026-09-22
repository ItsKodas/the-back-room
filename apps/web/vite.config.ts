import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * The API, the auth routes and the socket are all proxied to the game server,
 * so in development the browser talks to one origin — exactly as it will in
 * production, where the server serves the built client itself. Without this the
 * session cookie would not travel with the socket handshake and a signed-in
 * player would look like a guest at the table.
 */
export default defineConfig({
  plugins: [react()],
  server: {
    // Bind every interface, not just the loopback, so other people on the
    // network can open the game on this machine and sit down at a table.
    host: true,
    port: 5173,
    proxy: {
      "/api": "http://localhost:3001",
      "/auth": "http://localhost:3001",
      "/healthz": "http://localhost:3001",
      // The link cards, which the tiles on the front page are made of.
      "/og": "http://localhost:3001",
      "/socket.io": { target: "http://localhost:3001", ws: true },
    },
  },
  /*
   * Workspace packages are source, not dependencies.
   *
   * Pre-bundling them caches a copy that goes stale the moment one of their
   * barrels changes — and the failure is a blank page reporting that an export
   * "is not defined" while typecheck and build are both clean, which sends you
   * looking in exactly the wrong place. The games were missing from this list
   * and cost two rounds of that.
   */
  optimizeDeps: {
    exclude: [
      "@backroom/ui",
      "@backroom/rules",
      "@backroom/shared",
      "@backroom/core",
      "@backroom/economy",
      "@backroom/game-blackjack",
      "@backroom/game-craps",
      "@backroom/game-greed",
      "@backroom/game-plinko",
      "@backroom/game-poker",
      "@backroom/game-roulette",
      "@backroom/game-scribble",
      "@backroom/game-slots",
      "@backroom/game-two-up",
    ],
  },
});
