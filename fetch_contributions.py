import requests
import os
import re

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
    
    # Read the README file
    with open("README.md", "r") as file:
        readme_content = file.read()

    # Update the placeholder with the actual contribution count
    updated_content = re.sub(
        r"Total Contributions: <!--CONTRIBUTION_COUNT-->.*?<!--END_CONTRIBUTION_COUNT-->",
        f"Total Contributions: <!--CONTRIBUTION_COUNT-->{total_contributions}<!--END_CONTRIBUTION_COUNT-->",
        readme_content
    )

    # Write the updated content back to the README file
    with open("README.md", "w") as file:
        file.write(updated_content)

except KeyError:
    print("Error fetching data:", data)
