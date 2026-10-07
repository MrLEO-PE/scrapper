/**
 * Job-alert emails, in the shape tools/gmail-alerts-to-repo.gs files them: a
 * sanitised message with only From, Subject, Date and a base64 HTML body.
 */

import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const inbox = mkdtempSync(join(tmpdir(), "inbox-"));
process.env.SCRAPPER_INBOX = inbox;
const { mailboxSource, parseEml } = await import("../src/sources/mailbox.ts");

const eml = (from: string, subject: string, date: Date, html: string) =>
  [
    `From: ${from}`,
    `Subject: ${subject}`,
    `Date: ${date.toUTCString()}`,
    "MIME-Version: 1.0",
    "Content-Type: text/html; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(html, "utf8").toString("base64"),
  ].join("\r\n");

const body = `<html><body>
  <p>New matches for you</p>
  <a href="https://www.searchassociates.com/job/123">Head of Physical Education, Hanoi</a>
  <a href="https://www.searchassociates.com/job/124">Secondary Mathematics Teacher</a>
  <a href="https://www.searchassociates.com/job/125">PE Teacher (IB MYP), Bangkok</a>
  <a href="https://www.searchassociates.com/unsubscribe?u=1">Unsubscribe</a>
</body></html>`;

test("reads a filed alert: only the PE roles, with their links", () => {
  const mail = parseEml(eml("Search Associates <alerts@searchassociates.com>", "3 new matches", new Date(), body));
  assert.match(mail.html, /Head of Physical Education, Hanoi/);
  assert.equal(mail.subject, "3 new matches");
});

test("the source turns an alert into PE vacancies and ignores the rest", async () => {
  writeFileSync(join(inbox, "a.eml"), eml("Search Associates <alerts@searchassociates.com>", "3 new matches", new Date(), body));
  const jobs = await mailboxSource.collect({ fresh: false, deep: false, maxJobs: 0 });
  const titles = jobs.map((j) => j.title).sort();
  assert.deepEqual(titles, ["Head of Physical Education, Hanoi", "PE Teacher (IB MYP), Bangkok"]);
  assert.ok(jobs.every((j) => j.url.startsWith("https://www.searchassociates.com/job/")));
  assert.ok(jobs.every((j) => /Search Associates/.test(j.description ?? "")));
});

test("an alert older than the window is news no longer, and is ignored", async () => {
  writeFileSync(join(inbox, "a.eml"), eml("Search Associates <a@searchassociates.com>", "old", new Date(Date.now() - 45 * 86_400_000), body));
  assert.equal((await mailboxSource.collect({ fresh: false, deep: false, maxJobs: 0 })).length, 0);
});
