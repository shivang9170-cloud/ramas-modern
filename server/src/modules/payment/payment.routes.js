// Payment Entry REST API - replaces Accounts/Payment_Entry.aspx.
//
//   GET    /api/payments/options                 payment types, main ledgers with their sub-ledgers, drivers + employees
//   GET    /api/payments/payables?q              every postable ledger + how much we owe (the grid)
//   GET    /api/payments/pay-to?q                any postable ledger ("Other Ledger")
//   GET    /api/payments/pay-from                cash / bank accounts (+ balance)
//   GET    /api/payments/advances                advance given / adjusted per person
//   GET    /api/payments/open-bills?ledger       a party's unpaid bills (vendor invoice, challan, opening) with amount due
//   GET    /api/payments/next-no
//   GET    /api/payments?from&to&status&q
//   GET    /api/payments/:no
//   POST   /api/payments                         (staff) kind EXPENSE (main + sub-ledger) / ADVANCE (person) / GENERAL (ledger,
//                                                optional bills[] it settles)
//   POST   /api/payments/adjust-advance          (staff) journal: advance spent on an expense sub-ledger (no cash)
//   POST   /api/payments/:no/cancel              (staff)
// Sub-ledgers are created through POST /api/account-ledgers/:code/sub-ledgers.
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/errors.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import * as svc from './payment.service.js';

const router = Router();
router.use(requireAuth);
const staff = requireRole('admin', 'employee');

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a valid date');
const qOnly = z.object({ q: z.string().trim().max(60).optional().default('') });
const text = (max) => z.string().trim().max(max).optional().default('');
const code = z.string().trim().max(20).optional().default('');
const person = z.object({ type: z.enum(['DRIVER', 'EMPLOYEE']), id: z.string().trim().min(1).max(30) });
const amount = z.coerce.number({ invalid_type_error: 'Enter the amount' }).positive('Amount must be greater than 0');

const createSchema = z.object({
  kind: z.enum(svc.KINDS, { errorMap: () => ({ message: 'Select the payment type' }) }),
  paymentDate: isoDate,
  payFrom: z.string().trim().min(1, 'Select the cash / bank account').max(20),
  amount,
  mainLedger: code, subLedger: code,          // EXPENSE
  person: person.nullable().optional(),       // ADVANCE
  payTo: code,                                // GENERAL
  bills: z.array(z.object({                   // GENERAL: settle these open bills of payTo (rest stays on account)
    billType: z.string().trim().min(1).max(10), billNo: z.string().trim().min(1).max(50), amount: z.coerce.number().positive(),
  })).max(200).optional().default([]),
  refNo: text(50), chequeNo: text(50), narration: text(500),
});

const adjustSchema = z.object({
  paymentDate: isoDate, person, amount,
  mainLedger: z.string().trim().min(1, 'Select the main ledger').max(20),
  subLedger: z.string().trim().min(1, 'Select the sub-ledger').max(20),
  refNo: text(50), narration: text(500),
});

const dateRange = z.object({
  from: isoDate.optional(), to: isoDate.optional(),
  status: z.enum(['active', 'cancelled']).default('active'),
  q: z.string().trim().max(60).optional().default(''),
});
const fyRange = (req) => {
  const fy = req.user.financialYear.split('-');
  return { from: req.query.from || `${fy[0]}-04-01`, to: req.query.to || `${fy[1]}-03-31` };
};

router.get('/options', asyncHandler(async (req, res) => res.json(await svc.options(req.user))));
router.get('/payables', validate({ query: qOnly }), asyncHandler(async (req, res) => res.json(await svc.payables(req.user, req.query))));
router.get('/pay-to', validate({ query: qOnly }), asyncHandler(async (req, res) => res.json(await svc.payToLedgers(req.user, req.query))));
router.get('/pay-from', asyncHandler(async (req, res) => res.json(await svc.payFromAccounts(req.user))));
router.get('/advances', asyncHandler(async (req, res) => res.json(await svc.advances(req.user))));
router.get('/open-bills', validate({ query: z.object({ ledger: z.string().trim().min(1).max(20) }) }),
  asyncHandler(async (req, res) => res.json(await svc.openBills(req.user, req.query.ledger))));
router.get('/next-no',asyncHandler(async (req, res) => res.json(await svc.nextNo(req.user))));
router.get('/', validate({ query: dateRange }), asyncHandler(async (req, res) => {
  res.json(await svc.listPayments(req.user, { ...req.query, ...fyRange(req), search: req.query.q }));
}));
router.get('/:no', asyncHandler(async (req, res) => res.json(await svc.getPayment(req.user, req.params.no.toUpperCase()))));
router.post('/', staff, validate({ body: createSchema }), asyncHandler(async (req, res) => {
  res.status(201).json(await svc.createPayment(req.user, req.body));
}));
router.post('/adjust-advance', staff, validate({ body: adjustSchema }), asyncHandler(async (req, res) => {
  res.status(201).json(await svc.adjustAdvance(req.user, req.body));
}));
router.post('/:no/cancel', staff, validate({ body: z.object({ remarks: text(300) }) }),
  asyncHandler(async (req, res) => res.json(await svc.cancelPayment(req.user, req.params.no.toUpperCase(), req.body.remarks))));

export default router;
