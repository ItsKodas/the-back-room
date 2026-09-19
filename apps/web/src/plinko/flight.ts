import { ROWS } from "@backroom/game-plinko";
import { BUCKET_Y, CHUTE_Y, restY } from "./geometry.js";

/*
 * A ball's whole life as a function of the clock.
 *
 * Pure, so it can be run at any latency in a test, and so the drawing loop
 * never keeps state that could disagree with it: every frame asks where each
 * ball is *now*.
 */

/** From the chute to the top peg. Every path starts there, so this invents nothing. */
export const CHUTE_MS = 250;
export const HOP_MS = 110;
/** The last hop, off the bottom row into the bucket. */
export const LAND_MS = 170;
/** How long a landed ball sits in its bucket before it goes. */
export const SETTLE_MS = 450;
/** Back up the chute, for a ball the table turned down. */
export const LIFT_MS = 240;
export const FALL_MS = (ROWS - 1) * HOP_MS + LAND_MS;

const ROCK = 0.05;
const ROCK_PERIOD_MS = 520;
/** How high a ball kicks off each peg, in rows. */
const KICK = 0.3;

export interface Flight {
  droppedAt: number;
  path: readonly boolean[] | null;
  answeredAt: number | null;
  refusedAt: number | null;
  /** Reduced motion: no fall — the ball is in its bucket once it is known. */
  still?: boolean;
}

export type Phase = "chute" | "waiting" | "falling" | "landed" | "lifting" | "gone";

export interface Where {
  x: number;
  y: number;
  phase: Phase;
}

/** Where a ball on this path meets the given row. `ROWS` is its bucket. */
export function xOnRow(path: readonly boolean[], row: number): number {
  let rights = 0;
  for (let index = 0; index < row; index += 1) {
    if (path[index] === true) {
      rights += 1;
    }
  }
  return rights - row / 2;
}

/**
 * The small rock on the top peg while the answer is out: the ball is visibly
 * waiting rather than frozen, and it is genuinely still happening.
 */
function rock(f: Flight, now: number): number {
  if (f.still === true) {
    return 0;
  }
  const since = Math.max(0, now - (f.droppedAt + CHUTE_MS));
  return ROCK * Math.sin((since / ROCK_PERIOD_MS) * Math.PI * 2);
}

/** The fall starts once the ball is on the top peg *and* the answer is in. */
export function fallsAt(f: Flight): number | null {
  if (f.path === null || f.answeredAt === null) {
    return null;
  }
  return f.still === true ? f.answeredAt : Math.max(f.droppedAt + CHUTE_MS, f.answeredAt);
}

export function landsAt(f: Flight): number | null {
  const start = fallsAt(f);
  if (start === null) {
    return null;
  }
  return f.still === true ? start : start + FALL_MS;
}

/** A kick up off the peg and a drop onto the next: one quadratic curve. */
function arc(x0: number, y0: number, x1: number, y1: number, t: number): { x: number; y: number } {
  const cx = x0 + (x1 - x0) * 0.35;
  const cy = Math.min(y0, y1) - KICK;
  const u = 1 - t;
  return { x: u * u * x0 + 2 * u * t * cx + t * t * x1, y: u * u * y0 + 2 * u * t * cy + t * t * y1 };
}

export function where(f: Flight, now: number): Where {
  if (f.refusedAt !== null) {
    const from = where({ ...f, refusedAt: null }, f.refusedAt);
    const t = (now - f.refusedAt) / LIFT_MS;
    if (t >= 1) {
      return { x: 0, y: CHUTE_Y, phase: "gone" };
    }
    const eased = 1 - (1 - Math.max(0, t)) ** 2;
    return { x: from.x * (1 - eased), y: from.y + (CHUTE_Y - from.y) * eased, phase: "lifting" };
  }

  const since = now - f.droppedAt;
  if (f.still !== true && since < CHUTE_MS) {
    // Gravity: slow off the chute, quick onto the peg.
    const g = Math.max(0, since) / CHUTE_MS;
    return { x: 0, y: CHUTE_Y + (restY(0) - CHUTE_Y) * g * g, phase: "chute" };
  }

  const start = fallsAt(f);
  const end = landsAt(f);
  if (start === null || end === null || now < start) {
    return { x: rock(f, now), y: restY(0), phase: "waiting" };
  }

  const path = f.path as readonly boolean[];
  const bucket = xOnRow(path, ROWS);
  if (now >= end) {
    return { x: bucket, y: BUCKET_Y, phase: now >= end + SETTLE_MS ? "gone" : "landed" };
  }

  const elapsed = now - start;
  const hop = Math.min(ROWS - 1, Math.floor(elapsed / HOP_MS));
  // The first hop leaves from wherever the rock had got to, so the wait and
  // the fall are one motion rather than a snap back to centre.
  const x0 = hop === 0 ? rock(f, start) : xOnRow(path, hop);
  const y0 = restY(hop);
  if (hop < ROWS - 1) {
    const t = (elapsed - hop * HOP_MS) / HOP_MS;
    return { ...arc(x0, y0, xOnRow(path, hop + 1), restY(hop + 1), t), phase: "falling" };
  }
  const t = Math.min(1, (elapsed - hop * HOP_MS) / LAND_MS);
  return { ...arc(x0, y0, bucket, BUCKET_Y, t), phase: "falling" };
}

/**
 * The rows whose peg this ball met in `(from, to]`, for ticks and lights.
 * `ROWS` is the bucket. Nothing after a refusal: a ball going back up the
 * chute is not hitting anything.
 */
export function touches(f: Flight, from: number, to: number): number[] {
  const met: number[] = [];
  const upTo = f.refusedAt === null ? to : Math.min(to, f.refusedAt);
  const inWindow = (at: number) => at > from && at <= upTo;
  if (f.still !== true && inWindow(f.droppedAt + CHUTE_MS)) {
    met.push(0);
  }
  const start = fallsAt(f);
  if (start !== null && f.still !== true) {
    for (let row = 1; row < ROWS; row += 1) {
      if (inWindow(start + row * HOP_MS)) {
        met.push(row);
      }
    }
  }
  const end = landsAt(f);
  if (end !== null && inWindow(end)) {
    met.push(ROWS);
  }
  return met;
}
