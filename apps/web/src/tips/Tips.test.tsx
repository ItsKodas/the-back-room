// @vitest-environment jsdom
import type { JarView, TapResult } from "@backroom/shared";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Account } from "../game/useAccount.js";

/**
 * The optimism, and its rollback.
 *
 * A socket that answers in the same tick as it was asked proves nothing: the
 * bug this page exists to avoid only shows up when the table is slow to
 * speak. So the fake socket below lets a test hold one ack open — the same
 * gap a real connection leaves between a press and the round trip that
 * confirms it — and watch what the page says while that gap is still open.
 */

const account = vi.hoisted(() => ({ current: null as Account | null }));
vi.mock("../game/useAccount.js", () => ({ useAccount: () => account.current }));

/**
 * Only `play` is stubbed — the Navbar mounted underneath every test here
 * carries its own volume control, which reaches for the rest of this
 * module's real exports (getVolume, isMuted...) and would break without
 * them. What these tests are checking is only whether a tap does or does
 * not ask the building's one sound module to play something.
 */
const played = vi.hoisted(() => ({ calls: [] as string[] }));
vi.mock("../game/audio.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../game/audio.js")>();
  return {
    ...actual,
    play: (cue: string) => {
      played.calls.push(cue);
    },
  };
});

/** What "tips:open" answers with, one test's worth at a time. */
let openJar: JarView = jarView();
/** The ack a held tap or buy is waiting to be given. */
let heldAck: ((result: TapResult) => void) | null = null;

vi.mock("socket.io-client", () => ({
  io: () => ({
    on(event: string, handler: (...args: unknown[]) => void) {
      // The page only ever asks whether it is connected; answering at once
      // is what a socket that connected instantly would do too.
      if (event === "connect") {
        handler();
      }
    },
    emit(event: string, _payload: unknown, ack?: (...args: unknown[]) => void) {
      if (event === "tips:open") {
        ack?.(openJar);
        return;
      }
      if (event === "tips:tap" || event === "tips:buy") {
        heldAck = ack as (result: TapResult) => void;
      }
    },
    close() {},
  }),
}));

import Tips from "./Tips.js";

function jarView(overrides: Partial<JarView> = {}): JarView {
  return {
    level: 1_000,
    at: Date.now(),
    brim: 1_500,
    trickle: 60,
    scoop: 25,
    favours: 0,
    bought: [],
    chipsTonight: 0,
    nightEndsAt: Date.now() + 20 * 60 * 60 * 1000,
    token: "token-1",
    ...overrides,
  };
}

function signedIn(): Account {
  return {
    profile: {
      id: "u1",
      name: "Koda",
      avatar: null,
      accentColor: null,
      chips: 5_000,
      stats: { rounds: 0, roundsWon: 0, chipsWon: 0 },
      byGame: {},
    },
    available: true,
    loading: false,
    refresh: () => {},
    setChips: () => {},
    signOut: () => {},
  };
}

/** Holds the next tap or buy open, so a test can inspect the optimistic frame. */
function holdTheAck() {
  return {
    resolve(result: TapResult) {
      const ack = heldAck;
      heldAck = null;
      ack?.(result);
    },
  };
}

async function tapTheJar() {
  const button = await screen.findByRole("button", { name: /tap the jar/i });
  fireEvent.click(button);
}

/** Rendered inside a router, the way every page in the building is — the
    navbar's own link to the front page needs one to mount at all. */
function show() {
  return render(
    <MemoryRouter>
      <Tips />
    </MemoryRouter>,
  );
}

afterEach(() => {
  account.current = null;
  openJar = jarView();
  heldAck = null;
  played.calls = [];
});

describe("the jar you tap", () => {
  it("shows the scoop before the server answers", async () => {
    account.current = signedIn();
    const held = holdTheAck();

    show();
    await tapTheJar();

    // A stake is the player's own — the scoop is worked out from the same
    // numbers the ack will confirm, so it is on the page before the table
    // could possibly have replied.
    expect(screen.getByTestId("tonight").textContent).toBe("25");

    held.resolve({ ok: true, paid: 25, balance: 1_025, jar: jarView({ chipsTonight: 25 }) });
  });

  it("puts the level back when a tap is refused", async () => {
    account.current = signedIn();
    const held = holdTheAck();

    show();
    await tapTheJar();
    expect(screen.getByTestId("tonight").textContent).toBe("25");

    held.resolve({ ok: false, error: "The jar is dry — give it a moment.", jar: jarView() });

    expect(await screen.findByText(/the jar is dry/i)).toBeDefined();
    // The optimistic frame is gone: the refusal's own jar is what the page
    // shows now, not a number the press only guessed at.
    expect(screen.getByTestId("tonight").textContent).toBe("0");
  });

  /*
   * The chained-send bug: tap two lands optimistically before tap one's ack
   * is even back, because the client cannot send tap two until tap one's
   * token comes home. Adopting tap one's server truth must not discard the
   * optimism tap two already put on the glass — the figure has to hold at
   * two scoops the whole way through, never dip back to one before rising
   * again.
   */
  it("does not let a later tap's optimism flicker backwards when an earlier ack lands", async () => {
    account.current = signedIn();
    const held = holdTheAck();

    show();
    await tapTheJar();
    await tapTheJar();

    // Both presses landed before either was answered — two scoops of
    // optimism on the figure.
    expect(screen.getByTestId("tonight").textContent).toBe("50");

    // Tap one's ack answers while tap two is still queued (it hasn't even
    // been sent yet, since sends are chained one at a time). This must not
    // stomp the figure back down to tap one's own total.
    held.resolve({ ok: true, paid: 25, balance: 1_025, jar: jarView({ chipsTonight: 25 }) });
    expect(await screen.findByText("50")).toBeDefined();
    expect(screen.getByTestId("tonight").textContent).toBe("50");

    // Tap two's ack lands next (pump sent it the moment tap one's ack
    // freed the queue) — the figure settles on the true total.
    held.resolve({ ok: true, paid: 25, balance: 1_050, jar: jarView({ chipsTonight: 50 }) });
    expect(await screen.findByText("50")).toBeDefined();
  });

  /*
   * A jar with nothing dripped into it since the last tap must not let a
   * press vanish silently — that is indistinguishable from a broken button.
   * The client can already tell it is dry from the same numbers the server
   * would use, so nothing is even sent: the reason lands on the page at once.
   */
  it("says the jar is dry rather than showing nothing happening", async () => {
    account.current = signedIn();
    openJar = jarView({ level: 0, trickle: 0, scoop: 25 });

    show();
    await tapTheJar();

    expect(await screen.findByText(/the jar is dry/i)).toBeDefined();
    // Nothing to collect, so nothing moved — unlike a refused tap, this
    // never had a number to roll back from.
    expect(screen.getByTestId("tonight").textContent).toBe("0");
  });

  /*
   * "A chip arcs from where the thumb hit into the... out of the jar" — the
   * design's own words for what a tap looks like. The chip flies on the
   * press itself, the same instant the level drops and the counter ticks,
   * because the scoop is deterministic and both sides already agree what it
   * is — there is nothing here to wait on an ack for.
   */
  it("sends a chip out of the jar on an accepted tap", async () => {
    account.current = signedIn();

    show();
    await tapTheJar();

    expect(screen.queryByTestId("chip-flight")).not.toBeNull();
  });

  /*
   * The clink follows the same rule as the chip: it is the tap's own
   * consequence, not the ack's — it plays at the same instant the chip
   * leaves, on the press.
   */
  it("plays the clink on an accepted tap", async () => {
    account.current = signedIn();

    show();
    await tapTheJar();

    expect(played.calls).toEqual(["coin"]);
  });

  /*
   * The jar plays its own clink, so the building-wide tap click must not
   * double up on it. `useButtonSound` fences that off on `[data-quiet]` —
   * this only checks the jar still carries the attribute, since nothing
   * else here mounts that listener to catch a missing fence directly.
   */
  it("carries the opt-out that keeps the building's own click off its clink", async () => {
    account.current = signedIn();

    show();
    const button = await screen.findByRole("button", { name: /tap the jar/i });

    expect(button.hasAttribute("data-quiet")).toBe(true);
  });

  /*
   * A tap the client already knows is dry never gets far enough to be
   * "accepted" — nothing left the jar, so nothing sounds like it did.
   */
  it("stays silent on a dry tap", async () => {
    account.current = signedIn();
    openJar = jarView({ level: 0, trickle: 0, scoop: 25 });

    show();
    await tapTheJar();

    expect(await screen.findByText(/the jar is dry/i)).toBeDefined();
    expect(played.calls).toEqual([]);
  });

  /*
   * The one thing reduced motion is allowed to take away. The level and the
   * counter still change on the press either way — this only checks that
   * the decorative flight itself does not, and that the clink (governed by
   * the player's own mute and volume, not by this setting) still does.
   */
  it("sends no chip when the player has asked for less motion, but still plays the clink", async () => {
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: query.includes("prefers-reduced-motion"),
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as typeof window.matchMedia;

    try {
      account.current = signedIn();
      show();
      await tapTheJar();

      expect(screen.queryByTestId("chip-flight")).toBeNull();
      expect(played.calls).toEqual(["coin"]);
    } finally {
      window.matchMedia = original;
    }
  });
});
