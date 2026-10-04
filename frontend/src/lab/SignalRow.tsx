import { SIGNAL_LABEL, type Signal } from './labData';

export const formatCount = (value: number | null): string => value === null ? '—' : Number(value.toFixed(1)).toString();

type SignalRowProps = {
  signal: Signal;
  a: number | null;
  b: number | null;
  maximum: number;
  range: string;
};

export function SignalRow({ signal, a, b, maximum, range }: SignalRowProps) {
  const label = SIGNAL_LABEL[signal];
  return (
    <div className="lab-signal" role="group" aria-label={`${label}: draft A ${formatCount(a)}, draft B ${formatCount(b)}`} title={range}>
      <div className="lab-signal-values">
        <span className="lab-a">{formatCount(a)}</span>
        <span className="lab-signal-label">{label}</span>
        <span className="lab-b">{formatCount(b)}</span>
      </div>
      <div className="lab-bars" aria-hidden="true">
        <div className={`lab-bar-half lab-bar-a${a === null ? ' is-scoring' : ''}`}>
          <span style={{ width: `${a === null ? 100 : a / maximum * 100}%` }} />
        </div>
        <div className={`lab-bar-half lab-bar-b${b === null ? ' is-scoring' : ''}`}>
          <span style={{ width: `${b === null ? 100 : b / maximum * 100}%` }} />
        </div>
      </div>
    </div>
  );
}
