// Pickup (PRS) REST API — replaces Operation/pickup_entry.aspx, Pickup_Entry_Cancel.aspx,
// Pickup_EntryView.aspx.
//
//   GET  /api/pickups/options                 locations + pickup staff + franchisees for the current branch
//   GET  /api/pickups/pending-dockets?...     dockets waiting for pickup
//   POST /api/pickups                         create a pickup
//   GET  /api/pickups?from&to&status&search   list (usp_search_PickupEntry)
//   GET  /api/pickups/:no                     one pickup with its dockets
//   POST /api/pickups/:no/cancel              cancel
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/errors.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import * as svc from './pickup.service.js';

const router = Router();
router.use(requireAuth, requireRole('admin', 'employee', 'franchisee'));

const date = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

router.get('/options', asyncHandler(async (req, res) => res.json(await svc.options(req.user))));

router.get('/pending-dockets',
  validate({ query: z.object({
    from: date, to: date,
    docType: z.enum(['1', '2']).default('2'),
    dockets: z.string().trim().max(2000).optional().default(''),
  }) }),
  asyncHandler(async (req, res) => {
    const { from, to, docType, dockets } = req.query;
    res.json(await svc.pendingDockets(req.user, { from, to, docType, dockets: dockets.split(/[\s,]+/) }));
  }));

const createSchema = z.object({
  pickupDate: date,
  pickupTime: z.string().trim().regex(/^\d{2}:\d{2}$/, 'Use HH:mm'),
  docType: z.enum(['1', '2']),
  pickupBy: z.string().trim().max(50).optional().default(''),
  pickupByMobile: z.string().trim().max(20).optional().default(''),
  franchiseeCode: z.string().trim().max(50).optional().default(''),
  dockets: z.array(z.object({
    docketNo: z.string().trim().min(1).max(30),
    locationCode: z.string().trim().min(1, 'Select a location').max(30),
    packages: z.coerce.number().int().min(0),
    weight: z.coerce.number().min(0),
    freight: z.coerce.number().min(0),
  })).min(1, 'Select at least one docket').max(500),
});

router.post('/', validate({ body: createSchema }), asyncHandler(async (req, res) => {
  res.status(201).json(await svc.createPickup(req.user, req.body));
}));

router.get('/',
  validate({ query: z.object({
    from: date, to: date,
    status: z.enum(['active', 'cancelled']).default('active'),
    search: z.string().trim().max(30).optional().default(''),
  }) }),
  asyncHandler(async (req, res) => res.json(await svc.listPickups(req.user, req.query))));

router.get('/:no', asyncHandler(async (req, res) => res.json(await svc.getPickup(req.user, req.params.no))));

router.post('/:no/cancel', requireRole('admin', 'employee'), asyncHandler(async (req, res) => {
  res.json(await svc.cancelPickup(req.user, req.params.no));
}));

export default router;
