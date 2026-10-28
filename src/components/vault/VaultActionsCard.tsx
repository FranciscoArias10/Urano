import React from 'react';
import { HelpCircle } from 'lucide-react';
import { LanguageDropdown } from '../settings/LanguageDropdown';
import { useLocaleStore, useT } from '../../stores/localeStore';

export interface VaultActionsCardProps {
  onCreateClick: () => void;
  onOpenFolderClick: () => void;
  onSyncClick: () => void;
  onHelpClick?: () => void;
}

export const VaultActionsCard: React.FC<VaultActionsCardProps> = ({
  onCreateClick,
  onOpenFolderClick,
  onSyncClick,
  onHelpClick,
}) => {
  const t = useT();
  const { language, languages, setLanguage } = useLocaleStore();

  return (
    <div className="w-full max-w-[460px] bg-[#1e1e1e] border border-[#2a2a2a] rounded-[10px] px-5 py-1">
      {/* Row 1: Create new vault */}
      <div className="py-3 flex items-center justify-between gap-4">
        <div className="flex flex-col">
          <span className="text-[13.5px] font-medium text-[#e0e0e0]">
            {t('vaultManager.options.createVault')}
          </span>
          <span className="text-[12px] text-[#888888] mt-0.5">
            {t('vaultManager.options.createVaultDesc')}
          </span>
        </div>
        <button
          type="button"
          onClick={onCreateClick}
          className="bg-[#e06c1b] hover:brightness-110 text-white font-medium text-[13px] rounded-[5px] px-5 py-1.5 min-w-[86px] transition-all cursor-pointer text-center"
        >
          {t('vaultManager.options.buttonCreate')}
        </button>
      </div>

      {/* Row 2: Open folder as vault */}
      <div className="py-3 border-t border-[#2a2a2a] flex items-center justify-between gap-4">
        <div className="flex flex-col">
          <span className="text-[13.5px] font-medium text-[#e0e0e0]">
            {t('vaultManager.options.openFolder')}
          </span>
          <span className="text-[12px] text-[#888888] mt-0.5">
            {t('vaultManager.options.openFolderDesc')}
          </span>
        </div>
        <button
          type="button"
          onClick={onOpenFolderClick}
          className="bg-[#2c2c2c] hover:bg-[#353535] border border-[#3a3a3a] text-[#dcddde] hover:text-white font-medium text-[13px] rounded-[5px] px-5 py-1.5 min-w-[86px] transition-colors cursor-pointer text-center"
        >
          {t('vaultManager.options.buttonOpen')}
        </button>
      </div>

      {/* Row 3: Open vault from Urano Sync */}
      <div className="py-3 border-t border-[#2a2a2a] flex items-center justify-between gap-4">
        <div className="flex flex-col">
          <span className="text-[13.5px] font-medium text-[#e0e0e0]">
            {t('vaultManager.options.openSync')}
          </span>
          <span className="text-[12px] text-[#888888] mt-0.5">
            {t('vaultManager.options.openSyncDesc')}
          </span>
        </div>
        <button
          type="button"
          onClick={onSyncClick}
          className="bg-[#2c2c2c] hover:bg-[#353535] border border-[#3a3a3a] text-[#dcddde] hover:text-white font-medium text-[13px] rounded-[5px] px-5 py-1.5 min-w-[86px] transition-colors cursor-pointer text-center"
        >
          {t('vaultManager.options.buttonSignIn')}
        </button>
      </div>

      {/* Row 4: Help and Language Selector */}
      <div className="py-3.5 border-t border-[#2a2a2a] flex items-center gap-3">
        <button
          type="button"
          onClick={onHelpClick}
          className="text-[#888888] hover:text-white p-1 rounded transition-colors cursor-pointer"
          title={t('general.help')}
        >
          <HelpCircle size={18} />
        </button>

        <div className="flex-1">
          <LanguageDropdown
            value={language}
            languages={languages}
            ariaLabel={t('general.language')}
            onChange={(code) => void setLanguage(code)}
          />
        </div>
      </div>
    </div>
  );
};
