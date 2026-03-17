# CI Log Summarizer

Stop reading raw CI logs. Get a concise AI summary in seconds.

## When to use this vs CI Failure Explainer

- CI Log Summarizer -> fast triage (what happened)
- CI Failure Explainer -> deep analysis (why it failed)

Use Summarizer when you want quick signal.
Use Explainer when you need detailed debugging.

CI Log Summarizer is a production-oriented GitHub Action built for fast CI triage. It detects failed jobs in the current workflow run, downloads the failed logs, sanitizes and truncates them, and turns them into a compact report developers can use immediately.

Unlike a long-form failure explainer, this action is optimized for speed and signal density: one short summary, the key error, the failed step, and the next thing to do. The same summary is always written to the GitHub Actions job summary. If the workflow is running in a pull request context, the action also upserts a PR comment so teams do not get duplicate bot comments on every re-run.

## Use In 1 Minute

Add a dedicated follow-up job with `if: failure()` after your main CI jobs:

```yaml
name: CI

on:
  pull_request:
  push:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: npm test

  summarize-ci-logs:
    if: ${{ failure() }}
    needs:
      - test
    runs-on: ubuntu-latest
    permissions:
      actions: read
      contents: read
      pull-requests: write
      issues: write
    steps:
      - name: Summarize CI logs
        uses: Neal0326/ci-log-summarizer@v1
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          openai-api-key: ${{ secrets.OPENAI_API_KEY }}
          model: gpt-4.1-mini
          mode: short
```

## What It Does

1. Detects the current workflow run and run attempt
2. Lists failed jobs from the current run
3. Downloads the failed job logs
4. Strips ANSI codes, normalizes line endings, and redacts obvious secrets
5. Truncates logs to a safe prompt size
6. Sends the prepared logs to OpenAI
7. Returns a structured summary with `shortSummary`, `keyErrors`, `failedStep`, `likelyCause`, `suggestedNextSteps`, and `confidenceLevel`
8. Writes the markdown summary to the job summary
9. Upserts a pull request comment when running in PR context

## Why This Is Different

CI Log Summarizer is intentionally not a long narrative explainer.

- It is built for fast triage, not detailed postmortems
- It supports a `short` mode for developers who want one paragraph plus the top error
- It pushes the model to focus on the first real failure instead of writing broad commentary
- It is designed to fit naturally into noisy PR workflows where compact output matters

## Example Output

```md
CI Log Summarizer

Workflow: CI
Summary Status: success

Failed Jobs
- test (Step 4: npm test)

Short Summary
The workflow failed in the test job because the test command ran with a missing dependency and exited immediately.

Key Errors
- Error: Cannot find module 'vitest'
- npm ERR! Test failed. See above for more details.

Failed Step
Step 4: npm test

Likely Cause
Dependencies were not installed before the test command ran, or the dependency list is incomplete.

Suggested Next Steps
1. Ensure `npm ci` completes before `npm test`
2. Confirm `vitest` exists in `package.json`
3. Re-run the workflow after fixing dependency installation

Confidence Level
high
```

## Inputs

| Name | Required | Default | Description |
| --- | --- | --- | --- |
| `github-token` | Yes | | Token used to list workflow jobs, download logs, and post PR comments |
| `openai-api-key` | No | | OpenAI API key. If omitted, AI summarization is skipped gracefully |
| `model` | No | `gpt-4.1-mini` | OpenAI model name |
| `mode` | No | `short` | Output mode: `full` for the full structured report, `short` for a compact triage summary |

## Outputs

| Name | Description |
| --- | --- |
| `summary-status` | `success`, `fallback`, or `skipped` |
| `failed-job-count` | Number of failed jobs found in the current workflow run attempt |
| `pull-request-commented` | `true` if the action created or updated a PR comment |

## Permissions

Recommended workflow permissions:

```yaml
permissions:
  actions: read
  contents: read
  pull-requests: write
  issues: write
```

- `actions: read` is required to list jobs and download logs
- `pull-requests: write` and `issues: write` are required to create or update PR comments
- `contents: read` is recommended for normal workflow execution parity

If PR comment permissions are unavailable, the action still writes the report to the GitHub Actions job summary.

## Output Modes

- `full` writes the full structured report with failed jobs, key errors, failed step, likely cause, and next steps
- `short` writes a compact four-line PR-bot style summary with one short paragraph, `job + step`, and the top error line

`short` is the default because PR comments are usually more useful when they stay lightweight and easy to scan.

## Fork Pull Requests

For `pull_request` events coming from forks, GitHub does not expose repository secrets such as `OPENAI_API_KEY`.

CI Log Summarizer handles that safely:

- Detects fork pull request context
- Skips the OpenAI call instead of failing the action
- Writes a summary explaining that AI analysis was skipped because secrets are unavailable
- Avoids trying to comment back into the PR from an unsafe fork context

If you need AI analysis for forked contributions, use a carefully reviewed `pull_request_target` design and understand the security implications before exposing secrets.

## OpenAI Usage And Cost

This action sends sanitized and truncated log excerpts to OpenAI, not the entire workflow history.

- ANSI codes are stripped before transmission
- Obvious secrets and tokens are redacted
- Logs are truncated to a bounded prompt size
- The response is limited to a concise structured JSON payload

That keeps requests small and costs predictable for most CI runs.

If the OpenAI request fails, the action does not fail the whole workflow. It produces a deterministic fallback summary and still writes the job summary. If the OpenAI API key is missing, the action marks the run as `skipped` and explains why.

## OpenAI API Key

This action requires an OpenAI API key.

You must provide your own key:

```yaml
with:
  openai-api-key: ${{ secrets.OPENAI_API_KEY }}
```

## Publishing

This project is structured like a publishable JavaScript action:

- TypeScript source lives in `src/`
- `npm run build` bundles the action with `ncc`
- `action.yml` points to `dist/index.js`

Before publishing a release:

1. Run `npm install`
2. Run `npm run verify`
3. Commit the generated `dist/` artifacts
4. Tag a release such as `v1`
5. Reference that tag from `uses:`

## Implementation Notes

- Uses GitHub REST APIs through Octokit to list workflow jobs
- Downloads failed job logs directly from the Actions logs endpoint
- Upserts PR comments with the hidden marker `<!-- ci-log-summarizer -->`
- Focuses AI analysis on the first meaningful failure instead of noisy follow-up warnings
- Supports a compact `short` mode for lightweight PR summaries
- Falls back to a deterministic summary if OpenAI is unavailable
