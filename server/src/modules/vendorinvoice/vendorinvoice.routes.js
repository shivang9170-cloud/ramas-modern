// Vendor invoice REST API — replaces Invoice/VendorInvoice.aspx, OthVndInvoiceDetails.aspx, OtherVendorPrint.aspx (other
// vendors' bills with a PURCHASE/PAYBILL voucher) and Vendor_Invoice_For_Varification.aspx, VendorPendingInvoiceReport.aspx,
// Vendor_Invoice_Print.aspx (transport vendors' bills checked against their challans).
//
// Other vendor invoices
//   GET  /api/vendor-invoices/options                         GST slabs, invoice-for / part types, cost centre types
//   GET  /api/vendor-invoices/vendors?q=                      other vendors' ledgers (with TDS % and the cost centre flag)
//   GET  /api/vendor-invoices/products?q&partType             goods (Purchase) or services (Pay Bill)
//   GET  /api/vendor-invoices/ledgers?q&kind=expense|tds      expense ledger / TDS ledger search
//   GET  /api/vendor-invoices/cost-targets?type&q             branch / docket / customer / vendor / employee
//   POST /api/vendor-invoices                                 { invoiceDate, invoiceFor, partType, vendorLedger, vendorInvNo,
//                                                               purchaseDate, expenseLedger, tdsLedger, taxType, narration, lines[],
//                                                               costCentres[] }  posts the PURCHASE/PAYBILL voucher
//   GET  /api/vendor-invoices?from&to&status&search
//   GET  /api/vendor-invoices/:invoiceNo                      with lines, cost centres and the voucher
//   POST /api/vendor-invoices/:invoiceNo/cancel               { remarks }  cancels the voucher too
//
// Vendor bill verification (transport vendors' challans)
//   GET  /api/vendor-invoices/verify/options                  transport vendors, modes
//   GET  /api/vendor-invoices/verify/challans?vendorCode&mode&from&to   the vendor's challans with a balance left
//   POST /api/vendor-invoices/verify                          { vendorCode, mode, billDate, vendorRefNo, billAmount, deduction,
//                                                               narration, rows[] }
//   GET  /api/vendor-invoices/verify/report?from&to&vendorCode&pendingOnly   verified bills per challan
//   GET  /api/vendor-invoices/verify/:billNo                  one bill with its challans (print)
//   POST /api/vendor-invoices/verify/:billNo/cancel           { remarks }  opens the challans again
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/errors.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import * as svc from './vendorinvoice.service.js';
import * as verify from './vendorverify.service.js';

const router = Router();
router.use(requireAuth, requireRole('admin', 'employee'));

const date = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const opt = (max) => z.string().trim().max(max).optional().default('');
const term = z.object({ q: z.string().trim().min(1).max(60) });
const money = z.coerce.number().min(0).max(1e9);
const cancelBody = { body: z.object({ remarks: z.string().trim().min(3, 'Give a reason for cancelling').max(500) }) };

// ------------------------------------------------------------------ verification (before /:invoiceNo)
router.get('/verify/options', asyncHandler(async (req, res) => res.json(await verify.options(req.user))));
router.get('/verify/challans', validate({
  query: z.object({ vendorCode: z.string().trim().min(1, 'Select the vendor').max(20), mode: opt(10), from: date, to: date }),
}), asyncHandler(async (req, res) => res.json(await verify.pendingChallans(req.user, req.query))));
router.post('/verify', validate({
  body: z.object({
    vendorCode: z.string().trim().min(1, 'Select the vendor').max(20), mode: z.string().trim().min(1, 'Select the mode').max(10),
    billDate: date, vendorRefNo: opt(50), billAmount: money.positive('Enter the bill amount'), deduction: money.optional().default(0),
    narration: opt(1000),
    rows: z.array(z.object({
      challanNo: z.string().trim().min(1).max(30), currentPayment: money.positive('Enter the current payment'),
    })).min(1, 'select any challan').max(500),
  }),
}), asyncHandler(async (req, res) => res.status(201).json(await verify.createVerification(req.user, req.body))));
router.get('/verify/report', validate({
  query: z.object({ from: date, to: date, vendorCode: opt(20), pendingOnly: z.enum(['true', 'false']).default('false').transform((v) => v === 'true') }),
}), asyncHandler(async (req, res) => res.json(await verify.report(req.user, req.query))));
router.get('/verify/:billNo', asyncHandler(async (req, res) => res.json(await verify.getVerification(req.user, req.params.billNo))));
router.post('/verify/:billNo/cancel', validate(cancelBody),
  asyncHandler(async (req, res) => res.json(await verify.cancelVerification(req.user, req.params.billNo, req.body.remarks))));

// ------------------------------------------------------------------ other vendor invoices
router.get('/options', asyncHandler(async (req, res) => res.json(await svc.options())));
router.get('/vendors', validate({ query: term }), asyncHandler(async (req, res) => res.json(await svc.vendors(req.user, req.query.q))));
router.get('/products', validate({ query: term.extend({ partType: z.enum(svc.PART_TYPES).default('Purchase') }) }),
  asyncHandler(async (req, res) => res.json(await svc.products(req.query.q, req.query.partType))));
router.get('/ledgers', validate({ query: term.extend({ kind: z.enum(['expense', 'tds']).default('expense') }) }),
  asyncHandler(async (req, res) => res.json(await svc.ledgers(req.user, req.query.q, req.query.kind))));
router.get('/cost-targets', validate({ query: term.extend({ type: z.enum(svc.COST_TYPES) }) }),
  asyncHandler(async (req, res) => res.json(await svc.costTargets(req.user, req.query.type, req.query.q))));

router.post('/', validate({
  body: z.object({
    invoiceDate: date, invoiceFor: z.enum(svc.INVOICE_FOR).default(svc.INVOICE_FOR[0]), partType: z.enum(svc.PART_TYPES),
    vendorLedger: z.string().trim().min(1, 'Please Select Vendor for Invoice').max(200), vendorInvNo: opt(50),
    purchaseDate: date.optional().or(z.literal('')).default(''),
    expenseLedger: z.string().trim().min(1, 'Please Select Ledger for Invoice.').max(200), tdsLedger: opt(200),
    taxType: z.enum(['GST', 'IGST']).default('GST'), narration: opt(1000),
    lines: z.array(z.object({
      itemCode: z.string().trim().min(1, 'Select the product').max(20), quantity: z.coerce.number().positive('Enter the quantity').max(1e7),
      rate: money.positive('Enter the rate'), slab: z.coerce.number().int().positive('Select the GST slab'), description: opt(500),
    })).min(1, 'Add Invoice Details First').max(200),
    costCentres: z.array(z.object({
      type: z.enum(svc.COST_TYPES), code: z.string().trim().min(1).max(30), name: z.string().trim().min(1).max(200),
      amount: money.positive('Enter the part amount'),
    })).max(100).optional().default([]),
  }),
}), asyncHandler(async (req, res) => res.status(201).json(await svc.createInvoice(req.user, req.body))));

router.get('/', validate({
  query: z.object({ from: date, to: date, status: z.enum(['all', 'Active', 'Cancelled']).default('all'), search: opt(60) }),
}), asyncHandler(async (req, res) => res.json(await svc.listInvoices(req.user, req.query))));
router.get('/:invoiceNo', asyncHandler(async (req, res) => res.json(await svc.getInvoice(req.user, req.params.invoiceNo))));
router.post('/:invoiceNo/cancel', validate(cancelBody),
  asyncHandler(async (req, res) => res.json(await svc.cancelInvoice(req.user, req.params.invoiceNo, req.body.remarks))));

export default router;
