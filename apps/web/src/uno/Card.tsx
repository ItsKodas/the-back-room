import type { Card as CardData } from "@backroom/game-uno";
import { label, themeOf } from "@backroom/game-uno";
import type { CSSProperties, ReactNode } from "react";

/*
 * The symbols on the cards, drawn rather than typed so they read the same on
 * every phone. Ported from the tabletop's own set.
 */
const path = (d: string, fill = false) => (
  <svg viewBox="0 0 24 24" className="uno-card__ico" aria-hidden="true" focusable="false">
    <path
      d={d}
      fill={fill ? "currentColor" : "none"}
      stroke={fill ? "none" : "currentColor"}
      strokeWidth="2.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const ICONS: Partial<Record<CardData["type"], ReactNode>> = {
  skip: (
    <svg viewBox="0 0 24 24" className="uno-card__ico" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="3" />
      <line x1="6.6" y1="17.4" x2="17.4" y2="6.6" stroke="currentColor" strokeWidth="3" />
    </svg>
  ),
  reverse: path("M4 9h13l-3.5-3.5M20 15H7l3.5 3.5"),
  shuffle: path("M3 7h3.5c5 0 6 10 11 10H21M3 17h3.5c5 0 6-10 11-10H21M18 4l3 3-3 3M18 14l3 3-3 3"),
  cominThrough: path(
    "M12 12L5 5m0 0h4.5M5 5v4.5M12 12l7 7m0 0h-4.5m4.5 0v-4.5M12 12l7-7m0 0h-4.5M19 5v4.5M12 12l-7 7m0 0h4.5M5 19v-4.5",
  ),
  explosive: path("M10 22a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM14.5 9.5l3-3M19 3.5l.8-.8", true),
  hurry: path("M12 21.5a8.5 8.5 0 1 0 0-17 8.5 8.5 0 0 0 0 17zM12 8.5V13l3 2M9.5 2.5h5"),
  blueYonder: path("M12 2.5l7.5 3v6c0 5-3.3 8.3-7.5 10-4.2-1.7-7.5-5-7.5-10v-6z", true),
  dragon: path(
    "M12 2c1 4 5.5 5.5 5.5 11a5.5 5.5 0 0 1-11 0c0-3 2-4.5 2-7 1.5 1 2.5 2.5 2.5 4 1-2 .5-5.5 1-8z",
    true,
  ),
  escape: path("M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12zM12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4z"),
  punch: path("M12 2l2.2 5.2L20 5l-2.6 5.4L22 13l-5.4 1.2L18 20l-5-3-3.6 4.5-.6-5.7L3 16l3.5-4.5L2.5 7.5l5.8.3z", true),
  littleHelp: path(
    "M8.5 10.5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-8a2 2 0 0 1-2-2zM15.5 8.5V5a1.5 1.5 0 0 0-1.5-1.5H5A1.5 1.5 0 0 0 3.5 5v9A1.5 1.5 0 0 0 5 15.5h3.5",
  ),
  crossFade: path("M3 6h3.5l10 12H20M3 18h3.5l10-12H20M18 3.5L20.5 6 18 8.5M18 15.5l2.5 2.5-2.5 2.5"),
  getDown: path("M12 3v13M6.5 11l5.5 5.5 5.5-5.5M5 21h14"),
  hotNumber: path("M9.5 3L7.5 21M16.5 3l-2 18M4 8.5h17M3 15.5h17"),
  jdMachine: path("M9 18V5l11-2v13M6.5 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM17.5 19a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"),
  experiment: path("M8.5 3h7M10 3v6L4.5 19a1.5 1.5 0 0 0 1.3 2.2h12.4a1.5 1.5 0 0 0 1.3-2.2L14 9V3"),
};

/** What is printed in the middle of a card and in its corners. */
export function faceOf(card: Pick<CardData, "type" | "value">): { mid: ReactNode; corner: ReactNode } {
  switch (card.type) {
    case "number":
      return { mid: card.value, corner: card.value };
    case "draw2":
      return { mid: "+2", corner: "+2" };
    case "wild4":
      return { mid: "+4", corner: "+4" };
    case "wild":
      return { mid: null, corner: "W" };
    default: {
      const icon = ICONS[card.type] ?? "?";
      return { mid: icon, corner: icon };
    }
  }
}

/**
 * One card, face up.
 *
 * Its name is the label a screen reader reads — "Red 7", "Wild Draw Four" —
 * and everything drawn on it is decoration.
 */
export function UnoCard({
  card,
  className = "",
  style,
}: {
  card: CardData;
  className?: string;
  style?: CSSProperties;
}) {
  const face = faceOf(card);
  const theme = themeOf(card);
  // A six and a nine are underlined, as on the real cards, so upside down is not a different card.
  const underline = card.type === "number" && (card.value === 6 || card.value === 9);
  const classes = [
    "uno-card",
    `uno-card--${card.color}`,
    `uno-card--t-${card.type}`,
    underline ? "uno-card--ul" : "",
    theme === null ? "" : `uno-card--theme-${theme}`,
    card.clone === undefined ? "" : "uno-card--cloned",
    className,
  ]
    .filter((one) => one !== "")
    .join(" ");
  return (
    <span className={classes} style={style} role="img" aria-label={label(card)}>
      <span className="uno-card__face" aria-hidden="true">
        <span className="uno-card__oval" />
        <span className="uno-card__corner uno-card__corner--tl">{face.corner}</span>
        <span className="uno-card__mid">{face.mid}</span>
        <span className="uno-card__corner uno-card__corner--br">{face.corner}</span>
      </span>
    </span>
  );
}

/** A card face down: the back of the deck, or a card nobody has turned over yet. */
export function CardBack({ className = "", style }: { className?: string; style?: CSSProperties }) {
  return (
    <span className={`uno-card uno-card--back ${className}`.trim()} style={style} aria-hidden="true">
      <span className="uno-card__face">
        <span className="uno-card__oval" />
        <span className="uno-card__mid">UNO</span>
      </span>
    </span>
  );
}
