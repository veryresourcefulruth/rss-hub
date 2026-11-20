// Refresh button and "new version" notice for the installed app (taskbar, dock or home screen).
// - A round refresh button shows in the corner whenever the hub is open as an app (no browser bar to reload from).
// - The hub checks /api/version when it opens, every 5 minutes, and whenever its window comes back into view.
//   When a newer version has been published, a notice offers a one-tap refresh.
// Styles are set from script so this works under strict Content-Security-Policy headers.
(function () {
  if (window.__hubRefresh) return;
  window.__hubRefresh = true;

  var VERSION_URL = '/api/version';
  var CHECK_EVERY = 5 * 60 * 1000;
  var loaded = null;      // version this page was opened with
  var noticeShown = false;
  var standalone = matchMedia('(display-mode: standalone)').matches
    || matchMedia('(display-mode: window-controls-overlay)').matches
    || navigator.standalone === true;

  function refresh() {
    var go = function () { location.reload(); };
    if ('serviceWorker' in navigator && navigator.serviceWorker.getRegistration) {
      navigator.serviceWorker.getRegistration()
        .then(function (r) { return r && r.update(); })
        .catch(function () {})
        .then(go);
      setTimeout(go, 1500); // never leave the button hanging
    } else go();
  }

  function busy(btn) {
    btn.disabled = true;
    btn.style.opacity = '.6';
    btn.style.transition = 'transform .6s';
    btn.style.transform = 'rotate(360deg)';
  }

  function addButton() {
    if (!standalone || document.getElementById('hubRefreshBtn')) return;
    var b = document.createElement('button');
    b.id = 'hubRefreshBtn';
    b.type = 'button';
    b.title = 'Refresh (F5)';
    b.setAttribute('aria-label', 'Refresh');
    b.textContent = '↻';
    b.style.cssText = 'position:fixed;right:14px;bottom:calc(14px + env(safe-area-inset-bottom, 0px));z-index:9998;'
      + 'width:44px;height:44px;border-radius:50%;border:1px solid rgba(0,0,0,.15);background:#fff;color:#1c1b19;'
      + 'font:600 22px/1 system-ui,sans-serif;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.18);padding:0;'
      + 'display:flex;align-items:center;justify-content:center';
    b.addEventListener('click', function () { busy(b); refresh(); });
    document.body.appendChild(b);
  }

  function showNotice() {
    if (noticeShown) return;
    noticeShown = true;
    var bar = document.createElement('div');
    bar.id = 'hubUpdateBar';
    bar.setAttribute('role', 'status');
    bar.style.cssText = 'position:fixed;left:50%;top:calc(12px + env(safe-area-inset-top, 0px));transform:translateX(-50%);z-index:9999;'
      + 'display:flex;align-items:center;gap:12px;max-width:calc(100% - 24px);background:#1c1b19;color:#fff;'
      + 'font:500 14px/1.35 system-ui,sans-serif;padding:10px 12px 10px 16px;border-radius:12px;box-shadow:0 8px 28px rgba(0,0,0,.25)';
    var msg = document.createElement('span');
    msg.textContent = 'A new version of this hub is ready.';
    var go = document.createElement('button');
    go.type = 'button';
    go.textContent = 'Refresh now';
    go.style.cssText = 'font:inherit;font-weight:700;border:0;border-radius:8px;padding:8px 14px;background:#fff;color:#1c1b19;cursor:pointer;flex:none';
    go.addEventListener('click', function () { go.disabled = true; go.textContent = 'Refreshing…'; refresh(); });
    var x = document.createElement('button');
    x.type = 'button';
    x.setAttribute('aria-label', 'Later');
    x.textContent = '✕';
    x.style.cssText = 'font:inherit;border:0;background:none;color:#fff;opacity:.7;cursor:pointer;padding:4px 6px;flex:none';
    x.addEventListener('click', function () { bar.remove(); });
    bar.appendChild(msg); bar.appendChild(go); bar.appendChild(x);
    document.body.appendChild(bar);
  }

  function check() {
    if (noticeShown || !window.fetch) return;
    fetch(VERSION_URL, { cache: 'no-store', credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d || !d.version) return;
        if (loaded === null) loaded = d.version;
        else if (d.version !== loaded) showNotice();
      })
      .catch(function () {});
  }

  function start() {
    addButton();
    check();
    setInterval(check, CHECK_EVERY);
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') check(); });
    addEventListener('focus', check);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
