/**
 * The "Email" tab: one card per recipient address, ready to copy into Gmail.
 *
 * Built around the one rule that actually prevents a double-send: a row *is*
 * a recipient address, not a school, so there is no way to select the same
 * inbox twice. Everything else — the tier badge, the fact-quality flag, the
 * batch counter — exists to help you work through the list in the 80-a-day
 * batches you decided on, without re-deriving by eye which ones are safe.
 */

import type { Recipient } from "./recipients.ts";
import { FORM_LABEL } from "../enrich/knownforms.ts";

const esc = (s: unknown): string =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const TIER_LABEL: Record<Recipient["tier"], string> = {
  careers: "careers inbox",
  named: "named contact",
  general: "general inbox",
};

const FACT_LABEL: Record<Recipient["factQuality"], string> = {
  unique: "specific fact",
  group: "group letter",
  none: "no fact found",
};

/** A Gmail compose link carrying recipient, subject and body in one click. */
function gmailComposeUrl(to: string, subject: string, body: string): string {
  const params = new URLSearchParams({ view: "cm", fs: "1", to, su: subject, body });
  return `https://mail.google.com/mail/?${params.toString()}`;
}

export function emailTabBody(recipients: Recipient[]): string {
  const countries = [...new Set(recipients.map((r) => r.country).filter((c): c is string => !!c))].sort();

  const card = (r: Recipient, idx: number): string => {
    const names = r.schools.map((s) => s.name);
    const schoolLine =
      r.schools.length > 1
        ? `<span class="em-warn">covers ${r.schools.length} schools</span> — ${esc(names.slice(0, 4).join(" / "))}${names.length > 4 ? ` +${names.length - 4}` : ""}`
        : esc(names[0]);

    const meta = [
      r.country,
      r.city,
      r.rank != null ? `rank ${r.rank}${r.rankOf ? ` of ${r.rankOf}` : ""}${r.rankBasis ? ` · ${r.rankBasis}` : ""}` : null,
      r.contactName ? `named: ${r.contactName}` : null,
    ].filter(Boolean).map(esc).join(" · ");

    // What the permanent records say, drawn here so the page is right before any script runs.
    const when = (iso: string): string => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
    const sentDate = r.lastSent?.date ?? "";
    const skipDate = r.skipped?.date ?? "";
    const latest = sentDate && skipDate ? (sentDate >= skipDate ? "applied" : "skipped") : sentDate ? "applied" : skipDate ? "skipped" : "";
    const statusText =
      latest === "applied"
        ? `✅ applied ${when(sentDate)}${r.monthsSinceSent != null && r.monthsSinceSent >= 1 ? ` (${Math.round(r.monthsSinceSent)} mo ago)` : ""} · recorded`
        : latest === "skipped"
          ? `🚫 not interested ${when(skipDate)} · recorded`
          : "not marked yet";

    const body = r.body
      ? `<details class="em-preview"><summary>preview letter</summary><pre>${esc(r.body)}</pre></details>
    <button type="button" class="em-btn primary em-copy" data-body="${esc(r.body)}">copy body</button>
    <button type="button" class="em-btn em-copy" data-body="${esc(r.email)}">copy address</button>
    <a class="em-btn" href="${esc(gmailComposeUrl(r.email, r.subject, r.body))}" target="_blank" rel="noopener">open in Gmail</a>`
      : `<span class="em-warn">NEEDS: ${esc(r.missing.join(", "))}</span>`;

    // The school's own form, to fill in beside the letter. Opens in its own tab.
    const formLink = r.form
      ? `<a class="em-btn em-form" href="${esc(r.form.url)}" target="_blank" rel="noopener" title="${esc(r.form.school)} asks for this form with an application">📄 application form (${esc(FORM_LABEL[r.form.kind])})</a>`
      : "";

    // Every other address on file. Nothing is dropped: any of them reaches the school.
    const KIND: Record<string, string> = { careers: "careers", hr: "HR", principal: "principal", info: "info", admin: "admin", other: "" };
    const chip = (o: Recipient["others"][number]) =>
      `<a class="em-addr" href="mailto:${esc(o.email)}">${esc(o.email)}</a>${KIND[o.kind] ? ` <i>${esc(KIND[o.kind]!)}</i>` : ""}`;
    const shown = r.others.slice(0, 5);
    const rest = r.others.slice(5);
    const othersHtml = r.others.length
      ? `<p class="nr-meta em-others">other addresses on file (any of these reaches the school and can be forwarded): ${shown.map(chip).join(" · ")}${
          rest.length ? ` <details class="em-more"><summary>+${rest.length} more</summary>${rest.map(chip).join(" · ")}</details>` : ""
        }</p>`
      : "";

    return `  <li class="em-item" data-email="${esc(r.email)}" data-country="${esc(r.country ?? "")}" data-tier="${esc(r.tier)}" data-fact="${esc(r.factQuality)}" data-applied-at="${esc(sentDate)}" data-skipped-at="${esc(skipDate)}" data-recent="${r.appliedRecently ? "1" : "0"}" data-form="${r.form ? "1" : "0"}" data-rank="${r.rank ?? ""}" data-share="${r.rankShare != null ? r.rankShare.toFixed(4) : ""}" data-idx="${idx}">
    <label class="tick"><input type="checkbox" class="em-pick" data-mark="rcpt|${esc(r.email)}"><span class="box" aria-hidden="true"></span></label>
    <div>
      <p class="nr-name"><a class="em-mailto" href="mailto:${esc(r.email)}">${esc(r.email)}</a>
        <span class="em-tag em-tag-${esc(r.tier)}">${esc(TIER_LABEL[r.tier])}</span>
        <span class="em-tag em-tag-fact-${esc(r.factQuality)}">${esc(FACT_LABEL[r.factQuality])}</span>
      </p>
      <p class="nr-meta em-statusline"><span class="em-status">${esc(statusText)}</span>
        <button type="button" class="em-mark em-m-applied" title="Record that you sent your application to this address">mark applied</button>
        <button type="button" class="em-mark em-m-skip" title="Hide this address from your working list">not interested</button>
      </p>
      <p class="nr-meta">${schoolLine}</p>
      ${meta ? `<p class="nr-meta">${meta}</p>` : ""}
      ${r.applications.length || r.skippedCount ? `<p class="nr-meta em-history${r.appliedRecently ? " em-recent" : ""}">${r.appliedRecently ? "⚠ you applied here recently — " : ""}${[
        ...r.applications.map((a) => `applied ${new Date(a.at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}: ${esc(a.title)}`),
        r.skippedCount ? `${r.skippedCount} role${r.skippedCount === 1 ? "" : "s"} marked not interested` : "",
      ].filter(Boolean).join(" · ")}</p>` : ""}
      ${r.flags.length ? `<p class="nr-meta em-warn">check: ${esc(r.flags.join(" · "))}</p>` : ""}
      ${othersHtml}
      ${r.form ? `<p class="nr-meta em-warn">this school asks for an application form — fill it in and attach it to the email: ${formLink}</p>` : ""}
      ${body}
    </div>
  </li>`;
  };

  return `
<p class="meta">
  ${recipients.length} recipient addresses (deduplicated from ${recipients.reduce((a, r) => a + r.schools.length, 0)} schools) ·
  ${recipients.filter((r) => r.factQuality === "unique").length} with a specific fact · ${recipients.filter((r) => r.factQuality === "none").length} without one ·
  <span id="emSummary"></span>
</p>

<p class="nr-lead">
  Each row is an address, not a school — a group inbox shared by several campuses shows once, as
  one honest letter about the group, so there is no way to select it twice. Tick as you send;
  the running count below tracks today's batch. The permanent record of who has actually been
  emailed lives in <code>data/sent-log.jsonl</code>, written by <code>npm run mark-sent</code> —
  the ticks here reset if you clear this browser, that file does not.
</p>
<p class="nr-lead">
  <strong>Mark applied</strong> / <strong>not interested</strong> work like the buttons on Open roles: they
  are saved in this browser straight away, and <strong>export marks</strong> turns them into the permanent
  record — save the file, then run <code>npm run import-marks -- marks.json</code>. Rows already in the permanent
  record show <em>recorded</em> beside the date. "Not marked yet" is the working list; switch the status
  filter to see what you applied to, and when.
</p>

<div class="em-bar">
  <input id="emQ" placeholder="Filter by school, email, country…" autocomplete="off">
  <select id="emCountry"><option value="">All countries</option>${countries.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("")}</select>
  <select id="emRank" title="Rank is the school's place in its own country: package and salary first, then tuition fees, then accreditation">
    <option value="">Any rank</option>
    <option value="n:10">Top 10 in each country</option>
    <option value="n:25">Top 25 in each country</option>
    <option value="n:50">Top 50 in each country</option>
    <option value="n:100">Top 100 in each country</option>
    <option value="p:0.2">Top 20% of each country</option>
    <option value="p:0.35">Top 35% of each country</option>
    <option value="p:0.5">Top 50% of each country</option>
    <option value="none">Unranked</option>
  </select>
  <select id="emSort" title="Order of the list">
    <option value="">Order: default</option>
    <option value="rank">Best rank first</option>
    <option value="share">Best share of country first</option>
  </select>
  <select id="emTier">
    <option value="">Any tier</option>
    <option value="careers">Careers inbox</option>
    <option value="named">Named contact</option>
    <option value="general">General inbox</option>
  </select>
  <label class="em-check"><input type="checkbox" id="emReady" checked> specific fact only</label>
  <select id="emStatus" title="Which addresses to list">
    <option value="undecided">Not marked yet</option>
    <option value="applied">Applied</option>
    <option value="skipped">Not interested</option>
    <option value="all">All</option>
  </select>
  <label class="em-check"><input type="checkbox" id="emFormOnly"> has an application form</label>
  <label class="em-check"><input type="checkbox" id="emHideApplied" checked> hide schools I applied to in the last 60 days</label>
</div>

<div class="em-bar">
  <button type="button" class="em-btn" id="emSelectAll">select all visible</button>
  <button type="button" class="em-btn" id="emSelectNone">clear selection</button>
  <button type="button" class="em-btn primary" id="emCopyAll">copy visible addresses</button>
  <button type="button" class="em-btn" id="emExport" title="Download your applied / not-interested marks, then run: npm run import-marks -- marks.json">export marks</button>
  <span class="em-check" style="margin-left:4px">one address per line, for a BCC or a mail-merge list — your call whether they get one shared body or the pre-rendered one each</span>
</div>

<p class="em-counter" id="emCounter"></p>

<ul class="nr-list" id="emList">
${recipients.map(card).join("\n")}
</ul>
<p class="nr-lead" style="margin-top:14px">
  After sending a batch, record it permanently (or use the mark applied buttons, then export): <code>npm run mark-sent -- addr1@school.edu addr2@school.edu</code>
  (or paste a list of addresses into <code>--file sent.txt</code>). The next build greys those rows out and
  shows the date, for every device — not just this browser.
</p>`;
}

/** Extra CSS for the cards and filter bar, appended alongside the shared page stylesheet. */
export const EMAIL_TAB_CSS = `
  .em-bar { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 10px; align-items: center; }
  .em-bar input, .em-bar select { padding: 7px 10px; border: 1px solid var(--line); border-radius: 7px; background: var(--bg); color: var(--fg); margin: 0; width: auto; }
  .em-check { font-size: 13px; color: var(--muted); display: flex; align-items: center; gap: 5px; cursor: pointer; user-select: none; }
  .em-counter { font-weight: 600; margin: 0 0 12px; }
  .em-tag { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; padding: 2px 6px; border-radius: 4px; margin-left: 6px; vertical-align: 1px; }
  .em-tag-careers { background: color-mix(in srgb, #1f883d 18%, transparent); color: #1f883d; }
  .em-tag-named { background: color-mix(in srgb, dodgerblue 18%, transparent); color: dodgerblue; }
  .em-tag-general { background: color-mix(in srgb, var(--muted) 20%, transparent); color: var(--muted); }
  .em-tag-fact-unique { background: color-mix(in srgb, #1f883d 12%, transparent); color: #1f883d; }
  .em-tag-fact-group { background: color-mix(in srgb, #d29922 18%, transparent); color: #d29922; }
  .em-tag-fact-none { background: color-mix(in srgb, #d1242f 16%, transparent); color: #d1242f; }
  .em-warn { color: #d29922; font-weight: 600; }
  .em-history { color: var(--muted); }
  .em-recent { color: var(--warn); font-weight: 600; }
  .em-statusline { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-top: 4px; }
  .em-status { font-weight: 600; font-size: 12.5px; margin-right: 4px; }
  button.em-mark { font: inherit; font-size: 12px; padding: 3px 9px; border: 1px solid var(--line); border-radius: 999px; background: var(--bg); color: var(--muted); cursor: pointer; }
  button.em-mark:hover { border-color: #1f883d; color: #1f883d; }
  button.em-mark.em-m-skip:hover { border-color: var(--muted); color: var(--fg); }
  button.em-mark.done { border-color: #1f883d; background: color-mix(in srgb, #1f883d 18%, transparent); color: inherit; font-weight: 600; }
  button.em-mark.em-m-skip.done { border-color: var(--muted); background: color-mix(in srgb, var(--muted) 20%, transparent); }
  li.em-item.em-applied { border-left: 3px solid #1f883d; background: color-mix(in srgb, #1f883d 8%, transparent); }
  li.em-item.em-skipped { opacity: .55; }
  .em-others { font-size: 12px; }
  .em-others i { font-style: normal; font-size: 10px; color: var(--muted); border: 1px solid var(--line); border-radius: 4px; padding: 0 4px; }
  .em-others a.em-addr { color: inherit; }
  details.em-more { display: inline; }
  details.em-more summary { display: inline; cursor: pointer; color: var(--muted); }
  a.em-form { border-color: var(--warn); color: var(--warn); font-weight: 600; margin: 0 0 0 4px; }
  .em-preview { margin: 6px 0; }
  .em-preview summary { cursor: pointer; font-size: 12.5px; color: var(--muted); }
  .em-preview pre { white-space: pre-wrap; font: 12.5px/1.5 ui-monospace, monospace; background: var(--head); border: 1px solid var(--line); border-radius: 6px; padding: 10px; margin: 6px 0 0; }
  .em-btn { font-size: 12px; padding: 4px 10px; border: 1px solid var(--line); border-radius: 999px; background: var(--bg); color: inherit; cursor: pointer; text-decoration: none; margin: 4px 6px 0 0; display: inline-block; }
  .em-btn:hover { border-color: var(--fg); }
  .em-btn.primary { background: var(--fg); color: var(--bg); border-color: var(--fg); font-weight: 600; }
  .em-btn.copied { border-color: #1f883d; color: #1f883d; }
`;

/**
 * Extra client-side behaviour: filters, copy-to-clipboard, the batch counter.
 *
 * The pick checkboxes themselves (data-mark="rcpt|…") are already wired up by
 * the page shell's own script in sheet.ts — the same per-browser tick store
 * the No-robot tab uses, which also persists the checked state and the
 * "ticked" (struck-through) styling. This script runs after that one, so it
 * only has to listen for changes, not persist them itself.
 */
export const EMAIL_TAB_SCRIPT = `
(function () {
  var list = document.getElementById("emList");
  if (!list) return;
  var items = [...list.querySelectorAll("li.em-item")];
  var q = document.getElementById("emQ");
  var country = document.getElementById("emCountry");
  var tier = document.getElementById("emTier");
  var rankSel = document.getElementById("emRank");
  var sortSel = document.getElementById("emSort");
  var readyOnly = document.getElementById("emReady");
  var statusSel = document.getElementById("emStatus");
  var formOnly = document.getElementById("emFormOnly");
  var hideApplied = document.getElementById("emHideApplied");
  var counter = document.getElementById("emCounter");

  // ---- applied / not interested ------------------------------------------------------
  // Saved in this browser at once; "export marks" + "npm run import-marks" make them
  // permanent. A row already in the permanent record shows "recorded". Whichever
  // decision is latest — recorded, or marked here — is the one shown.
  var MARKS = "email-marks";
  function readMarks() { try { return JSON.parse(localStorage.getItem(MARKS) || "{}"); } catch (e) { return {}; } }
  function writeMarks(m) { try { localStorage.setItem(MARKS, JSON.stringify(m)); } catch (e) { /* private window */ } }
  var marks = readMarks();
  function nice(iso) { return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }); }

  function stateOf(li) {
    var c = [];
    if (li.dataset.appliedAt) c.push({ s: "applied", at: li.dataset.appliedAt, src: "recorded" });
    if (li.dataset.skippedAt) c.push({ s: "skipped", at: li.dataset.skippedAt, src: "recorded" });
    var m = marks[li.dataset.email];
    if (m) c.push({ s: m.s, at: m.at, src: "browser" });
    c.sort(function (a, b) { return a.at < b.at ? -1 : a.at > b.at ? 1 : (a.src === "browser" ? 1 : -1); });
    return c.length ? c[c.length - 1] : { s: "", at: "", src: "" };
  }

  function paint(li) {
    var st = stateOf(li);
    li.dataset.state = st.s || "undecided";
    li.classList.toggle("em-applied", st.s === "applied");
    li.classList.toggle("em-skipped", st.s === "skipped");
    var tag = st.src === "recorded" ? " · recorded" : "";
    li.querySelector(".em-status").textContent =
      st.s === "applied" ? "✅ applied " + nice(st.at) + tag
      : st.s === "skipped" ? "🚫 not interested " + nice(st.at) + tag
      : "not marked yet";
    var a = li.querySelector(".em-m-applied"), k = li.querySelector(".em-m-skip");
    a.classList.toggle("done", st.s === "applied");
    k.classList.toggle("done", st.s === "skipped");
    a.textContent = st.s === "applied" ? (st.src === "browser" ? "applied — undo" : "applied ✓") : "mark applied";
    k.textContent = st.s === "skipped" ? (st.src === "browser" ? "not interested — undo" : "not interested ✓") : "not interested";
  }

  function summary() {
    var n = { applied: 0, skipped: 0, undecided: 0 };
    items.forEach(function (li) { n[li.dataset.state || "undecided"]++; });
    var el = document.getElementById("emSummary");
    if (el) el.textContent = n.applied + " applied · " + n.skipped + " not interested · " + n.undecided + " not marked yet";
  }

  function toggle(li, which) {
    var email = li.dataset.email, st = stateOf(li);
    if (st.s === which && st.src === "browser") delete marks[email];
    else if (st.s === which) return; // already in the permanent record: nothing to add
    else marks[email] = { s: which, at: new Date().toISOString() };
    writeMarks(marks);
    paint(li);
    applyFilters();
  }

  items.forEach(function (li) {
    paint(li);
    var box = li.querySelector(".em-pick");
    box.addEventListener("change", updateCounter);
  });
  list.addEventListener("click", function (e) {
    var a = e.target.closest(".em-m-applied"), k = e.target.closest(".em-m-skip");
    if (a) toggle(a.closest("li.em-item"), "applied");
    else if (k) toggle(k.closest("li.em-item"), "skipped");
  });

  var exportBtn = document.getElementById("emExport");
  if (exportBtn) exportBtn.addEventListener("click", function () {
    function read(key) { try { return JSON.parse(localStorage.getItem(key) || "{}"); } catch (e) { return {}; } }
    var emailApplied = {}, emailSkipped = {};
    Object.keys(marks).forEach(function (e) { (marks[e].s === "applied" ? emailApplied : emailSkipped)[e] = marks[e].at; });
    var blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), applied: read("applied-dates"), skipped: read("skipped-dates"), emailApplied: emailApplied, emailSkipped: emailSkipped }, null, 2)], { type: "application/json" });
    var link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "marks.json";
    link.click();
    URL.revokeObjectURL(link.href);
  });

  function updateCounter() {
    var picked = items.filter(function (li) { return li.style.display !== "none" && li.querySelector(".em-pick").checked; }).length;
    counter.textContent = picked + " selected for today's batch (aim for 80/day)";
  }

  function applyFilters() {
    var needle = (q.value || "").toLowerCase();
    var c = country.value, t = tier.value;
    var visible = 0;
    items.forEach(function (li) {
      var matchesText = li.textContent.toLowerCase().indexOf(needle) !== -1;
      var matchesCountry = !c || li.dataset.country === c;
      var matchesTier = !t || li.dataset.tier === t;
      var matchesReady = !readyOnly.checked || li.dataset.fact !== "none";
      var rk = rankSel.value, matchesRank = true;
      if (rk === "none") matchesRank = li.dataset.rank === "";
      else if (rk) {
        var kind = rk.charAt(0), lim = parseFloat(rk.slice(2));
        matchesRank = li.dataset.rank !== "" && (kind === "n" ? parseInt(li.dataset.rank, 10) <= lim : parseFloat(li.dataset.share) <= lim);
      }
      var want = statusSel.value;
      var matchesStatus = want === "all" || (li.dataset.state || "undecided") === want;
      var matchesApplied = !hideApplied.checked || li.dataset.recent !== "1";
      var show = matchesText && matchesCountry && matchesTier && matchesReady && matchesStatus && matchesApplied && matchesRank && (!formOnly.checked || li.dataset.form === "1");
      li.style.display = show ? "" : "none";
      if (show) visible++;
    });
    updateCounter();
    summary();
  }

  [q, country, tier].forEach(function (el) { el.addEventListener("input", applyFilters); });
  [readyOnly, statusSel, hideApplied, rankSel, formOnly].forEach(function (el) { el.addEventListener("change", applyFilters); });
  // Ordering: the page is built best-country-rank first within each country; this reorders in place.
  var original = items.slice();
  function applySort() {
    var by = sortSel.value;
    var ordered = original.slice();
    if (by) {
      var key = by === "rank" ? "rank" : "share";
      ordered.sort(function (a, b) {
        var x = a.dataset[key] === "" ? Infinity : parseFloat(a.dataset[key]);
        var y = b.dataset[key] === "" ? Infinity : parseFloat(b.dataset[key]);
        return x - y;
      });
    }
    ordered.forEach(function (li) { list.appendChild(li); });
  }
  sortSel.addEventListener("change", applySort);
  applyFilters();

  function visibleItems() {
    return items.filter(function (li) { return li.style.display !== "none"; });
  }

  function copyText(btn, text) {
    navigator.clipboard.writeText(text).then(function () {
      var original = btn.textContent;
      btn.textContent = "copied!";
      btn.classList.add("copied");
      setTimeout(function () { btn.textContent = original; btn.classList.remove("copied"); }, 1400);
    }).catch(function () { /* clipboard unavailable — mailto/select-all still work */ });
  }

  list.addEventListener("click", function (e) {
    var btn = e.target.closest(".em-copy");
    if (!btn) return;
    copyText(btn, btn.dataset.body);
  });

  // Ticking every visible row at once — filtered to, say, Vietnam — is for
  // when you've decided to send one shared body to all of them rather than
  // the pre-rendered letter each. That is a real, legitimate choice some of
  // the time; the page's job is to make the filtered list easy to grab, not
  // to forbid the choice.
  var selectAll = document.getElementById("emSelectAll");
  var selectNone = document.getElementById("emSelectNone");
  var copyAll = document.getElementById("emCopyAll");

  if (selectAll) selectAll.addEventListener("click", function () {
    visibleItems().forEach(function (li) {
      var box = li.querySelector(".em-pick");
      if (!box.checked) { box.checked = true; box.dispatchEvent(new Event("change")); }
    });
  });
  if (selectNone) selectNone.addEventListener("click", function () {
    items.forEach(function (li) {
      var box = li.querySelector(".em-pick");
      if (box.checked) { box.checked = false; box.dispatchEvent(new Event("change")); }
    });
  });
  if (copyAll) copyAll.addEventListener("click", function () {
    var addresses = visibleItems().map(function (li) { return li.dataset.email; });
    copyText(copyAll, addresses.join("\\n"));
  });
})();
`;
