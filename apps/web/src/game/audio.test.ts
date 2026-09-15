import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { onset, pitchShift, preferring } from "./audio.js";

/**
 * The sound files themselves, read where they are dropped.
 *
 * The raw folders rather than the generated manifest: the manifest is written
 * by a build step and is not in the repository, so a test that read it would
 * pass here and explode on a fresh checkout. These are the files somebody
 * actually adds, which is also what the check is about — that the words the
 * cues search for still match what is there. A rename breaks nothing loudly:
 * the search falls back to the whole folder and the wrong sound plays forever
 * without an error anywhere.
 */
function group(name: string): string[] {
  const folder = fileURLToPath(new URL(`../../../../assets/audio/raw/${name}`, import.meta.url));
  try {
    return readdirSync(folder).filter((file) => /\.(mp3|ogg|wav|m4a|webm)$/i.test(file));
  } catch {
    return [];
  }
}

describe("choosing a sample by name", () => {
  it("keeps only the files that mention the word", () => {
    const files = ["/a/placing_chips1.mp3", "/a/counting_chips1.mp3", "/a/placing_chips2.mp3"];
    expect(preferring(files, "placing")).toEqual([
      "/a/placing_chips1.mp3",
      "/a/placing_chips2.mp3",
    ]);
    expect(preferring(files, "counting")).toEqual(["/a/counting_chips1.mp3"]);
  });

  it("falls back to the whole folder when nothing matches", () => {
    // The drop-a-file workflow: unnamed clips still play, just without a split.
    const files = ["/a/one.mp3", "/a/two.mp3"];
    expect(preferring(files, "placing")).toEqual(files);
  });

  it("never hands back an empty list to choose from", () => {
    expect(preferring([], "placing")).toEqual([]);
  });

  it("matches on the name rather than the folder", () => {
    // "/audio/chips/..." contains "chips" in its path, which must not make
    // every file in the folder count as a match for a word in a filename.
    const files = ["/audio/chips/counting_chips1.mp3", "/audio/chips/placing_chips1.mp3"];
    expect(preferring(files, "counting")).toEqual(["/audio/chips/counting_chips1.mp3"]);
  });
});

describe("the words the cues search for still find files", () => {
  /*
   * Each row is a cue and the word it looks up. Skipped when the folder is
   * empty, because an empty folder is a legitimate state — the game falls back
   * to its synthesised voice — and failing on it would make every checkout
   * without the audio assets red.
   */
  const wanted: Array<[cue: string, folder: string, word: string]> = [
    ["shake", "dice", "shake"],
    ["land", "dice", "roll"],
    ["card", "cards", "taking"],
    ["reveal", "cards", "placing"],
    ["bet / bank", "chips", "placing"],
    ["payout", "chips", "counting"],
    ["lever", "slots", "lever"],
    ["reelStop", "slots", "spinner_stop"],
    ["spinEnd", "slots", "spin_end"],
    ["spinWin", "slots", "win_sequence"],
    ["bonus", "slots", "slots_bonus"],
    ["bonusAppear", "slots", "bonus_appear"],
    ["coin", "slots", "coin"],
    ["tap", "ui", "soft_click"],
    ["pick", "ui", "pop"],
    ["drop", "ui", "hard_click"],
    ["yourTurn", "ui", "notification"],
    ["hotDice", "ui", "happy_notify"],
    ["farkle", "ui", "error"],
    ["noMoreBets", "ui", "warn"],
    ["open", "ui", "ui_open"],
    ["close", "ui", "ui_close"],
  ];

  for (const [cue, folder, word] of wanted) {
    it(`${cue} finds a "${word}" file in ${folder}`, () => {
      const files = group(folder);
      if (files.length === 0) {
        return;
      }
      const chosen = preferring(files, word);
      expect(chosen.length).toBeGreaterThan(0);
      // The point of the test: it matched, rather than falling back to all.
      expect(
        chosen.every((url) => url.toLowerCase().includes(word)),
        `nothing in ${folder} is named "${word}", so ${cue} plays whatever is there`,
      ).toBe(true);
    });
  }

  it("gives the deal something to stagger", () => {
    const cards = group("cards");
    if (cards.length === 0) {
      return;
    }
    // A hand is four sounds drawn at random; one file would machine-gun.
    expect(cards.length).toBeGreaterThan(1);
  });
});

/*
 * Where a clip actually starts.
 *
 * The files dropped in are not trimmed, and a press that plays 200ms of
 * nothing before its click is a press that feels broken. Measured, not
 * assumed: soft_click.mp3 arrived with 216ms of silence in front of it.
 */
describe("finding where a sample starts", () => {
  const rate = 1000;

  function clip(silent: number, length: number): Float32Array {
    const data = new Float32Array(length);
    for (let n = silent; n < length; n += 1) {
      data[n] = 0.5;
    }
    return data;
  }

  it("skips the silence in front of the sound", () => {
    // 200 silent samples at 1kHz is 200ms; backed off 3ms so the attack survives.
    expect(onset([clip(200, 400)], rate)).toBeCloseTo(0.197, 5);
  });

  it("starts at once when there is nothing to skip", () => {
    expect(onset([clip(0, 400)], rate)).toBe(0);
  });

  it("ignores noise under the threshold", () => {
    const data = clip(200, 400);
    for (let n = 0; n < 200; n += 1) {
      data[n] = 0.001; // about -60dB: hiss, not sound
    }
    expect(onset([data], rate)).toBeCloseTo(0.197, 5);
  });

  it("starts where the earliest channel does", () => {
    expect(onset([clip(300, 400), clip(100, 400)], rate)).toBeCloseTo(0.097, 5);
  });

  it("plays a clip that is silent throughout from the top", () => {
    // Nothing to find is not a reason to skip the whole thing.
    expect(onset([new Float32Array(400)], rate)).toBe(0);
  });
});

/*
 * The two that are one character apart.
 *
 * "spinner_stop" is a reel landing and fires five times a spin; "spin_end" is
 * the spin being over and fires once. Both live in the same folder and both
 * start with "spin", so a word that matched the wrong file — or both — would
 * play a reel click as the closing flourish, or the flourish five times a
 * spin. Neither would look like a bug; both would sound like one.
 */
describe("the slots cues that nearly collide", () => {
  it("keeps the reel landing and the spin ending apart", () => {
    const files = group("slots");
    if (files.length === 0) {
      return;
    }
    const landing = preferring(files, "spinner_stop");
    const ending = preferring(files, "spin_end");
    expect(landing.length).toBeGreaterThan(0);
    expect(ending.length).toBeGreaterThan(0);
    for (const file of landing) {
      expect(ending).not.toContain(file);
    }
    // And the spinning loop is a third thing again, not either of these.
    const loop = preferring(files, "spinning_loop");
    expect(loop).not.toEqual(landing);
    expect(loop).not.toEqual(ending);
  });

  it("keeps the bonus payout and the bonus landing apart", () => {
    /*
     * "bonus" on its own matches both slots_bonus and bonus_appear, so the cue
     * that celebrates winning the free spins would have played the little ping
     * a reel makes about half the time — and the other half it would have been
     * right, which is the worst way for this to be wrong.
     */
    const files = group("slots");
    if (files.length === 0) {
      return;
    }
    const payout = preferring(files, "slots_bonus");
    const landing = preferring(files, "bonus_appear");
    expect(payout.length).toBeGreaterThan(0);
    expect(landing.length).toBeGreaterThan(0);
    for (const file of payout) {
      expect(landing).not.toContain(file);
    }
  });
});

/**
 * Raising the pitch without shortening the sound.
 *
 * The whole requirement in one sentence, and the one thing `playbackRate`
 * cannot do: it is the same knob as `detune`, and both resample — so a sound
 * an octave up is also a sound at half the length. A run of bonuses landing is
 * meant to be the same sound coming back higher, not a shorter one.
 */
describe("pitching a sample up", () => {
  const RATE = 44_100;

  /** A second of a sine at `hz`, which is a signal with an obvious answer. */
  function sine(hz: number, seconds = 0.5): Float32Array {
    const samples = new Float32Array(Math.round(RATE * seconds));
    for (let n = 0; n < samples.length; n += 1) {
      samples[n] = Math.sin((2 * Math.PI * hz * n) / RATE);
    }
    return samples;
  }

  /**
   * The strength of `hz` in a signal, by the Goertzel algorithm.
   *
   * A whole FFT to answer one question about one frequency would be a lot of
   * code to review; this is six lines and says the same thing.
   */
  function strengthAt(samples: Float32Array, hz: number): number {
    const k = (2 * Math.PI * hz) / RATE;
    const coefficient = 2 * Math.cos(k);
    let previous = 0;
    let older = 0;
    for (const value of samples) {
      const current = value + coefficient * previous - older;
      older = previous;
      previous = current;
    }
    return Math.sqrt(previous * previous + older * older - coefficient * previous * older);
  }

  it("leaves the sound exactly as long as it was", () => {
    const from = sine(440);
    for (const semitones of [3, 6, 9, 12]) {
      expect(pitchShift(from, RATE, semitones).length).toBe(from.length);
    }
  });

  it("puts an octave up an octave up", () => {
    const from = sine(440);
    const up = pitchShift(from, RATE, 12);
    // Louder at 880 than at 440: the note moved rather than gaining a harmonic.
    expect(strengthAt(up, 880)).toBeGreaterThan(strengthAt(up, 440) * 4);
    // And it was the other way round before, so the test is measuring the shift.
    expect(strengthAt(from, 440)).toBeGreaterThan(strengthAt(from, 880) * 4);
  });

  it("climbs with each step of the run", () => {
    const from = sine(440);
    let last = 0;
    for (const semitones of [0, 3, 6, 9, 12]) {
      const up = pitchShift(from, RATE, semitones);
      const expected = 440 * 2 ** (semitones / 12);
      expect(strengthAt(up, expected)).toBeGreaterThan(strengthAt(up, 440 * 1.02));
      expect(expected).toBeGreaterThan(last);
      last = expected;
    }
  });

  it("hands back the sound untouched when nothing was asked for", () => {
    const from = sine(440);
    expect([...pitchShift(from, RATE, 0)]).toEqual([...from]);
  });

  it("plays every step of the run at the same loudness", () => {
    /*
     * Not a nicety. Overlapping grains at a shifted ratio add out of phase by
     * an amount that depends on the interval, so a fixed correction leaves
     * each note a different loudness — a run that climbs in pitch and wanders
     * in volume, which reads as five different sounds rather than as one
     * coming back higher.
     */
    const from = sine(440);
    const rms = (samples: Float32Array): number => {
      let energy = 0;
      for (const value of samples) {
        energy += value * value;
      }
      return Math.sqrt(energy / samples.length);
    };
    const was = rms(from);
    for (const semitones of [3, 6, 9, 12]) {
      expect(rms(pitchShift(from, RATE, semitones))).toBeCloseTo(was, 2);
    }
  });

  it("does not clip", () => {
    // The failure that reaches a player as a crackle rather than a wrong note.
    const from = sine(440);
    for (const semitones of [3, 12]) {
      let peak = 0;
      for (const value of pitchShift(from, RATE, semitones)) {
        peak = Math.max(peak, Math.abs(value));
      }
      expect(peak).toBeLessThanOrEqual(1.1);
    }
  });

  it("copes with a sound too short to hold a single grain", () => {
    // Nothing in the folder is this short, but the guard is one comparison and
    // the alternative is an exception on a sound effect.
    expect(() => pitchShift(new Float32Array(16), RATE, 12)).not.toThrow();
    expect(() => pitchShift(new Float32Array(0), RATE, 12)).not.toThrow();
  });
});
