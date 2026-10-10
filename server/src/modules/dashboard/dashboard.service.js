// Analytics dashboard — replaces default.aspx / MainDashboard.aspx's few counters with a full analysis of the business, in five
// sections (overview, bookings, operations, billing, vendors & accounts). Every dataset is read-only and filtered by the login
// division, a date range and optionally the current branch. Each function returns the data for one tab; the page draws 60+ charts.
import { query } from '../../db/index.js';
import { s, n, iso, today, round2 } from '../../utils/values.js';

// one docket per row, with its weight / freight, client and latest delivery status
const DK = `select g.docket_no, g.booking_date, g.created_date, g.booking_type, g.booking_mode, g.LoadType, g.DocsNoneDocs, g.customer_type,
    g.gstPaidBy, g.origin_branch, g.destination_branch, g.destination, g.ODA_Location, try_cast(g.ExpectedDate as date) as expected,
    g.DocketStatus, g.manifest_status, g.Arrived_status, g.drs_status, g.Invoice_status, isnull(try_cast(g.IsCancel as int), 0) as cancelled,
    case when charindex(':', coalesce(nullif(g.on_account_of, ''), g.consigner_name, '')) > 0
         then left(g.on_account_of, charindex(':', g.on_account_of) - 1) else coalesce(nullif(g.on_account_of, ''), g.consigner_name, '') end as client,
    isnull(c.charge_weight, 0) as wt, isnull(c.pcs, 0) as pcs,
    case when isnull(c.FtlRate, 0) > 0 then c.FtlRate else isnull(c.freight, 0) end as freight,
    ds.pkt_status, cast(ds.rcv_date as date) as rcv_date, ds.remarks as ds_remarks
  from grn_master g left join grn_docket_charge c on c.Docket_No = g.docket_no
  outer apply (select top 1 x.pkt_status, x.rcv_date, x.remarks from delivery_status_entry_details x
                where x.docket_no = g.docket_no and isnull(x.IsCancelled, 0) = 0 order by x.id desc) ds
 where g.booking_date between @from and @to and (@div = '' or g.Division = @div) and (@br = '' or g.origin_branch = @br)`;
const STAGE = `case when cancelled = 1 then 'Cancelled' when pkt_status = 'DLVRD' then 'Delivered' when pkt_status = 'UNDELIVERED' then 'Undelivered'
  when pkt_status = 'RTO' then 'RTO' when pkt_status = 'LOST' then 'Lost'
  when DocketStatus = 'OUT FOR DELIVERY' or drs_status is not null then 'Out for delivery'
  when DocketStatus = 'ARRIVED' or Arrived_status is not null then 'Arrived' when DocketStatus = 'CHALLAN GENERATED' then 'In transit'
  when manifest_status is not null then 'Manifested' else 'Booked' end`;
const live = 'cancelled = 0';

const params = (user, q) => ({
  from: q.from, to: q.to, div: s(user.divCode), br: q.scope === 'branch' ? user.currentBranch.code : '',
});
const num = (rows, keys) => rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, keys.includes(k) ? round2(n(v)) : (v instanceof Date ? iso(v) : v)])));
const q = (sql, p, keys = []) => query(sql, p).then((rows) => num(rows, keys));
const days = (from, to) => Math.round((new Date(to) - new Date(from)) / 86400000) + 1;
const shift = (d, by) => new Date(new Date(d).getTime() + by * 86400000).toISOString().slice(0, 10);
const MONTH = "convert(varchar(7), %s, 120)";
const month = (col) => MONTH.replace('%s', col);

// ------------------------------------------------------------------ overview

async function kpis(p) {
  const [d] = await query(
    `with d as (${DK}) select count(*) as dockets, sum(case when ${live} then freight else 0 end) as freight, sum(case when ${live} then wt else 0 end) as weight,
       sum(case when ${live} then pcs else 0 end) as packages, sum(cancelled) as cancelled,
       sum(case when pkt_status = 'DLVRD' then 1 else 0 end) as delivered,
       sum(case when ${live} and (pkt_status is null or pkt_status = 'UNDELIVERED') then 1 else 0 end) as pending,
       sum(case when pkt_status = 'DLVRD' and expected is not null and rcv_date <= expected then 1 else 0 end) as on_time,
       sum(case when pkt_status = 'DLVRD' and expected is not null then 1 else 0 end) as with_expected,
       count(distinct case when ${live} then client end) as clients from d`, p);
  const [b] = await query(
    `select isnull(sum(case when client_bill_status is null then totalamount end), 0) as billed, count(*) as bills from client_bill
      where bill_date between @from and @to and (@div = '' or division = @div) and (@br = '' or origin_branch = @br)`, p);
  const [r] = await query(
    `select isnull(sum(Receive_Amount + isnull(TDS, 0)), 0) as collected from Bill_Receive
      where Receive_Date between @from and @to and IsCancelled = 0 and (@div = '' or Division = @div) and (@br = '' or Branch = @br)`, p);
  const [c] = await query(
    `select count(*) as challans, isnull(sum(try_cast(total_freight as decimal(18,2))), 0) as hire from dispatch_master
      where challan_date between @from and @to and isnull(IsCancelled, '0') = '0' and (@div = '' or div_code = @div) and (@br = '' or from_branch = @br)`, p);
  return {
    dockets: n(d.dockets), freight: round2(n(d.freight)), weight: round2(n(d.weight)), packages: n(d.packages), cancelled: n(d.cancelled),
    delivered: n(d.delivered), pending: n(d.pending), onTime: n(d.on_time), withExpected: n(d.with_expected), clients: n(d.clients),
    billed: round2(n(b.billed)), bills: n(b.bills), collected: round2(n(r.collected)), challans: n(c.challans), hire: round2(n(c.hire)),
  };
}

export async function overview(user, qs) {
  const p = params(user, qs);
  const len = days(p.from, p.to);
  const prev = { ...p, from: shift(p.from, -len), to: shift(p.from, -1) };
  const [cur, before, daily, outstanding, clientsNow, clientsBefore, stages, lanes] = await Promise.all([
    kpis(p), kpis(prev),
    q(`with d as (${DK}) select booking_date as date, count(*) as dockets, sum(case when ${live} then freight else 0 end) as freight
         from d group by booking_date order by booking_date`, p, ['freight']),
    query(`select isnull(sum(cb.totalamount - isnull(r.settled, 0)), 0) as amt, count(*) as bills from client_bill cb
             outer apply (select sum(Settled) as settled from Bill_Receive_Details x where x.Bill_no = cb.bill_no and x.IsCancelled = 0) r
            where cb.client_bill_status is null and isnull(cb.Payment_Status, 0) = 0 and (@div = '' or cb.division = @div) and (@br = '' or cb.origin_branch = @br)`, p),
    q(`with d as (${DK}) select client, sum(freight) as freight from d where ${live} and client <> '' group by client`, p, ['freight']),
    q(`with d as (${DK}) select client, sum(freight) as freight from d where ${live} and client <> '' group by client`, prev, ['freight']),
    q(`with d as (${DK}) select ${STAGE} as stage, count(*) as dockets from d group by ${STAGE}`, p),
    q(`with d as (${DK}) select isnull(b.branch_name, d.destination_branch) as dest, avg(cast(datediff(day, d.booking_date, d.rcv_date) as float)) as days,
         count(*) as dockets from d left join branch_master b on b.branch_code = d.destination_branch
        where d.pkt_status = 'DLVRD' group by isnull(b.branch_name, d.destination_branch) having count(*) >= 5`, p, ['days']),
  ]);
  // insights: plain-language findings worked out from the numbers
  const insights = [];
  const pct = (a, b) => (b ? round2(((a - b) / b) * 100) : null);
  const g = pct(cur.freight, before.freight);
  if (g !== null) insights.push({ type: g >= 0 ? 'good' : 'bad', text: `Freight is ${g >= 0 ? 'up' : 'down'} ${Math.abs(g)}% on the previous ${len} days (₹ ${cur.freight.toLocaleString('en-IN')} vs ₹ ${before.freight.toLocaleString('en-IN')}).` });
  const sorted = [...clientsNow].sort((a, b) => b.freight - a.freight);
  const total = sorted.reduce((t, c) => t + c.freight, 0);
  if (sorted[0] && total) insights.push({ type: 'info', text: `Top client ${sorted[0].client} brings ${round2((sorted[0].freight / total) * 100)}% of freight; the top 3 bring ${round2((sorted.slice(0, 3).reduce((t, c) => t + c.freight, 0) / total) * 100)}%.` });
  const prevMap = new Map(clientsBefore.map((c) => [c.client, c.freight]));
  const prevTotal = clientsBefore.reduce((t, c) => t + c.freight, 0);
  // only clients that mattered before (≥ 2 % of the previous period's freight), so a tiny walk-in does not top the list
  const growth = sorted.filter((c) => prevMap.get(c.client) > 0 && prevMap.get(c.client) >= prevTotal * 0.02).map((c) => ({ ...c, g: pct(c.freight, prevMap.get(c.client)) })).sort((a, b) => b.g - a.g);
  if (growth[0]) insights.push({ type: 'good', text: `Fastest growing client: ${growth[0].client} (+${growth[0].g}%).` });
  if (growth.length > 1 && growth.at(-1).g < 0) insights.push({ type: 'bad', text: `Biggest drop: ${growth.at(-1).client} (${growth.at(-1).g}%) — worth a sales call.` });
  const lost = clientsBefore.filter((c) => c.freight >= prevTotal * 0.02 && !clientsNow.some((x) => x.client === c.client));
  if (lost.length) insights.push({ type: 'bad', text: `${lost.length} regular client(s) of the previous period have not booked in this one: ${lost.slice(0, 3).map((c) => c.client).join(', ')}.` });
  if (cur.withExpected) insights.push({ type: cur.onTime / cur.withExpected >= 0.85 ? 'good' : 'bad', text: `On-time delivery is ${round2((cur.onTime / cur.withExpected) * 100)}% (delivered on or before the expected date).` });
  const slow = [...lanes].sort((a, b) => b.days - a.days)[0];
  if (slow) insights.push({ type: 'info', text: `Slowest destination branch: ${slow.dest}, ${round2(slow.days)} days from booking to delivery on average.` });
  if (cur.billed) insights.push({ type: cur.collected >= cur.billed ? 'good' : 'info', text: `Collected ₹ ${cur.collected.toLocaleString('en-IN')} against ₹ ${cur.billed.toLocaleString('en-IN')} billed in the period (${round2((cur.collected / cur.billed) * 100)}%).` });
  if (cur.freight && cur.hire) insights.push({ type: 'info', text: `Vehicle hire is ${round2((cur.hire / cur.freight) * 100)}% of booked freight — gross margin about ${round2(100 - (cur.hire / cur.freight) * 100)}%.` });
  const busiest = daily.reduce((m, d) => (d.dockets > (m?.dockets ?? 0) ? d : m), null);
  if (busiest) insights.push({ type: 'info', text: `Busiest day: ${busiest.date} with ${busiest.dockets} dockets.` });
  return {
    range: { from: p.from, to: p.to, prevFrom: prev.from, prevTo: prev.to, days: len },
    kpis: cur, previous: before, daily, stages,
    outstanding: { amount: round2(n(outstanding[0]?.amt)), bills: n(outstanding[0]?.bills) }, insights,
  };
}

// ------------------------------------------------------------------ bookings

export async function bookings(user, qs) {
  const p = params(user, qs);
  const mix = (col, label = col) => q(`with d as (${DK}) select isnull(nullif(cast(${col} as varchar(60)), ''), 'Not set') as name, count(*) as dockets, sum(freight) as freight
     from d where ${live} group by isnull(nullif(cast(${col} as varchar(60)), ''), 'Not set') order by count(*) desc`, p, ['freight']).then((r) => ({ label, rows: r }));
  const [daily, monthly, weekday, hour, heat, bookingType, mode, load, docs, customerType, gstPaidBy, weightBands, freightBands, clients, destinations,
    lanes, branches, branchMonth, oda, yieldByMode, cancelByBranch, avgByMode] = await Promise.all([
    q(`with d as (${DK}) select booking_date as date, count(*) as dockets, sum(freight) as freight, sum(wt) as weight from d where ${live}
         group by booking_date order by booking_date`, p, ['freight', 'weight']),
    q(`with d as (${DK}) select ${month('booking_date')} as month, count(*) as dockets, sum(freight) as freight, sum(wt) as weight from d where ${live}
         group by ${month('booking_date')} order by 1`, p, ['freight', 'weight']),
    q(`with d as (${DK}) select (datepart(weekday, booking_date) + @@datefirst - 2) % 7 as dow, count(*) as dockets, sum(freight) as freight from d
         where ${live} group by (datepart(weekday, booking_date) + @@datefirst - 2) % 7 order by 1`, p, ['freight']),
    q(`with d as (${DK}) select datepart(hour, created_date) as hour, count(*) as dockets from d where ${live} and created_date is not null
         group by datepart(hour, created_date) order by 1`, p),
    q(`with d as (${DK}) select (datepart(weekday, booking_date) + @@datefirst - 2) % 7 as dow, datepart(hour, created_date) as hour, count(*) as dockets
         from d where ${live} and created_date is not null group by (datepart(weekday, booking_date) + @@datefirst - 2) % 7, datepart(hour, created_date)`, p),
    mix('booking_type', 'Booking type'), mix('booking_mode', 'Mode'), mix('LoadType', 'Load type'),
    mix("case DocsNoneDocs when '1' then 'Document' when '2' then 'Non-document' else DocsNoneDocs end", 'Document / non-document'),
    mix('customer_type', 'Customer type'), mix('gstPaidBy', 'GST paid by'),
    q(`with d as (${DK}) select band, min(o) as o, count(*) as dockets, sum(freight) as freight from (select freight,
         case when wt <= 5 then '0–5 kg' when wt <= 20 then '5–20 kg' when wt <= 50 then '20–50 kg' when wt <= 100 then '50–100 kg'
              when wt <= 250 then '100–250 kg' when wt <= 500 then '250–500 kg' when wt <= 1000 then '0.5–1 t' when wt <= 5000 then '1–5 t' else '5 t +' end as band,
         case when wt <= 5 then 1 when wt <= 20 then 2 when wt <= 50 then 3 when wt <= 100 then 4 when wt <= 250 then 5 when wt <= 500 then 6
              when wt <= 1000 then 7 when wt <= 5000 then 8 else 9 end as o from d where ${live}) x group by band order by o`, p, ['freight']),
    q(`with d as (${DK}) select band, min(o) as o, count(*) as dockets from (select
         case when freight < 250 then '< 250' when freight < 500 then '250–500' when freight < 1000 then '500–1k' when freight < 2500 then '1k–2.5k'
              when freight < 5000 then '2.5k–5k' when freight < 10000 then '5k–10k' when freight < 25000 then '10k–25k' else '25k +' end as band,
         case when freight < 250 then 1 when freight < 500 then 2 when freight < 1000 then 3 when freight < 2500 then 4 when freight < 5000 then 5
              when freight < 10000 then 6 when freight < 25000 then 7 else 8 end as o from d where ${live}) x group by band order by o`, p),
    q(`with d as (${DK}) select client as name, count(*) as dockets, sum(freight) as freight, sum(wt) as weight from d where ${live} and client <> ''
         group by client order by sum(freight) desc`, p, ['freight', 'weight']),
    q(`with d as (${DK}) select isnull(nullif(destination, ''), destination_branch) as name, count(*) as dockets, sum(freight) as freight from d where ${live}
         group by isnull(nullif(destination, ''), destination_branch) order by count(*) desc`, p, ['freight']),
    q(`with d as (${DK}) select d.origin_branch + N' → ' + d.destination_branch as lane, bo.branch_name as origin, bd.branch_name as destination, count(*) as dockets,
         sum(d.freight) as freight, avg(d.wt) as avg_weight, sum(d.freight) / nullif(sum(d.wt), 0) as per_kg
         from d left join branch_master bo on bo.branch_code = d.origin_branch left join branch_master bd on bd.branch_code = d.destination_branch
        where ${live} group by d.origin_branch, d.destination_branch, bo.branch_name, bd.branch_name order by count(*) desc`, p, ['freight', 'avg_weight', 'per_kg']),
    q(`with d as (${DK}) select isnull(b.branch_name, d.origin_branch) as name, count(*) as dockets, sum(d.freight) as freight, sum(d.wt) as weight
         from d left join branch_master b on b.branch_code = d.origin_branch where ${live} group by isnull(b.branch_name, d.origin_branch) order by 3 desc`, p, ['freight', 'weight']),
    q(`with d as (${DK}) select isnull(b.branch_name, d.origin_branch) as branch, ${month('d.booking_date')} as month, count(*) as dockets, sum(d.freight) as freight
         from d left join branch_master b on b.branch_code = d.origin_branch where ${live} group by isnull(b.branch_name, d.origin_branch), ${month('d.booking_date')}`, p, ['freight']),
    q(`with d as (${DK}) select sum(case when isnull(ODA_Location, '') <> '' then 1 else 0 end) as oda, count(*) as total from d where ${live}`, p),
    q(`with d as (${DK}) select booking_mode as name, sum(freight) / nullif(sum(wt), 0) as per_kg, sum(freight) / nullif(count(*), 0) as per_docket,
         avg(wt) as avg_weight from d where ${live} group by booking_mode`, p, ['per_kg', 'per_docket', 'avg_weight']),
    q(`with d as (${DK}) select isnull(b.branch_name, d.origin_branch) as name, sum(d.cancelled) as cancelled, count(*) as total,
         100.0 * sum(d.cancelled) / nullif(count(*), 0) as pct from d left join branch_master b on b.branch_code = d.origin_branch
        group by isnull(b.branch_name, d.origin_branch)`, p, ['pct']),
    q(`with d as (${DK}) select booking_type as name, avg(freight) as freight, avg(wt) as weight from d where ${live} group by booking_type`, p, ['freight', 'weight']),
  ]);
  return {
    daily, monthly, weekday, hour, heat, mixes: [bookingType, mode, load, docs, customerType, gstPaidBy], weightBands, freightBands,
    clients, destinations, lanes, branches, branchMonth, oda: oda[0] ?? { oda: 0, total: 0 }, yieldByMode, cancelByBranch, avgByType: avgByMode,
  };
}

// ------------------------------------------------------------------ operations

export async function operations(user, qs) {
  const p = params(user, qs);
  const [funnel, stages, outcomes, transit, transitByDest, transitByMode, onTimeMonthly, ageing, reasons, manifests, vendors, hireMonthly,
    vendorType, utilisation, pickups, pod, podDays, shortage, drivers] = await Promise.all([
    q(`with d as (${DK}) select count(*) as booked,
         sum(case when manifest_status is not null or DocketStatus in ('MANIFEST GENERATED', 'CHALLAN GENERATED', 'ARRIVED', 'OUT FOR DELIVERY') or pkt_status is not null then 1 else 0 end) as manifested,
         sum(case when DocketStatus in ('CHALLAN GENERATED', 'ARRIVED', 'OUT FOR DELIVERY') or Arrived_status is not null or pkt_status is not null then 1 else 0 end) as dispatched,
         sum(case when DocketStatus in ('ARRIVED', 'OUT FOR DELIVERY') or Arrived_status is not null or pkt_status is not null then 1 else 0 end) as arrived,
         sum(case when DocketStatus = 'OUT FOR DELIVERY' or drs_status is not null or pkt_status is not null then 1 else 0 end) as out_for_delivery,
         sum(case when pkt_status = 'DLVRD' then 1 else 0 end) as delivered from d where ${live}`, p),
    q(`with d as (${DK}) select ${STAGE} as name, count(*) as dockets, sum(freight) as freight from d group by ${STAGE} order by 2 desc`, p, ['freight']),
    q(`with d as (${DK}) select case pkt_status when 'DLVRD' then 'Delivered' when 'UNDELIVERED' then 'Undelivered' else pkt_status end as name, count(*) as dockets
         from d where pkt_status is not null group by pkt_status order by 2 desc`, p),
    q(`with d as (${DK}) select datediff(day, booking_date, rcv_date) as days, count(*) as dockets from d where pkt_status = 'DLVRD'
         group by datediff(day, booking_date, rcv_date) order by 1`, p),
    q(`with d as (${DK}) select isnull(b.branch_name, d.destination_branch) as name, avg(cast(datediff(day, d.booking_date, d.rcv_date) as float)) as days,
         100.0 * sum(case when d.rcv_date <= d.expected then 1 else 0 end) / nullif(count(*), 0) as on_time, count(*) as dockets
         from d left join branch_master b on b.branch_code = d.destination_branch where d.pkt_status = 'DLVRD' group by isnull(b.branch_name, d.destination_branch)`, p, ['days', 'on_time']),
    q(`with d as (${DK}) select booking_mode as name, avg(cast(datediff(day, booking_date, rcv_date) as float)) as days, count(*) as dockets
         from d where pkt_status = 'DLVRD' group by booking_mode`, p, ['days']),
    q(`with d as (${DK}) select ${month('booking_date')} as month, 100.0 * sum(case when rcv_date <= expected then 1 else 0 end) / nullif(count(*), 0) as on_time,
         avg(cast(datediff(day, booking_date, rcv_date) as float)) as days from d where pkt_status = 'DLVRD' and expected is not null
        group by ${month('booking_date')} order by 1`, p, ['on_time', 'days']),
    q(`with d as (${DK}) select bucket, min(o) as o, count(*) as dockets, sum(freight) as freight from (select freight,
         case when datediff(day, booking_date, @today) <= 2 then '0–2 days' when datediff(day, booking_date, @today) <= 5 then '3–5 days'
              when datediff(day, booking_date, @today) <= 10 then '6–10 days' when datediff(day, booking_date, @today) <= 30 then '11–30 days' else '30+ days' end as bucket,
         case when datediff(day, booking_date, @today) <= 2 then 1 when datediff(day, booking_date, @today) <= 5 then 2 when datediff(day, booking_date, @today) <= 10 then 3
              when datediff(day, booking_date, @today) <= 30 then 4 else 5 end as o
         from d where ${live} and (pkt_status is null or pkt_status = 'UNDELIVERED')) x group by bucket order by o`, { ...p, today: today() }, ['freight']),
    q(`with d as (${DK}) select isnull(ds_remarks, 'No reason') as name, count(*) as dockets from d where pkt_status in ('UNDELIVERED', 'RTO', 'LOST')
         group by isnull(ds_remarks, 'No reason') order by 2 desc`, p),
    q(`select mainfest_date as date, count(*) as manifests, isnull(sum(x.dockets), 0) as dockets from mainfest_entry m
         outer apply (select count(*) as dockets from Manifest_grn g where g.Manifest_no = m.mainfest_no) x
        where mainfest_date between @from and @to and isnull(m.IsCancelled, '0') = '0' and (@div = '' or m.div_code = @div) and (@br = '' or m.from_branch = @br)
        group by mainfest_date order by 1`, p),
    q(`select coalesce(v.Name, c.market_vendor_name, c.vendor_code) as name, count(*) as challans, sum(try_cast(c.total_freight as decimal(18,2))) as hire,
         sum(try_cast(c.total_weight as decimal(18,2))) as weight from dispatch_master c left join vendors_master v on v.vendor_code = c.vendor_code
        where c.challan_date between @from and @to and isnull(c.IsCancelled, '0') = '0' and (@div = '' or c.div_code = @div) and (@br = '' or c.from_branch = @br)
        group by coalesce(v.Name, c.market_vendor_name, c.vendor_code) order by 3 desc`, p, ['hire', 'weight']),
    q(`select m.month, isnull(f.freight, 0) as freight, isnull(m.hire, 0) as hire from
         (select ${month('challan_date')} as month, sum(try_cast(total_freight as decimal(18,2))) as hire from dispatch_master
           where challan_date between @from and @to and isnull(IsCancelled, '0') = '0' and (@div = '' or div_code = @div) and (@br = '' or from_branch = @br)
           group by ${month('challan_date')}) m
         left join (select ${month('booking_date')} as month, sum(freight) as freight from (${DK}) d where ${live} group by ${month('booking_date')}) f on f.month = m.month
        order by 1`, p, ['freight', 'hire']),
    q(`select isnull(vendor_type, 'Not set') as name, count(*) as challans, sum(try_cast(advance as decimal(18,2))) as advance,
         sum(try_cast(bal_amount as decimal(18,2))) as balance from dispatch_master
        where challan_date between @from and @to and isnull(IsCancelled, '0') = '0' and (@div = '' or div_code = @div) and (@br = '' or from_branch = @br)
        group by isnull(vendor_type, 'Not set')`, p, ['advance', 'balance']),
    q(`select band, min(o) as o, count(*) as challans from (select
         case when u < 25 then '< 25%' when u < 50 then '25–50%' when u < 75 then '50–75%' when u <= 100 then '75–100%' else 'Overloaded' end as band,
         case when u < 25 then 1 when u < 50 then 2 when u < 75 then 3 when u <= 100 then 4 else 5 end as o
         from (select 100.0 * try_cast(total_weight as decimal(18,2)) / nullif(try_cast(capacity as decimal(18,2)), 0) as u from dispatch_master
                where challan_date between @from and @to and isnull(IsCancelled, '0') = '0' and try_cast(capacity as decimal(18,2)) > 0
                  and (@div = '' or div_code = @div) and (@br = '' or from_branch = @br)) x) y group by band order by o`, p),
    q(`select ${month('pickup_date')} as month, count(distinct p.pickup_no) as pickups, count(g.docket_no) as dockets from Pick_up_entry p
         left join Pick_Up_grn g on g.Pickup_no = p.pickup_no
        where pickup_date between @from and @to and isnull(p.IsCancelled, '0') = '0' and (@div = '' or p.Division = @div) and (@br = '' or p.from_branch = @br)
        group by ${month('pickup_date')} order by 1`, p),
    q(`with d as (${DK}) select name, count(*) as dockets from (select
         case when exists (select 1 from pod_received r where r.docket_no = d.docket_no and isnull(r.IsCancelled, '0') = '0') then 'POD received at HO'
              when exists (select 1 from pod_dispatch x where x.docket_no = d.docket_no and isnull(x.IsCancelled, 0) = 0) then 'Dispatched, not received'
              else 'POD pending at branch' end as name from d where pkt_status = 'DLVRD') x group by name`, p),
    q(`with d as (${DK}) select datediff(day, d.rcv_date, r.Receive_date) as days, count(*) as dockets from d
         join pod_received r on r.docket_no = d.docket_no and isnull(r.IsCancelled, '0') = '0' where d.pkt_status = 'DLVRD'
        group by datediff(day, d.rcv_date, r.Receive_date) order by 1`, p),
    q(`select count(*) as arrivals, sum(case when isnull(diffwt, 0) <> 0 then 1 else 0 end) as with_difference, isnull(sum(abs(isnull(diffwt, 0))), 0) as kg
         from Arrival_entry where Receive_Date between @from and @to and isnull(IsCancelled, '0') = '0' and (@div = '' or div_code = @div)
          and (@br = '' or from_branch = @br)`, p, ['kg']),
    q(`select isnull(e.Driver_Name, 'Not set') as name, count(distinct e.Drs_no) as drs, count(g.docket_no) as dockets,
         sum(case when s.pkt_status = 'DLVRD' then 1 else 0 end) as delivered
         from drs_entry_details e join drs_entry_details_grn g on g.Drs_no = e.Drs_no
         left join delivery_status_entry_details s on s.docket_no = g.docket_no and s.drs_no = e.Drs_no and isnull(s.IsCancelled, 0) = 0
        where e.Drs_date between @from and @to and isnull(e.IsCancelled, 0) = 0 and (@div = '' or e.Division = @div) and (@br = '' or e.from_branch = @br)
        group by isnull(e.Driver_Name, 'Not set') order by 3 desc`, p),
  ]);
  return {
    funnel: funnel[0] ?? {}, stages, outcomes, transit, transitByDest, transitByMode, onTimeMonthly, ageing, reasons, manifests, vendors, hireMonthly,
    vendorType, utilisation, pickups, pod, podDays, shortage: shortage[0] ?? {}, drivers,
  };
}

// ------------------------------------------------------------------ billing and money

const BILL = `select cb.*, isnull(r.settled, 0) as settled, r.last_receipt,
    case when cb.client_bill_status is not null then 'Cancelled' when cb.Payment_Status = 1 then 'Paid' when isnull(r.settled, 0) > 0 then 'Part paid'
         when cb.ClientBill_Finalize_status = 'Finalized' then 'Finalized' when cb.ClientBill_Summation_status = 'Active' then 'Submitted' else 'Generated' end as status
  from client_bill cb
  outer apply (select sum(x.Settled) as settled, max(h.Receive_Date) as last_receipt from Bill_Receive_Details x join Bill_Receive h on h.BR_No = x.BR_No
                where x.Bill_no = cb.bill_no and x.IsCancelled = 0) r
 where (@div = '' or cb.division = @div) and (@br = '' or cb.origin_branch = @br)`;

export async function billing(user, qs) {
  const p = params(user, qs);
  const t = { ...p, today: today() };
  const [billedMonthly, collectedMonthly, statuses, ageing, outstandingClients, modes, tdsMonthly, unbilled, unbilledAge, lags, other, revenueMix,
    cashShare, billSizes] = await Promise.all([
    q(`with b as (${BILL}) select ${month('bill_date')} as month, count(*) as bills, sum(totalamount) as billed from b
         where bill_date between @from and @to and status <> 'Cancelled' group by ${month('bill_date')} order by 1`, p, ['billed']),
    q(`select ${month('Receive_Date')} as month, sum(Receive_Amount) as received, sum(isnull(TDS, 0)) as tds, count(*) as receipts from Bill_Receive
         where Receive_Date between @from and @to and IsCancelled = 0 and (@div = '' or Division = @div) and (@br = '' or Branch = @br)
        group by ${month('Receive_Date')} order by 1`, p, ['received', 'tds']),
    q(`with b as (${BILL}) select status as name, count(*) as bills, sum(totalamount) as amount from b where bill_date between @from and @to
         group by status order by 3 desc`, p, ['amount']),
    q(`with b as (${BILL}) select bucket, min(o) as o, count(*) as bills, sum(due) as amount from (select totalamount - settled as due,
         case when datediff(day, isnull(DueDate, bill_date), @today) <= 0 then 'Not due' when datediff(day, isnull(DueDate, bill_date), @today) <= 30 then '1–30 days overdue'
              when datediff(day, isnull(DueDate, bill_date), @today) <= 60 then '31–60 days' when datediff(day, isnull(DueDate, bill_date), @today) <= 90 then '61–90 days'
              else '90+ days' end as bucket,
         case when datediff(day, isnull(DueDate, bill_date), @today) <= 0 then 1 when datediff(day, isnull(DueDate, bill_date), @today) <= 30 then 2
              when datediff(day, isnull(DueDate, bill_date), @today) <= 60 then 3 when datediff(day, isnull(DueDate, bill_date), @today) <= 90 then 4 else 5 end as o
         from b where status not in ('Cancelled', 'Paid') and totalamount - settled > 0) x group by bucket order by o`, t, ['amount']),
    q(`with b as (${BILL}) select isnull(c.company_name, b.client_code) as name, count(*) as bills, sum(b.totalamount - b.settled) as due,
         max(datediff(day, isnull(b.DueDate, b.bill_date), @today)) as oldest from b left join client_Master c on c.client_code = b.client_code
        where b.status not in ('Cancelled', 'Paid') and b.totalamount - b.settled > 0 group by isnull(c.company_name, b.client_code) order by 3 desc`, t, ['due']),
    q(`select isnull(Paymentmode, Receive_mode) as name, count(*) as receipts, sum(Receive_Amount) as amount from Bill_Receive
         where Receive_Date between @from and @to and IsCancelled = 0 and (@div = '' or Division = @div) and (@br = '' or Branch = @br)
        group by isnull(Paymentmode, Receive_mode) order by 3 desc`, p, ['amount']),
    q(`select ${month('Receive_Date')} as month, sum(isnull(TDS, 0)) as tds, sum(isnull(Deduction, 0)) as deduction from Bill_Receive
         where Receive_Date between @from and @to and IsCancelled = 0 and (@div = '' or Division = @div) and (@br = '' or Branch = @br)
        group by ${month('Receive_Date')} order by 1`, p, ['tds', 'deduction']),
    q(`with d as (${DK}) select count(*) as dockets, isnull(sum(freight), 0) as freight from d
         where ${live} and booking_type = 'To Be Billed' and pkt_status = 'DLVRD' and Invoice_status is null`, p, ['freight']),
    q(`with d as (${DK}) select bucket, min(o) as o, count(*) as dockets, sum(freight) as freight from (select freight,
         case when datediff(day, rcv_date, @today) <= 15 then '0–15 days' when datediff(day, rcv_date, @today) <= 30 then '16–30 days'
              when datediff(day, rcv_date, @today) <= 60 then '31–60 days' else '60+ days' end as bucket,
         case when datediff(day, rcv_date, @today) <= 15 then 1 when datediff(day, rcv_date, @today) <= 30 then 2 when datediff(day, rcv_date, @today) <= 60 then 3 else 4 end as o
         from d where ${live} and booking_type = 'To Be Billed' and pkt_status = 'DLVRD' and Invoice_status is null) x group by bucket order by o`, t, ['freight']),
    q(`with b as (${BILL}) select avg(cast(datediff(day, ToDate, bill_date) as float)) as days_to_bill,
         avg(case when last_receipt is not null and status = 'Paid' then cast(datediff(day, bill_date, last_receipt) as float) end) as days_to_collect,
         avg(case when Summation_date is not null then cast(datediff(day, bill_date, Summation_date) as float) end) as days_to_submit,
         avg(case when ClientBill_Finalize_date is not null then cast(datediff(day, bill_date, ClientBill_Finalize_date) as float) end) as days_to_finalize
         from b where bill_date between @from and @to and status <> 'Cancelled'`, p, ['days_to_bill', 'days_to_collect', 'days_to_submit', 'days_to_finalize']),
    q(`select kind, month, sum(amount) as amount from (
         select 'Miscellaneous' as kind, ${month('BillDate')} as month, TotalAmount as amount from miscellaneous_bill
          where BillDate between @from and @to and Cancel_status is null and (@div = '' or Division = @div) and (@br = '' or CreatBranch = @br)
         union all select 'Warehouse', ${month('BillDate')}, TotalAmount from warehouse_bill
          where BillDate between @from and @to and Cancel_status is null and (@div = '' or Division = @div) and (@br = '' or CreatBranch = @br)
         union all select 'Octroi', ${month('bill_date')}, totalamount from octroi_bill
          where bill_date between @from and @to and OctroiBill_Cancel_status is null and (@div = '' or Division = @div) and (@br = '' or origin_branch = @br)) x
        group by kind, month order by month`, p, ['amount']),
    q(`select name, sum(amount) as amount from (
         select 'Freight bills' as name, totalamount as amount from client_bill where bill_date between @from and @to and client_bill_status is null
          and (@div = '' or division = @div) and (@br = '' or origin_branch = @br)
         union all select 'Miscellaneous', TotalAmount from miscellaneous_bill where BillDate between @from and @to and Cancel_status is null
          and (@div = '' or Division = @div) and (@br = '' or CreatBranch = @br)
         union all select 'Warehouse', TotalAmount from warehouse_bill where BillDate between @from and @to and Cancel_status is null
          and (@div = '' or Division = @div) and (@br = '' or CreatBranch = @br)
         union all select 'Octroi', totalamount from octroi_bill where bill_date between @from and @to and OctroiBill_Cancel_status is null
          and (@div = '' or Division = @div) and (@br = '' or origin_branch = @br)) x group by name order by 2 desc`, p, ['amount']),
    q(`with d as (${DK}) select ${month('booking_date')} as month, sum(case when booking_type = 'Paid' then freight else 0 end) as paid,
         sum(case when booking_type = 'To Pay' then freight else 0 end) as topay, sum(case when booking_type = 'To Be Billed' then freight else 0 end) as tbb
         from d where ${live} group by ${month('booking_date')} order by 1`, p, ['paid', 'topay', 'tbb']),
    q(`with b as (${BILL}) select band, min(o) as o, count(*) as bills from (select
         case when totalamount < 10000 then '< 10k' when totalamount < 25000 then '10k–25k' when totalamount < 50000 then '25k–50k'
              when totalamount < 100000 then '50k–1L' else '1L +' end as band,
         case when totalamount < 10000 then 1 when totalamount < 25000 then 2 when totalamount < 50000 then 3 when totalamount < 100000 then 4 else 5 end as o
         from b where bill_date between @from and @to and status <> 'Cancelled') x group by band order by o`, p),
  ]);
  const months = [...new Set([...billedMonthly.map((r) => r.month), ...collectedMonthly.map((r) => r.month)])].sort();
  const billedVsCollected = months.map((m) => ({
    month: m, billed: billedMonthly.find((r) => r.month === m)?.billed ?? 0,
    collected: round2((collectedMonthly.find((r) => r.month === m)?.received ?? 0) + (collectedMonthly.find((r) => r.month === m)?.tds ?? 0)),
  }));
  return {
    billedVsCollected, statuses, ageing, outstandingClients, modes, tdsMonthly, unbilled: unbilled[0] ?? {}, unbilledAge, lags: lags[0] ?? {},
    other, revenueMix, cashShare, billSizes,
  };
}

// ------------------------------------------------------------------ vendors, franchisees and accounts

export async function accounts(user, qs) {
  const p = params(user, qs);
  const [expenses, vendorMonthly, franchisee, voucherModes, drcr, vendorBills, receiptsByMode, topLedgers] = await Promise.all([
    q(`select isnull(l.LedgerName, i.ExpenseLedger) as name, count(*) as invoices, sum(i.TaxableAmt) as taxable from OtherVendorInvoice i
         left join tblAccountLedger l on l.LedgerCode = i.ExpenseLedger
        where i.InvoiceDate between @from and @to and i.IsCancelled = 0 and (@div = '' or i.Division = @div) and (@br = '' or i.Branch_Code = @br)
        group by isnull(l.LedgerName, i.ExpenseLedger) order by 3 desc`, p, ['taxable']),
    q(`select ${month('InvoiceDate')} as month, sum(TaxableAmt) as taxable, sum(isnull(CGSTAmt, 0) + isnull(SGSTAmt, 0) + isnull(IGSTAmt, 0)) as gst,
         sum(isnull(TotTDS, 0)) as tds from OtherVendorInvoice
        where InvoiceDate between @from and @to and IsCancelled = 0 and (@div = '' or Division = @div) and (@br = '' or Branch_Code = @br)
        group by ${month('InvoiceDate')} order by 1`, p, ['taxable', 'gst', 'tds']),
    q(`select Month as month, isnull(f.FranName, i.Fran_Code) as franchisee, sum(Commission_Total) as commission, sum(Rent + Mobile_Bills + Signage) as fixed,
         sum(Net_Amount) as net from Franchisee_Invoice i left join Franchise_Master f on f.FranCode = i.Fran_Code
        where Invoice_Date between @from and @to and IsCancel = 0 and (@div = '' or i.Division = @div)
        group by Month, isnull(f.FranName, i.Fran_Code) order by 1`, p, ['commission', 'fixed', 'net']),
    q(`select Mode as name, count(distinct VoucherNo) as vouchers, sum(Dr) as dr, sum(Cr) as cr from tblAccountTrasaction
         where CreatedDate between @from and @to and isnull(IsCancelled, 0) = 0 and (@div = '' or Division = @div)
        group by Mode order by 2 desc`, p, ['dr', 'cr']),
    q(`select ${month('CreatedDate')} as month, sum(Dr) as dr, sum(Cr) as cr from tblAccountTrasaction
         where CreatedDate between @from and @to and isnull(IsCancelled, 0) = 0 and (@div = '' or Division = @div)
        group by ${month('CreatedDate')} order by 1`, p, ['dr', 'cr']),
    q(`select isnull(v.Name, h.Vendor_Code) as name, count(*) as bills, sum(h.Challan_amount) as paid, sum(h.Balance_Amount) as pending
         from Vendor_Invoice_Verify h left join vendors_master v on v.vendor_code = h.Vendor_Code
        where h.Vendor_Bill_Date between @from and @to and h.IsCancelled = 0 and (@div = '' or h.division = @div) and (@br = '' or h.Branch_Code = @br)
        group by isnull(v.Name, h.Vendor_Code) order by 3 desc`, p, ['paid', 'pending']),
    q(`select ${month('Receive_Date')} as month, sum(case when Receive_mode = 'Cash' then Receive_Amount else 0 end) as cash,
         sum(case when Receive_mode <> 'Cash' then Receive_Amount else 0 end) as bank from Bill_Receive
        where Receive_Date between @from and @to and IsCancelled = 0 and (@div = '' or Division = @div) and (@br = '' or Branch = @br)
        group by ${month('Receive_Date')} order by 1`, p, ['cash', 'bank']),
    q(`select top 10 isnull(l.LedgerName, t.LedgerCode) as name, sum(t.Dr) as dr, sum(t.Cr) as cr, sum(t.Dr) - sum(t.Cr) as net from tblAccountTrasaction t
         left join tblAccountLedger l on l.LedgerCode = t.LedgerCode
        where t.CreatedDate between @from and @to and isnull(t.IsCancelled, 0) = 0 and (@div = '' or t.Division = @div)
        group by isnull(l.LedgerName, t.LedgerCode) order by abs(sum(t.Dr) - sum(t.Cr)) desc`, p, ['dr', 'cr', 'net']),
  ]);
  return { expenses, vendorMonthly, franchisee, voucherModes, drcr, vendorBills, receiptsByMode, topLedgers };
}

// ------------------------------------------------------------------ drill-down: the records behind any number on the dashboard
// kind + filters ({ column: value }) → { columns, rows, total }. Only the columns listed in each kind can be filtered on; the computed
// columns use the same expressions as the charts, so clicking a bar returns exactly the records it counts.
const WEIGHT_BAND = `case when wt <= 5 then '0–5 kg' when wt <= 20 then '5–20 kg' when wt <= 50 then '20–50 kg' when wt <= 100 then '50–100 kg'
  when wt <= 250 then '100–250 kg' when wt <= 500 then '250–500 kg' when wt <= 1000 then '0.5–1 t' when wt <= 5000 then '1–5 t' else '5 t +' end`;
const FREIGHT_BAND = `case when freight < 250 then '< 250' when freight < 500 then '250–500' when freight < 1000 then '500–1k' when freight < 2500 then '1k–2.5k'
  when freight < 5000 then '2.5k–5k' when freight < 10000 then '5k–10k' when freight < 25000 then '10k–25k' else '25k +' end`;
const NS = (col) => `isnull(nullif(cast(${col} as varchar(60)), ''), 'Not set')`;
const DOCKETS = `with d as (${DK}), e as (select d.*, ${STAGE} as stage, ${month('d.booking_date')} as month,
    (datepart(weekday, d.booking_date) + @@datefirst - 2) % 7 as dow, datepart(hour, d.created_date) as hour,
    ${NS('d.booking_type')} as booking_type_n, ${NS('d.booking_mode')} as mode_n, ${NS('d.LoadType')} as load_n,
    ${NS("case d.DocsNoneDocs when '1' then 'Document' when '2' then 'Non-document' else d.DocsNoneDocs end")} as docs_n,
    ${NS('d.customer_type')} as ctype_n, ${NS('d.gstPaidBy')} as gst_n, ${WEIGHT_BAND} as weight_band, ${FREIGHT_BAND} as freight_band,
    isnull(nullif(d.destination, ''), d.destination_branch) as dest_label, d.origin_branch + N' → ' + d.destination_branch as lane,
    isnull(bo.branch_name, d.origin_branch) as origin_name, isnull(bd.branch_name, d.destination_branch) as dest_name,
    case d.pkt_status when 'DLVRD' then 'Delivered' when 'UNDELIVERED' then 'Undelivered' else d.pkt_status end as outcome,
    datediff(day, d.booking_date, d.rcv_date) as transit,
    case when d.cancelled = 0 and (d.pkt_status is null or d.pkt_status = 'UNDELIVERED') then 1 else 0 end as pending,
    case when datediff(day, d.booking_date, @today) <= 2 then '0–2 days' when datediff(day, d.booking_date, @today) <= 5 then '3–5 days'
         when datediff(day, d.booking_date, @today) <= 10 then '6–10 days' when datediff(day, d.booking_date, @today) <= 30 then '11–30 days' else '30+ days' end as age_bucket,
    case when d.pkt_status in ('UNDELIVERED', 'RTO', 'LOST') then isnull(d.ds_remarks, 'No reason') end as reason,
    case when isnull(d.ODA_Location, '') <> '' then 1 else 0 end as oda,
    case when d.cancelled = 0 and d.booking_type = 'To Be Billed' and d.pkt_status = 'DLVRD' and d.Invoice_status is null then 1 else 0 end as unbilled,
    case when datediff(day, d.rcv_date, @today) <= 15 then '0–15 days' when datediff(day, d.rcv_date, @today) <= 30 then '16–30 days'
         when datediff(day, d.rcv_date, @today) <= 60 then '31–60 days' else '60+ days' end as unbilled_bucket,
    case when d.pkt_status <> 'DLVRD' then null
         when exists (select 1 from pod_received r where r.docket_no = d.docket_no and isnull(r.IsCancelled, '0') = '0') then 'POD received at HO'
         when exists (select 1 from pod_dispatch x where x.docket_no = d.docket_no and isnull(x.IsCancelled, 0) = 0) then 'Dispatched, not received'
         else 'POD pending at branch' end as pod_status,
    (select top 1 datediff(day, d.rcv_date, r.Receive_date) from pod_received r where r.docket_no = d.docket_no and isnull(r.IsCancelled, '0') = '0') as pod_days,
    case when d.pkt_status = 'DLVRD' and d.expected is not null then case when d.rcv_date <= d.expected then 1 else 0 end end as on_time
  from d left join branch_master bo on bo.branch_code = d.origin_branch left join branch_master bd on bd.branch_code = d.destination_branch)`;

const MONEY = 'money'; const DATE = 'date'; const NUM = 'number';
const DRILL = {
  dockets: {
    sql: DOCKETS, from: 'e', order: 'e.booking_date desc, e.docket_no desc', date: null,
    filters: ['date:booking_date', 'month', 'dow', 'hour', 'booking_type_n', 'mode_n', 'load_n', 'docs_n', 'ctype_n', 'gst_n', 'weight_band', 'freight_band',
      'client', 'dest_label', 'lane', 'origin_name', 'dest_name', 'stage', 'outcome', 'transit', 'pending', 'age_bucket', 'reason', 'oda', 'unbilled',
      'unbilled_bucket', 'pod_status', 'pod_days', 'on_time', 'cancelled'],
    select: `e.docket_no, e.booking_date, e.client, e.origin_name, e.dest_name, e.booking_type, e.booking_mode, e.wt, e.pcs, e.freight, e.stage,
      e.expected, e.rcv_date, e.transit, e.reason`,
    columns: [['docket_no', 'Docket', 'docket'], ['booking_date', 'Booked', DATE], ['client', 'Client / consignor'], ['origin_name', 'From'], ['dest_name', 'To'],
      ['booking_type', 'Type'], ['booking_mode', 'Mode'], ['wt', 'Weight', NUM], ['pcs', 'Pkts', NUM], ['freight', 'Freight', MONEY], ['stage', 'Status', 'tag'],
      ['expected', 'Expected', DATE], ['rcv_date', 'Delivered / attempted', DATE], ['transit', 'Days', NUM], ['reason', 'Reason']],
  },
  bills: {
    sql: `with b as (${BILL}), e as (select b.*, ${month('b.bill_date')} as month, isnull(c.company_name, b.client_code) as client_name,
        b.totalamount - b.settled as due, datediff(day, isnull(b.DueDate, b.bill_date), @today) as overdue,
        case when b.status not in ('Cancelled', 'Paid') and b.totalamount - b.settled > 0 then 1 else 0 end as outstanding,
        case when datediff(day, isnull(b.DueDate, b.bill_date), @today) <= 0 then 'Not due' when datediff(day, isnull(b.DueDate, b.bill_date), @today) <= 30 then '1–30 days overdue'
             when datediff(day, isnull(b.DueDate, b.bill_date), @today) <= 60 then '31–60 days' when datediff(day, isnull(b.DueDate, b.bill_date), @today) <= 90 then '61–90 days'
             else '90+ days' end as overdue_bucket,
        case when b.totalamount < 10000 then '< 10k' when b.totalamount < 25000 then '10k–25k' when b.totalamount < 50000 then '25k–50k'
             when b.totalamount < 100000 then '50k–1L' else '1L +' end as size_band
      from b left join client_Master c on c.client_code = b.client_code)`,
    from: 'e', order: 'e.bill_date desc, e.bill_no desc', date: 'e.bill_date',
    filters: ['month', 'status', 'client_name', 'outstanding', 'overdue_bucket', 'size_band'],
    select: 'e.bill_no, e.bill_date, e.DueDate, e.client_name, e.Bill_Type, e.totalamount, e.settled, e.due, e.status, e.overdue',
    columns: [['bill_no', 'Bill no.', 'bill'], ['bill_date', 'Bill date', DATE], ['DueDate', 'Due', DATE], ['client_name', 'Client'], ['Bill_Type', 'Type'],
      ['totalamount', 'Amount', MONEY], ['settled', 'Received', MONEY], ['due', 'Balance', MONEY], ['status', 'Status', 'tag'], ['overdue', 'Days overdue', NUM]],
  },
  receipts: {
    sql: `with e as (select r.*, ${month('r.Receive_Date')} as month, isnull(r.Paymentmode, r.Receive_mode) as mode_n,
        case when r.Receive_mode = 'Cash' then 'Cash' else 'Bank' end as cash_bank, isnull(c.company_name, r.Client_Code) as client_name
      from Bill_Receive r left join client_Master c on c.client_code = r.Client_Code
      where r.IsCancelled = 0 and (@div = '' or r.Division = @div) and (@br = '' or r.Branch = @br))`,
    from: 'e', order: 'e.Receive_Date desc', date: 'e.Receive_Date', filters: ['month', 'mode_n', 'cash_bank', 'client_name'],
    select: 'e.BR_No, e.Receive_Date, e.client_name, e.mode_n, e.ChequeNo, e.Receive_Amount, e.TDS, e.Deduction, e.Branch',
    columns: [['BR_No', 'Receipt'], ['Receive_Date', 'Date', DATE], ['client_name', 'Client'], ['mode_n', 'Mode'], ['ChequeNo', 'Cheque'],
      ['Receive_Amount', 'Received', MONEY], ['TDS', 'TDS', MONEY], ['Deduction', 'Deduction', MONEY], ['Branch', 'Branch']],
  },
  challans: {
    sql: `with e as (select c.*, ${month('c.challan_date')} as month, coalesce(v.Name, c.market_vendor_name, c.vendor_code) as vendor,
        isnull(c.vendor_type, 'Not set') as vendor_type_n,
        case when u < 25 then '< 25%' when u < 50 then '25–50%' when u < 75 then '50–75%' when u <= 100 then '75–100%' else 'Overloaded' end as util_band,
        u as utilisation, isnull(bf.branch_name, c.from_branch) + N' → ' + isnull(bt.branch_name, c.tobcode) as route
      from dispatch_master c left join vendors_master v on v.vendor_code = c.vendor_code
      left join branch_master bf on bf.branch_code = c.from_branch left join branch_master bt on bt.branch_code = c.tobcode
      cross apply (select 100.0 * try_cast(c.total_weight as decimal(18,2)) / nullif(try_cast(c.capacity as decimal(18,2)), 0) as u) x
      where isnull(c.IsCancelled, '0') = '0' and (@div = '' or c.div_code = @div) and (@br = '' or c.from_branch = @br))`,
    from: 'e', order: 'e.challan_date desc, e.challan_no desc', date: 'e.challan_date', filters: ['month', 'vendor', 'vendor_type_n', 'util_band'],
    select: 'e.challan_no, e.challan_date, e.vendor, e.vendor_type, e.truck_no, e.route, e.total_weight, e.capacity, e.utilisation, e.total_freight, e.advance, e.bal_amount',
    columns: [['challan_no', 'Challan'], ['challan_date', 'Date', DATE], ['vendor', 'Vendor'], ['vendor_type', 'Vendor type'], ['truck_no', 'Truck'], ['route', 'Route'],
      ['total_weight', 'Weight', NUM], ['capacity', 'Capacity', NUM], ['utilisation', 'Load %', NUM], ['total_freight', 'Hire', MONEY], ['advance', 'Advance', MONEY],
      ['bal_amount', 'Balance', MONEY]],
  },
  manifests: {
    sql: `with e as (select m.*, cast(m.mainfest_date as date) as date, isnull(bf.branch_name, m.from_branch) as from_name, isnull(bt.branch_name, m.to_branch) as to_name,
        (select count(*) from Manifest_grn g where g.Manifest_no = m.mainfest_no) as dockets
      from mainfest_entry m left join branch_master bf on bf.branch_code = m.from_branch left join branch_master bt on bt.branch_code = m.to_branch
      where isnull(m.IsCancelled, '0') = '0' and (@div = '' or m.div_code = @div) and (@br = '' or m.from_branch = @br))`,
    from: 'e', order: 'e.mainfest_date desc, e.mainfest_no desc', date: 'e.mainfest_date', filters: ['date'],
    select: 'e.mainfest_no, e.mainfest_date, e.from_name, e.to_name, e.Loadtype, e.dockets, e.challan_no, e.Arrived_status',
    columns: [['mainfest_no', 'Manifest'], ['mainfest_date', 'Date', DATE], ['from_name', 'From'], ['to_name', 'To'], ['Loadtype', 'Load'], ['dockets', 'Dockets', NUM],
      ['challan_no', 'Challan'], ['Arrived_status', 'Arrival']],
  },
  pickups: {
    sql: `with e as (select p.*, ${month('p.pickup_date')} as month, (select count(*) from Pick_Up_grn g where g.Pickup_no = p.pickup_no) as dockets
      from Pick_up_entry p where isnull(p.IsCancelled, '0') = '0' and (@div = '' or p.Division = @div) and (@br = '' or p.from_branch = @br))`,
    from: 'e', order: 'e.pickup_date desc', date: 'e.pickup_date', filters: ['month'],
    select: 'e.pickup_no, e.pickup_date, e.from_branch, e.PickUpBy, e.dockets',
    columns: [['pickup_no', 'Pickup'], ['pickup_date', 'Date', DATE], ['from_branch', 'Branch'], ['PickUpBy', 'Picked up by'], ['dockets', 'Dockets', NUM]],
  },
  otherbills: {
    sql: `with e as (
        select 'Miscellaneous' as kind, Bill_No as bill_no, BillDate as bill_date, cust_name as client_name, TaxableAmt as taxable, TotalAmount as amount, remarks
          from miscellaneous_bill where Cancel_status is null and (@div = '' or Division = @div) and (@br = '' or CreatBranch = @br)
        union all select 'Warehouse', Bill_No, BillDate, cust_name, TaxableAmt, TotalAmount, remarks
          from warehouse_bill where Cancel_status is null and (@div = '' or Division = @div) and (@br = '' or CreatBranch = @br)
        union all select 'Octroi', bill_no, bill_date, client_name, totalamount, totalamount, remarks
          from octroi_bill where OctroiBill_Cancel_status is null and (@div = '' or Division = @div) and (@br = '' or origin_branch = @br)
        union all select 'Freight bills', bill_no, bill_date, client_code, totalfreight, totalamount, remarks
          from client_bill where client_bill_status is null and (@div = '' or division = @div) and (@br = '' or origin_branch = @br)),
      f as (select e.*, ${month('e.bill_date')} as month from e)`,
    from: 'f e', order: 'e.bill_date desc', date: 'e.bill_date', filters: ['kind', 'month'],
    select: 'e.kind, e.bill_no, e.bill_date, e.client_name, e.taxable, e.amount, e.remarks',
    columns: [['kind', 'Bill type', 'tag'], ['bill_no', 'Bill no.'], ['bill_date', 'Date', DATE], ['client_name', 'Client'], ['taxable', 'Taxable', MONEY],
      ['amount', 'Amount', MONEY], ['remarks', 'Remarks']],
  },
  vendorinvoices: {
    sql: `with e as (select i.*, ${month('i.InvoiceDate')} as month, isnull(l.LedgerName, i.ExpenseLedger) as ledger, v.name as vendor_name,
        isnull(i.CGSTAmt, 0) + isnull(i.SGSTAmt, 0) + isnull(i.IGSTAmt, 0) as gst
      from OtherVendorInvoice i left join tblAccountLedger l on l.LedgerCode = i.ExpenseLedger left join Other_Vendor_Master v on v.vendor_code = i.VendorCode
      where i.IsCancelled = 0 and (@div = '' or i.Division = @div) and (@br = '' or i.Branch_Code = @br))`,
    from: 'e', order: 'e.InvoiceDate desc', date: 'e.InvoiceDate', filters: ['month', 'ledger'],
    select: 'e.InvoiceNo, e.InvoiceDate, e.vendor_name, e.VendorInvNo, e.ledger, e.TaxableAmt, e.gst, e.TotTDS, e.BillAmt',
    columns: [['InvoiceNo', 'Invoice', 'vendorinvoice'], ['InvoiceDate', 'Date', DATE], ['vendor_name', 'Vendor'], ['VendorInvNo', 'Vendor bill'], ['ledger', 'Expense ledger'],
      ['TaxableAmt', 'Taxable', MONEY], ['gst', 'GST', MONEY], ['TotTDS', 'TDS', MONEY], ['BillAmt', 'Total', MONEY]],
  },
  vendorbills: {
    sql: `with e as (select h.*, isnull(v.Name, h.Vendor_Code) as vendor from Vendor_Invoice_Verify h left join vendors_master v on v.vendor_code = h.Vendor_Code
      where h.IsCancelled = 0 and (@div = '' or h.division = @div) and (@br = '' or h.Branch_Code = @br))`,
    from: 'e', order: 'e.Vendor_Bill_Date desc', date: 'e.Vendor_Bill_Date', filters: ['vendor'],
    select: 'e.Vendor_Bill_No, e.Vendor_Bill_Date, e.vendor, e.Vendor_Ref_No, e.Bill_Amount, e.Challan_amount, e.Balance_Amount',
    columns: [['Vendor_Bill_No', 'Bill no.'], ['Vendor_Bill_Date', 'Date', DATE], ['vendor', 'Vendor'], ['Vendor_Ref_No', "Vendor's bill"], ['Bill_Amount', 'Bill amount', MONEY],
      ['Challan_amount', 'Verified payment', MONEY], ['Balance_Amount', 'Pending', MONEY]],
  },
  franchisee: {
    sql: `with e as (select i.*, isnull(f.FranName, i.Fran_Code) as franchisee,
        (select count(*) from Franchisee_Invoice_Detail d where d.F_Invoice_No = i.F_Invoice_No) as dockets
      from Franchisee_Invoice i left join Franchise_Master f on f.FranCode = i.Fran_Code where i.IsCancel = 0 and (@div = '' or i.Division = @div))`,
    from: 'e', order: 'e.Invoice_Date desc', date: 'e.Invoice_Date', filters: ['month', 'franchisee'],
    select: 'e.F_Invoice_No, e.Invoice_Date, e.franchisee, e.month, e.dockets, e.Commission_Total, e.Rent, e.Gross_Amount, e.TDS_Amount, e.Net_Amount',
    columns: [['F_Invoice_No', 'Invoice', 'franchiseeinvoice'], ['Invoice_Date', 'Date', DATE], ['franchisee', 'Franchisee'], ['month', 'Month'], ['dockets', 'Dockets', NUM],
      ['Commission_Total', 'Commission', MONEY], ['Rent', 'Rent', MONEY], ['Gross_Amount', 'Gross', MONEY], ['TDS_Amount', 'TDS', MONEY], ['Net_Amount', 'Net', MONEY]],
  },
  vouchers: {
    sql: `with e as (select t.*, ${month('t.CreatedDate')} as month, isnull(l.LedgerName, t.LedgerCode) as ledger, t.Mode as mode_n
      from tblAccountTrasaction t left join tblAccountLedger l on l.LedgerCode = t.LedgerCode
      where isnull(t.IsCancelled, 0) = 0 and (@div = '' or t.Division = @div))`,
    from: 'e', order: 'e.CreatedDate desc, e.VoucherNo', date: 'e.CreatedDate', filters: ['month', 'mode_n', 'ledger'],
    select: 'e.VoucherNo, e.CreatedDate, e.Mode, e.ledger, e.Dr, e.Cr',
    columns: [['VoucherNo', 'Voucher'], ['CreatedDate', 'Date', DATE], ['Mode', 'Type', 'tag'], ['ledger', 'Ledger'], ['Dr', 'Dr', MONEY], ['Cr', 'Cr', MONEY]],
  },
};

export async function drill(user, qs) {
  const k = DRILL[qs.kind];
  if (!k) return { columns: [], rows: [], total: 0 };
  const p = { ...params(user, qs), today: today() };
  const where = [];
  const allowed = new Map(k.filters.map((f) => { const [key, col] = f.split(':'); return [key, col ?? key]; }));
  let i = 0;
  for (const [key, value] of Object.entries(qs.filters ?? {})) {
    if (key === 'driver' && qs.kind === 'dockets') {
      p.driver = String(value);
      where.push(`e.docket_no in (select g.docket_no from drs_entry_details x join drs_entry_details_grn g on g.Drs_no = x.Drs_no
        where isnull(x.Driver_Name, 'Not set') = @driver and x.Drs_date between @from and @to)`);
      continue;
    }
    if (!allowed.has(key)) continue;
    const name = `f${i++}`;
    p[name] = typeof value === 'boolean' ? (value ? 1 : 0) : value;
    where.push(value === null ? `e.${allowed.get(key)} is null` : `e.${allowed.get(key)} = @${name}`);
  }
  if (qs.kind === 'dockets' && !('stage' in (qs.filters ?? {})) && !('cancelled' in (qs.filters ?? {})) && !qs.withCancelled) where.push('e.cancelled = 0');
  if (k.date && !qs.allDates) where.push(`${k.date} between @from and @to`);
  const cond = where.length ? `where ${where.join(' and ')}` : '';
  const sql = `${k.sql} select count(*) over () as total_rows, ${k.select} from ${k.from} ${cond} order by ${k.order} offset 0 rows fetch next 2000 rows only`;
  const rows = await query(sql, p);
  const money = k.columns.filter((c) => [MONEY, NUM].includes(c[2])).map((c) => c[0]);
  return {
    columns: k.columns.map(([key, title, type]) => ({ key, title, type: type ?? 'text' })),
    rows: num(rows, money).map(({ total_rows: _t, ...r }) => r),
    total: n(rows[0]?.total_rows),
  };
}
