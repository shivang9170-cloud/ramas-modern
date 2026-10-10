// JWT authentication. Replaces the ASP.NET Session keys that every page read:
//   Session["user_id"], ["User_name"], ["admin"], ["franch"], ["client"],
//   ["DivCode"], ["DivName"], ["Financial_Year"], ["home_branch"],
//   ["currentbranch"], ["cur_bra_code"], ["branch"], ["City_Code"]
// They now live in the signed token as `req.user` (see auth.service.js#toClaims).

import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { forbidden, HttpError, unauthorized } from './errors.js';

export function signToken(claims) {
  return jwt.sign(claims, config.jwt.secret, { expiresIn: config.jwt.expiresIn });
}

// A session opened with a default / weak password (claim pwc) may only change the password and read its own session.
const PASSWORD_CHANGE_ONLY = new Set(['/api/auth/change-password', '/api/auth/me']);

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return next(unauthorized());
  try {
    req.user = jwt.verify(token, config.jwt.secret, { algorithms: ['HS256'] });
  } catch {
    return next(unauthorized('Session expired, please log in again'));
  }
  if (req.user.pwc && !PASSWORD_CHANGE_ONLY.has(`${req.baseUrl}${req.path}`)) {
    const e = new HttpError(403, 'You are using a default password — change your password to continue');
    e.code = 'PASSWORD_CHANGE_REQUIRED';
    return next(e);
  }
  next();
}

/** Restrict a route to certain roles: 'admin' | 'employee' | 'franchisee' | 'client'. */
export const requireRole = (...roles) => (req, res, next) => {
  if (!req.user) return next(unauthorized());
  if (!roles.includes(req.user.role)) return next(forbidden());
  next();
};
