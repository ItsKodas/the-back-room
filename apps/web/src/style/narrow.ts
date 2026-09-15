/*
 * The building's one hard rule at 375px, as something a stylesheet test can
 * ask. jsdom has no layout engine, so nothing can lay a page out and measure
 * it; what can be checked is the sheet itself: a fixed width wider than the
 * narrowest screen, not fenced behind a min-width media query, is a real
 * overflow hazard.
 */

/** The narrowest screen the building promises a page fits without scrolling sideways. */
export const NARROWEST_PX = 375;

/** A `{`'s matching `}`, counting nested braces rather than guessing from the next one. */
function matchingBrace(text: string, openIndex: number): number {
  let depth = 0;
  for (let i = openIndex; i < text.length; i += 1) {
    if (text[i] === "{") {
      depth += 1;
    } else if (text[i] === "}") {
      depth -= 1;
      if (depth === 0) {
        return i;
      }
    }
  }
  throw new Error("unbalanced braces");
}

/**
 * Spans of the sheet that only ever apply above `NARROWEST_PX` — a
 * `min-width` media query wide enough that nothing inside it is a 375px
 * hazard. A declaration outside every such span still has to answer for
 * 375px, whatever other query it might also sit inside.
 */
function safeSpans(text: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  const mediaOpen = /@media\s*([^{]+)\{/g;
  let match: RegExpExecArray | null = mediaOpen.exec(text);
  while (match !== null) {
    const condition = match[1] ?? "";
    const open = match.index + match[0].length - 1;
    const close = matchingBrace(text, open);
    const minWidth = condition.match(/min-width:\s*([\d.]+)px/);
    if (minWidth && Number.parseFloat(minWidth[1]) >= NARROWEST_PX) {
      spans.push([open, close]);
    }
    match = mediaOpen.exec(text);
  }
  return spans;
}

function isInside(index: number, spans: Array<[number, number]>): boolean {
  return spans.some(([start, end]) => index > start && index < end);
}

/**
 * Every `width` or `min-width` declaration in pixels, wherever it sits.
 *
 * Matched only when it follows a brace, semicolon, or whitespace, so
 * `max-width` (which does not cap how wide a box's content is allowed to
 * force it) is never mistaken for `width`.
 */
const WIDTH_DECLARATION = /(?:^|[{;\s])(width|min-width)\s*:\s*([\d.]+)px/g;

export function offendingDeclarations(text: string): Array<{ property: string; px: number; near: string }> {
  const spans = safeSpans(text);
  const offenders: Array<{ property: string; px: number; near: string }> = [];
  let match: RegExpExecArray | null = WIDTH_DECLARATION.exec(text);
  while (match !== null) {
    const property = match[1] as string;
    const px = Number.parseFloat(match[2] as string);
    if (px > NARROWEST_PX && !isInside(match.index, spans)) {
      offenders.push({ property, px, near: text.slice(match.index, match.index + 40).trim() });
    }
    match = WIDTH_DECLARATION.exec(text);
  }
  return offenders;
}
