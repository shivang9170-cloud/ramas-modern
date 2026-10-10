// Franchisee commission invoice REST API — replaces Invoice/Franchisee_Commission_Invoice.aspx and Franchisee_Invoice_Cancel.aspx.
//
//   GET  /api/franchisee-invoices/franchisees                 franchisees with the branch they are bound to
//   GET  /api/franchisee-invoices/pending-dockets?franCode&branchCode&month   the month's dockets of that branch, with commission
//   GET  /api/franchisee-invoices/monthly?franCode&branchCode&month           rent / mobile / signage of the road master
//   POST /api/franchisee-invoices                             { franCode, branchCode, month, invoiceDate, dockets[], includeMonthly,
//                                                               tdsPercent, remarks }
//   GET  /api/franchisee-invoices?from&to&status&search
//   GET  /api/franchisee-invoices/:invoiceNo                  with its dockets (print)
//   POST /api/franchisee-invoices/:invoiceNo/cancel           { remarks }  frees the dockets
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/errors.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import * as svc from './franchiseeinvoice.service.js';

const router = Router();
router.use(requireAuth, requireRole('admin', 'employee'));

const date = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const month = z.string().trim().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM');
const opt = (max) => z.string().trim().max(max).optional().default('');
const who = { franCode: z.string().trim().min(1, 'Select the franchisee').max(20), branchCode: z.string().trim().min(1).max(20), month };

router.get('/franchisees', asyncHandler(async (req, res) => res.json(await svc.franchisees())));
router.get('/pending-dockets', validate({ query: z.object(who) }),
  asyncHandler(async (req, res) => res.json(await svc.pendingDockets(req.user, req.query))));
router.get('/monthly', validate({ query: z.object(who) }), asyncHandler(async (req, res) => res.json(await svc.monthly(req.user, req.query))));

router.post('/', validate({
  body: z.object({
    ...who, invoiceDate: date, dockets: z.array(z.string().trim().min(1).max(30)).max(2000).default([]),
    includeMonthly: z.boolean().default(false), tdsPercent: z.coerce.number().min(0).max(100).default(0), remarks: opt(500),
  }),
}), asyncHandler(async (req, res) => res.status(201).json(await svc.createInvoice(req.user, req.body))));

router.get('/', validate({
  query: z.object({ from: date, to: date, status: z.enum(['all', 'Active', 'Cancelled']).default('all'), search: opt(60) }),
}), asyncHandler(async (req, res) => res.json(await svc.listInvoices(req.user, req.query))));
router.get('/:invoiceNo', asyncHandler(async (req, res) => res.json(await svc.getInvoice(req.user, req.params.invoiceNo))));
router.post('/:invoiceNo/cancel', validate({ body: z.object({ remarks: z.string().trim().min(3, 'Give a reason for cancelling').max(500) }) }),
  asyncHandler(async (req, res) => res.json(await svc.cancelInvoice(req.user, req.params.invoiceNo, req.body.remarks))));

export default router;
