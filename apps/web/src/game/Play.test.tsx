// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { RoomActions } from "./useRoom.js";
import type { Account } from "./useAccount.js";
import { Join } from "./Play.js";

function signedIn(name: string): Account {
  return {
    loading: false,
    available: true,
    admin: false,
    profile: {
      id: "p1",
      name,
      avatar: null,
      accentColor: null,
      chips: 0,
      stats: { rounds: 0, roundsWon: 0, chipsWon: 0, chipsStaked: 0 },
      byGame: {},
    },
    refresh: () => {},
    setChips: () => {},
    signOut: () => {},
  };
}

function actions(): RoomActions {
  return {
    create: vi.fn(),
    join: vi.fn(),
    watch: vi.fn(),
    addBot: vi.fn(),
    removeSeat: vi.fn(),
    start: vi.fn(),
    playAgain: vi.fn(),
    roll: vi.fn(),
    toggle: vi.fn(),
    bank: vi.fn(),
    say: vi.fn(),
    setRules: vi.fn(),
    setBuyIn: vi.fn(),
    setListed: vi.fn(),
    taunt: vi.fn(),
  } as unknown as RoomActions;
}

/*
 * The invited "Take a seat" slab disables on `busy`, which here is the whole
 * room's connection state — every other press on the page also sets it, not
 * just this one. Without holding onto which press it was, the button reads
 * as put-out rather than held down whenever busy arrives, and stays lit
 * forever if a later, unrelated busy comes along after this press already
 * got its answer. Mirrors TableSetup's own busy/pressed pattern.
 */
describe("the invited join's Take a seat", () => {
  it("lights up once its own press goes busy, and clears once busy is gone", () => {
    const account = signedIn("Ada");
    const { rerender } = render(
      <Join actions={actions()} busy={false} connected account={account} invited="XKQ37" />,
    );

    const take = screen.getByRole("button", { name: "Take a seat" });
    expect(take.className).not.toContain("is-busy");

    fireEvent.click(take);
    rerender(<Join actions={actions()} busy={true} connected account={account} invited="XKQ37" />);
    expect(screen.getByRole("button", { name: "Take a seat" }).className).toContain("is-busy");
  });

  it("does not light up on a busy that arrived without a press in this mount", () => {
    const account = signedIn("Ada");
    render(<Join actions={actions()} busy={true} connected account={account} invited="XKQ37" />);
    expect(screen.getByRole("button", { name: "Take a seat" }).className).not.toContain("is-busy");
  });

  it("stops lighting a press once it has been answered, even if something else makes the page busy again", () => {
    const account = signedIn("Ada");
    const { rerender } = render(
      <Join actions={actions()} busy={false} connected account={account} invited="XKQ37" />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Take a seat" }));
    rerender(<Join actions={actions()} busy={true} connected account={account} invited="XKQ37" />);
    rerender(<Join actions={actions()} busy={false} connected account={account} invited="XKQ37" />);
    // Busy again, but for something else — watching, say.
    rerender(<Join actions={actions()} busy={true} connected account={account} invited="XKQ37" />);
    expect(screen.getByRole("button", { name: "Take a seat" }).className).not.toContain("is-busy");
  });
});
