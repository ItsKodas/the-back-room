/**
 * Hands the page to the service worker.
 *
 * Production only. In development Vite serves the client from its own server,
 * and a worker left behind on localhost by a `vite preview` would keep answering
 * with an offline page whenever the dev server happened to be down — a stale
 * page nobody asked for, on the one machine where it would be most confusing.
 *
 * After load, so fetching and parsing the worker never competes with the
 * room's first paint on a slow phone.
 */
export function registerServiceWorker(
  enabled: boolean,
  container: Pick<ServiceWorkerContainer, "register"> | undefined = navigator.serviceWorker,
): void {
  if (!enabled || container === undefined) {
    return;
  }
  const register = () => {
    // A refusal — an insecure origin, a private window — leaves the site
    // exactly as it was, which is a website. Nothing to tell anybody.
    container.register("/sw.js").catch(() => {});
  };
  if (document.readyState === "complete") {
    register();
  } else {
    window.addEventListener("load", register, { once: true });
  }
}
