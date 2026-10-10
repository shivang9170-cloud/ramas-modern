// Conversions between the antd form state and the API payload for dockets.
import dayjs from 'dayjs';

const toDate = (v) => (v ? dayjs(v).format('YYYY-MM-DD') : '');
const fromDate = (v) => (v ? dayjs(v) : null);

const emptyParty = { code: '', name: '', address: '', city: '', state: '', pinCode: '', phone: '', gstin: '' };

export function initialValues(user) {
  return {
    bookingDate: dayjs(),
    expectedDate: null,
    bookingMode: 'RD',
    customerType: 'General Client',
    docType: 'NONDOC',
    loadType: 'PTL',
    bookingType: 'Paid',
    // DIV1001 (courier) always used door delivery; the legacy page locked it.
    deliveryMode: 'DM-101',
    gstPaidBy: 'Transporter',
    rateOn: 'WEIGHT',
    taxMode: 'NA',
    packets: 1,
    fuelPercent: 0,
    discountPercent: 0,
    consigner: { ...emptyParty },
    consignee: { ...emptyParty },
    charges: {},
    invoices: [],
    dimensions: [],
    additionalCharges: [],
    additionalChargesTax: [],
    dimensionUnit: 'cm',
    originCity: user?.cityCode ?? '',
    international: { shipmentType: 'DOMESTIC' },
  };
}

/** Form values -> API body (docket.schema.js). */
export function toPayload(v) {
  const body = { ...v };
  delete body.dimensionUnit;
  body.bookingDate = toDate(v.bookingDate);
  body.expectedDate = toDate(v.expectedDate);
  body.invoices = (v.invoices || []).filter((i) => i?.invoiceNo).map((i) => ({
    ...i,
    invoiceDate: toDate(i.invoiceDate),
    eWayBillDate: toDate(i.eWayBillDate),
    eWayBillValidDate: toDate(i.eWayBillValidDate),
  }));
  body.insurance = (v.insurance || []).filter((i) => i?.riskAt).map((i) => ({ ...i, policyDate: toDate(i.policyDate) }));
  body.dimensions = (v.dimensions || []).filter((d) => d && Number(d.packets) > 0);
  body.additionalCharges = (v.additionalCharges || []).filter((c) => c?.name);
  body.additionalChargesTax = (v.additionalChargesTax || []).filter((c) => c?.name);
  for (const k of ['consigner', 'consignee']) body[k] = { ...emptyParty, ...(v[k] || {}) };
  // export / import: only the shipment type for a domestic docket
  const x = v.international || {};
  body.international = !x.shipmentType || x.shipmentType === 'DOMESTIC'
    ? { shipmentType: 'DOMESTIC' }
    : { ...x, customsDocDate: toDate(x.customsDocDate) };
  delete body.international.invoiceValueInr;
  // strip undefined so zod defaults apply
  return JSON.parse(JSON.stringify(body));
}

/** API docket (GET /dockets/:no) -> form values. */
export function fromDocket(doc) {
  const h = doc.header;
  return {
    docketNo: h.docketNo,
    manualDocketNo: h.manualDocketNo,
    bookingDate: fromDate(h.bookingDate),
    expectedDate: fromDate(h.expectedDate),
    bookingMode: h.bookingMode,
    customerType: h.customerType || 'General Client',
    docType: h.docType,
    loadType: h.loadType,
    bookingType: h.bookingType,
    deliveryMode: h.deliveryMode,
    originCity: h.originCity,
    destination: h.destination,
    destinationBranch: h.destinationBranch,
    destinationLocation: h.destinationLocation,
    pinCode: h.pinCode,
    onAccountOf: h.onAccountOf,
    billingAt: h.billingAt,
    consigner: { ...emptyParty, ...h.consigner },
    consignee: { ...emptyParty, ...h.consignee },
    consignerBillingAt: h.consignerBillingAt,
    consigneeBillingAt: h.consigneeBillingAt,
    originLocation: h.originLocation,
    itemContent: h.itemContent,
    itemDescription: h.itemDescription,
    pkgSize: h.pkgSize,
    remarks: h.remarks,
    eWayBill: h.eWayBill,
    gstPaidBy: h.gstPaidBy,
    ...doc.pricing,
    charges: { ...doc.pricing.charges },
    invoices: doc.invoices.map((i) => ({
      ...i, invoiceDate: fromDate(i.invoiceDate), eWayBillDate: fromDate(i.eWayBillDate), eWayBillValidDate: fromDate(i.eWayBillValidDate),
    })),
    insurance: doc.insurance.map((i) => ({ ...i, policyDate: fromDate(i.policyDate) })),
    dimensions: doc.dimensions,
    additionalCharges: doc.additionalCharges,
    additionalChargesTax: doc.additionalChargesTax,
    dimensionUnit: 'cm',
    international: doc.international
      ? { ...doc.international, customsDocDate: fromDate(doc.international.customsDocDate) }
      : { shipmentType: 'DOMESTIC' },
  };
}
