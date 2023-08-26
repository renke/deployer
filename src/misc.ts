import * as core from "@actions/core";
import * as github from "@actions/github";
import { BranchName } from "./model.js";

const getOctokit = () => {
  const token = (() => {
    const token = core.getInput("github-token");

    if (token === "") {
      return process.env.GITHUB_TOKEN;
    }

    return token;
  })();

  if (token === undefined) {
    core.setFailed("No GitHub token found.");

    process.exit(1);
  }

  return github.getOctokit(token);
};

export const repo = github.context.repo.repo;
export const owner = github.context.repo.owner;

export const octokit = getOctokit();

export const checkBranchExists = async (
  branchName: BranchName
): Promise<boolean> => {
  try {
    const getRefResponse = await octokit.rest.git.getRef({
      owner,
      repo,
      ref: `heads/${branchName}`,
    });

    if (getRefResponse.status === 200) {
      return true;
    }

    return false;
  } catch (error) {
    return false;
  }
};

export const checkIsDefined = <VALUE>(
  v: VALUE | undefined | null
): v is VALUE extends undefined | null ? never : VALUE => {
  return !!v;
};

import { z } from "zod";

export const zodCreate = <SCHEMA extends z.ZodTypeAny>(
  schema: SCHEMA,
  value: z.input<SCHEMA>
): z.output<typeof schema> => {
  return schema.parse(value);
};
