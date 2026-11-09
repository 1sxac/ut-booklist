/* UT Austin Course Booklist: "Your budget" and "Cheaper materials" tabs.
   Loaded before the main script. Everything here reads the main script's data and helpers
   (D, COURSE, COUNTS, search, norm, esc, money, plural, go, AN, CHECK) only when a function runs,
   by which time the main script has loaded the course data. Plans are saved in the visitor's
   browser only (localStorage). */
"use strict";

/* ---------------- settings: update these when UT posts new calendars ---------------- */
const BCFG = {
  checked: "2026-11-08",           // when the UT facts below were last checked
  aidBudget: 724,                  // UT 2026-27 cost of attendance: books, course materials, supplies and equipment (fall + spring)
  aidYear: "2026–27",
  coopScholarship: 250,            // University Co-op Course Material Scholarship, per year
  spreadWeeks: 4,                  // "spread over the term" = this many weekly payments
  // start: first class day. refundEnd: last day of the Co-op's full-refund window (5th class day, 2nd in summer).
  // LTA: bill posted to What I Owe, opt-out deadline (12th class day, 4th in summer), payment due.
  // est: dates UT hasn't posted yet, estimated from the same pattern as earlier terms.
  terms: [
    {id: "sp27", name: "Spring 2027", start: "2027-01-11", refundEnd: "2027-01-15", ltaBill: "2027-01-19", ltaOptOut: "2027-01-27", ltaDue: "2027-02-08", summer: false, est: []},
    {id: "su27", name: "Summer 2027", start: "2027-06-03", refundEnd: "2027-06-04", ltaBill: "2027-06-03", ltaOptOut: "2027-06-08", ltaDue: "2027-06-16", summer: true, est: ["ltaBill", "ltaDue"]},
    {id: "fa27", name: "Fall 2027", start: "2027-08-23", refundEnd: "2027-08-27", ltaBill: "2027-08-30", ltaOptOut: "2027-09-08", ltaDue: "2027-09-20", summer: false, est: ["ltaBill", "ltaOptOut", "ltaDue"]}
  ]
};

/* ---------------- dates ---------------- */
const BD = {
  parse: s => { const [y, m, d] = String(s).split("-").map(Number); return new Date(y, m - 1, d, 12); },
  iso: d => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"),
  add: (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; },
  addMonths: (d, n) => { const x = new Date(d), day = x.getDate(); x.setDate(1); x.setMonth(x.getMonth() + n); x.setDate(Math.min(day, new Date(x.getFullYear(), x.getMonth() + 1, 0).getDate())); return x; },
  days: (a, b) => Math.round((b - a) / 864e5),
  today: () => { const t = new Date(); return new Date(t.getFullYear(), t.getMonth(), t.getDate(), 12); },
  md: d => d.toLocaleDateString("en-US", {month: "short", day: "numeric"}),
  wmd: d => d.toLocaleDateString("en-US", {weekday: "short", month: "short", day: "numeric"}),
  mdy: d => d.toLocaleDateString("en-US", {month: "short", day: "numeric", year: "numeric"})
};

/* ---------------- saved plan ---------------- */
const BKEY = "utbooklist-budget-v1";
function bDefaults(){
  const now = BD.today();
  const t = BCFG.terms.find(x => BD.parse(x.start) > now) || BCFG.terms[BCFG.terms.length - 1];
  return {v: 1, term: t.id, courses: [], basis: "low", buffer: 7, freq: 7, start: null, cheaper: 0, cushion: false, saved: 0, aid: 0};
}
function bLoad(){
  try {
    const s = JSON.parse(localStorage.getItem(BKEY) || "null");
    if (s && s.v === 1 && Array.isArray(s.courses)) return Object.assign(bDefaults(), s);
  } catch (e) {}
  return bDefaults();
}
let BS = bLoad();
function bSave(){ try { localStorage.setItem(BKEY, JSON.stringify(BS)); } catch (e) {} }

/* ---------------- pricing ---------------- */
const bTerm = () => BCFG.terms.find(t => t.id === BS.term) || BCFG.terms[0];
const bCents = v => Math.round(v * 100) / 100;
function bSecPrice(s, basis){
  let buy = 0, lta = 0, np = 0;
  for (const [ix, rq] of s.m){
    if (!COUNTS.has(rq)) continue;
    const it = D.items[ix];
    let p = it.lo;
    if (basis === "new" && rq !== "L" && it.n != null) p = it.n;   // LTA is billed by UT, so "buying new" doesn't apply
    if (p == null){ np++; continue; }
    if (rq === "L") lta += p; else buy += p;
  }
  const packs = (s.pk || []).map(i => D.packs[i]);
  return {buy, lta, np, packs, pack: packs.reduce((a, p) => a + (p.pr || 0), 0)};
}
function bTypical(c){   // the section whose cost is closest to the course's typical (median) cost
  const cs = c.s.filter(s => s.c != null);
  if (!cs.length) return c.s.find(s => s.pk) || c.s[0];
  return cs.reduce((b, s) => Math.abs(s.c - c.med) < Math.abs(b.c - c.med) ? s : b);
}
function bEntry(e){
  const c = COURSE.get(norm(e.c)); if (!c) return null;
  const s = (e.sec && c.s.find(x => x.u === e.sec)) || bTypical(c);
  const p = bSecPrice(s, BS.basis);
  const est = p.buy + p.lta;
  let buy = p.buy, lta = p.lta;
  if (e.ov != null){   // the student typed their own cost: keep the LTA / buy-yourself split in proportion
    if (est > 0){ const k = e.ov / est; buy *= k; lta *= k; } else { buy = e.ov; lta = 0; }
  }
  return {c, s, est, buy, lta, pack: e.pk ? p.pack : 0, packs: p.packs, np: p.np, typical: !e.sec};
}

/* ---------------- the plan: bills, credits, savings schedule ---------------- */
function bPlan(){
  const T = bTerm(), start = BD.parse(T.start);
  const buyDate = BD.add(start, -BS.buffer);
  const cheapK = 1 - BS.cheaper / 100, cushK = BS.cushion ? 1.1 : 1;
  const rows = BS.courses.map((e, i) => ({e, i, r: bEntry(e)})).filter(x => x.r);
  const ev = new Map();   // key -> {date, kind, n, parts: [{code, amt, note}]}
  const put = (date, kind, code, amt, extra) => {
    const key = BD.iso(date) + "|" + kind;
    if (!ev.has(key)) ev.set(key, Object.assign({date, kind, parts: []}, extra || {}));
    ev.get(key).parts.push({code, amt});
  };
  const tot = {buy: 0, lta: 0, pack: 0, cheaper: 0, cushion: 0, np: 0};
  for (const {e, r} of rows){
    tot.buy += r.buy; tot.lta += r.lta; tot.pack += r.pack; tot.np += r.np;
    tot.cheaper += r.buy * (1 - cheapK);
    const own = (r.buy * cheapK + r.pack) * cushK, lta = r.lta * cushK;
    tot.cushion += (r.buy * cheapK + r.pack + r.lta) * (cushK - 1);
    if (own > 0.004){
      if (e.pay === "spread"){
        const n = BCFG.spreadWeeks, each = bCents(own / n);
        for (let k = 0; k < n; k++) put(BD.add(buyDate, 7 * k), "spread" + k, e.c, k < n - 1 ? each : bCents(own - each * (n - 1)), {n: k + 1, of: n});
      } else put(buyDate, "buy", e.c, bCents(own));
    }
    if (lta > 0.004) put(BD.parse(T.ltaDue), "lta", e.c, bCents(lta));
  }
  const bills = [...ev.values()].map(b => Object.assign(b, {amt: bCents(b.parts.reduce((a, p) => a + p.amt, 0))})).sort((a, b) => a.date - b.date || a.kind.localeCompare(b.kind));
  const gross = bCents(bills.reduce((a, b) => a + b.amt, 0));
  const credits = Math.max(0, +BS.aid || 0) + Math.max(0, +BS.saved || 0);
  const save = bSchedule(bills, credits);
  const ltaCodes = rows.filter(x => x.r.lta > 0.004).map(x => x.e.c);
  return {T, start, buyDate, rows, bills, tot, gross, credits, need: Math.max(0, bCents(gross - credits)), save, ltaCodes};
}
// Smallest equal deposit, every period from the start date, so money set aside covers every bill by its due date.
function bSchedule(bills, credits){
  const start = BS.start ? BD.parse(BS.start) : BD.today();
  const f = +BS.freq || 7;
  const dep = k => f === 30 ? BD.addMonths(start, k) : BD.add(start, k * f);
  const count = d => { if (d < start) return 0; if (f !== 30) return Math.floor(BD.days(start, d) / f) + 1; let k = 0; while (dep(k) <= d) k++; return k; };
  // Bills due before the first deposit can't be saved for; that money has to be on hand ("short").
  let cum = 0, amount = 0, onHand = 0;
  const short = [];
  for (const b of bills){
    cum += b.amt;
    const need = cum - credits;
    if (need <= 0.004) continue;
    const n = count(b.date);
    if (!n){ onHand = Math.max(onHand, need); short.push({b, need: bCents(need)}); }
    else amount = Math.max(amount, (need - onHand) / n);
  }
  amount = Math.ceil(amount * 100 - 1e-6) / 100;
  const total = Math.max(0, cum - credits - onHand);
  const K = amount > 0 ? Math.max(0, Math.ceil(total / amount - 1e-9)) : 0;
  const cap = Math.max(credits, cum);
  return {start, f, dep, count, amount, K, onHand: bCents(onHand), last: K > 0 ? dep(K - 1) : null, short,
    setAside: d => { const n = count(d); return Math.min(cap, credits + (n ? onHand : 0) + amount * Math.min(n, K)); }};
}

/* ---------------- "Add to my budget" (course pages) ---------------- */
const BUDGET = {
  has: code => BS.courses.some(e => norm(e.c) === norm(code)),
  button(c, sec){
    const inPlan = BUDGET.has(c.c);
    return '<button type="button" class="btn sm addbud' + (inPlan ? " ghost" : "") + '" data-addbud="' + esc(c.c) + '" data-addsec="' + esc(sec || "") + '">' +
      (inPlan ? "✓ In your budget · view" : "+ Add to my budget") + "</button>";
  },
  add(code, sec){
    const c = COURSE.get(norm(code)); if (!c) return false;
    if (BUDGET.has(c.c)) return false;
    const s = (sec && c.s.find(x => x.u === sec)) || bTypical(c);
    BS.courses.push({c: c.c, sec: sec || null, ov: null, pk: !!(s && s.pk && s.pk.length), pay: "once"});
    bSave();
    if (typeof AN !== "undefined") AN.event("budget-add", c.c);
    return true;
  },
  render(){ bRender(); },
  renderSavings(){ sRender(); }
};

/* ---------------- budget page ---------------- */
let bBuilt = false, bCur = [], bSel = -1;
function bRender(){
  const host = document.getElementById("budget");
  if (!bBuilt){ host.innerHTML = bShell(); bBuilt = true; }
  bSyncSettings();
  bDrawCourses(); bDrawTotals();
}
function bShell(){
  const opt = (v, l, cur) => '<option value="' + v + '"' + (String(cur) === String(v) ? " selected" : "") + ">" + l + "</option>";
  return '<div class="hero">' +
    '<div class="eyebrow">Your budget</div>' +
    "<h1>What will your classes cost, and when is the money due?</h1>" +
    "<p>Add the courses you plan to take. We estimate what the required materials cost, show when each payment hits, and work out how much to set aside each week so it never lands all at once.</p>" +
    '<div class="searchbox"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>' +
    '<input id="bq" type="search" autocomplete="off" spellcheck="false" placeholder="Add a course, e.g. BGS 337" aria-label="Add a course to your budget" aria-autocomplete="list" aria-controls="bsugg">' +
    '<div class="sugg" id="bsugg" role="listbox" hidden></div></div>' +
    '<p class="hint" style="margin:0">You can also click <b>Add to my budget</b> on any course page. Your plan is saved in this browser only.</p></div>' +
    '<div class="bp-callout" role="note"><span aria-hidden="true">ⓘ</span><span>Estimates use the <b>Fall 2026</b> book lists, the newest the Co-op has posted. Instructors can change books between terms, so check the syllabus or Canvas before you buy. LTA prices are upper bounds; your real price shows in Canvas.</span></div>' +
    '<div class="bp-grid">' +
      '<div class="bp-main"><div class="card" id="bp-courses"></div><div class="card" id="bp-schedule"></div></div>' +
      '<div class="bp-side"><div class="card" id="bp-summary"></div>' +
      '<div class="card bp-settings" id="bp-settings"><h3>Your assumptions</h3>' +
        '<div class="bp-field"><label for="bp-term">Semester</label><select id="bp-term">' + BCFG.terms.map(t => opt(t.id, t.name, BS.term)).join("") + "</select></div>" +
        '<div class="bp-field"><span class="lbl" id="bp-basis-l">Prices</span><div class="bp-seg" role="group" aria-labelledby="bp-basis-l"><button type="button" data-basis="low">Lowest price</button><button type="button" data-basis="new">Buying new</button></div>' +
          '<p class="hint">“Lowest” is the cheapest new, used, rental or digital price the Co-op lists. “Buying new” uses the new price wherever one is listed.</p></div>' +
        '<div class="bp-field"><label for="bp-buffer">Buy books and codes</label><select id="bp-buffer">' + opt(0, "On the first day of class", BS.buffer) + opt(7, "1 week before classes", BS.buffer) + opt(14, "2 weeks before classes", BS.buffer) + opt(30, "1 month before classes", BS.buffer) + "</select></div>" +
        '<div class="bp-field"><label for="bp-cheaper">What if you find it cheaper? <output id="bp-cheaper-o" class="mono"></output></label><input id="bp-cheaper" type="range" min="0" max="75" step="5">' +
          '<p class="hint">Used copies, library reserves, an older edition or sharing with a classmate. Applies to books and codes you buy yourself, not LTA charges.</p></div>' +
        '<label class="bp-check"><input type="checkbox" id="bp-cushion"><span>Add a 10% cushion for tax, shipping and price changes</span></label>' +
        '<div class="bp-field"><span class="lbl" id="bp-freq-l">Save every</span><div class="bp-seg" role="group" aria-labelledby="bp-freq-l"><button type="button" data-freq="7">Week</button><button type="button" data-freq="14">2 weeks</button><button type="button" data-freq="30">Month</button></div></div>' +
        '<div class="bp-field"><label for="bp-start">Start saving on</label><input id="bp-start" type="date"></div>' +
        '<div class="bp-field"><label for="bp-saved">Already set aside</label><div class="bp-money"><span>$</span><input id="bp-saved" type="number" min="0" step="1" inputmode="decimal" placeholder="0"></div></div>' +
        '<div class="bp-field"><label for="bp-aid">Aid or credit for materials</label><div class="bp-money"><span>$</span><input id="bp-aid" type="number" min="0" step="1" inputmode="decimal" placeholder="0"></div>' +
          '<div style="margin-top:4px"><button type="button" class="chipbtn plain" id="bp-coop">+ Co-op scholarship ($' + BCFG.coopScholarship + ")</button></div>" +
          '<p class="hint">Eligible students see the Co-op scholarship as a credit on their Financial Aid Notification. It works only at the University Co-op, and it can cover LTA charges. <a href="#savings" data-go="savings">More ways to pay less</a></p></div>' +
        '<button type="button" class="btn ghost sm" id="bp-clear" style="justify-self:start">Clear my plan</button>' +
      "</div></div>" +
    "</div>";
}
function bSyncSettings(){
  const q = id => document.getElementById(id);
  q("bp-term").value = BS.term; q("bp-buffer").value = String(BS.buffer);
  q("bp-cheaper").value = BS.cheaper; q("bp-cheaper-o").textContent = BS.cheaper + "%";
  q("bp-cushion").checked = !!BS.cushion;
  q("bp-start").value = BS.start || BD.iso(BD.today());
  q("bp-saved").value = BS.saved ? BS.saved : ""; q("bp-aid").value = BS.aid ? BS.aid : "";
  document.querySelectorAll("#budget [data-basis]").forEach(b => b.setAttribute("aria-pressed", b.dataset.basis === BS.basis));
  document.querySelectorAll("#budget [data-freq]").forEach(b => b.setAttribute("aria-pressed", +b.dataset.freq === +BS.freq));
}
function bDrawCourses(){
  const host = document.getElementById("bp-courses"), T = bTerm();
  if (!BS.courses.length){
    host.innerHTML = '<div class="bp-welcome"><div class="eyebrow">Start here</div><h2>Plan your ' + esc(T.name) + " materials in three steps</h2>" +
      '<ol class="bp-steps">' +
      "<li><div><b>Add your courses</b><span>Search above, or click Add to my budget on a course page.</span></div></li>" +
      "<li><div><b>Pick your section</b><span>Professors teaching the same course often assign different books. If you don't know yet, we use a typical section.</span></div></li>" +
      "<li><div><b>Get your plan</b><span>See every bill and its due date, and how much to put aside each week so you're never short.</span></div></li>" +
      '</ol><div class="cta"><button type="button" class="btn" data-bfocus>Add a course</button><button type="button" class="btn ghost" data-go="savings">Ways to pay less</button></div></div>';
    return;
  }
  const P = bPlan();
  host.innerHTML = '<h3>Your courses <span class="muted">' + plural(P.rows.length, "course") + " · " + esc(T.name) + "</span></h3>" + '<div class="bp-list">' + P.rows.map(({e, i, r}) => {
    const c = r.c, s = r.s;
    const typ = bTypical(c);
    const secOpts = '<option value="">Typical section' + (typ && typ.c != null ? " · " + money(typ.c) : "") + "</option>" +
      c.s.map(x => '<option value="' + esc(x.u) + '"' + (e.sec === x.u ? " selected" : "") + ">" + esc(x.u) + " · " + esc(person(x.in)) + " · " + (x.c != null ? money(x.c) : (x.st === "listed" ? "optional only" : "no books listed")) + "</option>").join("");
    const pk = r.packs.length ? '<label class="bp-check sm"><input type="checkbox" data-bpk="' + i + '"' + (e.pk ? " checked" : "") + "><span>Coursepack " + money(r.packs.reduce((a, p) => a + p.pr, 0)) + ' <span class="muted">· ' + esc([...new Set(r.packs.map(p => p.s))].join(" / ")) + "</span></span></label>" : "";
    const lta = r.lta > 0.004 ? '<span class="tag acc">LTA ' + money(r.lta) + " · billed by UT, due " + BD.md(BD.parse(T.ltaDue)) + (T.est.includes("ltaDue") ? " (est.)" : "") + "</span>" : "";
    const np = r.np ? '<span class="tag">' + plural(r.np, "item") + " without a public price</span>" : "";
    const own = r.buy > 0.004 ? '<span class="tag">You buy: ' + money(r.buy) + "</span>" : "";
    return '<div class="bp-item" data-bi="' + i + '">' +
      '<div class="bp-chead"><div><a class="code mono" href="#course-' + esc(hashOf(c.c)) + '">' + esc(c.c) + '</a><div class="ct">' + esc(tcase(s && s.tt ? s.tt : c.t)) + "</div></div>" +
      '<button type="button" class="bp-x" data-bdel="' + i + '" aria-label="Remove ' + esc(c.c) + '">×</button></div>' +
      '<div class="bp-pick">' +
        '<div class="bp-field"><label for="bsec' + i + '">Section</label><select id="bsec' + i + '" data-bsec="' + i + '">' + secOpts + "</select></div>" +
        '<div class="bp-field"><label for="bcost' + i + '">Required materials</label><div class="bp-money"><span>$</span><input id="bcost' + i + '" type="number" min="0" step="0.01" inputmode="decimal" data-bcost="' + i + '" value="' + (e.ov != null ? e.ov : bCents(r.est).toFixed(2)) + '"></div>' +
          '<p class="hint">' + (e.ov != null ? 'Your number · estimate ' + money(r.est) + ' · <button type="button" class="linkbtn" data-breset="' + i + '">use estimate</button>' : "Estimate" + (r.typical ? " for a typical section" : "") + ". Type your own if you know it.") + "</p></div>" +
        '<div class="bp-field"><label for="bpay' + i + '">Pay for it</label>' + (r.buy + r.pack > 0.004
          ? '<select id="bpay' + i + '" data-bpay="' + i + '"><option value="once"' + (e.pay !== "spread" ? " selected" : "") + ">All at once</option><option value=\"spread\"" + (e.pay === "spread" ? " selected" : "") + ">Over " + BCFG.spreadWeeks + " weeks</option></select>" +
            '<p class="hint">' + (e.pay === "spread" ? BCFG.spreadWeeks + " weekly payments, starting when you buy." : "Before classes start.") + "</p>"
          : '<select id="bpay' + i + '" disabled><option>Billed by UT</option></select><p class="hint">LTA charges come on your What I Owe bill.</p>') + "</div>" +
      "</div>" +
      (pk || lta || np || own ? '<div class="bp-extras">' + pk + own + lta + np + "</div>" : "") +
      "</div>";
  }).join("") + "</div>";
}
function bDrawTotals(){
  const P = bPlan(), T = P.T;
  const sum = document.getElementById("bp-summary"), sch = document.getElementById("bp-schedule");
  if (!P.rows.length){
    sum.innerHTML = "<h3>Your total</h3><div class=\"empty\">Add a course to see what your materials will cost and when each payment is due.</div>" + bBench(0, T);
    sch.hidden = true; return;
  }
  sch.hidden = false;
  const r = (k, v, cls) => '<div class="r' + (cls ? " " + cls : "") + '"><span>' + k + "</span><span></span><span>" + v + "</span></div>";
  const S = P.save, per = {7: "week", 14: "2 weeks", 30: "month"}[S.f];
  let plan;
  if (P.need <= 0.004) plan = '<div class="bp-save ok"><div class="lbl">Savings plan</div><div class="bp-big">You\'re covered</div><div class="sub">Your aid and savings already cover every bill.</div></div>';
  else if (S.short.length && !S.amount) plan = '<div class="bp-save warn"><div class="lbl">Savings plan</div><div class="bp-big">' + money(S.short[S.short.length - 1].need) + '</div><div class="sub">needed by ' + BD.md(S.short[S.short.length - 1].b.date) + ", before your savings start date. Move the start date earlier or add what you've set aside.</div></div>";
  else plan = '<div class="bp-save"><div class="lbl">Set aside</div><div class="bp-big num">' + money(S.amount) + " <small>every " + per + "</small></div>" +
    '<div class="sub">' + plural(S.K, "deposit") + " from " + BD.md(S.start) + (S.last ? " to " + BD.md(S.last) : "") + ". " + (S.short.length ? "Every later bill is" : "Every bill is") + " covered by its due date.</div>" +
    (S.short.length ? '<div class="sub warn-t">' + money(S.short[S.short.length - 1].need) + " is due " + BD.md(S.short[S.short.length - 1].b.date) + ", before your first deposit. You'll need that on hand.</div>" : "") + "</div>";
  sum.innerHTML = "<h3>Your total <span class=\"muted\">" + esc(T.name) + "</span></h3>" +
    '<div class="receipt bp-receipt">' +
      r("Books and codes you buy", money(P.tot.buy)) +
      (P.tot.lta > 0.004 ? r("LTA charges (billed by UT)", money(P.tot.lta)) : "") +
      (P.tot.pack > 0.004 ? r("Coursepacks", money(P.tot.pack)) : "") +
      (BS.cheaper ? r("If you find it " + BS.cheaper + "% cheaper", "−" + money(P.tot.cheaper)) : "") +
      (BS.cushion ? r("10% cushion", "+" + money(P.tot.cushion)) : "") +
      '<div class="lbl" style="margin-top:8px">Materials total</div><div class="total">' + money(P.gross) + "</div>" +
      (P.credits ? (+BS.aid > 0 ? r("Aid and credit", "−" + money(+BS.aid)) : "") + (+BS.saved > 0 ? r("Already set aside", "−" + money(+BS.saved)) : "") + '<div class="lbl" style="margin-top:8px">Still to save</div><div class="total">' + money(P.need) + "</div>" : "") +
      (P.tot.np ? '<div class="sub">' + plural(P.tot.np, "item") + " with no public price " + (P.tot.np === 1 ? "isn't" : "aren't") + " included.</div>" : "") +
    "</div>" + plan + bBench(P.gross, T);
  sch.innerHTML = "<h3>When the money is due <span class=\"muted\">" + esc(T.name) + " starts " + BD.wmd(P.start) + "</span></h3>" + bChart(P) + bTimeline(P);
}
function bBench(gross, T){
  const per = BCFG.aidBudget / 2, max = Math.max(gross, per) || 1;
  const diff = gross - per;
  return '<div class="bp-bench"><div class="lbl">Compared with UT\'s estimate</div>' +
    '<div class="row"><span>Your plan</span><span class="mono">' + money(gross) + '</span></div><div class="meter"><i style="width:' + (gross / max * 100).toFixed(1) + '%"></i></div>' +
    '<div class="row"><span>UT\'s budget per semester</span><span class="mono">' + money(per) + '</span></div><div class="meter ut"><i style="width:' + (per / max * 100).toFixed(1) + '%"></i></div>' +
    '<p class="hint">UT\'s ' + esc(BCFG.aidYear) + " cost of attendance counts " + money0(BCFG.aidBudget) + " for books, course materials, supplies and equipment across fall and spring (" + money0(per) + " a semester). " +
    (gross ? (diff > 0.5 ? "Your plan is " + money(diff) + " over that." : "Your plan fits within it" + (diff < -0.5 ? ", with " + money(-diff) + " to spare" : "") + ".") : "") + "</p></div>";
}
function bTimeline(P){
  const T = P.T, S = P.save, now = BD.today();
  const items = P.bills.map(b => ({date: b.date, b}));
  const est = k => T.est.includes(k) ? " (estimated)" : "";
  if (P.ltaCodes.length){
    items.push({date: BD.parse(T.ltaOptOut), note: "Last day to opt out of LTA" + est("ltaOptOut"), sub: (T.summer ? "4th" : "12th") + " class day · " + P.ltaCodes.join(", ") + ". You're opted in automatically. Opt out only if you'll get the materials another way."});
  }
  if (P.bills.some(b => b.kind === "buy" || b.kind.startsWith("spread"))) items.push({date: BD.parse(T.refundEnd), note: "Last day for a full refund at the Co-op", sub: (T.summer ? "2nd" : "5th") + " class day (13th with proof of add/drop) · books in original condition. Opened access codes can't be returned."});
  items.push({date: P.start, note: "Classes start", sub: ""});
  items.sort((a, b) => a.date - b.date || (a.b ? 1 : 0) - (b.b ? 1 : 0));
  let cum = 0;
  return '<ol class="bp-timeline">' + items.map(x => {
    const past = x.date < now ? " past" : "";
    const d = '<div class="d"><b>' + x.date.getDate() + "</b>" + x.date.toLocaleDateString("en-US", {month: "short"}) + " · " + x.date.toLocaleDateString("en-US", {weekday: "short"}) + "</div>";
    if (!x.b) return '<li class="bp-ev note' + past + '">' + d + '<div><div class="what">' + esc(x.note) + "</div>" + (x.sub ? '<div class="sub">' + esc(x.sub) + "</div>" : "") + "</div><div></div></li>";
    const b = x.b; cum += b.amt;
    const what = b.kind === "lta" ? "Longhorn Textbook Access bill due" + est("ltaDue") : b.kind === "buy" ? "Buy books and codes" : "Materials payment " + b.n + " of " + b.of;
    const sub = (b.kind === "lta" ? "Posted to What I Owe " + BD.md(BD.parse(T.ltaBill)) + est("ltaBill") + " · " : "") + b.parts.map(p => p.code + " " + money(p.amt)).join(" · ");
    const have = S.setAside(b.date), ok = have + 0.005 >= cum;
    return '<li class="bp-ev' + past + '">' + d + '<div><div class="what">' + esc(what) + '</div><div class="sub">' + esc(sub) + "</div>" +
      '<div class="bar" title="Set aside by this date"><i style="width:' + Math.min(100, cum ? have / cum * 100 : 100).toFixed(1) + '%" class="' + (ok ? "" : "short") + '"></i></div>' +
      '<div class="sub">' + (ok ? "Covered: " : "Short: ") + money(Math.min(have, cum)) + " set aside of " + money(cum) + " due so far</div></div>" +
      '<div class="amt num">' + money(b.amt) + "<small>" + BD.md(b.date) + "</small></div></li>";
  }).join("") + "</ol>";
}
function bChart(P){
  const S = P.save, bills = P.bills;
  if (!bills.length) return "";
  const t0 = new Date(Math.min(S.start, bills[0].date)), t1 = new Date(Math.max(bills[bills.length - 1].date, S.last || 0, S.start));
  const span = Math.max(BD.days(t0, t1), 7);
  const W = 640, H = 210, L = 58, R = 18, Tm = 14, B = 30;
  const x = d => L + (BD.days(t0, d) / span) * (W - L - R);
  const steps = []; let cum = 0;
  const pts = [[t0, 0]];
  for (const b of bills){ pts.push([b.date, cum]); cum += b.amt; pts.push([b.date, cum]); }
  pts.push([t1, cum]);
  const sv = []; let have = P.credits + S.onHand;
  sv.push([S.start, have]);
  for (let k = 0; k < S.K; k++){ const d = S.dep(k); sv.push([d, have]); have = Math.min(have + S.amount, Math.max(cum, P.credits)); sv.push([d, have]); }
  sv.push([t1, have]);
  const ymax = Math.max(cum, have, 1) * 1.08;
  const y = v => Tm + (1 - v / ymax) * (H - Tm - B);
  const path = a => a.map(([d, v], i) => (i ? "L" : "M") + x(d).toFixed(1) + " " + y(v).toFixed(1)).join(" ");
  const grid = [0, ymax / 2 / 1.08, ymax / 1.08].map(v => '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(v).toFixed(1) + '" y2="' + y(v).toFixed(1) + '" class="gl"/><text x="' + (L - 8) + '" y="' + (y(v) + 4).toFixed(1) + '" text-anchor="end" class="ax">' + money0(v) + "</text>").join("");
  const months = []; for (let m = new Date(t0.getFullYear(), t0.getMonth() + 1, 1, 12); m <= t1; m = BD.addMonths(m, 1)) months.push(m);
  const xt = months.map(m => '<line x1="' + x(m).toFixed(1) + '" x2="' + x(m).toFixed(1) + '" y1="' + (H - B) + '" y2="' + (H - B + 4) + '" class="tk"/><text x="' + x(m).toFixed(1) + '" y="' + (H - B + 17) + '" text-anchor="middle" class="ax">' + m.toLocaleDateString("en-US", {month: "short"}) + "</text>").join("");
  let c2 = 0;
  const marks = bills.map(b => { c2 += b.amt; return '<circle cx="' + x(b.date).toFixed(1) + '" cy="' + y(c2).toFixed(1) + '" r="5" class="mk" data-tip="' + esc(BD.md(b.date) + " · " + (b.kind === "lta" ? "LTA bill" : b.kind === "buy" ? "Buy books and codes" : "Payment " + b.n + " of " + b.of) + " · " + money(b.amt) + " (" + money(c2) + " due so far)") + '"/>'; }).join("");
  return '<div class="bp-legend"><span><i class="sw sv"></i>Money set aside</span><span><i class="sw bl"></i>Bills due, running total</span></div>' +
    '<svg class="bp-chart" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Money set aside versus bills due over time. Set aside reaches ' + esc(money(have)) + "; bills total " + esc(money(cum)) + '.">' +
    grid + '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + (H - B) + '" y2="' + (H - B) + '" class="base"/>' + xt +
    '<path d="' + path(sv) + '" class="ln sv"/><path d="' + path(pts) + '" class="ln bl"/>' + marks + "</svg>";
}

/* budget page events */
function bUpdate(full){ bSave(); if (full) bDrawCourses(); bDrawTotals(); }
function bSugg(){
  const box = document.getElementById("bsugg"), q = document.getElementById("bq").value;
  bCur = q.trim() ? search(q, 6) : []; bSel = bCur.length ? 0 : -1;
  if (!q.trim()){ box.hidden = true; return; }
  if (!bCur.length){ box.innerHTML = '<div class="empty" style="margin:8px">No course matches "' + esc(q) + '".</div>'; box.hidden = false; return; }
  box.innerHTML = bCur.map((r, i) => '<button type="button" role="option" data-badd="' + esc(r.c.c) + '" aria-selected="' + (i === bSel) + '"><span class="code">' + esc(r.c.c) + '</span><span class="t">' + esc(tcase(r.c.t)) + '</span><span class="why">' + (BUDGET.has(r.c.c) ? "added" : (r.c.med != null ? money(r.c.med) : "no books listed")) + "</span></button>").join("");
  box.hidden = false;
}
function bAddFromSearch(code){
  BUDGET.add(code, null);
  const q = document.getElementById("bq"); q.value = ""; document.getElementById("bsugg").hidden = true;
  bUpdate(true); q.focus();
}
document.addEventListener("input", e => {
  const t = e.target; if (!t.closest || !t.closest("#budget")) return;
  if (t.id === "bq"){ if (typeof D !== "undefined" && D) bSugg(); return; }
  if (t.id === "bp-cheaper"){ BS.cheaper = +t.value; document.getElementById("bp-cheaper-o").textContent = BS.cheaper + "%"; bUpdate(false); return; }
  if (t.id === "bp-saved" || t.id === "bp-aid"){ BS[t.id === "bp-saved" ? "saved" : "aid"] = Math.max(0, parseFloat(t.value) || 0); bUpdate(false); return; }
  if (t.dataset.bcost != null){ const e2 = BS.courses[+t.dataset.bcost]; if (!e2) return; const v = parseFloat(t.value); e2.ov = isNaN(v) ? null : Math.max(0, v); bUpdate(false); }
});
document.addEventListener("change", e => {
  const t = e.target; if (!t.closest || !t.closest("#budget")) return;
  if (t.id === "bp-term"){ BS.term = t.value; bUpdate(true); return; }
  if (t.id === "bp-buffer"){ BS.buffer = +t.value; bUpdate(false); return; }
  if (t.id === "bp-cushion"){ BS.cushion = t.checked; bUpdate(false); return; }
  if (t.id === "bp-start"){ BS.start = t.value || null; bUpdate(false); return; }
  if (t.dataset.bsec != null){ const e2 = BS.courses[+t.dataset.bsec]; e2.sec = t.value || null; e2.ov = null; const r = bEntry(e2); e2.pk = !!(r && r.packs.length); bUpdate(true); return; }
  if (t.dataset.bpay != null){ BS.courses[+t.dataset.bpay].pay = t.value; bUpdate(true); return; }
  if (t.dataset.bpk != null){ BS.courses[+t.dataset.bpk].pk = t.checked; bUpdate(true); return; }
  if (t.dataset.bcost != null) bUpdate(true);   // redraw the "your number / estimate" note after editing a cost
});
document.addEventListener("click", e => {
  const t = e.target;
  const ab = t.closest("[data-addbud]");
  if (ab){
    if (BUDGET.has(ab.dataset.addbud)){ go("budget"); return; }
    BUDGET.add(ab.dataset.addbud, ab.dataset.addsec || null);
    ab.classList.add("ghost"); ab.textContent = "✓ In your budget · view";
    return;
  }
  if (!t.closest("#budget")) return;
  const add = t.closest("[data-badd]"); if (add){ bAddFromSearch(add.dataset.badd); return; }
  if (!t.closest("#budget .searchbox")) { const bx = document.getElementById("bsugg"); if (bx) bx.hidden = true; }
  const del = t.closest("[data-bdel]"); if (del){ BS.courses.splice(+del.dataset.bdel, 1); bUpdate(true); return; }
  const rs = t.closest("[data-breset]"); if (rs){ BS.courses[+rs.dataset.breset].ov = null; bUpdate(true); return; }
  const bs = t.closest("[data-basis]"); if (bs){ BS.basis = bs.dataset.basis; bSyncSettings(); bUpdate(true); return; }
  const fq = t.closest("[data-freq]"); if (fq){ BS.freq = +fq.dataset.freq; bSyncSettings(); bUpdate(false); return; }
  if (t.closest("#bp-coop")){ BS.aid = Math.max(0, +BS.aid || 0) + BCFG.coopScholarship; bSyncSettings(); bUpdate(false); return; }
  if (t.closest("[data-bfocus]")){ document.getElementById("bq").focus(); return; }
  if (t.closest("#bp-clear")){ const keep = BS.term; BS = bDefaults(); BS.term = keep; bSave(); bSyncSettings(); bUpdate(true); return; }
});
document.addEventListener("keydown", e => {
  if (e.target.id !== "bq") return;
  const box = document.getElementById("bsugg");
  if (e.key === "ArrowDown" || e.key === "ArrowUp"){
    if (!bCur.length) return; e.preventDefault();
    bSel = (bSel + (e.key === "ArrowDown" ? 1 : -1) + bCur.length) % bCur.length;
    box.querySelectorAll("button").forEach((b, i) => b.setAttribute("aria-selected", i === bSel));
  } else if (e.key === "Enter"){ e.preventDefault(); if (bCur.length) bAddFromSearch(bCur[Math.max(bSel, 0)].c.c); }
  else if (e.key === "Escape") box.hidden = true;
});

/* ---------------- cheaper materials page ---------------- */
const RES = [
  {id: "borrow", h: "Borrow it before you buy it", intro: "UT Libraries may already have your book, or can get it for you. Check before you pay.", cards: [
    {t: "Course reserves at UT Libraries", tag: ["Free", "good"], p: "Instructors can ask UT Libraries to hold a book or ebook for their class, and many assigned books are already in the catalog. Search for your book's title or ISBN. If it isn't there, ask your instructor whether a copy can go on reserve.", links: [["Search the library catalog", "https://search.lib.utexas.edu/"], ["How course reserves work", "https://lib.utexas.edu/research-help-support/request-course-materials"]], contact: "Questions: pclresv@lib.utexas.edu"},
    {t: "Library ebooks", tag: ["Free", "good"], p: "Some required books are available as UT Libraries ebooks you can read online with your EID. Some ebooks can only be open for a limited number of readers at once, so look early, before the whole class needs the same chapter.", links: [["Search for an ebook", "https://search.lib.utexas.edu/"]]},
    {t: "Interlibrary loan", tag: ["Free", "good"], p: "If UT doesn't own a book, the Libraries can borrow it from another library for you. It isn't instant, so request it well before the reading is due.", links: [["Request through interlibrary loan", "https://lib.utexas.edu/find-borrow/interlibrary-loan"]]},
    {t: "Ask a librarian", tag: ["Free", "good"], p: "Librarians can help you track down a library copy of an assigned book, chapter or article.", links: [["Chat or email a librarian", "https://lib.utexas.edu/research-help-support/ask-us"]]}
  ]},
  {id: "open", h: "Free and open textbooks", intro: "Openly licensed books are free to read and download. They help most in intro courses, or when your instructor is open to alternatives.", cards: [
    {t: "OpenStax", tag: ["Free", "good"], p: "Free, peer-reviewed textbooks from Rice University for common intro courses such as economics, statistics, biology, chemistry, physics and psychology. Read online or download a PDF.", links: [["Browse OpenStax", "https://openstax.org/subjects"]]},
    {t: "Open Textbook Library", tag: ["Free", "good"], p: "A searchable catalog of free, openly licensed textbooks, many with reviews from faculty who have used them.", links: [["Search the Open Textbook Library", "https://open.umn.edu/opentextbooks"]]},
    {t: "UT's guide to open educational resources", tag: ["For instructors too", ""], p: "UT Libraries' guide to open educational resources, including UT programs that help instructors switch to free materials. Worth sharing with an instructor whose course uses an expensive book.", links: [["Open the OER guide", "https://guides.lib.utexas.edu/OER/home"]]},
    {t: "Ask about an older edition", tag: ["Often much cheaper", "info"], p: "If the assigned book is a new edition, ask your instructor whether the previous one will work. Older editions are often far cheaper used, though page numbers and problem sets can differ."}
  ]},
  {id: "buy", h: "Pay less when you do buy", intro: "If you need to buy, a few habits make a big difference.", cards: [
    {t: "Compare every format", tag: ["Saves money", "info"], p: "Each course page on this site shows the lowest price the Co-op lists across new, used, rental and digital copies, plus VitalSource eTextbook prices when the Co-op doesn't sell the item.", links: [["Look up a course", "#find"]]},
    {t: "Wait for the first class if you can", tag: ["Know the deadline", "warn"], p: "Some items are marked “attend class before buying,” and plans can change in week one. Books bought in store at the Co-op can be returned for a full refund through the 5th class day (2nd in summer), or the 13th with proof of add/drop, if they're in original, resaleable condition. Opened access codes can't be returned.", links: [["Co-op return policy", "https://help.universitycoop.com/hc/en-us/articles/4402973660563-Textbook-Return-Policy"]]},
    {t: "Sell books back", tag: ["Get money back", "good"], p: "The Co-op buys books back all year, but finals week usually pays best. If UT is using a book again next semester, the Co-op typically pays 50% of the new price. Bring your student ID; it doesn't matter where you bought the book.", links: [["Co-op buyback", "https://www.universitycoop.com/pages/buybacks"]]},
    {t: "Longhorn Textbook Access", tag: ["Know the deadline", "warn"], p: "In LTA courses you're opted in automatically and billed through What I Owe unless you opt out by the 12th class day (4th in summer). UT says LTA pricing is the lowest available for those materials, so opt out only if you'll get them another way.", links: [["LTA dates and billing (Texas One Stop)", "https://onestop.utexas.edu/longhorn-textbook-access/"]], contact: "Opting in or out: LTAHelp@universitycoop.com · 512-593-5737"}
  ]},
  {id: "money", h: "Money for course materials", intro: "Aid that can pay for books, and the number UT uses when it sizes your aid.", cards: [
    {t: "University Co-op Course Material Scholarship", tag: ["$250 a year", "good"], p: "A $250 yearly credit for low- and middle-income students; families earning up to $150,000 may qualify. If you're eligible, it appears as a credit on your Financial Aid Notification. It can only be used at the University Co-op, in store or online, and it can cover Longhorn Textbook Access charges. Each year's credit has a use-by deadline in mid-July.", links: [["About the scholarship (UT News)", "https://news.utexas.edu/2025/08/29/ut-co-op-reaffirms-commitment-to-student-affordability-with-course-materials-scholarship-extension/"], ["How to use it", "https://help.universitycoop.com/hc/en-us/articles/10037609219731-How-do-I-use-my-University-Co-op-Scholarship-Funds"]]},
    {t: "UT's books and supplies budget", tag: ["$724 a year", "info"], p: "UT's 2026–27 cost of attendance counts $724 for books, course materials, supplies and equipment across fall and spring, about $362 a semester. If your required materials cost much more than that, ask Texas One Stop what your options are.", links: [["Cost of attendance", "https://onestop.utexas.edu/managing-costs/cost-tuition-rates/cost-of-attendance/"], ["Plan your semester", "#budget"]], contact: "Texas One Stop: onestop@utexas.edu · 512-232-6988"},
    {t: "Student Emergency Fund", tag: ["Emergencies only", "warn"], p: "For verified, short-term emergencies such as medical bills or replacing belongings after a fire. It doesn't cover budgeted expenses like books, but it's worth knowing about if an emergency hits mid-semester.", links: [["Dean of Students: Student Emergency Fund", "https://deanofstudents.utexas.edu/sos/student-emergency-fund.php"]], contact: "512-471-5017 · deanofstudents@austin.utexas.edu"}
  ]},
  {id: "help", h: "Who to ask", intro: "Each office handles a different piece.", cards: [
    {t: "Texas One Stop", tag: ["Billing and aid", ""], p: "Paying LTA charges through What I Owe, financial aid, and your cost of attendance.", contact: "onestop@utexas.edu · 512-232-6988", links: [["onestop.utexas.edu", "https://onestop.utexas.edu/longhorn-textbook-access/"]]},
    {t: "University Co-op LTA help", tag: ["Access and opt-outs", ""], p: "Getting into your LTA materials, and opting in or out of LTA for a course.", contact: "LTAHelp@universitycoop.com · 512-593-5737"},
    {t: "UT Libraries", tag: ["Library copies", ""], p: "Course reserves, ebooks and interlibrary loan.", contact: "pclresv@lib.utexas.edu", links: [["Ask a librarian", "https://lib.utexas.edu/research-help-support/ask-us"]]},
    {t: "Dean of Students", tag: ["Emergencies", ""], p: "Student Outreach & Support, including the Student Emergency Fund.", contact: "512-471-5017 · deanofstudents@austin.utexas.edu"}
  ]}
];
const RES_SOURCES = [
  ["Texas One Stop: Cost of attendance", "https://onestop.utexas.edu/managing-costs/cost-tuition-rates/cost-of-attendance/"],
  ["Texas One Stop: University Co-op textbooks and course materials programs (LTA dates)", "https://onestop.utexas.edu/longhorn-textbook-access/"],
  ["Office of the Registrar: 2026–27 calendar", "https://registrar.utexas.edu/calendars/26-27"],
  ["Office of the Registrar: 2027–28 calendar", "https://registrar.utexas.edu/calendars/27-28"],
  ["UT News: Co-op extends course materials scholarship (Aug. 29, 2025)", "https://news.utexas.edu/2025/08/29/ut-co-op-reaffirms-commitment-to-student-affordability-with-course-materials-scholarship-extension/"],
  ["University Co-op Help: Scholarship credit on your Financial Aid Notification", "https://help.universitycoop.com/hc/en-us/articles/10037408164243-How-does-a-student-know-if-they-re-getting-textbook-credit-from-a-University-Co-op-Book-Scholarship"],
  ["University Co-op Help: Scholarship and LTA materials", "https://help.universitycoop.com/hc/en-us/articles/10037476985619-What-if-I-have-a-textbook-that-is-in-the-Longhorn-Textbook-Access-LTA-Program"],
  ["University Co-op Help: Using scholarship funds", "https://help.universitycoop.com/hc/en-us/articles/10037609219731-How-do-I-use-my-University-Co-op-Scholarship-Funds"],
  ["University Co-op Help: Textbook return policy", "https://help.universitycoop.com/hc/en-us/articles/4402973660563-Textbook-Return-Policy"],
  ["University Co-op: Sell your books back", "https://www.universitycoop.com/pages/buybacks"],
  ["UT Libraries: Course materials service", "https://lib.utexas.edu/research-help-support/request-course-materials"],
  ["UT Libraries: Interlibrary loan", "https://lib.utexas.edu/find-borrow/interlibrary-loan"],
  ["UT Libraries: Open educational resources guide", "https://guides.lib.utexas.edu/OER/home"],
  ["Dean of Students: Student Emergency Fund", "https://deanofstudents.utexas.edu/sos/student-emergency-fund.php"]
];
let sBuilt = false;
function sRender(){
  if (sBuilt) return;
  const host = document.getElementById("savings");
  const link = ([l, u]) => u.startsWith("#") ? '<a href="' + esc(u) + '" data-go="' + esc(u.slice(1)) + '">' + esc(l) + "</a>" : '<a href="' + esc(u) + '" target="_blank" rel="noopener">' + esc(l) + " ↗</a>";
  const card = c => '<div class="card bp-res"><div>' + (c.tag ? '<span class="tag ' + c.tag[1] + '">' + esc(c.tag[0]) + "</span>" : "") + "</div><h3>" + esc(c.t) + "</h3><p>" + esc(c.p) + "</p>" +
    (c.links || c.contact ? '<div class="foot">' + (c.links || []).map(link).join("") + (c.contact ? '<span class="contact">' + esc(c.contact) + "</span>" : "") + "</div>" : "") + "</div>";
  const est = (T, k) => T.est.includes(k) ? ' <span class="tag">estimate</span>' : "";
  const row = (T, k, label) => '<div class="row"><span>' + label + '</span><span class="mono">' + BD.wmd(BD.parse(T[k])) + est(T, k) + "</span></div>";
  host.innerHTML = '<div class="hero"><div class="eyebrow">Cheaper materials</div><h1>Ways to pay less, or nothing, for course materials</h1>' +
    "<p>Free borrowing, open textbooks, used and rental options, and money you can apply for. UT sources were checked on " + esc(BD.mdy(BD.parse(BCFG.checked))) + ". Links, prices and policies change, so confirm before you rely on one.</p>" +
    '<div class="cta"><button type="button" class="btn" data-go="budget">Plan your budget</button><button type="button" class="btn ghost" data-go="find">Look up a course</button></div></div>' +
    '<div class="bp-sections">' + RES.map(sec => '<section class="bp-sec" id="res-' + sec.id + '"><h2>' + esc(sec.h) + '</h2><p class="intro">' + esc(sec.intro) + '</p><div class="bp-cards">' + sec.cards.map(card).join("") + "</div></section>").join("") +
    '<section class="bp-sec" id="res-dates"><h2>Dates that matter</h2><p class="intro">From UT\'s registrar and Texas One Stop. Dates marked “estimate” haven\'t been posted yet; they follow the same pattern as earlier terms.</p><div class="bp-dates">' +
      BCFG.terms.map(T => '<div class="bp-term"><b>' + esc(T.name) + "</b>" + row(T, "start", "Classes start") + row(T, "refundEnd", "Co-op full refund ends (" + (T.summer ? "2nd" : "5th") + " class day)") + row(T, "ltaBill", "LTA charges posted") + row(T, "ltaOptOut", "LTA opt-out deadline (" + (T.summer ? "4th" : "12th") + " class day)") + row(T, "ltaDue", "LTA payment due") + "</div>").join("") +
    "</div></section>" +
    '<section class="bp-sec" id="res-sources"><h2>Sources</h2><p class="intro">Checked ' + esc(BD.mdy(BD.parse(BCFG.checked))) + '.</p><ul class="bp-src">' + RES_SOURCES.map(([l, u]) => '<li><a href="' + esc(u) + '" target="_blank" rel="noopener">' + esc(l) + "</a></li>").join("") + "</ul></section>" +
    "</div>";
  sBuilt = true;
}
