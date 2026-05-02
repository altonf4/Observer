// Privacy / telemetry gate.
//
// Upstream Observer initializes Datadog RUM unconditionally at module load
// time, with sessionSampleRate: 100 and 20% session-replay (DOM video).
// This fork makes that explicit and user-controllable.
//
// Three layers, evaluated in order (highest priority first):
//   1. VITE_DISABLE_TELEMETRY=true at build time → telemetry off, no toggle.
//   2. localStorage 'observer.telemetry' === 'true' → on at runtime.
//   3. localStorage 'observer.telemetry' === 'false' or missing → off (default).
//
// Default OFF is the deliberate fork-policy difference from upstream.
// Flip the toggle in Settings → Privacy & Telemetry to opt back in.

const STORAGE_KEY = 'observer.telemetry';

export function isTelemetryEnabled(): boolean {
  if (import.meta.env.VITE_DISABLE_TELEMETRY === 'true') return false;
  try {
    return localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    // Private/incognito or storage disabled — fall back to off.
    return false;
  }
}

export function setTelemetryEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? 'true' : 'false');
  } catch {
    // Storage unavailable — silently ignore; the build-time flag still works.
  }
}

export function isTelemetryLockedOff(): boolean {
  return import.meta.env.VITE_DISABLE_TELEMETRY === 'true';
}
