// Docket (GRN) booking REST API — replaces Operation/GrnEntry.aspx and the
// OperationService.svc methods it called.
//
//   GET  /api/dockets/options                     dropdown data for the booking form
//   GET  /api/dockets/lookup/cities?q=            destination autocomplete
//   GET  /api/dockets/lookup/destination-branches?city=
//   GET  /api/dockets/lookup/consigners?q=
//   GET  /api/dockets/lookup/clients?q=           "on account of" (contractual)
//   GET  /api/dockets/lookup/billing-at?...
//   GET  /api/dockets/lookup/rate?...&weight=     contract rate (sp_Select_Rate), slab rate for the weight
//   GET  /api/dockets/lookup/oda-locations?city=  locations of a city (PIN, serving branch, ODA rate in force)
//   GET  /api/dockets/lookup/location-by-pin?pin&city   the destination location of a PIN code
//   GET  /api/dockets/lookup/origin-locations     the booking branch's city locations + its own location
//   GET  /api/dockets/lookup/city-state?city=     state of a consignor / consignee city
//   GET  /api/dockets/lookup/gst-state?gstin=     state of a GSTIN (its first two digits = GST state code)
//   GET  /api/dockets/lookup/docket-issue?docketNo=     branch / client the docket number was issued to (shipper stock)
//   GET  /api/dockets/lookup/client-defaults?onAccountOf&destination   client details for the consignor, contract rate-on /
//                                                 delivery modes to the destination; refuses an inactive / other-division client
//   GET  /api/dockets/lookup/oda?location&weight  ODA charge (ODA Charge master, usp_Get_OdaRate)
//   GET  /api/dockets/lookup/tax?...              GST mode + rates
//   GET  /api/dockets/lookup/expected-date?...
//   GET  /api/dockets/lookup/next-number
//   GET  /api/dockets/lookup/international        countries, ports, currencies (rate), carriers, incoterms (export / import)
//   POST /api/dockets/calculate                  totals preview (same code the save uses)
//   POST /api/dockets                             book a docket        (GrnEntry.aspx?x=0)
//   GET  /api/dockets/:docketNo                   view                 (?x=1)
//   PUT  /api/dockets/:docketNo                   modify               (?x=1)
//   POST /api/dockets/:docketNo/cancel            cancel               (?x=2)
//   GET  /api/dockets/:docketNo/tracking          Tracking.aspx (docket_tracking rows only)
//   GET  /api/dockets/:docketNo/journey           full journey built from the operation tables (tracking.service.js)
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/errors.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { cancelSchema, docketSchema } from './docket.schema.js';
import * as svc from './docket.service.js';
import { journey } from './tracking.service.js';

const router = Router();
router.use(requireAuth);

const booker = requireRole('admin', 'employee', 'franchisee');
const staff = requireRole('admin', 'employee');
const q = (shape) => validate({ query: z.object(shape) });
const term = z.string().trim().min(1).max(100);
const opt = z.string().trim().max(260).optional().default('');

router.get('/options', booker, asyncHandler(async (req, res) => res.json(await svc.bookingOptions())));

router.get('/lookup/cities', booker, q({ q: term }), asyncHandler(async (req, res) => res.json(await svc.searchCities(req.query.q))));
router.get('/lookup/destination-branches', booker, q({ city: term }), asyncHandler(async (req, res) => res.json(await svc.destinationBranches(req.query.city))));
router.get('/lookup/consigners', booker, q({ q: term, city: opt }), asyncHandler(async (req, res) => res.json(await svc.searchConsigners(req.query.q, { city: req.query.city }))));
router.get('/lookup/clients', booker, q({ q: term }), asyncHandler(async (req, res) => res.json(await svc.searchClients(req.user, req.query.q))));

router.get('/lookup/billing-at', booker,
  q({ onAccountOf: term, destination: term, bookingMode: term, originLocation: opt, destinationLocation: opt }),
  asyncHandler(async (req, res) => res.json(await svc.billingAt(req.user, req.query))));

router.get('/lookup/rate', booker,
  q({
    onAccountOf: opt,                            // a General Client takes the Paid / To Pay general rates instead
    destination: term, bookingMode: term, rateOn: term,
    customerType: term, bookingType: term, bookingDate: term,
    docType: z.enum(['DOC', 'NONDOC']).default('NONDOC'),
    loadType: opt, deliveryMode: opt, freightType: opt, originLocation: opt, destinationLocation: opt,
    weight: z.coerce.number().min(0).max(1000000).optional().default(0),   // charge weight: picks the slab band
    packets: z.coerce.number().int().min(0).max(1000000).optional().default(0),   // BOX: picks the charge slab band
    itemCode: opt, pkgSize: z.union([z.literal(''), z.enum(['BIG', 'MEDIUM', 'SMALL'])]).optional().default(''),   // CATEGORY
  }),
  asyncHandler(async (req, res) => res.json(await svc.contractRate(req.user, req.query))));

router.get('/lookup/oda-locations', booker, q({ city: term }), asyncHandler(async (req, res) => res.json(await svc.odaLocations(req.query.city))));
router.get('/lookup/location-by-pin', booker, q({ pin: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit PIN'), city: term }),
  asyncHandler(async (req, res) => res.json(await svc.locationByPin(req.query.pin, req.query.city))));
router.get('/lookup/origin-locations', booker, asyncHandler(async (req, res) => res.json(await svc.originLocations(req.user))));
router.get('/lookup/city-state', booker, q({ city: term }), asyncHandler(async (req, res) => res.json(await svc.stateOfCity(req.query.city))));
router.get('/lookup/gst-state', booker, q({ gstin: term }), asyncHandler(async (req, res) => res.json(await svc.stateOfGstin(req.query.gstin))));
router.get('/lookup/docket-issue', booker, q({ docketNo: term }), asyncHandler(async (req, res) => res.json(await svc.docketIssue(req.user, req.query.docketNo))));
router.get('/lookup/client-defaults', booker, q({ onAccountOf: term, destination: opt }),
  asyncHandler(async (req, res) => res.json(await svc.clientDefaults(req.user, req.query.onAccountOf, req.query.destination))));
router.get('/lookup/oda', booker, q({ location: term, weight: z.coerce.number().min(0).max(1000000).optional().default(0) }),
  asyncHandler(async (req, res) => res.json(await svc.odaCharge(req.query.location, req.query.weight))));

router.get('/lookup/tax', booker, q({ destination: term, bookingMode: term, bookingDate: term, taxSelect: opt }),
  asyncHandler(async (req, res) => res.json(await svc.taxSetup(req.user, req.query))));

router.get('/lookup/expected-date', booker, q({ fromCity: term, toCity: term, bookingDate: term }),
  asyncHandler(async (req, res) => res.json({ expectedDate: await svc.expectedDate(req.query) })));

router.get('/lookup/next-number', booker, asyncHandler(async (req, res) => res.json({ docketNo: await svc.nextDocketNo(req.user) })));
router.get('/lookup/international', booker, asyncHandler(async (req, res) => res.json(await svc.internationalOptions())));

// Preview totals; accepts a partial form so the UI can call it while typing.
router.post('/calculate', booker, asyncHandler(async (req, res) => {
  const partial = docketSchema.innerType ? docketSchema.innerType().partial() : docketSchema.partial();
  const body = partial.parse(req.body ?? {});
  res.json(svc.calculate({ charges: {}, additionalCharges: [], additionalChargesTax: [], ...body }, req.user));
}));

router.post('/', booker, validate({ body: docketSchema }), asyncHandler(async (req, res) => {
  res.status(201).json(await svc.createDocket(req.body, req.user));
}));

router.get('/:docketNo', asyncHandler(async (req, res) => res.json(await svc.getDocket(req.params.docketNo, req.user))));

router.put('/:docketNo', booker, validate({ body: docketSchema }), asyncHandler(async (req, res) => {
  res.json(await svc.updateDocket(req.params.docketNo, req.body, req.user));
}));

router.post('/:docketNo/cancel', staff, validate({ body: cancelSchema }), asyncHandler(async (req, res) => {
  res.json(await svc.cancelDocket(req.params.docketNo, req.body.remark, req.user));
}));

router.get('/:docketNo/tracking', asyncHandler(async (req, res) => res.json(await svc.tracking(req.params.docketNo, req.user))));
router.get('/:docketNo/journey', asyncHandler(async (req, res) => res.json(await journey(req.params.docketNo, req.user))));

export default router;
