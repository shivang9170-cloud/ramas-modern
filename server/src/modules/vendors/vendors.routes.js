// Vendor Master REST API — replaces Master/Vendor_Entry.aspx.
//
//   GET    /api/vendors/options          vendor types, states, branches, modes, approvers, divisions
//   GET    /api/vendors/cities?state=
//   GET    /api/vendors?q&status&type
//   GET    /api/vendors/:code
//   POST   /api/vendors                  (staff)
//   PUT    /api/vendors/:code            (staff; the name cannot change — it is part of the ledger name)
//   DELETE /api/vendors/:code            (staff; refused while the vendor is in use)
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/errors.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { cities } from '../branches/branches.service.js';
import * as svc from './vendors.service.js';

const router = Router();
router.use(requireAuth);
const staff = requireRole('admin', 'employee');

const up = (max) => z.string().trim().max(max).optional().default('').transform((v) => v.toUpperCase());
const text = (max) => z.string().trim().max(max).optional().default('');
const pattern = (re, msg, max) => z.string().trim().toUpperCase().max(max).optional().default('').refine((v) => !v || re.test(v), msg);

const vendorSchema = z.object({
  name: z.string().trim().max(100).optional().default('').transform((v) => v.toUpperCase()),
  vendorType: z.enum(svc.VENDOR_TYPES.map((t) => t.value), { errorMap: () => ({ message: 'Select vendor type' }) }),
  modes: z.array(z.string().trim().min(1).max(10)).min(1, 'Tick at least one mode (road, train, air)').max(10),
  branch: z.string().trim().min(1, 'Select branch').max(20),
  address: up(500),
  stateCode: z.string().trim().min(1, 'Select state').max(10),
  cityCode: z.string().trim().min(1, 'Select city').max(10),
  pinCode: pattern(/^\d{6}$/, 'PIN code: 6 digits', 6),
  contactPerson: z.string().trim().min(1, 'Enter contact person').max(100).transform((v) => v.toUpperCase()),
  pan: pattern(/^[A-Z]{5}\d{4}[A-Z]$/, 'PAN: 10 characters (AAAAA9999A)', 10),
  email: z.string().trim().max(100).optional().default('').refine((v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), 'Invalid e-mail'),
  phone: z.string().trim().regex(/^\d{6,15}$/, 'Phone: 6–15 digits'),
  fax: text(50),
  approvalDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter approval date')
    .refine((v) => v <= new Date().toISOString().slice(0, 10), 'Approval date cannot be in the future'),
  approvedBy: z.string().trim().min(1, 'Select who approved the vendor').max(50),
  confLetterNo: up(50),
  remarks: up(500),
  tdsPercent: z.coerce.number({ invalid_type_error: 'Enter TDS %' }).min(0, 'TDS % cannot be negative').max(99.99, 'TDS % must be below 100'),
  sapCode: text(20),
  manualCode: text(20),
  gstRegistered: z.boolean().default(true),
  gstin: pattern(/^\d{2}[A-Z0-9]{13}$/, 'GSTIN must be 15 characters starting with the state code', 15),
  fastTag: z.boolean().default(false),
  ifsc: pattern(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'IFSC: 11 characters (e.g. HDFC0001234)', 11),
  accountNo: z.string().trim().max(30).optional().default('').refine((v) => !v || /^\d{6,20}$/.test(v), 'Account no.: digits only'),
  divisions: z.array(z.string().trim().min(1).max(20)).min(1, 'Tick at least one division').max(20),
  active: z.boolean().default(true),
});
const createSchema = vendorSchema.refine((b) => b.name.length >= 2, { path: ['name'], message: 'Enter vendor name' });

router.get('/options', asyncHandler(async (req, res) => res.json(await svc.options())));
router.get('/cities', validate({ query: z.object({ state: z.string().trim().min(1).max(10) }) }),
  asyncHandler(async (req, res) => res.json(await cities(req.query.state))));
router.get('/', validate({
  query: z.object({
    q: z.string().trim().max(60).optional().default(''),
    status: z.enum(['all', 'active', 'inactive']).default('all'),
    type: z.string().trim().max(20).optional().default(''),
  }),
}), asyncHandler(async (req, res) => res.json(await svc.listVendors(req.user, req.query))));
router.get('/:code', asyncHandler(async (req, res) => res.json(await svc.getVendor(req.user, req.params.code.toUpperCase()))));
router.post('/', staff, validate({ body: createSchema }), asyncHandler(async (req, res) => {
  res.status(201).json(await svc.createVendor(req.user, req.body));
}));
router.put('/:code', staff, validate({ body: vendorSchema }), asyncHandler(async (req, res) => {
  res.json(await svc.updateVendor(req.user, req.params.code.toUpperCase(), req.body));
}));
router.delete('/:code', staff, asyncHandler(async (req, res) => {
  res.json(await svc.deleteVendor(req.user, req.params.code.toUpperCase()));
}));

export default router;
