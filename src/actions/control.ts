import * as github from "@actions/github";
import { ControllerInput } from "../controller/ControllerInput.js";
import { control } from "../controller/controller.js";
import { BranchName, CommitRef } from "../model.js";

export const run = async () => {
  await control(
    ControllerInput.parse({
      branchName: BranchName.parse(process.env.GITHUB_REF_NAME),
      commitRef: CommitRef.parse(github.context.sha),
    })
  );
};

run();
