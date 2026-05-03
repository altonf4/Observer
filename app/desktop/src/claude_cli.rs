// Bridges the Observer agent-builder UI to the user's local `claude` CLI
// (Claude Code) so AI Edit and Generate Agent can route through Anthropic
// instead of Observer's hosted Gemini proxy. Pairs with the
// `observer-agent-builder` skill at ~/.claude/skills/observer-agent-builder/
// — the skill auto-loads on description match when claude sees an
// "Observer agent" prompt, so we don't pass the full system prompt manually.
//
// Threat model: user-supplied prompt text is passed as a separate argv
// element to `claude -p`, never spliced into a shell string. No shell
// interpolation possible.

use std::collections::HashMap;
use std::path::PathBuf;
use tokio::process::Command;

/// Likely places `claude` lives, in priority order. We probe these so the
/// command works when launched from /Applications/Observer.app, where the
/// inherited PATH is the bare-minimum macOS default and excludes the user's
/// shell-config additions.
fn candidate_paths() -> Vec<PathBuf> {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("/"));
    vec![
        home.join(".claude").join("local").join("claude"),
        home.join(".claude").join("local").join("node_modules").join(".bin").join("claude"),
        PathBuf::from("/opt/homebrew/bin/claude"),
        PathBuf::from("/usr/local/bin/claude"),
        home.join(".bun").join("bin").join("claude"),
        home.join(".local").join("bin").join("claude"),
        home.join("bin").join("claude"),
    ]
}

/// Resolve the `claude` binary. Tries explicit candidate paths first, then
/// falls back to whatever is in PATH (works when launched from a terminal).
fn resolve_claude_binary() -> Option<PathBuf> {
    for p in candidate_paths() {
        if p.exists() {
            return Some(p);
        }
    }
    // Fall back to PATH lookup — std lib has no `which` so we just trust the
    // binary name and let Command::new resolve it. If PATH is stripped,
    // execution will error and we surface that to the user.
    Some(PathBuf::from("claude"))
}

/// Build an env that's likely to let claude find its config + node runtime.
/// Tauri-launched processes inherit a stripped env; we backfill the basics.
fn enriched_env() -> HashMap<String, String> {
    let mut env: HashMap<String, String> = std::env::vars().collect();

    if !env.contains_key("HOME") {
        if let Some(h) = dirs::home_dir() {
            env.insert("HOME".into(), h.to_string_lossy().into_owned());
        }
    }

    // Augment PATH with common locations claude or its node runtime might live.
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("/"));
    let extra: Vec<String> = vec![
        home.join(".claude").join("local").to_string_lossy().into_owned(),
        home.join(".bun").join("bin").to_string_lossy().into_owned(),
        home.join(".local").join("bin").to_string_lossy().into_owned(),
        home.join("bin").to_string_lossy().into_owned(),
        "/opt/homebrew/bin".into(),
        "/usr/local/bin".into(),
        "/usr/bin".into(),
        "/bin".into(),
    ];
    let existing = env.remove("PATH").unwrap_or_default();
    let combined = if existing.is_empty() {
        extra.join(":")
    } else {
        format!("{}:{}", existing, extra.join(":"))
    };
    env.insert("PATH".into(), combined);

    env
}

/// Probe whether claude CLI is reachable + executable. Frontend uses this to
/// decide if the "Use Claude Code" toggle should be enabled.
#[tauri::command]
pub async fn claude_check_available() -> Result<bool, String> {
    let bin = match resolve_claude_binary() {
        Some(p) => p,
        None => return Ok(false),
    };
    let result = Command::new(&bin)
        .arg("--version")
        .envs(enriched_env())
        .output()
        .await;
    Ok(matches!(result, Ok(out) if out.status.success()))
}

/// Get claude CLI version string, for display in Settings.
#[tauri::command]
pub async fn claude_version() -> Result<String, String> {
    let bin = resolve_claude_binary().ok_or("claude binary not found")?;
    let out = Command::new(&bin)
        .arg("--version")
        .envs(enriched_env())
        .output()
        .await
        .map_err(|e| format!("failed to invoke claude: {}", e))?;
    if !out.status.success() {
        return Err(format!(
            "claude --version exited {}: {}",
            out.status,
            String::from_utf8_lossy(&out.stderr)
        ));
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

/// Run a one-shot generation through `claude -p` and return its stdout.
///
/// The frontend assembles the conversation context into a single `prompt`
/// string and prepends a hint so claude's skill auto-discovery picks up the
/// observer-agent-builder skill. We pass the prompt as a separate argv
/// element so no shell interpolation happens.
///
/// Returns whatever claude printed on stdout. Caller is responsible for
/// extracting `$$$ ... $$$` blocks (same parser the existing flow uses).
#[tauri::command]
pub async fn claude_generate_agent(prompt: String) -> Result<String, String> {
    let bin = resolve_claude_binary().ok_or_else(|| {
        "claude CLI not found. Install Claude Code, or ensure `claude` is on PATH.".to_string()
    })?;

    let env = enriched_env();
    let mut cmd = Command::new(&bin);
    cmd.arg("-p")
        .arg("--permission-mode")
        .arg("bypassPermissions") // we only let claude read; no edits in -p mode
        .arg(&prompt)
        .envs(&env);

    let out = cmd
        .output()
        .await
        .map_err(|e| format!("failed to spawn claude: {}", e))?;

    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        let stdout = String::from_utf8_lossy(&out.stdout);
        return Err(format!(
            "claude CLI exited {}.\n\nstderr:\n{}\n\nstdout:\n{}",
            out.status,
            stderr.trim(),
            stdout.trim()
        ));
    }

    let stdout = String::from_utf8_lossy(&out.stdout).into_owned();
    if stdout.trim().is_empty() {
        return Err("claude returned an empty response".into());
    }
    Ok(stdout)
}
