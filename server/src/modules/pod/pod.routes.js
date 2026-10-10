// POD dispatch REST API — replaces Operation/Pod_Dispatch.aspx, POD_Dispatch_Cancel.aspx, POD_Dispatch_View.aspx.
//
//   GET  /api/pod/options                     branches the PODs can be sent to
//   GET  /api/pod/check/:docketNo             delivered + made at this branch + not dispatched yet
//   POST /api/pod                             { iomDate, sentTo, dockets: [{ docketNo, remarks, withoutImage, images: [{ name, data(base64) }] }] }
//   GET  /api/pod?from&to&status&search
//   GET  /api/pod/images/:id                  the stored JPEG / PDF (authenticated)
//   GET  /api/pod/:iomNo
//   POST /api/pod/:iomNo/cancel
//
// This router parses its own JSON body (images are sent base64; app.js skips the small
// global parser for /api/pod).
import express, { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/errors.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import * as svc from './pod.service.js';

const router = Router();
// login first: only a signed-in user may send the large (base64 images) body
router.use(requireAuth, requireRole('admin', 'employee', 'franchisee'));
router.use(express.json({ limit: '40mb' }));

const date = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

router.get('/options', asyncHandler(async (req, res) => res.json(await svc.options())));
router.get('/check/:docketNo', asyncHandler(async (req, res) => res.json(await svc.checkDocket(req.user, req.params.docketNo.trim()))));

const createSchema = z.object({
  iomDate: date,
  sentTo: z.string().trim().min(1, 'Select the branch the PODs are sent to').max(20),
  dockets: z.array(z.object({
    docketNo: z.string().trim().min(1).max(30),
    remarks: z.string().trim().max(500).optional().default(''),
    withoutImage: z.boolean().default(false),
    images: z.array(z.object({
      name: z.string().trim().max(200).optional().default(''),
      // base64 of <= 2 MB; only base64 characters (an optional data: prefix is stripped by the service)
      data: z.string().min(1).max(3_000_100).regex(/^(data:[\w/+.-]+;base64,)?[A-Za-z0-9+/\r\n]+={0,2}$/, 'File is not valid base64 data'),
    })).max(svc.MAX_IMAGES_PER_DOCKET, `At most ${svc.MAX_IMAGES_PER_DOCKET} files per docket`).default([]),
  })).min(1, 'Add at least one docket').max(100),
});

router.post('/', validate({ body: createSchema }), asyncHandler(async (req, res) => {
  res.status(201).json(await svc.createPod(req.user, req.body));
}));

router.get('/',
  validate({ query: z.object({
    from: date, to: date,
    status: z.enum(['active', 'cancelled']).default('active'),
    search: z.string().trim().max(30).optional().default(''),
    scope: z.enum(['mine', 'all']).default('all'),
  }) }),
  asyncHandler(async (req, res) => res.json(await svc.listPods(req.user, req.query))));

router.get('/images/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(404).json({ error: 'Image not found' }); return; }
  const f = await svc.imageFile(req.user, id);
  res.set('Cache-Control', 'private, max-age=300');
  res.set('Content-Disposition', `inline; filename="${f.name.replace(/[^\w.-]/g, '_')}"`);
  // a stored file can never run script in the app's origin, whatever is inside it
  res.set('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox");
  res.set('X-Content-Type-Options', 'nosniff');
  res.type(f.type).sendFile(f.full);
}));

router.get('/:iomNo', asyncHandler(async (req, res) => res.json(await svc.getPod(req.user, req.params.iomNo))));

router.post('/:iomNo/cancel', requireRole('admin', 'employee'), asyncHandler(async (req, res) => {
  res.json(await svc.cancelPod(req.user, req.params.iomNo));
}));

export default router;
