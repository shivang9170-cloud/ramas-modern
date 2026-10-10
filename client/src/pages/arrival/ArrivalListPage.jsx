// Arrival list / view / cancel — replaces Operation/Arrival_Entry_Cancel.aspx and Arrival_Entry_View.aspx.
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

function ArrivalDetail({ arrivalNo, onClose, canCancel }) {
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ['arrival', arrivalNo],
    queryFn: () => api.get(`/arrivals/${encodeURIComponent(arrivalNo)}`).then((r) => r.data),
    enabled: Boolean(arrivalNo),
  });
  const cancel = useMutation({
    mutationFn: () => api.post(`/arrivals/${encodeURIComponent(arrivalNo)}/cancel`),
    onSuccess: (r) => {
      message.success(r.data.message);
      queryClient.invalidateQueries({ queryKey: ['arrivals'] });
      queryClient.invalidateQueries({ queryKey: ['arrival', arrivalNo] });
    },
    onError: (e) => message.error(errorMessage(e)),
  });
  const hasDrs = (data?.dockets ?? []).some((d) => d.drsNo);

  return (
    <Drawer title={`Arrival ${arrivalNo ?? ''}`} open={Boolean(arrivalNo)} onClose={onClose} width={Math.min(900, window.innerWidth)} loading={isLoading}>
      {error && <Typography.Text type="danger">{errorMessage(error)}</Typography.Text>}
      {data && (
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <Descriptions size="small" bordered column={{ xs: 1, sm: 2 }}>
            <Descriptions.Item label="Received">{fmt(data.receiveDate)} {data.receiveTime}</Descriptions.Item>
            <Descriptions.Item label="Status">{data.cancelled ? <Tag color="red">Cancelled</Tag> : <Tag color="green">Received</Tag>}</Descriptions.Item>
            <Descriptions.Item label="Challan">{data.challanNo} · {data.truckNo}</Descriptions.Item>
            <Descriptions.Item label="From">{data.from}</Descriptions.Item>
            <Descriptions.Item label="Weight">
              manifest {data.actualWeight} kg · inward {data.inwardWeight} kg
              {data.difference !== 0 && <Tag color="red" style={{ marginLeft: 8 }}>diff {data.difference} kg</Tag>}
            </Descriptions.Item>
            <Descriptions.Item label="KM">{data.openingKm || '—'} → {data.closingKm || '—'}</Descriptions.Item>
            {data.message && <Descriptions.Item label="Remarks" span={2}>{data.message}</Descriptions.Item>}
            <Descriptions.Item label="Created by">{data.createdBy}</Descriptions.Item>
          </Descriptions>
          <Table
            size="small"
            rowKey={(r) => `${r.manifestNo}|${r.docketNo}`}
            pagination={false}
            scroll={{ x: 'max-content' }}
            dataSource={data.dockets}
            columns={[
              { title: 'Docket no.', dataIndex: 'docketNo', render: (v, r) => (r.excess ? <>{v} <Tag color="purple">excess</Tag></> : v) },
              { title: 'Manifest', dataIndex: 'manifestNo' },
              { title: 'Consignee', dataIndex: 'consignee' },
              { title: 'Pkts', key: 'p', align: 'right', render: (_, r) => (r.packages < r.bookedPackages ? <>{r.packages} / {r.bookedPackages} <Tag color="orange">short</Tag></> : r.packages) },
              { title: 'Weight', dataIndex: 'weight', align: 'right' },
              { title: 'Remarks', dataIndex: 'remarks' },
              { title: 'DRS', dataIndex: 'drsNo', render: (v) => v || '—' },
            ]}
          />
          {canCancel && !data.cancelled && !hasDrs && (
            <Button
              danger icon={<StopOutlined />} loading={cancel.isPending}
              onClick={() => modal.confirm({
                title: `Cancel arrival ${arrivalNo}?`,
                content: `The challan ${data.challanNo} goes back to "in transit" for this branch.`,
                okText: 'Cancel arrival', okButtonProps: { danger: true }, cancelText: 'Keep',
                onOk: () => cancel.mutateAsync(),
              })}
            >
              Cancel arrival
            </Button>
          )}
          {hasDrs && !data.cancelled && <Typography.Text type="secondary">Dockets are on a DRS, so this arrival can no longer be cancelled.</Typography.Text>}
        </Space>
      )}
    </Drawer>
  );
}

export default function ArrivalListPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useState({
    from: dayjs().startOf('month').format('YYYY-MM-DD'), to: dayjs().format('YYYY-MM-DD'), status: 'active', search: '', scope: 'mine',
  });
  const [open, setOpen] = useState(null);
  const canCancel = ['admin', 'employee'].includes(user.role);

  const { data = [], isFetching, error } = useQuery({
    queryKey: ['arrivals', params, user.currentBranch.code],
    queryFn: () => api.get('/arrivals', { params }).then((r) => r.data),
  });

  return (
    <Card
      className="page-card"
      title="Arrival View / Cancel"
      extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/operation/arrival/new')}>New arrival</Button>}
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
          <Radio.Group optionType="button" options={[{ value: 'mine', label: 'My arrivals' }, { value: 'all', label: 'All at branch' }]} />
        </Form.Item>
        <Form.Item name="search"><Input placeholder="Arrival / challan no." allowClear style={{ width: 200 }} /></Form.Item>
        <Button type="primary" htmlType="submit" loading={isFetching}>Show</Button>
      </Form>
      {error && <Typography.Text type="danger">{errorMessage(error)}</Typography.Text>}
      <Table
        size="middle"
        rowKey="arrivalNo"
        loading={isFetching}
        dataSource={data}
        scroll={{ x: 'max-content' }}
        pagination={{ defaultPageSize: 20, showSizeChanger: true, showTotal: (t) => `${t} arrivals` }}
        columns={[
          { title: 'Arrival no.', dataIndex: 'arrivalNo' },
          { title: 'Received', dataIndex: 'receiveDate', render: (v, r) => `${fmt(v)} ${r.receiveTime}` },
          { title: 'Challan', dataIndex: 'challanNo' },
          { title: 'From', dataIndex: 'from' },
          { title: 'Vehicle', dataIndex: 'truckNo' },
          { title: 'Dockets', dataIndex: 'dockets', align: 'right' },
          { title: 'Pkts', dataIndex: 'packages', align: 'right' },
          { title: 'Diff (kg)', dataIndex: 'difference', align: 'right', render: (v) => (v ? <Typography.Text type="danger">{v}</Typography.Text> : 0) },
          { title: '', key: 'view', width: 90, render: (_, r) => <Button size="small" icon={<EyeOutlined />} onClick={() => setOpen(r.arrivalNo)}>View</Button> },
        ]}
      />
      <ArrivalDetail arrivalNo={open} onClose={() => setOpen(null)} canCancel={canCancel} />
    </Card>
  );
}
