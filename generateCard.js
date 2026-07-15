const fs = require("fs");

const GRAPHQL_API = "https://api.github.com/graphql";
const MS_PER_DAY = 24 * 60 * 60 * 1000;

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
  let totalContributionsSum = 0;

  console.log(`Fetching contributions for ${config.username}`);

  while (currentStart < now) {
    const oneYearLater = new Date(currentStart);
    oneYearLater.setUTCFullYear(oneYearLater.getUTCFullYear() + 1);
    const currentEnd = new Date(Math.min(oneYearLater.getTime(), now.getTime()));

    console.log(`Contribution window: ${currentStart.toISOString()} to ${currentEnd.toISOString()}`);
    const contributions = await fetchContributionsForPeriod(currentStart, currentEnd);
    totalContributionsSum += contributions.totalContributions;

    for (const week of contributions.weeks) {
      for (const day of week.contributionDays) {
        allContributionDays.push(day);
      }
    }

    currentStart = currentEnd;
  }

  return { allContributionDays, totalContributionsSum };
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
            defaultBranchRef {
              target {
                ... on Commit {
                  committedDate
                }
              }
            }
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
  let earliestCommitDate = null;
  let mostRecentCommitDate = null;
  let hasNextPage = true;
  let endCursor = null;

  while (hasNextPage) {
    const data = await fetchFromGitHub(query, { username: config.username, after: endCursor });
    const repositories = data.user.repositories;

    for (const repo of repositories.nodes) {
      const committedDate = repo.defaultBranchRef?.target?.committedDate;
      if (committedDate) {
        const date = new Date(committedDate);
        if (!earliestCommitDate || date < earliestCommitDate) earliestCommitDate = date;
        if (!mostRecentCommitDate || date > mostRecentCommitDate) mostRecentCommitDate = date;
      }

      for (const edge of repo.languages.edges) {
        const name = edge.node.name;
        languages[name] = (languages[name] || 0) + edge.size;
      }
    }

    hasNextPage = repositories.pageInfo.hasNextPage;
    endCursor = repositories.pageInfo.endCursor;
  }

  return {
    earliestCommitDate,
    mostRecentCommitDate,
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

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function buildSvg({
  totalContributions,
  commitDateRange,
  currentStreak,
  currentStreakDates,
  longestStreak,
  longestStreakDates,
  topLanguages,
  lastUpdate,
}) {
  const languagesText = topLanguages.length
    ? topLanguages
        .map(({ lang, percent }) => `<tspan x="0" dy="2.0em">${escapeXml(lang)}: ${percent.toFixed(2)}%</tspan>`)
        .join("")
    : '<tspan x="0" dy="2.0em">No language data</tspan>';

  return `
<svg xmlns="http://www.w3.org/2000/svg" style="isolation: isolate" viewBox="0 0 800 300" width="800px" height="300px" role="img" aria-labelledby="title desc">
  <title id="title">${escapeXml(config.username)} GitHub stats board</title>
  <desc id="desc">GitHub contribution, streak, and language statistics generated automatically.</desc>
  <style>
    @keyframes fadein {
      0% { opacity: 0; }
      100% { opacity: 1; }
    }

    @keyframes currstreak {
      0% { font-size: 3px; opacity: 0.2; }
      80% { font-size: 34px; opacity: 1; }
      100% { font-size: 28px; opacity: 1; }
    }

    .title { font: bold 16px sans-serif; fill: #FFD700; }
    .stat { font: bold 28px sans-serif; fill: #FFFFFF; }
    .label { font: 14px sans-serif; fill: #AAAAAA; }
    .divider { stroke: #555555; stroke-width: 2; stroke-dasharray: 4; }
    .date { font: 12px sans-serif; fill: #AAAAAA; }
    .footer { font: 10px sans-serif; fill: #AAAAAA; }
  </style>

  <rect width="100%" height="100%" fill="#1E1E1E" rx="15" />
  <line x1="200" y1="25" x2="200" y2="275" class="divider" />
  <line x1="400" y1="25" x2="400" y2="275" class="divider" />
  <line x1="600" y1="25" x2="600" y2="275" class="divider" />

  <g transform="translate(100, 100)">
    <text class="stat" y="15" text-anchor="middle" style="opacity: 0; animation: fadein 0.5s linear forwards 0.6s">${escapeXml(totalContributions)}</text>
    <text class="label" y="75" text-anchor="middle" style="opacity: 0; animation: fadein 0.5s linear forwards 0.7s">Total Contributions</text>
    <text class="date" y="100" text-anchor="middle" style="opacity: 0; animation: fadein 0.5s linear forwards 0.8s">${escapeXml(commitDateRange)}</text>
  </g>

  <g style="isolation: isolate" transform="translate(300, 100)">
    <g mask="url(#ringMask)">
      <circle cx="0" cy="0" r="40" fill="none" stroke="#FFD700" stroke-width="5" style="opacity: 0; animation: fadein 0.5s linear forwards 0.4s"></circle>
    </g>
    <defs>
      <mask id="ringMask">
        <rect x="-50" y="-40" width="100" height="100" fill="white" />
        <circle cx="0" cy="0" r="40" fill="black" />
        <ellipse cx="0" cy="-40" rx="20" ry="15" fill="black" />
      </mask>
    </defs>
    <text class="stat" y="10" text-anchor="middle" fill="#FFFFFF" font-family="Segoe UI, Ubuntu, sans-serif" font-weight="700" font-size="28px" font-style="normal" style="opacity: 0; animation: currstreak 0.6s linear forwards 0s">${escapeXml(currentStreak)}</text>
    <text class="label" y="75" text-anchor="middle" style="opacity: 0; animation: fadein 0.5s linear forwards 0.9s">Current Streak</text>
    <text class="date" y="100" text-anchor="middle" style="opacity: 0; animation: fadein 0.5s linear forwards 1.0s">${escapeXml(currentStreakDates)}</text>
    <g transform="translate(0, -60)" stroke-opacity="0" style="opacity: 0; animation: fadein 0.5s linear forwards 0.6s">
      <path d="M -12 -0.5 L 15 -0.5 L 15 23.5 L -12 23.5 L -12 -0.5 Z" fill="none"/>
      <path d="M 1.5 0.67 C 1.5 0.67 2.24 3.32 2.24 5.47 C 2.24 7.53 0.89 9.2 -1.17 9.2 C -3.23 9.2 -4.79 7.53 -4.79 5.47 L -4.76 5.11 C -6.78 7.51 -8 10.62 -8 13.99 C -8 18.41 -4.42 22 0 22 C 4.42 22 8 18.41 8 13.99 C 8 8.6 5.41 3.79 1.5 0.67 Z M -0.29 19 C -2.07 19 -3.51 17.6 -3.51 15.86 C -3.51 14.24 -2.46 13.1 -0.7 12.74 C 1.07 12.38 2.9 11.53 3.92 10.16 C 4.31 11.45 4.51 12.81 4.51 14.2 C 4.51 16.85 2.36 19 -0.29 19 Z" fill="#FF4500" stroke-opacity="0"/>
    </g>
  </g>

  <g transform="translate(500, 100)">
    <text class="stat" y="15" text-anchor="middle" style="opacity: 0; animation: fadein 0.5s linear forwards 1.2s">${escapeXml(longestStreak)}</text>
    <text class="label" y="75" text-anchor="middle" style="opacity: 0; animation: fadein 0.5s linear forwards 1.3s">Longest Streak</text>
    <text class="date" y="100" text-anchor="middle" style="opacity: 0; animation: fadein 0.5s linear forwards 1.4s">${escapeXml(longestStreakDates)}</text>
  </g>

  <g transform="translate(700, 100)">
    <text class="title" x="0" y="-10" text-anchor="middle" style="opacity: 0; animation: fadein 0.5s linear forwards 1.4s">Top Languages Used</text>
    <text class="label" text-anchor="middle" style="opacity: 0; animation: fadein 0.5s linear forwards 1.5s">${languagesText}</text>
  </g>

  <g transform="translate(20, 280)">
    <text class="footer" x="0" y="10" text-anchor="start" style="opacity: 0; animation: fadein 0.5s linear forwards 1.6s">Updated last at: ${escapeXml(lastUpdate)}</text>
  </g>
</svg>
`;
}

function buildFallbackSvg(error) {
  const lastUpdate = formatTimestamp(new Date());
  return `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 300" role="img" aria-label="GitHub stats board error">
  <style>
    .error { font: bold 20px sans-serif; fill: #FF4500; }
    .hint { font: 13px sans-serif; fill: #AAAAAA; }
    .footer { font: 10px sans-serif; fill: #AAAAAA; }
  </style>
  <rect width="100%" height="100%" fill="#1E1E1E" rx="15"/>
  <text class="error" x="50%" y="45%" text-anchor="middle">Error fetching GitHub stats</text>
  <text class="hint" x="50%" y="55%" text-anchor="middle">${escapeXml(error.message)}</text>
  <text class="footer" x="20" y="280">Updated last at: ${escapeXml(lastUpdate)}</text>
</svg>
`;
}

function formatTimestamp(date) {
  const value = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
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

    const firstActivityDate = repositoryInsights.earliestCommitDate || userCreationDate;
    const latestActivityDate = repositoryInsights.mostRecentCommitDate || now;
    const svgContent = buildSvg({
      totalContributions: totalContributionsSum.toLocaleString("en-US"),
      commitDateRange: `${formatDate(firstActivityDate)} - ${formatDate(latestActivityDate)}`,
      currentStreak: streaks.currentStreak,
      currentStreakDates: formatDateRange(streaks.currentStreakStart, streaks.currentStreakEnd),
      longestStreak: streaks.longestStreak,
      longestStreakDates: formatDateRange(streaks.longestStreakStart, streaks.longestStreakEnd),
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
  formatDateRange,
  formatTimestamp,
  isWeekend,
};
