import type { EmoteRecord, Store } from "@backroom/economy";
import { MAX_IMAGE_BYTES, MAX_SOUND_BYTES, REFUSALS, judgeEmote } from "@backroom/economy";
import type { EmoteView } from "@backroom/shared";
import express from "express";
import type { Express, RequestHandler } from "express";
import { handle } from "./handle.js";

/**
 * The emote desk, and the two routes that serve what it keeps.
 *
 * Uploading sits behind the admin allowlist, beside minting codes, for a
 * reason that is not about chips: this is the one place in the building where
 * a file one person chose is handed to every other person's browser. What is
 * allowed through is decided off the bytes in `@backroom/economy`; what
 * follows here is about how those bytes are carried in and served back out.
 */

/**
 * The path an upload is posted to.
 *
 * Named rather than written twice because the server has to know it in one
 * other place: the body limit everywhere else in this building is eight
 * kilobytes, and a picture is not. See {@link emoteUploadJson}.
 */
export const EMOTE_UPLOAD_PATH = "/api/admin/emotes";

/**
 * How much JSON an upload may be.
 *
 * The files arrive base64-encoded inside an ordinary JSON body rather than as
 * multipart. That costs a third in size and buys the whole of the parsing: no
 * new dependency, no boundary handling, and a route that can be tested with an
 * object instead of a hand-built multipart fixture. Base64 inflates by 4/3, so
 * this is the two caps plus that overhead plus room for the rest of the body.
 */
const UPLOAD_LIMIT = Math.ceil(((MAX_IMAGE_BYTES + MAX_SOUND_BYTES) * 4) / 3) + 64 * 1024;

/**
 * The body parser for uploads, which must be mounted *instead of* the small
 * one rather than after it — a body already refused at eight kilobytes cannot
 * be un-refused by a second parser further down.
 */
export const emoteUploadJson: RequestHandler = express.json({ limit: UPLOAD_LIMIT });

/** Where a client fetches an emote's picture and sound. */
export function emoteUrls(id: string, hasSound: boolean): { image: string; sound: string | null } {
  return {
    image: `/api/emotes/${id}/image`,
    sound: hasSound ? `/api/emotes/${id}/sound` : null,
  };
}

/** An emote as the room offers it to somebody deciding what to throw. */
export function toEmoteView(record: EmoteRecord): EmoteView {
  const urls = emoteUrls(record.id, record.soundMime !== null);
  return {
    id: record.id,
    name: record.name,
    cost: record.cost,
    image: urls.image,
    sound: urls.sound,
  };
}

/**
 * Decodes one base64 field, or null if it is not base64 at all.
 *
 * Length is checked before decoding. A caller could otherwise hand over a
 * string that expands into far more memory than the body limit suggests, and
 * refusing that after allocating it is refusing it too late.
 */
function decode(value: unknown, cap: number): Uint8Array | null {
  if (typeof value !== "string") {
    return null;
  }
  if (value.length === 0) {
    return new Uint8Array(0);
  }
  // Four base64 characters are three bytes, so this bounds the result without
  // producing it.
  if (Math.ceil((value.length * 3) / 4) > cap) {
    return null;
  }
  const bytes = Buffer.from(value, "base64");
  /*
   * Buffer.from is famously forgiving — it skips anything that is not base64
   * rather than refusing. Re-encoding and comparing lengths catches a field
   * that was mostly junk, which is the case worth catching: a genuine file
   * round-trips, and a string of rubbish does not.
   */
  if (bytes.length === 0 || Math.abs(bytes.toString("base64").length - value.length) > 4) {
    return null;
  }
  return new Uint8Array(bytes);
}

export interface EmoteRoutes {
  store: Store;
  requireAdmin: RequestHandler;
  /**
   * Who is asking, however this server has been told to work that out.
   *
   * Passed in rather than read off the session here, because the server has
   * one way of answering that question and it is not always the session — a
   * test says who is signed in without standing up a Discord round-trip, and
   * an upload recorded against nobody in those runs would be a difference
   * between how this behaves under test and how it behaves in production.
   */
  userIdOf: (request: express.Request) => string | undefined;
}

export function mountEmotes(
  app: Express,
  { store, requireAdmin, userIdOf }: EmoteRoutes,
): void {
  /**
   * What may be thrown, for the picker at a table.
   *
   * Open to anybody, including a guest who cannot throw one: the picker is
   * shown before it is used, and a list of what things cost is not a secret.
   */
  app.get(
    "/api/emotes",
    handle(async (_request, response) => {
      const emotes = await store.listEmotes(false);
      response.json({ emotes: emotes.map(toEmoteView) });
    }),
  );

  /**
   * One emote's picture, or its sound.
   *
   * The headers are the second half of the security argument, the first being
   * that the bytes were sniffed before they were ever stored:
   *
   * - `nosniff` stops a browser deciding for itself that a file we called a
   *   GIF is really something executable.
   * - The `Content-Security-Policy` gives the response no permissions at all,
   *   so even if something did get through, it can neither run nor phone home.
   * - `Content-Disposition: inline` with no filename keeps a download from
   *   inheriting a name somebody chose.
   *
   * Cached hard and forever because an id is a UUID minted per upload: the
   * bytes behind one can never change, only stop being offered.
   */
  const asset = (which: "image" | "sound"): express.RequestHandler => {
    return handle(async (request, response) => {
      const id = request.params["id"] ?? "";
      const file = await store.emoteAsset(id, which);
      if (file === null) {
        response.status(404).json({ error: "No such emote." });
        return;
      }
      response.setHeader("Content-Type", file.mime);
      response.setHeader("X-Content-Type-Options", "nosniff");
      response.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
      response.setHeader("Content-Disposition", "inline");
      response.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      response.end(Buffer.from(file.bytes));
    });
  };

  app.get("/api/emotes/:id/image", asset("image"));
  app.get("/api/emotes/:id/sound", asset("sound"));

  /** Everything, retired ones included, for the person deciding what to withdraw. */
  app.get(
    "/api/admin/emotes",
    requireAdmin,
    handle(async (_request, response) => {
      response.json({ emotes: await store.listEmotes(true) });
    }),
  );

  /**
   * A new emote.
   *
   * Note the body parser mounted on this one route: the building's limit is
   * eight kilobytes and a picture is not, so this route carries its own.
   */
  app.post(
    EMOTE_UPLOAD_PATH,
    requireAdmin,
    emoteUploadJson,
    handle(async (request, response) => {
      const body = (request.body ?? {}) as Record<string, unknown>;
      const image = decode(body["image"], MAX_IMAGE_BYTES);
      if (image === null) {
        response.status(400).json({ error: REFUSALS["image-not-an-image"] });
        return;
      }
      /*
       * A missing sound and an unreadable one are different answers. Absent is
       * the ordinary case — a sound is optional — but a field that was sent
       * and could not be decoded is a failed upload, and saying "no sound" to
       * that would silently publish an emote missing the half somebody meant.
       */
      const sent = body["sound"];
      const sound =
        sent === undefined || sent === null || sent === ""
          ? null
          : decode(sent, MAX_SOUND_BYTES);
      if (sound === null && sent !== undefined && sent !== null && sent !== "") {
        response.status(400).json({ error: REFUSALS["sound-not-a-sound"] });
        return;
      }

      const upload = {
        name: typeof body["name"] === "string" ? body["name"] : "",
        cost: typeof body["cost"] === "number" ? body["cost"] : Number.NaN,
        image,
        sound,
        // Taken from the session rather than the body: who uploaded a thing is
        // not something the uploader gets to write.
        createdBy: userIdOf(request) ?? "",
      };

      const judged = judgeEmote(upload);
      if (!judged.ok) {
        response.status(400).json({ error: REFUSALS[judged.reason] });
        return;
      }

      const record = await store.addEmote(upload);
      response.status(201).json({ emote: record });
    }),
  );

  /** Withdraws one, without deleting what it was. */
  app.post(
    "/api/admin/emotes/:id/retire",
    requireAdmin,
    handle(async (request, response) => {
      const retired = await store.retireEmote(request.params["id"] ?? "");
      if (!retired) {
        response.status(404).json({ error: "No such emote." });
        return;
      }
      response.json({ ok: true });
    }),
  );
}
