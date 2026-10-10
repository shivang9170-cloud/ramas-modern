// Click-through for the dashboard: any chart element opens this drawer with the records behind it (/api/dashboard/drill) —
// search, sort, totals, CSV download, and links to open a docket (tracking) or a bill / invoice print.
import { createContext, useContext, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { Alert, Button, Drawer, Input, Space, Table, Tag, Typography } from 'antd';
import { DownloadOutlined } from '@ant-design/icons';
import { api, errorMessage } from '../../api/client.js';
import { PALETTE, fmt } from './Charts.jsx';

const DrillContext = createContext(() => {});
/** open(title, kind, filters, { allDates, withCancelled }) */
export const useDrill = () => useContext(DrillContext);

const LINKS = {
  docket: (v) => `/tracking?docket=${encodeURIComponent(v)}`,
  bill: (v) => `/print/client-bill/${encodeURIComponent(v)}`,
  vendorinvoice: (v) => `/print/vendor-invoice/${encodeURIComponent(v)}`,
  franchiseeinvoice: (v) => `/print/franchisee-invoice/${encodeURIComponent(v)}`,
};
const TAG = { Delivered: 'green', Paid: 'green', Cancelled: 'red', Lost: 'red', RTO: 'volcano', Undelivered: 'orange', 'Part paid': 'gold', Finalized: 'blue', Submitted: 'cyan' };
const show = (c, v) => {
  if (v === null || v === undefined || v === '') return '';
  if (c.type === 'money') return fmt.inr(v);
  if (c.type === 'number') return fmt.dec(v);
  if (c.type === 'date') return dayjs(v).format('DD/MM/YYYY');
  return String(v);
};

function toCsv(columns, rows) {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  return [columns.map((c) => esc(c.title)).join(','), ...rows.map((r) => columns.map((c) => esc(c.type === 'date' && r[c.key] ? dayjs(r[c.key]).format('DD/MM/YYYY') : r[c.key])).join(','))].join('\r\n');
}

export function DrillProvider({ filters, children }) {
  const [state, setState] = useState(null);
  const [search, setSearch] = useState('');
  const open = useMemo(() => (title, kind, f = {}, opts = {}) => { setSearch(''); setState({ title, kind, f, ...opts }); }, []);
  const { data, isFetching, error } = useQuery({
    queryKey: ['dashboard-drill', filters, state],
    enabled: Boolean(state),
    queryFn: () => api.get('/dashboard/drill', {
      params: { ...filters, kind: state.kind, filters: JSON.stringify(state.f), allDates: Boolean(state.allDates), withCancelled: Boolean(state.withCancelled) },
    }).then((r) => r.data),
  });
  const columns = data?.columns ?? [];
  const rows = useMemo(() => {
    const all = (data?.rows ?? []).map((r, i) => ({ ...r, _k: i }));
    const q = search.trim().toLowerCase();
    return q ? all.filter((r) => columns.some((c) => String(r[c.key] ?? '').toLowerCase().includes(q))) : all;
  }, [data, search, columns]);
  const moneyCols = columns.filter((c) => c.type === 'money');

  function download() {
    const blob = new Blob([`﻿${toCsv(columns, rows)}`], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${(state?.title ?? 'records').replace(/[^\w-]+/g, '_')}_${filters.from}_${filters.to}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <DrillContext.Provider value={open}>
      {children}
      <Drawer open={Boolean(state)} onClose={() => setState(null)} width="min(1200px, 100vw)" destroyOnHidden
        title={<Space direction="vertical" size={0}>
          <span>{state?.title}</span>
          <Typography.Text type="secondary" style={{ fontSize: 12, fontWeight: 'normal' }}>
            {state?.allDates ? 'As of today' : `${dayjs(filters.from).format('DD/MM/YYYY')} – ${dayjs(filters.to).format('DD/MM/YYYY')}`}
            {filters.scope === 'branch' ? ' · current branch' : ' · all branches'}
            {data && ` · ${data.total.toLocaleString('en-IN')} record(s)${data.total > data.rows.length ? `, first ${data.rows.length} shown` : ''}`}
          </Typography.Text>
        </Space>}
        extra={<Space>
          <Input.Search allowClear placeholder="Search in these records" style={{ width: 240 }} value={search} onChange={(e) => setSearch(e.target.value)} />
          <Button icon={<DownloadOutlined />} onClick={download} disabled={!rows.length}>CSV</Button>
        </Space>}>
        {error && <Alert type="error" showIcon message={errorMessage(error)} />}
        <Table size="small" rowKey="_k" loading={isFetching} dataSource={rows} scroll={{ x: 'max-content' }}
          pagination={{ defaultPageSize: 50, showSizeChanger: true, pageSizeOptions: [20, 50, 100, 500] }}
          columns={columns.map((c) => ({
            title: c.title, dataIndex: c.key, align: ['money', 'number'].includes(c.type) ? 'right' : undefined,
            sorter: (a, b) => (['money', 'number'].includes(c.type) ? Number(a[c.key] || 0) - Number(b[c.key] || 0) : String(a[c.key] ?? '').localeCompare(String(b[c.key] ?? ''))),
            render: (v) => {
              if (LINKS[c.type] && v) return <a href={LINKS[c.type](v)} target="_blank" rel="noreferrer">{v}</a>;
              if (c.type === 'tag' && v) return <Tag color={TAG[v]}>{v}</Tag>;
              return show(c, v);
            },
          }))}
          summary={() => (moneyCols.length && rows.length ? (
            <Table.Summary.Row>
              {columns.map((c, i) => (
                <Table.Summary.Cell key={c.key} index={i} align={c.type === 'money' ? 'right' : undefined}>
                  {i === 0 ? <strong>Total ({rows.length})</strong> : c.type === 'money' ? <strong style={{ color: PALETTE[0] }}>{fmt.inr(rows.reduce((t, r) => t + Number(r[c.key] || 0), 0))}</strong> : null}
                </Table.Summary.Cell>
              ))}
            </Table.Summary.Row>
          ) : null)} />
      </Drawer>
    </DrillContext.Provider>
  );
}
