// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Account } from "../game/useAccount.js";
import { TableSetup } from "./TableSetup.js";

afterEach(cleanup);
beforeEach(() => {
  // The open-tables list polls; an empty answer keeps it quiet.
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ tables: [] }) })));
});

const signedIn = {
  loading: false,
  available: true,
  admin: false,
  profile: { id: "p1", name: "Koda", chips: 491_000, avatar: null, accentColor: null },
} as unknown as Account;

function setup(over: Partial<Parameters<typeof TableSetup>[0]> = {}) {
  const props = {
    game: "blackjack",
    pitch: "Beat the dealer.",
    invited: "",
    account: signedIn,
    busy: false,
    onJoin: vi.fn(),
    onWatch: vi.fn(),
    onCreate: vi.fn(),
    playsFor: { fun: "Play money that lives at the table." },
    note: () => "You get a five-character code to share.",
    ...over,
  };
  render(<TableSetup {...props} />);
  return props;
}

describe("TableSetup", () => {
  it("will not seat anybody until the code is whole", () => {
    const props = setup();
    const take = screen.getByRole("button", { name: "Take a seat" }) as HTMLButtonElement;
    const code = screen.getByRole("textbox", { name: "Table code" });
    fireEvent.change(code, { target: { value: "xkq3" } });
    expect(take.disabled).toBe(true);
    fireEvent.change(code, { target: { value: "xkq37" } });
    expect(take.disabled).toBe(false);
    fireEvent.click(take);
    expect(props.onJoin).toHaveBeenCalledWith("Koda", "XKQ37");
  });

  it("opens for chips by default for somebody signed in, and for fun when chosen", () => {
    const props = setup();
    const chips = screen.getByRole("radio", { name: /for chips/i });
    expect(chips.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("radio", { name: /for fun/i }));
    fireEvent.click(screen.getByRole("radio", { name: "8" }));
    fireEvent.click(screen.getByRole("button", { name: "Open a table" }));
    expect(props.onCreate).toHaveBeenCalledWith("Koda", { forFun: true, maxSeats: 8 });
  });

  it("lights the press it was given, not every button on the screen", () => {
    const onCreate = vi.fn();
    const { rerender } = render(
      <TableSetup
        game="blackjack"
        pitch=""
        invited=""
        account={signedIn}
        busy={false}
        onJoin={vi.fn()}
        onWatch={vi.fn()}
        onCreate={onCreate}
        note={() => ""}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open a table" }));
    rerender(
      <TableSetup
        game="blackjack"
        pitch=""
        invited=""
        account={signedIn}
        busy
        onJoin={vi.fn()}
        onWatch={vi.fn()}
        onCreate={onCreate}
        note={() => ""}
      />,
    );
    expect(screen.getByRole("button", { name: "Open a table" }).className).toContain("is-busy");
    expect(screen.getByRole("button", { name: "Take a seat" }).className).not.toContain("is-busy");
  });

  it("stops lighting a press once it has been answered, even if something else makes the table busy again", () => {
    const onCreate = vi.fn();
    const props = {
      game: "blackjack",
      pitch: "",
      invited: "",
      account: signedIn,
      onJoin: vi.fn(),
      onWatch: vi.fn(),
      onCreate,
      note: () => "",
    } as const;
    const { rerender } = render(<TableSetup {...props} busy={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Open a table" }));
    rerender(<TableSetup {...props} busy={true} />);
    rerender(<TableSetup {...props} busy={false} />);
    // A later press — watching, say — makes the table busy again, but it is
    // not the create button that was pressed this time.
    rerender(<TableSetup {...props} busy={true} />);
    expect(screen.getByRole("button", { name: "Open a table" }).className).not.toContain("is-busy");
  });
});
