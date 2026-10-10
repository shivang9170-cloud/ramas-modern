// Table export used by masters and reports. Replaces the Crystal Reports / GridView
// "Export to Excel" buttons with client-side CSV and PDF.
//
// columns: [{ title, dataIndex, align?, render?(value,row) -> string }]

function cellText(col, row) {
  const v = row[col.dataIndex];
  const out = col.exportValue ? col.exportValue(v, row) : v;
  return out === null || out === undefined ? '' : String(out);
}

export function exportCsv(filename, columns, rows) {
  const esc = (s) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const lines = [
    columns.map((c) => esc(String(c.title))).join(','),
    ...rows.map((r) => columns.map((c) => esc(cellText(c, r))).join(',')),
  ];
  // BOM so Excel opens UTF-8 correctly
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  download(blob, filename.endsWith('.csv') ? filename : `${filename}.csv`);
}

export async function exportPdf(filename, title, columns, rows, { subtitle, landscape = true, totals } = {}) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const doc = new jsPDF({ orientation: landscape ? 'landscape' : 'portrait', unit: 'pt', format: 'a4' });
  doc.setFontSize(14);
  doc.text(title, 40, 40);
  if (subtitle) {
    doc.setFontSize(9);
    doc.setTextColor(90);
    doc.text(subtitle, 40, 56);
    doc.setTextColor(0);
  }
  autoTable(doc, {
    startY: subtitle ? 68 : 56,
    head: [columns.map((c) => c.title)],
    body: rows.map((r) => columns.map((c) => cellText(c, r))),
    foot: totals ? [columns.map((c) => (totals[c.dataIndex] ?? ''))] : undefined,
    styles: { fontSize: 8, cellPadding: 3 },
    headStyles: { fillColor: [31, 95, 168] },
    footStyles: { fillColor: [230, 236, 245], textColor: 20, fontStyle: 'bold' },
    columnStyles: Object.fromEntries(columns.map((c, i) => [i, { halign: c.align === 'right' ? 'right' : 'left' }])),
    didDrawPage: () => {
      const n = doc.internal.getNumberOfPages();
      doc.setFontSize(8);
      doc.text(`Page ${n}  •  Printed ${new Date().toLocaleString('en-GB')}`, 40, doc.internal.pageSize.getHeight() - 20);
    },
  });
  doc.save(filename.endsWith('.pdf') ? filename : `${filename}.pdf`);
}

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
