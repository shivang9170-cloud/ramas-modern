// Delivery status entry — replaces Operation/deliverystatusentry.aspx.
// Door delivery: pick a DRS and give each docket a status. Godown delivery: dockets
// collected at the branch. Dockets not ticked keep waiting (the DRS stays open).
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import {
  Alert, App, Button, Card, DatePicker, Empty, Input, Select, Space, Table, Tabs, Tag, TimePicker, Typography,
} from 'antd';
import { SaveOutlined } from '@ant-design/icons';
import { api, errorMessage } from '../../api/client.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import MasterSelect from '../../components/masters/MasterSelect.jsx';

const DATE_FMT = 'DD/MM/YYYY';
const fmt = (v) => (v ? dayjs(v).format(DATE_FMT) : '');
const blank = () => ({ status: undefined, date: dayjs(), time: dayjs(), receiverName: '', receiverPhone: '', remarks: '', reason: undefined });

function StatusGrid({ mode, drs, dockets, opts, onSaved }) {
  const { message, modal } = App.useApp();
  const [rows, setRows] = useState([]);
  const [selected, setSelected] = useState([]);
  const [saving, setSaving] = useState(false);
  const minDate = mode === 'DRS' ? drs?.drsDate : null;
  const statuses = (opts?.statuses ?? []).filter((s) => mode === 'DRS' || opts.godownStatuses.includes(s.value));

  useEffect(() => { setRows(dockets.map((d) => ({ ...d, ...blank() }))); setSelected([]); }, [dockets]);
  const update = (no, patch) => setRows((rs) => rs.map((r) => (r.docketNo === no ? { ...r, ...patch } : r)));
  const ticked = useMemo(() => rows.filter((r) => selected.includes(r.docketNo)), [rows, selected]);

  function setForTicked(status) {
    setRows((rs) => rs.map((r) => (selected.includes(r.docketNo) ? { ...r, status } : r)));
  }

  async function save() {
    const missing = ticked.filter((r) => !r.status || (r.status === 'DLVRD' && !r.receiverName.trim()) || (r.status === 'UNDELIVERED' && !r.reason));
    if (!ticked.length) { message.warning('Tick at least one docket'); return; }
    if (missing.length) {
      message.warning(`Complete ${missing.map((r) => r.docketNo).join(', ')}: status, receiver name (delivered) or reason (undelivered)`);
      return;
    }
    setSaving(true);
    try {
      const { data } = await api.post('/delivery', {
        mode,
        drsNo: mode === 'DRS' ? drs.drsNo : undefined,
        entries: ticked.map((r) => ({
          docketNo: r.docketNo, status: r.status, date: r.date.format('YYYY-MM-DD'), time: r.time.format('HH:mm'),
          receiverName: r.receiverName.trim(), receiverPhone: r.receiverPhone.trim(), remarks: r.remarks.trim(), reason: r.reason || '',
        })),
      });
      modal.success({
        title: 'Delivery status saved',
        content: (
          <Space direction="vertical">
            <span>{Object.entries(data.counts).map(([k, v]) => `${v} ${k}`).join(', ')}</span>
            {data.billed.length > 0 && <span>To Pay bill raised for {data.billed.join(', ')}</span>}
            {data.billingErrors.length > 0 && (
              <Typography.Text type="danger">{data.billingErrors.map((b) => `${b.docketNo}: ${b.message}`).join('; ')}</Typography.Text>
            )}
          </Space>
        ),
      });
      onSaved();
    } catch (e) {
      const details = e.response?.data?.details;
      message.error(details?.length ? `${e.response.data.error}: ${details.map((d) => d.message).join('; ')}` : errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  const columns = [
    { title: 'Docket no.', dataIndex: 'docketNo', fixed: 'left' },
    { title: 'Consignee', dataIndex: 'consignee', ellipsis: true, width: 160 },
    { title: 'Pkts', dataIndex: 'packages', align: 'right' },
    ...(mode === 'GODOWN' ? [{ title: 'Arrived', dataIndex: 'arrivalDate', render: fmt }] : []),
    { title: 'Type', dataIndex: 'bookingType', render: (v) => (v === 'To Pay' ? <Tag color="gold">To Pay</Tag> : v || '—') },
    {
      title: 'Status', dataIndex: 'status', width: 150,
      render: (v, r) => (
        <Select size="small" value={v} placeholder="Select" style={{ width: 140 }} options={statuses} aria-label={`Status for ${r.docketNo}`}
          onChange={(x) => { update(r.docketNo, { status: x }); if (!selected.includes(r.docketNo)) setSelected((s) => [...s, r.docketNo]); }} />
      ),
    },
    {
      title: 'Date / time', key: 'dt', width: 230,
      render: (_, r) => (
        <Space size={4}>
          <DatePicker size="small" format={DATE_FMT} value={r.date} allowClear={false} style={{ width: 120 }}
            disabledDate={(d) => d.isAfter(dayjs(), 'day') || (minDate && d.isBefore(dayjs(minDate), 'day')) || (r.arrivalDate && d.isBefore(dayjs(r.arrivalDate), 'day'))}
            onChange={(d) => update(r.docketNo, { date: d })} />
          <TimePicker size="small" format="HH:mm" value={r.time} allowClear={false} style={{ width: 90 }} onChange={(t) => update(r.docketNo, { time: t })} />
        </Space>
      ),
    },
    {
      title: 'Receiver', key: 'rcv', width: 250,
      render: (_, r) => (
        <Space size={4}>
          <Input size="small" placeholder={r.status === 'DLVRD' ? 'Name (required)' : 'Name'} value={r.receiverName} maxLength={100}
            status={r.status === 'DLVRD' && !r.receiverName.trim() ? 'error' : undefined} style={{ width: 130 }}
            aria-label={`Receiver for ${r.docketNo}`} onChange={(e) => update(r.docketNo, { receiverName: e.target.value })} />
          <Input size="small" placeholder="Phone" value={r.receiverPhone} maxLength={10} inputMode="numeric" style={{ width: 110 }}
            onChange={(e) => update(r.docketNo, { receiverPhone: e.target.value.replace(/\D/g, '') })} />
        </Space>
      ),
    },
    {
      title: 'Remarks / reason', key: 'rem', width: 220,
      render: (_, r) => (r.status === 'UNDELIVERED' ? (
        <MasterSelect master="undelivered-reason" valueField="status_reason" size="small" value={r.reason} placeholder="Undelivered reason" style={{ width: 200 }}
          status={!r.reason ? 'error' : undefined} options={(opts?.undeliveredReasons ?? []).map((x) => ({ value: x, label: x }))}
          onChange={(x) => update(r.docketNo, { reason: x })} />
      ) : (
        <Input size="small" value={r.remarks} maxLength={500} style={{ width: 200 }} onChange={(e) => update(r.docketNo, { remarks: e.target.value })} />
      )),
    },
  ];

  if (!rows.length) return <Empty description={mode === 'DRS' ? 'All dockets on this DRS have a status' : 'No godown deliveries waiting at this branch'} />;
  return (
    <>
      <Space wrap style={{ marginBottom: 8 }}>
        <Typography.Text type="secondary">Set status for ticked:</Typography.Text>
        {statuses.map((s) => <Button key={s.value} size="small" disabled={!selected.length} onClick={() => setForTicked(s.value)}>{s.label}</Button>)}
      </Space>
      <Table
        size="small"
        rowKey="docketNo"
        columns={columns}
        dataSource={rows}
        pagination={false}
        scroll={{ x: 'max-content' }}
        rowSelection={{ selectedRowKeys: selected, onChange: setSelected }}
      />
      <Space style={{ marginTop: 12, width: '100%', justifyContent: 'space-between' }} wrap>
        <Typography.Text>Ticked <strong>{ticked.length}</strong> of {rows.length}</Typography.Text>
        <Button type="primary" icon={<SaveOutlined />} loading={saving} disabled={!ticked.length} onClick={save}>Save status</Button>
      </Space>
    </>
  );
}

export default function DeliveryStatusPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [drsNo, setDrsNo] = useState();
  const branch = user.currentBranch.code;

  const { data: opts } = useQuery({ queryKey: ['delivery-options'], queryFn: () => api.get('/delivery/options').then((r) => r.data) });
  const openDrs = useQuery({ queryKey: ['delivery-drs', branch], queryFn: () => api.get('/delivery/drs').then((r) => r.data) });
  const drs = useQuery({
    queryKey: ['delivery-drs-dockets', drsNo],
    queryFn: () => api.get(`/delivery/drs/${encodeURIComponent(drsNo)}`).then((r) => r.data),
    enabled: Boolean(drsNo),
  });
  const godown = useQuery({ queryKey: ['delivery-godown', branch], queryFn: () => api.get('/delivery/godown').then((r) => r.data) });
  const godownRows = useMemo(() => godown.data ?? [], [godown.data]); // stable, the grid resets when this changes

  const afterSave = () => {
    queryClient.invalidateQueries({ queryKey: ['delivery-drs'] });
    queryClient.invalidateQueries({ queryKey: ['delivery-drs-dockets'] });
    queryClient.invalidateQueries({ queryKey: ['delivery-godown'] });
  };
  useEffect(() => {
    if (drsNo && openDrs.data && !openDrs.data.some((d) => d.drsNo === drsNo)) setDrsNo(undefined);
  }, [openDrs.data, drsNo]);

  const err = openDrs.error || drs.error || godown.error;
  return (
    <div className="page-card">
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 12 }} wrap>
        <Typography.Title level={3} style={{ margin: 0 }}>Delivery Status Entry</Typography.Title>
        <Typography.Text type="secondary">At: {user.currentBranch.name} : {branch}</Typography.Text>
      </Space>
      {err && <Alert type="error" showIcon message={errorMessage(err)} style={{ marginBottom: 12 }} />}
      <Card size="small">
        <Tabs
          items={[
            {
              key: 'drs',
              label: `Door delivery (DRS)${openDrs.data?.length ? ` · ${openDrs.data.length}` : ''}`,
              children: (
                <>
                  <Space wrap style={{ marginBottom: 12 }}>
                    <Select
                      style={{ minWidth: 320 }}
                      placeholder="Select DRS"
                      loading={openDrs.isFetching}
                      value={drsNo}
                      onChange={setDrsNo}
                      aria-label="DRS no."
                      notFoundContent="No open DRS at this branch"
                      options={(openDrs.data ?? []).map((d) => ({
                        value: d.drsNo,
                        label: `${d.drsNo} · ${fmt(d.drsDate)} · ${d.deliveredBy} · ${d.open} of ${d.dockets} open`,
                      }))}
                    />
                  </Space>
                  {!drsNo ? <Empty description="Select a DRS to enter delivery status" />
                    : drs.isFetching && !drs.data ? <Card loading />
                      : drs.data && <StatusGrid mode="DRS" drs={drs.data} dockets={drs.data.dockets} opts={opts} onSaved={afterSave} />}
                </>
              ),
            },
            {
              key: 'godown',
              label: `Godown delivery${godown.data?.length ? ` · ${godown.data.length}` : ''}`,
              children: godown.isFetching && !godown.data ? <Card loading />
                : <StatusGrid mode="GODOWN" dockets={godownRows} opts={opts} onSaved={afterSave} />,
            },
          ]}
        />
      </Card>
    </div>
  );
}
