// RSS hub — Resourceful Staffing Support.
// Sign-in is Cloudflare Access (email one-time code) in front of the whole site. Every API call
// verifies the Access token here and looks the person up in D1; nothing the browser says about
// who it is is trusted. Roles: owner, coordinator (RSS office), manager (a nursery), staff (agency workers).

const TZ = "Europe/London";
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const fail = (status, message) => json({ error: message }, status);
const nowIso = () => new Date().toISOString();
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const bad = msg => { throw new HttpError(400, msg); };

// ---------- time ----------
export function ukNow(d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(d).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}
const toMin = t => { const m = /^(\d{2}):(\d{2})$/.exec(t || ""); return m && +m[1] < 24 && +m[2] < 60 ? +m[1] * 60 + +m[2] : null; };
const validDate = d => /^\d{4}-\d{2}-\d{2}$/.test(d || "") && new Date(d + "T00:00:00Z").toISOString().slice(0, 10) === d;
const addDays = (d, n) => { const t = new Date(d + "T12:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const mondayOf = d => { const t = new Date(d + "T12:00:00Z"); const w = (t.getUTCDay() + 6) % 7; return addDays(d, -w); };
export function shiftMins(start, finish, brk) {
  const s = toMin(start), f = toMin(finish);
  if (s == null || f == null || f <= s) return null;
  return Math.max(0, f - s - (Number(brk) || 0));
}
const money = (mins, rate) => Math.round((mins / 60) * (rate || 0));

// ---------- text helpers ----------
const clean = (s, max = 200) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const cleanMulti = (s, max = 2000) => String(s ?? "").replace(/\r/g, "").trim().slice(0, max);
const nameKey = n => String(n || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const validEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e || "");
const penceFrom = v => { if (v === "" || v == null) return null; const n = Math.round(Number(v) * 100); return Number.isFinite(n) && n >= 0 ? n : bad("Rates must be a number of pounds, e.g. 14.50"); };

// ---------- compliance ----------
// required: must be verified (and in date) before anyone can be booked.
export const CHECKS = {
  dbs: { label: "Enhanced DBS with barred list (children)", required: true, refLabel: "Certificate number", issued: true },
  rtw: { label: "Right to work in the UK", required: true, refLabel: "Share code or document seen", expires: true },
  id: { label: "Photo ID seen", required: true, refLabel: "Document type" },
  ref1: { label: "Reference 1", required: true, refLabel: "Referee name and organisation" },
  ref2: { label: "Reference 2", required: true, refLabel: "Referee name and organisation" },
  terms: { label: "RSS terms of engagement signed", required: true, refLabel: "Version signed", issued: true },
  qual: { label: "Childcare qualification", required: false, refLabel: "Qualification title", issued: true },
  pfa: { label: "Paediatric first aid certificate", required: false, refLabel: "Provider / certificate number", issued: true, expires: true },
  safeguarding: { label: "Accredited safeguarding training", required: false, refLabel: "Course and provider", issued: true, expires: true },
};

async function trainingFor(env, users) {
  // Childcare 101 completion, read from the training app's database.
  const out = {};
  if (!env.TRAINING || !users.length) return out;
  try {
    const c = await env.TRAINING.prepare("SELECT value FROM settings WHERE key='content'").first();
    const mods = c ? JSON.parse(c.value).modules.map(m => m.id) : [];
    const keys = users.map(u => nameKey(u.training_name || u.name));
    const ph = keys.map(() => "?").join(",");
    const { results: ts } = await env.TRAINING.prepare(`SELECT id,name_key,declared_at FROM trainees WHERE name_key IN (${ph})`).bind(...keys).all();
    const ids = ts.map(t => t.id);
    let passed = [];
    if (ids.length) passed = (await env.TRAINING.prepare(`SELECT trainee_id,module_id FROM results WHERE passed=1 AND trainee_id IN (${ids.map(() => "?").join(",")})`).bind(...ids).all()).results;
    for (const u of users) {
      const t = ts.find(x => x.name_key === nameKey(u.training_name || u.name));
      if (!t) { out[u.email] = { found: false, complete: false, passed: 0, total: mods.length }; continue; }
      const mine = new Set(passed.filter(p => p.trainee_id === t.id).map(p => p.module_id));
      const n = mods.filter(m => mine.has(m)).length;
      out[u.email] = { found: true, passed: n, total: mods.length, declaredAt: t.declared_at, complete: n === mods.length && !!t.declared_at };
    }
  } catch (e) { console.error("training lookup", e); }
  return out;
}

async function checksFor(env, emails) {
  if (!emails.length) return {};
  const { results } = await env.DB.prepare(`SELECT c.*, (SELECT COUNT(*) FROM documents d WHERE d.check_id=c.id) docs FROM checks c WHERE email IN (${emails.map(() => "?").join(",")})`).bind(...emails).all();
  const out = {}; for (const e of emails) out[e] = {};
  for (const r of results) { r.detail = r.detail ? JSON.parse(r.detail) : {}; out[r.email][r.type] = r; }
  return out;
}

// Why can't this person work this shift? Returns a list of plain-English reasons (empty = OK).
export function blockers(user, checks, training, shift, weekMins = 0) {
  const on = shift?.date || ukNow().date, why = [];
  if (!user.active) why.push("account is inactive");
  for (const [type, def] of Object.entries(CHECKS)) {
    if (!def.required) continue;
    const c = checks[type];
    if (!c || c.status !== "verified") why.push(`${def.label} not verified`);
    else if (c.expires_on && c.expires_on < on) why.push(`${def.label} expired ${c.expires_on}`);
  }
  if (checks.dbs?.status === "verified" && checks.dbs.detail?.barred === false) why.push("DBS does not include the children's barred list");
  if (!training?.complete) why.push("Childcare 101 training not complete");
  if (shift?.needs_l3) {
    const q = checks.qual;
    if (!(q?.status === "verified" && (user.qual_level || 0) >= 3)) why.push("shift needs a verified Level 3 qualification");
  }
  if (shift?.needs_pfa) {
    const p = checks.pfa;
    if (!(p?.status === "verified" && (!p.expires_on || p.expires_on >= on))) why.push("shift needs a valid paediatric first aid certificate");
  }
  const cap = Number(checks.rtw?.detail?.weekly_hours_limit) || 0;
  if (shift && cap) {
    const total = weekMins + (shiftMins(shift.start, shift.finish, shift.break_min) || 0);
    if (total > cap * 60) why.push(`would take them to ${(total / 60).toFixed(1)} hours that week, over their ${cap}-hour visa limit`);
  }
  return why;
}

async function weekMinsFor(env, email, date, excludeId = 0) {
  const from = mondayOf(date), to = addDays(from, 6);
  const { results } = await env.DB.prepare("SELECT start,finish,break_min FROM shifts WHERE worker_email=? AND status='filled' AND date BETWEEN ? AND ? AND id<>?").bind(email, from, to, excludeId).all();
  return results.reduce((a, s) => a + (shiftMins(s.start, s.finish, s.break_min) || 0), 0);
}
async function clashes(env, email, shift) {
  const { results } = await env.DB.prepare("SELECT id,start,finish FROM shifts WHERE worker_email=? AND status='filled' AND date=? AND id<>?").bind(email, shift.date, shift.id || 0).all();
  const s = toMin(shift.start), f = toMin(shift.finish);
  return results.some(r => toMin(r.start) < f && toMin(r.finish) > s);
}
async function bookingBlockers(env, email, shift) {
  const user = await env.DB.prepare("SELECT * FROM users WHERE email=? AND role='staff'").bind(email).first();
  if (!user) return ["not an RSS staff member"];
  const checks = (await checksFor(env, [email]))[email];
  const training = (await trainingFor(env, [user]))[email];
  const why = blockers(user, checks, training, shift, await weekMinsFor(env, email, shift.date, shift.id));
  if (await clashes(env, email, shift)) why.push("already booked on an overlapping shift");
  return why;
}

// ---------- Cloudflare Access ----------
let jwksCache = { at: 0, keys: null };
async function accessKeys(team) {
  if (jwksCache.keys && Date.now() - jwksCache.at < 3600_000) return jwksCache.keys;
  const r = await fetch(`https://${team}.cloudflareaccess.com/cdn-cgi/access/certs`);
  if (!r.ok) throw new Error("certs");
  jwksCache = { at: Date.now(), keys: (await r.json()).keys };
  return jwksCache.keys;
}
const b64u = s => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=")), c => c.charCodeAt(0));
async function verifyAccess(req, env) {
  const token = req.headers.get("cf-access-jwt-assertion");
  if (!token || !env.ACCESS_AUD) return null;
  const [h, p, sig] = token.split(".");
  if (!sig) return null;
  const header = JSON.parse(new TextDecoder().decode(b64u(h)));
  const payload = JSON.parse(new TextDecoder().decode(b64u(p)));
  const jwk = (await accessKeys(env.ACCESS_TEAM)).find(k => k.kid === header.kid);
  if (!jwk || header.alg !== "RS256") return null;
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  if (!(await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64u(sig), new TextEncoder().encode(`${h}.${p}`)))) return null;
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.includes(env.ACCESS_AUD) || payload.exp * 1000 < Date.now() || payload.iss !== `https://${env.ACCESS_TEAM}.cloudflareaccess.com`) return null;
  return String(payload.email || "").toLowerCase() || null;
}
async function whoAmI(req, env) {
  const email = env.DEV_MODE === "1" ? (req.headers.get("x-dev-email") || "").toLowerCase() : await verifyAccess(req, env).catch(() => null);
  if (!email) return null;
  const u = await env.DB.prepare("SELECT * FROM users WHERE email=?").bind(email).first();
  if (!u && email === String(env.OWNER_EMAIL || "").toLowerCase()) {
    await env.DB.prepare("INSERT INTO users(email,name,role,created_at) VALUES (?,?,'owner',?)").bind(email, "Ruth Oseme", nowIso()).run();
    return { email, name: "Ruth Oseme", role: "owner", active: 1 };
  }
  if (!u || !u.active) return { email, role: null };
  return u;
}
const audit = (env, actor, action, target, detail) =>
  env.DB.prepare("INSERT INTO audit(at,actor,action,target,detail) VALUES (?,?,?,?,?)").bind(nowIso(), actor, action, target == null ? null : String(target), detail ? JSON.stringify(detail) : null).run();

// ---------- settings ----------
const SETTING_DEFAULTS = {
  company_name: "Resourceful Staffing Support",
  company_legal: "Resourceful Ruth Solutions Ltd",
  company_address: "Unit 2B Spence Mills, Mill Lane, Leeds LS13 3HE",
  company_email: "ruth@resourcefulruth.co.uk",
  company_phone: "+44 7846 408545",
  vat_number: "",
  vat_rate: "0",
  bank_details: "",
  invoice_prefix: "RSS-",
  next_invoice: "1",
  holiday_pct: "0",
};
async function getSettings(env) {
  const { results } = await env.DB.prepare("SELECT key,value FROM settings").all();
  return { ...SETTING_DEFAULTS, ...Object.fromEntries(results.map(r => [r.key, r.value])) };
}

// ---------- shift helpers ----------
const SHIFT_COLS = `s.*, c.name client_name, u.name worker_name, u.phone worker_phone`;
const SHIFT_FROM = `FROM shifts s JOIN clients c ON c.id=s.client_id LEFT JOIN users u ON u.email=s.worker_email`;
function shiftOut(s, role) {
  const mins = shiftMins(s.start, s.finish, s.break_min);
  const actMins = s.act_start ? shiftMins(s.act_start, s.act_finish, s.act_break) : null;
  const o = { ...s, mins, actMins, offered_to: s.offered_to ? JSON.parse(s.offered_to) : null };
  if (role === "staff") { delete o.charge_rate; delete o.offered_to; }
  if (role === "manager") { delete o.pay_rate; delete o.offered_to; }
  return o;
}
function readShiftInput(b, partial = false) {
  const o = {};
  if (!partial || b.date !== undefined) { if (!validDate(b.date)) bad("Pick a valid date."); o.date = b.date; }
  if (!partial || b.start !== undefined || b.finish !== undefined) {
    if (toMin(b.start) == null || toMin(b.finish) == null) bad("Enter start and finish times like 08:00.");
    if (toMin(b.finish) <= toMin(b.start)) bad("Finish must be after start.");
    o.start = b.start; o.finish = b.finish;
  }
  if (!partial || b.break_min !== undefined) { const br = Number(b.break_min || 0); if (!(br >= 0 && br <= 240)) bad("Break must be 0–240 minutes."); o.break_min = br; }
  if (!partial || b.room !== undefined) o.room = clean(b.room, 80) || null;
  if (!partial || b.notes !== undefined) o.notes = cleanMulti(b.notes, 1000) || null;
  if (!partial || b.needs_l3 !== undefined) o.needs_l3 = b.needs_l3 ? 1 : 0;
  if (!partial || b.needs_pfa !== undefined) o.needs_pfa = b.needs_pfa ? 1 : 0;
  return o;
}

// ---------- CSV ----------
const csvCell = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
const csv = (rows, filename) => new Response(rows.map(r => r.map(csvCell).join(",")).join("\r\n"), {
  headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${filename}"`, "cache-control": "no-store" } });
const pounds = p => (p / 100).toFixed(2);

// ---------- router ----------
async function api(req, env, url) {
  const me = await whoAmI(req, env);
  if (!me) return fail(401, "You're not signed in. Reload the page to sign in with your email.");
  if (!me.role) return fail(403, `${me.email} isn't set up on the RSS hub yet. Ask RSS to add you.`);
  const p = url.pathname, method = req.method, role = me.role;
  const isAdmin = role === "owner" || role === "coordinator";
  const body = async () => { try { return await req.json(); } catch { return {}; } };
  const today = ukNow().date;
  const need = ok => { if (!ok) throw new HttpError(403, "You don't have access to that."); };
  let m;

  // ===== everyone =====
  if (p === "/api/me" && method === "GET") {
    const out = { email: me.email, name: me.name, role, today, checkTypes: CHECKS };
    if (role === "manager") out.client = await env.DB.prepare("SELECT id,name FROM clients WHERE id=?").bind(me.client_id).first();
    if (role === "staff") {
      const checks = (await checksFor(env, [me.email]))[me.email];
      const training = (await trainingFor(env, [me]))[me.email];
      Object.assign(out, { checks, training, qual_level: me.qual_level, blockers: blockers(me, checks, training, null) });
    }
    return json(out);
  }

  // ===== shifts: list =====
  if (p === "/api/shifts" && method === "GET") {
    const from = validDate(url.searchParams.get("from")) ? url.searchParams.get("from") : addDays(today, -14);
    const to = validDate(url.searchParams.get("to")) ? url.searchParams.get("to") : addDays(today, 60);
    let where = "s.date BETWEEN ? AND ?", args = [from, to];
    if (role === "manager") { where += " AND s.client_id=?"; args.push(me.client_id); }
    if (role === "staff") { where += " AND s.worker_email=?"; args.push(me.email); }
    const cid = Number(url.searchParams.get("client")); if (isAdmin && cid) { where += " AND s.client_id=?"; args.push(cid); }
    const { results } = await env.DB.prepare(`SELECT ${SHIFT_COLS} ${SHIFT_FROM} WHERE ${where} ORDER BY s.date, s.start`).bind(...args).all();
    const out = results.map(s => shiftOut(s, role));
    if (role === "manager") {
      // Agency confirmation for the nursery: the worker's checks, without documents.
      const emails = [...new Set(results.filter(s => s.worker_email).map(s => s.worker_email))];
      const ch = await checksFor(env, emails);
      const us = emails.length ? (await env.DB.prepare(`SELECT email,name,training_name,qual_level FROM users WHERE email IN (${emails.map(() => "?").join(",")})`).bind(...emails).all()).results : [];
      const tr = await trainingFor(env, us);
      for (const s of out) if (s.worker_email) {
        const c = ch[s.worker_email] || {}, u = us.find(x => x.email === s.worker_email);
        s.assurance = {
          dbs: c.dbs?.status === "verified" ? { issued: c.dbs.issued_on, update_service: !!c.dbs.detail?.update_service, verified_at: c.dbs.verified_at } : null,
          rtw: c.rtw?.status === "verified", refs: c.ref1?.status === "verified" && c.ref2?.status === "verified", id: c.id?.status === "verified",
          training: tr[s.worker_email]?.complete || false,
          qual_level: c.qual?.status === "verified" ? u?.qual_level || 0 : 0,
          pfa_expires: c.pfa?.status === "verified" ? c.pfa.expires_on || "verified" : null,
          safeguarding_expires: c.safeguarding?.status === "verified" ? c.safeguarding.expires_on || "verified" : null,
        };
      }
    }
    return json(out);
  }

  // ===== shifts: staff see open shifts they're offered =====
  if (p === "/api/open-shifts" && method === "GET") {
    need(role === "staff");
    const { results } = await env.DB.prepare(`SELECT ${SHIFT_COLS} ${SHIFT_FROM} WHERE s.status='open' AND s.date>=? ORDER BY s.date, s.start`).bind(today).all();
    const mine = results.filter(s => !s.offered_to || JSON.parse(s.offered_to).includes(me.email));
    const out = [];
    for (const s of mine) out.push({ ...shiftOut(s, "staff"), blockers: await bookingBlockers(env, me.email, s) });
    return json(out);
  }

  // ===== shifts: create =====
  if (p === "/api/shifts" && method === "POST") {
    need(isAdmin || role === "manager");
    const b = await body(), s = readShiftInput(b);
    const clientId = role === "manager" ? me.client_id : Number(b.client_id);
    const client = await env.DB.prepare("SELECT * FROM clients WHERE id=? AND active=1").bind(clientId).first();
    if (!client) bad("Pick a nursery.");
    if (s.date < today) bad("That date is in the past.");
    const count = Math.min(10, Math.max(1, Number(b.count) || 1));
    const status = isAdmin && b.publish ? "open" : "requested";
    const offered = isAdmin && Array.isArray(b.offered_to) && b.offered_to.length ? JSON.stringify(b.offered_to.map(String)) : null;
    const ids = [];
    for (let i = 0; i < count; i++) {
      const r = await env.DB.prepare(`INSERT INTO shifts(client_id,date,start,finish,break_min,room,needs_l3,needs_pfa,notes,status,offered_to,requested_by,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(clientId, s.date, s.start, s.finish, s.break_min, s.room, s.needs_l3, s.needs_pfa, s.notes, status, offered, me.email, nowIso()).run();
      ids.push(r.meta.last_row_id);
    }
    await audit(env, me.email, "shift_create", ids.join(","), { ...s, client: client.name, status });
    return json({ ids });
  }

  // ===== shifts: single =====
  if ((m = /^\/api\/shifts\/(\d+)(?:\/(\w+))?$/.exec(p))) {
    const id = Number(m[1]), action = m[2];
    const s = await env.DB.prepare(`SELECT ${SHIFT_COLS} ${SHIFT_FROM} WHERE s.id=?`).bind(id).first();
    if (!s) return fail(404, "That shift no longer exists.");
    const mineAsManager = role === "manager" && s.client_id === me.client_id;
    const mineAsStaff = role === "staff" && s.worker_email === me.email;

    if (!action && method === "GET") {
      need(isAdmin || mineAsManager || mineAsStaff);
      const out = shiftOut(s, role);
      if (isAdmin) {
        // Who could take it, and why others can't.
        const { results: staff } = await env.DB.prepare("SELECT * FROM users WHERE role='staff' AND active=1 ORDER BY name").all();
        const ch = await checksFor(env, staff.map(u => u.email)), tr = await trainingFor(env, staff);
        out.candidates = [];
        for (const u of staff) {
          const why = blockers(u, ch[u.email], tr[u.email], s, await weekMinsFor(env, u.email, s.date, s.id));
          if (await clashes(env, u.email, s)) why.push("already booked on an overlapping shift");
          out.candidates.push({ email: u.email, name: u.name, phone: u.phone, blockers: why });
        }
      }
      return json(out);
    }

    if (!action && method === "PUT") {
      need(isAdmin || (mineAsManager && s.status === "requested"));
      if (s.invoice_id) bad("This shift is on an invoice. Void the invoice first.");
      const b = await body(), upd = readShiftInput(b, true);
      if (isAdmin && b.client_id !== undefined) { if (!(await env.DB.prepare("SELECT id FROM clients WHERE id=?").bind(Number(b.client_id)).first())) bad("Pick a nursery."); upd.client_id = Number(b.client_id); }
      if (isAdmin && b.charge_rate !== undefined && s.status === "filled") upd.charge_rate = penceFrom(b.charge_rate);
      if (isAdmin && b.pay_rate !== undefined && s.status === "filled") upd.pay_rate = penceFrom(b.pay_rate);
      const next = { ...s, ...upd };
      if (s.worker_email && (upd.date || upd.start || upd.needs_l3 !== undefined || upd.needs_pfa !== undefined)) {
        const why = await bookingBlockers(env, s.worker_email, next);
        if (why.length && !b.override) return json({ error: `${s.worker_name} can't work the changed shift: ${why.join("; ")}.`, blockers: why }, 409);
      }
      const keys = Object.keys(upd);
      if (keys.length) await env.DB.prepare(`UPDATE shifts SET ${keys.map(k => k + "=?").join(",")} WHERE id=?`).bind(...keys.map(k => upd[k]), id).run();
      await audit(env, me.email, "shift_edit", id, upd);
      return json({ ok: true });
    }

    if (action === "publish" && method === "POST") {
      need(isAdmin);
      if (!["requested", "open"].includes(s.status)) bad("Only unfilled shifts can be offered to staff.");
      const b = await body();
      const offered = Array.isArray(b.offered_to) && b.offered_to.length ? JSON.stringify(b.offered_to.map(String)) : null;
      await env.DB.prepare("UPDATE shifts SET status='open', offered_to=? WHERE id=?").bind(offered, id).run();
      await audit(env, me.email, "shift_publish", id, { offered_to: b.offered_to || "all eligible" });
      return json({ ok: true });
    }

    if ((action === "assign" || action === "accept") && method === "POST") {
      const b = await body();
      const email = action === "accept" ? me.email : String(b.email || "").toLowerCase();
      if (action === "accept") {
        need(role === "staff");
        if (s.status !== "open") bad("Sorry, this shift has already been taken or is no longer available.");
        const offered = s.offered_to ? JSON.parse(s.offered_to) : null;
        if (offered && !offered.includes(me.email)) throw new HttpError(403, "This shift wasn't offered to you.");
      } else {
        need(isAdmin);
        if (!["requested", "open"].includes(s.status)) bad("This shift is already filled or cancelled. Unassign it first.");
      }
      if (s.date < today) bad("That shift is in the past.");
      const why = await bookingBlockers(env, email, s);
      if (why.length && !(action === "assign" && b.override && role === "owner")) return json({ error: `Can't book this shift: ${why.join("; ")}.`, blockers: why }, 409);
      const w = await env.DB.prepare("SELECT pay_rate FROM users WHERE email=?").bind(email).first();
      const c = await env.DB.prepare("SELECT charge_rate FROM clients WHERE id=?").bind(s.client_id).first();
      const r = await env.DB.prepare("UPDATE shifts SET status='filled', worker_email=?, filled_at=?, pay_rate=?, charge_rate=? WHERE id=? AND status IN ('requested','open') AND worker_email IS NULL")
        .bind(email, nowIso(), w?.pay_rate ?? 0, c?.charge_rate ?? 0, id).run();
      if (!r.meta.changes) bad("Sorry, someone else has just taken this shift.");
      await audit(env, me.email, action === "accept" ? "shift_accept" : "shift_assign", id, { worker: email, override: why.length ? why : undefined });
      return json({ ok: true });
    }

    if (action === "unassign" && method === "POST") {
      need(isAdmin);
      if (s.status !== "filled") bad("Nobody is booked on this shift.");
      if (s.ts_status !== "none") bad("A timesheet has been submitted for this shift, so it can't be unassigned.");
      const b = await body();
      await env.DB.prepare("UPDATE shifts SET status='open', worker_email=NULL, filled_at=NULL, pay_rate=NULL, charge_rate=NULL WHERE id=?").bind(id).run();
      await audit(env, me.email, "shift_unassign", id, { worker: s.worker_email, reason: clean(b.reason, 300) });
      return json({ ok: true });
    }

    if (action === "cancel" && method === "POST") {
      need(isAdmin || (mineAsManager && s.date >= today));
      if (s.status === "cancelled") bad("Already cancelled.");
      if (s.ts_status !== "none") bad("A timesheet has been submitted for this shift, so it can't be cancelled.");
      const b = await body();
      await env.DB.prepare("UPDATE shifts SET status='cancelled', cancelled_reason=? WHERE id=?").bind(clean(b.reason, 300) || null, id).run();
      await audit(env, me.email, "shift_cancel", id, { reason: b.reason, worker: s.worker_email });
      return json({ ok: true });
    }

    if (action === "timesheet" && method === "POST") {
      need(mineAsStaff || isAdmin);
      if (s.status !== "filled") bad("This shift isn't booked.");
      if (s.date > today) bad("You can submit hours once the shift has happened.");
      if (s.ts_status === "approved") bad("These hours have already been approved.");
      const b = await body();
      if (shiftMins(b.start, b.finish, b.break_min) == null) bad("Enter start and finish times like 08:00, finish after start.");
      const br = Number(b.break_min || 0); if (!(br >= 0 && br <= 240)) bad("Break must be 0–240 minutes.");
      await env.DB.prepare("UPDATE shifts SET ts_status='submitted', act_start=?, act_finish=?, act_break=?, ts_submitted_at=?, ts_comment=? WHERE id=?")
        .bind(b.start, b.finish, br, nowIso(), clean(b.comment, 500) || null, id).run();
      await audit(env, me.email, "timesheet_submit", id, { start: b.start, finish: b.finish, break_min: br });
      return json({ ok: true });
    }

    if ((action === "approve" || action === "query") && method === "POST") {
      need(isAdmin || mineAsManager);
      if (s.ts_status !== "submitted" && !(isAdmin && s.ts_status === "queried")) bad("There's no timesheet waiting for sign-off on this shift.");
      const b = await body();
      if (action === "query") {
        if (!clean(b.comment)) bad("Say what's wrong with the hours so the worker can correct them.");
        await env.DB.prepare("UPDATE shifts SET ts_status='queried', ts_comment=? WHERE id=?").bind(clean(b.comment, 500), id).run();
      } else {
        await env.DB.prepare("UPDATE shifts SET ts_status='approved', ts_approved_by=?, ts_approved_at=? WHERE id=?").bind(me.email, nowIso(), id).run();
      }
      await audit(env, me.email, "timesheet_" + action, id, { comment: b.comment });
      return json({ ok: true });
    }
    return fail(404, "Not found");
  }

  // ===== compliance =====
  if ((m = /^\/api\/staff\/([^/]+)\/checks\/(\w+)$/.exec(p)) && method === "PUT") {
    const email = decodeURIComponent(m[1]).toLowerCase(), type = m[2];
    need(isAdmin || (role === "staff" && email === me.email));
    if (!CHECKS[type]) bad("Unknown check.");
    const u = await env.DB.prepare("SELECT email FROM users WHERE email=? AND role='staff'").bind(email).first();
    if (!u) return fail(404, "No such staff member.");
    const b = await body(), def = CHECKS[type];
    for (const f of ["issued_on", "expires_on"]) if (b[f] && !validDate(b[f])) bad("Dates must be valid.");
    const detail = {};
    if (type === "dbs") { detail.barred = b.barred !== false; detail.update_service = !!b.update_service; if (b.last_status_check && validDate(b.last_status_check)) detail.last_status_check = b.last_status_check; }
    if (type === "rtw") { const n = Number(b.weekly_hours_limit); if (b.weekly_hours_limit !== "" && b.weekly_hours_limit != null && !(n > 0 && n <= 60)) bad("Weekly hours limit must be between 1 and 60, or blank."); if (n) detail.weekly_hours_limit = n; }
    const existing = await env.DB.prepare("SELECT * FROM checks WHERE email=? AND type=?").bind(email, type).first();
    let status = existing?.status || "pending";
    if (isAdmin && ["pending", "verified", "rejected"].includes(b.status)) status = b.status;
    else if (!isAdmin) status = "pending"; // a staff edit always needs re-checking
    const verified = status === "verified" && (existing?.status !== "verified" || isAdmin);
    const vals = [clean(b.ref, 200) || null, JSON.stringify(detail), b.issued_on || null, def.expires ? b.expires_on || null : null, cleanMulti(b.notes, 1000) || null];
    if (status === "verified" && def.expires && !vals[3] && type !== "rtw") bad("Enter the expiry date before verifying.");
    if (existing) {
      await env.DB.prepare("UPDATE checks SET ref=?, detail=?, issued_on=?, expires_on=?, notes=?, status=?, verified_by=?, verified_at=? WHERE id=?")
        .bind(...vals, status, status === "verified" ? (verified ? me.email : existing.verified_by) : null, status === "verified" ? (verified ? nowIso() : existing.verified_at) : null, existing.id).run();
    } else {
      await env.DB.prepare("INSERT INTO checks(email,type,ref,detail,issued_on,expires_on,notes,status,verified_by,verified_at,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
        .bind(email, type, ...vals, status, status === "verified" ? me.email : null, status === "verified" ? nowIso() : null, me.email, nowIso()).run();
    }
    if (isAdmin && type === "qual" && b.qual_level !== undefined) await env.DB.prepare("UPDATE users SET qual_level=? WHERE email=?").bind(Number(b.qual_level) || 0, email).run();
    await audit(env, me.email, "check_" + status, email, { type, ref: vals[0], expires_on: vals[3] });
    return json((await checksFor(env, [email]))[email]);
  }

  if ((m = /^\/api\/staff\/([^/]+)\/checks\/(\w+)\/documents$/.exec(p)) && method === "POST") {
    const email = decodeURIComponent(m[1]).toLowerCase(), type = m[2];
    need(isAdmin || (role === "staff" && email === me.email));
    let c = await env.DB.prepare("SELECT * FROM checks WHERE email=? AND type=?").bind(email, type).first();
    if (!CHECKS[type]) bad("Unknown check.");
    if (!c) {
      if (!(await env.DB.prepare("SELECT 1 FROM users WHERE email=? AND role='staff'").bind(email).first())) return fail(404, "No such staff member.");
      await env.DB.prepare("INSERT INTO checks(email,type,status,created_by,created_at) VALUES (?,?,'pending',?,?)").bind(email, type, me.email, nowIso()).run();
      c = await env.DB.prepare("SELECT * FROM checks WHERE email=? AND type=?").bind(email, type).first();
    }
    const mime = (req.headers.get("content-type") || "").split(";")[0];
    if (!/^(image\/(jpeg|png|webp)|application\/pdf)$/.test(mime)) bad("Upload a photo (JPG or PNG) or a PDF.");
    const data = await req.arrayBuffer();
    if (data.byteLength > 1_800_000) bad("That file is over 1.8 MB. Take a photo instead of a scan, or compress the PDF.");
    if (!data.byteLength) bad("That file is empty.");
    const filename = clean(decodeURIComponent(req.headers.get("x-filename") || "document"), 120);
    await env.DB.prepare("INSERT INTO documents(check_id,filename,mime,size,data,uploaded_by,uploaded_at) VALUES (?,?,?,?,?,?,?)")
      .bind(c.id, filename, mime, data.byteLength, data, me.email, nowIso()).run();
    if (!isAdmin && c.status !== "pending") await env.DB.prepare("UPDATE checks SET status='pending', verified_by=NULL, verified_at=NULL WHERE id=?").bind(c.id).run();
    await audit(env, me.email, "document_upload", email, { type, filename, size: data.byteLength });
    return json({ ok: true });
  }

  if ((m = /^\/api\/staff\/([^/]+)\/checks\/(\w+)\/documents$/.exec(p)) && method === "GET") {
    const email = decodeURIComponent(m[1]).toLowerCase();
    need(isAdmin || (role === "staff" && email === me.email));
    const { results } = await env.DB.prepare("SELECT d.id,d.filename,d.mime,d.size,d.uploaded_by,d.uploaded_at FROM documents d JOIN checks c ON c.id=d.check_id WHERE c.email=? AND c.type=? ORDER BY d.uploaded_at DESC").bind(email, m[2]).all();
    return json(results);
  }

  if ((m = /^\/api\/documents\/(\d+)$/.exec(p))) {
    const d = await env.DB.prepare("SELECT d.*, c.email FROM documents d JOIN checks c ON c.id=d.check_id WHERE d.id=?").bind(Number(m[1])).first();
    if (!d) return fail(404, "Document not found.");
    need(isAdmin || (role === "staff" && d.email === me.email));
    if (method === "DELETE") {
      need(isAdmin);
      await env.DB.prepare("DELETE FROM documents WHERE id=?").bind(d.id).run();
      await audit(env, me.email, "document_delete", d.email, { filename: d.filename });
      return json({ ok: true });
    }
    await audit(env, me.email, "document_view", d.email, { filename: d.filename });
    return new Response(d.data, { headers: { "content-type": d.mime, "content-disposition": `inline; filename="${d.filename.replace(/"/g, "")}"`, "cache-control": "private, no-store", "x-content-type-options": "nosniff" } });
  }

  // ===== admin only below =====
  need(isAdmin);

  if (p === "/api/dashboard" && method === "GET") {
    const q = (sql, ...a) => env.DB.prepare(sql).bind(...a).first().then(r => r?.n || 0);
    const { results: staff } = await env.DB.prepare("SELECT * FROM users WHERE role='staff' AND active=1").all();
    const ch = await checksFor(env, staff.map(u => u.email)), tr = await trainingFor(env, staff);
    const soon = addDays(today, 30), expiring = [], notReady = [];
    for (const u of staff) {
      const why = blockers(u, ch[u.email], tr[u.email], null);
      if (why.length) notReady.push({ email: u.email, name: u.name, blockers: why });
      for (const c of Object.values(ch[u.email])) if (c.status === "verified" && c.expires_on && c.expires_on <= soon) expiring.push({ email: u.email, name: u.name, type: c.type, label: CHECKS[c.type]?.label, expires_on: c.expires_on });
    }
    return json({
      requested: await q("SELECT COUNT(*) n FROM shifts WHERE status='requested' AND date>=?", today),
      open: await q("SELECT COUNT(*) n FROM shifts WHERE status='open' AND date>=?", today),
      next7: await q("SELECT COUNT(*) n FROM shifts WHERE status='filled' AND date BETWEEN ? AND ?", today, addDays(today, 7)),
      toSubmit: await q("SELECT COUNT(*) n FROM shifts WHERE status='filled' AND ts_status='none' AND date<?", today),
      awaiting: await q("SELECT COUNT(*) n FROM shifts WHERE ts_status='submitted'"),
      queried: await q("SELECT COUNT(*) n FROM shifts WHERE ts_status='queried'"),
      toInvoice: await q("SELECT COUNT(*) n FROM shifts WHERE ts_status='approved' AND invoice_id IS NULL AND status='filled'"),
      pendingChecks: await q("SELECT COUNT(*) n FROM checks c JOIN users u ON u.email=c.email WHERE c.status='pending' AND u.active=1"),
      staffCount: staff.length, readyCount: staff.length - notReady.length, notReady, expiring: expiring.sort((a, b) => a.expires_on.localeCompare(b.expires_on)),
    });
  }

  if (p === "/api/staff" && method === "GET") {
    const { results: staff } = await env.DB.prepare("SELECT * FROM users WHERE role='staff' ORDER BY active DESC, name").all();
    const ch = await checksFor(env, staff.map(u => u.email)), tr = await trainingFor(env, staff);
    return json(staff.map(u => ({ ...u, checks: ch[u.email], training: tr[u.email], blockers: blockers(u, ch[u.email], tr[u.email], null) })));
  }

  if (p === "/api/users" && method === "GET") {
    const { results } = await env.DB.prepare("SELECT u.*, c.name client_name FROM users u LEFT JOIN clients c ON c.id=u.client_id ORDER BY u.role, u.name").all();
    return json(results);
  }
  if (p === "/api/users" && method === "PUT") {
    const b = await body();
    const email = String(b.email || "").trim().toLowerCase();
    if (!validEmail(email)) bad("Enter a valid email address.");
    const name = clean(b.name, 100); if (!name) bad("Enter their name.");
    const r = b.role;
    if (!["owner", "coordinator", "manager", "staff"].includes(r)) bad("Pick a role.");
    if (r === "owner" && role !== "owner") bad("Only the owner can add another owner.");
    const before = await env.DB.prepare("SELECT * FROM users WHERE email=?").bind(email).first();
    if (before?.role === "owner" && role !== "owner") bad("Only the owner can change an owner.");
    if (email === me.email && r !== me.role) bad("You can't change your own role.");
    let clientId = null;
    if (r === "manager") { clientId = Number(b.client_id); if (!(await env.DB.prepare("SELECT 1 FROM clients WHERE id=?").bind(clientId).first())) bad("Pick the manager's nursery."); }
    const pay = r === "staff" ? penceFrom(b.pay_rate) : null;
    const active = email === me.email ? 1 : (b.active === false ? 0 : 1);
    await env.DB.prepare(`INSERT INTO users(email,name,role,client_id,phone,pay_rate,training_name,active,notes,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(email) DO UPDATE SET name=excluded.name, role=excluded.role, client_id=excluded.client_id, phone=excluded.phone, pay_rate=excluded.pay_rate,
      training_name=excluded.training_name, active=excluded.active, notes=excluded.notes`)
      .bind(email, name, r, clientId, clean(b.phone, 30) || null, pay, clean(b.training_name, 100) || null, active, cleanMulti(b.notes, 1000) || null, nowIso()).run();
    await audit(env, me.email, before ? "user_update" : "user_add", email, { name, role: r, client_id: clientId, pay_rate: pay, active });
    return json({ ok: true });
  }

  if (p === "/api/clients" && method === "GET") {
    const { results } = await env.DB.prepare("SELECT * FROM clients ORDER BY active DESC, name").all();
    return json(results);
  }
  if (p === "/api/clients" && method === "PUT") {
    const b = await body();
    const name = clean(b.name, 120); if (!name) bad("Enter the nursery's name.");
    if (b.invoice_email && !validEmail(b.invoice_email)) bad("Enter a valid invoice email or leave it blank.");
    const rate = penceFrom(b.charge_rate) ?? 0, days = Math.min(90, Math.max(0, Number(b.payment_days) || 14));
    const vals = [name, cleanMulti(b.address, 300) || null, clean(b.invoice_email, 120) || null, rate, days, b.active === false ? 0 : 1];
    let id = Number(b.id) || 0;
    if (id) await env.DB.prepare("UPDATE clients SET name=?,address=?,invoice_email=?,charge_rate=?,payment_days=?,active=? WHERE id=?").bind(...vals, id).run();
    else id = (await env.DB.prepare("INSERT INTO clients(name,address,invoice_email,charge_rate,payment_days,active,created_at) VALUES (?,?,?,?,?,?,?)").bind(...vals, nowIso()).run()).meta.last_row_id;
    await audit(env, me.email, b.id ? "client_update" : "client_add", id, { name, charge_rate: rate });
    return json({ id });
  }

  if (p === "/api/settings" && method === "GET") return json(await getSettings(env));
  if (p === "/api/settings" && method === "PUT") {
    need(role === "owner");
    const b = await body(), stmts = [];
    for (const k of Object.keys(SETTING_DEFAULTS)) {
      if (b[k] === undefined) continue;
      let v = cleanMulti(b[k], 600);
      if (["vat_rate", "holiday_pct"].includes(k) && !(Number(v) >= 0 && Number(v) <= 50)) bad("Percentages must be between 0 and 50.");
      if (k === "next_invoice" && !(Number.isInteger(Number(v)) && Number(v) >= 1)) bad("Next invoice number must be a whole number.");
      stmts.push(env.DB.prepare("INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(k, v));
    }
    if (stmts.length) await env.DB.batch(stmts);
    await audit(env, me.email, "settings_update", null, b);
    return json(await getSettings(env));
  }

  // ----- billing -----
  if (p === "/api/billing" && method === "GET") {
    const from = url.searchParams.get("from"), to = url.searchParams.get("to");
    if (!validDate(from) || !validDate(to)) bad("Pick a date range.");
    const { results } = await env.DB.prepare(`SELECT ${SHIFT_COLS} ${SHIFT_FROM} WHERE s.status='filled' AND s.date BETWEEN ? AND ? ORDER BY c.name, s.date, s.start`).bind(from, to).all();
    return json(results.map(s => shiftOut(s, role)));
  }
  if (p === "/api/invoices" && method === "GET") {
    const { results } = await env.DB.prepare("SELECT i.*, c.name client_name FROM invoices i JOIN clients c ON c.id=i.client_id ORDER BY i.id DESC LIMIT 200").all();
    return json(results);
  }
  if (p === "/api/invoices" && method === "POST") {
    const b = await body(), cid = Number(b.client_id);
    if (!validDate(b.from) || !validDate(b.to) || b.to < b.from) bad("Pick a valid date range.");
    const client = await env.DB.prepare("SELECT * FROM clients WHERE id=?").bind(cid).first(); if (!client) bad("Pick a nursery.");
    const { results: rows } = await env.DB.prepare("SELECT * FROM shifts WHERE client_id=? AND status='filled' AND ts_status='approved' AND invoice_id IS NULL AND date BETWEEN ? AND ? ORDER BY date").bind(cid, b.from, b.to).all();
    if (!rows.length) bad("There are no approved, un-invoiced hours for that nursery in those dates.");
    const st = await getSettings(env), vatRate = Number(st.vat_rate) || 0;
    const net = rows.reduce((a, s) => a + money(shiftMins(s.act_start, s.act_finish, s.act_break) || 0, s.charge_rate), 0);
    const vat = Math.round(net * vatRate / 100), n = Number(st.next_invoice) || 1;
    const number = `${st.invoice_prefix}${String(n).padStart(4, "0")}`;
    const r = await env.DB.prepare("INSERT INTO invoices(number,client_id,period_from,period_to,net,vat,total,vat_rate,issued_on,due_on,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
      .bind(number, cid, b.from, b.to, net, vat, net + vat, vatRate, today, addDays(today, client.payment_days), me.email).run();
    const invId = r.meta.last_row_id;
    await env.DB.batch([
      ...rows.map(s => env.DB.prepare("UPDATE shifts SET invoice_id=? WHERE id=? AND invoice_id IS NULL").bind(invId, s.id)),
      env.DB.prepare("INSERT INTO settings(key,value) VALUES ('next_invoice',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(String(n + 1)),
    ]);
    await audit(env, me.email, "invoice_create", number, { client: client.name, net, vat, shifts: rows.length });
    return json({ id: invId, number });
  }
  if ((m = /^\/api\/invoices\/(\d+)$/.exec(p)) && method === "GET") {
    const inv = await env.DB.prepare("SELECT i.*, c.name client_name, c.address client_address, c.invoice_email FROM invoices i JOIN clients c ON c.id=i.client_id WHERE i.id=?").bind(Number(m[1])).first();
    if (!inv) return fail(404, "Invoice not found.");
    const { results } = await env.DB.prepare(`SELECT ${SHIFT_COLS} ${SHIFT_FROM} WHERE s.invoice_id=? ORDER BY s.date, s.start`).bind(inv.id).all();
    return json({ ...inv, lines: results.map(s => shiftOut(s, role)), settings: await getSettings(env) });
  }
  if ((m = /^\/api\/invoices\/(\d+)\/void$/.exec(p)) && method === "POST") {
    const inv = await env.DB.prepare("SELECT * FROM invoices WHERE id=?").bind(Number(m[1])).first();
    if (!inv || inv.void) bad("That invoice doesn't exist or is already void.");
    await env.DB.batch([
      env.DB.prepare("UPDATE invoices SET void=1 WHERE id=?").bind(inv.id),
      env.DB.prepare("UPDATE shifts SET invoice_id=NULL WHERE invoice_id=?").bind(inv.id),
    ]);
    await audit(env, me.email, "invoice_void", inv.number, null);
    return json({ ok: true });
  }
  if (p === "/api/pay.csv" && method === "GET") {
    const from = url.searchParams.get("from"), to = url.searchParams.get("to");
    if (!validDate(from) || !validDate(to)) bad("Pick a date range.");
    const st = await getSettings(env), hol = Number(st.holiday_pct) || 0;
    const { results } = await env.DB.prepare(`SELECT ${SHIFT_COLS} ${SHIFT_FROM} WHERE s.status='filled' AND s.ts_status='approved' AND s.date BETWEEN ? AND ? ORDER BY u.name, s.date`).bind(from, to).all();
    const rows = [["Worker", "Email", "Date", "Nursery", "Start", "Finish", "Break (min)", "Hours", "Pay rate (£)", "Basic pay (£)", ...(hol ? [`Holiday pay ${hol}% (£)`, "Total (£)"] : []), "Approved by"]];
    for (const s of results) {
      const mins = shiftMins(s.act_start, s.act_finish, s.act_break) || 0, basic = money(mins, s.pay_rate), h = Math.round(basic * hol / 100);
      rows.push([s.worker_name, s.worker_email, s.date, s.client_name, s.act_start, s.act_finish, s.act_break, (mins / 60).toFixed(2), pounds(s.pay_rate || 0), pounds(basic), ...(hol ? [pounds(h), pounds(basic + h)] : []), s.ts_approved_by]);
    }
    await audit(env, me.email, "pay_export", `${from}..${to}`, { shifts: results.length });
    return csv(rows, `rss-pay-${from}-to-${to}.csv`);
  }
  if (p === "/api/audit" && method === "GET") {
    const { results } = await env.DB.prepare("SELECT * FROM audit ORDER BY id DESC LIMIT 300").all();
    return json(results);
  }
  return fail(404, "Not found");
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/api/")) {
      try { return await api(req, env, url); }
      catch (e) {
        if (e instanceof HttpError) return fail(e.status, e.message);
        console.error(e); return fail(500, "Something went wrong on the server. Try again in a moment.");
      }
    }
    return env.ASSETS.fetch(req);
  },
};
