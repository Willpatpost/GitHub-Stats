# GitHub Stats Board

An automatically generated SVG stat board for William Poston's GitHub profile.

![GitHub Stats](./stats_board.svg)

## What It Shows

- Total contributions across the account history
- Current contribution streak, with weekends treated as neutral days
- Longest contribution streak
- Top repository languages by byte count
- Last generated timestamp in Eastern Time

## Automation

`.github/workflows/update-stats.yml` runs every 5 minutes and on manual dispatch. The workflow regenerates `stats_board.svg`, commits it when the SVG changes, and pushes the update back to `main`.

## Local Commands

```bash
npm start
npm test
```

The generator uses these optional environment variables:

- `GITHUB_TOKEN`: required for GitHub API access
- `GITHUB_USERNAME`: GitHub username to render, defaults to `Willpatpost`
- `OUTPUT_PATH`: SVG output path, defaults to `stats_board.svg`
- `STATS_TIME_ZONE`: timestamp timezone, defaults to `America/New_York`
- `LANGUAGE_EXCLUSION_THRESHOLD`: hides a language when it exceeds this percentage before recalculating the top-language mix, defaults to `90`
