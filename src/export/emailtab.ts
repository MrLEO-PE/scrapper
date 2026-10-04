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

const esc = (s: unknown): string =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const TIER_LABEL: Record<Recipient["tier"], string> = {
  careers: "careers inbox",
  named: "named contact",
  general: "general inbox",
};

const FACT_LABEL: Record<Recipient["factQuality"], string> = {
  unique: "unique fact",
  structured: "structured fact",
  group: "group letter",
  none: "no fact — not written",
};

/** A Gmail compose link carrying recipient, subject and body in one click. */
function gmailComposeUrl(to: string, subject: string, body: string): string {
  const params = new URLSearchParams({ view: "cm", fs: "1", to, su: subject, body });
  return `https://mail.google.com/mail/?${params.toString()}`;
}

export function emailTabBody(recipients: Recipient[]): string {
  const sendable = recipients.filter((r) => r.body);
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
      r.rank != null ? `rank ${r.rank}` : null,
      r.contactName ? `named: ${r.contactName}` : null,
    ].filter(Boolean).map(esc).join(" · ");

    const sentBadge = r.lastSent
      ? `<span class="em-sent" title="${esc(r.lastSent.date)}">sent ${esc(r.lastSent.date)}${
          r.monthsSinceSent != null ? ` (${Math.round(r.monthsSinceSent)}mo ago)` : ""
        }</span>`
      : "";

    const body = r.body
      ? `<details class="em-preview"><summary>preview letter</summary><pre>${esc(r.body)}</pre></details>
    <button type="button" class="em-btn primary em-copy" data-body="${esc(r.body)}">copy body</button>
    <button type="button" class="em-btn em-copy" data-body="${esc(r.email)}">copy address</button>
    <a class="em-btn" href="${esc(gmailComposeUrl(r.email, r.subject, r.body))}" target="_blank" rel="noopener">open in Gmail</a>`
      : `<span class="em-warn">NEEDS: ${esc(r.missing.join(", "))}</span>`;

    return `  <li class="em-item" data-email="${esc(r.email)}" data-country="${esc(r.country ?? "")}" data-tier="${esc(r.tier)}" data-fact="${esc(r.factQuality)}" data-sent="${r.lastSent ? "1" : "0"}" data-idx="${idx}">
    <label class="tick"><input type="checkbox" class="em-pick" data-mark="rcpt|${esc(r.email)}"><span class="box" aria-hidden="true"></span></label>
    <div>
      <p class="nr-name"><a class="em-mailto" href="mailto:${esc(r.email)}">${esc(r.email)}</a>
        <span class="em-tag em-tag-${esc(r.tier)}">${esc(TIER_LABEL[r.tier])}</span>
        <span class="em-tag em-tag-fact-${esc(r.factQuality)}">${esc(FACT_LABEL[r.factQuality])}</span>
        ${sentBadge}
      </p>
      <p class="nr-meta">${schoolLine}</p>
      ${meta ? `<p class="nr-meta">${meta}</p>` : ""}
      ${body}
    </div>
  </li>`;
  };

  return `
<p class="meta">
  ${recipients.length} recipient addresses (deduplicated from ${recipients.reduce((a, r) => a + r.schools.length, 0)} schools) ·
  ${sendable.length} ready to send · ${recipients.length - sendable.length} missing a fact ·
  ticks and the batch counter are saved in this browser only
</p>

<p class="nr-lead">
  Each row is an address, not a school — a group inbox shared by several campuses shows once, as
  one honest letter about the group, so there is no way to select it twice. Tick as you send;
  the running count below tracks today's batch. The permanent record of who has actually been
  emailed lives in <code>data/sent-log.jsonl</code>, written by <code>npm run mark-sent</code> —
  the ticks here reset if you clear this browser, that file does not.
</p>

<div class="em-bar">
  <input id="emQ" placeholder="Filter by school, email, country…" autocomplete="off">
  <select id="emCountry"><option value="">All countries</option>${countries.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("")}</select>
  <select id="emTier">
    <option value="">Any tier</option>
    <option value="careers">Careers inbox</option>
    <option value="named">Named contact</option>
    <option value="general">General inbox</option>
  </select>
  <label class="em-check"><input type="checkbox" id="emReady" checked> ready to send only</label>
  <label class="em-check"><input type="checkbox" id="emHideSent"> hide already sent</label>
</div>

<div class="em-bar">
  <button type="button" class="em-btn" id="emSelectAll">select all visible</button>
  <button type="button" class="em-btn" id="emSelectNone">clear selection</button>
  <button type="button" class="em-btn primary" id="emCopyAll">copy visible addresses</button>
  <span class="em-check" style="margin-left:4px">one address per line, for a BCC or a mail-merge list — your call whether they get one shared body or the pre-rendered one each</span>
</div>

<p class="em-counter" id="emCounter"></p>

<ul class="nr-list" id="emList">
${recipients.map(card).join("\n")}
</ul>
<p class="nr-lead" style="margin-top:14px">
  After sending a batch, record it permanently: <code>npm run mark-sent -- addr1@school.edu addr2@school.edu</code>
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
  .em-tag-fact-structured { background: color-mix(in srgb, var(--muted) 18%, transparent); color: var(--muted); }
  .em-tag-fact-group { background: color-mix(in srgb, #d29922 18%, transparent); color: #d29922; }
  .em-tag-fact-none { background: color-mix(in srgb, #d1242f 16%, transparent); color: #d1242f; }
  .em-warn { color: #d29922; font-weight: 600; }
  .em-sent { font-size: 11px; color: var(--muted); margin-left: 6px; }
  li.em-item.em-sent-row { opacity: .5; }
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
  var readyOnly = document.getElementById("emReady");
  var hideSent = document.getElementById("emHideSent");
  var counter = document.getElementById("emCounter");

  items.forEach(function (li) {
    if (li.dataset.sent === "1") li.classList.add("em-sent-row");
    var box = li.querySelector(".em-pick");
    box.addEventListener("change", updateCounter);
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
      var matchesSent = !hideSent.checked || li.dataset.sent !== "1";
      var show = matchesText && matchesCountry && matchesTier && matchesReady && matchesSent;
      li.style.display = show ? "" : "none";
      if (show) visible++;
    });
    updateCounter();
  }

  [q, country, tier].forEach(function (el) { el.addEventListener("input", applyFilters); });
  [readyOnly, hideSent].forEach(function (el) { el.addEventListener("change", applyFilters); });
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
