async function run() {
  const core = require("@actions/core");
  try {
    // Fetch all the inputs
    const token = core.getInput('token');
    const repository = core.getInput('repository');
    const retain_days = core.getInput('retain_days');
    
    // Split the input 'repository' (format {owner}/{repo}) to be {owner} and {repo}
    const splitRepository = repository.split('/');
    if (splitRepository.length !== 2 || !splitRepository[0] || !splitRepository[1]) {
      throw new Error(`Invalid repository '${repository}'. Expected format {owner}/{repo}.`);
    }
    const repo_owner = splitRepository[0];
    const repo_name = splitRepository[1];
    
    var page_number = 1;
    var lenght = 100;
    while (true) {
      // Execute the API "List workflow runs for a repository", see 'https://octokit.github.io/rest.js/v18#actions-list-workflow-runs-for-repo'
      const { Octokit } = require("@octokit/rest");
      const octokit = new Octokit({ auth: token });
      const response = await octokit.actions.listWorkflowRunsForRepo({
        owner: repo_owner,
        repo: repo_name,
        per_page: 100,
        page: page_number
      });
      
      const lenght = response.data.workflow_runs.length;
      
      if (lenght < 1) {
        break;
      }
      else {
      }
      
      if (lenght < 100) {
        break;
      }
      page_number++;
    }
  }
  catch (error) {
    core.setFailed(error.message);
  }
}

run();
