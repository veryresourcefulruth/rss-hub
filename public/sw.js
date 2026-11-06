// Makes the app installable and shows a friendly page when the phone is offline.
// Nothing is cached: every screen always comes live from the server, so staff never see out-of-date shifts.
const OFFLINE = `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Offline</title>
<body style="font-family:system-ui,sans-serif;background:#F4F6F3;color:#1B2A33;display:grid;place-items:center;min-height:90vh;text-align:center;padding:24px">
<div><h1 style="font-size:1.4rem">You're offline</h1><p>Check your internet connection, then try again.</p>
<button onclick="location.reload()" style="font:inherit;font-weight:600;padding:10px 18px;border-radius:10px;border:0;background:#2C58C9;color:#fff">Try again</button></div>`;
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", e => {
  if (e.request.mode !== "navigate") return;           // API calls, scripts and images go straight to the network
  e.respondWith(fetch(e.request).catch(() => new Response(OFFLINE, { headers: { "content-type": "text/html; charset=utf-8" } })));
});
