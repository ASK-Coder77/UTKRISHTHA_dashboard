import assert from "node:assert/strict";
import { isRollNumberValidForYear, isTrackYearCombinationValid, normalizeRollNumber, rollNumberPattern } from "./team-validation.ts";

assert.equal(isTrackYearCombinationValid("web_dev", ["UG1", "UG1"]), true);
assert.equal(isTrackYearCombinationValid("web_dev", ["UG1", "UG2"]), false);
assert.equal(isTrackYearCombinationValid("ai_ml", ["UG2", "UG2"]), true);
assert.equal(isTrackYearCombinationValid("ai_ml", ["UG2", "UG3"]), false);
assert.equal(isTrackYearCombinationValid("ai_ml", ["UG1", "UG1"]), false);

assert.equal(rollNumberPattern.test(normalizeRollNumber(" s20250010001 ")), true);
assert.equal(rollNumberPattern.test("S2025001000"), false);
assert.equal(rollNumberPattern.test("A20250010001"), false);
assert.equal(rollNumberPattern.test("S2025001000A"), false);
assert.equal(isRollNumberValidForYear("S20260030001", "UG1", 2026), true);
assert.equal(isRollNumberValidForYear("S20260030001", "UG2", 2026), false);
assert.equal(isRollNumberValidForYear("S20250010001", "UG2", 2026), true);
assert.equal(isRollNumberValidForYear("S20240020001", "UG3", 2026), true);
assert.equal(isRollNumberValidForYear("S20230020001", "UG4", 2026), true);

console.log("team validation regression tests passed");
