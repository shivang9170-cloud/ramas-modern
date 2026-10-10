// Vehicle Master REST API — replaces Master/Vechile_Master.aspx and Master/View_Vechile_Master.aspx.
//
//   GET   /api/vehicles/options            vendor types, vehicle types (with capacity …), makers, branches, fuel, AMC
//   GET   /api/vehicles/vendors?type=      vendors of one kind (Self / Vendor / MARKET) in the user's division
//   GET   /api/vehicles/routes?q=          route search (attached vehicles)
//   GET   /api/vehicles?q&status&vendorType
//   GET   /api/vehicles/:no
//   POST  /api/vehicles                    (staff)
//   PUT   /api/vehicles/:no                (staff; the number cannot change)
//   PATCH /api/vehicles/:no/status         (staff) { active }
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/errors.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import * as svc from './vehicles.service.js';

const router = Router();
router.use(requireAuth);
const staff = requireRole('admin', 'employee');

const up = (max) => z.string().trim().max(max).optional().default('').transform((v) => v.toUpperCase());
const text = (max) => z.string().trim().max(max).optional().default('');
const money = z.union([z.number(), z.string()]).optional().nullable()
  .transform((v) => (v === '' || v === null || v === undefined ? null : Number(v)))
  .refine((v) => v === null || (Number.isFinite(v) && v >= 0), 'Enter an amount');

// Indian registration numbers (DL01AB1234, MH12A1234, 22BH1234AA); spaces and dashes are ignored.
const vehicleNo = z.string().trim().transform((v) => v.toUpperCase().replace(/[\s-]/g, ''))
  .refine((v) => /^([A-Z]{2}\d{1,2}[A-Z]{0,3}\d{4}|\d{2}BH\d{4}[A-Z]{1,2})$/.test(v), 'Vehicle no.: e.g. DL01AB1234');

const vehicleSchema = z.object({
  vendorType: z.enum(svc.VENDOR_TYPES.map((t) => t.value), { errorMap: () => ({ message: 'Select vendor type' }) }),
  vendorCode: z.string().trim().min(1, 'Select vendor').max(20),
  ownerName: z.string().trim().min(1, 'Enter owner name').max(100).transform((v) => v.toUpperCase()),
  vehicleType: z.string().trim().min(1, 'Select vehicle type').max(20),
  containerSize: z.string().trim().min(1, 'Enter container size').max(50).transform((v) => v.toUpperCase()),
  chassisNo: z.string().trim().min(1, 'Enter chassis no.').max(50).transform((v) => v.toUpperCase()),
  engineNo: z.string().trim().min(1, 'Enter engine no.').max(50).transform((v) => v.toUpperCase()),
  make: z.string().trim().min(1, 'Enter make').max(50),
  model: z.string().trim().min(1, 'Enter model').max(50),
  makerId: z.coerce.number().int().positive().optional().nullable().transform((v) => v ?? null),
  fuelType: z.enum(svc.FUEL_TYPES, { errorMap: () => ({ message: 'Select fuel type' }) }),
  tankCapacity: z.string().trim().regex(/^\d{1,6}$/, 'Tank capacity: litres, digits only'),
  amc: z.enum(svc.AMC_TYPES.map((a) => a.value), { errorMap: () => ({ message: 'Select AMC' }) }),
  branch: z.string().trim().min(1, 'Select branch').max(20),
  routes: z.array(z.string().trim().min(1).max(20)).max(10, 'At most 10 routes').default([]),
  dealerName: up(100),
  dealerAddress: up(500),
  purchaseDate: z.string().optional().default('').refine((v) => !v || /^\d{4}-\d{2}-\d{2}$/.test(v), 'Invalid purchase date')
    .refine((v) => !v || v <= new Date().toISOString().slice(0, 10), 'Purchase date cannot be in the future'),
  invoiceNo: text(50),
  invoiceValue: money,
  dealMaturityAmount: money,
  active: z.boolean().default(true),
});
const createSchema = vehicleSchema.extend({ vehicleNo });

router.get('/options', asyncHandler(async (req, res) => res.json(await svc.options())));
router.get('/vendors', validate({ query: z.object({ type: z.enum(svc.VENDOR_TYPES.map((t) => t.value)) }) }),
  asyncHandler(async (req, res) => res.json(await svc.vendors(req.user, req.query.type))));
router.get('/routes', validate({ query: z.object({ q: z.string().trim().max(60).optional().default('') }) }),
  asyncHandler(async (req, res) => res.json(await svc.routes(req.query.q))));
router.get('/', validate({
  query: z.object({
    q: z.string().trim().max(60).optional().default(''),
    status: z.enum(['all', 'active', 'inactive']).default('all'),
    vendorType: z.string().trim().max(20).optional().default(''),
  }),
}), asyncHandler(async (req, res) => res.json(await svc.listVehicles(req.user, req.query))));
router.get('/:no', asyncHandler(async (req, res) => res.json(await svc.getVehicle(req.user, req.params.no.toUpperCase()))));
router.post('/', staff, validate({ body: createSchema }), asyncHandler(async (req, res) => {
  res.status(201).json(await svc.createVehicle(req.user, req.body));
}));
router.put('/:no', staff, validate({ body: vehicleSchema }), asyncHandler(async (req, res) => {
  res.json(await svc.updateVehicle(req.user, req.params.no.toUpperCase(), req.body));
}));
router.patch('/:no/status', staff, validate({ body: z.object({ active: z.boolean() }) }), asyncHandler(async (req, res) => {
  res.json(await svc.setStatus(req.user, req.params.no.toUpperCase(), req.body.active));
}));

export default router;
