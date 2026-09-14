// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Codes } from "./Codes.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
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
