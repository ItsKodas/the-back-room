// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { registerServiceWorker } from "./register.js";

const container = () => ({ register: vi.fn(async () => ({}) as ServiceWorkerRegistration) });

describe("registering the worker", () => {
  it("does nothing outside a production build", () => {
    const workers = container();
    registerServiceWorker(false, workers);
    window.dispatchEvent(new Event("load"));
    expect(workers.register).not.toHaveBeenCalled();
  });

  it("does nothing in a browser without service workers", () => {
    expect(() => registerServiceWorker(true, undefined)).not.toThrow();
  });

  it("registers the worker at the root, once, whether or not the page had finished loading", () => {
    // The load is dispatched either way: if the page was already complete the
    // worker registered at once and no listener is waiting, so it stays one.
    const workers = container();
    registerServiceWorker(true, workers);
    window.dispatchEvent(new Event("load"));
    expect(workers.register).toHaveBeenCalledTimes(1);
    expect(workers.register).toHaveBeenCalledWith("/sw.js");
  });

  it("does not turn a refused registration into an error on the page", async () => {
    const refusing = { register: vi.fn(async () => Promise.reject(new Error("insecure"))) };
    const unhandled = vi.fn();
    window.addEventListener("unhandledrejection", unhandled);
    registerServiceWorker(true, refusing);
    window.dispatchEvent(new Event("load"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(refusing.register).toHaveBeenCalled();
    expect(unhandled).not.toHaveBeenCalled();
  });
});
