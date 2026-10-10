// Loading sheet — replaces Operation/Loading_Sheet.aspx (new), Loading_Sheet_Cancel / Loading_Sheet_View /
// Loading_Sheet_Edit (sheets) and Manual_Loading_Sheet_Cancel_Uncancel (one docket off / back on a sheet).
// A manifest can then be made from an open sheet (Manifest Entry → "From loading sheet").
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import {
  App, Button, Card, DatePicker, Descriptions, Drawer, Empty, Form, Input, Radio, Space, Switch, Table, Tabs, Tag, Typography,
} from 'antd';
import { EyeOutlined, SaveOutlined, SearchOutlined, StopOutlined } from '@ant-design/icons';
import { api, errorMessage } from '../../api/client.js';
import { useAuth } from '../../auth/AuthContext.jsx';

const DATE_FMT = 'DD/MM/YYYY';
const fmt = (v) => (v ? dayjs(v).format(DATE_FMT) : '');
const problem = (e) => {
  const details = e.response?.data?.details;
  return details?.length ? `${e.response.data.error}: ${details.map((d) => d.message).join('; ')}` : errorMessage(e);
};

function NewSheet() {
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();
  const [form] = Form.useForm();
  const [rows, setRows] = useState(null);
  const [selected, setSelected] = useState([]);
  const [scan, setScan] = useState('');
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);

  async function search() {
    const v = form.getFieldsValue();
    setSearching(true);
    try {
      const { data } = await api.get('/loading-sheets/pending-dockets', {
        params: { from: v.range[0].format('YYYY-MM-DD'), to: v.range[1].format('YYYY-MM-DD'), loadType: v.loadType || '' },
      });
      setRows(data);
      setSelected([]);
    } catch (e) { message.error(errorMessage(e)); } finally { setSearching(false); }
  }

  // txtDocketNo: scanning a docket ticks it (added to the list when it is outside the booked range)
  async function scanDocket() {
    const no = scan.trim().toUpperCase();
    if (!no) return;
    setScan('');
    if (rows?.some((r) => r.docketNo === no)) { setSelected((s) => (s.includes(no) ? s : [...s, no])); return; }
    try {
      const { data } = await api.get('/loading-sheets/pending-dockets', {
        params: { from: '2000-01-01', to: form.getFieldValue('loadingDate').format('YYYY-MM-DD'), dockets: no },
      });
      if (!data.length) { message.warning(`${no}: not lying at this branch or already on an open loading sheet`); return; }
      setRows((rs) => [...(rs ?? []), ...data]);
      setSelected((s) => [...s, no]);
    } catch (e) { message.error(errorMessage(e)); }
  }

  const chosen = useMemo(() => (rows ?? []).filter((r) => selected.includes(r.docketNo)), [rows, selected]);
  const totals = chosen.reduce((t, r) => ({ p: t.p + r.packages, w: t.w + r.weight }), { p: 0, w: 0 });

  async function save() {
    const v = form.getFieldsValue();
    setSaving(true);
    try {
      const { data } = await api.post('/loading-sheets', {
        loadingDate: v.loadingDate.format('YYYY-MM-DD'), loadType: v.loadType || '', dockets: chosen.map((r) => r.docketNo),
      });
      modal.success({ title: 'Loading sheet created', content: <>Loading sheet no. <strong>{data.lsNo}</strong> — {data.dockets} docket(s)</> });
      queryClient.invalidateQueries({ queryKey: ['loading-sheets'] });
      await search();
    } catch (e) { message.error(problem(e)); } finally { setSaving(false); }
  }

  return (
    <Form form={form} layout="vertical" initialValues={{ loadingDate: dayjs(), loadType: '', range: [dayjs().startOf('month'), dayjs()] }}>
      <Space wrap align="end" style={{ marginBottom: 12 }}>
        <Form.Item label="Loading date" name="loadingDate" style={{ marginBottom: 0 }}>
          <DatePicker format={DATE_FMT} allowClear={false} disabledDate={(d) => d.isAfter(dayjs(), 'day')} />
        </Form.Item>
        <Form.Item label="Load type" name="loadType" style={{ marginBottom: 0 }}>
          <Radio.Group optionType="button" options={[{ value: '', label: 'All' }, { value: 'PTL', label: 'PTL' }, { value: 'FTL', label: 'FTL' }]}
            onChange={() => setRows(null)} />
        </Form.Item>
        <Form.Item label="Booked" name="range" style={{ marginBottom: 0 }}><DatePicker.RangePicker format={DATE_FMT} allowClear={false} /></Form.Item>
        <Button type="primary" icon={<SearchOutlined />} onClick={search} loading={searching}>Search</Button>
        <Form.Item label="Scan docket no." style={{ marginBottom: 0 }}>
          <Input value={scan} onChange={(e) => setScan(e.target.value)} onPressEnter={scanDocket} placeholder="Docket no. + Enter"
            style={{ width: 180 }} aria-label="Scan docket no." disabled={rows === null} />
        </Form.Item>
      </Space>
      {rows === null ? <Empty description="Search to list the dockets lying at this branch" /> : (
        <>
          <Table
            size="small" rowKey="docketNo" dataSource={rows} scroll={{ x: 'max-content' }}
            pagination={{ defaultPageSize: 50, showSizeChanger: true }}
            rowSelection={{ selectedRowKeys: selected, onChange: setSelected }}
            locale={{ emptyText: 'No dockets lying at this branch' }}
            columns={[
              { title: 'Docket no.', dataIndex: 'docketNo' },
              { title: 'Booked', dataIndex: 'bookingDate', render: fmt },
              { title: 'Origin', dataIndex: 'origin' },
              { title: 'Destination', dataIndex: 'destination' },
              { title: 'Consignor', dataIndex: 'consigner', ellipsis: true },
              { title: 'Consignee', dataIndex: 'consignee', ellipsis: true },
              { title: 'Type', dataIndex: 'loadType' },
              { title: 'Pkts', dataIndex: 'packages', align: 'right' },
              { title: 'Weight', dataIndex: 'weight', align: 'right' },
            ]}
          />
          <Space style={{ marginTop: 12, width: '100%', justifyContent: 'space-between' }} wrap>
            <Typography.Text>Selected <strong>{chosen.length}</strong> docket(s) · {totals.p} pkts · {totals.w.toFixed(2)} kg</Typography.Text>
            <Button type="primary" icon={<SaveOutlined />} onClick={save} loading={saving} disabled={!chosen.length}>Create loading sheet</Button>
          </Space>
        </>
      )}
    </Form>
  );
}

function SheetDetail({ lsNo, onClose, canCancel }) {
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ['loading-sheet', lsNo],
    queryFn: () => api.get(`/loading-sheets/${encodeURIComponent(lsNo)}`).then((r) => r.data),
    enabled: Boolean(lsNo),
  });
  const cancel = useMutation({
    mutationFn: () => api.post(`/loading-sheets/${encodeURIComponent(lsNo)}/cancel`),
    onSuccess: (r) => {
      message.success(r.data.message);
      queryClient.invalidateQueries({ queryKey: ['loading-sheets'] });
      queryClient.invalidateQueries({ queryKey: ['loading-sheet', lsNo] });
    },
    onError: (e) => message.error(errorMessage(e)),
  });
  const live = (data?.dockets ?? []).filter((d) => !d.cancelled);
  const totals = live.reduce((t, d) => ({ p: t.p + d.packages, w: t.w + d.weight }), { p: 0, w: 0 });

  return (
    <Drawer title={`Loading sheet ${lsNo ?? ''}`} open={Boolean(lsNo)} onClose={onClose} width={Math.min(900, window.innerWidth)} loading={isLoading}
      extra={canCancel && data && !data.cancelled && !data.manifested && (
        <Button danger icon={<StopOutlined />} loading={cancel.isPending} onClick={() => modal.confirm({
          title: `Cancel loading sheet ${lsNo}?`, content: 'Its dockets become free for another loading sheet.',
          okText: 'Cancel sheet', okButtonProps: { danger: true }, cancelText: 'Keep', onOk: () => cancel.mutateAsync(),
        })}>Cancel sheet</Button>
      )}>
      {error && <Typography.Text type="danger">{errorMessage(error)}</Typography.Text>}
      {data && (
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <Descriptions size="small" bordered column={{ xs: 1, sm: 2 }}>
            <Descriptions.Item label="Date">{fmt(data.loadingDate)}</Descriptions.Item>
            <Descriptions.Item label="Status">
              {data.cancelled ? <Tag color="red">Cancelled</Tag> : data.manifested ? <Tag color="blue">Manifest {data.manifestNo}</Tag> : <Tag color="green">Open</Tag>}
            </Descriptions.Item>
            <Descriptions.Item label="Branch">{data.branchName}</Descriptions.Item>
            <Descriptions.Item label="Load type">{data.loadType || 'All'}</Descriptions.Item>
            <Descriptions.Item label="Created by">{data.enteredBy}</Descriptions.Item>
          </Descriptions>
          <Table
            size="small" rowKey="docketNo" pagination={false} scroll={{ x: 'max-content' }} dataSource={data.dockets}
            columns={[
              { title: 'Docket no.', dataIndex: 'docketNo' },
              { title: 'Booked', dataIndex: 'bookingDate', render: fmt },
              { title: 'To', dataIndex: 'toBranchName' },
              { title: 'Consignor', dataIndex: 'consigner' },
              { title: 'Pkts', dataIndex: 'packages', align: 'right' },
              { title: 'Weight', dataIndex: 'weight', align: 'right' },
              { title: '', key: 'st', render: (_, d) => (d.cancelled ? <Tag color="red">Off</Tag> : d.manifestNo ? <Tag color="blue">{d.manifestNo}</Tag> : null) },
            ]}
            summary={() => (
              <Table.Summary.Row>
                <Table.Summary.Cell index={0} colSpan={4}><strong>Total ({live.length})</strong></Table.Summary.Cell>
                <Table.Summary.Cell index={4} align="right"><strong>{totals.p}</strong></Table.Summary.Cell>
                <Table.Summary.Cell index={5} align="right"><strong>{totals.w.toFixed(2)}</strong></Table.Summary.Cell>
                <Table.Summary.Cell index={6} />
              </Table.Summary.Row>
            )}
          />
          {data.manifested && !data.cancelled && (
            <Typography.Text type="secondary">A manifest has been generated, so this loading sheet can no longer be cancelled.</Typography.Text>
          )}
        </Space>
      )}
    </Drawer>
  );
}

function SheetList({ canCancel }) {
  const { user } = useAuth();
  const [params, setParams] = useState({ status: 'active', search: '' });
  const [open, setOpen] = useState(null);
  const { data = [], isFetching, error } = useQuery({
    queryKey: ['loading-sheets', params, user.currentBranch.code],
    queryFn: () => api.get('/loading-sheets', { params }).then((r) => r.data),
  });
  return (
    <>
      <Form layout="inline" style={{ rowGap: 8, marginBottom: 12 }} initialValues={params}
        onFinish={(v) => setParams({ status: v.status, search: v.search?.trim() || '' })}>
        <Form.Item name="status">
          <Radio.Group optionType="button" options={[{ value: 'active', label: 'Active' }, { value: 'cancelled', label: 'Cancelled' }]} />
        </Form.Item>
        <Form.Item name="search"><Input placeholder="Loading sheet no." allowClear style={{ width: 200 }} /></Form.Item>
        <Button type="primary" htmlType="submit" loading={isFetching}>Show</Button>
      </Form>
      {error && <Typography.Text type="danger">{errorMessage(error)}</Typography.Text>}
      <Table
        size="middle" rowKey="lsNo" loading={isFetching} dataSource={data} scroll={{ x: 'max-content' }}
        pagination={{ defaultPageSize: 20, showSizeChanger: true, showTotal: (t) => `${t} loading sheets` }}
        columns={[
          { title: 'Loading sheet no.', dataIndex: 'lsNo' },
          { title: 'Date', dataIndex: 'loadingDate', render: fmt },
          { title: 'Type', dataIndex: 'loadType', render: (v) => v || 'All' },
          { title: 'Dockets', dataIndex: 'dockets', align: 'right' },
          { title: 'Pkts', dataIndex: 'packages', align: 'right' },
          { title: 'Weight', dataIndex: 'weight', align: 'right' },
          { title: 'Manifest', dataIndex: 'manifestNo', render: (v) => v || '—' },
          { title: 'By', dataIndex: 'enteredBy' },
          { title: '', key: 'view', width: 90, render: (_, r) => <Button size="small" icon={<EyeOutlined />} onClick={() => setOpen(r.lsNo)}>View</Button> },
        ]}
      />
      <SheetDetail lsNo={open} onClose={() => setOpen(null)} canCancel={canCancel} />
    </>
  );
}

function DocketCancel({ canCancel }) {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [docketNo, setDocketNo] = useState('');
  const { data, isFetching, error, refetch } = useQuery({
    queryKey: ['loading-sheet-docket', docketNo],
    queryFn: () => api.get(`/loading-sheets/docket/${encodeURIComponent(docketNo)}`).then((r) => r.data),
    enabled: Boolean(docketNo),
  });
  const toggle = useMutation({
    mutationFn: ({ id, cancelled }) => api.patch(`/loading-sheets/rows/${id}`, { cancelled }),
    onSuccess: (r) => { message.success(r.data.message); refetch(); queryClient.invalidateQueries({ queryKey: ['loading-sheets'] }); },
    onError: (e) => message.error(errorMessage(e)),
  });
  return (
    <>
      <Input.Search placeholder="Docket no." enterButton="Show" style={{ maxWidth: 320, marginBottom: 12 }} allowClear aria-label="Docket no."
        onSearch={(v) => setDocketNo(v.trim().toUpperCase())} loading={isFetching} />
      {error && <Typography.Text type="danger">{errorMessage(error)}</Typography.Text>}
      {docketNo && (
        <Table
          size="small" rowKey="id" loading={isFetching} dataSource={data ?? []} pagination={false} scroll={{ x: 'max-content' }}
          locale={{ emptyText: `${docketNo} is not on a loading sheet of this branch` }}
          columns={[
            { title: 'Loading sheet no.', dataIndex: 'lsNo' },
            { title: 'Date', dataIndex: 'loadingDate', render: fmt },
            { title: 'To', dataIndex: 'toBranchName' },
            { title: 'Pkts', dataIndex: 'packages', align: 'right' },
            { title: 'Weight', dataIndex: 'weight', align: 'right' },
            { title: 'Manifest', dataIndex: 'manifestNo', render: (v) => v || '—' },
            {
              title: 'On the sheet', key: 'on', render: (_, r) => (r.sheetOpen ? (
                <Switch checked={!r.cancelled} disabled={!canCancel} loading={toggle.isPending && toggle.variables?.id === r.id}
                  checkedChildren="On" unCheckedChildren="Off" aria-label={`${r.lsNo} ${r.docketNo}`}
                  onChange={(on) => toggle.mutate({ id: r.id, cancelled: !on })} />
              ) : <Tag>{r.cancelled ? 'Off' : 'Closed'}</Tag>),
            },
          ]}
        />
      )}
    </>
  );
}

export default function LoadingSheetPage({ tab = 'new' }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const canCancel = ['admin', 'employee'].includes(user.role);
  const items = [
    { key: 'new', label: 'New loading sheet', children: <NewSheet /> },
    { key: 'list', label: 'View / Cancel', children: <SheetList canCancel={canCancel} /> },
    { key: 'docket', label: 'Docket cancel / undo', children: <DocketCancel canCancel={canCancel} /> },
  ];
  return (
    <Card className="page-card" title="Loading Sheet"
      extra={<Typography.Text type="secondary">{user.currentBranch.name} : {user.currentBranch.code}</Typography.Text>}>
      <Tabs activeKey={tab} items={items} destroyOnHidden
        onChange={(k) => navigate(`/operation/loading-sheet/${k}`)} />
    </Card>
  );
}
