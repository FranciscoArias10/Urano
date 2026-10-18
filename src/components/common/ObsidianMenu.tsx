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

export const ObsidianMenu: React.FC<ObsidianMenuProps> = ({ x, y, items, onClose }) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const [activeSubmenuIndex, setActiveSubmenuIndex] = useState<number | null>(null);
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

          const hasSubmenu = Boolean(item.submenu && item.submenu.length > 0);
          const isSubmenuOpen = activeSubmenuIndex === idx;

          return (
            <div
              key={idx}
              className={`menu-item relative ${item.isWarning ? 'is-warning' : ''} ${
                item.disabled ? 'is-disabled' : ''
              } ${isSubmenuOpen ? 'selected' : ''}`}
              onMouseEnter={() => {
                if (hasSubmenu) {
                  setActiveSubmenuIndex(idx);
                } else {
                  setActiveSubmenuIndex(null);
                }
              }}
              onMouseDown={(e) => {
                if (hasSubmenu) {
                  e.preventDefault();
                  e.stopPropagation();
                  setActiveSubmenuIndex(idx);
                } else {
                  handleItemTrigger(item, e);
                }
              }}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (!hasSubmenu) {
                  handleItemTrigger(item, e);
                }
              }}
            >
              {item.icon && <span className="menu-item-icon">{item.icon}</span>}
              <span className="menu-item-title">{item.title}</span>

              {item.shortcut && (
                <span className="menu-item-shortcut">{item.shortcut}</span>
              )}

              {hasSubmenu && (
                <ChevronRight size={14} className="text-stone-500 ml-2" />
              )}

              {/* Submenu rendering */}
              {hasSubmenu && isSubmenuOpen && item.submenu && (
                <div
                  className="menu absolute top-0 left-full -ml-1 min-w-[180px] shadow-2xl animate-fadeIn"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  onMouseEnter={() => setActiveSubmenuIndex(idx)}
                >
                  <div className="menu-scroll">
                    {item.submenu.map((subItem, sIdx) => {
                      if (subItem.type === 'separator') {
                        return <div key={sIdx} className="menu-separator" />;
                      }

                      return (
                        <div
                          key={sIdx}
                          className={`menu-item ${subItem.isWarning ? 'is-warning' : ''} ${
                            subItem.disabled ? 'is-disabled' : ''
                          }`}
                          onMouseDown={(e) => {
                            handleItemTrigger(subItem, e);
                          }}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            handleItemTrigger(subItem, e);
                          }}
                        >
                          {subItem.icon && <span className="menu-item-icon">{subItem.icon}</span>}
                          <span className="menu-item-title">{subItem.title}</span>
                          {subItem.shortcut && (
                            <span className="menu-item-shortcut">{subItem.shortcut}</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
