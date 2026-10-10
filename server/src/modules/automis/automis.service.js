// MIS auto mail settings — port of Setting/MIS_Report_Auto.aspx (MIS_Report_Auto_dal).
//
// Clients get a daily MIS mail: the dockets booked for them over the last N days with their delivery status, in the
// columns picked per client, with a header and footer. The page keeps the switch, the two mail times, the effective
// date and the number of back days (AutoMis_setting), the client e-mail addresses with their columns (Client_email)
// and the header / footer (Auto_MIS_Header_footer).
//
// Changes from the page (docs/MIGRATION.md "Settings"):
//   * the settings, e-mails and header / footer are kept and a preview shows exactly what a client's mail would list;
//   * the mail itself is not sent yet: the page ran a timer inside the web server and sent through a Yahoo SMTP account
//     whose password was written in the code (cleared in the last version, so nothing was being sent); sending needs an
//     SMTP account in the server settings — see docs/MIGRATION.md;
//   * the same client + e-mail is not added twice; SQL is parameterised (it was concatenated).
import { query, withTransaction } from '../../db/index.js';
import { badRequest, conflict, notFound } from '../../middleware/errors.js';
import { s, n, iso } from '../../utils/values.js';

export async function settings() {
  const [r] = await query('select top 1 * from AutoMis_setting');
  return {
    active: Boolean(r?.isActive), mailTime1: s(r?.MailTime1) || '08:30', mailTime2: s(r?.MailTime2), effectiveDate: iso(r?.ActiveDeactive_date),
    backDays: r ? n(r.FromBackDays) : 7, sending: 'not configured',
  };
}

/** img_btn_Click: delete from AutoMis_setting; insert … */
export async function saveSettings(user, body) {
  await withTransaction(async (tx) => {
    await query('delete from AutoMis_setting', {}, { tx });
    await query(
      `insert into AutoMis_setting(isActive, MailTime1, MailTime2, ActiveDeactive_date, FromBackDays, modified_by, modified_date)
       values (@a, @t1, @t2, @d, @bd, @u, getdate())`,
      { a: body.active ? 1 : 0, t1: body.mailTime1, t2: body.mailTime2 || null, d: body.effectiveDate || null, bd: body.backDays, u: user.userId }, { tx });
  });
  return { ...(await settings()), message: 'MIS settings saved' };
}

export async function columns() {
  const rows = await query('select index_id, column_Name, field from Auto_MIS_Column_Master where isActive = 1 order by index_id');
  return rows.map((r, i) => ({ value: Number(r.index_id), label: s(r.column_Name), field: s(r.field), fixed: i < 2 }));
}

export async function clients() {
  const rows = await query('select client_code, company_name from client_Master where isnull(is_Active, 1) = 1 order by company_name');
  return rows.map((r) => ({ value: s(r.client_code), label: `${s(r.company_name)} : ${s(r.client_code)}` }));
}

export async function emails() {
  const cols = new Map((await columns()).map((c) => [c.value, c.label]));
  const rows = await query(
    `select ce.id, ce.client_code, cm.company_name, ce.email, ce.selectd_column from Client_email ce
       join client_Master cm on cm.client_code = ce.client_code where ce.isCancel = 0 order by cm.company_name, ce.email`);
  return rows.map((r) => {
    const ids = s(r.selectd_column).split(',').map(Number).filter((x) => cols.has(x));
    return { id: Number(r.id), client: s(r.client_code), clientName: s(r.company_name), email: s(r.email), columns: ids, columnNames: ids.map((x) => cols.get(x)) };
  });
}

/** btnAdd_Click + img_btn_Click (insClient_email): each client × each address. */
export async function addEmails(user, body) {
  const cols = await columns();
  const valid = new Set(cols.map((c) => c.value));
  const fixed = cols.filter((c) => c.fixed).map((c) => c.value);
  const known = new Set((await clients()).map((c) => c.value));
  return withTransaction(async (tx) => {
    let added = 0;
    for (const c of body.clients) {
      if (!known.has(c.client)) throw badRequest(`Unknown client ${c.client}`);
      const picked = [...new Set([...fixed, ...c.columns.filter((x) => valid.has(x))])].sort((a, b) => a - b);
      for (const email of body.emails) {
        const [dup] = await query('select top 1 id from Client_email with (updlock, holdlock) where client_code = @c and email = @e and isCancel = 0',
          { c: c.client, e: email }, { tx });
        if (dup) throw conflict(`${email} is already set for ${c.client}`);
        await query('insert into Client_email(client_code, email, selectd_column, created_by) values (@c, @e, @cols, @u)',
          { c: c.client, e: email, cols: picked.join(','), u: user.userId }, { tx });
        added += 1;
      }
    }
    return { added, message: `${added} e-mail setting(s) saved` };
  });
}

export async function removeEmail(id) {
  const [r] = await query('select id from Client_email where id = @id and isCancel = 0', { id });
  if (!r) throw notFound('E-mail setting not found');
  await query('update Client_email set isCancel = 1 where id = @id', { id });
  return { id, message: 'Removed' };
}

export async function headerFooters() {
  const rows = await query('select id, Header, footer, created_by, created_date from Auto_MIS_Header_footer order by id desc');
  return rows.map((r) => ({ id: Number(r.id), header: s(r.Header), footer: s(r.footer), createdBy: s(r.created_by), createdDate: iso(r.created_date) }));
}

/** btnSaveHeaderFooter_Click (insAuto_MIS_Header_footer): the latest one is used. */
export async function addHeaderFooter(user, body) {
  await query('insert into Auto_MIS_Header_footer(Header, footer, created_by) values (@h, @f, @u)', { h: body.header, f: body.footer, u: user.userId });
  return { message: 'Header / footer saved' };
}

/** getEmailData (sp_getDataForAuto_MIS): the client's dockets of the last `backDays` days with the delivery status. */
export async function preview(client, backDays = null) {
  const set = await settings();
  const days = backDays ?? set.backDays;
  const [c] = await query('select client_code, company_name from client_Master where client_code = @c', { c: client });
  if (!c) throw notFound('Client not found');
  const rows = await query(
    `select g.docket_no, g.booking_date, ob.branch_name as origin, g.destination, g.consigner_name, g.consignee_name,
            ch.pcs, ch.charge_weight, dl.rcv_date
       from grn_master g
       left join grn_docket_charge ch on ch.Docket_No = g.docket_no
       left join branch_master ob on ob.branch_code = g.origin_branch
       outer apply (select top 1 d.rcv_date from delivery_status_entry_details d
                     where d.docket_no = g.docket_no and d.pkt_status = 'DLVRD' and isnull(d.IsCancelled, 0) = 0 order by d.id desc) dl
      where isnull(g.IsCancel, 0) = 0 and replace(g.on_account_of, ' ', '') like '%:' + @c
        and g.booking_date >= dateadd(day, -@days, cast(getdate() as date))
      order by g.booking_date, g.docket_no`, { c: client, days });
  // the columns saved for this client's first e-mail (all columns when none is saved)
  const [saved] = await query('select top 1 selectd_column from Client_email where client_code = @c and isCancel = 0 order by id', { c: client });
  const picked = saved ? s(saved.selectd_column).split(',').map(Number) : null;
  const cols = (await columns()).filter((x) => !picked || picked.includes(x.value));
  return {
    client, clientName: s(c.company_name), backDays: days, columns: cols.map((x) => ({ key: x.field, title: x.label })),
    rows: rows.map((r) => ({
      docketNo: s(r.docket_no), bookingDate: iso(r.booking_date), origin: s(r.origin), destination: s(r.destination),
      consignor: s(r.consigner_name), consignee: s(r.consignee_name), packages: n(r.pcs), weight: n(r.charge_weight),
      status: r.rcv_date ? 'Delivered' : 'In transit', statusDate: iso(r.rcv_date),
    })),
  };
}
