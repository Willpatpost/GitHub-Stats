const fetch = require('node-fetch');
const fs = require('fs');
require('dotenv').config();

const username = "Willpatpost";
const token = process.env.GITHUB_TOKEN;
const exclusionThreshold = 90.0;  // Exclude languages that take up more than 90%

async function fetchFromGitHub(query) {
  const response = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ query })
  });
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

  let totalContributions = contributions.totalContributions;
  let currentStreak = 0;
  let longestStreak = 0;
  let today = new Date().toISOString().split('T')[0];
  let inStreak = false;

  contributions.weeks.reverse().forEach(week => {
    week.contributionDays.reverse().forEach(day => {
      const date = day.date;
      const count = day.contributionCount;

      if (date <= today) {
        if (count > 0) {
          if (inStreak) currentStreak++;
          longestStreak = Math.max(longestStreak, currentStreak);
          inStreak = true;
        } else {
          inStreak = false;
          currentStreak = 0;
        }
      }
    });
  });

  return { totalContributions, currentStreak, longestStreak };
}

async function fetchTopLanguages() {
  let page = 1;
  const languages = {};

  while (true) {
    const url = `https://api.github.com/users/${username}/repos?page=${page}&per_page=100`;
    const response = await fetch(url, {
      headers: { "Authorization": `Bearer ${token}` }
    });
    const repos = await response.json();
    if (!repos.length) break;

    for (const repo of repos) {
      const langUrl = repo.languages_url;
      const langResponse = await fetch(langUrl, {
        headers: { "Authorization": `Bearer ${token}` }
      });
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
  const { totalContributions, currentStreak, longestStreak } = await fetchContributions();
  const topLanguages = await fetchTopLanguages();

  let languagesText = "";
  topLanguages.forEach(({ lang, percent }) => {
    languagesText += `<tspan x="0" dy="1.2em">${lang}: ${percent.toFixed(2)}%</tspan>`;
  });

  const svgContent = `
    <svg width="800" height="200" xmlns="http://www.w3.org/2000/svg">
      <style>
        .title { font: bold 14px sans-serif; fill: #FFD700; }
        .stat { font: bold 24px sans-serif; fill: #FFFFFF; }
        .label { font: 12px sans-serif; fill: #AAAAAA; }
        .section { text-anchor: middle; }
      </style>

      <rect width="100%" height="100%" fill="#1E1E1E" rx="10"/>

      <g class="section" transform="translate(150, 100)">
        <text class="stat" y="-10">${totalContributions}</text>
        <text class="label" y="20">Total Contributions</text>
      </g>

      <g class="section" transform="translate(350, 100)">
        <text class="stat" y="-10">${currentStreak}</text>
        <text class="label" y="20">Current Streak</text>
      </g>

      <g class="section" transform="translate(550, 100)">
        <text class="stat" y="-10">${longestStreak}</text>
        <text class="label" y="20">Longest Streak</text>
      </g>

      <g class="section" transform="translate(750, 100)">
        <text class="title" x="0" y="-30">Top Languages Used</text>
        <text class="label" x="0" y="0">${languagesText}</text>
      </g>
    </svg>
  `;

  fs.writeFileSync("stats_board.svg", svgContent);
  console.log("SVG file created successfully.");
}

// Main function
generateSVG().catch(error => console.error("Error generating SVG:", error));
