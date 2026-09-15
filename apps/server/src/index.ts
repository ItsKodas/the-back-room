import type session from "express-session";
import { readAuthConfig } from "./auth.js";
import { MongoStore } from "@backroom/economy";
import { createBackRoomServer } from "./server.js";
import { MemoryStore } from "@backroom/economy";
import type { Store } from "@backroom/economy";

/**
 * Port precedence: an explicit --port flag, then PORT, then 3001. The flag
 * matters in dev because the harness that launches both processes sets PORT
 * for the web server, and the API must not inherit it.
 */
const portFlag = process.argv.indexOf("--port");
const PORT = Number(
  portFlag !== -1 ? process.argv[portFlag + 1] : (process.env["PORT"] ?? 3001),
);

const mongoUrl = process.env["MONGO_URL"];

/** The first line of a message, for logs that want a reason and not a stack. */
function firstLine(message: string): string {
  const end = message.indexOf("\n");
  return end === -1 ? message : message.slice(0, end).trimEnd();
}

/*
 * The last line of defence, and logged rather than fatal.
 *
 * Every route and event already catches its own failures, so reaching here is
 * a bug — and it is loud so it gets found. But Node's default is to end the
 * process, and this process is every table in the building: the stakes on
 * their felts live in memory, and one stray promise is not worth all of them.
 * A synchronous `uncaughtException` keeps the default, because a throw can
 * leave state half-changed in a way a rejected promise, finished and alone,
 * does not.
 */
process.on("unhandledRejection", (reason) => {
  console.error("backroom: unhandled rejection — this is a bug, and the server kept running", reason);
});

async function main(): Promise<void> {
  let store: Store = new MemoryStore();
  let sessionStore: session.Store | undefined;

  if (mongoUrl !== undefined && mongoUrl.length > 0) {
    try {
      store = await MongoStore.connect(mongoUrl);
      // Loaded here rather than at the top: with no database configured the
      // server should not need a database driver present at all.
      const { default: MongoSessionStore } = await import("connect-mongo");
      sessionStore = MongoSessionStore.create({ mongoUrl });
      console.log("backroom: profiles and chips are persistent");
    } catch (error) {
      /*
       * A database that will not answer should not take the game down with it:
       * losing persistence is better than losing the ability to play.
       *
       * One line rather than the whole stack. This path is expected — it is
       * what happens with no database running — and forty lines of driver
       * internals for an expected outcome buries every other line in the log.
       */
      const why = error instanceof Error ? firstLine(error.message) : String(error);
      console.error(`backroom: no database (${why}) — profiles and chips live in memory`);
      console.error("backroom: sessions die on restart too, so a sign-in will not survive one");
    }
  } else {
    console.log("backroom: no MONGO_URL, profiles and chips live in memory only");
  }

  const auth = readAuthConfig(process.env);
  if (auth === null) {
    console.log("backroom: no Discord credentials, sign-in is disabled");
  }

  const server = createBackRoomServer({
    store,
    auth,
    sessionStore,
    clientOrigin: process.env["CLIENT_ORIGIN"] ?? "http://localhost:5173",
  });

  server.http.listen(PORT, () => {
    console.log(`backroom server listening on http://localhost:${PORT}`);
  });

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      void server.close().then(() => process.exit(0));
    });
  }
}

main().catch((error: unknown) => {
  // A misconfigured server should say what is wrong in one line, not bury it
  // in an unhandled-rejection stack.
  console.error(`backroom: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
