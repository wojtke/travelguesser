import { useEffect, useRef } from 'react';
import { Compass, X } from 'lucide-react';

export default function Modal({ close, title, children, className = '' }) {
  const ref = useRef(null);
  useEffect(() => {
    const old = document.activeElement;
    const el = ref.current;
    el?.focus();
    const fn = (e) => {
      if (e.key === 'Escape') close();
      if (e.key === 'Tab') {
        const all = [
          ...el.querySelectorAll('button, input, a, select, textarea, [tabindex="0"]'),
        ].filter((x) => !x.disabled);
        if (!all.length) return;
        const first = all[0],
          last = all.at(-1);
        if (e.shiftKey && (document.activeElement === first || document.activeElement === el)) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', fn);
    return () => {
      document.removeEventListener('keydown', fn);
      old?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <section
        className={`modal ${className}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        tabIndex={-1}
        ref={ref}
      >
        <button className="modal-close icon-button" onClick={close} aria-label="Close dialog">
          <X size={20} />
        </button>
        <span className="modal-symbol">
          <Compass size={27} />
        </span>
        <h2 id="modal-title">{title}</h2>
        {children}
      </section>
    </div>
  );
}
