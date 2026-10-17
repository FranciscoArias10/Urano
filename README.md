# 🪐 Urano

Aplicación de notas Markdown de código abierto, **Local-First**, ultraligera (~40-80 MB de RAM), inspirada en Obsidian con **sincronización multidispositivo gratuita en Google Drive** (Google Drive API v3) y **Cero Pérdida de Datos**.

---

## 🚀 Características Principales

1. **Local-First & Privacidad Total:**
   - La fuente de la verdad son los archivos Markdown (`.md`) almacenados en tu disco local.
   - Funciona 100% offline sin dependencias de servicios externos para leer o escribir notas.
   - Permiso estricto de Google Drive: `https://www.googleapis.com/auth/drive.file` (Urano únicamente puede acceder a los archivos y carpetas creados por la aplicación).

2. **Ultra Ligero & Eficiente:**
   - Construido con **Tauri 2.0 (Rust)** y **React + TypeScript + Tailwind CSS**.
   - Evita la sobrecarga de Electron, manteniendo el consumo en un rango de ~40-80 MB de RAM.

3. **Editor Markdown Potente (CodeMirror 6):**
   - El mismo motor modular de Obsidian.
   - Detección y navegación interactiva de enlaces bidireccionales `[[Nombre de Nota]]`.
   - Si haces clic en un enlace a una nota que no existe todavía, Urano la crea automáticamente.
   - Atajo `Ctrl+S` para guardado instantáneo y auto-guardado al cambiar de archivo.

4. **Sincronización Diferencial con Google Drive:**
   - Conexión directa cliente-servidor mediante **OAuth 2.0 PKCE** sin servidores intermediarios.
   - Comparación de hashes `MD5` y estado en base de datos local SQLite (`.urano/sync.db`).
   - Algoritmo de 3 vías con **resolución de conflictos sin pérdida**: si se modifica una nota en dos dispositivos al mismo tiempo, Urano preserva la versión local y descarga la remota como `Nota (Conflicto AAAA-MM-DD).md`.

5. **Vista de Grafo Interactiva:**
   - Visualización por fuerzas (force-directed) renderizada en HTML5 Canvas con `force-graph`.
   - Nodos conectados automáticamente a partir de los enlaces `[[...]]`.
   - Navegación directa al hacer clic sobre cualquier nodo del grafo.

---

## 🛠️ Stack Tecnológico

- **Core Nativo:** Tauri 2.0 (Rust)
  - `tokio`: Concurrencia asíncrona nativa.
  - `reqwest` + `rustls`: Cliente REST para Google Drive API v3.
  - `rusqlite`: Base de datos embebida SQLite para el manifiesto de sincronización.
  - `md-5`: Cálculo ultra-rápido de checksums.
  - `tiny_http`: Micro-servidor efímero para captura local del callback OAuth 2.0 PKCE.
- **Frontend:**
  - React 18 + TypeScript + Vite.
  - CodeMirror 6 (`@codemirror/view`, `@codemirror/state`, `@codemirror/lang-markdown`).
  - Tailwind CSS (Paleta de colores oscura Obsidian).
  - Lucide Icons & Zustand (gestor de estado de ~2 KB).
  - Force-Graph (renderizado fluido en Canvas a 60 FPS).

---

## 📦 Ejecución y Desarrollo

### Requisitos Previos
- Node.js (v18+)
- Rust & Cargo (instalado en el entorno)

### 1. Iniciar en modo desarrollo
```bash
npm run tauri dev
```

### 2. Compilar binario de producción
```bash
npm run tauri build
```
El ejecutable optimizado se generará en `src-tauri/target/release/urano`.

---

## 🔑 Configuración de Google Drive (Paso a Paso)

Urano se conecta de forma directa y segura con tu Google Drive personal:

1. Ve a [Google Cloud Console](https://console.cloud.google.com/).
2. Crea un proyecto (ejemplo: `Urano Notes`).
3. Ve a **APIs y Servicios** > **Biblioteca**, busca **Google Drive API** y haz clic en **Habilitar**.
4. Ve a **Pantalla de consentimiento de OAuth**:
   - Tipo de usuario: **Externo**.
   - Nombre de la app: `Urano`.
   - En **Permisos (Scopes)**, añade: `https://www.googleapis.com/auth/drive.file`.
   - En **Usuarios de prueba**, añade tu propio correo electrónico de Google.
5. Ve a **Credenciales** > **Crear credenciales** > **ID de cliente de OAuth**:
   - Tipo de aplicación: **App de escritorio** (Desktop app).
6. Copia el **ID de cliente** generado.
7. Abre **Urano**, haz clic en el icono de configuración (engranaje) en la esquina superior derecha, pega tu Client ID y pulsa **Guardar y Conectar con Google**.

---

## 📂 Bóveda de Prueba Incluida

El repositorio incluye una bóveda de ejemplo lista para usar en la carpeta `./sample-vault` con notas interconectadas para probar de inmediato los enlaces wikilink y la vista de grafo.
