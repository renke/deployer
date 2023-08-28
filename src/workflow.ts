import { StageName } from "./model.js";

export const parseStageNameFromWorkflowName = (
  name: string
): StageName | undefined => {
  const stageMatch = name.match(/stage=(\w+)/);

  if (stageMatch === null) {
    return undefined;
  }

  return StageName.parse(stageMatch[1]);
};

export const parseCommitRefFromMessage = (name: string): string | undefined => {
  const commitRefMatch = name.match(/commit=(\w+)/);

  if (commitRefMatch === null) {
    return undefined;
  }

  return commitRefMatch[1];
};
