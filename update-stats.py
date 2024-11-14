import requests
import os

# Your GitHub username
github_username = "Willpatpost"

# GitHub API base URL for user repositories
base_url = f"https://api.github.com/users/{github_username}/repos"

# Headers with the access token
headers = {
    "Authorization": f"token {os.getenv('GITHUB_TOKEN')}"
}

# Initialize total commits
total_commits = 0

# Pagination for repositories
page = 1
while True:
    # Get repositories with pagination
    url = f"{base_url}?page={page}&per_page=100"  # 100 repos per page
    response = requests.get(url, headers=headers)
    repos = response.json()

    # If there are no more repos, break out of the loop
    if not repos:
        break

    # Process each repository to count commits authored by you across all branches
    for repo in repos:
        repo_name = repo["name"]
        
        # Pagination for commits
        commit_page = 1
        while True:
            commits_url = f"https://api.github.com/repos/{github_username}/{repo_name}/commits"
            params = {
                "author": github_username,  # Only count commits authored by you
                "page": commit_page,
                "per_page": 100
            }
            commits_response = requests.get(commits_url, headers=headers, params=params)
            commits = commits_response.json()
            
            # If there are no more commits, break
            if not commits:
                break
            
            # Add the number of commits in this page
            total_commits += len(commits)
            commit_page += 1

    page += 1

# Print the total commits (for testing in the Action logs)
print(f"Total Commits: {total_commits}")
