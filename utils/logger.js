/* Tiny structured logger. Swap for pino/winston without touching call sites. */
const stamp = () => new Date().toISOString();

export const logger = {
  info: (msg) => console.log(`[${stamp()}] INFO  ${msg}`),
  warn: (msg) => console.warn(`[${stamp()}] WARN  ${msg}`),
  error: (msg) => console.error(`[${stamp()}] ERROR ${msg}`),
};

/**
 * For log lines that need to identify "which account", without writing a
 * full email address (PII) to a file every service and its ops tooling can
 * read. `j***@example.com` is enough to recognise an account in a log
 * stream without exposing the address itself.
 */
export function maskEmail(email) {
  const str = String(email || '');
  const at = str.indexOf('@');
  if (at <= 1) return '***';
  return `${str[0]}***${str.slice(at)}`;
}
