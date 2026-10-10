// Client Contract REST API, stages 1–3 (City / Location / State / Zone, Credit, weight slabs) — replaces those parts
// of Rate/Client_Contract.aspx. A WEIGHT row may carry `slabs: [{ from, to, rate, discount, approvedDiscount }]` (≤ 10);
// a CATEGORY row must carry `categorySlabs: [{ itemCode, from, to, big, medium, small }]` (≤ 10); a City To City
// WEIGHT / BOX row may carry `chargeSlabs: { pickup: [{ from, to, amount }], delivery: [...] }` (the route's
// minimum collection / delivery charge by kg or packets).
//
//   GET  /api/contracts/options              contract types, modes, delivery modes, billing branches, FTL types, states,
//                                            zones, rate-on list, financial year
//   GET  /api/contracts/clients?q=           clients of the division
//   GET  /api/contracts/places?type&q=       cities / locations / states / zones to pick from
//   GET  /api/contracts/distance?type&from&to  road distance for a KM rate (city / location distance masters)
//   GET  /api/contracts?client&type&q&status&expiringInDays&rateType
//   GET  /api/contracts/:type/:id
//   POST /api/contracts                      (staff) { type, rateType, client, billingAt, dates, rows[] } — one transaction;
//                                            rateType Credit (default) needs client + billing branch, Paid / To Pay
//                                            (general rates for General Client dockets) take neither
//   PUT  /api/contracts/:type/:id            (staff) amounts, charges, end date (extend only), status
//   GET  /api/contracts/general-rate?type&origin&destination&mode&rateOn&deliveryMode&ftlType&docType
//                                            the General Rate Master rate in force, to copy into a client rate
//   GET  /api/contracts/current-rate?…&rateType&client&billingAt
//                                            the client's own current rate for the route (renew it with a hike)
//
// General Rate Master (Rate/General_Rate_Master.aspx): the same list / get / create / update / options / places /
// distance under /api/general-rates, on the General_Rate_* tables — no client, no billing branch, no slabs.
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/errors.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import * as svc from './contracts.service.js';

const staff = requireRole('admin', 'employee');

const type = z.enum(svc.TYPE_KEYS, { errorMap: () => ({ message: 'Select the contract type' }) });
const rateType = z.enum(svc.RATE_TYPES, { errorMap: () => ({ message: 'Select the rate type' }) });
const amount = (max = 10000000) => z.coerce.number({ invalid_type_error: 'Enter a number' }).min(0, 'Cannot be negative').max(max).default(0);
const date = (msg) => z.string().regex(/^\d{4}-\d{2}-\d{2}$/, msg);
const charges = z.object(Object.fromEntries(Object.keys(svc.CHARGES).map((k) => [k, amount()]))).partial().default({})
  .refine((c) => (c.fuelPercent ?? 0) <= 100 && (c.discount ?? 0) <= 100, 'Fuel / discount % must be 100 or less');
const amounts = {
  rate: amount(), ftlRate: amount(), freight: amount(), minWeight: amount(), minBoxes: amount(), minFreight: amount(),
  volumetricWeight: amount(1000), distance: amount(20000),
  perKmPerKg: amount(1000), adminPercent: amount(100),           // CARGO (DIV1002) weight rates: rate = km x this + admin %
  collectionPerBox: z.boolean().default(false), deliveryPerBox: z.boolean().default(false),   // chk_is_per_box_col / _del
  expectedDays: z.coerce.number().int().min(0).max(60).default(0), charges,
};
const slab = z.object({
  from: z.coerce.number({ invalid_type_error: 'Enter a weight' }).min(0, 'Cannot be negative').max(100000),
  to: z.coerce.number({ invalid_type_error: 'Enter a weight' }).min(0, 'Cannot be negative').max(100000),
  rate: z.coerce.number({ invalid_type_error: 'Enter a number' }).positive('Rate should not be zero').max(10000000),
  discount: amount(100),
  approvedDiscount: amount(100),
});
const slabs = z.array(slab).max(svc.SLAB_BANDS, `At most ${svc.SLAB_BANDS} slabs`);
const categorySlab = z.object({
  itemCode: z.string().trim().min(1, 'Select the product').max(20),
  from: z.coerce.number({ invalid_type_error: 'Enter a weight' }).min(0, 'Cannot be negative').max(100000),
  to: z.coerce.number({ invalid_type_error: 'Enter a weight' }).min(0, 'Cannot be negative').max(100000),
  big: amount(), medium: amount(), small: amount(),       // RateN / RateMedN / RateSmallN
});
const categorySlabs = z.array(categorySlab).max(svc.SLAB_BANDS, `At most ${svc.SLAB_BANDS} category slabs`);
const chargeBand = z.object({
  from: z.coerce.number({ invalid_type_error: 'Enter a number' }).min(0, 'Cannot be negative').max(100000),
  to: z.coerce.number({ invalid_type_error: 'Enter a number' }).min(0, 'Cannot be negative').max(100000),
  amount: z.coerce.number({ invalid_type_error: 'Enter an amount' }).min(0, 'Cannot be negative').max(10000000),
});
const chargeBands = z.array(chargeBand).max(svc.SLAB_BANDS, `At most ${svc.SLAB_BANDS} charge slabs`);
// pickup → collection charge (PICKUP), delivery → delivery charge (DEL); a kind left out is not touched
const chargeSlabs = z.object({ pickup: chargeBands.optional(), delivery: chargeBands.optional() }).optional();
const row = z.object({
  origin: z.string().trim().min(1, 'Select where from').max(20),
  destination: z.string().trim().min(1, 'Select where to').max(20),
  mode: z.string().trim().min(1, 'Select mode').max(10),
  deliveryMode: z.string().trim().min(1, 'Select delivery mode').max(20),
  rateOn: z.enum(['WEIGHT', 'FREIGHT', 'FTL', 'BOX', 'KM', 'CATEGORY'], { errorMap: () => ({ message: 'Select rate on' }) }),
  ftlType: z.string().trim().max(20).optional().default(''),
  loadType: z.string().trim().max(10).optional().default(''),
  docType: z.enum(['1', '2']).default('2'),     // rbldocs: 1 Document, 2 Non document
  ...amounts,
  slabs: slabs.default([]),
  categorySlabs: categorySlabs.default([]),
  chargeSlabs,
});
const createSchema = z.object({
  type: type.default('CITY'),
  rateType: rateType.default('Credit'),
  client: z.string().trim().max(50).optional().default(''),             // Credit only
  billingAt: z.string().trim().max(20).optional().default(''),          // Credit only
  startDate: date('Enter start date'),
  endDate: date('Enter end date'),
  effectiveFrom: date('Enter effective date'),
  active: z.boolean().default(true),
  notificationDays: z.string().trim().regex(/^\d{0,3}$/, 'Notification days: number').optional().default(''),
  rows: z.array(row).min(1, 'Add at least one rate').max(200),
});
const updateSchema = z.object({
  ...amounts,
  slabs: slabs.optional(),                      // left out: the slab stays as it is
  categorySlabs: categorySlabs.optional(),
  chargeSlabs,
  endDate: date('Enter end date'),
  active: z.boolean().default(true),
  notificationDays: z.string().trim().regex(/^\d{0,3}$/, 'Notification days: number').optional().default(''),
});
const rowParams = z.object({ type, id: z.coerce.number().int().positive() });
const search = z.string().trim().max(60).optional().default('');

const code = z.string().trim().min(1).max(20);

/** The same API over a rate book: CLIENT (/api/contracts) or GENERAL (/api/general-rates, General Rate Master). */
export function ratesRouter(book) {
  const router = Router();
  router.use(requireAuth);
  router.get('/options', asyncHandler(async (req, res) => res.json(await svc.options(req.user))));
  router.get('/places', validate({ query: z.object({ type, q: search }) }), asyncHandler(async (req, res) => res.json(await svc.places(req.query.type, req.query.q))));
  router.get('/distance', validate({ query: z.object({ type, from: code, to: code }) }),
    asyncHandler(async (req, res) => res.json(await svc.distance(req.query.type, req.query.from, req.query.to))));
  if (book === 'CLIENT') {
    router.get('/clients', validate({ query: z.object({ q: search }) }), asyncHandler(async (req, res) => res.json(await svc.clients(req.user, req.query.q))));
    router.get('/cities', validate({ query: z.object({ q: search }) }), asyncHandler(async (req, res) => res.json(await svc.places('CITY', req.query.q))));
    // "copy from General Rate Master" / "copy the client's current rate" for a new client rate
    const route = {
      type, origin: code, destination: code, mode: code, rateOn: z.string().trim().min(1).max(20),
      deliveryMode: z.string().trim().max(20).optional().default(''), ftlType: z.string().trim().max(20).optional().default(''),
      docType: z.enum(['1', '2']).default('2'),
    };
    router.get('/general-rate', validate({ query: z.object(route) }),
      asyncHandler(async (req, res) => res.json(await svc.generalRateFor(req.user, req.query))));
    router.get('/current-rate', validate({
      query: z.object({
        ...route, rateType: rateType.default('Credit'),
        client: z.string().trim().max(50).optional().default(''), billingAt: z.string().trim().max(20).optional().default(''),
      }),
    }), asyncHandler(async (req, res) => res.json(await svc.currentClientRate(req.user, req.query))));
  }
  router.get('/', validate({
    query: z.object({
      client: z.string().trim().max(50).optional().default(''),
      type: z.union([z.literal(''), type]).optional().default(''),
      q: search,
      status: z.enum(['all', 'active', 'inactive']).default('all'),
      expiringInDays: z.coerce.number().int().min(0).max(366).optional(),
      rateType: z.union([z.literal(''), rateType]).optional().default(''),
    }),
  }), asyncHandler(async (req, res) => res.json(await svc.listContracts(req.user, { ...req.query, expiringInDays: req.query.expiringInDays ?? null }, book))));
  router.get('/:type/:id', validate({ params: rowParams }),
    asyncHandler(async (req, res) => res.json(await svc.getContract(req.user, req.params.type, req.params.id, book))));
  router.post('/', staff, validate({ body: createSchema }), asyncHandler(async (req, res) => res.status(201).json(await svc.createContract(req.user, req.body, book))));
  router.put('/:type/:id', staff, validate({ params: rowParams, body: updateSchema }),
    asyncHandler(async (req, res) => res.json(await svc.updateContract(req.user, req.params.type, req.params.id, req.body, book))));
  return router;
}

export default ratesRouter('CLIENT');
