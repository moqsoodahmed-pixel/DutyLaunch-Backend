/* Tiny structured logger. Swap for pino/winston without touching call sites. */
const stamp = () => new Date().toISOString();

export const logger = {
  info: (msg) => console.log(`[${stamp()}] INFO  ${msg}`),
  warn: (msg) => console.warn(`[${stamp()}] WARN  ${msg}`),
  error: (msg) => console.error(`[${stamp()}] ERROR ${msg}`),
};
