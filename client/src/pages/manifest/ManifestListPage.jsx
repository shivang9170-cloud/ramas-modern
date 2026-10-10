// Manifest list / view / cancel — replaces Operation/manifest_Cancel.aspx and manifest_View.aspx.
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { App, Button, Card, DatePicker, Descriptions, Drawer, Form, Input, Radio, Space, Table, Tag, Typography } from 'antd';
import { EyeOutlined, PlusOutlined, PrinterOutlined, StopOutlined } from '@ant-design/icons';
import { api, errorMessage } from '../../api/client.js';
import { useAuth } from '../../auth/AuthContext.jsx';

const DATE_FMT = 'DD/MM/YYYY';
const fmt = (v) => (v ? dayjs(v).format(DATE_FMT) : '');

function ManifestDetail({ manifestNo, onClose, canCancel }) {
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ['manifest', manifestNo],
    queryFn: () => api.get(`/manifests/${encodeURIComponent(manifestNo)}`).then((r) => r.data),
    enabled: Boolean(manifestNo),
  });
  const cancel = useMutation({
    mutationFn: () => api.post(`/manifests/${encodeURIComponent(manifestNo)}/cancel`),
    onSuccess: (r) => {
      message.success(r.data.message);
      queryClient.invalidateQueries({ queryKey: ['manifests'] });
      queryClient.invalidateQueries({ queryKey: ['manifest', manifestNo] });
      queryClient.invalidateQueries({ queryKey: ['loading-sheets'] }); // its loading sheet opens again
    },
    onError: (e) => message.error(errorMessage(e)),
  });
  const totals = (data?.dockets ?? []).reduce((t, d) => ({ p: t.p + d.packages, w: t.w + d.weight }), { p: 0, w: 0 });

  return (
    <Drawer title={`Manifest ${manifestNo ?? ''}`} open={Boolean(manifestNo)} onClose={onClose} width={Math.min(900, window.innerWidth)} loading={isLoading}>
      {error && <Typography.Text type="danger">{errorMessage(error)}</Typography.Text>}
      {data && (
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <Descriptions size="small" bordered column={{ xs: 1, sm: 2 }}>
            <Descriptions.Item label="Date">{fmt(data.manifestDate)} {data.manifestTime}</Descriptions.Item>
            <Descriptions.Item label="Status">
              {data.cancelled ? <Tag color="red">Cancelled</Tag> : data.challanNo ? <Tag color="blue">Challan {data.challanNo}</Tag> : <Tag color="green">Open</Tag>}
            </Descriptions.Item>
            <Descriptions.Item label="Destination">{data.destination} <Tag>{data.freightType}</Tag></Descriptions.Item>
            <Descriptions.Item label="Transported by">{data.transportedBy}{data.coloaderName && ` — ${data.coloaderName}`}</Descriptions.Item>
            {data.manualNo && <Descriptions.Item label="Manual no.">{data.manualNo}</Descriptions.Item>}
            <Descriptions.Item label="Created by">{data.createdBy}</Descriptions.Item>
            {data.remarks && <Descriptions.Item label="Remarks" span={2}>{data.remarks}</Descriptions.Item>}
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
              { title: 'Pkts', dataIndex: 'packages', align: 'right' },
              { title: 'Weight', dataIndex: 'weight', align: 'right' },
              ...(data.bags?.length ? [{
                title: 'Packet / bag', key: 'bag',
                render: (_, r) => data.bags.find((b) => b.docketNos.includes(r.docketNo))?.bagNo ?? '—',
              }] : []),
            ]}
            summary={() => (
              <Table.Summary.Row>
                <Table.Summary.Cell index={0} colSpan={4}><strong>Total</strong></Table.Summary.Cell>
                <Table.Summary.Cell index={4} align="right"><strong>{totals.p}</strong></Table.Summary.Cell>
                <Table.Summary.Cell index={5} align="right"><strong>{totals.w.toFixed(2)}</strong></Table.Summary.Cell>
              </Table.Summary.Row>
            )}
          />
          {data.bags?.length > 0 && (
            <Space wrap>
              {['MASTER', 'BAG', 'PACKET'].map((l) => {
                const c = data.bags.filter((b) => b.level === l).length;
                return c ? <Tag key={l} color={{ MASTER: 'purple', BAG: 'blue', PACKET: 'green' }[l]}>{c} {{ MASTER: 'master bag', BAG: 'bag', PACKET: 'packet' }[l]}{c > 1 ? 's' : ''}</Tag> : null;
              })}
              <Button icon={<PrinterOutlined />} onClick={() => window.open(`/print/manifest-bags/${encodeURIComponent(data.manifestNo)}`, '_blank')}>
                Print bag labels
              </Button>
            </Space>
          )}
          {canCancel && !data.cancelled && !data.challanNo && (
            <Button
              danger icon={<StopOutlined />} loading={cancel.isPending}
              onClick={() => modal.confirm({
                title: `Cancel manifest ${manifestNo}?`,
                content: 'Its packages go back to pending at this branch.',
                okText: 'Cancel manifest', okButtonProps: { danger: true }, cancelText: 'Keep',
                onOk: () => cancel.mutateAsync(),
              })}
            >
              Cancel manifest
            </Button>
          )}
          {data.challanNo && !data.cancelled && (
            <Typography.Text type="secondary">A challan has been generated, so this manifest can no longer be cancelled.</Typography.Text>
          )}
        </Space>
      )}
    </Drawer>
  );
}

export default function ManifestListPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useState({
    from: dayjs().startOf('month').format('YYYY-MM-DD'), to: dayjs().format('YYYY-MM-DD'), status: 'active', search: '', scope: 'mine',
  });
  const [open, setOpen] = useState(null);
  const canCancel = ['admin', 'employee'].includes(user.role);

  const { data = [], isFetching, error } = useQuery({
    queryKey: ['manifests', params, user.currentBranch.code],
    queryFn: () => api.get('/manifests', { params }).then((r) => r.data),
  });

  return (
    <Card
      className="page-card"
      title="Manifest View / Cancel"
      extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/operation/manifest/new')}>New manifest</Button>}
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
          <Radio.Group optionType="button" options={[{ value: 'mine', label: 'My manifests' }, { value: 'all', label: 'All at branch' }]} />
        </Form.Item>
        <Form.Item name="search"><Input placeholder="Manifest no." allowClear style={{ width: 180 }} /></Form.Item>
        <Button type="primary" htmlType="submit" loading={isFetching}>Show</Button>
      </Form>
      {error && <Typography.Text type="danger">{errorMessage(error)}</Typography.Text>}
      <Table
        size="middle"
        rowKey="manifestNo"
        loading={isFetching}
        dataSource={data}
        scroll={{ x: 'max-content' }}
        pagination={{ defaultPageSize: 20, showSizeChanger: true, showTotal: (t) => `${t} manifests` }}
        columns={[
          { title: 'Manifest no.', dataIndex: 'manifestNo' },
          { title: 'Date', dataIndex: 'manifestDate', render: fmt, sorter: (a, b) => a.manifestDate.localeCompare(b.manifestDate) },
          { title: 'Destination', key: 'dest', render: (_, r) => r.toBranch || r.toCity },
          { title: 'Type', dataIndex: 'freightType' },
          { title: 'Dockets', dataIndex: 'dockets', align: 'right' },
          { title: 'Pkts', dataIndex: 'packages', align: 'right' },
          { title: 'Challan', dataIndex: 'challanNo', render: (c) => c || '—' },
          { title: '', key: 'view', width: 90, render: (_, r) => <Button size="small" icon={<EyeOutlined />} onClick={() => setOpen(r.manifestNo)}>View</Button> },
        ]}
      />
      <ManifestDetail manifestNo={open} onClose={() => setOpen(null)} canCancel={canCancel} />
    </Card>
  );
}
