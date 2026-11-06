/* Sign-in station: the nursery manager's iPad shows today's RSS staff; each person taps their name and enters
   their own 4-digit PIN when they arrive and leave. If they haven't set a PIN, the manager can confirm instead.
   Backup: staff sign in on their own phone (location-checked) from My shifts. */

const ukClock = iso => iso ? new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" }) : "";
// Arrival status pill for a shift card (today only).
function clockPill(s) {
  if (s.date !== me.today || s.status !== "filled") return "";
  if (s.clock_out_at) return pill(["Left " + ukClock(s.clock_out_at), ""]);
  if (s.clock_in_at) return pill(["Arrived " + ukClock(s.clock_in_at), "ok"]);
  const now = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });
  const late = (t => +t.slice(0, 2) * 60 + +t.slice(3))(now) > (+s.start.slice(0, 2) * 60 + +s.start.slice(3)) + 15;
  return late ? pill(["Not arrived", "bad"]) : pill(["Not arrived yet", "warn"]);
}

let stationTimer = null;
async function stationView() {
  clearInterval(stationTimer);
  let q = "";
  if (isAdmin()) {
    const clients = cache.clients || (cache.clients = await api("/api/clients"));
    if (!cache.stationClient) cache.stationClient = clients[0]?.id;
    q = "?client_id=" + cache.stationClient;
  }
  const d = await api("/api/station" + q);
  const picker = isAdmin() ? `<select id="st_client" aria-label="Nursery">${cache.clients.map(c => `<option value="${c.id}" ${c.id == cache.stationClient ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select>` : "";
  const card = s => {
    const state = s.clock_out_at ? "done" : s.clock_in_at ? "in" : "out";
    return `<button class="st-card ${state}" data-st="${s.id}" ${state === "done" ? "disabled" : ""}>
      ${avatar(s.has_photo ? `/api/photo/${encodeURIComponent(s.worker_email)}` : null, s.worker_name, 84)}
      <span class="st-name">${esc(s.worker_name)}</span>
      <span class="st-when">${s.start}–${s.finish}${s.room ? " · " + esc(s.room) : ""}</span>
      <span class="st-state">${state === "done" ? `Left ${ukClock(s.clock_out_at)} ✓` : state === "in" ? `Here since ${ukClock(s.clock_in_at)}` : "Not signed in"}</span>
      <span class="st-act">${state === "done" ? "All done" : state === "in" ? "Tap to sign out" : "Tap to sign in"}</span></button>`;
  };
  $("#app").innerHTML = `<div class="station">
    <div class="st-top"><div><p class="eyebrow">RSS sign-in station</p><h2>${esc(d.client.name)}</h2><p class="note">${new Date(d.date + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" })} · <b id="st_time">${d.time}</b></p></div>
      <div class="row">${picker}<button class="btn ghost sm" id="st_full">Full screen</button></div></div>
    <p class="st-help">RSS staff: tap your name, then enter your 4-digit PIN when you arrive and when you leave.</p>
    <div class="st-grid">${d.shifts.length ? d.shifts.map(card).join("") : `<p class="empty">No RSS staff are booked here today.</p>`}</div>
    <p class="note" style="margin-top:22px">Staff must also sign in on the nursery's own sign-in system, as normal. ${d.client.located ? "" : `<button class="link-btn" id="st_loc">Set this nursery's location</button> so staff can also sign in on their own phones if this iPad isn't available. Do this while you're at the nursery.`}</p></div>`;
  if (picker) $("#st_client").onchange = e => { cache.stationClient = e.target.value; stationView(); };
  $("#st_full").onclick = () => { const el = document.documentElement; (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el); };
  const loc = $("#st_loc"); if (loc) loc.onclick = () => {
    loc.textContent = "Finding location…";
    navigator.geolocation.getCurrentPosition(async p => {
      try { await api("/api/station/location" + q, { method: "POST", body: { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy } }); toast("Location saved"); stationView(); }
      catch (e) { toast(e.message); }
    }, () => { loc.textContent = "Couldn't get location. Allow location for this site and try again."; }, { enableHighAccuracy: true, timeout: 15000 });
  };
  $$("[data-st]").forEach(b => b.onclick = () => pinPad(d.shifts.find(s => s.id == b.dataset.st), q));
  stationTimer = setInterval(() => {
    if (view !== "station") { clearInterval(stationTimer); return; }
    if (!$("#pinpad")) stationView();
  }, 30000);
}

function pinPad(s, q) {
  const action = s.clock_in_at ? "out" : "in";
  let pin = "";
  const close = () => $("#pinpad")?.remove();
  const send = async body => {
    try {
      const r = await api("/api/station/clock" + q, { method: "POST", body: { shift_id: s.id, action, ...body } });
      $("#pinpad .pp-box").innerHTML = `<div class="pp-done"><div class="pp-tick">✓</div><h2>${action === "in" ? "Welcome" : "Thank you"}, ${esc(s.worker_name.split(" ")[0])}</h2><p>${action === "in" ? "Signed in" : "Signed out"} at <b>${r.time}</b>.</p>${action === "out" ? `<p class="note">Your hours have been sent for the manager to approve.</p>` : `<p class="note">Remember to sign in on the nursery's own system too.</p>`}</div>`;
      setTimeout(() => { close(); stationView(); }, 3500);
    } catch (e) { pin = ""; paint(e.message); }
  };
  const paint = err => {
    $("#pinpad .pp-box").innerHTML = `<p class="eyebrow">${action === "in" ? "Signing in" : "Signing out"}</p><h2>${esc(s.worker_name)}</h2>
      <p class="note">Enter your 4-digit RSS Hub PIN</p>
      <div class="pp-dots" aria-label="${pin.length} of 4 digits entered">${[0, 1, 2, 3].map(i => `<i class="${i < pin.length ? "on" : ""}"></i>`).join("")}</div>
      <p class="err" role="alert">${esc(err || "")}</p>
      <div class="pp-keys">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `<button data-k="${n}">${n}</button>`).join("")}<button data-k="x" aria-label="Cancel">Cancel</button><button data-k="0">0</button><button data-k="b" aria-label="Delete">⌫</button></div>
      <button class="link-btn" id="pp_mgr">${s.has_pin ? "Forgotten PIN? Manager confirms instead" : "No PIN set yet: manager confirms instead"}</button>`;
    $$("#pinpad [data-k]").forEach(k => k.onclick = () => {
      const v = k.dataset.k;
      if (v === "x") return close();
      if (v === "b") { pin = pin.slice(0, -1); return paint(); }
      if (pin.length < 4) pin += v;
      paint();
      if (pin.length === 4) { $("#pinpad .pp-dots").classList.add("busy"); send({ pin }); }
    });
    $("#pp_mgr").onclick = () => {
      $("#pinpad .pp-box").innerHTML = `<p class="eyebrow">Manager confirmation</p><h2>${esc(s.worker_name)}</h2>
        <p>Only tap this if you're the nursery manager and you've seen ${esc(s.worker_name.split(" ")[0])} ${action === "in" ? "arrive" : "leave"} just now. It's recorded under your name.</p>
        <p class="err" role="alert"></p>
        <div class="row" style="justify-content:center"><button class="btn" id="pp_ok">Confirm ${action === "in" ? "arrival" : "departure"}</button><button class="btn ghost" id="pp_back">Back</button></div>`;
      $("#pp_ok").onclick = () => send({ manager_confirm: true });
      $("#pp_back").onclick = () => paint();
    };
  };
  document.body.insertAdjacentHTML("beforeend", `<div id="pinpad" class="pinpad" role="dialog" aria-modal="true"><div class="pp-box"></div></div>`);
  $("#pinpad").onclick = e => { if (e.target.id === "pinpad") close(); };
  paint();
}

/* ---------- staff: sign in on own phone (backup) and set PIN ---------- */
function phoneClockHtml(s) {
  if (s.date !== me.today || s.status !== "filled" || s.clock_out_at) return s.clock_out_at && s.date === me.today ? `<div class="note">Signed out at ${ukClock(s.clock_out_at)}. Your hours have gone to the nursery to approve.</div>` : "";
  return `<div class="row" style="margin-top:6px">${s.clock_in_at ? `<span class="note">Signed in at ${ukClock(s.clock_in_at)}.</span>` : ""}
    <button class="btn ${s.clock_in_at ? "ghost " : ""}sm" data-pclock="${s.id}" data-act="${s.clock_in_at ? "out" : "in"}">${s.clock_in_at ? "I'm leaving" : "I've arrived"}</button><span class="err" id="pc${s.id}"></span></div>
    <div class="note">Use the nursery's sign-in iPad if there is one. Use this button only if it isn't available.</div>`;
}
function wirePhoneClock() {
  $$("[data-pclock]").forEach(b => b.onclick = () => {
    const err = $("#pc" + b.dataset.pclock);
    if (!navigator.geolocation) { err.textContent = "This phone can't share its location. Use the nursery's sign-in iPad."; return; }
    b.disabled = true; err.textContent = "Checking you're at the nursery…";
    navigator.geolocation.getCurrentPosition(async p => {
      try {
        const r = await api(`/api/shifts/${b.dataset.pclock}/clock`, { method: "POST", body: { action: b.dataset.act, lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy } });
        toast(b.dataset.act === "in" ? `Signed in at ${r.time}` : `Signed out at ${r.time}. Hours sent for approval.`); render();
      } catch (e) { err.textContent = e.message; b.disabled = false; }
    }, () => { err.textContent = "Location is turned off for the RSS Hub. Turn it on in your phone settings, or use the nursery's sign-in iPad."; b.disabled = false; },
    { enableHighAccuracy: true, timeout: 20000, maximumAge: 60000 });
  });
}
function pinRowHtml() {
  return `<div class="check-row"><div><b>Sign-in PIN</b><div class="note">${me.has_pin ? "Set. You use it on the nursery's sign-in iPad when you arrive and leave." : "Choose a 4-digit PIN to sign in on the nursery's iPad when you arrive and leave."}</div></div>
    <button class="btn ${me.has_pin ? "ghost " : ""}sm" id="setPin">${me.has_pin ? "Change PIN" : "Set PIN"}</button></div>`;
}
function wirePinRow() {
  const b = $("#setPin"); if (!b) return;
  b.onclick = () => openDrawer(`<p class="eyebrow">Sign-in PIN</p><h2>${me.has_pin ? "Change" : "Choose"} your PIN</h2>
    <p class="note">4 numbers that only you know. You'll type it on the nursery's sign-in iPad. Don't use your bank PIN or something like 1234.</p>
    <label class="fld" for="pin1">New PIN<input type="password" id="pin1" inputmode="numeric" maxlength="4" pattern="[0-9]{4}" autocomplete="off" class="pin"></label>
    <label class="fld" for="pin2">Type it again<input type="password" id="pin2" inputmode="numeric" maxlength="4" pattern="[0-9]{4}" autocomplete="off" class="pin"></label>
    <p class="err" id="pin_e"></p><div class="row"><button class="btn" id="pin_go">Save PIN</button></div>`, root => {
    root.querySelector("#pin_go").onclick = async () => {
      const a = fieldVal(root, "pin1"), c = fieldVal(root, "pin2");
      if (a !== c) { root.querySelector("#pin_e").textContent = "The two PINs don't match."; return; }
      if (await act(root.querySelector("#pin_go"), () => api("/api/me/pin", { method: "PUT", body: { pin: a } }), root.querySelector("#pin_e"))) { me.has_pin = true; closeDrawer(); toast("PIN saved"); render(); }
    };
  });
}
