// Request schema for docket (GRN) booking. Replaces the 230-field string
// DocketInfo DTO + separate JSON strings posted by OperationScript.js.
import { z } from 'zod';
import { OTHER_CHARGE_FIELDS, RATE_ON, TAX_MODES } from '../../../../shared/docketCalc.js';

const str = (max = 200) => z.string().trim().max(max).optional().default('');
const money = z.coerce.number().min(0).max(1e10).optional().default(0);
const date = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const optDate = z.union([date, z.literal('')]).optional().default('');

const party = z.object({
  code: str(60),           // client/consigner code ('' for walk-in)
  name: z.string().trim().min(1, 'Name is required').max(200),
  address: str(500),
  city: str(60),
  state: str(60),
  pinCode: str(10),
  phone: str(30),
  gstin: str(20),
});

const invoice = z.object({
  invoiceNo: z.string().trim().min(1).max(60),
  invoiceDate: optDate,
  invoiceValue: money,
  netInvoiceValue: money,
  partNo: str(60),
  itemDescription: str(200),
  packets: money,
  quantity: money,
  eWayBill: str(30),
  eWayBillDate: optDate,
  eWayBillValidDate: optDate,
  vehicleNo: str(20),
});

const insurance = z.object({
  riskAt: z.string().trim().min(1).max(30),
  policyNo: str(60),
  policyDate: optDate,
  insCompany: str(100),
  privateMark: str(100),
});

const dimension = z.object({
  packets: money,
  length: money,
  width: money,
  height: money,
  totalCft: money,
  perCft: money,
  chargeWeight: money,
  actualWeight: money,
  weightType: str(20),
});

const extraCharge = z.object({
  code: str(20),
  name: z.string().trim().min(1).max(100),
  days: money,
  amount: money,
});

const charges = z.object(Object.fromEntries(OTHER_CHARGE_FIELDS.map(([k]) => [k, money]))).partial().default({});

// Export / import details (docket_international). DOMESTIC = an ordinary docket, nothing stored.
export const SHIPMENT_TYPES = ['DOMESTIC', 'EXPORT', 'IMPORT'];
export const INCOTERMS = ['EXW', 'FCA', 'FOB', 'CFR', 'CIF', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP'];
const international = z.object({
  shipmentType: z.enum(SHIPMENT_TYPES).default('DOMESTIC'),
  originCountry: str(2),
  destinationCountry: str(2),
  originPort: str(10),
  destinationPort: str(10),
  carrierCode: str(10),
  mawbNo: str(30),
  hawbNo: str(30),
  flightVoyage: str(30),
  incoterm: z.union([z.enum(INCOTERMS), z.literal('')]).optional().default(''),
  currency: str(3),
  exchangeRate: z.coerce.number().min(0).max(1e6).optional().default(0),
  invoiceValueFc: money,
  hsCode: z.union([z.string().trim().regex(/^\d{4,12}$/, 'HS code: 4–12 digits'), z.literal('')]).optional().default(''),
  iecNo: z.union([z.string().trim().toUpperCase().regex(/^[A-Z0-9]{10}$/, 'IEC: 10 characters'), z.literal('')]).optional().default(''),
  customsDocNo: str(30),
  customsDocDate: optDate,
  overseasName: str(200),
  overseasAddress: str(500),
  overseasCity: str(60),
  overseasZip: str(15),
  overseasPhone: str(30),
  overseasEmail: z.union([z.string().trim().email('Invalid e-mail').max(100), z.literal('')]).optional().default(''),
}).superRefine((x, ctx) => {
  if (x.shipmentType === 'DOMESTIC') return;
  const need = (path, message) => ctx.addIssue({ code: 'custom', path: [path], message });
  if (x.shipmentType === 'EXPORT' && !x.destinationCountry) need('destinationCountry', 'Destination country is required for an export');
  if (x.shipmentType === 'IMPORT' && !x.originCountry) need('originCountry', 'Origin country is required for an import');
  if (!x.currency) need('currency', 'Select the invoice currency');
  if (!(x.invoiceValueFc > 0)) need('invoiceValueFc', 'Enter the invoice value');
  if (!x.overseasName) need('overseasName', x.shipmentType === 'EXPORT' ? 'Enter the consignee abroad' : 'Enter the shipper abroad');
}).optional().default({ shipmentType: 'DOMESTIC' });

export const docketSchema = z.object({
  docketNo: z.string().trim().min(1, 'Docket no is required').max(30),
  manualDocketNo: str(30),
  bookingDate: date,
  expectedDate: optDate,
  bookingMode: z.string().trim().min(1).max(10).default('RD'),
  customerType: z.enum(['Contractual Client', 'General Client']),
  docType: z.enum(['DOC', 'NONDOC']).default('NONDOC'),
  loadType: z.enum(['FTL', 'PTL', '']).optional().default('PTL'),
  bookingType: z.enum(['To Pay', 'Paid', 'FOC', 'Inter Division']),
  deliveryMode: str(20),
  topayType: str(30),

  originCity: str(20),            // ddlBindCity (city code)
  originLocation: str(60),
  destination: z.string().trim().min(1, 'Destination is required').max(100), // city name, as legacy
  destinationBranch: z.string().trim().min(1, 'Destination branch is required').max(20),
  destinationLocation: str(60),
  pinCode: str(10),
  odaLocation: str(60),

  onAccountOf: str(260),          // "CLIENT NAME:CODE" (contractual)
  billingAt: str(20),
  consigner: party,
  consignee: party,
  consignerBillingAt: str(20),
  consigneeBillingAt: str(20),

  itemContent: str(20),           // item_master code (TypeofPkts)
  itemDescription: str(500),
  pkgSize: str(10),
  remarks: str(500),
  eWayBill: str(30),
  gstPaidBy: z.enum(['Billing Party', 'Transporter']).default('Transporter'),
  vehicle: str(20),

  // pricing inputs (see shared/docketCalc.js)
  rateOn: z.enum(RATE_ON).default('WEIGHT'),
  rate: money,
  rateId: str(30),
  // Required in legacy ("Please check Freight Type."); pickup/manifest searches
  // skip dockets without it.
  freightType: z.string().trim().min(1, 'Select the freight type').max(30)
    .refine((v) => v !== '--SELECT--', 'Select the freight type'),
  packets: z.coerce.number().int().min(1, 'At least one packet').max(100000),
  actualWeight: money,
  chargeWeight: money,
  minWeight: money,
  minFreight: money,
  minBox: money,
  distance: money,
  ftlAmount: money,
  manualFreight: money,
  discountPercent: z.coerce.number().min(0).max(100).optional().default(0),
  fuelPercent: z.union([z.literal('Nil'), z.coerce.number().min(0).max(100)]).optional().default(0),
  docketCharge: money,
  charges,
  fovPercent: money,
  invoiceValueMin: money,
  invoiceValueMax: money,
  fovFlatRate: money,
  hamaliRate: money,
  taxMode: z.enum(TAX_MODES).default('NA'),
  igstRate: z.coerce.number().min(0).max(100).optional().default(0),
  cgstRate: z.coerce.number().min(0).max(100).optional().default(0),
  sgstRate: z.coerce.number().min(0).max(100).optional().default(0),
  isGta: str(5),
  isCourier: str(5),
  isReg: str(5),

  invoices: z.array(invoice).max(200).default([]),
  insurance: z.array(insurance).max(20).default([]),
  dimensions: z.array(dimension).max(500).default([]),
  additionalCharges: z.array(extraCharge).max(50).default([]),
  additionalChargesTax: z.array(extraCharge).max(50).default([]),

  // franchisee booking commission (computed by the legacy page from slab tables)
  bookingCommission: money,
  bookingCommissionPercent: money,

  international,
}).superRefine((d, ctx) => {
  if (d.customerType === 'Contractual Client' && !d.onAccountOf.includes(':')) {
    ctx.addIssue({ code: 'custom', path: ['onAccountOf'], message: 'Select the client (on account of) for a contractual booking' });
  }
  for (const [i, inv] of d.invoices.entries()) {
    if (inv.invoiceDate && inv.invoiceDate > d.bookingDate) {
      ctx.addIssue({ code: 'custom', path: ['invoices', i, 'invoiceDate'], message: 'Invoice date can not be greater than booking date' });
    }
  }
  for (const [i, ins] of d.insurance.entries()) {
    if (ins.policyDate && ins.policyDate > d.bookingDate) {
      ctx.addIssue({ code: 'custom', path: ['insurance', i, 'policyDate'], message: 'Policy date can not be greater than booking date' });
    }
  }
  if (d.expectedDate && d.expectedDate < d.bookingDate) {
    ctx.addIssue({ code: 'custom', path: ['expectedDate'], message: 'Expected delivery date can not be before booking date' });
  }
});

export const cancelSchema = z.object({
  remark: z.string().trim().min(3, 'Please give a reason for cancelling').max(300),
});
