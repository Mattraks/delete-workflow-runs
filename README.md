# delete-workflow-runs v1
The GitHub action to delete workflow runs in a repository. This Action (written in JavaScript) wraps two Workflow Runs API:
* [**List workflow runs for a repository**](https://docs.github.com/en/free-pro-team@latest/rest/reference/actions#list-workflow-runs-for-a-repository) -- Lists all workflow runs for a repository.
* [**Delete a workflow run**](https://docs.github.com/en/free-pro-team@latest/rest/reference/actions#delete-a-workflow-run) -- Delete a specific workflow run.

The action will calculate the number of days that each workflow run has been retained so far, then use this number to compare with the number you specify for the input parameter **`retain_days`**". If the retention days of the workflow run has reached (equal to or greater than) the specified number, delete the workflow run.

## Inputs
### 1. `token`
#### Required: YES
A personal access token (PAT) to authenticate. The PAT must have the **`repo`** scope.

##
