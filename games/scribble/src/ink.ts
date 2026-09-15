import { TableError } from "@backroom/core";

/*
 * Nine to draw with and the napkin itself, which is what the eraser draws in:
 * rubbing out is a line like any other, so it undoes like one.
 */
export const INKS = ["black", "red", "orange", "yellow", "green", "blue", "purple", "brown", "white", "paper"] as const;
export type Ink = (typeof INKS)[number];

/** Diameters in grid units. A mark stores the index, never a free-form width. */
export const SIZES = [4, 10, 22] as const;

/*
 * A fixed grid rather than pixels, so a point means the same place on a phone
 * and on a desk. Integers, because a float is eight bytes of JSON pretending to
 * be precision nobody can see.
 */
export const GRID_WIDTH = 1000;
export const GRID_HEIGHT = 750;
export const MAX_BATCH = 64;
/** A ceiling on one turn's picture, so a table's memory has one too. */
export const MAX_POINTS = 20_000;

export interface StrokeMark {
  kind: "stroke";
  id: string;
  by: string;
  ink: Ink;
  size: number;
  pts: number[];
}

export interface FillMark {
  kind: "fill";
  id: string;
  by: string;
  ink: Ink;
  x: number;
  y: number;
}

export type Mark = StrokeMark | FillMark;

export interface StrokeBatch {
  id: string;
  seq: number;
  ink: Ink;
  size: number;
  pts: number[];
}

export interface FillRequest {
  id: string;
  ink: Ink;
  x: number;
  y: number;
}

export type InkRelay =
  | { kind: "stroke"; id: string; by: string; ink: Ink; size: number; seq: number; pts: number[] }
  | { kind: "fill"; mark: FillMark }
  | { kind: "undo"; by: string; id: string }
  | { kind: "clear"; ids: string[] };

const NOT_A_LINE = "That is not a line.";
const NOT_YOUR_LINE = "That line is not yours.";
const NAPKIN_FULL = "The napkin's full.";
export const MUST_DRAW = "Only the people drawing can draw.";

/*
 * The exact player-facing strings ink ever refuses with. A client matches on
 * these to know a refusal was about the drawing rather than anything else at
 * the table, so the messages living in one list is what keeps that matching
 * from drifting quietly out of step with what is actually thrown.
 */
export const INK_REFUSALS: readonly string[] = [NOT_A_LINE, NOT_YOUR_LINE, NAPKIN_FULL, MUST_DRAW];

function readId(value: unknown): string {
  if (typeof value !== "string" || value.length < 1 || value.length > 24) {
    throw new TableError(NOT_A_LINE);
  }
  return value;
}

function readInk(value: unknown): Ink {
  if (!INKS.includes(value as Ink)) {
    throw new TableError(NOT_A_LINE);
  }
  return value as Ink;
}

function onGrid(x: unknown, y: unknown): boolean {
  return (
    Number.isInteger(x) &&
    Number.isInteger(y) &&
    (x as number) >= 0 &&
    (x as number) <= GRID_WIDTH &&
    (y as number) >= 0 &&
    (y as number) <= GRID_HEIGHT
  );
}

export function readBatch(raw: Record<string, unknown>): StrokeBatch {
  const id = readId(raw["id"]);
  const ink = readInk(raw["ink"]);
  const seq = raw["seq"];
  const size = raw["size"];
  const pts = raw["pts"];
  if (!Number.isInteger(seq) || (seq as number) < 0) {
    throw new TableError(NOT_A_LINE);
  }
  if (!Number.isInteger(size) || (size as number) < 0 || (size as number) >= SIZES.length) {
    throw new TableError(NOT_A_LINE);
  }
  if (!Array.isArray(pts) || pts.length === 0 || pts.length % 2 !== 0 || pts.length > MAX_BATCH * 2) {
    throw new TableError(NOT_A_LINE);
  }
  for (let at = 0; at < pts.length; at += 2) {
    if (!onGrid(pts[at], pts[at + 1])) {
      throw new TableError(NOT_A_LINE);
    }
  }
  return { id, seq: seq as number, ink, size: size as number, pts: pts as number[] };
}

export function readFill(raw: Record<string, unknown>): FillRequest {
  const id = readId(raw["id"]);
  const ink = readInk(raw["ink"]);
  if (!onGrid(raw["x"], raw["y"])) {
    throw new TableError(NOT_A_LINE);
  }
  return { id, ink, x: raw["x"] as number, y: raw["y"] as number };
}

/**
 * One turn's picture, as the server holds it.
 *
 * The whole log goes out in every view, so a player who reconnects draws the
 * picture from here; what goes out between views is only the relay each change
 * returns.
 */
export class InkLog {
  private readonly list: Mark[] = [];
  private readonly seqs = new Map<string, number>();
  /*
   * Ids that were undone or cleared. A drawer's last batches can still be in
   * flight when they press undo, and one arriving afterwards must not quietly
   * bring the line back.
   */
  private readonly gone = new Set<string>();
  private count = 0;

  get marks(): readonly Mark[] {
    return this.list;
  }

  get points(): number {
    return this.count;
  }

  stroke(by: string, batch: StrokeBatch): InkRelay | null {
    if (this.gone.has(batch.id)) {
      return null;
    }
    // A fill already holds this id: ids are shared across kinds, so a stroke reusing one is ignored, not layered on top.
    if (this.list.some((mark) => mark.kind !== "stroke" && mark.id === batch.id)) {
      return null;
    }
    const existing = this.list.find((mark): mark is StrokeMark => mark.kind === "stroke" && mark.id === batch.id);
    if (existing !== undefined && existing.by !== by) {
      throw new TableError(NOT_YOUR_LINE);
    }
    const last = this.seqs.get(batch.id);
    if (last !== undefined && batch.seq <= last) {
      return null;
    }
    const added = batch.pts.length / 2;
    if (this.count + added > MAX_POINTS) {
      throw new TableError(NAPKIN_FULL);
    }
    const mark: StrokeMark = existing ?? { kind: "stroke", id: batch.id, by, ink: batch.ink, size: batch.size, pts: [] };
    if (existing === undefined) {
      this.list.push(mark);
    }
    mark.pts.push(...batch.pts);
    this.seqs.set(batch.id, batch.seq);
    this.count += added;
    // The stroke's own ink and size, not the batch's: a line does not change pen halfway.
    return { kind: "stroke", id: mark.id, by, ink: mark.ink, size: mark.size, seq: batch.seq, pts: batch.pts };
  }

  fill(by: string, request: FillRequest): InkRelay | null {
    if (this.gone.has(request.id) || this.list.some((mark) => mark.id === request.id)) {
      return null;
    }
    if (this.count + 1 > MAX_POINTS) {
      throw new TableError(NAPKIN_FULL);
    }
    const mark: FillMark = { kind: "fill", id: request.id, by, ink: request.ink, x: request.x, y: request.y };
    this.list.push(mark);
    this.count += 1;
    return { kind: "fill", mark };
  }

  undo(by: string): InkRelay | null {
    for (let at = this.list.length - 1; at >= 0; at -= 1) {
      const mark = this.list[at] as Mark;
      if (mark.by !== by) {
        continue;
      }
      this.list.splice(at, 1);
      this.count -= mark.kind === "stroke" ? mark.pts.length / 2 : 1;
      this.gone.add(mark.id);
      return { kind: "undo", by, id: mark.id };
    }
    return null;
  }

  clear(): InkRelay {
    const ids = this.list.map((mark) => mark.id);
    for (const id of ids) {
      this.gone.add(id);
    }
    this.list.length = 0;
    this.count = 0;
    return { kind: "clear", ids };
  }
}
