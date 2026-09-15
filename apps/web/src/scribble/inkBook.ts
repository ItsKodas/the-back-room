import type { FillMark, Ink, InkRelay, Mark, StrokeMark } from "@backroom/game-scribble";
import { GRID_HEIGHT, GRID_WIDTH, MAX_BATCH } from "@backroom/game-scribble";

export interface StrokeAction {
  type: "stroke";
  id: string;
  seq: number;
  ink: Ink;
  size: number;
  pts: number[];
}

export interface FillAction {
  type: "fill";
  id: string;
  ink: Ink;
  x: number;
  y: number;
}

export function toGrid(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
): [number, number] {
  const x = Math.round(((clientX - rect.left) / rect.width) * GRID_WIDTH);
  const y = Math.round(((clientY - rect.top) / rect.height) * GRID_HEIGHT);
  return [Math.min(GRID_WIDTH, Math.max(0, x)), Math.min(GRID_HEIGHT, Math.max(0, y))];
}

interface Pending {
  mark: Mark;
  /** The next batch number to send. */
  seq: number;
  /** Points drawn here that have not gone to the server yet. */
  unsent: number[];
  open: boolean;
}

const copy = (mark: Mark): Mark => (mark.kind === "stroke" ? { ...mark, pts: [...mark.pts] } : { ...mark });

/**
 * The picture as this client shows it.
 *
 * Three sources, and the rule for each is the building's: your own ink is a
 * fact you chose, so it is on the napkin under your finger at once; your
 * partner's arrives as relays and is drawn as it lands; and every state from
 * the server is the truth, replacing whatever was guessed in between.
 */
export class InkBook {
  version = 0;
  private server: Mark[] = [];
  private pending: Pending[] = [];
  /* The last batch drawn of each relayed line, so a repeat is not drawn twice. */
  private readonly seen = new Map<string, number>();
  private readonly me: string;
  private readonly makeId: () => string;

  constructor(me: string, makeId: () => string = () => Math.random().toString(36).slice(2, 12)) {
    this.me = me;
    this.makeId = makeId;
  }

  marks(): Mark[] {
    const mine = new Map(this.pending.map((one) => [one.mark.id, one.mark]));
    const shown = this.server.map((mark) => {
      const local = mine.get(mark.id);
      // Your copy of a line you are still drawing is longer than the server's.
      return local !== undefined && local.kind === "stroke" && mark.kind === "stroke" && local.pts.length > mark.pts.length
        ? local
        : mark;
    });
    const known = new Set(this.server.map((mark) => mark.id));
    for (const one of this.pending) {
      if (!known.has(one.mark.id)) {
        shown.push(one.mark);
      }
    }
    return shown;
  }

  sync(ink: readonly Mark[], drawing: boolean): void {
    this.server = ink.map(copy);
    this.seen.clear();
    if (!drawing) {
      this.pending = [];
    } else {
      const byId = new Map(this.server.map((mark) => [mark.id, mark]));
      this.pending = this.pending.filter((one) => {
        const theirs = byId.get(one.mark.id);
        if (theirs === undefined) {
          return true;
        }
        return one.open || (one.mark.kind === "stroke" && theirs.kind === "stroke" && one.mark.pts.length > theirs.pts.length);
      });
    }
    this.version += 1;
  }

  applyRelay(from: string, relay: InkRelay): void {
    if (from === this.me) {
      return;
    }
    switch (relay.kind) {
      case "stroke": {
        const last = this.seen.get(relay.id);
        if (last !== undefined && relay.seq <= last) {
          return;
        }
        this.seen.set(relay.id, relay.seq);
        const line = this.server.find((mark): mark is StrokeMark => mark.kind === "stroke" && mark.id === relay.id);
        if (line === undefined) {
          this.server.push({ kind: "stroke", id: relay.id, by: relay.by, ink: relay.ink, size: relay.size, pts: [...relay.pts] });
        } else {
          line.pts.push(...relay.pts);
        }
        break;
      }
      case "fill":
        if (!this.server.some((mark) => mark.id === relay.mark.id)) {
          this.server.push({ ...relay.mark });
        }
        break;
      case "undo":
        this.server = this.server.filter((mark) => mark.id !== relay.id);
        break;
      case "clear":
        // Everything you had drawn is gone from the server too, including a line still under your finger.
        this.server = [];
        this.pending = [];
        break;
    }
    this.version += 1;
  }

  begin(ink: Ink, size: number, x: number, y: number): void {
    const mark: StrokeMark = { kind: "stroke", id: this.makeId(), by: this.me, ink, size, pts: [x, y] };
    this.pending.push({ mark, seq: 0, unsent: [x, y], open: true });
    this.version += 1;
  }

  extend(x: number, y: number): void {
    const one = this.pending.find((each) => each.open);
    if (one === undefined || one.mark.kind !== "stroke") {
      return;
    }
    const pts = one.mark.pts;
    if (pts[pts.length - 2] === x && pts[pts.length - 1] === y) {
      return;
    }
    pts.push(x, y);
    one.unsent.push(x, y);
    this.version += 1;
  }

  end(): void {
    for (const one of this.pending) {
      one.open = false;
    }
  }

  fill(ink: Ink, x: number, y: number): FillAction {
    const mark: FillMark = { kind: "fill", id: this.makeId(), by: this.me, ink, x, y };
    this.pending.push({ mark, seq: 1, unsent: [], open: false });
    this.version += 1;
    return { type: "fill", id: mark.id, ink, x, y };
  }

  /**
   * Takes back your latest mark. Returns whether the server needs telling.
   *
   * A line nobody has been sent a single point of is not on the server, and an
   * undo sent for it would take away the line before it instead.
   */
  undo(): boolean {
    const shown = this.marks();
    for (let at = shown.length - 1; at >= 0; at -= 1) {
      const mark = shown[at] as Mark;
      if (mark.by !== this.me) {
        continue;
      }
      const local = this.pending.find((one) => one.mark.id === mark.id);
      this.pending = this.pending.filter((one) => one.mark.id !== mark.id);
      this.server = this.server.filter((one) => one.id !== mark.id);
      this.version += 1;
      return local === undefined || local.seq > 0;
    }
    return false;
  }

  clear(): void {
    this.server = [];
    this.pending = [];
    this.version += 1;
  }

  takeBatches(): StrokeAction[] {
    const batches: StrokeAction[] = [];
    for (const one of this.pending) {
      const mark = one.mark;
      if (mark.kind !== "stroke") {
        continue;
      }
      while (one.unsent.length > 0) {
        batches.push({
          type: "stroke",
          id: mark.id,
          seq: one.seq,
          ink: mark.ink,
          size: mark.size,
          pts: one.unsent.splice(0, MAX_BATCH * 2),
        });
        one.seq += 1;
      }
    }
    return batches;
  }

  refused(): void {
    this.pending = [];
    this.version += 1;
  }
}
