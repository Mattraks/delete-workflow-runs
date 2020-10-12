# delete-workflow-runs v1
The GitHub action to delete workflow runs in a repository. This Action (written in JavaScript) wraps two Workflow Runs API:
* [**List workflow runs for a repository**](https://docs.github.com/en/free-pro-team@latest/rest/reference/actions#list-workflow-runs-for-a-repository) -- Lists all workflow runs for a repository.
* [**Delete a workflow run**](https://docs.github.com/en/free-pro-team@latest/rest/reference/actions#delete-a-workflow-run) -- Delete a specific workflow run.

The action will calculate the number of days that each workflow run has been retained so far, then use this number to compare with the number you specify for the input parameter "[**`retain_days`**](https://github.com/ActionsRML/delete-workflow-runs#3-retain_days)". If the retention days of the workflow run has reached (equal to or greater than) the specified number, the workflow run will be deleted.

## Inputs
### 1. `token`
#### Required: YES
A personal access token (PAT) to authenticate. The PAT must have the **`repo`** scope.

### 2. `repository`
#### Required: YES
#### Default: `${{ github.repository }}`
The name of the repository where the workflow runs are on.

### 3. `retain_days`
#### Required: YES
#### Default: 90
The number of days that is used to compare with the retention days of each workflow.
##

## Examples
### Using scheduled workflow, see [schedule](https://docs.github.com/en/free-pro-team@latest/actions/reference/events-that-trigger-workflows#schedule) event.
> Using scheduled workflow is the recommended way that can periodically delete old workflow runs.
```yaml
name: Delete old workflow runs
on:
  schedule:
    - cron: '0 0 1 * *'
# Run monthly, at 00:00 on the 1st day of month.

jobs:
  del_runs:
    runs-on: ubuntu-latest
    steps:
      - name: Delete workflow runs
        uses: ActionsRML/delete-workflow-runs@main
        with:
          token: ${{ secrets.API_AUTH_TOKEN }}
          repository: owner-name/repo-name
          retain_days: 30
  
```
##

## License
The scripts and documentation in this project are released under the [MIT License](https://github.com/ActionsRML/delete-workflow-runs/blob/main/LICENSE).
##
