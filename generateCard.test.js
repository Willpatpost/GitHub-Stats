const test = require("node:test");
const assert = require("node:assert/strict");

const {
  calculateStreaksAndTotals,
  calculateTopLanguages,
  escapeXml,
  formatDateRange,
  formatTimestamp,
} = require("./generateCard");

test("weekends bridge contribution streaks without starting streaks by themselves", () => {
  const result = calculateStreaksAndTotals(
    [
      { date: "2026-07-10", contributionCount: 1 },
      { date: "2026-07-11", contributionCount: 0 },
      { date: "2026-07-12", contributionCount: 0 },
      { date: "2026-07-13", contributionCount: 2 },
    ],
    new Date("2026-07-13T12:00:00.000Z"),
  );

  assert.equal(result.currentStreak, 4);
  assert.equal(result.currentStreakStart, "2026-07-10");
  assert.equal(result.currentStreakEnd, "2026-07-13");
});

test("a missed weekday ends the current streak", () => {
  const result = calculateStreaksAndTotals(
    [
      { date: "2026-07-10", contributionCount: 1 },
      { date: "2026-07-13", contributionCount: 0 },
    ],
    new Date("2026-07-13T12:00:00.000Z"),
  );

  assert.equal(result.currentStreak, 0);
  assert.equal(result.longestStreak, 3);
});

test("top languages falls back when every language crosses the exclusion threshold", () => {
  const result = calculateTopLanguages({ JavaScript: 1000 });

  assert.deepEqual(result, [{ lang: "JavaScript", percent: 100 }]);
});

test("generated text helpers are safe and deterministic", () => {
  assert.equal(escapeXml("A&B <C> \"D\""), "A&amp;B &lt;C&gt; &quot;D&quot;");
  assert.equal(formatDateRange("2026-07-10", "2026-07-13"), "Jul 10, 2026 - Jul 13, 2026");
});

test("timestamp includes the configured time zone on Node 20", () => {
  assert.equal(formatTimestamp(new Date("2026-07-14T16:05:06.000Z")), "7/14/2026, 12:05:06 PM ET");
});
