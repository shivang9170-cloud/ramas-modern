// Generic report screen — the replacement pattern for Crystal Reports (.rpt) + Report_Viewer.aspx.
// Server defines filters/columns (modules/reports); this page renders them with totals and export.
import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { Alert, App, Button, Card, DatePicker, Dropdown, Form, Result, Select, Space, Table, Typography } from 'antd';
import { DownloadOutlined, PlayCircleOutlined } from '@ant-design/icons';
import { api, errorMessage } from '../../api/client.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { exportCsv, exportPdf } from '../../utils/exportTable.js';

const inr = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt = (col, v) => {
  if (v === null || v === undefined || v === '') return '';
  if (col.type === 'money') return inr.format(Number(v));
  if (col.type === 'number') return Number(v).toLocaleString('en-IN');
  if (col.type === 'date') return dayjs(v).format('DD/MM/YYYY');
  return String(v);
};

export default function ReportPage() {
  const { key } = useParams();
  const { user } = useAuth();
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [result, setResult] = useState(null);
  const [running, setRunning] = useState(false);

  const { data: def, error } = useQuery({ queryKey: ['report-def', key], queryFn: () => api.get(`/reports/${key}`).then((r) => r.data) });

  const initial = useMemo(() => {
    if (!def) return {};
    const v = {};
    for (const f of def.filters) {
      if (f.type === 'date') v[f.name] = f.name === 'from' ? dayjs().startOf('month') : dayjs();
      else if (f.default) v[f.name] = f.default;
    }
    return v;
  }, [def]);

  async function run(values) {
    const params = {};
    for (const f of def.filters) {
      const v = values[f.name];
      params[f.name] = f.type === 'date' ? (v ? v.format('YYYY-MM-DD') : '') : v ?? '';
    }
    setRunning(true);
    try {
      const { data } = await api.get(`/reports/${key}/run`, { params });
      setResult(data);
      if (!data.rows.length) message.info('No records for the selected filters');
    } catch (e) {
      message.error(errorMessage(e));
    } finally {
      setRunning(false);
    }
  }

  const columns = useMemo(() => (def?.columns ?? []).map((c) => ({
    title: c.title,
    dataIndex: c.key,
    key: c.key,
    align: c.type === 'money' || c.type === 'number' ? 'right' : undefined,
    sorter: (a, b) => (c.type === 'money' || c.type === 'number'
      ? Number(a[c.key] || 0) - Number(b[c.key] || 0)
      : String(a[c.key] ?? '').localeCompare(String(b[c.key] ?? ''))),
    render: (v) => fmt(c, v),
    exportValue: (v) => fmt(c, v),
  })), [def]);

  const totals = useMemo(() => {
    if (!result || !def) return null;
    const t = {};
    for (const c of def.columns) {
      if (c.total) t[c.key] = fmt(c, result.rows.reduce((s, r) => s + (Number(r[c.key]) || 0), 0));
    }
    return t;
  }, [result, def]);

  if (error) return <Result status="warning" title={errorMessage(error)} />;

  const subtitle = result && `${user.divName} • ${user.currentBranch.name} • ${
    def.filters.map((f) => `${f.label}: ${f.type === 'date' ? dayjs(result.filtersApplied[f.name]).format('DD/MM/YYYY') : result.filtersApplied[f.name]}`).join(' • ')}`;

  return (
    <Card className="page-card" title={def?.title ?? 'Report'} loading={!def}>
      {def && (
        <Form form={form} layout="inline" initialValues={initial} onFinish={run} style={{ rowGap: 8, marginBottom: 16 }}>
          {def.filters.map((f) => (
            <Form.Item key={f.name} name={f.name} label={f.label} rules={f.required ? [{ required: true }] : []}>
              {f.type === 'date'
                ? <DatePicker format="DD/MM/YYYY" allowClear={!f.required} />
                : <Select style={{ minWidth: 140 }} options={f.options.map((o) => ({ value: o, label: o }))} />}
            </Form.Item>
          ))}
          <Form.Item>
            <Space>
              <Button type="primary" htmlType="submit" icon={<PlayCircleOutlined />} loading={running}>Show</Button>
              <Dropdown disabled={!result?.rows.length} menu={{ items: [
                { key: 'csv', label: 'Excel (CSV)', onClick: () => exportCsv(key, columns, result.rows) },
                { key: 'pdf', label: 'PDF', onClick: () => exportPdf(key, def.title, columns, result.rows, { subtitle, totals }) },
              ] }}>
                <Button icon={<DownloadOutlined />}>Export</Button>
              </Dropdown>
            </Space>
          </Form.Item>
        </Form>
      )}
      {result?.truncated && <Alert type="warning" showIcon style={{ marginBottom: 12 }} message="Showing the first 5,000 rows — narrow the date range to see everything." />}
      {result && (
        <Table
          size="small"
          rowKey={(r, i) => `${r[def.columns[0].key]}-${i}`}
          columns={columns}
          dataSource={result.rows}
          scroll={{ x: 'max-content' }}
          pagination={{ defaultPageSize: 50, showSizeChanger: true, showTotal: (t) => `${t} rows` }}
          summary={() => totals && (
            <Table.Summary fixed>
              <Table.Summary.Row>
                {def.columns.map((c, i) => (
                  <Table.Summary.Cell key={c.key} index={i} align={c.total ? 'right' : undefined}>
                    {i === 0 ? <Typography.Text strong>Total</Typography.Text> : <Typography.Text strong>{totals[c.key] ?? ''}</Typography.Text>}
                  </Table.Summary.Cell>
                ))}
              </Table.Summary.Row>
            </Table.Summary>
          )}
        />
      )}
    </Card>
  );
}
