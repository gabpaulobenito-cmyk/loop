import { useEffect, useState } from 'react';
import type { Loop } from '../../shared/types';
import { MenuPopover } from './Chrome';

export type LoopMenuAction = 'edit-title' | 'edit-note' | 'delete';

interface Item {
  action: LoopMenuAction;
  label: string;
  hint?: string;
  destructive?: boolean;
  separatorBefore?: boolean;
}

/** Per-loop settings. Add entries here to extend the menu. */
function itemsFor(loop: Loop): Item[] {
  return [
    { action: 'edit-title', label: 'EDIT TITLE' },
    { action: 'edit-note', label: loop.note ? 'EDIT NOTE' : 'ADD NOTE' },
    { action: 'delete', label: 'DELETE', destructive: true, separatorBefore: true },
  ];
}

interface Props {
  loop: Loop;
  anchor: HTMLElement | null;
  onAction: (action: LoopMenuAction) => void;
  onClose: () => void;
}

export function LoopMenu({ loop, anchor, onAction, onClose }: Props) {
  // Deleting takes two clicks so a stray tap can't remove a loop.
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!confirming) return;
    const t = setTimeout(() => setConfirming(false), 4000);
    return () => clearTimeout(t);
  }, [confirming]);

  return (
    <MenuPopover anchor={anchor} onClose={onClose} label={`Actions for ${loop.title}`} compact>
      <div className="menu__title" title={loop.title}>{loop.title}</div>
      {itemsFor(loop).map((item) => (
        <div key={item.action}>
          {item.separatorBefore && <div className="menu__sep" />}
          <button
            type="button"
            role="menuitem"
            className={`menu__item${item.destructive ? ' menu__item--danger' : ''}${item.destructive && confirming ? ' is-confirming' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              if (item.destructive && !confirming) {
                setConfirming(true);
                return;
              }
              onAction(item.action);
            }}
          >
            <span>{item.destructive && confirming ? 'CONFIRM DELETE' : item.label}</span>
            <span>{item.destructive && confirming ? '⏎' : item.hint ?? ''}</span>
          </button>
        </div>
      ))}
    </MenuPopover>
  );
}
