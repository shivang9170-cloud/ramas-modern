// Every `import … from 'antd'` in the app lands here (vite.config.js alias). It is Ant Design itself, with five parts
// adjusted to the chosen UI preset (theme/themes.js) — so all pages change together without touching their code:
//   Form    label position (top / left / left, right-aligned / grid = desktop cells) — not the one-line filter bars (layout="inline")
//   Col     boxes per line inside a form (wider, one per line, denser) — see UiCol for which columns change
//   Drawer  where a new / edit form opens (right, left, bottom sheet, centred popup, full screen) and where its Save
//           button sits (header, footer, both)
//   Button  the Save buttons (a drawer's primary header button, or any button with the Save icon) get the
//           `save-action` class (floating Save, Ctrl+S) and, if the preset asks, a "Save karein?" confirmation
//   Table   bordered when the preset asks
import { createContext, forwardRef, useContext } from 'react';
import * as Antd from 'antd/es/index.js';
import { SaveOutlined } from '@ant-design/icons';     // the same module the pages use (identity check below)
import { useUiLayout } from '../theme/uiContext.js';

export * from 'antd/es/index.js';

/** Copy a component's statics (Table.Column, Button.Group, …) — never React's own fields ($$typeof, render, …). */
const REACT_KEYS = new Set(['$$typeof', 'render', 'type', 'compare', 'displayName', 'propTypes', 'defaultProps']);
function copyStatics(target, source) {
  for (const k of Object.keys(source)) if (!REACT_KEYS.has(k)) target[k] = source[k];
  return target;
}

// ---------------------------------------------------------------- Form
const FormCtx = createContext(null);          // { inForm } inside a (non-inline) form

const LABELS = {
  left: { layout: 'horizontal', labelCol: { flex: '0 0 140px' }, wrapperCol: { flex: '1 1 0' }, labelWrap: true, labelAlign: 'left' },
  'left-right': { layout: 'horizontal', labelCol: { flex: '0 0 140px' }, wrapperCol: { flex: '1 1 0' }, labelWrap: true, labelAlign: 'right' },
  top: { layout: 'vertical' },
  // desktop look: each field is one bordered cell — a small caption strip on top, the box under it — and the cells
  // are joined edge to edge into a grid (theme/desktop-green.css, .ui-grid-form)
  grid: { layout: 'vertical', colon: false, className: 'ui-grid-form' },
};

const UiForm = forwardRef(function UiForm(props, ref) {
  const ui = useUiLayout();
  const inline = props.layout === 'inline';
  const forced = inline ? {} : LABELS[ui.labels] ?? {};
  return (
    <FormCtx.Provider value={inline ? null : { inForm: true }}>
      <Antd.Form ref={ref} {...props} {...forced} className={[props.className, forced.className].filter(Boolean).join(' ') || undefined} />
    </FormCtx.Provider>
  );
});
for (const k of ['Item', 'List', 'ErrorList', 'Provider', 'useForm', 'useFormInstance', 'useWatch']) UiForm[k] = Antd.Form[k];
export { UiForm as Form };

// ---------------------------------------------------------------- Col (boxes per line)
const BREAKPOINTS = ['span', 'sm', 'md', 'lg', 'xl', 'xxl'];
const DENSE = { 3: 2, 4: 3, 5: 4, 6: 4, 7: 5, 8: 6 };

function scale(value, mode) {
  const span = typeof value === 'object' && value !== null ? value.span : value;
  if (typeof span !== 'number' || span >= 24) return value;
  let next = span;
  if (mode === 'single') next = 24;
  else if (mode === 'wide') next = span >= 12 ? 24 : Math.min(24, span * 2);
  else if (mode === 'dense') next = DENSE[span] ?? span;
  return typeof value === 'object' ? { ...value, span: next } : next;
}

// the widest share a Col asks for on desktop (md and up), e.g. 6 for `xs={12} md={6}`
const spanOf = (v) => (typeof v === 'object' && v !== null ? v.span : v);
function desktopSpan(p) {
  const spans = ['md', 'lg', 'xl', 'xxl', 'span'].map((bp) => spanOf(p[bp])).filter((v) => typeof v === 'number');
  return spans.length ? Math.max(...spans) : null;
}

const UiCol = forwardRef(function UiCol(props, ref) {
  const ui = useUiLayout();
  const form = useContext(FormCtx);
  let p = props;
  // "single": every column of a form takes a whole line. "wide" / "dense": the field-sized columns (a third of the
  // line or less) wherever they are — bigger containers (e.g. two halves holding their own fields) stay as they are,
  // so nothing is resized twice.
  const fieldSized = (desktopSpan(props) ?? 24) <= 8;
  if (form && ui.columns !== 'as-is' && (ui.columns === 'single' || fieldSized)) {
    p = { ...props };
    for (const bp of BREAKPOINTS) if (p[bp] !== undefined) p[bp] = scale(p[bp], ui.columns);
    if (ui.columns === 'single' && p.xs !== undefined) p.xs = 24;
  }
  return <Antd.Col ref={ref} {...p} />;
});
export { UiCol as Col };

// ---------------------------------------------------------------- Drawer (where a form opens, where Save sits)
const SaveSlot = createContext(false);

export function Drawer({ extra, footer, placement, width, height, open, onClose, title, children, destroyOnClose, className, ...rest }) {
  const ui = useUiLayout();
  const save = extra ? <SaveSlot.Provider value>{extra}</SaveSlot.Provider> : null;
  const inHeader = ui.save !== 'footer';
  const inFooter = ui.save === 'footer' || ui.save === 'both';
  const foot = inFooter && save ? <div className="ui-form-footer">{save}</div> : footer;

  if (ui.editor === 'modal' || ui.editor === 'fullscreen') {
    const full = ui.editor === 'fullscreen';
    return (
      <Antd.Modal
        open={open}
        onCancel={onClose}
        title={<div className="ui-modal-title"><span>{title}</span>{inHeader && save}</div>}
        footer={foot ?? null}
        width={full ? '100vw' : width}
        centered={!full}
        destroyOnHidden={destroyOnClose}
        maskClosable={false}
        className={[className, full ? 'ui-modal-full' : 'ui-modal'].filter(Boolean).join(' ')}
      >
        {children}
      </Antd.Modal>
    );
  }
  const where = { 'drawer-left': 'left', 'drawer-bottom': 'bottom', 'drawer-right': 'right' }[ui.editor] ?? placement ?? 'right';
  return (
    <Antd.Drawer
      {...rest}
      open={open}
      onClose={onClose}
      title={title}
      placement={where}
      width={where === 'bottom' ? undefined : width}
      height={where === 'bottom' ? '88vh' : height}
      extra={inHeader ? save : undefined}
      footer={foot}
      destroyOnHidden={destroyOnClose}
      className={className}
    >
      {children}
    </Antd.Drawer>
  );
}

// ---------------------------------------------------------------- Button (Save buttons)
const UiButton = forwardRef(function UiButton(props, ref) {
  const ui = useUiLayout();
  const inSaveSlot = useContext(SaveSlot);
  const isSave = (inSaveSlot && props.type === 'primary') || props.icon?.type === SaveOutlined;
  if (!isSave) return <Antd.Button ref={ref} {...props} />;
  const className = [props.className, 'save-action'].filter(Boolean).join(' ');
  if (ui.confirm && props.onClick && !props.disabled && !props.loading) {
    const { onClick, ...rest } = props;
    return (
      <Antd.Popconfirm title="Save karein?" description="Data save ho jayega." okText="Haan, save" cancelText="Nahi" onConfirm={(e) => onClick(e)}>
        <Antd.Button ref={ref} {...rest} className={className} />
      </Antd.Popconfirm>
    );
  }
  return <Antd.Button ref={ref} {...props} className={className} />;
});
copyStatics(UiButton, Antd.Button);
UiButton.__ANT_BUTTON = true;
export { UiButton as Button };

// ---------------------------------------------------------------- Table
const UiTable = forwardRef(function UiTable(props, ref) {
  const ui = useUiLayout();
  return <Antd.Table ref={ref} bordered={props.bordered ?? ui.table === 'bordered'} {...props} />;
});
copyStatics(UiTable, Antd.Table);
export { UiTable as Table };
