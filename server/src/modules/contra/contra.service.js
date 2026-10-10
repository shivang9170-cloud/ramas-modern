// Contra Entry — port of Accounts/Contra_Entry.aspx: move money between the firm's own Cash / Bank ledgers.
// A voucher is a set of Dr lines and Cr lines over cash/bank ledgers; total Dr must equal total Cr (it is a transfer,
// nothing is earned or spent). Lines post to tblAccountTrasaction (Mode 'Contra Note', VoucherNo = Contra_No); the
// header (date, ref, cheque, narration) is tbl_contra (40-contra-entry.sql).
//
// Kept from the legacy page: only cash/bank ledgers can be picked; the selected ledger's current balance is shown; a
// Cr (money out) cannot exceed that ledger's balance (unless it is an OD / OCC account). Fixed vs the page: the contra
// number is generated inside the save transaction (the page generated it on load), and the voucher is re-checked to
// balance on the server.
import { query, withTransaction } from '../../db/index.js';
import { badRequest, conflict, HttpError, notFound } from '../../middleware/errors.js';
import { financialYearRange } from '../../utils/legacy.js';
import { finYr } from '../pickup/pickup.service.js';
import { s, n, iso, today, round2 } from '../../utils/values.js';
import { NOT_MAIN } from '../accounts/ledgerTree.js';

// Cash / bank ledgers (what a contra can touch). OD / OCC accounts may go negative.
const CASH_BANK = `(l.Ledger_Type in ('Cash', 'Bank') or g.GroupName like '%BANK%' or g.GroupName like '%CASH%')`;

/** Signed, Dr-positive balance of a ledger for the year: opening (by side) + posted Dr − posted Cr (uncancelled). */
async function ledgerBalance(user, code, tx) {
  const [r] = await query(
    `select (case when upper(l.DrCr) = 'CR' then -1 else 1 end) * isnull(l.OpeningBal, 0)
            + isnull((select sum(t.Dr) - sum(t.Cr) from tblAccountTrasaction t
                       where t.LedgerCode = l.LedgerCode and t.Financial_Year = @fy and (@div = '' or t.Division = @div)
                         and isnull(t.IsCancelled, 0) = 0), 0) as bal
       from tblAccountLedger l
      where l.LedgerCode = @code and l.Financial_Year = @fy and (@div = '' or l.Division = @div)`,
    { code, fy: user.financialYear, div: s(user.divCode) }, tx ? { tx } : undefined);
  return r ? round2(n(r.bal)) : null;
}

// ------------------------------------------------------------------ lookups

/** Cash / bank ledgers of the year with their current balance (GetDestination + Get_Ledger_Balance on the page). */
export async function ledgers(user, { q = '' } = {}) {
  const rows = await query(
    `select l.LedgerCode, l.LedgerName, l.Ledger_Type, g.GroupName,
            (case when upper(l.DrCr) = 'CR' then -1 else 1 end) * isnull(l.OpeningBal, 0)
            + isnull((select sum(t.Dr) - sum(t.Cr) from tblAccountTrasaction t
                       where t.LedgerCode = l.LedgerCode and t.Financial_Year = @fy and (@div = '' or t.Division = @div)
                         and isnull(t.IsCancelled, 0) = 0), 0) as bal
       from tblAccountLedger l left join tblAccountGroup g on g.GroupCode = l.GroupCode
      where l.Financial_Year = @fy and (@div = '' or l.Division = @div) and isnull(l.IsActive, 1) = 1 and ${CASH_BANK}
        and ${NOT_MAIN('l')} and (@q = '' or l.LedgerName like '%' + @q + '%')
      order by l.LedgerName`,
    { fy: user.financialYear, div: s(user.divCode), q });
  return rows.map((r) => ({
    value: s(r.LedgerCode), label: s(r.LedgerName), type: s(r.Ledger_Type), group: s(r.GroupName),
    balance: round2(n(r.bal)), od: /OD |OCC/i.test(s(r.GroupName)),
  }));
}

export async function ledgerBalanceOf(user, code) {
  const bal = await ledgerBalance(user, code);
  if (bal === null) throw notFound(`Ledger ${code} not found in this financial year`);
  return { code, balance: bal };
}

const contraPrefix = async (user) => {
  const [br] = await query('select short_code from branch_master where branch_code = @b', { b: user.currentBranch.code });
  return `CON${s(br?.short_code)}${finYr(user.financialYear)}`;
};

/** Next contra number (preview only; the real one is taken under a lock when saving). */
export async function nextNo(user) {
  const prefix = await contraPrefix(user);
  const [last] = await query(
    `select top 1 Contra_No from tbl_contra where Contra_No like @p + '%' and len(Contra_No) = len(@p) + 6 order by Contra_No desc`,
    { p: prefix });
  return { contraNo: `${prefix}${String((last ? Number(s(last.Contra_No).slice(-6)) : 0) + 1).padStart(6, '0')}` };
}

// ------------------------------------------------------------------ create

export async function createContra(user, body) {
  const fy = financialYearRange(user.financialYear);
  if (body.contraDate > today()) throw badRequest('Contra date should not be greater than current date');
  if (fy && (body.contraDate < fy.from || body.contraDate > fy.to)) throw badRequest('Invalid Financial Year Date');

  // normalise the lines (Dr side + Cr side)
  const lines = [
    ...body.debits.map((x) => ({ code: s(x.ledger), drcr: 'DR', amount: round2(n(x.amount)) })),
    ...body.credits.map((x) => ({ code: s(x.ledger), drcr: 'CR', amount: round2(n(x.amount)) })),
  ].filter((l) => l.code && l.amount > 0);
  if (lines.length < 2) throw badRequest('Add at least one debit and one credit ledger');
  if (new Set(lines.map((l) => l.code)).size !== lines.length) throw badRequest('A ledger is added more than once — each ledger only once');

  const totalDr = round2(lines.filter((l) => l.drcr === 'DR').reduce((a, l) => a + l.amount, 0));
  const totalCr = round2(lines.filter((l) => l.drcr === 'CR').reduce((a, l) => a + l.amount, 0));
  if (!totalDr || !totalCr) throw badRequest('Enter both a debit and a credit side');
  if (totalDr !== totalCr) throw badRequest(`Debit total (${totalDr}) must equal credit total (${totalCr})`);

  // every line must be a cash/bank ledger; a credit cannot exceed the ledger's balance (unless OD/OCC)
  const pick = new Map((await ledgers(user)).map((l) => [l.value, l]));
  const problems = [];
  for (const l of lines) {
    const info = pick.get(l.code);
    if (!info) { problems.push(`${l.code}: not a cash / bank ledger of this year`); continue; }
    if (l.drcr === 'CR' && !info.od) {
      if (info.balance <= 0) problems.push(`${info.label}: balance is ${info.balance} — nothing to transfer out`);
      else if (l.amount > info.balance + 0.005) problems.push(`${info.label}: only ${info.balance} available, cannot credit ${l.amount}`);
    }
  }
  if (problems.length) throw new HttpError(422, 'Some lines cannot be saved', problems.map((message) => ({ path: 'lines', message })));

  const names = new Map([...pick].map(([code, l]) => [code, l.label]));
  const narration = s(body.narration)
    || `Contra: Dr ${lines.filter((l) => l.drcr === 'DR').map((l) => names.get(l.code)).join(', ')}`
       + ` / Cr ${lines.filter((l) => l.drcr === 'CR').map((l) => names.get(l.code)).join(', ')} — ${totalDr}`;

  return withTransaction(async (tx) => {
    const prefix = await contraPrefix(user);
    const [last] = await query(
      `select top 1 Contra_No from tbl_contra with (updlock, holdlock) where Contra_No like @p + '%' and len(Contra_No) = len(@p) + 6 order by Contra_No desc`,
      { p: prefix }, { tx });
    const contraNo = `${prefix}${String((last ? Number(s(last.Contra_No).slice(-6)) : 0) + 1).padStart(6, '0')}`;

    // re-check credit balances inside the transaction (someone may have moved money since)
    for (const l of lines.filter((x) => x.drcr === 'CR')) {
      const info = pick.get(l.code);
      if (info.od) continue;
      const bal = await ledgerBalance(user, l.code, tx);
      if (l.amount > round2(bal) + 0.005) throw conflict(`${info.label} balance changed — only ${round2(bal)} available now`);
    }

    await query(
      `insert into tbl_contra(Contra_No, Contra_Date, Ref_No, ChequeNo, Narration, Branch, Financial_Year, Division, User_id)
       values (@no, @d, @ref, @chq, @nar, @b, @fy, @div, @u)`,
      { no: contraNo, d: body.contraDate, ref: s(body.refNo), chq: s(body.chequeNo), nar: narration,
        b: user.currentBranch.code, fy: user.financialYear, div: s(user.divCode), u: user.userId }, { tx });

    for (const l of lines) {
      await query(
        `insert into tblAccountTrasaction(LedgerCode, Dr, Cr, CreatedDate, VoucherNo, Mode, Entry, Financial_Year, Division)
         values (@l, @dr, @cr, @d, @no, 'Contra Note', 'Ledger', @fy, @div)`,
        { l: l.code, dr: l.drcr === 'DR' ? l.amount : 0, cr: l.drcr === 'CR' ? l.amount : 0, d: body.contraDate, no: contraNo,
          fy: user.financialYear, div: s(user.divCode) }, { tx });
    }
    return { contraNo, amount: totalDr, message: `Record Successfully Saved! Contra No : ${contraNo}` };
  });
}

// ------------------------------------------------------------------ list / view / cancel

export async function listContra(user, { from, to, status = 'active', search = '' }) {
  const rows = await query(
    `select c.Contra_No, c.Contra_Date, c.Ref_No, c.ChequeNo, c.Narration, c.User_id, c.IsCancelled,
            isnull((select sum(t.Dr) from tblAccountTrasaction t where t.VoucherNo = c.Contra_No and t.Mode = 'Contra Note' and isnull(t.IsCancelled,0) = c.IsCancelled), 0) as amount,
            (select count(*) from tblAccountTrasaction t where t.VoucherNo = c.Contra_No and t.Mode = 'Contra Note') as lines
       from tbl_contra c
      where c.Branch = @b and (@div = '' or c.Division = @div) and c.Financial_Year = @fy and c.Contra_Date between @from and @to
        and c.IsCancelled = @c and (@q = '' or c.Contra_No like '%' + @q + '%' or c.Narration like '%' + @q + '%' or c.Ref_No like '%' + @q + '%')
      order by c.Contra_No desc`,
    { b: user.currentBranch.code, div: s(user.divCode), fy: user.financialYear, from, to, c: status === 'cancelled' ? 1 : 0, q: search });
  return rows.map((r) => ({
    contraNo: s(r.Contra_No), contraDate: iso(r.Contra_Date), refNo: s(r.Ref_No), chequeNo: s(r.ChequeNo),
    narration: s(r.Narration), amount: round2(n(r.amount)), lines: n(r.lines), createdBy: s(r.User_id), cancelled: Boolean(r.IsCancelled),
  }));
}

export async function getContra(user, contraNo) {
  const [c] = await query(
    'select * from tbl_contra where Contra_No = @no and Branch = @b', { no: contraNo, b: user.currentBranch.code });
  if (!c) throw notFound(`Contra ${contraNo} not found at this branch`);
  const voucher = await query(
    `select l.LedgerName, l.LedgerCode, t.Dr, t.Cr from tblAccountTrasaction t join tblAccountLedger l on l.LedgerCode = t.LedgerCode
      where t.VoucherNo = @no and t.Mode = 'Contra Note' and isnull(t.IsCancelled, 0) = @c order by t.Dr desc, t.SlNo`,
    { no: contraNo, c: c.IsCancelled ? 1 : 0 });
  return {
    contraNo: s(c.Contra_No), contraDate: iso(c.Contra_Date), refNo: s(c.Ref_No), chequeNo: s(c.ChequeNo),
    narration: s(c.Narration), createdBy: s(c.User_id), cancelled: Boolean(c.IsCancelled),
    cancelledBy: s(c.Cancelled_By), cancelRemarks: s(c.Cancel_Remarks),
    debits: voucher.filter((v) => n(v.Dr) > 0).map((v) => ({ code: s(v.LedgerCode), ledger: s(v.LedgerName), amount: n(v.Dr) })),
    credits: voucher.filter((v) => n(v.Cr) > 0).map((v) => ({ code: s(v.LedgerCode), ledger: s(v.LedgerName), amount: n(v.Cr) })),
    amount: round2(voucher.reduce((a, v) => a + n(v.Dr), 0)),
  };
}

export async function cancelContra(user, contraNo, remarks) {
  const c = await getContra(user, contraNo);
  if (c.cancelled) throw conflict('This contra is already cancelled');
  await withTransaction(async (tx) => {
    await query('update tbl_contra set IsCancelled = 1, Cancelled_By = @u, Cancelled_Date = getdate(), Cancel_Remarks = @rem where Contra_No = @no',
      { u: user.userId, rem: s(remarks), no: contraNo }, { tx });
    await query("update tblAccountTrasaction set IsCancelled = 1 where VoucherNo = @no and Mode = 'Contra Note'", { no: contraNo }, { tx });
  });
  return { contraNo, message: 'Contra cancelled' };
}
