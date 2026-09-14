// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The music's own contract, against a stand-in for YouTube's player.
 *
 * The real embed cannot run here, and the thing being tested is not the embed
 * anyway: it is what this module asks of it — play on load, try again on the
 * first press when the browser said no, and pick up where a reload left off.
 *
 * Imported fresh in every test, because the module keeps its player and its
 * switches in memory. Window listeners from earlier imports cannot be taken
 * back, so every stand-in is killed after its test and answers nothing.
 */

const PLAYING = 1;
const PAUSED = 2;

interface Fake {
  ready(): void;
  state(data: number): void;
  current: { id: string; seconds: number; muted: boolean };
  playVideo: ReturnType<typeof vi.fn>;
  pauseVideo: ReturnType<typeof vi.fn>;
  playVideoAt: ReturnType<typeof vi.fn>;
  seekTo: ReturnType<typeof vi.fn>;
}

let fakes: Fake[] = [];
const dead = new Set<Fake>();

function installYouTube(playlist: string[]) {
  class Player {
    constructor(
      _element: HTMLElement,
      options: {
        events: {
          onReady: (event: { target: unknown }) => void;
          onStateChange: (event: { data: number }) => void;
        };
      },
    ) {
      const fake: Fake = {
        current: { id: playlist[0] ?? "", seconds: 0, muted: false },
        playVideo: vi.fn(),
        pauseVideo: vi.fn(),
        playVideoAt: vi.fn((index: number) => {
          fake.current.id = playlist[index] ?? "";
          fake.current.seconds = 0;
        }),
        seekTo: vi.fn((seconds: number) => {
          fake.current.seconds = seconds;
        }),
        ready: () => options.events.onReady({ target: api }),
        state: (data) => options.events.onStateChange({ data }),
      };
      const api = {
        playVideo: fake.playVideo,
        pauseVideo: fake.pauseVideo,
        nextVideo: vi.fn(),
        setVolume: vi.fn(),
        setShuffle: vi.fn(),
        setLoop: vi.fn(),
        getPlaylist: () => playlist,
        playVideoAt: fake.playVideoAt,
        seekTo: fake.seekTo,
        getCurrentTime: () => (dead.has(fake) ? Number.NaN : fake.current.seconds),
        getVideoData: () =>
          dead.has(fake) ? undefined : { title: "a song", video_id: fake.current.id },
        isMuted: () => fake.current.muted,
        unMute: () => {
          fake.current.muted = false;
        },
        destroy: vi.fn(),
      };
      fakes.push(fake);
    }
  }
  window.YT = {
    Player: Player as never,
    PlayerState: { PLAYING, PAUSED, ENDED: 0 },
  };
}

async function load() {
  vi.resetModules();
  const music = await import("./music.js");
  return music;
}

/** Lets the module's awaited script load settle and the player be made. */
async function settle() {
  for (let i = 0; i < 5; i += 1) {
    await Promise.resolve();
  }
}

async function tick() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function latest(): Fake {
  const fake = fakes.at(-1);
  if (fake === undefined) {
    throw new Error("no player was made");
  }
  return fake;
}

beforeEach(() => {
  window.localStorage.clear();
  document.body.innerHTML = "";
});

afterEach(() => {
  vi.useRealTimers();
  for (const fake of fakes) {
    dead.add(fake);
  }
  fakes = [];
  delete window.YT;
});

describe("the room's music", () => {
  it("is on for somebody who has never touched it", async () => {
    installYouTube(["a", "b"]);
    const music = await load();
    expect(music.musicState().on).toBe(true);
  });

  it("stays off for somebody who turned it off", async () => {
    window.localStorage.setItem("backroom.music.on", "false");
    installYouTube(["a", "b"]);
    const music = await load();
    expect(music.musicState().on).toBe(false);
  });

  it("asks to play as soon as the page loads", async () => {
    installYouTube(["a", "b", "c"]);
    const music = await load();
    music.attachMusic(null, false);
    await settle();
    latest().ready();
    expect(latest().playVideoAt).toHaveBeenCalledTimes(1);
  });

  /*
   * The bug: a reload whose autoplay the browser refused sat silent until
   * somebody found the panel and pressed Stop then Play.
   */
  it("tries again on the first press when the browser refused to play", async () => {
    installYouTube(["a", "b", "c"]);
    const music = await load();
    music.attachMusic(null, false);
    await settle();
    const fake = latest();
    fake.ready();
    // Refused: the track was asked for, and the player never started.
    expect(fake.playVideoAt).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new Event("pointerup"));
    await tick();
    expect(fake.playVideoAt).toHaveBeenCalledTimes(2);

    // Once it has actually sounded, a press is just a press.
    fake.state(PLAYING);
    window.dispatchEvent(new Event("pointerup"));
    await tick();
    expect(fake.playVideoAt).toHaveBeenCalledTimes(2);
    expect(fake.playVideo).not.toHaveBeenCalled();
  });

  /*
   * A reload can leave the embed sitting paused on its opening track without
   * anybody pressing anything. Stop then Play brought it back by hand, so the
   * page now does that itself.
   */
  it("pauses and plays again when a start is left sitting paused", async () => {
    vi.useFakeTimers();
    installYouTube(["a", "b", "c"]);
    const music = await load();
    music.attachMusic(null, false);
    await settle();
    const fake = latest();
    fake.ready();
    fake.state(PAUSED);

    vi.advanceTimersByTime(1500);
    expect(fake.pauseVideo).toHaveBeenCalledTimes(1);
    expect(fake.playVideo).not.toHaveBeenCalled();

    vi.advanceTimersByTime(250);
    expect(fake.playVideo).toHaveBeenCalledTimes(1);
  });

  it("leaves a start alone once it is playing", async () => {
    vi.useFakeTimers();
    installYouTube(["a", "b", "c"]);
    const music = await load();
    music.attachMusic(null, false);
    await settle();
    const fake = latest();
    fake.ready();
    fake.state(PLAYING);

    vi.advanceTimersByTime(60_000);
    expect(fake.pauseVideo).not.toHaveBeenCalled();
    expect(fake.playVideo).not.toHaveBeenCalled();
  });

  it("stops nudging after a few tries and leaves it to a press", async () => {
    vi.useFakeTimers();
    installYouTube(["a", "b", "c"]);
    const music = await load();
    music.attachMusic(null, false);
    await settle();
    const fake = latest();
    fake.ready();

    vi.advanceTimersByTime(10 * 60_000);
    expect(fake.playVideo).toHaveBeenCalledTimes(3);
    expect(fake.pauseVideo).toHaveBeenCalledTimes(3);
  });

  it("does not nudge a stream that has been turned off", async () => {
    vi.useFakeTimers();
    installYouTube(["a", "b", "c"]);
    const music = await load();
    music.attachMusic(null, false);
    await settle();
    const fake = latest();
    fake.ready();
    music.setMusicOn(false);

    vi.advanceTimersByTime(60_000);
    expect(fake.playVideo).not.toHaveBeenCalled();
  });

  it("does not count a muted start as having been heard", async () => {
    installYouTube(["a", "b", "c"]);
    const music = await load();
    music.attachMusic(null, false);
    await settle();
    const fake = latest();
    fake.ready();
    fake.current.muted = true;
    fake.state(PLAYING);

    window.dispatchEvent(new Event("keyup"));
    await tick();
    expect(fake.current.muted).toBe(false);
  });

  it("does not start a stream the press itself turned off", async () => {
    installYouTube(["a", "b", "c"]);
    const music = await load();
    music.attachMusic(null, false);
    await settle();
    const fake = latest();
    fake.ready();

    window.dispatchEvent(new Event("pointerup"));
    // The press was on Stop, whose handler runs before the retry does.
    music.setMusicOn(false);
    await tick();
    expect(fake.playVideoAt).toHaveBeenCalledTimes(1);
  });

  it("picks up the track that was on before a reload, from the same place", async () => {
    window.localStorage.setItem(
      "backroom.music.position",
      JSON.stringify({ id: "c", seconds: 83.5, at: Date.now() - 2000 }),
    );
    installYouTube(["a", "b", "c", "d"]);
    const music = await load();
    music.attachMusic(null, false);
    await settle();
    const fake = latest();
    fake.ready();
    expect(fake.playVideoAt).toHaveBeenCalledWith(2);

    fake.state(PLAYING);
    expect(fake.seekTo).toHaveBeenCalledWith(83.5, true);
  });

  it("does not go back to a place remembered long ago", async () => {
    window.localStorage.setItem(
      "backroom.music.position",
      JSON.stringify({ id: "c", seconds: 83.5, at: Date.now() - 24 * 60 * 60 * 1000 }),
    );
    installYouTube(["a", "b", "c", "d"]);
    const music = await load();
    music.attachMusic(null, false);
    await settle();
    const fake = latest();
    fake.ready();
    fake.state(PLAYING);
    expect(fake.seekTo).not.toHaveBeenCalled();
  });

  it("writes down where it is when the page goes away", async () => {
    installYouTube(["a", "b", "c"]);
    const music = await load();
    music.attachMusic(null, false);
    await settle();
    const fake = latest();
    fake.ready();
    fake.state(PLAYING);
    fake.current.seconds = 41;

    window.dispatchEvent(new Event("pagehide"));
    const saved = JSON.parse(window.localStorage.getItem("backroom.music.position") ?? "null");
    expect(saved).toMatchObject({ id: fake.current.id, seconds: 41 });
  });

  /*
   * A reload whose autoplay was refused is parked at the top of some other
   * track. Writing that down would lose the place from the reload before.
   */
  it("keeps the remembered place through a reload that never got to play", async () => {
    const before = { id: "c", seconds: 83.5, at: Date.now() - 2000 };
    window.localStorage.setItem("backroom.music.position", JSON.stringify(before));
    installYouTube(["a", "b", "c"]);
    const music = await load();
    music.attachMusic(null, false);
    await settle();
    latest().ready();

    window.dispatchEvent(new Event("pagehide"));
    expect(JSON.parse(window.localStorage.getItem("backroom.music.position") ?? "null")).toEqual(
      before,
    );
  });
});
