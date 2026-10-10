// Approval screens:
//   * SpecialBookingApprovalPage (replaces Setting/Special_Booking_Approval.aspx) — discounted dockets approved level by
//     level (Branch Manager → Area Manager → Division Head → final) by the size of the discount, or rejected;
//   * FreightMarginApprovalPage (replaces Setting/Freight_THC_Margin_Approval.aspx) — challans whose truck-hire freight
//     leaves less than the minimum margin on the dockets' freight; a rejected challan is cancelled.
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, App, Button, Card, Input, InputNumber, Popconfirm, Space, Table, Tabs, Tag } from 'antd';
import { CheckOutlined, CloseOutlined } from '@ant-design/icons';
import { api } from '../../api/client.js';
import { date, get, money, send } from './common.js';

const STAGE_COLOR = { FinA: 'green', Rejected: 'red' };

export function SpecialBookingApprovalPage() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [picked, setPicked] = useState([]);
  const [remarks, setRemarks] = useState({});
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useQuery({ queryKey: ['spl-pending'], queryFn: () => get('/approvals/special-booking') });
  const decided = useQuery({ queryKey: ['spl-decided', search], queryFn: () => get('/approvals/special-booking/decided', { search }) });

  async function decide(kind) {
    setBusy(true);
    const items = picked.map((d) => ({ docketNo: d, remarks: remarks[d] ?? '' }));
    const res = await send(message, () => api.post(`/approvals/special-booking/${kind}`, { items }));
    setBusy(false);
    if (res) {
      setPicked([]);
      queryClient.invalidateQueries({ queryKey: ['spl-pending'] });
      queryClient.invalidateQueries({ queryKey: ['spl-decided'] });
    }
  }

  const cols = [
    { title: 'Docket', dataIndex: 'docketNo' },
    { title: 'Booked', dataIndex: 'bookingDate', render: date },
    { title: 'On account of', dataIndex: 'onAccountOf' },
    { title: 'From', dataIndex: 'origin' },
    { title: 'To', dataIndex: 'destination' },
    { title: 'Pkgs', dataIndex: 'packages', align: 'right' },
    { title: 'Charge wt', dataIndex: 'chargeWeight', align: 'right' },
    { title: 'Freight', dataIndex: 'freight', align: 'right', render: money },
    { title: 'Discount %', dataIndex: 'discount', align: 'right' },
    { title: 'Status', dataIndex: 'stageLabel', render: (v, r) => <Tag color={STAGE_COLOR[r.stage]}>{v}</Tag> },
  ];

  return (
    <Card className="page-card" title="Special Booking Approval">
      <Tabs items={[
        {
          key: 'pending', label: `Pending (${pending.data?.length ?? 0})`,
          children: (
            <>
              <Space style={{ marginBottom: 12 }}>
                <Button type="primary" icon={<CheckOutlined />} loading={busy} disabled={!picked.length} onClick={() => decide('approve')}>Approve</Button>
                <Popconfirm title={`Reject ${picked.length} docket(s)?`} onConfirm={() => decide('reject')} disabled={!picked.length}>
                  <Button danger icon={<CloseOutlined />} disabled={!picked.length}>Reject</Button>
                </Popconfirm>
              </Space>
              <Alert type="info" showIcon style={{ marginBottom: 12 }}
                message="Up to 10 %: the branch manager's approval is final. 11–20 %: then the area manager. 21–70 %: then the division head. Above 70 %: one more final approval." />
              <Table size="small" rowKey="docketNo" loading={pending.isFetching} dataSource={pending.data ?? []} scroll={{ x: 'max-content' }}
                rowSelection={{ selectedRowKeys: picked, onChange: setPicked }}
                columns={[...cols,
                  { title: 'Next approver', dataIndex: 'nextApprover' },
                  {
                    title: 'Remarks', key: 'rm',
                    render: (_, r) => <Input size="small" style={{ width: 180 }} value={remarks[r.docketNo]} aria-label={`Remarks ${r.docketNo}`}
                      onChange={(e) => setRemarks({ ...remarks, [r.docketNo]: e.target.value })} />,
                  }]} />
            </>
          ),
        },
        {
          key: 'decided', label: 'Approved / rejected',
          children: (
            <>
              <Input.Search placeholder="Docket or client" allowClear style={{ width: 260, marginBottom: 12 }} onSearch={setSearch} />
              <Table size="small" rowKey="docketNo" loading={decided.isFetching} dataSource={decided.data ?? []} scroll={{ x: 'max-content' }}
                columns={[...cols,
                  { title: 'Approvals', dataIndex: 'history', render: (h) => h.map((x) => `${x.level}: ${x.by} (${date(x.date)})`).join('; ') },
                  { title: 'Remarks', dataIndex: 'remarks' }]} />
            </>
          ),
        },
      ]} />
    </Card>
  );
}

export function FreightMarginApprovalPage() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [picked, setPicked] = useState([]);
  const [remarks, setRemarks] = useState({});
  const [search, setSearch] = useState('');
  const [minimum, setMinimum] = useState(null);
  const [busy, setBusy] = useState(false);
  const pending = useQuery({ queryKey: ['margin-pending'], queryFn: () => get('/approvals/freight-margin') });
  const decided = useQuery({ queryKey: ['margin-decided', search], queryFn: () => get('/approvals/freight-margin/decided', { search }) });
  const refresh = () => { queryClient.invalidateQueries({ queryKey: ['margin-pending'] }); queryClient.invalidateQueries({ queryKey: ['margin-decided'] }); };

  async function decide(approve) {
    setBusy(true);
    const items = picked.map((c) => ({ challanNo: c, remarks: remarks[c] ?? '' }));
    const res = await send(message, () => api.post('/approvals/freight-margin/decide', { approve, items }));
    setBusy(false);
    if (res) { setPicked([]); refresh(); }
  }

  const cols = [
    { title: 'Challan', dataIndex: 'challanNo' },
    { title: 'Date', dataIndex: 'challanDate', render: date },
    { title: 'Branch', dataIndex: 'branchName' },
    { title: 'Docket freight', dataIndex: 'docketFreight', align: 'right', render: money },
    { title: 'THC freight', dataIndex: 'thcFreight', align: 'right', render: money },
    { title: 'Margin', dataIndex: 'margin', align: 'right', render: money },
    { title: 'Margin %', dataIndex: 'marginPercent', align: 'right', render: (v) => <Tag color={v < 0 ? 'red' : 'orange'}>{v}</Tag> },
  ];

  return (
    <Card className="page-card" title="Freight / THC Margin Approval"
      extra={(
        <Space>
          Minimum margin %
          <InputNumber min={-100} max={100} value={minimum ?? pending.data?.minMarginPercent} onChange={setMinimum} style={{ width: 90 }} />
          <Button disabled={minimum === null} onClick={async () => {
            if (await send(message, () => api.put('/approvals/freight-margin/setting', { minMarginPercent: minimum }))) { setMinimum(null); refresh(); }
          }}>Set</Button>
        </Space>
      )}>
      <Tabs items={[
        {
          key: 'pending', label: `Pending (${pending.data?.challans.length ?? 0})`,
          children: (
            <>
              <Space style={{ marginBottom: 12 }}>
                <Button type="primary" icon={<CheckOutlined />} loading={busy} disabled={!picked.length} onClick={() => decide(true)}>Approve</Button>
                <Popconfirm title={`Reject and cancel ${picked.length} challan(s)?`} onConfirm={() => decide(false)} disabled={!picked.length}>
                  <Button danger icon={<CloseOutlined />} disabled={!picked.length}>Reject (cancel challan)</Button>
                </Popconfirm>
              </Space>
              <Table size="small" rowKey="challanNo" loading={pending.isFetching} dataSource={pending.data?.challans ?? []} scroll={{ x: 'max-content' }}
                rowSelection={{ selectedRowKeys: picked, onChange: setPicked }}
                columns={[...cols, { title: 'Dockets', dataIndex: 'dockets', align: 'right' }, {
                  title: 'Remarks', key: 'rm',
                  render: (_, r) => <Input size="small" style={{ width: 180 }} value={remarks[r.challanNo]} aria-label={`Remarks ${r.challanNo}`}
                    onChange={(e) => setRemarks({ ...remarks, [r.challanNo]: e.target.value })} />,
                }]} />
            </>
          ),
        },
        {
          key: 'decided', label: 'Approved / rejected',
          children: (
            <>
              <Input.Search placeholder="Challan no" allowClear style={{ width: 220, marginBottom: 12 }} onSearch={setSearch} />
              <Table size="small" rowKey="id" loading={decided.isFetching} dataSource={decided.data ?? []} scroll={{ x: 'max-content' }}
                columns={[...cols,
                  { title: 'Decision', dataIndex: 'approved', render: (v) => (v ? <Tag color="green">Approved</Tag> : <Tag color="red">Rejected</Tag>) },
                  { title: 'By', dataIndex: 'by' }, { title: 'On', dataIndex: 'date', render: date }, { title: 'Remarks', dataIndex: 'remarks' }]} />
            </>
          ),
        },
      ]} />
    </Card>
  );
}
