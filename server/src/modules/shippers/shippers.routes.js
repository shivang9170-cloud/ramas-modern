// Shippers (docket-number stock) REST API — replaces Setting/Shiper_Master, GatePassShiper_Master, Shiper_Issue_Details
// and shiper_issue_details_to_Franchisee.
//
//   GET    /api/shippers/options                          shipper types, GRN types
//   GET    /api/shippers/stock/:kind?shipperType&grnType&number    kind shipper | gatepass
//   GET    /api/shippers/stock/:kind/next?shipperType     next free number
//   POST   /api/shippers/stock/:kind                      (staff) { shipperType, grnType, receivingDate, start, end, receivedFrom }
//   PUT    /api/shippers/stock/:kind/:id                  (staff) { receivingDate, receivedFrom }
//   DELETE /api/shippers/stock/:kind/:id                  (staff) refused once anything is issued from it
//   GET    /api/shippers/stock/:kind/:id/numbers          each number, issued or not
//   GET    /api/shippers/issue-branches?franchisee=       branches (or franchisee branches)
//   GET    /api/shippers/clients
//   GET    /api/shippers/issues?franchisee&branch&shipperType&grnType&number
//   GET    /api/shippers/issues/next?shipperType
//   POST   /api/shippers/issues                           (staff) { franchisee, branch, shipperType, grnType, issueDate, start, end,
//                                                         client?, perShipperCharge? }
//   DELETE /api/shippers/issues/:id                       (staff) refused once a number is used on a docket
//   GET    /api/shippers/issues/:id/numbers               each number, used / not used / moved
//   POST   /api/shippers/issues/:id/transfer              (staff) { number, toBranch }
//   GET    /api/shippers/transfers
//   POST   /api/shippers/transfers/:id/cancel             (staff)
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/errors.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import * as svc from './shippers.service.js';

const router = Router();
router.use(requireAuth);
const staff = requireRole('admin', 'employee');

const kind = z.object({ kind: z.enum(Object.keys(svc.STOCKS)) });
const kindId = kind.extend({ id: z.coerce.number().int().positive() });
const id = z.object({ id: z.coerce.number().int().positive() });
const shipperType = z.enum(svc.SHIPPER_TYPES, { errorMap: () => ({ message: 'Select shipper type' }) });
const grnType = z.coerce.number().int().refine((v) => svc.GRN_TYPES[v], 'Select GRN type');
const seriesNo = (label) => z.coerce.number({ invalid_type_error: `${label} required` }).int().positive(`${label} required`).max(999999999999);
const date = (msg) => z.string().regex(/^\d{4}-\d{2}-\d{2}$/, msg);
const opt = z.string().trim().max(30).optional().default('');
const franchisee = z.enum(['true', 'false']).default('false').transform((v) => v === 'true');

router.get('/options', asyncHandler(async (req, res) => res.json({
  shipperTypes: svc.SHIPPER_TYPES.map((v) => ({ value: v, label: v })),
  grnTypes: Object.entries(svc.GRN_TYPES).map(([value, label]) => ({ value: Number(value), label })),
})));

router.get('/stock/:kind', validate({ params: kind, query: z.object({ shipperType: opt, grnType: opt, number: opt }) }),
  asyncHandler(async (req, res) => res.json(await svc.listStock(req.user, req.params.kind, req.query))));
router.get('/stock/:kind/next', validate({ params: kind, query: z.object({ shipperType }) }),
  asyncHandler(async (req, res) => res.json(await svc.nextStockNumber(req.params.kind, req.query.shipperType))));
router.post('/stock/:kind', staff, validate({
  params: kind,
  body: z.object({
    shipperType, grnType, receivingDate: date('Enter the receiving date'), start: seriesNo('Starting series'), end: seriesNo('End series'),
    receivedFrom: z.string().trim().min(1, 'Received from required').max(100),
  }),
}), asyncHandler(async (req, res) => res.status(201).json(await svc.createStock(req.user, req.params.kind, req.body))));
router.put('/stock/:kind/:id', staff, validate({
  params: kindId, body: z.object({ receivingDate: date('Enter the receiving date'), receivedFrom: z.string().trim().min(1, 'Received from required').max(100) }),
}), asyncHandler(async (req, res) => res.json(await svc.updateStock(req.params.kind, req.params.id, req.body))));
router.delete('/stock/:kind/:id', staff, validate({ params: kindId }),
  asyncHandler(async (req, res) => res.json(await svc.deleteStock(req.params.kind, req.params.id))));
router.get('/stock/:kind/:id/numbers', validate({ params: kindId }),
  asyncHandler(async (req, res) => res.json(await svc.stockNumbers(req.params.kind, req.params.id))));

router.get('/issue-branches', validate({ query: z.object({ franchisee }) }),
  asyncHandler(async (req, res) => res.json(await svc.issueBranches(req.query.franchisee))));
router.get('/clients', asyncHandler(async (req, res) => res.json(await svc.issueClients(req.user))));
router.get('/issues', validate({ query: z.object({ franchisee, branch: opt, shipperType: opt, grnType: opt, number: opt }) }),
  asyncHandler(async (req, res) => res.json(await svc.listIssues(req.user, req.query))));
router.get('/issues/next', validate({ query: z.object({ shipperType }) }),
  asyncHandler(async (req, res) => res.json(await svc.nextIssueNumber(req.query.shipperType))));
router.post('/issues', staff, validate({
  body: z.object({
    franchisee: z.boolean().default(false), branch: z.string().trim().min(1, 'Select branch').max(20), shipperType, grnType,
    issueDate: date('Enter the issue date'), start: seriesNo('Starting series'), end: seriesNo('End series'),
    client: z.string().trim().max(20).optional().default(''),
    perShipperCharge: z.coerce.number().min(0).max(100000).optional().default(0),
  }),
}), asyncHandler(async (req, res) => res.status(201).json(await svc.createIssue(req.user, req.body, req.body.franchisee))));
router.delete('/issues/:id', staff, validate({ params: id }), asyncHandler(async (req, res) => res.json(await svc.deleteIssue(req.params.id))));
router.get('/issues/:id/numbers', validate({ params: id }), asyncHandler(async (req, res) => res.json(await svc.issueNumbers(req.params.id))));
router.post('/issues/:id/transfer', staff, validate({
  params: id, body: z.object({ number: seriesNo('Number'), toBranch: z.string().trim().min(1, 'Select branch').max(20) }),
}), asyncHandler(async (req, res) => res.status(201).json(await svc.transferNumber(req.user, req.params.id, req.body))));
router.get('/transfers', asyncHandler(async (req, res) => res.json(await svc.listTransfers())));
router.post('/transfers/:id/cancel', staff, validate({ params: id }),
  asyncHandler(async (req, res) => res.json(await svc.cancelTransfer(req.user, req.params.id))));

export default router;
