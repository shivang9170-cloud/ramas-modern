import { ZodError } from 'zod';
import { logger } from '../utils/logger.js';
import { config } from '../config.js';
import { redactUrl } from './security.js';

export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const badRequest = (msg, details) => new HttpError(400, msg, details);
export const unauthorized = (msg = 'Not authenticated') => new HttpError(401, msg);
export const forbidden = (msg = 'Not allowed') => new HttpError(403, msg);
export const notFound = (msg = 'Not found') => new HttpError(404, msg);
export const conflict = (msg) => new HttpError(409, msg);

/** Wrap async route handlers so rejections reach the error handler. */
export const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export function notFoundHandler(req, res) {
  res.status(404).json({ error: `No route for ${req.method} ${req.originalUrl}` });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: 'Validation failed',
      details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, details: err.details, ...(err.code ? { code: err.code } : {}) });
  }
  // request bodies are never logged; query strings are redacted (passwords / tokens)
  logger.error('Unhandled error', { method: req.method, path: redactUrl(req.originalUrl), user: req.user?.userId, err: err.message, stack: err.stack });
  // Legacy pages leaked raw exception text to users; only do that outside production.
  res.status(500).json({ error: config.isProd ? 'Internal server error' : err.message });
}
