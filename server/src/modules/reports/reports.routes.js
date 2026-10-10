//   GET /api/reports                 -> available reports
//   GET /api/reports/:key            -> filters + columns (to build the screen)
//   GET /api/reports/:key/run?...    -> { rows, columns, ... }
import { Router } from 'express';
import { asyncHandler } from '../../middleware/errors.js';
import { requireAuth } from '../../middleware/auth.js';
import * as svc from './reports.service.js';

const router = Router();
router.use(requireAuth);

router.get('/', (req, res) => res.json(svc.listReports()));
router.get('/:key', (req, res, next) => { try { res.json(svc.describe(req.params.key)); } catch (e) { next(e); } });
router.get('/:key/run', asyncHandler(async (req, res) => res.json(await svc.runReport(req.params.key, req.query, req.user))));

export default router;
