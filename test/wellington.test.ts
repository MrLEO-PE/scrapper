/**
 * Wellington College China.
 *
 * Read from Avature's server-rendered list. Pinned here: cards are found and
 * their ids taken from the JobDetail link, and the school comes from the
 * detail page's "Business unit" field.
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { listingEntries, schoolFrom } from "../src/sources/wellington.ts";

const CARD = `<article class="article article--result">
  <h3><a href="https://wellington.avature.cn/en_GB/jobs/JobDetail/Director-of-Sport/1201" class="link">Director of Sport</a></h3>
  <span class="list-item-location">Shanghai</span>
</article>`;

test("reads the result cards", () => {
  assert.deepEqual(listingEntries(`<main>${CARD}<article class="other">x</article></main>`), [
    { id: "1201", url: "https://wellington.avature.cn/en_GB/jobs/JobDetail/Director-of-Sport/1201", title: "Director of Sport", location: "Shanghai" },
  ]);
});

test("the school is the Business unit field", () => {
  const html = `<div class="label">Business unit</div>\n<div class="value"> Wellington College International Shanghai </div>`;
  assert.equal(schoolFrom(html), "Wellington College International Shanghai");
  assert.equal(schoolFrom("<div>nothing</div>"), undefined);
});
