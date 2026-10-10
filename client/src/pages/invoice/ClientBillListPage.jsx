// Client bill list / view / cancel — replaces Invoice/Client_Bill_Cancel.aspx, client_bill_ReportGST.aspx and
// client_bill_Report.aspx; "Print" opens the bill (Client_Bill_PrintGST / Client_Bill_Print).
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { App, Button, Card, DatePicker, Descriptions, Drawer, Form, Input, Radio, Space, Table, Tag, Typography } from 'antd';
import { EyeOutlined, PlusOutlined, PrinterOutlined, StopOutlined } from '@ant-design/icons';
import { api, errorMessage } from '../../api/client.js';
import { openBillPrint } from './ClientBillPage.jsx';

const DATE_FMT = 'DD/MM/YYYY';
const fmt = (v) => (v ? dayjs(v).format(DATE_FMT) : '');
const money = (v) => Number(v || 0).toFixed(2);
const STATUS_COLOR = { Generated: 'green', Submitted: 'blue', Finalized: 'purple', 'Part paid': 'orange', Paid: 'gold', Cancelled: 'red' };

function BillDetail({ billNo, onClose }) {
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');
  const { data, isLoading, error } = useQuery({
    queryKey: ['client-bill', billNo],
    queryFn: () => api.get(`/client-bills/${encodeURIComponent(billNo)}`).then((r) => r.data),
    enabled: Boolean(billNo),
  });
  const cancel = useMutation({
    mutationFn: () => api.post(`/client-bills/${encodeURIComponent(billNo)}/cancel`, { remarks: reason }),
    onSuccess: (r) => {
      message.success(r.data.message);
      setReason('');
      queryClient.invalidateQueries({ queryKey: ['client-bills'] });
      queryClient.invalidateQueries({ queryKey: ['client-bill', billNo] });
    },
    onError: (e) => message.error(errorMessage(e)),
  });

  return (
    <Drawer title={`Bill ${billNo ?? ''}`} open={Boolean(billNo)} onClose={onClose} width={Math.min(1000, window.innerWidth)} loading={isLoading}
      extra={data && <Button icon={<PrinterOutlined />} onClick={() => openBillPrint(billNo)}>Print</Button>}>
      {error && <Typography.Text type="danger">{errorMessage(error)}</Typography.Text>}
      {data && (
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <Descriptions size="small" bordered column={{ xs: 1, sm: 2 }}>
            <Descriptions.Item label="Client">{data.client.name} : {data.client.code}</Descriptions.Item>
            <Descriptions.Item label="Status"><Tag color={STATUS_COLOR[data.status]}>{data.status}</Tag></Descriptions.Item>
            <Descriptions.Item label="Bill date">{fmt(data.billDate)} · due {fmt(data.dueDate)}</Descriptions.Item>
            <Descriptions.Item label="Dockets booked">{fmt(data.from)} – {fmt(data.to)}</Descriptions.Item>
            <Descriptions.Item label="Tax">{data.taxType} · {data.serviceType} (SAC {data.sacCode})</Descriptions.Item>
            <Descriptions.Item label="Created by">{data.createdBy}{data.cancelledBy && ` · cancelled by ${data.cancelledBy}`}</Descriptions.Item>
            {data.remarks && <Descriptions.Item label="Remarks" span={2}>{data.remarks}</Descriptions.Item>}
          </Descriptions>
          <Table size="small" rowKey="docketNo" pagination={false} scroll={{ x: 'max-content' }} dataSource={data.dockets}
            columns={[
              { title: 'Docket no.', dataIndex: 'docketNo' },
              { title: 'Booked', dataIndex: 'bookingDate', render: fmt },
              { title: 'Origin', dataIndex: 'origin' },
              { title: 'Destination', dataIndex: 'destination' },
              { title: 'Pkts', dataIndex: 'packages', align: 'right' },
              { title: 'Weight', dataIndex: 'weight', align: 'right' },
              { title: 'Freight', dataIndex: 'freight', align: 'right', render: money },
              { title: 'GST', key: 'g', align: 'right', render: (_, r) => money(r.igst + r.cgst + r.sgst) },
              { title: 'Total', dataIndex: 'total', align: 'right', render: money },
            ]}
            summary={() => (
              <Table.Summary.Row>
                <Table.Summary.Cell index={0} colSpan={6}><strong>Total ({data.dockets.length})</strong></Table.Summary.Cell>
                <Table.Summary.Cell index={6} align="right"><strong>{money(data.totals.freight)}</strong></Table.Summary.Cell>
                <Table.Summary.Cell index={7} align="right"><strong>{money(data.totals.tax)}</strong></Table.Summary.Cell>
                <Table.Summary.Cell index={8} align="right"><strong>{money(data.totals.total)}</strong></Table.Summary.Cell>
              </Table.Summary.Row>
            )} />
          {data.status === 'Generated' && (
            <Space.Compact style={{ width: '100%' }}>
              <Input placeholder="Reason for cancelling" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} aria-label="Reason for cancelling" />
              <Button danger icon={<StopOutlined />} loading={cancel.isPending} disabled={reason.trim().length < 3}
                onClick={() => modal.confirm({
                  title: `Cancel bill ${billNo}?`, content: 'Its dockets can then be billed again.',
                  okText: 'Cancel bill', okButtonProps: { danger: true }, cancelText: 'Keep', onOk: () => cancel.mutateAsync(),
                })}>Cancel bill</Button>
            </Space.Compact>
          )}
          {['Submitted', 'Finalized', 'Part paid', 'Paid'].includes(data.status) && (
            <Typography.Text type="secondary">The bill is {data.status.toLowerCase()}, so it can no longer be cancelled.</Typography.Text>
          )}
        </Space>
      )}
    </Drawer>
  );
}

export default function ClientBillListPage() {
  const navigate = useNavigate();
  const [params, setParams] = useState({ from: dayjs().startOf('month').format('YYYY-MM-DD'), to: dayjs().format('YYYY-MM-DD'), status: 'active', search: '' });
  const [open, setOpen] = useState(null);
  const { data = [], isFetching, error } = useQuery({
    queryKey: ['client-bills', params],
    queryFn: () => api.get('/client-bills', { params }).then((r) => r.data),
  });

  return (
    <Card className="page-card" title="Client Bill View / Cancel"
      extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/invoice/client-bill/new')}>New bill</Button>}>
      <Form layout="inline" style={{ rowGap: 8, marginBottom: 12 }}
        initialValues={{ range: [dayjs(params.from), dayjs(params.to)], status: 'active' }}
        onFinish={(v) => setParams({ from: v.range[0].format('YYYY-MM-DD'), to: v.range[1].format('YYYY-MM-DD'), status: v.status, search: v.search?.trim() || '' })}>
        <Form.Item name="range" label="Bill date"><DatePicker.RangePicker format={DATE_FMT} allowClear={false} /></Form.Item>
        <Form.Item name="status">
          <Radio.Group optionType="button" options={[{ value: 'active', label: 'Active' }, { value: 'cancelled', label: 'Cancelled' }]} />
        </Form.Item>
        <Form.Item name="search"><Input placeholder="Bill no. / client" allowClear style={{ width: 200 }} /></Form.Item>
        <Button type="primary" htmlType="submit" loading={isFetching}>Show</Button>
      </Form>
      {error && <Typography.Text type="danger">{errorMessage(error)}</Typography.Text>}
      <Table size="middle" rowKey="billNo" loading={isFetching} dataSource={data} scroll={{ x: 'max-content' }}
        pagination={{ defaultPageSize: 20, showSizeChanger: true, showTotal: (t) => `${t} bills` }}
        columns={[
          { title: 'Bill no.', dataIndex: 'billNo' },
          { title: 'Date', dataIndex: 'billDate', render: fmt },
          { title: 'Due', dataIndex: 'dueDate', render: fmt },
          { title: 'Client / party', dataIndex: 'clientName' },
          { title: 'Type', dataIndex: 'billType' },
          { title: 'Tax', dataIndex: 'taxType' },
          { title: 'Dockets', dataIndex: 'dockets', align: 'right' },
          { title: 'Amount', dataIndex: 'totalAmount', align: 'right', render: money },
          { title: 'Status', dataIndex: 'status', render: (v) => <Tag color={STATUS_COLOR[v]}>{v}</Tag> },
          {
            title: '', key: 'act', width: 170, render: (_, r) => (
              <Space>
                <Button size="small" icon={<EyeOutlined />} onClick={() => setOpen(r.billNo)}>View</Button>
                <Button size="small" icon={<PrinterOutlined />} onClick={() => openBillPrint(r.billNo)} aria-label={`Print ${r.billNo}`} />
              </Space>
            ),
          },
        ]} />
      <BillDetail billNo={open} onClose={() => setOpen(null)} />
    </Card>
  );
}
