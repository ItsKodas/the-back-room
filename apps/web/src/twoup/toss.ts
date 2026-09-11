/**
 * How a coin goes up, turns over, and comes to rest.
 *
 * One description, used twice: the stylesheet animates from these and the
 * sound is scheduled against them. Those had been two sets of numbers that
 * "have to agree", which is an agreement that lasts exactly until the first
 * change — and the first thing a listener notices is a clatter that does not
 * land with the coins they are watching.
 */

/**
 * A profile is a velocity curve, not a position curve, because velocity is
 * what a thing slowing down actually has and it is the only form in which any
 * of this is worth arguing about. Position is its integral and falls out.
 */
export interface Profile {
  /** How much of the spin is spent barely slowing at all. */
  free: number;
  /** What share of its speed it still has at the end of that. */
  keep: number;
  /**
   * How the rest of the speed goes.
   *
   * Above one the deceleration eases off as it settles; at one it is constant;
   * below one it runs away at the end and the thing is yanked to a halt rather
   * than coming to rest. Every wrong version of this animation was a wrong
   * value here.
   */
  tail: number;
}

/** How fast it is going, as a share of its launch speed. */
export function speed(profile: Profile, t: number): number {
  if (t <= profile.free) {
    return 1 - (1 - profile.keep) * (t / profile.free);
  }
  const through = (t - profile.free) / (1 - profile.free);
  return profile.keep * (1 - through) ** profile.tail;
}

/** How many samples the integral is taken over. Fine enough to be exact here. */
const STEPS = 2_000;

/**
 * How far round it is at time `t`, from nought to one.
 *
 * The integral of the speed, normalised so a spin covers exactly its turns.
 */
export function progress(profile: Profile): (t: number) => number {
  const cumulative: number[] = [0];
  for (let step = 1; step <= STEPS; step += 1) {
    const from = (step - 1) / STEPS;
    const to = step / STEPS;
    cumulative.push(
      (cumulative[step - 1] as number) + ((speed(profile, from) + speed(profile, to)) / 2) * (1 / STEPS),
    );
  }
  const total = cumulative[STEPS] as number;
  return (t: number) => {
    const at = Math.min(STEPS, Math.max(0, Math.round(t * STEPS)));
    return (cumulative[at] as number) / total;
  };
}

/**
 * The profile as a CSS timing function.
 *
 * Sampled densely over the last stretch and to six decimals, both for the same
 * reason: near the end there is very little progress left to describe, and at
 * coarser resolution the settle collapses into a handful of visible steps.
 */
export function easing(profile: Profile): string {
  const at = progress(profile);
  const points = [...Array.from({ length: 18 }, (_, i) => i / 20), 0.9, 0.92, 0.94, 0.96, 0.97, 0.98, 0.99, 0.995, 1];
  return `linear(${points
    .map((t) => (t === 0 ? "0" : t === 1 ? "1" : `${at(t).toFixed(6)} ${+(t * 100).toFixed(4)}%`))
    .join(", ")})`;
}

/**
 * How high the coin is, from nought on the felt to one at the apex.
 *
 * A parabola, because gravity is one. It is worth saying that this is not a
 * curve anybody chose: the hang at the top — which is the whole feeling of a
 * toss, and what a real ring is shouting through — falls out of the arithmetic
 * rather than being dialled in. A coin spends nearly half its flight in the top
 * fifth of it — 4t(1-t) is at or above 0.8 across t in [0.276, 0.724], which is
 * 44.7% — and nothing had to be tuned to make that true.
 */
export function height(t: number): number {
  const at = Math.min(1, Math.max(0, t));
  return 4 * at * (1 - at);
}

/**
 * The arc, as a curve the stylesheet can animate the coin's rise along.
 *
 * `free: 1` and `keep: 1` because there is no deceleration to describe here —
 * the shape is `height` and the profile machinery is only being borrowed for
 * its sampling.
 */
export const FLIGHT: Profile = { free: 1, keep: 1, tail: 1 };

/**
 * The tumble.
 *
 * Very nearly linear, and that is the detail most coin animations get wrong.
 * Nothing decelerates a coin between the kip and the felt — no bearing, no
 * friction, nothing but a little air — so easing the rotation out is what makes
 * an animation of one read as a prop being turned over rather than a coin that
 * was thrown. What slowing there is happens in the last moment, as it hits.
 */
export const SPIN: Profile = { free: 0.95, keep: 0.99, tail: 1.05 };

/**
 * The settle.
 *
 * The one curve here that is yanked to a halt rather than coming to rest, and
 * the only place in this repo where a tail below one is the thing being drawn
 * rather than a bug. A disc coming down flat does not ease off; it goes over,
 * rattles faster and faster as it flattens, and stops dead.
 */
export const WOBBLE: Profile = { free: 0.05, keep: 0.6, tail: 0.55 };

/**
 * How long a landed coin rattles before it is still.
 *
 * Here rather than in the stylesheet because the ear needs it too, and a
 * duration written in both places is two numbers that agree until somebody
 * tunes one. The felt reads it as a custom property and the scheduler is
 * handed it; neither owns it.
 */
export const WOBBLE_MS = 420;

/**
 * When each coin lands, as shares of the flight.
 *
 * Two moments and not one. Two coins thrown from the same kip do not land
 * together, and a single impact is the difference between hearing two coins and
 * hearing one heavy thing — which is also why they are drawn with different
 * numbers of turns.
 */
export function landings(spread: number): [number, number] {
  const first = Math.max(0, 1 - spread);
  return [first, 1];
}

/**
 * When the settling coin knocks, as shares of the wobble.
 *
 * Derived from the wobble's own curve rather than tapped out by hand, for the
 * reason the wheel's ticking is: this is not a rhythm anybody chooses, it is
 * the coin flattening, heard. Walked forward over a fine grid because the curve
 * is monotonic, so one pass finds every crossing in order and costs nothing.
 *
 * Read backwards, though: `WOBBLE` is a velocity curve like every other one in
 * this file, fast at the start and spent by the end, because that is the
 * wobble's amplitude dying, same as a wheel's spin. But the knock is not the
 * amplitude, it is the contact rate, and a settling disc's contact rate does
 * the opposite of its amplitude — it climbs as the amplitude shrinks, which is
 * the whole counter-intuitive thing this function exists to get right. Reading
 * the curve back to front (`1 - at(1 - t)` rather than `at(t)`) turns a curve
 * that is dense early and sparse late into one that is sparse early and dense
 * late, off the same numbers, rather than inventing a second curve that has to
 * be kept in step with the first.
 *
 * `closest` guards against a degenerate profile scheduling thousands of them.
 * It is not a thinning — the accelerating knock at the end is exactly the part
 * everybody recognises, and cutting it is cutting the sound.
 */
export function rattle(closest = 0.004): number[] {
  const at = progress(WOBBLE);
  const KNOCKS = 26;
  const out: number[] = [];
  let last = Number.NEGATIVE_INFINITY;
  let step = 0;
  for (let sample = 1; sample <= 2_000; sample += 1) {
    const t = sample / 2_000;
    const passed = Math.floor((1 - at(1 - t)) * KNOCKS);
    while (step < passed) {
      step += 1;
      if (t - last >= closest) {
        out.push(t);
        last = t;
      }
    }
  }
  return out;
}
