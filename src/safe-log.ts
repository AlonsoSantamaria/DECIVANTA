const forbiddenKey = /secret|password|authorization|bearer|sessiontoken|connection|string|embedding/i;

export function safeLog(level: "info" | "warn" | "error", event: Record<string, unknown>): void {
  const safe = Object.fromEntries(Object.entries(event).filter(([key]) => !forbiddenKey.test(key)));
  console[level](JSON.stringify(safe));
}
