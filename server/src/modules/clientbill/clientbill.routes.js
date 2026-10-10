// Client bill REST API — replaces Invoice/Client_Bill_GST.aspx, Client_Bill.aspx, Client_Bill_Cancel.aspx and the bill
// views / prints (Client_Bill_PrintGST, Client_Bill_Print, client_bill_ReportGST, client_bill_Report).
//
//   GET  /api/client-bills/options                  service types + SAC codes, booking modes, tax types
//   GET  /api/client-bills/clients?q&billType       the branch's clients (To Be Billed) or consignors / consignees (Paid / To Pay)
//   GET  /api/client-bills/pending-dockets?clientCode&from&to&taxType&bookingMode&delivery&dockets&fromCity&toCity
//   POST /api/client-bills                          { billType, clientCode, billDate, dueDate?, serviceType, taxType, from, to, dockets[], … }
//   GET  /api/client-bills?from&to&status&search    the branch's bills of the login year
//   GET  /api/client-bills/:billNo                  header, client, branch, dockets (view / print)
//   POST /api/client-bills/:billNo/cancel           { remarks }   only while not submitted / finalized / paid
// Submission (Client_Bill_Summation) and finalize (Bill_Finalized, Bill_Finalized_Cancel, Client_billFinalise_view):
//   GET  /api/client-bills/submission?stage=pending|done&clientCode&search   bills of clients submitted at this branch
//   POST /api/client-bills/submission               { bills[], date, receiverName, receiverPhone, remarks }
//   POST /api/client-bills/:billNo/unsubmit         back to generated while not finalized
//   GET  /api/client-bills/finalize?stage=pending|done&by=billing|collection|paidtopay&search
//   POST /api/client-bills/finalize                 { bills[], date, by }   voucher Dr client BILLED / Cr client UNBILLED
//   POST /api/client-bills/:billNo/unfinalize       back to submitted while nothing is received
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/errors.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import * as svc from './clientbill.service.js';
import * as stages from './billstages.service.js';

const router = Router();
router.use(requireAuth, requireRole('admin', 'employee'));

const date = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const opt = (max) => z.string().trim().max(max).optional().default('');
const taxType = z.enum(['GST', 'IGST', 'NA']);
const billType = z.enum(['To Be Billed', 'Paid', 'To Pay']).default('To Be Billed');
const list = z.string().trim().max(4000).optional().default('').transform((v) => v.split(/[\s,]+/).map((x) => x.trim().toUpperCase()).filter(Boolean));

router.get('/options', asyncHandler(async (req, res) => res.json(await svc.options())));
router.get('/clients', validate({ query: z.object({ q: z.string().trim().min(1).max(60), billType }) }),
  asyncHandler(async (req, res) => res.json(await svc.searchParties(req.user, req.query.q, req.query.billType))));

router.get('/pending-dockets', validate({
  query: z.object({
    billType, clientCode: z.string().trim().min(1, 'Select the client').max(30), from: date, to: date, taxType,
    bookingMode: opt(10), delivery: z.enum(['All', 'DLVRD', 'UNDELIVERED']).default('All'), dockets: list,
    fromCity: opt(20), toCity: opt(100),
  }),
}), asyncHandler(async (req, res) => res.json(await svc.pendingDockets(req.user, req.query))));

router.post('/', validate({
  body: z.object({
    billType, clientCode: z.string().trim().min(1, 'Select Client Name').max(30),
    billDate: date, dueDate: z.union([date, z.literal('')]).optional().default(''),
    serviceType: z.string().trim().min(1).max(50), taxType, bookingMode: opt(10), rateOn: opt(30),
    from: date, to: date, address: opt(500), manualBillNo: opt(50), remarks: opt(500), docsEnclosed: opt(200),
    dockets: z.array(z.string().trim().min(1).max(30)).min(1, 'Select Atleast One Docket').max(2000),
  }).refine((b) => b.from <= b.to, { path: ['to'], message: 'From date must not be after to date' }),
}), asyncHandler(async (req, res) => res.status(201).json(await svc.createBill(req.user, req.body))));

router.get('/', validate({
  query: z.object({ from: date, to: date, status: z.enum(['active', 'cancelled']).default('active'), search: opt(60), billType: z.enum(['', 'To Be Billed', 'Paid', 'To Pay']).default('') }),
}), asyncHandler(async (req, res) => res.json(await svc.listBills(req.user, req.query))));

const bills = z.array(z.string().trim().min(1).max(30)).min(1, 'Select at least one bill').max(500)
  .refine((b) => new Set(b).size === b.length, 'The same bill is listed twice');
const stage = z.enum(['pending', 'done']).default('pending');

router.get('/submission', validate({ query: z.object({ stage, clientCode: opt(30), search: opt(60) }) }),
  asyncHandler(async (req, res) => res.json(await stages.submissionList(req.user, req.query))));
router.post('/submission', validate({
  body: z.object({ bills, date, receiverName: z.string().trim().min(1, 'Enter the receiver name').max(100), receiverPhone: opt(30), remarks: opt(500) }),
}), asyncHandler(async (req, res) => res.json(await stages.submitBills(req.user, req.body))));
router.get('/finalize', validate({ query: z.object({ stage, by: z.enum(['billing', 'collection', 'paidtopay']).default('billing'), search: opt(60) }) }),
  asyncHandler(async (req, res) => res.json(await stages.finalizeList(req.user, req.query))));
router.post('/finalize', validate({ body: z.object({ bills, date, by: z.enum(['billing', 'collection', 'paidtopay']).default('billing') }) }),
  asyncHandler(async (req, res) => res.json(await stages.finalizeBills(req.user, req.body))));
router.post('/:billNo/unsubmit', asyncHandler(async (req, res) => res.json(await stages.unsubmitBill(req.user, req.params.billNo))));
router.post('/:billNo/unfinalize', asyncHandler(async (req, res) => res.json(await stages.unfinalizeBill(req.user, req.params.billNo))));

router.get('/:billNo', asyncHandler(async (req, res) => res.json(await svc.getBill(req.user, req.params.billNo))));
router.post('/:billNo/cancel', validate({ body: z.object({ remarks: z.string().trim().min(3, 'Give a reason for cancelling').max(500) }) }),
  asyncHandler(async (req, res) => res.json(await svc.cancelBill(req.user, req.params.billNo, req.body.remarks))));

export default router;
