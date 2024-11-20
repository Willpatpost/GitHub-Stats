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
    current_streak = 0
    longest_streak = 0
    today = datetime.now().date()
    is_current_streak = True  # Flag to check if we are on the current streak

    # Loop through contribution days in reverse order
    for week in reversed(contributions):
        for day in reversed(week["contributionDays"]):
            date = datetime.strptime(day["date"], "%Y-%m-%d").date()
            contribution_count = day["contributionCount"]

            if date <= today:
                if contribution_count > 0:
                    # Continue the current streak
                    current_streak += 1
                    longest_streak = max(longest_streak, current_streak)
                else:
                    if date == today - timedelta(days=current_streak):
                        # If it's the day right after the last streaked day, end the current streak
                        is_current_streak = False
                    if not is_current_streak:
                        current_streak = 0  # Reset if the streak broke on a weekday

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

from PIL import Image, ImageDraw, ImageFont

def generate_image(stats, languages):
    # Set up image dimensions and colors
    img_width, img_height = 800, 400
    background_color = "#1E1E1E"  # Dark theme background
    text_color = "#FFFFFF"        # White text
    green_color = "#4CAF50"       # Green color for contributions and longest streak
    orange_color = "#FFA500"      # Orange color for current streak

    img = Image.new("RGB", (img_width, img_height), color=background_color)
    draw = ImageDraw.Draw(img)

    # Load fonts (use any custom font if available)
    title_font = ImageFont.load_default()
    large_font = ImageFont.truetype("arialbd.ttf", 36)  # Bold font for numbers
    small_font = ImageFont.truetype("arial.ttf", 20)

    # Define positions for each column
    x_positions = [img_width // 6, img_width // 2, img_width * 5 // 6]
    y_position = 60

    # Draw Total Contributions
    draw.text((x_positions[0], y_position), f"{stats['total_contributions']}", fill=green_color, font=large_font, anchor="ms")
    draw.text((x_positions[0], y_position + 40), "Total Contributions", fill=text_color, font=small_font, anchor="ms")
    draw.text((x_positions[0], y_position + 70), "Oct 3, 2023 - Present", fill=text_color, font=small_font, anchor="ms")

    # Draw Current Streak with Flame Icon
    flame_icon = "🔥"  # You can replace this with an image if desired
    draw.text((x_positions[1], y_position - 20), flame_icon, fill=orange_color, font=large_font, anchor="ms")
    draw.text((x_positions[1], y_position), f"{stats['current_streak']}", fill=orange_color, font=large_font, anchor="ms")
    draw.text((x_positions[1], y_position + 40), "Current Streak", fill=text_color, font=small_font, anchor="ms")
    draw.text((x_positions[1], y_position + 70), "Sep 27 - Nov 19", fill=text_color, font=small_font, anchor="ms")

    # Draw Longest Streak
    draw.text((x_positions[2], y_position), f"{stats['longest_streak']}", fill=green_color, font=large_font, anchor="ms")
    draw.text((x_positions[2], y_position + 40), "Longest Streak", fill=text_color, font=small_font, anchor="ms")
    draw.text((x_positions[2], y_position + 70), "Sep 27 - Nov 19", fill=text_color, font=small_font, anchor="ms")

    # Draw Exclusion Note at the Bottom
    exclusion_note = "* Excluding Sun, Sat"
    draw.text((img_width // 2, img_height - 30), exclusion_note, fill=text_color, font=small_font, anchor="ms")

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
