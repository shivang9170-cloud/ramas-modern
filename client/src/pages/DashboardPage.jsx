// Analytics dashboard — replaces MainDashboard.aspx / default.aspx. Module tiles (sp_getForMainDashboardAccess) at the top, then
// 86 numbered analyses in five tabs: Overview (KPIs vs the previous period, trend, status, insights), Booking, Operations,
// Billing & money, Vendors & accounts. Filters: period presets or any range, all branches or the current branch.
// Data: /api/dashboard/:section (server/src/modules/dashboard). Charts: components/charts/Charts.jsx (plain SVG).
// Every bar, slice, point, heatmap cell, KPI and table row is clickable: it opens the records behind it (DrillDrawer).
// Live mode re-reads the open tab every 30 s / 1 / 5 min; charts animate to the new numbers (ECharts), KPIs count up and glow.
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useIsFetching, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { Alert, Badge, Button, Card, Col, DatePicker, List, Row, Segmented, Select, Skeleton, Space, Statistic, Switch, Table, Tabs, Tag, Typography } from 'antd';
import {
  BulbOutlined, CarOutlined, ReloadOutlined, CheckCircleOutlined, RiseOutlined, SettingOutlined, TeamOutlined, WalletOutlined, WarningOutlined,
} from '@ant-design/icons';
import { api, errorMessage } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { resolveLegacyUrl } from '../routes/legacyRoutes.js';
import { Bars, ChartCard, Combo, Donut, Funnel, Gauge, Heatmap, Kpi, Lines, PALETTE, Scatter, fmt } from '../components/charts/Charts.jsx';
import { DrillProvider, useDrill } from '../components/charts/DrillDrawer.jsx';

const MODULES = {
  TMS: { icon: <CarOutlined />, label: 'Transport (TMS)', legacy: 'default.aspx' },
  HRM: { icon: <TeamOutlined />, label: 'HRM', legacy: 'HRMDashboard.aspx' },
  'CASH MANAGEMENT': { icon: <WalletOutlined />, label: 'Accounts', legacy: 'AccountDashboard.aspx' },
  MARKETING: { icon: <RiseOutlined />, label: 'Marketing', legacy: 'MarketingDashboard.aspx' },
  ADMIN: { icon: <SettingOutlined />, label: 'Admin', legacy: 'AdminDashboard.aspx' },
};
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const mLabel = (m) => (m ? dayjs(`${m}-01`).format('MMM YY') : '');
const dLabel = (d) => dayjs(d).format('DD MMM');
const pct = (a, b) => (b ? (a / b) * 100 : 0);
const top = (rows, k = 10) => (rows ?? []).slice(0, k);
const S = (key, label, color) => ({ key, label, color });
const View = ({ onClick }) => <Button size="small" type="link" onClick={onClick}>Records</Button>;

const LiveContext = createContext(false);
function useSection(section, filters) {
  const live = useContext(LiveContext);
  return useQuery({
    queryKey: ['dashboard', section, filters],
    queryFn: () => api.get(`/dashboard/${section}`, { params: filters }).then((r) => r.data),
    staleTime: live ? 0 : 120_000,
    refetchInterval: live || false,
    refetchIntervalInBackground: false,
    placeholderData: (prev) => prev,   // keep the charts on screen while new numbers load, so they animate instead of blinking
  });
}
/** Top 5 / 10 / 20 switch for the "top" lists. */
const TopN = ({ value, onChange }) => <Segmented size="small" value={value} onChange={onChange} options={[5, 10, 20]} />;
const Grid = ({ children }) => <Row gutter={[12, 12]}>{children}</Row>;
const Cell = ({ span = 'third', children }) => {
  const sizes = { third: { xs: 24, md: 12, xl: 8 }, half: { xs: 24, lg: 12 }, full: { xs: 24 }, kpi: { xs: 12, md: 8, lg: 6, xxl: 4 }, twothird: { xs: 24, xl: 16 } };
  return <Col {...sizes[span]}>{children}</Col>;
};
function Loading({ q, children }) {
  if (q.isLoading) return <Skeleton active paragraph={{ rows: 10 }} />;
  if (q.error) return <Alert type="error" showIcon message={errorMessage(q.error)} />;
  return children(q.data);
}

// ------------------------------------------------------------------ overview  (#1–#18)
function Overview({ filters }) {
  const q = useSection('overview', filters);
  const drill = useDrill();
  return (
    <Loading q={q}>{(d) => {
      const k = d.kpis; const p = d.previous; const live = k.dockets - k.cancelled; const pl = p.dockets - p.cancelled;
      const spark = (key) => d.daily.map((x) => x[key]);
      const compare = [
        { name: 'Freight', now: k.freight, before: p.freight }, { name: 'Billed', now: k.billed, before: p.billed },
        { name: 'Collected', now: k.collected, before: p.collected }, { name: 'Vehicle hire', now: k.hire, before: p.hire },
      ];
      return (
        <Grid>
          <Cell span="kpi"><Kpi no={1} onSelect={() => drill('Dockets booked (incl. cancelled)', 'dockets', {}, { withCancelled: true })} title="Dockets booked" value={k.dockets} prev={p.dockets} spark={spark('dockets')} /></Cell>
          <Cell span="kpi"><Kpi no={2} onSelect={() => drill('Booked freight', 'dockets')} title="Booked freight" value={k.freight} prev={p.freight} format={fmt.inrShort} spark={spark('freight')} /></Cell>
          <Cell span="kpi"><Kpi no={3} onSelect={() => drill('Charged weight', 'dockets')} title="Charged weight" value={k.weight} prev={p.weight} format={fmt.kg} /></Cell>
          <Cell span="kpi"><Kpi no={4} onSelect={() => drill('Dockets', 'dockets')} title="Avg freight / docket" value={live ? k.freight / live : 0} prev={pl ? p.freight / pl : 0} format={fmt.inr} /></Cell>
          <Cell span="kpi"><Kpi no={5} onSelect={() => drill('Dockets', 'dockets')} title="Freight per kg (yield)" value={k.weight ? k.freight / k.weight : 0} prev={p.weight ? p.freight / p.weight : 0} format={(v) => `₹ ${fmt.dec(v)}`} /></Cell>
          <Cell span="kpi"><Kpi no={6} onSelect={() => drill('Delivered dockets', 'dockets', { stage: 'Delivered' })} title="Delivered %" value={pct(k.delivered, live)} prev={pct(p.delivered, pl)} format={fmt.pct} help="Delivered dockets out of live (not cancelled) dockets booked in the period" /></Cell>
          <Cell span="kpi"><Kpi no={7} onSelect={() => drill('Delivered late (after the expected date)', 'dockets', { on_time: 0 })} title="On-time delivery" value={pct(k.onTime, k.withExpected)} prev={pct(p.onTime, p.withExpected)} format={fmt.pct} help="Delivered on or before the expected date" /></Cell>
          <Cell span="kpi"><Kpi no={8} onSelect={() => drill('Pending deliveries', 'dockets', { pending: 1 })} title="Pending deliveries" value={k.pending} prev={p.pending} invert help="Live dockets of the period not delivered yet (no status, or an undelivered attempt)" /></Cell>
          <Cell span="kpi"><Kpi no={9} onSelect={() => drill('Client bills', 'bills')} title="Billed (client bills)" value={k.billed} prev={p.billed} format={fmt.inrShort} /></Cell>
          <Cell span="kpi"><Kpi no={10} onSelect={() => drill('Receipts', 'receipts')} title="Collected" value={k.collected} prev={p.collected} format={fmt.inrShort} help="Receipts incl. TDS" /></Cell>
          <Cell span="kpi"><Kpi no={11} onSelect={() => drill('Outstanding bills', 'bills', { outstanding: 1 }, { allDates: true })} title="Outstanding today" value={d.outstanding.amount} format={fmt.inrShort} sub={`${d.outstanding.bills} unpaid bill(s)`} /></Cell>
          <Cell span="kpi"><Kpi no={12} onSelect={() => drill('Challans (vehicle hire)', 'challans')} title="Vehicle hire" value={k.hire} prev={p.hire} format={fmt.inrShort} invert sub={k.freight ? ` · margin ${fmt.pct(100 - pct(k.hire, k.freight))}` : ''} /></Cell>
          <Cell span="kpi"><Kpi no={13} onSelect={() => drill('Dockets of all clients', 'dockets')} title="Active clients" value={k.clients} prev={p.clients} /></Cell>
          <Cell span="kpi"><Kpi no={14} onSelect={() => drill('Cancelled dockets', 'dockets', { stage: 'Cancelled' })} title="Cancelled %" value={pct(k.cancelled, k.dockets)} prev={pct(p.cancelled, p.dockets)} format={fmt.pct} invert /></Cell>
          <Cell span="twothird">
            <ChartCard no={15} title="Daily booked freight" help="Freight of the live dockets booked each day" empty={!d.daily.length}>
              <Lines data={d.daily} x="date" xFormat={dLabel} series={[S('freight', 'Freight')]} area format={fmt.inrShort} onSelect={(x) => drill(`Dockets booked on ${dLabel(x.date)}`, 'dockets', { date: x.date })} />
            </ChartCard>
          </Cell>
          <Cell span="third">
            <ChartCard no={16} title="This period vs previous" help={`${d.range.from} – ${d.range.to} against ${d.range.prevFrom} – ${d.range.prevTo}`}>
              <Bars data={compare} x="name" horizontal labelWidth={90} format={fmt.inrShort} series={[S('now', 'This period', PALETTE[0]), S('before', 'Previous', PALETTE[10])]}
                onSelect={(x) => drill(x.name, { Freight: 'dockets', Billed: 'bills', Collected: 'receipts', 'Vehicle hire': 'challans' }[x.name])} />
            </ChartCard>
          </Cell>
          <Cell span="third">
            <ChartCard no={17} title="Where the dockets are now" empty={!d.stages.length}>
              <Donut data={d.stages} name="stage" value="dockets" centerLabel="dockets" onSelect={(x) => drill(`Dockets: ${x.stage}`, 'dockets', { stage: x.stage })} />
            </ChartCard>
          </Cell>
          <Cell span="twothird">
            <ChartCard no={18} title="Insights" help="Findings worked out from the numbers of this period">
              <List size="small" dataSource={d.insights} locale={{ emptyText: 'Not enough data for insights' }}
                renderItem={(i) => (
                  <List.Item>
                    <Space align="start">
                      {i.type === 'good' ? <CheckCircleOutlined style={{ color: PALETTE[1] }} /> : i.type === 'bad' ? <WarningOutlined style={{ color: PALETTE[3] }} /> : <BulbOutlined style={{ color: PALETTE[2] }} />}
                      <span>{i.text}</span>
                    </Space>
                  </List.Item>
                )} />
            </ChartCard>
          </Cell>
        </Grid>
      );
    }}</Loading>
  );
}

// ------------------------------------------------------------------ bookings  (#19–#45)
function Bookings({ filters }) {
  const q = useSection('bookings', filters);
  const drill = useDrill();
  const MIX_COL = ['booking_type_n', 'mode_n', 'load_n', 'docs_n', 'ctype_n', 'gst_n'];
  const [n1, setN1] = useState(10); const [n2, setN2] = useState(10); const [n3, setN3] = useState(10);
  return (
    <Loading q={q}>{(d) => {
      const monthly = d.monthly.map((m, i) => ({ ...m, label: mLabel(m.month), growth: i && d.monthly[i - 1].freight ? pct(m.freight - d.monthly[i - 1].freight, d.monthly[i - 1].freight) : 0 }));
      let run = 0; const cumulative = d.daily.map((x) => ({ date: x.date, total: (run += x.freight) }));
      const weekday = DAYS.map((name, i) => ({ name, dockets: d.weekday.find((w) => w.dow === i)?.dockets ?? 0, freight: d.weekday.find((w) => w.dow === i)?.freight ?? 0 }));
      const hours = Array.from({ length: 24 }, (_, h) => ({ name: `${h}`, dockets: d.hour.find((x) => x.hour === h)?.dockets ?? 0 })).filter((h, i, a) => a.slice(i).some((x) => x.dockets) && a.slice(0, i + 1).some((x) => x.dockets));
      const hourCols = hours.map((h) => h.name);
      const total = d.clients.reduce((t, c) => t + c.freight, 0); let cum = 0;
      const pareto = top(d.clients, 15).map((c) => ({ ...c, share: (cum += c.freight) / (total || 1) * 100 }));
      const branchNames = [...new Set(d.branchMonth.map((r) => r.branch))]; const bmMonths = [...new Set(d.branchMonth.map((r) => r.month))].sort();
      const odaPct = pct(d.oda.oda, d.oda.total);
      return (
        <Grid>
          <Cell span="half">
            <ChartCard no={19} title="Monthly freight and dockets" empty={!monthly.length}>
              <Combo data={monthly} x="label" bars={[S('freight', 'Freight')]} line={S('dockets', 'Dockets')} format={fmt.inrShort} lineFormat={fmt.num} onSelect={(x) => drill(`Dockets of ${x.label}`, 'dockets', { month: x.month })} />
            </ChartCard>
          </Cell>
          <Cell span="half">
            <ChartCard no={20} title="Month-on-month freight growth" help="Change in freight against the month before" empty={monthly.length < 2}>
              <Lines data={monthly.slice(1)} x="label" series={[S('growth', 'Growth %', PALETTE[4])]} format={fmt.pct} min0={false} onSelect={(x) => drill(`Dockets of ${x.label}`, 'dockets', { month: x.month })} />
            </ChartCard>
          </Cell>
          <Cell span="half">
            <ChartCard no={21} title="Cumulative freight in the period" empty={!cumulative.length}>
              <Lines data={cumulative} x="date" xFormat={dLabel} series={[S('total', 'Running total', PALETTE[1])]} area format={fmt.inrShort} onSelect={(x) => drill(`Dockets booked on ${dLabel(x.date)}`, 'dockets', { date: x.date })} />
            </ChartCard>
          </Cell>
          <Cell span="half">
            <ChartCard no={22} title="Daily charged weight" empty={!d.daily.length}>
              <Lines data={d.daily} x="date" xFormat={dLabel} series={[S('weight', 'Weight', PALETTE[5])]} area format={fmt.kg} onSelect={(x) => drill(`Dockets booked on ${dLabel(x.date)}`, 'dockets', { date: x.date })} />
            </ChartCard>
          </Cell>
          <Cell><ChartCard no={23} title="Bookings by weekday"><Bars data={weekday} x="name" series={[S('dockets', 'Dockets')]} format={fmt.num} onSelect={(x) => drill(`Dockets booked on ${x.name}days`, 'dockets', { dow: DAYS.indexOf(x.name) })} /></ChartCard></Cell>
          <Cell><ChartCard no={24} title="Bookings by hour of entry" empty={!hours.length}><Bars data={hours} x="name" series={[S('dockets', 'Dockets', PALETTE[7])]} format={fmt.num} onSelect={(x) => drill(`Dockets entered at ${x.name}:00–${x.name}:59`, 'dockets', { hour: Number(x.name) })} /></ChartCard></Cell>
          <Cell>
            <ChartCard no={25} title="Weekday × hour heatmap" help="When dockets are entered — darker is busier" empty={!d.heat.length}>
              <Heatmap rows={DAYS} cols={hourCols} labelWidth={40} value={(r, c) => d.heat.find((x) => x.dow === r && String(x.hour) === hourCols[c])?.dockets ?? 0}
                onSelect={(r, c) => drill(`Dockets entered on ${DAYS[r]} at ${hourCols[c]}:00`, 'dockets', { dow: r, hour: Number(hourCols[c]) })} />
            </ChartCard>
          </Cell>
          {d.mixes.map((m, i) => (
            <Cell key={m.label}>
              <ChartCard no={26 + i} title={`${m.label} mix`} help="Share of freight" empty={!m.rows.length}>
                <Donut data={m.rows} value="freight" format={fmt.inr} centerLabel="freight" onSelect={(x) => drill(`${m.label}: ${x.name}`, 'dockets', { [MIX_COL[i]]: x.name })} />
              </ChartCard>
            </Cell>
          ))}
          <Cell><ChartCard no={32} title="Weight bands" help="How many dockets fall in each charged-weight band" empty={!d.weightBands.length}><Bars data={d.weightBands} x="band" series={[S('dockets', 'Dockets', PALETTE[5])]} format={fmt.num} onSelect={(x) => drill(`Dockets of ${x.band}`, 'dockets', { weight_band: x.band })} /></ChartCard></Cell>
          <Cell><ChartCard no={33} title="Freight bands (₹ per docket)" empty={!d.freightBands.length}><Bars data={d.freightBands} x="band" series={[S('dockets', 'Dockets', PALETTE[8])]} format={fmt.num} onSelect={(x) => drill(`Dockets with freight ${x.band}`, 'dockets', { freight_band: x.band })} /></ChartCard></Cell>
          <Cell><ChartCard no={34} title={`Top ${n1} clients by freight`} extra={<TopN value={n1} onChange={setN1} />} empty={!d.clients.length}><Bars data={top(d.clients, n1)} x="name" horizontal series={[S('freight', 'Freight')]} format={fmt.inrShort} onSelect={(x) => drill(`Dockets of ${x.name}`, 'dockets', { client: x.name })} /></ChartCard></Cell>
          <Cell>
            <ChartCard no={35} title={`Top ${n2} clients by dockets`} extra={<TopN value={n2} onChange={setN2} />} empty={!d.clients.length}>
              <Bars data={top([...d.clients].sort((a, b) => b.dockets - a.dockets), n2)} x="name" horizontal series={[S('dockets', 'Dockets', PALETTE[1])]} format={fmt.num} onSelect={(x) => drill(`Dockets of ${x.name}`, 'dockets', { client: x.name })} />
            </ChartCard>
          </Cell>
          <Cell span="half">
            <ChartCard no={36} title="Client concentration (Pareto)" help="Freight of the top clients and their cumulative share — how much depends on a few clients" empty={!pareto.length}>
              <Combo data={pareto} x="name" bars={[S('freight', 'Freight')]} line={S('share', 'Cumulative share')} format={fmt.inrShort} lineMax={100} onSelect={(x) => drill(`Dockets of ${x.name}`, 'dockets', { client: x.name })} />
            </ChartCard>
          </Cell>
          <Cell><ChartCard no={37} title={`Top ${n3} destinations`} extra={<TopN value={n3} onChange={setN3} />} empty={!d.destinations.length}><Bars data={top(d.destinations, n3)} x="name" horizontal series={[S('dockets', 'Dockets', PALETTE[4])]} format={fmt.num} onSelect={(x) => drill(`Dockets to ${x.name}`, 'dockets', { dest_label: x.name })} /></ChartCard></Cell>
          <Cell span="twothird">
            <ChartCard no={38} title="Lanes (origin → destination)" help="Volume, freight and yield of each route">
              <Table size="small" rowKey="lane" dataSource={d.lanes} onRow={(r) => ({ onClick: () => drill(`Dockets ${r.origin} → ${r.destination}`, 'dockets', { lane: r.lane }), style: { cursor: 'pointer' } })} pagination={{ pageSize: 6, size: 'small' }} scroll={{ x: 'max-content' }}
                columns={[
                  { title: 'Lane', dataIndex: 'origin', render: (v, r) => `${v ?? ''} → ${r.destination ?? ''}` },
                  { title: 'Dockets', dataIndex: 'dockets', align: 'right', sorter: (a, b) => a.dockets - b.dockets, defaultSortOrder: 'descend' },
                  { title: 'Freight', dataIndex: 'freight', align: 'right', render: fmt.inr, sorter: (a, b) => a.freight - b.freight },
                  { title: 'Avg weight', dataIndex: 'avg_weight', align: 'right', render: fmt.kg },
                  { title: '₹ / kg', dataIndex: 'per_kg', align: 'right', render: fmt.dec, sorter: (a, b) => a.per_kg - b.per_kg },
                ]} />
            </ChartCard>
          </Cell>
          <Cell>
            <ChartCard no={39} title="Lane yield vs load size" help="Each bubble is a lane: average weight (x), ₹ per kg (y), size = dockets" empty={!d.lanes.length}>
              <Scatter data={d.lanes} x="avg_weight" y="per_kg" size="dockets" label="lane" xLabel="avg kg" yLabel="₹/kg" xFormat={fmt.short} yFormat={fmt.dec} onSelect={(x) => drill(`Dockets ${x.origin} → ${x.destination}`, 'dockets', { lane: x.lane })} />
            </ChartCard>
          </Cell>
          <Cell><ChartCard no={40} title="Freight by booking branch" empty={!d.branches.length}><Bars data={d.branches} x="name" horizontal series={[S('freight', 'Freight', PALETTE[2])]} format={fmt.inrShort} onSelect={(x) => drill(`Dockets booked at ${x.name}`, 'dockets', { origin_name: x.name })} /></ChartCard></Cell>
          <Cell span="twothird">
            <ChartCard no={41} title="Branch × month heatmap (freight)" empty={!branchNames.length}>
              <Heatmap rows={branchNames} cols={bmMonths.map(mLabel)} labelWidth={110} format={fmt.inr}
                value={(r, c) => d.branchMonth.find((x) => x.branch === branchNames[r] && x.month === bmMonths[c])?.freight ?? 0} color={PALETTE[2]}
                onSelect={(r, c) => drill(`Dockets booked at ${branchNames[r]} in ${mLabel(bmMonths[c])}`, 'dockets', { origin_name: branchNames[r], month: bmMonths[c] })} />
            </ChartCard>
          </Cell>
          <Cell><ChartCard no={42} title="ODA share" help="Dockets to out-of-delivery-area locations" extra={<View onClick={() => drill('ODA dockets', 'dockets', { oda: 1 })} />}><Gauge value={odaPct} label={`${d.oda.oda} of ${d.oda.total} dockets`} good={0} /></ChartCard></Cell>
          <Cell><ChartCard no={43} title="Yield by mode (₹ per kg)" empty={!d.yieldByMode.length}><Bars data={d.yieldByMode} x="name" series={[S('per_kg', '₹ / kg', PALETTE[6])]} format={fmt.dec} onSelect={(x) => drill(`Dockets by ${x.name}`, 'dockets', { mode_n: x.name })} /></ChartCard></Cell>
          <Cell><ChartCard no={44} title="Cancellation rate by branch" empty={!d.cancelByBranch.length}><Bars data={d.cancelByBranch} x="name" horizontal series={[S('pct', 'Cancelled %', PALETTE[3])]} format={fmt.pct} onSelect={(x) => drill(`Cancelled dockets of ${x.name}`, 'dockets', { origin_name: x.name, cancelled: 1 })} /></ChartCard></Cell>
          <Cell><ChartCard no={45} title="Average freight by booking type" empty={!d.avgByType.length}><Bars data={d.avgByType} x="name" series={[S('freight', 'Avg freight', PALETTE[9])]} format={fmt.inrShort} onSelect={(x) => drill(`${x.name} dockets`, 'dockets', { booking_type_n: x.name })} /></ChartCard></Cell>
        </Grid>
      );
    }}</Loading>
  );
}

// ------------------------------------------------------------------ operations  (#46–#64)
function Operations({ filters }) {
  const q = useSection('operations', filters);
  const drill = useDrill();
  const [nv, setNv] = useState(10);
  const STEP = { Booked: {}, Manifested: { stage: 'Manifested' }, Dispatched: { stage: 'In transit' }, Arrived: { stage: 'Arrived' }, 'Out for delivery': { stage: 'Out for delivery' }, Delivered: { stage: 'Delivered' } };
  return (
    <Loading q={q}>{(d) => {
      const f = d.funnel;
      const steps = [['Booked', f.booked], ['Manifested', f.manifested], ['Dispatched', f.dispatched], ['Arrived', f.arrived], ['Out for delivery', f.out_for_delivery], ['Delivered', f.delivered]]
        .map(([label, value]) => ({ label, value: value ?? 0 }));
      const hire = d.hireMonthly.map((m) => ({ ...m, label: mLabel(m.month), margin: m.freight ? 100 - pct(m.hire, m.freight) : 0 }));
      const drivers = d.drivers.map((r) => ({ ...r, rate: pct(r.delivered, r.dockets) }));
      return (
        <Grid>
          <Cell span="half"><ChartCard no={46} title="Docket pipeline (funnel)" help="How far the period's live dockets have got"><Funnel steps={steps} onSelect={(s) => drill(s.label === 'Booked' ? 'All live dockets' : `Dockets now at: ${s.label}`, 'dockets', STEP[s.label])} /></ChartCard></Cell>
          <Cell><ChartCard no={47} title="Current stage" empty={!d.stages.length}><Donut data={d.stages} value="dockets" centerLabel="dockets" onSelect={(x) => drill(`Dockets: ${x.name}`, 'dockets', { stage: x.name })} /></ChartCard></Cell>
          <Cell><ChartCard no={48} title="Delivery outcomes" empty={!d.outcomes.length}><Donut data={d.outcomes} value="dockets" centerLabel="attempts" onSelect={(x) => drill(`Delivery outcome: ${x.name}`, 'dockets', { outcome: x.name })} /></ChartCard></Cell>
          <Cell>
            <ChartCard no={49} title="Booking-to-delivery days" help="How many dockets were delivered after n days" empty={!d.transit.length}>
              <Bars data={d.transit.map((t) => ({ ...t, name: `${t.days} d` }))} x="name" series={[S('dockets', 'Dockets', PALETTE[5])]} format={fmt.num} onSelect={(x) => drill(`Delivered after ${x.days} day(s)`, 'dockets', { transit: x.days, outcome: 'Delivered' })} />
            </ChartCard>
          </Cell>
          <Cell span="half">
            <ChartCard no={50} title="Transit days and on-time % by destination" empty={!d.transitByDest.length}>
              <Combo data={d.transitByDest} x="name" bars={[S('days', 'Avg days', PALETTE[0])]} line={S('on_time', 'On-time %', PALETTE[1])} format={fmt.days} lineMax={100} onSelect={(x) => drill(`Delivered at ${x.name}`, 'dockets', { dest_name: x.name, outcome: 'Delivered' })} />
            </ChartCard>
          </Cell>
          <Cell><ChartCard no={51} title="Average transit days by mode" empty={!d.transitByMode.length}><Bars data={d.transitByMode} x="name" series={[S('days', 'Avg days', PALETTE[4])]} format={fmt.days} onSelect={(x) => drill(`Delivered dockets by ${x.name}`, 'dockets', { mode_n: x.name, outcome: 'Delivered' })} /></ChartCard></Cell>
          <Cell span="half">
            <ChartCard no={52} title="On-time delivery trend" empty={!d.onTimeMonthly.length}>
              <Lines data={d.onTimeMonthly} x="month" xFormat={mLabel} series={[S('on_time', 'On-time %', PALETTE[1])]} format={fmt.pct} onSelect={(x) => drill(`Late deliveries of ${mLabel(x.month)}`, 'dockets', { month: x.month, on_time: 0 })} />
            </ChartCard>
          </Cell>
          <Cell><ChartCard no={53} title="Pending dockets by age" help="Live dockets not yet delivered (incl. undelivered attempts), by days since booking" empty={!d.ageing.length}><Bars data={d.ageing} x="bucket" series={[S('dockets', 'Dockets', PALETTE[3])]} format={fmt.num} onSelect={(x) => drill(`Pending dockets, ${x.bucket} old`, 'dockets', { pending: 1, age_bucket: x.bucket })} /></ChartCard></Cell>
          <Cell><ChartCard no={54} title="Undelivered / RTO / lost reasons" empty={!d.reasons.length}><Bars data={d.reasons} x="name" horizontal labelWidth={170} series={[S('dockets', 'Dockets', PALETTE[7])]} format={fmt.num} onSelect={(x) => drill(`Dockets: ${x.name}`, 'dockets', { reason: x.name })} /></ChartCard></Cell>
          <Cell span="half">
            <ChartCard no={55} title="Manifests per day" empty={!d.manifests.length}>
              <Lines data={d.manifests} x="date" xFormat={dLabel} series={[S('manifests', 'Manifests'), S('dockets', 'Dockets', PALETTE[1])]} format={fmt.num} onSelect={(x) => drill(`Manifests of ${dLabel(x.date)}`, 'manifests', { date: x.date })} />
            </ChartCard>
          </Cell>
          <Cell><ChartCard no={56} title="Vehicle hire by vendor" extra={<TopN value={nv} onChange={setNv} />} empty={!d.vendors.length}><Bars data={top(d.vendors, nv)} x="name" horizontal series={[S('hire', 'Hire')]} format={fmt.inrShort} onSelect={(x) => drill(`Challans of ${x.name}`, 'challans', { vendor: x.name })} /></ChartCard></Cell>
          <Cell span="half">
            <ChartCard no={57} title="Freight vs vehicle hire, gross margin %" help="Freight booked against challan hire in the same month" empty={!hire.length}>
              <Combo data={hire} x="label" bars={[S('freight', 'Freight', PALETTE[1]), S('hire', 'Hire', PALETTE[3])]} line={S('margin', 'Margin %', PALETTE[4])} format={fmt.inrShort} lineMax={100}
                onSelect={(x, s) => (s?.key === 'freight' ? drill(`Dockets of ${x.label}`, 'dockets', { month: x.month }) : drill(`Challans of ${x.label}`, 'challans', { month: x.month }))} />
            </ChartCard>
          </Cell>
          <Cell><ChartCard no={58} title="Advance vs balance by vendor type" empty={!d.vendorType.length}><Bars data={d.vendorType} x="name" horizontal stacked series={[S('advance', 'Advance', PALETTE[2]), S('balance', 'Balance', PALETTE[0])]} format={fmt.inrShort} onSelect={(x) => drill(`Challans: ${x.name}`, 'challans', { vendor_type_n: x.name })} /></ChartCard></Cell>
          <Cell><ChartCard no={59} title="Vehicle load utilisation" help="Challan weight against vehicle capacity" empty={!d.utilisation.length}><Bars data={d.utilisation} x="band" series={[S('challans', 'Challans', PALETTE[5])]} format={fmt.num} onSelect={(x) => drill(`Challans loaded ${x.band}`, 'challans', { util_band: x.band })} /></ChartCard></Cell>
          <Cell><ChartCard no={60} title="Pickups per month" empty={!d.pickups.length}><Bars data={d.pickups.map((x) => ({ ...x, label: mLabel(x.month) }))} x="label" series={[S('pickups', 'Pickups'), S('dockets', 'Dockets', PALETTE[1])]} format={fmt.num} onSelect={(x) => drill(`Pickups of ${x.label}`, 'pickups', { month: x.month })} /></ChartCard></Cell>
          <Cell><ChartCard no={61} title="POD status of delivered dockets" empty={!d.pod.length}><Donut data={d.pod} value="dockets" centerLabel="delivered" onSelect={(x) => drill(`Delivered dockets: ${x.name}`, 'dockets', { pod_status: x.name })} /></ChartCard></Cell>
          <Cell><ChartCard no={62} title="POD turnaround (days after delivery)" empty={!d.podDays.length}><Bars data={d.podDays.map((x) => ({ ...x, name: `${x.days} d` }))} x="name" series={[S('dockets', 'Dockets', PALETTE[8])]} format={fmt.num} onSelect={(x) => drill(`POD received ${x.days} day(s) after delivery`, 'dockets', { pod_days: x.days })} /></ChartCard></Cell>
          <Cell>
            <ChartCard no={63} title="Arrival weight differences">
              <Row gutter={12}>
                <Col span={8}><Statistic title="Arrivals" value={d.shortage.arrivals ?? 0} /></Col>
                <Col span={8}><Statistic title="With difference" value={d.shortage.with_difference ?? 0} valueStyle={{ color: d.shortage.with_difference ? PALETTE[3] : undefined }} /></Col>
                <Col span={8}><Statistic title="Kg difference" value={d.shortage.kg ?? 0} /></Col>
              </Row>
              <Gauge value={100 - pct(d.shortage.with_difference ?? 0, d.shortage.arrivals ?? 0)} label="arrivals without a weight difference" />
            </ChartCard>
          </Cell>
          <Cell span="half">
            <ChartCard no={64} title="Delivery staff productivity" help="Dockets taken out on DRS and how many were delivered" empty={!drivers.length}>
              <Table size="small" rowKey="name" dataSource={drivers} onRow={(r) => ({ onClick: () => drill(`Dockets delivered by ${r.name}`, 'dockets', { driver: r.name }), style: { cursor: 'pointer' } })} pagination={{ pageSize: 6, size: 'small' }}
                columns={[
                  { title: 'Delivered by', dataIndex: 'name' }, { title: 'DRS', dataIndex: 'drs', align: 'right' },
                  { title: 'Dockets', dataIndex: 'dockets', align: 'right', sorter: (a, b) => a.dockets - b.dockets },
                  { title: 'Delivered', dataIndex: 'delivered', align: 'right' },
                  { title: 'Success', dataIndex: 'rate', align: 'right', render: (v) => <Tag color={v >= 90 ? 'green' : v >= 75 ? 'gold' : 'red'}>{fmt.pct(v)}</Tag>, sorter: (a, b) => a.rate - b.rate },
                ]} />
            </ChartCard>
          </Cell>
        </Grid>
      );
    }}</Loading>
  );
}

// ------------------------------------------------------------------ billing and money  (#65–#78)
function Billing({ filters }) {
  const q = useSection('billing', filters);
  const drill = useDrill();
  const BT = { paid: 'Paid', topay: 'To Pay', tbb: 'To Be Billed' };
  const [no, setNo] = useState(10);
  return (
    <Loading q={q}>{(d) => {
      const bvc = d.billedVsCollected.map((m) => ({ ...m, label: mLabel(m.month), eff: pct(m.collected, m.billed) }));
      const otherMonths = [...new Set(d.other.map((r) => r.month))].sort();
      const other = otherMonths.map((m) => ({ label: mLabel(m), ...Object.fromEntries(['Miscellaneous', 'Warehouse', 'Octroi'].map((k) => [k, d.other.find((r) => r.month === m && r.kind === k)?.amount ?? 0])) }));
      const lag = d.lags;
      return (
        <Grid>
          <Cell span="half">
            <ChartCard no={65} title="Billed vs collected by month" empty={!bvc.length}>
              <Bars data={bvc} x="label" series={[S('billed', 'Billed', PALETTE[0]), S('collected', 'Collected', PALETTE[1])]} format={fmt.inrShort}
                onSelect={(x, s) => (s.key === 'billed' ? drill(`Bills of ${x.label}`, 'bills', { month: x.month }) : drill(`Receipts of ${x.label}`, 'receipts', { month: x.month }))} />
            </ChartCard>
          </Cell>
          <Cell span="half">
            <ChartCard no={66} title="Collection efficiency" help="Collected (incl. TDS) as % of billed in the same month" empty={!bvc.length}>
              <Lines data={bvc} x="label" series={[S('eff', 'Collected / billed %', PALETTE[1])]} format={fmt.pct} onSelect={(x) => drill(`Receipts of ${x.label}`, 'receipts', { month: x.month })} />
            </ChartCard>
          </Cell>
          <Cell><ChartCard no={67} title="Bill status (amount)" empty={!d.statuses.length}><Donut data={d.statuses} value="amount" format={fmt.inr} centerLabel="billed" onSelect={(x) => drill(`Bills: ${x.name}`, 'bills', { status: x.name })} /></ChartCard></Cell>
          <Cell><ChartCard no={68} title="Receivables ageing" help="Unpaid amount by days past the due date" empty={!d.ageing.length}><Bars data={d.ageing} x="bucket" series={[S('amount', 'Outstanding', PALETTE[3])]} format={fmt.inrShort} colorBy={(r) => PALETTE[[1, 2, 7, 3, 3][r.o - 1] ?? 0]} onSelect={(x) => drill(`Outstanding bills: ${x.bucket}`, 'bills', { outstanding: 1, overdue_bucket: x.bucket }, { allDates: true })} /></ChartCard></Cell>
          <Cell><ChartCard no={69} title="Top outstanding clients" extra={<TopN value={no} onChange={setNo} />} empty={!d.outstandingClients.length}><Bars data={top(d.outstandingClients, no)} x="name" horizontal series={[S('due', 'Due', PALETTE[3])]} format={fmt.inrShort} onSelect={(x) => drill(`Outstanding bills of ${x.name}`, 'bills', { outstanding: 1, client_name: x.name }, { allDates: true })} /></ChartCard></Cell>
          <Cell><ChartCard no={70} title="Collections by payment mode" empty={!d.modes.length}><Donut data={d.modes} value="amount" format={fmt.inr} centerLabel="received" onSelect={(x) => drill(`Receipts by ${x.name}`, 'receipts', { mode_n: x.name })} /></ChartCard></Cell>
          <Cell><ChartCard no={71} title="TDS and deductions by month" empty={!d.tdsMonthly.length}><Bars data={d.tdsMonthly.map((x) => ({ ...x, label: mLabel(x.month) }))} x="label" stacked series={[S('tds', 'TDS', PALETTE[4]), S('deduction', 'Deduction', PALETTE[7])]} format={fmt.inrShort} onSelect={(x) => drill(`Receipts of ${x.label}`, 'receipts', { month: x.month })} /></ChartCard></Cell>
          <Cell span="kpi"><Kpi no={72} onSelect={() => drill('Delivered, not yet billed', 'dockets', { unbilled: 1 })} title="Delivered, not yet billed" value={d.unbilled.freight ?? 0} format={fmt.inrShort} sub={`${d.unbilled.dockets ?? 0} To Be Billed docket(s)`} help="Revenue waiting for a client bill" /></Cell>
          <Cell><ChartCard no={73} title="Unbilled dockets by age" help="Days since delivery" empty={!d.unbilledAge.length}><Bars data={d.unbilledAge} x="bucket" series={[S('freight', 'Freight', PALETTE[2])]} format={fmt.inrShort} onSelect={(x) => drill(`Unbilled dockets, delivered ${x.bucket} ago`, 'dockets', { unbilled: 1, unbilled_bucket: x.bucket })} /></ChartCard></Cell>
          <Cell>
            <ChartCard no={74} title="Billing cycle (average days)" extra={<View onClick={() => drill('Client bills', 'bills')} />}>
              <Row gutter={[12, 12]}>
                <Col span={12}><Statistic title="Period end → bill" value={lag.days_to_bill ?? 0} precision={1} suffix="d" /></Col>
                <Col span={12}><Statistic title="Bill → submitted" value={lag.days_to_submit ?? 0} precision={1} suffix="d" /></Col>
                <Col span={12}><Statistic title="Bill → finalized" value={lag.days_to_finalize ?? 0} precision={1} suffix="d" /></Col>
                <Col span={12}><Statistic title="Bill → paid (DSO)" value={lag.days_to_collect ?? 0} precision={1} suffix="d" /></Col>
              </Row>
            </ChartCard>
          </Cell>
          <Cell span="half"><ChartCard no={75} title="Other bills by month" empty={!other.length}><Bars data={other} x="label" stacked series={[S('Miscellaneous', 'Miscellaneous', PALETTE[0]), S('Warehouse', 'Warehouse', PALETTE[5]), S('Octroi', 'Octroi', PALETTE[2])]} format={fmt.inrShort} onSelect={(x, s) => drill(`${s.label} bills of ${x.label}`, 'otherbills', { kind: s.key, month: x.month })} /></ChartCard></Cell>
          <Cell><ChartCard no={76} title="Revenue mix" empty={!d.revenueMix.length}><Donut data={d.revenueMix} value="amount" format={fmt.inr} centerLabel="billed" onSelect={(x) => drill(x.name, 'otherbills', { kind: x.name })} /></ChartCard></Cell>
          <Cell span="half"><ChartCard no={77} title="Paid / To Pay / To Be Billed freight by month" empty={!d.cashShare.length}><Bars data={d.cashShare.map((x) => ({ ...x, label: mLabel(x.month) }))} x="label" stacked series={[S('paid', 'Paid', PALETTE[1]), S('topay', 'To Pay', PALETTE[2]), S('tbb', 'To Be Billed', PALETTE[0])]} format={fmt.inrShort} onSelect={(x, s) => drill(`${s.label} dockets of ${x.label}`, 'dockets', { month: x.month, booking_type_n: BT[s.key] })} /></ChartCard></Cell>
          <Cell><ChartCard no={78} title="Bill size distribution" empty={!d.billSizes.length}><Bars data={d.billSizes} x="band" series={[S('bills', 'Bills', PALETTE[8])]} format={fmt.num} onSelect={(x) => drill(`Bills of ${x.band}`, 'bills', { size_band: x.band })} /></ChartCard></Cell>
        </Grid>
      );
    }}</Loading>
  );
}

// ------------------------------------------------------------------ vendors and accounts  (#79–#86)
function Accounts({ filters }) {
  const q = useSection('accounts', filters);
  const drill = useDrill();
  return (
    <Loading q={q}>{(d) => {
      const fran = [...new Set(d.franchisee.map((r) => r.month))].sort().map((m) => ({
        month: m, label: mLabel(m), commission: d.franchisee.filter((r) => r.month === m).reduce((t, r) => t + r.commission, 0), fixed: d.franchisee.filter((r) => r.month === m).reduce((t, r) => t + r.fixed, 0),
      }));
      return (
        <Grid>
          <Cell><ChartCard no={79} title="Vendor expenses by ledger" empty={!d.expenses.length}><Bars data={d.expenses} x="name" horizontal series={[S('taxable', 'Taxable', PALETTE[7])]} format={fmt.inrShort} onSelect={(x) => drill(`Vendor invoices: ${x.name}`, 'vendorinvoices', { ledger: x.name })} /></ChartCard></Cell>
          <Cell span="twothird"><ChartCard no={80} title="Other vendor invoices by month" empty={!d.vendorMonthly.length}><Bars data={d.vendorMonthly.map((x) => ({ ...x, label: mLabel(x.month) }))} x="label" stacked series={[S('taxable', 'Taxable', PALETTE[0]), S('gst', 'Input GST', PALETTE[5]), S('tds', 'TDS', PALETTE[4])]} format={fmt.inrShort} onSelect={(x) => drill(`Vendor invoices of ${x.label}`, 'vendorinvoices', { month: x.month })} /></ChartCard></Cell>
          <Cell span="half"><ChartCard no={81} title="Franchisee commission by month" empty={!fran.length}><Bars data={fran} x="label" stacked series={[S('commission', 'Commission', PALETTE[1]), S('fixed', 'Rent / mobile / signage', PALETTE[2])]} format={fmt.inrShort} onSelect={(x) => drill(`Franchisee invoices of ${x.label}`, 'franchisee', { month: x.month })} /></ChartCard></Cell>
          <Cell span="half"><ChartCard no={82} title="Vouchers by type" empty={!d.voucherModes.length}><Bars data={d.voucherModes} x="name" horizontal labelWidth={160} series={[S('vouchers', 'Vouchers', PALETTE[8])]} format={fmt.num} onSelect={(x) => drill(`Vouchers: ${x.name}`, 'vouchers', { mode_n: x.name })} /></ChartCard></Cell>
          <Cell span="half"><ChartCard no={83} title="Debit and credit by month" empty={!d.drcr.length}><Bars data={d.drcr.map((x) => ({ ...x, label: mLabel(x.month) }))} x="label" series={[S('dr', 'Dr', PALETTE[0]), S('cr', 'Cr', PALETTE[1])]} format={fmt.inrShort} onSelect={(x) => drill(`Voucher lines of ${x.label}`, 'vouchers', { month: x.month })} /></ChartCard></Cell>
          <Cell><ChartCard no={84} title="Transport vendor bills verified" empty={!d.vendorBills.length}><Bars data={d.vendorBills} x="name" horizontal stacked series={[S('paid', 'Verified payment', PALETTE[1]), S('pending', 'Pending', PALETTE[3])]} format={fmt.inrShort} onSelect={(x) => drill(`Verified bills of ${x.name}`, 'vendorbills', { vendor: x.name })} /></ChartCard></Cell>
          <Cell span="half"><ChartCard no={85} title="Cash vs bank receipts" empty={!d.receiptsByMode.length}><Bars data={d.receiptsByMode.map((x) => ({ ...x, label: mLabel(x.month) }))} x="label" stacked series={[S('cash', 'Cash', PALETTE[2]), S('bank', 'Bank', PALETTE[0])]} format={fmt.inrShort} onSelect={(x, s) => drill(`${s.label} receipts of ${x.label}`, 'receipts', { month: x.month, cash_bank: s.label })} /></ChartCard></Cell>
          <Cell span="half">
            <ChartCard no={86} title="Most active ledgers" empty={!d.topLedgers.length}>
              <Table size="small" rowKey="name" dataSource={d.topLedgers} pagination={false} onRow={(r) => ({ onClick: () => drill(`Voucher lines of ${r.name}`, 'vouchers', { ledger: r.name }), style: { cursor: 'pointer' } })}
                columns={[{ title: 'Ledger', dataIndex: 'name', ellipsis: true }, { title: 'Dr', dataIndex: 'dr', align: 'right', render: fmt.inr },
                  { title: 'Cr', dataIndex: 'cr', align: 'right', render: fmt.inr }, { title: 'Net', dataIndex: 'net', align: 'right', render: (v) => <Typography.Text type={v < 0 ? 'danger' : undefined}>{fmt.inr(v)}</Typography.Text> }]} />
            </ChartCard>
          </Cell>
        </Grid>
      );
    }}</Loading>
  );
}

// ------------------------------------------------------------------ page
function presets(fy) {
  const t = dayjs();
  const [y] = String(fy || '').split('-').map(Number);
  const fyStart = y ? dayjs(`${y}-04-01`) : t.startOf('year');
  const fyEnd = fyStart.add(1, 'year').subtract(1, 'day');
  return {
    month: [t.startOf('month'), t], d30: [t.subtract(29, 'day'), t], d90: [t.subtract(89, 'day'), t],
    fy: [fyStart, fyEnd.isAfter(t) ? t : fyEnd], m12: [t.subtract(1, 'year').add(1, 'day'), t],
  };
}

export default function DashboardPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [preset, setPreset] = useState('d90');
  const ranges = useMemo(() => presets(user.financialYear), [user.financialYear]);
  const [range, setRange] = useState(ranges.d90);
  const [scope, setScope] = useState('all');
  const [tab, setTab] = useState('overview');
  const [live, setLive] = useState(false);
  const [every, setEvery] = useState(60_000);
  const [updated, setUpdated] = useState(null);
  const queryClient = useQueryClient();
  const fetching = useIsFetching({ queryKey: ['dashboard'] });
  const wasFetching = useRef(0);
  useEffect(() => { if (wasFetching.current && !fetching) setUpdated(new Date()); wasFetching.current = fetching; }, [fetching]);
  // in live mode a relative period moves with the clock (e.g. "30 days" keeps ending today)
  useEffect(() => {
    if (!live || preset === 'custom') return undefined;
    const id = setInterval(() => { const r = presets(user.financialYear)[preset]; if (r && !r[1].isSame(range[1], 'day')) setRange(r); }, 60_000);
    return () => clearInterval(id);
  }, [live, preset, range, user.financialYear]);
  const filters = { from: range[0].format('YYYY-MM-DD'), to: range[1].format('YYYY-MM-DD'), scope };
  const { data: modules } = useQuery({ queryKey: ['modules'], queryFn: () => api.get('/menu/modules').then((r) => r.data) });

  return (
    <div className="page-card">
      <Space wrap align="center" style={{ width: '100%', justifyContent: 'space-between', marginBottom: 12 }}>
        <div>
          <Typography.Title level={3} style={{ margin: 0 }}>Welcome, {user.userName || user.userId}</Typography.Title>
          <Typography.Text type="secondary">{user.divName} · FY {user.financialYear} · {user.currentBranch.name} : {user.currentBranch.code} · 86 analyses</Typography.Text>
        </div>
        <Space wrap>
          {(modules ?? []).map((m) => {
            const mod = MODULES[m] ?? { icon: <SettingOutlined />, label: m, legacy: '' };
            return <Tag key={m} icon={mod.icon} style={{ cursor: 'pointer', padding: '2px 8px' }} onClick={() => navigate(resolveLegacyUrl(mod.legacy) ?? '/')}>{mod.label}</Tag>;
          })}
        </Space>
      </Space>
      <Card size="small" style={{ marginBottom: 12 }}>
        <Space wrap>
          <Segmented value={preset} onChange={(v) => { setPreset(v); if (ranges[v]) setRange(ranges[v]); }}
            options={[{ value: 'month', label: 'This month' }, { value: 'd30', label: '30 days' }, { value: 'd90', label: '90 days' },
              { value: 'fy', label: 'This FY' }, { value: 'm12', label: '12 months' }, { value: 'custom', label: 'Custom' }]} />
          <DatePicker.RangePicker value={range} format="DD/MM/YYYY" allowClear={false} disabledDate={(d) => d.isAfter(dayjs(), 'day')}
            onChange={(v) => { if (v) { setRange(v); setPreset('custom'); } }} />
          <Segmented value={scope} onChange={setScope} options={[{ value: 'all', label: 'All branches' }, { value: 'branch', label: `Only ${user.currentBranch.name}` }]} />
          <Space size={6}>
            <Switch checked={live} onChange={setLive} checkedChildren="Live" unCheckedChildren="Live" aria-label="Live auto-refresh" />
            <Select size="small" value={every} onChange={setEvery} disabled={!live} style={{ width: 92 }} aria-label="Refresh every"
              options={[{ value: 30_000, label: 'every 30 s' }, { value: 60_000, label: 'every 1 min' }, { value: 300_000, label: 'every 5 min' }]} />
            <Button size="small" icon={<ReloadOutlined spin={Boolean(fetching)} />} onClick={() => queryClient.invalidateQueries({ queryKey: ['dashboard'] })}>Refresh</Button>
            {updated && <Badge status={live ? 'processing' : 'default'} text={<Typography.Text type="secondary" style={{ fontSize: 12 }}>updated {dayjs(updated).format('HH:mm:ss')}</Typography.Text>} />}
          </Space>
        </Space>
      </Card>
      <LiveContext.Provider value={live ? every : false}>
      <DrillProvider filters={filters}>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>Click any bar, slice, point, cell, number or table row to see the records behind it. Hover for details, click a legend entry to hide / show it, drag the slider or Shift + wheel to zoom, use the small icons to switch bar / line / stacked, see the data or save the chart as an image.</Typography.Paragraph>
      <Tabs activeKey={tab} onChange={setTab} destroyOnHidden items={[
        { key: 'overview', label: 'Overview (1–18)', children: <Overview filters={filters} /> },
        { key: 'bookings', label: 'Booking (19–45)', children: <Bookings filters={filters} /> },
        { key: 'operations', label: 'Operations (46–64)', children: <Operations filters={filters} /> },
        { key: 'billing', label: 'Billing & money (65–78)', children: <Billing filters={filters} /> },
        { key: 'accounts', label: 'Vendors & accounts (79–86)', children: <Accounts filters={filters} /> },
      ]} />
      </DrillProvider>
      </LiveContext.Provider>
    </div>
  );
}
