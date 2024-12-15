// generateCard.js
const fs = require('fs');

const username = "Willpatpost";
const token = process.env.GITHUB_TOKEN;
const exclusionThreshold = 90.0; // Exclude languages that take up more than 90%

if (!token) {
  console.error("Error: GITHUB_TOKEN is not defined in the environment variables.");
  process.exit(1);
}

async function fetchFromGitHub(query) {
  const response = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("GitHub API Error:", errorText);
    throw new Error("Failed to fetch data from GitHub API.");
  }

  const data = await response.json();
  if (data.errors) {
    console.error("GitHub API Error:", data.errors);
    throw new Error("Failed to fetch data from GitHub API.");
  }
  return data.data;
}

async function fetchContributions() {
  const query = `
    {
      user(login: "${username}") {
        contributionsCollection {
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

  const data = await fetchFromGitHub(query);
  const contributions = data.user.contributionsCollection.contributionCalendar;

  const totalContributions = contributions.totalContributions;
  let currentStreak = 0;
  let longestStreak = 0;
  let currentStreakStart = null;
  let longestStreakStart = null;
  let longestStreakEnd = null;
  const today = new Date().toISOString().split('T')[0];
  let lastContributedDate = null;

  // Iterate over each week and each day in chronological order
  contributions.weeks
    .slice() // Create a shallow copy to prevent mutating the original data
    .sort((a, b) => new Date(a.contributionDays[0].date) - new Date(b.contributionDays[0].date)) // Sort weeks chronologically
    .forEach((week) => {
      week.contributionDays
        .slice()
        .sort((a, b) => new Date(a.date) - new Date(b.date)) // Sort days chronologically
        .forEach((day) => {
          const { date, contributionCount } = day;

          if (date > today) return; // Skip future dates

          const currentDay = new Date(date);
          const dayOfWeek = currentDay.getUTCDay(); // 0 (Sun) to 6 (Sat)
          const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

          if (contributionCount > 0) {
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
            // No contribution on weekend, but streak continues
            // Do not reset the streak
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

async function fetchTopLanguages() {
  let page = 1;
  const languages = {};

  while (true) {
    const url = `https://api.github.com/users/${username}/repos?page=${page}&per_page=100`;
    const response = await fetch(url, {
      headers: { "Authorization": `Bearer ${token}` },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Error fetching repositories: ${errorText}`);
      throw new Error("Failed to fetch repositories from GitHub.");
    }

    const repos = await response.json();
    if (!repos.length) break;

    for (const repo of repos) {
      const langUrl = repo.languages_url;
      const langResponse = await fetch(langUrl, {
        headers: { "Authorization": `Bearer ${token}` },
      });

      if (!langResponse.ok) {
        const errorText = await langResponse.text();
        console.error(`Error fetching languages for repo ${repo.name}: ${errorText}`);
        continue; // Skip this repo
      }

      const langData = await langResponse.json();
      for (const [lang, bytes] of Object.entries(langData)) {
        languages[lang] = (languages[lang] || 0) + bytes;
      }
    }
    page++;
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

async function generateSVG() {
  const {
    totalContributions,
    currentStreak,
    longestStreak,
    currentStreakStart,
    longestStreakStart,
    longestStreakEnd,
  } = await fetchContributions();
  const topLanguages = await fetchTopLanguages();

  const languagesText = topLanguages
    .map(({ lang, percent }) => `<tspan x="0" dy="2.0em">${lang}: ${percent.toFixed(2)}%</tspan>`)
    .join('');

  // Format dates
  const formatDate = (dateStr) => {
    const options = { year: 'numeric', month: 'short', day: 'numeric' };
    const date = new Date(dateStr);
    return date.toLocaleDateString(undefined, options);
  };

  const currentStreakEnd = new Date().toISOString().split('T')[0];
  const currentStreakDates = currentStreak > 0 && currentStreakStart
    ? `${formatDate(currentStreakStart)} - ${formatDate(currentStreakEnd)}`
    : "N/A";

  const longestStreakDates = longestStreak > 0 && longestStreakStart && longestStreakEnd
    ? `${formatDate(longestStreakStart)} - ${formatDate(longestStreakEnd)}`
    : "N/A";

  const lastUpdate = new Date().toLocaleString();

  const svgContent = `
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
      stroke-dasharray: 4; /* Dashed line style */
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
    <text class="stat" y="0" text-anchor="middle" style="opacity: 0; animation: fadein 0.5s linear forwards 0.6s">
      ${totalContributions}
    </text>
    <text class="label" y="40" text-anchor="middle" style="opacity: 0; animation: fadein 0.5s linear forwards 0.7s">
      Total Contributions
    </text>
    <text class="date" y="60" text-anchor="middle" style="opacity: 0; animation: fadein 0.5s linear forwards 0.8s">
      ${currentStreakDates}
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
        <rect x="-50" y="-50" width="100" height="100" fill="white" />
        <circle cx="0" cy="0" r="40" fill="black" />
        <!-- Changed fill to black to hide the top of the ring -->
        <ellipse cx="0" cy="-40" rx="20" ry="15" fill="black" />
      </mask>
    </defs>

    <!-- Main Number -->
    <text class="stat" y="-10" text-anchor="middle" fill="#FFFFFF" 
          font-family="Segoe UI, Ubuntu, sans-serif" font-weight="700" 
          font-size="28px" font-style="normal" style="opacity: 0; animation: currstreak 0.6s linear forwards 0s">
      ${currentStreak}
    </text>
    
    <!-- Label -->
    <text class="label" y="30" text-anchor="middle" style="opacity: 0; animation: fadein 0.5s linear forwards 0.9s">
      Current Streak
    </text>
    
    <!-- Date Range -->
    <text class="date" y="50" text-anchor="middle" style="opacity: 0; animation: fadein 0.5s linear forwards 1.0s">
      ${currentStreakDates}
    </text>

    <!-- Fire icon positioned within the hole of the ring -->
    <g transform="translate(0, -40)" stroke-opacity="0" 
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
    <text class="stat" y="0" text-anchor="middle" style="opacity: 0; animation: fadein 0.5s linear forwards 1.2s">
      ${longestStreak}
    </text>
    <text class="label" y="40" text-anchor="middle" style="opacity: 0; animation: fadein 0.5s linear forwards 1.3s">
      Longest Streak
    </text>
    <text class="date" y="60" text-anchor="middle" style="opacity: 0; animation: fadein 0.5s linear forwards 1.4s">
      ${longestStreakDates}
    </text>
  </g>

  <!-- Section 4: Top Languages -->
  <g transform="translate(700, 100)">
    <text class="title" x="0" y="-20" text-anchor="middle" style="opacity: 0; animation: fadein 0.5s linear forwards 1.4s">
      Top Languages Used
    </text>
    <text class="label" text-anchor="middle" style="opacity: 0; animation: fadein 0.5s linear forwards 1.5s">
      ${languagesText}
    </text>
  </g>

  <!-- Footer: Last Update Timestamp -->
  <g transform="translate(20, 280)">
    <text class="footer" x="0" y="0" text-anchor="start" style="opacity: 0; animation: fadein 0.5s linear forwards 1.6s">
      Updated last at: ${lastUpdate}
    </text>
  </g>
</svg>
  `;

  fs.writeFileSync("stats_board.svg", svgContent);
  console.log("SVG file created successfully.");
}

// Main function
generateSVG().catch((error) => console.error("Error generating SVG:", error));
