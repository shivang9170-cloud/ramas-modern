// User Master REST API (staff logins) — replaces User/User_Master.aspx. Admin only, like User Access Rights.
//
//   GET    /api/users/options          employees without a login, branches (by branch id)
//   GET    /api/users?q&status
//   GET    /api/users/:userId
//   POST   /api/users                  { employee, password, homeBranch, branches[], active }
//   PUT    /api/users/:userId          { homeBranch, branches[], active, password? (blank = keep) }
//   DELETE /api/users/:userId
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/errors.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import * as svc from './users.service.js';

const router = Router();
router.use(requireAuth, requireRole('admin'));

const password = z.string().min(6, 'Password: at least 6 characters').max(50, 'Password: at most 50 characters')
  .refine((v) => v.trim() === v, 'Password cannot start or end with a space');
const branchId = z.coerce.string().trim().regex(/^\d+$/, 'Branch id');
const base = {
  homeBranch: branchId,
  branches: z.array(branchId).max(100).default([]),
  active: z.boolean().default(true),
};
const createSchema = z.object({ employee: z.string().trim().min(1, 'Select employee').max(50), password, ...base });
const updateSchema = z.object({ password: z.union([z.literal(''), password]).optional().default(''), ...base });
const userParam = z.object({ userId: z.string().trim().min(1).max(50) });

router.get('/options', asyncHandler(async (req, res) => res.json(await svc.options(req.user))));
router.get('/', validate({
  query: z.object({ q: z.string().trim().max(60).optional().default(''), status: z.enum(['all', 'active', 'inactive']).default('all') }),
}), asyncHandler(async (req, res) => res.json(await svc.listUsers(req.user, req.query))));
router.get('/:userId', validate({ params: userParam }), asyncHandler(async (req, res) => res.json(await svc.getUser(req.user, req.params.userId))));
router.post('/', validate({ body: createSchema }), asyncHandler(async (req, res) => res.status(201).json(await svc.createUser(req.user, req.body))));
router.put('/:userId', validate({ params: userParam, body: updateSchema }),
  asyncHandler(async (req, res) => res.json(await svc.updateUser(req.user, req.params.userId, req.body))));
router.delete('/:userId', validate({ params: userParam }),
  asyncHandler(async (req, res) => res.json(await svc.deleteUser(req.user, req.params.userId, req.user))));

export default router;
