const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildSvg,
  calculateStreaksAndTotals,
  calculateTopLanguages,
  escapeXml,
  formatCompactDateRange,
  formatDateRange,
  formatTimestamp,
  mergeContributionDays,
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
  assert.equal(formatCompactDateRange("2026-07-10", "2026-07-13"), "Jul 10 - Jul 13, 2026");
});

test("timestamp includes the configured time zone on Node 20", () => {
  assert.equal(formatTimestamp(new Date("2026-07-14T16:05:06.000Z")), "Jul 14, 2026, 12:05 PM ET");
});

test("overlapping contribution windows keep one value per calendar day", () => {
  const result = mergeContributionDays([
    { date: "2023-10-04", contributionCount: 3 },
    { date: "2024-10-04", contributionCount: 4 },
    { date: "2024-10-04", contributionCount: 4 },
    { date: "2025-01-10", contributionCount: 1 },
  ]);

  assert.deepEqual(result, [
    { date: "2023-10-04", contributionCount: 3 },
    { date: "2024-10-04", contributionCount: 4 },
    { date: "2025-01-10", contributionCount: 1 },
  ]);
});

test("card renders adaptive golden styling without duplicating GitHub's activity chart", () => {
  const svg = buildSvg({
    totalContributions: "1,870",
    contributionStartDate: "Oct 4, 2023",
    currentStreak: 0,
    currentStreakDates: { start: null, end: null },
    longestStreak: 22,
    longestStreakDates: { start: "2024-11-27", end: "2024-12-18" },
    topLanguages: [{ lang: "JavaScript", percent: 57.03 }],
    lastUpdate: "Jul 14, 2026, 12:05 PM ET",
  });

  assert.match(svg, /Since Oct 4, 2023/);
  assert.match(svg, /fill="#f1e05a"/);
  assert.match(svg, /fill: #7d4e00/);
  assert.match(svg, /fill: #f0c74e/);
  assert.match(svg, /@media \(prefers-color-scheme: dark\)/);
  assert.match(svg, /No active streak/);
  assert.match(svg, /@media \(prefers-reduced-motion: reduce\)/);
  assert.doesNotMatch(svg, /Contribution activity/);
  assert.doesNotMatch(svg, /activity-cell/);
  assert.doesNotMatch(svg, /stroke-dasharray/);
  assert.doesNotMatch(svg, /@keyframes reveal[^}]*transform/);
});
