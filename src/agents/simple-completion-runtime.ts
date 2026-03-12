import type { Api, Model } from "@mariozechner/pi-ai";
import type { OpenClawConfig } from "../config/config.js";
import { resolveAgentDir, resolveAgentEffectiveModelPrimary } from "./agent-scope.js";
import { DEFAULT_MODEL, DEFAULT_PROVIDER } from "./defaults.js";
import { getApiKeyForModel, type ResolvedProviderAuth } from "./model-auth.js";
import { splitTrailingAuthProfile } from "./model-ref-profile.js";
import {
  buildModelAliasIndex,
  resolveDefaultModelForAgent,
  resolveModelRefFromString,
} from "./model-selection.js";
import { resolveModel } from "./pi-embedded-runner/model.js";
import { runEmbeddedPiAgent } from "./pi-embedded.js";

type SimpleCompletionAuthStorage = {
  setRuntimeApiKey: (provider: string, apiKey: string) => void;
};

type AllowedMissingApiKeyMode = ResolvedProviderAuth["mode"];

export type PreparedSimpleCompletionModel =
  | {
      model: Model<Api>;
      auth: ResolvedProviderAuth;
    }
  | {
      error: string;
      auth?: ResolvedProviderAuth;
    };

export type AgentSimpleCompletionSelection = {
  provider: string;
  modelId: string;
  profileId?: string;
  agentDir: string;
};

export type PreparedSimpleCompletionModelForAgent =
  | {
      selection: AgentSimpleCompletionSelection;
      model: Model<Api>;
      auth: ResolvedProviderAuth;
    }
  | {
      error: string;
      selection?: AgentSimpleCompletionSelection;
      auth?: ResolvedProviderAuth;
    };

type RunSimpleCompletionForAgentParams = {
  cfg: OpenClawConfig;
  agentId: string;
  prompt: string;
  sessionId: string;
  sessionKey?: string;
  sessionFile: string;
  workspaceDir: string;
  timeoutMs: number;
  runId: string;
  modelRef?: string;
};

export function resolveSimpleCompletionSelectionForAgent(params: {
  cfg: OpenClawConfig;
  agentId: string;
  modelRef?: string;
}): AgentSimpleCompletionSelection | null {
  const fallbackRef = resolveDefaultModelForAgent({
    cfg: params.cfg,
    agentId: params.agentId,
  });
  const modelRef =
    params.modelRef?.trim() || resolveAgentEffectiveModelPrimary(params.cfg, params.agentId);
  const split = modelRef ? splitTrailingAuthProfile(modelRef) : null;
  const aliasIndex = buildModelAliasIndex({
    cfg: params.cfg,
    defaultProvider: fallbackRef.provider || DEFAULT_PROVIDER,
  });
  const resolved = split
    ? resolveModelRefFromString({
        raw: split.model,
        defaultProvider: fallbackRef.provider || DEFAULT_PROVIDER,
        aliasIndex,
      })
    : null;
  const provider = resolved?.ref.provider ?? fallbackRef.provider;
  const modelId = resolved?.ref.model ?? fallbackRef.model;
  if (!provider || !modelId) {
    return null;
  }
  return {
    provider,
    modelId,
    profileId: split?.profile || undefined,
    agentDir: resolveAgentDir(params.cfg, params.agentId),
  };
}

async function setRuntimeApiKeyForCompletion(params: {
  authStorage: SimpleCompletionAuthStorage;
  model: Model<Api>;
  apiKey: string;
}): Promise<void> {
  if (params.model.provider === "github-copilot") {
    const { resolveCopilotApiToken } = await import("../providers/github-copilot-token.js");
    const copilotToken = await resolveCopilotApiToken({
      githubToken: params.apiKey,
    });
    params.authStorage.setRuntimeApiKey(params.model.provider, copilotToken.token);
    return;
  }
  params.authStorage.setRuntimeApiKey(params.model.provider, params.apiKey);
}

function hasMissingApiKeyAllowance(params: {
  mode: ResolvedProviderAuth["mode"];
  allowMissingApiKeyModes?: ReadonlyArray<AllowedMissingApiKeyMode>;
}): boolean {
  return Boolean(params.allowMissingApiKeyModes?.includes(params.mode));
}

function formatRuntimeError(err: unknown, fallback: string): string {
  if (err instanceof Error && typeof err.message === "string" && err.message.trim()) {
    return err.message.trim();
  }
  if (typeof err === "string" && err.trim()) {
    return err.trim();
  }
  if (typeof err === "number" || typeof err === "boolean" || typeof err === "bigint") {
    return `${err}`;
  }
  return fallback;
}

export async function prepareSimpleCompletionModel(params: {
  cfg: OpenClawConfig | undefined;
  provider: string;
  modelId: string;
  agentDir?: string;
  profileId?: string;
  preferredProfile?: string;
  allowMissingApiKeyModes?: ReadonlyArray<AllowedMissingApiKeyMode>;
}): Promise<PreparedSimpleCompletionModel> {
  const resolved = resolveModel(params.provider, params.modelId, params.agentDir, params.cfg);
  if (!resolved.model) {
    return {
      error: resolved.error ?? `Unknown model: ${params.provider}/${params.modelId}`,
    };
  }

  let auth: ResolvedProviderAuth;
  try {
    auth = await getApiKeyForModel({
      model: resolved.model,
      cfg: params.cfg,
      agentDir: params.agentDir,
      profileId: params.profileId,
      preferredProfile: params.preferredProfile,
    });
  } catch (err) {
    return {
      error: formatRuntimeError(
        err,
        `Failed to resolve auth for provider "${resolved.model.provider}".`,
      ),
    };
  }

  const rawApiKey = auth.apiKey?.trim();
  if (
    !rawApiKey &&
    !hasMissingApiKeyAllowance({
      mode: auth.mode,
      allowMissingApiKeyModes: params.allowMissingApiKeyModes,
    })
  ) {
    return {
      error: `No API key resolved for provider "${resolved.model.provider}" (auth mode: ${auth.mode}).`,
      auth,
    };
  }

  if (rawApiKey) {
    try {
      await setRuntimeApiKeyForCompletion({
        authStorage: resolved.authStorage,
        model: resolved.model,
        apiKey: rawApiKey,
      });
    } catch (err) {
      return {
        error: formatRuntimeError(
          err,
          `Failed to set runtime API key for provider "${resolved.model.provider}".`,
        ),
        auth,
      };
    }
  }

  return {
    model: resolved.model,
    auth,
  };
}

export async function prepareSimpleCompletionModelForAgent(params: {
  cfg: OpenClawConfig;
  agentId: string;
  modelRef?: string;
  preferredProfile?: string;
  allowMissingApiKeyModes?: ReadonlyArray<AllowedMissingApiKeyMode>;
}): Promise<PreparedSimpleCompletionModelForAgent> {
  const selection = resolveSimpleCompletionSelectionForAgent({
    cfg: params.cfg,
    agentId: params.agentId,
    modelRef: params.modelRef,
  });
  if (!selection) {
    return {
      error: `No model configured for agent ${params.agentId}.`,
    };
  }
  const prepared = await prepareSimpleCompletionModel({
    cfg: params.cfg,
    provider: selection.provider,
    modelId: selection.modelId,
    agentDir: selection.agentDir,
    profileId: selection.profileId,
    preferredProfile: params.preferredProfile,
    allowMissingApiKeyModes: params.allowMissingApiKeyModes,
  });
  if ("error" in prepared) {
    return {
      ...prepared,
      selection,
    };
  }
  return {
    selection,
    model: prepared.model,
    auth: prepared.auth,
  };
}

export async function runSimpleCompletionForAgent(params: RunSimpleCompletionForAgentParams) {
  const selection = resolveSimpleCompletionSelectionForAgent({
    cfg: params.cfg,
    agentId: params.agentId,
    modelRef: params.modelRef,
  });
  const provider = selection?.provider ?? DEFAULT_PROVIDER;
  const model = selection?.modelId ?? DEFAULT_MODEL;
  const authProfileId = selection?.profileId?.trim();

  return runEmbeddedPiAgent({
    sessionId: params.sessionId,
    sessionKey: params.sessionKey,
    agentId: params.agentId,
    sessionFile: params.sessionFile,
    workspaceDir: params.workspaceDir,
    agentDir: selection?.agentDir || resolveAgentDir(params.cfg, params.agentId),
    config: params.cfg,
    prompt: params.prompt,
    provider,
    model,
    ...(authProfileId
      ? {
          authProfileId,
          authProfileIdSource: "user" as const,
        }
      : {}),
    timeoutMs: params.timeoutMs,
    runId: params.runId,
  });
}
