# GitHub Stats Board

An automatically generated SVG stat board for my GitHub profile.

![GitHub Stats](./stats_board.svg)

## What It Shows

- Total contributions across the account history
- Current contribution streak, with weekends treated as neutral days
- Longest contribution streak
- Top repository languages by byte count
- Last statistics change timestamp in Eastern Time
- Automatic light and dark themes with a golden-yellow accent

## Automation

`.github/workflows/update-stats.yml` runs on pushes to `main`, on manual dispatch, and approximately every 5 minutes through GitHub's best-effort scheduler. The workflow compares generated statistics with the existing `stats_board.svg` while ignoring the timestamp. It commits only when statistics or card output change, so unchanged runs preserve the previous SVG and timestamp. SVG-only bot updates are ignored by the push trigger to avoid update loops.

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
