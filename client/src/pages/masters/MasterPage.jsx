// Generic screen for every declarative master (server: modules/masters/definitions.js).
// Replaces General/State_Master.aspx, Zone_Master.aspx, City_Master.aspx, ...
// The add / edit form is shared with quick add (components/masters/MasterFormModal.jsx).
import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  App, Button, Card, Dropdown, Input, Popconfirm, Result, Space, Table, Tag, Tooltip,
} from 'antd';
import { DeleteOutlined, DownloadOutlined, EditOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { api, errorMessage } from '../../api/client.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { exportCsv, exportPdf } from '../../utils/exportTable.js';
import MasterFormModal from '../../components/masters/MasterFormModal.jsx';

const isOn = (field, v) => v === true || v === 1 || v === '1' || v === field.yes || v === 'true';

export default function MasterPage() {
  const { key } = useParams();
  const { user } = useAuth();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(null); // null = closed, {} = new, row = edit
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['master', key],
    queryFn: () => api.get(`/masters/${key}`).then((r) => r.data),
  });
  const def = data?.definition;
  // add / edit / delete: admin, or an employee given this master in User Access Rights (server: canAdd)
  const canWrite = Boolean(def?.canAdd) && (user.role === 'admin' || user.role === 'employee');
  const rows = data?.rows ?? [];

  const remove = useMutation({
    mutationFn: (code) => api.delete(`/masters/${key}/${encodeURIComponent(code)}`),
    onSuccess: () => { message.success('Record deleted'); queryClient.invalidateQueries({ queryKey: ['master', key] }); },
    onError: (err) => message.error(errorMessage(err)),
  });

  const columns = useMemo(() => {
    if (!def) return [];
    const cols = def.fields.filter((f) => f.list).map((f) => ({
      title: f.label,
      dataIndex: f.display ?? f.name,
      key: f.name,
      sorter: (a, b) => String(a[f.display ?? f.name] ?? '').localeCompare(String(b[f.display ?? f.name] ?? '')),
      render: (v, row) => {
        if (f.type === 'status') return <Tag color={v === def.statusValues[0] ? 'green' : 'default'}>{v}</Tag>;
        if (f.type === 'checkbox') return isOn(f, row[f.name]) ? <Tag color="blue">Yes</Tag> : <Tag>No</Tag>;
        return v;
      },
      exportValue: f.type === 'checkbox' ? (v, row) => (isOn(f, row[f.name]) ? 'Yes' : 'No') : undefined,
    }));
    if (canWrite) {
      cols.push({
        title: 'Actions', key: '_actions', width: 110, fixed: 'right',
        render: (_, row) => (
          <Space>
            <Tooltip title="Edit"><Button size="small" icon={<EditOutlined />} onClick={() => setEditing(row)} aria-label="Edit" /></Tooltip>
            <Popconfirm title="Delete this record?" okText="Delete" okButtonProps={{ danger: true }} onConfirm={() => remove.mutate(String(row[def.keyField]).trim())}>
              <Tooltip title="Delete"><Button size="small" danger icon={<DeleteOutlined />} aria-label="Delete" /></Tooltip>
            </Popconfirm>
          </Space>
        ),
      });
    }
    return cols;
  }, [def, canWrite]); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => Object.values(r).some((v) => v !== null && String(v).toLowerCase().includes(q)));
  }, [rows, search]);

  if (error) return <Result status={error.response?.status === 403 ? '403' : 'error'} title={errorMessage(error)} />;

  const exportCols = columns.filter((c) => c.key !== '_actions');
  const editRow = editing && def && editing[def.keyField] !== undefined ? editing : null;

  return (
    <Card
      className="page-card"
      loading={isLoading && !def}
      title={def?.title}
      extra={def && (
        <Space wrap>
          <Input.Search placeholder="Search" allowClear onChange={(e) => setSearch(e.target.value)} style={{ width: 220 }} />
          <Tooltip title="Refresh"><Button icon={<ReloadOutlined />} loading={isFetching} onClick={() => refetch()} aria-label="Refresh" /></Tooltip>
          <Dropdown menu={{ items: [
            { key: 'csv', label: 'Excel (CSV)', onClick: () => exportCsv(def.key, exportCols, filtered) },
            { key: 'pdf', label: 'PDF', onClick: () => exportPdf(def.key, def.title, exportCols, filtered, { subtitle: `${user.divName} • ${filtered.length} records` }) },
          ] }}>
            <Button icon={<DownloadOutlined />}>Export</Button>
          </Dropdown>
          {canWrite && <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditing({})}>Add</Button>}
        </Space>
      )}
    >
      {def && (
        <Table
          rowKey={(r) => String(r[def.keyField])}
          columns={columns}
          dataSource={filtered}
          size="middle"
          scroll={{ x: 'max-content' }}
          pagination={{ defaultPageSize: 20, showSizeChanger: true, showTotal: (t) => `${t} records` }}
        />
      )}

      {def && (
        <MasterFormModal
          masterKey={key}
          def={def}
          row={editRow}
          open={editing !== null}
          allowSaveNew
          onClose={() => setEditing(null)}
          onSaved={(_, { next }) => { if (!next) setEditing(null); }}
        />
      )}
    </Card>
  );
}
