// Vendor rate masters REST API — replaces Rate/Vendor_Road_Rate_Master.aspx, Vendor_Air_Rate_Master.aspx and
// Vendor_Train_Rate_Master.aspx.
//
//   GET   /api/vendor-rates/options                   vendor types per kind, road rate modes, FTL rate types, shifts, train rate types
//   GET   /api/vendor-rates/vendors?kind&type         kind road | air | train
//   GET   /api/vendor-rates/carriers?kind&vendor      the vendor's flights (air) / trains (train)
//   GET   /api/vendor-rates/cities?q=
//   GET   /api/vendor-rates/road?vendor&origin&destination
//   POST  /api/vendor-rates/road                      (staff) { vendorType, vendor, origin, destination, rateMode, ftlRateType,
//                                                     ftlAmount, perKg, perKm, effectiveDate, startDate, endDate }
//   GET   /api/vendor-rates/road/rate?vendor&origin&destination&weight&km   road rate in force + the hire charge it gives
//   GET   /api/vendor-rates/air?vendor&origin&destination
//   GET   /api/vendor-rates/air/:id                   with its weight slabs
//   POST  /api/vendor-rates/air                       (staff) { vendorType, vendor, flight, shift, origin, destination, ratePerKg,
//                                                     slabs[{from, to, rate}], charges{…}, effectiveDate, startDate, endDate }
//   GET   /api/vendor-rates/train?vendor&origin&destination
//   POST  /api/vendor-rates/train                     (staff) { vendorType, vendor, train, origin, destination, rateType 1|2,
//                                                     ratePerKg, tripCost, ddAmount, effectiveDate }
//   PATCH /api/vendor-rates/:kind/:id/status          (staff) { active }
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/errors.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import * as svc from './vendorrates.service.js';

const router = Router();
router.use(requireAuth);
const staff = requireRole('admin', 'employee');

const kind = z.enum(['road', 'air', 'train']);
const code = (msg) => z.string().trim().min(1, msg).max(20);
const opt = z.string().trim().max(20).optional().default('');
const date = (msg) => z.string().regex(/^\d{4}-\d{2}-\d{2}$/, msg);
const amount = z.coerce.number({ invalid_type_error: 'Enter a number' }).min(0, 'Cannot be negative').max(100000000).optional().default(0);
const filters = z.object({ vendor: opt, origin: opt, destination: opt });
const route = {
  vendor: code('Select vendor'), origin: code('Enter Origin'), destination: code('Enter Destination'),
  effectiveDate: date('Enter the effective date'),
};

router.get('/options', asyncHandler(async (req, res) => res.json({
  vendorTypes: svc.VENDOR_TYPES, roadModes: svc.ROAD_MODES, ftlRateTypes: svc.FTL_RATE_TYPES, shifts: svc.FLIGHT_SHIFTS,
  trainRateTypes: Object.entries(svc.TRAIN_RATE_TYPES).map(([value, label]) => ({ value, label })), airCharges: svc.AIR_CHARGE_KEYS,
})));
router.get('/vendors', validate({ query: z.object({ kind, type: z.string().trim().toUpperCase().max(20) }) }),
  asyncHandler(async (req, res) => res.json(await svc.vendors(req.user, req.query.kind, req.query.type))));
router.get('/carriers', validate({ query: z.object({ kind: z.enum(['air', 'train']), vendor: code('Select vendor') }) }),
  asyncHandler(async (req, res) => res.json(await svc.vendorCarriers(req.query.kind, req.query.vendor))));
router.get('/cities', validate({ query: z.object({ q: z.string().trim().min(1).max(60) }) }),
  asyncHandler(async (req, res) => res.json(await svc.cities(req.query.q))));

router.get('/road', validate({ query: filters }), asyncHandler(async (req, res) => res.json(await svc.listRoad(req.query))));
router.get('/road/rate', validate({
  query: z.object({ vendor: code('Select vendor'), origin: code('Origin'), destination: code('Destination'), weight: amount, km: amount }),
}), asyncHandler(async (req, res) => res.json(await svc.roadRateFor(req.query.vendor, req.query.origin, req.query.destination, req.query))));
router.post('/road', staff, validate({
  body: z.object({
    vendorType: z.enum(svc.VENDOR_TYPES.road, { errorMap: () => ({ message: 'Select vendor type' }) }), ...route,
    rateMode: z.string().trim().toUpperCase().max(10).optional().default(''), ftlRateType: z.string().trim().max(10).optional().default(''),
    ftlAmount: amount, perKg: amount, perKm: amount,
    startDate: date('Enter the start date'), endDate: date('Enter the end date'),
  }),
}), asyncHandler(async (req, res) => res.status(201).json(await svc.createRoad(req.user, req.body))));

router.get('/air', validate({ query: filters }), asyncHandler(async (req, res) => res.json(await svc.listAir(req.query))));
router.get('/air/:id', validate({ params: z.object({ id: z.coerce.number().int().positive() }) }),
  asyncHandler(async (req, res) => res.json(await svc.getAir(req.params.id))));
router.post('/air', staff, validate({
  body: z.object({
    vendorType: z.enum(svc.VENDOR_TYPES.air, { errorMap: () => ({ message: 'Select Vendor Type!!' }) }), ...route,
    flight: code('Select the flight'), shift: z.enum(svc.FLIGHT_SHIFTS, { errorMap: () => ({ message: 'Select the flight shift' }) }),
    ratePerKg: amount,
    slabs: z.array(z.object({ from: z.coerce.number().min(0), to: z.coerce.number().min(0), rate: z.coerce.number().min(0) })).max(50).default([]),
    charges: z.object(Object.fromEntries(svc.AIR_CHARGE_KEYS.map((k) => [k, amount]))).partial().default({}),
    startDate: date('Enter the start date'), endDate: date('Enter the end date'),
  }),
}), asyncHandler(async (req, res) => res.status(201).json(await svc.createAir(req.user, req.body))));

router.get('/train', validate({ query: filters }), asyncHandler(async (req, res) => res.json(await svc.listTrain(req.query))));
router.post('/train', staff, validate({
  body: z.object({
    vendorType: z.enum(svc.VENDOR_TYPES.train, { errorMap: () => ({ message: 'Select Vendor Type!!' }) }), ...route,
    train: code('Select the train'), rateType: z.enum(['1', '2'], { errorMap: () => ({ message: 'Select the rate type' }) }),
    ratePerKg: amount, tripCost: amount, ddAmount: amount,
  }),
}), asyncHandler(async (req, res) => res.status(201).json(await svc.createTrain(req.user, req.body))));

router.patch('/:kind/:id/status', staff, validate({ params: z.object({ kind, id: z.coerce.number().int().positive() }), body: z.object({ active: z.boolean() }) }),
  asyncHandler(async (req, res) => res.json(await svc.setStatus(req.params.kind, req.params.id, req.body.active))));

export default router;
