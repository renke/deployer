import { checkBranchExists, octokit, owner, repo } from "../misc.js";
import immer from "immer";
import z from "zod";
import { CommitRef, BranchName, StageName } from "../model.js";

export const DeployStatus = z
  .enum(["success", "failure"])
  .brand("DeploymentStatus");

export type DeployStatus = z.infer<typeof DeployStatus>;

export const BuildStatus = z.enum(["success", "failure"]).brand("BuildStatus");

export type BuildStatus = z.infer<typeof BuildStatus>;

interface CommitEntry {
  buildStatus?: BuildStatus | undefined;
  deployStatus: Record<StageName, DeployStatus>;
}

interface StageEntry {
  current: CommitRef;
}

interface DeployerDb {
  stageByName: Record<StageName, StageEntry>;

  commitByRef: Record<CommitRef, CommitEntry>;

  commits: CommitRef[];
}

// TODO: Add a variant that caches stuff?
export const loadDb = async (): Promise<DeployerDb | undefined> => {
  return (await loadDbAndSha())?.[0];
};

const loadDbAndSha = async (): Promise<[DeployerDb, string] | undefined> => {
  try {
    const getContentRes = await octokit.rest.repos.getContent({
      owner,
      repo,
      path: "deployer-db.json",
      ref: "deployer/db",
    });

    if ("content" in getContentRes.data) {
      const decodedDb = Buffer.from(
        getContentRes.data.content,
        "base64"
      ).toString("utf-8");

      const db = JSON.parse(decodedDb);

      return [db, getContentRes.data.sha];
    }

    return undefined;
  } catch (error: any) {
    if ("status" in error && error.status === 404) {
      return undefined;
    }

    throw error;
  }
};

const EMPTY_DB: DeployerDb = { commitByRef: {}, stageByName: {}, commits: [] };

export const changeDb = async (
  change: (oldDb: DeployerDb) => void
): Promise<void> => {
  const [oldDb, sha] = (await loadDbAndSha()) ?? [EMPTY_DB, undefined];

  const newDb = immer(change)(oldDb);

  if (!(await checkBranchExists(BranchName.parse("deployer/db")))) {
    await createEmptyBranch("deployer/db");
  }

  const createOrUpdateFileContentsRes =
    await octokit.rest.repos.createOrUpdateFileContents({
      owner,
      repo,
      path: "deployer-db.json",
      message: "Save deployer-db.json",
      content: Buffer.from(JSON.stringify(newDb, undefined, 2) + "\n").toString(
        "base64"
      ),
      branch: "deployer/db",
      sha,
      committer: {
        name: "github-actions[bot]",
        email: "github-actions[bot]@users.noreply.github.com",
      },
    });

  const message = createOrUpdateFileContentsRes.data.commit.message;
  const tree = createOrUpdateFileContentsRes.data.commit.tree?.sha;

  if (message === undefined || tree === undefined) {
    throw new Error("Failed to create commit.");
  }

  const createCommitRes = await octokit.rest.git.createCommit({
    owner,
    repo,
    message,
    tree,
    parents: [],
  });

  await octokit.rest.git.updateRef({
    owner,
    repo,
    ref: "heads/deployer/db",
    sha: createCommitRes.data.sha,
    force: true,
  });
};

const createEmptyBranch = async (branchName: string) => {
  const { data: newCommit } = await octokit.rest.git.createCommit({
    owner,
    repo,
    message: "Save deployer-db.json",
    tree: "4b825dc642cb6eb9a060e54bf8d69288fbee4904",
  });

  await octokit.rest.git.createRef({
    owner,
    repo,
    ref: `refs/heads/${branchName}`,
    sha: newCommit.sha,
  });
};

export const setCommitDeploymentStatus = async (
  commitRef: CommitRef,
  stageName: StageName,
  deploymentStatus: DeployStatus
): Promise<DeployStatus | undefined> => {
  await changeDb((oldDb) => {
    const commitEntry = oldDb.commitByRef[commitRef];

    if (commitEntry === undefined) {
      oldDb.commitByRef[commitRef] = {
        deployStatus: {
          [stageName]: deploymentStatus,
        },
      };
    } else {
      commitEntry.deployStatus[stageName] = deploymentStatus;
    }
  });

  return deploymentStatus;
};

export const getCommitDeploymentStatus = async (
  commitRef: CommitRef,
  stageName: StageName
): Promise<DeployStatus | undefined> => {
  const db = await loadDb();

  return db?.commitByRef[commitRef]?.deployStatus[stageName];
};

export const setCommitBuildStatus = async (
  commitRef: CommitRef,
  stageName: StageName,
  buildStatus: BuildStatus
): Promise<void> => {
  await changeDb((oldDb) => {
    const commitEntry = oldDb.commitByRef[commitRef];

    if (commitEntry === undefined) {
      oldDb.commitByRef[commitRef] = {
        buildStatus,

        deployStatus: {},
      };
    } else {
      commitEntry.buildStatus = buildStatus;
    }
  });
};

export const getCommitBuildStatus = async (
  commitRef: CommitRef,
  stageName: StageName
): Promise<BuildStatus | undefined> => {
  const db = await loadDb();

  return db?.commitByRef[commitRef]?.buildStatus;
};

export const getDeployedCommitRef = async (
  stageName: StageName
): Promise<CommitRef | undefined> => {
  const db = await loadDb();

  return db?.stageByName[stageName]?.current;
};

export const getCommits = async (): Promise<CommitRef[]> => {
  const db = await loadDb();

  return db?.commits ?? [];
};

export const setCommits = async (commits: CommitRef[]): Promise<void> => {
  await changeDb((oldDb) => {
    oldDb.commits = commits;
  });
};
