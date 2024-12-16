// generateCard.js
const fs = require('fs');
const fetch = require('node-fetch'); // Ensure node-fetch is installed
const dotenv = require('dotenv');
dotenv.config();

const username = "Willpatpost";
const token = process.env.GITHUB_TOKEN;
const exclusionThreshold = 90.0; // Exclude languages that take up more than 90%

if (!token) {
  console.error("Error: GITHUB_TOKEN is not defined in the environment variables.");
  process.exit(1);
}

const GRAPHQL_API = "https://api.github.com/graphql";

// Helper function to make GraphQL requests with retries
async function fetchFromGitHub(query, variables = {}, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch(GRAPHQL_API, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query, variables }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`GitHub API Error (Attempt ${attempt}): ${errorText}`);
      }

      const data = await response.json();
      if (data.errors) {
        throw new Error(`GitHub API Errors (Attempt ${attempt}): ${JSON.stringify(data.errors, null, 2)}`);
      }

      return data.data;
    } catch (error) {
      console.error(error.message);
      if (attempt === retries) {
        throw new Error("Exceeded maximum retries for GitHub API.");
      }
      // Exponential backoff
      await new Promise(res => setTimeout(res, 1000 * Math.pow(2, attempt)));
    }
  }
}

// Function to fetch the earliest commit date across all repositories
async function fetchEarliestCommitDate() {
  let hasNextPage = true;
  let endCursor = null;
  let earliestCommitDate = null;

  const query = `
    query ($username: String!, $after: String) {
      user(login: $username) {
        repositories(first: 100, after: $after, isFork: false, ownerAffiliations: OWNER, privacy: PUBLIC, orderBy: {field: CREATED_AT, direction: ASC}) {
          pageInfo {
            hasNextPage
            endCursor
          }
          nodes {
            createdAt
          }
        }
      }
    }
  `;

  while (hasNextPage) {
    const variables = {
      username,
      after: endCursor,
    };

    const data = await fetchFromGitHub(query, variables);
    const repositories = data.user.repositories.nodes;

    if (repositories.length === 0 && !earliestCommitDate) {
      // Fallback if no repositories found
      earliestCommitDate = new Date();
    }

    for (const repo of repositories) {
      const repoCreatedAt = new Date(repo.createdAt);
      if (!earliestCommitDate || repoCreatedAt < earliestCommitDate) {
        earliestCommitDate = repoCreatedAt;
      }
    }

    hasNextPage = data.user.repositories.pageInfo.hasNextPage;
    endCursor = data.user.repositories.pageInfo.endCursor;
  }

  return earliestCommitDate;
}

// Function to fetch total contributions from a specific date to now
async function fetchContributions(fromDate) {
  const toDate = new Date().toISOString();

  const query = `
    query ($username: String!, $from: DateTime!, $to: DateTime!) {
      user(login: $username) {
        contributionsCollection(from: $from, to: $to) {
          totalContributions
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
    username,
    from: fromDate.toISOString(),
    to: toDate,
  };

  const data = await fetchFromGitHub(query, variables);
  const contributions = data.user.contributionsCollection.contributionCalendar;

  const totalContributions = contributions.totalContributions;
  let currentStreak = 0;
  let longestStreak = 0;
  let currentStreakStart = null;
  let longestStreakStart = null;
  let longestStreakEnd = null;
  let lastContributedDate = null;

  const today = new Date().toISOString().split('T')[0];

  // Iterate over each week and each day in chronological order
  contributions.weeks
    .slice()
    .sort((a, b) => new Date(a.contributionDays[0].date) - new Date(b.contributionDays[0].date))
    .forEach((week) => {
      week.contributionDays
        .slice()
        .sort((a, b) => new Date(a.date) - new Date(b.date))
        .forEach((day) => {
          const { date, contributionCount } = day;

          if (date > today) return; // Skip future dates

          const currentDay = new Date(date);
          const dayOfWeek = currentDay.getUTCDay(); // 0 (Sun) to 6 (Sat)
          const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

          if (contributionCount > 0) {
            // Handle streak calculations
            if (!lastContributedDate || isNextDay(lastContributedDate, date)) {
              currentStreak++;
              if (currentStreak === 1) {
                currentStreakStart = date;
              }
            } else {
              currentStreak = 1; // Reset streak
              currentStreakStart = date;
            }
            lastContributedDate = date;
            if (currentStreak > longestStreak) {
              longestStreak = currentStreak;
              longestStreakStart = currentStreakStart;
              longestStreakEnd = date;
            }
          } else if (isWeekend) {
            // Include weekends in streak
            currentStreak++;
          } else {
            // No contribution on weekday, reset streak
            currentStreak = 0;
            currentStreakStart = null;
            lastContributedDate = null;
          }
        });
    });

  return {
    totalContributions,
    currentStreak,
    longestStreak,
    currentStreakStart,
    longestStreakStart,
    longestStreakEnd,
  };
}

// Function to fetch top languages using GraphQL to minimize REST API calls
async function fetchTopLanguages() {
  let hasNextPage = true;
  let endCursor = null;
  const languages = {};

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

  while (hasNextPage) {
    const variables = {
      username,
      after: endCursor,
    };

    const data = await fetchFromGitHub(query, variables);
    const repositories = data.user.repositories.nodes;

    for (const repo of repositories) {
      for (const edge of repo.languages.edges) {
        const lang = edge.node.name;
        const bytes = edge.size;
        languages[lang] = (languages[lang] || 0) + bytes;
      }
    }

    hasNextPage = data.user.repositories.pageInfo.hasNextPage;
    endCursor = data.user.repositories.pageInfo.endCursor;
  }

  const totalBytes = Object.values(languages).reduce((sum, val) => sum + val, 0);
  const filteredLanguages = Object.fromEntries(
    Object.entries(languages).filter(([_, bytes]) => (bytes / totalBytes) * 100 < exclusionThreshold)
  );

  const newTotalBytes = Object.values(filteredLanguages).reduce((sum, val) => sum + val, 0);
  return Object.entries(filteredLanguages)
    .map(([lang, bytes]) => ({ lang, percent: (bytes / newTotalBytes) * 100 }))
    .sort((a, b) => b.percent - a.percent)
    .slice(0, 5);
}

// Helper function to check if two dates are consecutive
function isNextDay(previousDate, currentDate) {
  const prev = new Date(previousDate);
  const curr = new Date(currentDate);

  // Normalize both dates to UTC midnight
  const prevUTC = Date.UTC(prev.getUTCFullYear(), prev.getUTCMonth(), prev.getUTCDate());
  const currUTC = Date.UTC(curr.getUTCFullYear(), curr.getUTCMonth(), curr.getUTCDate());

  const diffDays = (currUTC - prevUTC) / (1000 * 60 * 60 * 24);
  return diffDays === 1;
}

// Function to format dates
function formatDate(date) {
  if (!date) return "N/A";
  const options = { year: 'numeric', month: 'short', day: 'numeric' };
  return date.toLocaleDateString(undefined, options);
}

// Main function to generate SVG
async function generateSVG() {
  try {
    console.log("Fetching earliest commit date...");
    const earliestCommitDate = await fetchEarliestCommitDate();
    console.log(`Earliest commit date: ${earliestCommitDate.toISOString().split('T')[0]}`);

    console.log("Fetching total contributions...");
    const {
      totalContributions,
      currentStreak,
      longestStreak,
      currentStreakStart,
      longestStreakStart,
      longestStreakEnd,
    } = await fetchContributions(earliestCommitDate);

    console.log(`Total Contributions: ${totalContributions}`);

    console.log("Fetching top languages...");
    const topLanguages = await fetchTopLanguages();

    const languagesText = topLanguages
      .map(({ lang, percent }) => `<tspan x="0" dy="2.0em">${lang}: ${percent.toFixed(2)}%</tspan>`)
      .join('');

    const commitDateRange = earliestCommitDate
      ? `${formatDate(earliestCommitDate)} - ${formatDate(new Date())}`
      : "N/A";

    const longestStreakDates = longestStreak > 0 && longestStreakStart && longestStreakEnd
      ? `${formatDate(new Date(longestStreakStart))} - ${formatDate(new Date(longestStreakEnd))}`
      : "N/A";

    // Display last update in EST
    const lastUpdate = new Date().toLocaleString("en-US", { timeZone: "America/New_York" }) + " EST";

    const svgContent = `
  <svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
       style="isolation: isolate" viewBox="0 0 1000 400" width="1000px" height="400px">
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
    <line x1="250" y1="50" x2="250" y2="350" class="divider" />
    <line x1="500" y1="50" x2="500" y2="350" class="divider" />
    <line x1="750" y1="50" x2="750" y2="350" class="divider" />

    <!-- Section 1: Total Contributions -->
    <g transform="translate(125, 100)">
      <text class="stat" y="15" text-anchor="middle" style="opacity: 0; animation: fadein 0.5s linear forwards 0.6s">
        ${totalContributions}
      </text>
      <text class="label" y="75" text-anchor="middle" style="opacity: 0; animation: fadein 0.5s linear forwards 0.7s">
        Total Contributions
      </text>
      <text class="date" y="100" text-anchor="middle" style="opacity: 0; animation: fadein 0.5s linear forwards 0.8s">
        ${commitDateRange}
      </text>
    </g>

    <!-- Section 2: Current Streak -->
    <g style="isolation: isolate" transform="translate(375, 100)">
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
        ${currentStreak > 0 && currentStreakStart
          ? `${formatDate(new Date(currentStreakStart))} - ${formatDate(new Date())}`
          : "N/A"}
      </text>

      <!-- Fire icon positioned within the hole of the ring -->
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
    <g transform="translate(625, 100)">
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
    <g transform="translate(875, 100)">
      <text class="title" x="0" y="-10" text-anchor="middle" style="opacity: 0; animation: fadein 0.5s linear forwards 1.4s">
        Top Languages Used
      </text>
      <text class="label" text-anchor="middle" style="opacity: 0; animation: fadein 0.5s linear forwards 1.5s">
        ${languagesText}
      </text>
    </g>

    <!-- Footer: Last Update Timestamp -->
    <g transform="translate(20, 380)">
      <text class="footer" x="0" y="10" text-anchor="start" style="opacity: 0; animation: fadein 0.5s linear forwards 1.6s">
        Updated last at: ${lastUpdate}
      </text>
    </g>
  </svg>
    `;

    fs.writeFileSync("stats_board.svg", svgContent);
    console.log("SVG file created successfully.");
  } catch (error) {
    console.error("Error generating SVG:", error);
  }
}

// Execute the main function
generateSVG();
