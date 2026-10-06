import { explorerTx } from '@/lib/meridian';

export function TxStatus({ status }: { status: { kind: string; msg?: string; sig?: string } }) {
  if (status.kind === 'idle') return null;
  const color = status.kind === 'error' ? 'text-no' : status.kind === 'ok' ? 'text-yes' : 'text-gray-300';
  return (
    <p role="status" aria-live="polite" className={`text-sm ${color}`}>
      {status.msg}{' '}
      {status.sig && (
        <a className="underline" href={explorerTx(status.sig)} target="_blank" rel="noreferrer">
          view tx
        </a>
      )}
    </p>
  );
}
