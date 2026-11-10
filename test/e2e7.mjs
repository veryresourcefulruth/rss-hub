// Weekly availability: staff send next week's availability by Tuesday; RSS sees it on the dashboard and when filling shifts.
import { execSync } from "node:child_process";
const B = "http://localhost:8788", OWNER = "ruth@resourcefulruth.co.uk", MGR = "mgr7@nursery.test";
const W1 = "amy7@student.test", W2 = "ben7@student.test";
let fails = 0;
const call = async (who, path, method = "GET", body) => { const r = await fetch(B + path, { method, headers: { "x-dev-email": who, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined }); const ct = r.headers.get("content-type") || ""; return [r.status, ct.includes("json") ? await r.json() : await r.text()]; };
const ok = (c, l, x) => { console.log((c ? "PASS " : "FAIL ") + l + (c ? "" : " " + JSON.stringify(x)?.slice(0, 300))); if (!c) fails++; };
const sql = q => execSync(`npx wrangler d1 execute rss-hub --local --json --command ${JSON.stringify(q)}`, { cwd: new URL("..", import.meta.url).pathname, stdio: ["ignore", "pipe", "ignore"] }).toString();
const addDays = (d, n) => { const t = new Date(d + "T12:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
let s, r;
[s, r] = await call(OWNER, "/api/clients", "PUT", { name: "Avail Nursery", charge_rate: "18.00" }); const cid = r.id;
await call(OWNER, "/api/users", "PUT", { email: MGR, name: "Max Manager", role: "manager", client_id: cid });
for (const [e, n] of [[W1, "Amy Avail"], [W2, "Ben Busy"]]) await call(OWNER, "/api/users", "PUT", { email: e, name: n, role: "staff", pay_rate: "13.00" });

[s, r] = await call(W1, "/api/me"); const due = r.availability_due;
ok(due && due.submitted === false && new Date(due.week_start + "T12:00:00Z").getUTCDay() === 1, "staff told next week's availability is due", due);
ok(due.deadline_date === addDays(due.week_start, -6) && new Date(due.deadline_date + "T12:00:00Z").getUTCDay() === 2, "deadline is the Tuesday before", due);
const week = due.week_start, days = Array.from({ length: 7 }, (_, i) => addDays(week, i));

[s, r] = await call(W1, "/api/availability?week=" + week); ok(s === 200 && r.days.length === 7 && r.is_due_week && !r.submitted_at, "staff reads an empty week", r);
[s, r] = await call(W1, "/api/availability", "PUT", { week_start: addDays(week, 1), days: [] }); ok(s === 400, "week must start on a Monday", r);
[s, r] = await call(W1, "/api/availability", "PUT", { week_start: week, days: days.slice(0, 6).map(d => ({ date: d, slot: "all" })) }); ok(s === 400 && /Choose an option/.test(r.error), "every day needs an answer", r);
[s, r] = await call(W1, "/api/availability", "PUT", { week_start: week, days: days.map((d, i) => ({ date: d, slot: i === 0 ? "times" : "all", start: "14:00", finish: "09:00" })) }); ok(s === 400 && /finish must be after/.test(r.error), "set times must make sense", r);
const amyDays = days.map((d, i) => i === 0 ? { date: d, slot: "am" } : i === 1 ? { date: d, slot: "times", start: "09:00", finish: "15:00" } : i === 2 ? { date: d, slot: "none" } : { date: d, slot: "all" });
[s, r] = await call(W1, "/api/availability", "PUT", { week_start: week, days: amyDays }); ok(s === 200, "staff sends availability", r);
[s, r] = await call(W1, "/api/me"); ok(r.availability_due.submitted === true, "reminder clears once sent", r.availability_due);
[s, r] = await call(W1, "/api/availability?week=" + week); ok(r.submitted_at && r.days[0].slot === "am" && r.days[1].start === "09:00" && r.days[2].slot === "none", "availability saved day by day", r.days);
[s, r] = await call(W2, "/api/availability?week=" + week); ok(r.days.every(d => d.slot === null), "one person can't see another's", r.days);
[s, r] = await call(MGR, "/api/availability?week=" + week); ok(s === 403, "nursery managers can't see availability", s);
[s, r] = await call(W1, "/api/availability", "PUT", { week_start: addDays(week, 35), days: [] }); ok(s === 400 && /four weeks/.test(r.error), "no more than four weeks ahead", r);

// RSS view
[s, r] = await call(OWNER, "/api/availability/team?week=" + week);
const amy = r.staff?.find(x => x.email === W1), ben = r.staff?.find(x => x.email === W2);
ok(s === 200 && amy?.submitted_at && amy.days[2].slot === "none" && ben && !ben.submitted_at, "RSS sees the week for everyone", r);
[s, r] = await call(W1, "/api/availability/team?week=" + week); ok(s === 403, "staff can't see the team view", s);
[s, r] = await call(OWNER, "/api/dashboard"); ok(r.availability?.week_start === week && typeof r.availability.submitted === "number" && Array.isArray(r.availability.missing), "dashboard shows availability summary", r.availability);

// Shift matching
const mk = async (date, start, finish) => { const [, x] = await call(OWNER, "/api/shifts", "POST", { client_id: cid, date, start, finish, break_min: 30 }); return x.ids[0]; };
const sMon = await mk(days[0], "08:00", "12:30"), sMonLong = await mk(days[0], "08:00", "17:00"), sTue = await mk(days[1], "09:00", "15:00"), sWed = await mk(days[2], "08:00", "16:00");
const fit = async id => { const [, x] = await call(OWNER, "/api/shifts/" + id); return Object.fromEntries(x.candidates.map(c => [c.email, c.avail?.fit])); };
let f = await fit(sMon); ok(f[W1] === "full" && f[W2] === "unknown", "morning shift fits 'mornings only'", f);
f = await fit(sMonLong); ok(f[W1] === "part", "full-day shift only partly fits mornings", f);
f = await fit(sTue); ok(f[W1] === "full", "set times cover the shift", f);
f = await fit(sWed); ok(f[W1] === "no", "said not available", f);
[s, r] = await call(OWNER, "/api/shifts/" + sMon); ok(r.candidates[0].email === W1, "available staff listed first", r.candidates.map(c => c.email));

// Late submission flagged
sql(`DELETE FROM availability_weeks WHERE email='${W2}'`);
const thisMon = addDays(week, -7);
[s, r] = await call(W2, "/api/availability", "PUT", { week_start: thisMon, days: Array.from({ length: 7 }, (_, i) => ({ date: addDays(thisMon, i), slot: "pm" })) });
ok(s === 200 && r.late === true, "sending this week's availability counts as late", r);

// tidy up
sql(`DELETE FROM shifts WHERE client_id=${cid}`); sql(`DELETE FROM availability WHERE email IN ('${W1}','${W2}')`); sql(`DELETE FROM availability_weeks WHERE email IN ('${W1}','${W2}')`);
for (const e of [MGR, W1, W2]) await call(OWNER, `/api/users/${e}`, "DELETE");
console.log(fails ? `${fails} FAILED` : "ALL PASSED"); process.exit(fails ? 1 : 0);
