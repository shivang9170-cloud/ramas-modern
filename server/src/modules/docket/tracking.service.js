// Docket tracking — replaces Tracking.aspx / Tracking_Client.aspx. The legacy page (and the first port) only listed the rows of
// docket_tracking, which each operation had to write itself; pickups, loading sheets, bills and receipts never did, so the
// journey stopped at "Booked". The journey is now built from the operation tables themselves (the source of truth), with any
// other docket_tracking rows added:
//   booking → (pickup) → (loading sheet) → manifest → challan / dispatch → arrival → DRS (out for delivery) → delivery status
//   → POD to HO → POD received → bill → bill finalized → money received;  cancellations of the docket / documents are shown.
// Clients see only their own dockets and no amounts.
import { query } from '../../db/index.js';
import { notFound } from '../../middleware/errors.js';
import { s, n, iso, round2 } from '../../utils/values.js';

const at = (d, t) => {
  if (!d) return null;
  const day = iso(d);
  const m = /^(\d{1,2}):(\d{2})/.exec(s(t));
  if (m) return `${day}T${m[1].padStart(2, '0')}:${m[2]}:00`;
  const full = new Date(d);
  return full.getUTCHours() || full.getUTCMinutes() ? full.toISOString().slice(0, 19) : `${day}T00:00:00`;
};
const STATUS = { DLVRD: 'Delivered', UNDELIVERED: 'Undelivered', RTO: 'Return to origin', LOST: 'Lost' };

export async function journey(docketNo, user) {
  const client = user.role === 'client';
  const [g] = await query(
    `select g.*, c.pcs, c.charge_weight, c.actual_weight, case when isnull(c.FtlRate, 0) > 0 then c.FtlRate else c.freight end as freight,
            bo.branch_name as origin_name, bd.branch_name as dest_name, bc.branch_name as current_name
       from grn_master g left join grn_docket_charge c on c.Docket_No = g.docket_no
       left join branch_master bo on bo.branch_code = g.origin_branch left join branch_master bd on bd.branch_code = g.destination_branch
       left join branch_master bc on bc.branch_code = g.current_branch
      where (g.docket_no = @d or g.ManualDocketNo = @d) and (@div = '' or g.Division = @div)
        and (@client = '' or g.consigner_code = @client or g.consignee_code = @client or g.on_account_of like '%:' + @client)`,
    { d: docketNo, div: s(user.divCode), client: client ? user.userId : '' });
  if (!g) throw notFound(`Docket ${docketNo} not found`);
  const no = s(g.docket_no);
  const p = { d: no };

  const [pickups, sheets, manifests, arrivals, drs, statuses, podOut, podIn, bills, receipts, logged] = await Promise.all([
    query(`select e.pickup_no, e.pickup_date, e.pickup_time, e.from_branch, b.branch_name, e.PickUpBy, e.user_id, e.IsCancelled
             from Pick_Up_grn x join Pick_up_entry e on e.pickup_no = x.Pickup_no left join branch_master b on b.branch_code = e.from_branch
            where x.docket_no = @d`, p),
    query(`select h.Ls_no, h.loading_date, h.Created_Date, h.Loading_Branch, b.branch_name, h.entered_by, isnull(h.IsCancel, 0) as cancelled, d.Manifest_No,
                  d.pices, d.weight, d.to_branch, bt.branch_name as to_name
             from Loading_Sheet_Details d join Loading_Sheet h on h.Ls_no = d.Ls_no left join branch_master b on b.branch_code = h.Loading_Branch
             left join branch_master bt on bt.branch_code = d.to_branch
            where d.docket_no = @d`, p),
    query(`select m.mainfest_no, m.mainfest_date, m.mainfest_time, m.from_branch, m.to_branch, bf.branch_name as from_name, bt.branch_name as to_name,
                  m.user_id, m.IsCancelled, mg.package, mg.weight, mg.freight as mf_freight, isnull(mg.challan_no, m.challan_no) as challan_no,
                  c.challan_date, c.challan_time, c.truck_no, c.drivername, c.vendor_type, isnull(v.Name, c.market_vendor_name) as vendor, c.IsCancelled as ch_cancelled,
                  c.user_id as ch_user, c.tobcode, bc.branch_name as ch_to_name, c.total_freight as hire, c.total_weight as ch_weight
             from Manifest_grn mg join mainfest_entry m on m.mainfest_no = mg.Manifest_no
             left join branch_master bf on bf.branch_code = m.from_branch left join branch_master bt on bt.branch_code = m.to_branch
             left join dispatch_master c on c.challan_no = isnull(mg.challan_no, m.challan_no)
             left join branch_master bc on bc.branch_code = c.tobcode
             left join vendors_master v on v.vendor_code = c.vendor_code
            where mg.docket_no = @d`, p),
    query(`select a.ArrivalNo, a.Receive_Date, a.Receive_time, a.from_branch, b.branch_name, a.user_id, a.IsCancelled, a.diffwt, x.package, x.pending_package, x.weight,
                  x.IsExcessArrival, x.challan_no
             from Arrival_Packg x join Arrival_entry a on a.ArrivalNo = x.ArrivalNo left join branch_master b on b.branch_code = a.from_branch
            where x.docket_no = @d`, p),
    query(`select e.Drs_no, e.Drs_date, e.Drs_time, e.from_branch, b.branch_name, e.Driver_Name, e.Vehicle_No, e.DelBy, e.DelByNo, e.IsCancelled, x.packg, x.weight
             from drs_entry_details_grn x join drs_entry_details e on e.Drs_no = x.Drs_no left join branch_master b on b.branch_code = e.from_branch
            where x.docket_no = @d`, p),
    query(`select s.pkt_status, s.rcv_date, s.rcv_time, s.rcvr_name, s.rcvr_phone, s.remarks, s.drs_no, s.from_branch, b.branch_name, s.UserId, s.IsCancelled
             from delivery_status_entry_details s left join branch_master b on b.branch_code = s.from_branch where s.docket_no = @d order by s.id`, p),
    query(`select p.IOM_number, p.Iom_date, p.created_at, p.From_Branch, b.branch_name, p.branch_code, bh.branch_name as to_name, p.user_id, p.IsCancelled
             from pod_dispatch p left join branch_master b on b.branch_code = p.From_Branch left join branch_master bh on bh.branch_code = p.branch_code
            where p.docket_no = @d`, p),
    query('select IOM_number, Receive_date, LastUpdate, user_id, IsCancelled, Remark from pod_received where docket_no = @d', p),
    query(`select b.bill_no, b.bill_date, b.created_date, b.user_id, b.client_bill_status, b.CancelBy, b.CancelDate, b.ClientBill_Summation_status, b.Summation_date,
                  b.RcvName, b.ClientBill_Finalize_status, b.ClientBill_Finalize_date, b.Payment_Status, b.totalamount, b.Bill_Type
             from client_bill_charge_details d join client_bill b on b.bill_no = d.bill_no where d.docket_no = @d`, p),
    query(`select h.BR_No, h.Receive_Date, h.Created_Date, h.Paymentmode, h.User_id, h.IsCancelled, x.Bill_no, x.Settled
             from client_bill_charge_details d join Bill_Receive_Details x on x.Bill_no = d.bill_no join Bill_Receive h on h.BR_No = x.BR_No
            where d.docket_no = @d`, p),
    query('select Operation, Status, EntryDate, UserLog, Origin, Destination from docket_tracking where docket_no = @d order by EntryDate, id', p),
  ]);

  const events = [];
  const add = (e) => events.push({ cancelled: false, ...e });
  const cancelledFlag = (v) => ['1', 'true'].includes(s(v).toLowerCase());

  add({ key: 'booked', stage: 'Booked', title: 'Docket booked', when: at(g.created_date || g.booking_date), place: s(g.origin_name) || s(g.origin_branch), by: s(g.user_id || g.created_by),
    details: [`${s(g.booking_type)} · ${s(g.booking_mode)}${s(g.LoadType) ? ` · ${s(g.LoadType)}` : ''}`, `${n(g.pcs)} pkt(s), ${n(g.charge_weight)} kg`, `To ${s(g.dest_name) || s(g.destination)}`] });
  if (cancelledFlag(g.IsCancel)) add({ key: 'cancel', stage: 'Cancelled', title: 'Docket cancelled', when: null, by: s(g.cancelled_by), details: [s(g.CancelRemark)], cancelled: true });
  for (const r of pickups) {
    add({ key: `pk-${r.pickup_no}`, stage: 'Picked up', title: `Picked up — ${s(r.pickup_no)}`, when: at(r.pickup_date, r.pickup_time), place: s(r.branch_name) || s(r.from_branch),
      by: s(r.user_id), details: [s(r.PickUpBy) && `By ${s(r.PickUpBy)}`], cancelled: cancelledFlag(r.IsCancelled) });
  }
  for (const r of sheets) {
    add({ key: `ls-${r.Ls_no}`, stage: 'Loading sheet', title: `Loading sheet ${s(r.Ls_no)}`, when: at(r.Created_Date || r.loading_date), place: s(r.branch_name) || s(r.Loading_Branch),
      by: s(r.entered_by), details: [], cancelled: cancelledFlag(r.cancelled) });
  }
  for (const r of manifests) {
    add({ key: `mf-${r.mainfest_no}`, stage: 'Manifested', title: `Manifest ${s(r.mainfest_no)}`, when: at(r.mainfest_date, r.mainfest_time), place: s(r.from_name) || s(r.from_branch),
      by: s(r.user_id), details: [`${s(r.from_name) || s(r.from_branch)} → ${s(r.to_name) || s(r.to_branch)}`, `${n(r.package)} pkt(s), ${n(r.weight)} kg`], cancelled: cancelledFlag(r.IsCancelled) });
    if (s(r.challan_no) && r.challan_date) {
      add({ key: `ch-${r.challan_no}`, stage: 'In transit', title: `Dispatched on challan ${s(r.challan_no)}`, when: at(r.challan_date, r.challan_time), place: s(r.from_name) || s(r.from_branch),
        by: s(r.ch_user), details: [s(r.truck_no) && `Vehicle ${s(r.truck_no)}`, s(r.vendor) && `${s(r.vendor)}${s(r.vendor_type) ? ` (${s(r.vendor_type)})` : ''}`, s(r.drivername) && `Driver ${s(r.drivername)}`],
        cancelled: cancelledFlag(r.ch_cancelled) });
    }
  }
  for (const r of arrivals) {
    add({ key: `ar-${r.ArrivalNo}`, stage: 'Arrived', title: `Arrived — ${s(r.ArrivalNo)}${r.IsExcessArrival ? ' (excess)' : ''}`, when: at(r.Receive_Date, r.Receive_time),
      place: s(r.branch_name) || s(r.from_branch), by: s(r.user_id),
      details: [`${n(r.package)} pkt(s) received${n(r.pending_package) ? `, ${n(r.pending_package)} short` : ''}`, s(r.challan_no) && `Challan ${s(r.challan_no)}`], cancelled: cancelledFlag(r.IsCancelled) });
  }
  for (const r of drs) {
    add({ key: `drs-${r.Drs_no}`, stage: 'Out for delivery', title: `Out for delivery — DRS ${s(r.Drs_no)}`, when: at(r.Drs_date, r.Drs_time), place: s(r.branch_name) || s(r.from_branch),
      details: [s(r.Driver_Name) && `With ${s(r.Driver_Name)}`, s(r.Vehicle_No) && `Vehicle ${s(r.Vehicle_No)}`, r.packg ? `${n(r.packg)} pkt(s)` : ''], cancelled: cancelledFlag(r.IsCancelled) });
  }
  for (const r of statuses) {
    const st = STATUS[s(r.pkt_status)] ?? s(r.pkt_status);
    add({ key: `ds-${s(r.drs_no)}-${iso(r.rcv_date)}-${st}`, stage: st === 'Delivered' ? 'Delivered' : st, title: st, when: at(r.rcv_date, r.rcv_time), place: s(r.branch_name) || s(r.from_branch),
      by: s(r.UserId), details: [s(r.rcvr_name) && `Received by ${s(r.rcvr_name)}${s(r.rcvr_phone) && !client ? ` (${s(r.rcvr_phone)})` : ''}`, s(r.remarks)],
      cancelled: cancelledFlag(r.IsCancelled), tone: st === 'Delivered' ? 'good' : 'bad' });
  }
  for (const r of podOut) {
    add({ key: `pod-${r.IOM_number}`, stage: 'POD sent', title: `POD sent to ${s(r.to_name) || s(r.branch_code)} — IOM ${s(r.IOM_number)}`, when: at(r.created_at || r.Iom_date),
      place: s(r.branch_name) || s(r.From_Branch), by: s(r.user_id), details: [], cancelled: cancelledFlag(r.IsCancelled) });
  }
  for (const r of podIn) {
    add({ key: `podr-${r.IOM_number}`, stage: 'POD received', title: 'POD received at head office', when: at(r.Receive_date), by: s(r.user_id), details: [s(r.Remark)],
      cancelled: cancelledFlag(r.IsCancelled), tone: 'good' });
  }
  for (const r of bills) {
    add({ key: `bill-${r.bill_no}`, stage: 'Billed', title: `Billed — ${s(r.bill_no)}`, when: at(r.bill_date), by: s(r.user_id),
      details: [s(r.Bill_Type), !client && `₹ ${round2(n(r.totalamount)).toLocaleString('en-IN')}`], cancelled: Boolean(s(r.client_bill_status)), billNo: s(r.bill_no) });
    if (s(r.ClientBill_Summation_status) === 'Active' && r.Summation_date) {
      add({ key: `sub-${r.bill_no}`, stage: 'Billed', title: `Bill ${s(r.bill_no)} submitted to the client`, when: at(r.Summation_date), details: [s(r.RcvName) && `Received by ${s(r.RcvName)}`] });
    }
    if (s(r.ClientBill_Finalize_status) === 'Finalized') add({ key: `fin-${r.bill_no}`, stage: 'Billed', title: `Bill ${s(r.bill_no)} finalized`, when: at(r.ClientBill_Finalize_date), details: [] });
  }
  for (const r of receipts) {
    add({ key: `br-${r.BR_No}-${r.Bill_no}`, stage: 'Paid', title: `Payment received — ${s(r.BR_No)}`, when: at(r.Receive_Date), by: s(r.User_id),
      details: [s(r.Paymentmode), !client && `₹ ${round2(n(r.Settled)).toLocaleString('en-IN')} against bill ${s(r.Bill_no)}`], cancelled: Boolean(r.IsCancelled), tone: 'good' });
  }
  // docket_tracking rows of operations not read above (e.g. future modules) are kept
  const known = /^(BOOKING|PICKUP|PRS|LOADING|MANIFEST|CHALLAN|DISPATCH|ARRIVAL|DRS|DELIVERY|POD|BILL)/i;
  for (const r of logged) {
    if (known.test(s(r.Operation))) continue;
    add({ key: `log-${s(r.Operation)}-${iso(r.EntryDate)}`, stage: s(r.Operation), title: `${s(r.Operation)} — ${s(r.Status)}`, when: at(r.EntryDate), place: s(r.Origin), by: s(r.UserLog), details: [s(r.Destination) && `→ ${s(r.Destination)}`] });
  }

  // the values entered on each entry, for the grids on the tracking page (amounts only for staff)
  const amt = (v) => (client ? null : round2(n(v)));
  const V = (key, v) => { const e = events.find((x) => x.key === key); if (e) e.values = { entryNo: '', ...v }; };
  V('booked', {
    entryNo: no, branch: s(g.origin_name) || s(g.origin_branch), toBranch: s(g.dest_name) || s(g.destination_branch), packages: n(g.pcs), weight: n(g.charge_weight),
    amount: amt(g.freight), status: [s(g.booking_type), s(g.booking_mode), s(g.LoadType)].filter(Boolean).join(' · '),
    person: [s(g.consigner_name), s(g.consignee_name)].filter(Boolean).join(' → '), remarks: s(g.destination) && `To ${s(g.destination)}`, enteredBy: s(g.user_id || g.created_by),
  });
  for (const r of pickups) V(`pk-${r.pickup_no}`, { entryNo: s(r.pickup_no), branch: s(r.branch_name) || s(r.from_branch), person: s(r.PickUpBy), enteredBy: s(r.user_id) });
  for (const r of sheets) {
    V(`ls-${r.Ls_no}`, { entryNo: s(r.Ls_no), branch: s(r.branch_name) || s(r.Loading_Branch), toBranch: s(r.to_name) || s(r.to_branch), packages: n(r.pices), weight: n(r.weight),
      remarks: s(r.Manifest_No) && `Manifest ${s(r.Manifest_No)}`, enteredBy: s(r.entered_by) });
  }
  for (const r of manifests) {
    V(`mf-${r.mainfest_no}`, { entryNo: s(r.mainfest_no), branch: s(r.from_name) || s(r.from_branch), toBranch: s(r.to_name) || s(r.to_branch), packages: n(r.package), weight: n(r.weight),
      amount: amt(r.mf_freight), remarks: s(r.challan_no) && `Challan ${s(r.challan_no)}`, enteredBy: s(r.user_id) });
    if (s(r.challan_no)) {
      V(`ch-${r.challan_no}`, { entryNo: s(r.challan_no), branch: s(r.from_name) || s(r.from_branch), toBranch: s(r.ch_to_name) || s(r.tobcode), vehicle: s(r.truck_no),
        person: s(r.drivername), vendor: [s(r.vendor), s(r.vendor_type)].filter(Boolean).join(' · '), amount: amt(r.hire),
        remarks: n(r.ch_weight) ? `Whole vehicle ${n(r.ch_weight)} kg; amount = vehicle hire` : 'Amount = vehicle hire', enteredBy: s(r.ch_user) });
    }
  }
  for (const r of arrivals) {
    V(`ar-${r.ArrivalNo}`, { entryNo: s(r.ArrivalNo), branch: s(r.branch_name) || s(r.from_branch), packages: n(r.package), short: n(r.pending_package), weight: n(r.weight),
      remarks: [n(r.diffwt) ? `Vehicle weight difference ${n(r.diffwt)} kg` : '', r.IsExcessArrival ? 'Excess arrival' : '', s(r.challan_no) && `Challan ${s(r.challan_no)}`].filter(Boolean).join('; '),
      enteredBy: s(r.user_id) });
  }
  for (const r of drs) {
    V(`drs-${r.Drs_no}`, { entryNo: s(r.Drs_no), branch: s(r.branch_name) || s(r.from_branch), packages: n(r.packg), weight: n(r.weight), person: s(r.Driver_Name),
      vehicle: s(r.Vehicle_No), remarks: s(r.DelBy) && `Delivery by ${s(r.DelBy)}${s(r.DelByNo) ? ` (${s(r.DelByNo)})` : ''}` });
  }
  for (const r of statuses) {
    const st = STATUS[s(r.pkt_status)] ?? s(r.pkt_status);
    V(`ds-${s(r.drs_no)}-${iso(r.rcv_date)}-${st}`, { entryNo: s(r.drs_no) && `DRS ${s(r.drs_no)}`, branch: s(r.branch_name) || s(r.from_branch), status: st,
      receiver: [s(r.rcvr_name), !client && s(r.rcvr_phone)].filter(Boolean).join(' · '), remarks: s(r.remarks), enteredBy: s(r.UserId) });
  }
  for (const r of podOut) V(`pod-${r.IOM_number}`, { entryNo: s(r.IOM_number), branch: s(r.branch_name) || s(r.From_Branch), toBranch: s(r.to_name) || s(r.branch_code), enteredBy: s(r.user_id) });
  for (const r of podIn) V(`podr-${r.IOM_number}`, { entryNo: s(r.IOM_number), remarks: s(r.Remark), enteredBy: s(r.user_id) });
  for (const r of bills) {
    V(`bill-${r.bill_no}`, { entryNo: s(r.bill_no), amount: amt(r.totalamount), status: s(r.client_bill_status) ? 'Cancelled' : s(r.Bill_Type), enteredBy: s(r.user_id) });
    V(`sub-${r.bill_no}`, { entryNo: s(r.bill_no), status: 'Submitted', receiver: s(r.RcvName) });
    V(`fin-${r.bill_no}`, { entryNo: s(r.bill_no), status: 'Finalized' });
  }
  for (const r of receipts) {
    V(`br-${r.BR_No}-${r.Bill_no}`, { entryNo: s(r.BR_No), amount: amt(r.Settled), status: s(r.Paymentmode), remarks: `Bill ${s(r.Bill_no)}`, enteredBy: s(r.User_id) });
  }
  for (const e of events) e.values ??= { entryNo: '', branch: e.place, enteredBy: e.by, remarks: e.details.filter(Boolean).join('; ') };

  events.forEach((e) => { e.details = e.details.filter(Boolean); });
  events.sort((a, b) => (a.when ?? '9999').localeCompare(b.when ?? '9999'));

  const live = events.filter((e) => !e.cancelled);
  const has = (st) => live.some((e) => e.stage === st);
  const last = live.filter((e) => !['Billed', 'Paid', 'POD sent', 'POD received'].includes(e.stage)).at(-1);
  const delivered = live.find((e) => e.stage === 'Delivered');
  const final = live.filter((e) => ['Delivered', 'Undelivered', 'Return to origin', 'Lost'].includes(e.stage)).at(-1);
  const status = cancelledFlag(g.IsCancel) ? 'Cancelled' : final?.stage ?? last?.stage ?? 'Booked';
  const steps = [
    { key: 'Booked', label: 'Booked', done: true },
    { key: 'Manifested', label: 'Manifested', done: has('Manifested') || has('In transit') || has('Arrived') || has('Out for delivery') || Boolean(final) },
    { key: 'In transit', label: 'In transit', done: has('In transit') || has('Arrived') || has('Out for delivery') || Boolean(final) },
    { key: 'Arrived', label: 'Arrived at destination', done: has('Arrived') || has('Out for delivery') || Boolean(final) },
    { key: 'Out for delivery', label: 'Out for delivery', done: has('Out for delivery') || Boolean(final) },
    { key: 'Delivered', label: delivered ? 'Delivered' : final ? final.stage : 'Delivered', done: Boolean(final), failed: Boolean(final) && !delivered },
  ];
  const expected = s(g.ExpectedDate) ? iso(s(g.ExpectedDate)) : '';
  const issues = findIssues({ g, events, live, final, delivered, expected, manifests, arrivals, drs, statuses, podOut, podIn, bills, client });
  for (const i of issues) {
    const e = i.event && events.find((x) => x.key === i.event);
    if (e) (e.issues ??= []).push(i);
  }
  return {
    docket: {
      docketNo: no, manualNo: s(g.ManualDocketNo), bookingDate: iso(g.booking_date), expectedDate: expected, status,
      deliveredOn: delivered?.when ?? null, receiver: delivered?.details?.[0]?.replace(/^Received by /, '') ?? '',
      late: Boolean(delivered?.when && expected && delivered.when.slice(0, 10) > expected),
      origin: s(g.origin_name) || s(g.origin_branch), destination: s(g.dest_name) || s(g.destination), destinationCity: s(g.destination),
      currentBranch: s(g.current_name) || s(g.current_branch),
      bookingType: s(g.booking_type), mode: s(g.booking_mode), loadType: s(g.LoadType), packages: n(g.pcs), weight: n(g.charge_weight),
      consignor: { name: s(g.consigner_name), city: s(g.consigner_city) }, consignee: { name: s(g.consignee_name), city: s(g.consignee_city) },
      client: s(g.on_account_of).split(':')[0], freight: client ? null : round2(n(g.freight)), billNo: bills.find((b) => !s(b.client_bill_status))?.bill_no ?? '',
      cancelled: cancelledFlag(g.IsCancel),
      health: issues.some((i) => i.level === 'error') ? 'error' : issues.some((i) => i.level === 'warning') ? 'warning' : 'ok',
    },
    steps, events, issues,
  };
}

// ------------------------------------------------------------------ problems: where the journey went wrong and which entry is wrong
const DAY = 86400000;
const dayOf = (w) => String(w ?? '').slice(0, 10);
const daysBetween = (a, b) => Math.round((new Date(dayOf(b)) - new Date(dayOf(a))) / DAY);
const todayIso = () => new Date().toISOString().slice(0, 10);
const PIPE = ['Booked', 'Picked up', 'Loading sheet', 'Manifested', 'In transit', 'Arrived', 'Out for delivery', 'Delivered', 'Undelivered', 'Return to origin', 'Lost'];
const rank = (st) => { const i = PIPE.indexOf(st); return i < 0 ? 99 : Math.min(i, 7); };
const fmtDay = (w) => (w ? `${w.slice(8, 10)}/${w.slice(5, 7)}/${w.slice(0, 4)}` : '');
const isCancelled = (v) => ['1', 'true'].includes(s(v).toLowerCase());

/**
 * Each issue: { level: 'error' | 'warning', stage, event (key of the timeline entry it belongs to), title, detail, fix, ref, by }.
 * error = an entry is wrong or the shipment failed; warning = late, stuck or incomplete.
 */
function findIssues({ g, events, live, final, delivered, expected, manifests, arrivals, drs, statuses, podOut, podIn, bills, client }) {
  const out = [];
  const add = (i) => out.push({ level: 'warning', ...i });
  const booked = events.find((e) => e.key === 'booked');
  const docketCancelled = isCancelled(g.IsCancel);

  // 1. the booking entry itself
  if (!(n(g.pcs) > 0)) add({ level: 'error', stage: 'Booked', event: 'booked', field: 'packages', title: 'No packages on the booking', detail: 'Packages are 0 or missing.', fix: 'Correct the packages in Docket modify.', by: booked?.by });
  if (!(n(g.charge_weight) > 0)) add({ level: 'error', stage: 'Booked', event: 'booked', field: 'weight', title: 'No charged weight on the booking', detail: 'Charged weight is 0 or missing.', fix: 'Correct the weight in Docket modify.', by: booked?.by });
  if (!client && !(n(g.freight) > 0) && !docketCancelled) add({ stage: 'Booked', event: 'booked', field: 'amount', title: 'Freight is 0', detail: 'The docket has no freight; it will bill as 0.', fix: 'Check the rate / contract and modify the docket.', by: booked?.by });
  if (!s(g.consignee_name)) add({ stage: 'Booked', event: 'booked', field: 'person', title: 'Consignee name missing', detail: 'The delivery branch cannot see who to deliver to.', fix: 'Fill the consignee in Docket modify.', by: booked?.by });
  if (!expected) add({ stage: 'Booked', event: 'booked', field: 'date', title: 'No expected delivery date', detail: 'Lateness cannot be checked.', fix: 'Set the expected date (destination / transit days).', by: booked?.by });

  // 2. a cancelled docket must not move
  if (docketCancelled) {
    for (const e of live.filter((x) => rank(x.stage) > 0 && rank(x.stage) < 99)) {
      add({ level: 'error', stage: e.stage, event: e.key, field: 'status', title: `${e.stage} after the docket was cancelled`, detail: `${e.title} is active although the docket is cancelled.`, fix: 'Cancel this entry, or un-cancel the docket if the cancel was a mistake.', ref: e.title, by: e.by });
    }
  }

  // 3. entries in the wrong order (a later step dated before an earlier one)
  const flow = live.filter((e) => e.when && rank(e.stage) < 99).sort((a, b) => rank(a.stage) - rank(b.stage) || a.when.localeCompare(b.when));
  for (let i = 1; i < flow.length; i++) {
    const cur = flow[i];
    const prev = flow.slice(0, i).filter((x) => rank(x.stage) < rank(cur.stage)).sort((a, b) => a.when.localeCompare(b.when)).at(-1);
    if (!prev) continue;
    const timed = (w) => !w.endsWith('T00:00:00');
    if (dayOf(cur.when) < dayOf(prev.when)) {
      add({ level: 'error', stage: cur.stage, event: cur.key, field: 'date', title: `${cur.stage} dated before ${prev.stage.toLowerCase()}`, detail: `${cur.title} is dated ${fmtDay(cur.when)} but ${prev.title} is ${fmtDay(prev.when)}.`, fix: `Check the date entered on ${cur.title}.`, ref: cur.title, by: cur.by });
    } else if (dayOf(cur.when) === dayOf(prev.when) && timed(cur.when) && timed(prev.when) && cur.when < prev.when) {
      add({ stage: cur.stage, event: cur.key, field: 'date', title: `${cur.stage} time is before ${prev.stage.toLowerCase()}`, detail: `${cur.title} at ${cur.when.slice(11, 16)} but ${prev.title} at ${prev.when.slice(11, 16)} on the same day.`, fix: `Check the time entered on ${cur.title} (or on ${prev.title}).`, ref: cur.title, by: cur.by });
    }
  }

  // 4. packages / weight / branches: manifest and arrival against the booking
  const liveMf = manifests.filter((m) => !isCancelled(m.IsCancelled));
  const mfPkts = liveMf.reduce((t, m) => t + n(m.package), 0);
  if (n(g.pcs) > 0 && mfPkts > n(g.pcs)) {
    add({ level: 'error', stage: 'Manifested', event: `mf-${s(liveMf.at(-1)?.mainfest_no)}`, field: 'packages', title: 'More packages manifested than booked', detail: `Booked ${n(g.pcs)} pkt(s), manifested ${mfPkts}.`, fix: 'Check the packages on the manifest(s) or on the booking.', ref: liveMf.map((m) => s(m.mainfest_no)).join(', '), by: s(liveMf.at(-1)?.user_id) });
  }
  if (liveMf[0] && s(liveMf[0].from_branch) && s(liveMf[0].from_branch) !== s(g.origin_branch)) {
    add({ stage: 'Manifested', event: `mf-${s(liveMf[0].mainfest_no)}`, field: 'branch', title: 'First manifest is not from the booking branch', detail: `Booked at ${s(g.origin_name) || s(g.origin_branch)}, first manifested at ${s(liveMf[0].from_name) || s(liveMf[0].from_branch)}.`, fix: 'Check the booking branch or the manifest branch.', ref: s(liveMf[0].mainfest_no), by: s(liveMf[0].user_id) });
  }
  const liveArr = arrivals.filter((x) => !x.IsCancelled);
  for (const a of liveArr) {
    if (n(a.pending_package) > 0) add({ level: 'error', stage: 'Arrived', event: `ar-${s(a.ArrivalNo)}`, field: 'short', title: `${n(a.pending_package)} package(s) short at arrival`, detail: `Arrival ${s(a.ArrivalNo)} at ${s(a.branch_name) || s(a.from_branch)} received ${n(a.package)}; ${n(a.pending_package)} not received.`, fix: 'Trace the short packages with the loading branch / vehicle; receive them when they come.', ref: s(a.ArrivalNo), by: s(a.user_id) });
    if (Math.abs(n(a.diffwt)) > 0) add({ stage: 'Arrived', event: `ar-${s(a.ArrivalNo)}`, field: 'remarks', title: `Weight difference of ${n(a.diffwt)} kg on the vehicle`, detail: `Arrival ${s(a.ArrivalNo)} recorded a difference between loaded and received weight.`, fix: "Check the vehicle's dockets for damage / shortage.", ref: s(a.ArrivalNo), by: s(a.user_id) });
  }
  const lastArr = liveArr.at(-1);
  if (lastArr && (final || drs.length) && s(lastArr.from_branch) !== s(g.destination_branch)) {
    add({ stage: 'Arrived', event: `ar-${s(lastArr.ArrivalNo)}`, field: 'branch', title: 'Delivered from a branch that is not the destination', detail: `Destination is ${s(g.dest_name) || s(g.destination_branch)}, last arrival at ${s(lastArr.branch_name) || s(lastArr.from_branch)}.`, fix: 'Check the destination on the booking or the manifest destination.', ref: s(lastArr.ArrivalNo), by: s(lastArr.user_id) });
  }

  // 5. delivery outcome
  const liveStatus = statuses.filter((x) => !x.IsCancelled);
  const lastStatus = liveStatus.at(-1);
  for (const st of liveStatus.filter((x) => s(x.pkt_status) !== 'DLVRD')) {
    const name = STATUS[s(st.pkt_status)] ?? s(st.pkt_status);
    const ev = events.find((e) => e.key === `ds-${s(st.drs_no)}-${iso(st.rcv_date)}-${name}`);
    add({ level: s(st.pkt_status) === 'UNDELIVERED' ? 'warning' : 'error', stage: name, event: ev?.key, field: 'status', title: name, detail: s(st.remarks) || 'No reason entered.', fix: s(st.pkt_status) === 'UNDELIVERED' ? 'Re-attempt: put the docket on a new DRS.' : 'Inform the client; settle the claim / return as per policy.', ref: s(st.drs_no) && `DRS ${s(st.drs_no)}`, by: s(st.UserId) });
  }
  if (lastStatus && s(lastStatus.pkt_status) === 'UNDELIVERED' && daysBetween(iso(lastStatus.rcv_date), todayIso()) > 1) {
    add({ stage: 'Undelivered', title: 'No re-attempt after the failed delivery', detail: `Undelivered on ${fmtDay(iso(lastStatus.rcv_date))}; no new DRS since.`, fix: 'Put the docket on a DRS again or mark it RTO.' });
  }
  if (delivered && !s(liveStatus.find((x) => s(x.pkt_status) === 'DLVRD')?.rcvr_name)) {
    add({ stage: 'Delivered', event: delivered.key, field: 'receiver', title: 'Delivered without a receiver name', detail: 'The delivery entry has no receiver; the POD may be disputed.', fix: 'Fill the receiver in the delivery status entry.', by: delivered.by });
  }

  // 6. late / overdue / stuck
  if (delivered?.when && expected && dayOf(delivered.when) > expected) {
    add({ stage: 'Delivered', event: delivered.key, field: 'date', title: `Delivered ${daysBetween(expected, delivered.when)} day(s) late`, detail: `Expected ${fmtDay(expected)}, delivered ${fmtDay(delivered.when)}.`, fix: 'See which step took longest in the timeline.' });
  }
  if (!final && !docketCancelled) {
    if (expected && todayIso() > expected) add({ level: 'error', stage: 'Overdue', title: `Overdue by ${daysBetween(expected, todayIso())} day(s)`, detail: `Expected ${fmtDay(expected)}; still not delivered.`, fix: 'Chase the branch that holds it now (see the last entry).' });
    const lastMove = live.filter((e) => rank(e.stage) < 7 && e.when).sort((a, b) => a.when.localeCompare(b.when)).at(-1);
    const limits = { Booked: 2, 'Picked up': 2, 'Loading sheet': 2, Manifested: 1, 'In transit': 5, Arrived: 2, 'Out for delivery': 1 };
    const fixes = { Booked: 'Manifest it.', 'Picked up': 'Manifest it.', 'Loading sheet': 'Make the manifest from the loading sheet.', Manifested: 'Dispatch it on a challan.', 'In transit': 'Check with the vehicle / receive it at the destination.', Arrived: 'Put it on a DRS.', 'Out for delivery': 'Enter the delivery status.' };
    if (lastMove && limits[lastMove.stage] !== undefined && daysBetween(lastMove.when, todayIso()) > limits[lastMove.stage]) {
      add({ stage: lastMove.stage, event: lastMove.key, field: 'date', title: `Stuck at "${lastMove.stage}" for ${daysBetween(lastMove.when, todayIso())} day(s)`, detail: `Nothing has happened since ${lastMove.title} on ${fmtDay(lastMove.when)}.`, fix: fixes[lastMove.stage], ref: lastMove.title, by: lastMove.by });
    }
  }

  // 7. POD and billing follow-up (staff only)
  if (delivered?.when && !client) {
    const age = daysBetween(delivered.when, todayIso());
    const sent = podOut.find((p) => !p.IsCancelled);
    const got = podIn.some((p) => !isCancelled(p.IsCancelled));
    if (!sent && !got && age > 7) add({ stage: 'POD', event: delivered.key, title: `POD not sent ${age} days after delivery`, detail: 'The signed POD is still at the delivering branch.', fix: 'Send it in a POD dispatch (IOM).' });
    if (sent && !got && daysBetween(iso(sent.created_at || sent.Iom_date), todayIso()) > 10) add({ stage: 'POD', event: `pod-${s(sent.IOM_number)}`, title: 'POD sent but not received at head office', detail: `IOM ${s(sent.IOM_number)} sent ${fmtDay(iso(sent.created_at || sent.Iom_date))}.`, fix: 'Receive the IOM at head office or trace the courier.', ref: s(sent.IOM_number), by: s(sent.user_id) });
    const liveBill = bills.find((b) => !s(b.client_bill_status));
    if (s(g.booking_type) === 'To Be Billed' && !liveBill && age > 30) add({ stage: 'Billing', event: delivered.key, title: `Not billed ${age} days after delivery`, detail: 'A To Be Billed docket, delivered, without a client bill.', fix: 'Include it in the next client bill.' });
    if (liveBill && Number(liveBill.Payment_Status) !== 1 && liveBill.bill_date && daysBetween(iso(liveBill.bill_date), todayIso()) > 60) add({ stage: 'Billing', event: `bill-${s(liveBill.bill_no)}`, title: 'Bill unpaid for more than 60 days', detail: `Bill ${s(liveBill.bill_no)} of ${fmtDay(iso(liveBill.bill_date))} is not fully paid.`, fix: 'Follow up the payment with the client.', ref: s(liveBill.bill_no) });
  }
  return out;
}
