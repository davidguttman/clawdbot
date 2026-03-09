# ACP Agent-to-Agent Supervision Pattern

This guide explains how to use `sessions_spawn` with `runtime: "acp"` when the supervisor is another agent (not a human watching Discord).

## The Problem

By default, ACP sessions are designed for human supervision:
- Output streams to a Discord thread
- The human watches and responds
- No automatic wake signal to a supervising agent

When an agent supervises another agent (e.g., an orchestrator spawning Claude Code), you need:
1. The supervisor to be notified when the ACP task completes
2. Output that doesn't leak to Discord (unless you want it to)
3. Access to the result for verification

## Solution 1: Use `streamTo: "parent"`

The `streamTo: "parent"` parameter routes ACP output back to the spawning session instead of Discord:

```typescript
const result = await sessions_spawn({
  task: "Implement feature X",
  runtime: "acp",
  agentId: "claude",
  mode: "run",
  streamTo: "parent"  // Key parameter
});
```

**What this does:**
- Sets `deliver: false` so output doesn't go to Discord
- Creates a relay that listens for ACP events
- Streams progress snippets to the parent session via system events
- Wakes the parent session on completion/error

**The parent session receives:**
- Progress updates (truncated snippets)
- Completion notice with duration
- Error notices if the task fails

## Solution 2: Direct `acpx` via Bash

For full programmatic control, bypass OpenClaw's ACP runtime and call `acpx` directly:

```bash
# One-shot execution - result returns synchronously
acpx --format quiet --approve-all claude exec "task here"

# Full NDJSON event stream
acpx --format json --approve-all claude exec "task here"

# Persistent sessions
acpx claude sessions new --name my-session
acpx claude -s my-session "first task"
acpx claude -s my-session "follow-up"  # remembers context
```

**Why this works:**
- Synchronous execution - result returns in same shell call
- `--format quiet` gives just the final answer
- `--format json` gives full NDJSON event stream
- No Discord involvement at all

## Comparison

| Approach | Completion Signal | Output Format | Discord Involvement |
|----------|------------------|---------------|---------------------|
| `sessions_spawn` + thread | Message in thread | Chat messages | Yes - posts to thread |
| `sessions_spawn` + `streamTo: parent` | System event wake | Progress snippets | No |
| Direct `acpx exec` | Sync return | Full text or NDJSON | No |

## When to Use Each

- **Thread-bound sessions**: Human supervision, ongoing feature work with visible progress
- **`streamTo: parent`**: Agent supervision with OpenClaw integration, progress visibility
- **Direct `acpx`**: Maximum control, synchronous results, scripting/automation

## Example: Orchestrator Pattern

```typescript
// Orchestrator agent spawns Claude Code for a task
const spawn = await sessions_spawn({
  task: "Fix the failing tests in src/api/",
  runtime: "acp",
  agentId: "claude",
  mode: "run",
  streamTo: "parent",
  cwd: "/path/to/project"
});

// Orchestrator continues other work...
// When Claude Code completes, this session gets woken with a system event

// On wake, check the stream log for full details
const logPath = spawn.streamLogPath;
// Parse JSONL log for complete event history
```
