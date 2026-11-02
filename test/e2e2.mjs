const B = "http://localhost:8788", OWNER = "ruth@resourcefulruth.co.uk", MGR = "carley@nursery.test", ADA = "ada@student.test", OTHER = "mgr2@other.test";
let fails = 0;
const call = async (who, path, method = "GET", body) => { const r = await fetch(B + path, { method, headers: { "x-dev-email": who, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined }); const ct = r.headers.get("content-type") || ""; return [r.status, ct.includes("json") ? await r.json() : await r.text()]; };
const ok = (c, l, x) => { console.log((c ? "PASS " : "FAIL ") + l + (c ? "" : " " + JSON.stringify(x))); if (!c) fails++; };
let [s, r] = await call(ADA, "/api/shifts?from=2026-01-01");
const mine = r.filter(x => x.status === "filled"); const [a, b] = mine;
// second nursery manager can't touch it
[s, r] = await call(OWNER, "/api/clients", "PUT", { name: "Other Nursery", charge_rate: "20" }); const c2 = r.id;
await call(OWNER, "/api/users", "PUT", { email: OTHER, name: "Other Mgr", role: "manager", client_id: c2 });
[s, r] = await call(ADA, `/api/shifts/${a.id}/timesheet`, "POST", { start: "08:00", finish: "16:30", break_min: 30, comment: "Stayed late for handover" }); ok(s === 200, "Ada submits hours", r);
[s, r] = await call(OTHER, `/api/shifts/${a.id}/approve`, "POST", {}); ok(s === 403, "other nursery can't approve", r);
[s, r] = await call(MGR, `/api/shifts/${a.id}/query`, "POST", { comment: "" }); ok(s === 400, "query needs a reason", r);
[s, r] = await call(MGR, `/api/shifts/${a.id}/query`, "POST", { comment: "Left at 16:00" }); ok(s === 200, "manager queries", r);
[s, r] = await call(ADA, `/api/shifts/${a.id}/timesheet`, "POST", { start: "08:00", finish: "16:00", break_min: 30 }); ok(s === 200, "Ada resubmits", r);
[s, r] = await call(MGR, `/api/shifts/${a.id}/approve`, "POST", {}); ok(s === 200, "manager approves", r);
[s, r] = await call(ADA, `/api/shifts/${a.id}/timesheet`, "POST", { start: "08:00", finish: "18:00", break_min: 0 }); ok(s === 400, "can't change approved hours", r);
[s, r] = await call(ADA, `/api/shifts/${b.id}/timesheet`, "POST", { start: "17:00", finish: "23:00", break_min: 0 }); 
[s, r] = await call(OWNER, `/api/shifts/${b.id}/approve`, "POST", {}); ok(s === 200, "RSS approves on nursery's behalf", r);
[s, r] = await call(OWNER, `/api/shifts/${a.id}/unassign`, "POST", {}); ok(s === 400, "can't unassign after timesheet", r);
// invoice: 7.5h + 6h = 13.5h @ £18.50 = £249.75
const y = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
[s, r] = await call(OWNER, "/api/settings", "PUT", { vat_rate: "20", bank_details: "Sort code 00-00-00" }); ok(s === 200, "owner saves settings", r);
[s, r] = await call(OWNER, "/api/invoices", "POST", { client_id: a.client_id, from: y, to: y }); ok(s === 200 && r.number === "RSS-0001", "invoice created", r); const inv = r.id;
[s, r] = await call(OWNER, `/api/invoices/${inv}`); ok(r.net === 24975 && r.vat === 4995 && r.total === 29970 && r.lines.length === 2, "invoice maths correct (£249.75 + VAT)", { net: r.net, vat: r.vat, total: r.total });
[s, r] = await call(OWNER, "/api/invoices", "POST", { client_id: a.client_id, from: y, to: y }); ok(s === 400, "no double billing", r);
[s, r] = await call(OWNER, `/api/shifts/${a.id}`, "PUT", { room: "x" }); ok(s === 400, "invoiced shift locked", r);
[s, r] = await call(OWNER, `/api/invoices/${inv}/void`, "POST", {}); ok(s === 200, "void invoice", r);
[s, r] = await call(OWNER, "/api/invoices", "POST", { client_id: a.client_id, from: y, to: y }); ok(s === 200 && r.number === "RSS-0002", "re-invoice after void", r);
[s, r] = await call(OWNER, `/api/pay.csv?from=${y}&to=${y}`); ok(s === 200 && r.includes("Ada Obi") && r.includes("93.75") && r.includes("75.00"), "pay CSV (7.5h & 6h @ £12.50)", r);
[s, r] = await call(MGR, "/api/pay.csv?from=2026-01-01&to=2026-12-31"); ok(s === 403, "manager can't export pay", r);
[s, r] = await call(OWNER, "/api/dashboard"); ok(s === 200 && r.staffCount === 2 && r.readyCount === 1, "dashboard counts", r);
[s, r] = await call(OWNER, "/api/audit"); ok(r.length > 20, "audit log written", r.length);
// coordinator can't change settings or add owner
await call(OWNER, "/api/users", "PUT", { email: "coord@rss.test", name: "Coord", role: "coordinator" });
[s, r] = await call("coord@rss.test", "/api/settings", "PUT", { vat_rate: "0" }); ok(s === 403, "coordinator can't change settings", r);
[s, r] = await call("coord@rss.test", "/api/users", "PUT", { email: "x@y.test", name: "X", role: "owner" }); ok(s === 400, "coordinator can't add owner", r);
[s, r] = await call("coord@rss.test", "/api/users", "PUT", { email: OWNER, name: "Hacked", role: "staff" }); ok(s === 400, "coordinator can't demote owner", r);
console.log(fails ? `${fails} FAILED` : "ALL PASSED (part 2)"); process.exitCode = fails ? 1 : 0;
