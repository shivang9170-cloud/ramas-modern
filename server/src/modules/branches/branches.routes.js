// Branch Master REST API — replaces Master/Branch_Master.aspx.
//
//   GET    /api/branches/options          companies, states (+ GSTIN), divisions, controlling branches
//   GET    /api/branches/cities?state=
//   GET    /api/branches/locations?city=  with pin code and the branch already linked to it
//   GET    /api/branches?q&status
//   GET    /api/branches/:code
//   POST   /api/branches                  (staff)
//   PUT    /api/branches/:code            (staff)
//   DELETE /api/branches/:code            (staff; refused while the branch is in use)
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/errors.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import * as svc from './branches.service.js';

const router = Router();
router.use(requireAuth);
const staff = requireRole('admin', 'employee');

const up = (max) => z.string().trim().max(max).optional().default('').transform((v) => v.toUpperCase());
const text = (max) => z.string().trim().max(max).optional().default('');

const branchSchema = z.object({
  name: z.string().trim().min(2, 'Enter branch name').max(100).transform((v) => v.toUpperCase()),
  shortCode: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{2,6}$/, 'Short code: 2–6 letters/digits (used in every document number)'),
  stateCode: z.string().trim().min(1, 'Select state').max(10),
  cityCode: z.string().trim().min(1, 'Select city').max(10),
  location: text(20),
  place: up(100),
  address: up(500),
  contactPerson: up(100),
  email: z.string().trim().max(100).optional().default('').refine((v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), 'Invalid e-mail'),
  phone: text(50),
  fax: text(50),
  remarks: up(500),
  gstin: z.string().trim().toUpperCase().max(15).optional().default('')
    .refine((v) => !v || /^\d{2}[A-Z0-9]{13}$/.test(v), 'GSTIN must be 15 characters starting with the state code'),
  company: z.string().trim().min(1, 'Select company').max(20),
  controllingBranch: text(20),
  sapCode: text(30),
  manualCode: text(30),
  maxLimit: z.string().trim().max(20).optional().default('').refine((v) => !v || /^\d+(\.\d+)?$/.test(v), 'Enter a number'),
  divisions: z.array(z.string().trim().min(1).max(20)).max(20).default([]),
  active: z.boolean().default(true),
  isHub: z.boolean().default(false),
  isMasterFranchisee: z.boolean().default(false),
  isFranchisee: z.boolean().default(false),
  docketAutoNumber: z.boolean().default(false),
}).superRefine((b, ctx) => {
  // The page un-ticked the other two whenever one was ticked.
  if ([b.isHub, b.isMasterFranchisee, b.isFranchisee].filter(Boolean).length > 1) {
    ctx.addIssue({ code: 'custom', path: ['isHub'], message: 'A branch is either a hub, a master franchisee or a franchisee' });
  }
  if (b.gstin && b.gstin.slice(0, 2) === '00') ctx.addIssue({ code: 'custom', path: ['gstin'], message: 'Invalid GSTIN state code' });
});

router.get('/options', asyncHandler(async (req, res) => res.json(await svc.options())));
router.get('/cities', validate({ query: z.object({ state: z.string().trim().min(1).max(10) }) }),
  asyncHandler(async (req, res) => res.json(await svc.cities(req.query.state))));
router.get('/locations', validate({ query: z.object({ city: z.string().trim().min(1).max(10) }) }),
  asyncHandler(async (req, res) => res.json(await svc.locations(req.query.city))));
router.get('/', validate({ query: z.object({ q: z.string().trim().max(60).optional().default(''), status: z.enum(['all', 'active', 'inactive']).default('all') }) }),
  asyncHandler(async (req, res) => res.json(await svc.listBranches(req.user, req.query))));
router.get('/:code', asyncHandler(async (req, res) => res.json(await svc.getBranch(req.user, req.params.code.toUpperCase()))));
router.post('/', staff, validate({ body: branchSchema }), asyncHandler(async (req, res) => {
  res.status(201).json(await svc.createBranch(req.user, req.body));
}));
router.put('/:code', staff, validate({ body: branchSchema }), asyncHandler(async (req, res) => {
  res.json(await svc.updateBranch(req.user, req.params.code.toUpperCase(), req.body));
}));
router.delete('/:code', staff, asyncHandler(async (req, res) => {
  res.json(await svc.deleteBranch(req.user, req.params.code.toUpperCase()));
}));

export default router;
