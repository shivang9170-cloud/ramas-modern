// PRS / DRS Rate Master REST API — replaces Rate/PRS_and_DRS_Rate_Master.aspx.
//
//   GET   /api/prs-drs-rates/options                 vendor types, rate-on list, FTL types
//   GET   /api/prs-drs-rates/vendors?type=           vendors of a type (VENDOR / SELF) in the user's division
//   GET   /api/prs-drs-rates/previous-date?vendor&rateOn   latest effective date already saved
//   GET   /api/prs-drs-rates?vendorType&vendor&rateOn
//   GET   /api/prs-drs-rates/:id
//   POST  /api/prs-drs-rates                         (staff) { vendorType, vendor, rateOn, ftlType, fixKm, fixKmRate,
//                                                    extraKmRate, perKg, effectiveDate (today or later, in the FY) }
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/errors.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import * as svc from './prsdrs.service.js';

const router = Router();
router.use(requireAuth);
const staff = requireRole('admin', 'employee');

const vendorType = z.enum(Object.keys(svc.VENDOR_TYPES), { errorMap: () => ({ message: 'Select vendor type' }) });
const rateOn = z.enum(svc.RATE_ON, { errorMap: () => ({ message: 'Select rate on' }) });
const amount = z.coerce.number({ invalid_type_error: 'Enter a number' }).min(0, 'Cannot be negative').max(10000000).default(0);
const createSchema = z.object({
  vendorType,
  vendor: z.string().trim().min(1, 'Select vendor').max(20),
  rateOn,
  ftlType: z.string().trim().min(1, 'Select FTL type').max(50),
  fixKm: amount,
  fixKmRate: amount,
  extraKmRate: amount,
  perKg: amount,
  effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter the effective date'),
});

router.get('/options', asyncHandler(async (req, res) => res.json(await svc.options())));
router.get('/vendors', validate({ query: z.object({ type: vendorType }) }),
  asyncHandler(async (req, res) => res.json(await svc.vendors(req.user, req.query.type))));
router.get('/previous-date', validate({ query: z.object({ vendor: z.string().trim().min(1).max(20), rateOn }) }),
  asyncHandler(async (req, res) => res.json(await svc.previousDate(req.query.vendor, req.query.rateOn))));
router.get('/', validate({
  query: z.object({
    vendorType: z.union([vendorType, z.literal('')]).optional().default(''),
    vendor: z.string().trim().max(20).optional().default(''),
    rateOn: z.union([rateOn, z.literal('')]).optional().default(''),
  }),
}), asyncHandler(async (req, res) => res.json(await svc.listRates(req.query))));
router.get('/:id', validate({ params: z.object({ id: z.coerce.number().int().positive() }) }),
  asyncHandler(async (req, res) => res.json(await svc.getRate(req.params.id))));
router.post('/', staff, validate({ body: createSchema }),
  asyncHandler(async (req, res) => res.status(201).json(await svc.createRate(req.user, req.body))));

export default router;
