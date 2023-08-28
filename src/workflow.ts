import { CommitRef, StageName } from "./model.js";

export const parseStageNameFromWorkflowName = (
  name: string
): StageName | undefined => {
  const stageMatch = name.match(/stage=(\w+)/);

  if (stageMatch === null) {
    return undefined;
  }

  try {
    return StageName.parse(stageMatch[1]);
  } catch (err) {
    return undefined;
  }
};

export const parseCommitRefFromMessage = (name: string): string | undefined => {
  const commitRefMatch = name.match(/commit=(\w+)/);

  if (commitRefMatch === null) {
    return undefined;
  }

  try {
    return CommitRef.parse(commitRefMatch[1]);
  } catch (err) {
    return undefined;
  }
};
