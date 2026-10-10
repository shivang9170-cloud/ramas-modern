// DRS entry — replaces Operation/Drs_Entry.aspx.
// List dockets that have arrived here for delivery, tick the ones going out (packets can
// be split across runs), name the delivery person and save.
import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import {
  Alert, App, AutoComplete, Button, Card, Col, DatePicker, Form, Input, InputNumber, Row, Select, Space, Table, Tag, TimePicker, Typography,
} from 'antd';
import { SaveOutlined, SearchOutlined } from '@ant-design/icons';
import { api, errorMessage } from '../../api/client.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { round2 } from '../../../../shared/challanCalc.js';

const DATE_FMT = 'DD/MM/YYYY';
const fmt = (v) => (v ? dayjs(v).format(DATE_FMT) : '');
const key = (r) => `${r.docketNo}|${r.challanNo}`;

function fyStart(fy) {
  const y = Number(String(fy || '').split('-')[0]);
  return y ? dayjs(`${y}-04-01`) : dayjs().startOf('month');
}

/** preset (opened from Docket Entry's side panel): { docketNo } — searched and ticked when it is here for delivery. */
export default function DrsEntryPage({ preset = null, onSaved } = {}) {
  const { user } = useAuth();
  const { message, modal } = App.useApp();
  const [form] = Form.useForm();
  const [filter, setFilter] = useState({ range: [fyStart(user.financialYear), dayjs()], dockets: preset?.docketNo ?? '' });
  const [lines, setLines] = useState([]);
  const [selected, setSelected] = useState([]);
  const [saving, setSaving] = useState(false);

  const { data: opts } = useQuery({ queryKey: ['drs-options', user.currentBranch.code], queryFn: () => api.get('/drs/options').then((r) => r.data) });
  const params = { from: filter.range[0].format('YYYY-MM-DD'), to: filter.range[1].format('YYYY-MM-DD'), dockets: filter.dockets };
  const { data, isFetching, error, refetch } = useQuery({
    queryKey: ['drs-pending', params, user.currentBranch.code],
    queryFn: () => api.get('/drs/pending-dockets', { params }).then((r) => r.data),
  });
  useEffect(() => {
    if (!data) return;
    setLines(data.map((d) => ({ ...d, out: d.packages })));
    // A docket-number search ticks what it found (legacy txtDocketNo behaviour).
    setSelected(filter.dockets ? data.map(key) : []);
  }, [data, filter.dockets]);

  const update = (k, out) => setLines((ls) => ls.map((r) => (key(r) === k ? { ...r, out } : r)));
  const outWeight = (r) => (r.out === r.packages ? r.weight : round2((r.weight / r.packages) * r.out));
  const ticked = useMemo(() => lines.filter((r) => selected.includes(key(r))), [lines, selected]);
  const totals = ticked.reduce((t, r) => ({ packages: t.packages + r.out, weight: round2(t.weight + outWeight(r)) }), { packages: 0, weight: 0 });

  async function save() {
    let v;
    try { v = await form.validateFields(); } catch { return; }
    if (!ticked.length) { message.warning('Select at least one docket'); return; }
    setSaving(true);
    try {
      const { data: res } = await api.post('/drs', {
        drsDate: v.drsDate.format('YYYY-MM-DD'),
        drsTime: v.drsTime.format('HH:mm'),
        deliveredBy: v.deliveredBy,
        deliveredByMobile: v.deliveredByMobile || '',
        driverName: v.driverName || '',
        vehicleNo: v.vehicleNo || '',
        franchiseeCode: v.franchiseeCode || '',
        dockets: ticked.map((r) => ({ docketNo: r.docketNo, challanNo: r.challanNo, packages: r.out })),
      });
      modal.success({ title: 'DRS saved', content: <>DRS no. <strong>{res.drsNo}</strong> — {res.dockets} docket(s), {res.packages} pkts, {res.totalWeight} kg</> });
      onSaved?.(res.drsNo);
      setSelected([]);
      refetch();
    } catch (e) {
      const details = e.response?.data?.details;
      message.error(details?.length ? `${e.response.data.error}: ${details.map((d) => d.message).join('; ')}` : errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  const staff = (opts?.deliveryStaff ?? []).map((s) => ({ value: s.label, label: `${s.label} (${s.value})`, mobile: s.mobile }));

  const columns = [
    { title: 'Docket no.', dataIndex: 'docketNo', fixed: 'left' },
    { title: 'Arrived', dataIndex: 'arrivalDate', render: fmt },
    { title: 'Challan', dataIndex: 'challanNo' },
    { title: 'Consignee', dataIndex: 'consignee', ellipsis: true },
    { title: 'Location', dataIndex: 'location', render: (v, r) => v || r.locationCode || '—' },
    { title: 'Pending', key: 'p', align: 'right', render: (_, r) => `${r.packages} pkts · ${r.weight} kg` },
    {
      title: 'Out pkts', dataIndex: 'out', width: 100,
      render: (v, r) => (
        <InputNumber size="small" min={1} max={r.packages} precision={0} value={v} style={{ width: 70 }} aria-label={`Packets out for ${r.docketNo}`}
          onChange={(x) => update(key(r), Math.min(Math.max(x ?? 1, 1), r.packages))} />
      ),
    },
    { title: 'Weight', key: 'w', align: 'right', render: (_, r) => outWeight(r) },
    { title: '', key: 'split', render: (_, r) => (r.out < r.packages ? <Tag color="blue">{r.packages - r.out} stay</Tag> : null) },
  ];

  return (
    <div className="page-card">
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 12 }} wrap>
        <Typography.Title level={3} style={{ margin: 0 }}>DRS Entry</Typography.Title>
        <Typography.Text type="secondary">At: {user.currentBranch.name} : {user.currentBranch.code} · number is generated on save</Typography.Text>
      </Space>

      <Card size="small" title="Dockets waiting for delivery" style={{ marginBottom: 12 }}>
        <Form layout="inline" style={{ rowGap: 8, marginBottom: 12 }}
          initialValues={filter}
          onFinish={(v) => setFilter({ range: v.range, dockets: (v.dockets || '').trim() })}>
          <Form.Item name="range" label="Arrived"><DatePicker.RangePicker format={DATE_FMT} allowClear={false} /></Form.Item>
          <Form.Item name="dockets"><Input placeholder="Docket nos (comma separated)" allowClear style={{ width: 260 }} /></Form.Item>
          <Button htmlType="submit" icon={<SearchOutlined />} loading={isFetching}>Search</Button>
        </Form>
        {error && <Alert type="error" showIcon message={errorMessage(error)} style={{ marginBottom: 12 }} />}
        {preset?.docketNo && filter.dockets === preset.docketNo && data && !data.length && (
          <Alert type="info" showIcon style={{ marginBottom: 12 }}
            message={`Docket ${preset.docketNo} is not waiting for delivery at ${user.currentBranch.name} — a DRS is made at the destination branch after the docket arrives there.`} />
        )}
        <Table
          size="small"
          rowKey={key}
          columns={columns}
          dataSource={lines}
          loading={isFetching}
          scroll={{ x: 'max-content' }}
          pagination={{ defaultPageSize: 50, hideOnSinglePage: true }}
          rowSelection={{ selectedRowKeys: selected, onChange: setSelected }}
          locale={{ emptyText: 'Nothing waiting for delivery at this branch' }}
        />
        <Typography.Text style={{ display: 'block', marginTop: 12 }}>
          Selected <strong>{ticked.length}</strong> docket(s) · {totals.packages} pkts · {totals.weight} kg
        </Typography.Text>
      </Card>

      <Card size="small" title="Delivery run">
        <Form form={form} layout="vertical" initialValues={{ drsDate: dayjs(), drsTime: dayjs() }}>
          <Row gutter={12}>
            <Col xs={12} md={4}>
              <Form.Item label="DRS date" name="drsDate" rules={[{ required: true }]}>
                <DatePicker format={DATE_FMT} style={{ width: '100%' }} disabledDate={(d) => d.isAfter(dayjs(), 'day')} />
              </Form.Item>
            </Col>
            <Col xs={12} md={3}>
              <Form.Item label="Time" name="drsTime" rules={[{ required: true }]}><TimePicker format="HH:mm" style={{ width: '100%' }} /></Form.Item>
            </Col>
            <Col xs={24} md={6}>
              <Form.Item label="Delivered by" name="deliveredBy" rules={[{ required: true, message: 'Who is delivering?' }]}>
                <AutoComplete options={staff} placeholder="Type or pick a name" maxLength={100}
                  filterOption={(q, o) => o.value.toUpperCase().includes(q.toUpperCase())}
                  onSelect={(_, o) => { if (o.mobile) form.setFieldValue('deliveredByMobile', o.mobile); }} />
              </Form.Item>
            </Col>
            <Col xs={12} md={4}>
              <Form.Item label="Mobile" name="deliveredByMobile" rules={[{ pattern: /^\d{10}$/, message: '10 digits' }]}>
                <Input maxLength={10} inputMode="numeric" />
              </Form.Item>
            </Col>
            <Col xs={12} md={4}><Form.Item label="Driver" name="driverName"><Input maxLength={100} /></Form.Item></Col>
            <Col xs={12} md={3}>
              <Form.Item label="Vehicle no." name="vehicleNo" normalize={(x) => (x || '').toUpperCase().replace(/\s/g, '')}>
                <Input maxLength={20} />
              </Form.Item>
            </Col>
            {/* chkFranchisee / ddlFranchisee: the DRS goes to a franchisee, who then delivers */}
            <Col xs={24} md={6}>
              <Form.Item label="To franchisee" name="franchiseeCode">
                <Select allowClear showSearch optionFilterProp="label" placeholder="Own delivery staff" options={opts?.franchisees ?? []}
                  onChange={(v, o) => { if (v) form.setFieldsValue({ deliveredBy: o?.name, deliveredByMobile: '' }); }} />
              </Form.Item>
            </Col>
          </Row>
          <div style={{ textAlign: 'right' }}>
            <Button type="primary" size="large" icon={<SaveOutlined />} loading={saving} onClick={save} disabled={!ticked.length}>Save DRS</Button>
          </div>
        </Form>
      </Card>
    </div>
  );
}
