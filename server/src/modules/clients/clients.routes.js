// Client Master REST API — replaces Master/Client_Master.aspx.
//
//   GET    /api/clients/options          branches, nature of business, employees (contract by), parent clients, fixed lists
//   GET    /api/clients/cities?q=
//   GET    /api/clients?q&status
//   GET    /api/clients/:id              (client_Id, the page's grid key)
//   POST   /api/clients                  (staff)
//   PUT    /api/clients/:id              (staff; name and billing branch cannot change — they are in the ledger names)
//   DELETE /api/clients/:id              (staff; refused while the client is in use)
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/errors.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import * as svc from './clients.service.js';
import { today } from '../../utils/values.js';

const router = Router();
router.use(requireAuth);
const staff = requireRole('admin', 'employee');

const up = (max) => z.string().trim().max(max).optional().default('').transform((v) => v.toUpperCase());
const text = (max) => z.string().trim().max(max).optional().default('');
const pattern = (re, msg, max) => z.string().trim().toUpperCase().max(max).optional().default('').refine((v) => !v || re.test(v), msg);
const gstinRe = /^\d{2}[A-Z0-9]{13}$/;

const clientSchema = z.object({
  name: z.string().trim().max(200).optional().default('').transform((v) => v.toUpperCase().replace(/\s+/g, ' ')),
  branch: z.string().trim().max(20).optional().default(''),
  submissionLocation: z.string().trim().min(1, 'Select submission location').max(20),
  collectionLocation: z.string().trim().min(1, 'Select collection location').max(20),
  contactPerson: up(100),
  address: z.string().trim().min(1, 'Enter address').max(500).transform((v) => v.toUpperCase()),
  cityCode: z.string().trim().min(1, 'Select city').max(10),
  place: up(100),
  pinCode: pattern(/^\d{6}$/, 'PIN code: 6 digits', 6),
  email: z.string().trim().max(100).optional().default('').refine((v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), 'Invalid e-mail'),
  phone: z.string().trim().regex(/^\d{6,13}$/, 'Phone: 6–13 digits'),
  mobile: z.string().trim().regex(/^\d{10}$/, 'Mobile: 10 digits'),
  fax: text(50),
  pan: pattern(/^[A-Z]{5}\d{4}[A-Z]$/, 'PAN: 10 characters (AAAAA9999A)', 10),
  tin: text(50),
  gstRegistered: z.boolean().default(true),
  gstin: pattern(gstinRe, 'GSTIN must be 15 characters starting with the state code', 15),
  placeOfSupply: z.enum(svc.PLACE_OF_SUPPLY.map((p) => p.value), { errorMap: () => ({ message: 'Select place of supply' }) }),
  introDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter introduction date')
    .refine((v) => v <= today(), 'Introduction date should not be greater than the current date'),
  creditPeriod: z.coerce.number().int().min(0, 'Credit period cannot be negative').max(365).default(0),
  billingCycle: z.string().trim().regex(/^\d{1,3}$/, 'Billing cycle: days (up to 3 digits)'),
  creditType: z.enum(svc.CREDIT_TYPES.map((c) => c.value)).default('Consigner'),
  custType: z.coerce.number().int().refine((v) => v === 0 || v === 1, 'Select customer type').default(0),
  natureOfBusinessId: z.coerce.number().int().positive({ message: 'Select nature of business' }),
  contractBy: text(50),
  underClient: text(50),
  billing: z.object({
    sameAsClient: z.boolean().default(true),
    address: up(500),
    name: up(200),
    phone: text(20),
    gstin: pattern(gstinRe, 'Billing GSTIN must be 15 characters', 15),
  }).default({ sameAsClient: true }),
  isPs: z.boolean().default(false),
  transportId: text(50),
  showKmOnPrint: z.boolean().default(false),
  printAs: up(200),
  poNo: text(50),
  poDate: z.string().optional().default('').refine((v) => !v || /^\d{4}-\d{2}-\d{2}$/.test(v), 'Invalid PO date'),
  cinNo: pattern(/^[A-Z0-9]{21}$/, 'CIN: 21 characters', 21),
  sapCode: text(20),
  manualCode: text(20),
  remarks: up(500),
  discount: z.boolean().default(false),
  thirdPartyBilling: z.boolean().default(false),
  walkingClient: z.boolean().default(false),
  active: z.boolean().default(true),
}).superRefine((b, ctx) => {
  if (b.isPs && !b.transportId) ctx.addIssue({ code: 'custom', path: ['transportId'], message: 'Enter the transport id' });
});
const createSchema = clientSchema.superRefine((b, ctx) => {
  if (b.name.length < 2) ctx.addIssue({ code: 'custom', path: ['name'], message: 'Enter client name' });
  if (!b.branch) ctx.addIssue({ code: 'custom', path: ['branch'], message: 'Select billing branch' });
});
const idParam = z.object({ id: z.coerce.number().int().positive() });

router.get('/options', asyncHandler(async (req, res) => res.json(await svc.options(req.user))));
router.get('/cities', validate({ query: z.object({ q: z.string().trim().max(60).optional().default('') }) }),
  asyncHandler(async (req, res) => res.json(await svc.cities(req.query.q))));
router.get('/', validate({
  query: z.object({ q: z.string().trim().max(60).optional().default(''), status: z.enum(['all', 'active', 'inactive']).default('all') }),
}), asyncHandler(async (req, res) => res.json(await svc.listClients(req.user, req.query))));
router.get('/:id', validate({ params: idParam }), asyncHandler(async (req, res) => res.json(await svc.getClient(req.user, req.params.id))));
router.post('/', staff, validate({ body: createSchema }), asyncHandler(async (req, res) => {
  res.status(201).json(await svc.createClient(req.user, req.body));
}));
router.put('/:id', staff, validate({ params: idParam, body: clientSchema }), asyncHandler(async (req, res) => {
  res.json(await svc.updateClient(req.user, req.params.id, req.body));
}));
router.delete('/:id', staff, validate({ params: idParam }), asyncHandler(async (req, res) => {
  res.json(await svc.deleteClient(req.user, req.params.id));
}));

export default router;
