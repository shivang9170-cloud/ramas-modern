// Books & Reports REST API (read only) — every report covers the login financial year + division.
//
//   GET  /api/books/overview?to                 money position (cash, bank, receivable, payable, advances, taxes), P&L so far, trend
//   GET  /api/books/day-book?from&to&type&q     every voucher of every module with its lines and source
//   GET  /api/books/ledgers                     ledger picker (mains with their sub-ledgers, balance)
//   GET  /api/books/ledger/:code?from&to        ledger statement with running balance (a main ledger includes its subs)
//   GET  /api/books/trial-balance?from&to       closing balances by section / group / ledger
//   GET  /api/books/profit-loss?from&to         gross / net profit by section / group / ledger
//   GET  /api/books/balance-sheet?to            assets / liabilities as on a date (profit carried to the liabilities side)
//   GET  /api/books/expenses?from&to            expenses by group -> main -> sub-ledger, by month, by source
//   GET  /api/books/sections                    the sections a group can belong to
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/errors.js';
import { requireAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import * as svc from './books.service.js';
import { sectionOptions } from './sections.js';

const router = Router();
router.use(requireAuth);

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a valid date');
const range = z.object({ from: isoDate.optional(), to: isoDate.optional() });

router.get('/sections', (req, res) => res.json(sectionOptions()));
router.get('/overview', validate({ query: range }), asyncHandler(async (req, res) => res.json(await svc.overview(req.user, req.query))));
router.get('/day-book', validate({ query: range.extend({ type: z.string().trim().max(20).optional().default(''), q: z.string().trim().max(60).optional().default('') }) }),
  asyncHandler(async (req, res) => res.json(await svc.dayBook(req.user, req.query))));
router.get('/ledgers', asyncHandler(async (req, res) => res.json(await svc.ledgerList(req.user))));
router.get('/ledger/:code', validate({ query: range }), asyncHandler(async (req, res) => res.json(await svc.ledgerStatement(req.user, req.params.code, req.query))));
router.get('/trial-balance', validate({ query: range }), asyncHandler(async (req, res) => res.json(await svc.trialBalance(req.user, req.query))));
router.get('/profit-loss', validate({ query: range }), asyncHandler(async (req, res) => res.json(await svc.profitLoss(req.user, req.query))));
router.get('/balance-sheet', validate({ query: range }), asyncHandler(async (req, res) => res.json(await svc.balanceSheet(req.user, req.query))));
router.get('/expenses', validate({ query: range }), asyncHandler(async (req, res) => res.json(await svc.expenseAnalysis(req.user, req.query))));

export default router;
