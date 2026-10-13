/**
 * Work Hub service worker.
 *
 * Two jobs only: show a notification when a push arrives, and when the user
 * taps it, either focus an already-open tab that's already showing the
 * exact target URL, or open a new tab/window at that URL. `lib/push/send.ts`
 * sends the push message body as `JSON.stringify({ title, body, url })`
 * with no extra wrapping, so `event.data.json()` below yields that shape
 * directly.
 *
 * The notification's `url` (see `lib/frameio/poll.ts` /
 * `lib/push/send.ts`) is always an EXTERNAL Frame.io link
 * (`https://app.frame.io/...`), never a same-origin Work Hub route. That
 * matters for `resolveNotificationClickAction` below: a same-origin check
 * is not a safe signal for "this tab can be steered to the target", because
 * steering it would require a cross-origin `client.navigate()`, which
 * WebKit (Safari/iOS — this project's primary target) can silently refuse.
 * Only an EXACT URL match is reused/focused; anything else opens a new
 * window, which works regardless of browser support for cross-origin
 * `navigate()`.
 */

/**
 * Pure decision function for `notificationclick`: given the URLs of
 * currently-open window clients and the resolved target URL, decides
 * whether to focus an existing client (because it's already showing the
 * exact target URL) or open a new window. Kept separate from the
 * `clients`/`event` service-worker APIs so it can be unit tested in a
 * plain JS/Node environment without a browser or service-worker shim.
 *
 * @param {string[]} clientUrls
 * @param {string} targetUrl
 * @returns {{ action: "focus", index: number } | { action: "openWindow" }}
 */
function resolveNotificationClickAction(clientUrls, targetUrl) {
  const index = clientUrls.findIndex((url) => url === targetUrl);
  if (index !== -1) {
    return { action: "focus", index };
  }
  return { action: "openWindow" };
}

self.addEventListener("install", () => {
  // Activate this version as soon as it finishes installing, rather than
  // waiting for every open tab to close first — this app has no versioned
  // asset cache to worry about invalidating, so there's nothing to protect
  // by waiting.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  // Take control of any already-open Work Hub tabs immediately, so a
  // service worker registered during this very session is the one that
  // ends up handling push for it instead of waiting for a reload.
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let payload = { title: "Work Hub", body: "", url: "/" };
  try {
    if (event.data) {
      const data = event.data.json();
      payload = {
        title: typeof data.title === "string" && data.title ? data.title : payload.title,
        body: typeof data.body === "string" ? data.body : payload.body,
        url: typeof data.url === "string" && data.url ? data.url : payload.url,
      };
    }
  } catch {
    // Malformed/non-JSON push payload - fall back to the defaults above
    // rather than letting the handler throw and drop the notification
    // entirely.
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      data: { url: payload.url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data && event.notification.data.url
    ? event.notification.data.url
    : "/";

  event.waitUntil(
    (async () => {
      const windowClients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });

      // Reuse an already-open tab only if it's already showing the EXACT
      // target URL - never just same-origin. The target is almost always a
      // cross-origin Frame.io link, and steering an existing same-origin
      // tab there would require a cross-origin client.navigate(), which
      // WebKit can silently refuse - leaving the user stranded on the
      // refocused tab instead of the notification's actual destination.
      // openWindow() always reaches the right URL, regardless of browser
      // support for cross-origin navigate().
      const resolvedTarget = new URL(targetUrl, self.location.origin).href;
      const clientUrls = windowClients.map((client) => client.url);
      const decision = resolveNotificationClickAction(clientUrls, resolvedTarget);

      if (decision.action === "focus") {
        return windowClients[decision.index].focus();
      }

      return self.clients.openWindow(resolvedTarget);
    })(),
  );
});
