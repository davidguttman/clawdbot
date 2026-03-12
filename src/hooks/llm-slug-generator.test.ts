import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_MODEL, DEFAULT_PROVIDER } from "../agents/defaults.js";
import type { OpenClawConfig } from "../config/config.js";

const hoisted = vi.hoisted(() => ({
  resolveDefaultAgentIdMock: vi.fn(),
  resolveAgentWorkspaceDirMock: vi.fn(),
  resolveAgentDirMock: vi.fn(),
  resolveSimpleCompletionSelectionForAgentMock: vi.fn(),
  runEmbeddedPiAgentMock: vi.fn(),
}));

vi.mock("../agents/agent-scope.js", () => ({
  resolveDefaultAgentId: hoisted.resolveDefaultAgentIdMock,
  resolveAgentWorkspaceDir: hoisted.resolveAgentWorkspaceDirMock,
  resolveAgentDir: hoisted.resolveAgentDirMock,
}));

vi.mock("../agents/simple-completion-runtime.js", () => ({
  resolveSimpleCompletionSelectionForAgent: hoisted.resolveSimpleCompletionSelectionForAgentMock,
}));

vi.mock("../agents/pi-embedded.js", () => ({
  runEmbeddedPiAgent: hoisted.runEmbeddedPiAgentMock,
}));

import { generateSlugViaLLM } from "./llm-slug-generator.js";

beforeEach(() => {
  hoisted.resolveDefaultAgentIdMock.mockReset();
  hoisted.resolveAgentWorkspaceDirMock.mockReset();
  hoisted.resolveAgentDirMock.mockReset();
  hoisted.resolveSimpleCompletionSelectionForAgentMock.mockReset();
  hoisted.runEmbeddedPiAgentMock.mockReset();

  hoisted.resolveDefaultAgentIdMock.mockReturnValue("main");
  hoisted.resolveAgentWorkspaceDirMock.mockReturnValue("/tmp/workspace");
  hoisted.resolveAgentDirMock.mockReturnValue("/tmp/legacy-agent");
  hoisted.resolveSimpleCompletionSelectionForAgentMock.mockReturnValue({
    provider: "openrouter",
    modelId: "anthropic/claude-sonnet-4-5",
    profileId: "work",
    agentDir: "/tmp/selected-agent",
  });
  hoisted.runEmbeddedPiAgentMock.mockResolvedValue({
    payloads: [{ text: "Release Planning" }],
  });
});

describe("generateSlugViaLLM", () => {
  it("uses shared selection and forwards auth profile to embedded run", async () => {
    const result = await generateSlugViaLLM({
      sessionContent: "Discuss release planning and follow-ups",
      cfg: {} as OpenClawConfig,
    });

    expect(result).toBe("release-planning");
    expect(hoisted.resolveSimpleCompletionSelectionForAgentMock).toHaveBeenCalledWith({
      cfg: {} as OpenClawConfig,
      agentId: "main",
    });

    const call = hoisted.runEmbeddedPiAgentMock.mock.calls[0]?.[0] as
      | {
          provider?: string;
          model?: string;
          agentDir?: string;
          authProfileId?: string;
          authProfileIdSource?: string;
        }
      | undefined;
    expect(call?.provider).toBe("openrouter");
    expect(call?.model).toBe("anthropic/claude-sonnet-4-5");
    expect(call?.agentDir).toBe("/tmp/selected-agent");
    expect(call?.authProfileId).toBe("work");
    expect(call?.authProfileIdSource).toBe("user");
  });

  it("falls back to default provider/model when shared selection is unavailable", async () => {
    hoisted.resolveSimpleCompletionSelectionForAgentMock.mockReturnValueOnce(null);
    hoisted.runEmbeddedPiAgentMock.mockResolvedValueOnce({
      payloads: [{ text: "Fallback Slug" }],
    });

    const result = await generateSlugViaLLM({
      sessionContent: "Fallback test",
      cfg: {} as OpenClawConfig,
    });

    expect(result).toBe("fallback-slug");
    const call = hoisted.runEmbeddedPiAgentMock.mock.calls[0]?.[0] as
      | {
          provider?: string;
          model?: string;
          agentDir?: string;
          authProfileId?: string;
          authProfileIdSource?: string;
        }
      | undefined;
    expect(call?.provider).toBe(DEFAULT_PROVIDER);
    expect(call?.model).toBe(DEFAULT_MODEL);
    expect(call?.agentDir).toBe("/tmp/legacy-agent");
    expect(call?.authProfileId).toBeUndefined();
    expect(call?.authProfileIdSource).toBeUndefined();
  });
});
