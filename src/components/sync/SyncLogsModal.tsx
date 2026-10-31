import React from 'react';
import { useSyncStore } from '../../stores/syncStore';
import { useT } from '../../stores/localeStore';
import { X, Activity, CheckCircle, AlertTriangle, AlertCircle, Info } from 'lucide-react';

interface SyncLogsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SyncLogsModal: React.FC<SyncLogsModalProps> = ({ isOpen, onClose }) => {
  const { logs } = useSyncStore();
  const t = useT();

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--background-modifier-cover)] backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-obsidian-sidebar border border-obsidian-border rounded-xl w-full max-w-lg max-h-[80vh] shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-obsidian-border bg-obsidian-bg/50">
          <div className="flex items-center gap-2">
            <Activity className="w-5 h-5 text-orange-400" />
            <h2 className="text-base font-semibold text-obsidian-text">{t('sync.logsModal.title')}</h2>
          </div>
          <button
            onClick={onClose}
            className="text-obsidian-muted hover:text-obsidian-text p-1 rounded-md transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content list */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2 font-mono text-[11px]">
          {logs.length === 0 ? (
            <div className="text-center text-obsidian-muted py-8 font-sans text-xs">
              {t('sync.logsModal.empty')}
            </div>
          ) : (
            logs.map((log) => {
              let Icon = Info;
              let iconColor = 'text-blue-400';
              let bgColor = 'bg-blue-500/5';
              let borderColor = 'border-blue-500/20';

              if (log.type === 'success') {
                Icon = CheckCircle;
                iconColor = 'text-emerald-400';
                bgColor = 'bg-emerald-500/5';
                borderColor = 'border-emerald-500/20';
              } else if (log.type === 'warn') {
                Icon = AlertTriangle;
                iconColor = 'text-amber-400';
                bgColor = 'bg-amber-500/5';
                borderColor = 'border-amber-500/20';
              } else if (log.type === 'error') {
                Icon = AlertCircle;
                iconColor = 'text-red-400';
                bgColor = 'bg-red-500/5';
                borderColor = 'border-red-500/20';
              }

              return (
                <div
                  key={log.id}
                  className={`flex items-start gap-2.5 p-2 rounded-lg border ${bgColor} ${borderColor}`}
                >
                  <Icon className={`w-3.5 h-3.5 ${iconColor} shrink-0 mt-0.5`} />
                  <div className="flex-1 min-w-0">
                    <span className="text-obsidian-muted mr-2">[{log.timestamp}]</span>
                    <span className="text-obsidian-text break-words">{log.message}</span>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-obsidian-border bg-obsidian-bg/50 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-obsidian-active hover:bg-obsidian-hover text-obsidian-text text-xs transition-colors"
          >
            {t('common.close')}
          </button>
        </div>
      </div>
    </div>
  );
};
