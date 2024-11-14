import requests
import os
import json

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
        print("No more repositories found.")
        break

    # Process each repository to count all commits in all branches
    for repo in repos:
        repo_name = repo["name"]
        print(f"Checking repository: {repo_name}")
        
        # Pagination for commits
        commit_page = 1
        while True:
            commits_url = f"https://api.github.com/repos/{github_username}/{repo_name}/commits"
            params = {
                "page": commit_page,
                "per_page": 1  # Get only one commit for debugging
            }
            commits_response = requests.get(commits_url, headers=headers, params=params)
            commits = commits_response.json()
            
            # If there are no more commits, break
            if not commits:
                print(f"No more commits found on page {commit_page} for repository {repo_name}.")
                break
            
            # Debug: Print the JSON structure of the first commit
            print(f"Commit JSON structure for repository {repo_name} on page {commit_page}:")
            print(json.dumps(commits[0], indent=2))  # Pretty-print the first commit's JSON
            
            commit_page += 1
            break  # Exit after the first commit for now to limit output

    page += 1
    break  # Exit after the first repository to limit output

# Print message to indicate completion of the test run
print("Commit structure inspection complete.")
