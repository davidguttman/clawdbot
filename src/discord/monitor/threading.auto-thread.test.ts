import { ChannelType } from "@buape/carbon";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { maybeCreateDiscordAutoThread } from "./threading.js";

describe("maybeCreateDiscordAutoThread", () => {
  const postMock = vi.fn();
  const getMock = vi.fn();
  const mockClient = {
    rest: { post: postMock, get: getMock },
  } as unknown as Parameters<typeof maybeCreateDiscordAutoThread>[0]["client"];
  const mockMessage = {
    id: "msg1",
    timestamp: "123",
  } as unknown as Parameters<typeof maybeCreateDiscordAutoThread>[0]["message"];

  it("skips auto-thread if channelType is GuildForum", async () => {
    const result = await maybeCreateDiscordAutoThread({
      client: mockClient,
      message: mockMessage,
      messageChannelId: "forum1",
      isGuildMessage: true,
      channelConfig: { allowed: true, autoThread: true },
      channelType: ChannelType.GuildForum,
      baseText: "test",
      combinedBody: "test",
    });
    expect(result).toBeUndefined();
    expect(postMock).not.toHaveBeenCalled();
  });

  it("skips auto-thread if not guild message", async () => {
    const result = await maybeCreateDiscordAutoThread({
      client: mockClient,
      message: mockMessage,
      messageChannelId: "dm1",
      isGuildMessage: false,
      channelConfig: { allowed: true, autoThread: true },
      channelType: ChannelType.DM,
      baseText: "test",
      combinedBody: "test",
    });
    expect(result).toBeUndefined();
    expect(postMock).not.toHaveBeenCalled();
  });

  it("skips auto-thread if autoThread is false", async () => {
    const result = await maybeCreateDiscordAutoThread({
      client: mockClient,
      message: mockMessage,
      messageChannelId: "text1",
      isGuildMessage: true,
      channelConfig: { allowed: true, autoThread: false },
      channelType: ChannelType.GuildText,
      baseText: "test",
      combinedBody: "test",
    });
    expect(result).toBeUndefined();
    expect(postMock).not.toHaveBeenCalled();
  });

  it("skips auto-thread if already in thread", async () => {
    const result = await maybeCreateDiscordAutoThread({
      client: mockClient,
      message: mockMessage,
      messageChannelId: "text1",
      isGuildMessage: true,
      channelConfig: { allowed: true, autoThread: true },
      threadChannel: { id: "existing-thread" },
      channelType: ChannelType.GuildText,
      baseText: "test",
      combinedBody: "test",
    });
    expect(result).toBeUndefined();
    expect(postMock).not.toHaveBeenCalled();
  });

  it("creates thread when conditions are met", async () => {
    postMock.mockResolvedValueOnce({ id: "new-thread-123" });
    const result = await maybeCreateDiscordAutoThread({
      client: mockClient,
      message: mockMessage,
      messageChannelId: "text1",
      isGuildMessage: true,
      channelConfig: { allowed: true, autoThread: true },
      channelType: ChannelType.GuildText,
      baseText: "Hello world",
      combinedBody: "Hello world",
    });
    expect(result).toBe("new-thread-123");
    expect(postMock).toHaveBeenCalled();
  });
});

describe("maybeCreateDiscordAutoThread config integration", () => {
  const postMock = vi.fn();
  const getMock = vi.fn();
  const mockClient = {
    rest: { post: postMock, get: getMock },
  } as unknown as Parameters<typeof maybeCreateDiscordAutoThread>[0]["client"];
  const mockMessage = {
    id: "msg1",
    timestamp: "123",
  } as unknown as Parameters<typeof maybeCreateDiscordAutoThread>[0]["message"];

  beforeEach(() => {
    postMock.mockReset();
    getMock.mockReset();
  });

  it("uses configured autoThreadArchiveMin", async () => {
    postMock.mockResolvedValueOnce({ id: "thread1" });
    await maybeCreateDiscordAutoThread({
      client: mockClient,
      message: mockMessage,
      messageChannelId: "text1",
      isGuildMessage: true,
      channelConfig: { allowed: true, autoThread: true, autoThreadArchiveMin: "10080" },
      channelType: ChannelType.GuildText,
      baseText: "test",
      combinedBody: "test",
    });
    expect(postMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ body: expect.objectContaining({ auto_archive_duration: 10080 }) }),
    );
  });

  it("defaults to 60 minute archive when autoThreadArchiveMin not set", async () => {
    postMock.mockResolvedValueOnce({ id: "thread1" });
    await maybeCreateDiscordAutoThread({
      client: mockClient,
      message: mockMessage,
      messageChannelId: "text1",
      isGuildMessage: true,
      channelConfig: { allowed: true, autoThread: true },
      channelType: ChannelType.GuildText,
      baseText: "test",
      combinedBody: "test",
    });
    expect(postMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ body: expect.objectContaining({ auto_archive_duration: 60 }) }),
    );
  });
});
