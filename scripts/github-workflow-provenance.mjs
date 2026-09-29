function reject(fail, message) {
  if (fail) {
    fail(message);
  }
  throw new Error(message);
}

function positiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

export function requireWorkflow(workflow, { name, path, fail }) {
  if (
    !workflow ||
    !positiveInteger(workflow.id) ||
    workflow.name !== name ||
    workflow.path !== path ||
    workflow.state !== 'active'
  ) {
    reject(fail, `The ${name} workflow identity is missing or inactive.`);
  }
  return workflow;
}

export function requireSuccessfulWorkflowRun(
  run,
  { id, attempt, workflow, repository, event, headBranch = 'main', sourceSha, fail },
) {
  if (
    !run ||
    run.id !== id ||
    run.run_attempt !== attempt ||
    run.name !== workflow.name ||
    run.workflow_id !== workflow.id ||
    (sourceSha !== undefined && run.head_sha !== sourceSha) ||
    run.head_branch !== headBranch ||
    run.event !== event ||
    run.status !== 'completed' ||
    run.conclusion !== 'success' ||
    run.head_repository?.full_name !== repository
  ) {
    reject(fail, `The exact successful ${workflow.name} run does not match the required source SHA, ref, and attempt.`);
  }
  return run;
}

export function assertSourceReachableFromMain({ sourceSha, execFileSyncImpl, fail, description = 'Source SHA' }) {
  execFileSyncImpl('git', ['fetch', '--no-tags', 'origin', 'main:refs/remotes/origin/main'], {
    stdio: 'ignore',
  });
  try {
    execFileSyncImpl('git', ['merge-base', '--is-ancestor', sourceSha, 'refs/remotes/origin/main'], {
      stdio: 'ignore',
    });
  } catch (error) {
    if (error.status === 1) {
      reject(fail, `${description} ${sourceSha} is no longer reachable from pitaka-web/main; review it manually.`);
    }
    throw error;
  }
}
