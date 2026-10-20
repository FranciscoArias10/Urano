# Resumen de Contexto: Sesión de Desarrollo Urano

Este documento consolida de forma compacta y cronológica todo el trabajo, decisiones técnicas, estado del código y tareas pendientes de la sesión de desarrollo sobre **Urano** (y resoluciones paralelas).

---

## 1. Visión General del Proyecto Urano
- **Stack Técnico**: Tauri (Rust) + React 18 + TypeScript + Vite + TailwindCSS / Vanilla CSS + CodeMirror 6.
- **Identidad**: Cliente local de notas Markdown compatible 1:1 con la experiencia nativa de Obsidian, manteniendo el color de acento oficial naranja de Urano y sincronización híbrida (`StorageAdapter` Local / Google Drive).
- **Ramas Git**: `master` (sincronizada con `origin/master` y `origin/main`).

---

## 2. Hitos y Cambios Realizados en la Sesión

### A. Estabilidad del Vault y Corrección de Crashes
- **Detección**: Ciertas notas con Markdown complejo o wikilinks malformados producían un crash en el renderizador/parser.
- **Solución**: Robustecimiento de la tokenización de wikilinks y Live Preview en CodeMirror 6 para manejar índices fuera de rango y caracteres especiales de forma segura.

### B. Live Preview: Ocultamiento de Delimitadores Markdown
- **Problema**: Los delimitadores (`**`, `*`, `~~`, `` ` ``, `==`) permanecían visibles siempre.
- **Solución**: En el `ViewPlugin` de Live Preview de CodeMirror 6, cuando el cursor **no** está sobre la línea (`!isCursorOnLine`), los delimitadores de apertura y cierre se ocultan mediante `Decoration.replace({})` y el contenido interno se estiliza con `Decoration.mark(...)`. Al posicionar el cursor sobre la línea, los delimitadores reaparecen para permitir la edición Markdown directa.

### C. Sistema de Resaltado (Highlight) Nativo y Ecuaciones KaTeX
- **Eliminación de HTML Sucio**: Se retiró por completo la inserción de `<mark class="...">`.
- **Sintaxis de 7 Colores con Indicador**:
  - `Default`: `==texto==`
  - Colores: `==🔴texto==`, `==🟠texto==`, `==🟡texto==`, `==🟢texto==`, `==🔵texto==`, `==🟣texto==`.
- **Regex & Live Preview**: Detección sin conflicto con ecuaciones KaTeX (`$$...$$`). Al no estar el cursor en la línea, se ocultan los signos `==` y el emoji indicador, aplicando la clase CSS de color correspondiente (`.cm-highlight-red`, etc.).

### D. Reestructuración 1:1 del Menú Contextual (Clic Derecho)
Se implementó la arquitectura nativa de 3 bloques compactos (`min-width: 185px`, `padding: 6px`, sin atajos de teclado a la derecha):

1. **Bloque 1 (Enlaces y Selección Dinámica)**:
   - `Añadir enlace` (`Link`): Transforma texto a `[[texto]]` o inserta `[[]]` abriendo el popup de notas del Vault.
   - `Añadir enlace externo` (`ExternalLink`): Transforma texto a `[texto](url)` dejando seleccionado `url` o inserta `[](url)`.
   - *Dinámico si hay selección*: `Buscar "<texto>"` (`Search`, activa búsqueda global del Vault) y `Extraer selección actual...` (`FolderInput`, crea nota y enlaza).
2. **Bloque 2 (Submenús Centrales)**:
   - `Formato` (`Paintbrush`): Negrita, Cursiva, Tachado, Resaltado (7 colores), Código, Matemáticas, Comentario y `Borrar formato` (`Eraser`).
   - `Párrafo` (`Pilcrow` `¶`): Texto normal (limpia prefijos `#`, `-`, `>`, etc.), Encabezados 1 a 6 (`# ` a `###### `), separador, Listas (viñetas `- `, numerada `1. `, tareas `- [ ] `) y Cita (`> `).
   - `Insertar` (`ListPlus`): Tabla, Callout, Bloque de código, Bloque matemático, Línea horizontal, Plantilla.
3. **Bloque 3 (Portapapeles con Estados Deshabilitados)**:
   - `Cortar` (`Scissors`): Deshabilitado (`opacity: 0.38`, `pointer-events: none`) si no hay selección.
   - `Copiar` (`Copy`): Deshabilitado si no hay selección.
   - `Pegar` (`ClipboardCheck`).
   - `Pegar sin formato` (`ClipboardType`).
   - `Seleccionar todo` (`SquareDashed`).
4. **Comportamiento Visual de Submenús**:
   - Detección de bordes de pantalla (`opensLeft`) para que los submenús se abran a la izquierda si tocan el margen derecho de la ventana.

### E. Documentación y Repositorio
- Actualización completa del `README.md` a inglés con la descripción del proyecto, arquitectura y stack.
- Commits limpios y sincronización `git push origin master` y `git push --force origin master:main`.

---

## 3. Implementación Completada: Submenú `Insert` (`Insertar`) 1:1 con Obsidian
Se actualizó **únicamente** el submenú de `Insertar` en [Editor.tsx](file:///home/fkhalil/Desktop/Proyectos/Urano/src/components/editor/Editor.tsx) manteniendo intacto el resto del menú contextual. Se implementaron las 7 opciones exactas divididas en 2 secciones con `.menu-separator`, sus iconos de Lucide correspondientes y el comportamiento 1:1 nativo en CodeMirror 6:

### Sección Superior (4 opciones)
1. **`Footnote` / `Nota al pie`** (`FilePen`):
   - Calcula el índice más alto disponible `n` (`[^n]`) en el documento y usa `n + 1` (iniciando en `1`).
   - Inserta `[^n]` en la posición actual del cursor (o tras la selección).
   - Añade al final del documento `[^n]: ` y traslada el cursor inmediatamente tras los dos puntos con `scrollIntoView: true`.
   - En Live Preview ([liveMarkdown.ts](file:///home/fkhalil/Desktop/Proyectos/Urano/src/editor/liveMarkdown.ts)): cuando el cursor no está encima, se reemplaza por `<sup class="cm-footnote-ref">[n]</sup>` clicable con salto directo a la definición.
2. **`Table` / `Tabla`** (`Table`):
   - Inserta la tabla 2x2 markdown limpia y enfoca automáticamente la celda `(0, 0)`.
3. **`Callout`** (`Quote`):
   - Inserta `\n> [!NOTE] Título\n> Contenido\n` (o envuelve el texto seleccionado) y deja seleccionada la palabra `Título` para edición inmediata.
   - Live Preview renderiza la tarjeta visual Obsidian con icono y fondo tintado suave; al hacer clic, abre el modo edición directa.
4. **`Horizontal rule` / `Línea horizontal`** (`Minus`):
   - Inserta `\n---\n\n`.
   - Live Preview reemplaza la línea por `<hr class="cm-hr">` de extremo a extremo cuando el cursor no está en ella. Al hacer clic o posicionar el cursor sobre la línea, reaparecen los caracteres `---`.

### Separador (`.menu-separator` de 1px solid #2e2e2e)

### Sección Inferior (3 opciones)
5. **`Code block` / `Bloque de código`** (`Code`):
   - Inserta ```` ```\n\n``` ```` con el cursor situado en la línea interior y botón flotante de copiado.
6. **`Math block` / `Bloque matemático`** (`SquareSigma`):
   - Inserta `$$\n\n$$` con el cursor en la línea interior, render KaTeX reactivo y botón `</>`.
7. **`New base` / `Nueva base`** (`TableProperties`):
   - Crea un archivo `.base` en el Vault (`Sin título.base`, `Sin título 1.base`, etc.) vía `createBaseFile` en [vaultStore.ts](file:///home/fkhalil/Desktop/Proyectos/Urano/src/stores/vaultStore.ts) e inserta `![[Sin título.base]]` en la posición del cursor.
   - En Live Preview ([wikilinks.ts](file:///home/fkhalil/Desktop/Proyectos/Urano/src/editor/wikilinks.ts)), cuando el cursor no está en la línea, renderiza una tarjeta interactiva incrustada que al hacer clic abre la vista tabular dinámica `BaseView` de Urano indexando las notas del Vault.

---

8. **Tablas Markdown en Live Preview ([tableExtension.tsx](file:///home/fkhalil/Desktop/Proyectos/Urano/src/editor/tableExtension.tsx))**:
   - Reemplazo y reconciliación de widgets de tabla sin pérdida de foco ni cursor al escribir dentro de celdas (`eq` preserva el DOM cuando el número de filas y columnas no cambia).
   - Inserción y eliminación de filas y columnas tanto desde el menú contextual (`urano-table-contextmenu`) como desde los botones `+` (`urano-table-col-btn` a la derecha y `urano-table-row-btn` abajo).
   - Reconstrucción limpia de la tabla y autoenfoque (`pendingTableFocus`) en la nueva celda al agregar filas o columnas.

---

## 4. Formato en Línea sin Selección Previa ("Sin Sombrear")
- **Regla Estricta del Proyecto**: Al aplicar cualquier formato (Negrita `**`, Cursiva `*`, Tachado `~~`, Código `` ` ``, Matemáticas `$`, Comentario `%%`, Resaltado `==` o Borrar formato) sin tener texto sombreado/seleccionado (`selection.empty`), la acción **nunca** debe insertar delimitadores vacíos desconectados (como `****`, `**texto**`, `==texto==`) si existe texto o una palabra detrás o debajo del cursor.
- **Comportamiento Implementado**:
  1. Si el cursor se ubica sobre o inmediatamente detrás de una palabra (ej: `suu|`, `s|uu`, o tras espacios `suu |`), el editor detecta automáticamente dicha palabra previa (`[\p{L}\p{N}_]+\s*$`) y le aplica el formato (`**suu**`, `*suu*`, `==🔴suu==`, etc.).
  2. Si la palabra objetivo ya posee dicho formato, se desenvuelve (toggle off).
  3. Si la selección está vacía sobre o tras un token formateado y se invoca "Borrar formato", se limpian los delimitadores de esa palabra/token.
  4. Únicamente si el cursor se encuentra en una línea vacía o sin ninguna palabra/texto previo en la línea activa, se inserta el par de delimitadores con el cursor en el centro para iniciar la escritura con formato.
- **Archivos Clave**:
  - [Editor.tsx](file:///home/fkhalil/Desktop/Proyectos/Urano/src/components/editor/Editor.tsx): `toggleInlineFormatting`, `applyHighlight`, `handleClearFormatting`.
  - [EditorFormattingMenu.tsx](file:///home/fkhalil/Desktop/Proyectos/Urano/src/components/editor/EditorFormattingMenu.tsx): `applyInlineWrap`.

