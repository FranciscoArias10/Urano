import React, { useState } from 'react';
import { useSyncStore } from '../../stores/syncStore';
import { X, Key, FolderSync, ShieldCheck, ExternalLink, HelpCircle } from 'lucide-react';

export const SyncConfigModal: React.FC = () => {
  const {
    showConfigModal,
    setShowConfigModal,
    clientId,
    clientSecret,
    folderName,
    setCredentials,
    loginWithGoogle,
    isAuthenticated,
    user,
    logout,
  } = useSyncStore();

  const [localClientId, setLocalClientId] = useState(clientId);
  const [localClientSecret, setLocalClientSecret] = useState(clientSecret);
  const [localFolderName, setLocalFolderName] = useState(folderName);
  const [showHelp, setShowHelp] = useState(false);

  if (!showConfigModal) return null;

  const handleSaveAndLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setCredentials(localClientId.trim(), localClientSecret.trim(), localFolderName.trim());
    setShowConfigModal(false);
    if (!isAuthenticated) {
      await loginWithGoogle();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-obsidian-sidebar border border-obsidian-border rounded-xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-obsidian-border bg-obsidian-bg/50">
          <div className="flex items-center gap-2">
            <FolderSync className="w-5 h-5 text-orange-400" />
            <h2 className="text-base font-semibold text-white">Configuración de Google Drive</h2>
          </div>
          <button
            onClick={() => setShowConfigModal(false)}
            className="text-obsidian-muted hover:text-white p-1 rounded-md transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <form onSubmit={handleSaveAndLogin} className="p-6 space-y-4 text-xs">
          {isAuthenticated && user ? (
            <div className="flex items-center justify-between p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-lg">
              <div className="flex items-center gap-3">
                {user.picture ? (
                  <img src={user.picture} alt={user.name} className="w-8 h-8 rounded-full border border-emerald-500/50" />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-emerald-600/30 text-emerald-300 flex items-center justify-center font-bold">
                    {user.name.charAt(0)}
                  </div>
                )}
                <div>
                  <div className="text-white font-medium">{user.name}</div>
                  <div className="text-emerald-400 text-[11px]">{user.email}</div>
                </div>
              </div>
              <button
                type="button"
                onClick={logout}
                className="text-red-400 hover:text-red-300 hover:bg-red-500/10 px-2.5 py-1 rounded transition-colors"
              >
                Cerrar sesión
              </button>
            </div>
          ) : (
            <div className="p-3 bg-orange-500/10 border border-orange-500/20 rounded-lg text-obsidian-text flex items-start gap-2.5">
              <ShieldCheck className="w-5 h-5 text-orange-400 shrink-0 mt-0.5" />
              <div>
                <span className="font-medium text-white">Privacidad 100% Garantizada:</span>
                <p className="text-[11px] text-obsidian-muted mt-0.5">
                  Urano utiliza exclusivamente el permiso <code className="text-orange-300 bg-orange-950/40 px-1 py-0.5 rounded">drive.file</code>. La aplicación solo tiene acceso a las notas y carpetas que ella misma crea en tu cuenta personal de Google Drive.
                </p>
              </div>
            </div>
          )}

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-obsidian-text font-medium flex items-center gap-1.5">
                <Key className="w-3.5 h-3.5 text-orange-400" />
                Google Client ID (OAuth 2.0)
              </label>
              <button
                type="button"
                onClick={() => setShowHelp(!showHelp)}
                className="text-orange-400 hover:text-orange-300 flex items-center gap-1 text-[11px]"
              >
                <HelpCircle className="w-3 h-3" />
                ¿Cómo obtenerlo?
              </button>
            </div>
            <input
              type="text"
              placeholder="ej: 123456789-xxxxxx.apps.googleusercontent.com"
              value={localClientId}
              onChange={(e) => setLocalClientId(e.target.value)}
              required
              className="w-full bg-obsidian-bg border border-obsidian-border focus:border-orange-500 rounded-lg px-3 py-2 text-white outline-none font-mono text-[11px]"
            />
          </div>

          <div>
            <label className="text-obsidian-text font-medium block mb-1.5">
              Client Secret (Opcional si usas cliente de escritorio PKCE)
            </label>
            <input
              type="password"
              placeholder="GOCSPX-xxxxxxxxxxxxxxxx"
              value={localClientSecret}
              onChange={(e) => setLocalClientSecret(e.target.value)}
              className="w-full bg-obsidian-bg border border-obsidian-border focus:border-orange-500 rounded-lg px-3 py-2 text-white outline-none font-mono text-[11px]"
            />
          </div>

          <div>
            <label className="text-obsidian-text font-medium block mb-1.5">
              Nombre de la carpeta remota en Google Drive
            </label>
            <input
              type="text"
              placeholder="UranoVault"
              value={localFolderName}
              onChange={(e) => setLocalFolderName(e.target.value)}
              className="w-full bg-obsidian-bg border border-obsidian-border focus:border-orange-500 rounded-lg px-3 py-2 text-white outline-none text-xs"
            />
          </div>

          {/* Quick instructions dropdown */}
          {showHelp && (
            <div className="p-3 bg-obsidian-active rounded-lg border border-obsidian-border text-[11px] text-obsidian-muted space-y-1.5">
              <div className="font-semibold text-white flex items-center gap-1">
                <span>Pasos en Google Cloud Console:</span>
                <a
                  href="https://console.cloud.google.com/apis/credentials"
                  target="_blank"
                  rel="noreferrer"
                  className="text-orange-400 hover:underline flex items-center gap-0.5 ml-1"
                >
                  Abrir consola <ExternalLink className="w-2.5 h-2.5" />
                </a>
              </div>
              <ol className="list-decimal list-inside space-y-0.5">
                <li>Crea un proyecto (ej: "Urano Notes").</li>
                <li>Habilita la <strong>Google Drive API</strong> en Biblioteca de APIs.</li>
                <li>En Pantalla de consentimiento OAuth, selecciona "Externo" y añade el scope <code>drive.file</code>.</li>
                <li>En Credenciales, crea un <strong>ID de cliente de OAuth</strong> de tipo <em>App de escritorio</em>.</li>
                <li>Copia el Client ID resultante aquí. ¡Listo!</li>
              </ol>
            </div>
          )}

          {/* Actions */}
          <div className="pt-2 flex items-center justify-end gap-2 border-t border-obsidian-border">
            <button
              type="button"
              onClick={() => setShowConfigModal(false)}
              className="px-4 py-2 rounded-lg text-obsidian-muted hover:text-white hover:bg-obsidian-hover transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="px-4 py-2 rounded-lg bg-orange-600 hover:bg-orange-500 text-white font-medium transition-colors shadow-lg shadow-orange-600/20"
            >
              {isAuthenticated ? 'Guardar Cambios' : 'Guardar y Conectar con Google'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
