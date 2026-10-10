// Pickup list / view / cancel — replaces Operation/Pickup_Entry_Cancel.aspx and Pickup_EntryView.aspx.
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import {
  App, Button, Card, DatePicker, Descriptions, Drawer, Form, Input, Radio, Space, Table, Tag, Typography,
} from 'antd';
import { EyeOutlined, PlusOutlined, StopOutlined } from '@ant-design/icons';
import { api, errorMessage } from '../../api/client.js';
import { useAuth } from '../../auth/AuthContext.jsx';

const DATE_FMT = 'DD/MM/YYYY';
const fmt = (v) => (v ? dayjs(v).format(DATE_FMT) : '');

function PickupDetail({ pickupNo, onClose, canCancel }) {
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ['pickup', pickupNo],
    queryFn: () => api.get(`/pickups/${encodeURIComponent(pickupNo)}`).then((r) => r.data),
    enabled: Boolean(pickupNo),
  });
  const cancel = useMutation({
    mutationFn: () => api.post(`/pickups/${encodeURIComponent(pickupNo)}/cancel`),
    onSuccess: (r) => {
      message.success(r.data.message);
      queryClient.invalidateQueries({ queryKey: ['pickups'] });
      queryClient.invalidateQueries({ queryKey: ['pickup', pickupNo] });
    },
    onError: (e) => message.error(errorMessage(e)),
  });

  return (
    <Drawer title={`Pickup ${pickupNo ?? ''}`} open={Boolean(pickupNo)} onClose={onClose} width={Math.min(900, window.innerWidth)} loading={isLoading}>
      {error && <Typography.Text type="danger">{errorMessage(error)}</Typography.Text>}
      {data && (
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <Descriptions size="small" bordered column={{ xs: 1, sm: 2 }}>
            <Descriptions.Item label="Date">{fmt(data.pickupDate)} {data.pickupTime}</Descriptions.Item>
            <Descriptions.Item label="Status">
              {data.cancelled ? <Tag color="red">Cancelled</Tag> : data.challanNo ? <Tag color="blue">Challan {data.challanNo}</Tag> : <Tag color="green">Open</Tag>}
            </Descriptions.Item>
            <Descriptions.Item label="Picked up by">{data.pickupBy || '—'} {data.pickupByMobile && `(${data.pickupByMobile})`}</Descriptions.Item>
            <Descriptions.Item label="Created by">{data.createdBy}</Descriptions.Item>
          </Descriptions>
          <Table
            size="small"
            rowKey="docketNo"
            pagination={false}
            scroll={{ x: 'max-content' }}
            dataSource={data.dockets}
            columns={[
              { title: 'Docket no.', dataIndex: 'docketNo' },
              { title: 'Booked', dataIndex: 'bookingDate', render: fmt },
              { title: 'Consignor', dataIndex: 'consigner' },
              { title: 'Consignee', dataIndex: 'consignee' },
              { title: 'Location', dataIndex: 'location' },
              { title: 'Pkts', dataIndex: 'packages', align: 'right' },
              { title: 'Weight', dataIndex: 'weight', align: 'right' },
              { title: '', dataIndex: 'manifested', render: (m) => (m ? <Tag color="blue">Manifested</Tag> : null) },
            ]}
          />
          {canCancel && !data.cancelled && (
            <Button
              danger icon={<StopOutlined />} loading={cancel.isPending}
              onClick={() => modal.confirm({
                title: `Cancel pickup ${pickupNo}?`,
                content: 'Its dockets will become available for a new pickup.',
                okText: 'Cancel pickup', okButtonProps: { danger: true }, cancelText: 'Keep',
                onOk: () => cancel.mutateAsync(),
              })}
            >
              Cancel pickup
            </Button>
          )}
        </Space>
      )}
    </Drawer>
  );
}

export default function PickupListPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [form] = Form.useForm();
  const [params, setParams] = useState({
    from: dayjs().startOf('month').format('YYYY-MM-DD'), to: dayjs().format('YYYY-MM-DD'), status: 'active', search: '',
  });
  const [open, setOpen] = useState(null);
  const canCancel = ['admin', 'employee'].includes(user.role);

  const { data = [], isFetching, error } = useQuery({
    queryKey: ['pickups', params, user.currentBranch.code],
    queryFn: () => api.get('/pickups', { params }).then((r) => r.data),
  });

  return (
    <Card
      className="page-card"
      title="Pickup View / Cancel"
      extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/operation/pickup/new')}>New pickup</Button>}
    >
      <Form
        form={form}
        layout="inline"
        style={{ rowGap: 8, marginBottom: 12 }}
        initialValues={{ range: [dayjs(params.from), dayjs(params.to)], status: 'active' }}
        onFinish={(v) => setParams({
          from: v.range[0].format('YYYY-MM-DD'), to: v.range[1].format('YYYY-MM-DD'), status: v.status, search: v.search?.trim() || '',
        })}
      >
        <Form.Item name="range" label="Pickup date"><DatePicker.RangePicker format={DATE_FMT} allowClear={false} /></Form.Item>
        <Form.Item name="status">
          <Radio.Group optionType="button" options={[{ value: 'active', label: 'Active' }, { value: 'cancelled', label: 'Cancelled' }]} />
        </Form.Item>
        <Form.Item name="search"><Input placeholder="Pickup no." allowClear style={{ width: 180 }} /></Form.Item>
        <Button type="primary" htmlType="submit" loading={isFetching}>Show</Button>
      </Form>
      {error && <Typography.Text type="danger">{errorMessage(error)}</Typography.Text>}
      <Table
        size="middle"
        rowKey="pickupNo"
        loading={isFetching}
        dataSource={data}
        scroll={{ x: 'max-content' }}
        pagination={{ defaultPageSize: 20, showSizeChanger: true, showTotal: (t) => `${t} pickups` }}
        columns={[
          { title: 'Pickup no.', dataIndex: 'pickupNo' },
          { title: 'Date', dataIndex: 'pickupDate', render: fmt, sorter: (a, b) => a.pickupDate.localeCompare(b.pickupDate) },
          { title: 'Time', dataIndex: 'pickupTime' },
          { title: 'Dockets', dataIndex: 'dockets', align: 'right' },
          { title: 'Picked up by', dataIndex: 'pickupBy' },
          { title: 'Challan', dataIndex: 'challanNo', render: (c) => c || '—' },
          {
            title: '', key: 'view', width: 90,
            render: (_, r) => <Button size="small" icon={<EyeOutlined />} onClick={() => setOpen(r.pickupNo)}>View</Button>,
          },
        ]}
      />
      <PickupDetail pickupNo={open} onClose={() => setOpen(null)} canCancel={canCancel} />
    </Card>
  );
}
