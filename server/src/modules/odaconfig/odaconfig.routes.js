// ODA master and configuration REST API — replaces Setting/ODA_Master_And_Configuration.aspx.
//
//   GET   /api/oda-config/bands/:kind            kind distance | weight
//   POST  /api/oda-config/bands/:kind            (staff) { from, to, active }
//   PUT   /api/oda-config/bands/:kind/:id        (staff) { from, to, active }
//   GET   /api/oda-config/rates                  distance × weight rates
//   POST  /api/oda-config/rates                  (staff) { rows[{distanceId, weightId, rate, effectiveDate}] }
//   PUT   /api/oda-config/rates/:id              (staff) { distanceId, weightId, rate, effectiveDate, active }
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/errors.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import * as svc from './odaconfig.service.js';

const router = Router();
router.use(requireAuth);
const staff = requireRole('admin', 'employee');

const kind = z.object({ kind: z.enum(Object.keys(svc.MASTERS)) });
const kindId = kind.extend({ id: z.coerce.number().int().positive() });
const band = z.object({
  from: z.coerce.number({ invalid_type_error: 'Enter "From"' }).int().min(0).max(100000),
  to: z.coerce.number({ invalid_type_error: 'Enter "To"' }).int().min(1).max(100000),
  active: z.boolean().default(true),
});
const rate = z.object({
  distanceId: z.coerce.number({ invalid_type_error: 'Select distance' }).int().positive('Select distance'),
  weightId: z.coerce.number({ invalid_type_error: 'Select weight' }).int().positive('Select weight'),
  rate: z.coerce.number({ invalid_type_error: 'Enter the rate' }).min(0).max(1000000),
  effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter the effective date'),
});

router.get('/bands/:kind', validate({ params: kind }), asyncHandler(async (req, res) => res.json(await svc.listBands(req.params.kind))));
router.post('/bands/:kind', staff, validate({ params: kind, body: band }),
  asyncHandler(async (req, res) => res.status(201).json(await svc.createBand(req.user, req.params.kind, req.body))));
router.put('/bands/:kind/:id', staff, validate({ params: kindId, body: band }),
  asyncHandler(async (req, res) => res.json(await svc.updateBand(req.user, req.params.kind, req.params.id, req.body))));
router.get('/rates', asyncHandler(async (req, res) => res.json(await svc.listConfig())));
router.post('/rates', staff, validate({ body: z.object({ rows: z.array(rate).min(1, 'Add at least one rate').max(200) }) }),
  asyncHandler(async (req, res) => res.status(201).json(await svc.createConfig(req.user, req.body.rows))));
router.put('/rates/:id', staff, validate({ params: z.object({ id: z.coerce.number().int().positive() }), body: rate.extend({ active: z.boolean().default(true) }) }),
  asyncHandler(async (req, res) => res.json(await svc.updateConfig(req.user, req.params.id, req.body))));

export default router;
