import React, { useState, useEffect, useRef } from 'react';
import { ChevronRight } from 'lucide-react';

export interface MenuItemData {
  type?: 'item' | 'separator';
  title?: string;
  icon?: React.ReactNode;
  shortcut?: string;
  isWarning?: boolean;
  disabled?: boolean;
  action?: () => void;
  submenu?: MenuItemData[];
}

interface ObsidianMenuProps {
  x: number;
  y: number;
  items: MenuItemData[];
  onClose: () => void;
}

interface MenuItemRowProps {
  item: MenuItemData;
  onTrigger: (item: MenuItemData, e: React.MouseEvent) => void;
}

const MenuItemRow: React.FC<MenuItemRowProps> = ({ item, onTrigger }) => {
  const [isSubmenuOpen, setIsSubmenuOpen] = useState(false);
  const [opensLeft, setOpensLeft] = useState(false);
  const rowRef = useRef<HTMLDivElement>(null);
  const hasSubmenu = Boolean(item.submenu && item.submenu.length > 0);

  return (
    <div
      ref={rowRef}
      className={`menu-item relative ${item.isWarning ? 'is-warning' : ''} ${
        item.disabled ? 'is-disabled' : ''
      } ${isSubmenuOpen ? 'selected' : ''}`}
      onMouseEnter={() => {
        if (item.disabled) return;
        if (hasSubmenu) {
          if (rowRef.current) {
            const rect = rowRef.current.getBoundingClientRect();
            setOpensLeft(rect.right + 200 > window.innerWidth);
          }
          setIsSubmenuOpen(true);
        }
      }}
      onMouseLeave={(e) => {
        if (hasSubmenu) {
          const nextTarget = e.relatedTarget as Node | null;
          if (rowRef.current && nextTarget && rowRef.current.contains(nextTarget)) {
            return;
          }
          setIsSubmenuOpen(false);
        }
      }}
      onMouseDown={(e) => {
        if (item.disabled) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        if (hasSubmenu) {
          e.preventDefault();
          e.stopPropagation();
          if (rowRef.current) {
            const rect = rowRef.current.getBoundingClientRect();
            setOpensLeft(rect.right + 200 > window.innerWidth);
          }
          setIsSubmenuOpen((prev) => !prev);
        } else {
          onTrigger(item, e);
        }
      }}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (item.disabled) return;
        if (!hasSubmenu) {
          onTrigger(item, e);
        }
      }}
    >
      {item.icon && <span className="menu-item-icon">{item.icon}</span>}
      <span className="menu-item-title flex-1">{item.title}</span>

      {item.shortcut && (
        <span className="menu-item-shortcut">{item.shortcut}</span>
      )}

      {hasSubmenu && (
        <ChevronRight size={14} className="text-stone-500 ml-2" />
      )}

      {/* Recursive Submenu */}
      {hasSubmenu && isSubmenuOpen && item.submenu && (
        <div
          className={`menu top-0 ${opensLeft ? 'right-full -mr-1' : 'left-full -ml-1'} min-w-[185px] shadow-2xl animate-fadeIn z-50`}
          style={{ position: 'absolute' }}
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onMouseEnter={() => setIsSubmenuOpen(true)}
        >
          <div className="menu-scroll">
            {item.submenu.map((sub, sIdx) => {
              if (sub.type === 'separator') {
                return <div key={sIdx} className="menu-separator" />;
              }
              return (
                <MenuItemRow
                  key={sIdx}
                  item={sub}
                  onTrigger={onTrigger}
                />
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export const ObsidianMenu: React.FC<ObsidianMenuProps> = ({ x, y, items, onClose }) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState<{ x: number; y: number }>({ x, y });

  // Boundary adjustment to keep menu inside screen
  useEffect(() => {
    if (!menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    let newX = x;
    let newY = y;

    if (newX + rect.width > window.innerWidth - 8) {
      newX = Math.max(8, window.innerWidth - rect.width - 8);
    }
    if (newY + rect.height > window.innerHeight - 8) {
      newY = Math.max(8, window.innerHeight - rect.height - 8);
    }

    setCoords({ x: newX, y: newY });
  }, [x, y]);

  // Click outside and Escape key dismissal
  useEffect(() => {
    const handlePointerDown = (e: MouseEvent | PointerEvent) => {
      if (menuRef.current && menuRef.current.contains(e.target as Node)) {
        return;
      }
      onClose();
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  const handleItemTrigger = (targetItem: MenuItemData, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (targetItem.disabled) return;
    console.log('[Urano Menu] Ejecutando comando:', targetItem.title || 'Sin nombre');
    if (targetItem.action) {
      targetItem.action();
      onClose();
    }
  };

  return (
    <div
      ref={menuRef}
      className="menu select-none animate-fadeIn"
      style={{
        left: `${coords.x}px`,
        top: `${coords.y}px`,
      }}
      onContextMenu={(e) => e.preventDefault()}
      onMouseDown={(e) => e.preventDefault()}
    >
      <div className="menu-scroll">
        {items.map((item, idx) => {
          if (item.type === 'separator') {
            return <div key={idx} className="menu-separator" />;
          }

          return (
            <MenuItemRow
              key={idx}
              item={item}
              onTrigger={handleItemTrigger}
            />
          );
        })}
      </div>
    </div>
  );
};
