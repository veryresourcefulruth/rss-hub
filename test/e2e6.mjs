// Sign-in station (nursery iPad with PINs), manager confirmation, phone backup with location check, arrivals.
import { execSync } from "node:child_process";
const B = "http://localhost:8788", OWNER = "ruth@resourcefulruth.co.uk";
const M1 = "mgr6@nursery.test", M2 = "mgr6b@nursery.test", W1 = "wes6@student.test", W2 = "val6@student.test";
let fails = 0;
const call = async (who, path, method = "GET", body) => { const r = await fetch(B + path, { method, headers: { "x-dev-email": who, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined }); const ct = r.headers.get("content-type") || ""; return [r.status, ct.includes("json") ? await r.json() : await r.text()]; };
const ok = (c, l, x) => { console.log((c ? "PASS " : "FAIL ") + l + (c ? "" : " " + JSON.stringify(x)?.slice(0, 300))); if (!c) fails++; };
const sql = q => execSync(`npx wrangler d1 execute rss-hub --local --json --command ${JSON.stringify(q)}`, { cwd: new URL("..", import.meta.url).pathname, stdio: ["ignore", "pipe", "ignore"] }).toString();
const uk = (offsetMin = 0) => { const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(Date.now() + offsetMin * 60000)).map(x => [x.type, x.value])); return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` }; };
let s, r;
[s, r] = await call(OWNER, "/api/clients", "PUT", { name: "Station Nursery", address: "1 Test Street, Leeds", charge_rate: "18.00" }); const cid = r.id;
[s, r] = await call(OWNER, "/api/clients", "PUT", { name: "Other Nursery", charge_rate: "18.00" }); const cid2 = r.id;
await call(OWNER, "/api/users", "PUT", { email: M1, name: "Mia Manager", role: "manager", client_id: cid });
await call(OWNER, "/api/users", "PUT", { email: M2, name: "Other Manager", role: "manager", client_id: cid2 });
for (const [e, n] of [[W1, "Wes Lane"], [W2, "Val Moss"]]) await call(OWNER, "/api/users", "PUT", { email: e, name: n, role: "staff", pay_rate: "13.00" });
const today = uk().date, tomorrow = uk(24 * 60).date;
const ins = (w, date, start, finish) => sql(`INSERT INTO shifts(client_id,date,start,finish,break_min,status,worker_email,pay_rate,charge_rate,created_at,filled_at) VALUES (${cid},'${date}','${start}','${finish}',30,'filled','${w}',1300,1800,datetime('now'),datetime('now'))`);
ins(W1, today, uk(-150).time, uk(180).time); ins(W2, today, uk(-30).time, uk(240).time); ins(W1, tomorrow, "08:00", "16:00");
const ids = JSON.parse(sql(`SELECT id,worker_email,date FROM shifts WHERE client_id=${cid} ORDER BY id`))[0].results;
const A = ids[0].id, Bv = ids[1].id, C = ids[2].id;

// PINs
[s, r] = await call(W1, "/api/me/pin", "PUT", { pin: "1111" }); ok(s === 400, "too-easy PIN rejected", r);
[s, r] = await call(W1, "/api/me/pin", "PUT", { pin: "12a4" }); ok(s === 400, "PIN must be 4 numbers", r);
[s, r] = await call(W1, "/api/me/pin", "PUT", { pin: "4826" }); ok(s === 200, "staff sets PIN", r);
[s, r] = await call(W1, "/api/me"); ok(r.has_pin === true, "has_pin shown to staff", r.has_pin);
// station access
[s, r] = await call(W1, "/api/station"); ok(s === 403, "staff can't open the station", s);
[s, r] = await call(OWNER, "/api/station"); ok(s === 400, "office must choose a nursery", r);
[s, r] = await call(M1, "/api/station"); ok(s === 200 && r.shifts.length === 2 && r.shifts.find(x => x.id === A)?.has_pin && !r.shifts.find(x => x.id === Bv)?.has_pin && !JSON.stringify(r).includes("hash"), "manager sees today's booked staff (no PIN data leaked)", r);
// sign in with PIN
[s, r] = await call(M1, "/api/station/clock", "POST", { shift_id: A, action: "in", pin: "0000" }); ok(s === 400 && /isn't right/.test(r.error), "wrong PIN refused", r);
[s, r] = await call(M2, "/api/station/clock", "POST", { shift_id: A, action: "in", pin: "4826" }); ok(s === 400 && /isn't at this nursery/.test(r.error), "another nursery's iPad can't sign them in", r);
[s, r] = await call(M1, "/api/station/clock", "POST", { shift_id: A, action: "in", pin: "4826" }); ok(s === 200 && r.time, "signs in with PIN", r);
[s, r] = await call(M1, "/api/station/clock", "POST", { shift_id: A, action: "in", pin: "4826" }); ok(s === 400 && /Already signed in/.test(r.error), "can't sign in twice", r);
[s, r] = await call(M1, "/api/station/clock", "POST", { shift_id: C, action: "in", pin: "4826" }); ok(s === 400, "tomorrow's shift isn't on today's station", r);
// manager confirms for someone without a PIN
[s, r] = await call(M1, "/api/station/clock", "POST", { shift_id: Bv, action: "in" }); ok(s === 400 && /hasn't set a sign-in PIN/.test(r.error), "no PIN and no manager confirm refused", r);
// arrivals before Val signs in: she's late
[s, r] = await call(OWNER, "/api/dashboard"); const arr = r.arrivals;
ok(arr.find(a => a.id === Bv)?.late === true && arr.find(a => a.id === A)?.clock_in_at && !arr.find(a => a.id === A).late, "office sees who has arrived and who is late", arr);
[s, r] = await call(M1, "/api/station/clock", "POST", { shift_id: Bv, action: "in", manager_confirm: true }); ok(s === 200, "manager confirms arrival", r);
[s, r] = await call(M1, `/api/shifts?from=${today}`); ok(r.find(x => x.id === Bv)?.clock_in_by === "manager", "recorded as manager-confirmed", r.find(x => x.id === Bv));
// lockout after 5 wrong PINs
for (let i = 0; i < 5; i++) await call(M1, "/api/station/clock", "POST", { shift_id: A, action: "out", pin: "9999" });
[s, r] = await call(M1, "/api/station/clock", "POST", { shift_id: A, action: "out", pin: "4826" }); ok(s === 400 && /Too many/.test(r.error), "locked after 5 wrong PINs", r);
sql(`DELETE FROM pin_fails WHERE email='${W1}'`);
sql(`UPDATE shifts SET clock_in_at=strftime('%Y-%m-%dT%H:%M:%fZ','now','-120 minutes') WHERE id=${A}`); // pretend they arrived 2 hours ago
// break out / break in
[s, r] = await call(M1, "/api/station/clock", "POST", { shift_id: A, action: "break_in", pin: "4826" }); ok(s === 400 && /Not on a break/.test(r.error), "can't end a break that hasn't started", r);
[s, r] = await call(M1, "/api/station/clock", "POST", { shift_id: A, action: "break_out", pin: "4826" }); ok(s === 200, "starts break with PIN", r);
[s, r] = await call(M1, "/api/station/clock", "POST", { shift_id: A, action: "break_out", pin: "4826" }); ok(s === 400 && /Already on break/.test(r.error), "can't start two breaks at once", r);
[s, r] = await call(M1, "/api/station"); ok(r.shifts.find(x => x.id === A).breaks.length === 1 && !r.shifts.find(x => x.id === A).breaks[0].in, "station shows them on break", r.shifts.find(x => x.id === A).breaks);
sql(`UPDATE shifts SET breaks=json_array(json_object('out',strftime('%Y-%m-%dT%H:%M:%fZ','now','-22 minutes'),'in',NULL,'by','pin')) WHERE id=${A}`); // the break began 22 minutes ago
[s, r] = await call(M1, "/api/station/clock", "POST", { shift_id: A, action: "break_in", pin: "4826" }); ok(s === 200, "ends break with PIN", r);
// sign out fills the timesheet
[s, r] = await call(M1, "/api/station/clock", "POST", { shift_id: A, action: "out", pin: "4826" }); ok(s === 200, "signs out with PIN", r);
[s, r] = await call(W1, `/api/shifts?from=${today}`); const a = r.find(x => x.id === A);
ok(a.ts_status === "submitted" && a.act_start && a.act_finish && /From sign-in/.test(a.ts_comment), "timesheet filled in and sent for approval", a);
ok(a.act_break >= 21 && a.act_break <= 23 && /Break /.test(a.ts_comment), "timesheet uses the break actually taken (22 min), not the booked 30", { b: a.act_break, c: a.ts_comment });
[s, r] = await call(M1, "/api/station/clock", "POST", { shift_id: A, action: "out", pin: "4826" }); ok(s === 400 && /Already signed out/.test(r.error), "can't sign out twice", r);
// phone backup with location check
[s, r] = await call(M1, "/api/station/location", "POST", { lat: 53.8008, lng: -1.5491, acc: 20 }); ok(s === 200, "manager saves the nursery's location from the iPad", r);
[s, r] = await call(W2, `/api/shifts/${Bv}/clock`, "POST", { action: "out" }); ok(s === 400 && /location/.test(r.error), "phone needs location", r);
[s, r] = await call(W2, `/api/shifts/${Bv}/clock`, "POST", { action: "out", lat: 51.5074, lng: -0.1278, acc: 30 }); ok(s === 400 && /km from Station Nursery/.test(r.error), "phone far away refused", r);
[s, r] = await call(W1, `/api/shifts/${Bv}/clock`, "POST", { action: "out", lat: 53.8009, lng: -1.5492, acc: 30 }); ok(s === 403, "can't sign out someone else's shift", s);
[s, r] = await call(W2, `/api/shifts/${Bv}/clock`, "POST", { action: "out", lat: 53.8010, lng: -1.5493, acc: 30 }); ok(s === 200, "phone at the nursery signs out", r);
[s, r] = await call(OWNER, `/api/shifts?from=${today}`); const b = r.find(x => x.id === Bv); ok(b.clock_out_by === "phone" && /m from nursery/.test(b.clock_note), "phone sign-out recorded with distance", b);
[s, r] = await call(W1, `/api/shifts/${C}/clock`, "POST", { action: "in", lat: 53.8008, lng: -1.5491, acc: 10 }); ok(s === 400 && /day of the shift/.test(r.error), "can't sign in for tomorrow", r);
// tidy up
sql(`DELETE FROM shifts WHERE client_id IN (${cid},${cid2})`);
for (const e of [M1, M2, W1, W2]) await call(OWNER, `/api/users/${e}`, "DELETE");
console.log(fails ? `${fails} FAILED` : "ALL PASSED"); process.exit(fails ? 1 : 0);
