"use strict";
const core = require("@actions/core");
const { Octokit } = require("@octokit/rest");
const { throttling } = require("@octokit/plugin-throttling");
/**
 * Convert input string to boolean.
 * - Treats empty / undefined input as false.
 * - Returns true for values not in the falsyValues list.
 * @param {string|undefined} input
 * @param {string[]} falsyValues
 * @returns {boolean}
 */
const parseBoolean = (input, falsyValues = ["0", "no", "n", "false"]) => {
  /* prettier-ignore */
  const normalized = String(input ?? "false").trim().toLowerCase();
  return !falsyValues.includes(normalized);
};
/**
 * Split a comma-separated pattern into trimmed items.
 * If pattern is empty/undefined returns an empty array.
 * @param {string|undefined} pattern
 * @returns {string[]}
 */
/* prettier-ignore */
const splitPattern = pattern => (pattern ?? "").split(/[,|]/).map(s => s.trim()).filter(Boolean);
/**
 * Bulk-delete runs using Octokit. Uses Promise.allSettled so failures don't abort the whole batch.
 * @param {Array} runs
 * @param {string} context
 * @param {boolean} dryRun
 * @param {Octokit} octokit
 * @param {string} owner
 * @param {string} repo
 */
async function deleteRuns(runs, context, dryRun, octokit, owner, repo) {
  if (!runs?.length) {
    core.debug(`[${context}] No runs to delete.`);
    return;
  }
  const tasks = runs.map((run) => async () => {
    if (dryRun) {
      core.info(`[dry-run] 🚀 Simulate deletion: Run ${run.id} (${context})`);
      return { status: "skipped", runId: run.id };
    }
    try {
      await octokit.rest.actions.deleteWorkflowRun({ owner, repo, run_id: run.id });
      core.info(`✅ Successfully deleted: Run ${run.id} (${context})`);
      return { status: "deleted", runId: run.id };
    } catch (err) {
      core.error(`❌ Failed to delete: Run ${run.id} (${context}) - ${err.message}`);
      return { status: "failed", runId: run.id, error: err };
    }
  });
  const results = await Promise.allSettled(tasks.map((t) => t()));
  const summary = results.reduce(
    (acc, res) => {
      const status = res.status === "fulfilled" ? res.value?.status : null;
      switch (status) {
        case "deleted": acc.deleted++; break;
        case "skipped": acc.skipped++; break;
        case "failed": acc.failed++; break;
        default: acc.failed++;
      }
      return acc;
    },
    { deleted: 0, skipped: 0, failed: 0 },
  );
  core.info(`🗑️ Deletion summary for ${context}: deleted=${summary.deleted}, skipped=${summary.skipped}, failed=${summary.failed}`);
}
/**
 * Decide whether a run should be deleted according to the given options.
 * Logs a reason for skipping.
 * @param {Object} run
 * @param {Object} options
 * @returns {boolean}
 */
function shouldDeleteRun(run, options) {
  const { checkPullRequestExist, checkBranchExistence, branchNames, allowedConclusions, retainDays } = options;
  // Only completed runs are considered.
  if (run.status !== "completed") {
    core.debug(`💬 Skip: Run ${run.id} status=${run.status}`);
    return false;
  }
  // Skip runs attached to pull requests (if requested).
  if (checkPullRequestExist && Array.isArray(run.pull_requests) && run.pull_requests.length > 0) {
    core.debug(`💬 Skip: Run ${run.id} linked to PR(s)`);
    return false;
  }
  // Skip if branch still exists
  const headBranch = run.head_branch ?? "";
  if (checkBranchExistence && headBranch && branchNames.includes(headBranch)) {
    core.debug(`💬 Skip: Run ${run.id} branch ${headBranch} still exists`);
    return false;
  }
  // Conclusion filter (if provided). If allowedConclusions is empty, that means "ALL".
  if (allowedConclusions.length > 0 && !allowedConclusions.includes(run.conclusion)) {
    core.debug(`💬 Skip: Run ${run.id} conclusion="${run.conclusion}" not allowed`);
    return false;
  }
  // Age filter
  const ageDays = (Date.now() - new Date(run.created_at).getTime()) / 86400000;
  if (ageDays < retainDays) {
    core.debug(`💬 Skip: Run ${run.id} is ${ageDays.toFixed(1)} days old (< ${retainDays} days)`);
    return false;
  }
  // All checks passed → delete
  return true;
}
/**
 * Group runs by date and filter runs to retain per day
 * @param {Array} runs
 * @param {number} keepMinimumRunsPerDay
 * @returns {Object} { runsToDelete: Array, runsToRetain: Array }
 */
function filterRunsByDailyRetention(runs, keepMinimumRunsPerDay) {
  if (keepMinimumRunsPerDay <= 0) {
    return { runsToDelete: runs, runsToRetain: [] };
  }
  // Group runs by date (YYYY-MM-DD)
  const runsByDate = {};
  runs.forEach(run => {
    const date = new Date(run.created_at).toISOString().split('T')[0]; // Get YYYY-MM-DD
    if (!runsByDate[date]) {
      runsByDate[date] = [];
    }
    runsByDate[date].push(run);
  });
  const runsToDelete = [];
  const runsToRetain = [];
  // For each date, keep the latest keepMinimumRunsPerDay runs
  Object.values(runsByDate).forEach(dateRuns => {
    // Sort by creation time (newest first)
    dateRuns.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    // Keep the latest N runs for this date
    const retainedRuns = dateRuns.slice(0, keepMinimumRunsPerDay);
    const deletedRuns = dateRuns.slice(keepMinimumRunsPerDay);
    runsToRetain.push(...retainedRuns);
    runsToDelete.push(...deletedRuns);
  });
  return { runsToDelete, runsToRetain };
}
async function run() {
  try {
    // ---------------------- 1. Parse Input Parameters ----------------------
    const token = core.getInput("token");
    const baseUrl = core.getInput("baseUrl");
    const repositoryInput = core.getInput("repository");
    const [repoOwner, repoName] = repositoryInput.split("/");
    if (!repoOwner || !repoName) {
      throw new Error(`Invalid repository: "${repositoryInput}". Use "owner/repo".`);
    }
    const retainDays = Number(core.getInput("retain_days") || "30");
    const keepMinimumRuns = Number(core.getInput("keep_minimum_runs") || "6");
    const useDailyRetention = parseBoolean(core.getInput("use_daily_retention"));
    const deleteWorkflowPattern = core.getInput("delete_workflow_pattern") || "";
    const deleteWorkflowByStatePattern = core.getInput("delete_workflow_by_state_pattern") || "ALL";
    const deleteRunByConclusionPattern = core.getInput("delete_run_by_conclusion_pattern") || "ALL";
    const dryRun = parseBoolean(core.getInput("dry_run"));
    const checkBranchExistence = parseBoolean(core.getInput("check_branch_existence"));
    const checkPullRequestExist = parseBoolean(core.getInput("check_pullrequest_exist"));
    // ---------------------- 2. Initialize Octokit Client ----------------------
    const MyOctokit = Octokit.plugin(throttling);
    const octokit = new MyOctokit({
      auth: token,
      baseUrl,
      throttle: {
        onRateLimit: (retryAfter, options) => {
          core.warning(`Rate limit: ${options.method} ${options.url} — wait ${retryAfter}s`);
          return retryAfter < 5;
        },
        onSecondaryRateLimit: (retryAfter, options) => {
          core.warning(`Secondary rate limit: ${options.method} ${options.url}`);
        },
      },
    });
    // ---------------------- 3. Fetch Workflows ----------------------
    const workflows = await octokit.paginate(octokit.rest.actions.listRepoWorkflows, {
      owner: repoOwner,
      repo: repoName,
      per_page: 100,
    });
    const workflowIds = workflows.map((w) => w.id);
    // ---------------------- 4. Fetch Branches (if needed) ----------------------
    let branchNames = [];
    if (checkBranchExistence) {
      branchNames = (
        await octokit.paginate(octokit.rest.repos.listBranches, {
          owner: repoOwner,
          repo: repoName,
          per_page: 100,
        })
      ).map((b) => b.name);
      core.info(`💬 Found ${branchNames.length} branches`);
    }
    // ---------------------- 5. Delete Orphan Runs ----------------------
    const allRuns = await octokit.paginate(octokit.rest.actions.listWorkflowRunsForRepo, {
      owner: repoOwner,
      repo: repoName,
      per_page: 100,
    });
    const orphanRuns = allRuns.filter((run) => !workflowIds.includes(run.workflow_id));
    if (orphanRuns.length > 0) {
      core.info(`👻 Found ${orphanRuns.length} orphan runs`);
      await deleteRuns(orphanRuns, "orphan runs", dryRun, octokit, repoOwner, repoName);
    }
    // ---------------------- 6. Filter Workflows ----------------------
    let filteredWorkflows = workflows;
    if (deleteWorkflowPattern) {
      const patterns = splitPattern(deleteWorkflowPattern);
      if (patterns.length > 0) {
        core.info(`🔍 Filtering by patterns: ${patterns.join(", ")}`);
        filteredWorkflows = filteredWorkflows.filter(({ name, path }) => {
          const filename = path.replace(/^\.github\/workflows\//, "");
          return patterns.some((p) => name.includes(p) || filename.includes(p));
        });
      }
    }
    if (deleteWorkflowByStatePattern.toUpperCase() !== "ALL") {
      const states = splitPattern(deleteWorkflowByStatePattern);
      core.info(`🔍 Filtering by state: ${states.join(", ")}`);
      filteredWorkflows = filteredWorkflows.filter(({ state }) => states.includes(state));
    }
    core.info(`Processing ${filteredWorkflows.length} workflow(s)`);
    // ---------------------- 7. Process Each Workflow ----------------------
    const allowedConclusionsAll = deleteRunByConclusionPattern.toUpperCase() === "ALL";
    const allowedConclusions = allowedConclusionsAll ? [] : splitPattern(deleteRunByConclusionPattern);
    for (const workflow of filteredWorkflows) {
      core.startGroup(`Processing: ${workflow.name} (ID: ${workflow.id})`);
      const runs = await octokit.paginate(octokit.rest.actions.listWorkflowRuns, {
        owner: repoOwner,
        repo: repoName,
        workflow_id: workflow.id,
        per_page: 100,
      });
      const candidates = runs.filter((run) =>
        shouldDeleteRun(run, {
          checkPullRequestExist,
          checkBranchExistence,
          branchNames,
          allowedConclusions,
          retainDays,
        }),
      );
      let runsToDelete = [];
      let runsToRetain = [];
      if (useDailyRetention) {
        // Use daily retention strategy
        const { runsToDelete: dailyRunsToDelete, runsToRetain: dailyRunsToRetain } = 
          filterRunsByDailyRetention(candidates, keepMinimumRuns);
        runsToDelete = dailyRunsToDelete;
        runsToRetain = dailyRunsToRetain;
        core.info(`📅 Daily retention: Keeping ${keepMinimumRuns} runs per day, retaining ${runsToRetain.length} runs total`);
      } else {
        // Use original strategy (keep latest N runs overall)
        candidates.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
        runsToRetain = keepMinimumRuns > 0 ? candidates.slice(-keepMinimumRuns) : [];
        runsToDelete = keepMinimumRuns > 0 ? candidates.slice(0, candidates.length - keepMinimumRuns) : candidates;
        if (runsToRetain.length > 0) {
          core.info(`🔄 Retaining latest ${runsToRetain.length} run(s)`);
        }
      }
      if (runsToDelete.length > 0) {
        core.info(`🚀 Deleting ${runsToDelete.length} run(s)`);
        await deleteRuns(runsToDelete, workflow.name, dryRun, octokit, repoOwner, repoName);
      } else {
        core.info("💬 No runs to delete");
      }
      core.endGroup();
    }
    core.info("✅ Cleanup completed successfully!");
  } catch (error) {
    core.setFailed(`❌ Action failed: ${error.message}`);
  }
}
// Start
run();
