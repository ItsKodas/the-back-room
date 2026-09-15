// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * iOS suspends an AudioContext whenever the app is put away and never resumes
 * it on its own. The listeners that call `unlock` are `once`, so the table had
 * no way to get its sound back for the rest of the session.
 */

class FakeContext {
  static last: FakeContext | null = null;
  state: AudioContextState | "interrupted" = "running";
  readonly destination = {};
  readonly resume = vi.fn(async () => {
    this.state = "running";
  });

  constructor() {
    FakeContext.last = this;
  }

  createGain() {
    return { gain: { value: 0 }, connect: () => {} };
  }
}

beforeAll(async () => {
  vi.stubGlobal("AudioContext", FakeContext);
  // `unlock` starts a preload; an empty manifest rather than a network it
  // cannot reach, shaped like the stub in tossCoins.test.ts.
  vi.stubGlobal(
    "fetch",
    async () =>
      ({
        ok: true,
        json: async () => ({}),
        text: async () => "{}",
        arrayBuffer: async () => new ArrayBuffer(0),
      }) as unknown as Response,
  );
  const audio = await import("./audio.js");
  audio.unlock();
});

beforeEach(() => {
  FakeContext.last?.resume.mockClear();
});

describe("after the app has been put away", () => {
  it("resumes a suspended context on the next touch anywhere", () => {
    const context = FakeContext.last as FakeContext;
    context.state = "interrupted";

    window.dispatchEvent(new Event("pointerdown"));

    expect(context.resume).toHaveBeenCalledTimes(1);
  });

  it("does the same on every later return, not just the first", () => {
    const context = FakeContext.last as FakeContext;
    for (let away = 0; away < 3; away += 1) {
      context.state = "suspended";
      window.dispatchEvent(new Event("pointerdown"));
    }

    expect(context.resume).toHaveBeenCalledTimes(3);
  });

  it("leaves a context that is already playing alone", () => {
    const context = FakeContext.last as FakeContext;
    context.state = "running";

    window.dispatchEvent(new Event("pointerdown"));

    expect(context.resume).not.toHaveBeenCalled();
  });
});
