// ODA master and configuration — port of Setting/ODA_Master_And_Configuration.aspx (ODA_Master_And_Configuration_Dal).
//
// Two masters of ranges — ODA distance bands (km) and ODA weight bands (kg) — and the configuration: the ODA rate for a
// distance band × weight band from an effective date. (The DIV1002 parcel ODA lookup Get_ODACharge reads it; that
// docket lookup is not ported yet — the docket uses the location ODA Charge page.)
//
// Changes from the page (docs/MIGRATION.md "Settings"):
//   * a band may not overlap another band of the same master (the page only refused a from / to value that fell
//     inside an existing band, so a wider band could swallow one) and "from" must be below "to";
//   * a configuration is one per distance band + weight band + effective date (the page refused a second rate for the
//     pair whatever the date, so a rate could never change except by editing the old one in place);
//   * added configuration rows are saved in one transaction.
import { query, withTransaction } from '../../db/index.js';
import { badRequest, conflict, notFound } from '../../middleware/errors.js';
import { s, n, iso } from '../../utils/values.js';

// rbl_type 1 = distance, 2 = weight (identifiers only from here)
export const MASTERS = {
  distance: { table: 'ODA_Distance_Master', from: 'from_distance', to: 'to_distance', name: 'distance_name', unit: 'KMS' },
  weight: { table: 'ODA_Weight_Master', from: 'from_weight', to: 'to_weight', name: 'weight_name', unit: 'KGS' },
};

const mapBand = (m) => (r) => ({ id: Number(r.ID), from: n(r[m.from]), to: n(r[m.to]), name: s(r[m.name]), active: Boolean(r.IsActive) });

export async function listBands(kind) {
  const m = MASTERS[kind];
  return (await query(`select * from ${m.table} order by ${m.from}`)).map(mapBand(m));
}

async function saveBand(user, kind, body, id = null) {
  const m = MASTERS[kind];
  if (!(body.from < body.to)) throw badRequest('"From" should be less than "To"');
  return withTransaction(async (tx) => {
    if (id) {
      const [cur] = await query(`select ID from ${m.table} where ID = @id`, { id }, { tx });
      if (!cur) throw notFound('Band not found');
    }
    // CHECK_VALUE_ALREADY_EXISTS_IN_ODA_MASTERS(_ON_EDIT): no overlap with another band
    const [dup] = await query(
      `select top 1 ${m.name} as name from ${m.table} with (updlock, holdlock)
        where (@id is null or ID <> @id) and ${m.from} <= @to and ${m.to} >= @from`, { id, from: body.from, to: body.to }, { tx });
    if (dup) throw conflict(`The band overlaps ${s(dup.name)}`);
    const name = `${body.from} to ${body.to} ${m.unit}`;
    if (id) {
      await query(`update ${m.table} set ${m.from} = @from, ${m.to} = @to, ${m.name} = @name, IsActive = @a, modified_by = @u, modified_date = getdate() where ID = @id`,
        { from: body.from, to: body.to, name, a: body.active ? 1 : 0, u: user.userId, id }, { tx });
      return { id, message: `${name} updated` };
    }
    const [row] = await query(
      `insert into ${m.table}(${m.from}, ${m.to}, ${m.name}, IsActive, created_by) output inserted.ID values (@from, @to, @name, @a, @u)`,
      { from: body.from, to: body.to, name, a: body.active ? 1 : 0, u: user.userId }, { tx });
    return { id: Number(row.ID), message: `${name} saved` };
  });
}

export const createBand = (user, kind, body) => saveBand(user, kind, body);
export const updateBand = (user, kind, id, body) => saveBand(user, kind, body, id);

// ------------------------------------------------------------------ configuration

const CONFIG_SELECT = `
  select c.*, d.distance_name, w.weight_name from ODA_Configuration_Master c
    left join ODA_Distance_Master d on d.ID = c.ODA_Distance_ID
    left join ODA_Weight_Master w on w.ID = c.ODA_Weight_ID`;
const mapConfig = (r) => ({
  id: Number(r.ID), distanceId: Number(r.ODA_Distance_ID), distanceName: s(r.distance_name), weightId: Number(r.ODA_Weight_ID),
  weightName: s(r.weight_name), rate: n(r.ODA_Rate), effectiveDate: iso(r.Effective_Date), active: Boolean(r.IsActive),
});

export async function listConfig() {
  return (await query(`${CONFIG_SELECT} order by d.from_distance, w.from_weight, c.Effective_Date desc`)).map(mapConfig);
}

async function checkBands(tx, distanceId, weightId) {
  const [d] = await query('select ID from ODA_Distance_Master where ID = @id and IsActive = 1', { id: distanceId }, { tx });
  if (!d) throw badRequest('Select an active distance band');
  const [w] = await query('select ID from ODA_Weight_Master where ID = @id and IsActive = 1', { id: weightId }, { tx });
  if (!w) throw badRequest('Select an active weight band');
}

async function checkDuplicate(tx, r, id = null) {
  const [dup] = await query(
    `select top 1 ID from ODA_Configuration_Master with (updlock, holdlock)
      where ODA_Distance_ID = @d and ODA_Weight_ID = @w and Effective_Date = @e and (@id is null or ID <> @id)`,
    { d: r.distanceId, w: r.weightId, e: r.effectiveDate, id }, { tx });
  if (dup) throw conflict('A rate for this distance, weight and effective date already exists');
}

/** btnsubmit_Click (configuration): the rows added with ImageButtonAdd_Click, all or none. */
export async function createConfig(user, rows) {
  const keys = new Set();
  for (const r of rows) {
    const k = `${r.distanceId}|${r.weightId}|${r.effectiveDate}`;
    if (keys.has(k)) throw badRequest('Rate already added for the selection');
    keys.add(k);
  }
  return withTransaction(async (tx) => {
    for (const r of rows) {
      await checkBands(tx, r.distanceId, r.weightId);
      await checkDuplicate(tx, r);
      await query(
        `insert into ODA_Configuration_Master(ODA_Distance_ID, ODA_Weight_ID, ODA_Rate, Effective_Date, IsActive, created_by)
         values (@d, @w, @r, @e, 1, @u)`, { d: r.distanceId, w: r.weightId, r: r.rate, e: r.effectiveDate, u: user.userId }, { tx });
    }
    return { saved: rows.length, message: `${rows.length} ODA rate(s) saved` };
  });
}

export async function updateConfig(user, id, body) {
  return withTransaction(async (tx) => {
    const [cur] = await query('select ID from ODA_Configuration_Master where ID = @id', { id }, { tx });
    if (!cur) throw notFound('ODA rate not found');
    await checkBands(tx, body.distanceId, body.weightId);
    await checkDuplicate(tx, body, id);
    await query(
      `update ODA_Configuration_Master set ODA_Distance_ID = @d, ODA_Weight_ID = @w, ODA_Rate = @r, Effective_Date = @e, IsActive = @a,
         modified_by = @u, modified_date = getdate() where ID = @id`,
      { d: body.distanceId, w: body.weightId, r: body.rate, e: body.effectiveDate, a: body.active ? 1 : 0, u: user.userId, id }, { tx });
    return { id, message: 'ODA rate updated' };
  });
}
