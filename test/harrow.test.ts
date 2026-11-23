/**
 * Harrow International (AISL): openings grouped by campus on one page.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { countryOf, isoDate, rowsFrom } from "../src/sources/harrow.ts";

const PAGE = `<div class="panel panel-default"> <div class="panel-heading "> <h4 class="panel-title">
<a data-toggle="collapse" href="#Harrow_Beijing"><span class="anchor"></span> AISL Harrow Beijing <span class="text-danger pull-right">(11 openings)</span></a></h4></div>
<div id="Harrow_Beijing"><table><tbody><tr class=""> <td class="vertical-middle"> <h4><a class="btn-ajax-modal" data-jid="4078" href="/job/modalView/4078">Whole School Head of PE</a></h4> </td>
<td class="vertical-middle text-center"> Academic </td> <td class="vertical-middle text-center"> Whole School </td> <td class="vertical-middle text-center"> - </td>
<td class="vertical-middle text-center">30/11/2026</td> <td class="text-center"><a href="/site/beforeLogin/4078">Apply</a></td> </tr></tbody></table></div></div>`;

test("reads openings with their campus", () => {
  assert.deepEqual(rowsFrom(PAGE), [
    { id: "4078", title: "Whole School Head of PE", campus: "Harrow Beijing", fn: "Academic", division: "Whole School", closes: "30/11/2026" },
  ]);
  assert.equal(isoDate("30/11/2026"), "2026-11-30");
});

test("places campuses", () => {
  assert.equal(countryOf("Harrow International School Hong Kong"), "Hong Kong");
  assert.equal(countryOf("Harrow Hong Kong Children School Shenzhen Qianhai"), "China");
  assert.equal(countryOf("Harrow International School Bangkok"), "Thailand");
  assert.equal(countryOf("Harrow International School Appi, Japan"), "Japan");
  assert.equal(countryOf("Harrow LiDe School Haikou"), "China");
});
