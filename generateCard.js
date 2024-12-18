// generateCard.js
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

// Environment variables
const USERNAME = process.env.GITHUB_USERNAME || "Willpatpost";
const TOKEN = process.env.GITHUB_TOKEN;
const EXCLUSION_THRESHOLD = parseFloat(process.env.EXCLUSION_THRESHOLD) || 90.0; // Percentage
const GRAPHQL_API = "https://api.github.com/graphql";

if (!TOKEN) {
  console.error("Error: GITHUB_TOKEN is not defined in the environment variables.");
  process.exit(1);
}

if (!USERNAME) {
  console.error("Error: GITHUB_USERNAME is not defined in the environment variables.");
  process.exit(1);
}

/**
 * GraphQL request to GitHub API
 */
async function fetchFromGitHub(query, variables = {}) {
  const response = await fetch(GRAPHQL_API, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("GitHub API Error:", errorText);
    throw new Error("Failed to fetch data from GitHub API.");
  }

  const data = await response.json();
  if (data.errors) {
    console.error("GitHub API Error:", JSON.stringify(data.errors, null, 2));
    throw new Error("Failed to fetch data from GitHub API.");
  }

  return data.data;
}

/**
 * Fetch user's account creation date.
 */
async function fetchUserCreationDate() {
  const query = `
    query ($username: String!) {
      user(login: $username) {
        createdAt
      }
    }
  `;
  const variables = { username: USERNAME };
  const data = await fetchFromGitHub(query, variables);
  return new Date(data.user.createdAt);
}

/**
 * Fetch contributions for a given period (up to 1 year).
 */
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
    username: USERNAME,
    from: fromDate.toISOString(),
    to: toDate.toISOString(),
  };

  const data = await fetchFromGitHub(query, variables);
  return data.user.contributionsCollection.contributionCalendar;
}

/**
 * Fetch all contributions from the user's first contribution to now.
 * We iterate year by year because GitHub's API for contributions typically only returns a maximum 1-year window.
 */
async function fetchAllContributions(userCreationDate, now) {
  let currentStart = new Date(userCreationDate);
  let allContributionDays = [];
  let totalContributionsSum = 0;

  console.log(`Fetching all contributions from ${userCreationDate.toISOString()} to ${now.toISOString()}`);

  while (currentStart < now) {
    // End date is either one year after currentStart or now, whichever is earlier
    const currentEnd = new Date(Math.min(
      new Date(currentStart.getFullYear() + 1, currentStart.getMonth(), currentStart.getDate()).getTime(),
      now.getTime()
    ));

    console.log(`Fetching contributions for the period: ${currentStart.toISOString()} to ${currentEnd.toISOString()}`);

    const contributions = await fetchContributionsForPeriod(currentStart, currentEnd);
    const periodTotal = contributions.totalContributions;
    totalContributionsSum += periodTotal;

    console.log(`Period contributions: ${periodTotal}`);
    console.log(`Running total contributions so far: ${totalContributionsSum}`);

    contributions.weeks.forEach((week) => {
      week.contributionDays.forEach((day) => {
        allContributionDays.push(day);
      });
    });

    // Move to the end of this period
    currentStart = currentEnd;
  }

  console.log(`Final total contributions after combining all periods: ${totalContributionsSum}`);

  return { allContributionDays, totalContributionsSum };
}

/**
 * Calculate current and longest streak from all contribution days.
 */
function calculateStreaks(allContributionDays) {
  let currentStreak = 0;
  let longestStreak = 0;
  let currentStreakStart = null;
  let longestStreakStart = null;
  let longestStreakEnd = null;
  let lastContributedDate = null;
  const today = new Date().toISOString().split('T')[0];

  // Sort all days chronologically
  allContributionDays.sort((a, b) => new Date(a.date) - new Date(b.date));

  for (const { date, contributionCount } of allContributionDays) {
    if (date > today) continue; // skip future dates
    const currentDay = new Date(date);
    const isWeekend = isDateWeekend(currentDay);

    if (contributionCount > 0) {
      // If contributing day or continuation of a streak
      if (!lastContributedDate || isNextDay(lastContributedDate, date)) {
        currentStreak++;
        if (currentStreak === 1) currentStreakStart = date;
      } else {
        currentStreak = 1;
        currentStreakStart = date;
      }
      lastContributedDate = date;

      if (currentStreak > longestStreak) {
        longestStreak = currentStreak;
        longestStreakStart = currentStreakStart;
        longestStreakEnd = date;
      }
    } else if (isWeekend) {
      // Weekends without contribution still count towards the streak
      currentStreak++;
    } else {
      // Break streak on a weekday with no contributions
      currentStreak = 0;
      currentStreakStart = null;
      lastContributedDate = null;
    }
  }

  return {
    currentStreak,
    longestStreak,
    currentStreakStart,
    longestStreakStart,
    longestStreakEnd,
  };
}

/**
 * Check if a date is on the weekend.
 */
function isDateWeekend(date) {
  const day = date.getUTCDay();
  return day === 0 || day === 6;
}

/**
 * Check if two dates are consecutive.
 */
function isNextDay(previousDate, currentDate) {
  const prev = new Date(previousDate);
  const curr = new Date(currentDate);

  // Normalize both dates to UTC midnight
  const prevUTC = Date.UTC(prev.getUTCFullYear(), prev.getUTCMonth(), prev.getUTCDate());
  const currUTC = Date.UTC(curr.getUTCFullYear(), curr.getUTCMonth(), curr.getUTCDate());

  const diffDays = (currUTC - prevUTC) / (1000 * 60 * 60 * 24);
  return diffDays === 1;
}

/**
 * Fetch all public repositories (pagination handled) to calculate top languages.
 */
async function fetchAllRepositories(endCursor = null, accumulated = []) {
  const query = `
    query ($username: String!, $after: String) {
      user(login: $username) {
        repositories(first: 100, after: $after, isFork: false, ownerAffiliations: OWNER, privacy: PUBLIC) {
          pageInfo {
            hasNextPage
            endCursor
          }
          nodes {
            languages(first: 100) {
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

  const variables = { username: USERNAME, after: endCursor };
  const data = await fetchFromGitHub(query, variables);
  const repos = accumulated.concat(data.user.repositories.nodes);

  if (data.user.repositories.pageInfo.hasNextPage) {
    return fetchAllRepositories(data.user.repositories.pageInfo.endCursor, repos);
  } else {
    return repos;
  }
}

/**
 * Calculate top languages from all repositories.
 */
function calculateTopLanguages(repos) {
  const languages = {};

  for (const repo of repos) {
    for (const { size, node } of repo.languages.edges) {
      languages[node.name] = (languages[node.name] || 0) + size;
    }
  }

  const totalBytes = Object.values(languages).reduce((sum, val) => sum + val, 0);
  const filteredEntries = Object.entries(languages).filter(([_, bytes]) => (bytes / totalBytes) * 100 < EXCLUSION_THRESHOLD);

  const newTotalBytes = filteredEntries.reduce((sum, [_, bytes]) => sum + bytes, 0);
  const topLanguages = filteredEntries
    .map(([lang, bytes]) => ({ lang, percent: (bytes / newTotalBytes) * 100 }))
    .sort((a, b) => b.percent - a.percent)
    .slice(0, 5);

  return topLanguages;
}

/**
 * Format a date for display.
 */
function formatDate(date) {
  if (!date) return "N/A";
  const options = { year: 'numeric', month: 'short', day: 'numeric' };
  return date.toLocaleDateString(undefined, options);
}

/**
 * Generate SVG content.
 */
function generateSVGContent({ totalContributionsSum, commitDateRange, currentStreak, longestStreak, currentStreakStart, longestStreakStart, longestStreakEnd, topLanguages, lastUpdate }) {
  const languagesText = topLanguages
    .map(({ lang, percent }) => `<tspan x="0" dy="2.0em">${lang}: ${percent.toFixed(2)}%</tspan>`)
    .join('');

  const longestStreakDates = longestStreak > 0 && longestStreakStart && longestStreakEnd
    ? `${formatDate(new Date(longestStreakStart))} - ${formatDate(new Date(longestStreakEnd))}`
    : "N/A";

  const currentStreakDates = currentStreak > 0 && currentStreakStart
    ? `${formatDate(new Date(currentStreakStart))} - ${formatDate(new Date())}`
    : "N/A";

  return `
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
     style="isolation: isolate" viewBox="0 0 800 300" width="800px" height="300px">
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

    .title {
      font: bold 16px sans-serif;
      fill: #FFD700;
    }

    .stat {
      font: bold 28px sans-serif;
      fill: #FFFFFF;
    }

    .label {
      font: 14px sans-serif;
      fill: #AAAAAA;
    }

    .divider {
      stroke: #555555;
      stroke-width: 2;
      stroke-dasharray: 4;
    }

    .date {
      font: 12px sans-serif;
      fill: #AAAAAA;
    }

    .footer {
      font: 10px sans-serif;
      fill: #AAAAAA;
    }
  </style>

  <!-- Background -->
  <rect width="100%" height="100%" fill="#1E1E1E" rx="15" />

  <!-- Divider Lines -->
  <line x1="200" y1="25" x2="200" y2="275" class="divider" />
  <line x1="400" y1="25" x2="400" y2="275" class="divider" />
  <line x1="600" y1="25" x2="600" y2="275" class="divider" />

  <!-- Section 1: Total Contributions -->
  <g transform="translate(100, 100)">
    <text class="stat" y="15" text-anchor="middle" style="opacity: 0; animation: fadein 0.5s linear forwards 0.6s">
      ${totalContributionsSum}
    </text>
    <text class="label" y="75" text-anchor="middle" style="opacity: 0; animation: fadein 0.5s linear forwards 0.7s">
      Total Contributions
    </text>
    <text class="date" y="100" text-anchor="middle" style="opacity: 0; animation: fadein 0.5s linear forwards 0.8s">
      ${commitDateRange}
    </text>
  </g>

  <!-- Section 2: Current Streak -->
  <g style="isolation: isolate" transform="translate(300, 100)">
    <!-- Ring around number with a mask to hide the top -->
    <g mask="url(#ringMask)">
      <circle cx="0" cy="0" r="40" fill="none" stroke="#FFD700" stroke-width="5" 
              style="opacity: 0; animation: fadein 0.5s linear forwards 0.4s"></circle>
    </g>
    <defs>
      <mask id="ringMask">
        <rect x="-50" y="-40" width="100" height="100" fill="white" />
        <circle cx="0" cy="0" r="40" fill="black" />
        <ellipse cx="0" cy="-40" rx="20" ry="15" fill="black" />
      </mask>
    </defs>

    <!-- Main Number -->
    <text class="stat" y="10" text-anchor="middle" fill="#FFFFFF" 
          font-family="Segoe UI, Ubuntu, sans-serif" font-weight="700" 
          font-size="28px" font-style="normal" style="opacity: 0; animation: currstreak 0.6s linear forwards 0s">
      ${currentStreak}
    </text>
    
    <!-- Label -->
    <text class="label" y="75" text-anchor="middle" style="opacity: 0; animation: fadein 0.5s linear forwards 0.9s">
      Current Streak
    </text>
    
    <!-- Date Range -->
    <text class="date" y="100" text-anchor="middle" style="opacity: 0; animation: fadein 0.5s linear forwards 1.0s">
      ${currentStreakDates}
    </text>

    <!-- Fire icon -->
    <g transform="translate(0, -60)" stroke-opacity="0" 
       style="opacity: 0; animation: fadein 0.5s linear forwards 0.6s">
      <path d="M -12 -0.5 L 15 -0.5 L 15 23.5 L -12 23.5 L -12 -0.5 Z" fill="none"/>
      <path d="M 1.5 0.67 C 1.5 0.67 2.24 3.32 2.24 5.47 C 2.24 7.53 0.89 9.2 -1.17 9.2 
               C -3.23 9.2 -4.79 7.53 -4.79 5.47 L -4.76 5.11 
               C -6.78 7.51 -8 10.62 -8 13.99 C -8 18.41 -4.42 22 0 22 
               C 4.42 22 8 18.41 8 13.99 
               C 8 8.6 5.41 3.79 1.5 0.67 Z 
               M -0.29 19 C -2.07 19 -3.51 17.6 -3.51 15.86 
               C -3.51 14.24 -2.46 13.1 -0.7 12.74 
               C 1.07 12.38 2.9 11.53 3.92 10.16 
               C 4.31 11.45 4.51 12.81 4.51 14.2 
               C 4.51 16.85 2.36 19 -0.29 19 Z" 
        fill="#FF4500" stroke-opacity="0"/>
    </g>
  </g>

  <!-- Section 3: Longest Streak -->
  <g transform="translate(500, 100)">
    <text class="stat" y="15" text-anchor="middle" style="opacity: 0; animation: fadein 0.5s linear forwards 1.2s">
      ${longestStreak}
    </text>
    <text class="label" y="75" text-anchor="middle" style="opacity: 0; animation: fadein 0.5s linear forwards 1.3s">
      Longest Streak
    </text>
    <text class="date" y="100" text-anchor="middle" style="opacity: 0; animation: fadein 0.5s linear forwards 1.4s">
      ${longestStreakDates}
    </text>
  </g>

  <!-- Section 4: Top Languages -->
  <g transform="translate(700, 100)">
    <text class="title" x="0" y="-10" text-anchor="middle" style="opacity: 0; animation: fadein 0.5s linear forwards 1.4s">
      Top Languages Used
    </text>
    <text class="label" text-anchor="middle" style="opacity: 0; animation: fadein 0.5s linear forwards 1.5s">
      ${languagesText}
    </text>
  </g>

  <!-- Footer: Last Update Timestamp -->
  <g transform="translate(20, 280)">
    <text class="footer" x="0" y="10" text-anchor="start" style="opacity: 0; animation: fadein 0.5s linear forwards 1.6s">
      Updated last at: ${lastUpdate}
    </text>
  </g>
</svg>
  `;
}

/**
 * Generate fallback SVG in case of error.
 */
function generateFallbackSVG(lastUpdate) {
  return `
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 300">
    <style>
      .error { font: bold 20px sans-serif; fill: #FF4500; }
      .footer { font: 10px sans-serif; fill: #AAAAAA; }
    </style>
    <rect width="100%" height="100%" fill="#1E1E1E" rx="15"/>
    <text class="error" x="50%" y="50%" text-anchor="middle">Error fetching data</text>
    <text class="footer" x="20" y="280">Updated last at: ${lastUpdate}</text>
  </svg>`;
}

/**
 * Main function to generate the SVG.
 */
async function generateSVG() {
  try {
    // Fetch user's account creation date
    const userCreationDate = await fetchUserCreationDate();
    const now = new Date();

    // Fetch all contributions (year by year)
    const { allContributionDays, totalContributionsSum } = await fetchAllContributions(userCreationDate, now);

    // Calculate streaks
    const {
      currentStreak,
      longestStreak,
      currentStreakStart,
      longestStreakStart,
      longestStreakEnd,
    } = calculateStreaks(allContributionDays);

    // Fetch repositories and compute top languages
    const repositories = await fetchAllRepositories();
    const topLanguages = calculateTopLanguages(repositories);

    // Format commit date range
    const commitDateRange = `${formatDate(new Date(userCreationDate))} - ${formatDate(new Date())}`;

    // Last update timestamp in EST
    const lastUpdate = new Date().toLocaleString("en-US", { timeZone: "America/New_York" }) + " EST";

    // Generate SVG Content
    const svgContent = generateSVGContent({
      totalContributionsSum,
      commitDateRange,
      currentStreak,
      longestStreak,
      currentStreakStart,
      longestStreakStart,
      longestStreakEnd,
      topLanguages,
      lastUpdate,
    });

    fs.writeFileSync(path.join(__dirname, "stats_board.svg"), svgContent);
    console.log("SVG file created successfully.");
  } catch (error) {
    console.error("Error generating SVG:", error);
    // Generate fallback SVG
    const lastUpdate = new Date().toLocaleString("en-US", { timeZone: "America/New_York" }) + " EST";
    const fallbackSVG = generateFallbackSVG(lastUpdate);
    fs.writeFileSync(path.join(__dirname, "stats_board.svg"), fallbackSVG);
    console.log("Fallback SVG file created.");
  }
}

generateSVG().catch((error) => {
  console.error("Unhandled Error:", error);
});
