// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from "vitest";
import { landings, rattle, WOBBLE_MS, height } from "../twoup/toss.js";

/**
 * The toss's scheduling, against an AudioContext that keeps the spec's rules.
 *
 * Every other audio test in this repo either stubs `tossCoins` out or relies
 * on jsdom having no AudioContext at all, which makes the whole synthesis a
 * silent no-op. That is how an uncaught `NotSupportedError` reached players:
 * on the first real toss, and only sometimes, the felt vanished.
 *
 * Two of the spec's rules are what bite, so this fake keeps exactly those:
 *
 * - `setValueCurveAtTime` owns `[start, start + duration]`, and scheduling any
 *   other automation inside that span throws.
 * - a curve whose start is already in the past is clamped forward to
 *   `currentTime`.
 *
 * And time passes while the toss is built, the way it does in a browser on a
 * busy frame: every node created moves `currentTime` on a little. So a follow-
 * up worked out from a `now` captured at the top can land inside a curve that
 * really started later than `now` — which a margin of a few milliseconds only
 * makes rarer, never impossible.
 */

const TICK = 0.004;

class FakeParam {
  value = 0;
  private curves: Array<{ start: number; end: number }> = [];
  private times: number[] = [];

  constructor(private readonly ctx: FakeContext) {}

  private guard(at: number, what: string): void {
    for (const curve of this.curves) {
      if (at >= curve.start && at <= curve.end) {
        throw new DOMException(
          `Failed to execute '${what}' on 'AudioParam': ${what}(…, ${at}) overlaps setValueCurveAtTime(…, ${curve.start}, ${curve.end - curve.start})`,
          "NotSupportedError",
        );
      }
    }
  }

  setValueAtTime(_value: number, at: number): this {
    this.guard(at, "setValueAtTime");
    this.times.push(at);
    return this;
  }

  linearRampToValueAtTime(_value: number, at: number): this {
    this.guard(at, "linearRampToValueAtTime");
    this.times.push(at);
    return this;
  }

  exponentialRampToValueAtTime(_value: number, at: number): this {
    this.guard(at, "exponentialRampToValueAtTime");
    this.times.push(at);
    return this;
  }

  setValueCurveAtTime(_curve: Float32Array, at: number, duration: number): this {
    const start = Math.max(at, this.ctx.currentTime);
    for (const time of this.times) {
      if (time >= start && time <= start + duration) {
        throw new DOMException("setValueCurveAtTime overlaps an existing event", "NotSupportedError");
      }
    }
    this.curves.push({ start, end: start + duration });
    return this;
  }

  cancelScheduledValues(): this {
    this.curves = [];
    this.times = [];
    return this;
  }
}

const node = <T extends object>(extra: T) => ({
  connect: <N>(next: N) => next,
  ...extra,
});

class FakeContext {
  private clock = 10;
  readonly sampleRate = 48_000;
  readonly destination = {};

  get currentTime(): number {
    return this.clock;
  }

  /** Building a node costs a little time, as it does on a real frame. */
  private spend(): void {
    this.clock += TICK;
  }

  resume = async () => {};
  decodeAudioData = async () => ({});

  createGain() {
    this.spend();
    return node({ gain: new FakeParam(this) });
  }

  createBuffer(_channels: number, length: number) {
    this.spend();
    return { getChannelData: () => new Float32Array(length) };
  }

  createBufferSource() {
    this.spend();
    return node({ buffer: null, playbackRate: new FakeParam(this), start() {}, stop() {} });
  }

  createBiquadFilter() {
    this.spend();
    return node({ type: "", frequency: new FakeParam(this), Q: new FakeParam(this) });
  }

  createStereoPanner() {
    this.spend();
    return node({ pan: new FakeParam(this) });
  }

  createOscillator() {
    this.spend();
    return node({ type: "", frequency: new FakeParam(this), detune: new FakeParam(this), start() {}, stop() {} });
  }
}

type Audio = typeof import("./audio.js");
let audio: Audio;

beforeAll(async () => {
  vi.stubGlobal("AudioContext", FakeContext);
  // `unlock` starts a preload; give it a manifest with nothing in it rather
  // than a network it cannot reach.
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
  audio = await import("./audio.js");
  audio.setMuted(false);
  audio.setVolume(0.7);
  audio.unlock();
});

describe("scheduling a toss", () => {
  it("never schedules anything inside a curve, however long the toss took to build", () => {
    /*
     * The felt's own numbers. Before the fix this threw on the first call:
     * the ring's curve was clamped to start after `now`, and its damp —
     * scheduled at `now + duration` plus a margin — landed inside it.
     */
    expect(() =>
      audio.tossCoins({
        flightMs: 2_600,
        wobbleMs: WOBBLE_MS,
        height,
        landings: landings(0.16),
        rattle: rattle(),
      }),
    ).not.toThrow();
  });

  it("survives a throw whose flight is short enough that the damp comes early", () => {
    expect(() =>
      audio.tossCoins({ flightMs: 400, wobbleMs: WOBBLE_MS, height, landings: landings(0.16), rattle: rattle() }),
    ).not.toThrow();
  });
});
