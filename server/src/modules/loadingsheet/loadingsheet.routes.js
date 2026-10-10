// Loading sheet REST API — replaces Operation/Loading_Sheet.aspx, Loading_Sheet_Cancel.aspx, Loading_Sheet_View.aspx,
// Loading_Sheet_Edit.aspx and Manual_Loading_Sheet_Cancel_Uncancel.aspx.
//
//   GET   /api/loading-sheets/pending-dockets?from&to&loadType&dockets=D1,D2   dockets lying here, not on an open sheet
//   POST  /api/loading-sheets                      { loadingDate, loadType, dockets[] }
//   GET   /api/loading-sheets?status&search&open   the branch's sheets of the login year (open = not manifested)
//   GET   /api/loading-sheets/docket/:docketNo      a docket's rows on this branch's sheets (manual cancel / undo)
//   PATCH /api/loading-sheets/rows/:id               { cancelled }   take a docket off an open sheet / put it back
//   GET   /api/loading-sheets/:lsNo
//   POST  /api/loading-sheets/:lsNo/cancel          refused once manifested
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/errors.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import * as svc from './loadingsheet.service.js';

const router = Router();
router.use(requireAuth, requireRole('admin', 'employee', 'franchisee'));

const date = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const loadType = z.enum(['', 'PTL', 'FTL']).optional().default('');

router.get('/pending-dockets', validate({
  query: z.object({
    from: date, to: date, loadType,
    dockets: z.string().trim().max(2000).optional().default('').transform((v) => v.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean)),
  }),
}), asyncHandler(async (req, res) => res.json(await svc.pendingDockets(req.user, req.query))));

router.post('/', validate({
  body: z.object({ loadingDate: date, loadType, dockets: z.array(z.string().trim().min(1).max(30)).min(1, 'Select Atleast One Docket No.').max(1000) }),
}), asyncHandler(async (req, res) => res.status(201).json(await svc.createLoadingSheet(req.user, req.body))));

router.get('/', validate({
  query: z.object({
    status: z.enum(['active', 'cancelled']).default('active'), search: z.string().trim().max(30).optional().default(''),
    open: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  }),
}), asyncHandler(async (req, res) => res.json(await svc.listLoadingSheets(req.user, req.query))));

router.get('/docket/:docketNo', asyncHandler(async (req, res) => res.json(await svc.docketRows(req.user, req.params.docketNo))));
router.patch('/rows/:id', requireRole('admin', 'employee'), validate({
  params: z.object({ id: z.coerce.number().int().positive() }), body: z.object({ cancelled: z.boolean() }),
}), asyncHandler(async (req, res) => res.json(await svc.setDocketCancelled(req.user, req.params.id, req.body.cancelled))));

router.get('/:lsNo', asyncHandler(async (req, res) => res.json(await svc.getLoadingSheet(req.user, req.params.lsNo))));
router.post('/:lsNo/cancel', requireRole('admin', 'employee'),
  asyncHandler(async (req, res) => res.json(await svc.cancelLoadingSheet(req.user, req.params.lsNo))));

export default router;
