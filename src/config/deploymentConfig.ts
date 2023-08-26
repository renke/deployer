import { octokit, owner, repo } from "../misc.js";
import { BranchName, StageName } from "../model.js";

export const DEPLOYMENT_YAML_FILE_NAME = "deployment.json";

interface DeploymentConfig {
  deployments: Record<StageName, string | null>;
}

export const getDeploymentConfigAndSha = async (
  input: {
    branchName?: BranchName;
  } = {}
): Promise<[DeploymentConfig, string] | undefined> => {
  const getContentRes = octokit.rest.repos.getContent({
    owner,
    repo,
    ref: input.branchName,
    path: DEPLOYMENT_YAML_FILE_NAME,
  });

  const { data } = await getContentRes;

  if (!("content" in data)) {
    return undefined;
  }

  const { content } = data;

  if (content === undefined) {
    return undefined;
  }

  const decodedContent = Buffer.from(content, "base64").toString("utf-8");

  const parsedContent = JSON.parse(decodedContent);

  // TODO: Validate config

  return [parsedContent, data.sha];
};

export const getDeploymentConfig = async (): Promise<
  DeploymentConfig | undefined
> => {
  const deploymentConfigRes = await getDeploymentConfigAndSha();

  if (deploymentConfigRes === undefined) {
    return undefined;
  }

  const [deploymentConfig] = deploymentConfigRes;

  return deploymentConfig;
};

export const DeploymentConfigApi = {
  isDesiredCommitRefForStage: (
    config: DeploymentConfig,
    commitRef: string,
    stage: keyof DeploymentConfig["deployments"]
  ) => {
    return config.deployments[stage] === commitRef;
  },

  setDesiredCommitRefForStage: (
    config: DeploymentConfig,
    commitRef: string,
    stage: keyof DeploymentConfig["deployments"]
  ) => {
    return {
      ...config,
      deployments: {
        ...config.deployments,
        [stage]: commitRef,
      },
    };
  },
};
