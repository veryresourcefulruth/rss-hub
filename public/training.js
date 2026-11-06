/* Childcare 101 inside the RSS Hub (moved from the separate training app).
   Staff: work through the modules, pass each quiz (marked on the server), sign the declaration, get a certificate.
   RSS office: tracker, link old training records, preview every module, edit modules/quizzes and course settings. */

const T = { C: null, prog: null, sub: null, current: null, quiz: {}, draft: null, tracker: null };
const tFmt = iso => iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "";
const tPass = m => m.critical ? 100 : T.C.pass;
const tPassed = () => T.prog ? T.C.modules.filter(m => T.prog.modules[m.id]?.passed).length : 0;
const tUnlocked = i => isAdmin() || i === 0 || !!T.prog?.modules[T.C.modules[i - 1].id]?.passed;
const tDone = p => T.C.modules.every(m => p.modules[m.id]?.passed) && !!p.declaredAt;

async function trainingStaff() {
  const r = await api("/api/training");
  T.C = r.content; T.prog = r.progress;
  if (!["learn", "cert"].includes(T.sub)) T.sub = "learn";
  tRender();
}
async function trainingAdmin() {
  const r = await api("/api/training");
  T.C = r.content; T.prog = null;
  if (!["track", "learn", "edit", "settings"].includes(T.sub)) T.sub = "track";
  if (T.sub === "track") T.tracker = await api("/api/training/tracker");
  tRender();
}

function tSubnav() {
  const items = isAdmin() ? [["track", "Tracker"], ["learn", "Preview & edit modules"], ["settings", "Course settings"]] : [["learn", "Modules"], ["cert", "My certificate"]];
  return `<div class="subnav" role="tablist">${items.map(([k, l]) => `<button class="tab sm" data-tsub="${k}" aria-pressed="${T.sub === k || (k === "learn" && T.sub === "edit")}">${l}</button>`).join("")}</div>`;
}
function tRender() {
  const head = `<div class="panel t-head"><p class="eyebrow">RSS induction</p><h2 style="margin:0 0 10px">Childcare 101</h2>${tSubnav()}</div>`;
  if (T.sub === "edit" && T.draft) { $("#app").innerHTML = head + `<div class="t-one">${tEditor()}</div>`; tWireEditor(); }
  else if (T.sub === "settings") { $("#app").innerHTML = head + `<div class="t-one">${tSettings()}</div>`; tWireSettings(); }
  else if (T.sub === "track") { $("#app").innerHTML = head + `<div class="t-one">${tTrack()}</div>`; tWireTrack(); }
  else {
    $("#app").innerHTML = head + `<div class="wrap"><aside class="rail"><div class="who" id="who"></div><nav class="cls" id="rail" aria-label="Modules"></nav></aside><main id="tmain"></main></div>`;
    tWho(); tRail();
    if (T.sub === "cert") $("#tmain").innerHTML = tCert();
    else {
      const m = T.C.modules.find(x => x.id === T.current) || T.C.modules.find((x, i) => tUnlocked(i) && !T.prog?.modules[x.id]?.passed) || T.C.modules[0];
      T.current = m.id; $("#tmain").innerHTML = tModule(m);
    }
    tWire();
  }
  $$("[data-tsub]").forEach(b => b.onclick = async () => { T.sub = b.dataset.tsub; T.quiz = {}; T.draft = null; await (isAdmin() ? trainingAdmin() : trainingStaff()); scrollTo({ top: 0 }); });
}
function tWho() {
  if (isAdmin()) { $("#who").innerHTML = `<b>Preview</b><span class="note">All modules are open for you. Quiz answers in preview aren't recorded.</span>`; return; }
  const n = tPassed(), pct = Math.round(n / T.C.modules.length * 100);
  $("#who").innerHTML = `<b>${esc(me.name)}</b><span class="note">${n} of ${T.C.modules.length} modules passed${T.prog.declaredAt ? " · declaration signed" : ""}</span><div class="meter"><i style="width:${pct}%"></i></div>`;
}
function tRail() {
  $("#rail").innerHTML = T.C.classes.map(c => `<h4>${esc(c.name)}</h4>` + T.C.modules.map((m, i) => [m, i]).filter(([m]) => m.cls === c.id).map(([m, i]) => {
    const r = T.prog?.modules[m.id], open = tUnlocked(i);
    const chip = r?.passed ? `<span class="chip ok">${r.best}%</span>` : !open ? `<span class="chip lock">Locked</span>` : m.critical ? `<span class="chip crit">100%</span>` : "";
    return `<button class="mod ${r?.passed ? "done" : ""}" data-m="${m.id}" ${open ? "" : "disabled"} aria-current="${T.current === m.id && T.sub === "learn"}"><span class="num">${r?.passed ? "✓" : i + 1}</span><span class="t">${esc(m.title)}</span>${chip}</button>`;
  }).join("")).join("") + (isAdmin() ? `<div class="owner-tools"><h4>RSS office</h4><button class="link-btn" id="addMod">+ Add a new module</button></div>` : "");
  $$(".mod").forEach(b => b.onclick = () => { T.current = b.dataset.m; T.sub = "learn"; T.quiz = {}; tRender(); scrollTo({ top: 0 }); });
  const am = $("#addMod"); if (am) am.onclick = () => { T.draft = { id: "m" + Date.now().toString(36), cls: T.C.classes[T.C.classes.length - 1].id, title: "", mins: 15, critical: false, intro: "", body: "<h3>First heading</h3><p>Start writing here.</p>", quiz: [{ q: "", o: ["", ""], a: 0, w: "" }] }; T.sub = "edit"; tRender(); scrollTo({ top: 0 }); };
}

function tModule(m) {
  const i = T.C.modules.indexOf(m), r = T.prog?.modules[m.id], qs = T.quiz;
  const quiz = m.quiz.map((q, qi) => {
    const a = qs.answers?.[qi], fb = qs.feedback?.[qi];
    return `<fieldset class="q"><legend>${qi + 1}. ${esc(q.q)}</legend>${q.o.map((o, oi) => {
      let cls = ""; if (fb) { if (oi === fb.a && a === oi) cls = "right"; else if (a === oi) cls = "wrong"; }
      return `<label class="opt ${cls}"><input type="radio" name="q${qi}" value="${oi}" ${a === oi ? "checked" : ""} ${fb ? "disabled" : ""}><span>${esc(o)}</span></label>`;
    }).join("")}
    ${fb ? (a !== fb.a ? `<p class="why"><b>Correct answer:</b> ${esc(q.o[fb.a])}. ${esc(fb.w)}</p>` : `<p class="why">${esc(fb.w)}</p>`) : ""}</fieldset>`;
  }).join("");
  let res = "";
  if (qs.feedback) {
    const ok = qs.passed, last = i === T.C.modules.length - 1;
    res = `<div class="result ${ok ? "pass" : "fail"}" role="status"><strong>${ok ? "Passed" : "Not yet passed"} · ${qs.score}%</strong>${isAdmin() ? "<p class='note'>Preview only: this score isn't recorded.</p>" : ""}
      ${ok ? (last ? "All modules passed. Sign the declaration on My certificate." : "The next module is now open.") : `You need ${qs.passMark}%. Re-read the module, then try again.`}</div>
    <div class="row">${ok && !last ? `<button class="btn" id="next">Go to Module ${i + 2}</button>` : ""}${ok && last && !isAdmin() ? `<button class="btn" id="toCert">Go to My certificate</button>` : ""}${!ok ? `<button class="btn" id="retry">Retake quiz</button>` : ""}</div>`;
  }
  return `<article class="panel">${isAdmin() ? `<div class="row" style="margin:0 0 16px"><button class="btn ghost" id="editMod">Edit this module</button><span class="note">Only the RSS office sees this.</span></div>` : ""}<div class="reading">
   <p class="eyebrow">Module ${i + 1} · about ${m.mins} min${m.critical ? " · Critical" : ""}</p>
   <h2>${esc(m.title)}</h2><p class="lede">${esc(m.intro)}</p>
   ${r?.passed ? `<p><span class="chip ok">Passed ${tFmt(r.passedAt)} · best ${r.best}% · ${r.attempts} attempt${r.attempts > 1 ? "s" : ""}</span></p>` : ""}
   ${m.body}
   <h3 id="quiz" style="margin-top:2em">Quiz · pass mark ${tPass(m)}%</h3>
   <form id="quizForm">${quiz}${qs.feedback ? "" : `<div class="row"><button class="btn" type="submit" id="qgo">Submit answers</button><span class="note" id="qmsg" role="status"></span></div>`}</form>
   ${res}</div></article>`;
}

function tCert() {
  const n = tPassed(), p = T.prog;
  if (n < T.C.modules.length) return `<div class="panel"><div class="reading"><p class="eyebrow">My certificate</p><h2>${n} of ${T.C.modules.length} modules passed</h2><p>Your certificate appears here once you pass every module and sign the RSS declaration.</p>
  <div class="tbl"><table><thead><tr><th>Module</th><th>Status</th><th>Best</th></tr></thead><tbody>${T.C.modules.map((m, i) => { const r = p.modules[m.id]; return `<tr><td>${i + 1}. ${esc(m.title)}</td><td>${r?.passed ? "Passed " + tFmt(r.passedAt) : r ? "Attempted" : "Not started"}</td><td class="n">${r ? r.best + "%" : "–"}</td></tr>`; }).join("")}</tbody></table></div></div></div>`;
  if (!p.declaredAt) return `<div class="panel"><div class="reading"><p class="eyebrow">Final step</p><h2>RSS practitioner declaration</h2><p>Tick each statement to confirm you understand and will follow it on every RSS placement.</p>
   <form id="declForm">${T.C.declaration.map((d, i) => `<label class="opt" for="d${i}"><input type="checkbox" id="d${i}" required><span>${esc(d)}</span></label>`).join("")}
   <div class="row"><button class="btn" type="submit">Sign declaration</button><span class="note" id="dmsg" role="status"></span></div></form></div></div>`;
  const refresh = new Date(p.declaredAt); refresh.setFullYear(refresh.getFullYear() + 1);
  return `<div class="cert"><p class="eyebrow">Resourceful Staffing Support</p><h2>Certificate of completion</h2>
   <p>This confirms that</p><p class="name">${esc(me.name)}</p>
   <p>has completed <b>RSS Childcare 101</b>, covering EYFS 2026 essentials, safeguarding and child protection, whistleblowing, intimate care, ratios, safer eating, emergencies and quality practice, passing all ${T.C.modules.length} assessed modules and signing the RSS practitioner declaration on <b>${tFmt(p.declaredAt)}</b>.</p>
   <div class="tbl"><table><thead><tr><th>Module</th><th>Score</th><th>Passed</th></tr></thead><tbody>${T.C.modules.map((m, i) => { const r = p.modules[m.id]; return `<tr><td>${i + 1}. ${esc(m.title)}</td><td class="n">${r.best}%</td><td class="n">${tFmt(r.passedAt)}</td></tr>`; }).join("")}</tbody></table></div>
   <p class="note">Induction training only. Does not replace accredited safeguarding training (required under EYFS 2026) or paediatric first aid certification. Refresh due ${tFmt(refresh.toISOString())}.</p></div>
   <div class="panel no-print" style="margin-top:18px"><p style="margin:0"><b>RSS can already see your result.</b> <span class="note">To keep a copy, use the button below and choose "Save as PDF".</span></p><div class="row"><button class="btn ghost" onclick="window.print()">Print or save as PDF</button></div></div>`;
}

function tWire() {
  const qf = $("#quizForm"); if (qf) qf.onsubmit = async e => {
    e.preventDefault(); const m = T.C.modules.find(x => x.id === T.current); const answers = [];
    for (let i = 0; i < m.quiz.length; i++) { const c = qf.querySelector(`input[name=q${i}]:checked`); if (!c) { $("#qmsg").textContent = "Answer every question before submitting."; return; } answers.push(+c.value); }
    if (isAdmin()) {
      const right = m.quiz.filter((q, i) => answers[i] === q.a).length, score = Math.round(right / m.quiz.length * 100);
      T.quiz = { answers, score, passed: score >= tPass(m), passMark: tPass(m), feedback: m.quiz.map(q => ({ a: q.a, w: q.w })) };
    } else {
      $("#qgo").disabled = true; $("#qmsg").textContent = "Marking…";
      try { const r = await api("/api/training/quiz", { method: "POST", body: { moduleId: m.id, answers } }); T.prog = r.progress; T.quiz = { answers, ...r }; if (r.passed) me = await api("/api/me"); }
      catch (err) { $("#qmsg").textContent = err.message; $("#qgo").disabled = false; return; }
    }
    tRender(); document.querySelector(".result")?.scrollIntoView({ block: "center" });
  };
  const em = $("#editMod"); if (em) em.onclick = () => { T.draft = JSON.parse(JSON.stringify(T.C.modules.find(x => x.id === T.current))); T.sub = "edit"; tRender(); scrollTo({ top: 0 }); };
  const nx = $("#next"); if (nx) nx.onclick = () => { const i = T.C.modules.findIndex(x => x.id === T.current); T.current = T.C.modules[i + 1].id; T.quiz = {}; tRender(); scrollTo({ top: 0 }); };
  const rt = $("#retry"); if (rt) rt.onclick = () => { T.quiz = {}; tRender(); $("#quiz").scrollIntoView(); };
  const tc = $("#toCert"); if (tc) tc.onclick = () => { T.sub = "cert"; tRender(); scrollTo({ top: 0 }); };
  const df = $("#declForm"); if (df) df.onsubmit = async e => {
    e.preventDefault();
    try { T.prog = (await api("/api/training/declare", { method: "POST" })).progress; me = await api("/api/me"); tRender(); toast("Declaration signed"); }
    catch (err) { $("#dmsg").textContent = err.message; }
  };
}

/* ---------- RSS office: tracker ---------- */
function tTrack() {
  const d = T.tracker, people = d.people.filter(p => p.active), done = people.filter(tDone).length;
  const staffOpts = d.people.filter(p => !p.startedAt || !Object.keys(p.modules).length).map(p => `<option value="${esc(p.email)}">${esc(p.name)}</option>`).join("");
  return `<div class="panel"><h2 style="margin-top:0">Who has done Childcare 101</h2>
  <div class="stat-row"><div class="stat"><b>${people.length}</b><span>active staff</span></div><div class="stat"><b>${done}</b><span>fully complete</span></div><div class="stat"><b>${people.length - done}</b><span>not finished</span></div></div>
  <div class="tbl"><table><thead><tr><th>Name</th>${d.modules.map((m, i) => `<th title="${esc(m.title)}">M${i + 1}</th>`).join("")}<th>Declaration</th><th>Last active</th>${me.role === "owner" ? "<th></th>" : ""}</tr></thead><tbody>
  ${people.map(p => `<tr><td><b>${esc(p.name)}</b> ${tDone(p) ? `<span class="tag ok">Complete</span>` : ""}</td>${d.modules.map(m => { const x = p.modules[m.id]; return `<td class="n" title="${x?.passed ? "Passed " + tFmt(x.passedAt) + ", " + x.attempts + " attempt(s)" : x ? x.attempts + " attempt(s)" : ""}">${x?.passed ? `<span class="dot y"></span> ${x.best}` : x ? x.best : "–"}</td>`; }).join("")}<td class="n">${p.declaredAt ? tFmt(p.declaredAt) : "–"}</td><td class="n">${tFmt(p.lastSeenAt)}</td>
  ${me.role === "owner" ? `<td>${Object.keys(p.modules).length ? `<button class="link-btn danger" data-treset="${esc(p.email)}">Reset</button>` : ""}</td>` : ""}</tr>`).join("") || `<tr><td colspan="${d.modules.length + 3}" class="empty">No staff yet.</td></tr>`}</tbody></table></div>
  <p class="note">Staff do the training in the Hub under <b>Training</b>, signed in as themselves. Hover over a score to see when it was passed.${me.role === "owner" ? " <b>Reset</b> clears someone's results so they take the course again." : ""}</p></div>
  ${d.unlinked.length ? `<div class="panel" style="margin-top:18px"><h2 style="margin-top:0">Progress from the old training app to match up</h2>
   <p class="note">These people did training in the old Childcare 101 app, but their name there didn't match anyone's name in the Hub. Choose who each one is, and their results move across.</p>
   <div class="tbl"><table><thead><tr><th>Name in old app</th><th>Progress</th><th>This is</th><th></th></tr></thead><tbody>
   ${d.unlinked.map(t => `<tr><td>${esc(t.name)}</td><td>${t.passed} of ${d.modules.length} modules${t.declared_at ? " · declaration signed" : ""}</td>
     <td><select data-tsel="${t.id}"><option value="">Choose staff member…</option>${staffOpts}</select></td><td><button class="btn sm" data-tlink="${t.id}">Move results</button></td></tr>`).join("")}</tbody></table></div></div>` : ""}`;
}
function tWireTrack() {
  $$("[data-tlink]").forEach(b => b.onclick = async () => {
    const email = $(`[data-tsel="${b.dataset.tlink}"]`).value;
    if (!email) { toast("Choose who this is first"); return; }
    if (await act(b, () => api("/api/training/link", { method: "POST", body: { trainee_id: b.dataset.tlink, email } }))) { toast("Results moved"); trainingAdmin(); }
  });
  $$("[data-treset]").forEach(b => b.onclick = async () => {
    if (!b.dataset.armed) { b.dataset.armed = 1; b.textContent = "Click again to clear all their results"; return; }
    if (await act(b, () => api(`/api/training/progress/${encodeURIComponent(b.dataset.treset)}`, { method: "DELETE" }))) { toast("Results cleared"); trainingAdmin(); }
  });
}

/* ---------- RSS office: module editor ---------- */
function tQEd(q, qi) {
  return `<fieldset class="qed">
   <div class="qed-head"><b>Question ${qi + 1}</b><button type="button" class="link-btn danger" data-delq="${qi}">Remove question</button></div>
   <label class="fld" for="q${qi}text">Question<textarea class="plain" id="q${qi}text" data-f="q">${esc(q.q)}</textarea></label>
   <span class="note">Answer options. Tick the circle beside the correct one.</span>
   ${q.o.map((o, oi) => `<div class="optrow"><input type="radio" name="corr${qi}" value="${oi}" ${q.a === oi ? "checked" : ""} aria-label="Mark option ${oi + 1} as correct"><input type="text" data-o="${oi}" value="${esc(o)}" placeholder="Option ${oi + 1}">${q.o.length > 2 ? `<button type="button" class="link-btn danger" data-delo="${qi}:${oi}">Remove</button>` : "<span></span>"}</div>`).join("")}
   ${q.o.length < 5 ? `<button type="button" class="link-btn" data-addo="${qi}">+ Add answer option</button>` : ""}
   <label class="fld" for="q${qi}w">Explanation shown after they answer<input type="text" id="q${qi}w" data-f="w" value="${esc(q.w)}"></label>
  </fieldset>`;
}
function tEditor() {
  const m = T.draft, isNew = !T.C.modules.find(x => x.id === m.id);
  return `<div class="panel"><p class="eyebrow">${isNew ? "New module" : "Editing module"} · staff see your changes as soon as you save</p>
  <h2>${isNew ? "Add a module" : esc(m.title)}</h2>
  <div class="ed-grid">
   <label class="fld" for="edTitle">Title<input type="text" id="edTitle" value="${esc(m.title)}" placeholder="e.g. Working in the baby room"></label>
   <label class="fld" for="edCls">Class<select id="edCls">${T.C.classes.map(c => `<option value="${c.id}" ${c.id === m.cls ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select></label>
   <label class="fld" for="edMins">Minutes<input type="number" id="edMins" min="5" max="240" value="${m.mins}"></label>
  </div>
  <label class="opt" for="edCrit"><input type="checkbox" id="edCrit" ${m.critical ? "checked" : ""}><span>Critical module: staff need 100% to pass (other modules need ${T.C.pass}%)</span></label>
  <label class="fld" for="edIntro">Introduction (one or two sentences under the title)<textarea class="plain" id="edIntro" style="max-width:none">${esc(m.intro)}</textarea></label>
  <h3>Module content</h3>
  <p class="note">Click into the text and type as you would in Word. Select text, then use the buttons to format it. Pasted text comes in plain, so add headings and bold afterwards.</p>
  <div class="ed-toolbar" role="toolbar" aria-label="Formatting">
    <button type="button" class="tool" data-cmd="h3">Heading</button>
    <button type="button" class="tool" data-cmd="p">Normal text</button>
    <button type="button" class="tool" data-cmd="bold"><b>Bold</b></button>
    <button type="button" class="tool" data-cmd="ul">Bullet list</button>
    <button type="button" class="tool" data-cmd="ol">Numbered steps</button>
    <button type="button" class="tool accent" data-cmd="exp">+ From Ruth's experience</button>
    <button type="button" class="tool" data-cmd="tip">+ Key point box</button>
  </div>
  <div id="edBody" class="rich" contenteditable="true" aria-label="Module content">${m.body}</div>
  <h3>Quiz</h3>
  <div id="edQuiz">${m.quiz.map(tQEd).join("")}</div>
  <button type="button" class="btn ghost" id="addQ">+ Add question</button>
  <div class="row sticky-save">
    <button type="button" class="btn" id="edSave">Save and publish</button>
    <button type="button" class="btn ghost" id="edCancel">Cancel</button>
    ${isNew ? "" : `<button type="button" class="link-btn danger" id="edDel">Delete module</button>`}
    <span class="note" id="edMsg" role="status"></span>
  </div></div>`;
}
function tReadEditor() {
  if (!$("#edTitle")) return;
  const d = T.draft;
  d.title = $("#edTitle").value.trim(); d.cls = $("#edCls").value; d.mins = Math.max(5, +$("#edMins").value || 15);
  d.critical = $("#edCrit").checked; d.intro = $("#edIntro").value.trim(); d.body = $("#edBody").innerHTML;
  d.quiz = $$(".qed").map((f, qi) => ({
    q: f.querySelector('[data-f="q"]').value.trim(),
    o: [...f.querySelectorAll("[data-o]")].map(i => i.value.trim()),
    a: +(f.querySelector(`input[name="corr${qi}"]:checked`)?.value ?? -1),
    w: f.querySelector('[data-f="w"]').value.trim(),
  }));
}
function tCleanHTML(html) {
  const t = document.createElement("template"); t.innerHTML = html;
  t.content.querySelectorAll("script,style,iframe,object,embed,link,meta,form,input,button,select,textarea,img,video,audio").forEach(n => n.remove());
  t.content.querySelectorAll("*").forEach(el => [...el.attributes].forEach(a => {
    const n = a.name.toLowerCase();
    if (n.startsWith("on") || n === "style" || n === "contenteditable" || n === "id" || ((n === "href" || n === "src") && !/^\s*https?:/i.test(a.value))) el.removeAttribute(a.name);
  }));
  t.content.querySelectorAll("ol").forEach(o => o.className = "steps");
  t.content.querySelectorAll("ul").forEach(u => { if (!u.className) u.className = "list"; });
  t.content.querySelectorAll("a").forEach(a => { a.target = "_blank"; a.rel = "noopener"; });
  return t.innerHTML.trim();
}
function tSort(list) { const order = T.C.classes.map(c => c.id); return list.map((m, i) => [m, i]).sort((x, y) => (order.indexOf(x[0].cls) - order.indexOf(y[0].cls)) || (x[1] - y[1])).map(x => x[0]); }
async function tSave(next, msgEl) {
  msgEl.textContent = "Saving…";
  try { T.C = await api("/api/training/content", { method: "PUT", body: { ...T.C, ...next } }); toast("Saved and published"); return true; }
  catch (e) { msgEl.textContent = e.message; return false; }
}
function tWireEditor() {
  try { document.execCommand("defaultParagraphSeparator", false, "p"); } catch {}
  const body = $("#edBody");
  body.addEventListener("paste", e => {
    e.preventDefault(); const t = e.clipboardData.getData("text/plain");
    document.execCommand("insertHTML", false, t.split(/\r?\n\s*\r?\n/).map(p => "<p>" + esc(p).replace(/\r?\n/g, "<br>") + "</p>").join(""));
  });
  const ensureFocus = () => { const s = getSelection(); if (!s.rangeCount || !body.contains(s.anchorNode)) { body.focus(); const r = document.createRange(); r.selectNodeContents(body); r.collapse(false); s.removeAllRanges(); s.addRange(r); } };
  $$(".tool").forEach(b => {
    b.addEventListener("mousedown", e => e.preventDefault());
    b.onclick = () => {
      ensureFocus(); const c = b.dataset.cmd;
      if (c === "h3" || c === "p") document.execCommand("formatBlock", false, c);
      else if (c === "bold") document.execCommand("bold");
      else if (c === "ul") document.execCommand("insertUnorderedList");
      else if (c === "ol") document.execCommand("insertOrderedList");
      else if (c === "exp") document.execCommand("insertHTML", false, `<div class="callout exp"><b>From Ruth's experience:</b> Type your story or lesson here.</div><p><br></p>`);
      else if (c === "tip") document.execCommand("insertHTML", false, `<div class="callout"><b>Key point:</b> Type the key point here.</div><p><br></p>`);
    };
  });
  const rerender = () => { const y = scrollY; tRender(); scrollTo({ top: y }); };
  $("#addQ").onclick = () => { tReadEditor(); T.draft.quiz.push({ q: "", o: ["", "", "", ""], a: 0, w: "" }); rerender(); };
  $$("[data-delq]").forEach(b => b.onclick = () => { tReadEditor(); T.draft.quiz.splice(+b.dataset.delq, 1); rerender(); });
  $$("[data-addo]").forEach(b => b.onclick = () => { tReadEditor(); T.draft.quiz[+b.dataset.addo].o.push(""); rerender(); });
  $$("[data-delo]").forEach(b => b.onclick = () => { tReadEditor(); const [qi, oi] = b.dataset.delo.split(":").map(Number); const q = T.draft.quiz[qi]; q.o.splice(oi, 1); if (q.a === oi) q.a = -1; else if (q.a > oi) q.a--; rerender(); });
  $("#edCancel").onclick = () => { const ex = T.C.modules.find(x => x.id === T.draft.id); T.draft = null; T.sub = "learn"; if (ex) T.current = ex.id; T.quiz = {}; tRender(); scrollTo({ top: 0 }); };
  const del = $("#edDel"); if (del) del.onclick = async () => {
    if (!del.dataset.armed) { del.dataset.armed = "1"; del.textContent = "Click again to delete this module for everyone"; return; }
    if (await tSave({ modules: T.C.modules.filter(x => x.id !== T.draft.id) }, $("#edMsg"))) { T.draft = null; T.sub = "learn"; T.current = T.C.modules[0].id; tRender(); }
  };
  $("#edSave").onclick = async () => {
    tReadEditor(); const msg = $("#edMsg"), m = T.draft;
    if (!m.title) { msg.textContent = "Give the module a title."; $("#edTitle").focus(); return; }
    if (!m.quiz.length) { msg.textContent = "Add at least one quiz question, so staff have something to pass."; return; }
    for (let i = 0; i < m.quiz.length; i++) {
      const q = m.quiz[i];
      if (!q.q) { msg.textContent = `Question ${i + 1} has no question text.`; return; }
      if (q.o.some(o => !o)) { msg.textContent = `Question ${i + 1} has an empty answer option. Fill it in or remove it.`; return; }
      if (!(q.a >= 0 && q.a < q.o.length)) { msg.textContent = `Question ${i + 1}: tick the correct answer.`; return; }
    }
    const saved = { ...m, body: tCleanHTML(m.body) }, exists = T.C.modules.some(x => x.id === m.id);
    const next = tSort(exists ? T.C.modules.map(x => x.id === m.id ? saved : x) : [...T.C.modules, saved]);
    if (await tSave({ modules: next }, msg)) { T.draft = null; T.sub = "learn"; T.current = saved.id; T.quiz = {}; tRender(); scrollTo({ top: 0 }); }
  };
}

/* ---------- RSS office: course settings ---------- */
function tSettings() {
  return `<div class="panel set"><h2 style="margin-top:0">Course settings</h2>
  <label class="fld" for="sPass">Pass mark for standard modules (%)<input type="number" id="sPass" min="50" max="100" value="${T.C.pass}" style="max-width:140px"></label>
  <h3>Class names</h3>
  ${T.C.classes.map((c, i) => `<label class="fld" for="sCls${i}">Class ${esc(c.id)}<input type="text" id="sCls${i}" value="${esc(c.name)}"></label>`).join("")}
  <h3>Practitioner declaration</h3>
  <label class="fld" for="sDecl">One statement per line. Staff tick each one before getting their certificate.<textarea class="plain" id="sDecl" style="max-width:none;min-height:160px">${esc(T.C.declaration.join("\n"))}</textarea></label>
  <div class="row"><button class="btn" id="sSave">Save settings</button><span class="note" id="sMsg" role="status"></span></div></div>`;
}
function tWireSettings() {
  $("#sSave").onclick = async () => {
    const pass = Math.min(100, Math.max(50, +$("#sPass").value || 80));
    const declaration = $("#sDecl").value.split("\n").map(s => s.trim()).filter(Boolean);
    if (!declaration.length) { $("#sMsg").textContent = "Keep at least one declaration statement."; return; }
    const classes = T.C.classes.map((c, i) => ({ id: c.id, name: $("#sCls" + i).value.trim() || c.name }));
    if (await tSave({ pass, declaration, classes }, $("#sMsg"))) $("#sMsg").textContent = "Saved.";
  };
}
