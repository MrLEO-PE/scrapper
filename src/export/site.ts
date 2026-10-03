/**
 * Builds the folder published to GitHub Pages.
 *
 * GitHub Pages only serves static files, so the scraping itself happens in a
 * GitHub Actions run; this turns the resulting database into a small site you
 * can open on any device:
 *
 *   index.html    open PE vacancies, leadership highlighted
 *   schools.html  one row per school, with the contact details
 *   closed.html   roles no longer listed, kept for reference
 *   *.csv         the same tables, for Google Sheets
 *
 * Filenames are stable (no date stamp) so the published URLs never change.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { log } from "../core/logger.ts";
import { byCountryRank, getSchools, queryJobs, stats as dbStats } from "../store/db.ts";
import { isTargetCountry, targetCountries, vacancyInScope } from "../directoryconfig.ts";
import { writeCsv, writeHtml, writePage, type SheetRow } from "./sheet.ts";
import { norobotBody } from "./norobot.ts";

/**
 * Work out `owner/repo` so the pages can link back to the Actions tab.
 *
 * GitHub sets GITHUB_REPOSITORY inside a workflow; locally we read the git
 * remote instead, so the button is correct either way.
 */
function repoSlug(): string | null {
  const fromEnv = process.env.GITHUB_REPOSITORY;
  if (fromEnv?.includes("/")) return fromEnv;
  try {
    const remote = execFileSync("git", ["remote", "get-url", "origin"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const m = /github\.com[/:]([^/]+\/[^/.]+)(?:\.git)?$/.exec(remote);
    return m?.[1] ?? null;
  } catch {
    return null;
  }
}

interface NavItem {
  label: string;
  href: string;
  current?: boolean;
  cta?: boolean;
}

function buildNav(): NavItem[] {
  const nav: NavItem[] = [
    { label: "Open roles", href: "index.html" },
    { label: "Applied", href: "applied.html" },
    { label: "Schools", href: "schools.html" },
    { label: "Closed", href: "closed.html" },
    { label: "Download CSV", href: "pe-jobs.csv" },
    // Last of the ordinary tabs: the work no crawler can do for you.
    { label: "No robot school", href: "norobot.html" },
  ];

  // A published page is static and cannot scrape anything itself, so the
  // button sends you to the workflow, where "Run workflow" starts a run.
  const slug = repoSlug();
  if (slug) {
    nav.push({
      label: "▶ Run a new scrape",
      href: `https://github.com/${slug}/actions/workflows/scrape.yml`,
      cta: true,
    });
  }
  return nav;
}

const navFor = (current: string) =>
  buildNav().map((n) => ({ ...n, current: n.href === current }));

export interface SiteOptions {
  outDir?: string;
  fields: string[];
}

export function buildSite(opts: SiteOptions): { dir: string; jobs: number; schools: number } {
  const dir = opts.outDir ?? join(process.cwd(), "site");
  mkdirSync(dir, { recursive: true });

  const schools = getSchools();
  // Every view holds to the countries in config/directory.json. Scraping still
  // covers the world, so widening the config brings roles back at the next
  // build — nothing has to be re-scraped.
  const targets = targetCountries();

  const toRows = (status: "open" | "closed"): SheetRow[] =>
    queryJobs({ peOnly: true, status })
      .filter((job) => vacancyInScope(job.country, targets))
      .map((job) => ({
        job,
        school: job.school_key ? schools.get(job.school_key) : undefined,
      }));

  const open = toRows("open");
  const closed = toRows("closed");
  const schoolRows: SheetRow[] = [...schools.values()]
    .filter((s) => isTargetCountry(s.country, targets))
    .sort(byCountryRank)
    .map((school) => ({ school }));

  const s = dbStats();
  const note = `${s.leadership} leadership roles · ${s.schoolsWithCareerEmail} schools with a careers email`;

  writeHtml(join(dir, "index.html"), open, opts.fields, "job", "International school PE vacancies", {
    nav: navFor("index.html"),
    note,
  });
  writeHtml(join(dir, "schools.html"), schoolRows, opts.fields, "school", "Schools — PE profile", {
    nav: navFor("schools.html"),
  });
  writeHtml(join(dir, "closed.html"), closed, opts.fields, "job", "Closed / filled roles", {
    nav: navFor("closed.html"),
    note: "kept for reference — these are no longer listed",
  });

  /*
   * The roles you have applied for.
   *
   * Built from the open roles and the closed ones together, so an application
   * does not disappear from your own record the week the advert comes down —
   * that is exactly when you are still waiting to hear back.
   *
   * It carries every row, and the page itself keeps only the marked ones;
   * Open roles does the reverse. Neither can be decided here, because the
   * marks live in your browser and this file is written long before it.
   */
  writeHtml(join(dir, "applied.html"), [...open, ...closed], opts.fields, "job", "Roles you have applied for", {
    nav: navFor("applied.html"),
    note: "marked in this browser, so this list is per-device — `npm run track` is the permanent record",
    view: "applied",
  });

  /*
   * Everything a crawler cannot reach: the group portals that render in the
   * browser or refuse robots, and the top schools that name nobody on any
   * page this can read. Both are jobs for a person, so they get a page that
   * can be worked through and ticked off rather than a line in a log.
   */
  writePage(join(dir, "norobot.html"), "No robot school", norobotBody([...schools.values()]), {
    nav: navFor("norobot.html"),
  });

  writeCsv(join(dir, "pe-jobs.csv"), open, opts.fields, "job");
  writeCsv(join(dir, "schools.csv"), schoolRows, opts.fields, "school");

  // Tell Pages to serve the files as-is rather than running them through
  // Jekyll, which would add a build step for no benefit.
  writeFileSync(join(dir, ".nojekyll"), "");

  log.ok(`site → ${dir}  (${open.length} open, ${closed.length} closed, ${schoolRows.length} schools)`);
  return { dir, jobs: open.length, schools: schoolRows.length };
}
