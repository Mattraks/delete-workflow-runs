# Delete Workflow Runs v2.1.0

A GitHub Action to delete workflow runs in a repository. This Action uses JavaScript and interacts with the GitHub API to manage workflow runs efficiently.

## Features

- Deletes workflow runs based on retention period and minimum runs to keep.
- Supports filtering by workflow name, filename, state, or run conclusion.
- Includes a dry-run mode to simulate deletions without making changes.
- Skips runs linked to active branches or pull requests (optional).
- Optimized to avoid uploading `node_modules` by bundling code with `@vercel/ncc`.

## Inputs (summary)

| Input | Required | Default | Description |
|---|---:|---|---|
| `token` | No | `${{github.token}}` | GitHub token used for authentication. Use `github.token` for the current repository or a PAT with `repo` scope for cross-repo access. Token must have appropriate permissions (see Permissions). |
| `repository` | No | `${{github.repository}}` | The target repository in `owner/repo` format. |
| `retain_days` | No | `30` | Number of days to retain workflow runs before deletion. |
| `keep_minimum_runs` | No | `6` | Minimum number of runs to keep per workflow. |
| `delete_workflow_pattern` | No | (empty) | Target workflows by name or filename. Supports multiple filters separated by `\|`. Example: `build\|deploy` will match workflows with "build" OR "deploy" in name/filename. Omit to target all workflows. |
| `delete_workflow_by_state_pattern` | No | (empty) | Filter workflows by state (comma-separated): `active`, `deleted`, `disabled_fork`, `disabled_inactivity`, `disabled_manually`. Omit to target all states. |
| `delete_run_by_conclusion_pattern` | No | (empty) | Filter runs by conclusion (comma-separated): `action_required`, `cancelled`, `failure`, `skipped`, `success`. Omit to target all conclusions. |
| `dry_run` | No | `false` | If `true`, simulate deletions and only log actions without performing them. |
| `check_branch_existence` | No | `false` | If `true`, skip deletion for runs linked to an existing branch. Note: default branch (e.g., `main`) can be excluded from deletion checks as configured. |
| `check_pullrequest_exist` | No | `false` | If `true`, skip deletion for runs linked to a pull request. |
| `baseUrl` | No | (GitHub API base) | Optional GitHub Enterprise API base URL (e.g. `https://github.mycompany.com/api/v3`). Set when using GitHub Enterprise / GHES. |

Notes:
- Inputs names reflect the action's expected input keys. Do not change names in your workflow unless you have updated the Action code accordingly.
- If an input has a default value, it is optional in your workflow inputs.
- For delete_workflow_pattern you can provide multiple filters separated by the pipe character `|` (interpreted as logical OR). For more complex matching, combine with other inputs.

## Permissions

The token used must allow the Action to list and delete workflow runs. Recommended permission set for the GitHub App/Token used:
- actions: write
- contents: read

Using `${{ github.token }}` in workflows is recommended for the current repository. For cross-repository operations or if you need broader scope, use a Personal Access Token (PAT) with `repo` scope and appropriate permissions.

## Setup (development / publishing)

1. Ensure `package.json` includes dependencies and a build script using `@vercel/ncc`.
2. Run `npm install` and `npm run build` to generate `dist/index.js`.
3. Commit the `dist/` folder (compiled bundle) to the repository. Do NOT commit `node_modules/` — use `.gitignore` to exclude it.
4. Tag and release versions as needed (the action can be referenced by `@v2`, `@v2.1.0`, or a full SHA).

## Examples

### Scheduled Workflow (monthly)

Run monthly to delete old workflow runs:

```yaml
name: Delete old workflow runs
on:
  schedule:
    - cron: "0 0 1 * *" # Monthly at 00:00 on the 1st
jobs:
  delete-runs:
    runs-on: ubuntu-latest
    permissions:
      actions: write
      contents: read
    steps:
      - name: Delete workflow runs
        uses: Mattraks/delete-workflow-runs@v2
        with:
          token: ${{ github.token }}
          repository: ${{ github.repository }}
          retain_days: 30
          keep_minimum_runs: 6
```

### Manual Workflow (workflow_dispatch)

Trigger manually with customizable inputs:

```yaml
name: Delete old workflow runs
on:
  workflow_dispatch:
    inputs:
      days:
        description: "Days to retain runs"
        required: true
        default: "30"
      minimum_runs:
        description: "Minimum runs to keep"
        required: true
        default: "6"
      delete_workflow_pattern:
        description: "Workflow name or filename (omit for all). Use `|` to separate multiple filters (e.g. 'build|deploy')."
        required: false
      delete_workflow_by_state_pattern:
        description: "Workflow state: active, deleted, disabled_fork, disabled_inactivity, disabled_manually"
        required: false
        default: "ALL"
        type: choice
        options:
          - "ALL"
          - active
          - deleted
          - disabled_inactivity
          - disabled_manually
      delete_run_by_conclusion_pattern:
        description: "Run conclusion: action_required, cancelled, failure, skipped, success"
        required: false
        default: "ALL"
        type: choice
        options:
          - "ALL"
          - "Unsuccessful: action_required,cancelled,failure,skipped"
          - action_required
          - cancelled
          - failure
          - skipped
          - success
      dry_run:
        description: "Simulate deletions"
        required: false
        default: "false"
        type: choice
        options:
          - "false"
          - "true"
jobs:
  delete-runs:
    runs-on: ubuntu-latest
    permissions:
      actions: write
      contents: read
    steps:
      - name: Delete workflow runs
        uses: Mattraks/delete-workflow-runs@v2
        with:
          token: ${{ github.token }}
          repository: ${{ github.repository }}
          retain_days: ${{ github.event.inputs.days }}
          keep_minimum_runs: ${{ github.event.inputs.minimum_runs }}
          delete_workflow_pattern: ${{ github.event.inputs.delete_workflow_pattern }}
          delete_workflow_by_state_pattern: ${{ github.event.inputs.delete_workflow_by_state_pattern }}
          delete_run_by_conclusion_pattern: >-
            ${{
              startsWith(github.event.inputs.delete_run_by_conclusion_pattern, 'Unsuccessful:') &&
              'action_required,cancelled,failure,skipped' ||
              github.event.inputs.delete_run_by_conclusion_pattern
            }}
          dry_run: ${{ github.event.inputs.dry_run }}
```

### Multiple repositories (matrix)

Run the Action for multiple repositories using a matrix job. Note: when operating on repositories other than the workflow repo, you must provide a PAT with `repo` scope (use a secret such as `secrets.PAT_TOKEN`).

```yaml
name: Delete old workflow runs across repos
on:
  workflow_dispatch:
    inputs:
      days:
        description: "Days to retain runs"
        required: true
        default: "30"
      minimum_runs:
        description: "Minimum runs to keep"
        required: true
        default: "6"
jobs:
  delete-multiple-repos:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        repository: [ "org/repo-one", "org/repo-two", "org/repo-three" ]
    permissions:
      actions: write
      contents: read
    steps:
      - name: Delete workflow runs in repository
        uses: Mattraks/delete-workflow-runs@v2
        with:
          token: ${{ secrets.PAT_TOKEN }} # PAT with repo scope required for cross-repo
          repository: ${{ matrix.repository }}
          retain_days: ${{ github.event.inputs.days }}
          keep_minimum_runs: ${{ github.event.inputs.minimum_runs }}
          # example: match workflows named 'build' OR 'deploy'
          delete_workflow_pattern: build|deploy
          dry_run: "false"
```

### GitHub Enterprise / GHES

For GitHub Enterprise, specify the API base URL via `baseUrl`:

```yaml
jobs:
  delete-runs:
    runs-on: ubuntu-latest
    permissions:
      actions: write
      contents: read
    steps:
      - name: Delete old workflow runs
        uses: Mattraks/delete-workflow-runs@v2
        with:
          token: ${{ secrets.PAT_TOKEN }}
          baseUrl: https://github.mycompany.com/api/v3
          repository: mycompany/myrepo
          retain_days: 30
          keep_minimum_runs: 6
```

## Development

To build the Action locally:

1. Install dependencies: `npm install`
2. Build the Action: `npm run build`
3. Commit the `dist/` folder to the repository (this includes the compiled bundle).
4. Keep `node_modules/` excluded by `.gitignore` to reduce repository size.

## Troubleshooting & Notes

- Use `dry_run: true` first to preview which runs would be deleted.
- When filtering by workflow name/filename or conclusions, ensure your patterns match the targets you expect. Consider testing on a small repo first.
- The Action will not delete runs that are linked to open pull requests if `check_pullrequest_exist` is set to `true`.
- For `delete_workflow_pattern`, use `|` to supply multiple alternative patterns (logical OR). Example: `build|deploy` matches either "build" or "deploy".
- For cross-repository execution, ensure the token provided has necessary scopes (PAT with `repo` for private repos / cross-repo operations).

## License

This project is licensed under the [MIT License](LICENSE).