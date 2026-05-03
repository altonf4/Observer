// Bring-Your-Own Telegram Bot (BYOB) — direct sender that bypasses
// Observer's hosted /tools/send-telegram proxy.
//
// Why this exists: upstream `sendTelegram` POSTs your message AND any
// attached screenshots/videos to api.observer-ai.com, which forwards
// through the @observer_notification_bot account. That means screen
// captures hit a third-party server before reaching your own Telegram
// chat. For users who care about not exposing screen content to a
// centralized service, this module sends straight to api.telegram.org
// using the user's own bot token.
//
// Setup once: chat with @BotFather on Telegram → /newbot → copy token
// → paste in Settings → Telegram Bot. Then any agent code that calls
// sendTelegram will route directly. The Observer-hosted path stays as
// a fallback so existing agents using @observer_notification_bot keep
// working.

const TOKEN_KEY = 'observer.telegram.botToken';

export function getUserBotToken(): string | null {
  try {
    const t = localStorage.getItem(TOKEN_KEY);
    return t && t.trim().length > 0 ? t.trim() : null;
  } catch {
    return null;
  }
}

export function setUserBotToken(token: string | null): void {
  try {
    if (token && token.trim().length > 0) {
      localStorage.setItem(TOKEN_KEY, token.trim());
    } else {
      localStorage.removeItem(TOKEN_KEY);
    }
  } catch {
    // localStorage unavailable — silently ignore.
  }
}

/** Roughly validate a token's shape: `<int>:<35+ char base64-ish>`. */
export function isPlausibleBotToken(token: string): boolean {
  return /^\d{6,12}:[A-Za-z0-9_-]{30,}$/.test(token.trim());
}

function base64ToBlob(b64: string, mime: string): Blob {
  const bin = atob(b64);
  const len = bin.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

async function callTelegram(token: string, method: string, form: FormData): Promise<void> {
  const url = `https://api.telegram.org/bot${encodeURIComponent(token)}/${method}`;
  const resp = await fetch(url, { method: 'POST', body: form });
  if (!resp.ok) {
    let detail = `${resp.status} ${resp.statusText}`;
    try {
      const j = await resp.json();
      if (j?.description) detail = j.description;
    } catch { /* fallthrough */ }
    throw new Error(`Telegram API ${method} failed: ${detail}`);
  }
  // Body has { ok: true, result: ... } on success — discard.
  await resp.text();
}

/**
 * Send a Telegram message + optional images/videos directly via the user's
 * bot. Mirrors the `images?: string[]` / `videos?: string[]` arity of the
 * upstream sendTelegram so the agent-facing API stays identical.
 *
 * Telegram requires one API call per media item, with the text caption on
 * the first one. We sendMessage for text-only, otherwise sendPhoto/Video
 * with the message as caption on the first attachment, and any extras
 * captionless after.
 */
export async function sendTelegramDirect(
  message: string,
  chatId: string,
  images?: string[],
  videos?: string[],
): Promise<void> {
  const token = getUserBotToken();
  if (!token) {
    throw new Error('No user bot token configured (Settings → Telegram Bot).');
  }

  const imgs = images?.filter(Boolean) ?? [];
  const vids = videos?.filter(Boolean) ?? [];
  const totalAttachments = imgs.length + vids.length;

  // Plain text message — single sendMessage call.
  if (totalAttachments === 0) {
    const form = new FormData();
    form.append('chat_id', chatId);
    form.append('text', message);
    await callTelegram(token, 'sendMessage', form);
    return;
  }

  // First attachment carries the caption; the rest go captionless.
  let captionUsed = false;
  const send = async (b64: string, mime: string, method: 'sendPhoto' | 'sendVideo', field: 'photo' | 'video') => {
    const form = new FormData();
    form.append('chat_id', chatId);
    form.append(field, base64ToBlob(b64, mime), `attachment.${field === 'photo' ? 'jpg' : 'mp4'}`);
    if (!captionUsed && message) {
      form.append('caption', message);
      captionUsed = true;
    }
    await callTelegram(token, method, form);
  };

  for (const img of imgs) {
    await send(img, 'image/jpeg', 'sendPhoto', 'photo');
  }
  for (const vid of vids) {
    await send(vid, 'video/mp4', 'sendVideo', 'video');
  }
}
