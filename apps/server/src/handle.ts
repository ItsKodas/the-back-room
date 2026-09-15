import type { NextFunction, Request, RequestHandler, Response } from "express";

/**
 * What a request or an event hears when the building failed rather than refused.
 *
 * Deliberately says nothing about why: the reason is in the log, and a store's
 * error message is not something to hand a stranger.
 */
export const SOMETHING_WENT_WRONG = "Something went wrong.";

/**
 * An async route or middleware whose failure stays its own.
 *
 * Express 4 does nothing with a rejected promise, and on Node 15 and later an
 * unhandled rejection ends the process — every table in the building, mid-hand,
 * because one request could not reach the store. This answers that request 500
 * and leaves everybody else alone.
 */
export function handle(
  run: (request: Request, response: Response, next: NextFunction) => Promise<void>,
): RequestHandler {
  return (request, response, next) => {
    run(request, response, next).catch((error: unknown) => {
      console.error(`${request.method} ${request.path} failed`, error);
      if (response.headersSent) {
        // Half an answer cannot be turned into a 500. Cutting it off is the
        // only way the client learns it is not getting the rest.
        response.destroy();
        return;
      }
      response.status(500).json({ error: SOMETHING_WENT_WRONG });
    });
  };
}

/**
 * `handle` for a socket event that acks.
 *
 * A client waiting on an ack has usually already shown something early — a
 * stake on the felt, a lever pulled — and an ack that never comes leaves that
 * showing until its own timeout gives up. So a failure acks too, with the
 * answer `failed` builds, and at most once: a failure after the real ack has
 * gone out is only logged.
 */
export function acking<T>(
  what: string,
  ack: (result: T) => void,
  // Not a source of T: a refusal is one shape of the answer, and inferring
  // from it narrows T until the event's real answer no longer fits.
  failed: () => NoInfer<T>,
  run: (ack: (result: T) => void) => Promise<void>,
): void {
  let answered = false;
  const once = (result: T) => {
    if (!answered) {
      answered = true;
      ack(result);
    }
  };
  run(once).catch((error: unknown) => {
    console.error(`${what} failed`, error);
    once(failed());
  });
}

/**
 * Work that follows a change which has already been made and must not undo
 * its answer.
 *
 * Pushing a fresh balance is the usual case. If that fails the chips have
 * still moved, and answering 500 would tell the person who asked that they
 * had not — which is an invitation to do it again.
 */
export async function bestEffort(what: string, ...tasks: Array<Promise<unknown>>): Promise<void> {
  for (const settled of await Promise.allSettled(tasks)) {
    if (settled.status === "rejected") {
      console.error(`${what} failed`, settled.reason);
    }
  }
}
