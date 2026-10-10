// Docket (GRN) freight / charges / GST calculation.
//
// Shared by the API (authoritative — it recomputes every total before saving)
// and the React form (live preview). Pure function, no dependencies.
//
// Ported from wwwroot/PageScript/OperationScript.js:
//   CalculatedFright()  -> freight from rate basis, special discount
//   CalOtherCharges()   -> fuel surcharge + "other charges" total
//   BindTaxRules()      -> minimum freight, IGST / CGST+SGST, grand total
// and cross-checked against the (commented-out) server-side rules in
// grn_class/DAL/OperationDAL.cs#ValidateGrnEntry.
//
// Deliberate differences from the legacy JS (see docs/DOCKET-CALCULATION.md):
//   1. Special discount is applied ONCE. Legacy (non-DIV1002, contractual)
//      deducted it from freight and then again from the grand total.
//   2. Fuel surcharge is included in the total for every customer type. Legacy
//      taxed it but left it out of the total for non-contractual customers.
//   3. The legacy server trusted totals sent by the browser; now the API
//      recomputes them with this function.

export const RATE_ON = ['WEIGHT', 'BOX', 'BAG', 'KM', 'FTL', 'FREIGHT', 'CATEGORY'];
export const TAX_MODES = ['IGST', 'GST', 'NA'];

/** The individual "other charge" fields (DocketInfo / Save_OtherCharges). */
export const OTHER_CHARGE_FIELDS = [
  ['handling', 'Handling'],
  ['halting', 'Halting'],
  ['fov', 'FOV'],
  ['oda', 'ODA'],
  ['stationary', 'Stationary'],
  ['topay', 'To-pay charge'],
  ['logistics', 'Logistics'],
  ['dod', 'DOD / DAC'],
  ['ocs', 'OCS'],
  ['service', 'Service'],
  ['risk', 'Risk'],
  ['loading', 'Loading'],
  ['unloading', 'Unloading'],
  ['collection', 'Collection'],
  ['delivery', 'Door delivery'],
  ['hamali', 'Hamali'],
  ['statistical', 'Statistical'],
  ['localCartage', 'Local cartage'],
  ['pf', 'P&F'],
];

const num = (v) => {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};
const round2 = (v) => Math.round((num(v) + Number.EPSILON) * 100) / 100;
const sum = (arr) => arr.reduce((a, b) => a + num(b), 0);

/**
 * @param {object} i
 * @param {string} i.divCode          e.g. 'DIV1002' changes the discount rule
 * @param {'DOC'|'NONDOC'} i.docType  documents are always charged per packet
 * @param {string} i.rateOn           one of RATE_ON
 * @param {number} i.rate
 * @param {number} i.packets
 * @param {number} i.chargeWeight     final chargeable weight
 * @param {number} [i.minWeight]      minimum chargeable weight
 * @param {number} [i.minFreight]
 * @param {number} [i.minBox]
 * @param {number} [i.distance]       for KM
 * @param {number} [i.ftlAmount]      for FTL
 * @param {number} [i.manualFreight]  for FREIGHT (freight typed by the user)
 * @param {number} [i.discountPercent] special discount %
 * @param {number|'Nil'} [i.fuelPercent]
 * @param {number} [i.docketCharge]
 * @param {object} [i.charges]        { handling, halting, ... } see OTHER_CHARGE_FIELDS
 * @param {Array<{amount:number}>} [i.additionalCharges]     taxable extras (Save_ChargeEntry)
 * @param {Array<{amount:number}>} [i.additionalChargesTax]  non-taxable extras added after tax (Save_ChargeEntryTax)
 * @param {'IGST'|'GST'|'NA'} [i.taxMode]
 * @param {number} [i.igstRate]
 * @param {number} [i.cgstRate]
 * @param {number} [i.sgstRate]
 * @param {string} [i.gstPaidBy]      'Billing Party' => tax not added to the total (reverse charge)
 */
export function calculateDocket(i) {
  const rateOn = String(i.rateOn || 'WEIGHT').toUpperCase();
  const isDoc = i.docType === 'DOC';
  const rate = num(i.rate);
  const minBox = num(i.minBox);
  const packets = Math.max(num(i.packets), minBox > 0 ? minBox : 0);
  const minWeight = num(i.minWeight);
  const chargeWeight = Math.max(num(i.chargeWeight), minWeight > 0 ? minWeight : 0);

  // ---- 1. base freight (CalculatedFright)
  let baseFreight;
  if (isDoc) baseFreight = rate * packets;
  else if (rateOn === 'KM') baseFreight = rate * num(i.distance);
  else if (rateOn === 'FTL') baseFreight = num(i.ftlAmount);
  else if (rateOn === 'BOX' || rateOn === 'BAG') baseFreight = rate * packets;
  else if (rateOn === 'CATEGORY') baseFreight = rate;
  else if (rateOn === 'FREIGHT') baseFreight = num(i.manualFreight);
  else baseFreight = rate * chargeWeight; // WEIGHT (and CFT-derived weight)
  baseFreight = round2(baseFreight);

  // ---- 2. special discount
  const discountPercent = num(i.discountPercent);
  const discountValue = discountPercent > 0 ? round2((baseFreight * discountPercent) / 100) : 0;
  // DIV1002 kept freight gross and deducted the discount from the total instead.
  const discountOnTotal = i.divCode === 'DIV1002';
  let freight = discountOnTotal ? baseFreight : round2(baseFreight - discountValue);

  // ---- 3. minimum freight (BindTaxRules)
  const minFreight = num(i.minFreight);
  const minFreightApplied = minFreight > freight;
  if (minFreightApplied) freight = round2(minFreight);

  // ---- 4. fuel surcharge (CalOtherCharges: freight * fuel% / 100, 'Nil' => 0)
  const fuelPercent = i.fuelPercent === 'Nil' ? 0 : num(i.fuelPercent);
  const fuelSurcharge = round2((freight * fuelPercent) / 100);

  // ---- 5. other charges
  const charges = i.charges || {};
  const chargeBreakup = Object.fromEntries(OTHER_CHARGE_FIELDS.map(([k]) => [k, round2(charges[k])]));
  const additionalTotal = round2(sum((i.additionalCharges || []).map((c) => c.amount)));
  const otherCharges = round2(sum(Object.values(chargeBreakup)) + additionalTotal);

  const docketCharge = round2(i.docketCharge);

  // ---- 6. GST on (freight + others + docket charge + fuel)
  const taxableAmount = round2(freight + otherCharges + docketCharge + fuelSurcharge);
  const taxMode = TAX_MODES.includes(i.taxMode) ? i.taxMode : 'NA';
  let igstRate = 0; let cgstRate = 0; let sgstRate = 0;
  if (taxMode === 'IGST') igstRate = num(i.igstRate);
  if (taxMode === 'GST') { cgstRate = num(i.cgstRate); sgstRate = num(i.sgstRate); }
  const igstAmount = round2((taxableAmount * igstRate) / 100);
  const cgstAmount = round2((taxableAmount * cgstRate) / 100);
  const sgstAmount = round2((taxableAmount * sgstRate) / 100);
  const totalTax = round2(igstAmount + cgstAmount + sgstAmount);
  const reverseCharge = i.gstPaidBy === 'Billing Party';

  // ---- 7. grand total
  const additionalTaxTotal = round2(sum((i.additionalChargesTax || []).map((c) => c.amount)));
  const grandTotal = round2(
    taxableAmount
    - (discountOnTotal ? discountValue : 0)
    + additionalTaxTotal
    + (reverseCharge ? 0 : totalTax),
  );

  return {
    rateOn,
    effectivePackets: packets,
    effectiveChargeWeight: chargeWeight,
    baseFreight,
    discountPercent,
    discountValue,
    freight,
    minFreightApplied,
    fuelPercent,
    fuelSurcharge,
    chargeBreakup,
    additionalTotal,
    otherCharges,
    docketCharge,
    taxableAmount,
    taxMode,
    igstRate, igstAmount,
    cgstRate, cgstAmount,
    sgstRate, sgstAmount,
    totalTax,
    reverseCharge,
    additionalTaxTotal,
    grandTotal,
  };
}

/**
 * One dimension row (OperationScript.js: CFT calc + GetTotalCFT).
 *   cft          = L*W*H*packets / divisor   (feet: no divisor)
 *   chargeWeight = cft * perCft
 * divisor: Inch 1728, mm 270000, cm 5000 for Air/Express (AI, EX) else 27000.
 */
export function dimensionRow({ length, width, height, packets, perCft, unit = 'cm', bookingMode }) {
  const l = num(length); const w = num(width); const h = num(height); const p = num(packets);
  if (!l || !w || !h || !p) return { cft: 0, chargeWeight: 0 };
  let cft;
  if (unit === 'feet') cft = l * w * h * p;
  else {
    let divisor;
    if (unit === 'Inch') divisor = 1728;
    else if (unit === 'mm') divisor = 270000;
    else divisor = bookingMode === 'AI' || bookingMode === 'EX' ? 5000 : 27000;
    cft = (l * w * h * p) / divisor;
  }
  cft = round2(cft);
  return { cft, chargeWeight: round2(cft * num(perCft)) };
}
