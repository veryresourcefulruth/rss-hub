/* RSS Hub — browser app. Sign-in is handled by Cloudflare Access before this page loads.
   Staff: take shifts, submit hours, keep checks up to date.
   Nursery managers: request cover, see who's coming and their checks, sign off hours.
   RSS office (owner/coordinator): everything, plus invoices and pay. */

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const gbp = p => "£" + ((p || 0) / 100).toFixed(2);
const rate = p => p == null ? "" : ((p || 0) / 100).toFixed(2);
const hrs = m => m == null ? "–" : (m / 60).toFixed(2).replace(/\.?0+$/, "") + " h";
const dayName = d => new Date(d + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const fullDate = d => d ? new Date(d.length > 10 ? d : d + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "";
const minsBetween = (a, b, br) => { const t = x => +x.slice(0, 2) * 60 + +x.slice(3); return t(b) - t(a) - (br || 0); };
function toast(t) { const el = $("#toast"); el.textContent = t; el.hidden = false; clearTimeout(toast.h); toast.h = setTimeout(() => el.hidden = true, 3000); }

/* ---------- API ---------- */
const DEV = (() => { try { return localStorage.getItem("rss-dev-email"); } catch { return null; } })();
async function api(path, opts = {}) {
  const headers = { ...(opts.body && !(opts.body instanceof Blob) ? { "content-type": "application/json" } : {}), ...(DEV ? { "x-dev-email": DEV } : {}), ...(opts.headers || {}) };
  let res;
  try { res = await fetch(path, { method: opts.method || "GET", headers, body: opts.body instanceof Blob ? opts.body : opts.body ? JSON.stringify(opts.body) : undefined }); }
  catch { throw new Error("Can't reach the server. Check your connection and try again."); }
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("json") && !res.ok && res.status !== 409) { if (res.status === 401 || res.redirected) { location.reload(); } throw new Error("Your sign-in has expired. Reloading…"); }
  const data = ct.includes("json") ? await res.json() : await res.blob();
  if (!res.ok) { const e = new Error(data.error || "Something went wrong."); e.status = res.status; e.data = data; throw e; }
  return data;
}
async function download(path, fallbackName) {
  try {
    const blob = await api(path);
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = fallbackName; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  } catch (e) { toast(e.message); }
}

/* ---------- state ---------- */
let me = null, view = null, cache = {};
const isAdmin = () => me && (me.role === "owner" || me.role === "coordinator");
const TABS = {
  staff: [["shifts", "My shifts"], ["hours", "My hours"], ["checks", "My checks"], ["training", "Training"]],
  manager: [["shifts", "Our shifts"], ["station", "Sign-in station"], ["staff", "Our staff"], ["request", "Request cover"], ["hours", "Sign off hours"]],
  admin: [["today", "Today"], ["shifts", "Shifts"], ["staff", "Staff"], ["nurseries", "Nurseries"], ["billing", "Hours & billing"], ["training", "Training"], ["settings", "Settings"]],
};
const tabsFor = () => TABS[isAdmin() ? "admin" : me.role];

async function boot() {
  try { me = await api("/api/me"); }
  catch (e) {
    $("#app").innerHTML = `<div class="panel" style="max-width:560px"><p class="eyebrow">RSS Hub</p><h2>No access yet</h2><p>${esc(e.message)}</p>
      <p class="note">If you think this is wrong, contact RSS on ruth@resourcefulruth.co.uk.</p></div>`;
    $("#foot").innerHTML = `<span></span><a href="/cdn-cgi/access/logout">Sign out</a>`; return;
  }
  const hash = location.hash.slice(1);
  view = tabsFor().some(t => t[0] === hash) || (me.role === "staff" && hash === "terms") || (isAdmin() && hash === "station") ? hash : tabsFor()[0][0];
  $("#foot").innerHTML = `<span>Signed in as ${esc(me.name)} (${esc(me.email)})${me.client ? " · " + esc(me.client.name) : ""}</span><a href="/cdn-cgi/access/logout">Sign out</a>`;
  render();
}
// Refresh the current view when the person comes back to the tab, and every 2 minutes while it's open,
// so new bookings and sign-offs appear without a manual reload (skipped while a form/drawer is open).
const LIST_VIEWS = ["shifts", "hours", "checks", "today", "staff", "nurseries"];
// Shown to staff whenever something stops them being booked.
const outstandingHtml = (list, link) => `<div class="callout outstanding" role="alert"><b>You cannot currently be booked into a shift, as you have outstanding requirements to complete:</b>
  <ul class="blk">${list.map(b => `<li>${esc(b.charAt(0).toUpperCase() + b.slice(1))}</li>`).join("")}</ul>
  <div class="note" style="color:inherit">Upload or update these in My checks. RSS checks each item, usually within 2 working days. Once everything is verified, shifts will open up for you here.</div>
  <div class="row" style="margin-top:8px">${list.some(b => /terms of engagement/i.test(b)) ? `<button class="btn sm" id="toTerms">Read and sign the terms</button>` : ""}${list.some(b => /childcare 101/i.test(b)) ? `<button class="btn sm" id="toTraining">Do Childcare 101</button>` : ""}${link ? `<button class="btn ${list.some(b => /terms of engagement/i.test(b)) ? "ghost " : ""}sm" id="toChecks">Go to My checks</button>` : ""}</div></div>`;
const wireOutstanding = () => { const t = $("#toTerms"); if (t) t.onclick = () => go("terms"); const tr = $("#toTraining"); if (tr) tr.onclick = () => go("training"); const c = $("#toChecks"); if (c) c.onclick = () => go("checks"); };
const declinedHtml = s => s.declined?.length ? `<div class="note">Declined by ${s.declined.map(d => esc(d.name) + (d.reason ? ` (“${esc(d.reason)}”)` : "")).join(", ")}</div>` : "";
const expiringHtml = list => list?.length ? `<div class="callout"><b>Training and certificates to renew:</b><ul class="blk" style="color:inherit">${list.map(x => `<li>${esc(x.label)}: ${x.expired ? "<b>expired</b> " : "expires "}${fullDate(x.expires_on)}</li>`).join("")}</ul></div>` : "";
const refreshIfIdle = () => { if (me && LIST_VIEWS.includes(view) && document.visibilityState === "visible" && !$("#drawer-root").innerHTML && !document.activeElement?.matches("input,textarea,select")) render(); };
document.addEventListener("visibilitychange", refreshIfIdle);
setInterval(refreshIfIdle, 120000);
window.addEventListener("hashchange", () => { const h = location.hash.slice(1); if (me && h !== view && tabsFor().some(t => t[0] === h)) { view = h; render(); } });
function go(v) { view = v; history.replaceState(null, "", "#" + v); render(); scrollTo({ top: 0 }); }

function renderTabs(counts = {}) {
  $("#tabs").innerHTML = tabsFor().map(([k, l]) => `<button class="tab" data-tab="${k}" aria-pressed="${k === view}">${l}${counts[k] ? `<span class="count">${counts[k]}</span>` : ""}</button>`).join("");
  $$("[data-tab]").forEach(b => b.onclick = () => go(b.dataset.tab));
}
async function render() {
  renderTabs(cache.counts);
  $("#app").innerHTML = `<p class="loading">Loading…</p>`;
  try {
    const fn = isAdmin() ? ADMIN[view] : me.role === "manager" ? MANAGER[view] : STAFF[view];
    await fn();
  } catch (e) { $("#app").innerHTML = `<div class="panel"><p class="err">${esc(e.message)}</p><button class="btn" id="retry">Try again</button></div>`; $("#retry").onclick = render; }
}

/* ---------- drawer ---------- */
function openDrawer(html, wire) {
  $("#drawer-root").innerHTML = `<div class="drawer-bg" id="dbg"></div><aside class="drawer" role="dialog" aria-modal="true"><button class="close" id="dclose">Close</button><div id="dbody">${html}</div></aside>`;
  $("#dbg").onclick = $("#dclose").onclick = closeDrawer;
  document.addEventListener("keydown", escClose);
  if (wire) wire($("#dbody"));
}
function escClose(e) { if (e.key === "Escape") closeDrawer(); }
function closeDrawer() { $("#drawer-root").innerHTML = ""; document.removeEventListener("keydown", escClose); }
function setDrawer(html, wire) { $("#dbody").innerHTML = html; if (wire) wire($("#dbody")); }

/* ---------- shared pieces ---------- */
const STATUS = {
  requested: ["Requested", "warn"], open: ["Offered to staff", "info"], pending: ["Waiting for worker to confirm", "warn"], filled: ["Booked", "ok"], cancelled: ["Cancelled", ""],
};
const TS = { none: null, submitted: ["Hours submitted", "warn"], approved: ["Hours approved", "ok"], queried: ["Hours queried", "bad"] };
const pill = ([t, c]) => `<span class="pill ${c}">${esc(t)}</span>`;
function shiftWhen(s) { return `<span class="when">${dayName(s.date)} · ${s.start}–${s.finish}</span>`; }
function shiftReqs(s) { return [s.room && esc(s.room), s.needs_l3 && "Level 3 needed", s.needs_pfa && "PFA needed", s.break_min ? `${s.break_min} min break` : "No break"].filter(Boolean).join(" · "); }
function fieldVal(root, id) { const el = root.querySelector("#" + id); return el.type === "checkbox" ? el.checked : el.value; }
async function act(btn, fn, msgEl) {
  btn.disabled = true; if (msgEl) msgEl.textContent = "";
  try { await fn(); } catch (e) { if (msgEl) msgEl.textContent = e.message; else toast(e.message); btn.disabled = false; return false; }
  btn.disabled = false; return true;
}
const checkStatusPill = (c, def, today) => !c ? pill(["Missing", def.required ? "bad" : ""]) :
  c.status === "verified" ? (c.expires_on && c.expires_on < today ? pill(["Expired " + fullDate(c.expires_on), "bad"]) : pill(["Verified" + (c.expires_on ? " · to " + fullDate(c.expires_on) : ""), "ok"])) :
  c.status === "rejected" ? pill(["Rejected", "bad"]) : pill([(c.docs ? "Uploaded, " : "") + "awaiting RSS check", "warn"]);

/* ---------- check form (staff self-service and RSS) ---------- */
function checkForm(email, type, c, admin, user) {
  const def = me.checkTypes[type], d = c?.detail || {};
  return `<p class="eyebrow">${admin ? "Compliance" : "My checks"}</p><h2>${esc(def.label)}</h2>
  ${!admin ? `<p class="note">Fill in the details and upload a clear photo or PDF. RSS checks it before it counts.${c?.status === "verified" ? " Changing a verified item sends it back for checking." : ""}</p>` : ""}
  ${c?.status === "rejected" && c.notes ? `<div class="callout"><b>RSS note:</b> ${esc(c.notes)}</div>` : ""}
  <form id="ckf"><div class="form-grid">
    <label class="fld" for="ck_ref">${esc(def.refLabel)}<input type="text" id="ck_ref" value="${esc(c?.ref)}"></label>
    ${def.issued ? `<label class="fld" for="ck_iss">Issue date<input type="date" id="ck_iss" value="${esc(c?.issued_on)}"></label>` : ""}
    ${def.expires ? (def.group === "training" && def.years
      ? `<label class="fld" for="ck_exp">Expiry date<input type="date" id="ck_exp" value="${esc(c?.expires_on)}" disabled><span class="note" style="font-weight:400">Set automatically: 1 year after the issue date (RSS policy).</span></label>`
      : `<label class="fld" for="ck_exp">${type === "rtw" ? "Permission ends (blank if no time limit)" : "Expiry / renewal date"}<input type="date" id="ck_exp" value="${esc(c?.expires_on)}"></label>`) : ""}
    ${type === "dbs" ? `<label class="fld" for="ck_dt">DBS type<select id="ck_dt"><option value="">Choose…</option>${me.dbsTypes.map(t => `<option ${d.dbs_type === t ? "selected" : ""}>${esc(t)}</option>`).join("")}</select></label>
      <label class="fld" for="ck_usn">Update Service number<input type="text" id="ck_usn" value="${esc(d.update_service_no)}" placeholder="e.g. C1234567890"></label>
      <label class="fld" for="ck_lsc">Last Update Service status check<input type="date" id="ck_lsc" value="${esc(d.last_status_check)}"></label>` : ""}
    ${type === "rtw" ? `<label class="fld" for="ck_rm">Proof of right to work<select id="ck_rm"><option value="">Choose…</option>${me.rtwMethods.map(t => `<option ${d.rtw_method === t ? "selected" : ""}>${esc(t)}</option>`).join("")}</select></label>
      <label class="fld" for="ck_cd">Visa / right to work check date<input type="date" id="ck_cd" value="${esc(d.check_date)}"></label>
      <label class="fld" for="ck_cr">Visa check reference<input type="text" id="ck_cr" value="${esc(d.check_ref)}" placeholder="e.g. WE-J88G273-2Y"></label>` : ""}
    ${type === "rtw" && admin ? `<label class="fld" for="ck_whl">Weekly hours limit (e.g. 20 on a Student visa in term time)<input type="number" id="ck_whl" min="1" max="60" value="${esc(d.weekly_hours_limit)}"></label>` : ""}
    ${type === "qual" && admin ? `<label class="fld" for="ck_lvl">Level<select id="ck_lvl">${[[0, "Not relevant / below Level 2"], [2, "Level 2"], [3, "Level 3 (full and relevant)"], [6, "Level 6 / QTS / EYTS"]].map(([v, l]) => `<option value="${v}" ${(user?.qual_level || 0) === v ? "selected" : ""}>${l}</option>`).join("")}</select></label>` : ""}
  </div>
  ${type === "dbs" ? `<label class="opt" for="ck_us"><input type="checkbox" id="ck_us" ${d.update_service ? "checked" : ""}><span>Subscribed to the DBS Update Service</span></label>` : ""}
  ${admin ? `<label class="fld" for="ck_st">Status<select id="ck_st">${["pending", "verified", "rejected"].map(s => `<option value="${s}" ${(c?.status || "pending") === s ? "selected" : ""}>${{ pending: "Awaiting check", verified: "Verified (I've seen the original or checked online)", rejected: "Rejected" }[s]}</option>`).join("")}</select></label>` : ""}
  <label class="fld" for="ck_notes">${admin ? "Notes (shown to the worker if rejected)" : "Notes for RSS"}<textarea id="ck_notes" class="plain" style="max-width:none">${esc(c?.notes)}</textarea></label>
  <p class="err" id="ck_err" role="alert"></p>
  <div class="row" style="margin-top:0"><button class="btn" type="submit" id="ck_save">Save</button></div>
  </form>
  <h3>Documents</h3>
  <div id="ck_docs" class="doclist"><span class="note">Loading…</span></div>
  <label class="fld" for="ck_file">Add a photo or PDF (max 1.8 MB)<input type="file" id="ck_file" accept="image/jpeg,image/png,image/webp,application/pdf"></label>
  <p class="err" id="ck_ferr" role="alert"></p>
  ${c?.verified_by ? `<p class="note">Verified by ${esc(c.verified_by)} on ${fullDate(c.verified_at)}.</p>` : ""}`;
}
async function shrinkImage(file) {
  if (!file.type.startsWith("image/") || file.size < 900_000) return file;
  const img = await createImageBitmap(file);
  const scale = Math.min(1, 2000 / Math.max(img.width, img.height));
  const cv = document.createElement("canvas"); cv.width = Math.round(img.width * scale); cv.height = Math.round(img.height * scale);
  cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
  return await new Promise(r => cv.toBlob(b => r(new File([b], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" })), "image/jpeg", 0.82));
}
function wireCheckForm(root, email, type, admin, after) {
  const base = `/api/staff/${encodeURIComponent(email)}/checks/${type}`;
  const loadDocs = async () => {
    const docs = await api(base + "/documents");
    root.querySelector("#ck_docs").innerHTML = docs.length ? docs.map(d => `<div><a href="/api/documents/${d.id}" target="_blank" rel="noopener">${esc(d.filename)}</a> <span class="note">${(d.size / 1024).toFixed(0)} KB · ${fullDate(d.uploaded_at)}</span>
      ${admin ? `<button class="link-btn danger" data-deldoc="${d.id}">Delete</button>` : ""}</div>`).join("") : `<span class="note">No documents yet.</span>`;
    root.querySelectorAll("[data-deldoc]").forEach(b => b.onclick = async () => {
      if (!b.dataset.armed) { b.dataset.armed = 1; b.textContent = "Click again to delete"; return; }
      await act(b, async () => { await api("/api/documents/" + b.dataset.deldoc, { method: "DELETE" }); await loadDocs(); });
    });
  };
  loadDocs().catch(e => root.querySelector("#ck_docs").textContent = e.message);
  const iss = root.querySelector("#ck_iss"), exp = root.querySelector("#ck_exp"), yrs = me.checkTypes[type].years;
  if (iss && exp && yrs) iss.addEventListener("change", () => {
    if (!iss.value) { exp.value = ""; return; }
    const d = new Date(iss.value + "T12:00:00Z"); d.setUTCFullYear(d.getUTCFullYear() + yrs); exp.value = d.toISOString().slice(0, 10);
  });
  root.querySelector("#ckf").onsubmit = async e => {
    e.preventDefault();
    const g = id => root.querySelector("#" + id);
    const b = { ref: g("ck_ref").value, notes: g("ck_notes").value };
    if (g("ck_iss")) b.issued_on = g("ck_iss").value;
    if (g("ck_exp")) b.expires_on = g("ck_exp").value;
    if (g("ck_lsc")) b.last_status_check = g("ck_lsc").value;
    if (g("ck_dt")) { b.dbs_type = g("ck_dt").value; b.update_service = g("ck_us").checked; b.update_service_no = g("ck_usn").value; }
    if (g("ck_rm")) { b.rtw_method = g("ck_rm").value; b.check_date = g("ck_cd").value; b.check_ref = g("ck_cr").value; }
    if (g("ck_whl")) b.weekly_hours_limit = g("ck_whl").value;
    if (g("ck_lvl")) b.qual_level = Number(g("ck_lvl").value);
    if (g("ck_st")) b.status = g("ck_st").value;
    const ok = await act(g("ck_save"), () => api(base, { method: "PUT", body: b }), g("ck_err"));
    if (ok) { toast("Saved"); after && after(); }
  };
  root.querySelector("#ck_file").onchange = async e => {
    const f = e.target.files[0]; if (!f) return; const err = root.querySelector("#ck_ferr"); err.textContent = "Uploading…";
    try {
      const file = await shrinkImage(f);
      await api(base + "/documents", { method: "POST", body: file, headers: { "content-type": file.type, "x-filename": encodeURIComponent(file.name) } });
      err.textContent = ""; e.target.value = ""; toast("Uploaded"); await loadDocs(); after && after(true);
    } catch (x) { err.textContent = x.message; }
  };
}

function checkRows(checks, btn) {
  const row = ([k, def]) => `<div class="check-row"><div><b>${esc(def.label)}</b>${def.required ? "" : ` <span class="note">(optional, needed for some shifts)</span>`}<div>${checkStatusPill(checks[k], def, me.today)}${checks[k]?.docs ? ` <span class="note">${checks[k].docs} document${checks[k].docs > 1 ? "s" : ""}</span>` : ""}</div></div>${btn(k)}</div>`;
  const all = Object.entries(me.checkTypes);
  return `<h3>Vetting checks</h3>${all.filter(([, d]) => d.group === "vetting").map(row).join("")}
    <h3>Core training (required)</h3>${all.filter(([, d]) => d.core).map(row).join("")}
    <h3>Qualifications &amp; other training</h3>${all.filter(([, d]) => d.group === "training" && !d.core).map(row).join("")}`;
}
// Headshot: shown to RSS and to nurseries the person is booked with, so the nursery can confirm who arrives.
const initials = n => String(n || "?").split(/\s+/).map(w => w[0]).slice(0, 2).join("").toUpperCase();
const avatar = (src, name, size = 56) => src ? `<img src="${esc(src)}" alt="Photo of ${esc(name)}" class="avatar" style="width:${size}px;height:${size}px" onerror="this.outerHTML='<span class=&quot;avatar ph&quot; style=&quot;width:${size}px;height:${size}px;font-size:${Math.round(size / 2.6)}px&quot;>${esc(initials(name))}</span>'">`
  : `<span class="avatar ph" style="width:${size}px;height:${size}px;font-size:${Math.round(size / 2.6)}px" aria-hidden="true">${esc(String(name || "?").split(/\s+/).map(w => w[0]).slice(0, 2).join("").toUpperCase())}</span>`;
function photoBlock(email, name, has, canEdit, after) {
  const src = has ? `/api/photo/${encodeURIComponent(email)}?v=${Date.now()}` : null;
  return `<div class="photo-row">${avatar(src, name, 88)}<div>${canEdit ? `<label class="btn ghost sm" for="ph_file" style="cursor:pointer">${has ? "Change photo" : "Add headshot"}</label><input type="file" id="ph_file" accept="image/*" capture="user" hidden>
    ${has ? `<button class="link-btn danger" id="ph_del">Remove</button>` : ""}<div class="note">A clear, recent head-and-shoulders photo. Nurseries see it on the day so they know who to expect.</div><p class="err" id="ph_err"></p>` : ""}</div></div>`;
}
function wirePhoto(root, email, after) {
  const f = root.querySelector("#ph_file"); if (!f) return;
  f.onchange = async () => {
    const file = f.files[0]; if (!file) return; const err = root.querySelector("#ph_err"); err.textContent = "Uploading…";
    try {
      const img = await createImageBitmap(file), side = Math.min(img.width, img.height), cv = document.createElement("canvas"); cv.width = cv.height = 480;
      cv.getContext("2d").drawImage(img, (img.width - side) / 2, Math.max(0, (img.height - side) / 3), side, side, 0, 0, 480, 480);
      const blob = await new Promise(r => cv.toBlob(r, "image/jpeg", 0.85));
      await api(`/api/photo/${encodeURIComponent(email)}`, { method: "PUT", body: blob, headers: { "content-type": "image/jpeg" } });
      toast("Photo saved"); after();
    } catch (e) { err.textContent = e.message || "Couldn't read that photo. Try a JPG or PNG."; }
  };
  const d = root.querySelector("#ph_del"); if (d) d.onclick = async () => { if (await act(d, () => api(`/api/photo/${encodeURIComponent(email)}`, { method: "DELETE" }))) { toast("Photo removed"); after(); } };
}
const QSTAT = { completed: ["Completed", "ok"], in_progress: ["In progress", "info"] };
function qualRows(quals, canEdit) {
  return `<h3>Academic &amp; professional qualifications</h3>${quals.length ? quals.map(q => `<div class="check-row"><div><b>${esc(q.level)} ${esc(q.subject)}</b>
    <div class="note">${esc(q.institution || "")}${q.year ? (q.institution ? " · " : "") + (q.status === "completed" ? "Completed " : "Expected ") + esc(q.year) : ""}</div>
    <div>${pill(QSTAT[q.status])} ${q.verified ? pill(["Checked by RSS", "ok"]) : pill(["Not yet checked", ""])}</div></div>
    ${canEdit ? `<button class="btn ghost sm" data-qual="${q.id}">Edit</button>` : ""}</div>`).join("") : `<p class="empty">None added yet.</p>`}
    ${canEdit ? `<button class="btn ghost sm" data-qual="new">+ Add qualification</button>` : ""}`;
}
function qualDrawer(email, q, admin, after) {
  q = q || { status: "completed" };
  openDrawer(`<p class="eyebrow">Qualification</p><h2>${q.id ? "Edit qualification" : "Add a qualification"}</h2>
  <div class="form-grid">
    <label class="fld" for="q_lvl">Level<select id="q_lvl"><option value="">Choose…</option>${me.qualLevels.map(l => `<option ${q.level === l ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></label>
    <label class="fld" for="q_sub">Subject<input type="text" id="q_sub" value="${esc(q.subject)}" placeholder="e.g. Early Childhood Studies"></label>
    <label class="fld" for="q_inst">University / college<input type="text" id="q_inst" value="${esc(q.institution)}"></label>
    <label class="fld" for="q_st">Status<select id="q_st"><option value="completed" ${q.status === "completed" ? "selected" : ""}>Completed</option><option value="in_progress" ${q.status === "in_progress" ? "selected" : ""}>In progress (studying now)</option></select></label>
    <label class="fld" for="q_yr"><span id="q_yrl">${q.status === "in_progress" ? "Expected completion year" : "Year completed"}</span><input type="text" id="q_yr" inputmode="numeric" maxlength="4" value="${esc(q.year)}" placeholder="2025"></label>
  </div>
  ${admin ? `<label class="opt" for="q_ver"><input type="checkbox" id="q_ver" ${q.verified ? "checked" : ""}><span>I've seen the certificate or proof of enrolment</span></label>` : `<p class="note">RSS will check your certificate or proof of enrolment. Upload it under Childcare qualification if you're asked to.</p>`}
  <p class="err" id="q_err"></p><div class="row"><button class="btn" id="q_go">Save</button>${q.id ? `<button class="link-btn danger" id="q_del">Remove</button>` : ""}</div>`, root => {
    const g = id => root.querySelector("#" + id);
    g("q_st").onchange = () => g("q_yrl").textContent = g("q_st").value === "in_progress" ? "Expected completion year" : "Year completed";
    g("q_go").onclick = async () => {
      const b = { level: g("q_lvl").value, subject: g("q_sub").value, institution: g("q_inst").value, status: g("q_st").value, year: g("q_yr").value, verified: admin ? g("q_ver").checked : false };
      const path = q.id ? `/api/quals/${q.id}` : `/api/staff/${encodeURIComponent(email)}/quals`;
      if (await act(g("q_go"), () => api(path, { method: q.id ? "PUT" : "POST", body: b }), g("q_err"))) { toast("Saved"); after(); }
    };
    if (g("q_del")) g("q_del").onclick = async () => {
      const d = g("q_del"); if (!d.dataset.armed) { d.dataset.armed = 1; d.textContent = "Click again to remove"; return; }
      if (await act(d, () => api(`/api/quals/${q.id}`, { method: "DELETE" }), g("q_err"))) { toast("Removed"); after(); }
    };
  });
}

/* ---------- terms of engagement + Key Information Document ---------- */
// Small, safe Markdown renderer for the agreement texts (escape first, then add formatting).
function md(src) {
  const inline = s => esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/(^|[^*])\*([^*\s][^*]*?)\*(?!\*)/g, "$1<i>$2</i>");
  const lines = String(src || "").replace(/\r/g, "").split("\n"), out = [];
  for (let i = 0; i < lines.length;) {
    const l = lines[i];
    if (!l.trim()) { i++; continue; }
    let h = /^(#{1,3})\s+(.*)$/.exec(l);
    if (h) { const n = h[1].length + 1; out.push(`<h${n}>${inline(h[2])}</h${n}>`); i++; continue; }
    if (/^-{3,}\s*$/.test(l)) { out.push("<hr>"); i++; continue; }
    if (/^\s*[-*]\s+/.test(l)) { const items = []; while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) items.push(`<li>${inline(lines[i++].replace(/^\s*[-*]\s+/, ""))}</li>`); out.push(`<ul>${items.join("")}</ul>`); continue; }
    if (/^\s*\|/.test(l)) {
      const rows = []; while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(lines[i++]);
      const cells = r => r.trim().replace(/^\||\|$/g, "").split("|").map(c => c.trim());
      const isSep = r => /^\s*\|[\s:|-]+\|\s*$/.test(r) && r.includes("-");
      const hasHead = rows.length > 1 && isSep(rows[1]) && !isSep(rows[0]);
      const body = rows.filter(r => !isSep(r)).map(cells);
      let head = hasHead ? body.shift() : null; if (head && !head.some(Boolean)) head = null;
      out.push(`<div class="tbl"><table>${head ? `<thead><tr>${head.map(c => `<th>${inline(c)}</th>`).join("")}</tr></thead>` : ""}<tbody>${body.map(r => `<tr>${r.map(c => `<td>${inline(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`);
      continue;
    }
    const para = []; while (i < lines.length && lines[i].trim() && !/^(#{1,3}\s|\s*[-*]\s|\s*\||-{3,}\s*$)/.test(lines[i])) para.push(lines[i++]);
    out.push(`<p>${inline(para.join(" "))}</p>`);
  }
  return out.join("");
}
const fullDateTime = iso => iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" }) : "";
// Printable record of a signed agreement: the exact text signed, plus who signed, when and from where.
function signedRecordHtml(r) {
  return `<div class="no-print row" style="margin:0 0 12px"><button class="btn" onclick="window.print()">Print or save as PDF</button></div>
  <div class="agreement-doc"><div class="sig-box"><b>Signed electronically in the RSS Hub</b>
    <div>Name typed: <b>${esc(r.typed_name)}</b> (${esc(r.name || "")}, ${esc(r.email)})</div>
    <div>Key Information Document received: ${fullDateTime(r.kid_ack_at)}</div>
    <div>Terms signed: ${fullDateTime(r.signed_at)} (UK time) · Version ${r.version}</div>
    ${r.ip ? `<div class="note">IP address ${esc(r.ip)} · Fingerprint ${esc((r.terms_sha256 || "").slice(0, 16))}</div>` : ""}</div>
  ${md(r.kid_md)}<hr class="page-break">${md(r.terms_md)}</div>`;
}
async function openSignedRecord(email, back) {
  openDrawer(`<p class="loading">Loading…</p>`);
  try {
    const r = await api(`/api/agreement/signature/${encodeURIComponent(email)}`);
    setDrawer((back ? `<button class="link-btn no-print" id="back">← Back</button>` : "") + signedRecordHtml(r), root => { if (back) root.querySelector("#back").onclick = back; });
  } catch (e) { setDrawer(`<p class="err">${esc(e.message)}</p>`); }
}
// Staff: read the Key Information Document, confirm receipt, then read and sign the terms.
async function agreementView() {
  const a = await api("/api/agreement");
  const backBtn = `<button class="link-btn" id="ag_back">← Back to My checks</button>`;
  if (!a.version) { $("#app").innerHTML = `<div class="panel">${backBtn}<p>RSS hasn't published its terms in the hub yet.</p></div>`; $("#ag_back").onclick = () => go("checks"); return; }
  const signed = a.mine?.signed_at, kidDone = !!a.mine?.kid_ack_at;
  $("#app").innerHTML = `<div class="panel agreement">${backBtn}
    <p class="eyebrow">Your agreement with RSS · Version ${a.version}</p>
    <h2>${signed ? "Your signed terms" : "Read and sign your terms"}</h2>
    ${signed ? `<div class="callout exp"><b>You signed these terms on ${fullDateTime(a.mine.signed_at)}.</b> <button class="link-btn" id="ag_rec">View or print your signed copy</button></div>`
      : `<div class="ag-steps"><span class="${kidDone ? "done" : "now"}">${kidDone ? "✓" : "1."} Read your Key Information Document</span><span class="${kidDone ? "now" : ""}">2. Read and sign the Terms of Engagement</span></div>
         ${a.last_signed ? `<div class="callout">RSS has updated its terms since you signed version ${a.last_signed.version}. Please read and sign the new version.${a.note ? ` <b>What changed:</b> ${esc(a.note)}` : ""}</div>` : ""}`}
    <details class="doc-fold" ${signed || kidDone ? "" : "open"}><summary><b>Step 1: Key Information Document</b>${kidDone ? ` · received ${fullDateTime(a.mine.kid_ack_at)}` : ""}</summary><div class="agreement-doc">${md(a.kid_md)}</div></details>
    ${!signed && !kidDone ? `<label class="opt" for="ag_kid"><input type="checkbox" id="ag_kid"><span>I confirm I have received and read my Key Information Document.</span></label>
      <p class="err" id="ag_e1"></p><div class="row"><button class="btn" id="ag_kidgo">Continue to the terms</button></div>` : ""}
    ${kidDone || signed ? `<details class="doc-fold" ${signed ? "" : "open"}><summary><b>Step 2: Terms of Engagement</b></summary><div class="agreement-doc">${md(a.terms_md)}</div></details>` : ""}
    ${kidDone && !signed ? `<div class="sign-panel"><h3>Sign</h3>
      <label class="opt" for="ag_ok"><input type="checkbox" id="ag_ok"><span>I have read and understood these Terms of Engagement and I agree to them. The information I have given RSS is true and complete.</span></label>
      <label class="fld" for="ag_name">Type your full name to sign<input type="text" id="ag_name" autocomplete="name" placeholder="${esc(me.name)}" style="max-width:none"></label>
      <p class="note">Typing your name here is your signature. RSS records the date, time and device it was signed from.</p>
      <p class="err" id="ag_e2" role="alert"></p><div class="row"><button class="btn" id="ag_sign">Sign the terms</button></div></div>` : ""}
  </div>`;
  $("#ag_back").onclick = () => go("checks");
  if ($("#ag_rec")) $("#ag_rec").onclick = () => openSignedRecord(me.email);
  if ($("#ag_kidgo")) $("#ag_kidgo").onclick = async () => {
    if (!$("#ag_kid").checked) { $("#ag_e1").textContent = "Tick the box to confirm you've read it."; return; }
    if (await act($("#ag_kidgo"), () => api("/api/agreement/kid-ack", { method: "POST", body: { version: a.version } }), $("#ag_e1"))) { await agreementView(); $(".sign-panel")?.scrollIntoView({ block: "nearest" }); }
  };
  if ($("#ag_sign")) $("#ag_sign").onclick = async () => {
    if (await act($("#ag_sign"), () => api("/api/agreement/sign", { method: "POST", body: { version: a.version, agree: $("#ag_ok").checked, typed_name: $("#ag_name").value } }), $("#ag_e2"))) {
      toast("Signed. Thank you."); me = await api("/api/me"); await agreementView(); scrollTo({ top: 0 });
    }
  };
}

/* =====================================================================
   STAFF
   ===================================================================== */
const STAFF = {
  training: () => trainingStaff(),
  async shifts() {
    const [open, mine] = await Promise.all([api("/api/open-shifts"), api(`/api/shifts?from=${me.today}`)]);
    const upcoming = mine.filter(s => s.status === "filled"), toConfirm = mine.filter(s => s.status === "pending");
    $("#app").innerHTML = `
    ${expiringHtml(me.expiring)}
    ${toConfirm.length ? `<div class="section-h"><h2>Please confirm</h2></div><p class="note" style="margin-top:-6px">RSS has asked you to work these shifts. Accept or decline so the nursery knows.</p>
    <div class="cards">${toConfirm.map(s => `<div class="card attn"><div class="section-h" style="margin:0"><h4>${esc(s.client_name)}</h4>${shiftWhen(s)}</div>
      <div class="meta">${shiftReqs(s)} · ${hrs(s.mins)}</div>${s.notes ? `<div class="note">${esc(s.notes)}</div>` : ""}
      <div class="row" style="margin-top:6px"><button class="btn sm" data-confirm="${s.id}">Accept</button><button class="btn ghost sm" data-decline="${s.id}">Decline</button><span class="err" id="ce${s.id}"></span></div></div>`).join("")}</div>` : ""}
    ${me.blockers.length ? outstandingHtml(me.blockers, true) : ""}
    <div class="section-h"><h2>Shifts you can take</h2></div>
    <div class="cards">${open.length ? open.map(s => `<div class="card ${s.blockers.length ? "" : "attn"}">
      <div class="section-h" style="margin:0"><h4>${esc(s.client_name)}</h4>${shiftWhen(s)}</div>
      <div class="meta">${shiftReqs(s)} · ${hrs(s.mins)}</div>${s.notes ? `<div class="note">${esc(s.notes)}</div>` : ""}
      ${s.blockers.length ? `<div class="note" style="color:var(--bad);font-weight:600">You can't take this shift yet:</div><ul class="blk">${s.blockers.map(b => `<li>${esc(b)}</li>`).join("")}</ul>` : `<div class="row" style="margin-top:6px"><button class="btn sm" data-accept="${s.id}">Accept this shift</button><span class="err" id="ae${s.id}"></span></div>`}
    </div>`).join("") : `<p class="empty">No open shifts right now. New shifts appear here as soon as RSS offers them.</p>`}</div>
    <div class="section-h" style="margin-top:28px"><h2>Your upcoming shifts</h2></div>
    ${upcoming.length && !me.has_pin ? `<div class="callout"><b>Set your sign-in PIN.</b> You'll type it on the nursery's sign-in iPad when you arrive and leave. <button class="btn sm" id="setPin">Set PIN</button></div>` : ""}
    <div class="cards">${upcoming.length ? upcoming.map(s => `<div class="card ok"><div class="section-h" style="margin:0"><h4>${esc(s.client_name)}</h4>${shiftWhen(s)}</div>
      <div class="meta">${clockPill(s)}${shiftReqs(s)} · ${hrs(s.mins)} · Pay ${gbp(s.pay_rate)}/h</div>${s.notes ? `<div class="note">${esc(s.notes)}</div>` : ""}${phoneClockHtml(s)}</div>`).join("") : `<p class="empty">Nothing booked yet.</p>`}</div>
    <p class="note" style="margin-top:20px">Can't make a booked shift? Call RSS straight away. Don't contact the nursery's parent line or just not turn up.</p>`;
    wireOutstanding(); wirePhoneClock(); wirePinRow();
    $$("[data-confirm]").forEach(b => b.onclick = async () => {
      if (await act(b, () => api(`/api/shifts/${b.dataset.confirm}/accept`, { method: "POST", body: {} }), $("#ce" + b.dataset.confirm))) { toast("Confirmed. The nursery can now see you're coming."); render(); }
    });
    $$("[data-decline]").forEach(b => b.onclick = () => {
      const s = toConfirm.find(x => x.id == b.dataset.decline);
      openDrawer(`<p class="eyebrow">Decline shift</p><h2>${esc(s.client_name)}</h2><p>${shiftWhen(s)}</p>
        <label class="fld" for="dc_r">Reason (optional, helps RSS rebook)<input type="text" id="dc_r" style="max-width:none" placeholder="e.g. Lecture that morning"></label>
        <p class="err" id="dc_e"></p><div class="row"><button class="btn warn" id="dc_go">Decline this shift</button></div>`, root => {
        root.querySelector("#dc_go").onclick = async () => { if (await act(root.querySelector("#dc_go"), () => api(`/api/shifts/${s.id}/decline`, { method: "POST", body: { reason: fieldVal(root, "dc_r") } }), root.querySelector("#dc_e"))) { closeDrawer(); toast("Declined. RSS will find someone else."); render(); } };
      });
    });
    $$("[data-accept]").forEach(b => b.onclick = async () => {
      const ok = await act(b, () => api(`/api/shifts/${b.dataset.accept}/accept`, { method: "POST", body: {} }), $("#ae" + b.dataset.accept));
      if (ok) { toast("Shift booked. It's in your upcoming shifts."); render(); }
    });
  },
  async hours() {
    const all = await api(`/api/shifts?from=${shiftBack(60)}&to=${me.today}`);
    const past = all.filter(s => s.status === "filled").reverse();
    const todo = past.filter(s => s.ts_status === "none" || s.ts_status === "queried");
    $("#app").innerHTML = `<div class="section-h"><h2>Hours to submit</h2></div>
    <div class="cards">${todo.length ? todo.map(s => `<div class="card ${s.ts_status === "queried" ? "bad" : "attn"}"><div class="section-h" style="margin:0"><h4>${esc(s.client_name)}</h4>${shiftWhen(s)}</div>
      ${s.ts_status === "queried" ? `<div><b>The nursery queried your hours:</b> ${esc(s.ts_comment)}</div>` : ""}
      <div class="row" style="margin-top:4px"><button class="btn sm" data-ts="${s.id}">Submit hours</button></div></div>`).join("") : `<p class="empty">You're all up to date.</p>`}</div>
    <div class="section-h" style="margin-top:28px"><h2>Last 60 days</h2></div>
    <div class="tbl"><table><thead><tr><th>Date</th><th>Nursery</th><th>Hours</th><th>Status</th></tr></thead><tbody>
    ${past.map(s => `<tr><td class="n">${dayName(s.date)}</td><td>${esc(s.client_name)}</td><td class="n">${s.actMins != null ? hrs(s.actMins) : "–"}</td><td>${TS[s.ts_status] ? pill(TS[s.ts_status]) : pill(["Not submitted", ""])}</td></tr>`).join("") || `<tr><td colspan="4" class="empty">No shifts yet.</td></tr>`}</tbody></table></div>`;
    $$("[data-ts]").forEach(b => b.onclick = () => timesheetDrawer(past.find(s => s.id == b.dataset.ts)));
  },
  async checks() {
    me = await api("/api/me");
    const t = me.training || {};
    $("#app").innerHTML = `<div class="panel"><p class="eyebrow">My checks</p>${photoBlock(me.email, me.name, me.has_photo, true)}<h2>${me.blockers.length ? "Not ready to book yet" : "Ready to work"}</h2>
    ${me.blockers.length ? outstandingHtml(me.blockers, false) : `<p class="note">All required checks and training are verified. Keep your certificates in date so you can keep picking up shifts.</p>`}
    <div class="check-row"><div><b>Childcare 101 training</b><div class="note">${t.passed ? `${t.passed} of ${t.total} modules passed${t.declaredAt ? ", declaration signed" : ""}` : "Not started yet. It takes about 3 hours, and you can stop and carry on any time."}</div></div>
      ${t.complete ? `<button class="btn ghost sm" id="toTraining2">View certificate</button>` : `<button class="btn sm" id="toTraining2">${t.passed ? "Carry on" : "Start training"}</button>`}</div>
    ${pinRowHtml()}
    ${expiringHtml(me.expiring)}
    ${checkRows(me.checks, k => k === "terms" ? `<button class="btn ${me.checks.terms?.status === "verified" ? "ghost " : ""}sm" id="toTerms2">${me.checks.terms?.status === "verified" ? "View signed terms" : "Read and sign"}</button>` : `<button class="btn ghost sm" data-ck="${k}">${me.checks[k] ? "View / update" : "Add"}</button>`)}
    ${qualRows(me.quals, true)}</div>`;
    wirePhoto($("#app"), me.email, () => render());
    wireOutstanding(); $("#toTerms2").onclick = () => go("terms");
    wirePinRow();
    $("#toTraining2").onclick = () => { T.sub = t.complete ? "cert" : "learn"; go("training"); };
    $$("[data-qual]").forEach(b => b.onclick = () => qualDrawer(me.email, me.quals.find(q => q.id == b.dataset.qual), false, () => { closeDrawer(); render(); }));
    $$("[data-ck]").forEach(b => b.onclick = () => openDrawer(checkForm(me.email, b.dataset.ck, me.checks[b.dataset.ck], false), root => wireCheckForm(root, me.email, b.dataset.ck, false, () => { closeDrawer(); render(); })));
  },
  terms: agreementView,
};
function shiftBack(n) { const d = new Date(me.today + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); }
function timesheetDrawer(s) {
  openDrawer(`<p class="eyebrow">Submit hours</p><h2>${esc(s.client_name)}</h2><p>${shiftWhen(s)} <span class="note">(booked ${s.start}–${s.finish}, ${s.break_min} min break)</span></p>
  <form id="tsf"><div class="form-grid">
    <label class="fld" for="ts_s">Actual start<input type="time" id="ts_s" value="${s.act_start || s.start}" required></label>
    <label class="fld" for="ts_f">Actual finish<input type="time" id="ts_f" value="${s.act_finish || s.finish}" required></label>
    <label class="fld" for="ts_b">Break taken (minutes)<input type="number" id="ts_b" min="0" max="240" value="${s.act_break ?? s.break_min}"></label>
  </div>
  <label class="fld" for="ts_c">Anything the nursery should know? (optional)<input type="text" id="ts_c" style="max-width:none"></label>
  <p class="note" id="ts_tot"></p><p class="err" id="ts_err"></p>
  <div class="row"><button class="btn" id="ts_go">Send to the nursery for sign-off</button></div></form>`, root => {
    const upd = () => { try { const m = minsBetween(root.querySelector("#ts_s").value, root.querySelector("#ts_f").value, +root.querySelector("#ts_b").value); root.querySelector("#ts_tot").textContent = m > 0 ? `That's ${hrs(m)}.` : ""; } catch {} };
    root.querySelectorAll("input").forEach(i => i.oninput = upd); upd();
    root.querySelector("#tsf").onsubmit = async e => {
      e.preventDefault();
      const ok = await act(root.querySelector("#ts_go"), () => api(`/api/shifts/${s.id}/timesheet`, { method: "POST", body: { start: fieldVal(root, "ts_s"), finish: fieldVal(root, "ts_f"), break_min: fieldVal(root, "ts_b"), comment: fieldVal(root, "ts_c") } }), root.querySelector("#ts_err"));
      if (ok) { closeDrawer(); toast("Hours sent for sign-off"); render(); }
    };
  });
}

/* =====================================================================
   NURSERY MANAGER
   ===================================================================== */
function assuranceHtml(a) {
  if (!a) return "";
  const yes = (ok, t) => `<span class="pill ${ok ? "ok" : "bad"}">${t}</span>`;
  const top = a.quals?.find(q => q.status === "completed") || a.quals?.[0];
  return `<div class="meta" style="gap:6px">${yes(!!a.dbs, a.dbs ? `Enhanced DBS ✓${a.dbs.update_service ? " (Update Service)" : ""}` : "DBS not verified")}
    ${yes(a.rtw, "Right to work")} ${yes(a.refs, "2 references")} ${yes(a.id, "ID seen")} ${yes(a.childcare101, "RSS Childcare 101")}
    ${a.qual_level ? `<span class="pill info">Childcare Level ${a.qual_level}</span>` : `<span class="pill">No childcare qualification</span>`}
    ${a.pfa_expires ? `<span class="pill ok">Paediatric first aid${a.pfa_expires !== "verified" ? " to " + fullDate(a.pfa_expires) : ""}</span>` : `<span class="pill">No PFA</span>`}
    ${top ? `<span class="pill info">${esc(top.level)} ${esc(top.subject)}${top.status === "in_progress" ? " (in progress)" : ""}</span>` : ""}</div>`;
}
// Agency Staff Profile: the document a nursery keeps for its records (single central record), laid out like
// RSS's previous paper profile. Prints / saves as PDF from the browser.
function agencyProfileHtml(a) {
  const ag = me.agency || {}, d = s => s ? new Date(s + "T12:00:00Z").toLocaleDateString("en-GB", { timeZone: "UTC" }) : "–";
  const rowsT = [];
  rowsT.push([`RSS Childcare 101 induction`, a.childcare101 ? "Completed" : "Not completed", a.childcare101_at ? d(a.childcare101_at.slice(0, 10)) : ""]);
  for (const t of a.training) { const exp = t.expires && t.expires < me.today; rowsT.push([esc(t.label), exp ? "Expired" : "Completed", t.expires ? (exp ? "Expired on " : "Valid to ") + d(t.expires) : ""]); }
  if (a.qual_level) rowsT.push([`Childcare qualification: Level ${a.qual_level}${a.qual_title ? " " + esc(a.qual_title) : ""}`, "Completed", ""]);
  for (const q of a.quals) rowsT.push([`${esc(q.level)} ${esc(q.subject)}${q.institution ? ", " + esc(q.institution) : ""}`, q.status === "completed" ? "Completed" : "Ongoing", q.year ? (q.status === "completed" ? q.year : "Expected " + q.year) : ""]);
  return `<div class="no-print row" style="margin:0 0 12px"><button class="btn" onclick="window.print()">Print or save as PDF</button></div>
  <article class="agency-profile">
    <header class="ap-head"><img src="/rss-logo.png" alt="Resourceful Staffing Support logo" class="ap-logo"><h2>AGENCY STAFF PROFILE</h2>
      <address>${esc(ag.address || "").replace(/,\s*/g, "<br>")}${ag.phone ? "<br>" + esc(ag.phone) : ""}</address></header>
    <div class="ap-bar">CANDIDATE INFORMATION</div>
    <div class="ap-cand"><table class="ap-t"><tbody>
      <tr><td>Candidate name</td><td>${esc(a.name)}</td></tr>
      <tr><td>DBS number</td><td>${esc(a.dbs?.number || "–")}</td></tr>
      <tr><td>DBS issue date</td><td>${d(a.dbs?.issued)}</td></tr>
      <tr><td>DBS type</td><td>${esc(a.dbs?.type || (a.dbs ? "Enhanced" : "Not verified"))}</td></tr>
      <tr><td>Update Service #</td><td>${esc(a.dbs?.update_service_no || (a.dbs?.update_service ? "Subscribed" : "–"))}</td></tr>
    </tbody></table><div class="ap-photo">${a.photo ? `<img src="${esc(a.photo)}" alt="Photo of ${esc(a.name)}" onerror="this.replaceWith(Object.assign(document.createElement('span'),{textContent:'${esc(initials(a.name))}'}))">` : `<span>${esc(initials(a.name))}</span>`}</div></div>
    <div class="ap-bar">RIGHT TO WORK</div>
    <table class="ap-t"><tbody>
      <tr><td>Proof of right to work</td><td>${esc(a.rtw_detail?.method || (a.rtw ? "Verified" : "Not verified"))}</td></tr>
      <tr><td>Visa check date</td><td>${d(a.rtw_detail?.check_date)}</td></tr>
      <tr><td>Visa check reference</td><td>${esc(a.rtw_detail?.check_ref || "–")}</td></tr>
      ${a.rtw_detail?.expires ? `<tr><td>Permission to work until</td><td>${d(a.rtw_detail.expires)}</td></tr>` : ""}
      <tr><td>References (2) and photo ID</td><td>${a.refs && a.id ? "Verified by RSS" : "Not complete"}</td></tr>
    </tbody></table>
    <div class="ap-bar">TRAININGS / QUALIFICATIONS</div>
    <table class="ap-t ap-train"><thead><tr><th>Title</th><th>Status</th><th>Date</th></tr></thead><tbody>
      ${rowsT.map(r => `<tr><td>${r[0]}</td><td class="${r[1] === "Expired" || r[1] === "Not completed" ? "ap-bad" : ""}">${r[1]}</td><td>${r[2]}</td></tr>`).join("")}
    </tbody></table>
    <p class="ap-note">Checks verified by Resourceful Staffing Support. Original documents are held by RSS. Profile generated ${d(me.today)}.</p>
    <footer class="ap-foot">“${esc(ag.tagline || "")}”</footer>
  </article>`;
}
function profileHtml(a) {
  const row = (label, val, ok) => `<div class="check-row"><div><b>${label}</b></div>${ok === undefined ? val : pill([val, ok === "info" ? "info" : ok ? "ok" : "bad"])}</div>`;
  return `<h3>Vetting (checked by RSS)</h3>
    ${row("Enhanced DBS with children's barred list", a.dbs ? "Verified" : "Not verified", !!a.dbs)}
    ${a.dbs ? `<div class="tbl" style="margin:0 0 8px"><table><tbody>
      <tr><td>DBS number</td><td class="n">${esc(a.dbs.number || "–")}</td></tr><tr><td>DBS issue date</td><td class="n">${fullDate(a.dbs.issued) || "–"}</td></tr>
      <tr><td>DBS type</td><td>${esc(a.dbs.type || "–")}</td></tr><tr><td>Update Service number</td><td class="n">${esc(a.dbs.update_service_no || (a.dbs.update_service ? "Subscribed" : "Not subscribed"))}</td></tr></tbody></table></div>` : ""}
    ${row("Right to work", a.rtw ? "Verified" : "Not verified", a.rtw)}
    ${a.rtw_detail ? `<div class="tbl" style="margin:0 0 8px"><table><tbody>
      <tr><td>Proof of right to work</td><td>${esc(a.rtw_detail.method || "–")}</td></tr><tr><td>Visa check date</td><td class="n">${fullDate(a.rtw_detail.check_date) || "–"}</td></tr>
      <tr><td>Visa check reference</td><td class="n">${esc(a.rtw_detail.check_ref || "–")}</td></tr>${a.rtw_detail.expires ? `<tr><td>Permission ends</td><td class="n">${fullDate(a.rtw_detail.expires)}</td></tr>` : ""}</tbody></table></div>` : ""}${row("Two references", a.refs ? "Verified" : "Not verified", a.refs)}${row("Photo ID", a.id ? "Seen" : "Not seen", a.id)}
    ${row("RSS Childcare 101 induction", a.childcare101 ? "Completed" + (a.childcare101_at ? " " + fullDate(a.childcare101_at) : "") : "Not completed", a.childcare101)}
    <h3>Childcare qualification</h3>${row(a.qual_level ? `Level ${a.qual_level}${a.qual_title ? " · " + esc(a.qual_title) : ""}` : "No verified childcare qualification", "")}
    <h3>Training</h3>${a.training.length ? a.training.map(t => row(esc(t.label), t.expires ? (t.expires < me.today ? "Expired " : "Valid to ") + fullDate(t.expires) : "Verified", !t.expires || t.expires >= me.today)).join("") : `<p class="empty">No training recorded yet.</p>`}
    <h3>Academic qualifications</h3>${a.quals.length ? a.quals.map(q => row(`${esc(q.level)} ${esc(q.subject)}${q.institution ? `<div class="note">${esc(q.institution)}</div>` : ""}`, `${q.status === "completed" ? "Completed" : "In progress"}${q.year ? " " + esc(q.year) : ""}`, q.status === "completed" ? true : "info")).join("") : `<p class="empty">None recorded.</p>`}
    <p class="note">RSS keeps the documents behind these checks. Contact RSS if you need written confirmation.</p>`;
}
const MANAGER = {
  station: () => stationView(),
  async shifts() {
    const list = await api(`/api/shifts?from=${shiftBack(14)}`);
    const up = list.filter(s => s.date >= me.today && s.status !== "cancelled"), past = list.filter(s => s.date < me.today && s.status === "filled").reverse();
    $("#app").innerHTML = `<div class="section-h"><h2>Coming up at ${esc(me.client.name)}</h2><button class="btn" id="newReq">Request cover</button></div>
    <div class="cards">${up.length ? up.map(s => `<div class="card ${s.status === "filled" ? "ok" : "attn"}">
      <div class="section-h" style="margin:0">${shiftWhen(s)}<span>${pill(STATUS[s.status])} ${clockPill(s)}</span></div>
      <div class="meta">${shiftReqs(s)}</div>
      ${s.worker_name ? `<div style="display:flex;gap:12px;align-items:center">${avatar(s.assurance?.photo, s.worker_name, 52)}<div><b>${esc(s.worker_name)}</b> ${s.status === "pending" ? "has been asked and hasn't confirmed yet." : "is coming."} <button class="link-btn" data-prof="${s.id}">Full profile</button></div></div>${assuranceHtml(s.assurance)}` : `<div class="note">RSS is finding someone for this shift.</div>`}${declinedHtml(s)}
      <div class="row" style="margin-top:4px"><button class="link-btn danger" data-cancel="${s.id}">Cancel this shift</button></div></div>`).join("") : `<p class="empty">No cover booked. Use Request cover when you need someone.</p>`}</div>
    <div class="section-h" style="margin-top:28px"><h2>Last two weeks</h2></div>
    <div class="tbl"><table><thead><tr><th>Date</th><th>Worker</th><th>Hours</th><th>Timesheet</th></tr></thead><tbody>
    ${past.map(s => `<tr><td class="n">${dayName(s.date)}</td><td>${esc(s.worker_name)}</td><td class="n">${s.actMins != null ? hrs(s.actMins) : "–"}</td><td>${TS[s.ts_status] ? pill(TS[s.ts_status]) : pill(["Not submitted yet", ""])}</td></tr>`).join("") || `<tr><td colspan="4" class="empty">Nothing yet.</td></tr>`}</tbody></table></div>`;
    $("#newReq").onclick = () => go("request");
    $$("[data-prof]").forEach(b => b.onclick = () => { const s = up.find(x => x.id == b.dataset.prof); openDrawer(agencyProfileHtml(s.assurance)); });
    $$("[data-cancel]").forEach(b => b.onclick = () => cancelShift(b.dataset.cancel, b));
  },
  async request() {
    $("#app").innerHTML = `<div class="panel" style="max-width:720px"><p class="eyebrow">${esc(me.client.name)}</p><h2>Request cover</h2>
    <p class="note">RSS only books people whose DBS, right to work, references and RSS training are verified. Tick the boxes if the shift needs more.</p>
    ${shiftFormHtml({ date: me.today, start: "08:00", finish: "18:00", break_min: 60 }, { count: true })}
    <p class="err" id="sf_err"></p><div class="row"><button class="btn" id="sf_go">Send request to RSS</button></div></div>`;
    $("#sf_go").onclick = async () => {
      const ok = await act($("#sf_go"), () => api("/api/shifts", { method: "POST", body: readShiftForm($("#app")) }), $("#sf_err"));
      if (ok) { toast("Request sent to RSS"); go("shifts"); }
    };
  },
  async hours() { await signOffList(`/api/shifts?from=${shiftBack(90)}&to=${me.today}`); },
  async staff() {
    const list = await api("/api/our-staff");
    $("#app").innerHTML = `<div class="section-h"><h2>RSS staff at ${esc(me.client.name)}</h2></div>
    <p class="note" style="margin-top:-6px">Everyone RSS has booked with you in the last 6 months or coming up, with their checks, qualifications and training.</p>
    <div class="cards">${list.length ? list.map((a, i) => `<div class="card"><div class="section-h" style="margin:0"><div style="display:flex;gap:12px;align-items:center">${avatar(a.photo, a.name, 52)}<h4>${esc(a.name)}</h4></div><span class="note">${a.next_date ? "Next: " + dayName(a.next_date) : a.last_date ? "Last: " + dayName(a.last_date) : ""}</span></div>
      ${assuranceHtml(a)}<div class="row" style="margin-top:4px"><button class="btn ghost sm" data-full="${i}">Full profile</button></div></div>`).join("") : `<p class="empty">No RSS staff booked with you yet.</p>`}</div>`;
    $$("[data-full]").forEach(b => b.onclick = () => { const a = list[+b.dataset.full]; openDrawer(agencyProfileHtml(a)); });
  },
};
function shiftFormHtml(s, { count = false, clients = null } = {}) {
  return `<div class="form-grid">
    ${clients ? `<label class="fld" for="sf_c">Nursery<select id="sf_c">${clients.filter(c => c.active).map(c => `<option value="${c.id}" ${s.client_id === c.id ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select></label>` : ""}
    <label class="fld" for="sf_d">Date<input type="date" id="sf_d" value="${esc(s.date)}"></label>
    <label class="fld" for="sf_s">Start<input type="time" id="sf_s" value="${esc(s.start)}"></label>
    <label class="fld" for="sf_f">Finish<input type="time" id="sf_f" value="${esc(s.finish)}"></label>
    <label class="fld" for="sf_b">Unpaid break (minutes)<input type="number" id="sf_b" min="0" max="240" value="${s.break_min ?? 0}"></label>
    <label class="fld" for="sf_r">Room<input type="text" id="sf_r" value="${esc(s.room)}" placeholder="e.g. Baby Room (0–2)"></label>
    ${count ? `<label class="fld" for="sf_n">How many staff?<input type="number" id="sf_n" min="1" max="10" value="1"></label>` : ""}
  </div>
  <label class="opt" for="sf_l3"><input type="checkbox" id="sf_l3" ${s.needs_l3 ? "checked" : ""}><span>Needs a Level 3 practitioner (counts in ratio as qualified)</span></label>
  <label class="opt" for="sf_pfa"><input type="checkbox" id="sf_pfa" ${s.needs_pfa ? "checked" : ""}><span>Needs a valid paediatric first aid certificate</span></label>
  <label class="fld" for="sf_notes">Notes for the worker (arrival, parking, who to ask for)<textarea id="sf_notes" class="plain" style="max-width:none">${esc(s.notes)}</textarea></label>`;
}
function readShiftForm(root) {
  const g = id => root.querySelector("#" + id);
  const b = { date: g("sf_d").value, start: g("sf_s").value, finish: g("sf_f").value, break_min: g("sf_b").value, room: g("sf_r").value, needs_l3: g("sf_l3").checked, needs_pfa: g("sf_pfa").checked, notes: g("sf_notes").value };
  if (g("sf_n")) b.count = g("sf_n").value;
  if (g("sf_c")) b.client_id = g("sf_c").value;
  return b;
}
async function cancelShift(id, btn) {
  if (!btn.dataset.armed) { btn.dataset.armed = 1; btn.textContent = "Click again to cancel the shift"; return; }
  if (await act(btn, () => api(`/api/shifts/${id}/cancel`, { method: "POST", body: { reason: "Cancelled by " + me.name } }))) { toast("Shift cancelled"); closeDrawer(); render(); }
}
async function signOffList(path) {
  const list = (await api(path)).filter(s => s.ts_status === "submitted" || (isAdmin() && s.ts_status === "queried"));
  const host = isAdmin() ? $("#tsHost") : $("#app");
  host.innerHTML = `<div class="section-h"><h2>Hours waiting for sign-off</h2></div><div class="cards">${list.length ? list.map(s => `<div class="card ${s.ts_status === "queried" ? "bad" : "attn"}">
    <div class="section-h" style="margin:0"><h4>${esc(s.worker_name)}${isAdmin() ? ` · ${esc(s.client_name)}` : ""}</h4>${shiftWhen(s)}</div>
    <div>Worked <b>${s.act_start}–${s.act_finish}</b>, ${s.act_break} min break = <b>${hrs(s.actMins)}</b> <span class="note">(booked ${s.start}–${s.finish})</span></div>
    ${s.ts_comment ? `<div class="note">${s.ts_status === "queried" ? "Queried: " : "Worker's note: "}${esc(s.ts_comment)}</div>` : ""}
    <div class="row" style="margin-top:4px"><button class="btn sm" data-approve="${s.id}">Approve hours</button><button class="btn ghost sm" data-query="${s.id}">Query</button><span class="err" id="se${s.id}"></span></div></div>`).join("")
    : `<p class="empty">Nothing waiting. Hours appear here when a worker submits them.</p>`}</div>`;
  $$("[data-approve]").forEach(b => b.onclick = async () => { if (await act(b, () => api(`/api/shifts/${b.dataset.approve}/approve`, { method: "POST", body: {} }), $("#se" + b.dataset.approve))) { toast("Hours approved"); render(); } });
  $$("[data-query]").forEach(b => b.onclick = () => {
    const s = list.find(x => x.id == b.dataset.query);
    openDrawer(`<p class="eyebrow">Query hours</p><h2>${esc(s.worker_name)}</h2><p>${shiftWhen(s)}</p>
      <label class="fld" for="q_c">What's wrong with the hours?<textarea id="q_c" class="plain" style="max-width:none" placeholder="e.g. Left at 16:30, not 18:00"></textarea></label>
      <p class="err" id="q_err"></p><div class="row"><button class="btn" id="q_go">Send back to the worker</button></div>`, root => {
      root.querySelector("#q_go").onclick = async () => { if (await act(root.querySelector("#q_go"), () => api(`/api/shifts/${s.id}/query`, { method: "POST", body: { comment: fieldVal(root, "q_c") } }), root.querySelector("#q_err"))) { closeDrawer(); toast("Sent back to the worker"); render(); } };
    });
  });
}

/* =====================================================================
   RSS OFFICE
   ===================================================================== */
const ADMIN = {
  station: () => stationView(),
  training: () => trainingAdmin(),
  async today() {
    const d = await api("/api/dashboard");
    cache.counts = { shifts: d.requested + d.open + d.pending || 0, billing: d.awaiting || 0, staff: d.pendingChecks || 0 }; renderTabs(cache.counts);
    const card = (n, l, to, attn) => `<button class="stat-card ${attn && n ? "attn" : ""}" data-go="${to}"><b>${n}</b><span>${l}</span></button>`;
    $("#app").innerHTML = `<div class="stat-grid">
      ${card(d.requested, "cover requests to fill", "shifts", 1)}${card(d.open, "offered, not yet taken", "shifts", 1)}${card(d.pending, "waiting for staff to confirm", "shifts", 1)}${card(d.next7, "booked in the next 7 days", "shifts")}
      ${card(d.toSubmit, "past shifts with no hours yet", "billing", 1)}${card(d.awaiting, "hours waiting for nursery sign-off", "billing")}${card(d.queried, "hours queried", "billing", 1)}
      ${card(d.toInvoice, "approved shifts not yet invoiced", "billing", 1)}${card(d.pendingChecks, "documents waiting for your check", "staff", 1)}${card(`${d.readyCount}/${d.staffCount}`, "staff ready to book", "staff")}
    </div>
    <div class="panel" style="margin-top:24px"><div class="section-h" style="margin:0 0 8px"><h3 style="margin:0">Today's arrivals</h3><button class="btn ghost sm" id="toStation">Open a sign-in station</button></div>
      ${d.arrivals.length ? `<div class="tbl"><table><thead><tr><th>Worker</th><th>Nursery</th><th>Booked</th><th>Arrived</th><th>Left</th></tr></thead><tbody>${d.arrivals.map(a => `<tr${a.late ? ` class="late"` : ""}><td><b>${esc(a.worker_name)}</b>${a.late && a.worker_phone ? ` <a href="tel:${esc(a.worker_phone)}">Call</a>` : ""}</td><td>${esc(a.client_name)}</td><td class="n">${a.start}–${a.finish}</td>
        <td class="n">${a.clock_in_at ? ukClock(a.clock_in_at) + (a.clock_in_by === "phone" ? " 📱" : a.clock_in_by === "manager" ? " (manager)" : "") : a.late ? `<b style="color:var(--bad)">Not arrived</b>` : "–"}</td><td class="n">${a.clock_out_at ? ukClock(a.clock_out_at) : "–"}</td></tr>`).join("")}</tbody></table></div>` : `<p class="empty">Nobody is booked today.</p>`}</div>
    <div class="grid2" style="margin-top:24px">
      <div class="panel"><h3 style="margin-top:0">Not ready to book</h3>${d.notReady.length ? d.notReady.map(u => `<div class="check-row"><div><b>${esc(u.name)}</b><ul class="blk">${u.blockers.map(b => `<li>${esc(b)}</li>`).join("")}</ul></div><button class="btn ghost sm" data-staff="${esc(u.email)}">Open</button></div>`).join("") : `<p class="empty">Everyone is ready.</p>`}</div>
      <div class="panel"><h3 style="margin-top:0">Training &amp; certificates expired or due in 30 days</h3>${d.expiring.length ? d.expiring.map(x => `<div class="check-row"><div><b>${esc(x.name)}</b><div class="note">${esc(x.label)} · ${x.expired ? "<b style='color:var(--bad)'>expired</b> " : ""}${fullDate(x.expires_on)}</div></div><button class="btn ghost sm" data-staff="${esc(x.email)}">Open</button></div>`).join("") : `<p class="empty">Nothing expiring soon.</p>`}</div>
    </div>`;
    $$("[data-go]").forEach(b => b.onclick = () => go(b.dataset.go));
    $("#toStation").onclick = () => go("station");
    $$("[data-staff]").forEach(b => b.onclick = () => staffDrawer(b.dataset.staff));
  },

  async shifts() {
    const f = cache.shiftFilter || { show: "action", client: "" };
    const [list, clients] = await Promise.all([api(`/api/shifts?from=${f.show === "past" ? shiftBack(60) : f.show === "action" || f.show === "upcoming" ? me.today : shiftBack(14)}&to=${f.show === "past" ? me.today : ""}${f.client ? "&client=" + f.client : ""}`), api("/api/clients")]);
    cache.clients = clients;
    let rows = list;
    if (f.show === "action") rows = list.filter(s => s.status === "requested" || s.status === "open" || s.status === "pending");
    if (f.show === "upcoming") rows = list.filter(s => s.status === "filled");
    if (f.show === "past") rows = list.filter(s => s.date < me.today).reverse();
    $("#app").innerHTML = `<div class="section-h"><div class="filters">
      <select id="f_show" aria-label="Show">${[["action", "Needs filling or confirming"], ["upcoming", "Booked, upcoming"], ["all", "Everything"], ["past", "Past 60 days"]].map(([v, l]) => `<option value="${v}" ${f.show === v ? "selected" : ""}>${l}</option>`).join("")}</select>
      <select id="f_client" aria-label="Nursery"><option value="">All nurseries</option>${clients.map(c => `<option value="${c.id}" ${f.client == c.id ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select></div>
      <button class="btn" id="newShift" ${clients.length ? "" : "disabled title='Add a nursery first'"}>New shift</button></div>
    ${clients.length ? "" : `<div class="callout">Add your nurseries first, in the Nurseries tab.</div>`}
    <div class="cards">${rows.length ? rows.map(s => `<button class="card ${s.status === "requested" ? "attn" : s.status === "filled" ? "ok" : ""}" data-shift="${s.id}" style="text-align:left;cursor:pointer;font:inherit;color:inherit">
      <div class="section-h" style="margin:0;width:100%"><h4>${esc(s.client_name)}</h4>${shiftWhen(s)}</div>
      <div class="meta">${pill(STATUS[s.status])}${clockPill(s)}${TS[s.ts_status] ? pill(TS[s.ts_status]) : ""}<span>${shiftReqs(s)}</span>${s.worker_name ? `<b style="color:var(--ink)">${esc(s.worker_name)}</b>` : ""}</div></button>`).join("") : `<p class="empty">No shifts to show.</p>`}</div>`;
    $("#f_show").onchange = e => { cache.shiftFilter = { ...f, show: e.target.value }; render(); };
    $("#f_client").onchange = e => { cache.shiftFilter = { ...f, client: e.target.value }; render(); };
    $("#newShift").onclick = () => openDrawer(`<p class="eyebrow">New shift</p><h2>Add a shift</h2>${shiftFormHtml({ date: me.today, start: "08:00", finish: "18:00", break_min: 60, client_id: clients[0]?.id }, { count: true, clients })}
      <label class="opt" for="sf_pub"><input type="checkbox" id="sf_pub" checked><span>Offer it to all eligible staff now</span></label>
      <p class="err" id="sf_err"></p><div class="row"><button class="btn" id="sf_go">Create</button></div>`, root => {
      root.querySelector("#sf_go").onclick = async () => {
        let res; const ok = await act(root.querySelector("#sf_go"), async () => { res = await api("/api/shifts", { method: "POST", body: { ...readShiftForm(root), publish: fieldVal(root, "sf_pub") } }); }, root.querySelector("#sf_err"));
        if (ok) { toast(res.ids.length > 1 ? `${res.ids.length} shifts created` : "Shift created"); render(); shiftDrawer(res.ids[0]); }
      };
    });
    $$("[data-shift]").forEach(b => b.onclick = () => shiftDrawer(b.dataset.shift));
  },

  async staff() {
    const list = await api("/api/staff");
    const f = cache.staffFilter || "active";
    const rows = list.filter(u => f === "all" || (f === "active" ? u.active : f === "notready" ? u.active && u.blockers.length : f === "pending" ? Object.values(u.checks).some(c => c.status === "pending") : !u.active));
    $("#app").innerHTML = `<div class="section-h"><div class="filters"><select id="f_st" aria-label="Show">${[["active", "Active staff"], ["notready", "Not ready to book"], ["pending", "Documents to check"], ["inactive", "Inactive"], ["all", "Everyone"]].map(([v, l]) => `<option value="${v}" ${f === v ? "selected" : ""}>${l}</option>`).join("")}</select></div>
      <button class="btn" id="addStaff">Add staff member</button></div>
    <div class="tbl"><table><thead><tr><th>Name</th><th>Status</th><th>DBS</th><th>RTW</th><th>Refs</th><th>Training</th><th>Level</th><th>PFA</th><th>Renewals</th><th>Pay</th></tr></thead><tbody>
    ${rows.map(u => { const c = u.checks, v = t => c[t]?.status === "verified" ? "✓" : c[t]?.status === "pending" ? "…" : "✗";
      return `<tr style="cursor:pointer" data-staff="${esc(u.email)}"><td><div style="display:flex;gap:10px;align-items:center">${avatar(u.has_photo ? `/api/photo/${encodeURIComponent(u.email)}` : null, u.name, 36)}<div><b>${esc(u.name)}</b><div class="note">${esc(u.email)}</div></div></div></td>
      <td>${!u.active ? pill(["Inactive", ""]) : u.blockers.length ? pill(["Not ready", "bad"]) : pill(["Ready", "ok"])}</td>
      <td>${v("dbs")}</td><td>${v("rtw")}</td><td>${v("ref1")}${v("ref2")}</td><td>${u.training?.complete ? "✓" : `${u.training?.passed || 0}/${u.training?.total || 0}`}</td>
      <td>${c.qual?.status === "verified" && u.qual_level ? "L" + u.qual_level : "–"}</td><td class="n">${c.pfa?.status === "verified" ? fullDate(c.pfa.expires_on) : "–"}</td><td>${u.expiring.length ? pill([u.expiring.some(x => x.expired) ? `${u.expiring.length} due / expired` : `${u.expiring.length} due soon`, u.expiring.some(x => x.expired) ? "bad" : "warn"]) : "–"}</td><td class="n">${u.pay_rate != null ? gbp(u.pay_rate) : "–"}</td></tr>`; }).join("") || `<tr><td colspan="10" class="empty">No staff yet. Add your first RSS worker.</td></tr>`}</tbody></table></div>
    <p class="note">✓ verified · … uploaded, waiting for your check · ✗ missing. Click a person to open their file.</p>`;
    $("#f_st").onchange = e => { cache.staffFilter = e.target.value; render(); };
    $("#addStaff").onclick = () => userDrawer({ role: "staff", active: 1 });
    $$("[data-staff]").forEach(r => r.onclick = () => staffDrawer(r.dataset.staff));
  },

  async nurseries() {
    const [clients, users] = await Promise.all([api("/api/clients"), api("/api/users")]);
    cache.clients = clients;
    $("#app").innerHTML = `<div class="section-h"><h2>Nurseries</h2><button class="btn" id="addClient">Add nursery</button></div>
    <div class="cards">${clients.map(c => { const mgrs = users.filter(u => u.role === "manager" && u.client_id === c.id);
      return `<div class="card ${c.active ? "" : "bad"}"><div class="section-h" style="margin:0"><h4>${esc(c.name)}</h4><span class="when">${gbp(c.charge_rate)}/h</span></div>
      <div class="meta"><span>${esc(c.address || "No address")}</span><span>Invoices: ${esc(c.invoice_email || "no email")}</span><span>Pay in ${c.payment_days} days</span>${c.active ? "" : pill(["Inactive", ""])}</div>
      <div class="meta">Managers: ${mgrs.length ? mgrs.map(u => `<button class="link-btn" data-user="${esc(u.email)}">${esc(u.name)}</button>`).join(" ") : "none yet"}</div>
      <div class="row" style="margin-top:4px"><button class="btn ghost sm" data-client="${c.id}">Edit</button><button class="btn ghost sm" data-addmgr="${c.id}">Add manager</button></div></div>`; }).join("") || `<p class="empty">No nurseries yet.</p>`}</div>`;
    $("#addClient").onclick = () => clientDrawer({ active: 1, payment_days: 14 });
    $$("[data-client]").forEach(b => b.onclick = () => clientDrawer(clients.find(c => c.id == b.dataset.client)));
    $$("[data-addmgr]").forEach(b => b.onclick = () => userDrawer({ role: "manager", client_id: +b.dataset.addmgr, active: 1 }));
    $$("[data-user]").forEach(b => b.onclick = () => userDrawer(users.find(u => u.email === b.dataset.user)));
  },

  async billing() {
    const [clients, invoices] = await Promise.all([api("/api/clients"), api("/api/invoices")]);
    const first = me.today.slice(0, 8) + "01";
    $("#app").innerHTML = `<div id="tsHost"></div>
    <div class="grid2" style="margin-top:28px">
      <div class="panel"><h3 style="margin-top:0">Create an invoice</h3>
        <p class="note">Bills every approved, not-yet-invoiced shift for the nursery in the dates you pick, at the rate locked in when the shift was booked.</p>
        <div class="form-grid"><label class="fld" for="iv_c">Nursery<select id="iv_c">${clients.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join("")}</select></label>
        <label class="fld" for="iv_f">From<input type="date" id="iv_f" value="${first}"></label><label class="fld" for="iv_t">To<input type="date" id="iv_t" value="${me.today}"></label></div>
        <div id="iv_prev" class="note"></div><p class="err" id="iv_err"></p>
        <div class="row"><button class="btn ghost" id="iv_check">Preview</button><button class="btn" id="iv_go">Create invoice</button></div></div>
      <div class="panel"><h3 style="margin-top:0">Pay export</h3>
        <p class="note">A spreadsheet of approved hours per worker, for payroll.</p>
        <div class="form-grid"><label class="fld" for="pe_f">From<input type="date" id="pe_f" value="${first}"></label><label class="fld" for="pe_t">To<input type="date" id="pe_t" value="${me.today}"></label></div>
        <div class="row"><button class="btn" id="pe_go">Download pay CSV</button></div></div>
    </div>
    <div class="section-h" style="margin-top:28px"><h2>Invoices</h2></div>
    <div class="tbl"><table><thead><tr><th>Number</th><th>Nursery</th><th>Period</th><th>Total</th><th>Issued</th><th>Due</th><th></th></tr></thead><tbody>
    ${invoices.map(i => `<tr><td class="n"><b>${esc(i.number)}</b></td><td>${esc(i.client_name)}</td><td class="n">${fullDate(i.period_from)} – ${fullDate(i.period_to)}</td><td class="n">${gbp(i.total)}</td><td class="n">${fullDate(i.issued_on)}</td><td class="n">${fullDate(i.due_on)}</td>
      <td>${i.void ? pill(["Void", ""]) : `<button class="link-btn" data-inv="${i.id}">Open</button>`}</td></tr>`).join("") || `<tr><td colspan="7" class="empty">No invoices yet.</td></tr>`}</tbody></table></div>`;
    await signOffList(`/api/shifts?from=${shiftBack(120)}&to=${me.today}`);
    const range = () => ({ c: +$("#iv_c").value, f: $("#iv_f").value, t: $("#iv_t").value });
    $("#iv_check").onclick = async () => {
      const { c, f, t } = range();
      try {
        const rows = (await api(`/api/billing?from=${f}&to=${t}`)).filter(s => s.client_id === c);
        const ready = rows.filter(s => s.ts_status === "approved" && !s.invoice_id), waiting = rows.filter(s => s.ts_status !== "approved");
        const net = ready.reduce((a, s) => a + Math.round(s.actMins / 60 * s.charge_rate), 0);
        $("#iv_prev").innerHTML = `${ready.length} approved shift${ready.length === 1 ? "" : "s"} ready, net ${gbp(net)}.${waiting.length ? ` <b>${waiting.length} more in these dates don't have approved hours yet</b> and won't be included.` : ""}`;
      } catch (e) { $("#iv_err").textContent = e.message; }
    };
    $("#iv_go").onclick = async () => {
      const { c, f, t } = range(); let res;
      if (await act($("#iv_go"), async () => { res = await api("/api/invoices", { method: "POST", body: { client_id: c, from: f, to: t } }); }, $("#iv_err"))) { toast(`Invoice ${res.number} created`); render(); invoiceDrawer(res.id); }
    };
    $("#pe_go").onclick = () => download(`/api/pay.csv?from=${$("#pe_f").value}&to=${$("#pe_t").value}`, `rss-pay-${$("#pe_f").value}-to-${$("#pe_t").value}.csv`);
    $$("[data-inv]").forEach(b => b.onclick = () => invoiceDrawer(b.dataset.inv));
  },

  async settings() {
    const [s, users] = await Promise.all([api("/api/settings"), api("/api/users")]);
    const office = users.filter(u => u.role === "owner" || u.role === "coordinator");
    const owner = me.role === "owner";
    const F = (k, l, type = "text") => `<label class="fld" for="st_${k}">${l}<input type="${type}" id="st_${k}" value="${esc(s[k])}" ${owner ? "" : "disabled"}></label>`;
    $("#app").innerHTML = `<div class="panel"><h2 style="margin-top:0">Business details</h2><p class="note">Used on invoices.${owner ? "" : " Only the owner can change these."}</p>
      <div class="form-grid">${F("company_name", "Trading name")}${F("company_legal", "Company")}${F("company_email", "Email", "email")}${F("company_phone", "Phone")}${F("vat_number", "VAT number (blank if not registered)")}${F("vat_rate", "VAT rate %", "number")}${F("invoice_prefix", "Invoice number prefix")}${F("next_invoice", "Next invoice number", "number")}${F("holiday_pct", "Rolled-up holiday pay % on pay export (0 = none)", "number")}${F("profile_tagline", "Strapline on staff profiles")}</div>
      <label class="fld" for="st_company_address">Address<textarea id="st_company_address" class="plain" style="max-width:none" ${owner ? "" : "disabled"}>${esc(s.company_address)}</textarea></label>
      <label class="fld" for="st_bank_details">Bank details for invoices<textarea id="st_bank_details" class="plain" style="max-width:none" ${owner ? "" : "disabled"}>${esc(s.bank_details)}</textarea></label>
      ${owner ? `<p class="err" id="st_err"></p><div class="row"><button class="btn" id="st_go">Save details</button></div>` : ""}</div>
    <div class="panel" style="margin-top:20px"><div class="section-h"><h2 style="margin:0">RSS office team</h2><button class="btn ghost" id="addOffice">Add coordinator</button></div>
      ${office.map(u => `<div class="check-row"><div><b>${esc(u.name)}</b><div class="note">${esc(u.email)} · ${u.role === "owner" ? "Owner" : "Coordinator"}${u.active ? "" : " · inactive"}</div></div><button class="btn ghost sm" data-user="${esc(u.email)}">Edit</button></div>`).join("")}
      <p class="note">Everyone signs in with a one-time code sent to their email. Add staff in the Staff tab and nursery managers in the Nurseries tab.</p></div>
    <div class="panel" style="margin-top:20px" id="termsPanel"><h2 style="margin-top:0">Terms of engagement</h2><p class="loading">Loading…</p></div>
    <div class="panel" style="margin-top:20px"><h2 style="margin-top:0">Activity log</h2><div id="auditHost"><button class="btn ghost" id="loadAudit">Show the last 300 actions</button></div></div>`;
    if (owner) $("#st_go").onclick = async () => {
      const b = {}; for (const k of ["company_name", "company_legal", "company_email", "company_phone", "vat_number", "vat_rate", "invoice_prefix", "next_invoice", "holiday_pct", "profile_tagline", "company_address", "bank_details"]) b[k] = $("#st_" + k).value;
      if (await act($("#st_go"), () => api("/api/settings", { method: "PUT", body: b }), $("#st_err"))) toast("Saved");
    };
    $("#addOffice").onclick = () => userDrawer({ role: "coordinator", active: 1 });
    termsPanel().catch(e => $("#termsPanel").innerHTML = `<p class="err">${esc(e.message)}</p>`);
    $$("[data-user]").forEach(b => b.onclick = () => userDrawer(users.find(u => u.email === b.dataset.user)));
    $("#loadAudit").onclick = async () => {
      const a = await api("/api/audit");
      $("#auditHost").innerHTML = `<div class="tbl"><table><thead><tr><th>When</th><th>Who</th><th>What</th><th>Item</th></tr></thead><tbody>${a.map(x => `<tr><td class="n">${new Date(x.at).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" })}</td><td>${esc(x.actor)}</td><td>${esc(x.action.replace(/_/g, " "))}</td><td>${esc(x.target)}</td></tr>`).join("")}</tbody></table></div>`;
    };
  },
};

/* ---------- admin: terms of engagement ---------- */
async function termsPanel() {
  const [sig, cur] = await Promise.all([api("/api/agreement/signatures"), api("/api/agreement")]);
  const active = sig.staff.filter(u => u.active), signedNow = active.filter(u => u.current?.signed_at);
  const status = u => u.current?.signed_at ? pill(["Signed " + fullDate(u.current.signed_at), "ok"])
    : u.check === "verified" ? pill(["Verified by RSS (paper or earlier version)", "ok"])
    : u.current?.kid_ack_at ? pill(["Read KID, not signed yet", "warn"]) : pill(["Not signed", "bad"]);
  $("#termsPanel").innerHTML = `<h2 style="margin-top:0">Terms of engagement</h2>
    <p class="note">Staff read the Key Information Document and sign the terms under <b>My checks</b>. Signing ticks off "RSS terms of engagement signed" automatically.
    ${sig.version ? `Current version: <b>${sig.version}</b>, published ${fullDate(sig.versions[0].published_at)}.` : "Nothing published yet."} ${signedNow.length} of ${active.length} active staff have signed it.</p>
    <div class="tbl"><table><thead><tr><th>Staff member</th><th>Status</th><th></th></tr></thead><tbody>
    ${active.map(u => `<tr><td>${esc(u.name)}</td><td>${status(u)}</td><td>${u.last ? `<button class="link-btn" data-sigrec="${esc(u.email)}">Signed copy</button>` : ""}</td></tr>`).join("") || `<tr><td colspan="3" class="empty">No staff yet.</td></tr>`}</tbody></table></div>
    <div class="row"><button class="btn ghost sm" id="tp_view">Read current version</button>${me.role === "owner" ? `<button class="btn ghost sm" id="tp_edit">Update the terms or KID</button>` : ""}</div>`;
  $$("[data-sigrec]").forEach(b => b.onclick = () => openSignedRecord(b.dataset.sigrec));
  $("#tp_view").onclick = () => openDrawer(`<p class="eyebrow">Version ${cur.version}</p><div class="no-print row" style="margin:0 0 12px"><button class="btn" onclick="window.print()">Print or save as PDF</button></div><div class="agreement-doc">${md(cur.kid_md)}<hr class="page-break">${md(cur.terms_md)}</div>`);
  if ($("#tp_edit")) $("#tp_edit").onclick = () => openDrawer(`<p class="eyebrow">Publish a new version</p><h2>Update the terms</h2>
    <p class="note">Edit the text below. Use <code>## Heading</code>, <code>**bold**</code>, <code>- bullet</code> and <code>| table | rows |</code>. Each version is kept, so earlier signatures always match the text that was signed.</p>
    <label class="fld" for="tp_kid">Key Information Document<textarea id="tp_kid" class="plain mono" rows="14" style="max-width:none">${esc(cur.kid_md)}</textarea></label>
    <label class="fld" for="tp_terms">Terms of Engagement<textarea id="tp_terms" class="plain mono" rows="20" style="max-width:none">${esc(cur.terms_md)}</textarea></label>
    <label class="fld" for="tp_note">What changed (shown to staff)<input type="text" id="tp_note" style="max-width:none" placeholder="e.g. New pay rate from 1 April"></label>
    <label class="opt" for="tp_rs"><input type="checkbox" id="tp_rs" checked><span>Everyone must sign the new version before their next booking</span></label>
    <p class="note">Untick only for small corrections (typos) that don't change anyone's rights or pay. If the Key Information Document changes, staff must get the new one within a week, so leave this ticked.</p>
    <p class="err" id="tp_e"></p><div class="row"><button class="btn" id="tp_go">Publish version ${cur.version + 1}</button></div>`, root => {
    const g = id => root.querySelector("#" + id);
    g("tp_go").onclick = async () => {
      if (!g("tp_go").dataset.armed) { g("tp_go").dataset.armed = 1; g("tp_go").textContent = g("tp_rs").checked ? "Publish and ask everyone to sign again?" : "Publish without re-signing?"; return; }
      if (await act(g("tp_go"), () => api("/api/agreement", { method: "POST", body: { kid_md: g("tp_kid").value, terms_md: g("tp_terms").value, note: g("tp_note").value, resign: g("tp_rs").checked } }), g("tp_e"))) { closeDrawer(); toast("Published"); termsPanel(); }
    };
  });
}

/* ---------- admin drawers ---------- */
async function shiftDrawer(id) {
  openDrawer(`<p class="loading">Loading…</p>`);
  const s = await api("/api/shifts/" + id).catch(e => ({ error: e.message }));
  if (s.error) return setDrawer(`<p class="err">${esc(s.error)}</p>`);
  const clients = cache.clients || await api("/api/clients");
  const ready = (s.candidates || []).filter(c => !c.blockers.length), notReady = (s.candidates || []).filter(c => c.blockers.length);
  const unfilled = s.status === "requested" || s.status === "open";
  const pendingHtml = s.status === "pending" ? `<div class="panel" style="padding:16px"><b>${esc(s.worker_name)}</b> has been asked to work this shift and hasn't confirmed yet${s.assigned_at ? ` (asked ${new Date(s.assigned_at).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" })})` : ""}.
     <div class="note">${esc(s.worker_email)}${s.worker_phone ? " · " + esc(s.worker_phone) : ""}. It's on their My shifts page to accept or decline.</div>
     <div class="row" style="margin-top:8px"><button class="btn ghost sm" id="sd_un">Withdraw and ask someone else</button></div><p class="err" id="sd_err1"></p></div>` : "";
  setDrawer(`<p class="eyebrow">Shift #${s.id} · ${pill(STATUS[s.status])} ${clockPill(s)} ${TS[s.ts_status] ? pill(TS[s.ts_status]) : ""}</p>${s.clock_in_at ? `<p class="note">Arrived ${ukClock(s.clock_in_at)} (${{ pin: "sign-in station, PIN", manager: "confirmed by manager", phone: "own phone" }[s.clock_in_by] || s.clock_in_by})${s.clock_out_at ? ` · left ${ukClock(s.clock_out_at)} (${{ pin: "sign-in station, PIN", manager: "confirmed by manager", phone: "own phone" }[s.clock_out_by] || s.clock_out_by})` : ""}${s.clock_note ? ` · ${esc(s.clock_note)}` : ""}</p>` : ""}
  <h2>${esc(s.client_name)}</h2><p>${shiftWhen(s)} · ${hrs(s.mins)}</p>
  ${s.requested_by ? `<p class="note">Requested by ${esc(s.requested_by)} on ${fullDate(s.created_at)}.${s.cancelled_reason ? " Cancelled: " + esc(s.cancelled_reason) : ""}</p>` : ""}
  ${pendingHtml}${declinedHtml(s)}
  ${s.status === "filled" ? `<div class="panel" style="padding:16px"><b>${esc(s.worker_name)}</b> <span class="note">${esc(s.worker_email)}${s.worker_phone ? " · " + esc(s.worker_phone) : ""}</span>
     <div class="meta">Pay ${gbp(s.pay_rate)}/h · Charge ${gbp(s.charge_rate)}/h</div>
     ${s.ts_status !== "none" ? `<div>Hours: ${s.act_start}–${s.act_finish}, ${s.act_break} min break = <b>${hrs(s.actMins)}</b>${s.ts_comment ? ` · <span class="note">${esc(s.ts_comment)}</span>` : ""}</div>` : ""}
     ${s.invoice_id ? `<div class="note">On an invoice.</div>` : ""}
     <div class="row" style="margin-top:8px">${s.ts_status === "none" && s.date <= me.today ? `<button class="btn sm" id="sd_ts">Enter hours for them</button>` : ""}
     ${s.ts_status === "submitted" || s.ts_status === "queried" ? `<button class="btn sm" id="sd_appr">Approve hours on the nursery's behalf</button>` : ""}
     ${s.ts_status === "none" ? `<button class="btn ghost sm" id="sd_un">Unassign</button>` : ""}</div><p class="err" id="sd_err1"></p></div>` : ""}
  ${unfilled ? `<h3>Ready to work this shift (${ready.length})</h3>
    ${ready.length ? `<div class="cards">${ready.map(c => `<div class="check-row"><label class="opt" style="margin:0;border:0;padding:0" for="cand_${c.email}"><input type="checkbox" class="cand" id="cand_${c.email}" value="${esc(c.email)}"><span><b>${esc(c.name)}</b>${c.phone ? ` <span class="note">${esc(c.phone)}</span>` : ""}</span></label>
      <button class="btn sm" data-assign="${esc(c.email)}">Ask to work</button></div>`).join("")}</div>
      <p class="note">"Ask to work" sends it to that person to accept or decline. "Offer" lets the first eligible person to accept take it.</p>
      <div class="row"><button class="btn ghost" id="sd_pub">${s.status === "open" ? "Re-offer" : "Offer"} to ticked staff</button><button class="btn ghost" id="sd_puball">Offer to all ${ready.length} ready staff</button></div>`
      : `<p class="empty">Nobody is eligible yet.</p>`}
    ${s.status === "open" ? `<p class="note">Currently offered to ${s.offered_to ? s.offered_to.length + " selected staff" : "all eligible staff"}. The first to accept gets it.</p>` : ""}
    ${notReady.length ? `<details><summary>Not eligible (${notReady.length})</summary>${notReady.map(c => `<div class="check-row"><div><b>${esc(c.name)}</b><ul class="blk">${c.blockers.map(b => `<li>${esc(b)}</li>`).join("")}</ul></div>${me.role === "owner" ? `<button class="link-btn danger" data-override="${esc(c.email)}">Book anyway</button>` : ""}</div>`).join("")}</details>` : ""}
    <p class="err" id="sd_err2"></p>` : ""}
  ${s.status !== "cancelled" && !s.invoice_id ? `<h3>Edit shift</h3>${shiftFormHtml(s, { clients })}<p class="err" id="sd_err3"></p>
    <div class="row"><button class="btn" id="sd_save">Save changes</button>${s.ts_status === "none" ? `<button class="link-btn danger" id="sd_cancel">Cancel shift</button>` : ""}</div>` : ""}`, root => {
    const g = id => root.querySelector("#" + id), reopen = () => { render(); shiftDrawer(id); };
    root.querySelectorAll("[data-assign]").forEach(b => b.onclick = async () => { if (await act(b, () => api(`/api/shifts/${id}/assign`, { method: "POST", body: { email: b.dataset.assign } }), g("sd_err2"))) { toast("Sent. Waiting for them to accept."); reopen(); } });
    root.querySelectorAll("[data-override]").forEach(b => b.onclick = async () => {
      if (!b.dataset.armed) { b.dataset.armed = 1; b.textContent = "Book despite missing checks? Click again"; return; }
      if (await act(b, () => api(`/api/shifts/${id}/assign`, { method: "POST", body: { email: b.dataset.override, override: true } }), g("sd_err2"))) { toast("Sent to them to confirm (override logged)"); reopen(); }
    });
    if (g("sd_pub")) g("sd_pub").onclick = async () => {
      const picked = [...root.querySelectorAll(".cand:checked")].map(x => x.value);
      if (!picked.length) { g("sd_err2").textContent = "Tick at least one person, or offer it to everyone."; return; }
      if (await act(g("sd_pub"), () => api(`/api/shifts/${id}/publish`, { method: "POST", body: { offered_to: picked } }), g("sd_err2"))) { toast("Offered. It's on their My shifts page."); reopen(); }
    };
    if (g("sd_puball")) g("sd_puball").onclick = async () => { if (await act(g("sd_puball"), () => api(`/api/shifts/${id}/publish`, { method: "POST", body: {} }), g("sd_err2"))) { toast("Offered to all eligible staff"); reopen(); } };
    if (g("sd_un")) g("sd_un").onclick = async () => { if (await act(g("sd_un"), () => api(`/api/shifts/${id}/unassign`, { method: "POST", body: { reason: "Unassigned by RSS" } }), g("sd_err1"))) { toast("Unassigned. The shift needs filling again."); reopen(); } };
    if (g("sd_appr")) g("sd_appr").onclick = async () => { if (await act(g("sd_appr"), () => api(`/api/shifts/${id}/approve`, { method: "POST", body: {} }), g("sd_err1"))) { toast("Approved"); reopen(); } };
    if (g("sd_ts")) g("sd_ts").onclick = () => { closeDrawer(); timesheetDrawer(s); };
    if (g("sd_save")) g("sd_save").onclick = async () => {
      const b = readShiftForm(root);
      const run = async override => api("/api/shifts/" + id, { method: "PUT", body: { ...b, override } });
      try { g("sd_save").disabled = true; await run(false); toast("Saved"); reopen(); }
      catch (e) { g("sd_save").disabled = false; g("sd_err3").textContent = e.message + (e.status === 409 ? " Unassign them first, or change it back." : ""); }
    };
    if (g("sd_cancel")) g("sd_cancel").onclick = () => cancelShift(id, g("sd_cancel"));
  });
}

async function staffDrawer(email) {
  openDrawer(`<p class="loading">Loading…</p>`);
  const list = await api("/api/staff"), u = list.find(x => x.email === email);
  if (!u) return setDrawer(`<p class="err">Not found.</p>`);
  const t = u.training || {};
  setDrawer(`<p class="eyebrow">Staff file</p>${photoBlock(u.email, u.name, u.has_photo, true)}<h2>${esc(u.name)}</h2>
  <p class="note">${esc(u.email)}${u.phone ? " · " + esc(u.phone) : ""} · Pay ${u.pay_rate != null ? gbp(u.pay_rate) + "/h" : "not set"} <button class="link-btn" id="sd_edit">Edit details</button> <button class="link-btn" id="sd_prof">Agency profile</button></p>
  ${u.blockers.length ? `<div class="callout"><b>Can't be booked:</b><ul class="blk">${u.blockers.map(b => `<li>${esc(b)}</li>`).join("")}</ul></div>` : `<div class="callout exp"><b>Ready to book.</b></div>`}
  <div class="check-row"><div><b>Childcare 101 training</b><div class="note">${t.found ? `${t.passed} of ${t.total} modules passed${t.declaredAt ? ", declaration signed " + fullDate(t.declaredAt) : ""}` : `Not started yet.`}</div></div>${t.complete ? pill(["Complete", "ok"]) : pill(["Not complete", "bad"])}</div>
  ${expiringHtml(u.expiring)}
  ${checkRows(u.checks, k => `<button class="btn ${u.checks[k]?.status === "pending" ? "" : "ghost"} sm" data-ck="${k}">${u.checks[k]?.status === "pending" ? "Check now" : "Open"}</button>`)}
  <div class="row"><button class="btn ghost sm" id="sd_terms">Signed terms &amp; Key Information Document</button></div>
  ${qualRows(u.quals, true)}`, root => {
    root.querySelector("#sd_edit").onclick = () => userDrawer(u);
    root.querySelector("#sd_terms").onclick = () => openSignedRecord(email, () => staffDrawer(email));
    root.querySelector("#sd_prof").onclick = async () => { const a = await api(`/api/staff/${encodeURIComponent(email)}/profile`); setDrawer(`<button class="link-btn no-print" id="back">← Back to ${esc(u.name)}</button>` + agencyProfileHtml(a), r => r.querySelector("#back").onclick = () => staffDrawer(email)); };
    wirePhoto(root, email, () => { render(); staffDrawer(email); });
    root.querySelectorAll("[data-qual]").forEach(b => b.onclick = () => qualDrawer(email, u.quals.find(q => q.id == b.dataset.qual), true, () => { render(); staffDrawer(email); }));
    root.querySelectorAll("[data-ck]").forEach(b => b.onclick = () => setDrawer(`<button class="link-btn" id="back">← Back to ${esc(u.name)}</button>` + checkForm(email, b.dataset.ck, u.checks[b.dataset.ck], true, u),
      r => { r.querySelector("#back").onclick = () => staffDrawer(email); wireCheckForm(r, email, b.dataset.ck, true, uploadOnly => { if (!uploadOnly) { render(); staffDrawer(email); } }); }));
  });
}

function userDrawer(u) {
  const isNew = !u.email, clients = cache.clients || [];
  const roleOpts = [["staff", "RSS staff (agency worker)"], ["manager", "Nursery manager"], ["coordinator", "RSS coordinator (office)"], ...(me.role === "owner" ? [["owner", "Owner"]] : [])];
  openDrawer(`<p class="eyebrow">${isNew ? "Add person" : "Edit person"}</p><h2>${isNew ? "New " + (u.role === "manager" ? "nursery manager" : u.role === "staff" ? "staff member" : "coordinator") : esc(u.name)}</h2>
  <div class="form-grid">
    <label class="fld" for="u_name">Full name<input type="text" id="u_name" value="${esc(u.name)}"></label>
    <label class="fld" for="u_email">Email (they sign in with this)<input type="email" id="u_email" value="${esc(u.email)}"></label>
    <label class="fld" for="u_phone">Mobile<input type="tel" id="u_phone" value="${esc(u.phone)}"></label>
    <label class="fld" for="u_role">Role<select id="u_role">${roleOpts.map(([v, l]) => `<option value="${v}" ${u.role === v ? "selected" : ""}>${l}</option>`).join("")}</select></label>
    <label class="fld" for="u_client" data-for="manager">Nursery<select id="u_client">${clients.map(c => `<option value="${c.id}" ${u.client_id === c.id ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select></label>
    <label class="fld" for="u_pay" data-for="staff">Pay rate (£ per hour)<input type="number" step="0.01" min="0" id="u_pay" value="${rate(u.pay_rate)}"></label>
    <label class="fld" for="u_tn" data-for="staff">Name used in the old Childcare 101 app (only if different, to carry over their results)<input type="text" id="u_tn" value="${esc(u.training_name)}"></label>
  </div>
  <label class="fld" for="u_notes">Notes<textarea id="u_notes" class="plain" style="max-width:none">${esc(u.notes)}</textarea></label>
  <label class="opt" for="u_active"><input type="checkbox" id="u_active" ${u.active !== 0 ? "checked" : ""}><span>Active (can sign in${u.role === "staff" ? " and be booked" : ""})</span></label>
  <p class="err" id="u_err"></p><div class="row"><button class="btn" id="u_go">${isNew ? "Add" : "Save"}</button>${!isNew && u.email !== me.email && u.role !== "owner" ? `<button class="link-btn danger" id="u_del">Delete ${esc(u.name)}</button>` : ""}</div>
  ${!isNew ? `<p class="note">Changing the email changes how they sign in, and keeps all their records. Deleting removes them and their documents for good. Anyone with booked or worked shifts can't be deleted; untick Active instead.</p>` : ""}
  ${isNew ? `<p class="note">Then send them the hub link. They sign in with a one-time code sent to this email address.</p>` : ""}`, root => {
    const sync = () => { const r = fieldVal(root, "u_role"); root.querySelectorAll("[data-for]").forEach(el => el.hidden = el.dataset.for !== r); };
    root.querySelector("#u_role").onchange = sync; sync();
    if (!clients.length) api("/api/clients").then(c => { cache.clients = c; root.querySelector("#u_client").innerHTML = c.map(x => `<option value="${x.id}" ${u.client_id === x.id ? "selected" : ""}>${esc(x.name)}</option>`).join(""); });
    const del = root.querySelector("#u_del"); if (del) del.onclick = async () => {
      if (!del.dataset.armed) { del.dataset.armed = 1; del.textContent = `Delete ${u.name} and their documents? Click again`; return; }
      if (await act(del, () => api(`/api/users/${encodeURIComponent(u.email)}`, { method: "DELETE" }), root.querySelector("#u_err"))) { toast("Deleted"); closeDrawer(); render(); }
    };
    root.querySelector("#u_go").onclick = async () => {
      const newEmail = fieldVal(root, "u_email").trim().toLowerCase();
      if (!isNew && newEmail !== u.email) {
        const ok = await act(root.querySelector("#u_go"), () => api(`/api/users/${encodeURIComponent(u.email)}/email`, { method: "POST", body: { email: newEmail } }), root.querySelector("#u_err"));
        if (!ok) return;
        u = { ...u, email: newEmail };
      }
      const b = { email: newEmail, name: fieldVal(root, "u_name"), phone: fieldVal(root, "u_phone"), role: fieldVal(root, "u_role"), client_id: fieldVal(root, "u_client"), pay_rate: fieldVal(root, "u_pay"), training_name: fieldVal(root, "u_tn"), notes: fieldVal(root, "u_notes"), active: fieldVal(root, "u_active") };
      if (await act(root.querySelector("#u_go"), () => api("/api/users", { method: "PUT", body: b }), root.querySelector("#u_err"))) {
        toast(isNew ? "Added" : "Saved");
        if (b.role === "staff") { render(); staffDrawer(b.email.trim().toLowerCase()); } else { closeDrawer(); render(); }
      }
    };
  });
}

function clientDrawer(c) {
  openDrawer(`<p class="eyebrow">${c.id ? "Edit nursery" : "Add nursery"}</p><h2>${c.id ? esc(c.name) : "New nursery"}</h2>
  <div class="form-grid">
    <label class="fld" for="c_name">Name<input type="text" id="c_name" value="${esc(c.name)}"></label>
    <label class="fld" for="c_rate">Charge rate (£ per hour)<input type="number" step="0.01" min="0" id="c_rate" value="${rate(c.charge_rate)}"></label>
    <label class="fld" for="c_email">Invoice email<input type="email" id="c_email" value="${esc(c.invoice_email)}"></label>
    <label class="fld" for="c_days">Payment terms (days)<input type="number" min="0" max="90" id="c_days" value="${c.payment_days ?? 14}"></label>
  </div>
  <label class="fld" for="c_addr">Address<textarea id="c_addr" class="plain" style="max-width:none">${esc(c.address)}</textarea></label>
  <label class="opt" for="c_active"><input type="checkbox" id="c_active" ${c.active !== 0 ? "checked" : ""}><span>Active</span></label>
  <p class="note">Changing the rate only affects shifts booked from now on.</p>
  <p class="err" id="c_err"></p><div class="row"><button class="btn" id="c_go">${c.id ? "Save" : "Add nursery"}</button></div>`, root => {
    root.querySelector("#c_go").onclick = async () => {
      const b = { id: c.id, name: fieldVal(root, "c_name"), charge_rate: fieldVal(root, "c_rate"), invoice_email: fieldVal(root, "c_email"), payment_days: fieldVal(root, "c_days"), address: fieldVal(root, "c_addr"), active: fieldVal(root, "c_active") };
      if (await act(root.querySelector("#c_go"), () => api("/api/clients", { method: "PUT", body: b }), root.querySelector("#c_err"))) { toast("Saved"); cache.clients = null; closeDrawer(); render(); }
    };
  });
}

async function invoiceDrawer(id) {
  openDrawer(`<p class="loading">Loading…</p>`);
  const inv = await api("/api/invoices/" + id), s = inv.settings;
  setDrawer(`<div class="row no-print" style="margin:0 0 14px"><button class="btn" id="iv_print">Print or save as PDF</button>${inv.void ? "" : `<button class="link-btn danger" id="iv_void">Void invoice</button>`}<span class="err" id="iv_e"></span></div>
  <div class="inv">
    <div class="section-h" style="align-items:flex-start"><div><h2 style="margin:0">${esc(s.company_name)}</h2><div class="note" style="white-space:pre-line">${esc(s.company_legal)}\n${esc(s.company_address)}\n${esc(s.company_email)} · ${esc(s.company_phone)}${s.vat_number ? "\nVAT " + esc(s.vat_number) : ""}</div></div>
      <div style="text-align:right"><h3 style="margin:0">Invoice ${esc(inv.number)}</h3><div class="note">Issued ${fullDate(inv.issued_on)}<br>Due ${fullDate(inv.due_on)}<br>Period ${fullDate(inv.period_from)} – ${fullDate(inv.period_to)}</div></div></div>
    <p><b>Bill to</b><br><span style="white-space:pre-line">${esc(inv.client_name)}${inv.client_address ? "\n" + esc(inv.client_address) : ""}</span></p>
    <div class="tbl"><table><thead><tr><th>Date</th><th>Worker</th><th>Times</th><th>Hours</th><th>Rate</th><th>Amount</th></tr></thead><tbody>
    ${inv.lines.map(l => `<tr><td class="n">${dayName(l.date)}</td><td>${esc(l.worker_name)}${l.room ? `<div class="note">${esc(l.room)}</div>` : ""}</td><td class="n">${l.act_start}–${l.act_finish} (${l.act_break}m break)</td><td class="n">${(l.actMins / 60).toFixed(2)}</td><td class="n">${gbp(l.charge_rate)}</td><td class="n">${gbp(Math.round(l.actMins / 60 * l.charge_rate))}</td></tr>`).join("")}
    <tr><td colspan="5" style="text-align:right">Net</td><td class="n">${gbp(inv.net)}</td></tr>
    ${inv.vat_rate ? `<tr><td colspan="5" style="text-align:right">VAT ${inv.vat_rate}%</td><td class="n">${gbp(inv.vat)}</td></tr>` : ""}
    <tr class="tot"><td colspan="5" style="text-align:right">Total due</td><td class="n">${gbp(inv.total)}</td></tr></tbody></table></div>
    ${s.bank_details ? `<p><b>Payment details</b><br><span style="white-space:pre-line">${esc(s.bank_details)}</span></p>` : ""}
    <p class="note">All hours were approved by the nursery. Please quote ${esc(inv.number)} with your payment.</p>
  </div>`, root => {
    root.querySelector("#iv_print").onclick = () => window.print();
    const v = root.querySelector("#iv_void"); if (v) v.onclick = async () => {
      if (!v.dataset.armed) { v.dataset.armed = 1; v.textContent = "Void it? The shifts can then be invoiced again. Click again"; return; }
      if (await act(v, () => api(`/api/invoices/${id}/void`, { method: "POST", body: {} }), root.querySelector("#iv_e"))) { toast("Invoice voided"); closeDrawer(); render(); }
    };
  });
}

boot();
