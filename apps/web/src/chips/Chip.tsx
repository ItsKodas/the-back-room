import { useId } from "react";

/**
 * A poker chip.
 *
 * Drawn rather than styled: a chip is a shape with things set into it, and CSS
 * borders can only ever suggest that. One inline SVG has no image to fetch, no
 * resolution to be wrong at, and re-tints from the same values everything else
 * uses.
 *
 * The pale centre is the point of this design. A denomination printed straight
 * onto a coloured body has to fight that colour for contrast at every value;
 * an inlay gives the number a ground of its own, which is the only reason it
 * still reads at the sizes these are actually drawn at.
 *
 * The face is separated from the chip so a pile can be built out of the same
 * drawing. A stack of coloured bands is not a stack of chips, and the way to
 * be sure a pile looks like the tray is to make it literally out of the tray.
 */

/** How one denomination is painted. */
export interface Face {
  /** The clay. */
  body: string;
  /** The spots in the rim and the inlay, which are the same colour on a chip. */
  trim: string;
  /** How many spots. A real house varies these so a stack can be counted. */
  spots: number;
}

/*
 * Casino convention where it has one, and a house's own choice where it does
 * not — two-fifty is not a chip anybody mints, so it takes the rose a real
 * table would give it, and the fifty is green because this house says so.
 */
export const FACES: Record<number, Face> = {
  /*
   * The two small plates a poker table needs, which no other game here does:
   * blinds are ten and twenty, and without a face for them every bet on the
   * felt would come out as one anonymous odd chip. White and blue because
   * nothing else in the house is either — the rest of this list is greens,
   * roses, violets and golds, and a low chip has to be told apart at a glance
   * from the stack it is sitting next to.
   */
  10: { body: "#cfd6e0", trim: "#39404d", spots: 8 },
  20: { body: "#2a5f8f", trim: "#d5e6f5", spots: 8 },
  50: { body: "#2f6b45", trim: "#d7f0e0", spots: 8 },
  100: { body: "#2b3038", trim: "#eceff3", spots: 8 },
  250: { body: "#8e3358", trim: "#f6d7e4", spots: 6 },
  500: { body: "#4b3277", trim: "#e2d6f7", spots: 4 },
  1000: { body: "#a8791c", trim: "#fbecc6", spots: 3 },
  5000: { body: "#a33c1e", trim: "#f7d8c9", spots: 6 },
  25000: { body: "#16605e", trim: "#cfeeea", spots: 4 },
};

/** Anything the house has not minted a colour for still gets a chip. */
export const PLAIN: Face = { body: "#3b4250", trim: "#e6ebf2", spots: 6 };

/**
 * What can be pushed onto the felt, largest first.
 *
 * The twenty-five is missing on purpose, and it is the only one that is: a
 * table's maximum is ten thousand, so a single press of that plate would stake
 * more than the house allows and the chip would spend its life disabled. Five
 * thousand is exactly half the maximum, so two of them make it.
 *
 * The cage still counts a balance on the full LADDER below, the way a real one
 * holds plates nobody bets directly.
 */
export const MINTED = [5000, 1000, 500, 250, 100];

/** Every denomination, for showing what somebody has rather than what they bet. */
export const LADDER = [25000, 5000, 1000, 500, 250, 100];

/** A point on a circle, with zero at the top rather than at three o'clock. */
function around(cx: number, cy: number, radius: number, degrees: number): [number, number] {
  const radians = ((degrees - 90) * Math.PI) / 180;
  return [cx + radius * Math.cos(radians), cy + radius * Math.sin(radians)];
}

/**
 * One chip's face, without an SVG around it, so it can be drawn anywhere.
 *
 * Everything is in proportion to the radius rather than to a fixed viewBox,
 * which is what lets the same drawing be a forty-six pixel button and one chip
 * in a pile of nine.
 */
export function ChipFace({
  cx,
  cy,
  r,
  amount,
  showValue = false,
  lift,
  face: painted,
}: {
  cx: number;
  cy: number;
  r: number;
  amount: number;
  showValue?: boolean;
  /** The id of a gradient to lay over the top, if the caller has made one. */
  lift?: string;
  /** Paint it in something other than its denomination's clay. */
  face?: Face;
}) {
  const face = painted ?? FACES[amount] ?? PLAIN;
  const scale = r / 48;
  const label = amount.toLocaleString("en-US");
  // The number sizes to its own length: "1,000" cannot wear "100"'s size.
  const type = (label.length > 3 ? 17 : 24) * scale;

  const spots: string[] = [];
  for (let index = 0; index < face.spots; index += 1) {
    const centre = (360 / face.spots) * index;
    const [ax, ay] = around(cx, cy, 43 * scale, centre - 9);
    const [bx, by] = around(cx, cy, 43 * scale, centre + 9);
    spots.push(`M ${ax} ${ay} A ${43 * scale} ${43 * scale} 0 0 1 ${bx} ${by}`);
  }

  return (
    <>
      <circle cx={cx} cy={cy} r={r} fill={face.body} />
      {spots.map((path) => (
        <path key={path} d={path} stroke={face.trim} strokeWidth={11 * scale} fill="none" />
      ))}
      <circle cx={cx} cy={cy} r={33 * scale} fill={face.trim} />
      <circle
        cx={cx}
        cy={cy}
        r={33 * scale}
        fill="none"
        stroke="rgb(0 0 0 / 0.35)"
        strokeWidth={1.5 * scale}
      />
      <circle
        cx={cx}
        cy={cy}
        r={28 * scale}
        fill="none"
        stroke={face.body}
        strokeWidth={scale}
        opacity="0.4"
      />
      {lift === undefined ? null : <circle cx={cx} cy={cy} r={r} fill={`url(#${lift})`} />}
      {/* Below about twenty pixels the number is a smudge, and a smudge in the
          middle of a chip reads as dirt rather than as a value. */}
      {showValue && r > 14 ? (
        <text
          x={cx}
          y={cy}
          textAnchor="middle"
          dominantBaseline="central"
          fontFamily="IBM Plex Mono, ui-monospace, monospace"
          fontWeight="600"
          fontSize={type}
          fill={face.body}
        >
          {label}
        </text>
      ) : null}
    </>
  );
}

/** Where the rim is cut, a notch every eighth of the way round. */
const NOTCHES = [0, 45, 90, 135, 180, 225, 270, 315];

/**
 * The building's sign for chips, small, beside a figure.
 *
 * The house chip reduced to the two things that make it a chip: a notched rim
 * and an inlay. The full chip drawn at fourteen pixels was gold on dark gold,
 * which is a disc with a smudge in it.
 *
 * Cut out rather than painted, so the whole mark is one colour and that colour
 * is the text's. Gold beside a balance, faint on a key nobody can press — and
 * never a patch of some other background showing through the holes.
 *
 * No value printed on it, and aria-hidden: the figure it sits beside is the
 * number, and a second reading of it as "chip" is noise to anybody listening.
 */
export function ChipMark({ size = 14 }: { size?: number }) {
  // One mask per mark: two sharing an id would have the second cut by the first.
  const cut = useId();
  return (
    <svg
      className="chip-mark"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <mask id={cut} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
          <circle cx="12" cy="12" r="11.5" fill="#fff" />
          {NOTCHES.map((turn) => (
            <rect
              key={turn}
              x="10.9"
              y="-0.6"
              width="2.2"
              height="3.1"
              fill="#000"
              transform={`rotate(${turn} 12 12)`}
            />
          ))}
          <circle cx="12" cy="12" r="6.4" fill="none" stroke="#000" strokeWidth="1.7" />
          {/* A second ring only once there is room for it; below this it
              closes up and the mark goes muddy. */}
          {size >= 28 ? (
            <circle cx="12" cy="12" r="9.1" fill="none" stroke="#000" strokeWidth="0.55" />
          ) : null}
        </mask>
      </defs>
      <rect width="24" height="24" fill="currentColor" mask={`url(#${cut})`} />
    </svg>
  );
}

/** The lit-from-above wash that makes a flat circle read as an object. */
export function Lift({ id }: { id: string }) {
  return (
    <radialGradient id={id} cx="50%" cy="28%" r="75%">
      <stop offset="0%" stopColor="#fff" stopOpacity="0.18" />
      <stop offset="55%" stopColor="#fff" stopOpacity="0.03" />
      <stop offset="100%" stopColor="#000" stopOpacity="0.28" />
    </radialGradient>
  );
}

export function Chip({ amount, size = 46 }: { amount: number; size?: number }) {
  /*
   * A gradient needs an id, and an id has to be unique in the document — there
   * are four of these on screen at once and more once a hand is in play.
   */
  const lift = useId();

  return (
    <svg
      className="chip"
      viewBox="0 0 100 100"
      width={size}
      height={size}
      role="img"
      aria-label={`${amount.toLocaleString("en-US")} chips`}
    >
      <defs>
        <Lift id={lift} />
      </defs>
      <ChipFace cx={50} cy={50} r={48} amount={amount} showValue lift={lift} />
    </svg>
  );
}
