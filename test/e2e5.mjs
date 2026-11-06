// Childcare 101 inside the Hub: carry-over from the old app, quizzes, declaration, booking check, editor, tracker.
import fs from "node:fs";
const C = JSON.parse(fs.readFileSync(new URL("../../rss-training/seed/content.json", import.meta.url)));
const B = "http://localhost:8788", OWNER = "ruth@resourcefulruth.co.uk", COORD = "coord5@rss.test";
const ADA = "ada5@student.test", BEN = "ben5@student.test", CARA = "cara5@student.test", ZARA = "zara5@student.test", MGR = "mgr5@nursery.test";
let fails = 0;
const call = async (who, path, method = "GET", body) => { const r = await fetch(B + path, { method, headers: { "x-dev-email": who, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined }); const ct = r.headers.get("content-type") || ""; return [r.status, ct.includes("json") ? await r.json() : await r.text()]; };
const ok = (c, l, x) => { console.log((c ? "PASS " : "FAIL ") + l + (c ? "" : " " + JSON.stringify(x)?.slice(0, 400))); if (!c) fails++; };
const right = m => m.quiz.map(q => q.a), wrong = m => m.quiz.map(q => (q.a + 1) % q.o.length);
let s, r;
await call(OWNER, "/api/users", "PUT", { email: COORD, name: "Coord Five", role: "coordinator" });
for (const [e, n] of [[ADA, "Ada Obi"], [BEN, "Ben Lee"], [CARA, "Cara New"], [ZARA, "Zara Smith"]]) await call(OWNER, "/api/users", "PUT", { email: e, name: n, role: "staff" });

// carry-over by name
[s, r] = await call(ADA, "/api/me"); ok(r.training?.complete && !r.blockers.some(b => /childcare/i.test(b)), "Ada's old completed training carried over by name", r.training);
[s, r] = await call(BEN, "/api/training"); ok(s === 200 && r.progress.modules.m1?.passed && !r.progress.modules.m2 && !r.content.modules[0].quiz[0].hasOwnProperty("a"), "Ben's partial progress carried over; answers not sent to staff", r.progress);
[s, r] = await call(CARA, "/api/me"); ok(r.blockers.some(b => /childcare 101/i.test(b)) && !r.training.found, "new starter blocked until training done", r.blockers);
// quiz rules
[s, r] = await call(CARA, "/api/training/quiz", "POST", { moduleId: "m2", answers: right(C.modules[1]) }); ok(s === 403, "can't skip ahead", r);
[s, r] = await call(CARA, "/api/training/quiz", "POST", { moduleId: "m1", answers: [0] }); ok(s === 400, "must answer every question", r);
[s, r] = await call(CARA, "/api/training/quiz", "POST", { moduleId: "m1", answers: wrong(C.modules[0]) }); ok(s === 200 && !r.passed && r.feedback.length, "wrong answers fail, with feedback", r.score);
[s, r] = await call(CARA, "/api/training/declare", "POST"); ok(s === 403, "can't declare before passing everything", r);
for (const m of C.modules) { [s, r] = await call(CARA, "/api/training/quiz", "POST", { moduleId: m.id, answers: right(m) }); if (!r.passed) ok(false, "pass " + m.id, r); }
ok(Object.values(r.progress.modules).filter(x => x.passed).length === C.modules.length && r.progress.modules.m1.attempts === 2, "passes all modules, attempts counted", r.progress.modules.m1);
[s, r] = await call(CARA, "/api/me"); ok(r.blockers.some(b => /childcare 101/i.test(b)), "still blocked until declaration signed", r.blockers);
[s, r] = await call(CARA, "/api/training/declare", "POST"); ok(s === 200 && r.progress.declaredAt, "declaration signed", r);
[s, r] = await call(CARA, "/api/me"); ok(r.training.complete && !r.blockers.some(b => /childcare/i.test(b)), "training no longer blocks booking", r.blockers);
// access
[s, r] = await call(MGR, "/api/training"); ok(s === 403 || s === 401, "managers can't open training", s);
[s, r] = await call(CARA, "/api/training/tracker"); ok(s === 403, "staff can't see tracker", s);
[s, r] = await call(COORD, "/api/training"); ok(s === 200 && r.preview && Number.isInteger(r.content.modules[0].quiz[0].a), "office gets full content with answers", s);
// tracker + manual link
[s, r] = await call(COORD, "/api/training/tracker"); ok(s === 200 && r.people.find(p => p.email === CARA)?.declaredAt && r.unlinked.some(t => t.id === "t3") && !r.unlinked.some(t => t.id === "t1"), "tracker shows people and unmatched old records", r.unlinked);
[s, r] = await call(COORD, "/api/training/link", "POST", { trainee_id: "t1", email: ZARA }); ok(s === 400, "can't link a record already used", r);
[s, r] = await call(COORD, "/api/training/link", "POST", { trainee_id: "t3", email: ZARA }); ok(s === 200, "link unmatched old record to Zara", r);
[s, r] = await call(ZARA, "/api/training"); ok(r.progress.modules.m1?.passed && r.progress.modules.m1.best === 85, "Zara now has the old results", r.progress);
[s, r] = await call(COORD, "/api/training/tracker"); ok(!r.unlinked.some(t => t.id === "t3"), "linked record leaves the to-match list", r.unlinked);
// editor
[s, r] = await call(COORD, "/api/training"); const content = r.content;
[s, r] = await call(COORD, "/api/training/content", "PUT", { ...content, pass: 20 }); ok(s === 400, "invalid pass mark rejected", r);
const edited = { ...content, modules: content.modules.map((m, i) => i === 0 ? { ...m, title: m.title + " (edited)" } : m) };
[s, r] = await call(COORD, "/api/training/content", "PUT", edited); ok(s === 200, "office saves an edit", r.error);
[s, r] = await call(BEN, "/api/training"); ok(/\(edited\)/.test(r.content.modules[0].title), "staff see the edit straight away", r.content.modules[0].title);
await call(COORD, "/api/training/content", "PUT", content);
// reset (owner only)
[s, r] = await call(COORD, `/api/training/progress/${ZARA}`, "DELETE"); ok(s === 403, "coordinator can't reset results", s);
[s, r] = await call(OWNER, `/api/training/progress/${ZARA}`, "DELETE"); ok(s === 200, "owner resets results", r);
[s, r] = await call(ZARA, "/api/training"); ok(!Object.keys(r.progress.modules).length, "results cleared", r.progress);
// email change keeps training
await call(OWNER, `/api/users/${CARA}/email`, "POST", { email: "cara.n5@student.test" });
[s, r] = await call("cara.n5@student.test", "/api/me"); ok(r.training?.complete, "training follows an email change", r.training);
for (const e of [ADA, BEN, "cara.n5@student.test", ZARA]) await call(OWNER, `/api/users/${e}`, "DELETE");
console.log(fails ? `${fails} FAILED` : "ALL PASSED"); process.exit(fails ? 1 : 0);
