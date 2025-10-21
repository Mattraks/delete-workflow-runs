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
  const normalized = String(input ?? "false")
    .trim()
    .toLowerCase();
  return !falsyValues.includes(normalized);
};
/**
 * Split a comma-separated pattern into trimmed items.
 * If pattern is empty/undefined returns an empty array.
 * @param {string|undefined} pattern
 * @returns {string[]}
 */
const splitPattern = (pattern) =>
  (pattern ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
/**
 * Bulk-delete runs using Octokit. Uses Promise.allSettled so failures don"t abort the whole batch.
 * @param {Array} runs
 * @param {string} context
 * @param {boolean} dryRun
 * @param {Octokit} octokit
 * @param {string} owner
 * @param {string} repo
 */
async function deleteRuns(runs, context, dryRun, octokit, owner, repo) {
  if (!runs || runs.length === 0) {
    core.debug(`[${context}] No runs to delete.`);
    return;
  }
  const tasks = runs.map((run) => async () => {
    if (dryRun) {
      core.info(`[dry-run] Simulate deletion: Run ${run.id} (${context})`);
      return { status: "skipped", runId: run.id };
    }
    try {
      await octokit.actions.deleteWorkflowRun({ owner, repo, run_id: run.id });
      core.info(`🚀 Successfully deleted: Run ${run.id} (${context})`);
      return { status: "deleted", runId: run.id };
    } catch (err) {
      core.error(
        `❌ Failed to delete: Run ${run.id} (${context}) - ${err.message}`,
      );
      return { status: "failed", runId: run.id, error: err };
    }
  });
  // Execute in parallel. Throttling plugin handles rate limiting; allSettled ensures we continue on errors.
  const results = await Promise.allSettled(tasks.map((t) => t()));
  const summary = results.reduce(
    (acc, res) => {
      if (res.status === "fulfilled") {
        const r = res.value;
        if (r && r.status === "deleted") acc.deleted += 1;
        else if (r && r.status === "skipped") acc.skipped += 1;
        else if (r && r.status === "failed") acc.failed += 1;
      } else {
        acc.failed += 1;
      }
      return acc;
    },
    { deleted: 0, skipped: 0, failed: 0 },
  );
  core.info(
    `🗑️ Deletion summary for ${context}: deleted=${summary.deleted}, skipped=${summary.skipped}, failed=${summary.failed}`,
  );
}
/**
 * Decide whether a run should be deleted according to the given options.
 * Logs a reason for skipping.
 * @param {Object} run
 * @param {Object} options
 * @returns {boolean}
 */
function shouldDeleteRun(run, options) {
  const {
    checkPullRequestExist,
    checkBranchExistence,
    branchNames,
    allowedConclusions,
    retainDays,
  } = options;
  // Only completed runs are considered.
  if (run.status !== "completed") {
    core.debug(`Skip: Run ${run.id} status=${run.status}`);
    return false;
  }
  // Skip runs attached to pull requests (if requested).
  if (
    checkPullRequestExist &&
    Array.isArray(run.pull_requests) &&
    run.pull_requests.length > 0
  ) {
    core.debug(`Skip: Run ${run.id} linked to PR(s)`);
    return false;
  }
  // Skip if branch still exists (if requested).
  const headBranch = run.head_branch ?? "";
  if (checkBranchExistence && headBranch && branchNames.includes(headBranch)) {
    core.debug(`Skip: Run ${run.id} branch ${headBranch} still exists`);
    return false;
  }
  // Conclusion filter (if provided). If allowedConclusions is empty, that means "ALL".
  if (Array.isArray(allowedConclusions) && allowedConclusions.length > 0) {
    if (!run.conclusion || !allowedConclusions.includes(run.conclusion)) {
      core.debug(
        `Skip: Run ${run.id} conclusion="${run.conclusion ?? "undefined"}" not in allowed list (${allowedConclusions.join(",")})`,
      );
      return false;
    }
  }
  // Age filter.
  const msPerDay = 24 * 60 * 60 * 1000;
  const elapsedDays =
    (Date.now() - new Date(run.created_at).getTime()) / msPerDay;
  if (elapsedDays < retainDays) {
    core.debug(
      `Skip: Run ${run.id} is ${elapsedDays.toFixed(1)} days old (needs >= ${retainDays} days)`,
    );
    return false;
  }
  // Passed all checks → delete.
  return true;
}
async function run() {
  try {
    // ---------------------- 1. Parse Input Parameters ----------------------
    const token = core.getInput("token");
    if (!token) throw new Error("Missing required input: token");
    const baseUrl = core.getInput("baseUrl") || undefined;
    const repositoryInput =
      core.getInput("repository") || process.env.GITHUB_REPOSITORY || "";
    const [repoOwner, repoName] = repositoryInput.split("/");
    if (!repoOwner || !repoName) {
      throw new Error(
        `Invalid repository format: "${repositoryInput}". Expected "owner/repo".`,
      );
    }
    const retainDays = Number(core.getInput("retain_days") || "30");
    const keepMinimumRuns = Number(core.getInput("keep_minimum_runs") || "6");
    const deleteWorkflowPattern =
      core.getInput("delete_workflow_pattern") || "";
    const deleteWorkflowByStatePattern =
      core.getInput("delete_workflow_by_state_pattern") || "ALL";
    const deleteRunByConclusionPattern =
      core.getInput("delete_run_by_conclusion_pattern") || "ALL";
    // Booleans
    const dryRun = parseBoolean(core.getInput("dry_run"));
    const checkBranchExistence = parseBoolean(
      core.getInput("check_branch_existence"),
    );
    const checkPullRequestExist = parseBoolean(
      core.getInput("check_pullrequest_exist"),
    );
    // ---------------------- 2. Initialize Octokit Client ----------------------
    const MyOctokit = Octokit.plugin(throttling);
    const octokit = new MyOctokit({
      auth: token,
      baseUrl,
      throttle: {
        onRateLimit: (retryAfter, options) => {
          core.warning(
            `Rate limit hit for ${options.method} ${options.url}. retryAfter=${retryAfter}s`,
          );
          // let the plugin retry once for short waits
          return retryAfter < 5;
        },
        onSecondaryRateLimit: (retryAfter, options) => {
          core.warning(
            `Secondary rate limit for ${options.method} ${options.url}. retryAfter=${retryAfter}s`,
          );
          // Do not explicitly retry here; plugin will handle appropriate behavior.
        },
      },
    });
    // ---------------------- 3. Fetch Base Data in Bulk ----------------------
    core.info("Fetching workflows...");
    const workflows = await octokit.paginate(
      "GET /repos/:owner/:repo/actions/workflows",
      {
        owner: repoOwner,
        repo: repoName,
        per_page: 100,
      },
    );
    const workflowIds = workflows.map((w) => w.id);
    // Branches (if needed)
    let branchNames = [];
    if (checkBranchExistence) {
      core.info("Fetching branches for branch-existence checks...");
      branchNames = (
        await octokit.paginate("GET /repos/:owner/:repo/branches", {
          owner: repoOwner,
          repo: repoName,
          per_page: 100,
        })
      ).map((b) => b.name);
    }
    // ---------------------- 4. Handle Orphan Runs ----------------------
    core.info("Fetching all workflow runs (to find orphans)...");
    const allRuns = await octokit.paginate(
      "GET /repos/:owner/:repo/actions/runs",
      {
        owner: repoOwner,
        repo: repoName,
        per_page: 100,
      },
    );
    const orphanRuns = allRuns.filter(
      (run) => !workflowIds.includes(run.workflow_id),
    );
    if (orphanRuns.length > 0) {
      core.info(`Found ${orphanRuns.length} orphan runs (no linked workflow).`);
      await deleteRuns(
        orphanRuns,
        "orphan runs",
        dryRun,
        octokit,
        repoOwner,
        repoName,
      );
    } else {
      core.info("No orphan runs found.");
    }
    // ---------------------- 5. Filter Workflows to Process ----------------------
    let filteredWorkflows = workflows;
    if (deleteWorkflowPattern) {
      const patterns = deleteWorkflowPattern.split("|").map((p) => p.trim());
      if (patterns.length === 0) {
        core.info(
          "⚠️ No valid patterns provided. Skipping workflow filtering.",
        );
        return filteredWorkflows;
      }
      core.info(`💬 Filter workflows by patterns: ${patterns.join(", ")}`);
      filteredWorkflows = filteredWorkflows.filter(({ name, path }) => {
        const filename = path.replace(".github/workflows/", "");
        return patterns.some(
          (pattern) => name.includes(pattern) || filename.includes(pattern),
        );
      });
    }
    if ((deleteWorkflowByStatePattern || "").toUpperCase() !== "ALL") {
      const states = splitPattern(deleteWorkflowByStatePattern);
      core.info(`Filter workflows by state: ${states.join(", ")}`);
      filteredWorkflows = filteredWorkflows.filter(({ state }) =>
        states.includes(state),
      );
    }
    core.info(`Workflows to process: ${filteredWorkflows.length}`);
    // ---------------------- 6. Process Runs Per Workflow ----------------------
    const allowedConclusionsAll =
      (deleteRunByConclusionPattern || "ALL").toUpperCase() === "ALL";
    const allowedConclusions = allowedConclusionsAll
      ? []
      : splitPattern(deleteRunByConclusionPattern);
    for (const workflow of filteredWorkflows) {
      core.info(`Processing workflow: ${workflow.name} (ID: ${workflow.id})`);
      const runs = await octokit.paginate(
        "GET /repos/:owner/:repo/actions/workflows/:workflow_id/runs",
        {
          owner: repoOwner,
          repo: repoName,
          workflow_id: workflow.id,
          per_page: 100,
        },
      );
      // Single-pass filter to determine candidates for deletion.
      const candidates = [];
      for (const run of runs) {
        if (
          shouldDeleteRun(run, {
            checkPullRequestExist,
            checkBranchExistence,
            branchNames,
            allowedConclusions,
            retainDays,
          })
        ) {
          candidates.push(run);
        }
      }
      // Sort oldest first.
      candidates.sort(
        (a, b) =>
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
      );
      // Keep the latest N runs (retain).
      const runsToRetain =
        keepMinimumRuns > 0 ? candidates.slice(-keepMinimumRuns) : [];
      const runsToDeleteFinal =
        keepMinimumRuns > 0
          ? candidates.slice(
              0,
              Math.max(0, candidates.length - keepMinimumRuns),
            )
          : candidates;
      if (runsToRetain.length > 0) {
        core.info(
          `Retaining latest ${runsToRetain.length} runs: ${runsToRetain.map((r) => r.id).join(", ")}`,
        );
      }
      if (runsToDeleteFinal.length > 0) {
        core.info(
          `About to delete ${runsToDeleteFinal.length} runs for workflow "${workflow.name}".`,
        );
        await deleteRuns(
          runsToDeleteFinal,
          workflow.name,
          dryRun,
          octokit,
          repoOwner,
          repoName,
        );
      } else {
        core.info(`No runs to delete for workflow "${workflow.name}".`);
      }
    }
    core.info("All cleanup tasks completed.");
  } catch (error) {
    core.setFailed(
      `Cleanup failed: ${error && error.message ? error.message : String(error)}`,
    );
  }
}
// Start the script.
run();
