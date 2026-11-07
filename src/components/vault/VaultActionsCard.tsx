import React from 'react';
import { HelpCircle } from 'lucide-react';
import { LanguageDropdown } from '../settings/LanguageDropdown';
import { useLocaleStore, useT } from '../../stores/localeStore';
import { useSyncStore } from '../../stores/syncStore';

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
  const isAuthenticated = useSyncStore((s) => s.isAuthenticated);
  const isAuthenticating = useSyncStore((s) => s.isAuthenticating);

  return (
    <div className="vault-actions-card w-full max-w-[460px] bg-urano-bg border border-urano-border rounded-[10px] px-5 py-1">
      {/* Row 1: Create new vault */}
      <div className="py-3 flex items-center justify-between gap-4">
        <div className="flex flex-col">
          <span className="text-[13.5px] font-medium text-urano-text">
            {t('vaultManager.options.createVault')}
          </span>
          <span className="text-[12px] text-urano-muted mt-0.5">
            {t('vaultManager.options.createVaultDesc')}
          </span>
        </div>
        <button
          type="button"
          onClick={onCreateClick}
          className="bg-[#e06c1b] hover:brightness-110 text-white font-medium text-[13px] rounded-[5px] h-[32px] px-4 whitespace-nowrap inline-flex items-center justify-center min-w-[86px] transition-all cursor-pointer text-center"
        >
          {t('vaultManager.options.buttonCreate')}
        </button>
      </div>

      {/* Row 2: Open folder as vault */}
      <div className="py-3 border-t border-urano-border flex items-center justify-between gap-4">
        <div className="flex flex-col">
          <span className="text-[13.5px] font-medium text-urano-text">
            {t('vaultManager.options.openFolder')}
          </span>
          <span className="text-[12px] text-urano-muted mt-0.5">
            {t('vaultManager.options.openFolderDesc')}
          </span>
        </div>
        <button
          type="button"
          onClick={onOpenFolderClick}
          className="bg-[var(--interactive-normal)] hover:bg-[var(--interactive-hover)] border border-urano-border text-urano-text hover:text-urano-text font-medium text-[13px] rounded-[5px] h-[32px] px-4 whitespace-nowrap inline-flex items-center justify-center min-w-[86px] transition-colors cursor-pointer text-center"
        >
          {t('vaultManager.options.buttonOpen')}
        </button>
      </div>

      {/* Row 3: Open vault from Urano Sync */}
      <div className="py-3 border-t border-urano-border flex items-center justify-between gap-4">
        <div className="flex flex-col">
          <span className="text-[13.5px] font-medium text-urano-text">
            {t('vaultManager.options.openSync')}
          </span>
          <span className="text-[12px] text-urano-muted mt-0.5">
            {t('vaultManager.options.openSyncDesc')}
          </span>
        </div>
        <button
          type="button"
          onClick={onSyncClick}
          disabled={isAuthenticating}
          className="bg-[var(--interactive-normal)] hover:bg-[var(--interactive-hover)] border border-urano-border text-urano-text hover:text-urano-text font-medium text-[13px] rounded-[5px] h-[32px] px-4 whitespace-nowrap inline-flex items-center justify-center min-w-[86px] transition-colors cursor-pointer text-center"
        >
          {isAuthenticating
            ? t('vaultManager.options.buttonSigningIn')
            : isAuthenticated
            ? t('vaultManager.options.buttonBrowse')
            : t('vaultManager.options.buttonSignIn')}
        </button>
      </div>

      {/* Row 4: Help and Language Selector */}
      <div className="py-3.5 border-t border-urano-border flex items-center gap-3">
        <button
          type="button"
          onClick={onHelpClick}
          className="text-urano-muted hover:text-urano-text p-1 rounded transition-colors cursor-pointer shrink-0"
          title={t('general.help')}
        >
          <HelpCircle size={18} />
        </button>

        <div className="flex-1 relative" style={{ flex: 1, position: 'relative' }}>
          <LanguageDropdown
            value={language}
            languages={languages}
            ariaLabel={t('general.language')}
            direction="up"
            onChange={(code) => void setLanguage(code)}
          />
        </div>
      </div>
    </div>
  );
};
