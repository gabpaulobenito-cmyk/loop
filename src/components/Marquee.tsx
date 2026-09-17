import { useLayoutEffect, useRef } from 'react';

/**
 * Single-line note that slowly pans when it overflows (as in V2), pausing on
 * hover/focus. Under prefers-reduced-motion it falls back to an ellipsis.
 */
export function Marquee({ text, className = '' }: { text: string; className?: string }) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const o = outer.current;
    const i = inner.current;
    if (!o || !i) return;
    const measure = () => {
      const over = Math.ceil(i.scrollWidth - o.clientWidth);
      if (over > 6) {
        o.classList.add('is-moving');
        const style = o.style;
        style.setProperty('--sx', `${-over}px`);
        style.setProperty('--mq-dur', `${Math.round(over / 16) + 5}s`);
        style.setProperty('--mq-steps', String(over));
      } else {
        o.classList.remove('is-moving');
      }
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(o);
    return () => ro.disconnect();
  }, [text]);

  return (
    <div ref={outer} className={`marquee ${className}`} title={text}>
      <span ref={inner} className="marquee__inner">
        {text}
      </span>
    </div>
  );
}
