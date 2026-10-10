// DRS list / view / cancel — replaces Operation/Drs_Entry_Cancel.aspx and Drs_Entry_View.aspx.
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
const STATUS_COLOR = { DLVRD: 'green', UNDELIVERED: 'orange', RTO: 'red', LOST: 'red' };

function DrsDetail({ drsNo, onClose, canCancel }) {
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ['drs', drsNo],
    queryFn: () => api.get(`/drs/${encodeURIComponent(drsNo)}`).then((r) => r.data),
    enabled: Boolean(drsNo),
  });
  const cancel = useMutation({
    mutationFn: () => api.post(`/drs/${encodeURIComponent(drsNo)}/cancel`),
    onSuccess: (r) => {
      message.success(r.data.message);
      queryClient.invalidateQueries({ queryKey: ['drs-list'] });
      queryClient.invalidateQueries({ queryKey: ['drs', drsNo] });
    },
    onError: (e) => message.error(errorMessage(e)),
  });
  const hasStatus = (data?.dockets ?? []).some((d) => d.status);

  return (
    <Drawer title={`DRS ${drsNo ?? ''}`} open={Boolean(drsNo)} onClose={onClose} width={Math.min(900, window.innerWidth)} loading={isLoading}>
      {error && <Typography.Text type="danger">{errorMessage(error)}</Typography.Text>}
      {data && (
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <Descriptions size="small" bordered column={{ xs: 1, sm: 2 }}>
            <Descriptions.Item label="Date">{fmt(data.drsDate)} {data.drsTime}</Descriptions.Item>
            <Descriptions.Item label="Status">
              {data.cancelled ? <Tag color="red">Cancelled</Tag> : data.onChallan ? <Tag color="blue">On challan {data.challanNo}</Tag> : <Tag color="green">Out for delivery</Tag>}
            </Descriptions.Item>
            <Descriptions.Item label="Delivered by">{data.deliveredBy}{data.deliveredByMobile && ` (${data.deliveredByMobile})`}</Descriptions.Item>
            <Descriptions.Item label="Vehicle">{data.vehicleNo || '—'}{data.driverName && ` · ${data.driverName}`}</Descriptions.Item>
            <Descriptions.Item label="Weight">{data.totalWeight} kg</Descriptions.Item>
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
              { title: 'Consignee', dataIndex: 'consignee' },
              { title: 'Location', dataIndex: 'location', render: (v) => v || '—' },
              { title: 'Pkts', dataIndex: 'packages', align: 'right' },
              { title: 'Weight', dataIndex: 'weight', align: 'right' },
              { title: 'Status', dataIndex: 'status', render: (v) => (v ? <Tag color={STATUS_COLOR[v]}>{v}</Tag> : 'Pending') },
            ]}
          />
          {canCancel && !data.cancelled && !data.onChallan && !hasStatus && (
            <Button
              danger icon={<StopOutlined />} loading={cancel.isPending}
              onClick={() => modal.confirm({
                title: `Cancel DRS ${drsNo}?`,
                content: 'Its packets go back to "waiting for delivery" at this branch.',
                okText: 'Cancel DRS', okButtonProps: { danger: true }, cancelText: 'Keep',
                onOk: () => cancel.mutateAsync(),
              })}
            >
              Cancel DRS
            </Button>
          )}
          {!data.cancelled && (data.onChallan || hasStatus) && (
            <Typography.Text type="secondary">
              {data.onChallan ? 'This DRS is on a challan — cancel the challan first.' : 'Delivery status has been entered, so this DRS can no longer be cancelled.'}
            </Typography.Text>
          )}
        </Space>
      )}
    </Drawer>
  );
}

export default function DrsListPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useState({
    from: dayjs().startOf('month').format('YYYY-MM-DD'), to: dayjs().format('YYYY-MM-DD'), status: 'active', search: '', scope: 'mine',
  });
  const [open, setOpen] = useState(null);
  const canCancel = ['admin', 'employee'].includes(user.role);

  const { data = [], isFetching, error } = useQuery({
    queryKey: ['drs-list', params, user.currentBranch.code],
    queryFn: () => api.get('/drs', { params }).then((r) => r.data),
  });

  return (
    <Card
      className="page-card"
      title="DRS View / Cancel"
      extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/operation/drs/new')}>New DRS</Button>}
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
          <Radio.Group optionType="button" options={[{ value: 'mine', label: 'My DRS' }, { value: 'all', label: 'All at branch' }]} />
        </Form.Item>
        <Form.Item name="search"><Input placeholder="DRS no." allowClear style={{ width: 180 }} /></Form.Item>
        <Button type="primary" htmlType="submit" loading={isFetching}>Show</Button>
      </Form>
      {error && <Typography.Text type="danger">{errorMessage(error)}</Typography.Text>}
      <Table
        size="middle"
        rowKey="drsNo"
        loading={isFetching}
        dataSource={data}
        scroll={{ x: 'max-content' }}
        pagination={{ defaultPageSize: 20, showSizeChanger: true, showTotal: (t) => `${t} DRS` }}
        columns={[
          { title: 'DRS no.', dataIndex: 'drsNo' },
          { title: 'Date', dataIndex: 'drsDate', render: (v, r) => `${fmt(v)} ${r.drsTime}` },
          { title: 'Delivered by', dataIndex: 'deliveredBy' },
          { title: 'Vehicle', dataIndex: 'vehicleNo', render: (v) => v || '—' },
          { title: 'Dockets', dataIndex: 'dockets', align: 'right' },
          { title: 'Pkts', dataIndex: 'packages', align: 'right' },
          { title: 'Weight', dataIndex: 'weight', align: 'right' },
          { title: '', key: 'view', width: 90, render: (_, r) => <Button size="small" icon={<EyeOutlined />} onClick={() => setOpen(r.drsNo)}>View</Button> },
        ]}
      />
      <DrsDetail drsNo={open} onClose={() => setOpen(null)} canCancel={canCancel} />
    </Card>
  );
}
