import { test } from "node:test";
import assert from "node:assert/strict";
import { candidatesFromPage, careerLinks, sameDomain } from "../src/enrich/careerscan.ts";

const SITE = "https://ise.ac.th/";

test("an address named for hiring on a careers page is accepted", () => {
  const html = "<p>Please send your CV to <a href='mailto:hr@ise.ac.th'>hr@ise.ac.th</a>. Thank you.</p>";
  const [c] = candidatesFromPage(html, SITE + "careers/", SITE, true);
  assert.equal(c?.email, "hr@ise.ac.th");
  assert.equal(c?.kind, "hr");
});

test("admissions and info inboxes are never promoted, even beside the words 'apply' and 'CV'", () => {
  const html = "<p>To apply, send your CV and application to admissions@ise.ac.th or info@ise.ac.th</p>";
  assert.deepEqual(candidatesFromPage(html, SITE + "careers/", SITE, true), []);
});

test("a person is accepted only when the page tells you to send your application to them", () => {
  const told = "<p>Interested candidates are invited to submit their CV and cover letter to anna.k@ise.ac.th.</p>";
  assert.equal(candidatesFromPage(told, SITE + "jobs", SITE, true)[0]?.kind, "named");
  const listed = "<p>Our staff: Anna K, anna.k@ise.ac.th, Head of Maths</p>";
  assert.deepEqual(candidatesFromPage(listed, SITE + "jobs", SITE, true), []);
});

test("nothing on a page that is not about jobs counts for a person's address", () => {
  const html = "<p>Send your CV to anna.k@ise.ac.th</p>";
  assert.deepEqual(candidatesFromPage(html, SITE + "about", SITE, false), []);
});

test("a Cloudflare-hidden address is read together with the words around it", () => {
  // "vacancies@renaissance.edu.vn", XOR-encoded with key 0x1c
  const hex = "1c6a7d7f7d727f75796f5c6e79727d756f6f7d727f7932797869326a72";
  const html = `<p>Please apply to our email address: <a href="/cdn-cgi/l/email-protection#${hex}"><span class="__cf_email__" data-cfemail="${hex}">[email&#160;protected]</span></a></p>`;
  const [c] = candidatesFromPage(html, "https://renaissance.edu.vn/working-at-renaissance/", "https://renaissance.edu.vn/", true);
  assert.equal(c?.email, "vacancies@renaissance.edu.vn");
});

test("an address on someone else's domain needs a hiring name AND a careers page", () => {
  assert.equal(sameDomain("hr@standrews.ac.th", "https://www.nordangliaeducation.com/x"), false);
  assert.equal(sameDomain("recruitment@gapps.uwcsea.edu.sg", "https://uwcsea.edu.sg"), true);
  const html = "<p>Send your CV to anna@gmail.com</p>";
  assert.deepEqual(candidatesFromPage(html, SITE + "jobs", SITE, true), []);
});

test("career links: words about hiring count, a staff list does not", () => {
  const html = `<a href="/about/staff">Our Staff</a><a href="/join"><span>Join our team</span></a><a href="/teaching-staff">Teaching Staff</a>`;
  assert.deepEqual(careerLinks(html, SITE), ["https://ise.ac.th/join"]);
});
