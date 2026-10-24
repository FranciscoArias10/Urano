import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { useT } from '../../stores/localeStore';

interface UpdateLinksModalProps {
  isOpen: boolean;
  totalLinks: number;
  totalFiles: number;
  onAlwaysUpdate: () => void;
  onJustOnce: () => void;
  onDoNotUpdate: () => void;
}

export const UpdateLinksModal: React.FC<UpdateLinksModalProps> = ({
  isOpen,
  totalLinks,
  totalFiles,
  onAlwaysUpdate,
  onJustOnce,
  onDoNotUpdate,
}) => {
  const t = useT();
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onDoNotUpdate();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onDoNotUpdate]);

  if (!isOpen) return null;

  const linksText = t(totalLinks === 1 ? 'updateLinks.linkOne' : 'updateLinks.linkOther', {
    count: totalLinks,
  });
  const filesText = t(totalFiles === 1 ? 'updateLinks.fileOne' : 'updateLinks.fileOther', {
    count: totalFiles,
  });

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-[1px]"
      onClick={onDoNotUpdate}
    >
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-update-links-title"
        onClick={(e) => e.stopPropagation()}
        className="relative w-[440px] max-w-[92vw] bg-[#1e1e1e] border border-[#363636] rounded-[8px] p-6 text-stone-200 shadow-[0_20px_25px_-5px_rgba(0,0,0,0.7),0_10px_10px_-5px_rgba(0,0,0,0.5)] select-none animate-in fade-in zoom-in-95 duration-100"
      >
        {/* Top-right close button (×) */}
        <button
          onClick={onDoNotUpdate}
          title={t('updateLinks.close')}
          className="absolute top-4 right-4 p-1 text-stone-400 hover:text-white hover:bg-white/5 rounded transition-colors outline-none cursor-pointer"
        >
          <X size={16} />
        </button>

        {/* Modal Title */}
        <h2
          id="modal-update-links-title"
          className="text-[17px] font-semibold text-stone-100 tracking-tight mb-2.5 pr-6"
        >
          {t('updateLinks.title')}
        </h2>

        {/* Modal Body */}
        <div className="space-y-2 text-sm leading-relaxed">
          <p className="text-stone-200">
            {t('updateLinks.question')}
          </p>
          <p className="text-stone-400">
            {t('updateLinks.affects', { links: linksText, files: filesText })}
          </p>
        </div>

        {/* Action Buttons Container */}
        <div className="mt-6 flex items-center justify-end gap-2">
          <button
            onClick={onAlwaysUpdate}
            className="px-3.5 py-1.5 bg-[#e06c1b] hover:bg-[#ea7e31] text-white text-xs font-medium rounded transition-colors shadow-sm outline-none cursor-pointer focus-visible:ring-2 focus-visible:ring-orange-400"
          >
            {t('updateLinks.alwaysUpdate')}
          </button>
          <button
            onClick={onJustOnce}
            className="px-3.5 py-1.5 bg-[#262626] hover:bg-[#333333] text-stone-200 border border-[#3d3d3d] text-xs font-medium rounded transition-colors outline-none cursor-pointer focus-visible:ring-2 focus-visible:ring-stone-400"
          >
            {t('updateLinks.justOnce')}
          </button>
          <button
            onClick={onDoNotUpdate}
            className="px-3.5 py-1.5 bg-[#262626] hover:bg-[#333333] text-stone-200 border border-[#3d3d3d] text-xs font-medium rounded transition-colors outline-none cursor-pointer focus-visible:ring-2 focus-visible:ring-stone-400"
          >
            {t('updateLinks.doNotUpdate')}
          </button>
        </div>
      </div>
    </div>
  );
};
