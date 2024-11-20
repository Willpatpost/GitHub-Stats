import requests
import os
from datetime import datetime, timedelta

# Your GitHub username
github_username = "Willpatpost"

# Headers with access token
headers = {
    "Authorization": f"Bearer {os.getenv('GITHUB_TOKEN')}"
}

# Fetch total contributions and streaks
def fetch_contributions():
    query = """
    {
      user(login: "%s") {
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
    """ % github_username
    url = "https://api.github.com/graphql"
    response = requests.post(url, json={"query": query}, headers=headers)
    data = response.json()

    contributions = data["data"]["user"]["contributionsCollection"]["contributionCalendar"]["weeks"]

    # Initialize counters for current and longest streaks
    current_streak, longest_streak = 0, 0
    today = datetime.now().date()
    in_streak = False

    for week in reversed(contributions):
        for day in reversed(week["contributionDays"]):
            date = datetime.strptime(day["date"], "%Y-%m-%d").date()
            contribution_count = day["contributionCount"]

            if date <= today:
                if contribution_count > 0:
                    current_streak += 1
                    longest_streak = max(longest_streak, current_streak)
                    in_streak = True
                else:
                    in_streak = False
                    current_streak = 0

    return {
        "total_contributions": data["data"]["user"]["contributionsCollection"]["contributionCalendar"]["totalContributions"],
        "current_streak": current_streak,
        "longest_streak": longest_streak
    }

# Fetch top languages
def fetch_languages():
    languages = {}
    page = 1
    exclusion_threshold = 90.0  # Exclude languages that take up more than 90%

    while True:
        url = f"https://api.github.com/users/{github_username}/repos?page={page}&per_page=100"
        response = requests.get(url, headers=headers)
        repos = response.json()
        if not repos:
            break
        for repo in repos:
            lang_url = repo["languages_url"]
            lang_data = requests.get(lang_url, headers=headers).json()
            for lang, bytes in lang_data.items():
                languages[lang] = languages.get(lang, 0) + bytes
        page += 1

    total_bytes = sum(languages.values())
    filtered_languages = {lang: bytes for lang, bytes in languages.items() if (bytes / total_bytes) * 100 < exclusion_threshold}

    new_total_bytes = sum(filtered_languages.values())
    top_languages = sorted(filtered_languages.items(), key=lambda x: x[1], reverse=True)[:5]
    top_languages = {lang: (bytes / new_total_bytes) * 100 for lang, bytes in top_languages}
    
    return top_languages

# Update the SVG template with stats
def update_svg(stats, languages):
    with open("stats_template.svg", "r") as file:
        svg_content = file.read()

    # Replace placeholders with actual stats
    svg_content = svg_content.replace("id=\"total_contributions\">0", f"id=\"total_contributions\">{stats['total_contributions']}")
    svg_content = svg_content.replace("id=\"current_streak\">0", f"id=\"current_streak\">{stats['current_streak']}")
    svg_content = svg_content.replace("id=\"longest_streak\">0", f"id=\"longest_streak\">{stats['longest_streak']}")

    # Build languages text block
    languages_text = ""
    for lang, percent in languages.items():
        languages_text += f"<tspan x=\"0\" dy=\"1.2em\">{lang}: {percent:.2f}%</tspan>"
    svg_content = svg_content.replace("id=\"top_languages\" y=\"0\">", f"id=\"top_languages\" y=\"0\">{languages_text}")

    # Save the updated SVG
    with open("stats_board.svg", "w") as file:
        file.write(svg_content)

# Main function to fetch data and update the SVG
def main():
    stats = fetch_contributions()
    languages = fetch_languages()
    update_svg(stats, languages)

if __name__ == "__main__":
    main()
