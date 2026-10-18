import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import type { PhoneLink } from '../phone/PhoneLink';
import { usePhone } from './common';

function usePhoneUrl(code: string) {
  const [url, setUrl] = useState(`${location.origin}/phone?s=${code}`);
  const [alts, setAlts] = useState<string[]>([]);
  useEffect(() => {
    const local = ['localhost', '127.0.0.1', '::1'].includes(location.hostname);
    if (!local) return;
    fetch('/api/session/info')
      .then((r) => r.json())
      .then((j: { lanUrls: string[] }) => {
        if (j.lanUrls?.length) {
          setUrl(`${j.lanUrls[0]}/phone?s=${code}`);
          setAlts(j.lanUrls.slice(1).map((u) => `${u}/phone?s=${code}`));
        }
      })
      .catch(() => {});
  }, [code]);
  return { url, alts };
}

export function ConnectPhone({ link, compact, onClose }: { link: PhoneLink; compact?: boolean; onClose?: () => void }) {
  const st = usePhone(link);
  const { url, alts } = usePhoneUrl(st.code);
  const [qr, setQr] = useState<string | null>(null);
  useEffect(() => {
    QRCode.toDataURL(url, { margin: 1, width: 320, color: { dark: '#0b0c0f', light: '#f4f1ec' } }).then(setQr).catch(() => setQr(null));
  }, [url]);
  const connected = st.phones > 0;

  return (
    <div className={`connect ${compact ? 'compact' : ''}`}>
      <div className="connect-head">
        <div>
          <div className="eyebrow">Phone remote</div>
          <h3 className="serif">{connected ? 'Phone connected' : 'Connect your phone'}</h3>
        </div>
        {onClose && <button className="x" aria-label="Close" onClick={onClose}>×</button>}
      </div>
      <div className="connect-body">
        <div className={`qr ${connected ? 'dim' : ''}`}>{qr ? <img src={qr} alt="QR code for the phone remote" /> : <div className="skeleton" style={{ width: '100%', height: '100%' }} />}</div>
        <div className="connect-info">
          <div className="code-label faint">Session code</div>
          <div className="code mono">{st.code.split('').map((c, i) => <span key={i}>{c}</span>)}</div>
          <div className="conn-state">
            <span className={`dot ${connected ? 'ok' : st.online ? '' : 'danger'}`} />
            {connected ? `${st.device ?? 'Phone'}${st.phones > 1 ? ` +${st.phones - 1}` : ''}` : st.online ? 'Waiting for phone…' : 'Relay offline — retrying'}
          </div>
        </div>
      </div>
      {!compact && (
        <ol className="connect-steps">
          <li>Join the same Wi-Fi as this computer.</li>
          <li>Scan with the Android camera, or open <span className="mono url">{url.replace(/^https?:\/\//, '')}</span></li>
          <li>Tap <b>Rep</b> on the phone — reps feed the same set as the keyboard.</li>
          {alts.length > 0 && <li className="faint">Other addresses: {alts.map((a) => a.replace(/^https?:\/\//, '')).join(', ')}</li>}
        </ol>
      )}
    </div>
  );
}
