import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../config/config.js";

const hoisted = vi.hoisted(() => ({
  resolveDefaultAgentIdMock: vi.fn(),
  resolveAgentWorkspaceDirMock: vi.fn(),
  runSimpleCompletionForAgentMock: vi.fn(),
}));

vi.mock("../agents/agent-scope.js", () => ({
  resolveDefaultAgentId: hoisted.resolveDefaultAgentIdMock,
  resolveAgentWorkspaceDir: hoisted.resolveAgentWorkspaceDirMock,
}));

vi.mock("../agents/simple-completion-runtime.js", () => ({
  runSimpleCompletionForAgent: hoisted.runSimpleCompletionForAgentMock,
}));

import { generateSlugViaLLM } from "./llm-slug-generator.js";

beforeEach(() => {
  hoisted.resolveDefaultAgentIdMock.mockReset();
  hoisted.resolveAgentWorkspaceDirMock.mockReset();
  hoisted.runSimpleCompletionForAgentMock.mockReset();

  hoisted.resolveDefaultAgentIdMock.mockReturnValue("main");
  hoisted.resolveAgentWorkspaceDirMock.mockReturnValue("/tmp/workspace");
  hoisted.runSimpleCompletionForAgentMock.mockResolvedValue({
    payloads: [{ text: "Release Planning" }],
  });
});

describe("generateSlugViaLLM", () => {
  it("uses shared completion helper with one-shot prompt", async () => {
    const result = await generateSlugViaLLM({
      sessionContent: "Discuss release planning and follow-ups",
      cfg: {} as OpenClawConfig,
    });

    expect(result).toBe("release-planning");
    const call = hoisted.runSimpleCompletionForAgentMock.mock.calls[0]?.[0] as
      | {
          cfg?: OpenClawConfig;
          agentId?: string;
          workspaceDir?: string;
          sessionKey?: string;
          timeoutMs?: number;
          prompt?: string;
        }
      | undefined;
    expect(call?.cfg).toEqual({} as OpenClawConfig);
    expect(call?.agentId).toBe("main");
    expect(call?.workspaceDir).toBe("/tmp/workspace");
    expect(call?.sessionKey).toBe("temp:slug-generator");
    expect(call?.timeoutMs).toBe(15_000);
    expect(call?.prompt).toContain("Based on this conversation");
    expect(call?.prompt).toContain("Discuss release planning and follow-ups");
  });

  it("returns null when completion payload has no text", async () => {
    hoisted.runSimpleCompletionForAgentMock.mockResolvedValueOnce({
      payloads: [{ text: "" }],
    });

    const result = await generateSlugViaLLM({
      sessionContent: "No text test",
      cfg: {} as OpenClawConfig,
    });

    expect(result).toBeNull();
  });
});
