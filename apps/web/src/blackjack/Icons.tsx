/**
 * The table's own signals, drawn.
 *
 * Drawn on the same 24-unit grid, in the same weight, as the rest of the
 * building's icons. No size and no colour of their own: both come from the
 * button they are sitting in, so a disabled control dims its icon with the
 * rest of itself rather than leaving a bright glyph on a grey button.
 */

function Glyph({ children }: { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

/** A card leaving the shoe. */
export function DealIcon() {
  return (
    <Glyph>
      <rect x="3" y="4" width="10" height="16" rx="2" />
      <path d="M16 12h5" />
      <path d="m18 9 3 3-3 3" />
    </Glyph>
  );
}

/** The stake coming back off the felt. */
export function UndoIcon() {
  return (
    <Glyph>
      <path d="M4 10h11a4.5 4.5 0 0 1 0 9h-5" />
      <path d="m8 6-4 4 4 4" />
    </Glyph>
  );
}

/** Two sliders: the table's own settings, which are what a host adjusts. */
export function TableIcon() {
  return (
    <Glyph>
      <path d="M4 7h10" />
      <path d="M18 7h2" />
      <path d="M4 17h4" />
      <path d="M12 17h8" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="10" cy="17" r="2" />
    </Glyph>
  );
}

/**
 * Discord's mark, filled rather than stroked.
 *
 * The one icon here that is somebody else's: it names a service, so it has to
 * be recognisable rather than in the house style, and drawing it in outline
 * would make it neither.
 */
export function DiscordIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
      <path d="M19.3 5.6A16.3 16.3 0 0 0 15.2 4.4l-.2.4a12.4 12.4 0 0 1 3.6 1.8 14.9 14.9 0 0 0-12.8 0 12.4 12.4 0 0 1 3.6-1.8l-.2-.4A16.3 16.3 0 0 0 5 5.6C2.4 9.4 1.7 13.2 2 17a16.5 16.5 0 0 0 5 2.5l.9-1.4a10.8 10.8 0 0 1-1.7-.8l.4-.3a11.8 11.8 0 0 0 10.1 0l.4.3a10.8 10.8 0 0 1-1.7.8l.9 1.4a16.5 16.5 0 0 0 5-2.5c.4-4.4-.7-8.2-2-11.4ZM9 14.6c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2Zm6.1 0c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2Z" />
    </svg>
  );
}
