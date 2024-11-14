import requests
import os
from datetime import datetime, timedelta
from PIL import Image, ImageDraw, ImageFont

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

    # Calculate current and longest streaks
    current_streak, longest_streak = 0, 0
    total_contributions = 0
    today = datetime.now().date()
    ongoing_streak = True

    for week in reversed(contributions):
        for day in reversed(week["contributionDays"]):
            if day["contributionCount"] > 0:
                current_streak += 1
                longest_streak = max(longest_streak, current_streak)
            else:
                if ongoing_streak:
                    ongoing_streak = False
                else:
                    current_streak = 0  # Reset if there's a gap
    
    return {
        "total_contributions": data["data"]["user"]["contributionsCollection"]["contributionCalendar"]["totalContributions"],
        "current_streak": current_streak,
        "longest_streak": longest_streak
    }

# Fetch top languages
def fetch_languages():
    languages = {}
    page = 1
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

    # Get top 5 languages
    total_bytes = sum(languages.values())
    top_languages = sorted(languages.items(), key=lambda x: x[1], reverse=True)[:5]
    top_languages = {lang: (bytes / total_bytes) * 100 for lang, bytes in top_languages}
    return top_languages

# Generate stats image
def generate_image(stats, languages):
    # Set up image dimensions
    img = Image.new("RGB", (600, 300), color="white")
    draw = ImageDraw.Draw(img)
    font = ImageFont.load_default()  # Use built-in font

    # Add stats text
    draw.text((10, 10), f"Total Contributions: {stats['total_contributions']}", fill="black", font=font)
    draw.text((10, 40), f"Current Streak: {stats['current_streak']} days", fill="black", font=font)
    draw.text((10, 70), f"Longest Streak: {stats['longest_streak']} days", fill="black", font=font)

    # Add language stats
    y_offset = 100
    for lang, percent in languages.items():
        draw.text((10, y_offset), f"{lang}: {percent:.2f}%", fill="black", font=font)
        y_offset += 30

    img.save("stats_board.png")

# Main function to fetch data and create the image
def main():
    stats = fetch_contributions()
    languages = fetch_languages()
    generate_image(stats, languages)

# Run the main function
if __name__ == "__main__":
    main()
