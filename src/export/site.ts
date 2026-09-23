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

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { log } from "../core/logger.ts";
import { getSchools, queryJobs, stats as dbStats } from "../store/db.ts";
import { writeCsv, writeHtml, type SheetRow } from "./sheet.ts";

const NAV = [
  { label: "Open roles", href: "index.html" },
  { label: "Schools", href: "schools.html" },
  { label: "Closed", href: "closed.html" },
  { label: "Download CSV", href: "pe-jobs.csv" },
];

const navFor = (current: string) =>
  NAV.map((n) => ({ ...n, current: n.href === current }));

export interface SiteOptions {
  outDir?: string;
  fields: string[];
}

export function buildSite(opts: SiteOptions): { dir: string; jobs: number; schools: number } {
  const dir = opts.outDir ?? join(process.cwd(), "site");
  mkdirSync(dir, { recursive: true });

  const schools = getSchools();
  const toRows = (status: "open" | "closed"): SheetRow[] =>
    queryJobs({ peOnly: true, status }).map((job) => ({
      job,
      school: job.school_key ? schools.get(job.school_key) : undefined,
    }));

  const open = toRows("open");
  const closed = toRows("closed");
  const schoolRows: SheetRow[] = [...schools.values()]
    .sort((a, b) => (a.country ?? "").localeCompare(b.country ?? "") || a.name.localeCompare(b.name))
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

  writeCsv(join(dir, "pe-jobs.csv"), open, opts.fields, "job");
  writeCsv(join(dir, "schools.csv"), schoolRows, opts.fields, "school");

  // Tell Pages to serve the files as-is rather than running them through
  // Jekyll, which would add a build step for no benefit.
  writeFileSync(join(dir, ".nojekyll"), "");

  log.ok(`site → ${dir}  (${open.length} open, ${closed.length} closed, ${schoolRows.length} schools)`);
  return { dir, jobs: open.length, schools: schoolRows.length };
}
