// Arrival REST API — replaces Operation/Arrival_Entry.aspx (branch wise), Arrival_Entry_Cancel.aspx
// and Arrival_Entry_View.aspx.
//
//   GET  /api/arrivals/pending-challans?from&to
//   GET  /api/arrivals/challans/:challanNo      manifests + dockets waiting at this branch
//   GET  /api/arrivals/challans/:challanNo/excess/:docketNo   a docket that came on this truck though its manifest is on another challan
//   POST /api/arrivals                          { ..., dockets[], excess[] }
//   GET  /api/arrivals?from&to&status&search&scope=mine|all
//   GET  /api/arrivals/:arrivalNo
//   POST /api/arrivals/:arrivalNo/cancel
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/errors.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import * as svc from './arrival.service.js';

const router = Router();
router.use(requireAuth, requireRole('admin', 'employee', 'franchisee'));

const date = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

router.get('/pending-challans', validate({ query: z.object({ from: date, to: date }) }),
  asyncHandler(async (req, res) => res.json(await svc.pendingChallans(req.user, req.query))));

router.get('/challans/:challanNo', asyncHandler(async (req, res) => res.json(await svc.challanForArrival(req.user, req.params.challanNo))));
router.get('/challans/:challanNo/excess/:docketNo',
  asyncHandler(async (req, res) => res.json(await svc.excessDocket(req.user, req.params.challanNo, req.params.docketNo.trim().toUpperCase()))));

const createSchema = z.object({
  challanNo: z.string().trim().min(1).max(30),
  receiveDate: date,
  receiveTime: z.string().trim().regex(/^\d{2}:\d{2}$/, 'Use HH:mm'),
  closingKm: z.coerce.number().int().min(0).max(1e8).optional(),
  message: z.string().trim().max(500).optional().default(''),
  dockets: z.array(z.object({
    manifestNo: z.string().trim().min(1).max(30),
    docketNo: z.string().trim().min(1).max(30),
    packages: z.coerce.number().int().min(1, 'Received packets cannot be 0'),
    weight: z.coerce.number().min(0).max(1e7).optional(),
    remarks: z.string().trim().max(500).optional().default(''),
  })).max(2000).default([]),
  excess: z.array(z.object({
    docketNo: z.string().trim().min(1).max(30),
    weight: z.coerce.number().min(0).max(1e7).optional(),
    remarks: z.string().trim().max(500).optional().default(''),
  })).max(500).default([]),
}).refine((b) => b.dockets.length + b.excess.length > 0, { path: ['dockets'], message: 'Select at least one docket' });

router.post('/', validate({ body: createSchema }), asyncHandler(async (req, res) => {
  res.status(201).json(await svc.createArrival(req.user, req.body));
}));

router.get('/',
  validate({ query: z.object({
    from: date, to: date,
    status: z.enum(['active', 'cancelled']).default('active'),
    search: z.string().trim().max(30).optional().default(''),
    scope: z.enum(['mine', 'all']).default('mine'),
  }) }),
  asyncHandler(async (req, res) => res.json(await svc.listArrivals(req.user, req.query))));

router.get('/:arrivalNo', asyncHandler(async (req, res) => res.json(await svc.getArrival(req.user, req.params.arrivalNo))));

router.post('/:arrivalNo/cancel', requireRole('admin', 'employee'), asyncHandler(async (req, res) => {
  res.json(await svc.cancelArrival(req.user, req.params.arrivalNo));
}));

export default router;
