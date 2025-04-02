function csv_string_to_array(listString){
  if (typeof listString == "string"){
    return listString.trim().split(/[ ]*,[ ]*/);
  }
  return []
}

function generate_conclusion_pattern(core){
  let delete_run_by_conclusion_pattern = (core.getInput('delete_run_by_conclusion_pattern') || 'ALL').trim();
  if(delete_run_by_conclusion_pattern.toUpperCase() !== "ALL"){
    return csv_string_to_array(delete_run_by_conclusion_pattern.toLowerCase())
  } else {
    return false
  }
}

async function run() {
  const core = require("@actions/core");
  try {
    // Fetch all the inputs
    const token = core.getInput('token');
    const url = core.getInput('baseUrl');
    const repository = core.getInput('repository');
    const retain_days = Number(core.getInput('retain_days'));
    const keep_minimum_runs = Number(core.getInput('keep_minimum_runs'));
    const minimum_run_is_branch_specific = core.getInput('branch_specific_minimum_runs');
    const delete_workflow_pattern = csv_string_to_array(core.getInput('delete_workflow_pattern'));
    const delete_workflow_by_state_pattern = core.getInput('delete_workflow_by_state_pattern');
    const delete_run_by_conclusion_pattern = generate_conclusion_pattern(core);
    const dry_run = core.getInput('dry_run');
    const branch_filter_patterns = JSON.parse(core.getInput('branch_filter'));
    const check_branch_existence = core.getInput("check_branch_existence");
    const check_branch_existence_exceptions = csv_string_to_array(core.getInput("check_branch_existence_exceptions"));
    const check_pullrequest_exist = core.getInput("check_pullrequest_exist");
    // Split the input 'repository' (format {owner}/{repo}) to be {owner} and {repo}
    const splitRepository = repository.split('/');
    if (splitRepository.length !== 2 || !splitRepository[0] || !splitRepository[1]) {
      throw new Error(`Invalid repository '${repository}'. Expected format {owner}/{repo}.`);
    }
    const repo_owner = splitRepository[0];
    const repo_name = splitRepository[1];
    const { Octokit } = require("@octokit/rest");
    const { throttling } = require("@octokit/plugin-throttling");
    const MyOctokit = Octokit.plugin(throttling);
    const octokit = new MyOctokit({
      auth: token,
      baseUrl: url,
      // To avoid "API rate limit exceeded" errors
      throttle: {
        onRateLimit: (retryAfter, options, octokit, retryCount) => {
          octokit.log.warn(
            `Request quota exhausted for request ${options.method} ${options.url}`,
          );
          if (retryCount < 1) {
            // only retries once
            octokit.log.info(`Retrying after ${retryAfter} seconds!`);
            return true;
          }
        },
        onSecondaryRateLimit: (retryAfter, options, octokit) => {
          // does not retry, only logs a warning
          octokit.log.warn(
            `SecondaryRateLimit detected for request ${options.method} ${options.url}`,
          );
        },
      },
    });
    let workflows = await octokit
      .paginate("GET /repos/:owner/:repo/actions/workflows", {
        owner: repo_owner,
        repo: repo_name,
      });

    let workflow_ids = workflows.map(w => w.id);
    console.log("💬 Known workflow ids:", workflow_ids);

    // Gets all workflow runs for the repository
    // see https://docs.github.com/en/rest/actions/workflow-runs?apiVersion=2022-11-28#list-workflow-runs-for-a-repository
    let all_runs = await octokit
      .paginate('GET /repos/:owner/:repo/actions/runs', {
        owner: repo_owner,
        repo: repo_name,
      });
    console.log(`💬 found total number of ${all_runs.length} runs across all workflows`);

    // Creates the delete runs array, and adds the runs that don't have a workflow associated with it
    let del_runs = new Array();
    for (const run of all_runs) {
      if (!workflow_ids.includes(run.workflow_id)) {
        del_runs.push(run);
        core.debug(`  Added to del list '${run.name}' workflow run ${run.id}`);
      }
    }

    console.log(`💬 ${del_runs.length} workflow run(s) do not match to existing workflows anymore`);
    // is attempting to delete the existing workflow. Means the filtering logic is wrong
    for (const del of del_runs) {
      core.debug(`Deleting '${del.name}' workflow run ${del.id}`);
      // Execute the API "Delete a workflow run", see 'https://octokit.github.io/rest.js/v18#actions-delete-workflow-run'

      if (dry_run) {
        console.log(`[dry-run] 🚀 Delete run ${del.id} of '${del.name}' workflow`);
        continue;
      }

      await octokit.actions.deleteWorkflowRun({
        owner: repo_owner,
        repo: repo_name,
        run_id: del.id
      });

      console.log(`🚀 Delete run ${del.id} of '${del.name}' workflow`);
    }

    if (delete_workflow_pattern.length > 0) {
      console.log(`💬 workflows containing '${delete_workflow_pattern}' will be targeted`, JSON.stringify(delete_workflow_pattern));
      workflows = workflows.filter(
        ({ name, path }) => {
          const filename = path.replace(".github/workflows/", '');
          return delete_workflow_pattern.includes(filename) || delete_workflow_pattern.includes(name);
        }
      );
    }

    if (delete_workflow_by_state_pattern && delete_workflow_by_state_pattern.toUpperCase() !== "ALL") {
      console.log(`💬 workflows containing state '${delete_workflow_by_state_pattern}' will be targeted`);
      let patternFilter =  delete_workflow_by_state_pattern.split(",").map(x => x.trim());
      workflows = workflows.filter(
        ({ state }) => patternFilter.includes(state)
      );
    }

    let branches = await octokit
      .paginate("GET /repos/:owner/:repo/branches", {
        owner: repo_owner,
        repo: repo_name,
      })

    let existingBranchNames = branches.map(a => a.name).filter(branch => !check_branch_existence_exceptions.includes(branch));
    let allowedBranches = new RegExp(`^(${branch_filter_patterns.join('|')})$`);

    console.log(`💬 found total of ${workflows.length} workflow(s)`);
    for (const workflow of workflows) {
      core.debug(`Workflow: ${workflow.name} ${workflow.id} ${workflow.state}`);
      let del_runs = {};
      let Skip_runs = new Array();
      // Execute the API "List workflow runs for a repository", see 'https://octokit.github.io/rest.js/v18#actions-list-workflow-runs-for-repo'
      const runs = await octokit
        .paginate("GET /repos/:owner/:repo/actions/workflows/:workflow_id/runs", {
          owner: repo_owner,
          repo: repo_name,
          workflow_id: workflow.id
        });

      console.log(`Found a total of ${runs.length} runs for workflow '${workflow.name}'`)

      for (const run of runs) {
        core.debug(`Run: '${workflow.name}' workflow run ${run.id} (status=${run.status})`);

        if(!allowedBranches.test(run.head_branch)){
          console.log(` Skipping '${workflow.name}' workflow run ${run.id} because branch '${run.head_branch}' doesn't match '${allowedBranches.toString()}'.`);
          continue;
        }

        if (run.status !== "completed") {
          console.log(`👻 Skipped '${workflow.name}' workflow run ${run.id}: it is in '${run.status}' state`);
          continue;
        }

        if (check_pullrequest_exist && run.pull_requests.length > 0) {
          console.log(` Skipping '${workflow.name}' workflow run ${run.id} because PR is attached.`);
          continue;
        }

        if (check_branch_existence && existingBranchNames.includes(run.head_branch)) {
          console.log(` Skipping '${workflow.name}' workflow run ${run.id} because branch '${run.head_branch}' is still active.`);
          continue;
        }

        if (delete_run_by_conclusion_pattern && !delete_run_by_conclusion_pattern.includes(run.conclusion)) {
          core.debug(`  Skipping '${workflow.name}' workflow run ${run.id} because conclusion was ${run.conclusion}`);
          continue;
        }
        const created_at = new Date(run.created_at);
        const current = new Date();
        const ELAPSE_ms = current.getTime() - created_at.getTime();
        const ELAPSE_days = ELAPSE_ms / (1000 * 3600 * 24);
        if (ELAPSE_days >= retain_days) {
          let branchName = minimum_run_is_branch_specific ? run.head_branch || 'ALL_BRANCHES' : 'ALL_BRANCHES';
          core.debug(`  Added to del list (${branchName}): '${workflow.name}' workflow run ${run.id}`);
          let targetList = del_runs[branchName] ||= [];
          targetList.push(run);
        } else {
          console.log(`👻 Skipped '${workflow.name}' workflow run ${run.id}: created at ${run.created_at} because ${ELAPSE_days.toFixed(2)}d < ${retain_days}d`);
        }
      }
      core.debug(`Delete list for '${workflow.name}' is ${del_runs.length} items`);
      for(let [branchName, wf_runs] of Object.entries(del_runs)){
        wf_runs = wf_runs.sort((a, b) => { return a.id - b.id; });

        if (keep_minimum_runs !== 0 && wf_runs.length > keep_minimum_runs) {
          Skip_runs = wf_runs.slice(-keep_minimum_runs);
          wf_runs = wf_runs.slice(0, -keep_minimum_runs);
          for (const Skipped of Skip_runs) {
            console.log(`👻 Skipped '${workflow.name}' workflow run ${Skipped.id}: created at ${Skipped.created_at} because of keep_minimum_runs=${keep_minimum_runs}`);
          }
        }
        console.log(`💬 Deleting ${wf_runs.length} runs for '${workflow.name}' workflow on '${branchName}'`);
        for (const del of wf_runs) {
          core.debug(`Deleting '${workflow.name}' workflow run ${del.id}`);
          // Execute the API "Delete a workflow run", see 'https://octokit.github.io/rest.js/v18#actions-delete-workflow-run'

          if (dry_run) {
            console.log(`[dry-run] 🚀 Delete run ${del.id} of '${workflow.name}' workflow`);
            continue;
          }

          await octokit.actions.deleteWorkflowRun({
            owner: repo_owner,
            repo: repo_name,
            run_id: del.id
          });

          console.log(`🚀 Delete run ${del.id} of '${workflow.name}' workflow`);
        }
        console.log(`✅ ${wf_runs.length} runs of '${workflow.name}' workflow deleted.`);
      }
    }
  }
  catch (error) {
    core.setFailed(error.message);
  }
}

run();
