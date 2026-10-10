// Books & Reports — one screen to see where every rupee is and where it came from (GET /api/books/*):
//   Overview          cash / bank / receivable / payable / advances / taxes, profit so far, income vs expense by month
//   Day Book          every voucher of every module (sales, purchase, payment, receipt, contra, journal) with its lines + source
//   Ledger Statement  any ledger (a main ledger includes its sub-ledgers) with running balance and the other side of each entry
//   Trial Balance / Profit & Loss / Balance Sheet / Expense Analysis
// Any ledger name opens its statement in a side panel.
import { createContext, useContext, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Alert, Button, Card, Col, DatePicker, Descriptions, Empty, Input, Row, Segmented, Select, Space, Spin, Statistic, Table, Tabs, Tag, Typography,
} from 'antd';
import { Drawer as AntDrawer } from 'antd/es/index.js';
import {
  BankOutlined, BookOutlined, DownloadOutlined, FallOutlined, RiseOutlined, ShopOutlined, TeamOutlined, WalletOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { api } from '../../api/client.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { Bars, ChartCard, Donut, fmt } from '../../components/charts/Charts.jsx';

const { Text, Title } = Typography;
const money = (v) => (Number(v) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const drcr = (v) => (Number(v) ? `${money(Math.abs(v))} ${v > 0 ? 'Dr' : 'Cr'}` : '0.00');
const TYPE_COLOR = { Sales: 'green', Purchase: 'volcano', Payment: 'orange', Receipt: 'blue', Contra: 'cyan', Journal: 'purple' };
const num = { align: 'right', className: 'num' };

// open a ledger statement from anywhere on the page
const LedgerLink = createContext(() => {});
function LName({ code, children }) {
  const open = useContext(LedgerLink);
  return code ? <Typography.Link onClick={() => open(code)}>{children}</Typography.Link> : <span>{children}</span>;
}

function useBooks(path, params, enabled = true) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['books', path, params, user.divCode, user.financialYear],
    queryFn: () => api.get(`/books/${path}`, { params }).then((r) => r.data),
    enabled,
  });
}

function csv(name, header, rows) {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const blob = new Blob([[header, ...rows].map((r) => r.map(esc).join(',')).join('\r\n')], { type: 'text/csv' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${name}.csv`; a.click();
  URL.revokeObjectURL(a.href);
}

// ------------------------------------------------------------------ ledger statement (tab + side panel)

function Statement({ code, range, compact = false }) {
  const q = useBooks(`ledger/${encodeURIComponent(code)}`, range, Boolean(code));
  if (!code) return <Empty description="Select a ledger" />;
  if (q.isLoading) return <Spin />;
  if (q.error) return <Alert type="error" message="Could not load the statement" />;
  const d = q.data;
  const columns = [
    { title: 'Date', dataIndex: 'date', width: 100, render: (v) => (v ? dayjs(v).format('DD-MM-YYYY') : '') },
    { title: 'Voucher', dataIndex: 'voucherNo', width: 170, render: (v, r) => <Space direction="vertical" size={0}><Text>{v}</Text><Tag color={TYPE_COLOR[r.type]}>{r.type}</Tag></Space> },
    {
      title: 'Particulars', key: 'p', render: (_, r) => (
        <Space direction="vertical" size={0}>
          <Text>{r.against || r.source}</Text>
          {r.subLedger && <Text type="secondary" style={{ fontSize: 12 }}>Sub-ledger: {r.subLedger}</Text>}
          {r.narration && <Text type="secondary" style={{ fontSize: 12 }}>{r.narration}</Text>}
        </Space>),
    },
    { title: 'Debit', dataIndex: 'dr', width: 120, ...num, render: (v) => (v ? money(v) : '') },
    { title: 'Credit', dataIndex: 'cr', width: 120, ...num, render: (v) => (v ? money(v) : '') },
    { title: 'Balance', dataIndex: 'balance', width: 140, ...num, render: drcr },
  ];
  return (
    <Space direction="vertical" style={{ width: '100%' }} size="middle">
      <Descriptions size="small" bordered column={compact ? 2 : 4} items={[
        { label: 'Ledger', children: <b>{d.ledger.name}</b> },
        { label: 'Group', children: `${d.ledger.group} (${d.ledger.section})` },
        { label: 'Period', children: `${dayjs(d.from).format('DD-MM-YYYY')} to ${dayjs(d.to).format('DD-MM-YYYY')}` },
        { label: 'Closing balance', children: <b>{drcr(d.closing)}</b> },
        ...(d.ledger.subs.length ? [{ label: 'Sub-ledgers', span: 4, children: d.ledger.subs.map((x) => <Tag key={x.code}>{x.name}</Tag>) }] : []),
      ]} />
      <Table size="small" rowKey={(r, i) => `${r.voucherNo}-${i}`} columns={columns} dataSource={d.entries} pagination={{ pageSize: 50, hideOnSinglePage: true }}
        scroll={{ x: 800 }}
        title={() => <Space style={{ width: '100%', justifyContent: 'space-between' }}><Text>Opening balance: <b>{drcr(d.opening)}</b></Text>
          <Button size="small" icon={<DownloadOutlined />} onClick={() => csv(`ledger-${d.ledger.name}`, ['Date', 'Voucher', 'Type', 'Particulars', 'Narration', 'Debit', 'Credit', 'Balance'],
            d.entries.map((e) => [e.date, e.voucherNo, e.type, e.against || e.source, e.narration, e.dr, e.cr, drcr(e.balance)]))}>CSV</Button></Space>}
        summary={() => (
          <Table.Summary fixed>
            <Table.Summary.Row>
              <Table.Summary.Cell index={0} colSpan={3}><b>Total</b></Table.Summary.Cell>
              <Table.Summary.Cell index={3} align="right"><b>{money(d.dr)}</b></Table.Summary.Cell>
              <Table.Summary.Cell index={4} align="right"><b>{money(d.cr)}</b></Table.Summary.Cell>
              <Table.Summary.Cell index={5} align="right"><b>{drcr(d.closing)}</b></Table.Summary.Cell>
            </Table.Summary.Row>
          </Table.Summary>
        )} />
    </Space>
  );
}

function LedgerTab({ range, initial }) {
  const [code, setCode] = useState(initial);
  const list = useBooks('ledgers', {});
  return (
    <Space direction="vertical" style={{ width: '100%' }} size="middle">
      <Select showSearch optionFilterProp="label" style={{ width: '100%', maxWidth: 560 }} placeholder="Select a ledger" value={code} onChange={setCode}
        loading={list.isLoading}
        options={(list.data ?? []).map((l) => ({ value: l.value, label: `${l.label}${l.isMain ? '  [main]' : ''}  ·  ${drcr(l.balance)}` }))} />
      <Statement code={code} range={range} />
    </Space>
  );
}

// ------------------------------------------------------------------ overview

function MoneyList({ title, icon, data, sign = '', empty }) {
  return (
    <Card size="small" title={<Space>{icon}{title}</Space>} extra={<b>₹ {money(data?.total)}</b>} style={{ height: '100%' }}>
      {data?.ledgers?.length ? (
        <Table size="small" pagination={false} showHeader={false} rowKey="code" scroll={{ y: 240 }}
          dataSource={data.ledgers}
          columns={[
            { dataIndex: 'name', render: (v, r) => <LName code={r.code}>{v}</LName> },
            { dataIndex: 'amount', width: 130, ...num, render: (v) => `${money(v)}${sign}` },
          ]} />
      ) : <Text type="secondary">{empty}</Text>}
      {data?.count > (data?.ledgers?.length ?? 0) && <Text type="secondary" style={{ fontSize: 12 }}>Top {data.ledgers.length} of {data.count}</Text>}
    </Card>
  );
}

function Overview({ range }) {
  const q = useBooks('overview', range);
  if (q.isLoading) return <Spin />;
  if (q.error) return <Alert type="error" message="Could not load the overview" />;
  const d = q.data; const m = d.money;
  const kpi = (title, value, icon, color, sub) => (
    <Col xs={12} md={8} xl={4}>
      <Card size="small"><Statistic title={<Space>{icon}{title}</Space>} value={value} precision={0} prefix="₹" valueStyle={{ color, fontSize: 22 }} />
        {sub && <Text type="secondary" style={{ fontSize: 12 }}>{sub}</Text>}</Card>
    </Col>
  );
  return (
    <Space direction="vertical" style={{ width: '100%' }} size="middle">
      {d.unclassified > 0 && <Alert type="warning" showIcon message={`${d.unclassified} ledger(s) are in groups without a type. Set the group type in Account Master so they appear correctly in the reports.`} />}
      <Row gutter={[12, 12]}>
        {kpi('Cash in Hand', m.cash.total, <WalletOutlined />, undefined, `${m.cash.ledgers.length} cash account(s)`)}
        {kpi('Bank Balance', m.bank.total, <BankOutlined />, undefined, `${m.bank.ledgers.length} bank account(s)`)}
        {kpi('To Receive', m.receivable.total, <RiseOutlined />, '#389e0d', `${m.receivable.count} client(s)`)}
        {kpi('To Pay', m.payable.total, <FallOutlined />, '#cf1322', `${m.payable.count} vendor(s)`)}
        {kpi('Advances Out', m.advances.total, <TeamOutlined />, '#d46b08', `${m.advances.count} person(s)`)}
        {kpi(d.profit.net >= 0 ? 'Net Profit' : 'Net Loss', Math.abs(d.profit.net), <ShopOutlined />, d.profit.net >= 0 ? '#389e0d' : '#cf1322',
          `Income ₹${fmt.short(d.profit.income)} · Expense ₹${fmt.short(d.profit.expense)}`)}
      </Row>
      <Row gutter={[12, 12]}>
        <Col xs={24} xl={14}>
          <ChartCard title="Income vs Expense by month" empty={!d.trend.some((t) => t.income || t.expense)}>
            <Bars data={d.trend.map((t) => ({ ...t, month: dayjs(`${t.month}-01`).format('MMM YY') }))} x="month"
              series={[{ key: 'income', label: 'Income', color: '#52c41a' }, { key: 'expense', label: 'Expense', color: '#f5222d' }, { key: 'profit', label: 'Profit', color: '#1677ff' }]}
              format={fmt.inrShort} height={260} />
          </ChartCard>
        </Col>
        <Col xs={24} xl={10}>
          <ChartCard title="Where the money went (expenses this year)" empty={!d.expenses.length}>
            <Bars horizontal data={d.expenses.slice(0, 10)} x="name" series={[{ key: 'amount', label: 'Amount' }]} format={fmt.inrShort} labelWidth={170} />
          </ChartCard>
        </Col>
      </Row>
      <Row gutter={[12, 12]}>
        <Col xs={24} md={12} xl={8}><MoneyList title="Cash & Bank" icon={<WalletOutlined />} empty="No cash / bank balance"
          data={{ total: m.cash.total + m.bank.total, ledgers: [...m.cash.ledgers, ...m.bank.ledgers] }} /></Col>
        <Col xs={24} md={12} xl={8}><MoneyList title="To receive from clients" icon={<RiseOutlined />} data={m.receivable} empty="Nothing outstanding" /></Col>
        <Col xs={24} md={12} xl={8}><MoneyList title="To pay to vendors" icon={<FallOutlined />} data={m.payable} empty="Nothing payable" /></Col>
        <Col xs={24} md={12} xl={8}><MoneyList title="Advances given (drivers / staff)" icon={<TeamOutlined />} data={m.advances} empty="No advance outstanding" /></Col>
        <Col xs={24} md={12} xl={8}><MoneyList title="Duties & taxes (payable)" icon={<BookOutlined />} data={m.taxes} empty="No tax balance" /></Col>
        <Col xs={24} md={12} xl={8}>
          <Card size="small" title="This month" style={{ height: '100%' }}>
            <Descriptions size="small" column={1} items={[
              { label: 'Income', children: `₹ ${money(d.profit.thisMonth.income)}` },
              { label: 'Expense', children: `₹ ${money(d.profit.thisMonth.expense)}` },
              { label: d.profit.thisMonth.profit >= 0 ? 'Profit' : 'Loss', children: <b style={{ color: d.profit.thisMonth.profit >= 0 ? '#389e0d' : '#cf1322' }}>₹ {money(Math.abs(d.profit.thisMonth.profit))}</b> },
            ]} />
          </Card>
        </Col>
      </Row>
    </Space>
  );
}

// ------------------------------------------------------------------ day book

const TYPES = ['All', 'Sales', 'Purchase', 'Payment', 'Receipt', 'Contra', 'Journal'];

function DayBook({ range }) {
  const [type, setType] = useState('All');
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const r = useBooks('day-book', { ...range, type: type === 'All' ? '' : type, q: term });
  const d = r.data;
  const columns = [
    { title: 'Date', dataIndex: 'date', width: 100, render: (v) => dayjs(v).format('DD-MM-YYYY') },
    { title: 'Type', dataIndex: 'type', width: 95, render: (v) => <Tag color={TYPE_COLOR[v]}>{v}</Tag> },
    { title: 'Voucher No', dataIndex: 'voucherNo', width: 170 },
    { title: 'Source', dataIndex: 'source', width: 170 },
    { title: 'Party', dataIndex: 'party', width: 200, ellipsis: true },
    { title: 'Narration', dataIndex: 'narration', ellipsis: true },
    { title: 'Amount', dataIndex: 'amount', width: 130, ...num, render: money },
  ];
  return (
    <Space direction="vertical" style={{ width: '100%' }} size="middle">
      <Space wrap>
        <Segmented options={TYPES} value={type} onChange={setType} />
        <Input.Search allowClear placeholder="Voucher, party, ledger, narration" style={{ width: 300 }} value={q} onChange={(e) => setQ(e.target.value)} onSearch={setTerm} />
        {d && <Button icon={<DownloadOutlined />} onClick={() => csv('day-book', ['Date', 'Type', 'Voucher', 'Source', 'Party', 'Narration', 'Ledger', 'Debit', 'Credit'],
          d.vouchers.flatMap((v) => v.lines.map((l) => [v.date, v.type, v.voucherNo, v.source, v.party, v.narration, l.ledger, l.dr, l.cr])))}>CSV</Button>}
      </Space>
      {d && (
        <Space wrap size={[8, 8]}>
          {Object.entries(d.byType).map(([k, v]) => <Tag key={k} color={TYPE_COLOR[k]} style={{ padding: '2px 8px' }}>{k}: ₹ {money(v)}</Tag>)}
        </Space>
      )}
      <Table size="small" rowKey="key" loading={r.isLoading} columns={columns} dataSource={d?.vouchers ?? []} scroll={{ x: 1000 }}
        pagination={{ pageSize: 50, showSizeChanger: true, showTotal: (t) => `${t} voucher(s)` }}
        expandable={{
          expandedRowRender: (v) => (
            <Table size="small" pagination={false} rowKey={(l, i) => `${l.code}-${i}`} dataSource={v.lines} style={{ maxWidth: 720 }}
              columns={[
                { title: 'Ledger', dataIndex: 'ledger', render: (x, l) => <LName code={l.code}>{x}</LName> },
                { title: 'Debit', dataIndex: 'dr', width: 130, ...num, render: (x) => (x ? money(x) : '') },
                { title: 'Credit', dataIndex: 'cr', width: 130, ...num, render: (x) => (x ? money(x) : '') },
              ]}
              footer={() => <Text type="secondary">Entered by {v.createdBy || '—'}{v.branch ? ` · Branch ${v.branch}` : ''}</Text>} />
          ),
        }}
        summary={() => d && (
          <Table.Summary.Row>
            <Table.Summary.Cell index={0} colSpan={7}><b>Total of {d.count} voucher(s)</b></Table.Summary.Cell>
            <Table.Summary.Cell index={7} align="right"><b>{money(d.total)}</b></Table.Summary.Cell>
          </Table.Summary.Row>
        )} />
    </Space>
  );
}

// ------------------------------------------------------------------ tree reports (TB / P&L / BS / expenses)

/** sections -> groups -> ledgers -> subs into antd tree rows; amount column chosen by `cols`. */
function treeRows(sections) {
  return sections.map((sec) => ({
    key: `s-${sec.key}`, name: sec.label, amount: sec.amount, level: 0,
    children: sec.groups.map((g) => ({
      key: `g-${sec.key}-${g.code}`, name: g.name, amount: g.amount, level: 1,
      children: g.ledgers.map((l) => ({
        key: `l-${l.code}`, code: l.code, name: l.name, amount: l.amount, level: 2, isMain: l.isMain,
        children: l.subs?.length ? l.subs.map((x) => ({ key: `x-${x.code}`, code: x.code, name: x.name, amount: x.amount, level: 3 })) : undefined,
      })),
    })),
  }));
}

const nameCol = {
  title: 'Particulars', dataIndex: 'name', render: (v, r) => (r.level === 0 ? <b>{v}</b> : r.level === 1 ? <Text strong>{v}</Text>
    : <LName code={r.code}>{v}{r.isMain && <Tag style={{ marginInlineStart: 6 }}>main</Tag>}</LName>),
};
const amountCol = { title: 'Amount', dataIndex: 'amount', width: 160, ...num, render: (v, r) => (r.level <= 1 ? <b>{money(v)}</b> : money(v)) };

function TreeTable({ sections, extraRows = [], total, totalLabel = 'Total' }) {
  const rows = useMemo(() => [...treeRows(sections), ...extraRows], [sections, extraRows]);
  return (
    <Table size="small" rowKey="key" columns={[nameCol, amountCol]} dataSource={rows} pagination={false}
      expandable={{ defaultExpandedRowKeys: rows.flatMap((r) => [r.key, ...(r.children ?? []).map((g) => g.key)]) }}
      rowClassName={(r) => (r.level === 0 ? 'row-main-ledger' : '')}
      summary={() => (total === undefined ? null : (
        <Table.Summary.Row>
          <Table.Summary.Cell index={0}><b>{totalLabel}</b></Table.Summary.Cell>
          <Table.Summary.Cell index={1} align="right"><b>{money(total)}</b></Table.Summary.Cell>
        </Table.Summary.Row>
      ))} />
  );
}

function TrialBalance({ range }) {
  const q = useBooks('trial-balance', range);
  if (q.isLoading) return <Spin />;
  if (q.error) return <Alert type="error" message="Could not load the trial balance" />;
  const d = q.data;
  const rows = d.lines.map((l) => ({ ...l, key: l.code }));
  const columns = [
    { title: 'Ledger', dataIndex: 'name', render: (v, r) => <LName code={r.code}>{v}</LName> },
    { title: 'Group', dataIndex: 'group', width: 180, responsive: ['md'] },
    { title: 'Type', dataIndex: 'section', width: 170, responsive: ['lg'] },
    { title: 'Opening', dataIndex: 'opening', width: 140, ...num, render: drcr },
    { title: 'Debit', dataIndex: 'dr', width: 130, ...num, render: (v) => (v ? money(v) : '') },
    { title: 'Credit', dataIndex: 'cr', width: 130, ...num, render: (v) => (v ? money(v) : '') },
    { title: 'Closing Dr', dataIndex: 'closing', width: 140, ...num, render: (v) => (v > 0 ? money(v) : '') },
    { title: 'Closing Cr', dataIndex: 'closing', key: 'ccr', width: 140, ...num, render: (v) => (v < 0 ? money(-v) : '') },
  ];
  return (
    <Space direction="vertical" style={{ width: '100%' }} size="middle">
      {d.totals.difference ? <Alert type="error" showIcon message={`Trial balance does not tally: difference ₹ ${money(d.totals.difference)}`} />
        : <Alert type="success" showIcon message="Trial balance tallies (total debit = total credit)." />}
      {d.totals.openingDifference ? <Alert type="warning" showIcon message={`Opening balances entered in Account Master do not match: difference ₹ ${money(Math.abs(d.totals.openingDifference))} (${d.totals.openingDifference > 0 ? 'Dr' : 'Cr'} excess). It is shown as a separate line.`} /> : null}
      <Space><Button icon={<DownloadOutlined />} onClick={() => csv('trial-balance', ['Ledger', 'Group', 'Type', 'Opening', 'Debit', 'Credit', 'Closing Dr', 'Closing Cr'],
        d.lines.map((l) => [l.name, l.group, l.section, drcr(l.opening), l.dr, l.cr, l.closing > 0 ? l.closing : '', l.closing < 0 ? -l.closing : '']))}>CSV</Button></Space>
      <Table size="small" rowKey="key" columns={columns} dataSource={rows} pagination={false} scroll={{ x: 900 }}
        summary={() => (
          <>
            {d.totals.openingDifference ? (
              <Table.Summary.Row>
                <Table.Summary.Cell index={0} colSpan={6}><Text type="warning">Difference in opening balances</Text></Table.Summary.Cell>
                <Table.Summary.Cell index={6} align="right">{d.totals.openingDifference < 0 ? money(-d.totals.openingDifference) : ''}</Table.Summary.Cell>
                <Table.Summary.Cell index={7} align="right">{d.totals.openingDifference > 0 ? money(d.totals.openingDifference) : ''}</Table.Summary.Cell>
              </Table.Summary.Row>
            ) : null}
            <Table.Summary.Row>
              <Table.Summary.Cell index={0} colSpan={6}><b>Total</b></Table.Summary.Cell>
              <Table.Summary.Cell index={6} align="right"><b>{money(d.totals.dr)}</b></Table.Summary.Cell>
              <Table.Summary.Cell index={7} align="right"><b>{money(d.totals.cr)}</b></Table.Summary.Cell>
            </Table.Summary.Row>
          </>
        )} />
    </Space>
  );
}

function ProfitLoss({ range }) {
  const q = useBooks('profit-loss', range);
  if (q.isLoading) return <Spin />;
  if (q.error) return <Alert type="error" message="Could not load profit & loss" />;
  const d = q.data; const s = d.summary;
  const pick = (keys) => d.sections.filter((x) => keys.includes(x.key));
  const line = (label, v, strong) => (
    <Space style={{ width: '100%', justifyContent: 'space-between', padding: '6px 8px' }}>
      <Text strong={strong}>{label}</Text><Text strong={strong} style={{ color: v < 0 ? '#cf1322' : undefined }}>₹ {money(v)}</Text>
    </Space>
  );
  return (
    <Row gutter={[12, 12]}>
      <Col xs={24} lg={8}>
        <Card size="small" title="Summary">
          {line('Direct income (freight, services)', s.directIncome)}
          {line('Less: direct expenses (truck hire, operations)', s.directExpenses)}
          {line(s.grossProfit >= 0 ? 'Gross profit' : 'Gross loss', s.grossProfit, true)}
          {line('Add: indirect income', s.indirectIncome)}
          {line('Less: indirect expenses (office, salary)', s.indirectExpenses)}
          {line(s.netProfit >= 0 ? 'Net profit' : 'Net loss', s.netProfit, true)}
          <Text type="secondary">Net margin {s.margin}% of income</Text>
        </Card>
      </Col>
      <Col xs={24} lg={8}><Card size="small" title="Income"><TreeTable sections={pick(['DIRECT_INC', 'INDIRECT_INC'])} total={s.totalIncome} totalLabel="Total income" /></Card></Col>
      <Col xs={24} lg={8}><Card size="small" title="Expenses"><TreeTable sections={pick(['DIRECT_EXP', 'INDIRECT_EXP'])} total={s.totalExpenses} totalLabel="Total expenses" /></Card></Col>
    </Row>
  );
}

function BalanceSheet({ range }) {
  const q = useBooks('balance-sheet', { to: range.to });
  if (q.isLoading) return <Spin />;
  if (q.error) return <Alert type="error" message="Could not load the balance sheet" />;
  const d = q.data;
  const liabExtra = [
    { key: 'pl', name: d.profit >= 0 ? 'Profit & Loss A/c (profit)' : 'Profit & Loss A/c (loss)', amount: d.profit, level: 0 },
    ...(d.openingDifference > 0 ? [{ key: 'od', name: 'Difference in opening balances', amount: d.openingDifference, level: 0 }] : []),
  ];
  const assetExtra = d.openingDifference < 0 ? [{ key: 'od', name: 'Difference in opening balances', amount: -d.openingDifference, level: 0 }] : [];
  return (
    <Space direction="vertical" style={{ width: '100%' }} size="middle">
      <Text type="secondary">As on {dayjs(d.asOn).format('DD-MM-YYYY')}</Text>
      {d.totals.difference ? <Alert type="error" showIcon message={`Balance sheet does not tally: difference ₹ ${money(d.totals.difference)}`} /> : null}
      <Row gutter={[12, 12]}>
        <Col xs={24} lg={12}><Card size="small" title="Liabilities"><TreeTable sections={d.liabilities} extraRows={liabExtra} total={d.totals.liabilities} /></Card></Col>
        <Col xs={24} lg={12}><Card size="small" title="Assets"><TreeTable sections={d.assets} extraRows={assetExtra} total={d.totals.assets} /></Card></Col>
      </Row>
    </Space>
  );
}

function Expenses({ range }) {
  const q = useBooks('expenses', range);
  if (q.isLoading) return <Spin />;
  if (q.error) return <Alert type="error" message="Could not load the expense analysis" />;
  const d = q.data;
  const heads = d.sections.flatMap((s) => s.groups.flatMap((g) => g.ledgers.map((l) => ({ name: l.name, amount: l.amount }))))
    .sort((a, b) => b.amount - a.amount);
  const headNames = [...new Set(d.byMonth.flatMap((m) => Object.keys(m.heads)))];
  const monthRows = d.byMonth.map((m) => ({ month: dayjs(`${m.month}-01`).format('MMM YY'), ...m.heads }));
  return (
    <Row gutter={[12, 12]}>
      <Col xs={24} lg={10}>
        <ChartCard title={`Expenses by head — total ₹ ${money(d.total)}`} empty={!heads.length}>
          <Donut data={heads.slice(0, 10)} name="name" value="amount" format={fmt.inr} centerLabel="Expenses" height={260} />
        </ChartCard>
      </Col>
      <Col xs={24} lg={14}>
        <ChartCard title="Month by month" empty={!monthRows.length}>
          <Bars stacked data={monthRows} x="month" series={headNames.map((h) => ({ key: h, label: h }))} format={fmt.inrShort} height={260} />
        </ChartCard>
      </Col>
      <Col xs={24} lg={8}>
        <Card size="small" title="Where the expense was entered">
          <Table size="small" pagination={false} rowKey="source" dataSource={d.bySource} columns={[
            { title: 'Entry', dataIndex: 'source' }, { title: 'Amount', dataIndex: 'amount', width: 140, ...num, render: money },
          ]} />
        </Card>
      </Col>
      <Col xs={24} lg={16}>
        <Card size="small" title="Group → main ledger → sub-ledger"><TreeTable sections={d.sections} total={d.total} totalLabel="Total expenses" /></Card>
      </Col>
    </Row>
  );
}

// ------------------------------------------------------------------ page

export default function BooksPage() {
  const { user } = useAuth();
  const [a, b] = String(user.financialYear || '').split('-');
  const fyFrom = dayjs(`${a}-04-01`); const fyTo = dayjs(`${b}-03-31`);
  const [dates, setDates] = useState([fyFrom, dayjs().isAfter(fyTo) ? fyTo : dayjs()]);
  const range = { from: dates[0].format('YYYY-MM-DD'), to: dates[1].format('YYYY-MM-DD') };
  const [tab, setTab] = useState('overview');
  const [panel, setPanel] = useState(null);
  const presets = [
    { label: 'This month', value: [dayjs().startOf('month'), dayjs()] },
    { label: 'Last month', value: [dayjs().subtract(1, 'month').startOf('month'), dayjs().subtract(1, 'month').endOf('month')] },
    { label: 'This quarter', value: [dayjs().startOf('month').subtract((dayjs().month() + 9) % 3, 'month'), dayjs()] },
    { label: 'Financial year', value: [fyFrom, dayjs().isAfter(fyTo) ? fyTo : dayjs()] },
  ];

  return (
    <LedgerLink.Provider value={setPanel}>
      <Card
        title={<Space><BookOutlined /><Title level={5} style={{ margin: 0 }}>Books & Reports</Title><Tag>FY {user.financialYear}</Tag></Space>}
        extra={<DatePicker.RangePicker allowClear={false} format="DD-MM-YYYY" value={dates} presets={presets}
          disabledDate={(d) => d.isBefore(fyFrom) || d.isAfter(fyTo)} onChange={(v) => v && setDates(v)} />}>
        <Tabs activeKey={tab} onChange={setTab} destroyOnHidden items={[
          { key: 'overview', label: 'Overview', children: <Overview range={range} /> },
          { key: 'daybook', label: 'Day Book', children: <DayBook range={range} /> },
          { key: 'ledger', label: 'Ledger Statement', children: <LedgerTab range={range} /> },
          { key: 'tb', label: 'Trial Balance', children: <TrialBalance range={range} /> },
          { key: 'pl', label: 'Profit & Loss', children: <ProfitLoss range={range} /> },
          { key: 'bs', label: 'Balance Sheet', children: <BalanceSheet range={range} /> },
          { key: 'exp', label: 'Expense Analysis', children: <Expenses range={range} /> },
        ]} />
      </Card>
      <AntDrawer open={Boolean(panel)} onClose={() => setPanel(null)} width={Math.min(1000, window.innerWidth)} title="Ledger Statement" destroyOnHidden>
        {panel && <Statement code={panel} range={range} compact />}
      </AntDrawer>
    </LedgerLink.Provider>
  );
}
