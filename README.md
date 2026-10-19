# 🪐 Urano

<p align="center">
  <strong>A high-performance, local-first knowledge base & note-taking application inspired by Obsidian.</strong><br>
  Built with <strong>Tauri 2.0 (Rust)</strong> and <strong>CodeMirror 6</strong> with zero-lock-in plaintext Markdown, infinite canvas, structured bases, and direct Google Drive cloud sync.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Platform-Linux%20%7C%20Windows%20%7C%20macOS-blue?style=flat-square" alt="Platform" />
  <img src="https://img.shields.io/badge/Engine-Tauri%202.0%20(Rust)-orange?style=flat-square" alt="Tauri 2" />
  <img src="https://img.shields.io/badge/Editor-CodeMirror%206-green?style=flat-square" alt="CodeMirror 6" />
  <img src="https://img.shields.io/badge/RAM%20Usage-~40--80%20MB-success?style=flat-square" alt="RAM" />
  <img src="https://img.shields.io/badge/License-MIT-yellow?style=flat-square" alt="License" />
</p>

---

## 🌟 Why Urano?

Most modern knowledge management tools either force your thoughts into proprietary cloud databases or wrap web technologies in bloated Electron containers that consume hundreds of megabytes of RAM before writing a single word.

**Urano** delivers the gold standard Obsidian-like user experience with native desktop efficiency:
- **Ultra-lightweight:** Consumes only **~40–80 MB of RAM**, keeping your computer fast, cool, and responsive.
- **True Local-First:** Your notes belong to you. Every file is stored locally as human-readable standard Markdown (`.md`), Infinite Canvas (`.canvas`), or Structured Databases (`.base`).
- **Free Multi-Device Sync:** Built-in direct Google Drive synchronization with zero third-party intermediaries, MD5 differential checksums, and non-destructive conflict handling.
- **Signature Aesthetics:** Polished Obsidian dark neutral interface (`#1e1e1e`) complemented by Urano's signature vibrant atomic-orange accent (`#e06c1b`).

---

## 🚀 Key Features

### 📝 1:1 Live Preview Editor (CodeMirror 6)
Powered by the same modular next-generation editor architecture as Obsidian:
- **Visual Table Editor:** Insert clean 2x2 tables without raw pipe characters cluttering the document. Interactive contextual menu for adding/removing rows & columns, adjusting column alignments (left, center, right), and full keyboard navigation (`Tab`, `Shift+Tab`, `Enter`).
- **Interactive Callouts:** Native support for `> [!NOTE]`, `> [!TIP]`, `> [!WARNING]`, `> [!BUG]`, `> [!DANGER]`, and more with curated icons and styling.
- **LaTeX Math Formulas:** Instant KaTeX rendering for both inline `$E = mc^2$` and multiline equation blocks `$$\n...\n$$`. Cursor-aware transitions let you edit raw LaTeX fluidly upon focus.
- **Enhanced Code Blocks:** Syntax highlighting across dozens of languages, language indicator header, and one-click copy button with cursor-aware fence hiding.
- **Smart Formatting:** Bold (`Ctrl+B`), Italic (`Ctrl+I`), Strikethrough (`Ctrl+Shift+X`), Highlights (`==highlight==`), Comments (`%%comment%%`), and Inline Code with instant toggle shortcuts.

### 🔗 Wikilinks & Second Brain Connections
- **Bi-directional Links:** Type `[[` for instant note autocompletion.
- **Promptless Note Creation:** Clicking an unresolved link automatically creates the new note and focuses the editor without disruptive dialog popups.
- **Backlinks Explorer:** Discover all incoming and outgoing mentions of the current note across your entire vault.

### 🌐 60 FPS Interactive Graph View
- Force-directed physics simulation rendered on HTML5 Canvas.
- Visually navigate your web of knowledge and jump directly to any document by clicking its node.

### 🎨 Infinite Canvas & Structured Bases
- **Visual Canvas (`.canvas`):** Infinite 2D workspace to arrange cards, connect notes with arrows, and create visual concept maps.
- **Databases & Bases (`.base`):** Structured table view for tasks, properties, tags, and status tracking.

### 🔄 Differential Google Drive Cloud Sync (Zero Data Loss)
- **Direct Client-to-Cloud:** Connects directly from your machine to Google Drive API v3 via **OAuth 2.0 PKCE**—no intermediate servers, subscriptions, or telemetry.
- **Strict Privacy Scope:** Uses `https://www.googleapis.com/auth/drive.file`. Urano can *only* access files and folders created by the app itself.
- **3-Way Differential Sync:** Tracks MD5 file hashes in a local SQLite database (`.urano/sync.db`).
- **Conflict Prevention:** Never overwrites work silently. In case of simultaneous edits across devices, Urano keeps your local file intact and preserves the remote version as `Note (Conflict YYYY-MM-DD).md`.

### 🎛️ Complete Obsidian-Crafted Workspace
- **Left Ribbon:** Quick Switcher, Daily Notes, Graph View, Canvas, Bases, Templates, and Settings.
- **Dock Header:** Left sidebar toggle, Vault Explorer, Global Search, and Bookmarks panel.
- **Explorer Toolbar:** Sort files (A-Z, Z-A, Newest, Oldest), expand/collapse all folders, and create new notes or folders with one click.
- **Tabs & Breadcrumbs:** Multi-tab browsing, navigation history, breadcrumb navigation, reading/editing mode toggle, and automatic silent background saves.

---

## 🛠️ Technology Stack

| Layer | Technologies |
| :--- | :--- |
| **Native Core** | **Tauri 2.0 (Rust 2021)**, `tokio` (async runtime), `rusqlite` (local SQLite manifest), `reqwest` + `rustls` (HTTPS REST client), `tiny_http` (OAuth local callback), `md-5` |
| **Frontend UI** | **React 18**, **TypeScript**, **Vite**, **Tailwind CSS** |
| **Editor** | **CodeMirror 6** (`@codemirror/view`, `@codemirror/state`, `@codemirror/lang-markdown`, `@codemirror/language-data`) |
| **Mathematics** | **KaTeX** with CodeMirror 6 `StateField` multiline decoration engine |
| **Visualizations** | **Force-Graph** (HTML5 Canvas physics engine) |
| **State & Icons** | **Zustand** (lightweight state store), **Lucide React** |

---

## 📋 Keyboard Shortcuts

| Shortcut | Action |
| :--- | :--- |
| <kbd>Ctrl</kbd> + <kbd>P</kbd> / <kbd>Cmd</kbd> + <kbd>P</kbd> | Open Command Palette |
| <kbd>Ctrl</kbd> + <kbd>S</kbd> / <kbd>Cmd</kbd> + <kbd>S</kbd> | Save Current Document (Auto-save is also active) |
| <kbd>Ctrl</kbd> + <kbd>B</kbd> / <kbd>Cmd</kbd> + <kbd>B</kbd> | Toggle Bold |
| <kbd>Ctrl</kbd> + <kbd>I</kbd> / <kbd>Cmd</kbd> + <kbd>I</kbd> | Toggle Italic |
| <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>X</kbd> | Toggle Strikethrough |
| <kbd>Tab</kbd> / <kbd>Shift</kbd> + <kbd>Tab</kbd> | Navigate Table Cells / Indent |
| <kbd>Enter</kbd> | Insert Table Row (in table cell) |
| <kbd>Right Click</kbd> | Open Obsidian Context Menu (formatting, tables, callouts, code blocks) |

---

## 🚀 Getting Started

### Prerequisites
- **Node.js**: v18.0.0 or later
- **Rust & Cargo**: Latest stable toolchain ([Install Rust](https://rustup.rs/))
- System dependencies for Tauri on Linux (e.g. `webkit2gtk-4.1` on Arch/Debian/Fedora).

### 1. Clone the repository
```bash
git clone https://github.com/FranciscoArias10/Urano.git
cd Urano
```

### 2. Install dependencies
```bash
npm install
```

### 3. Run in Development Mode
```bash
npm run tauri dev
```

### 4. Build Production Executable
```bash
npm run tauri build
```
The optimized native executable will be located in:
- **Linux:** `src-tauri/target/release/urano` (or `.deb` / `.AppImage` in `src-tauri/target/release/bundle/`)
- **Windows:** `src-tauri/target/release/urano.exe` (or `.msi` in `src-tauri/target/release/bundle/`)
- **macOS:** `src-tauri/target/release/bundle/macos/Urano.app`

---

## 🔑 Google Drive Sync Setup (Step-by-Step)

Urano connects securely to your personal Google Drive account using OAuth 2.0 PKCE:

1. Visit the [Google Cloud Console](https://console.cloud.google.com/).
2. Create a new project (e.g., `Urano Notes`).
3. Navigate to **APIs & Services** > **Library**, search for **Google Drive API**, and click **Enable**.
4. Go to **APIs & Services** > **OAuth consent screen**:
   - User Type: **External**.
   - App Name: `Urano`.
   - Under **Scopes**, click **Add or Remove Scopes** and add:
     ```text
     https://www.googleapis.com/auth/drive.file
     ```
   - Under **Test Users**, add your personal Google account email address.
5. Go to **APIs & Services** > **Credentials** > **Create Credentials** > **OAuth client ID**:
   - Application Type: **Desktop app**.
   - Name: `Urano Desktop`.
6. Copy the generated **Client ID**.
7. In **Urano**, click the **Settings** gear icon in the Left Ribbon or top right, paste your **Client ID**, and click **Save and Connect with Google**.
8. Authenticate once in your browser. All synchronization runs silently and automatically in the background.

---

## 📂 Included Sample Vault

A ready-to-use sample vault is provided in `./sample-vault` with interconnected notes, LaTeX math formulas, callout examples, and wikilinks to immediately test graph visualization and live editing.

---

## 📄 License

This project is open-source and available under the [MIT License](LICENSE).
