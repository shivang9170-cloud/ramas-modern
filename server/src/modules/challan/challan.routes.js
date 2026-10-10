// Challan REST API — replaces Operation/dispatchentry_fleet.aspx (road, "FOR MANIFEST"),
// dispatchentry_fleet_Cancel.aspx and dispatchentry_fleet_View.aspx.
//
//   GET  /api/challans/options
//   GET  /api/challans/vendors?vendorType&mode
//   GET  /api/challans/vehicles?vendorCode
//   GET  /api/challans/vehicles/:truckNo          details + running-truck warning + allocated driver
//   GET  /api/challans/vendor-rate?vendorCode&routeCode|city&weight   vendor road rate in force → hire charge
//   GET  /api/challans/drivers?q=
//   GET  /api/challans/routes?routeType=DIRECT|VIA&toBranch   (toBranch: only routes reaching that branch)
//   GET  /api/challans/routes/:code               destination, km, times, stations
//   GET  /api/challans/pending-manifests?from&to&freightType&destType&routeCode|destination
//   POST /api/challans
//   GET  /api/challans?from&to&status&search&scope=mine|all
//   GET  /api/challans/:no
//   POST /api/challans/:no/cancel
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/errors.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import * as svc from './challan.service.js';

const router = Router();
router.use(requireAuth, requireRole('admin', 'employee', 'franchisee'));

const date = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const time = z.string().trim().regex(/^\d{2}:\d{2}$/, 'Use HH:mm');
const text = (max) => z.string().trim().max(max).optional().default('');
const money = z.coerce.number().min(0).max(1e9).default(0);
const vendorType = z.enum(svc.VENDOR_TYPES.map((v) => v.value));
const code = z.string().trim().min(1).max(20);

router.get('/options', (req, res) => res.json(svc.options()));

router.get('/vendors',
  validate({ query: z.object({ vendorType, mode: z.enum(['RD']).default('RD') }) }),
  asyncHandler(async (req, res) => res.json(await svc.vendors(req.user, req.query))));

router.get('/vehicles', validate({ query: z.object({ vendorCode: code }) }),
  asyncHandler(async (req, res) => res.json(await svc.vehicles(req.query.vendorCode))));

router.get('/vehicles/:truckNo', asyncHandler(async (req, res) => res.json(await svc.vehicleDetails(req.params.truckNo))));

router.get('/vendor-rate', validate({
  query: z.object({ vendorCode: code, routeCode: text(20), city: text(20), weight: z.coerce.number().min(0).max(1e7).default(0) }),
}), asyncHandler(async (req, res) => res.json(await svc.vendorRate(req.user, req.query))));

router.get('/drivers', validate({ query: z.object({ q: z.string().trim().min(1).max(60) }) }),
  asyncHandler(async (req, res) => res.json(await svc.searchDrivers(req.query.q))));

router.get('/routes', validate({ query: z.object({ routeType: z.enum(['DIRECT', 'VIA']).default('DIRECT'), toBranch: text(20) }) }),
  asyncHandler(async (req, res) => res.json(await svc.routes(req.user, req.query.routeType, req.query.toBranch))));

router.get('/routes/:code', asyncHandler(async (req, res) => res.json(await svc.routeDetails(req.user, req.params.code))));

router.get('/pending-manifests',
  validate({ query: z.object({
    from: date, to: date,
    freightType: z.enum(['SUNDRY', 'FTL']).default('SUNDRY'),
    destType: z.enum(['BRANCH', 'CITY']).default('BRANCH'),
    routeCode: z.string().trim().max(20).optional().default(''),
    destination: z.string().trim().max(20).optional().default(''),
  }).superRefine((q, ctx) => {
    if (q.destType === 'BRANCH' && !q.routeCode) ctx.addIssue({ code: 'custom', path: ['routeCode'], message: 'Select route' });
    if (q.destType === 'CITY' && !q.destination) ctx.addIssue({ code: 'custom', path: ['destination'], message: 'Destination is required' });
  }) }),
  asyncHandler(async (req, res) => res.json(await svc.pendingManifests(req.user, req.query))));

const createSchema = z.object({
  challanDate: date,
  challanTime: time,
  mode: z.enum(['RD']).default('RD'),
  vendorType,
  vendorCode: code,
  freightType: z.enum(['SUNDRY', 'FTL']),
  destType: z.enum(['BRANCH', 'CITY']),
  routeType: z.enum(['DIRECT', 'VIA']).optional(),
  routeCode: text(20),
  routeTime: text(20),
  destination: text(20),
  truckNo: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{4,15}$/, 'Enter a valid vehicle no.'),
  capacity: z.coerce.number().min(0).max(1e6).default(0),
  isOverload: z.boolean().default(false),
  driverName: text(100),
  driverMobile: z.string().trim().regex(/^$|^\d{10}$/, 'Mobile no. must be 10 digits').optional().default(''),
  dlNo: text(50),
  driverRef: text(100),
  secondDriverName: text(100),
  secondDriverMobile: z.string().trim().regex(/^$|^\d{10}$/, 'Mobile no. must be 10 digits').optional().default(''),
  secondDriverDlNo: text(50),
  secondDriverRef: text(100),
  sealNo: text(50),
  loadedBy: text(100),
  deliveryDate: date,
  deliveryTime: text(10),
  openingMeter: text(20),
  closingMeter: text(20),
  penalty: money,
  incentive: money,
  ewayBillNo: text(50),
  location: text(200),
  message: text(500),
  hireCharge: money,
  labourCharge: z.coerce.number().int('Labour charge must be a whole number').min(0).max(1e9).default(0),
  otherCharge: money,
  overloadCharge: money,
  deductionAmt: money,
  advance: money,
  manifests: z.array(z.string().trim().min(1).max(30)).min(1, 'Select at least one manifest').max(200),
}).superRefine((d, ctx) => {
  if (d.destType === 'BRANCH' && !d.routeCode) ctx.addIssue({ code: 'custom', path: ['routeCode'], message: 'Select route' });
  if (d.destType === 'CITY' && !d.destination) ctx.addIssue({ code: 'custom', path: ['destination'], message: 'Destination is required' });
  if (d.vendorType === 'Self' && (!d.driverName || !d.driverMobile)) {
    ctx.addIssue({ code: 'custom', path: ['driverName'], message: 'Driver name and mobile number are required' });
  }
  if (d.vendorType === 'Market Vendor' && !(d.capacity > 0)) {
    ctx.addIssue({ code: 'custom', path: ['capacity'], message: 'Enter the truck capacity' });
  }
});

router.post('/', validate({ body: createSchema }), asyncHandler(async (req, res) => {
  res.status(201).json(await svc.createChallan(req.user, req.body));
}));

router.get('/',
  validate({ query: z.object({
    from: date, to: date,
    status: z.enum(['active', 'cancelled']).default('active'),
    search: z.string().trim().max(30).optional().default(''),
    scope: z.enum(['mine', 'all']).default('mine'),
  }) }),
  asyncHandler(async (req, res) => res.json(await svc.listChallans(req.user, req.query))));

router.get('/:no', asyncHandler(async (req, res) => res.json(await svc.getChallan(req.user, req.params.no))));

router.post('/:no/cancel', requireRole('admin', 'employee'), asyncHandler(async (req, res) => {
  res.json(await svc.cancelChallan(req.user, req.params.no));
}));

export default router;
