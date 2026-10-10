// ODA Charge REST API — replaces Rate/ODA_Charge.aspx.
//
//   GET   /api/oda-charges/branches
//   GET   /api/oda-charges/cities?branch=       cities the branch serves
//   GET   /api/oda-charges/locations?city=
//   GET   /api/oda-charges?branch&city&location&status
//   GET   /api/oda-charges/:id
//   POST  /api/oda-charges                      (staff) { branch, city, location, distance, charges{upTo100…above1000},
//                                               effectiveDate (after today) }
//   PATCH /api/oda-charges/:id/status           (staff) { active }
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/errors.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import * as svc from './oda.service.js';

const router = Router();
router.use(requireAuth);
const staff = requireRole('admin', 'employee');

const code = z.string().trim().min(1).max(20);
const amount = (max) => z.coerce.number({ invalid_type_error: 'Enter a number' }).min(0, 'Cannot be negative').max(max);
const createSchema = z.object({
  branch: z.string().trim().min(1, 'Select branch').max(20),
  city: z.string().trim().min(1, 'Select city').max(20),
  location: z.string().trim().min(1, 'Select location').max(20),
  distance: amount(5000),
  charges: z.object(Object.fromEntries(Object.keys(svc.BANDS).map((k) => [k, amount(1000000)]))),
  effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter the effective date'),
});
const id = z.object({ id: z.coerce.number().int().positive() });

router.get('/branches', asyncHandler(async (req, res) => res.json(await svc.branches())));
router.get('/cities', validate({ query: z.object({ branch: code }) }), asyncHandler(async (req, res) => res.json(await svc.cities(req.query.branch))));
router.get('/locations', validate({ query: z.object({ city: code }) }), asyncHandler(async (req, res) => res.json(await svc.locations(req.query.city))));
router.get('/', validate({
  query: z.object({
    branch: z.string().trim().max(20).optional().default(''),
    city: z.string().trim().max(20).optional().default(''),
    location: z.string().trim().max(20).optional().default(''),
    status: z.enum(['all', 'active', 'inactive']).default('all'),
  }),
}), asyncHandler(async (req, res) => res.json(await svc.listRates(req.query))));
router.get('/:id', validate({ params: id }), asyncHandler(async (req, res) => res.json(await svc.getRate(req.params.id))));
router.post('/', staff, validate({ body: createSchema }), asyncHandler(async (req, res) => res.status(201).json(await svc.createRate(req.user, req.body))));
router.patch('/:id/status', staff, validate({ params: id, body: z.object({ active: z.boolean() }) }),
  asyncHandler(async (req, res) => res.json(await svc.setStatus(req.params.id, req.body.active))));

export default router;
