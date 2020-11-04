# delete-workflow-runs v2
The GitHub action to delete workflow runs in a repository. This action (written in JavaScript) wraps two Workflow Runs API:
* [**List repository workflows**](https://docs.github.com/en/free-pro-team@latest/rest/reference/actions#list-repository-workflows) -- Lists the workflows in a repository.

* [**List workflow runs**](https://docs.github.com/en/free-pro-team@latest/rest/reference/actions#list-workflow-runs) -- List all workflow runs for a workflow.

* [**Delete a workflow run**](https://docs.github.com/en/free-pro-team@latest/rest/reference/actions#delete-a-workflow-run) -- Delete a specific workflow run.

The action will calculate the number of days that each workflow run has been retained so far, then use this number to compare with the number you specify for the input parameter "[**`retain_days`**](#3-retain_days)". If the retention days of the workflow run has reached (equal to or greater than) the specified number, the workflow run will be deleted.

## What's new?
* Add the input parameter "[**`keep_minimum_runs`**](#4-keep_minimum_runs)". Whit this input parameter, you can specify the number of the minimum runs to keep for each workflow. The specified number of latest runs will be kept for each workflow, even if some of the runs have reached the specified retention days.

* Optimize code to simplify the processes.
##

## Inputs
### 1. `token`
#### Required: YES
#### Default: `${{ github.token }}`
The token used to authenticate.
* If the workflow runs are in the current repository where the action is running, using **`github.token`** is OK. More details, see the [**`GITHUB_TOKEN`**](https://docs.github.com/en/free-pro-team@latest/actions/reference/authentication-in-a-workflow).
* If the workflow runs are in another repository, you need to use a personal access token (PAT) that must have the **`repo`** scope. More details, see "[Creating a personal access token](https://docs.github.com/en/free-pro-team@latest/github/authenticating-to-github/creating-a-personal-access-token)".

### 2. `repository`
#### Required: YES
#### Default: `${{ github.repository }}`
The name of the repository where the workflow runs are on.

### 3. `retain_days`
#### Required: YES
#### Default: 90
The number of days that is used to compare with the retention days of each workflow.

### 4. `keep_minimum_runs`
#### Required: YES
#### Default: 6
The minimum runs to keep for each workflow.
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
    steps:
      - name: Delete workflow runs
        uses: ActionsRML/delete-workflow-runs@main
        with:
          token: ${{ secrets.AUTH_PAT }}
          repository: ${{ github.repository }}
          retain_days: 30
```

### In manual triggered workflow, see [workflow_dispatch event](https://docs.github.com/en/free-pro-team@latest/actions/reference/events-that-trigger-workflows#workflow_dispatch).
> In this way, you can manually trigger the workflow at any time to delete old workflow runs. <br/>
![manual workflow](https://github.com/ActionsRML/delete-workflow-runs/blob/main/img/example.PNG)
```yaml
name: Delete old workflow runs
on:
  workflow_dispatch:
    inputs:
      days:
        description: 'Number of days.'
        required: true
        default: 90

jobs:
  del_runs:
    runs-on: ubuntu-latest
    steps:
      - name: Delete workflow runs
        uses: ActionsRML/delete-workflow-runs@main
        with:
          token: ${{ secrets.AUTH_PAT }}
          repository: ${{ github.repository }}
          retain_days: ${{ github.event.inputs.days }}
```
##

## License
The scripts and documentation in this project are released under the [MIT License](https://github.com/ActionsRML/delete-workflow-runs/blob/main/LICENSE).
##
