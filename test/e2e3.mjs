// v2 features: confirm/decline, quals, training expiry, manager staff view, rename/delete.
const B = "http://localhost:8788", OWNER = "ruth@resourcefulruth.co.uk", MGR = "carley@nursery.test", ADA = "ada@student.test", BEN = "ben@student.test";
let fails = 0;
const call = async (who, path, method = "GET", body) => { const r = await fetch(B + path, { method, headers: { "x-dev-email": who, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined }); const ct = r.headers.get("content-type") || ""; return [r.status, ct.includes("json") ? await r.json() : await r.text()]; };
const ok = (c, l, x) => { console.log((c ? "PASS " : "FAIL ") + l + (c ? "" : " " + JSON.stringify(x))); if (!c) fails++; };
const d = n => { const t = new Date(); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
let [s, r] = await call(OWNER, "/api/clients"); const cid = r.find(c => c.name === "New Beginnings Leeds").id;
// assign -> pending
[s, r] = await call(OWNER, "/api/shifts", "POST", { client_id: cid, date: d(10), start: "08:00", finish: "12:00" }); const sid = r.ids[0];
[s, r] = await call(OWNER, `/api/shifts/${sid}/assign`, "POST", { email: ADA }); ok(s === 200 && r.pending, "RSS asks Ada -> pending", r);
[s, r] = await call(MGR, "/api/shifts"); let ms = r.find(x => x.id === sid); ok(ms.status === "pending" && ms.worker_name === "Ada Obi" && ms.assurance, "manager sees pending with worker + checks", ms);
[s, r] = await call(OWNER, `/api/shifts/${sid}/assign`, "POST", { email: BEN }); ok(s === 400, "can't double-assign a pending shift", r);
[s, r] = await call(BEN, `/api/shifts/${sid}/accept`, "POST", {}); ok(s === 400, "other staff can't grab pending shift", r);
[s, r] = await call(ADA, `/api/shifts/${sid}/decline`, "POST", { reason: "Lecture" }); ok(s === 200, "Ada declines", r);
[s, r] = await call(OWNER, `/api/shifts/${sid}`); ok(r.status === "requested" && !r.worker_email && r.declined[0].reason === "Lecture", "back to requested with decline recorded", r);
[s, r] = await call(MGR, "/api/shifts"); ms = r.find(x => x.id === sid); ok(ms.declined.length === 1 && ms.declined[0].name === "Ada Obi", "manager sees who declined", ms.declined);
[s, r] = await call(OWNER, `/api/shifts/${sid}/assign`, "POST", { email: ADA });
[s, r] = await call(ADA, `/api/shifts/${sid}/accept`, "POST", {}); ok(s === 200, "Ada confirms", r);
[s, r] = await call(OWNER, `/api/shifts/${sid}`); ok(r.status === "filled" && r.pay_rate === 1250 && r.charge_rate === 1850, "confirmed -> booked with rates", r);
// quals
[s, r] = await call(ADA, `/api/staff/${ADA}/quals`, "POST", { level: "MSc", subject: "Early Childhood Education", institution: "Leeds Beckett", status: "in_progress", year: "2027", verified: true }); ok(s === 200 && r.length === 1 && r[0].verified === 0, "staff adds qual (not self-verified)", r);
[s, r] = await call(ADA, `/api/staff/${ADA}/quals`, "POST", { level: "Degree", subject: "x", status: "completed" }); ok(s === 400, "invalid level rejected", r);
const qid = (await call(OWNER, "/api/staff"))[1].find(u => u.email === ADA).quals[0].id;
[s, r] = await call(OWNER, `/api/quals/${qid}`, "PUT", { level: "MSc", subject: "Early Childhood Education", institution: "Leeds Beckett", status: "in_progress", year: "2027", verified: true }); ok(s === 200 && r[0].verified === 1, "RSS verifies qual", r);
[s, r] = await call(BEN, `/api/quals/${qid}`, "DELETE"); ok(s === 403, "other staff can't delete Ada's qual", r);
// training with expiry -> alerts
[s, r] = await call(OWNER, `/api/staff/${ADA}/checks/food`, "PUT", { ref: "Highfield", issued_on: d(-355), status: "verified" }); ok(s === 200, "food hygiene recorded", r);
[s, r] = await call(OWNER, `/api/staff/${ADA}/checks/pfa`, "PUT", { ref: "x", issued_on: d(-370), status: "verified" });
[s, r] = await call(ADA, "/api/me"); ok(r.expiring.some(x => x.type === "food" && !x.expired) && r.expiring.some(x => x.type === "pfa" && x.expired), "staff see due + expired training", r.expiring);
[s, r] = await call(OWNER, "/api/dashboard"); ok(r.expiring.some(x => x.type === "pfa" && x.expired) && r.pending >= 0, "coordinator dashboard alerts", r.expiring);
// manager our staff
[s, r] = await call(MGR, "/api/our-staff"); const a = r.find(x => x.name === "Ada Obi"); ok(a && a.quals[0].level === "MSc" && a.training.some(t => t.type === "food") && a.email === undefined, "manager Our staff: quals + training, no email", a);
[s, r] = await call(ADA, "/api/our-staff"); ok(s === 403, "staff can't use our-staff", r);
// rename + delete
[s, r] = await call(OWNER, `/api/users/${ADA}/email`, "POST", { email: "ada.obi@uni.test" }); ok(s === 200, "change Ada's email", r);
[s, r] = await call("ada.obi@uni.test", "/api/me"); ok(s === 200 && r.checks.dbs && r.quals.length === 1, "Ada signs in with new email, records kept", r);
[s, r] = await call(OWNER, `/api/shifts/${sid}`); ok(r.worker_email === "ada.obi@uni.test", "shifts follow new email", r.worker_email);
[s, r] = await call(OWNER, `/api/users/ada.obi@uni.test`, "DELETE"); ok(s === 400 && /Untick Active/.test(r.error), "can't delete someone with shift history", r);
await call(OWNER, "/api/users", "PUT", { email: "temp@x.test", name: "Temp Person", role: "staff" });
await call(OWNER, `/api/staff/temp@x.test/checks/dbs`, "PUT", { ref: "1", status: "pending" });
[s, r] = await call(OWNER, `/api/users/temp@x.test`, "DELETE"); ok(s === 200, "delete person with no shifts", r);
[s, r] = await call("temp@x.test", "/api/me"); ok(s === 403, "deleted person can't sign in", r);
[s, r] = await call(OWNER, `/api/users/${OWNER}`, "DELETE"); ok(s === 400, "can't delete self", r);
console.log(fails ? `${fails} FAILED` : "ALL PASSED (v2)"); process.exitCode = fails ? 1 : 0;
