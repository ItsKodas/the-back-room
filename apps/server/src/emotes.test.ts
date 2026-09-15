import type { AddressInfo } from "node:net";
import { MemoryStore } from "@backroom/economy";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createBackRoomServer } from "./server.js";
import type { BackRoomServer } from "./server.js";
import { listenForFetch } from "./test-listen.js";

/**
 * The emote desk, over real HTTP.
 *
 * What the bytes are allowed to be is decided in `@backroom/economy` and
 * tested there. What is only reachable here is the carrying: that an upload
 * gets past the building's eight-kilobyte body limit at all, that the files
 * come back with the headers that keep them inert, and that none of it is
 * reachable by somebody who is not on the admin list.
 */

let server: BackRoomServer | null = null;

/*
 * The admin list is process-wide, so it is cleared going in as well as coming
 * out — otherwise a test here reads whatever the file before it left behind.
 */
beforeEach(() => {
  delete process.env["ADMIN_DISCORD_IDS"];
});

afterEach(async () => {
  if (server !== null) {
    await server.close();
    server = null;
  }
  delete process.env["ADMIN_DISCORD_IDS"];
});

async function start(store: MemoryStore, as: string | null): Promise<string> {
  server = createBackRoomServer({
    store,
    auth: null,
    serveClient: false,
    identify: () => as,
    identifyRequest: () => as,
  });
  await listenForFetch(server.http);
  return `http://localhost:${(server.http.address() as AddressInfo).port}`;
}

const ascii = (text: string): number[] => [...text].map((letter) => letter.charCodeAt(0));

function bytes(magic: readonly number[], length = 64): Uint8Array {
  const out = new Uint8Array(length);
  out.set(magic.slice(0, length));
  return out;
}

const GIF = bytes(ascii("GIF89a"));
const MP3 = bytes(ascii("ID3"));
const b64 = (input: Uint8Array) => Buffer.from(input).toString("base64");

async function post(url: string, body: unknown) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  return {
    status: response.status,
    body: (text === "" ? {} : JSON.parse(text)) as Record<string, unknown>,
  };
}

/** An admin, and a server that believes they are signed in. */
async function asAdmin(store: MemoryStore) {
  const profile = await store.upsertDiscordUser({
    discordId: "admin-1",
    name: "Ada",
    avatar: null,
    accentColor: null,
  });
  process.env["ADMIN_DISCORD_IDS"] = "admin-1";
  return { base: await start(store, profile.id), profile };
}

const upload = (over: Record<string, unknown> = {}) => ({
  name: "Smug",
  cost: 250,
  image: b64(GIF),
  ...over,
});

describe("uploading an emote", () => {
  it("accepts a picture and lists it", async () => {
    const store = new MemoryStore();
    const { base, profile } = await asAdmin(store);

    const made = await post(`${base}/api/admin/emotes`, upload());

    expect(made.status).toBe(201);
    expect(made.body["emote"]).toMatchObject({
      name: "Smug",
      cost: 250,
      imageMime: "image/gif",
      soundMime: null,
      retired: false,
      // Recorded from the session, not from anything the body said.
      createdBy: profile.id,
    });
  });

  it("keeps an optional sound when one is sent", async () => {
    const store = new MemoryStore();
    const { base } = await asAdmin(store);

    const made = await post(`${base}/api/admin/emotes`, upload({ sound: b64(MP3) }));

    expect(made.body["emote"]).toMatchObject({ soundMime: "audio/mpeg" });
  });

  it("makes a sound genuinely optional", async () => {
    const store = new MemoryStore();
    const { base } = await asAdmin(store);

    for (const sound of [undefined, null, ""]) {
      const made = await post(`${base}/api/admin/emotes`, upload({ sound }));
      expect(made.status).toBe(201);
      expect(made.body["emote"]).toMatchObject({ soundMime: null });
    }
  });

  /*
   * A picture is several hundred times the building's ordinary body limit, so
   * this asserts the one route that is allowed past it actually is. Without
   * the exemption every upload is a 413 and nothing else in this file could
   * even be reached.
   */
  it("accepts a picture far larger than the building's body limit", async () => {
    const store = new MemoryStore();
    const { base } = await asAdmin(store);
    const big = new Uint8Array(400 * 1024);
    big.set(ascii("GIF89a"));

    const made = await post(`${base}/api/admin/emotes`, upload({ image: b64(big) }));

    expect(made.status).toBe(201);
    expect(made.body["emote"]).toMatchObject({ imageBytes: big.length });
  });

  it("refuses a file that is not a picture", async () => {
    const store = new MemoryStore();
    const { base } = await asAdmin(store);

    const made = await post(
      `${base}/api/admin/emotes`,
      upload({ image: b64(bytes(ascii("<svg onload=alert(1)>"))) }),
    );

    expect(made.status).toBe(400);
    expect(await store.listEmotes(true)).toEqual([]);
  });

  it("refuses a sound that is not a sound rather than silently dropping it", async () => {
    const store = new MemoryStore();
    const { base } = await asAdmin(store);

    const made = await post(`${base}/api/admin/emotes`, upload({ sound: b64(GIF) }));

    expect(made.status).toBe(400);
    expect(await store.listEmotes(true)).toEqual([]);
  });

  it("refuses an unnamed or unpriced emote", async () => {
    const store = new MemoryStore();
    const { base } = await asAdmin(store);

    expect((await post(`${base}/api/admin/emotes`, upload({ name: "" }))).status).toBe(400);
    expect((await post(`${base}/api/admin/emotes`, upload({ cost: -5 }))).status).toBe(400);
    expect((await post(`${base}/api/admin/emotes`, upload({ cost: "free" }))).status).toBe(400);
  });

  it("refuses a body with no picture in it at all", async () => {
    const store = new MemoryStore();
    const { base } = await asAdmin(store);

    expect((await post(`${base}/api/admin/emotes`, { name: "Smug", cost: 1 })).status).toBe(400);
  });
});

describe("who may reach the desk", () => {
  /*
   * 404 rather than 403, matching the code desk: whether this page exists is
   * not something an unauthorised visitor gets to learn by asking.
   */
  it("hides the desk from somebody not on the list", async () => {
    const store = new MemoryStore();
    const profile = await store.upsertDiscordUser({
      discordId: "nobody",
      name: "Mal",
      avatar: null,
      accentColor: null,
    });
    const base = await start(store, profile.id);

    expect((await fetch(`${base}/api/admin/emotes`)).status).toBe(404);
    expect((await post(`${base}/api/admin/emotes`, upload())).status).toBe(404);
    expect(await store.listEmotes(true)).toEqual([]);
  });

  it("hides it from a signed-out visitor", async () => {
    const store = new MemoryStore();
    const base = await start(store, null);

    expect((await fetch(`${base}/api/admin/emotes`)).status).toBe(404);
    expect((await post(`${base}/api/admin/emotes`, upload())).status).toBe(404);
  });

  it("refuses an upload when nobody at all is on the list", async () => {
    const store = new MemoryStore();
    const profile = await store.upsertDiscordUser({
      discordId: "admin-1",
      name: "Ada",
      avatar: null,
      accentColor: null,
    });
    const base = await start(store, profile.id);

    expect((await post(`${base}/api/admin/emotes`, upload())).status).toBe(404);
  });
});

describe("what the room offers", () => {
  it("lists emotes to anybody, signed in or not", async () => {
    const store = new MemoryStore();
    const { base } = await asAdmin(store);
    const made = await post(`${base}/api/admin/emotes`, upload({ sound: b64(MP3) }));
    const id = (made.body["emote"] as { id: string }).id;

    const listed = await (await fetch(`${base}/api/emotes`)).json();

    expect(listed).toEqual({
      emotes: [
        {
          id,
          name: "Smug",
          cost: 250,
          image: `/api/emotes/${id}/image`,
          sound: `/api/emotes/${id}/sound`,
        },
      ],
    });
  });

  it("says an emote has no sound rather than offering a URL for one", async () => {
    const store = new MemoryStore();
    const { base } = await asAdmin(store);
    await post(`${base}/api/admin/emotes`, upload());

    const listed = (await (await fetch(`${base}/api/emotes`)).json()) as {
      emotes: Array<{ sound: string | null }>;
    };

    expect(listed.emotes[0]?.sound).toBeNull();
  });
});

describe("serving the files", () => {
  it("hands back the exact bytes that were uploaded", async () => {
    const store = new MemoryStore();
    const { base } = await asAdmin(store);
    const made = await post(`${base}/api/admin/emotes`, upload({ sound: b64(MP3) }));
    const id = (made.body["emote"] as { id: string }).id;

    const picture = await fetch(`${base}/api/emotes/${id}/image`);
    const sound = await fetch(`${base}/api/emotes/${id}/sound`);

    expect(new Uint8Array(await picture.arrayBuffer())).toEqual(GIF);
    expect(new Uint8Array(await sound.arrayBuffer())).toEqual(MP3);
    expect(picture.headers.get("content-type")).toBe("image/gif");
    expect(sound.headers.get("content-type")).toBe("audio/mpeg");
  });

  /*
   * The second half of the security argument, the first being that the bytes
   * were sniffed before they were ever stored. These headers are what stop a
   * file that did somehow get through from being able to do anything, so they
   * are pinned rather than trusted to survive a refactor.
   */
  it("serves them inert", async () => {
    const store = new MemoryStore();
    const { base } = await asAdmin(store);
    const made = await post(`${base}/api/admin/emotes`, upload());
    const id = (made.body["emote"] as { id: string }).id;

    const picture = await fetch(`${base}/api/emotes/${id}/image`);

    expect(picture.headers.get("x-content-type-options")).toBe("nosniff");
    expect(picture.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(picture.headers.get("content-security-policy")).toContain("sandbox");
    expect(picture.headers.get("content-disposition")).toBe("inline");
  });

  it("answers 404 for an emote that does not exist", async () => {
    const store = new MemoryStore();
    const { base } = await asAdmin(store);

    expect((await fetch(`${base}/api/emotes/nonsense/image`)).status).toBe(404);
  });

  it("answers 404 for the sound of an emote that has none", async () => {
    const store = new MemoryStore();
    const { base } = await asAdmin(store);
    const made = await post(`${base}/api/admin/emotes`, upload());
    const id = (made.body["emote"] as { id: string }).id;

    expect((await fetch(`${base}/api/emotes/${id}/sound`)).status).toBe(404);
  });
});

describe("retiring one", () => {
  it("stops it being offered", async () => {
    const store = new MemoryStore();
    const { base } = await asAdmin(store);
    const made = await post(`${base}/api/admin/emotes`, upload());
    const id = (made.body["emote"] as { id: string }).id;

    expect((await post(`${base}/api/admin/emotes/${id}/retire`, {})).status).toBe(200);

    const listed = (await (await fetch(`${base}/api/emotes`)).json()) as { emotes: unknown[] };
    expect(listed.emotes).toEqual([]);
  });

  /*
   * A retired emote may still be sitting in somebody's bonus pool waiting to
   * be thrown back at whoever sent it. If withdrawing it took its picture away
   * too, that replay would arrive as a broken image a week later.
   */
  it("keeps serving its picture, for the replays still owed", async () => {
    const store = new MemoryStore();
    const { base } = await asAdmin(store);
    const made = await post(`${base}/api/admin/emotes`, upload());
    const id = (made.body["emote"] as { id: string }).id;

    await post(`${base}/api/admin/emotes/${id}/retire`, {});

    const picture = await fetch(`${base}/api/emotes/${id}/image`);
    expect(picture.status).toBe(200);
    expect(new Uint8Array(await picture.arrayBuffer())).toEqual(GIF);
  });

  it("still shows it on the admin's own list", async () => {
    const store = new MemoryStore();
    const { base } = await asAdmin(store);
    const made = await post(`${base}/api/admin/emotes`, upload());
    const id = (made.body["emote"] as { id: string }).id;
    await post(`${base}/api/admin/emotes/${id}/retire`, {});

    const listed = (await (await fetch(`${base}/api/admin/emotes`)).json()) as {
      emotes: Array<{ retired: boolean }>;
    };

    expect(listed.emotes).toHaveLength(1);
    expect(listed.emotes[0]?.retired).toBe(true);
  });

  it("refuses to retire something twice, or something that is not there", async () => {
    const store = new MemoryStore();
    const { base } = await asAdmin(store);
    const made = await post(`${base}/api/admin/emotes`, upload());
    const id = (made.body["emote"] as { id: string }).id;

    expect((await post(`${base}/api/admin/emotes/${id}/retire`, {})).status).toBe(200);
    expect((await post(`${base}/api/admin/emotes/${id}/retire`, {})).status).toBe(404);
    expect((await post(`${base}/api/admin/emotes/nope/retire`, {})).status).toBe(404);
  });
});
