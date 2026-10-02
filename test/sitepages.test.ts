/**
 * What the published pages carry for the browser to act on.
 *
 * Which roles you have applied for is known only in your browser — the mark
 * is kept in local storage, and a static page has nowhere else to put it. So
 * the Open roles page and the Applied page are built from the same rows and
 * each keeps its own half at load. That only works if the markup carries
 * three things, and none of them is visible in the rendered table, so they
 * are easy to break without noticing.
 */

import { strict as assert } from "node:assert";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { writeHtml, type SheetRow } from "../src/export/sheet.ts";
import type { JobRow } from "../src/store/db.ts";

const dir = mkdtempSync(join(tmpdir(), "scrapper-pages-"));
after(() => rmSync(dir, { recursive: true, force: true }));

const job = (over: Partial<JobRow>): SheetRow => ({
  job: {
    id: "tes:1", title: "Head of PE", country: "Thailand", status: "open",
    app_form: null, my_status: null, my_status_at: null, deadline_at: null,
    first_seen_at: "2020-01-01", ...over,
  } as JobRow,
});

const build = (name: string, rows: SheetRow[], view?: "default" | "applied") => {
  const path = join(dir, name);
  writeHtml(path, rows, ["applied", "job_title", "application_form"], "job", "T", { view });
  return readFileSync(path, "utf8");
};

test("each page states which half of the split it shows", () => {
  assert.match(build("a.html", [job({})]), /const VIEW = "default"/);
  assert.match(build("b.html", [job({})], "applied"), /const VIEW = "applied"/);
});

test("every row carries the job id the mark is stored against", () => {
  // Without this the browser cannot tell which row it just marked, and the
  // mark cannot survive the nightly rebuild that rewrites every row.
  assert.match(build("c.html", [job({ id: "tes:99" })]), /data-job="tes:99"/);
});

test("a role needing a form to fill in is marked on the row", () => {
  // Matched on the row's class attribute, not the word: the rule that styles
  // it sits in the stylesheet of every page, including pages with no forms.
  assert.match(build("d.html", [job({ app_form: "pdf" })]), /class="[^"]*hasform/);
  assert.doesNotMatch(build("e.html", [job({ app_form: null })]), /class="[^"]*hasform/);
});

test("an empty page says why it is empty rather than looking broken", () => {
  // The Applied page is empty until something is marked, which is exactly
  // when a blank table looks like a bug.
  const html = build("f.html", [job({})], "applied");
  assert.match(html, /id="empty"/);
  assert.match(html, /Mark a role as applied/);
});
