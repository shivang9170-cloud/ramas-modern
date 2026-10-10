// Miscellaneous / warehouse bill REST API (:kind = misc | warehouse) — replaces Invoice/Miscellaneous_Bill, Warehouse_bill,
// MiscellaneousBillSubmission, WareHouseBillSubmission, MiscellaneousBillFinalise, WarehouseBillFinalise, MiscellaneousBillCancel,
// warehouseBillCancel, miscellaneousbill_ReportView, WareHouseBill_ReportView, MiscellaneousBillPrint, WarehousePrint.
//
//   GET  /api/other-bills/:kind/options                GST slabs, SAC codes, service types / service for, months
//   GET  /api/other-bills/:kind/clients?q=             the branch's clients (intrastate / interstate)
//   POST /api/other-bills/:kind                        { clientCode, billDate, dueDate, month, year, serviceType, serviceFor, sac, slab, taxType, quantity, rate, remarks }
//   GET  /api/other-bills/:kind?from&to&status&search
//   GET  /api/other-bills/:kind/:billNo
//   POST /api/other-bills/:kind/:billNo/submit         { date, receiverName, receiverPhone }
//   POST /api/other-bills/:kind/:billNo/finalize       { date }   voucher Dr client BILLED / Cr OUTPUT GST + booking income
//   POST /api/other-bills/:kind/:billNo/unfinalize
//   POST /api/other-bills/:kind/:billNo/cancel         { remarks }   until finalized
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/errors.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import * as svc from './otherbill.service.js';

const router = Router();
router.use(requireAuth, requireRole('admin', 'employee'));

const date = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const opt = (max) => z.string().trim().max(max).optional().default('');
const kind = validate({ params: z.object({ kind: z.enum(['misc', 'warehouse']) }).passthrough() });

router.get('/:kind/options', kind, asyncHandler(async (req, res) => res.json(await svc.options())));
router.get('/:kind/clients', kind, validate({ query: z.object({ q: z.string().trim().min(1).max(60) }) }),
  asyncHandler(async (req, res) => res.json(await svc.clients(req.user, req.query.q))));

router.post('/:kind', kind, validate({
  body: z.object({
    clientCode: z.string().trim().min(1, 'Please Select Vendor for Invoice').max(30), billDate: date,
    dueDate: z.union([date, z.literal('')]).optional().default(''),
    month: z.enum(svc.MONTHS), year: z.string().trim().regex(/^\d{4}$/, 'Year as YYYY'),
    serviceType: z.enum(['GTA', 'Courier']).default('GTA'), serviceFor: z.string().trim().min(1, 'Select service for').max(60),
    sac: z.string().trim().min(1, 'Select the SAC').max(20), slab: z.coerce.number().int().positive(),
    taxType: z.enum(['Intrastate', 'Interstate']), quantity: z.coerce.number().positive().max(1e7), rate: z.coerce.number().positive().max(1e9),
    remarks: opt(500),
  }),
}), asyncHandler(async (req, res) => res.status(201).json(await svc.createBill(req.user, req.params.kind, req.body))));

router.get('/:kind', kind, validate({
  query: z.object({ from: date, to: date, status: z.enum(['all', 'Generated', 'Submitted', 'Finalized', 'Cancelled']).default('all'), search: opt(60) }),
}), asyncHandler(async (req, res) => res.json(await svc.listBills(req.user, req.params.kind, req.query))));
router.get('/:kind/:billNo', kind, asyncHandler(async (req, res) => res.json(await svc.getBill(req.user, req.params.kind, req.params.billNo))));
router.post('/:kind/:billNo/submit', kind, validate({
  body: z.object({ date, receiverName: z.string().trim().min(1, 'Enter the receiver name').max(100), receiverPhone: opt(30) }),
}), asyncHandler(async (req, res) => res.json(await svc.submitBill(req.user, req.params.kind, req.params.billNo, req.body))));
router.post('/:kind/:billNo/finalize', kind, validate({ body: z.object({ date }) }),
  asyncHandler(async (req, res) => res.json(await svc.finalizeBill(req.user, req.params.kind, req.params.billNo, req.body))));
router.post('/:kind/:billNo/unfinalize', kind,
  asyncHandler(async (req, res) => res.json(await svc.unfinalizeBill(req.user, req.params.kind, req.params.billNo))));
router.post('/:kind/:billNo/cancel', kind, validate({ body: z.object({ remarks: z.string().trim().min(3, 'Give a reason for cancelling').max(500) }) }),
  asyncHandler(async (req, res) => res.json(await svc.cancelBill(req.user, req.params.kind, req.params.billNo, req.body.remarks))));

export default router;
