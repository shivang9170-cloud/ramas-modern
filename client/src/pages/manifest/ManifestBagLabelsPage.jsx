// Route /print/manifest-bags/:manifestNo — one label per master bag / bag / packet of a manifest (Code 128 barcode of
// its number, from → to, what it holds). Printed from the manifest screen after a save; any A4 / label printer.
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { api, errorMessage } from '../../api/client.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import Barcode128 from '../../components/Barcode128.jsx';

const LABEL = { MASTER: 'MASTER BAG', BAG: 'BAG', PACKET: 'PACKET' };

export default function ManifestBagLabelsPage() {
  const { manifestNo } = useParams();
  const { user } = useAuth();
  const { data: m, error, isLoading } = useQuery({
    queryKey: ['manifest', manifestNo],
    queryFn: () => api.get(`/manifests/${encodeURIComponent(manifestNo)}`).then((r) => r.data),
  });
  if (isLoading) return <div style={{ padding: 40 }}>Loading labels…</div>;
  if (error) return <div style={{ padding: 40, color: '#b00' }}>{errorMessage(error)}</div>;
  const bags = (m.bags ?? []).filter((b) => !b.cancelled);
  const parentOf = (b) => bags.find((x) => x.bagNo === b.parent);

  return (
    <div className="bag-labels">
      <style>{`
        .bag-labels { background: #fff; color: #000; padding: 16px; font-family: Arial, sans-serif; min-height: 100vh; }
        .bag-labels .bar { display: flex; gap: 8px; align-items: center; margin-bottom: 12px; }
        .bag-labels .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(96mm, 1fr)); gap: 6mm; }
        .bag-label { border: 2px solid #000; padding: 4mm; height: 66mm; box-sizing: border-box; display: flex; flex-direction: column; break-inside: avoid; }
        .bag-label .lvl { font-size: 15px; font-weight: 800; letter-spacing: 1px; display: flex; justify-content: space-between; }
        .bag-label .route { font-size: 20px; font-weight: 800; margin: 2mm 0; }
        .bag-label .meta { font-size: 11px; line-height: 1.45; }
        .bag-label .dockets { font-size: 10px; margin-top: auto; word-break: break-all; }
        @media print { .bag-labels .bar { display: none; } .bag-labels { padding: 0; } @page { margin: 8mm; } }
      `}</style>
      <div className="bar">
        <button type="button" onClick={() => window.print()}>Print</button>
        <span>Manifest {m.manifestNo} · {bags.length} label(s)</span>
      </div>
      {!bags.length && <div>This manifest has no bags (whole dockets).</div>}
      <div className="grid">
        {bags.map((b) => {
          const parent = parentOf(b);
          return (
            <div className="bag-label" key={b.bagNo}>
              <div className="lvl"><span>{LABEL[b.level]}</span><span>{user.divName}</span></div>
              <div className="route">{user.currentBranch?.name} → {m.destination}</div>
              <Barcode128 value={b.bagNo} height={46} />
              <div className="meta">
                Manifest <strong>{m.manifestNo}</strong> · {dayjs(m.manifestDate).format('DD/MM/YYYY')} {m.manifestTime}<br />
                <strong>{b.dockets}</strong> docket(s) · <strong>{b.packages}</strong> pkts · <strong>{Number(b.weight).toFixed(2)}</strong> kg
                {b.sealNo ? <> · Seal <strong>{b.sealNo}</strong></> : null}
                {parent ? <><br />Inside {LABEL[parent.level].toLowerCase()} {parent.bagNo}</> : null}
              </div>
              {b.docketNos?.length > 0 && <div className="dockets">{b.docketNos.join(', ')}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
