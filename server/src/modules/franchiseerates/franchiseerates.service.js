// Franchisee rates — port of Rate/Franchisee_Commission_Master.aspx (FranchiseeCommissionMaster_dal) and
// Rate/Franchisees_Pickup_Delivery.aspx.
//
// Commission master: what franchisees earn, from an effective date — monthly rent / mobile bill / signage, commission on
// the base freight, and by mode:
//   * Road (RD): rows per booking type (Paid / To Pay / To Be Billed) —
//       LTL: % up to 3 tons and % for 3–6 tons;  FTL 3–6 tons / FTL 9–16 tons: vehicle type, commission per consignment,
//       share %;  FTL trailer: commission per vehicle, share %;
//   * Train (TR): train commission % and per-rail commission;  Air (AI): air commission %.
// Pickup / delivery: per franchisee, the pickup charge and the delivery commission per consignment — per document for
// documents, per weight band for non-documents — from an effective date.
//
// Changes from the pages (docs/MIGRATION.md "Franchisee rates"):
//   * the commission code (FCM…) is numbered inside the save's transaction and the road rows are saved with the header
//     (the page saved the header, then each row separately; a failed row left a header without rows);
//   * the same mode + effective date is refused (as on the page) and the same booking type + category twice in one save;
//     the effective date must be today or later, inside the start / end dates of the login year;
//   * the pickup / delivery page was a copy of the loan page — it reported "Not successfully saved" on success and sent
//     the user to LoanDetails.aspx; its grid swapped the document and weight-band columns. Rewritten on the same table.
import { query, withTransaction } from '../../db/index.js';
import { badRequest, conflict } from '../../middleware/errors.js';
import { financialYearRange } from '../../utils/legacy.js';
import { s, n, iso, today } from '../../utils/values.js';

export const MODES = { RD: 'Road', TR: 'Train', AI: 'Air' };
export const COMMISSION_MODES = { BookingType: 'Booking Type', DeliveryType: 'Delivery Type' };
export const BOOKING_TYPES = { Paid: 'Paid', Topay: 'To Pay', TBB: 'To Be Billed' };
export const CATEGORIES = { LTL: 'LTL 03 Tons', FTL36: 'FTL 36 Tons', FTL916: 'FTL 916 Tons', TRAILER: 'FTL Trailor' };
export const WEIGHT_BANDS = ['Up to 3 kg', '3 to 5 kg', '5-10 kg', '10- 50 kg', '50-100kg', 'Above 100 kg'];
export const DOC_TYPES = { DOC: 'Document', NONDOC: 'Non Document' };

/** FTL_36_List / FTL_916_List: vehicle (freight) types by capacity. */
export async function vehicleTypes() {
  const rows = await query("select container_code, freight_name, container_Capacity from freight_master where isnull(active_flag, 'Active') = 'Active' order by container_Capacity");
  const pick = (lo, hi) => rows.filter((r) => n(r.container_Capacity) >= lo && n(r.container_Capacity) <= hi)
    .map((r) => ({ value: s(r.freight_name), label: `${s(r.freight_name)} (${n(r.container_Capacity) / 1000} t)` }));
  return { ftl36: pick(3000, 6000), ftl916: pick(9000, 16000) };
}

function checkDates(user, body) {
  const fy = financialYearRange(user.financialYear);
  if (fy && (body.startDate < fy.from || body.endDate > fy.to)) throw badRequest('Date should be exist in current financial year');
  if (body.endDate < body.startDate) throw badRequest('End date should not be before the start date');
  if (body.effectiveDate < body.startDate || body.effectiveDate > body.endDate) throw badRequest('The effective date should be between the start and end dates');
  if (body.effectiveDate < today()) throw badRequest('The effective date cannot be in the past');
}

// ------------------------------------------------------------------ commission master

/** GetCommissionList: header + road rows, the one in force per mode marked. */
export async function listCommissions() {
  const heads = await query('select * from Franchisee_Commission_Master order by Mode, EffectiveDate desc, CommId desc');
  const rows = await query('select * from Franchisee_Commission_Master_Detail order by id');
  const byCode = new Map();
  for (const r of rows) {
    const k = s(r.CommId);
    if (!byCode.has(k)) byCode.set(k, []);
    byCode.get(k).push({
      bookingType: s(r.Booking_Type), category: s(r.Commission_1),
      // LTL: c2 = % up to 3 t, c4 = % 3–6 t;  FTL: c2 = vehicle type, c3 = per consignment / vehicle, c4 = share %
      ...(s(r.Commission_1) === CATEGORIES.LTL
        ? { upTo3Tons: n(r.Commission_2), from3To6Tons: n(r.Commission_4) }
        : { vehicleType: s(r.Commission_2), perConsignment: n(r.Commission_3), sharePercent: n(r.Commission_4) }),
    });
  }
  const inForce = new Map();
  const out = heads.map((h) => ({
    id: Number(h.CommId), code: s(h.Comm_Code), mode: s(h.Mode), modeName: MODES[s(h.Mode)] ?? s(h.Mode),
    commissionMode: s(h.Commission_Mode), rent: n(h.Rent), mobileBills: n(h.Mobile_Bills), signage: n(h.Signage_Payment),
    baseFreightPercent: n(h.Comm_On_Base_Freight), airPercent: n(h.Air_Commission), trainPercent: n(h.Train_Commission),
    trainPerRail: n(h.Train_V_Commission), startDate: iso(h.StartDate), endDate: iso(h.EndDate), effectiveDate: iso(h.EffectiveDate),
    rows: byCode.get(s(h.Comm_Code)) ?? [],
  }));
  for (const c of out) if (c.effectiveDate <= today() && !inForce.has(c.mode)) inForce.set(c.mode, c.id);
  return out.map((c) => ({ ...c, inForce: inForce.get(c.mode) === c.id, upcoming: c.effectiveDate > today() }));
}

/** btnsubmitRoad_Click / btnsubmit_Click (SaveRecord + SaveRecord_Detail). */
export async function createCommission(user, body) {
  checkDates(user, body);
  if (body.mode === 'RD') {
    if (!body.rows.length) throw badRequest('Add at least one commission row');
    const seen = new Set();
    const types = await vehicleTypes();
    for (const [i, r] of body.rows.entries()) {
      const k = `${r.bookingType}|${r.category}|${r.vehicleType ?? ''}`;
      if (seen.has(k)) throw badRequest(`Row ${i + 1}: Record Already Exist`);
      seen.add(k);
      if (r.category === 'FTL36' && !types.ftl36.some((t) => t.value === r.vehicleType)) throw badRequest(`Row ${i + 1}: select an FTL 3–6 tons vehicle type`);
      if (r.category === 'FTL916' && !types.ftl916.some((t) => t.value === r.vehicleType)) throw badRequest(`Row ${i + 1}: select an FTL 9–16 tons vehicle type`);
    }
  }
  if (body.mode === 'TR' && !(body.trainPercent > 0 || body.trainPerRail > 0)) throw badRequest('Enter the train commission');
  if (body.mode === 'AI' && !(body.airPercent > 0)) throw badRequest('Enter the air commission');
  return withTransaction(async (tx) => {
    // Check_Deplicate(EffectiveDate, Mode): "This Rate has AllReady Exist!"
    const [dup] = await query(
      'select top 1 Comm_Code from Franchisee_Commission_Master with (updlock, holdlock) where Mode = @m and EffectiveDate = @e',
      { m: body.mode, e: body.effectiveDate }, { tx });
    if (dup) throw conflict(`This rate already exists (${s(dup.Comm_Code)})`);
    const [mx] = await query(
      "select max(try_cast(substring(Comm_Code, 4, 20) as int)) as mx from Franchisee_Commission_Master with (updlock, holdlock) where Comm_Code like 'FCM%'", {}, { tx });
    const code = `FCM${String((Number(mx?.mx) || 0) + 1).padStart(4, '0')}`;
    const road = body.mode === 'RD';
    const [h] = await query(
      `insert into Franchisee_Commission_Master(Comm_Code, Agent_Type, Rent, Mobile_Bills, Signage_Payment, Commission_Mode, Booking_Type, Mode,
         Comm_On_Base_Freight, Air_Commission, Train_Commission, Train_V_Commission, StartDate, EndDate, EffectiveDate, UserId)
       output inserted.CommId
       values (@code, 'Franchisee', @rent, @mob, @sign, @cm, '', @mode, @base, @air, @tr, @trv, @sd, @ed, @e, @u)`,
      { code, rent: body.rent, mob: body.mobileBills, sign: body.signage, cm: body.commissionMode, mode: body.mode, base: body.baseFreightPercent,
        air: body.mode === 'AI' ? body.airPercent : 0, tr: body.mode === 'TR' ? body.trainPercent : 0, trv: body.mode === 'TR' ? body.trainPerRail : 0,
        sd: body.startDate, ed: body.endDate, e: body.effectiveDate, u: user.userId }, { tx });
    if (road) {
      for (const r of body.rows) {
        const bt = BOOKING_TYPES[r.bookingType];
        const c = r.category === 'LTL'
          ? [CATEGORIES.LTL, String(r.upTo3Tons ?? 0), 'LTL 36 Tons', String(r.from3To6Tons ?? 0)]
          : [CATEGORIES[r.category], r.category === 'TRAILER' ? bt : r.vehicleType, String(r.perConsignment ?? 0), String(r.sharePercent ?? 0)];
        await query(
          `insert into Franchisee_Commission_Master_Detail(CommId, Booking_Type, Commission_1, Commission_2, Commission_3, Commission_4)
           values (@id, @bt, @c1, @c2, @c3, @c4)`, { id: code, bt, c1: c[0], c2: c[1], c3: c[2], c4: c[3] }, { tx });
      }
    }
    return { id: Number(h.CommId), code, message: `Commission ${code} saved — from ${body.effectiveDate}` };
  });
}

// ------------------------------------------------------------------ pickup / delivery

/** GetBranchList: franchisees. */
export async function franchisees() {
  const rows = await query('select FranCode, FranName from Franchise_Master union select FranCode, FranName from MasterFranchise order by FranName');
  return rows.map((r) => ({ value: s(r.FranCode), label: `${s(r.FranName)} : ${s(r.FranCode)}` }));
}

export async function listPickupDelivery({ franchisee = '' } = {}) {
  const rows = await query(
    `select fm.*, coalesce(f.FranName, mf.FranName) as FranName from FranchiseeCommissionMaster fm
       left join Franchise_Master f on f.FranCode = fm.FranchiseeCode left join MasterFranchise mf on mf.FranCode = fm.FranchiseeCode
      where (@f = '' or fm.FranchiseeCode = @f)
      order by FranName, fm.PreDocument, fm.NonDockname, fm.Effective_Date desc, fm.id desc`, { f: franchisee });
  const list = rows.map((r) => ({
    id: Number(r.id), franchisee: s(r.FranchiseeCode), franchiseeName: s(r.FranName),
    docType: s(r.PreDocument) === 'Per Document' ? 'DOC' : 'NONDOC', band: s(r.PreDocument) === 'Per Document' ? 'Per Document' : s(r.NonDockname),
    pickup: n(r.Pickup), perConsignment: n(r.PerCon), effectiveDate: iso(r.Effective_Date),
  }));
  const key = (r) => `${r.franchisee}|${r.docType}|${r.band}`;
  const inForce = new Map();
  for (const r of list) if (r.effectiveDate <= today() && !inForce.has(key(r))) inForce.set(key(r), r.id);
  return list.map((r) => ({ ...r, inForce: inForce.get(key(r)) === r.id, upcoming: r.effectiveDate > today() }));
}

/** btnSave_Click (InsertLoanDetail / InsertAdvDetail on FranchiseeCommissionMaster): one row per band added. */
export async function createPickupDelivery(user, body) {
  const fy = financialYearRange(user.financialYear);
  if (body.effectiveDate < today()) throw badRequest('The effective date cannot be in the past');
  if (fy && (body.effectiveDate < fy.from || body.effectiveDate > fy.to)) throw badRequest(`The effective date should be in the financial year ${user.financialYear}`);
  if (!(await franchisees()).some((f) => f.value === body.franchisee)) throw badRequest('Select the franchisee');
  const bands = body.docType === 'DOC' ? ['Per Document'] : body.rows.map((r) => r.band);
  if (new Set(bands).size !== bands.length) throw badRequest('The same weight band is listed twice');
  const rows = body.docType === 'DOC' ? [{ band: 'Per Document', pickup: body.rows[0]?.pickup ?? 0, perConsignment: body.rows[0]?.perConsignment ?? 0 }] : body.rows;
  if (!rows.length) throw badRequest('Add at least one weight band');
  return withTransaction(async (tx) => {
    for (const r of rows) {
      if (body.docType === 'NONDOC' && !WEIGHT_BANDS.includes(r.band)) throw badRequest('Select the weight band');
      const [dup] = await query(
        `select top 1 id from FranchiseeCommissionMaster with (updlock, holdlock)
          where FranchiseeCode = @f and isnull(PreDocument, '') = @pd and isnull(NonDockname, '') = @nd and Effective_Date = @e`,
        { f: body.franchisee, pd: body.docType === 'DOC' ? 'Per Document' : '', nd: body.docType === 'DOC' ? '' : r.band, e: body.effectiveDate }, { tx });
      if (dup) throw conflict(`${r.band}: a rate from ${body.effectiveDate} already exists for this franchisee`);
      await query(
        `insert into FranchiseeCommissionMaster(FranchiseeCode, Pickup, PerCon, PreDocument, NonDockname, Effective_Date, User_Id, Financial_Year)
         values (@f, @p, @pc, @pd, @nd, @e, @u, @fy)`,
        { f: body.franchisee, p: r.pickup, pc: r.perConsignment, pd: body.docType === 'DOC' ? 'Per Document' : '',
          nd: body.docType === 'DOC' ? '' : r.band, e: body.effectiveDate, u: user.userId, fy: user.financialYear }, { tx });
    }
    return { saved: rows.length, message: `${rows.length} pickup / delivery rate(s) saved — from ${body.effectiveDate}` };
  });
}
