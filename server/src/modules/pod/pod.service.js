// POD dispatch (IOM) — port of:
//   wwwroot/Operation/Pod_Dispatch.aspx(.cs)          create, with the signed POD images
//   wwwroot/Operation/POD_Dispatch_Cancel.aspx(.cs)   list / cancel
//   wwwroot/Operation/POD_Dispatch_View.aspx(.cs)     list / view
//   ClassLibrary/dal/pod_dispatch_dal.cs, POD_Dispatch_Cancel_Dal.cs
//
// After delivery, the delivering branch scans the signed POD of each docket and sends
// them (one IOM no.) to a branch. Images are written to config.podUploadDir and their
// paths ("~/PODImage/<file>", as the legacy site stores them) go to the database.
//
// Fixed legacy bugs (docs/SECURITY.md):
//   * every docket in the IOM was saved with the images of the LAST docket added
//     (one ViewState table was reused) — now each docket keeps its own images;
//   * the file name came from the uploaded file name (path traversal into the web root)
//     — now generated on the server; the type is checked from the file content;
//   * PDFs were rejected by the extension check although the rest of the code handled
//     them, and images had no size limit — now JPEG and PDF, each up to 2 MB;
//   * the IOM no. was generated when the page opened (race) — now inside the save transaction;
//   * inserts and the grn_docket_charge update ran separately with docket numbers
//     concatenated into SQL — now one transaction, parameters;
//   * cancel hard-deleted the rows (sp_Delete_Pod_Cancel) and was only blocked while the
//     courier to head office was NOT yet received — now a soft cancel
//     (usp_POD_Dispatch_Cancel), blocked once the POD is on any courier document.
//
// Not ported: direct POD dispatch (Pod_Dispatch_Direct.aspx), bulk POD dispatch, POD modify,
// courier to head office and POD receive (next step), the IOM print. Images are stored as
// uploaded (the legacy page halved JPEG dimensions).

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../../config.js';
import { exec, query, sql, withTransaction } from '../../db/index.js';
import { badRequest, conflict, HttpError, notFound } from '../../middleware/errors.js';
import { round2 } from '../../../../shared/challanCalc.js';
import { s, n, iso, today } from '../../utils/values.js';

const unprocessable = (msg, details) => new HttpError(422, msg, details);

export const MAX_IMAGES_PER_DOCKET = 5;

/** File type from its first bytes (never from the name). */
function sniff(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { ext: '.jpg', type: 'image/jpeg' };
  if (buf.length > 4 && buf.subarray(0, 5).toString('latin1') === '%PDF-') return { ext: '.pdf', type: 'application/pdf' };
  return null;
}

export async function options() {
  const branches = await query("select branch_code, branch_name from branch_master where status = 'Active' order by branch_name");
  return { branches: branches.map((b) => ({ value: s(b.branch_code), label: `${s(b.branch_name)} : ${s(b.branch_code)}` })) };
}

// ------------------------------------------------------------------ eligibility

/** txtdocketno_TextChanged: delivered, POD made at this branch (origin for FTL), not dispatched yet. */
export async function checkDocket(user, docketNo) {
  const [dl] = await query(
    `select top 1 rcv_date from delivery_status_entry_details
      where docket_no = @d and pkt_status = 'DLVRD' and isnull(IsCancelled, 0) = 0 order by rcv_date desc`, { d: docketNo });
  if (!dl) throw unprocessable(`${docketNo}: docket not delivered`);
  const { recordset } = await exec('CHECK_DOCKET_NO_ELIGIBLE_FOR_POD_DISPATCH', {
    docket_no: docketNo, branch_code: user.currentBranch.code, div_code: user.divCode,
  });
  if (!recordset.length) {
    const [g] = await query(
      `select bm.branch_code, bm.branch_name, g.Division, dm.DivName
         from grn_master g
         join branch_master bm on bm.branch_code = (case when g.LoadType = 'FTL' then g.origin_branch else g.destination_branch end)
         left join DivisionMaster dm on dm.DivCode = g.Division
        where g.docket_no = @d`, { d: docketNo });
    if (g && s(g.branch_code) !== user.currentBranch.code) {
      throw unprocessable(`${docketNo}: POD for this docket is to be made in ${s(g.branch_name)} : ${s(g.branch_code)}`);
    }
    if (g && s(g.Division) !== user.divCode) throw unprocessable(`${docketNo}: POD for this docket is to be made in ${s(g.DivName) || s(g.Division)} division`);
    throw notFound(`${docketNo}: docket not found`);
  }
  if (s(recordset[0].pod_generated_status) === '1') throw conflict(`${docketNo}: POD already generated for this docket`);

  // search_docket_for_pod_dispatch — the booking row carries pieces / weight / freight
  const [c] = await query(
    `select g.docket_no, g.booking_date, g.Consigner_Name, g.consignee_name, c.pcs, c.charge_weight,
            case when c.freight = 0 then c.charges else c.freight end as fright_charges
       from grn_master g join grn_docket_charge c on c.Docket_No = g.docket_no
            and isnull(c.branch, g.origin_branch) = g.origin_branch
      where g.docket_no = @d`, { d: docketNo });
  return {
    docketNo: s(c?.docket_no || docketNo),
    bookingDate: iso(c?.booking_date),
    deliveredOn: iso(dl.rcv_date),
    consigner: s(c?.Consigner_Name),
    consignee: s(c?.consignee_name),
    packages: n(c?.pcs),
    weight: round2(n(c?.charge_weight)),
    freight: round2(n(c?.fright_charges)),
  };
}

// ------------------------------------------------------------------ create

// PDF features that run code or open other files — a POD scan never needs them
// (/OpenAction and /AA are left alone: scanners use them just to set the opening view)
const PDF_ACTIVE = /\/(JavaScript|JS|Launch|EmbeddedFile|RichMedia|XFA|SubmitForm|ImportData)\b/;

function decodeImages(docketNo, images) {
  return images.map((img, i) => {
    const label = img.name ? `"${String(img.name).slice(0, 60)}"` : `file ${i + 1}`;
    let buf;
    try { buf = Buffer.from(String(img.data).replace(/^data:[\w/+.-]+;base64,/, ''), 'base64'); } catch { buf = Buffer.alloc(0); }
    if (!buf.length) throw badRequest(`${docketNo}: ${label} is empty`);
    if (buf.length > config.podMaxBytes) throw badRequest(`${docketNo}: ${label} is larger than ${Math.round(config.podMaxBytes / 1024 / 1024)} MB`);
    const kind = sniff(buf);
    if (!kind) throw badRequest(`${docketNo}: ${label} is not a JPEG image or PDF`);
    // a JPEG must also end like one (not a script with a JPEG header glued on)
    if (kind.ext === '.jpg' && !(buf[buf.length - 2] === 0xff && buf[buf.length - 1] === 0xd9) && !buf.subarray(-64).includes(Buffer.from([0xff, 0xd9]))) {
      throw badRequest(`${docketNo}: ${label} is not a complete JPEG image`);
    }
    if (kind.ext === '.pdf' && PDF_ACTIVE.test(buf.toString('latin1'))) {
      throw badRequest(`${docketNo}: ${label} contains active content (scripts / embedded files) — upload a plain scan`);
    }
    return { buf, ...kind };
  });
}

export async function createPod(user, body) {
  const branch = user.currentBranch.code;
  if (body.iomDate > today()) throw badRequest('IOM date should not be greater than current date');
  const nos = body.dockets.map((d) => d.docketNo);
  if (new Set(nos).size !== nos.length) throw badRequest('Docket no. already in the POD dispatch list');
  const [to] = await query('select branch_code from branch_master where branch_code = @b', { b: body.sentTo });
  if (!to) throw badRequest('Select the branch the PODs are sent to');

  const problems = [];
  const rows = [];
  for (const d of body.dockets) {
    try {
      const info = await checkDocket(user, d.docketNo);
      if (info.deliveredOn && body.iomDate < info.deliveredOn) throw unprocessable(`${d.docketNo}: delivered on ${info.deliveredOn}, after the IOM date`);
      if (!d.withoutImage && !d.images.length) throw badRequest(`${d.docketNo}: upload the POD image (or tick "without image")`);
      rows.push({ ...d, files: d.withoutImage ? [] : decodeImages(d.docketNo, d.images) });
    } catch (e) {
      if (e instanceof HttpError) problems.push(e.message); else throw e;
    }
  }
  if (problems.length) throw unprocessable('Some dockets cannot be dispatched', problems.map((message) => ({ path: 'dockets', message })));

  // Files first (named by the server), removed again if the database save fails.
  await fs.mkdir(config.podUploadDir, { recursive: true });
  const written = [];
  const safe = (x) => x.replace(/[^A-Za-z0-9_-]/g, '');
  for (const r of rows) {
    r.paths = [];
    for (const f of r.files) {
      const name = `${safe(r.docketNo)}-${crypto.randomUUID()}${f.ext}`;
      const full = path.join(config.podUploadDir, name);
      await fs.writeFile(full, f.buf, { flag: 'wx' });
      written.push(full);
      r.paths.push(`~/PODImage/${name}`);
    }
  }

  const S = sql();
  try {
    const iom = await withTransaction(async (tx) => {
      // Generate_Autocode("pod_dispatch", "P", "IOM_Number", "100000") — under a lock.
      const [m] = await query(
        `select max(cast(substring(IOM_number, 2, 20) as bigint)) as mx from pod_dispatch with (updlock, holdlock)
          where IOM_number like 'P%' and isnumeric(substring(IOM_number, 2, 20)) = 1`, {}, { tx });
      const no = `P${Math.max(n(m?.mx), 100000) + 1}`;
      for (const r of rows) {
        const tvp = new S.Table(config.tvp.podImage);
        tvp.columns.add('ImagePath', S.VarChar(300));
        for (const p of r.paths) tvp.rows.add(p);
        const res = await exec('usp_insert_Pod_Dispatch', {
          IOM_number: no,
          branch_code: body.sentTo,
          docket_no: r.docketNo,
          Iom_date: body.iomDate,
          reamrks: r.remarks,
          ImagePath: '', // images go to the image table (legacy did the same)
          From_Branch: branch,
          user_id: user.userId,
          division: user.divCode,
          Fin_year: user.financialYear,
          dtPod_Dispatch_image: { type: S.TVP, value: tvp },
        }, { retval: [S.VarChar(20), null] }, { tx });
        if (s(res.output.retval) === '0') throw conflict(`${r.docketNo}: POD already generated for this docket`);
      }
      // Update_POD_No — this branch's row of each docket
      const params = { iom: no, b: branch };
      const inList = nos.map((d, i) => { params[`d${i}`] = d; return `@d${i}`; }).join(',');
      await query(
        `update grn_docket_charge set pod_dispatch = 'POD_Dispatch_IsActive', IOM_num = @iom
          where Docket_No in (${inList}) and branch = @b and IOM_num is null`, params, { tx });
      return no;
    });
    return {
      iomNo: iom,
      dockets: rows.length,
      images: written.length,
      message: `POD dispatch ${iom} saved — ${rows.length} docket(s), ${written.length} image(s)`,
    };
  } catch (err) {
    await Promise.all(written.map((f) => fs.unlink(f).catch(() => {})));
    throw err;
  }
}

// ------------------------------------------------------------------ list / view / images

export async function listPods(user, { from, to, status = 'active', search = '', scope = 'all' }) {
  const { recordset } = await exec('usp_search_POD_Dispatch_Entry', {
    booking_date1: from,
    booking_date2: to,
    currbranch: user.currentBranch.code,
    IsCancelled: status === 'cancelled' ? 1 : 0,
    IOM_number: search || null,
    user_id: scope === 'all' ? 'admin' : user.userId, // legacy lists always passed "admin"
    Financial_Year: user.financialYear,
    division: user.divCode,
  });
  const byIom = new Map();
  for (const r of recordset) {
    const no = s(r.IOM_number);
    const cur = byIom.get(no) ?? { iomNo: no, iomDate: iso(r.Iom_date), sentTo: s(r.sent_to || r.branch_code), createdBy: s(r.user_id), dockets: [], images: 0 };
    cur.dockets.push(s(r.docket_no));
    cur.images += n(r.images);
    byIom.set(no, cur);
  }
  return [...byIom.values()];
}

export async function getPod(user, iomNo) {
  const rows = await query(
    `select p.*, b.branch_name as sent_to, g.consignee_name, g.booking_date
       from pod_dispatch p
       left join branch_master b on b.branch_code = p.branch_code
       left join grn_master g on g.docket_no = p.docket_no
      where p.IOM_number = @no and (p.From_Branch = @b or p.branch_code = @b)
      order by p.docket_no`, { no: iomNo, b: user.currentBranch.code });
  if (!rows.length) throw notFound(`POD dispatch ${iomNo} not found at this branch`);
  const images = await query('select id, docket_no, ImagePath from pod_dispatch_image where IOM_number = @no order by id', { no: iomNo });
  const courier = await query(
    'select top 1 Doc_No from POD_Dispatch_D where IOM_No = @no and isnull(IsCancelled, 0) = 0', { no: iomNo });
  const h = rows[0];
  return {
    iomNo,
    iomDate: iso(h.Iom_date),
    sentTo: s(h.sent_to || h.branch_code),
    fromBranch: s(h.From_Branch),
    createdBy: s(h.user_id),
    cancelled: rows.every((r) => !['0', 'false', ''].includes(s(r.IsCancelled).toLowerCase())),
    courierDocNo: s(courier[0]?.Doc_No),
    dockets: rows.map((r) => ({
      docketNo: s(r.docket_no),
      bookingDate: iso(r.booking_date),
      consignee: s(r.consignee_name),
      remarks: s(r.remarks),
      images: images.filter((i) => s(i.docket_no) === s(r.docket_no)).map((i) => ({
        id: n(i.id), name: path.basename(s(i.ImagePath)), type: s(i.ImagePath).toLowerCase().endsWith('.pdf') ? 'pdf' : 'image',
      })),
    })),
  };
}

/** Resolve an image id to a file inside the upload folder (the stored name is never trusted as a path). */
export async function imageFile(user, id) {
  const [r] = await query(
    `select i.ImagePath from pod_dispatch_image i
       join pod_dispatch p on p.IOM_number = i.IOM_number and p.docket_no = i.docket_no
      where i.id = @id and (p.From_Branch = @b or p.branch_code = @b or @admin = 1)`,
    { id, b: user.currentBranch.code, admin: user.role === 'admin' ? 1 : 0 });
  if (!r) throw notFound('Image not found');
  const name = path.basename(s(r.ImagePath).replace(/\\/g, '/'));
  const full = path.join(config.podUploadDir, name);
  try { await fs.access(full); } catch { throw notFound('Image file is missing on the server'); }
  return { full, name, type: name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'image/jpeg' };
}

// ------------------------------------------------------------------ cancel

export async function cancelPod(user, iomNo) {
  const p = await getPod(user, iomNo);
  if (p.cancelled) throw conflict('This POD dispatch is already cancelled');
  if (p.fromBranch !== user.currentBranch.code) throw conflict('Only the branch that dispatched the PODs can cancel them');
  if (p.courierDocNo) throw conflict(`Cannot be cancelled because the POD is dispatched by courier (${p.courierDocNo})`);
  const res = await exec('usp_POD_Dispatch_Cancel', {
    IOM_number: iomNo, user_id: user.userId, Financial_Year: user.financialYear,
  }, { success: [sql().VarChar(1000), null] });
  if (s(res.output.success).toLowerCase() !== 'success') throw unprocessable(s(res.output.success) || 'POD dispatch not cancelled');
  return { iomNo, message: 'POD dispatch cancelled' };
}
