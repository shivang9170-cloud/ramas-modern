// Manifest entry — replaces Operation/menifest.aspx.
// Pick a destination (branch for Sundry, city for FTL), list dockets lying at
// this branch for it, tick them (packages can be split), and save. "From loading sheet"
// limits the list to an open loading sheet's dockets; saving marks the sheet manifested.
// Courier divisions also bag the dockets (packets → bags → master bags, BaggingPanel.jsx) in the same save; TMS
// divisions (cargo / FTL) never see it — one entry for the whole docket.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import {
  Alert, App, Button, Card, Col, DatePicker, Empty, Form, Input, InputNumber, Radio, Row, Select, Space, Table,
  TimePicker, Typography,
} from 'antd';
import { PrinterOutlined, SaveOutlined, SearchOutlined } from '@ant-design/icons';
import { api, errorMessage } from '../../api/client.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import SearchSelect from '../../components/SearchSelect.jsx';
import BaggingPanel from './BaggingPanel.jsx';
import { LEVEL_LABEL, keepSelected, pathOf, toBagsPayload } from './bagging.js';

const DATE_FMT = 'DD/MM/YYYY';
const BAG_PREFS = 'ramas.manifest.bagging.v2';

function savedBagPrefs() {
  try { return JSON.parse(localStorage.getItem(BAG_PREFS)) || {}; } catch { return {}; }
}

/**
 * preset (opened from Docket Entry's side panel): { docketNo, destination: { code, name }, bookingDate } — the destination
 * branch is chosen, the dockets are listed from the booking date and that docket is ticked. onSaved(manifestNo) after a save.
 */
export default function ManifestEntryPage({ preset = null, onSaved } = {}) {
  const { user } = useAuth();
  const { message, modal } = App.useApp();
  const [form] = Form.useForm();
  const queryClient = useQueryClient();
  const [destination, setDestination] = useState(preset?.destination ?? null); // { code, name }
  const [rows, setRows] = useState([]);
  const [selected, setSelected] = useState([]);
  const [searched, setSearched] = useState(false);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sheet, setSheet] = useState(null); // open loading sheet no.

  const { data: opts, error: optsError } = useQuery({
    queryKey: ['manifest-options', user.divCode],
    queryFn: () => api.get('/manifests/options').then((r) => r.data),
  });
  const { data: sheets = [] } = useQuery({
    queryKey: ['loading-sheets', 'open', user.currentBranch.code],
    queryFn: () => api.get('/loading-sheets', { params: { open: true } }).then((r) => r.data),
  });

  const freightType = Form.useWatch('freightType', form) ?? 'SUNDRY';
  const transportedBy = Form.useWatch('transportedBy', form) ?? 'SELF';
  const destType = freightType === 'FTL' ? 'city' : 'branch';

  // bagging: courier divisions, branch-wise (Sundry) manifests; TMS / FTL = whole dockets in one entry
  const prefs = savedBagPrefs();
  const [bag, setBagState] = useState({
    on: prefs.on ?? true,
    levels: prefs.levels ?? { PACKET: false, BAG: true, MASTER: true },   // packets are optional (inside bags)
    limits: { docketsPerPacket: 10, itemsPerBag: 10, bagsPerMasterBag: 10 },
    nodes: [],
  });
  const setBag = useCallback((patch) => setBagState((s) => ({ ...s, ...patch })), []);
  const baggingAvailable = Boolean(opts?.bagging?.enabled) && freightType === 'SUNDRY';
  const bagging = baggingAvailable && bag.on;
  useEffect(() => { if (opts?.bagging?.limits) setBag({ limits: opts.bagging.limits }); }, [opts, setBag]);
  useEffect(() => {
    try { localStorage.setItem(BAG_PREFS, JSON.stringify({ on: bag.on, levels: bag.levels })); } catch { /* private window */ }
  }, [bag.on, bag.levels]);
  // a docket unticked from the manifest leaves its bag
  useEffect(() => { setBagState((s) => ({ ...s, nodes: keepSelected(s.nodes, selected) })); }, [selected]);

  function resetDockets() { setRows([]); setSelected([]); setSearched(false); setBag({ nodes: [] }); }

  // from Docket Entry: list the docket's destination straight away and tick the docket
  useEffect(() => {
    if (preset?.destination) search({ pick: preset.docketNo });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function search({ pick } = {}) {
    if (!destination) { message.warning(`Choose the destination ${destType} first`); return; }
    const range = form.getFieldValue('range');
    setSearching(true);
    try {
      const { data } = await api.get('/manifests/pending-dockets', {
        params: {
          destination: destination.code,
          // a loading sheet's dockets may be older than the range
          from: sheet ? '2000-01-01' : range[0].format('YYYY-MM-DD'),
          to: range[1].format('YYYY-MM-DD'),
          loadType: freightType === 'FTL' ? 'FTL' : 'PTL',
          bookingMode: form.getFieldValue('bookingMode') || 'All',
          loadingSheet: sheet || undefined,
        },
      });
      // Default to manifesting everything still pending; keep the pending totals so a
      // split can prorate weight and freight.
      setRows(data.map((d) => ({ ...d, maxPackages: d.packages, maxWeight: d.weight, maxFreight: d.freight })));
      setSelected(pick && data.some((d) => d.docketNo === pick) ? [pick] : []);
      if (pick && !data.some((d) => d.docketNo === pick)) message.info(`Docket ${pick} is not waiting for a manifest here (already manifested, or not at this branch)`);
      setSearched(true);
    } catch (e) {
      message.error(errorMessage(e));
    } finally {
      setSearching(false);
    }
  }

  const update = (no, patch) => setRows((rs) => rs.map((r) => (r.docketNo === no ? { ...r, ...patch } : r)));
  const chosen = useMemo(() => rows.filter((r) => selected.includes(r.docketNo)), [rows, selected]);
  const totals = useMemo(() => chosen.reduce((t, r) => ({
    packages: t.packages + (Number(r.packages) || 0), weight: t.weight + (Number(r.weight) || 0),
  }), { packages: 0, weight: 0 }), [chosen]);

  async function save() {
    let v;
    try { v = await form.validateFields(); } catch { return; }
    if (!destination) { message.warning(`Choose the destination ${destType}`); return; }
    if (!chosen.length) { message.warning('Select at least one docket'); return; }
    // the bags made on the panel; ticked dockets outside every bag go loose
    const nodes = bagging ? bag.nodes : [];
    setSaving(true);
    try {
      const { data } = await api.post('/manifests', {
        bags: toBagsPayload(nodes),
        manifestDate: v.manifestDate.format('YYYY-MM-DD'),
        manifestTime: v.manifestTime.format('HH:mm'),
        freightType: v.freightType,
        destination: destination.code,
        manualNo: v.manualNo || '',
        transportedBy: v.transportedBy,
        coloadingBy: v.coloadingBy || '',
        coloaderName: v.coloaderName || '',
        remarks: v.remarks || '',
        loadingSheetNo: sheet || '',
        dockets: chosen.map((r) => ({ docketNo: r.docketNo, packages: r.packages, weight: r.weight, freight: r.freight })),
      });
      modal.success({
        title: 'Manifest created',
        width: 520,
        content: (
          <>
            <div>{data.message}</div>
            {data.bags?.length > 0 && (
              <div style={{ marginTop: 8 }}>
                {['MASTER', 'BAG', 'PACKET'].map((l) => {
                  const list = data.bags.filter((b) => b.level === l);
                  return list.length ? <div key={l}><strong>{LEVEL_LABEL[l]}:</strong> {list.map((b) => b.bagNo).join(', ')}</div> : null;
                })}
                <Button style={{ marginTop: 8 }} icon={<PrinterOutlined />} onClick={() => window.open(`/print/manifest-bags/${encodeURIComponent(data.manifestNo)}`, '_blank')}>
                  Print bag labels
                </Button>
              </div>
            )}
          </>
        ),
      });
      setBag({ nodes: [] });
      onSaved?.(data.manifestNo);
      // the sheet is used up; otherwise partly-manifested dockets stay with their remaining packages
      if (sheet) { setSheet(null); resetDockets(); queryClient.invalidateQueries({ queryKey: ['loading-sheets'] }); } else await search();
    } catch (e) {
      const details = e.response?.data?.details;
      message.error(details?.length ? `${e.response.data.error}: ${details.map((d) => d.message).join('; ')}` : errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  const columns = [
    { title: 'Docket no.', dataIndex: 'docketNo', fixed: 'left' },
    { title: 'Booked', dataIndex: 'bookingDate', render: (v) => dayjs(v).format(DATE_FMT) },
    { title: 'Mode', dataIndex: 'bookingMode' },
    { title: 'Destination', dataIndex: 'destination' },
    { title: 'Consignor', dataIndex: 'consigner', ellipsis: true },
    { title: 'Consignee', dataIndex: 'consignee', ellipsis: true },
    { title: 'Pending', key: 'pend', align: 'right', render: (_, r) => `${r.maxPackages} / ${r.totalPackages}` },
    {
      title: 'Pkts', dataIndex: 'packages', width: 90,
      render: (v, r) => (
        <InputNumber size="small" min={1} max={r.maxPackages} value={v} style={{ width: 70 }} aria-label={`Packages for ${r.docketNo}`}
          onChange={(x) => {
            // Splitting a docket: prorate weight and freight by packages (legacy
            // left both to be retyped by hand). Weight stays editable.
            const p = Math.min(Math.max(x ?? 1, 1), r.maxPackages);
            const share = p / r.maxPackages;
            update(r.docketNo, {
              packages: p,
              weight: Math.round(r.maxWeight * share * 100) / 100,
              freight: Math.round(r.maxFreight * share * 100) / 100,
            });
          }} />
      ),
    },
    {
      title: 'Weight', dataIndex: 'weight', width: 100,
      render: (v, r) => <InputNumber size="small" min={0} value={v} style={{ width: 90 }} aria-label={`Weight for ${r.docketNo}`} onChange={(x) => update(r.docketNo, { weight: x ?? 0 })} />,
    },
    { title: 'Freight', dataIndex: 'freight', align: 'right', render: (v) => Number(v).toFixed(2) },
    // which packet / bag / master bag the docket is in
    ...(bagging ? [{
      title: 'In', key: 'bag',
      render: (_, r) => {
        const path = pathOf(bag.nodes, r.docketNo);
        return path.length ? <Typography.Text strong>{path.join(' › ')}</Typography.Text> : <Typography.Text type="secondary">loose</Typography.Text>;
      },
    }] : []),
  ];

  if (optsError) return <Alert type="error" showIcon message={errorMessage(optsError)} />;

  return (
    <div className="page-card">
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 12 }} wrap>
        <Typography.Title level={3} style={{ margin: 0 }}>Manifest Entry</Typography.Title>
        <Typography.Text type="secondary">From: {user.currentBranch.name} : {user.currentBranch.code}</Typography.Text>
      </Space>

      <Form
        form={form}
        layout="vertical"
        initialValues={{
          manifestDate: dayjs(), manifestTime: dayjs(), freightType: 'SUNDRY', transportedBy: 'SELF', bookingMode: 'All',
          range: [preset?.bookingDate ? dayjs(preset.bookingDate) : dayjs().startOf('month'), dayjs()],
        }}
      >
        <Card size="small" title="Manifest" style={{ marginBottom: 12 }}>
          <Row gutter={12}>
            <Col xs={12} md={4}>
              <Form.Item label="Date" name="manifestDate" rules={[{ required: true }]}>
                <DatePicker format={DATE_FMT} style={{ width: '100%' }} disabledDate={(d) => d.isAfter(dayjs(), 'day')} />
              </Form.Item>
            </Col>
            <Col xs={12} md={3}>
              <Form.Item label="Time" name="manifestTime" rules={[{ required: true }]}><TimePicker format="HH:mm" style={{ width: '100%' }} /></Form.Item>
            </Col>
            <Col xs={24} md={7}>
              <Form.Item label="Type" name="freightType">
                <Radio.Group
                  optionType="button"
                  options={opts?.freightTypes ?? []}
                  onChange={(e) => {
                    setDestination(null); resetDockets();
                    if (e.target.value === 'FTL') form.setFieldValue('transportedBy', 'SELF');
                  }}
                />
              </Form.Item>
            </Col>
            <Col xs={24} md={6}>
              <Form.Item label={`Destination ${destType}`} required>
                <SearchSelect
                  key={destType}
                  defaultValue={preset?.destination ? `${preset.destination.name} : ${preset.destination.code}` : undefined}
                  placeholder={`Type ${destType} name`}
                  minChars={1}
                  fetcher={(q) => api.get('/manifests/destinations', { params: { type: destType, q } })
                    .then((r) => r.data.filter((d) => destType === 'city' || d.code !== user.currentBranch.code)
                      .map((d) => ({ ...d, value: `${d.name} : ${d.code}`, label: `${d.name} : ${d.code}` })))}
                  onPick={(o) => { setDestination({ code: o.code, name: o.name }); resetDockets(); }}
                  onChange={(t) => { if (!t) { setDestination(null); resetDockets(); } }}
                  quickAdd={destType === 'city' ? {
                    master: 'city',
                    toOption: (r) => {
                      const name = String(r.city_name ?? '').trim();
                      const code = String(r.city_code ?? '').trim();
                      return { value: `${name} : ${code}`, label: `${name} : ${code}`, name, code };
                    },
                  } : undefined}
                />
              </Form.Item>
            </Col>
            <Col xs={24} md={4}>
              <Form.Item label="Manual manifest no." name="manualNo"><Input maxLength={30} /></Form.Item>
            </Col>
            <Col xs={24} md={6}>
              <Form.Item label="Transported by" name="transportedBy">
                <Radio.Group optionType="button" options={[
                  { value: 'SELF', label: 'Self' },
                  { value: 'COLOADER', label: 'Co-loader', disabled: freightType === 'FTL' },
                ]} />
              </Form.Item>
            </Col>
            {transportedBy === 'COLOADER' && (
              <>
                <Col xs={12} md={4}>
                  <Form.Item label="Co-loading by" name="coloadingBy"><Select allowClear options={(opts?.coloadingBy ?? []).map((x) => ({ value: x, label: x }))} /></Form.Item>
                </Col>
                <Col xs={12} md={5}>
                  <Form.Item label="Co-loader" name="coloaderName" rules={[{ required: true, message: 'Select the co-loader' }]}>
                    <Select options={(opts?.coloaderNames ?? []).map((x) => ({ value: x, label: x }))} />
                  </Form.Item>
                </Col>
              </>
            )}
            <Col xs={24} md={transportedBy === 'COLOADER' ? 9 : 18}>
              <Form.Item label="Remarks" name="remarks"><Input maxLength={500} /></Form.Item>
            </Col>
          </Row>
        </Card>

        <Card size="small" title={destination ? `Dockets for ${destination.name}` : 'Dockets'}>
          <Space wrap style={{ marginBottom: 12 }} align="end">
            <Form.Item label="Booked" name="range" style={{ marginBottom: 0 }}><DatePicker.RangePicker format={DATE_FMT} allowClear={false} /></Form.Item>
            <Form.Item label="Mode" name="bookingMode" style={{ marginBottom: 0 }}><Select style={{ width: 130 }} options={opts?.bookingModes ?? []} /></Form.Item>
            <Form.Item label="From loading sheet" style={{ marginBottom: 0 }}>
              <Select allowClear placeholder="All dockets" style={{ width: 230 }} value={sheet} aria-label="From loading sheet"
                onChange={(v) => { setSheet(v ?? null); resetDockets(); }}
                options={sheets.map((l) => ({ value: l.lsNo, label: `${l.lsNo} (${l.dockets})` }))} />
            </Form.Item>
            <Button type="primary" icon={<SearchOutlined />} onClick={() => search()} loading={searching} disabled={!destination}>Search</Button>
          </Space>
          {!searched ? <Empty description={destination ? 'Search to list dockets at this branch for the destination' : `Choose the destination ${destType} first`} /> : (
            <>
              {baggingAvailable && rows.length > 0 && (
                <BaggingPanel state={bag} setState={setBag} rows={rows} selected={selected} onSelect={setSelected} message={message} />
              )}
              <Table
                size="small"
                rowKey="docketNo"
                columns={columns}
                dataSource={rows}
                scroll={{ x: 'max-content' }}
                pagination={{ defaultPageSize: 50, showSizeChanger: true }}
                rowSelection={{ selectedRowKeys: selected, onChange: setSelected }}
                locale={{ emptyText: 'No dockets pending for this destination' }}
              />
              <Space style={{ marginTop: 12, width: '100%', justifyContent: 'space-between' }} wrap>
                <Typography.Text>
                  Selected <strong>{chosen.length}</strong> docket(s) · {totals.packages} pkts · {totals.weight.toFixed(2)} kg
                  {bagging && bag.nodes.length > 0 && ` · ${['MASTER', 'BAG', 'PACKET'].map((l) => [l, bag.nodes.filter((n) => n.level === l).length])
                    .filter(([, c]) => c).map(([l, c]) => `${c} ${LEVEL_LABEL[l].toLowerCase()}${c > 1 ? 's' : ''}`).join(', ')}`}
                </Typography.Text>
                <Button type="primary" icon={<SaveOutlined />} onClick={save} loading={saving} disabled={!chosen.length}>Create manifest</Button>
              </Space>
            </>
          )}
        </Card>
      </Form>
    </div>
  );
}
