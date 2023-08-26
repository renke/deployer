import * as core from "@actions/core";
import { execSync } from "node:child_process";
import * as os from "node:os";
import z from "zod";

import { RequestError } from "@octokit/request-error";
import { groupBy } from "lodash-es";
import { BuildStatus, changeDb } from "../db/deployerDb.js";
import { DeployRun, fetchFinishedDeployRuns } from "../deployRuns.js";
import { checkIsDefined, octokit, owner, repo } from "../misc.js";
import { BranchName, CommitRef, StageName } from "../model.js";
import { ControllerInput } from "./ControllerInput.js";

export const controlCommits = async (input: ControllerInput) => {
  core.info(`Control commits`);

  try {
    const buildRuns = await fetchBuildRuns({ branchName: input.branchName });

    const buildRunsByCommitRef = new Map<CommitRef, BuildRun>();

    for (const buildRun of buildRuns) {
      buildRunsByCommitRef.set(buildRun.commitRef, buildRun);
    }

    const buildRunsCommitRefs = Array.from(buildRunsByCommitRef.keys());

    const deployRuns = await fetchFinishedDeployRuns({
      branchName: input.branchName,
    });

    const deployRunsSortedByFinishedAt = deployRuns.sort((a, b) => {
      return (
        new Date(b.finishedAt).getTime() - new Date(a.finishedAt).getTime()
      );
    });

    const deployRunsSortedByFinishedAtAndGroupedByStageName = groupBy(
      deployRunsSortedByFinishedAt,
      (deployRun) => {
        return deployRun.stageName;
      }
    );

    const deployRunsByCommitRef = new Map<CommitRef, DeployRun>();

    for (const deployRun of deployRuns) {
      deployRunsByCommitRef.set(deployRun.commitRef, deployRun);
    }

    const deployRunsCommitRefs = Array.from(deployRunsByCommitRef.keys());

    await changeDb((oldDb) => {
      const commitRefs = new Set([
        ...oldDb.commits,
        ...buildRunsCommitRefs,
        ...deployRunsCommitRefs,
      ]);

      if (commitRefs.size === 0) {
        return;
      }

      // TODO: This might be a problem when too many commits are passed to git. Read from stdin?
      const command = `git rev-list --topo-order --no-walk ${Array.from(
        commitRefs
      ).join(" ")}`;

      const sortedCommitRefs = execSync(command)
        .toString("ascii")
        .trim()
        .split(os.EOL)
        .map((line) => {
          return CommitRef.parse(line.trim());
        });

      oldDb.commits = sortedCommitRefs;

      for (const buildRunCommitRef of buildRunsCommitRefs) {
        const buildRun = buildRunsByCommitRef.get(buildRunCommitRef)!;

        oldDb.commitByRef[buildRunCommitRef] = {
          deployStatus: {},

          ...(oldDb.commitByRef[buildRunCommitRef] ?? {}),

          buildStatus: buildRun.buildStatus,
        };
      }

      for (const deployRunCommitRef of deployRunsCommitRefs) {
        const deployRun = deployRunsByCommitRef.get(deployRunCommitRef)!;

        oldDb.commitByRef[deployRunCommitRef] = {
          ...oldDb.commitByRef[deployRunCommitRef],

          deployStatus: {
            [deployRun.stageName]: deployRun.deployStatus,
          },
        };
      }

      for (const [rawStageName, deployRuns] of Object.entries(
        deployRunsSortedByFinishedAtAndGroupedByStageName
      )) {
        const latestDeployRun = deployRuns[0];

        if (latestDeployRun === undefined) {
          continue;
        }

        const stageName = StageName.parse(rawStageName);

        oldDb.stageByName[stageName] = {
          ...oldDb.stageByName[stageName],

          current: latestDeployRun.commitRef,

          // TODO: Augment history / previous runs
        };
      }
    });
  } catch (error) {
    if (error instanceof RequestError) {
      if (error.status === 404) {
        // TODO
      }
    }

    throw error;
  }
};

// TODO: Only include latest run for a given commit?
const fetchBuildRuns = async (input: {
  branchName: BranchName;
}): Promise<BuildRun[]> => {
  try {
    const buildRunsRes = await octokit.rest.actions.listWorkflowRuns({
      owner,
      repo,
      workflow_id: "build.yaml",
      branch: input.branchName,
    });

    const buildRuns = buildRunsRes.data.workflow_runs
      .map((run) => {
        const buildStatusRes = BuildStatus.safeParse(run.conclusion);

        if (!buildStatusRes.success) {
          return;
        }

        const buildRun = BuildRun.parse({
          commitRef: run.head_sha,
          // TODO: Validate that this is a valid conclusion
          buildStatus: buildStatusRes.data,
        });

        return buildRun;
      })
      .filter(checkIsDefined);

    return buildRuns;
  } catch (error) {
    if (error instanceof RequestError) {
      throw error;
    }

    throw error;
  }
};

const BuildRun = z
  .object({
    commitRef: CommitRef,
    buildStatus: BuildStatus,
  })
  .brand("BuildRun");

type BuildRun = z.infer<typeof BuildRun>;
