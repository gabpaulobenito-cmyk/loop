import type { Loop } from '../../shared/types';

type Size = 'xs' | 'sm' | 'md' | 'lg';

interface Props {
  loop: Loop;
  size?: Size;
  disabled?: boolean;
  onToggle: () => void;
  onReopen: () => void;
}

/** Start / stop / reopen control. Stops click propagation so the parent row does not also fire. */
export function ToggleButton({ loop, size = 'md', disabled, onToggle, onReopen }: Props) {
  const cls = `tbtn${size === 'md' ? '' : ` tbtn--${size}`}`;
  if (loop.state === 'closed') {
    return (
      <button
        type="button"
        className={cls}
        data-ctl="toggle"
        title="REOPEN"
        aria-label={`Reopen ${loop.title}`}
        disabled={disabled}
        onClick={(e) => {
          e.stopPropagation();
          onReopen();
        }}
      >
        <span className="g-reopen" aria-hidden="true">↺</span>
      </button>
    );
  }
  const running = loop.state === 'running';
  return (
    <button
      type="button"
      className={cls}
      data-ctl="toggle"
      title={running ? 'STOP' : 'START'}
      aria-label={`${running ? 'Stop' : loop.accumulatedMs > 0 ? 'Resume' : 'Start'} ${loop.title}`}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
    >
      <span className={running ? 'g-stop' : 'g-play'} aria-hidden="true" />
    </button>
  );
}

/** Vertical three-dot button that opens a loop's detail drawer (rename, note, delete…). */
export function MoreButton({
  title,
  size,
  expanded,
  onOpen,
}: {
  title: string;
  size: Size;
  expanded: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      className={`mbtn mbtn--${size}`}
      data-ctl="more"
      title="DETAILS"
      aria-label={`Details for ${title}`}
      aria-haspopup="dialog"
      aria-expanded={expanded}
      onClick={(e) => {
        e.stopPropagation();
        onOpen();
      }}
    >
      <svg viewBox="0 0 4 14" aria-hidden="true" focusable="false">
        <circle cx="2" cy="2" r="1.35" />
        <circle cx="2" cy="7" r="1.35" />
        <circle cx="2" cy="12" r="1.35" />
      </svg>
    </button>
  );
}
