/**
 * Social pages: recorded for the reader, never read by the scraper.
 *
 * Two things are being protected here. One is usefulness — a school with no
 * website still has a Facebook page carrying the head's name and a contact
 * address, and that link is worth having. The other is the rule that the
 * scraper must never fetch those hosts, which has to hold even when the link
 * is stored in the same field a website would occupy.
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { bestSocial, extractSocial, isNeverFetch } from "../src/enrich/social.ts";

test("refuses to fetch the platforms that forbid automated collection", () => {
  for (const url of [
    "https://www.facebook.com/AISDofficialpage/",
    "https://facebook.com/someschool",
    "https://www.instagram.com/al_rabeeh_academy",
    "https://www.linkedin.com/school/aisd",
    "https://x.com/someschool",
    "https://www.tiktok.com/@someschool",
    "fb.me/someschool",
  ]) {
    assert.equal(isNeverFetch(url), true, `${url} must never be fetched`);
  }
});

test("an ordinary school website is still fetchable", () => {
  for (const url of [
    "https://www.aisdhaka.org",
    "https://lincoln.ed.cr/en/about-us",
    // A school whose name merely contains a platform word.
    "https://www.facebookschool.edu.ng",
    "https://instagram-academy.ac.uk",
  ]) {
    assert.equal(isNeverFetch(url), false, `${url} is a normal site`);
  }
  assert.equal(isNeverFetch(null), false);
  assert.equal(isNeverFetch("not a url"), false);
});

test("finds a school's own pages in advert text", () => {
  // Both of these are real, from adverts already in the database.
  const found = extractSocial(
    "Follow us at https://www.instagram.com/al_rabeeh_academy and " +
      "https://www.facebook.com/AISDofficialpage/ for updates",
  );
  assert.deepEqual(found.map((f) => f.kind).sort(), ["facebook", "instagram"]);
  assert.ok(found.some((f) => f.url === "https://instagram.com/al_rabeeh_academy"));
});

test("ignores share buttons and platform furniture", () => {
  // Every school site has these in its footer; none of them is the school.
  const found = extractSocial(
    "<a href='https://www.facebook.com/sharer/sharer.php?u=x'>Share</a>" +
      "<a href='https://www.facebook.com/login'>Log in</a>" +
      "<a href='https://www.instagram.com/explore/tags/school'>tag</a>" +
      "<a href='https://www.instagram.com/p/Cabc123/'>a post</a>" +
      "<a href='https://www.linkedin.com/legal/privacy-policy'>privacy</a>",
  );
  assert.deepEqual(found, []);
});

test("ignores a path too deep to be an account", () => {
  const found = extractSocial("https://www.facebook.com/school/photos/albums/2024/sports-day");
  assert.deepEqual(found, []);
});

test("strips tracking query strings so one page is one link", () => {
  const found = extractSocial(
    "https://www.facebook.com/someschool?ref=page_internal " +
      "https://facebook.com/someschool?fbclid=abc",
  );
  assert.equal(found.length, 1);
  assert.equal(found[0]?.url, "https://facebook.com/someschool");
});

test("prefers Facebook, which carries the most usable detail", () => {
  // Instagram is photographs and LinkedIn is staff; a school's Facebook About
  // section is where the head's name and a contact address actually appear.
  const links = extractSocial(
    "https://www.instagram.com/someschool https://www.linkedin.com/school/someschool " +
      "https://www.facebook.com/someschool",
  );
  assert.equal(bestSocial(links)?.kind, "facebook");
  assert.equal(bestSocial(links.filter((l) => l.kind !== "facebook"))?.kind, "instagram");
  assert.equal(bestSocial([]), undefined);
});
