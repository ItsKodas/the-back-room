/**
 * The game's sound.
 *
 * Two sources, deliberately. Recorded samples for the physical sounds — dice
 * on wood is not something synthesis does convincingly — and Web Audio for the
 * interface, where a synthesised tone is smaller, needs no files, and can be
 * pitch-varied per press so repeats never sound machine-gunned.
 */

export type Cue =
  | "shake"
  | "land"
  | "pick"
  | "drop"
  | "bank"
  | "farkle"
  | "greed"
  | "hotDice"
  | "yourTurn"
  | "win"
  /* Cards. A hand going out, one card landing, and the hole card turning. */
  | "deal"
  | "card"
  | "reveal"
  /* Money, in both directions: staked, and counted back to you. */
  | "bet"
  | "payout"
  /* The interface itself: any press, anywhere. */
  | "tap"
  /* The machine: the lever, a reel settling, and what it pays. */
  | "lever"
  | "reelStop"
  | "spinEnd"
  | "spinWin"
  | "jackpot"
  | "bonus"
  | "bonusAppear"
  | "coin"
  /*
   * A table talking. One short tone per move, quiet enough to sit under a
   * ten-handed table where somebody acts every second or two — these fire far
   * more often than anything else in the building, so they are the ones that
   * have to be almost not there.
   */
  | "sayCheck"
  | "sayFold"
  | "sayCall"
  | "sayRaise"
  | "sayAllIn"
  /* The pot going across the felt to whoever took it. */
  | "potPush"
  /*
   * The wheel. Everything continuous about a spin is scheduled in one go by
   * `spinWheel`; these are the two moments around it — the window shutting,
   * and the number the ball finally sat down in.
   */
  | "noMoreBets"
  | "numberUp"
  /*
   * The coins. Everything continuous about a toss — the kip, the ring, the
   * clacks, the settle — is scheduled in one go by `tossCoins`, the same way
   * the wheel's hum and roll and clatter never became cues of their own; the
   * one moment around it is the boxer's call, once the coins are down.
   */
  | "headsUp"
  | "tailsUp"
  | "oddsUp";

interface Manifest {
  dice?: string[];
  cards?: string[];
  coins?: string[];
  chips?: string[];
  slots?: string[];
  ui?: string[];
  stingers?: string[];
  ambience?: string[];
}

const VOLUME_KEY = "backroom.volume";
const MUTED_KEY = "backroom.muted";

let context: AudioContext | null = null;
let master: GainNode | null = null;
let samples: Manifest = {};
let ready = false;
/** Files already fetched and decoded, by URL. */
const decoded = new Map<string, AudioBuffer>();
/**
 * Files fetched but not yet decoded.
 *
 * Fetching needs nothing from the browser; decoding needs an AudioContext, and
 * a browser will not give us one until the player has touched the page. So the
 * two are split: bytes are pulled as soon as the page loads, and turned into
 * buffers the moment we are allowed to. On a server across an ocean that is
 * the difference between a die landing silently and landing with a knock.
 */
const fetched = new Map<string, ArrayBuffer>();
let preloading: Promise<void> | null = null;

function readVolume(): number {
  try {
    const raw = window.localStorage.getItem(VOLUME_KEY);
    if (raw !== null) {
      const value = Number(raw);
      if (Number.isFinite(value) && value >= 0 && value <= 1) {
        return value;
      }
    }
  } catch {
    // ignore
  }
  return 0.7;
}

function readMuted(): boolean {
  try {
    return window.localStorage.getItem(MUTED_KEY) === "true";
  } catch {
    return false;
  }
}

let volume = readVolume();
/**
 * Everything off, without moving anything.
 *
 * Kept apart from the volume rather than expressed as a volume of zero: mute
 * is a switch and a level is a level, and collapsing the two means unmuting
 * has to guess where the slider used to be — a guess that does not survive a
 * reload. It is also the master switch for the music, which has no volume of
 * ours to set to zero.
 */
let muted = readMuted();

function applyGain(): void {
  if (master !== null) {
    master.gain.value = muted ? 0 : volume;
  }
}

export function getVolume(): number {
  return volume;
}

export function isMuted(): boolean {
  return muted;
}

export function setMuted(next: boolean): void {
  muted = next;
  applyGain();
  try {
    window.localStorage.setItem(MUTED_KEY, String(next));
  } catch {
    // ignore
  }
}

export function setVolume(next: number): void {
  volume = Math.min(1, Math.max(0, next));
  applyGain();
  try {
    window.localStorage.setItem(VOLUME_KEY, String(volume));
  } catch {
    // ignore
  }
}

/**
 * Browsers refuse to start audio until the user has interacted with the page,
 * so this is called from the first click rather than on load.
 */
export function unlock(): void {
  if (context !== null) {
    void context.resume();
    return;
  }
  try {
    context = new AudioContext();
    master = context.createGain();
    master.gain.value = muted ? 0 : volume;
    master.connect(context.destination);
    // Anything already downloaded can become playable right now; anything not
    // yet asked for gets asked for here.
    void preload().then(decodeWaiting);
  } catch {
    context = null;
  }
}

async function loadManifest(): Promise<void> {
  try {
    const response = await fetch("/audio/manifest.json");
    if (!response.ok) {
      return;
    }
    samples = (await response.json()) as Manifest;
    ready = true;
  } catch {
    // No samples is fine — the synthesised cues still work.
  }
}

/** Every sample the manifest names, in one flat list. */
function everySample(): string[] {
  return Object.values(samples).flatMap((list) => list ?? []);
}

/**
 * Pulls every sample down ahead of time.
 *
 * Worth doing eagerly because the whole set is a few hundred kilobytes, and
 * because the cost of not doing it is paid per file rather than once: a cue
 * picks a random file from its group, so without this the first roll, the
 * second, and the third each stall on a different download.
 *
 * Safe to call more than once; safe to call before any sound is wanted.
 */
export function preload(): Promise<void> {
  preloading ??= (async () => {
    if (!ready) {
      await loadManifest();
    }
    await Promise.all(
      everySample().map(async (url) => {
        if (fetched.has(url) || decoded.has(url)) {
          return;
        }
        try {
          const response = await fetch(url);
          if (response.ok) {
            fetched.set(url, await response.arrayBuffer());
          }
        } catch {
          // A sample that will not download is not worth failing over; the
          // cue falls back to its synthesised voice.
        }
      }),
    );
    // If the player has already touched the page, there is a context waiting.
    await decodeWaiting();
  })();
  return preloading;
}

/** Turns whatever has been fetched into buffers, once there is a context. */
async function decodeWaiting(): Promise<void> {
  if (context === null) {
    return;
  }
  for (const [url, bytes] of [...fetched]) {
    try {
      // decodeAudioData detaches the buffer, so hand it a copy: a failed
      // decode must not leave an unusable husk behind in the cache.
      decoded.set(url, await context.decodeAudioData(bytes.slice(0)));
      fetched.delete(url);
    } catch {
      fetched.delete(url);
    }
  }
}

async function buffer(url: string): Promise<AudioBuffer | null> {
  const cached = decoded.get(url);
  if (cached !== undefined) {
    return cached;
  }
  if (context === null) {
    return null;
  }
  // Downloaded already but not yet decoded — the common case for a cue that
  // fires in the same moment the player first touches the page.
  const waiting = fetched.get(url);
  if (waiting !== undefined) {
    try {
      const audio = await context.decodeAudioData(waiting.slice(0));
      fetched.delete(url);
      decoded.set(url, audio);
      return audio;
    } catch {
      fetched.delete(url);
      return null;
    }
  }
  try {
    const response = await fetch(url);
    if (!response.ok) {
      return null;
    }
    const audio = await context.decodeAudioData(await response.arrayBuffer());
    decoded.set(url, audio);
    return audio;
  } catch {
    return null;
  }
}

function pick(list: string[] | undefined): string | null {
  if (list === undefined || list.length === 0) {
    return null;
  }
  return list[Math.floor(Math.random() * list.length)] ?? null;
}

/**
 * The files in a list whose names mention a word, or all of them if none do.
 *
 * Naming a file "diceshake2.mp3" or "placing_chips1.mp3" is a hint, not a
 * requirement — drop in a pile of unnamed clips and they still all play, just
 * without the split. That is what keeps the drop-a-file workflow honest: a
 * folder is never wrong, it is only ever less specific.
 *
 * Exported because this is the seam that fails quietly. A renamed file does
 * not break anything; it just stops matching, falls back to the whole folder,
 * and the wrong sound plays forever without a single error.
 */
export function preferring(files: readonly string[], word: string): string[] {
  const matching = files.filter((url) => url.toLowerCase().includes(word));
  return matching.length > 0 ? matching : [...files];
}

function pickNamed(group: keyof Manifest, word: string): string | null {
  const all = samples[group];
  if (all === undefined || all.length === 0) {
    return null;
  }
  return pick(preferring(all, word));
}

/**
 * The same sound at a different pitch, at the same length.
 *
 * `playbackRate` and `detune` are the same knob under two names: both resample
 * the buffer, so a sound an octave up is also a sound at half the length. That
 * is fine for a rattle and wrong for a run of notes, where the point is that
 * the *same* sound comes back higher.
 *
 * So the buffer is rebuilt out of overlapping windowed grains, read at the
 * pitch ratio while the read head advances at the original rate — the oldest
 * trick there is, and enough for a sting under half a second. Kept by url and
 * interval, because the same five notes play all evening.
 */
const shifted = new Map<string, AudioBuffer>();

/**
 * A Hann window of `size`, which is the envelope every grain is read through.
 *
 * At a half-grain hop two of these sum to a flat one, so overlap-adding them
 * needs no correction at all — which is the entire reason for the half hop.
 */
function hann(size: number): Float32Array {
  const shape = new Float32Array(size);
  for (let n = 0; n < size; n += 1) {
    shape[n] = 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / size);
  }
  return shape;
}

/**
 * The same audio made `factor` times longer, at the same pitch.
 *
 * Overlap-add, but with each grain allowed to slide a few milliseconds to
 * wherever it best lines up with what has already been written. That search is
 * the whole difference between this working and not: at fixed hops, successive
 * grains read points in the source that are a fixed distance apart, and for
 * any tone whose period divides that distance near-evenly the grains land in
 * antiphase and cancel. On a 440Hz sine at a 50ms grain that cancellation is
 * near-total — the sound comes out at a fraction of the level it went in, and
 * which frequencies survive depends on the interval, so the fault arrives as
 * "the third bonus is oddly quiet" rather than as anything obviously broken.
 */
function stretch(from: Float32Array, sampleRate: number, factor: number): Float32Array {
  const grain = Math.max(64, Math.round(sampleRate * 0.05));
  const hop = grain >> 1;
  // How far back through the source to step for each hop forward in the
  // output. Longer output means smaller steps through the source.
  const step = Math.max(1, Math.round(hop / factor));
  /* Three milliseconds either way: more than a period of anything with a
     pitch, and little enough that nothing audibly jumps. */
  const search = Math.max(1, Math.round(sampleRate * 0.003));

  const out = new Float32Array(Math.ceil(from.length * factor) + grain);
  const shape = hann(grain);
  let at = 0;

  for (let o = 0; o + grain <= out.length; o += hop) {
    let slide = 0;
    if (o > 0) {
      /*
       * Correlated against the tail already sitting in the output, every
       * fourth sample. A quarter of the samples is enough to find the peak of
       * a correlation this broad, and it is the difference between this
       * costing a millisecond and costing four.
       */
      let bestScore = Number.NEGATIVE_INFINITY;
      for (let d = -search; d <= search; d += 1) {
        const begin = at + d;
        if (begin < 0 || begin + hop >= from.length) {
          continue;
        }
        let score = 0;
        for (let n = 0; n < hop; n += 4) {
          score += (from[begin + n] as number) * (out[o + n] as number);
        }
        if (score > bestScore) {
          bestScore = score;
          slide = d;
        }
      }
    }

    const begin = at + slide;
    for (let n = 0; n < grain; n += 1) {
      const index = begin + n;
      if (index < 0 || index >= from.length) {
        break;
      }
      out[o + n] = (out[o + n] as number) + (shape[n] as number) * (from[index] as number);
    }

    at += step;
    if (at >= from.length) {
      break;
    }
  }
  return out;
}

/**
 * One channel, raised by `semitones` and left exactly as long as it was.
 *
 * Two steps, because the pitch and the length are two separate problems and
 * doing them at once is what makes granular shifters sound like a bad phone
 * line. First the audio is stretched to `ratio` times its length at its
 * original pitch; then it is read back at `ratio` times the rate, which puts
 * the length back where it started and takes the pitch up with it.
 *
 * Exported for the test rather than for a caller: this is the part that can be
 * subtly wrong — a shift that also stretches, or grains that cancel — in a way
 * nobody notices under a sound effect until the intervals stop landing.
 */
export function pitchShift(
  from: Float32Array,
  sampleRate: number,
  semitones: number,
): Float32Array {
  const to = new Float32Array(from.length);
  if (semitones === 0 || from.length === 0) {
    to.set(from);
    return to;
  }
  const ratio = 2 ** (semitones / 12);
  const longer = stretch(from, sampleRate, ratio);

  for (let n = 0; n < to.length; n += 1) {
    const where = n * ratio;
    const left = Math.floor(where);
    if (left + 1 >= longer.length) {
      break;
    }
    const fraction = where - left;
    to[n] = (longer[left] as number) * (1 - fraction) + (longer[left + 1] as number) * fraction;
  }

  /*
   * Matched back to the level it came in at.
   *
   * Hann at a half hop overlaps to one, so this should barely engage — but
   * "barely" is doing work at the edges, where grains run out of source, and a
   * run of five notes has to be five of the same loudness or it reads as five
   * different sounds rather than one coming back higher.
   */
  let energy = 0;
  let was = 0;
  for (let n = 0; n < to.length; n += 1) {
    energy += (to[n] as number) ** 2;
    was += (from[n] as number) ** 2;
  }
  if (energy > 0 && was > 0) {
    // Capped, because a near-silent result would otherwise be multiplied up
    // into whatever the interpolation left behind.
    const level = Math.min(2, Math.sqrt(was / energy));
    for (let n = 0; n < to.length; n += 1) {
      to[n] = (to[n] as number) * level;
    }
  }
  return to;
}

function pitchUp(audio: AudioBuffer, semitones: number): AudioBuffer {
  if (context === null) {
    return audio;
  }
  const out = context.createBuffer(audio.numberOfChannels, audio.length, audio.sampleRate);
  for (let channel = 0; channel < audio.numberOfChannels; channel += 1) {
    out
      .getChannelData(channel)
      .set(pitchShift(audio.getChannelData(channel), audio.sampleRate, semitones));
  }
  return out;
}

interface SampleOptions {
  /**
   * Semitones up. Whole numbers of them: this is used to play intervals, and
   * an interval only reads as one if it lands where a listener expects it.
   */
  semitones?: number;
  /**
   * A touch of random pitch so repeats do not machine-gun. Off wherever the
   * pitch means something, because a wobble on top of an interval is a wrong
   * note rather than a lively one.
   */
  vary?: boolean;
}

/** Plays a sample with a little pitch variation so repeats stay alive. */
async function sample(
  url: string | null,
  gain: number,
  options: SampleOptions = {},
): Promise<boolean> {
  if (!ready || context === null || master === null) {
    return false;
  }
  if (url === null) {
    return false;
  }
  const audio = await buffer(url);
  if (audio === null || context === null || master === null) {
    return false;
  }
  const { semitones = 0, vary = true } = options;

  let playing = audio;
  if (semitones !== 0) {
    const key = `${url}|${semitones}`;
    const already = shifted.get(key);
    if (already === undefined) {
      playing = pitchUp(audio, semitones);
      shifted.set(key, playing);
    } else {
      playing = already;
    }
  }

  const source = context.createBufferSource();
  source.buffer = playing;
  if (vary) {
    source.playbackRate.value = 0.94 + Math.random() * 0.12;
  }
  const level = context.createGain();
  level.gain.value = gain;
  source.connect(level).connect(master);
  source.start();
  return true;
}

interface ToneOptions {
  frequency: number;
  duration: number;
  type?: OscillatorType;
  gain?: number;
  /** Slide to this frequency across the note. */
  to?: number;
  delay?: number;
}

function tone(options: ToneOptions): void {
  if (context === null || master === null) {
    return;
  }
  const { frequency, duration, type = "sine", gain = 0.2, to, delay = 0 } = options;
  const start = context.currentTime + delay;
  const osc = context.createOscillator();
  const level = context.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(frequency, start);
  if (to !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), start + duration);
  }
  level.gain.setValueAtTime(0.0001, start);
  level.gain.exponentialRampToValueAtTime(gain, start + 0.01);
  level.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(level).connect(master);
  osc.start(start);
  osc.stop(start + duration + 0.02);
}

/**
 * A short filtered noise burst: the basis of every click and thud.
 *
 * @param q How tight the band is. One by default, which is a click with a
 * pitch to it; below one opens the filter up and the burst reads as a brush
 * rather than a tap — softer without simply being quieter.
 */
function noise(duration: number, frequency: number, gain: number, q = 1): void {
  if (context === null || master === null) {
    return;
  }
  const frames = Math.floor(context.sampleRate * duration);
  const buf = context.createBuffer(1, frames, context.sampleRate);
  const data = buf.getChannelData(0);
  for (let index = 0; index < frames; index += 1) {
    data[index] = (Math.random() * 2 - 1) * (1 - index / frames);
  }
  const source = context.createBufferSource();
  source.buffer = buf;
  const filter = context.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = frequency;
  filter.Q.value = q;
  const level = context.createGain();
  level.gain.value = gain;
  source.connect(filter).connect(level).connect(master);
  source.start();
}

export function play(
  cue: Cue,
  /**
   * How far up the run this one is, for the cues that climb.
   *
   * Only "bonusAppear" reads it. Passed as a plain count rather than a pitch
   * so the caller says what happened — "this is the third one" — and the
   * interval it turns into stays a decision this file makes.
   */
  step = 0,
): void {
  if (context === null || master === null || muted || volume === 0) {
    return;
  }
  switch (cue) {
    case "shake":
      // The throw. Recorded if we have one, a rattle of noise if not.
      void sample(pickNamed("dice", "shake"), 0.85).then((played) => {
        if (!played) {
          for (let hit = 0; hit < 6; hit += 1) {
            window.setTimeout(() => noise(0.04, 1100 + Math.random() * 800, 0.16), hit * 70);
          }
        }
      });
      break;
    case "land":
      void sample(pickNamed("dice", "roll"), 0.9).then((played) => {
        if (!played) {
          for (let hit = 0; hit < 4; hit += 1) {
            window.setTimeout(() => noise(0.05, 800 + Math.random() * 600, 0.22), hit * 45);
          }
        }
      });
      break;
    case "pick":
      noise(0.03, 2200, 0.18);
      tone({ frequency: 880, duration: 0.05, type: "triangle", gain: 0.07 });
      break;
    case "drop":
      noise(0.03, 1400, 0.12);
      break;
    case "tap":
      /*
       * Under everything, so it is closer to felt than to a click — low, wide
       * and very quiet, with no tone on top of it at all. This fires on every
       * press on the site, and anything with body to it is a nag by the
       * twentieth time somebody hears it.
       *
       * At this level it will be the first thing to disappear on small
       * speakers, which is the right way round: a press people cannot hear is
       * better than one they get tired of.
       */
      noise(0.032, 520, 0.022, 0.5);
      break;
    case "bank":
      void sample(pickNamed("chips", "placing"), 0.8).then((played) => {
        if (!played) {
          tone({ frequency: 520, duration: 0.12, type: "triangle", gain: 0.16 });
          tone({ frequency: 780, duration: 0.16, type: "triangle", gain: 0.14, delay: 0.08 });
        }
      });
      break;
    case "farkle":
      tone({ frequency: 220, to: 70, duration: 0.5, type: "sawtooth", gain: 0.14 });
      noise(0.25, 260, 0.2);
      break;
    case "greed": {
      // One note per letter, climbing, timed to the dice revealing in turn —
      // then a bell over the top once the word is complete.
      const ladder = [392, 494, 587, 659, 784, 988];
      ladder.forEach((frequency, step) => {
        tone({ frequency, duration: 0.5, type: "triangle", gain: 0.16, delay: step * 0.11 });
        tone({ frequency: frequency * 2, duration: 0.3, gain: 0.05, delay: step * 0.11 });
      });
      tone({ frequency: 1568, duration: 1.1, gain: 0.09, delay: 0.68 });
      tone({ frequency: 2350, duration: 0.9, gain: 0.04, delay: 0.7 });
      break;
    }
    case "hotDice":
      [523, 659, 784, 1046].forEach((frequency, step) => {
        tone({ frequency, duration: 0.16, type: "triangle", gain: 0.13, delay: step * 0.07 });
      });
      break;
    case "potPush":
      /*
       * Chips sliding, not chips landing. A sampled rattle if the building has
       * one, because this is a physical thing happening to physical objects;
       * the synthesised fallback is a soft wash rather than a tone, since a
       * pot being pushed has no pitch either.
       */
      void sample(pickNamed("chips", "slide"), 0.7).then((played) => {
        if (!played) {
          noise(0.22, 1600, 0.06);
          noise(0.16, 900, 0.05);
        }
      });
      break;
    /*
     * Two firm knocks, the way a croupier raps the rim. Deliberately not a
     * chime: this is an instruction and the last moment a chip can move, so it
     * wants to sound like somebody's hand rather than like a notification.
     */
    case "noMoreBets":
      noise(0.05, 320, 0.22, 0.7);
      noise(0.05, 300, 0.18, 0.7);
      tone({ frequency: 210, duration: 0.14, type: "sine", gain: 0.1, delay: 0.11 });
      return;

    /*
     * The number arriving, once the ball is in. A small two-note figure rather
     * than a win sound, because most spins are not wins and this one plays on
     * every single one of them — it says "that is the number", and whether it
     * was a good number is the felt's business.
     */
    case "numberUp":
      tone({ frequency: 620, duration: 0.1, type: "sine", gain: 0.12 });
      tone({ frequency: 930, duration: 0.22, type: "sine", gain: 0.1, delay: 0.07 });
      return;

    /*
     * The boxer's call, once the coins are down — three different figures
     * rather than one reused three times, so which one played is legible by
     * ear alone. Heads rises, tails falls to answer it, and odds — neither —
     * is the one that doesn't resolve: the same note three times, unsettled.
     */
    case "headsUp":
      tone({ frequency: 660, duration: 0.1, type: "sine", gain: 0.12 });
      tone({ frequency: 990, duration: 0.22, type: "sine", gain: 0.1, delay: 0.07 });
      return;
    case "tailsUp":
      tone({ frequency: 520, duration: 0.1, type: "sine", gain: 0.12 });
      tone({ frequency: 347, duration: 0.22, type: "sine", gain: 0.1, delay: 0.07 });
      return;
    case "oddsUp":
      tone({ frequency: 600, duration: 0.08, type: "triangle", gain: 0.1 });
      tone({ frequency: 600, duration: 0.08, type: "triangle", gain: 0.1, delay: 0.1 });
      tone({ frequency: 600, duration: 0.16, type: "triangle", gain: 0.1, delay: 0.2 });
      return;

    case "sayCheck":
      /*
       * Two knuckles on the table, which is what a check actually is. Noise
       * rather than a tone, because a knock has no pitch.
       */
      noise(0.03, 900, 0.05);
      window.setTimeout(() => noise(0.03, 900, 0.045), 95);
      break;
    case "sayFold":
      // Cards pushed away: short, soft, and downward.
      tone({ frequency: 300, to: 190, duration: 0.12, type: "sine", gain: 0.05 });
      break;
    case "sayCall":
      // Matching, so: one note, flat, no opinion about it.
      tone({ frequency: 520, duration: 0.09, type: "triangle", gain: 0.05 });
      break;
    case "sayRaise":
      // Putting it up, so the tone goes up with it.
      tone({ frequency: 520, duration: 0.09, type: "triangle", gain: 0.05 });
      tone({ frequency: 700, duration: 0.11, type: "triangle", gain: 0.05, delay: 0.07 });
      break;
    case "sayAllIn":
      // Everything, and the only one of these allowed to be a moment.
      [520, 700, 940].forEach((frequency, step) => {
        tone({
          frequency,
          duration: 0.16,
          type: "triangle",
          gain: 0.06,
          delay: step * 0.06,
        });
      });
      break;
    case "yourTurn":
      // A small brass bell: fundamental plus a fifth above it.
      tone({ frequency: 784, duration: 0.5, gain: 0.12 });
      tone({ frequency: 1176, duration: 0.4, gain: 0.06, delay: 0.01 });
      break;
    case "win":
      [523, 659, 784, 1046, 1318].forEach((frequency, step) => {
        tone({ frequency, duration: 0.35, type: "triangle", gain: 0.14, delay: step * 0.11 });
      });
      break;

    /*
     * The machine.
     *
     * Every one of these is a recorded sample first, because a slot machine is
     * a physical object and synthesis does not do sprung metal. The fallbacks
     * exist so the game is still legible with the audio folder empty, not
     * because they are as good.
     */
    case "lever":
      void sample(pickNamed("slots", "lever"), 0.75).then((played) => {
        if (!played) {
          noise(0.09, 320, 0.2, 0.6);
          tone({ frequency: 180, to: 90, duration: 0.16, type: "square", gain: 0.1 });
        }
      });
      break;
    case "reelStop":
      /*
       * Quieter than it wants to be. This fires five times a spin and a player
       * will hear it a few hundred times an evening — at full weight it stops
       * being punctuation and becomes a drum.
       */
      void sample(pickNamed("slots", "spinner_stop"), 0.5).then((played) => {
        if (!played) {
          noise(0.035, 900, 0.14, 0.8);
        }
      });
      break;
    case "bonusAppear": {
      /*
       * A bonus arriving on a reel, and each one after it higher than the
       * last. Minor thirds, so the run climbs and the fifth one — the rarest
       * spin this machine has — lands exactly an octave above the first.
       *
       * Pitched rather than resampled, and that is the whole point: sped up,
       * the second bonus is a different, shorter sound. The player is meant to
       * hear the same sound coming back higher, because what is climbing is
       * the number of them on the glass.
       */
      const semitones = Math.max(0, Math.min(4, Math.round(step))) * 3;
      void sample(pickNamed("slots", "bonus_appear"), 0.7, { semitones, vary: false }).then(
        (played) => {
          if (!played) {
            // Same interval, synthesised, so the run still climbs without it.
            const root = 660 * 2 ** (semitones / 12);
            tone({ frequency: root, duration: 0.22, type: "triangle", gain: 0.16 });
            tone({ frequency: root * 1.5, duration: 0.16, type: "sine", gain: 0.08, delay: 0.05 });
          }
        },
      );
      break;
    }
    case "spinEnd":
      /*
       * The last reel, which is a different event from a reel stopping —
       * "that one has landed" happens five times, "the spin is over" happens
       * once. It rides on top of that fifth reelStop rather than replacing it,
       * so the reel still lands and the spin still closes.
       *
       * "spin_end" and "spinner_stop" are different files and neither name
       * contains the other, which is what keeps the two cues apart: the
       * matcher falls back to the whole folder when nothing matches, and a
       * near-miss here would play a random slots sample forever without an
       * error.
       */
      void sample(pickNamed("slots", "spin_end"), 0.6).then((played) => {
        if (!played) {
          tone({ frequency: 320, duration: 0.22, type: "sine", gain: 0.1 });
        }
      });
      break;
    case "spinWin":
      void sample(pickNamed("slots", "win_sequence"), 0.8).then((played) => {
        if (!played) {
          [523, 659, 784, 1046].forEach((frequency, step) => {
            tone({ frequency, duration: 0.3, type: "triangle", gain: 0.13, delay: step * 0.09 });
          });
        }
      });
      break;
    case "jackpot":
      // The win sequence and the coins together: the machine celebrating and
      // the money arriving are two different sounds, and both belong here.
      void sample(pickNamed("slots", "win_sequence"), 0.9).then((played) => {
        if (!played) {
          [523, 659, 784, 1046, 1318, 1568].forEach((frequency, step) => {
            tone({ frequency, duration: 0.5, type: "triangle", gain: 0.15, delay: step * 0.1 });
          });
        }
      });
      void sample(pickNamed("slots", "coin_payout_1"), 0.8);
      break;
    case "coin":
      // One coin hitting the tray. Played a few times over, unevenly, so a
      // payout sounds counted rather than issued.
      void sample(pickNamed("slots", "single_coin"), 0.55).then((played) => {
        if (!played) {
          tone({ frequency: 1200 + Math.random() * 400, duration: 0.07, gain: 0.08 });
        }
      });
      break;
    case "bonus":
      void sample(pickNamed("slots", "slots_bonus"), 0.85).then((played) => {
        if (!played) {
          [659, 784, 988, 1318].forEach((frequency, step) => {
            tone({ frequency, duration: 0.4, type: "triangle", gain: 0.14, delay: step * 0.12 });
          });
        }
      });
      break;

    /*
     * A whole hand going out, rather than one card.
     *
     * Six cards played from a single sample would machine-gun even with the
     * pitch wobble, so this draws a fresh file per card from the entire card
     * folder — placing and taking alike — and staggers them unevenly. A dealer
     * does not deal on a metronome.
     */
    case "deal": {
      const cards = samples.cards ?? [];
      const count = cards.length === 0 ? 0 : 4;
      for (let index = 0; index < count; index += 1) {
        const delay = index * 135 + Math.random() * 50;
        /*
         * Quieter than a single card on purpose. These clips run about half a
         * second each and the stagger is shorter than that, so three of them
         * are sounding at once in the middle of a deal — at the gain one card
         * gets, four of them sum past full scale and clip.
         */
        window.setTimeout(() => void sample(pick(cards), 0.38), delay);
      }
      if (count === 0) {
        for (let hit = 0; hit < 4; hit += 1) {
          window.setTimeout(() => noise(0.03, 1600 + Math.random() * 500, 0.1), hit * 110);
        }
      }
      break;
    }

    // One card off the shoe: a hit, a double, or the dealer drawing.
    case "card":
      void sample(pickNamed("cards", "taking"), 0.7).then((played) => {
        if (!played) {
          noise(0.035, 1700, 0.12);
        }
      });
      break;

    // The hole card turned over, which is the moment the hand is decided.
    case "reveal":
      void sample(pickNamed("cards", "placing"), 0.8).then((played) => {
        if (!played) {
          noise(0.05, 900, 0.16);
        }
      });
      break;

    // Chips onto the felt.
    case "bet":
      void sample(pickNamed("chips", "placing"), 0.75).then((played) => {
        if (!played) {
          noise(0.04, 2400, 0.12);
          tone({ frequency: 660, duration: 0.06, type: "triangle", gain: 0.06 });
        }
      });
      break;

    /*
     * Chips counted back to you. Only ever on the way in — a loss is silence,
     * which is both cheaper to listen to and truer to a table.
     */
    case "payout":
      void sample(pickNamed("chips", "counting"), 0.85).then((played) => {
        if (!played) {
          [660, 880].forEach((frequency, step) => {
            tone({ frequency, duration: 0.18, type: "triangle", gain: 0.12, delay: step * 0.09 });
          });
        }
      });
      break;
  }
}

/** A sound that runs until it is told to stop. */
export type LoopCue = "reels" | "coins";

const LOOP_FILES: Record<LoopCue, string> = {
  // "spinning_loop" and not "spin": the folder also holds spinner_stop, and a
  // looping stop-click is a fault nobody would think to look for.
  reels: "spinning_loop",
  coins: "coin_payout_loop",
};

/**
 * Starts a looping sample and hands back the way to stop it.
 *
 * A handle rather than a second cue, because the thing that starts a loop is
 * always the thing that has to end it — and a `stop` cue in the same enum as
 * `play` is an invitation to leave one running when a component unmounts
 * mid-spin.
 *
 * Silent and harmless when there is no such file, no context yet, or the sound
 * is off: the reels are visibly turning either way.
 */
export function startLoop(cue: LoopCue, gain = 0.45): () => void {
  let stopped = false;
  let node: AudioBufferSourceNode | null = null;
  let level: GainNode | null = null;

  void (async () => {
    const url = pickNamed("slots", LOOP_FILES[cue]);
    if (url === null || !ready || context === null || master === null) {
      return;
    }
    const audio = await buffer(url);
    // Checked again: the spin can easily be over by the time this decodes.
    if (audio === null || stopped || context === null || master === null) {
      return;
    }
    const source = context.createBufferSource();
    source.buffer = audio;
    source.loop = true;
    const gainNode = context.createGain();
    gainNode.gain.value = gain;
    source.connect(gainNode).connect(master);
    source.start();
    node = source;
    level = gainNode;
  })();

  return () => {
    stopped = true;
    if (node === null || context === null) {
      return;
    }
    /*
     * Faded rather than cut. A looping sample stopped dead leaves a click,
     * which after five reels is the sound the player remembers.
     */
    const now = context.currentTime;
    const stopAt = now + 0.08;
    if (level !== null) {
      level.gain.setValueAtTime(level.gain.value, now);
      level.gain.exponentialRampToValueAtTime(0.0001, stopAt);
    }
    try {
      node.stop(stopAt);
    } catch {
      // Already stopped, which is not worth a fuss.
    }
    node = null;
    level = null;
  };
}

/**
 * The rising note under a spin that might be about to pay.
 *
 * Synthesised rather than sampled on purpose: its length is not known when it
 * starts — it lasts exactly as long as the reels are held — and a sample would
 * either be cut off or have to be chosen from a set of fixed lengths.
 *
 * Two voices a fifth apart, sliding up together under a slow swell, so it
 * reads as pressure building rather than as an alarm. Returns the way to end
 * it, which fades out over a beat rather than stopping dead.
 */
export function riser(seconds: number): () => void {
  if (context === null || master === null || muted || volume === 0) {
    return () => {};
  }
  const start = context.currentTime;
  const level = context.createGain();
  level.gain.setValueAtTime(0.0001, start);
  level.gain.exponentialRampToValueAtTime(0.09, start + seconds * 0.85);
  level.connect(master);

  const voices = [1, 1.5].map((interval, index) => {
    const osc = (context as AudioContext).createOscillator();
    osc.type = index === 0 ? "triangle" : "sine";
    osc.frequency.setValueAtTime(180 * interval, start);
    osc.frequency.exponentialRampToValueAtTime(760 * interval, start + seconds);
    osc.connect(level);
    osc.start(start);
    return osc;
  });

  return () => {
    if (context === null) {
      return;
    }
    const now = context.currentTime;
    const end = now + 0.12;
    level.gain.cancelScheduledValues(now);
    level.gain.setValueAtTime(Math.max(0.0001, level.gain.value), now);
    level.gain.exponentialRampToValueAtTime(0.0001, end);
    for (const osc of voices) {
      try {
        osc.stop(end + 0.02);
      } catch {
        // Already stopped.
      }
    }
  };
}

/**
 * A sound somebody uploaded, played the once.
 *
 * Emote sounds are not cues: there is no fixed set of them, they arrive as
 * URLs the server hands over, and a new one can appear without this file
 * changing. What they share with every other sound in the building is the
 * thing that matters — they go through the master gain, so the player's own
 * volume and mute govern them exactly as they govern everything else. An
 * `<audio>` element would have been fewer lines and would have played on
 * regardless of both.
 *
 * Silently does nothing before the page has been touched, because the browser
 * would refuse anyway, and a taunt that cannot be heard is not worth an error.
 */
export async function playEmoteSound(url: string, gain = 0.7): Promise<void> {
  if (context === null || master === null) {
    return;
  }
  const audio = await buffer(url);
  // Decoded and cached by `buffer`, so a taunt thrown twice downloads once.
  if (audio === null || context === null || master === null) {
    return;
  }
  const source = context.createBufferSource();
  source.buffer = audio;
  const level = context.createGain();
  level.gain.value = gain;
  source.connect(level).connect(master);
  source.start();
}

/**
 * The whole of a roulette spin, as one scheduled sound.
 *
 * Placeholders. Every one of these is synthesised, and a ball on a lacquered
 * track is exactly the sort of physical thing this file says should be
 * sampled — so these are meant to be replaced, and are written to be easy to
 * replace: one function, one call, nothing about the wheel's timings living
 * anywhere else.
 *
 * Scheduled up front rather than driven by timers, and that is the part worth
 * keeping whatever the sounds become. The whole arc is known the moment the
 * ball is released, so every event is placed on the audio clock in one go.
 * Timers fired from React would drift against the animation on a busy frame,
 * and the drift a listener notices first is a clatter that does not land with
 * the ball they can see.
 *
 * The four voices are the four things happening: the wheel's low hum dying
 * with the rim, the ball's roll running the length of the spin, the frets it
 * clatters through once it drops, and the click of it settling.
 */
export function spinWheel(options: {
  /** How long the ball is in the air. */
  spinMs: number;
  /** When the wheel itself comes to rest, as a share of the spin. */
  rimAt: number;
  /** When the ball comes off the track, as a share of the spin. */
  dropAt: number;
  /**
   * When each pocket passes the marker, as shares of the wheel's own run.
   *
   * Worked out from the curve the rim is animated by, so the clicks land on
   * pockets the player can watch going past rather than on a rhythm chosen
   * here. See spin.ts — this only schedules what it is given.
   */
  ticks?: readonly number[];
}): () => void {
  if (context === null || master === null || muted || volume === 0) {
    return () => {};
  }
  const now = context.currentTime;
  const seconds = options.spinMs / 1000;
  const drop = now + seconds * options.dropAt;
  const rimEnds = now + seconds * options.rimAt;
  const settled = now + seconds * 0.97;

  const stop: Array<{ stop(when: number): void }> = [];
  const bus = context.createGain();
  bus.gain.value = 1;
  bus.connect(master);

  /*
   * The wheel: a low hum with a fifth above it, sliding down as the rim loses
   * speed and gone by the time it stops. Two voices rather than one because a
   * single sine reads as a test tone; a fifth apart it reads as mass.
   */
  const hum = context.createGain();
  hum.gain.setValueAtTime(0.0001, now);
  hum.gain.exponentialRampToValueAtTime(0.05, now + 0.4);
  hum.gain.exponentialRampToValueAtTime(0.0001, rimEnds);
  hum.connect(bus);
  for (const [at, interval] of [
    ["triangle", 1],
    ["sine", 1.5],
  ] as const) {
    const osc = context.createOscillator();
    osc.type = at;
    osc.frequency.setValueAtTime(58 * interval, now);
    osc.frequency.exponentialRampToValueAtTime(22 * interval, rimEnds);
    osc.connect(hum);
    osc.start(now);
    stop.push(osc);
  }

  /*
   * The ball: filtered noise, because a ball running a track is a rush of air
   * and not a note. The filter opens high while it is up on the rim and closes
   * as it slows, which is what makes it read as losing speed rather than
   * simply getting quieter — a roll that only fades sounds like someone
   * turning it down.
   */
  const frames = Math.floor(context.sampleRate * 2);
  const rush = context.createBuffer(1, frames, context.sampleRate);
  const data = rush.getChannelData(0);
  for (let index = 0; index < frames; index += 1) {
    data[index] = Math.random() * 2 - 1;
  }
  const roll = context.createBufferSource();
  roll.buffer = rush;
  roll.loop = true;
  const band = context.createBiquadFilter();
  band.type = "bandpass";
  band.Q.value = 6;
  band.frequency.setValueAtTime(1400, now);
  band.frequency.linearRampToValueAtTime(1150, drop);
  band.frequency.exponentialRampToValueAtTime(240, settled);
  const rollLevel = context.createGain();
  rollLevel.gain.setValueAtTime(0.0001, now);
  rollLevel.gain.exponentialRampToValueAtTime(0.07, now + 0.25);
  rollLevel.gain.setValueAtTime(0.07, drop);
  rollLevel.gain.exponentialRampToValueAtTime(0.0001, settled);
  roll.connect(band).connect(rollLevel).connect(bus);
  roll.start(now);
  stop.push(roll);

  /*
   * The frets: a run of clicks from the moment it comes off the track, coming
   * closer together and quieter as it loses the last of its speed. Spaced by
   * the same shape the ball is drawn with, so the last few crowd together the
   * way they do when a ball is hunting a pocket.
   */
  const clatters = 11;
  for (let index = 0; index < clatters; index += 1) {
    const through = index / (clatters - 1);
    const when = drop + (settled - drop) * (1 - (1 - through) ** 1.8);
    const level = context.createGain();
    level.gain.value = 0.16 * (1 - through) ** 0.8 + 0.02;
    level.connect(bus);
    const click = context.createBufferSource();
    const short = Math.floor(context.sampleRate * 0.03);
    const buf = context.createBuffer(1, short, context.sampleRate);
    const bits = buf.getChannelData(0);
    for (let at = 0; at < short; at += 1) {
      bits[at] = (Math.random() * 2 - 1) * (1 - at / short) ** 3;
    }
    click.buffer = buf;
    const edge = context.createBiquadFilter();
    edge.type = "bandpass";
    edge.frequency.value = 2600 - through * 1200;
    edge.Q.value = 3;
    click.connect(edge).connect(level);
    click.start(when);
    stop.push(click);
  }

  /*
   * The rim's ticking: one click for each pocket going past the marker.
   *
   * Not a rhythm but the rotation itself, heard — which is why the times come
   * from the same curve the rim is drawn with. They widen on their own as the
   * wheel runs down, and that widening is the whole sound of a wheel stopping.
   * Sharper and quieter than the ball's clatter through the frets, because a
   * marker flicking over a fret is a lighter thing than a ball dropping onto
   * one, and there are a great many more of them.
   */
  const rimRun = seconds * options.rimAt;
  for (const share of options.ticks ?? []) {
    const when = now + rimRun * share;
    const level = context.createGain();
    /*
     * Loud enough to be a tick from the first one. They still swell as they
     * thin out, so the last few carry, but the floor is what a wheel at speed
     * is: a fast, present rattle rather than something faint behind the roll.
     */
    level.gain.value = 0.12 + 0.13 * share;
    level.connect(bus);
    const tick = context.createBufferSource();
    const short = Math.floor(context.sampleRate * 0.012);
    const buf = context.createBuffer(1, short, context.sampleRate);
    const bits = buf.getChannelData(0);
    for (let at = 0; at < short; at += 1) {
      bits[at] = (Math.random() * 2 - 1) * (1 - at / short) ** 5;
    }
    tick.buffer = buf;
    const edge = context.createBiquadFilter();
    edge.type = "bandpass";
    edge.frequency.value = 3400;
    edge.Q.value = 8;
    tick.connect(edge).connect(level);
    tick.start(when);
    stop.push(tick);
  }

  return () => {
    if (context === null) {
      return;
    }
    const at = context.currentTime;
    const end = at + 0.1;
    bus.gain.cancelScheduledValues(at);
    bus.gain.setValueAtTime(Math.max(0.0001, bus.gain.value), at);
    bus.gain.exponentialRampToValueAtTime(0.0001, end);
    for (const node of stop) {
      try {
        node.stop(end + 0.02);
      } catch {
        // Already stopped, or never started. Neither is worth a fuss.
      }
    }
  };
}

/**
 * A short one-shot noise burst, filtered, with its own start time, connected
 * straight to the bus a caller hands in.
 *
 * Built inline rather than through the `noise()` helper above for the same
 * reason `spinWheel`'s own clicks are: `noise()` starts immediately and
 * always speaks to `master`, and everything here is scheduled ahead of the
 * moment it plays and has to fade with the rest of its own toss.
 */
function burst(
  audio: AudioContext,
  bus: GainNode,
  when: number,
  duration: number,
  frequency: number,
  gain: number,
  q: number,
): AudioBufferSourceNode {
  const frames = Math.max(4, Math.floor(audio.sampleRate * duration));
  const buf = audio.createBuffer(1, frames, audio.sampleRate);
  const data = buf.getChannelData(0);
  for (let index = 0; index < frames; index += 1) {
    data[index] = (Math.random() * 2 - 1) * (1 - index / frames) ** 2;
  }
  const source = audio.createBufferSource();
  source.buffer = buf;
  const band = audio.createBiquadFilter();
  band.type = "bandpass";
  band.frequency.value = frequency;
  band.Q.value = q;
  const level = audio.createGain();
  level.gain.value = gain;
  source.connect(band).connect(level).connect(bus);
  source.start(when);
  return source;
}

/**
 * The whole of a coin toss, as one scheduled sound.
 *
 * Placeholders for `coinClack`, the same way every voice in `spinWheel` is:
 * synthesised because there was nothing to sample yet, and easy to replace
 * because nothing about the toss's own numbers lives anywhere else — every
 * curve here (`height`, `wobbleMs`, `landings`, `rattle`) is an argument from
 * `twoup/toss.ts` rather than a copy of it, the same reason `spinWheel`'s
 * `ticks` is an argument rather than a reach into `roulette/spin.ts`. This
 * file stays free of any one game's own curve module.
 *
 * Four voices, in the order they happen: the kip that flicks the coins up,
 * the ring the two of them carry through the air, the clack of each landing
 * (sampled the moment there is anything to sample — see `samples.coins`),
 * and the rattle of each settling flat.
 */
export function tossCoins(options: {
  /** How long the coins are in the air. */
  flightMs: number;
  /** How long a landed coin rattles before it is still. */
  wobbleMs: number;
  /** The coin's height over its flight, nought on the felt and one at the apex. */
  height: (t: number) => number;
  /** When each coin lands, as shares of the flight — `landings()`. */
  landings: readonly number[];
  /** When the settling coin knocks, as shares of its own wobble — `rattle()`. */
  rattle: readonly number[];
}): () => void {
  if (context === null || master === null || muted || volume === 0) {
    return () => {};
  }
  // Captured locally: `context` is narrowed here, but not inside the
  // `forEach` closures below — a nested function is a boundary TypeScript
  // won't carry a mutable outer binding's narrowing across.
  const audio = context;
  const now = audio.currentTime;
  const seconds = options.flightMs / 1000;

  const stop: Array<{ stop(when: number): void }> = [];
  const bus = audio.createGain();
  bus.gain.value = 1;
  bus.connect(master);

  /*
   * The kip: wood flicking the coins into the air. A rising sweep because
   * that is the sound of the kip itself accelerating through them, cut dead
   * rather than faded — the kip lets go, it doesn't decay.
   */
  {
    const duration = 0.12;
    const frames = Math.floor(context.sampleRate * duration);
    const buf = context.createBuffer(1, frames, context.sampleRate);
    const data = buf.getChannelData(0);
    for (let index = 0; index < frames; index += 1) {
      data[index] = Math.random() * 2 - 1;
    }
    const source = context.createBufferSource();
    source.buffer = buf;
    const band = context.createBiquadFilter();
    band.type = "bandpass";
    band.Q.value = 2.2;
    band.frequency.setValueAtTime(450, now);
    band.frequency.linearRampToValueAtTime(2600, now + duration);
    const level = context.createGain();
    level.gain.setValueAtTime(0.13, now);
    level.gain.setValueAtTime(0.13, now + duration - 0.01);
    level.gain.setValueAtTime(0.0001, now + duration);
    source.connect(band).connect(level).connect(bus);
    source.start(now);
    stop.push(source);
  }

  /*
   * The ring: two struck-disc voices, one per coin, panned apart and detuned
   * a few cents from each other so the pair reads as two objects rather than
   * one. Each voice's own envelope runs across only that coin's own flight —
   * `landings()`'s two shares, not the whole toss — because the coin that
   * lands first stops ringing first. `1 : 1.59 : 2.14` is a strike's own
   * spectrum: a flat disc is not a harmonic series, so integer ratios would
   * read as a bell or a chime rather than as metal.
   */
  {
    const ratios = [1, 1.59, 2.14];
    const partialGain = [0.022, 0.011, 0.006];
    const baseFrequency = 2200;
    const voices: Array<{ pan: number; cents: number }> = [
      { pan: -0.16, cents: -4 },
      { pan: 0.16, cents: 4 },
    ];

    voices.forEach((voice, index) => {
      const share = options.landings[index] ?? 1;
      const duration = Math.max(0.05, seconds * share);
      const points = 32;
      const curve = new Float32Array(points);
      for (let sample = 0; sample < points; sample += 1) {
        const t = sample / (points - 1);
        // Quietest at the apex, per `options.height`, loudest at either end —
        // very quiet throughout, the way CLAUDE.md asks anything that has to
        // live under twenty presses to be.
        curve[sample] = 0.09 + 0.28 * (1 - options.height(t));
      }
      const level = audio.createGain();
      level.gain.setValueCurveAtTime(curve, now, duration);
      // Damped rather than left to hold at the curve's last value: a real
      // strike's ring is cut short by the impact, not switched off later.
      level.gain.setValueAtTime(curve[points - 1] ?? 0, now + duration);
      level.gain.exponentialRampToValueAtTime(0.0001, now + duration + 0.03);
      const panner = audio.createStereoPanner();
      panner.pan.value = voice.pan;
      level.connect(panner).connect(bus);

      ratios.forEach((ratio, partial) => {
        const osc = audio.createOscillator();
        osc.type = "sine";
        osc.frequency.value = baseFrequency * ratio;
        osc.detune.value = voice.cents;
        const partialLevel = audio.createGain();
        partialLevel.gain.value = partialGain[partial] ?? 0.01;
        osc.connect(partialLevel).connect(level);
        osc.start(now);
        osc.stop(now + duration + 0.05);
        stop.push(osc);
      });
    });
  }

  /*
   * The clack: each coin's own impact, at `landings()`'s own times. A sample
   * the moment there is one to reach for — a coin on wood is exactly the
   * physical sound CLAUDE.md asks to be recorded rather than synthesised —
   * and a short resonant noise burst until then.
   */
  for (const share of options.landings) {
    const when = now + seconds * share;
    const url = pick(samples.coins);
    const clip = url === null ? undefined : decoded.get(url);
    if (clip !== undefined) {
      const source = context.createBufferSource();
      source.buffer = clip;
      source.playbackRate.value = 0.94 + Math.random() * 0.12;
      const level = context.createGain();
      level.gain.value = 0.8;
      source.connect(level).connect(bus);
      source.start(when);
      stop.push(source);
      continue;
    }
    stop.push(burst(context, bus, when, 0.05, 1500, 0.17, 9));
  }

  /*
   * The rattle: each coin's own settle, independently — two coins flatten at
   * two different moments, and a single shared rattle would read as one
   * heavy thing rather than two coins. `rattle()`'s shares accelerate as
   * they die (see its own doc comment); that acceleration is reproduced here
   * only by walking the same array in order, never by a second rhythm.
   */
  for (const landing of options.landings) {
    const landedAt = now + seconds * landing;
    for (const t of options.rattle) {
      const when = landedAt + (options.wobbleMs / 1000) * t;
      const duration = 0.018 * (1 - t) + 0.004;
      const gain = 0.05 * (1 - t) ** 1.6;
      stop.push(burst(context, bus, when, duration, 2100, gain, 5));
    }
  }

  return () => {
    if (context === null) {
      return;
    }
    const at = context.currentTime;
    const end = at + 0.08;
    bus.gain.cancelScheduledValues(at);
    bus.gain.setValueAtTime(Math.max(0.0001, bus.gain.value), at);
    bus.gain.exponentialRampToValueAtTime(0.0001, end);
    for (const node of stop) {
      try {
        node.stop(end + 0.02);
      } catch {
        // Already stopped, or never started. Neither is worth a fuss.
      }
    }
  };
}
