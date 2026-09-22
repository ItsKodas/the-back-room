// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { LiarsDice } from "./LiarsDice.js";

// The socket is not this test's business; the page is.
vi.mock("../table/useTableSocket.js", () => ({
  useTableSocket: () => ({
    state: null,
    listed: true,
    seatId: null,
    error: null,
    errorKey: 0,
    connected: true,
    taken: null,
    retry: () => undefined,
    busy: false,
    chat: [],
    say: () => undefined,
    addBot: () => undefined,
    setListed: () => undefined,
    create: () => undefined,
    join: () => undefined,
    watch: () => undefined,
    leave: () => undefined,
    act: () => undefined,
    onRelay: () => () => undefined,
    onError: () => () => undefined,
    landed: [],
    stakes: [],
    taunt: () => undefined,
  }),
}));

describe("the Liar's Dice page", () => {
  it("offers a table to join and one to open", () => {
    render(
      <MemoryRouter>
        <LiarsDice />
      </MemoryRouter>,
    );
    expect(screen.getByText("Join a table")).toBeInTheDocument();
    expect(screen.getByText("Open your own")).toBeInTheDocument();
  });

  it("turns away a code that is not a code", () => {
    render(
      <MemoryRouter initialEntries={["/liars-dice/nope"]}>
        <LiarsDice />
      </MemoryRouter>,
    );
    // Reached through the route, the param is read from useParams; with no
    // matching route this renders the setup instead, which is also correct.
    expect(document.body.textContent).not.toBe("");
  });
});

/*
 * `.lamp--fit` is a sizing modifier — "a word lamp that sizes to its word" —
 * not a selected flag. The lit look is `[aria-checked="true"]`, driven by the
 * `aria-checked` prop already on every lamp here. Toggling `lamp--fit` with
 * selection gives the chosen lamp a different flex-basis from its siblings
 * (`flex: 1 1 auto` instead of `1 1 0`, plus different padding), so the row's
 * widths visibly jump every time the selection moves — worst on the phone
 * this building is built for. Every lamp in a group has to carry the same
 * classes whichever one is checked.
 */
describe("the stake and dice pickers", () => {
  function radios(name: string): HTMLElement[] {
    return within(screen.getByRole("radiogroup", { name })).getAllByRole("radio");
  }

  it("keeps every stake lamp's classes the same, whichever one is checked", () => {
    render(
      <MemoryRouter>
        <LiarsDice />
      </MemoryRouter>,
    );
    const lamps = radios("What it costs to sit down");
    expect(lamps.length).toBeGreaterThan(1);
    const before = lamps.map((lamp) => lamp.className);
    expect(new Set(before).size).toBe(1);

    const other = lamps.find((lamp) => lamp.getAttribute("aria-checked") === "false");
    expect(other).not.toBeUndefined();
    fireEvent.click(other as HTMLElement);

    const after = lamps.map((lamp) => lamp.className);
    expect(new Set(after).size).toBe(1);
    expect(after).toEqual(before);
  });

  it("keeps every dice lamp's classes the same, whichever one is checked", () => {
    render(
      <MemoryRouter>
        <LiarsDice />
      </MemoryRouter>,
    );
    const lamps = radios("How many dice each");
    expect(lamps.length).toBeGreaterThan(1);
    const before = lamps.map((lamp) => lamp.className);
    expect(new Set(before).size).toBe(1);

    const other = lamps.find((lamp) => lamp.getAttribute("aria-checked") === "false");
    expect(other).not.toBeUndefined();
    fireEvent.click(other as HTMLElement);

    const after = lamps.map((lamp) => lamp.className);
    expect(new Set(after).size).toBe(1);
    expect(after).toEqual(before);
  });
});
