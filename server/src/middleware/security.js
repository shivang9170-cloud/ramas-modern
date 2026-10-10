// Request-level protection, mounted in app.js before the routes:
//   apiLimiter / writeLimiter   rate limits per client IP for the whole API (the login has its own, stricter one)
//   csrfGuard                   state-changing requests (POST / PUT / PATCH / DELETE) must come from an allowed origin and
//                               carry a JSON body — a page on another site can neither send JSON cross-site without a CORS
//                               pre-flight (refused by corsOptions) nor post an HTML form here. The login token travels in
//                               the Authorization header, never in a cookie, so a browser never sends it on its own.
//   corsOptions                 only the configured origins, only the methods / headers the app uses
//   redactUrl                   keep passwords, tokens and secrets in query strings out of the logs (utils/logger.js
//                               redacts the same keys in log fields)
import rateLimit from 'express-rate-limit';
import { config } from '../config.js';

const WRITE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const tooMany = (req, res) => res.status(429).json({ error: 'Too many requests — please wait a few minutes and try again' });

export function apiLimiters() {
  const rl = config.rateLimit;
  if (rl.off) return [];
  const base = { windowMs: rl.windowMs, standardHeaders: true, legacyHeaders: false, handler: tooMany };
  return [
    rateLimit({ ...base, limit: rl.max }),
    rateLimit({ ...base, limit: rl.writeMax, skip: (req) => !WRITE.has(req.method) }),
  ];
}

/** Is this Origin allowed: a configured CORS origin, or this server itself (the built app served from here). */
export function originAllowed(origin, req) {
  if (!origin) return true;
  if (config.corsOrigins.includes(origin)) return true;
  if (req) {
    // the page came from this very server (same host name, e.g. the tunnel's public address): compared by host only,
    // because a proxy / tunnel in front may not pass on the https scheme
    // (a dev proxy in front passes the browser's host as X-Forwarded-Host; a cross-site page cannot set that header)
    try {
      const host = new URL(origin).host;
      if (host === req.get('host')) return true;
      const fwd = String(req.get('x-forwarded-host') || '').split(',')[0].trim();
      if (fwd && host === fwd) return true;
    } catch { return false; }
  }
  return false;
}

export function csrfGuard(req, res, next) {
  if (!WRITE.has(req.method)) return next();
  // Origin (or, when a browser leaves it out, the Referer's origin) must be ours
  let origin = req.get('origin');
  if (!origin && req.get('referer')) { try { origin = new URL(req.get('referer')).origin; } catch { origin = 'invalid'; } }
  if (origin && !originAllowed(origin, req)) {
    return res.status(403).json({ error: 'Cross-site request blocked' });
  }
  // a body must be JSON (blocks HTML form posts: urlencoded / multipart / text/plain)
  const hasBody = Number(req.get('content-length') || 0) > 0 || Boolean(req.get('transfer-encoding'));
  if (hasBody && !req.is('application/json')) {
    return res.status(415).json({ error: 'Only JSON requests are accepted' });
  }
  next();
}

export const corsOptions = {
  origin(origin, cb) { cb(null, originAllowed(origin)); },   // unknown origins get no CORS headers → the browser blocks them
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: false,
  maxAge: 600,
};

// ------------------------------------------------------------------ logs
const SENSITIVE = /pass(word)?|pwd|token|secret|authorization|otp|api[-_]?key/i;

/** URL with the values of sensitive query parameters replaced by *** */
export function redactUrl(url) {
  return String(url || '').replace(/([?&])([^=&#]+)=([^&#]*)/g, (m, sep, k, v) => (SENSITIVE.test(decodeURIComponent(k)) ? `${sep}${k}=***` : `${sep}${k}=${v}`));
}
