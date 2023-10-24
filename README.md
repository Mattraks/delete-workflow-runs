# delete-workflow-runs v2
The GitHub action to delete workflow runs in a repository. This action (written in JavaScript) wraps two Workflow Runs API:
* [**List repository workflows**](https://docs.github.com/en/free-pro-team@latest/rest/reference/actions#list-repository-workflows) -- Lists the workflows in a repository.

* [**List workflow runs**](https://docs.github.com/en/free-pro-team@latest/rest/reference/actions#list-workflow-runs) -- List all workflow runs for a workflow.

* [**Delete a workflow run**](https://docs.github.com/en/free-pro-team@latest/rest/reference/actions#delete-a-workflow-run) -- Delete a specific workflow run.

The action will calculate the number of days that each workflow run has been retained so far, then use this number to compare with the number you specify for the input parameter "[**`retain_days`**](#3-retain_days)". If the retention days of the workflow run has reached (equal to or greater than) the specified number, the workflow run will be deleted.

## What's new?
* Add the input parameter "[**`delete_run_by_conclusion_pattern`**](#7-delete_run_by_conclusion_pattern)" - useful for `skipped` workflow runs.
* Add the input parameter "[**`delete_workflow_by_state_pattern`**](#6-delete_workflow_by_state_pattern)" and "[**`dry_run`**](#8-dry_run)".
* Add ability to filter workflows by workflow filename (in addition to the name)
* Add ability to filter workflows by state
* Add ability to perform a 'dry run' which logs the changes but doesn't perform the actual deletion.
##

## Inputs
### 1. `token`
#### Required: YES
#### Default: `${{ github.token }}`
The token used to authenticate.
* If the workflow runs are in the current repository where the action is running, using **`github.token`** is OK, but you must specify `permissions: actions: write` within your build job (or at a higher level) to allow the default token access to write (delete) action-related data. More details, see the [**`GITHUB_TOKEN`**](https://docs.github.com/en/free-pro-team@latest/actions/reference/authentication-in-a-workflow).
* If the workflow runs are in another repository, you need to use a personal access token (PAT) that must have the **`repo`** scope. More details, see "[Creating a personal access token](https://docs.github.com/en/free-pro-team@latest/github/authenticating-to-github/creating-a-personal-access-token)".

### 2. `repository`
#### Required: YES
#### Default: `${{ github.repository }}`
The name of the repository where the workflow runs are on.

### 3. `retain_days`
#### Required: YES
#### Default: 30
The number of days that is used to compare with the retention days of each workflow.

### 4. `keep_minimum_runs`
#### Required: YES
#### Default: 6
The minimum runs to keep for each workflow.

### 5. `delete_workflow_pattern`
#### Required: NO
The name or filename of the workflow. If not set then it will target all workflows.

### 6. `delete_workflow_by_state_pattern`
#### Required: NO
#### Default: 'ALL'
Remove workflow by state: active, deleted, disabled_fork, disabled_inactivity, disabled_manually
_Multiple state values permitted as a comma-separated list_

### 7. `delete_run_by_conclusion_pattern`
#### Required: NO
#### Default: 'ALL'
Remove workflow by conclusion: action_required, cancelled, failure, skipped, success
_Multiple conclusion values permitted as a comma-separated list_

### 8. `dry_run`
#### Required: NO
Only log actions, do not perform any delete operations.
##

## Examples
### In scheduled workflow, see [schedule event](https://docs.github.com/en/free-pro-team@latest/actions/reference/events-that-trigger-workflows#schedule).
> **Tip:** Using scheduled workflow is the recommended way that can periodically, automatically delete old workflow runs.
```yaml
name: Delete old workflow runs
on:
  schedule:
    - cron: '0 0 1 * *'
# Run monthly, at 00:00 on the 1st day of month.

jobs:
  del_runs:
    runs-on: ubuntu-latest
    permissions:
      actions: write
    steps:
      - name: Delete workflow runs
        uses: Mattraks/delete-workflow-runs@v2
        with:
          token: ${{ github.token }}
          repository: ${{ github.repository }}
          retain_days: 30
          keep_minimum_runs: 6
```

### In manual triggered workflow, see [workflow_dispatch event](https://docs.github.com/en/free-pro-team@latest/actions/reference/events-that-trigger-workflows#workflow_dispatch).
> In this way, you can manually trigger the workflow at any time to delete old workflow runs. <br/>
![manual workflow](img/example.PNG)
```yaml
name: Delete old workflow runs
on:
  workflow_dispatch:
    inputs:
      days:
        description: 'Number of days.'
        required: true
        default: '30'
      minimum_runs:
        description: 'The minimum runs to keep for each workflow.'
        required: true
        default: '6'
      delete_workflow_pattern:
        description: 'The name or filename of the workflow. if not set then it will target all workflows.'
        required: false
      delete_workflow_by_state_pattern:
        description: 'Remove workflow by state: active, deleted, disabled_fork, disabled_inactivity, disabled_manually'
        required: true
        default: "ALL"
        type: choice
        options:
          - "ALL"
          - active
          - deleted
          - disabled_inactivity
          - disabled_manually
      delete_run_by_conclusion_pattern:
        description: 'Remove workflow by conclusion: action_required, cancelled, failure, skipped, success'
        required: true
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
        description: 'Only log actions, do not perform any delete operations.'
        required: false

jobs:
  del_runs:
    runs-on: ubuntu-latest
    permissions:
      actions: write
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
              startsWith(github.event.inputs.delete_run_by_conclusion_pattern, 'Unsuccessful:')
              && 'action_required,cancelled,failure,skipped'
              || github.event.inputs.delete_run_by_conclusion_pattern
            }}
          dry_run: ${{ github.event.inputs.dry_run }}
```
##

## License
The scripts and documentation in this project are released under the [MIT License](LICENSE).
##
