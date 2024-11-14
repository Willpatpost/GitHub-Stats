import requests
import os

# Your GitHub username
github_username = "Willpatpost"

# GraphQL query to fetch total contributions
query = """
{
  user(login: "%s") {
    contributionsCollection {
      contributionCalendar {
        totalContributions
      }
    }
  }
}
""" % github_username

# GitHub GraphQL API endpoint
url = "https://api.github.com/graphql"

# Headers with the access token
headers = {
    "Authorization": f"Bearer {os.getenv('GITHUB_TOKEN')}"
}

# Make the request
response = requests.post(url, json={"query": query}, headers=headers)
data = response.json()

# Extract total contributions
try:
    total_contributions = data["data"]["user"]["contributionsCollection"]["contributionCalendar"]["totalContributions"]
    print(f"Total Contributions: {total_contributions}")
except KeyError:
    print("Error fetching data:", data)
