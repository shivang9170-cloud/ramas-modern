// Replaces Tracking.aspx / Tracking_Client.aspx. Shows the docket's whole journey built from the operation entries
// (GET /api/dockets/:no/journey): a summary, the progress steps, the problems found (which entry is wrong or where it is stuck,
// who entered it and what to do) and three views:
//   * Entries grid      — one row per entry (booking, pickup, manifest, challan, arrival, DRS, delivery, POD, bill, receipt) with
//                         every value entered on it; the cell with a wrong value is red;
//   * Field comparison  — one row per field (packages, weight, branch, date…), one column per entry: what value went where,
//                         values that differ from the booking are orange, wrong ones red;
//   * Journey           — the timeline.
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { Alert, Badge, Card, Col, Descriptions, Empty, Input, List, Result, Row, Space, Spin, Steps, Table, Tabs, Tag, Timeline, Tooltip, Typography } from 'antd';
import { CheckCircleFilled, CloseCircleFilled, ExclamationCircleFilled, WarningFilled } from '@ant-design/icons';
import { api, errorMessage } from '../api/client.js';

const when = (w) => (w ? dayjs(w).format(w.endsWith('T00:00:00') ? 'DD/MM/YYYY' : 'DD/MM/YYYY HH:mm') : 'date not entered');
const STATUS_COLOR = { Delivered: 'green', Cancelled: 'red', Lost: 'red', 'Return to origin': 'volcano', Undelivered: 'orange' };
const STAGE_COLOR = { Booked: 'blue', 'Picked up': 'cyan', 'Loading sheet': 'geekblue', Manifested: 'purple', 'In transit': 'magenta', Arrived: 'gold', 'Out for delivery': 'orange', Delivered: 'green', Undelivered: 'volcano', 'Return to origin': 'volcano', Lost: 'red', 'POD sent': 'lime', 'POD received': 'lime', Billed: 'blue', Paid: 'green', Cancelled: 'red' };
const HEALTH = {
  ok: { text: 'No problems found', icon: <CheckCircleFilled style={{ color: '#52c41a' }} /> },
  warning: { text: 'Needs attention', icon: <WarningFilled style={{ color: '#faad14' }} /> },
  error: { text: 'Problem found', icon: <CloseCircleFilled style={{ color: '#f5222d' }} /> },
};
const RED = 'rgba(245,34,45,.14)'; const ORANGE = 'rgba(250,173,20,.18)';
const levelIcon = (l) => (l === 'error' ? <CloseCircleFilled style={{ color: '#f5222d' }} /> : <ExclamationCircleFilled style={{ color: '#faad14' }} />);
const money = (v) => (v === null || v === undefined || v === '' ? '' : `₹ ${Number(v).toLocaleString('en-IN')}`);

/** The fields shown in both grids: key in values, label, how to show it, numeric (compared with the booking). */
const FIELDS = [
  { key: 'date', label: 'Date / time', show: (e) => when(e.when) },
  { key: 'entryNo', label: 'Entry no.' },
  { key: 'branch', label: 'Branch' },
  { key: 'toBranch', label: 'To branch' },
  { key: 'packages', label: 'Packages', num: true },
  { key: 'short', label: 'Short pkts', num: true },
  { key: 'weight', label: 'Weight (kg)', num: true },
  { key: 'amount', label: 'Amount', show: (e) => money(e.values?.amount), staff: true },
  { key: 'vehicle', label: 'Vehicle' },
  { key: 'person', label: 'Person / driver' },
  { key: 'vendor', label: 'Vendor' },
  { key: 'receiver', label: 'Receiver' },
  { key: 'status', label: 'Status / type' },
  { key: 'remarks', label: 'Remarks' },
  { key: 'enteredBy', label: 'Entered by' },
];
const valueOf = (f, e) => (f.show ? f.show(e) : e.values?.[f.key] ?? '');
/** Grids list the entries in process order (booking first), then by date — a wrongly dated entry then stands out in red. */
const ORDER = ['Booked', 'Cancelled', 'Picked up', 'Loading sheet', 'Manifested', 'In transit', 'Arrived', 'Out for delivery', 'Delivered', 'Undelivered', 'Return to origin', 'Lost', 'POD sent', 'POD received', 'Billed', 'Paid'];
const inOrder = (events) => [...events].sort((a, b) => {
  const ra = ORDER.indexOf(a.stage); const rb = ORDER.indexOf(b.stage);
  return (ra < 0 ? 99 : ra) - (rb < 0 ? 99 : rb) || String(a.when ?? '9').localeCompare(String(b.when ?? '9'));
});
const issuesOn = (e, field) => (e.issues ?? []).filter((i) => i.field === field);

function Issue({ i, onJump }) {
  return (
    <Space align="start" style={{ width: '100%' }}>
      {levelIcon(i.level)}
      <div style={{ flex: 1 }}>
        <Typography.Text strong>{i.title}</Typography.Text> <Tag>{i.stage}</Tag>
        <div><Typography.Text type="secondary">{i.detail}</Typography.Text></div>
        {(i.ref || i.by) && (
          <div style={{ fontSize: 12 }}>
            {i.ref && <>Entry: {i.event ? <a onClick={() => onJump(i.event)}>{i.ref}</a> : i.ref}</>}
            {i.by && <> · entered by <Typography.Text code>{i.by}</Typography.Text></>}
          </div>
        )}
        {i.fix && <div style={{ fontSize: 12 }}>What to do: {i.fix}</div>}
      </div>
    </Space>
  );
}

/** A grid cell: red when an issue is on this field, orange when it differs from the booking. */
function Cell({ children, issues = [], differs }) {
  const bad = issues.some((i) => i.level === 'error'); const warn = issues.length && !bad;
  const content = <div style={{ background: bad ? RED : warn || differs ? ORANGE : undefined, margin: '-4px -8px', padding: '4px 8px', minHeight: 22 }}>{children}</div>;
  if (!issues.length && !differs) return content;
  return <Tooltip title={issues.length ? issues.map((i) => `${i.title}${i.fix ? ` — ${i.fix}` : ''}`).join(' | ') : 'Different from the booking'}>{content}</Tooltip>;
}

function EntriesGrid({ data, staff, highlight }) {
  const booked = data.events.find((e) => e.key === 'booked');
  const fields = FIELDS.filter((f) => (staff || !f.staff) && data.events.some((e) => valueOf(f, e) !== '' && valueOf(f, e) !== 0 && valueOf(f, e) !== null));
  return (
    <Table size="small" bordered rowKey="key" dataSource={inOrder(data.events)} pagination={false} scroll={{ x: 'max-content' }}
      rowClassName={(e) => (e.key === highlight ? 'ant-table-row-selected' : '')}
      onRow={(e) => ({ id: `row-${e.key}`, style: e.cancelled ? { opacity: 0.55, textDecoration: 'line-through' } : undefined })}
      columns={[
        { title: '#', key: 'n', width: 40, render: (_, __, i) => i + 1, fixed: 'left' },
        { title: 'Stage', dataIndex: 'stage', fixed: 'left', render: (v, e) => <Space size={4}><Tag color={STAGE_COLOR[v] ?? 'default'}>{v}</Tag>{e.cancelled && <Tag>cancelled</Tag>}</Space> },
        ...fields.map((f) => ({
          title: f.label, key: f.key, align: f.num ? 'right' : undefined,
          render: (_, e) => {
            const v = valueOf(f, e);
            const differs = f.num && e.key !== 'booked' && booked && v !== '' && booked.values?.[f.key] !== undefined && f.key !== 'short' && Number(v) !== Number(booked.values[f.key]);
            return <Cell issues={issuesOn(e, f.key)} differs={differs}>{f.num && v !== '' && v !== undefined ? Number(v).toLocaleString('en-IN') : v}</Cell>;
          },
        })),
        {
          title: 'Problems', key: 'issues', render: (_, e) => (e.issues?.length
            ? <Space direction="vertical" size={0}>{e.issues.map((i, k) => <span key={k} style={{ fontSize: 12 }}>{levelIcon(i.level)} {i.title}</span>)}</Space>
            : <CheckCircleFilled style={{ color: '#52c41a' }} />),
        },
      ]} />
  );
}

function FieldGrid({ data, staff }) {
  const booked = data.events.find((e) => e.key === 'booked');
  const cols = inOrder(data.events);
  const fields = FIELDS.filter((f) => (staff || !f.staff) && cols.some((e) => valueOf(f, e) !== '' && valueOf(f, e) !== null && valueOf(f, e) !== undefined));
  const rows = fields.map((f) => ({ key: f.key, field: f }));
  return (
    <Table size="small" bordered rowKey="key" dataSource={rows} pagination={false} scroll={{ x: 'max-content' }}
      columns={[
        { title: 'Field', key: 'f', fixed: 'left', width: 130, render: (_, r) => <Typography.Text strong>{r.field.label}</Typography.Text> },
        ...cols.map((e, ci) => ({
          key: `${e.key}-${ci}`,
          title: <Space direction="vertical" size={0}><Tag color={STAGE_COLOR[e.stage] ?? 'default'} style={{ marginInlineEnd: 0 }}>{e.stage}</Tag><span style={{ fontSize: 11, fontWeight: 'normal' }}>{e.values?.entryNo || ''}</span></Space>,
          align: 'center',
          onHeaderCell: () => ({ style: e.cancelled ? { opacity: 0.55, textDecoration: 'line-through' } : undefined }),
          render: (_, r) => {
            const f = r.field; const v = valueOf(f, e);
            const differs = f.num && e.key !== 'booked' && booked && v !== '' && v !== undefined && booked.values?.[f.key] !== undefined && f.key !== 'short' && Number(v) !== Number(booked.values[f.key]);
            return <Cell issues={issuesOn(e, f.key)} differs={differs}>{f.num && v !== '' && v !== undefined ? Number(v).toLocaleString('en-IN') : v}</Cell>;
          },
        })),
      ]} />
  );
}

export default function TrackingPage() {
  const [params, setParams] = useSearchParams();
  const docket = params.get('docket') || '';
  const [tab, setTab] = useState('grid');
  const [highlight, setHighlight] = useState(null);
  const { data, isFetching, error } = useQuery({
    queryKey: ['journey', docket],
    queryFn: () => api.get(`/dockets/${encodeURIComponent(docket)}/journey`).then((r) => r.data),
    enabled: Boolean(docket),
  });
  const jump = (key) => {
    setTab('grid'); setHighlight(key);
    setTimeout(() => document.getElementById(`row-${key}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 100);
  };
  const d = data?.docket;
  const staff = d ? d.freight !== null : true;
  const current = data ? Math.max(0, data.steps.findLastIndex((s) => s.done)) : 0;
  const sortedIssues = useMemo(() => [...(data?.issues ?? [])].sort((a, b) => (a.level === b.level ? 0 : a.level === 'error' ? -1 : 1)), [data]);

  return (
    <Card className="page-card" title="Docket Tracking">
      <Space direction="vertical" style={{ width: '100%' }} size="large">
        <Input.Search key={docket} defaultValue={docket} placeholder="Enter docket no. (or manual no.)" enterButton="Track" size="large" loading={isFetching}
          style={{ maxWidth: 520 }} onSearch={(v) => v.trim() && setParams({ docket: v.trim() })} />
        {!docket && <Empty description="Enter a docket number to see every entry made on it and any problems" />}
        {docket && isFetching && !data && <Spin />}
        {error && <Result status={error.response?.status === 404 ? '404' : 'warning'} title={errorMessage(error)} />}
        {data && (
          <>
            <Row gutter={[16, 16]}>
              <Col xs={24} lg={14}>
                <Card size="small" title={<Space wrap>
                  <span>Docket {d.docketNo}</span>{d.manualNo && <Typography.Text type="secondary">({d.manualNo})</Typography.Text>}
                  <Tag color={STATUS_COLOR[d.status] ?? 'blue'}>{d.status}</Tag>
                  {d.late && <Tag color="orange">Late</Tag>}
                </Space>} extra={<Space>{HEALTH[d.health].icon}<Typography.Text>{HEALTH[d.health].text}</Typography.Text></Space>}>
                  <Descriptions size="small" column={{ xs: 1, sm: 2 }} items={[
                    { key: 'r', label: 'Route', children: `${d.origin} → ${d.destination}${d.destinationCity && d.destinationCity !== d.destination ? ` (${d.destinationCity})` : ''}` },
                    { key: 'b', label: 'Booked', children: dayjs(d.bookingDate).format('DD/MM/YYYY') },
                    { key: 't', label: 'Type', children: [d.bookingType, d.mode, d.loadType].filter(Boolean).join(' · ') },
                    { key: 'e', label: 'Expected', children: d.expectedDate ? dayjs(d.expectedDate).format('DD/MM/YYYY') : '—' },
                    { key: 'p', label: 'Packages / weight', children: `${d.packages} pkt(s) · ${d.weight} kg` },
                    { key: 'd', label: 'Delivered', children: d.deliveredOn ? `${when(d.deliveredOn)}${d.receiver ? ` — ${d.receiver}` : ''}` : '—' },
                    { key: 'c1', label: 'Consignor', children: [d.consignor.name, d.consignor.city].filter(Boolean).join(', ') || '—' },
                    { key: 'c2', label: 'Consignee', children: [d.consignee.name, d.consignee.city].filter(Boolean).join(', ') || '—' },
                    { key: 'n', label: 'Now at', children: d.currentBranch || '—' },
                    ...(staff ? [{ key: 'f', label: 'Freight', children: `${money(d.freight)}${d.billNo ? ` · bill ${d.billNo}` : ''}` }] : []),
                  ]} />
                </Card>
              </Col>
              <Col xs={24} lg={10}>
                <Card size="small" title={<Space><span>Problems</span><Badge count={data.issues.length} showZero color={data.issues.some((i) => i.level === 'error') ? '#f5222d' : data.issues.length ? '#faad14' : '#52c41a'} /></Space>}
                  styles={{ body: { maxHeight: 330, overflow: 'auto' } }}>
                  {data.issues.length
                    ? <List size="small" dataSource={sortedIssues} renderItem={(i) => <List.Item><Issue i={i} onJump={jump} /></List.Item>} />
                    : <Result status="success" title="Everything looks right" subTitle="Every step is in order, on time and complete." style={{ padding: 8 }} />}
                </Card>
              </Col>
            </Row>

            {d.cancelled && <Alert type="error" showIcon message="This docket is cancelled." />}
            <Steps size="small" current={current} status={data.steps.at(-1).failed ? 'error' : d.status === 'Delivered' ? 'finish' : 'process'} responsive
              items={data.steps.map((s) => ({ title: s.label }))} />

            <Card size="small">
              <Space size={16} wrap style={{ marginBottom: 8, fontSize: 12 }}>
                <span><span style={{ display: 'inline-block', width: 12, height: 12, background: RED, verticalAlign: 'middle' }} /> wrong value / problem on this field</span>
                <span><span style={{ display: 'inline-block', width: 12, height: 12, background: ORANGE, verticalAlign: 'middle' }} /> different from the booking (or a warning)</span>
                <span style={{ opacity: 0.6, textDecoration: 'line-through' }}>cancelled entry</span>
              </Space>
              <Tabs activeKey={tab} onChange={setTab} items={[
                { key: 'grid', label: `Entries grid (${data.events.length})`, children: <EntriesGrid data={data} staff={staff} highlight={highlight} /> },
                { key: 'fields', label: 'Field comparison', children: <FieldGrid data={data} staff={staff} /> },
                {
                  key: 'journey', label: 'Journey',
                  children: (
                    <Timeline items={data.events.map((e) => {
                      const bad = e.issues?.some((i) => i.level === 'error'); const warn = e.issues?.length && !bad;
                      return {
                        color: e.cancelled ? 'gray' : bad ? 'red' : warn ? 'orange' : e.tone === 'good' ? 'green' : e.tone === 'bad' ? 'red' : 'blue',
                        children: (
                          <div>
                            <Typography.Text strong delete={e.cancelled}>{e.title}</Typography.Text>
                            <div><Typography.Text type="secondary">{when(e.when)}{e.place ? ` • ${e.place}` : ''}{e.by ? ` • by ${e.by}` : ''}</Typography.Text></div>
                            {e.details?.length > 0 && <div style={{ fontSize: 13 }}>{e.details.join(' · ')}</div>}
                            {e.issues?.map((i, k) => <div key={k} style={{ fontSize: 12 }}>{levelIcon(i.level)} {i.title}{i.fix ? ` — ${i.fix}` : ''}</div>)}
                          </div>
                        ),
                      };
                    })} />
                  ),
                },
              ]} />
            </Card>
          </>
        )}
      </Space>
    </Card>
  );
}
