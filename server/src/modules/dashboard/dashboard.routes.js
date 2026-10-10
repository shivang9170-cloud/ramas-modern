// Analytics dashboard REST API — replaces the counters of default.aspx / MainDashboard.aspx.
//
//   GET  /api/dashboard/overview?from&to&scope=all|branch     KPIs vs the previous period, daily trend, status mix, insights
//   GET  /api/dashboard/bookings?from&to&scope                trends, weekday / hour, mixes, bands, clients, lanes, branches
//   GET  /api/dashboard/operations?from&to&scope              funnel, transit, on-time, ageing, vendors, utilisation, POD, DRS
//   GET  /api/dashboard/billing?from&to&scope                 billed vs collected, bill status, receivables ageing, unbilled
//   GET  /api/dashboard/accounts?from&to&scope                vendor / franchisee invoices, vouchers, receipts by mode
//   GET  /api/dashboard/drill?kind&filters&from&to&scope&allDates&withCancelled   the records behind any chart element (click-through)
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/errors.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import * as svc from './dashboard.service.js';

const router = Router();
router.use(requireAuth, requireRole('admin', 'employee'));

const date = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const range = validate({
  query: z.object({ from: date, to: date, scope: z.enum(['all', 'branch']).default('all') })
    .refine((v) => v.from <= v.to, { message: 'From date should not be after the to date', path: ['from'] })
    .refine((v) => (new Date(v.to) - new Date(v.from)) / 86400000 <= 1100, { message: 'Pick a range of up to three years', path: ['from'] }),
});
const SECTIONS = { overview: svc.overview, bookings: svc.bookings, operations: svc.operations, billing: svc.billing, accounts: svc.accounts };

// the records behind a chart element: kind + filters (JSON { column: value }); up to 2000 rows with the full count
router.get('/drill', validate({
  query: z.object({
    from: date, to: date, scope: z.enum(['all', 'branch']).default('all'),
    kind: z.enum(['dockets', 'bills', 'receipts', 'challans', 'manifests', 'pickups', 'otherbills', 'vendorinvoices', 'vendorbills', 'franchisee', 'vouchers']),
    filters: z.string().max(2000).optional().default('{}').transform((v, ctx) => {
      try {
        const o = JSON.parse(v);
        if (!o || typeof o !== 'object' || Array.isArray(o)) throw new Error();
        return Object.fromEntries(Object.entries(o).filter(([, x]) => x === null || ['string', 'number', 'boolean'].includes(typeof x)));
      } catch { ctx.addIssue({ code: 'custom', message: 'filters must be a JSON object' }); return z.NEVER; }
    }),
    allDates: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
    withCancelled: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  }),
}), asyncHandler(async (req, res) => res.json(await svc.drill(req.user, req.query))));

router.get('/:section', range, asyncHandler(async (req, res) => {
  const fn = SECTIONS[req.params.section];
  if (!fn) return res.status(404).json({ error: 'Unknown dashboard section' });
  return res.json(await fn(req.user, req.query));
}));

export default router;
