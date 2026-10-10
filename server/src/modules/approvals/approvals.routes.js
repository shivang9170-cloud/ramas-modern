// Approvals REST API — replaces Setting/Special_Booking_Approval.aspx and Setting/Freight_THC_Margin_Approval.aspx.
//
//   GET   /api/approvals/special-booking                  discounted dockets waiting for approval (next approver shown)
//   GET   /api/approvals/special-booking/decided?search=
//   POST  /api/approvals/special-booking/approve          (staff) { items[{docketNo, remarks}] } → one level up each
//   POST  /api/approvals/special-booking/reject           (staff) { items[{docketNo, remarks}] }
//   GET   /api/approvals/freight-margin                   challans below the minimum margin %, undecided
//   GET   /api/approvals/freight-margin/decided?search=
//   GET   /api/approvals/freight-margin/setting
//   PUT   /api/approvals/freight-margin/setting           (staff) { minMarginPercent }
//   POST  /api/approvals/freight-margin/decide            (staff) { approve, items[{challanNo, remarks}] } — reject cancels the challan
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/errors.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import * as svc from './approvals.service.js';

const router = Router();
router.use(requireAuth, requireRole('admin', 'employee'));

const search = z.object({ search: z.string().trim().max(60).optional().default('') });
const remarks = z.string().trim().max(500).optional().default('');
const dockets = z.object({ items: z.array(z.object({ docketNo: z.string().trim().min(1).max(30), remarks })).min(1, 'Select at least one docket').max(500) });

router.get('/special-booking', asyncHandler(async (req, res) => res.json(await svc.pendingSpecial(req.user))));
router.get('/special-booking/decided', validate({ query: search }), asyncHandler(async (req, res) => res.json(await svc.decidedSpecial(req.user, req.query.search))));
router.post('/special-booking/approve', validate({ body: dockets }), asyncHandler(async (req, res) => res.json(await svc.approveSpecial(req.user, req.body.items))));
router.post('/special-booking/reject', validate({ body: dockets }), asyncHandler(async (req, res) => res.json(await svc.rejectSpecial(req.user, req.body.items))));

router.get('/freight-margin', asyncHandler(async (req, res) => res.json(await svc.pendingMargin(req.user))));
router.get('/freight-margin/decided', validate({ query: search }), asyncHandler(async (req, res) => res.json(await svc.decidedMargin(req.user, req.query.search))));
router.get('/freight-margin/setting', asyncHandler(async (req, res) => res.json(await svc.marginSetting())));
router.put('/freight-margin/setting', validate({ body: z.object({ minMarginPercent: z.coerce.number().min(-100).max(100) }) }),
  asyncHandler(async (req, res) => res.json(await svc.saveMarginSetting(req.user, req.body.minMarginPercent))));
router.post('/freight-margin/decide', validate({
  body: z.object({ approve: z.boolean(), items: z.array(z.object({ challanNo: z.string().trim().min(1).max(30), remarks })).min(1, 'Select at least one challan').max(200) }),
}), asyncHandler(async (req, res) => res.json(await svc.decideMargin(req.user, req.body))));

export default router;
