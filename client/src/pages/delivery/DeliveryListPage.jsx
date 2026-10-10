// Delivery status list / cancel — replaces Operation/deliverystatusentry_Cancel.aspx and deliverystatusentry_view.aspx.
// Cancelling works per DRS and only for admin (legacy rule).
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { App, Button, Card, DatePicker, Form, Input, Radio, Table, Tag, Typography } from 'antd';
import { PlusOutlined, StopOutlined } from '@ant-design/icons';
import { api, errorMessage } from '../../api/client.js';
import { useAuth } from '../../auth/AuthContext.jsx';

const DATE_FMT = 'DD/MM/YYYY';
const fmt = (v) => (v ? dayjs(v).format(DATE_FMT) : '');
const COLOR = { DLVRD: 'green', UNDELIVERED: 'orange', RTO: 'volcano', LOST: 'red' };

export default function DeliveryListPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();
  const isAdmin = user.role === 'admin';
  const [params, setParams] = useState({
    from: dayjs().startOf('month').format('YYYY-MM-DD'), to: dayjs().format('YYYY-MM-DD'), status: 'active', search: '', scope: 'mine',
  });

  const { data = [], isFetching, error } = useQuery({
    queryKey: ['delivery-list', params, user.currentBranch.code],
    queryFn: () => api.get('/delivery', { params }).then((r) => r.data),
  });
  const cancel = useMutation({
    mutationFn: (drsNo) => api.post(`/delivery/drs/${encodeURIComponent(drsNo)}/cancel`),
    onSuccess: (r) => { message.success(`${r.data.message} (${r.data.cancelled} docket(s))`); queryClient.invalidateQueries({ queryKey: ['delivery-list'] }); },
    onError: (e) => message.error(errorMessage(e)),
  });

  // First row of each DRS carries the cancel button.
  const firstOfDrs = new Set();
  const seen = new Set();
  for (const r of data) { if (r.drsNo && !seen.has(r.drsNo)) { seen.add(r.drsNo); firstOfDrs.add(`${r.drsNo}|${r.docketNo}`); } }

  return (
    <Card
      className="page-card"
      title="Delivery Status View / Cancel"
      extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/operation/delivery/new')}>Enter status</Button>}
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
          <Radio.Group optionType="button" options={[{ value: 'mine', label: 'Mine' }, { value: 'all', label: 'All at branch' }]} />
        </Form.Item>
        <Form.Item name="search"><Input placeholder="DRS / docket no." allowClear style={{ width: 180 }} /></Form.Item>
        <Button type="primary" htmlType="submit" loading={isFetching}>Show</Button>
      </Form>
      {error && <Typography.Text type="danger">{errorMessage(error)}</Typography.Text>}
      {!isAdmin && params.status === 'active' && (
        <Typography.Paragraph type="secondary">Only admin can cancel a delivery status.</Typography.Paragraph>
      )}
      <Table
        size="middle"
        rowKey={(r) => `${r.drsNo}|${r.docketNo}`}
        loading={isFetching}
        dataSource={data}
        scroll={{ x: 'max-content' }}
        pagination={{ defaultPageSize: 50, showSizeChanger: true, showTotal: (t) => `${t} dockets` }}
        columns={[
          { title: 'DRS no.', dataIndex: 'drsNo', render: (v) => v || <Tag>Godown</Tag> },
          { title: 'Docket no.', dataIndex: 'docketNo' },
          { title: 'Status', dataIndex: 'status', render: (v) => <Tag color={COLOR[v]}>{v}</Tag> },
          { title: 'Date', dataIndex: 'date', render: (v, r) => `${fmt(v)} ${r.time}` },
          { title: 'Receiver', dataIndex: 'receiver', render: (v) => v || '—' },
          { title: 'By', dataIndex: 'createdBy' },
          {
            title: '', key: 'cancel', width: 150,
            render: (_, r) => (isAdmin && params.status === 'active' && r.drsNo && firstOfDrs.has(`${r.drsNo}|${r.docketNo}`) ? (
              <Button size="small" danger icon={<StopOutlined />} loading={cancel.isPending && cancel.variables === r.drsNo}
                onClick={() => modal.confirm({
                  title: `Cancel delivery status of DRS ${r.drsNo}?`,
                  content: 'Every docket on this DRS goes back to "out for delivery".',
                  okText: 'Cancel status', okButtonProps: { danger: true }, cancelText: 'Keep',
                  onOk: () => cancel.mutateAsync(r.drsNo),
                })}>
                Cancel DRS status
              </Button>
            ) : null),
          },
        ]}
      />
    </Card>
  );
}
