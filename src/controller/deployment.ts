import * as core from "@actions/core";
import { getDeploymentConfig } from "../config/deploymentConfig.js";
import {
  getCommitBuildStatus,
  getCommitDeployStatus,
  getDeployedCommitRef,
} from "../db/deployerDb.js";
import { octokit, owner, repo } from "../misc.js";
import { BranchName, CommitRef, StageName } from "../model.js";
import { parseStageNameFromWorkflowName } from "../workflow.js";
import { ControllerInput } from "./ControllerInput.js";

export const controlDeployment = async (input: ControllerInput) => {
  core.info(`## Control deployment`);

  const deploymentConfig = await getDeploymentConfig();

  if (deploymentConfig === undefined) {
    core.warning("No deployment config found. Doing nothing.");

    // TODO: Undeploy all stages?
    return;
  }

  const { deployments } = deploymentConfig;

  // TODO
  const stageName = StageName.parse("dev");

  const rawTargetCommitRef = deployments[stageName];

  if (!rawTargetCommitRef) {
    // TODO: Undeploy DEV stage
    core.warning(
      `No commit ref found for stage "${stageName}". Doing nothing.`
    );

    return;
  }

  const targetCommitRef = CommitRef.parse(rawTargetCommitRef);

  // TODO: Check if any commit is deployed but not mentioned in deployment config and undeploy them

  if (await checkIfCommitIsNotMarkedAsBuildPassed(targetCommitRef, stageName)) {
    core.info(
      `Commit "${targetCommitRef}" is not marked as build passed and cannot be deployed. Doing nothing.`
    );

    return;
  }

  if (await checkIfCommitIsDeployedAndIsSuccess(targetCommitRef, stageName)) {
    core.info(
      `Commit "${targetCommitRef}" is already deployed on stage "${stageName}". Doing nothing.`
    );

    return;
  }

  if (
    await checkIfDeploymentIsInProgress({
      commitRef: targetCommitRef,
      stageName,
      branchName: input.branchName,
    })
  ) {
    core.info(
      `Another deployment is already in progress on stage "${stageName}". Doing nothing.`
    );

    return;
  }

  if (await checkIfCommitIsDeployedAndIsFailure(targetCommitRef, stageName)) {
    core.info(
      `Commit "${targetCommitRef}" is already deployed on stage "${stageName} but failed. Doing nothing.`
    );

    return;
  }

  if (await checkIfCommitDeploymentIsFailure(targetCommitRef, stageName)) {
    core.info(
      `Commit "${targetCommitRef}" cannot be deployed on stage "${stageName} because it failed previous deployment. Doing nothing.`
    );

    return;
  }

  core.info(
    `Starting deployment of commit "${targetCommitRef}" on stage "${stageName}"`
  );

  await octokit.rest.actions.createWorkflowDispatch({
    owner,
    repo,
    workflow_id: "deploy.yaml",
    ref: input.branchName,
    inputs: {
      stage: stageName,
      commit: targetCommitRef,
    },
  });

  return;
};

async function checkIfCommitIsNotMarkedAsBuildPassed(
  commitRef: CommitRef,
  stageName: StageName
): Promise<boolean> {
  const status = await getCommitBuildStatus(commitRef, stageName);

  if (status === "success") {
    return false;
  }

  return true;
}

async function checkIfCommitIsDeployedAndIsSuccess(
  commitRef: CommitRef,
  stageName: StageName
): Promise<boolean> {
  core.info(
    `Check if commit "${commitRef}" is deployed on stage "${stageName}"`
  );

  const deployedCommitRef = await getDeployedCommitRef(stageName);

  core.info(`Deployed commit ref "${deployedCommitRef}"`);

  if (deployedCommitRef !== commitRef) {
    return false;
  }

  const deploymentStatus = await getCommitDeployStatus(commitRef, stageName);

  return deploymentStatus === "success";
}

async function checkIfDeploymentIsInProgress(input: {
  commitRef: CommitRef;
  stageName: StageName;
  branchName: BranchName;
}): Promise<boolean> {
  // TODO: We could probably cache this since we already fetch all runs somewhere else
  const deployRunsRes = await octokit.rest.actions.listWorkflowRuns({
    owner,
    repo,
    // TODO: Make this configurable
    workflow_id: "deploy.yaml",
    // TODO: Make this configurable
    branch: input.branchName,
  });

  const deployInProgressOrQueued = deployRunsRes.data.workflow_runs.some(
    (run) => {
      const runStageName = parseStageNameFromWorkflowName(run.name ?? "");

      if (runStageName === undefined) {
        // TODO: Extract and reuse
        core.warning(
          `Could not parse stage name from deploy workflow name "${run.name}". This usually means the deploy action is not configured correctly to work with deployer.`
        );

        return false;
      }

      if (runStageName !== input.stageName) {
        return false;
      }

      // TODO: Check if this is the correct status
      const inProgressStatus = [
        "in_progress",
        "queued",
        "pending",
        "waiting",
        "requested",
      ];

      if (run.status === null) {
        return false;
      }

      return inProgressStatus.includes(run.status);
    }
  );

  return deployInProgressOrQueued;
}

async function checkIfCommitDeploymentIsFailure(
  commitRef: CommitRef,
  stageName: StageName
): Promise<boolean> {
  // TODO
  return false;
}

async function checkIfCommitIsDeployedAndIsFailure(
  commitRef: CommitRef,
  stageName: StageName
): Promise<boolean> {
  // TODO
  return false;
}
