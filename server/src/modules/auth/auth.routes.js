import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/errors.js';
import { requireAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import * as auth from './auth.service.js';

const router = Router();

// Brute-force protection the legacy login page never had.
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false });

const loginSchema = z.object({
  loginType: z.enum(['employee', 'franchisee', 'client']).default('employee'),
  username: z.string().trim().min(1, 'User id is required').max(100),
  password: z.string().min(1, 'Password is required').max(200),
  divCode: z.string().trim().min(1, 'Division is required'),
  financialYear: z.string().trim().regex(/^\d{4}\s*-\s*\d{4}$/, 'Financial year must look like 2024-2025'),
});

// GET /api/auth/options -> dropdown data for the login screen
router.get('/options', asyncHandler(async (req, res) => {
  const [divisions, financialYears] = await Promise.all([auth.getDivisions(), auth.getFinancialYears()]);
  res.json({ divisions, financialYears });
}));

// POST /api/auth/login -> { token, user }
router.post('/login', loginLimiter, validate({ body: loginSchema }), asyncHandler(async (req, res) => {
  res.json(await auth.login(req.body));
}));

// GET /api/auth/me -> current session claims
router.get('/me', requireAuth, (req, res) => res.json({ user: req.user }));

// GET /api/auth/branches -> branches the user can switch to
router.get('/branches', requireAuth, asyncHandler(async (req, res) => {
  res.json(await auth.allowedBranches(req.user));
}));

// POST /api/auth/switch-branch { branchCode } -> new { token, user }
router.post('/switch-branch', requireAuth,
  validate({ body: z.object({ branchCode: z.string().trim().min(1) }) }),
  asyncHandler(async (req, res) => {
    res.json(await auth.switchBranch(req.user, req.body.branchCode));
  }));

// POST /api/auth/change-password
// POST /api/auth/change-password -> { message, token, user } (a new session, also clearing "must change password")
const changeLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false });
router.post('/change-password', requireAuth, changeLimiter,
  validate({ body: z.object({ oldPassword: z.string().min(1).max(200), newPassword: z.string().min(8, 'At least 8 characters').max(50) }) }),
  asyncHandler(async (req, res) => {
    const session = await auth.changePassword(req.user, req.body.oldPassword, req.body.newPassword);
    res.json({ message: 'Password changed successfully', ...session });
  }));

export default router;
