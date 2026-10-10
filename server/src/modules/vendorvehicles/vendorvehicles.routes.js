// Vendor and vehicle REST API — replaces Setting/Vendor_and_vehicle.aspx.
//
//   GET   /api/vendor-vehicles/options                modes, vehicle names, capacities, trains
//   GET   /api/vendor-vehicles/vendors?type=          VENDOR / SELF
//   GET   /api/vendor-vehicles?vendorType&vendor&mode&search
//   POST  /api/vendor-vehicles                        (staff) { vendorType, vendor, mode, rows[] } — road / air / train rows by mode
//   PATCH /api/vendor-vehicles/:id/status             (staff) { active }
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/errors.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import * as svc from './vendorvehicles.service.js';

const router = Router();
router.use(requireAuth);
const staff = requireRole('admin', 'employee');

const vendorType = z.enum(Object.keys(svc.VENDOR_TYPES), { errorMap: () => ({ message: 'Select vendor type' }) });
const text = (max) => z.string().trim().max(max).optional().default('');

router.get('/options', asyncHandler(async (req, res) => res.json(await svc.options())));
router.get('/vendors', validate({ query: z.object({ type: vendorType }) }), asyncHandler(async (req, res) => res.json(await svc.vendors(req.query.type))));
router.get('/', validate({
  query: z.object({ vendorType: z.union([vendorType, z.literal('')]).optional().default(''), vendor: text(20), mode: text(5), search: text(40) }),
}), asyncHandler(async (req, res) => res.json(await svc.list(req.query))));
router.post('/', staff, validate({
  body: z.object({
    vendorType, vendor: z.string().trim().min(1, 'Select vendor').max(20), mode: z.string().trim().min(1, 'Select mode').max(5),
    rows: z.array(z.object({
      vehicleNo: text(30), vehicleName: text(100), trainCode: text(20), direction: z.enum(['UP', 'DOWN']).optional(), trainType: text(30),
      truckNo: text(30), engineNo: text(50), chassisNo: text(50), model: text(50), make: text(50), validity: text(20),
      capacity: text(50), vehicleCapacity: z.coerce.number().min(0).max(1000000).optional().default(0), containerSize: text(30), state: text(50),
    })).min(1, 'Please add the details').max(100),
  }),
}), asyncHandler(async (req, res) => res.status(201).json(await svc.create(req.user, req.body))));
router.patch('/:id/status', staff, validate({ params: z.object({ id: z.coerce.number().int().positive() }), body: z.object({ active: z.boolean() }) }),
  asyncHandler(async (req, res) => res.json(await svc.setStatus(req.params.id, req.body.active))));

export default router;
