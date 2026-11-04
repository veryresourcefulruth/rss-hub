// Terms of engagement + Key Information Document signed in the hub.
const B = "http://localhost:8788", OWNER = "ruth@resourcefulruth.co.uk", COORD = "coord4@rss.test", W = "tess@student.test", W2 = "uma@student.test", MGR = "carley@nursery.test";
let fails = 0;
const call = async (who, path, method = "GET", body) => { const r = await fetch(B + path, { method, headers: { "x-dev-email": who, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined }); const ct = r.headers.get("content-type") || ""; return [r.status, ct.includes("json") ? await r.json() : await r.text()]; };
const ok = (c, l, x) => { console.log((c ? "PASS " : "FAIL ") + l + (c ? "" : " " + JSON.stringify(x))); if (!c) fails++; };
let s, r;
await call(OWNER, "/api/users", "PUT", { email: COORD, name: "Coord Four", role: "coordinator" });
for (const [e, n] of [[W, "Tess Ndu"], [W2, "Uma Ray"]]) { await call(OWNER, `/api/users/${e}`, "DELETE"); await call(OWNER, "/api/users", "PUT", { email: e, name: n, role: "staff" }); }

[s, r] = await call(W, "/api/agreement"); ok(s === 200 && r.version >= 1 && /Key Information Document/.test(r.kid_md) && /Terms of Engagement/.test(r.terms_md) && !r.mine, "staff reads current KID + terms", { s, v: r.version });
const v = r.version;
[s, r] = await call(MGR, "/api/agreement"); ok(s === 403, "manager can't read agreement endpoint", r);
[s, r] = await call(W, "/api/me"); ok(r.blockers.some(b => /terms of engagement/i.test(b)), "unsigned terms block booking", r.blockers);
[s, r] = await call(W, "/api/agreement/sign", "POST", { version: v, agree: true, typed_name: "Tess Ndu" }); ok(s === 400 && /Key Information/.test(r.error), "can't sign before confirming KID", r);
[s, r] = await call(W, "/api/agreement/kid-ack", "POST", { version: v + 5 }); ok(s === 400, "stale version rejected", r);
[s, r] = await call(W, "/api/agreement/kid-ack", "POST", { version: v }); ok(s === 200, "KID receipt confirmed", r);
[s, r] = await call(W, "/api/agreement/sign", "POST", { version: v, agree: false, typed_name: "Tess Ndu" }); ok(s === 400 && /Tick/.test(r.error), "must tick agree", r);
[s, r] = await call(W, "/api/agreement/sign", "POST", { version: v, agree: true, typed_name: "Someone Else" }); ok(s === 400 && /Tess Ndu/.test(r.error), "typed name must match profile", r);
[s, r] = await call(W, "/api/agreement/sign", "POST", { version: v, agree: true, typed_name: "  tess  NDU " }); ok(s === 200 && r.signed_at, "signs (name match ignores case/spaces)", r);
[s, r] = await call(W, "/api/agreement/sign", "POST", { version: v, agree: true, typed_name: "Tess Ndu" }); ok(s === 400 && /already/.test(r.error), "can't sign twice", r);
[s, r] = await call(W, "/api/me"); ok(r.checks.terms?.status === "verified" && r.checks.terms.ref === `Version ${v}` && !r.blockers.some(b => /terms/i.test(b)), "terms check completed automatically", r.checks.terms);
[s, r] = await call(W, "/api/agreement"); ok(r.mine?.signed_at && r.mine.kid_ack_at <= r.mine.signed_at, "KID received before signing, both recorded", r.mine);
[s, r] = await call(W, `/api/agreement/signature/${W}`); ok(s === 200 && r.typed_name.trim() && r.terms_sha256?.length === 64 && /Terms of Engagement/.test(r.terms_md), "signed copy with exact text + fingerprint", { s, h: r.terms_sha256 });
[s, r] = await call(W2, `/api/agreement/signature/${W}`); ok(s === 403, "other staff can't see someone's signed copy", r);
[s, r] = await call(COORD, `/api/agreement/signature/${W}`); ok(s === 200, "coordinator can see signed copy", s);
[s, r] = await call(COORD, "/api/agreement/signatures"); ok(r.staff.find(u => u.email === W)?.current?.signed_at && !r.staff.find(u => u.email === W2)?.current, "signature list for RSS", r.staff?.length);
// publishing
const body = { kid_md: r && (await call(OWNER, "/api/agreement"))[1].kid_md, terms_md: (await call(OWNER, "/api/agreement"))[1].terms_md + "\n\n**13.1** Test clause.", note: "Test clause added", resign: true };
[s, r] = await call(COORD, "/api/agreement", "POST", body); ok(s === 403, "coordinator can't publish", r);
[s, r] = await call(OWNER, "/api/agreement", "POST", { ...body, terms_md: "short" }); ok(s === 400, "empty terms rejected", r);
[s, r] = await call(OWNER, "/api/agreement", "POST", body); ok(s === 200 && r.version === v + 1, "owner publishes new version", r);
[s, r] = await call(W, "/api/me"); ok(r.checks.terms.status === "pending" && r.blockers.some(b => /terms/i.test(b)), "new version needs re-signing before booking", r.checks.terms);
[s, r] = await call(W, "/api/agreement"); ok(r.version === v + 1 && !r.mine && r.last_signed?.version === v && r.note === "Test clause added", "staff see what changed", r.last_signed);
await call(W, "/api/agreement/kid-ack", "POST", { version: v + 1 });
[s, r] = await call(W, "/api/agreement/sign", "POST", { version: v + 1, agree: true, typed_name: "Tess Ndu" }); ok(s === 200, "signs new version", r);
[s, r] = await call(W, `/api/agreement/signature/${W}?version=${v}`); ok(s === 200 && !/13\.1/.test(r.terms_md), "old signature still shows the old text", s);
[s, r] = await call(OWNER, "/api/agreement", "POST", { ...body, terms_md: body.terms_md + " Typo fix.", resign: false });
[s, r] = await call(W, "/api/me"); ok(r.checks.terms.status === "verified", "minor update without re-signing keeps people bookable", r.checks.terms.status);
// rename keeps signatures
[s, r] = await call(OWNER, `/api/users/${W}/email`, "POST", { email: "tess.n@student.test" });
[s, r] = await call(OWNER, `/api/agreement/signature/tess.n@student.test`); ok(s === 200, "signatures follow an email change", s);
await call(OWNER, `/api/users/tess.n@student.test`, "DELETE"); await call(OWNER, `/api/users/${W2}`, "DELETE");
// tidy: put the seeded version back on top for later runs
console.log(fails ? `${fails} FAILED` : "ALL PASSED"); process.exit(fails ? 1 : 0);
