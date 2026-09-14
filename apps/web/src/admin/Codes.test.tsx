// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Codes } from "./Codes.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("minting a code", () => {
  /*
   * `Math.floor(Number("1o"))` is NaN, and `JSON.stringify` turns NaN into
   * null — which the server reads as "anyone, once each". A typo in a small
   * number minted a code with no cap at all.
   */
  it("refuses a People box that is not a whole number, and posts nothing", async () => {
    const posted: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === "POST") {
          posted.push(url);
          return { ok: true, status: 200, json: async () => ({ code: { code: "ABCD" } }) };
        }
        return { ok: true, status: 200, json: async () => ({ codes: [] }) };
      }),
    );

    render(<Codes />);
    await waitFor(() => expect(screen.getByText("None minted yet.")).toBeTruthy());

    for (const typo of ["1o", "0", "2.5", "-3"]) {
      fireEvent.change(screen.getByLabelText("People (blank: anyone, once each)"), { target: { value: typo } });
      fireEvent.click(screen.getByRole("button", { name: "Mint" }));
      await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/whole number/i));
      expect(posted).toEqual([]);
    }
  });

  it("still mints for anyone when the box is blank", async () => {
    const bodies: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method === "POST") {
          bodies.push(JSON.parse(String(init.body)));
          return { ok: true, status: 200, json: async () => ({ code: { code: "ABCD" } }) };
        }
        return { ok: true, status: 200, json: async () => ({ codes: [] }) };
      }),
    );

    render(<Codes />);
    await waitFor(() => expect(screen.getByText("None minted yet.")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Mint" }));
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toMatchObject({ maxRedemptions: null });
  });
});

describe("the codes tab, when the list will not load", () => {
  it("says it could not read the list rather than claiming there are none", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.startsWith("/api/admin/codes")) {
          return { ok: false, status: 500, json: async () => ({ error: "broke" }) };
        }
        return { ok: false, status: 404, json: async () => ({}) };
      }),
    );

    render(<Codes />);

    await waitFor(() => expect(screen.getByText("Could not read it.")).toBeTruthy());
    expect(screen.queryByText("None minted yet.")).toBeNull();
  });
});
