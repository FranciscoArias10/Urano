# ☁️ Sincronización con Google Drive

Urano utiliza la **Google Drive API v3** con autenticación directa del cliente mediante **OAuth 2.0 PKCE**:

1. **Autenticación sin backend:** El flujo se realiza directamente entre tu máquina y Google.
2. **Algoritmo diferencial:** Se calculan hashes `MD5` y se comparan contra `md5Checksum` de Google Drive.
3. **Cero pérdida de datos:** Si modificas la misma nota en dos dispositivos a la vez, Urano conserva tu versión local y crea una rama de conflicto: `Nota (Conflicto AAAA-MM-DD).md`.

Ver también la [[Arquitectura]] y los [[Atajos y Trucos]].
