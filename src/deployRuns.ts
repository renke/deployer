import * as core from "@actions/core";

import { z } from "zod";

import { BranchName, CommitRef, StageName } from "./model.js";
import {
  parseCommitRefFromMessage,
  parseStageNameFromWorkflowName,
} from "./workflow.js";
import { DeployStatus } from "./db/deployerDb.js";
import { octokit, owner, repo, zodCreate, checkIsDefined } from "./misc.js";

export const DeployRun = z
  .object({
    commitRef: CommitRef,
    stageName: StageName,
    deployStatus: DeployStatus,

    startedAt: z.string(),
    finishedAt: z.string(),
  })
  .brand("DeployRun");

export type DeployRun = z.infer<typeof DeployRun>;

// TODO: Only include latest run for a given commit?
export const fetchFinishedDeployRuns = async (input: {
  branchName: BranchName;
}): Promise<DeployRun[]> => {
  try {
    const deployRunsRes = await octokit.rest.actions.listWorkflowRuns({
      owner,
      repo,
      // TODO: Make this configurable
      workflow_id: "deploy.yaml",
      // TODO: Make this configurable
      branch: input.branchName,
    });

    const deployRuns = deployRunsRes.data.workflow_runs
      .map((run) => {
        const deployStatus = DeployStatus.safeParse(run.conclusion);

        if (!deployStatus.success) {
          return;
        }

        const stageName = parseStageNameFromWorkflowName(run.name ?? "");

        if (stageName === undefined) {
          core.warning(
            `Could not parse stage name from deploy workflow name "${run.name}". This usually means the deploy action is not configured correctly to work with deployer.`
          );

          return;
        }

        const commitRef = parseCommitRefFromMessage(run.name ?? "");

        if (commitRef === undefined) {
          core.warning(
            `Could not parse commit ref from deploy workflow name "${run.name}". This usually means the deploy action is not configured correctly to work with deployer.`
          );

          return;
        }

        const deployRun = zodCreate(DeployRun, {
          commitRef: CommitRef.parse(run.head_sha),

          stageName,

          deployStatus: deployStatus.data,

          startedAt: run.created_at,

          finishedAt: run.updated_at,
        });

        return deployRun;
      })
      .filter(checkIsDefined);

    return deployRuns;
  } catch (error) {
    throw error;
  }
};
