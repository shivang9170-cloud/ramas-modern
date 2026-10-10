// POD to head office REST API.
//
// Courier (replaces POD_Dispatch_To_Head_Office.aspx, POD_Courier_Cancel.aspx, POD_Courier_View.aspx):
//   GET  /api/pod-courier/options
//   GET  /api/pod-courier/pending              IOMs of this branch not yet sent
//   POST /api/pod-courier                      { docDate, mode: SELF|COURIER, personName, courierCode, awbNo, ioms: [] }
//   GET  /api/pod-courier?status
//   GET  /api/pod-courier/:docNo
//   POST /api/pod-courier/:docNo/cancel
//
// Receive at head office (replaces podreceive.aspx, POD_Received_Cancel.aspx, POD_Received_View.aspx):
//   GET  /api/pod-receive/pending?from&to      courier documents not fully received
//   GET  /api/pod-receive/docs/:docNo          its dockets
//   GET  /api/pod-receive/by-docket/:docketNo  → { docNo }
//   POST /api/pod-receive                      { docNo, receiveDate, remark, dockets: [] }
//   GET  /api/pod-receive?from&to&status&search
//   POST /api/pod-receive/:docNo/cancel
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/errors.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import * as svc from './podho.service.js';

const date = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const status = z.enum(['active', 'cancelled']).default('active');

// ---------------------------------------------------------------- courier
export const courierRouter = Router();
courierRouter.use(requireAuth, requireRole('admin', 'employee', 'franchisee'));

courierRouter.get('/options', asyncHandler(async (req, res) => res.json(await svc.courierOptions())));
courierRouter.get('/pending', asyncHandler(async (req, res) => res.json(await svc.pendingIoms(req.user))));

const courierSchema = z.object({
  docDate: date,
  mode: z.enum(['SELF', 'COURIER']),
  personName: z.string().trim().max(100).optional().default(''),
  courierCode: z.string().trim().max(20).optional().default(''),
  awbNo: z.string().trim().max(50).optional().default(''),
  ioms: z.array(z.string().trim().min(1).max(30)).min(1, 'No record to save').max(200),
}).superRefine((b, ctx) => {
  if (b.mode === 'SELF' && !b.personName) ctx.addIssue({ code: 'custom', path: ['personName'], message: 'Name of the person carrying the PODs' });
  if (b.mode === 'COURIER' && !b.courierCode) ctx.addIssue({ code: 'custom', path: ['courierCode'], message: 'Select the courier' });
  if (b.mode === 'COURIER' && !b.awbNo) ctx.addIssue({ code: 'custom', path: ['awbNo'], message: 'Enter the airway bill no.' });
});

courierRouter.post('/', validate({ body: courierSchema }), asyncHandler(async (req, res) => {
  res.status(201).json(await svc.createCourier(req.user, req.body));
}));
courierRouter.get('/', validate({ query: z.object({ status }) }),
  asyncHandler(async (req, res) => res.json(await svc.listCouriers(req.user, req.query))));
courierRouter.get('/:docNo', asyncHandler(async (req, res) => res.json(await svc.getCourier(req.user, req.params.docNo))));
courierRouter.post('/:docNo/cancel', requireRole('admin', 'employee'), asyncHandler(async (req, res) => {
  res.json(await svc.cancelCourier(req.user, req.params.docNo));
}));

// ---------------------------------------------------------------- receive at head office
export const receiveRouter = Router();
receiveRouter.use(requireAuth, requireRole('admin', 'employee'));

receiveRouter.get('/pending', validate({ query: z.object({ from: date, to: date }) }),
  asyncHandler(async (req, res) => res.json(await svc.pendingDocs(req.user, req.query))));
receiveRouter.get('/docs/:docNo', asyncHandler(async (req, res) => res.json(await svc.docForReceive(req.user, req.params.docNo))));
receiveRouter.get('/by-docket/:docketNo', asyncHandler(async (req, res) => res.json(await svc.docByDocket(req.user, req.params.docketNo.trim()))));

const receiveSchema = z.object({
  docNo: z.string().trim().min(1, 'DOC No is required').max(30),
  receiveDate: date,
  remark: z.string().trim().max(500).optional().default(''),
  dockets: z.array(z.string().trim().min(1).max(30)).min(1, 'Select at least one docket no.').max(1000),
});
receiveRouter.post('/', validate({ body: receiveSchema }), asyncHandler(async (req, res) => {
  res.status(201).json(await svc.receive(req.user, req.body));
}));
receiveRouter.get('/',
  validate({ query: z.object({ from: date.optional(), to: date.optional(), status, search: z.string().trim().max(30).optional().default('') }) }),
  asyncHandler(async (req, res) => res.json(await svc.listReceived(req.user, req.query))));
receiveRouter.post('/:docNo/cancel', asyncHandler(async (req, res) => res.json(await svc.cancelReceive(req.user, req.params.docNo))));
