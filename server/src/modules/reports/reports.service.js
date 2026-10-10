// Reports. Pattern for replacing the 105 Crystal Reports (.rpt): the API returns
// rows + column metadata as JSON; the React ReportPage renders a table with
// totals and CSV/PDF export. Each report is a server-side definition — SQL text
// is a constant, filters are always parameters.
//
// Column names below follow the legacy inline SQL (ClassLibrary/dal/Dashboard_Dal.cs
// Docket_List: grn_master g ... g.Division, g.IsCancel, g.created_by) and the
// Save_DocketCharges parameter names for grn_docket_charge. Verify against the
// production schema script.

import { query } from '../../db/index.js';
import { badRequest, notFound } from '../../middleware/errors.js';

const HEAD_OFFICE = 'B1001';

const reports = {
  'docket-register': {
    title: 'Docket Booking Register',
    legacyPage: 'Report/Docket_Booking_Register.aspx',
    filters: [
      { name: 'from', label: 'From', type: 'date', required: true },
      { name: 'to', label: 'To', type: 'date', required: true },
      { name: 'status', label: 'Status', type: 'select', options: ['All', 'Booked', 'Cancelled'], default: 'Booked' },
      { name: 'bookingType', label: 'Booking type', type: 'select', options: ['All', 'To Pay', 'Paid', 'FOC'], default: 'All' },
    ],
    columns: [
      { key: 'Docket_No', title: 'Docket no.' },
      { key: 'booking_date', title: 'Date', type: 'date' },
      { key: 'origin', title: 'Origin' },
      { key: 'Destination', title: 'Destination' },
      { key: 'booking_type', title: 'Type' },
      { key: 'customer_type', title: 'Customer' },
      { key: 'Consigner_Name', title: 'Consignor' },
      { key: 'consignee_name', title: 'Consignee' },
      { key: 'pcs', title: 'Pkts', type: 'number', total: true },
      { key: 'charge_weight', title: 'Chg wt', type: 'number', total: true },
      { key: 'freight', title: 'Freight', type: 'money', total: true },
      { key: 'other_charge', title: 'Other', type: 'money', total: true },
      { key: 'service_tax', title: 'GST', type: 'money', total: true },
      { key: 'charges', title: 'Total', type: 'money', total: true },
      { key: 'status', title: 'Status' },
    ],
    async run(f, user) {
      const params = { div: user.divCode, from: f.from, to: f.to };
      let where = 'g.Division = @div and g.booking_date >= @from and g.booking_date <= @to';
      // Legacy rule (Dashboard_Dal.Docket_List): head office sees all branches.
      if (user.currentBranch.code !== HEAD_OFFICE) {
        where += ' and g.origin_branch = @branch';
        params.branch = user.currentBranch.code;
      }
      if (f.status === 'Booked') where += " and isnull(g.IsCancel,'0') = '0'";
      if (f.status === 'Cancelled') where += " and isnull(g.IsCancel,'0') <> '0'";
      if (f.bookingType && f.bookingType !== 'All') { where += ' and g.booking_type = @bt'; params.bt = f.bookingType; }
      if (user.role === 'client') { where += ' and g.on_account_of like @client'; params.client = `%:${user.userId}`; }
      return query(
        `select top 5000 g.Docket_No, g.booking_date, b.branch_name as origin, g.Destination, g.booking_type, g.customer_type,
                g.Consigner_Name, g.consignee_name, c.pcs, c.charge_weight, c.freight, c.other_charge, c.service_tax, c.charges,
                case when isnull(g.IsCancel,'0') = '0' then 'Booked' else 'Cancelled' end as status
           from grn_master g
           left join branch_master b on b.branch_code = g.origin_branch
           left join grn_docket_charge c on c.Docket_No = g.Docket_No
                 and isnull(c.branch, g.origin_branch) = g.origin_branch -- booking row (arrivals add one per branch)
          where ${where}
          order by g.booking_date desc, g.Docket_No desc`,
        params,
      );
    },
  },
};

export function listReports() {
  return Object.entries(reports).map(([key, r]) => ({ key, title: r.title, legacyPage: r.legacyPage }));
}

function getReport(key) {
  const r = reports[key];
  if (!r) throw notFound(`Unknown report "${key}"`);
  return r;
}

export function describe(key) {
  const { title, legacyPage, filters, columns } = getReport(key);
  return { key, title, legacyPage, filters, columns };
}

export async function runReport(key, rawFilters, user) {
  const r = getReport(key);
  const f = {};
  for (const flt of r.filters) {
    let v = rawFilters[flt.name] ?? flt.default ?? '';
    v = String(v).trim();
    if (flt.required && !v) throw badRequest(`${flt.label} is required`);
    if (flt.type === 'date' && v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw badRequest(`${flt.label} must be YYYY-MM-DD`);
    if (flt.type === 'select' && v && !flt.options.includes(v)) throw badRequest(`${flt.label} is invalid`);
    f[flt.name] = v;
  }
  if (f.from && f.to) {
    if (f.from > f.to) throw badRequest('From date must be before To date');
    const days = (new Date(f.to) - new Date(f.from)) / 86400000;
    if (days > 366) throw badRequest('Please choose a range of one year or less');
  }
  const rows = await r.run(f, user);
  return { ...describe(key), filtersApplied: f, rows, truncated: rows.length >= 5000 };
}
