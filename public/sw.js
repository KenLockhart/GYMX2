// GYMX2 service worker: shows push notifications and opens the right page when one is tapped.
// It does not cache pages, so the site always loads fresh.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) =>
  event.waitUntil(self.clients.claim()),
);

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "GYMX2", body: event.data ? event.data.text() : "" };
  }
  const url =
    typeof data.url === "string" && data.url.startsWith("/")
      ? data.url
      : "/dashboard";
  event.waitUntil(
    self.registration.showNotification(data.title || "GYMX2", {
      body: data.body || "",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: data.tag,
      renotify: Boolean(data.tag),
      data: { url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(
    event.notification.data?.url || "/dashboard",
    self.location.origin,
  ).href;
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((windows) => {
        for (const client of windows) {
          if (
            client.url.startsWith(self.location.origin) &&
            "focus" in client
          ) {
            return client
              .navigate(target)
              .then((page) => (page || client).focus());
          }
        }
        return self.clients.openWindow(target);
      }),
  );
});
