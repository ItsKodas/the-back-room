// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { chipsSentence } from "./dialogs.js";
import { Players } from "./Players.js";

const ROWS = [
  { id: "u1", name: "Ada", avatar: null, accentColor: null, chips: 12_000, rounds: 4, createdAt: 1 },
  { id: "u2", name: "Bo", avatar: null, accentColor: null, chips: 900, rounds: 1, createdAt: 2 },
];

const posted: Array<{ url: string; body: unknown }> = [];

function stubFetch(resetAnswer: { status: number; body: unknown } = { status: 200, body: { affected: 1 } }) {
  posted.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body));
        posted.push({ url, body });
        if (url === "/api/admin/reset") {
          return { ok: resetAnswer.status === 200, status: resetAnswer.status, json: async () => resetAnswer.body };
        }
        return { ok: true, status: 200, json: async () => ({ affected: 1, moved: 1 }) };
      }
      return { ok: true, status: 200, json: async () => ({ rows: ROWS, total: 2 }) };
    }),
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("what a chips dialog says it will do", () => {
  it("says it in words", () => {
    expect(chipsSentence("add", 5000, 3)).toBe("Give 5,000 chips to 3 players.");
    expect(chipsSentence("remove", 5000, 1)).toBe("Take up to 5,000 chips from 1 player.");
    expect(chipsSentence("set", 0, "everyone")).toBe("Set everyone's balance to 0 chips.");
  });
});

describe("the players tab", () => {
  it("shows rounds singular for one and plural otherwise", async () => {
    stubFetch();
    render(<Players />);
    await waitFor(() => expect(screen.getByText("Ada")).toBeTruthy());
    expect(screen.getByText(/4 rounds · joined/)).toBeTruthy();
    expect(screen.getByText(/1 round · joined/)).toBeTruthy();
  });

  it("raises the action bar with how many are selected", async () => {
    stubFetch();
    render(<Players />);
    await waitFor(() => expect(screen.getByText("Ada")).toBeTruthy());
    expect(screen.queryByRole("region", { name: "Selected players" })).toBeNull();

    fireEvent.click(screen.getByRole("checkbox", { name: "Select Ada" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Bo" }));
    const bar = screen.getByRole("region", { name: "Selected players" });
    expect(bar.textContent).toContain("2 selected");
  });

  it("gives chips to the selected players", async () => {
    stubFetch();
    render(<Players />);
    await waitFor(() => expect(screen.getByText("Ada")).toBeTruthy());
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Ada" }));
    fireEvent.click(within(screen.getByRole("region", { name: "Selected players" })).getByRole("button", { name: "Add" }));

    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Chips"), { target: { value: "250" } });
    fireEvent.change(within(dialog).getByLabelText("Note"), { target: { value: "bug" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Give" }));

    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toEqual({
      url: "/api/admin/chips",
      body: { op: "add", amount: 250, target: { ids: ["u1"] }, note: "bug" },
    });
  });

  it("will not reset everyone until RESET is typed", async () => {
    stubFetch();
    render(<Players />);
    await waitFor(() => expect(screen.getByText("Ada")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Reset everyone…" }));

    const dialog = screen.getByRole("dialog");
    const go = within(dialog).getByRole("button", { name: "Reset" }) as HTMLButtonElement;
    expect(go.disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText("Type RESET to confirm"), { target: { value: "reset" } });
    expect(go.disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText("Type RESET to confirm"), { target: { value: "RESET" } });
    expect(go.disabled).toBe(false);

    fireEvent.click(within(dialog).getByLabelText("Also empty the banks"));
    fireEvent.click(go);
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]?.body).toEqual({ target: { all: true }, parts: ["balance"], emptyBanks: true, note: "" });
  });

  it("offers to empty the banks only when resetting everyone", async () => {
    stubFetch();
    render(<Players />);
    await waitFor(() => expect(screen.getByText("Ada")).toBeTruthy());
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Ada" }));
    fireEvent.click(within(screen.getByRole("region", { name: "Selected players" })).getByRole("button", { name: "Reset…" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).queryByLabelText("Also empty the banks")).toBeNull();
    expect(within(dialog).queryByLabelText("Type RESET to confirm")).toBeNull();
  });

  /*
   * Wiping a player's history deletes their redemptions, which is what lets
   * a used code be redeemed again — and for everyone, every capped code's
   * uses go back. That is chips, so the dialog says it before it is pressed.
   */
  it("says resetting history lets used codes be redeemed again", async () => {
    stubFetch();
    render(<Players />);
    await waitFor(() => expect(screen.getByText("Ada")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Reset everyone…" }));
    const history = within(screen.getByRole("dialog")).getByText(/^History/).closest("label");
    expect(history?.textContent).toMatch(/codes they redeemed can be redeemed again/i);
  });

  it("shows the server's refusal when players are still seated", async () => {
    stubFetch({ status: 409, body: { error: "2 tables still have them seated.", seatedAt: 2 } });
    render(<Players />);
    await waitFor(() => expect(screen.getByText("Ada")).toBeTruthy());
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Ada" }));
    fireEvent.click(within(screen.getByRole("region", { name: "Selected players" })).getByRole("button", { name: "Reset…" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Reset" }));
    await waitFor(() => expect(screen.getByRole("dialog").textContent).toContain("2 tables still have them seated."));
  });
});

describe("an admin dialog, where it lives and where focus goes", () => {
  it("is rendered on the body, outside the transformed tab panel", async () => {
    stubFetch();
    render(
      <div className="desk__panel" data-testid="panel">
        <Players />
      </div>,
    );
    await waitFor(() => expect(screen.getByText("Ada")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Give everyone…" }));

    const dialog = screen.getByRole("dialog");
    expect(screen.getByTestId("panel").contains(dialog)).toBe(false);
    expect(dialog.closest(".desk__scrim")?.parentElement).toBe(document.body);
  });

  it("keeps focus where the admin put it when the list lands under an open dialog", async () => {
    // The list is held back so it lands while the dialog is already open —
    // the slow connection the dialog has to survive.
    let release: (() => void) | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise((resolve) => {
            release = () => resolve({ ok: true, status: 200, json: async () => ({ rows: ROWS, total: 2 }) });
          }),
      ),
    );
    render(<Players />);
    fireEvent.click(screen.getByRole("button", { name: "Give everyone…" }));
    const note = within(screen.getByRole("dialog")).getByLabelText("Note");
    note.focus();
    expect(document.activeElement).toBe(note);

    release?.();
    await waitFor(() => expect(screen.getByText("Ada")).toBeTruthy());
    expect(document.activeElement).toBe(note);
  });

  it.each([
    ["Cancel", (dialog: HTMLElement) => fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }))],
    ["Escape", () => fireEvent.keyDown(window, { key: "Escape" })],
    ["the backdrop", () => fireEvent.click(screen.getByRole("button", { name: "Close" }))],
    ["done", (dialog: HTMLElement) => fireEvent.click(within(dialog).getByRole("button", { name: "Give" }))],
  ])("gives focus back to the button that opened it, after %s", async (_how, shut) => {
    stubFetch();
    render(<Players />);
    await waitFor(() => expect(screen.getByText("Ada")).toBeTruthy());
    const opener = screen.getByRole("button", { name: "Give everyone…" });
    // A click in jsdom does not move focus the way a browser press does.
    opener.focus();
    fireEvent.click(opener);
    const dialog = screen.getByRole("dialog");
    expect(document.activeElement).not.toBe(opener);

    shut(dialog);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(opener);
  });
});

describe("the players tab, when the list will not load", () => {
  it("says it could not read the players rather than claiming there are none", async () => {
    // Ruling 1: `page` must stay distinct from an empty result on a failed
    // read. `adminGet` resolves to null on any non-ok response or network
    // failure (see api.ts), so a 500 here has to land the tab on wording
    // that says the read failed — never on "Nobody by that name.", which
    // would tell an admin the room is empty when it is only unreachable.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method === "POST") {
          return { ok: true, status: 200, json: async () => ({ affected: 0, moved: 0 }) };
        }
        return { ok: false, status: 500, json: async () => ({ error: "broke" }) };
      }),
    );

    render(<Players />);

    await waitFor(() => expect(screen.getByText("Could not read the players.")).toBeTruthy());
    expect(screen.queryByText("Nobody by that name.")).toBeNull();
  });
});
