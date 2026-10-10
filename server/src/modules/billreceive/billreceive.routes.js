// Bill receipt REST API — replaces Invoice/Bill_Receive.aspx (To Be Billed client bills; Paid / To Pay bills with kind=paidtopay).
//
//   GET  /api/bill-receipts/options               cash ledger of the branch, bank ledgers, payment modes
//   GET  /api/bill-receipts/clients?q&kind=client|paidtopay   parties with outstanding finalized bills at this branch
//   GET  /api/bill-receipts/pending-bills?clientCode&search   the bills and what is still outstanding on each
//   POST /api/bill-receipts                       { clientCode, receiveDate, mode, bankLedger?, payMode, chequeNo, …, bills[], otherIncome }
//   GET  /api/bill-receipts?from&to&status&search
//   GET  /api/bill-receipts/:brNo                 header, bills, voucher
//   POST /api/bill-receipts/:brNo/cancel          { remarks }   cancels the voucher, the bills reopen
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/errors.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import * as svc from './billreceive.service.js';

const router = Router();
router.use(requireAuth, requireRole('admin', 'employee'));

const date = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const opt = (max) => z.string().trim().max(max).optional().default('');
const amount = z.coerce.number().min(0).max(1e10).optional().default(0);
const kind = z.enum(['client', 'paidtopay']).default('client');   // To Be Billed client bills / Paid & To Pay bills

router.get('/options', asyncHandler(async (req, res) => res.json(await svc.options(req.user))));
router.get('/clients', validate({ query: z.object({ q: z.string().trim().min(1).max(60), kind }) }),
  asyncHandler(async (req, res) => res.json(await svc.clients(req.user, req.query.q, req.query.kind))));
router.get('/pending-bills', validate({ query: z.object({ kind, clientCode: opt(30), search: opt(60) }) }),
  asyncHandler(async (req, res) => res.json(await svc.pendingBills(req.user, req.query))));

router.post('/', validate({
  body: z.object({
    kind, clientCode: z.string().trim().min(1, 'Select the client').max(30), receiveDate: date,
    mode: z.enum(['Cash', 'Bank']), bankLedger: opt(20), payMode: z.enum(['', 'Cheque', 'NEFT', 'RTGS', 'IMPS', 'UPI', 'DD']).default(''),
    chequeNo: opt(50), chequeDate: z.union([date, z.literal('')]).optional().default(''), clientBank: opt(100), manualNo: opt(50), remarks: opt(500),
    otherIncome: amount,
    bills: z.array(z.object({
      billNo: z.string().trim().min(1).max(30), received: amount, tds: amount, deduction: amount,
      roundOff: z.coerce.number().min(-100).max(100).optional().default(0),
    })).min(1, 'There is no bill in list to save').max(200),
  }).superRefine((b, ctx) => {
    if (b.mode === 'Bank' && !b.bankLedger) ctx.addIssue({ code: 'custom', path: ['bankLedger'], message: 'Select the bank' });
    if (b.mode === 'Bank' && ['Cheque', 'DD'].includes(b.payMode) && !b.chequeNo) ctx.addIssue({ code: 'custom', path: ['chequeNo'], message: 'Enter the cheque / DD no.' });
  }),
}), asyncHandler(async (req, res) => res.status(201).json(await svc.createReceipt(req.user, req.body))));

router.get('/', validate({
  query: z.object({ from: date, to: date, status: z.enum(['active', 'cancelled']).default('active'), search: opt(60) }),
}), asyncHandler(async (req, res) => res.json(await svc.listReceipts(req.user, req.query))));
router.get('/:brNo', asyncHandler(async (req, res) => res.json(await svc.getReceipt(req.user, req.params.brNo))));
router.post('/:brNo/cancel', validate({ body: z.object({ remarks: z.string().trim().min(3, 'Give a reason for cancelling').max(500) }) }),
  asyncHandler(async (req, res) => res.json(await svc.cancelReceipt(req.user, req.params.brNo, req.body.remarks))));

export default router;
