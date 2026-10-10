// Effective date change REST API — replaces Setting/EffectiveDateChange.aspx and
// Setting/ClientRateMasterEffectiveDateMmodification.aspx.
//
//   GET   /api/effective-dates/clients                          clients with Credit contract rates
//   GET   /api/effective-dates/client-rates?rateType&client&scope   rateType Credit / Paid / To Pay; scope upcoming | all
//   PUT   /api/effective-dates/client-rates                     (staff) { rows[{type, id}], effectiveFrom }
//   GET   /api/effective-dates/vendors                          vendors with PRS / DRS rates
//   GET   /api/effective-dates/vendor-rates?vendor&scope
//   PUT   /api/effective-dates/vendor-rates                     (staff) { ids[], effectiveDate }
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/errors.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { TYPES } from '../contracts/contracts.service.js';
import * as svc from './effdate.service.js';

const router = Router();
router.use(requireAuth);
const staff = requireRole('admin', 'employee');

const date = (msg) => z.string().regex(/^\d{4}-\d{2}-\d{2}$/, msg);
const scope = z.enum(['upcoming', 'all']).default('upcoming');

router.get('/clients', asyncHandler(async (req, res) => res.json(await svc.clients(req.user))));
router.get('/client-rates', validate({
  query: z.object({ rateType: z.enum(['Credit', 'Paid', 'To Pay']).default('Credit'), client: z.string().trim().max(20).optional().default(''), scope }),
}), asyncHandler(async (req, res) => res.json(await svc.clientRates(req.user, req.query))));
router.put('/client-rates', staff, validate({
  body: z.object({
    rows: z.array(z.object({ type: z.enum(Object.keys(TYPES)), id: z.coerce.number().int().positive() })).min(1, 'Select at least one rate').max(500),
    effectiveFrom: date('Enter the new effective date'),
  }),
}), asyncHandler(async (req, res) => res.json(await svc.changeClientRates(req.user, req.body))));

router.get('/vendors', asyncHandler(async (req, res) => res.json(await svc.vendors())));
router.get('/vendor-rates', validate({ query: z.object({ vendor: z.string().trim().min(1).max(20), scope }) }),
  asyncHandler(async (req, res) => res.json(await svc.vendorRates(req.query))));
router.put('/vendor-rates', staff, validate({
  body: z.object({ ids: z.array(z.coerce.number().int().positive()).min(1, 'Select at least one rate').max(500), effectiveDate: date('Enter the new effective date') }),
}), asyncHandler(async (req, res) => res.json(await svc.changeVendorRates(req.user, req.body))));

export default router;
