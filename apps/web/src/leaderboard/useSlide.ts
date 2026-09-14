import { useLayoutEffect, useRef } from "react";
import type { RefObject } from "react";

/**
 * Rows slide from where they were to where they now are.
 *
 * Overtaking somebody is the one thing this page is for, so it has to be
 * something you watch happen rather than something you notice happened. The
 * old positions are measured before the browser paints the new ones, each row
 * is put back where it was with a transform, and then released — so the
 * distance is real rather than a guess, and a row that did not move does
 * nothing at all.
 *
 * One motion per row: a row that both moves and re-numbers does both inside
 * this one transition, because two animations over one element is the bug.
 */
export function useSlide(rows: Array<{ id: string }>): RefObject<HTMLDivElement> {
  const box = useRef<HTMLDivElement>(null);
  const was = useRef(new Map<string, number>());

  // biome-ignore lint/correctness/useExhaustiveDependencies: fires on the rows changing, which is the point — the body reads the DOM, not the prop
  useLayoutEffect(() => {
    const element = box.current;
    if (element === null) {
      return;
    }
    const quiet = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const now = new Map<string, number>();
    const children = [...element.querySelectorAll<HTMLElement>("[data-id]")];

    // offsetTop, not getBoundingClientRect().top: the rect is relative to the
    // viewport, so a scroll or a resize between one poll and the next shifts
    // every row by the same amount and reads as a reorder that never
    // happened. offsetTop is relative to the shared offsetParent instead, so
    // it is scroll- and resize-invariant while still forcing the layout the
    // FLIP needs.
    //
    // Read every row's position before writing any of them: a read
    // interleaved with each row's own write-then-read would force one
    // synchronous reflow per row on a full reshuffle instead of one for the
    // whole board.
    for (const child of children) {
      const id = child.dataset["id"] as string;
      now.set(id, child.offsetTop);
    }

    if (!quiet) {
      for (const child of children) {
        const id = child.dataset["id"] as string;
        const top = now.get(id) as number;
        const before = was.current.get(id);
        if (before === undefined || before === top) {
          continue;
        }
        // Back to where it was, with no transition, then forward to where it is.
        child.style.transition = "none";
        child.style.transform = `translateY(${before - top}px)`;
      }
      // Read, once for the batch, so the browser takes every jump before any
      // transition is put back.
      void element.offsetHeight;
      for (const child of children) {
        child.style.transition = "";
        child.style.transform = "";
      }
    }
    was.current = now;
  }, [rows]);

  return box;
}
