import * as core from "@actions/core";

import { ControllerInput } from "./ControllerInput.js";
import { loadDb } from "../db/deployerDb.js";
import {
  DEPLOYMENT_YAML_FILE_NAME,
  DeploymentConfigApi,
  getDeploymentConfig,
  getDeploymentConfigAndSha,
} from "../config/deploymentConfig.js";
import { checkBranchExists, octokit, owner, repo, retry } from "../misc.js";
import { CommitRef, BranchName, StageName } from "../model.js";

export const controlPullRequest = async (input: ControllerInput) => {
  core.info(`Control pull request`);

  const mostRecentDeployableCommitRef =
    await getMostRecentDeployableCommitRef();

  if (mostRecentDeployableCommitRef === undefined) {
    await deletePr({ branchName: input.branchName });

    return;
  }

  const deploymentConfig = await getDeploymentConfig();

  if (deploymentConfig === undefined) {
    return undefined;
  }

  core.info(`Current deployment config: "${JSON.stringify(deploymentConfig)}"`);

  if (
    DeploymentConfigApi.isDesiredCommitRefForStage(
      deploymentConfig,
      mostRecentDeployableCommitRef,
      // TODO
      StageName.parse("dev")
    )
  ) {
    await deletePr({ branchName: input.branchName });

    return;
  }

  await createOrUpdatePr({
    targetBranchName: input.branchName,
    targetCommitRef: input.commitRef,
    newDesiredCommitRef: mostRecentDeployableCommitRef,
  });
};

const createOrUpdatePr = async (input: {
  targetCommitRef: CommitRef;
  targetBranchName: BranchName;
  newDesiredCommitRef: CommitRef;
}) => {
  core.info(
    `Create PR with new desired commit ref "${input.newDesiredCommitRef}"`
  );

  await createOrResetBranch({
    targetBranchName: input.targetBranchName,
  });

  retry(
    async () => {
      await createDeploymentConfigCommit({
        targetCommitRef: input.targetCommitRef,
        targetBranchName: input.targetBranchName,
        newDesiredCommitRef: input.newDesiredCommitRef,
      });
    },
    5,
    (error, attempt) => {
      console.log(
        `Failed to create deployment config commit on attempt #${attempt}`
      );

      if (error && typeof error === "object" && "status" in error) {
        if (error.status === 409) {
          return false;
        }
      }

      // Stop retrying
      return true;
    }
  );

  const prNumber = await findPrNumber({
    targetBranchName: input.targetBranchName,
  });

  if (prNumber !== undefined) {
    core.info(`PR already exists: #${prNumber}`);

    return;
  }

  core.info(`Create PR`);

  const createPullRequestResponse = await octokit.rest.pulls.create({
    owner,
    repo,
    title: `Update deployment config for "dev" stage`,
    head: buildPrBranchName(),
    base: input.targetBranchName,
    body: `Update deployment config for "dev" stage`,
  });
};

const createDeploymentConfigCommit = async (input: {
  targetCommitRef: CommitRef;
  targetBranchName: BranchName;
  newDesiredCommitRef: CommitRef;
}) => {
  core.info(
    `Update deployment config with new desired commit ref "${input.newDesiredCommitRef}"`
  );
  const deploymentConfigAndShaRes = await getDeploymentConfigAndSha({
    branchName: buildPrBranchName(),
  });

  if (deploymentConfigAndShaRes === undefined) {
    throw new Error("No deployment config found.");
  }

  const [deploymentConfig, deploymentConfigSha] = deploymentConfigAndShaRes;

  const newDeploymentConfig = DeploymentConfigApi.setDesiredCommitRefForStage(
    deploymentConfig,
    input.newDesiredCommitRef,
    // TODO
    StageName.parse("dev")
  );

  console.log("EXPECTED SHA", deploymentConfigSha);

  const createCommitResponse =
    await octokit.rest.repos.createOrUpdateFileContents({
      owner,
      repo,
      path: DEPLOYMENT_YAML_FILE_NAME,
      message: "Update deployments.dev",
      content: Buffer.from(
        JSON.stringify(newDeploymentConfig, undefined, 2) + "\n"
      ).toString("base64"),
      branch: buildPrBranchName(),
      sha: deploymentConfigSha,
      committer: {
        name: "github-actions[bot]",
        email: "github-actions[bot]@users.noreply.github.com",
      },
    });
};

type PullRequestNumber = number;

const findPrNumber = async (input: {
  targetBranchName: BranchName;
}): Promise<PullRequestNumber | undefined> => {
  const searchPrsRes = await octokit.rest.search.issuesAndPullRequests({
    q: `repo:${owner}/${repo}+head:${buildPrBranchName()}+base:${
      input.targetBranchName
    }+is:pr+is:open`,
  });

  if (searchPrsRes.data.total_count === 0) {
    return undefined;
  }

  return searchPrsRes.data.items[0]?.number;
};

const checkPrExists = async (input: {
  targetBranchName: BranchName;
}): Promise<boolean> => {
  const prNumber = await findPrNumber({
    targetBranchName: input.targetBranchName,
  });

  if (prNumber === undefined) {
    return false;
  }

  return true;
};

const createOrResetBranch = async (input: { targetBranchName: BranchName }) => {
  core.info(`Create or reset branch "${buildPrBranchName()}"`);

  const getBranchRes = await octokit.rest.repos.getBranch({
    owner,
    repo,
    branch: input.targetBranchName,
  });

  const targetBranchCommitRef = getBranchRes.data.commit.sha;

  if (await checkPrBranchExists()) {
    core.info(`Branch "${buildPrBranchName()}" exists`);

    const updateRefResponse = await octokit.rest.git.updateRef({
      owner,
      repo,
      ref: `heads/${buildPrBranchName()}`,
      sha: targetBranchCommitRef,
      force: true,
    });
  } else {
    core.info(`Branch "${buildPrBranchName()}" does not exist`);

    const createRefResponse = await octokit.rest.git.createRef({
      owner,
      repo,
      ref: `refs/heads/${buildPrBranchName()}`,
      sha: targetBranchCommitRef,
    });
  }
};

const checkPrBranchExists = async (): Promise<boolean> => {
  return await checkBranchExists(buildPrBranchName());
};

const buildPrBranchName = (): BranchName => {
  return BranchName.parse("deployer/pr/dev");
};

const deletePr = async (input: { branchName: BranchName }) => {
  core.info("Delete PR");

  await deleteBranch();

  const prNumber = await findPrNumber({
    targetBranchName: input.branchName,
  });

  if (prNumber === undefined) {
    return;
  }

  const deletePrResponse = await octokit.rest.pulls.update({
    owner,
    repo,
    pull_number: prNumber,
    state: "closed",
  });
};

const deleteBranch = async () => {
  if (await checkPrBranchExists()) {
    const deleteRefRes = await octokit.rest.git.deleteRef({
      owner,
      repo,
      ref: `heads/${buildPrBranchName()}`,
    });
  }
};

const getMostRecentDeployableCommitRef = async (): Promise<
  CommitRef | undefined
> => {
  const db = await loadDb();

  if (db === undefined) {
    return undefined;
  }

  const commitRefs = db.commits.filter((commitRef) => {
    const commitEntry = db.commitByRef[commitRef];

    if (commitEntry === undefined) {
      return false;
    }

    const buildStatus = commitEntry.buildStatus;

    return buildStatus === "success";
  });

  for (const commitRef of commitRefs) {
    const getCommitRes = await octokit.rest.repos.getCommit({
      owner,
      repo,
      ref: commitRef,
    });

    const commit = getCommitRes.data;

    const checkOnlyDeploymentConfigFileChanged = () => {
      if (commit.files === undefined) {
        return false;
      }

      if (commit.files.length !== 1) {
        return false;
      }

      return commit.files[0]?.filename === DEPLOYMENT_YAML_FILE_NAME;
    };

    if (checkOnlyDeploymentConfigFileChanged()) {
      continue;
    }

    core.info(`Most recent deployable commit ref: "${commitRef}"`);

    return commitRef;
  }

  return undefined;
};
