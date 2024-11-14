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

    # Initialize counters for current and longest streaks
    current_streak, longest_streak = 0, 0
    today = datetime.now().date()
    in_streak = False
    consecutive_days = 0  # To track consecutive days including weekends

    # Loop through contribution days in reverse order
    for week in reversed(contributions):
        for day in reversed(week["contributionDays"]):
            date = datetime.strptime(day["date"], "%Y-%m-%d").date()
            contribution_count = day["contributionCount"]

            # Only consider days up to today
            if date <= today:
                # Check if the day is a weekend
                is_weekend = date.weekday() >= 5

                if contribution_count > 0:
                    # If there's a contribution, continue the streak
                    current_streak += 1
                    longest_streak = max(longest_streak, current_streak)
                    consecutive_days = 0  # Reset consecutive days gap counter
                    in_streak = True
                elif is_weekend:
                    # If it's a weekend without contributions, skip it
                    consecutive_days += 1
                else:
                    # If it's a weekday without contributions, break the streak
                    in_streak = False
                    current_streak = 0
                    consecutive_days = 0  # Reset the gap counter for weekdays

    return {
        "total_contributions": data["data"]["user"]["contributionsCollection"]["contributionCalendar"]["totalContributions"],
        "current_streak": current_streak,
        "longest_streak": longest_streak
    }

# Fetch top languages, excluding any specified language
def fetch_languages():
    languages = {}
    page = 1
    exclusion_threshold = 90.0  # Exclude languages that take up more than 90%

    # Retrieve language usage from all repositories
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

    # Calculate total bytes and filter out dominant language
    total_bytes = sum(languages.values())
    filtered_languages = {lang: bytes for lang, bytes in languages.items() if (bytes / total_bytes) * 100 < exclusion_threshold}

    # Calculate percentages for remaining languages
    new_total_bytes = sum(filtered_languages.values())
    top_languages = sorted(filtered_languages.items(), key=lambda x: x[1], reverse=True)[:5]
    top_languages = {lang: (bytes / new_total_bytes) * 100 for lang, bytes in top_languages}
    
    return top_languages

# Generate stats image
from PIL import Image, ImageDraw, ImageFont

def generate_image(stats, languages):
    # Set up image dimensions and colors
    img_width, img_height = 600, 300
    background_color = "#23272A"  # Dark theme background
    text_color = "#FFFFFF"        # White text
    title_color = "#FFD700"       # Gold color for titles
    border_radius = 10            # Rounded corners for borders

    img = Image.new("RGB", (img_width, img_height), color=background_color)
    draw = ImageDraw.Draw(img)

    # Load default font or add a custom font path if you have one
    title_font = ImageFont.load_default()
    stat_font = ImageFont.load_default()
    language_font = ImageFont.load_default()

    # Define starting y position
    y_position = 20

    # Draw Border Rectangle with Rounded Corners (simulate rounded corners)
    draw.rounded_rectangle(
        [(10, 10), (img_width - 10, img_height - 10)],
        radius=border_radius,
        outline=title_color,
        width=2
    )

    # Add Title
    draw.text((img_width // 2 - 50, y_position), "GitHub Stats", fill=title_color, font=title_font)
    y_position += 40

    # Add Total Contributions
    draw.text((20, y_position), f"Total Contributions: {stats['total_contributions']}", fill=text_color, font=stat_font)
    y_position += 30

    # Add Current Streak and Longest Streak
    draw.text((20, y_position), f"Current Streak: {stats['current_streak']} days", fill=text_color, font=stat_font)
    y_position += 30
    draw.text((20, y_position), f"Longest Streak: {stats['longest_streak']} days", fill=text_color, font=stat_font)
    y_position += 50

    # Add Languages Section Title
    draw.text((20, y_position), "Top Languages Used:", fill=title_color, font=title_font)
    y_position += 30

    # Display each language and percentage
    for lang, percent in languages.items():
        draw.text((20, y_position), f"{lang}: {percent:.2f}%", fill=text_color, font=language_font)
        y_position += 20

    # Save the image
    img.save("stats_board.png")

# Main function to fetch data and create the image
def main():
    stats = fetch_contributions()
    languages = fetch_languages()
    generate_image(stats, languages)

# Run the main function
if __name__ == "__main__":
    main()
