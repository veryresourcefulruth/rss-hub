// End-to-end API test against `wrangler dev` with DEV_MODE=1.
const B = process.env.BASE || "http://localhost:8788";
const OWNER = "ruth@resourcefulruth.co.uk", MGR = "carley@nursery.test", ADA = "ada@student.test", BEN = "ben@student.test";
let fails = 0;
const call = async (who, path, method = "GET", body, headers = {}) => {
  const r = await fetch(B + path, { method, headers: { "x-dev-email": who, ...(body && !(body instanceof Uint8Array) ? { "content-type": "application/json" } : {}), ...headers }, body: body instanceof Uint8Array ? body : body ? JSON.stringify(body) : undefined });
  const ct = r.headers.get("content-type") || ""; return [r.status, ct.includes("json") ? await r.json() : await r.text()];
};
const ok = (cond, label, extra) => { console.log((cond ? "PASS " : "FAIL ") + label + (cond ? "" : " " + JSON.stringify(extra))); if (!cond) fails++; };
const d = n => { const t = new Date(); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };

let [s, r] = await call("stranger@x.test", "/api/me"); ok(s === 403, "unknown email refused", r);
[s, r] = await call(OWNER, "/api/clients", "PUT", { name: "New Beginnings Leeds", charge_rate: "18.50", invoice_email: "acc@nb.test", payment_days: 14 }); ok(s === 200, "add nursery", r); const cid = r.id;
[s, r] = await call(OWNER, "/api/users", "PUT", { email: MGR, name: "Carley Roberts", role: "manager", client_id: cid }); ok(s === 200, "add manager", r);
for (const [e, n] of [[ADA, "Ada Obi"], [BEN, "Ben Lee"]]) { [s, r] = await call(OWNER, "/api/users", "PUT", { email: e, name: n, role: "staff", pay_rate: "12.50", phone: "07700900000" }); ok(s === 200, "add staff " + n, r); }

// manager requests cover
[s, r] = await call(MGR, "/api/shifts", "POST", { date: d(2), start: "08:00", finish: "16:00", break_min: 30, room: "Baby Room", needs_pfa: true, count: 1 }); ok(s === 200, "manager requests cover", r); const sid = r.ids[0];
[s, r] = await call(MGR, "/api/shifts", "POST", { client_id: 999, date: d(3), start: "08:00", finish: "16:00" }); ok(s === 200, "manager client forced to own", r);
[s, r] = await call(ADA, "/api/dashboard"); ok(s === 403, "staff blocked from dashboard", r);

// Ada not ready: can't be assigned
[s, r] = await call(OWNER, `/api/shifts/${sid}/assign`, "POST", { email: ADA }); ok(s === 409 && r.blockers.length >= 6, "unverified worker can't be booked", r);
// Ada uploads her own DBS (pending) — still not verified
[s, r] = await call(ADA, `/api/staff/${ADA}/checks/dbs`, "PUT", { ref: "001234567890", issued_on: "2026-09-01", status: "verified", update_service: true }); ok(s === 200 && r.dbs.status === "pending", "staff can't self-verify", r.dbs);
[s, r] = await call(ADA, `/api/staff/${ADA}/checks/dbs/documents`, "POST", new Uint8Array([0x25, 0x50, 0x44, 0x46]), { "content-type": "application/pdf", "x-filename": "dbs.pdf" }); ok(s === 200, "staff uploads document", r);
[s, r] = await call(BEN, `/api/staff/${ADA}/checks/dbs/documents`); ok(s === 403, "other staff can't see Ada's documents", r);
[s, r] = await call(MGR, `/api/staff/${ADA}/checks/dbs/documents`); ok(s === 403, "manager can't see documents", r);
// owner verifies everything for Ada, PFA needed for this shift
const verify = async (who, type, extra = {}) => call(OWNER, `/api/staff/${who}/checks/${type}`, "PUT", { ref: "x", issued_on: "2026-01-01", status: "verified", ...extra });
for (const t of ["dbs", "rtw", "id", "ref1", "ref2", "terms"]) { [s, r] = await verify(ADA, t, t === "rtw" ? { weekly_hours_limit: 20, expires_on: d(300) } : {}); ok(s === 200 && r[t].status === "verified", "verify " + t, r[t] || r); }
[s, r] = await call(OWNER, `/api/shifts/${sid}/assign`, "POST", { email: ADA }); ok(s === 409 && r.blockers.some(b => /first aid/.test(b)), "PFA requirement enforced", r);
[s, r] = await verify(ADA, "pfa", {}); ok(s === 400, "PFA needs expiry before verifying", r);
[s, r] = await verify(ADA, "pfa", { expires_on: d(2) }); ok(s === 200, "PFA verified (expires on shift day)", r);
// Ben: training incomplete
for (const t of ["dbs", "rtw", "id", "ref1", "ref2", "terms"]) await verify(BEN, t);
[s, r] = await call(OWNER, `/api/shifts/${sid}`); const cand = Object.fromEntries(r.candidates.map(c => [c.email, c.blockers]));
ok(cand[ADA].length === 0, "Ada eligible", cand[ADA]); ok(cand[BEN].some(b => /training/.test(b)), "Ben blocked by training", cand[BEN]);
// offer to all, Ben can't accept, Ada accepts
[s, r] = await call(OWNER, `/api/shifts/${sid}/publish`, "POST", {}); ok(s === 200, "publish", r);
[s, r] = await call(BEN, "/api/open-shifts"); ok(r.length >= 1 && r[0].blockers.length, "Ben sees shift with reasons", r);
[s, r] = await call(BEN, `/api/shifts/${sid}/accept`, "POST", {}); ok(s === 409, "Ben can't accept", r);
[s, r] = await call(ADA, `/api/shifts/${sid}/accept`, "POST", {}); ok(s === 200, "Ada accepts", r);
[s, r] = await call(ADA, `/api/shifts/${sid}/accept`, "POST", {}); ok(s === 400, "can't accept twice", r);
// visa cap: 20h/week; shift is 7.5h. Two more 7.5h shifts in same week -> third over cap
const wk = d(2);
[s, r] = await call(OWNER, "/api/shifts", "POST", { client_id: cid, date: wk, start: "17:00", finish: "23:00", break_min: 0, publish: true }); const s2 = r.ids[0];
[s, r] = await call(OWNER, `/api/shifts/${s2}/assign`, "POST", { email: ADA }); ok(s === 200, "second shift same day, no overlap", r);
[s, r] = await call(OWNER, "/api/shifts", "POST", { client_id: cid, date: wk, start: "07:00", finish: "09:00", publish: true }); const s3 = r.ids[0];
[s, r] = await call(OWNER, `/api/shifts/${s3}/assign`, "POST", { email: ADA }); ok(s === 409 && r.blockers.some(b => /overlapping/.test(b)), "overlap blocked", r);
[s, r] = await call(OWNER, `/api/shifts/${s3}`, "PUT", { date: d(3), start: "08:00", finish: "16:00", break_min: 0 }); 
[s, r] = await call(OWNER, `/api/shifts/${s3}/assign`, "POST", { email: ADA }); ok(s === 409 && r.blockers.some(b => /visa limit/.test(b)), "visa weekly hours cap enforced (if same week)", r);
// manager sees assurance, not pay
[s, r] = await call(MGR, "/api/shifts"); const ms = r.find(x => x.id === sid); ok(ms.assurance && ms.assurance.dbs && ms.assurance.training && ms.pay_rate === undefined, "manager sees checks summary, not pay", ms);
[s, r] = await call(ADA, "/api/shifts"); ok(r.every(x => x.charge_rate === undefined), "staff don't see charge rate", r[0]);
// timesheet: can't submit future shift
[s, r] = await call(ADA, `/api/shifts/${sid}/timesheet`, "POST", { start: "08:00", finish: "16:00", break_min: 30 }); ok(s === 400, "can't submit hours before shift", r);
// make a past shift via owner-created shift in the past is blocked; simulate by moving date back directly
console.log("(moving shift into the past for timesheet test)");
process.exitCode = fails ? 1 : 0;
console.log(fails ? `${fails} FAILED` : "ALL PASSED (part 1)");
export { sid, cid };
