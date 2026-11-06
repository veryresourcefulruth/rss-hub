// Turns the site into an installable phone app and gently shows staff how to add it to their home screen.
(function () {
  if ("serviceWorker" in navigator) addEventListener("load", function () { navigator.serviceWorker.register("/sw.js").catch(function () {}); });
  var standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  var KEY = "rss-install-dismissed", phone = matchMedia("(pointer: coarse)").matches && innerWidth < 900;
  function dismissed() { try { return Number(localStorage.getItem(KEY) || 0) > Date.now(); } catch (e) { return false; } }
  function hide(days) { try { localStorage.setItem(KEY, String(Date.now() + days * 864e5)); } catch (e) {} var b = document.getElementById("installBar"); if (b) b.remove(); document.body.style.paddingBottom = ""; }
  if (standalone || dismissed()) return;
  var ua = navigator.userAgent, ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  var deferred = null;
  function show(html, onInstall) {
    if (document.getElementById("installBar")) return;
    var bar = document.createElement("div");
    bar.id = "installBar"; bar.className = "install-bar"; bar.setAttribute("role", "region"); bar.setAttribute("aria-label", "Install the app");
    bar.innerHTML = '<img src="/icon-192.png" alt="" width="40" height="40"><div class="ib-text">' + html + '</div>' +
      (onInstall ? '<button type="button" class="ib-go">Install</button>' : "") + '<button type="button" class="ib-x" aria-label="Not now">✕</button>';
    document.body.appendChild(bar);
    document.body.style.paddingBottom = (bar.offsetHeight + 28) + "px";   // so the bar never hides the last button on the page
    bar.querySelector(".ib-x").onclick = function () { hide(14); };
    if (onInstall) bar.querySelector(".ib-go").onclick = onInstall;
  }
  addEventListener("beforeinstallprompt", function (e) {
    e.preventDefault(); deferred = e;
    show("<b>Get the app</b><span>Add " + document.title + " to your home screen.</span>", function () {
      deferred.prompt(); deferred.userChoice.then(function () { hide(60); });
    });
  });
  addEventListener("appinstalled", function () { hide(3650); });
  if (ios && phone) setTimeout(function () {
    show('<b>Get the app</b><span>Tap <svg width="14" height="16" viewBox="0 0 14 16" aria-label="Share" style="vertical-align:-2px"><path d="M7 1v9M3.5 4.5 7 1l3.5 3.5M2 7.5v7h10v-7" fill="none" stroke="currentColor" stroke-width="1.6"/></svg> <b>Share</b>, then <b>Add to Home Screen</b>.</span>');
  }, 1500);
})();
