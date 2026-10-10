// Contra Entry REST API — replaces Accounts/Contra_Entry.aspx.
//
//   GET    /api/contra-entries/ledgers?q         cash / bank ledgers (+ current balance)
//   GET    /api/contra-entries/ledger-balance/:code
//   GET    /api/contra-entries/next-no           preview of the next contra number
//   GET    /api/contra-entries?from&to&status&q  saved contras
//   GET    /api/contra-entries/:no
//   POST   /api/contra-entries                   (staff) debits[] + credits[], must balance
//   POST   /api/contra-entries/:no/cancel        (staff)
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/errors.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import * as svc from './contra.service.js';

const router = Router();
router.use(requireAuth);
const staff = requireRole('admin', 'employee');

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a valid date');
const line = z.object({ ledger: z.string().trim().min(1, 'Select a ledger').max(20), amount: z.coerce.number().positive('Amount must be greater than 0') });

const createSchema = z.object({
  contraDate: isoDate,
  refNo: z.string().trim().max(50).optional().default(''),
  chequeNo: z.string().trim().max(50).optional().default(''),
  narration: z.string().trim().max(500).optional().default(''),
  debits: z.array(line).min(1, 'Add at least one debit (To) ledger').max(20),
  credits: z.array(line).min(1, 'Add at least one credit (From) ledger').max(20),
});

const dateRange = z.object({
  from: isoDate.optional(), to: isoDate.optional(),
  status: z.enum(['active', 'cancelled']).default('active'),
  q: z.string().trim().max(60).optional().default(''),
});

router.get('/ledgers', validate({ query: z.object({ q: z.string().trim().max(60).optional().default('') }) }),
  asyncHandler(async (req, res) => res.json(await svc.ledgers(req.user, req.query))));
router.get('/ledger-balance/:code', asyncHandler(async (req, res) => res.json(await svc.ledgerBalanceOf(req.user, req.params.code.toUpperCase()))));
router.get('/next-no', asyncHandler(async (req, res) => res.json(await svc.nextNo(req.user))));
router.get('/', validate({ query: dateRange }), asyncHandler(async (req, res) => {
  const fy = req.user.financialYear.split('-');
  const from = req.query.from || `${fy[0]}-04-01`;
  const to = req.query.to || `${fy[1]}-03-31`;
  res.json(await svc.listContra(req.user, { ...req.query, from, to }));
}));
router.get('/:no', asyncHandler(async (req, res) => res.json(await svc.getContra(req.user, req.params.no.toUpperCase()))));
router.post('/', staff, validate({ body: createSchema }), asyncHandler(async (req, res) => {
  res.status(201).json(await svc.createContra(req.user, req.body));
}));
router.post('/:no/cancel', staff, validate({ body: z.object({ remarks: z.string().trim().max(300).optional().default('') }) }),
  asyncHandler(async (req, res) => res.json(await svc.cancelContra(req.user, req.params.no.toUpperCase(), req.body.remarks))));

export default router;
