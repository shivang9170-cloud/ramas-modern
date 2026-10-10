// Accounts integration tests against the local DEV database: Account Master (groups with type, ledgers, sub-ledgers),
// Contra, Payment (expense / advance / vendor against bills), Books & Reports (day book, ledger statement, trial balance,
// P&L, balance sheet, expenses, overview). Skipped when DB_NAME is not a *_dev database.
//
// Test data is named "ZTA …" (ledgers, group, vendor bill ZTAVINV1, narrations) and every voucher made here is removed
// in after(), so the suite can be re-run and leaves the books as they were.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { assertConfig, config } from '../src/config.js';
import { closeDb, initDb, query } from '../src/db/index.js';
import { createApp } from '../src/app.js';

const enabled = Boolean(config.db?.database?.endsWith('_dev'));
const today = new Date().toISOString().slice(0, 10);
const y = Number(today.slice(0, 4)) - (today.slice(5, 7) < '04' ? 1 : 0);
const FY = `${y}-${y + 1}`;
const r2 = (v) => Math.round(Number(v) * 100) / 100;

let app; let tok;
const at = () => ({ Authorization: `Bearer ${tok}` });
const get = (url, q) => request(app).get(url).set(at()).query(q ?? {});
const post = (url, body) => request(app).post(url).set(at()).send(body ?? {});
const put = (url, body) => request(app).put(url).set(at()).send(body ?? {});

const made = { payments: [], contras: [] };   // vouchers to remove in after()
const ids = {};                                // ledger / group codes made by the suite

async function voucher(no, mode) {
  return (await query(
    `select l.LedgerName, t.Dr, t.Cr from tblAccountTrasaction t join tblAccountLedger l on l.LedgerCode = t.LedgerCode
      where t.VoucherNo = @no and t.Mode = @m and isnull(t.IsCancelled, 0) = 0 order by t.Dr desc, l.LedgerName`, { no, m: mode }))
    .map((r) => [r.LedgerName, Number(r.Dr), Number(r.Cr)]);
}
const balanced = (lines) => r2(lines.reduce((a, l) => a + l[1], 0)) === r2(lines.reduce((a, l) => a + l[2], 0));

async function cleanup() {
  const zta = "select LedgerCode from tblAccountLedger where LedgerName like 'ZTA %'";
  await query(`
    declare @p table (no varchar(50));
    insert into @p select Payment_No from tbl_payment where Narration like 'ZTA%' or PayTo_Ledger in (${zta}) or PayFrom_Ledger in (${zta})
      or Payment_No in (select Payment_No from tbl_payment_detail where LedgerCode in (${zta}));
    delete from tblAccountTrasaction where Mode = 'Payment Note' and VoucherNo in (select no from @p);
    delete from tbl_payment_detail where Payment_No in (select no from @p);
    delete from tbl_payment where Payment_No in (select no from @p);
    declare @c table (no varchar(50));
    insert into @c select Contra_No from tbl_contra where Narration like 'ZTA%';
    delete from tblAccountTrasaction where Mode = 'Contra Note' and VoucherNo in (select no from @c);
    delete from tbl_contra where Contra_No in (select no from @c);
    delete from tblAccountTrasaction where VoucherNo like 'ZTA%' or LedgerCode in (${zta});
    delete from tblLedgerHierarchy where LedgerCode in (${zta}) or ParentLedgerCode in (${zta});
    delete from tblAccountLedger where LedgerName like 'ZTA %';
    delete from tblAccountGroupInfo where GroupCode in (select GroupCode from tblAccountGroup where GroupName like 'ZTA %');
    delete from tblAccountGroup where GroupName like 'ZTA %';`);
  // vouchers made by the suite that touch no ZTA ledger (e.g. an advance) are removed by number
  for (const no of made.payments) {
    await query(`delete from tblAccountTrasaction where Mode = 'Payment Note' and VoucherNo = @no;
                 delete from tbl_payment_detail where Payment_No = @no; delete from tbl_payment where Payment_No = @no`, { no });
  }
  for (const no of made.contras) {
    await query("delete from tblAccountTrasaction where Mode = 'Contra Note' and VoucherNo = @no; delete from tbl_contra where Contra_No = @no", { no });
  }
}

describe('Accounts (dev database)', { skip: !enabled && 'DB_NAME is not a *_dev database' }, () => {
  let cash; let bank; let creditors; let freightIncome;

  before(async () => {
    assertConfig();
    await initDb();
    config.rateLimit.off = true;   // many requests from one address (rate limits: security.test.js)
    app = createApp();
    await cleanup();
    const res = await request(app).post('/api/auth/login')
      .send({ loginType: 'employee', username: 'EMP001', password: 'emp123', divCode: 'DIV1001', financialYear: FY });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    tok = res.body.token;
    const from = (await get('/api/payments/pay-from')).body;
    cash = from.find((a) => a.label === 'CASH HEAD OFFICE');
    bank = from.find((a) => a.label === 'HDFC BANK CURRENT A/C');
    assert.ok(cash && bank, 'CASH HEAD OFFICE and HDFC BANK CURRENT A/C ledgers are needed');
    if (cash.balance < 2000) {   // give the test cash something to spend (removed again in after())
      await query(`insert into tblAccountTrasaction(LedgerCode, Dr, Cr, CreatedDate, VoucherNo, Mode, Entry, Financial_Year, Division)
                   values (@c, 5000, 0, @d, 'ZTAFUND', 'Journal', 'Ledger', @fy, 'DIV1001')`, { c: cash.value, d: today, fy: FY });
      cash.balance += 5000;
    }
    [creditors] = await query("select GroupCode from tblAccountGroup where upper(GroupName) = 'SUNDRY CREDITORS'");
    [freightIncome] = await query("select LedgerCode from tblAccountLedger where LedgerName = 'FREIGHT INCOME' and Financial_Year = @fy and Division = 'DIV1001'", { fy: FY });
  });

  after(async () => {
    try { await cleanup(); } finally { await closeDb(); }
  });

  // ------------------------------------------------------------------ security
  test('every accounts API needs a login', async () => {
    for (const url of ['/api/books/overview', '/api/books/day-book', '/api/payments/open-bills?ledger=X', '/api/account-ledgers/groups']) {
      assert.equal((await request(app).get(url)).status, 401, url);
    }
  });

  // ------------------------------------------------------------------ groups
  test('account group: type is required, saved, shown with its nature and can be changed', async () => {
    assert.equal((await post('/api/account-ledgers/groups', { name: 'ZTA OFFICE COSTS' })).status, 400);
    assert.equal((await post('/api/account-ledgers/groups', { name: 'ZTA OFFICE COSTS', section: 'NOPE' })).status, 400);
    const ok = await post('/api/account-ledgers/groups', { name: 'zta office costs', section: 'DIRECT_EXP' });
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    ids.group = ok.body.code;
    assert.equal((await post('/api/account-ledgers/groups', { name: 'ZTA OFFICE COSTS', section: 'DIRECT_EXP' })).status, 409);
    const changed = await put(`/api/account-ledgers/groups/${ids.group}/section`, { section: 'INDIRECT_EXP' });
    assert.equal(changed.status, 200, JSON.stringify(changed.body));
    const g = (await get('/api/account-ledgers/groups')).body.find((x) => x.code === ids.group);
    assert.deepEqual([g.name, g.section, g.sectionLabel, g.nature], ['ZTA OFFICE COSTS', 'INDIRECT_EXP', 'Indirect Expenses', 'Expense']);
    assert.equal((await put('/api/account-ledgers/groups/G999999/section', { section: 'CASH' })).status, 404);
    const opts = (await get('/api/account-ledgers/options')).body;
    assert.equal(opts.sections.length, 16);
    assert.ok(opts.groups.some((x) => x.value === ids.group && x.sectionLabel === 'Indirect Expenses'));
  });

  test('chart of accounts: no duplicate / untyped groups left by migration 45', async () => {
    const groups = (await get('/api/account-ledgers/groups')).body;
    assert.deepEqual(groups.filter((x) => !x.section).map((x) => x.name), []);
    const names = groups.map((x) => x.name.toUpperCase());
    for (const dup of ['DIRECT EXPENSE', 'CASH IN HAND', 'HIMANSHU']) assert.ok(!names.includes(dup), `${dup} should be merged`);
    assert.ok(freightIncome, 'FREIGHT INCOME ledger exists for the year');
  });

  // ------------------------------------------------------------------ ledgers + sub-ledgers
  test('main ledger with sub-ledgers: "+ Sub-Ledger", roll-up, main not postable', async () => {
    const main = await post('/api/account-ledgers', { name: 'ZTA OFFICE', groupCode: ids.group, ledgerType: 'Expense', openingBal: 0, drCr: 'DR', active: true });
    assert.equal(main.status, 201, JSON.stringify(main.body));
    ids.main = main.body.code;
    for (const name of ['ZTA TEA', 'ZTA PAPER']) {
      const sub = await post(`/api/account-ledgers/${ids.main}/sub-ledgers`, { name });
      assert.equal(sub.status, 201, JSON.stringify(sub.body));
      ids[name] = sub.body.code;
    }
    assert.equal((await post(`/api/account-ledgers/${ids.main}/sub-ledgers`, { name: 'ZTA TEA' })).status, 409);
    const list = (await get('/api/account-ledgers', { q: 'ZTA' })).body;
    const m = list.find((x) => x.code === ids.main);
    assert.deepEqual([m.isMain, m.subCount], [true, 2]);
    const tea = list.find((x) => x.code === ids['ZTA TEA']);
    assert.deepEqual([tea.parentCode, tea.groupCode], [ids.main, ids.group]);   // the sub-ledger takes the main's group
    // a sub-ledger cannot itself get sub-ledgers (one level)
    assert.equal((await post(`/api/account-ledgers/${ids['ZTA TEA']}/sub-ledgers`, { name: 'ZTA DEEP' })).status, 400);
    // payment screen offers the main with its subs
    const opt = (await get('/api/payments/options')).body;
    const pm = opt.mains.find((x) => x.value === ids.main);
    assert.deepEqual(pm.subs.map((x) => x.label).sort(), ['ZTA PAPER', 'ZTA TEA']);
    // a main ledger cannot be deleted while it has subs
    assert.equal((await request(app).delete(`/api/account-ledgers/${ids.main}`).set(at())).status, 409);

    // vendor with a credit opening balance (an "opening" bill) and one purchase bill ZTAVINV1 (Cr vendor 3000 / Dr ZTA PAPER)
    const v = await post('/api/account-ledgers', { name: 'ZTA VENDOR', groupCode: creditors.GroupCode, ledgerType: 'Liability', openingBal: 5000, drCr: 'CR', active: true });
    assert.equal(v.status, 201, JSON.stringify(v.body));
    ids.vendor = v.body.code;
    await query(`insert into tblAccountTrasaction(LedgerCode, Dr, Cr, CreatedDate, VoucherNo, Mode, Entry, Financial_Year, Division)
                 values (@v, 0, 3000, @d, 'ZTAVINV1', 'PURCHASE/PAYBILL', 'Ledger', @fy, 'DIV1001'),
                        (@p, 3000, 0, @d, 'ZTAVINV1', 'PURCHASE/PAYBILL', 'Ledger', @fy, 'DIV1001')`,
    { v: ids.vendor, p: ids['ZTA PAPER'], d: today, fy: FY });
  });

  // ------------------------------------------------------------------ contra
  test('contra: cash -> bank balanced, refusals, cancel', async () => {
    const body = (amount, extra = {}) => ({ contraDate: today, narration: 'ZTA contra', debits: [{ ledger: bank.value, amount }], credits: [{ ledger: cash.value, amount }], ...extra });
    const ok = await post('/api/contra-entries', body(100));
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    made.contras.push(ok.body.contraNo);
    assert.deepEqual(await voucher(ok.body.contraNo, 'Contra Note'), [['HDFC BANK CURRENT A/C', 100, 0], ['CASH HEAD OFFICE', 0, 100]]);
    assert.equal((await post('/api/contra-entries', body(100, { credits: [{ ledger: cash.value, amount: 90 }] }))).status, 400);   // Dr ≠ Cr
    assert.equal((await post('/api/contra-entries', body(100, { debits: [{ ledger: cash.value, amount: 100 }] }))).status, 400);  // same ledger twice
    assert.equal((await post('/api/contra-entries', body(99999999))).status, 422);                                                 // more than cash holds
    assert.equal((await post('/api/contra-entries', body(100, { debits: [{ ledger: ids['ZTA TEA'], amount: 100 }] }))).status, 422); // not cash / bank
    assert.equal((await post('/api/contra-entries', body(100, { contraDate: '2999-01-01' }))).status, 400);
    const c = await post(`/api/contra-entries/${ok.body.contraNo}/cancel`, { remarks: 'ZTA' });
    assert.equal(c.status, 200, JSON.stringify(c.body));
    assert.deepEqual(await voucher(ok.body.contraNo, 'Contra Note'), []);
    assert.equal((await post(`/api/contra-entries/${ok.body.contraNo}/cancel`, {})).status, 409);
  });

  // ------------------------------------------------------------------ payments
  test('expense payment: main -> sub-ledger, voucher Dr sub / Cr cash, and every refusal', async () => {
    const pay = (extra) => post('/api/payments', { kind: 'EXPENSE', paymentDate: today, payFrom: cash.value, amount: 150, mainLedger: ids.main, subLedger: ids['ZTA TEA'], ...extra });
    const ok = await pay({ narration: 'ZTA tea for office' });
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    made.payments.push(ok.body.paymentNo);
    assert.deepEqual(await voucher(ok.body.paymentNo, 'Payment Note'), [['ZTA TEA', 150, 0], ['CASH HEAD OFFICE', 0, 150]]);
    const view = (await get(`/api/payments/${ok.body.paymentNo}`)).body;
    assert.deepEqual([view.kind, view.mainLedger, view.payTo, view.payFrom, view.amount], ['EXPENSE', 'ZTA OFFICE', 'ZTA TEA', 'CASH HEAD OFFICE', 150]);

    assert.equal((await pay({ subLedger: ids.vendor })).status, 400);                 // not a sub-ledger of this main
    assert.equal((await pay({ amount: 0 })).status, 400);
    assert.equal((await pay({ amount: -5 })).status, 400);
    assert.equal((await pay({ paymentDate: '2999-01-01' })).status, 400);             // future date
    assert.equal((await pay({ paymentDate: `${y - 1}-06-01` })).status, 400);         // outside the year
    assert.equal((await pay({ amount: 99999999 })).status, 422);                      // more than the cash holds
    assert.equal((await pay({ payFrom: ids['ZTA TEA'] })).status, 400);               // pay from must be cash / bank
    // a main ledger takes no entries
    const main = await post('/api/payments', { kind: 'GENERAL', paymentDate: today, payFrom: cash.value, amount: 10, payTo: ids.main });
    assert.equal(main.status, 409, JSON.stringify(main.body));
    // cash / bank to cash / bank is a contra, not a payment
    assert.equal((await post('/api/payments', { kind: 'GENERAL', paymentDate: today, payFrom: cash.value, amount: 10, payTo: bank.value })).status, 400);
  });

  test('advance: given, adjusted by journal (no cash), over-adjust refused, register', async () => {
    const before = (await get('/api/payments/advances')).body.find((x) => x.key === 'EMPLOYEE:EMP003') ?? { given: 0, adjusted: 0 };
    const adv = await post('/api/payments', { kind: 'ADVANCE', paymentDate: today, payFrom: cash.value, amount: 300, person: { type: 'EMPLOYEE', id: 'EMP003' }, narration: 'ZTA advance' });
    assert.equal(adv.status, 201, JSON.stringify(adv.body));
    made.payments.push(adv.body.paymentNo);
    const lines = await voucher(adv.body.paymentNo, 'Payment Note');
    assert.ok(lines[0][0].startsWith('ADVANCE : SURESH') && lines[0][1] === 300 && lines[1][0] === 'CASH HEAD OFFICE', JSON.stringify(lines));

    const adj = await post('/api/payments/adjust-advance', { paymentDate: today, amount: 100, person: { type: 'EMPLOYEE', id: 'EMP003' }, mainLedger: ids.main, subLedger: ids['ZTA TEA'], narration: 'ZTA adjust' });
    assert.equal(adj.status, 201, JSON.stringify(adj.body));
    made.payments.push(adj.body.paymentNo);
    const j = await voucher(adj.body.paymentNo, 'Payment Note');
    assert.deepEqual([j[0][0], j[0][1], j[1][2]], ['ZTA TEA', 100, 100]);
    assert.ok(j[1][0].startsWith('ADVANCE : SURESH') && !j.some((l) => l[0] === 'CASH HEAD OFFICE'), 'journal: no cash line');

    const people = (await get('/api/payments/options')).body.people;
    const bal = people.find((p) => p.key === 'EMPLOYEE:EMP003').advance;
    assert.equal((await post('/api/payments/adjust-advance', { paymentDate: today, amount: bal + 1, person: { type: 'EMPLOYEE', id: 'EMP003' }, mainLedger: ids.main, subLedger: ids['ZTA TEA'] })).status, 422);
    assert.equal((await post('/api/payments', { kind: 'ADVANCE', paymentDate: today, payFrom: cash.value, amount: 10, person: { type: 'EMPLOYEE', id: 'NOBODY' } })).status, 400);
    const reg = (await get('/api/payments/advances')).body.find((x) => x.key === 'EMPLOYEE:EMP003');
    assert.deepEqual([r2(reg.given - before.given), r2(reg.adjusted - before.adjusted)], [300, 100]);
  });

  test('vendor payment against bills: open bills, part / full settlement, refusals, on account, cancel reopens', async () => {
    const open = async () => (await get('/api/payments/open-bills', { ledger: ids.vendor })).body;
    const o1 = await open();
    assert.equal(o1.billWise, true);
    assert.deepEqual(o1.bills.map((b) => [b.billType, b.billNo, b.due]), [['OPENING', 'OPENING', 5000], ['VINV', 'ZTAVINV1', 3000]]);
    assert.deepEqual([o1.totalDue, o1.ledger.owed, o1.onAccount], [8000, 8000, 0]);
    const grid = (await get('/api/payments/payables', { q: 'ZTA VENDOR' })).body.find((x) => x.code === ids.vendor);
    assert.equal(grid.owed, 8000);

    const pay = (amount, bills, extra) => post('/api/payments', { kind: 'GENERAL', paymentDate: today, payFrom: cash.value, amount, payTo: ids.vendor, bills, ...extra });
    // refusals
    assert.equal((await pay(100, [{ billType: 'VINV', billNo: 'ZTAVINV1', amount: 3001 }])).status, 422);                 // more than due
    assert.equal((await pay(100, [{ billType: 'VINV', billNo: 'ZTAVINV1', amount: 200 }])).status, 400);                  // bills > amount
    assert.equal((await pay(100, [{ billType: 'VINV', billNo: 'NOPE', amount: 50 }])).status, 422);                        // not his bill
    assert.equal((await pay(100, [{ billType: 'VINV', billNo: 'ZTAVINV1', amount: 50 }, { billType: 'VINV', billNo: 'ZTAVINV1', amount: 50 }])).status, 400); // twice

    // 1200 = opening 1000 (part) + ZTAVINV1 200 (part)
    const p1 = await pay(1200, [{ billType: 'OPENING', billNo: 'OPENING', amount: 1000 }, { billType: 'VINV', billNo: 'ZTAVINV1', amount: 200 }]);
    assert.equal(p1.status, 201, JSON.stringify(p1.body));
    made.payments.push(p1.body.paymentNo);
    assert.deepEqual(await voucher(p1.body.paymentNo, 'Payment Note'), [['ZTA VENDOR', 1200, 0], ['CASH HEAD OFFICE', 0, 1200]]);   // one Dr line
    const v1 = (await get(`/api/payments/${p1.body.paymentNo}`)).body;
    assert.deepEqual(v1.bills.map((b) => [b.billNo, b.amount]), [['OPENING', 1000], ['ZTAVINV1', 200]]);
    assert.match(v1.narration, /against opening balance, ZTAVINV1/);
    const o2 = await open();
    assert.deepEqual(o2.bills.map((b) => [b.billNo, b.paid, b.due]), [['OPENING', 1000, 4000], ['ZTAVINV1', 200, 2800]]);

    // 3000 = ZTAVINV1 in full (2800) + 200 on account
    const p2 = await pay(3000, [{ billType: 'VINV', billNo: 'ZTAVINV1', amount: 2800 }]);
    assert.equal(p2.status, 201, JSON.stringify(p2.body));
    made.payments.push(p2.body.paymentNo);
    const o3 = await open();
    assert.deepEqual(o3.bills.map((b) => b.billNo), ['OPENING']);
    assert.deepEqual([o3.onAccount, o3.ledger.owed], [200, 3800]);
    assert.equal((await pay(10, [{ billType: 'VINV', billNo: 'ZTAVINV1', amount: 10 }])).status, 422);   // already settled

    // a payment with no bills is all on account
    const p3 = await pay(50, [], { narration: 'ZTA on account' });
    assert.equal(p3.status, 201, JSON.stringify(p3.body));
    made.payments.push(p3.body.paymentNo);
    assert.equal((await open()).onAccount, 250);

    // cancel the first payment: both bills it settled open again (opening 1000 back, ZTAVINV1 200 back)
    assert.equal((await post(`/api/payments/${p1.body.paymentNo}/cancel`, { remarks: 'ZTA' })).status, 200);
    const o4 = await open();
    assert.deepEqual(o4.bills.map((b) => [b.billNo, b.due]), [['OPENING', 5000], ['ZTAVINV1', 200]]);
    assert.equal((await post(`/api/payments/${p1.body.paymentNo}/cancel`, {})).status, 409);

    // income / expense ledgers have no bills and are never "payable"
    const fi = (await get('/api/payments/open-bills', { ledger: freightIncome.LedgerCode })).body;
    assert.deepEqual([fi.billWise, fi.bills.length], [false, 0]);
    assert.equal((await get('/api/payments/payables', { q: 'FREIGHT INCOME' })).body.find((x) => x.name === 'FREIGHT INCOME')?.owed ?? 0, 0);
    assert.equal((await get('/api/payments/open-bills', { ledger: 'NOPE' })).status, 404);
  });

  // ------------------------------------------------------------------ books & reports
  test('books: trial balance and balance sheet tally', async () => {
    const tb = (await get('/api/books/trial-balance')).body;
    assert.equal(tb.totals.difference, 0, JSON.stringify(tb.totals));
    assert.equal(tb.totals.dr, tb.totals.cr);
    assert.deepEqual(tb.unclassified, []);
    const z = tb.lines.find((l) => l.code === ids.vendor);
    assert.deepEqual([z.section, z.opening], ['Sundry Creditors', -5000]);
    const bs = (await get('/api/books/balance-sheet')).body;
    assert.equal(bs.totals.difference, 0, JSON.stringify(bs.totals));
    assert.equal(bs.totals.assets, bs.totals.liabilities);
  });

  test('books: profit & loss and expense analysis show the ZTA main ledger with its sub-ledgers', async () => {
    const pl = (await get('/api/books/profit-loss')).body;
    const s = pl.summary;
    assert.equal(s.grossProfit, r2(s.directIncome - s.directExpenses));
    assert.equal(s.netProfit, r2(s.grossProfit + s.indirectIncome - s.indirectExpenses));
    const sec = pl.sections.find((x) => x.key === 'INDIRECT_EXP');
    const g = sec.groups.find((x) => x.code === ids.group);
    const main = g.ledgers.find((x) => x.code === ids.main);
    // TEA 150 (expense) + 100 (advance adjusted) ; PAPER 3000 (vendor bill)
    assert.deepEqual([main.amount, main.isMain, main.subs.map((x) => [x.name, x.amount]).sort()], [3250, true, [['ZTA PAPER', 3000], ['ZTA TEA', 250]]]);
    const ex = (await get('/api/books/expenses')).body;
    assert.ok(ex.total >= 3250);
    assert.ok(ex.sections.some((x) => x.groups.some((gg) => gg.code === ids.group && gg.amount === 3250)));
    assert.ok(ex.bySource.some((x) => /Payments/.test(x.source)) && ex.bySource.some((x) => /Purchases/.test(x.source)));
    // profit on the balance sheet = net profit of the year
    const bs = (await get('/api/books/balance-sheet')).body;
    const full = (await get('/api/books/profit-loss', { from: `${y}-04-01`, to: bs.asOn })).body;
    assert.equal(bs.profit, full.summary.netProfit);
  });

  test('books: day book lists every voucher with its source; ledger statement runs the balance', async () => {
    const pno = made.payments[4];   // expense, advance, adjustment, vendor 1200 (cancelled), vendor 3000 ← this one, on account 50
    const db = (await get('/api/books/day-book', { from: today, to: today, q: pno })).body;
    const v = db.vouchers.find((x) => x.voucherNo === pno);
    assert.deepEqual([v.type, v.source, v.party, v.amount], ['Payment', 'Payment against bills', 'ZTA VENDOR', 3000]);
    assert.ok(balanced(v.lines.map((l) => [l.ledger, l.dr, l.cr])));
    const purchases = (await get('/api/books/day-book', { from: today, to: today, type: 'Purchase', q: 'ZTAVINV1' })).body;
    assert.deepEqual(purchases.vouchers.map((x) => x.voucherNo), ['ZTAVINV1']);
    assert.ok((await get('/api/books/day-book', { from: today, to: today, type: 'Contra', q: 'ZTA' })).body.vouchers.every((x) => x.type === 'Contra'));

    const st = (await get(`/api/books/ledger/${ids.vendor}`)).body;
    assert.equal(st.opening, -5000);
    let bal = st.opening;
    for (const e of st.entries) { bal = r2(bal + e.dr - e.cr); assert.equal(e.balance, bal); }
    assert.equal(st.closing, bal);
    assert.equal(st.closing, -(5000 + 3000 - 3000 - 50));   // opening + bill − payments still active (3000 + 50)
    assert.ok(st.entries.some((e) => e.against === 'CASH HEAD OFFICE' && e.dr === 3000));
    // a main ledger's statement includes its sub-ledgers
    const ms = (await get(`/api/books/ledger/${ids.main}`)).body;
    assert.deepEqual([ms.ledger.isMain, ms.ledger.subs.length, ms.closing], [true, 2, 3250]);
    assert.ok(ms.entries.every((e) => ['ZTA TEA', 'ZTA PAPER'].includes(e.subLedger)));
    assert.equal((await get('/api/books/ledger/NOPE')).status, 404);
    const picker = (await get('/api/books/ledgers')).body;
    assert.ok(picker.some((x) => x.value === ids.main && x.isMain) && picker.some((x) => x.value === ids['ZTA TEA'] && x.label.includes('(ZTA OFFICE)')));
  });

  test('books: overview money position and validation', async () => {
    const o = (await get('/api/books/overview')).body;
    for (const k of ['cash', 'bank', 'receivable', 'payable', 'advances', 'taxes']) assert.ok(o.money[k] && typeof o.money[k].total === 'number', k);
    assert.ok(o.money.payable.ledgers.some((x) => x.code === ids.vendor && x.amount === 4950));
    assert.ok(o.money.cash.ledgers.some((x) => x.code === cash.value));
    assert.equal(o.profit.net, r2(o.profit.income - o.profit.expense));
    assert.equal(o.trend.length, Number(o.to.slice(5, 7)) - 4 + 1 + (o.to.slice(5, 7) < '04' ? 12 : 0));
    assert.equal((await get('/api/books/day-book', { from: '08-10-2026' })).status, 400);
    // dates outside the login year are pulled back inside it
    const clamp = (await get('/api/books/trial-balance', { from: '1999-01-01', to: '2999-01-01' })).body;
    assert.deepEqual([clamp.from, clamp.to <= today], [`${y}-04-01`, true]);
    assert.equal((await get('/api/books/sections')).body.length, 16);
  });
});
