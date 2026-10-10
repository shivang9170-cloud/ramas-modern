// DRS REST API — replaces Operation/Drs_Entry.aspx, Drs_Entry_Cancel.aspx, Drs_Entry_View.aspx.
//
//   GET  /api/drs/options                         delivery staff at this branch, franchisees a DRS can go to
//   GET  /api/drs/pending-dockets?from&to&dockets=D1,D2
//   POST /api/drs
//   GET  /api/drs?from&to&status&search&scope=mine|all
//   GET  /api/drs/:drsNo
//   POST /api/drs/:drsNo/cancel
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/errors.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import * as svc from './drs.service.js';

const router = Router();
router.use(requireAuth, requireRole('admin', 'employee', 'franchisee'));

const date = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const mobile = z.string().trim().regex(/^$|^\d{10}$/, 'Mobile no. must be 10 digits').optional().default('');

router.get('/options', asyncHandler(async (req, res) => res.json(await svc.options(req.user))));

router.get('/pending-dockets',
  validate({ query: z.object({
    from: date, to: date,
    dockets: z.string().trim().max(2000).optional().default('')
      .transform((v) => v.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean)),
  }) }),
  asyncHandler(async (req, res) => res.json(await svc.pendingDockets(req.user, req.query))));

const createSchema = z.object({
  drsDate: date,
  drsTime: z.string().trim().regex(/^\d{2}:\d{2}$/, 'Use HH:mm'),
  deliveredBy: z.string().trim().min(1, 'Delivered by is required').max(100),
  deliveredByMobile: mobile,
  driverName: z.string().trim().max(100).optional().default(''),
  vehicleNo: z.string().trim().toUpperCase().max(20).optional().default(''),
  franchiseeCode: z.string().trim().max(20).optional().default(''),   // DRS given to a franchisee
  dockets: z.array(z.object({
    docketNo: z.string().trim().min(1).max(30),
    challanNo: z.string().trim().max(30).optional().default(''),
    packages: z.coerce.number().int().min(1, 'At least one packet'),
  })).min(1, 'Select at least one docket').max(500),
});

router.post('/', validate({ body: createSchema }), asyncHandler(async (req, res) => {
  res.status(201).json(await svc.createDrs(req.user, req.body));
}));

router.get('/',
  validate({ query: z.object({
    from: date, to: date,
    status: z.enum(['active', 'cancelled']).default('active'),
    search: z.string().trim().max(30).optional().default(''),
    scope: z.enum(['mine', 'all']).default('mine'),
  }) }),
  asyncHandler(async (req, res) => res.json(await svc.listDrs(req.user, req.query))));

router.get('/:drsNo', asyncHandler(async (req, res) => res.json(await svc.getDrs(req.user, req.params.drsNo))));

router.post('/:drsNo/cancel', requireRole('admin', 'employee'), asyncHandler(async (req, res) => {
  res.json(await svc.cancelDrs(req.user, req.params.drsNo));
}));

export default router;
