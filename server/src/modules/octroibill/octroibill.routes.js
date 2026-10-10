// Octroi bill REST API — replaces Invoice/Octroi_Bills.aspx, Octroi_Bill_Summation, Octroi_Bill_Cancel, Octroi_Bill_Report,
// Octroi_Bill_Print and OctroBillFinalise (empty page).
//
//   GET  /api/octroi-bills/pending-dockets?clientCode&from&to&bookingMode&dockets   the client's dockets booked here, not billed
//   POST /api/octroi-bills                        { clientCode, billDate, octroiNo, bookingMode, remarks, rows[] }
//   GET  /api/octroi-bills?from&to&status&search
//   GET  /api/octroi-bills/:billNo
//   POST /api/octroi-bills/:billNo/submit         { date, receiverName, receiverPhone }
//   POST /api/octroi-bills/:billNo/cancel         { remarks }   until money is received; frees the dockets
//   GET  /api/octroi-bills/clients?q=              active clients of the division
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/errors.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import * as svc from './octroibill.service.js';

const router = Router();
router.use(requireAuth, requireRole('admin', 'employee'));

const date = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const opt = (max) => z.string().trim().max(max).optional().default('');
const money = z.coerce.number().min(0).max(1e9).optional().default(0);
const pct = z.coerce.number().min(0).max(100).optional().default(0);

router.get('/clients', validate({ query: z.object({ q: z.string().trim().min(1).max(60) }) }),
  asyncHandler(async (req, res) => res.json(await svc.clients(req.user, req.query.q))));

router.get('/pending-dockets', validate({
  query: z.object({
    clientCode: z.string().trim().min(1, 'Select the client').max(30), from: date, to: date, bookingMode: opt(10),
    dockets: opt(4000).transform((v) => v.split(/[\s,]+/).map((x) => x.trim().toUpperCase()).filter(Boolean)),
  }),
}), asyncHandler(async (req, res) => res.json(await svc.pendingDockets(req.user, req.query))));

router.post('/', validate({
  body: z.object({
    clientCode: z.string().trim().min(1, 'Select the client').max(30), billDate: date,
    octroiNo: z.string().trim().min(1, 'Enter the octroi no.').max(50), bookingMode: opt(10), remarks: opt(500),
    rows: z.array(z.object({
      docketNo: z.string().trim().min(1).max(30), octroiAmount: z.coerce.number().positive('Enter the octroi amount').max(1e9),
      otherCharges: money, chargePercent: pct, taxPercent: pct,
    })).min(1, 'Select Atleast One Docket').max(500),
  }),
}), asyncHandler(async (req, res) => res.status(201).json(await svc.createBill(req.user, req.body))));

router.get('/', validate({
  query: z.object({ from: date, to: date, status: z.enum(['all', 'Generated', 'Submitted', 'Received', 'Cancelled']).default('all'), search: opt(60) }),
}), asyncHandler(async (req, res) => res.json(await svc.listBills(req.user, req.query))));
router.get('/:billNo', asyncHandler(async (req, res) => res.json(await svc.getBill(req.user, req.params.billNo))));
router.post('/:billNo/submit', validate({
  body: z.object({ date, receiverName: z.string().trim().min(1, 'Enter the receiver name').max(100), receiverPhone: opt(30) }),
}), asyncHandler(async (req, res) => res.json(await svc.submitBill(req.user, req.params.billNo, req.body))));
router.post('/:billNo/cancel', validate({ body: z.object({ remarks: z.string().trim().min(3, 'Give a reason for cancelling').max(500) }) }),
  asyncHandler(async (req, res) => res.json(await svc.cancelBill(req.user, req.params.billNo, req.body.remarks))));

export default router;
