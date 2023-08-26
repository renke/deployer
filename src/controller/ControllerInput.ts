import { z } from "zod";
import { BranchName, CommitRef } from "../model.js";

export const ControllerInput = z
  .object({
    branchName: BranchName,
    commitRef: CommitRef,
  })
  .brand("ControllerInput");

export type ControllerInput = z.infer<typeof ControllerInput>;
