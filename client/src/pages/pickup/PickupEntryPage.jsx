// Pickup (PRS) entry — replaces Operation/pickup_entry.aspx.
// Search dockets waiting for pickup at the current branch, tick them, choose a
// pickup location for each, and save. The pickup number is generated on save.
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import {
  Alert, App, Button, Card, Col, DatePicker, Empty, Form, Input, InputNumber, Radio, Row, Select, Space, Table,
  TimePicker, Typography,
} from 'antd';
import { SaveOutlined, SearchOutlined } from '@ant-design/icons';
import { api, errorMessage } from '../../api/client.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import MasterSelect from '../../components/masters/MasterSelect.jsx';

const DATE_FMT = 'DD/MM/YYYY';

export default function PickupEntryPage() {
  const { user } = useAuth();
  const { message, modal } = App.useApp();
  const [head] = Form.useForm();
  const [filters] = Form.useForm();
  const franchiseeCode = Form.useWatch('franchiseeCode', head);
  const [rows, setRows] = useState([]); // pending dockets (editable)
  const [selected, setSelected] = useState([]);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [searched, setSearched] = useState(false);

  const { data: opts, error: optsError } = useQuery({
    queryKey: ['pickup-options', user.currentBranch.code],
    queryFn: () => api.get('/pickups/options').then((r) => r.data),
  });
  const defaultDoc = opts?.docTypes?.[opts.docTypes.length - 1]?.value ?? '2';

  async function search() {
    const f = await filters.validateFields();
    setSearching(true);
    try {
      const { data } = await api.get('/pickups/pending-dockets', {
        params: {
          from: f.range[0].format('YYYY-MM-DD'),
          to: f.range[1].format('YYYY-MM-DD'),
          docType: head.getFieldValue('docType') || defaultDoc,
          dockets: f.dockets || '',
        },
      });
      const single = opts?.locations?.length === 1 ? opts.locations[0].value : undefined;
      setRows(data.map((d) => ({ ...d, locationCode: single })));
      setSelected([]);
      setSearched(true);
    } catch (e) {
      message.error(errorMessage(e));
    } finally {
      setSearching(false);
    }
  }

  const update = (docketNo, patch) => setRows((rs) => rs.map((r) => (r.docketNo === docketNo ? { ...r, ...patch } : r)));

  const chosen = useMemo(() => rows.filter((r) => selected.includes(r.docketNo)), [rows, selected]);
  const totals = useMemo(() => chosen.reduce((t, r) => ({
    packages: t.packages + (Number(r.packages) || 0), weight: t.weight + (Number(r.weight) || 0),
  }), { packages: 0, weight: 0 }), [chosen]);

  async function save() {
    let h;
    try { h = await head.validateFields(); } catch { return; }
    if (!chosen.length) { message.warning('Select at least one docket'); return; }
    const missing = chosen.filter((r) => !r.locationCode).map((r) => r.docketNo);
    if (missing.length) { message.warning(`Select a location for: ${missing.join(', ')}`); return; }
    setSaving(true);
    try {
      const { data } = await api.post('/pickups', {
        pickupDate: h.pickupDate.format('YYYY-MM-DD'),
        pickupTime: h.pickupTime.format('HH:mm'),
        docType: h.docType,
        pickupBy: h.pickupBy || '',
        pickupByMobile: h.pickupByMobile || '',
        franchiseeCode: h.franchiseeCode || '',
        dockets: chosen.map((r) => ({
          docketNo: r.docketNo, locationCode: r.locationCode, packages: r.packages, weight: r.weight, freight: r.freight,
        })),
      });
      modal.success({ title: 'Pickup created', content: <>Pickup no. <strong>{data.pickupNo}</strong> — {data.dockets} docket(s)</> });
      setRows((rs) => rs.filter((r) => !selected.includes(r.docketNo)));
      setSelected([]);
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
    { title: 'Destination', dataIndex: 'destination' },
    { title: 'Consignor', dataIndex: 'consigner', ellipsis: true },
    { title: 'Consignee', dataIndex: 'consignee', ellipsis: true },
    {
      title: 'Location', dataIndex: 'locationCode', width: 170,
      render: (v, r) => (
        <MasterSelect
          master="location" quickInitial={{ City_Code: user.cityCode, branch_code: user.currentBranch?.code }}
          size="small" style={{ width: 160 }} value={v} placeholder="Select"
          status={selected.includes(r.docketNo) && !v ? 'error' : undefined}
          options={opts?.locations} onChange={(val) => update(r.docketNo, { locationCode: val })}
          aria-label={`Location for ${r.docketNo}`}
        />
      ),
    },
    {
      title: 'Pkts', dataIndex: 'packages', width: 80,
      render: (v, r) => <InputNumber size="small" min={0} value={v} onChange={(x) => update(r.docketNo, { packages: x ?? 0 })} style={{ width: 70 }} aria-label="Packets" />,
    },
    {
      title: 'Weight', dataIndex: 'weight', width: 100,
      render: (v, r) => <InputNumber size="small" min={0} value={v} onChange={(x) => update(r.docketNo, { weight: x ?? 0 })} style={{ width: 90 }} aria-label="Weight" />,
    },
    { title: 'Freight', dataIndex: 'freight', align: 'right', render: (v) => Number(v).toFixed(2) },
  ];

  if (optsError) return <Alert type="error" showIcon message={errorMessage(optsError)} />;

  return (
    <div className="page-card">
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 12 }} wrap>
        <Typography.Title level={3} style={{ margin: 0 }}>Pickup Entry (PRS)</Typography.Title>
        <Typography.Text type="secondary">Branch: {user.currentBranch.name} : {user.currentBranch.code}</Typography.Text>
      </Space>

      <Card size="small" title="Pickup" style={{ marginBottom: 12 }}>
        <Form
          form={head}
          layout="vertical"
          initialValues={{ pickupDate: dayjs(), pickupTime: dayjs(), docType: defaultDoc }}
        >
          <Row gutter={12}>
            <Col xs={12} md={5}>
              <Form.Item label="Pickup date" name="pickupDate" rules={[{ required: true }]}>
                <DatePicker format={DATE_FMT} style={{ width: '100%' }} disabledDate={(d) => d.isAfter(dayjs(), 'day')} />
              </Form.Item>
            </Col>
            <Col xs={12} md={4}>
              <Form.Item label="Time" name="pickupTime" rules={[{ required: true }]}>
                <TimePicker format="HH:mm" style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col xs={24} md={6}>
              <Form.Item label="Contents" name="docType">
                <Radio.Group optionType="button" options={opts?.docTypes ?? []} onChange={() => { setRows([]); setSelected([]); setSearched(false); }} />
              </Form.Item>
            </Col>
            <Col xs={14} md={5}>
              <Form.Item label="Picked up by" name="pickupBy">
                <Select
                  allowClear showSearch optionFilterProp="label" options={opts?.pickupBy} disabled={Boolean(franchiseeCode)}
                  onChange={(v, o) => head.setFieldValue('pickupByMobile', o?.mobile ?? '')}
                />
              </Form.Item>
            </Col>
            <Col xs={10} md={4}>
              <Form.Item label="Mobile" name="pickupByMobile"><Input maxLength={20} /></Form.Item>
            </Col>
            {/* chkFranchisee: the pickup is done by a franchisee instead of a pickup boy */}
            <Col xs={24} md={6}>
              <Form.Item label="By franchisee" name="franchiseeCode">
                <Select allowClear showSearch optionFilterProp="label" placeholder="Own staff" options={opts?.franchisees ?? []}
                  onChange={(v) => { if (v) head.setFieldsValue({ pickupBy: undefined, pickupByMobile: '' }); }} />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Card>

      <Card size="small" title="Dockets waiting for pickup">
        <Form
          form={filters}
          layout="inline"
          initialValues={{ range: [dayjs().startOf('month'), dayjs()] }}
          onFinish={search}
          style={{ rowGap: 8, marginBottom: 12 }}
        >
          <Form.Item name="range" label="Booked" rules={[{ required: true }]}>
            <DatePicker.RangePicker format={DATE_FMT} allowClear={false} />
          </Form.Item>
          <Form.Item name="dockets" label="Docket nos.">
            <Input placeholder="optional, comma separated" style={{ width: 220 }} allowClear />
          </Form.Item>
          <Button type="primary" htmlType="submit" icon={<SearchOutlined />} loading={searching}>Search</Button>
        </Form>

        {!searched ? <Empty description="Search to list dockets booked at this branch that have no pickup yet" /> : (
          <>
            <Table
              size="small"
              rowKey="docketNo"
              columns={columns}
              dataSource={rows}
              scroll={{ x: 'max-content' }}
              pagination={{ defaultPageSize: 50, showSizeChanger: true }}
              rowSelection={{ selectedRowKeys: selected, onChange: setSelected }}
              locale={{ emptyText: 'No dockets waiting for pickup in this range' }}
            />
            <Space style={{ marginTop: 12, width: '100%', justifyContent: 'space-between' }} wrap>
              <Typography.Text>
                Selected <strong>{chosen.length}</strong> docket(s) · {totals.packages} pkts · {totals.weight.toFixed(2)} kg
              </Typography.Text>
              <Button type="primary" icon={<SaveOutlined />} onClick={save} loading={saving} disabled={!chosen.length}>
                Create pickup
              </Button>
            </Space>
          </>
        )}
      </Card>
    </div>
  );
}
