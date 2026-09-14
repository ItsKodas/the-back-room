// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Admin } from "./Admin.js";

function stubFetch(allowed = true) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url === "/api/me") {
        return { ok: true, json: async () => ({ signedIn: false, signinAvailable: false }) };
      }
      if (url.startsWith("/api/admin/")) {
        if (!allowed) {
          return { ok: false, status: 404, json: async () => ({ error: "Not found." }) };
        }
        if (url.startsWith("/api/admin/bank")) {
          return { ok: true, json: async () => ({ bank: 1000, maxStake: 10 }) };
        }
        if (url.startsWith("/api/admin/log")) {
          return { ok: true, json: async () => ({ entries: [] }) };
        }
        if (url.startsWith("/api/admin/users")) {
          return { ok: true, json: async () => ({ rows: [], total: 0 }) };
        }
        if (url.startsWith("/api/admin/codes")) {
          return { ok: true, json: async () => ({ codes: [] }) };
        }
        if (url.startsWith("/api/admin/emotes")) {
          return { ok: true, json: async () => ({ emotes: [] }) };
        }
      }
      return { ok: false, status: 404, json: async () => ({}) };
    }),
  );
}

let where = "";
function Where() {
  const location = useLocation();
  where = `${location.pathname}${location.search}`;
  return null;
}

function show(at: string) {
  render(
    <MemoryRouter initialEntries={[at]}>
      <Routes>
        <Route path="/admin" element={<><Admin /><Where /></>} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the admin desk's tabs", () => {
  it("opens on the banks when the URL names no tab", async () => {
    stubFetch();
    show("/admin");
    await waitFor(() => expect(screen.getByRole("tab", { name: "Banks" }).getAttribute("aria-selected")).toBe("true"));
    expect(screen.getByRole("tabpanel").textContent).toContain("Slots");
  });

  it("opens the tab the URL names, and a press changes the URL", async () => {
    stubFetch();
    show("/admin?tab=codes");
    await waitFor(() => expect(screen.getByRole("tab", { name: "Codes" }).getAttribute("aria-selected")).toBe("true"));
    fireEvent.click(screen.getByRole("tab", { name: "Log" }));
    expect(where).toBe("/admin?tab=log");
    expect(screen.getByRole("tab", { name: "Log" }).getAttribute("aria-selected")).toBe("true");
  });

  it("says there is no such page to somebody the server turns away", async () => {
    stubFetch(false);
    show("/admin");
    await waitFor(() => expect(screen.getByText("No such page.")).toBeTruthy());
    expect(screen.queryByRole("tablist")).toBeNull();
  });
});
