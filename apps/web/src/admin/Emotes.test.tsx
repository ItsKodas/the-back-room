// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Emotes } from "./Emotes.js";

const EMOTE = {
  id: "e1",
  name: "Smug",
  cost: 250,
  imageMime: "image/gif",
  soundMime: null,
  imageBytes: 2048,
  soundBytes: null,
  createdAt: 1,
  retired: false,
};

const posted: string[] = [];

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** The list read succeeds with one emote; POSTs succeed and are recorded by url. */
function stub() {
  posted.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        posted.push(url);
        return { ok: true, status: 200, json: async () => ({ ok: true }) };
      }
      return { ok: true, status: 200, json: async () => ({ emotes: [EMOTE] }) };
    }),
  );
}

describe("deleting an emote", () => {
  it("asks once before it sends", async () => {
    stub();
    render(<Emotes />);
    const card = await waitFor(() => screen.getByRole("article", { name: "Smug" }));
    fireEvent.click(within(card).getByRole("button", { name: "Delete" }));
    expect(posted).toEqual([]);
    fireEvent.click(within(card).getByRole("button", { name: "Delete for good?" }));
    await waitFor(() => expect(posted).toEqual(["/api/admin/emotes/e1/delete"]));
  });

  it("stops asking after a moment", async () => {
    stub();
    render(<Emotes />);
    const card = await waitFor(() => screen.getByRole("article", { name: "Smug" }));
    vi.useFakeTimers();
    fireEvent.click(within(card).getByRole("button", { name: "Delete" }));
    act(() => {
      vi.advanceTimersByTime(3100);
    });
    expect(within(card).getByRole("button", { name: "Delete" })).toBeTruthy();
    expect(posted).toEqual([]);
  });
});

describe("the emotes tab, when the list will not load", () => {
  it("says it could not read the list rather than claiming there are none", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.startsWith("/api/admin/emotes")) {
          return { ok: false, status: 500, json: async () => ({ error: "broke" }) };
        }
        return { ok: false, status: 404, json: async () => ({}) };
      }),
    );

    render(<Emotes />);

    await waitFor(() => expect(screen.getByText("Could not read the emotes.")).toBeTruthy());
    expect(screen.queryByText("None yet.")).toBeNull();
  });
});

describe("a refused delete", () => {
  it("says the server's words rather than silently reloading", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method === "POST") {
          return { ok: false, status: 404, json: async () => ({ error: "Already gone." }) };
        }
        return { ok: true, status: 200, json: async () => ({ emotes: [EMOTE] }) };
      }),
    );

    render(<Emotes />);
    const card = await waitFor(() => screen.getByRole("article", { name: "Smug" }));
    fireEvent.click(within(card).getByRole("button", { name: "Delete" }));
    fireEvent.click(within(card).getByRole("button", { name: "Delete for good?" }));

    await waitFor(() => expect(within(card).getByText("Already gone.")).toBeTruthy());
    // The card is still here — a refusal does not vanish the emote it named.
    expect(screen.getByRole("article", { name: "Smug" })).toBeTruthy();
  });
});
