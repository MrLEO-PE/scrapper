/**
 * The half of the search a scraper cannot do.
 *
 * Two kinds of school end up here, and neither is a failure of coverage —
 * both are places where a person with a browser gets further than any crawler
 * will.
 *
 * The group portals come first because they have the best return: register
 * once with Nord Anglia or Harrow and you are in front of every campus they
 * run. They are also, almost without exception, unreadable — several render
 * their vacancies in the browser, and three refuse crawlers in robots.txt.
 * That refusal binds this scraper and not the reader, which is exactly why
 * the link belongs here rather than in a log of things that failed.
 *
 * Then the individual schools: top-ranked, no careers address, and nobody
 * named on any page the crawl could read. Most of them do publish a
 * leadership page; it just builds client-side. A minute each by hand.
 */

import { loadGroups, schoolGroup } from "./groups.ts";
import { isTargetCountry, targetCountries } from "../directoryconfig.ts";
import type { SchoolRow } from "../store/db.ts";

export interface GroupPortal {
  name: string;
  portal: string;
  kind: string;
  note: string;
  scraped: boolean;
  schools: number;
  top: number;
  countries: string[];
}

/** Group portals, with how many of your schools each one covers. */
export function groupPortals(schools: SchoolRow[]): GroupPortal[] {
  const targets = targetCountries();
  const counts = new Map<string, { n: number; top: number; countries: Set<string> }>();
  for (const s of schools) {
    const g = schoolGroup(s.name, s.website);
    if (!g || !isTargetCountry(s.country, targets)) continue;
    const e = counts.get(g) ?? { n: 0, top: 0, countries: new Set<string>() };
    e.n++;
    if (s.country) e.countries.add(s.country);
    if (s.country_rank != null && s.country_rank <= 20) e.top++;
    counts.set(g, e);
  }

  return loadGroups()
    .filter((g) => g.portal)
    .map((g) => {
      const c = counts.get(g.name);
      return {
        name: g.name,
        portal: g.portal!,
        kind: g.portalKind ?? "own page",
        note: g.portalNote ?? "",
        scraped: !!g.scraped,
        schools: c?.n ?? 0,
        top: c?.top ?? 0,
        countries: c ? [...c.countries].sort() : [],
      };
    })
    // A group with none of your schools is noise; order the rest by what
    // registering actually buys.
    .filter((g) => g.schools > 0)
    .sort((a, b) => b.top - a.top || b.schools - a.schools);
}

/** Top-ranked schools with no careers address and nobody named. */
export function schoolsNeedingAHuman(schools: SchoolRow[]): SchoolRow[] {
  const targets = targetCountries();
  return schools
    .filter(
      (s) =>
        s.country_rank != null && s.country_rank <= 20 &&
        !s.career_email && !s.contact_name &&
        isTargetCountry(s.country, targets),
    )
    .sort((a, b) => (a.country ?? "").localeCompare(b.country ?? "") || (a.country_rank ?? 0) - (b.country_rank ?? 0));
}

const esc = (s: unknown): string =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The page body, to be dropped into the site's standard shell. */
export function norobotBody(schools: SchoolRow[]): string {
  const portals = groupPortals(schools);
  const needy = schoolsNeedingAHuman(schools);
  const covered = portals.reduce((a, b) => a + b.schools, 0);
  const coveredTop = portals.reduce((a, b) => a + b.top, 0);
  const noSite = needy.filter((s) => !s.website).length;

  const byCountry = new Map<string, SchoolRow[]>();
  for (const s of needy) byCountry.set(s.country ?? "—", [...(byCountry.get(s.country ?? "—") ?? []), s]);

  const tick = (id: string) =>
    `<label class="tick"><input type="checkbox" data-mark="${esc(id)}"><span class="box" aria-hidden="true"></span></label>`;

  return `
<p class="meta">
  ${portals.length} group portals covering ${covered} of your schools (${coveredTop} top-twenty) ·
  ${needy.length} schools with no contact found · ticks are saved in this browser only
</p>

<h2 class="nr-h">Group portals — register once, reach every campus</h2>
<p class="nr-lead">
  These are mostly the portals the scraper cannot read: several build their vacancy
  list in the browser, and three refuse crawlers in robots.txt. That refusal applies
  to this scraper, not to you. Applying through them is what the group expects.
</p>
<ul class="nr-list">
${portals.map((g) => `  <li class="nr-item${g.scraped ? " scraped" : ""}">
    ${tick("grp|" + g.name)}
    <div>
      <p class="nr-name">
        <a class="nr-go" href="${esc(g.portal)}" target="_blank" rel="noopener"
           title="${esc(g.kind === "robots-blocked" ? "Their homepage — robots.txt hides the careers path from me" : "Straight to the group's recruitment portal")}"
        >${esc(g.name)}<span class="nr-arrow" aria-hidden="true">↗</span></a>${g.scraped ? ' <span class="nr-tag">already scraped</span>' : ""}
      </p>
      <p class="nr-meta">${g.schools} school${g.schools === 1 ? "" : "s"}${g.top ? ` · <strong>${g.top} top-twenty</strong>` : ""}${g.countries.length ? ` · ${esc(g.countries.join(", "))}` : ""}</p>
      ${g.note ? `<p class="nr-note">${esc(g.note)}</p>` : ""}
    </div>
    <span class="nr-links">
      <span class="nr-btn kind">${esc(g.kind === "robots-blocked" ? "homepage only" : g.kind)}</span>
    </span>
  </li>`).join("\n")}
</ul>

<h2 class="nr-h">Schools where nobody could be named</h2>
<p class="nr-lead">
  Top-twenty schools with no careers address and no name found. ${needy.length - noSite}
  have a site that loads — it simply publishes no staff names a crawler can read, so a
  minute on their “Our Team” or “Contact” page usually settles it. ${noSite} have no
  website yet. Look for the Director of Sport first: they know whether they need a PE
  teacher next August, and they answer their own email.
</p>
${[...byCountry.entries()].map(([country, list]) => `
<h3 class="nr-c">${esc(country)} <span class="nr-n">${list.length}</span></h3>
<ul class="nr-list">
${list.map((s) => `  <li class="nr-item">
    ${tick("sch|" + s.school_key)}
    <div>
      <p class="nr-name"><span class="nr-rank">${s.country_rank}</span> ${s.website
        ? `<a class="nr-go" href="${esc(s.website)}" target="_blank" rel="noopener" title="Open the school's site and look for its leadership page"
           >${esc(s.name)}<span class="nr-arrow" aria-hidden="true">↗</span></a>`
        : esc(s.name)}</p>
      <p class="nr-meta">${esc([s.city, s.student_count ? `${s.student_count.toLocaleString("en-GB")} pupils` : ""].filter(Boolean).join(" · "))}</p>
    </div>
    <span class="nr-links">
      ${s.website ? "" : `<span class="nr-btn warn">no website yet</span>`}
      ${s.careers_url ? `<a class="nr-btn" href="${esc(s.careers_url)}" target="_blank" rel="noopener">Careers</a>` : ""}
      ${s.school_email ? `<a class="nr-btn" href="mailto:${esc(s.school_email)}">${esc(s.school_email)}</a>` : ""}
    </span>
  </li>`).join("\n")}
</ul>`).join("\n")}

<p class="nr-lead" style="margin-top:28px">
  Found a name? Add the school to <code>config/known-schools.json</code>, or set the
  contact with <code>npm run track</code>, and it reaches the sheet properly instead of
  living only in this page.
</p>`;
}
