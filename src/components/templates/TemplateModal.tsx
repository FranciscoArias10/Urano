import React, { useState } from 'react';
import { FileText, Calendar, Users, Briefcase, BookOpen, X, Check } from 'lucide-react';
import { useT } from '../../stores/localeStore';

export interface TemplateItem {
  id: string;
  name: string;
  description: string;
  icon: React.ReactNode;
  content: string;
}

interface TemplateModalProps {
  isOpen: boolean;
  onClose: () => void;
  onInsert: (content: string) => void;
}

export const TemplateModal: React.FC<TemplateModalProps> = ({
  isOpen,
  onClose,
  onInsert,
}) => {
  const t = useT();
  const [selectedId, setSelectedId] = useState<string>('daily');

  if (!isOpen) return null;

  const now = new Date();
  const dateStr = now.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const templates: TemplateItem[] = [
    {
      id: 'daily',
      name: t('templates.daily.name'),
      description: t('templates.daily.description'),
      icon: <Calendar size={18} className="text-orange-400" />,
      content: `# Nota del Día: ${dateStr}\n\n## 🎯 Objetivos Principales\n- [ ] \n- [ ] \n\n## 📋 Tareas Pendientes\n- [ ] \n- [ ] \n\n## 📝 Notas y Reflexiones\n\n`,
    },
    {
      id: 'meeting',
      name: t('templates.meeting.name'),
      description: t('templates.meeting.description'),
      icon: <Users size={18} className="text-sky-400" />,
      content: `# Reunión: [Tema de la reunión]\n**Fecha:** ${dateStr}\n**Participantes:** \n\n## 📌 Agenda / Puntos a Tratar\n1. \n2. \n\n## 💬 Discusión y Notas\n- \n\n## ✅ Acuerdos y Próximos Pasos\n- [ ] Responsable: \n`,
    },
    {
      id: 'project',
      name: t('templates.project.name'),
      description: t('templates.project.description'),
      icon: <Briefcase size={18} className="text-emerald-400" />,
      content: `# Proyecto: [Nombre del Proyecto]\n**Estado:** 🟡 En progreso\n**Fecha de inicio:** ${dateStr}\n\n## 🎯 Objetivo General\n\n## 🚩 Hitos y Entregables\n- [ ] Hito 1:\n- [ ] Hito 2:\n\n## 🛠️ Recursos y Enlaces\n- \n`,
    },
    {
      id: 'reading',
      name: t('templates.reading.name'),
      description: t('templates.reading.description'),
      icon: <BookOpen size={18} className="text-purple-400" />,
      content: `# Ficha: [Título del Libro o Artículo]\n**Autor:** \n**Fecha:** ${dateStr}\n**Tags:** #lectura #resumen\n\n## 💡 Resumen en una frase\n\n## 🔑 Ideas Principales\n1. \n2. \n\n## 💬 Citas Destacadas\n> \n\n## 🧠 Conclusión Personal\n`,
    },
  ];

  const selectedTemplate = templates.find((tpl) => tpl.id === selectedId) || templates[0];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--background-modifier-cover)] backdrop-blur-sm animate-fadeIn"
      onClick={onClose}
    >
      <div
        className="w-[620px] max-h-[80vh] flex flex-col bg-obsidian-bg border border-obsidian-border rounded-xl shadow-2xl overflow-hidden select-none"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-obsidian-border bg-obsidian-sidebar">
          <div className="flex items-center gap-2">
            <FileText size={16} className="text-orange-500" />
            <span className="text-sm font-semibold text-obsidian-text">{t('templates.title')}</span>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-obsidian-muted hover:text-obsidian-text rounded hover:bg-[var(--interactive-hover)] transition-colors"
          >
            <X size={15} />
          </button>
        </div>

        {/* Modal Body: Split view (Template list on left, preview on right) */}
        <div className="flex flex-1 min-h-[340px] overflow-hidden">
          {/* Templates List */}
          <div className="w-1/2 border-r border-obsidian-border p-3 overflow-y-auto space-y-1.5">
            {templates.map((tpl) => {
              const isSelected = tpl.id === selectedId;
              return (
                <div
                  key={tpl.id}
                  onClick={() => setSelectedId(tpl.id)}
                  className={`p-2.5 rounded-lg cursor-pointer transition-all border ${
                    isSelected
                      ? 'bg-orange-500/15 border-orange-500 text-white'
                      : 'border-transparent text-obsidian-text hover:bg-[var(--interactive-hover)]'
                  }`}
                >
                  <div className="flex items-center gap-2.5 mb-1">
                    {tpl.icon}
                    <span className="text-xs font-semibold">{tpl.name}</span>
                  </div>
                  <p className="text-[11px] text-obsidian-muted line-clamp-2 leading-relaxed">
                    {tpl.description}
                  </p>
                </div>
              );
            })}
          </div>

          {/* Preview Panel */}
          <div className="w-1/2 p-4 bg-obsidian-sidebar flex flex-col">
            <span className="text-[11px] font-semibold text-obsidian-muted uppercase tracking-wider mb-2">
              {t('templates.preview')}
            </span>
            <div className="flex-1 bg-obsidian-sidebar border border-obsidian-border rounded-md p-3 font-mono text-[11px] text-obsidian-text whitespace-pre-wrap overflow-y-auto select-text">
              {selectedTemplate.content}
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-obsidian-border bg-obsidian-sidebar">
          <span className="text-[11px] text-obsidian-faint">
            {t('templates.escHint')}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-xs text-obsidian-muted hover:text-obsidian-text rounded-md hover:bg-[var(--interactive-hover)] transition-colors"
            >
              {t('common.cancel')}
            </button>
            <button
              onClick={() => {
                onInsert(selectedTemplate.content);
                onClose();
              }}
              className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium bg-orange-600 hover:bg-orange-500 text-white rounded-md transition-colors shadow-sm"
            >
              <Check size={13} />
              <span>{t('templates.insert')}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
