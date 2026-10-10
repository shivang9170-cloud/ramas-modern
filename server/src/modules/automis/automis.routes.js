// MIS auto mail REST API — replaces Setting/MIS_Report_Auto.aspx.
//
//   GET    /api/auto-mis/settings
//   PUT    /api/auto-mis/settings                 (staff) { active, mailTime1, mailTime2?, effectiveDate?, backDays }
//   GET    /api/auto-mis/columns                  MIS columns (the first two always included)
//   GET    /api/auto-mis/clients
//   GET    /api/auto-mis/emails                   client e-mail settings
//   POST   /api/auto-mis/emails                   (staff) { clients[{client, columns[]}], emails[1-2] }
//   DELETE /api/auto-mis/emails/:id               (staff)
//   GET    /api/auto-mis/header-footer
//   POST   /api/auto-mis/header-footer            (staff) { header, footer }
//   GET    /api/auto-mis/preview?client&backDays   what the client's mail would list
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/errors.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import * as svc from './automis.service.js';

const router = Router();
router.use(requireAuth, requireRole('admin', 'employee'));

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Enter the time as HH:mm');

router.get('/settings', asyncHandler(async (req, res) => res.json(await svc.settings())));
router.put('/settings', validate({
  body: z.object({
    active: z.boolean(), mailTime1: time, mailTime2: z.union([time, z.literal('')]).optional().default(''),
    effectiveDate: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal('')]).optional().default(''),
    backDays: z.coerce.number().int().min(0, 'Back days cannot be negative').max(365),
  }),
}), asyncHandler(async (req, res) => res.json(await svc.saveSettings(req.user, req.body))));
router.get('/columns', asyncHandler(async (req, res) => res.json(await svc.columns())));
router.get('/clients', asyncHandler(async (req, res) => res.json(await svc.clients())));
router.get('/emails', asyncHandler(async (req, res) => res.json(await svc.emails())));
router.post('/emails', validate({
  body: z.object({
    clients: z.array(z.object({ client: z.string().trim().min(1).max(20), columns: z.array(z.coerce.number().int()).max(50).default([]) }))
      .min(1, 'Please add a client').max(200),
    emails: z.array(z.string().trim().email('Enter a valid e-mail').max(200)).min(1, 'Please add the client e-mail id').max(2),
  }),
}), asyncHandler(async (req, res) => res.status(201).json(await svc.addEmails(req.user, req.body))));
router.delete('/emails/:id', validate({ params: z.object({ id: z.coerce.number().int().positive() }) }),
  asyncHandler(async (req, res) => res.json(await svc.removeEmail(req.params.id))));
router.get('/header-footer', asyncHandler(async (req, res) => res.json(await svc.headerFooters())));
router.post('/header-footer', validate({
  body: z.object({ header: z.string().trim().min(1, 'Enter the header').max(4000), footer: z.string().trim().max(4000).default('') }),
}), asyncHandler(async (req, res) => res.status(201).json(await svc.addHeaderFooter(req.user, req.body))));
router.get('/preview', validate({
  query: z.object({ client: z.string().trim().min(1, 'Select client').max(20), backDays: z.coerce.number().int().min(0).max(365).optional() }),
}), asyncHandler(async (req, res) => res.json(await svc.preview(req.query.client, req.query.backDays ?? null))));

export default router;
