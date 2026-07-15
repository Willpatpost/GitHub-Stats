const fs = require("fs");

const GRAPHQL_API = "https://api.github.com/graphql";
const LANGUAGE_COLORS = {
  C: "#555555",
  "C#": "#178600",
  "C++": "#f34b7d",
  CSS: "#663399",
  Go: "#00ADD8",
  HTML: "#e34c26",
  Java: "#b07219",
  JavaScript: "#f1e05a",
  Kotlin: "#A97BFF",
  PHP: "#4F5D95",
  Python: "#3572A5",
  Ruby: "#701516",
  Rust: "#dea584",
  Shell: "#89e051",
  Swift: "#F05138",
  TypeScript: "#3178c6",
};
const FALLBACK_LANGUAGE_COLORS = ["#58a6ff", "#d2a8ff", "#f778ba", "#ffa657", "#7ee787"];

const config = {
  username: process.env.GITHUB_USERNAME || "Willpatpost",
  token: process.env.GITHUB_TOKEN,
  outputPath: process.env.OUTPUT_PATH || "stats_board.svg",
  timeZone: process.env.STATS_TIME_ZONE || "America/New_York",
  languageExclusionThreshold: Number(process.env.LANGUAGE_EXCLUSION_THRESHOLD || 90),
};

async function fetchFromGitHub(query, variables = {}) {
  if (!config.token) {
    throw new Error("GITHUB_TOKEN is not defined in the environment variables.");
  }

  const response = await fetch(GRAPHQL_API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`GitHub API request failed (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  if (data.errors) {
    throw new Error(`GitHub API returned errors: ${JSON.stringify(data.errors, null, 2)}`);
  }

  return data.data;
}

async function fetchUserCreationDate() {
  const query = `
    query ($username: String!) {
      user(login: $username) {
        createdAt
      }
    }
  `;

  const data = await fetchFromGitHub(query, { username: config.username });
  return new Date(data.user.createdAt);
}

async function fetchContributionsForPeriod(fromDate, toDate) {
  const query = `
    query ($username: String!, $from: DateTime!, $to: DateTime!) {
      user(login: $username) {
        contributionsCollection(from: $from, to: $to) {
          contributionCalendar {
            totalContributions
            weeks {
              contributionDays {
                date
                contributionCount
              }
            }
          }
        }
      }
    }
  `;

  const variables = {
    username: config.username,
    from: fromDate.toISOString(),
    to: toDate.toISOString(),
  };

  const data = await fetchFromGitHub(query, variables);
  return data.user.contributionsCollection.contributionCalendar;
}

async function fetchAllContributions(userCreationDate, now) {
  let currentStart = new Date(userCreationDate);
  const allContributionDays = [];

  console.log(`Fetching contributions for ${config.username}`);

  while (currentStart < now) {
    const oneYearLater = new Date(currentStart);
    oneYearLater.setUTCFullYear(oneYearLater.getUTCFullYear() + 1);
    const currentEnd = new Date(Math.min(oneYearLater.getTime(), now.getTime()));

    console.log(`Contribution window: ${currentStart.toISOString()} to ${currentEnd.toISOString()}`);
    const contributions = await fetchContributionsForPeriod(currentStart, currentEnd);
    console.log(`Period contributions: ${contributions.totalContributions.toLocaleString("en-US")}`);

    for (const week of contributions.weeks) {
      for (const day of week.contributionDays) {
        allContributionDays.push(day);
      }
    }

    currentStart = currentEnd;
  }

  const uniqueContributionDays = mergeContributionDays(allContributionDays);
  const totalContributionsSum = uniqueContributionDays.reduce((sum, day) => sum + day.contributionCount, 0);
  return { allContributionDays: uniqueContributionDays, totalContributionsSum };
}

function mergeContributionDays(contributionDays) {
  const contributionsByDate = new Map();
  for (const { date, contributionCount } of contributionDays) {
    contributionsByDate.set(date, Math.max(contributionsByDate.get(date) || 0, contributionCount));
  }

  return [...contributionsByDate.entries()]
    .sort(([dateA], [dateB]) => dateA.localeCompare(dateB))
    .map(([date, contributionCount]) => ({ date, contributionCount }));
}

async function fetchRepositoryInsights() {
  const query = `
    query ($username: String!, $after: String) {
      user(login: $username) {
        repositories(
          first: 100
          after: $after
          isFork: false
          ownerAffiliations: OWNER
          privacy: PUBLIC
          orderBy: { field: UPDATED_AT, direction: DESC }
        ) {
          pageInfo {
            hasNextPage
            endCursor
          }
          nodes {
            languages(first: 20, orderBy: { field: SIZE, direction: DESC }) {
              edges {
                size
                node {
                  name
                }
              }
            }
          }
        }
      }
    }
  `;

  const languages = {};
  let hasNextPage = true;
  let endCursor = null;

  while (hasNextPage) {
    const data = await fetchFromGitHub(query, { username: config.username, after: endCursor });
    const repositories = data.user.repositories;

    for (const repo of repositories.nodes) {
      for (const edge of repo.languages.edges) {
        const name = edge.node.name;
        languages[name] = (languages[name] || 0) + edge.size;
      }
    }

    hasNextPage = repositories.pageInfo.hasNextPage;
    endCursor = repositories.pageInfo.endCursor;
  }

  return {
    topLanguages: calculateTopLanguages(languages),
  };
}

function calculateTopLanguages(languages) {
  const totalBytes = Object.values(languages).reduce((sum, bytes) => sum + bytes, 0);
  if (totalBytes === 0) return [];

  const filteredEntries = Object.entries(languages).filter(([, bytes]) => {
    return (bytes / totalBytes) * 100 < config.languageExclusionThreshold;
  });

  const entries = filteredEntries.length > 0 ? filteredEntries : Object.entries(languages);
  const filteredTotalBytes = entries.reduce((sum, [, bytes]) => sum + bytes, 0);

  return entries
    .map(([lang, bytes]) => ({ lang, percent: (bytes / filteredTotalBytes) * 100 }))
    .sort((a, b) => b.percent - a.percent)
    .slice(0, 5);
}

function calculateStreaksAndTotals(allContributionDays, today = new Date()) {
  const contributionsByDate = new Map();
  for (const { date, contributionCount } of allContributionDays) {
    contributionsByDate.set(date, (contributionsByDate.get(date) || 0) + contributionCount);
  }

  const sortedDates = [...contributionsByDate.keys()].sort();
  const firstDate = sortedDates[0];
  if (!firstDate) {
    return emptyStreaks();
  }

  const todayDate = toDateString(today);
  let currentDate = firstDate;
  let currentStreak = 0;
  let currentStreakStart = null;
  let lastStreakEnd = null;
  let longestStreak = 0;
  let longestStreakStart = null;
  let longestStreakEnd = null;

  while (currentDate <= todayDate) {
    const contributionCount = contributionsByDate.get(currentDate) || 0;
    const countsTowardStreak = contributionCount > 0 || (currentStreak > 0 && isWeekend(currentDate));

    if (countsTowardStreak) {
      if (currentStreak === 0) currentStreakStart = currentDate;
      currentStreak += 1;
      lastStreakEnd = currentDate;

      if (currentStreak > longestStreak) {
        longestStreak = currentStreak;
        longestStreakStart = currentStreakStart;
        longestStreakEnd = currentDate;
      }
    } else {
      currentStreak = 0;
      currentStreakStart = null;
    }

    currentDate = addDays(currentDate, 1);
  }

  return {
    currentStreak,
    longestStreak,
    currentStreakStart,
    currentStreakEnd: currentStreak > 0 ? lastStreakEnd : null,
    longestStreakStart,
    longestStreakEnd,
  };
}

function emptyStreaks() {
  return {
    currentStreak: 0,
    longestStreak: 0,
    currentStreakStart: null,
    currentStreakEnd: null,
    longestStreakStart: null,
    longestStreakEnd: null,
  };
}

function toDateString(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(dateString, days) {
  const date = new Date(`${dateString}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return toDateString(date);
}

function isWeekend(dateString) {
  const dayOfWeek = new Date(`${dateString}T00:00:00.000Z`).getUTCDay();
  return dayOfWeek === 0 || dayOfWeek === 6;
}

function formatDate(date, timeZone = config.timeZone) {
  if (!date) return "N/A";
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone,
  }).format(date);
}

function formatDateRange(start, end) {
  if (!start || !end) return "N/A";
  return `${formatDate(new Date(`${start}T00:00:00.000Z`), "UTC")} - ${formatDate(new Date(`${end}T00:00:00.000Z`), "UTC")}`;
}

function formatCompactDateRange(start, end) {
  if (!start || !end) return "N/A";

  const startDate = new Date(`${start}T00:00:00.000Z`);
  const endDate = new Date(`${end}T00:00:00.000Z`);
  const startYear = startDate.getUTCFullYear();
  const endYear = endDate.getUTCFullYear();
  const shortDate = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

  if (startYear === endYear) {
    return `${shortDate.format(startDate)} - ${shortDate.format(endDate)}, ${endYear}`;
  }

  return formatDateRange(start, end);
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function languageColor(language, index) {
  return LANGUAGE_COLORS[language] || FALLBACK_LANGUAGE_COLORS[index % FALLBACK_LANGUAGE_COLORS.length];
}

function buildSvg({
  totalContributions,
  contributionStartDate,
  currentStreak,
  currentStreakDates,
  longestStreak,
  longestStreakDates,
  topLanguages,
  lastUpdate,
}) {
  const languageRows = topLanguages.length
    ? topLanguages
        .slice(0, 4)
        .map(({ lang, percent }, index) => {
          const x = 24 + index * 188;
          const barWidth = Math.max(3, Math.round((percent / 100) * 164));
          return `
    <g class="animate" style="animation-delay: ${120 + index * 35}ms">
      <circle cx="${x + 4}" cy="198" r="4" fill="${languageColor(lang, index)}" />
      <text class="language-name" x="${x + 14}" y="202">${escapeXml(lang)}</text>
      <text class="language-percent" x="${x + 164}" y="202" text-anchor="end">${percent.toFixed(1)}%</text>
      <rect class="language-track" x="${x}" y="212" width="164" height="7" rx="3.5" />
      <rect x="${x}" y="212" width="${barWidth}" height="7" rx="3.5" fill="${languageColor(lang, index)}" />
    </g>`;
        })
        .join("")
    : '<text class="empty-state" x="24" y="205">No language data available</text>';
  const currentStreakNote = currentStreak > 0 ? formatCompactDateRange(currentStreakDates.start, currentStreakDates.end) : "No active streak";
  const longestStreakNote = formatCompactDateRange(longestStreakDates.start, longestStreakDates.end);
  const currentStreakUnit = currentStreak === 1 ? "day" : "days";
  const longestStreakUnit = longestStreak === 1 ? "day" : "days";

  return `
<svg xmlns="http://www.w3.org/2000/svg" style="isolation: isolate" viewBox="0 0 800 242" width="800px" height="242px" role="img" aria-labelledby="title desc">
  <title id="title">${escapeXml(config.username)} GitHub stats board</title>
  <desc id="desc">GitHub contribution totals, streaks, and top languages for ${escapeXml(config.username)}.</desc>
  <style>
    @keyframes reveal {
      from { opacity: 0.2; }
      to { opacity: 1; }
    }
    .animate { animation: reveal 320ms ease-out both; }
    .background { fill: #ffffff; stroke: #d0d7de; }
    .username { font: 600 16px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; fill: #1f2328; }
    .subtitle, .updated { font: 11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; fill: #656d76; }
    .section-label, .metric-label { font: 600 10px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; fill: #656d76; }
    .metric-label, .section-label { text-transform: uppercase; }
    .metric-value { font: 600 31px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; fill: #7d4e00; }
    .metric-unit, .metric-note { fill: #656d76; }
    .metric-note { font: 11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .language-name { font: 11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; fill: #1f2328; }
    .language-percent { font: 10px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; fill: #656d76; }
    .language-track { fill: #eaeef2; }
    .empty-state { font: 11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; fill: #656d76; }
    .rule { stroke: #d8dee4; stroke-width: 1; }
    .accent { fill: #bf8700; }
    @media (prefers-color-scheme: dark) {
      .background { fill: #0d1117; stroke: #30363d; }
      .username, .language-name { fill: #f0f6fc; }
      .subtitle, .updated, .section-label, .metric-label, .metric-unit, .metric-note, .language-percent, .empty-state { fill: #8b949e; }
      .metric-value { fill: #f0c74e; }
      .language-track { fill: #21262d; }
      .rule { stroke: #21262d; }
      .accent { fill: #e3b341; }
    }
    @media (prefers-reduced-motion: reduce) {
      .animate { animation: none; }
    }
  </style>

  <rect class="background" x="0.5" y="0.5" width="799" height="241" rx="8" />
  <rect class="accent" x="24" y="22" width="4" height="24" rx="2" />
  <text class="username" x="38" y="31">${escapeXml(config.username)}</text>
  <text class="subtitle" x="38" y="46">GitHub activity overview</text>
  <text class="updated" x="776" y="34" text-anchor="end">Updated ${escapeXml(lastUpdate)}</text>
  <line class="rule" x1="24" y1="62" x2="776" y2="62" />

  <g class="animate" style="animation-delay: 20ms">
    <text class="metric-label" x="24" y="85">Total contributions</text>
    <text class="metric-value" x="24" y="120">${escapeXml(totalContributions)}</text>
    <text class="metric-note" x="24" y="141">Since ${escapeXml(contributionStartDate)}</text>
  </g>
  <g class="animate" style="animation-delay: 55ms">
    <text class="metric-label" x="286" y="85">Current streak</text>
    <text class="metric-value" x="286" y="120">${escapeXml(currentStreak)} <tspan class="metric-unit" font-size="15">${currentStreakUnit}</tspan></text>
    <text class="metric-note" x="286" y="141">${escapeXml(currentStreakNote)}</text>
  </g>
  <g class="animate" style="animation-delay: 90ms">
    <text class="metric-label" x="548" y="85">Longest streak</text>
    <text class="metric-value" x="548" y="120">${escapeXml(longestStreak)} <tspan class="metric-unit" font-size="15">${longestStreakUnit}</tspan></text>
    <text class="metric-note" x="548" y="141">${escapeXml(longestStreakNote)}</text>
  </g>

  <line class="rule" x1="24" y1="158" x2="776" y2="158" />
  <text class="section-label" x="24" y="181">Top languages</text>
  ${languageRows}
</svg>
`;
}

function buildFallbackSvg(error) {
  const lastUpdate = formatTimestamp(new Date());
  return `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 242" role="img" aria-label="GitHub stats board error">
  <style>
    .background { fill: #ffffff; stroke: #d0d7de; }
    .error { font: 600 20px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; fill: #1f2328; }
    .hint { font: 13px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; fill: #656d76; }
    .footer { font: 10px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; fill: #656d76; }
    @media (prefers-color-scheme: dark) {
      .background { fill: #0d1117; stroke: #30363d; }
      .error { fill: #f0f6fc; }
      .hint, .footer { fill: #8b949e; }
    }
  </style>
  <rect class="background" x="0.5" y="0.5" width="799" height="241" rx="8"/>
  <rect x="24" y="22" width="4" height="24" rx="2" fill="#f85149" />
  <text class="error" x="38" y="38">Stats temporarily unavailable</text>
  <text class="hint" x="24" y="145">${escapeXml(error.message)}</text>
  <text class="footer" x="24" y="220">Last attempted ${escapeXml(lastUpdate)}</text>
</svg>
`;
}

function formatTimestamp(date) {
  const value = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: config.timeZone,
    timeZoneName: "short",
  }).format(date);
  return value.replace(" EDT", " ET").replace(" EST", " ET");
}

async function generateSVG() {
  try {
    const userCreationDate = await fetchUserCreationDate();
    const now = new Date();
    const { allContributionDays, totalContributionsSum } = await fetchAllContributions(userCreationDate, now);
    const repositoryInsights = await fetchRepositoryInsights();
    const streaks = calculateStreaksAndTotals(allContributionDays, now);

    const svgContent = buildSvg({
      totalContributions: totalContributionsSum.toLocaleString("en-US"),
      contributionStartDate: formatDate(userCreationDate),
      currentStreak: streaks.currentStreak,
      currentStreakDates: { start: streaks.currentStreakStart, end: streaks.currentStreakEnd },
      longestStreak: streaks.longestStreak,
      longestStreakDates: { start: streaks.longestStreakStart, end: streaks.longestStreakEnd },
      topLanguages: repositoryInsights.topLanguages,
      lastUpdate: formatTimestamp(now),
    });

    fs.writeFileSync(config.outputPath, svgContent);
    console.log(`SVG file written to ${config.outputPath}.`);
  } catch (error) {
    console.error("Error generating SVG:", error);
    fs.writeFileSync(config.outputPath, buildFallbackSvg(error));
    process.exitCode = 1;
  }
}

if (require.main === module) {
  generateSVG();
}

module.exports = {
  addDays,
  buildSvg,
  calculateStreaksAndTotals,
  calculateTopLanguages,
  escapeXml,
  formatCompactDateRange,
  formatDateRange,
  formatTimestamp,
  isWeekend,
  mergeContributionDays,
};
