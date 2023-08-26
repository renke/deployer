import { StageName } from "./model.js";

export const parseStageFromWorkflowName = (
  name: string
): StageName | undefined => {
  const stageMatch = name.match(/stage=(\w+)/);

  if (stageMatch === null) {
    return undefined;
  }

  return StageName.parse(stageMatch[1]);
};
