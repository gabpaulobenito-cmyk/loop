import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { NOTE_MAX, TITLE_MAX } from '../../shared/types';

interface Props {
  field: 'title' | 'note';
  initial: string;
  compact: boolean;
  onSave: (value: string) => void;
  onCancel: () => void;
}

/** Inline editor that takes over a row. Enter or blur saves, Escape cancels. */
export function RowEdit({ field, initial, compact, onSave, onCancel }: Props) {
  const [value, setValue] = useState(initial);
  const done = useRef(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);

  const save = () => {
    if (done.current) return;
    done.current = true;
    const v = value.replace(/\s+/g, ' ').trim();
    if ((field === 'title' && !v) || v === initial) onCancel();
    else onSave(v);
  };
  const cancel = () => {
    if (done.current) return;
    done.current = true;
    onCancel();
  };
  // Buttons must not steal focus first, or blur would save before cancel runs.
  const noBlur = (e: ReactMouseEvent) => e.preventDefault();

  return (
    <div className="row-edit" onClick={(e) => e.stopPropagation()}>
      <span className="row-edit__label" aria-hidden="true">{field === 'title' ? 'TITLE' : 'NOTE'}</span>
      <input
        ref={input}
        className="row-edit__input"
        type="text"
        aria-label={field === 'title' ? 'Edit title' : 'Edit note'}
        placeholder={field === 'note' ? 'Short context note' : undefined}
        maxLength={field === 'title' ? TITLE_MAX : NOTE_MAX}
        enterKeyHint="done"
        autoComplete="off"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
            e.preventDefault();
            save();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            cancel();
          }
        }}
      />
      <button type="button" className="row-edit__btn row-edit__btn--save hit" onMouseDown={noBlur} onClick={save} aria-label="Save">
        {compact ? '✓' : 'SAVE'}
      </button>
      <button type="button" className="row-edit__btn hit" onMouseDown={noBlur} onClick={cancel} aria-label="Cancel">
        ✕
      </button>
    </div>
  );
}
