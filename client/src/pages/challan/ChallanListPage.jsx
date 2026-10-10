// Challan list / view / cancel — replaces Operation/dispatchentry_fleet_Cancel.aspx and dispatchentry_fleet_View.aspx.
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { App, Button, Card, DatePicker, Descriptions, Drawer, Form, Input, Radio, Space, Table, Tag, Typography } from 'antd';
import { EyeOutlined, PlusOutlined, StopOutlined } from '@ant-design/icons';
import { api, errorMessage } from '../../api/client.js';
import { useAuth } from '../../auth/AuthContext.jsx';

const DATE_FMT = 'DD/MM/YYYY';
const fmt = (v) => (v ? dayjs(v).format(DATE_FMT) : '');
const money = (v) => Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const VENDOR_TYPE = { 'Market Vendor': 'Market', Vendor: 'Attached', Self: 'Self' };

function ChallanDetail({ challanNo, onClose, canCancel }) {
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ['challan', challanNo],
    queryFn: () => api.get(`/challans/${encodeURIComponent(challanNo)}`).then((r) => r.data),
    enabled: Boolean(challanNo),
  });
  const cancel = useMutation({
    mutationFn: () => api.post(`/challans/${encodeURIComponent(challanNo)}/cancel`),
    onSuccess: (r) => {
      message.success(r.data.message);
      queryClient.invalidateQueries({ queryKey: ['challans'] });
      queryClient.invalidateQueries({ queryKey: ['challan', challanNo] });
    },
    onError: (e) => message.error(errorMessage(e)),
  });
  const a = data?.amounts;

  return (
    <Drawer title={`Challan ${challanNo ?? ''}`} open={Boolean(challanNo)} onClose={onClose} width={Math.min(900, window.innerWidth)} loading={isLoading}>
      {error && <Typography.Text type="danger">{errorMessage(error)}</Typography.Text>}
      {data && (
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <Descriptions size="small" bordered column={{ xs: 1, sm: 2 }}>
            <Descriptions.Item label="Date">{fmt(data.challanDate)} {data.challanTime}</Descriptions.Item>
            <Descriptions.Item label="Status">
              {data.cancelled ? <Tag color="red">Cancelled</Tag> : data.arrived ? <Tag color="blue">Arrived</Tag> : <Tag color="green">In transit</Tag>}
            </Descriptions.Item>
            <Descriptions.Item label="Route">{data.from} → {data.to}{data.route && ` (${data.route}, ${data.routeTime})`}</Descriptions.Item>
            <Descriptions.Item label="Type">{data.freightType} · {data.destType}</Descriptions.Item>
            <Descriptions.Item label="Vendor">{data.vendor} <Tag>{VENDOR_TYPE[data.vendorType] ?? data.vendorType}</Tag></Descriptions.Item>
            <Descriptions.Item label="Vehicle">
              {data.truckNo} · {data.capacity} kg{data.isOverload && <Tag color="red" style={{ marginLeft: 8 }}>Overloaded {data.overloadWeight} kg</Tag>}
            </Descriptions.Item>
            <Descriptions.Item label="Driver">{data.driverName} {data.driverMobile && `(${data.driverMobile})`}</Descriptions.Item>
            <Descriptions.Item label="Expected delivery">{fmt(data.deliveryDate)}</Descriptions.Item>
            {data.sealNo && <Descriptions.Item label="Seal no.">{data.sealNo}</Descriptions.Item>}
            {data.ewayBillNo && <Descriptions.Item label="E-way bill">{data.ewayBillNo}</Descriptions.Item>}
            <Descriptions.Item label="Load">{data.packages} pkts · {data.weight} kg</Descriptions.Item>
            <Descriptions.Item label="Created by">{data.createdBy}</Descriptions.Item>
          </Descriptions>
          <Descriptions size="small" bordered title="Hire amount" column={{ xs: 1, sm: 2, md: 4 }}>
            <Descriptions.Item label="Hire">₹{money(a.hireCharge)}</Descriptions.Item>
            <Descriptions.Item label="Labour">₹{money(a.labourCharge)}</Descriptions.Item>
            <Descriptions.Item label="Other">₹{money(a.otherCharge)}</Descriptions.Item>
            <Descriptions.Item label="Overload">₹{money(a.overloadCharge)}</Descriptions.Item>
            <Descriptions.Item label="Deduction">₹{money(a.deductionAmt)}</Descriptions.Item>
            <Descriptions.Item label="Total freight"><strong>₹{money(a.freight)}</strong></Descriptions.Item>
            <Descriptions.Item label="Advance">₹{money(a.advance)}</Descriptions.Item>
            <Descriptions.Item label="Balance">₹{money(a.balance)}</Descriptions.Item>
          </Descriptions>
          <Table
            size="small"
            rowKey="manifestNo"
            pagination={false}
            scroll={{ x: 'max-content' }}
            dataSource={data.manifests}
            columns={[
              { title: 'Manifest no.', dataIndex: 'manifestNo' },
              { title: 'Date', dataIndex: 'manifestDate', render: fmt },
              { title: 'To', dataIndex: 'to' },
              { title: 'Pkts', dataIndex: 'packages', align: 'right' },
              { title: 'Weight', dataIndex: 'weight', align: 'right' },
            ]}
          />
          {canCancel && !data.cancelled && !data.arrived && (
            <Button
              danger icon={<StopOutlined />} loading={cancel.isPending}
              onClick={() => modal.confirm({
                title: `Cancel challan ${challanNo}?`,
                content: 'The manifests go back to "waiting for dispatch" and the hire voucher is reversed.',
                okText: 'Cancel challan', okButtonProps: { danger: true }, cancelText: 'Keep',
                onOk: () => cancel.mutateAsync(),
              })}
            >
              Cancel challan
            </Button>
          )}
        </Space>
      )}
    </Drawer>
  );
}

export default function ChallanListPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useState({
    from: dayjs().startOf('month').format('YYYY-MM-DD'), to: dayjs().format('YYYY-MM-DD'), status: 'active', search: '', scope: 'mine',
  });
  const [open, setOpen] = useState(null);
  const canCancel = ['admin', 'employee'].includes(user.role);

  const { data = [], isFetching, error } = useQuery({
    queryKey: ['challans', params, user.currentBranch.code],
    queryFn: () => api.get('/challans', { params }).then((r) => r.data),
  });

  return (
    <Card
      className="page-card"
      title="Challan View / Cancel"
      extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/operation/challan/new')}>New challan</Button>}
    >
      <Form
        layout="inline"
        style={{ rowGap: 8, marginBottom: 12 }}
        initialValues={{ range: [dayjs(params.from), dayjs(params.to)], status: 'active', scope: 'mine' }}
        onFinish={(v) => setParams({
          from: v.range[0].format('YYYY-MM-DD'), to: v.range[1].format('YYYY-MM-DD'),
          status: v.status, scope: v.scope, search: v.search?.trim() || '',
        })}
      >
        <Form.Item name="range" label="Date"><DatePicker.RangePicker format={DATE_FMT} allowClear={false} /></Form.Item>
        <Form.Item name="status">
          <Radio.Group optionType="button" options={[{ value: 'active', label: 'Active' }, { value: 'cancelled', label: 'Cancelled' }]} />
        </Form.Item>
        <Form.Item name="scope">
          <Radio.Group optionType="button" options={[{ value: 'mine', label: 'My challans' }, { value: 'all', label: 'All at branch' }]} />
        </Form.Item>
        <Form.Item name="search"><Input placeholder="Challan no." allowClear style={{ width: 180 }} /></Form.Item>
        <Button type="primary" htmlType="submit" loading={isFetching}>Show</Button>
      </Form>
      {error && <Typography.Text type="danger">{errorMessage(error)}</Typography.Text>}
      <Table
        size="middle"
        rowKey="challanNo"
        loading={isFetching}
        dataSource={data}
        scroll={{ x: 'max-content' }}
        pagination={{ defaultPageSize: 20, showSizeChanger: true, showTotal: (t) => `${t} challans` }}
        columns={[
          { title: 'Challan no.', dataIndex: 'challanNo' },
          { title: 'Date', dataIndex: 'challanDate', render: (v, r) => `${fmt(v)} ${r.challanTime}`, sorter: (a, b) => a.challanDate.localeCompare(b.challanDate) },
          { title: 'To', dataIndex: 'to' },
          { title: 'Vehicle', dataIndex: 'truckNo' },
          { title: 'Vendor', dataIndex: 'vendor', ellipsis: true },
          { title: 'Manifests', dataIndex: 'manifests', align: 'right', render: (m) => m.length },
          { title: 'Weight', dataIndex: 'weight', align: 'right' },
          { title: 'Freight', dataIndex: 'freight', align: 'right', render: money },
          { title: '', key: 'status', render: (_, r) => (r.arrived ? <Tag color="blue">Arrived</Tag> : null) },
          { title: '', key: 'view', width: 90, render: (_, r) => <Button size="small" icon={<EyeOutlined />} onClick={() => setOpen(r.challanNo)}>View</Button> },
        ]}
      />
      <ChallanDetail challanNo={open} onClose={() => setOpen(null)} canCancel={canCancel} />
    </Card>
  );
}
