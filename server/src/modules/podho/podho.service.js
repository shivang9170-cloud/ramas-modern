// POD to head office — port of:
//   wwwroot/Operation/POD_Dispatch_To_Head_Office.aspx(.cs)   courier / hand the IOMs to head office (Doc No.)
//   wwwroot/Operation/POD_Courier_Cancel.aspx(.cs), POD_Courier_View.aspx(.cs)
//   wwwroot/Operation/podreceive.aspx(.cs)                    receive the PODs at head office
//   wwwroot/Operation/POD_Received_Cancel.aspx(.cs), POD_Received_View.aspx(.cs)
//   ClassLibrary/dal/POD_Dispach_To_Head_Office_Dal.cs, POD_Courier_Cancel_Dal.cs, Pod_received_dal.cs,
//   POD_Received_Cancel_Dal.cs
//
// Fixed legacy bugs (docs/SECURITY.md):
//   * courier: the Doc No. was generated at page load (race) and the header, the "IOM sent"
//     flags and the detail rows were written separately — now one transaction (number from
//     usp_insert_Pod_Dispatch_H's @retval inside it); IOM numbers were concatenated into SQL;
//   * courier: a back-dated document date was silently replaced by today — now the date
//     must be today (no back / future dating), stated on screen;
//   * receive: grn_master / grn_docket_charge / POD_Dispatch_D were updated BEFORE the
//     duplicate check, so skipped dockets were still marked received, and the whole IOM was
//     marked received at head office even if only some of its dockets were ticked — now only
//     received dockets are flagged and an IOM / document is closed when all its dockets are in;
//   * receive: no transaction, receive date not checked against today — fixed;
//   * receive cancel hard-deleted rows (sp_Delete_Pod_Receive_Cencel) — now the soft
//     usp_POD_Receive_Cancel.
//
// Not ported: HO-copy dispatch (Courier_Type HOCOPY, Dispatch_HO_Copy), editing a courier
// document (update_POD_Dispatch_Head_Office), POD tracking, the print.

import { config } from '../../config.js';
import { exec, query, sql, withTransaction } from '../../db/index.js';
import { badRequest, conflict, forbidden, HttpError, notFound } from '../../middleware/errors.js';
import { financialYearRange } from '../../utils/legacy.js';
import { s, n, iso, today } from '../../utils/values.js';

const unprocessable = (msg, details) => new HttpError(422, msg, details);
const inParams = (list, prefix, params) => list.map((v, i) => { params[`${prefix}${i}`] = v; return `@${prefix}${i}`; }).join(',');

// ================================================================== courier to head office

export async function courierOptions() {
  const rows = await query('select CCode, CName from Courier order by CName');
  return { couriers: rows.map((r) => ({ value: s(r.CCode), label: s(r.CName) })), headOffice: config.headOfficeBranch };
}

/** select_iom_no_List — IOMs dispatched from this branch and not yet sent on a courier document. */
export async function pendingIoms(user) {
  const rows = await query(
    `select p.IOM_number, p.Iom_date, b.branch_name as sent_to, p.docket_no
       from pod_dispatch p left join branch_master b on b.branch_code = p.branch_code
      where p.From_Branch = @b and p.Division = @div and p.Dispatch is null and isnull(p.IsCancelled, 0) = 0
      order by p.Iom_date, p.IOM_number, p.docket_no`, { b: user.currentBranch.code, div: user.divCode });
  const byIom = new Map();
  for (const r of rows) {
    const cur = byIom.get(s(r.IOM_number)) ?? { iomNo: s(r.IOM_number), iomDate: iso(r.Iom_date), sentTo: s(r.sent_to), dockets: [] };
    cur.dockets.push(s(r.docket_no));
    byIom.set(cur.iomNo, cur);
  }
  return [...byIom.values()];
}

export async function createCourier(user, body) {
  const branch = user.currentBranch.code;
  if (body.docDate !== today()) throw badRequest('The document date must be today');
  const ioms = [...new Set(body.ioms)];
  if (ioms.length !== body.ioms.length) throw badRequest('Record already added');
  const pending = new Map((await pendingIoms(user)).map((p) => [p.iomNo, p]));
  const missing = ioms.filter((i) => !pending.has(i));
  if (missing.length) throw unprocessable(`Not waiting to be sent from this branch: ${missing.join(', ')}`);
  const courier = body.mode === 'COURIER';
  if (courier) {
    const [c] = await query('select CCode from Courier where CCode = @c', { c: body.courierCode });
    if (!c) throw badRequest('Select the courier');
  }

  const S = sql();
  const docNo = await withTransaction(async (tx) => {
    const res = await exec('usp_insert_Pod_Dispatch_H', {
      Doc_Cat: branch,
      Doc_No: '',
      Doc_Dt: body.docDate,
      Ent_Dt: new Date(),
      Branch_Code: branch,
      MODE: courier ? 'C' : 'S',
      PName: body.personName,
      CCode: courier ? body.courierCode : '',
      USER_ID: user.userId,
      Courier_Type: 'POD',
      financial_year: user.financialYear,
      division: user.divCode,
    }, { retval: [S.VarChar(20), null] }, { tx });
    const no = s(res.output.retval);
    if (!no) throw unprocessable('Courier document could not be saved');
    for (const iom of ioms) {
      // update_Pod_Dispatch1 + insert_POD_Dispatch_D
      await query(
        `update pod_dispatch set Dispatch = 'y' where IOM_number = @iom and From_Branch = @b and isnull(IsCancelled, 0) = 0;
         insert into POD_Dispatch_D(Doc_Cat, Doc_No, Doc_Dt, IOM_No, MODE, PName, CCode, AWBill_No, Financial_Year, division)
         values (@b, @doc, @dt, @iom, @mode, @person, @ccode, @awb, @fy, @div);`,
        {
          iom, b: branch, doc: no, dt: body.docDate, mode: courier ? 'C' : 'S', person: body.personName,
          ccode: courier ? body.courierCode : '', awb: courier ? body.awbNo : '', fy: user.financialYear, div: user.divCode,
        }, { tx });
    }
    return no;
  });
  return { docNo, ioms: ioms.length, message: `Courier document ${docNo} saved with ${ioms.length} IOM(s)` };
}

export async function listCouriers(user, { status = 'active' }) {
  const { recordset } = await exec('GET_POD_DISPATCH_LIST_BY_COURIER_FOR_VIEW_CANCEL', {
    Financial_Year: user.financialYear, Branch_code: user.currentBranch.code, division: user.divCode,
  });
  return recordset
    .map((r) => ({
      docNo: s(r.Doc_No), docDate: iso(r.Doc_Dt), mode: s(r.MODE) === 'C' ? 'Courier' : 'Self', person: s(r.PName),
      courier: s(r.CName), awbNo: s(r.AWBill_No), ioms: n(r.iom_count), received: Boolean(r.Receive_Status),
      cancelled: ['1', 'true'].includes(s(r.IsCancelled).toLowerCase()), createdBy: s(r.USER_ID),
    }))
    .filter((r) => (status === 'cancelled' ? r.cancelled : !r.cancelled));
}

async function courierDoc(docNo, division) {
  const [h] = await query(
    `select h.*, c.CName, b.branch_name from POD_Dispatch_H h
       left join Courier c on c.CCode = h.CCode left join branch_master b on b.branch_code = h.Branch_Code
      where h.Doc_No = @d and h.division = @div`, { d: docNo, div: division });
  if (!h) throw notFound(`Courier document ${docNo} not found`);
  return h;
}

export async function getCourier(user, docNo) {
  const h = await courierDoc(docNo, user.divCode);
  if (s(h.Branch_Code) !== user.currentBranch.code && user.currentBranch.code !== config.headOfficeBranch) {
    throw notFound(`Courier document ${docNo} not found at this branch`);
  }
  const lines = await query(
    `select d.IOM_No, d.AWBill_No, d.ho_receive, p.docket_no,
            (select top 1 1 from pod_received r where r.docket_no = p.docket_no and r.Doc_No = d.Doc_No and isnull(r.IsCancelled, '0') = '0') as received
       from POD_Dispatch_D d join pod_dispatch p on p.IOM_number = d.IOM_No and isnull(p.IsCancelled, 0) = 0
      where d.Doc_No = @d and (isnull(d.IsCancelled, 0) = 0 or @cancelled = 1)
      order by d.IOM_No, p.docket_no`, { d: docNo, cancelled: h.IsCancelled ? 1 : 0 });
  return {
    docNo: s(h.Doc_No), docDate: iso(h.Doc_Dt), from: s(h.branch_name), fromCode: s(h.Branch_Code), mode: s(h.MODE) === 'C' ? 'Courier' : 'Self',
    person: s(h.PName), courier: s(h.CName), awbNo: s(lines[0]?.AWBill_No),
    cancelled: Boolean(h.IsCancelled), received: Boolean(h.Receive_Status), createdBy: s(h.USER_ID),
    dockets: lines.map((l) => ({ iomNo: s(l.IOM_No), docketNo: s(l.docket_no), received: Boolean(l.received) })),
  };
}

export async function cancelCourier(user, docNo) {
  const h = await courierDoc(docNo, user.divCode);
  if (s(h.Branch_Code) !== user.currentBranch.code) throw conflict('Only the branch that sent the courier can cancel it');
  if (h.IsCancelled) throw conflict('This courier document is already cancelled');
  const { recordset } = await exec('CHECK_WHEN_POD_ALREADY_RECEIVED', { doc_no: docNo });
  if (recordset.length) throw conflict('Cannot cancel because the POD is already received');
  const res = await exec('CANCEL_POD_DISPATCH_BY_COUREIR', { Doc_No: docNo, Cancel_By: user.userId });
  if (!(res.rowsAffected ?? []).some((x) => x > 0)) throw unprocessable('Record not cancelled');
  return { docNo, message: 'Courier document cancelled' };
}

// ================================================================== receive at head office

function assertHeadOffice(user) {
  if (user.currentBranch.code !== config.headOfficeBranch) {
    throw forbidden('POD receive is done at head office — select the head office branch');
  }
}

export async function pendingDocs(user, { from, to }) {
  assertHeadOffice(user);
  const { recordset } = await exec('search_Doc_no_Datewise', { booking_date1: from, booking_date2: to, Divcode: user.divCode });
  return recordset.map((r) => ({
    docNo: s(r.Doc_No), docDate: iso(r.Doc_Dt), mode: s(r.MODE) === 'C' ? 'Courier' : 'Self', from: s(r.from_branch),
    courier: s(r.CName), person: s(r.PName), ioms: n(r.iom_count),
  }));
}

export async function docForReceive(user, docNo) {
  assertHeadOffice(user);
  const { recordset } = await exec('search_pod_on_the_basis_of_pod_number_After_Courier', { Doc_No: docNo, DivCode: user.divCode });
  if (!recordset.length) throw notFound(`Courier document ${docNo} not found`);
  return {
    docNo,
    dockets: recordset.map((r) => ({
      docketNo: s(r.docket_no), iomNo: s(r.IOM_number), iomDate: iso(r.Iom_date), consignee: s(r.consignee_name),
      packages: n(r.pcs), weight: n(r.charge_weight), freight: n(r.freight), images: n(r.images),
      received: s(r.PODDispatch_status) === 'POD_Received_IsActive',
    })),
  };
}

export async function docByDocket(user, docketNo) {
  assertHeadOffice(user);
  const { recordset } = await exec('GET_DOC_NO_BY_DOCKET_NO_FOR_POD_RECEIVE', { docket_no: docketNo });
  if (!recordset.length) throw notFound('Docket no. not valid for POD receive');
  return { docNo: s(recordset[0].Doc_No) };
}

export async function receive(user, body) {
  assertHeadOffice(user);
  if (body.receiveDate > today()) throw badRequest('Receive date should not be greater than current date');
  const nos = body.dockets;
  if (new Set(nos).size !== nos.length) throw badRequest('The same docket is listed twice');
  const doc = await docForReceive(user, body.docNo);
  const onDoc = new Map(doc.dockets.map((d) => [d.docketNo, d]));
  const problems = [];
  for (const no of nos) {
    const d = onDoc.get(no);
    if (!d) problems.push(`${no}: not on courier document ${body.docNo}`);
    else if (d.received) problems.push(`${no}: POD already received`);
    else if (d.iomDate && body.receiveDate < d.iomDate) problems.push(`${no}: receive date is before the POD dispatch date (${d.iomDate})`);
  }
  if (problems.length) throw unprocessable('Some PODs cannot be received', problems.map((message) => ({ path: 'dockets', message })));

  await withTransaction(async (tx) => {
    for (const no of nos) {
      const d = onDoc.get(no);
      const dup = await query(
        "select top 1 1 as x from pod_received where docket_no = @d and isnull(IsCancelled, '0') = '0'", { d: no }, { tx });
      if (dup.length) throw conflict(`${no}: POD already received`);
      await exec('Insert_Pod_Received', {
        IOM_number: d.iomNo, docket_no: no, Receive_date: body.receiveDate, Remark: body.remark, Doc_No: body.docNo,
        user_id: user.userId, IsCancelled: '0', LastUpdate: new Date(), DivCode: user.divCode, Financial_Year: user.financialYear,
      }, {}, { tx });
      await query(
        `update grn_master set PODDispatch_status = 'POD_Received_IsActive', IOM_number = @iom where docket_no = @d;
         update grn_docket_charge set PODRCV_status = 'POD_Received_IsActive' where Docket_No = @d;`,
        { d: no, iom: d.iomNo }, { tx });
    }
    // Close an IOM only when all its dockets are in, and the document when all its IOMs are.
    const params = { doc: body.docNo };
    const iomIn = inParams([...new Set(nos.map((no) => onDoc.get(no).iomNo))], 'i', params);
    await query(
      `update d set ho_receive = '1' from POD_Dispatch_D d
        where d.Doc_No = @doc and d.IOM_No in (${iomIn})
          and not exists (select 1 from pod_dispatch p where p.IOM_number = d.IOM_No and isnull(p.IsCancelled, 0) = 0
                            and p.docket_no not in (select docket_no from pod_received where isnull(IsCancelled, '0') = '0'));
       update POD_Dispatch_H set Receive_Status = 1
        where Doc_No = @doc
          and not exists (select 1 from POD_Dispatch_D d where d.Doc_No = @doc and isnull(d.IsCancelled, 0) = 0 and d.ho_receive is null);`,
      params, { tx });
  });
  const left = doc.dockets.filter((d) => !d.received && !nos.includes(d.docketNo)).length;
  return { docNo: body.docNo, received: nos.length, pending: left, message: `${nos.length} POD(s) received${left ? `, ${left} still pending on ${body.docNo}` : ''}` };
}

export async function listReceived(user, { from, to, status = 'active', search = '' }) {
  const fy = financialYearRange(user.financialYear);
  const { recordset } = await exec('usp_search_POD_Receive_Entry', {
    booking_date1: from || fy.from, booking_date2: to || fy.to, Doc_no: search || null,
    IsCancelled: status === 'cancelled' ? 1 : 0, user_id: 'admin', Financial_Year: user.financialYear, DivCode: user.divCode,
  });
  return recordset.map((r) => ({
    docNo: s(r.Doc_No), receiveDate: iso(r.Receive_date), docketNo: s(r.docket_no), iomNo: s(r.IOM_number),
    remark: s(r.Remark), from: s(r.from_branch), createdBy: s(r.user_id),
  }));
}

export async function cancelReceive(user, docNo) {
  assertHeadOffice(user);
  const res = await exec('usp_POD_Receive_Cancel', {
    Doc_No: docNo, user_id: user.userId, Financial_Year: user.financialYear, DivCode: user.divCode,
  }, { success: [sql().VarChar(1000), null] });
  const msg = s(res.output.success);
  if (msg.toLowerCase() !== 'success') throw (/nothing/i.test(msg) ? notFound(msg) : unprocessable(msg || 'Not cancelled'));
  return { docNo, message: 'POD receive cancelled' };
}
