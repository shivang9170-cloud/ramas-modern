// Manifest REST API — replaces Operation/menifest.aspx, manifest_Cancel.aspx, manifest_View.aspx.
//
//   GET  /api/manifests/options
//   GET  /api/manifests/destinations?type=branch|city&q=
//   GET  /api/manifests/pending-dockets?destination&from&to&loadType&bookingMode&loadingSheet
//   POST /api/manifests                        { ..., loadingSheetNo?, bags? }  bags = packets / bags / master bags
//                                              (courier divisions only: [{ key, level, parent, sealNo, dockets[] }])
//   GET  /api/manifests?from&to&status&search&scope=mine|all
//   GET  /api/manifests/bags/:bagNo            a scanned packet / bag / master bag: its manifest and dockets
//   GET  /api/manifests/:no                    (+ bags)
//   POST /api/manifests/:no/cancel
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/errors.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import * as svc from './manifest.service.js';

const router = Router();
router.use(requireAuth, requireRole('admin', 'employee', 'franchisee'));

const date = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

router.get('/options', asyncHandler(async (req, res) => res.json(await svc.options(req.user))));

router.get('/destinations',
  validate({ query: z.object({ type: z.enum(['branch', 'city']).default('branch'), q: z.string().trim().min(1).max(60) }) }),
  asyncHandler(async (req, res) => res.json(await svc.searchDestinations(req.query.type, req.query.q))));

router.get('/pending-dockets',
  validate({ query: z.object({
    destination: z.string().trim().min(1, 'Destination is required').max(20),
    from: date, to: date,
    loadType: z.enum(['PTL', 'FTL', 'ODC']).default('PTL'),
    bookingMode: z.enum(['All', 'AI']).default('All'),
    loadingSheet: z.string().trim().max(30).optional().default(''),
  }) }),
  asyncHandler(async (req, res) => res.json(await svc.pendingDockets(req.user, req.query))));

const createSchema = z.object({
  manifestDate: date,
  manifestTime: z.string().trim().regex(/^\d{2}:\d{2}$/, 'Use HH:mm'),
  freightType: z.enum(['SUNDRY', 'FTL']),
  destination: z.string().trim().min(1, 'Destination is required').max(20),
  manualNo: z.string().trim().max(30).optional().default(''),
  transportedBy: z.enum(['SELF', 'COLOADER']).default('SELF'),
  coloadingBy: z.string().trim().max(30).optional().default(''),
  coloaderName: z.string().trim().max(60).optional().default(''),
  remarks: z.string().trim().max(500).optional().default(''),
  loadingSheetNo: z.string().trim().max(30).optional().default(''),
  dockets: z.array(z.object({
    docketNo: z.string().trim().min(1).max(30),
    packages: z.coerce.number().int().min(1, 'At least one package'),
    weight: z.coerce.number().min(0),
    freight: z.coerce.number().min(0),
  })).min(1, 'Select at least one docket').max(1000),
  bags: z.array(z.object({
    key: z.string().trim().min(1).max(20),
    level: z.enum(svc.BAG_LEVELS),
    parent: z.string().trim().max(20).optional().default(''),
    sealNo: z.string().trim().max(30).optional().default(''),
    dockets: z.array(z.string().trim().min(1).max(30)).max(1000).optional().default([]),
  })).max(2000).optional().default([]),
}).superRefine((d, ctx) => {
  if (d.freightType === 'FTL' && d.transportedBy === 'COLOADER') {
    ctx.addIssue({ code: 'custom', path: ['transportedBy'], message: 'FTL manifests cannot go by co-loader' });
  }
  if (d.transportedBy === 'COLOADER' && !d.coloaderName) {
    ctx.addIssue({ code: 'custom', path: ['coloaderName'], message: 'Select the co-loader' });
  }
});

router.post('/', validate({ body: createSchema }), asyncHandler(async (req, res) => {
  res.status(201).json(await svc.createManifest(req.user, req.body));
}));

router.get('/',
  validate({ query: z.object({
    from: date, to: date,
    status: z.enum(['active', 'cancelled']).default('active'),
    search: z.string().trim().max(30).optional().default(''),
    scope: z.enum(['mine', 'all']).default('mine'),
  }) }),
  asyncHandler(async (req, res) => res.json(await svc.listManifests(req.user, req.query))));

router.get('/bags/:bagNo', asyncHandler(async (req, res) => res.json(await svc.findBag(String(req.params.bagNo).trim().toUpperCase()))));

router.get('/:no', asyncHandler(async (req, res) => res.json(await svc.getManifest(req.user, req.params.no))));

router.post('/:no/cancel', requireRole('admin', 'employee'), asyncHandler(async (req, res) => {
  res.json(await svc.cancelManifest(req.user, req.params.no));
}));

export default router;
