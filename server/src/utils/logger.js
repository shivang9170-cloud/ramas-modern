// Minimal structured logger. Replaces CommonHelper.ErrorLog (which wrote to a
// text file under the web root). Swap for pino/winston if you need log shipping.

const levels = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = levels[process.env.LOG_LEVEL] ?? levels.info;

// keys whose values never reach a log line
const SENSITIVE = /pass(word)?|pwd|token|secret|authorization|otp|api[-_]?key/i;
function redact(value, depth = 0) {
  if (depth > 6 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, SENSITIVE.test(k) ? '***' : redact(v, depth + 1)]));
}

function write(level, msg, extra) {
  if (levels[level] < threshold) return;
  const line = { t: new Date().toISOString(), level, msg, ...redact(extra || {}) };
  const out = level === 'error' || level === 'warn' ? console.error : console.log;
  out(JSON.stringify(line));
}

export const logger = {
  debug: (m, e) => write('debug', m, e),
  info: (m, e) => write('info', m, e),
  warn: (m, e) => write('warn', m, e),
  error: (m, e) => write('error', m, e),
};
