/**
 * Brighton College International: vacancy cards on each school's page.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { cardsFrom, isoDate, placeOf } from "../src/sources/brighton.ts";

const PAGE = `<div class="flex-1"> <h3 class="type-3xl mb-4"> <a href="/job-vacancies/director-of-sport">Director of Sport</a> </h3>
<div class="flex gap-2 mb-6 lg:mb-7"> <svg width="22"><path d="M11 11.9"/></svg> <div class="type-lg uppercase"> BANGKOK, THAILAND </div> </div>
<div class="mb-8 type-xs uppercase"> <div>Closes: 30/11/2026</div> </div>
<div class="type-base mb-6 lg:mb-8"> Brighton College Bangkok is seeking to appoint an outstanding Director of Sport to le... </div> </div>
<div> <a href="/job-vacancies/director-of-sport" class="button--sea">Learn more</a> </div>`;

test("reads a vacancy card", () => {
  const [c] = cardsFrom(PAGE);
  assert.equal(c!.slug, "director-of-sport");
  assert.equal(c!.title, "Director of Sport");
  assert.equal(c!.location, "BANGKOK, THAILAND");
  assert.equal(isoDate(c!.closes), "2026-11-30");
  assert.match(c!.teaser!, /^Brighton College Bangkok is seeking/);
});

test("places a card", () => {
  assert.deepEqual(placeOf("BANGKOK, THAILAND"), { city: "Bangkok", country: "Thailand" });
  assert.deepEqual(placeOf("SINGAPORE"), { country: "Singapore" });
});
