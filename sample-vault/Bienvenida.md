# 🪐 Bienvenida a Urano

¡Bienvenido a **Urano**! Tu aplicación de notas Markdown **Local-First**, ultraligera y con sincronización directa en tu cuenta personal de **Google Drive**.

---

## ⚡ Principios de Urano
- **Sin servidores intermedios:** La fuente de la verdad son los archivos `.md` en tu disco local.
- **Privacidad estricta:** Urano solo tiene acceso a las notas que crea gracias al scope `drive.file`.
- **Rendimiento extremo:** Creado con Tauri 2.0 y Rust, consumiendo entre ==40 y 80 MB de RAM==.

---

## 📝 Formato y Capacidades de Escritura
Haz **clic derecho** sobre cualquier parte del texto o selecciona una palabra para abrir el **Menú de Formato de Urano**:

- **Resaltado fluorescente:** Puedes destacar ideas clave usando `==texto resaltado==` -> ==ejemplo de texto resaltado en uranio==.
- **Ecuaciones Matemáticas:**
  - En línea: $E = mc^2$ o $\lambda = \frac{h}{p}$
  - En bloque:
  $$
  \int_{-\infty}^{\infty} e^{-x^2} \, dx = \sqrt{\pi}
  $$
- **Bloques de Código:**
```javascript
function sincronizarBoveda(boveda) {
  console.log("Sincronizando con Google Drive (MD5)...");
  return { status: "synced", conflictos: 0 };
}
```
- **Listas de Tareas:**
  - [x] Crear repositorio Urano con Tauri 2.0 y Rust
  - [x] Configurar tipografía estilo Obsidian y menú de formato
  - [ ] Conectar cuenta personal de Google Drive en configuración

---

## 🔗 Explora tus notas conectadas
Urano soporta enlaces bidireccionales automáticos estilo Obsidian:
- Consulta la [[Arquitectura]] del sistema.
- Aprende sobre la [[Sincronizacion Google Drive]] y la resolución de conflictos.
- Descubre los [[Atajos y Trucos]] para escribir más rápido.

Haz clic en cualquiera de los enlaces de arriba para navegar a la nota o abre la **Vista de Grafo** en la barra superior para ver las conexiones en tiempo real.
