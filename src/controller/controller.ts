import * as core from "@actions/core";
import { ControllerInput } from "./ControllerInput.js";
import { controlDeployment } from "./deployment.js";
import { controlPullRequest } from "./pullRequest.js";
import { controlCommits } from "./commits.js";

export const control = async (input: ControllerInput) => {
  core.info(
    `# Control started for branch "${input.branchName}" and commit "${input.commitRef}"`
  );

  try {
    await controlCommits(input);
  } catch (error: any) {
    console.error(error);

    core.warning(`Error while controlling commits: ${error}`);
  }

  try {
    await controlPullRequest(input);
  } catch (error: any) {
    console.error(error);

    core.warning(`Error while controlling pull request: ${error}`);
  }

  try {
    await controlDeployment(input);
  } catch (error: any) {
    console.error(error);

    core.error(`Error while controlling deployment: ${error}`);
  }
};
