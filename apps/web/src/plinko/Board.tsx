import { BIG_HIT, BUCKETS, MULTS, ROWS, type Risk, multText } from "@backroom/game-plinko";
import type { PlinkoDrop } from "@backroom/shared";
import { type MutableRefObject, useEffect, useMemo, useRef } from "react";
import { play } from "../game/audio.js";
import { exact } from "../game/money.js";
import { type Flight, touches, where, xOnRow } from "./flight.js";
import { BALL_R, BUCKET_Y, OTHER_R, PEG_R, VIEW, bucketX, pegXs } from "./geometry.js";

export interface Ball extends Flight {
  id: string;
  mine: boolean;
  colour: number;
  name: string | null;
  risk: Risk;
  bucket: number | null;
  mult: number | null;
  stake: number;
  won: number;
  fun: boolean;
  news?: PlinkoDrop;
}

const SVG = "http://www.w3.org/2000/svg";

/** Read once: a board that changed its mind mid-ball would be two motions. */
function reducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

/** WAAPI where there is one; jsdom has none, and a missing flash is not a missing fact. */
function flash(element: Element | undefined, frames: Keyframe[], duration: number): void {
  if (element !== undefined && typeof (element as HTMLElement).animate === "function") {
    (element as HTMLElement).animate(frames, { duration, easing: "cubic-bezier(.2,.9,.3,1.3)" });
  }
}

/**
 * The board: pegs, buckets, and every ball on the floor.
 *
 * Bucket labels are the viewer's own risk. Somebody on High can land in the
 * same bucket and be paid something else; their landing says so in their own
 * colour rather than by relabelling the board under everybody else.
 */
export function Board({
  risk,
  balls,
  onLand,
}: {
  risk: Risk;
  balls: MutableRefObject<Map<string, Ball>>;
  onLand: (ball: Ball) => void;
}) {
  const layer = useRef<SVGGElement | null>(null);
  const tags = useRef<SVGGElement | null>(null);
  const pegs = useRef(new Map<string, SVGCircleElement>());
  const buckets = useRef(new Map<number, SVGGElement>());
  const landRef = useRef(onLand);
  landRef.current = onLand;
  const still = useMemo(reducedMotion, []);

  const rows = useMemo(() => Array.from({ length: ROWS }, (_, row) => pegXs(row)), []);

  useEffect(() => {
    const circles = new Map<string, SVGCircleElement>();
    let last = performance.now();
    let frame = 0;

    const tag = (x: number, text: string, colour: string) => {
      const group = tags.current;
      if (group === null) return;
      const label = document.createElementNS(SVG, "text");
      label.setAttribute("x", String(x));
      label.setAttribute("y", String(BUCKET_Y - 0.9));
      label.setAttribute("class", "pk-tag");
      label.style.setProperty("--pk-tag", colour);
      label.textContent = text;
      group.appendChild(label);
      if (!still && typeof label.animate === "function") {
        label
          .animate(
            [
              { transform: "translateY(0)", opacity: 1 },
              { transform: "translateY(-1.4px)", opacity: 0 },
            ],
            { duration: 1_100, easing: "ease-out" },
          )
          .finished.then(() => label.remove(), () => label.remove());
      } else {
        window.setTimeout(() => label.remove(), 1_200);
      }
    };

    const land = (ball: Ball) => {
      if (ball.path === null || ball.bucket === null) return;
      const colour = ball.mine ? "var(--gr-color-neon-hi)" : `var(--pk-c${ball.colour})`;
      const pocket = buckets.current.get(ball.bucket);
      pocket?.style.setProperty("--pk-hit", colour);
      flash(
        pocket,
        still
          ? [{ opacity: 1 }, { opacity: 1 }]
          : [
              { transform: "translateY(0)" },
              { transform: "translateY(0.22px)" },
              { transform: "translateY(-0.04px)" },
              { transform: "translateY(0)" },
            ],
        320,
      );
      pocket?.classList.add("pk-bucket--hit");
      window.setTimeout(() => pocket?.classList.remove("pk-bucket--hit"), 380);
      play(ball.mine ? "pocket" : "pocketFar", Math.abs(ball.bucket - ROWS / 2));
      if (still) {
        // No fall to watch, so the path it took shows as a trail of lit pegs.
        for (let row = 0; row < ROWS; row += 1) {
          const peg = pegs.current.get(`${row}:${xOnRow(ball.path, row)}`);
          peg?.classList.add("pk-peg--trail");
          window.setTimeout(() => peg?.classList.remove("pk-peg--trail"), 700);
        }
      }
      const x = bucketX(ball.bucket);
      if (ball.mine && ball.won > 0) {
        tag(x, `+${exact(ball.won)}`, colour);
      } else if (!ball.mine && (ball.mult ?? 0) >= BIG_HIT && ball.name !== null) {
        tag(x, `${ball.name} ×${multText(ball.mult as number)}`, colour);
      }
      landRef.current(ball);
    };

    const tick = (now: number) => {
      const group = layer.current;
      for (const ball of balls.current.values()) {
        const at = where({ ...ball, still: still || ball.still }, now);
        let circle = circles.get(ball.id);
        if (at.phase === "gone") {
          circle?.remove();
          circles.delete(ball.id);
          balls.current.delete(ball.id);
          continue;
        }
        if (circle === undefined && group !== null) {
          circle = document.createElementNS(SVG, "circle");
          circle.setAttribute("r", String(ball.mine ? BALL_R : OTHER_R));
          circle.setAttribute("class", ball.mine ? "pk-ball pk-ball--mine" : "pk-ball");
          if (!ball.mine) circle.style.setProperty("--pk-ball", `var(--pk-c${ball.colour})`);
          group.appendChild(circle);
          circles.set(ball.id, circle);
        }
        circle?.setAttribute("cx", at.x.toFixed(3));
        circle?.setAttribute("cy", at.y.toFixed(3));
        for (const row of touches({ ...ball, still: still || ball.still }, last, now)) {
          if (row === ROWS) {
            land(ball);
            continue;
          }
          const x = ball.path === null ? 0 : xOnRow(ball.path, row);
          const peg = pegs.current.get(`${row}:${x}`);
          flash(
            peg,
            [
              { transform: "scale(1.9)", opacity: 1 },
              { transform: "scale(1)", opacity: 0.6 },
            ],
            260,
          );
          play(ball.mine ? "peg" : "pegFar", row);
        }
      }
      last = now;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      for (const circle of circles.values()) circle.remove();
    };
  }, [balls, still]);

  const mults = MULTS[risk];
  return (
    <svg
      className="pk-svg"
      viewBox={`${VIEW.x} ${VIEW.y} ${VIEW.w} ${VIEW.h}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={`Plinko board, ${ROWS} rows, paying ${multText(mults[0] as number)}× at the edges`}
    >
      <path className="pk-chute" d={`M -0.45 ${VIEW.y} V -1.2 M 0.45 ${VIEW.y} V -1.2`} />
      {rows.map((xs, row) =>
        xs.map((x) => (
          <circle
            // biome-ignore lint/suspicious/noArrayIndexKey: pegs are positions on the board, and never reorder
            key={`${row}:${x}`}
            ref={(element) => {
              if (element === null) pegs.current.delete(`${row}:${x}`);
              else pegs.current.set(`${row}:${x}`, element);
            }}
            className="pk-peg"
            cx={x}
            cy={row}
            r={PEG_R}
          />
        )),
      )}
      {Array.from({ length: BUCKETS }, (_, bucket) => {
        const mult = mults[bucket] as number;
        return (
          <g
            // biome-ignore lint/suspicious/noArrayIndexKey: buckets are positions, and never reorder
            key={bucket}
            ref={(element) => {
              if (element === null) buckets.current.delete(bucket);
              else buckets.current.set(bucket, element);
            }}
            className="pk-bucket"
            data-tier={Math.abs(bucket - ROWS / 2)}
          >
            <rect x={bucketX(bucket) - 0.46} y={BUCKET_Y - 0.1} width={0.92} height={0.9} rx={0.14} />
            <text x={bucketX(bucket)} y={BUCKET_Y + 0.5}>
              {multText(mult)}
            </text>
          </g>
        );
      })}
      <g ref={layer} />
      <g ref={tags} aria-live="polite" />
    </svg>
  );
}
