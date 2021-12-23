async function run() {
  const core = require("@actions/core");
  try {
    // Fetch all the inputs
    const token = core.getInput('token');
    const repository = core.getInput('repository');
    const retain_days = Number(core.getInput('retain_days'));
    const keep_minimum_runs = Number(core.getInput('keep_minimum_runs'));

    // Split the input 'repository' (format {owner}/{repo}) to be {owner} and {repo}
    const splitRepository = repository.split('/');
    if (splitRepository.length !== 2 || !splitRepository[0] || !splitRepository[1]) {
      throw new Error(`Invalid repository '${repository}'. Expected format {owner}/{repo}.`);
    }
    const repo_owner = splitRepository[0];
    const repo_name = splitRepository[1];

    const { Octokit } = require("@octokit/rest");
    const octokit = new Octokit({ auth: token });

    const workflows = await octokit
      .paginate("GET /repos/:owner/:repo/actions/workflows", {
        owner: repo_owner,
        repo: repo_name,
      });
    for (const workflow of workflows)
    {
      core.debug(`Workflow: ${workflow.name} ${workflow.id} ${workflow.state}`);
      let del_runs = new Array();
      // Execute the API "List workflow runs for a repository", see 'https://octokit.github.io/rest.js/v18#actions-list-workflow-runs-for-repo'
      const runs = await octokit
        .paginate("GET /repos/:owner/:repo/actions/workflows/:workflow_id/runs", {
          owner: repo_owner,
          repo: repo_name,
          workflow_id: workflow.id
        });
      for (const run of runs)
      {
        core.debug(`Run: '${workflow.name}' workflow run ${run.id} (status=${run.status})`)

        if (run.status !== "completed") {
          console.log(`👻 Skipped '${workflow.name}' workflow run ${run.id}: it is in '${run.status}' state`);
          continue;
        }

        const created_at = new Date(run.created_at);
        const current = new Date();
        const ELAPSE_ms = current.getTime() - created_at.getTime();
        const ELAPSE_days = ELAPSE_ms / (1000 * 3600 * 24);
                
        if (ELAPSE_days > retain_days) {
          core.debug(`  Added to del list '${workflow.name}' workflow run ${run.id}`);
          del_runs.push(run);
        }
        else
        {
          console.log(`👻 Skipped '${workflow.name}' workflow run ${run.id}: created at ${run.created_at}`);
        }
      }

      core.debug(`Delete list for '${workflow.name}' is ${del_runs.length} items`);
      const arr_length = del_runs.length - keep_minimum_runs;
      if (arr_length > 0) {
        del_runs = del_runs
          .sort((a, b) => {
            let deltaT = Date(a.created_at).getTime() - Date(b.created_at).getTime();
            return deltaT > 0 ? 1 : (deltaT < 0 ? -1 : 0);
          })
          .slice(0, -keep_minimum_runs);
          core.debug(`Deleting ${del_runs.length} runs for '${workflow.name}' workflow`);
        for (const del of del_runs)
        {
          core.debug(`Deleting '${workflow.name}' workflow run ${del.id}`);

          // Execute the API "Delete a workflow run", see 'https://octokit.github.io/rest.js/v18#actions-delete-workflow-run'
          await octokit.actions.deleteWorkflowRun({
            owner: repo_owner,
            repo: repo_name,
            run_id: del.id
          });

          console.log(`🚀 Delete run ${del.id} of '${workflow.name}' workflow`);
        }
        console.log(`✅ ${arr_length} runs of '${workflow.name}' workflow deleted.`);
      }
    }
  }
  catch (error) {
    core.setFailed(error.message);
  }
}

run();
