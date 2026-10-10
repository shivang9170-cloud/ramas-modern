// Franchisee rates REST API — replaces Rate/Franchisee_Commission_Master.aspx and Rate/Franchisees_Pickup_Delivery.aspx.
//
//   GET   /api/franchisee-rates/options              modes, commission modes, booking types, categories, weight bands, vehicle types
//   GET   /api/franchisee-rates/commissions          commission versions with their road rows
//   POST  /api/franchisee-rates/commissions          (staff) { mode RD|TR|AI, commissionMode, rent, mobileBills, signage,
//                                                    baseFreightPercent, airPercent, trainPercent, trainPerRail,
//                                                    rows[{bookingType, category LTL|FTL36|FTL916|TRAILER, …}], startDate, endDate, effectiveDate }
//   GET   /api/franchisee-rates/franchisees
//   GET   /api/franchisee-rates/pickup-delivery?franchisee=
//   POST  /api/franchisee-rates/pickup-delivery      (staff) { franchisee, docType DOC|NONDOC, rows[{band, pickup, perConsignment}], effectiveDate }
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/errors.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import * as svc from './franchiseerates.service.js';

const router = Router();
router.use(requireAuth);
const staff = requireRole('admin', 'employee');

const date = (msg) => z.string().regex(/^\d{4}-\d{2}-\d{2}$/, msg);
const amount = z.coerce.number({ invalid_type_error: 'Enter a number' }).min(0, 'Cannot be negative').max(10000000).optional().default(0);
const pct = z.coerce.number({ invalid_type_error: 'Enter a number' }).min(0).max(100, 'At most 100 %').optional().default(0);
const opts = (o) => Object.entries(o).map(([value, label]) => ({ value, label }));

router.get('/options', asyncHandler(async (req, res) => res.json({
  modes: opts(svc.MODES), commissionModes: opts(svc.COMMISSION_MODES), bookingTypes: opts(svc.BOOKING_TYPES),
  categories: opts(svc.CATEGORIES), weightBands: svc.WEIGHT_BANDS, docTypes: opts(svc.DOC_TYPES), vehicleTypes: await svc.vehicleTypes(),
})));

router.get('/commissions', asyncHandler(async (req, res) => res.json(await svc.listCommissions())));
router.post('/commissions', staff, validate({
  body: z.object({
    mode: z.enum(Object.keys(svc.MODES)), commissionMode: z.enum(Object.keys(svc.COMMISSION_MODES)).default('BookingType'),
    rent: amount, mobileBills: amount, signage: amount, baseFreightPercent: pct, airPercent: pct, trainPercent: pct, trainPerRail: amount,
    rows: z.array(z.object({
      bookingType: z.enum(Object.keys(svc.BOOKING_TYPES)), category: z.enum(Object.keys(svc.CATEGORIES)),
      upTo3Tons: pct, from3To6Tons: pct, vehicleType: z.string().trim().max(60).optional().default(''), perConsignment: amount, sharePercent: pct,
    })).max(50).default([]),
    startDate: date('Enter the start date'), endDate: date('Enter the end date'), effectiveDate: date('Enter the effective date'),
  }),
}), asyncHandler(async (req, res) => res.status(201).json(await svc.createCommission(req.user, req.body))));

router.get('/franchisees', asyncHandler(async (req, res) => res.json(await svc.franchisees())));
router.get('/pickup-delivery', validate({ query: z.object({ franchisee: z.string().trim().max(20).optional().default('') }) }),
  asyncHandler(async (req, res) => res.json(await svc.listPickupDelivery(req.query))));
router.post('/pickup-delivery', staff, validate({
  body: z.object({
    franchisee: z.string().trim().min(1, 'Select the franchisee').max(20), docType: z.enum(Object.keys(svc.DOC_TYPES)),
    rows: z.array(z.object({ band: z.string().trim().max(30).optional().default(''), pickup: amount, perConsignment: amount })).min(1, 'Add the rates').max(10),
    effectiveDate: date('Enter the effective date'),
  }),
}), asyncHandler(async (req, res) => res.status(201).json(await svc.createPickupDelivery(req.user, req.body))));

export default router;
