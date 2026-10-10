// Business profile of the logged-in division (courier / TMS / international) — which screens and steps apply.
//   GET  /api/business/profile    { businessType, useBagging, allowInternational, tms, limits }
// Edited on the Division Master (masters/definitions.js, division).
import { Router } from 'express';
import { asyncHandler } from '../../middleware/errors.js';
import { requireAuth } from '../../middleware/auth.js';
import { profile } from './business.service.js';

const router = Router();
router.use(requireAuth);

router.get('/profile', asyncHandler(async (req, res) => res.json(await profile(req.user.divCode))));

export default router;
