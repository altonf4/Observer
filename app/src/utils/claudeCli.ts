// Frontend bridge to the Tauri claude_cli commands.
//
// AI Edit / Generate Agent flows can route through the user's local
// `claude` CLI instead of Observer's hosted Gemini proxy. The
// observer-agent-builder skill (at ~/.claude/skills/observer-agent-builder/)
// auto-loads from claude's description match, so we only pass the user's
// conversation as a single prompt.
//
// Web build: every call is a no-op / returns false. Only the Tauri desktop
// build can shell out to a local binary.

import { isTauri } from './platform';

const STORAGE_KEY = 'observer.claudeCode.enabled';

export function isClaudeCodeEnabled(): boolean {
  if (!isTauri()) return false;
  try {
    return localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function setClaudeCodeEnabled(enabled: boolean): void {
  try {
    if (enabled) localStorage.setItem(STORAGE_KEY, 'true');
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* localStorage unavailable — silently ignore */
  }
}

/** True if the running platform supports the claude-CLI bridge at all. */
export function isClaudeCodeSupported(): boolean {
  return isTauri();
}

/**
 * Probe whether the `claude` binary is reachable from this Tauri app.
 * Web build returns false. Tauri build invokes the Rust `claude_check_available`.
 */
export async function checkClaudeAvailable(): Promise<boolean> {
  if (!isTauri()) return false;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<boolean>('claude_check_available');
  } catch {
    return false;
  }
}

export async function claudeVersion(): Promise<string | null> {
  if (!isTauri()) return null;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<string>('claude_version');
  } catch {
    return null;
  }
}

/**
 * Drive a one-shot generation through the local claude CLI.
 *
 * `messages` is the OpenAI-style conversation: an optional system prompt
 * (we drop it on the floor — the skill handles framing) plus alternating
 * user/assistant turns. We flatten to a single text prompt because
 * `claude -p` is non-interactive and starts fresh each call.
 *
 * Returns claude's stdout verbatim. Caller extracts the `$$$ ... $$$` block
 * the same way it does for the cloud / local-LLM paths.
 */
export async function claudeGenerateAgent(
  messages: Array<{ role: string; content: string | unknown }>,
): Promise<string> {
  if (!isTauri()) {
    throw new Error('Claude Code bridge is only available in the desktop build.');
  }

  // Flatten conversation into a single prompt that signals the
  // observer-agent-builder skill (description match: "build, generate,
  // edit, or refine an Observer AI agent"). Drop the system message — the
  // skill IS the framing.
  const turns = messages
    .filter((m) => m.role !== 'system')
    .map((m) => {
      const role = m.role === 'assistant' ? 'ASSISTANT' : 'USER';
      const text = typeof m.content === 'string'
        ? m.content
        : Array.isArray(m.content)
          ? // OpenAI multimodal format — keep only text parts; claude-CLI -p
            // doesn't accept inline images on this path. Future: attach via
            // a tempfile and pass --resume / images via separate flag.
            (m.content as Array<{ type: string; text?: string }>)
              .filter((p) => p.type === 'text' && p.text)
              .map((p) => p.text)
              .join('\n')
          : String(m.content);
      return `${role}: ${text}`;
    })
    .join('\n\n');

  const prompt = [
    'You are helping build or edit an Observer AI agent (browser-runnable',
    'micro-agents that watch screen/camera/audio via local LLMs and react',
    'with notifications, memory, or recording tools).',
    '',
    'Use the observer-agent-builder skill to produce a $$$ ... $$$ YAML',
    'block matching Observer\'s importer. If the user is still describing',
    'what they want, ask clarifying questions in plain prose. Only emit',
    'the $$$ block when you have everything needed.',
    '',
    'Conversation so far:',
    '',
    turns,
    '',
    'ASSISTANT:',
  ].join('\n');

  const { invoke } = await import('@tauri-apps/api/core');
  return await invoke<string>('claude_generate_agent', { prompt });
}
