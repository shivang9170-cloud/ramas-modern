// Change docket financial year REST API — replaces Setting/ChangeDocket_FY.aspx.
//
//   GET   /api/docket-fy/stages                        stage list + the previous-year date range
//   GET   /api/docket-fy/pending?stage&from&to          dockets of the previous year still pending in the stage
//   POST  /api/docket-fy/move                          (staff) { stage, dockets[], from?, to? } → moved to the login year
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/errors.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import * as svc from './docketfy.service.js';

const router = Router();
router.use(requireAuth, requireRole('admin', 'employee'));

const stage = z.enum(Object.keys(svc.STAGES), { errorMap: () => ({ message: 'Select the stage' }) });
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional();

router.get('/stages', asyncHandler(async (req, res) => res.json({
  stages: Object.entries(svc.STAGES).map(([value, label]) => ({ value, label })), ...svc.years(req.user),
})));
router.get('/pending', validate({ query: z.object({ stage, from: date, to: date }) }),
  asyncHandler(async (req, res) => res.json(await svc.pending(req.user, req.query.stage, req.query))));
router.post('/move', validate({
  body: z.object({ stage, from: date, to: date, dockets: z.array(z.string().trim().min(1).max(30)).min(1, 'Select at least one docket').max(2000) }),
}), asyncHandler(async (req, res) => res.json(await svc.move(req.user, req.body.stage, req.body))));

export default router;
