/**
 * Work Hub service worker.
 *
 * Two jobs only: show a notification when a push arrives, and when the user
 * taps it, focus an already-open Work Hub tab (navigating it to the
 * notification's URL) or open a new one. `lib/push/send.ts` sends the push
 * message body as `JSON.stringify({ title, body, url })` with no extra
 * wrapping, so `event.data.json()` below yields that shape directly.
 */

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

      // Prefer focusing (and navigating) an already-open Work Hub tab over
      // opening a new one, so tapping a notification doesn't pile up tabs.
      const resolvedTarget = new URL(targetUrl, self.location.origin).href;
      for (const client of windowClients) {
        if (client.url.startsWith(self.location.origin)) {
          if (client.url !== resolvedTarget && "navigate" in client) {
            try {
              await client.navigate(resolvedTarget);
            } catch {
              // Some browsers restrict cross-document navigate() in edge
              // cases - focusing the existing tab is still a reasonable
              // outcome even if it can't be steered to the exact URL.
            }
          }
          return client.focus();
        }
      }

      return self.clients.openWindow(resolvedTarget);
    })(),
  );
});
