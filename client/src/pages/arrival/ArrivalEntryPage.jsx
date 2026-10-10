// Arrival entry — replaces Operation/Arrival_Entry.aspx (branch wise).
// Pick a challan in transit to this branch, tick the dockets that arrived (packets can be
// fewer than manifested — the rest are short), note any weight difference and save.
// Excess dockets: scan a docket that came on this truck though its manifest is on another
// challan — it is received in full with this arrival.
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import {
  Alert, App, Button, Card, Col, DatePicker, Descriptions, Empty, Form, Input, InputNumber, Row, Space, Statistic, Table, Tag,
  TimePicker, Typography,
} from 'antd';
import { ArrowLeftOutlined, DeleteOutlined, InboxOutlined, PlusOutlined, SaveOutlined } from '@ant-design/icons';
import { api, errorMessage } from '../../api/client.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { round2 } from '../../../../shared/challanCalc.js';

const DATE_FMT = 'DD/MM/YYYY';
const fmt = (v) => (v ? dayjs(v).format(DATE_FMT) : '');
const key = (r) => `${r.manifestNo}|${r.docketNo}`;
const prorate = (r, p) => (r.packages ? { weight: round2((r.weight / r.packages) * p), freight: round2((r.freight / r.packages) * p) } : { weight: 0, freight: 0 });

function fyStart(fy) {
  const y = Number(String(fy || '').split('-')[0]);
  return y ? dayjs(`${y}-04-01`) : dayjs().startOf('month');
}

function Receive({ challanNo, onDone, onBack }) {
  const { message, modal } = App.useApp();
  const [form] = Form.useForm();
  const [lines, setLines] = useState([]);
  const [selected, setSelected] = useState([]);
  const [saving, setSaving] = useState(false);
  const [excess, setExcess] = useState([]);
  const [scan, setScan] = useState('');
  const [scanning, setScanning] = useState(false);
  const messageText = Form.useWatch('message', form);

  // txt_excess_docket_no: GET_DOCKET_DETAILS_FOR_EXCESS_DOCKET_ARRIVAL
  async function addExcess() {
    const no = scan.trim().toUpperCase();
    if (!no) return;
    if (lines.some((r) => r.docketNo === no)) { message.info(`${no} is on this challan — tick it in the list above`); setScan(''); return; }
    if (excess.some((r) => r.docketNo === no)) { setScan(''); return; }
    setScanning(true);
    try {
      const { data } = await api.get(`/arrivals/challans/${encodeURIComponent(challanNo)}/excess/${encodeURIComponent(no)}`);
      setExcess((xs) => [...xs, { ...data, rcvWeight: data.weight, remarks: '' }]);
      setScan('');
    } catch (e) { message.warning(errorMessage(e)); } finally { setScanning(false); }
  }
  const updateExcess = (no, patch) => setExcess((xs) => xs.map((r) => (r.docketNo === no ? { ...r, ...patch } : r)));

  const { data: c, isLoading, error } = useQuery({
    queryKey: ['arrival-challan', challanNo],
    queryFn: () => api.get(`/arrivals/challans/${encodeURIComponent(challanNo)}`).then((r) => r.data),
  });
  // Start with every docket ticked and received in full.
  useEffect(() => {
    if (!c) return;
    const init = c.dockets.map((d) => ({ ...d, received: d.packages, rcvWeight: d.weight, rcvFreight: d.freight, remarks: '' }));
    setLines(init);
    setSelected(init.map(key));
  }, [c]);
  const ticked = useMemo(() => lines.filter((r) => selected.includes(key(r))), [lines, selected]);
  const update = (k, patch) => setLines((ls) => ls.map((r) => (key(r) === k ? { ...r, ...patch } : r)));

  const actual = round2((c?.manifests ?? []).reduce((t, m) => t + m.weight, 0));
  const inward = round2(ticked.reduce((t, r) => t + Number(r.rcvWeight || 0), 0));
  const diff = round2(actual - inward);

  async function save() {
    let v;
    try { v = await form.validateFields(); } catch { return; }
    if (!ticked.length && !excess.length) { message.warning('Select at least one docket'); return; }
    setSaving(true);
    try {
      const { data } = await api.post('/arrivals', {
        challanNo,
        receiveDate: v.receiveDate.format('YYYY-MM-DD'),
        receiveTime: v.receiveTime.format('HH:mm'),
        closingKm: v.closingKm ?? undefined,
        message: v.message || '',
        dockets: ticked.map((r) => ({
          manifestNo: r.manifestNo, docketNo: r.docketNo, packages: r.received, weight: r.rcvWeight, remarks: r.remarks || '',
        })),
        excess: excess.map((r) => ({ docketNo: r.docketNo, weight: r.rcvWeight, remarks: r.remarks || '' })),
      });
      modal.success({
        title: 'Arrival saved',
        content: <>Arrival no. <strong>{data.arrivalNo}</strong> — {data.received} docket(s) received{data.excess ? `, ${data.excess} excess` : ''}{data.short ? `, ${data.short} short` : ''}</>,
      });
      onDone();
    } catch (e) {
      const details = e.response?.data?.details;
      message.error(details?.length ? `${e.response.data.error}: ${details.map((d) => d.message).join('; ')}` : errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  if (error) return <Alert type="error" showIcon message={errorMessage(error)} action={<Button onClick={onBack}>Back</Button>} />;
  if (isLoading || !c) return <Card loading />;

  const columns = [
    { title: 'Docket no.', dataIndex: 'docketNo', fixed: 'left' },
    { title: 'Manifest', dataIndex: 'manifestNo' },
    { title: 'Origin', dataIndex: 'origin' },
    { title: 'Consignee', dataIndex: 'consignee', ellipsis: true },
    { title: 'Manifested', key: 'm', align: 'right', render: (_, r) => `${r.packages} pkts · ${r.weight} kg` },
    {
      title: 'Received pkts', dataIndex: 'received', width: 110,
      render: (v, r) => (
        <InputNumber size="small" min={1} max={r.packages} precision={0} value={v} style={{ width: 80 }} aria-label={`Received packets for ${r.docketNo}`}
          onChange={(x) => {
            const p = Math.min(Math.max(x ?? 1, 1), r.packages);
            const pr = prorate(r, p);
            update(key(r), { received: p, rcvWeight: pr.weight, rcvFreight: pr.freight });
          }} />
      ),
    },
    {
      title: 'Weight', dataIndex: 'rcvWeight', width: 110,
      render: (v, r) => <InputNumber size="small" min={0} value={v} style={{ width: 90 }} aria-label={`Received weight for ${r.docketNo}`} onChange={(x) => update(key(r), { rcvWeight: x ?? 0 })} />,
    },
    { title: 'Freight', dataIndex: 'rcvFreight', align: 'right', render: (v) => Number(v).toFixed(2) },
    {
      title: 'Remarks', dataIndex: 'remarks', width: 180,
      render: (v, r) => <Input size="small" value={v} maxLength={500} aria-label={`Remarks for ${r.docketNo}`} onChange={(e) => update(key(r), { remarks: e.target.value })} />,
    },
    { title: '', key: 'short', render: (_, r) => (r.received < r.packages ? <Tag color="orange">{r.packages - r.received} short</Tag> : null) },
  ];

  return (
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      <Space wrap>
        <Button icon={<ArrowLeftOutlined />} onClick={onBack}>Back to challans</Button>
        <Typography.Title level={4} style={{ margin: 0 }}>Receive challan {c.challanNo}</Typography.Title>
      </Space>
      <Descriptions size="small" bordered column={{ xs: 1, sm: 2, md: 3 }}>
        <Descriptions.Item label="Challan date">{fmt(c.challanDate)} {c.challanTime}</Descriptions.Item>
        <Descriptions.Item label="From">{c.from}{c.route && ` · ${c.route}`}</Descriptions.Item>
        <Descriptions.Item label="Vehicle">{c.truckNo}</Descriptions.Item>
        <Descriptions.Item label="Seal no.">{c.sealNo || '—'}</Descriptions.Item>
        <Descriptions.Item label="Manifests">{c.manifests.map((m) => m.manifestNo).join(', ')}</Descriptions.Item>
        <Descriptions.Item label="Opening KM">{c.openingKm || '—'}</Descriptions.Item>
      </Descriptions>

      <Card size="small" title={`Dockets (${ticked.length} of ${lines.length} ticked)`}>
        <Table
          size="small"
          rowKey={key}
          columns={columns}
          dataSource={lines}
          scroll={{ x: 'max-content' }}
          pagination={false}
          rowSelection={{ selectedRowKeys: selected, onChange: setSelected }}
        />
        <Row gutter={16} style={{ marginTop: 16 }}>
          <Col xs={8} md={4}><Statistic title="Manifest weight" value={actual} suffix="kg" /></Col>
          <Col xs={8} md={4}><Statistic title="Inward weight" value={inward} suffix="kg" /></Col>
          <Col xs={8} md={4}><Statistic title="Difference" value={diff} suffix="kg" valueStyle={diff ? { color: '#cf1322' } : undefined} /></Col>
          <Col xs={24} md={12}>
            {lines.length - ticked.length > 0 && (
              <Alert type="warning" showIcon message={`${lines.length - ticked.length} docket(s) not ticked will stay short on the manifest.`} />
            )}
          </Col>
        </Row>
      </Card>

      <Card size="small" title={`Excess dockets (${excess.length})`}
        extra={<Typography.Text type="secondary">Came on this truck, but the manifest is on another challan</Typography.Text>}>
        <Space wrap style={{ marginBottom: excess.length ? 12 : 0 }}>
          <Input value={scan} onChange={(e) => setScan(e.target.value)} onPressEnter={addExcess} placeholder="Scan docket no. + Enter"
            style={{ width: 220 }} aria-label="Scan excess docket no." disabled={scanning} />
          <Button icon={<PlusOutlined />} onClick={addExcess} loading={scanning}>Add</Button>
        </Space>
        {excess.length > 0 && (
          <Table
            size="small" rowKey="docketNo" dataSource={excess} pagination={false} scroll={{ x: 'max-content' }}
            columns={[
              { title: 'Docket no.', dataIndex: 'docketNo' },
              { title: 'Manifest', dataIndex: 'manifestNo' },
              { title: 'On challan', dataIndex: 'challanNo' },
              { title: 'Origin', dataIndex: 'origin' },
              { title: 'Consignee', dataIndex: 'consignee', ellipsis: true },
              { title: 'Pkts', dataIndex: 'packages', align: 'right' },
              {
                title: 'Weight', dataIndex: 'rcvWeight', width: 110,
                render: (v, r) => <InputNumber size="small" min={0} value={v} style={{ width: 90 }} aria-label={`Excess weight for ${r.docketNo}`}
                  onChange={(x) => updateExcess(r.docketNo, { rcvWeight: x ?? 0 })} />,
              },
              { title: 'Freight', dataIndex: 'freight', align: 'right', render: (v) => Number(v).toFixed(2) },
              {
                title: 'Remarks', dataIndex: 'remarks', width: 180,
                render: (v, r) => <Input size="small" value={v} maxLength={500} aria-label={`Remarks for excess ${r.docketNo}`} onChange={(e) => updateExcess(r.docketNo, { remarks: e.target.value })} />,
              },
              {
                title: '', key: 'del', width: 48,
                render: (_, r) => <Button size="small" type="text" danger icon={<DeleteOutlined />} aria-label={`Remove ${r.docketNo}`}
                  onClick={() => setExcess((xs) => xs.filter((x) => x.docketNo !== r.docketNo))} />,
              },
            ]}
          />
        )}
      </Card>

      <Card size="small" title="Arrival">
        <Form form={form} layout="vertical" initialValues={{ receiveDate: dayjs(), receiveTime: dayjs() }}>
          <Row gutter={12}>
            <Col xs={12} md={4}>
              <Form.Item label="Receive date" name="receiveDate" rules={[{ required: true }]}>
                <DatePicker format={DATE_FMT} style={{ width: '100%' }}
                  disabledDate={(d) => d.isAfter(dayjs(), 'day') || d.isBefore(dayjs(c.challanDate), 'day')} />
              </Form.Item>
            </Col>
            <Col xs={12} md={3}>
              <Form.Item label="Time" name="receiveTime" rules={[{ required: true }]}><TimePicker format="HH:mm" style={{ width: '100%' }} /></Form.Item>
            </Col>
            <Col xs={12} md={4}>
              <Form.Item label="Closing KM" name="closingKm"
                rules={c.openingKm ? [{ required: true, message: 'Enter closing KM' }, {
                  validator: (_, v) => (v === undefined || v === null || v > c.openingKm ? Promise.resolve() : Promise.reject(new Error(`Must be more than ${c.openingKm}`))),
                }] : []}>
                <InputNumber min={0} precision={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col xs={24} md={13}>
              <Form.Item label="Remarks" name="message"
                rules={[{ required: diff !== 0, message: 'Remarks are required when the weight differs' }]}
                extra={diff !== 0 && !messageText ? `Weight differs by ${diff} kg — explain it here.` : undefined}>
                <Input maxLength={500} />
              </Form.Item>
            </Col>
          </Row>
          <div style={{ textAlign: 'right' }}>
            <Button type="primary" size="large" icon={<SaveOutlined />} loading={saving} onClick={save} disabled={!ticked.length && !excess.length}>Save arrival</Button>
          </div>
        </Form>
      </Card>
    </Space>
  );
}

export default function ArrivalEntryPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [range, setRange] = useState([fyStart(user.financialYear), dayjs()]);
  const [open, setOpen] = useState(null);

  const params = { from: range[0].format('YYYY-MM-DD'), to: range[1].format('YYYY-MM-DD') };
  const { data = [], isFetching, error } = useQuery({
    queryKey: ['arrival-pending', params, user.currentBranch.code],
    queryFn: () => api.get('/arrivals/pending-challans', { params }).then((r) => r.data),
    enabled: !open,
  });

  return (
    <div className="page-card">
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 12 }} wrap>
        <Typography.Title level={3} style={{ margin: 0 }}>Arrival Entry</Typography.Title>
        <Typography.Text type="secondary">At: {user.currentBranch.name} : {user.currentBranch.code}</Typography.Text>
      </Space>
      {open ? (
        <Receive
          key={open}
          challanNo={open}
          onBack={() => setOpen(null)}
          onDone={() => { setOpen(null); queryClient.invalidateQueries({ queryKey: ['arrival-pending'] }); }}
        />
      ) : (
        <Card size="small" title="Challans in transit to this branch">
          <Space wrap style={{ marginBottom: 12 }}>
            <DatePicker.RangePicker format={DATE_FMT} allowClear={false} value={range} onChange={(v) => v && setRange(v)} />
          </Space>
          {error && <Alert type="error" showIcon message={errorMessage(error)} style={{ marginBottom: 12 }} />}
          <Table
            size="middle"
            rowKey="challanNo"
            loading={isFetching}
            dataSource={data}
            scroll={{ x: 'max-content' }}
            pagination={{ defaultPageSize: 20, hideOnSinglePage: true }}
            locale={{ emptyText: <Empty image={<InboxOutlined style={{ fontSize: 40, color: '#bbb' }} />} description="Nothing in transit to this branch" /> }}
            columns={[
              { title: 'Challan no.', dataIndex: 'challanNo' },
              { title: 'Date', dataIndex: 'challanDate', render: (v, r) => `${fmt(v)} ${r.challanTime}` },
              { title: 'From', dataIndex: 'from' },
              { title: 'Route', dataIndex: 'route', render: (v) => v || '—' },
              { title: 'Vehicle', dataIndex: 'truckNo' },
              { title: 'Manifests', dataIndex: 'manifests', align: 'right' },
              { title: 'Pkts', dataIndex: 'packages', align: 'right' },
              { title: 'Weight', dataIndex: 'weight', align: 'right' },
              { title: '', key: 'go', render: (_, r) => <Button type="primary" size="small" onClick={() => setOpen(r.challanNo)}>Receive</Button> },
            ]}
          />
        </Card>
      )}
    </div>
  );
}
