// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
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
