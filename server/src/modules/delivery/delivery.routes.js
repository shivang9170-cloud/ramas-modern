// Delivery status REST API — replaces Operation/deliverystatusentry.aspx, deliverystatusentry_Cancel.aspx,
// deliverystatusentry_view.aspx.
//
//   GET  /api/delivery/options                  statuses + undelivered reasons
//   GET  /api/delivery/drs                      DRS at this branch with dockets still without a status
//   GET  /api/delivery/drs/:drsNo               those dockets
//   GET  /api/delivery/godown                   godown-delivery dockets waiting at this branch
//   POST /api/delivery                          { mode: DRS|GODOWN, drsNo?, entries: [...] }
//   GET  /api/delivery?from&to&status&search&scope=mine|all
//   POST /api/delivery/drs/:drsNo/cancel        admin only (legacy rule)
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/errors.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import * as svc from './delivery.service.js';

const router = Router();
router.use(requireAuth, requireRole('admin', 'employee', 'franchisee'));

const date = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

router.get('/options', asyncHandler(async (req, res) => res.json(await svc.options())));
router.get('/drs', asyncHandler(async (req, res) => res.json(await svc.openDrs(req.user))));
router.get('/drs/:drsNo', asyncHandler(async (req, res) => res.json(await svc.drsDockets(req.user, req.params.drsNo))));
router.get('/godown', asyncHandler(async (req, res) => res.json(await svc.godownDockets(req.user))));

const entry = z.object({
  docketNo: z.string().trim().min(1).max(30),
  status: z.enum(svc.STATUSES.map((x) => x.value)),
  date,
  time: z.string().trim().regex(/^\d{2}:\d{2}$/, 'Use HH:mm'),
  receiverName: z.string().trim().max(100).optional().default(''),
  receiverPhone: z.string().trim().regex(/^$|^\d{10}$/, 'Phone must be 10 digits').optional().default(''),
  remarks: z.string().trim().max(500).optional().default(''),
  reason: z.string().trim().max(100).optional().default(''),
}).superRefine((e, ctx) => {
  if (e.status === 'DLVRD' && !e.receiverName) ctx.addIssue({ code: 'custom', path: ['receiverName'], message: `${e.docketNo}: enter the receiver name` });
});

const saveSchema = z.object({
  mode: z.enum(['DRS', 'GODOWN']).default('DRS'),
  drsNo: z.string().trim().max(30).optional(),
  entries: z.array(entry).min(1, 'Select at least one docket').max(500),
}).superRefine((b, ctx) => {
  if (b.mode === 'DRS' && !b.drsNo) ctx.addIssue({ code: 'custom', path: ['drsNo'], message: 'Select DRS no.' });
});

router.post('/', validate({ body: saveSchema }), asyncHandler(async (req, res) => {
  res.status(201).json(await svc.saveStatuses(req.user, req.body));
}));

router.get('/',
  validate({ query: z.object({
    from: date, to: date,
    status: z.enum(['active', 'cancelled']).default('active'),
    search: z.string().trim().max(30).optional().default(''),
    scope: z.enum(['mine', 'all']).default('mine'),
  }) }),
  asyncHandler(async (req, res) => res.json(await svc.listStatuses(req.user, req.query))));

router.post('/drs/:drsNo/cancel', requireRole('admin'), asyncHandler(async (req, res) => {
  res.json(await svc.cancelDrsStatuses(req.user, req.params.drsNo));
}));

export default router;
