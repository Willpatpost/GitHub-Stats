import requests
import os

# Your GitHub username
github_username = "Willpatpost"

# GitHub API URL to get a list of your repositories
url = f"https://api.github.com/users/{github_username}/repos"

# Send the request with an authorization token (set in the GitHub Action)
headers = {
    "Authorization": f"token {os.getenv('GITHUB_TOKEN')}"
}
response = requests.get(url, headers=headers)
data = response.json()

# Calculate total contributions by summing the commit count in each repository
total_commits = 0
for repo in data:
    repo_name = repo["name"]
    commits_url = f"https://api.github.com/repos/{github_username}/{repo_name}/commits"
    commits_response = requests.get(commits_url, headers=headers)
    total_commits += len(commits_response.json())

# Print the total commits (for testing in the Action logs)
print(f"Total Commits: {total_commits}")
