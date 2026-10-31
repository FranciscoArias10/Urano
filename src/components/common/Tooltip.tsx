import React, { useState, useRef, useEffect } from 'react';
import ReactDOM from 'react-dom';

interface TooltipProps {
  content: string;
  shortcut?: string;
  position?: 'right' | 'bottom' | 'top' | 'left';
  delay?: number;
  children: React.ReactElement;
}

export const Tooltip: React.FC<TooltipProps> = ({
  content,
  shortcut,
  position = 'right',
  delay = 200,
  children,
}) => {
  const [visible, setVisible] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLElement | null>(null);
  const timerRef = useRef<any>(null);

  const showTooltip = () => {
    timerRef.current = setTimeout(() => {
      if (!triggerRef.current) return;
      const rect = triggerRef.current.getBoundingClientRect();

      let top = 0;
      let left = 0;

      if (position === 'right') {
        top = rect.top + rect.height / 2;
        left = rect.right + 8;
      } else if (position === 'left') {
        top = rect.top + rect.height / 2;
        left = rect.left - 8;
      } else if (position === 'bottom') {
        top = rect.bottom + 8;
        left = rect.left + rect.width / 2;
      } else if (position === 'top') {
        top = rect.top - 8;
        left = rect.left + rect.width / 2;
      }

      setCoords({ top, left });
      setVisible(true);
    }, delay);
  };

  const hideTooltip = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setVisible(false);
  };

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const clonedChild = React.cloneElement(children, {
    ref: (node: HTMLElement | null) => {
      triggerRef.current = node;
      // Preserve original ref if exists
      const { ref } = children as any;
      if (typeof ref === 'function') ref(node);
      else if (ref) ref.current = node;
    },
    onMouseEnter: (e: React.MouseEvent) => {
      showTooltip();
      children.props.onMouseEnter?.(e);
    },
    onMouseLeave: (e: React.MouseEvent) => {
      hideTooltip();
      children.props.onMouseLeave?.(e);
    },
    onClick: (e: React.MouseEvent) => {
      hideTooltip();
      children.props.onClick?.(e);
    },
  });

  return (
    <>
      {clonedChild}
      {visible &&
        ReactDOM.createPortal(
          <div
            className={`urano-tooltip mod-${position}`}
            style={{
              top: `${coords.top}px`,
              left: `${coords.left}px`,
              transform:
                position === 'right'
                  ? 'translateY(-50%)'
                  : position === 'left'
                  ? 'translate(-100%, -50%)'
                  : position === 'bottom'
                  ? 'translateX(-50%)'
                  : 'translate(-50%, -100%)',
            }}
          >
            <div className="urano-tooltip-arrow" />
            <div className="flex items-center gap-1.5">
              <span>{content}</span>
              {shortcut && (
                <span className="text-[10px] text-obsidian-muted font-mono bg-[var(--interactive-normal)] px-1 py-0.2 rounded border border-obsidian-border">
                  {shortcut}
                </span>
              )}
            </div>
          </div>,
          document.body
        )}
    </>
  );
};
