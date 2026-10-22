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

---

## 5. Módulo Canvas 1:1 con Obsidian (Formato JSON Canvas 1.0)
Se realizó ingeniería inversa completa de la implementación oficial de Obsidian (`obsidian.asar`) para replicar de manera idéntica su diseño, arquitectura y matemáticas, adaptando el color de acento al naranja oficial de Urano (`#e06c1b`) y guardando mediante el `StorageAdapter` (Local y Google Drive).

### A. Especificaciones Técnicas y Matemáticas Extraídas de Obsidian
1. **Esquema JSON Canvas 1.0**:
   - `nodes`: `[{ id, type: "text" | "file" | "link" | "group", x, y, width, height, color?, text?, file?, url?, label? }]`.
   - `edges`: `[{ id, fromNode, fromSide, toNode, toSide, color?, label?, fromEnd?, toEnd? }]`.
   - Dimensiones predeterminadas: texto (`250x60` px), nota/archivo (`400x400` px), enlace (`400x400` px), grupo (`400x300` px), dimensión mínima (`50px`).
2. **Matemáticas de Conexiones Bézier Cúbicas SVG**:
   - `dist = hypot(to.x - from.x, to.y - from.y)`.
   - `offset = clamp(dist / 2, 70, 150)`.
   - Puntos de control proyectados con vector normal de salida según lado (`top`, `bottom`, `left`, `right`).
   - Holgura de borde (`clearance`) de 7px desde el bounding box del nodo.
   - Rotación y ubicación exacta de la flecha con `marker-end="url(#canvas-arrow)"`.
   - Selección automática de lado (`autoSide`) calculando distancias mínimas cuando no se especifica.
3. **Paleta de 6 Colores Oficiales de Obsidian + Default**:
   - 1: Rojo (`#e93147`)
   - 2: Naranja (`#ec7500`)
   - 3: Amarillo (`#e0ac00`)
   - 4: Verde (`#08b94e`)
   - 5: Cian (`#00bfbc`)
   - 6: Púrpura (`#7852ee`)
   - Sin color: Borde neutro (`#383838`), fondo (`#1c1c1c` o transparente en grupos).

### B. Componentes Implementados en Urano
1. [canvasMath.ts](file:///home/fkhalil/Desktop/Proyectos/Urano/src/components/canvas/canvasMath.ts): Bounding boxes, curvas Bézier, autoSide, conversiones pantalla-mundo y colores.
2. [canvasStyles.css](file:///home/fkhalil/Desktop/Proyectos/Urano/src/components/canvas/canvasStyles.css): Hoja de estilos extraída de Obsidian adaptada con variables CSS y acento naranja `#e06c1b`.
3. [CanvasControls.tsx](file:///home/fkhalil/Desktop/Proyectos/Urano/src/components/canvas/CanvasControls.tsx): Controles superiores derechos (Zoom in `+`, Zoom out `-`, `100%`, `Zoom to fit`, Candado de solo lectura).
4. [CanvasCardMenu.tsx](file:///home/fkhalil/Desktop/Proyectos/Urano/src/components/canvas/CanvasCardMenu.tsx): Píldora inferior flotante central con 3 botones arrastrables y clicables (Tarjeta de texto, Nota del Vault, Enlace externo/media).
5. [VaultFileModal.tsx](file:///home/fkhalil/Desktop/Proyectos/Urano/src/components/canvas/VaultFileModal.tsx): Modal de selección y búsqueda instantánea de notas `.md` del Vault.
6. [CanvasFloatingMenu.tsx](file:///home/fkhalil/Desktop/Proyectos/Urano/src/components/canvas/CanvasFloatingMenu.tsx): Barra de herramientas contextual sobre tarjetas o flechas seleccionadas (Eliminar, Paleta de 6 colores, Editar, Convertir a archivo `.md`, Invertir/Alternar flecha, Etiqueta).
7. [CanvasNodeView.tsx](file:///home/fkhalil/Desktop/Proyectos/Urano/src/components/canvas/CanvasNodeView.tsx): Renderizado interactivo de nodos `text`, `file`, `link` y `group`, con Live Markdown, checkboxes de tareas interactivos, 8 tiradores de redimensionamiento y 4 puertos de conexión en hover.
8. [CanvasEdgeView.tsx](file:///home/fkhalil/Desktop/Proyectos/Urano/src/components/canvas/CanvasEdgeView.tsx): Renderizado SVG de conexiones con curvas Bézier, etiquetas centrales y selección resaltada en naranja.
9. [CanvasView.tsx](file:///home/fkhalil/Desktop/Proyectos/Urano/src/components/canvas/CanvasView.tsx): Lienzo infinito interactivo con cuadrícula de puntos dinámica, arrastre (pan con botón central, espacio o rueda), zoom de 0.15x a 3x enfocado hacia el cursor, cuadro de selección múltiple, arrastre de grupos que desplaza a sus nodos contenidos, y debounce de autoguardado a disco vía `StorageAdapter`.
10. [FileTree.tsx](file:///home/fkhalil/Desktop/Proyectos/Urano/src/components/vault/FileTree.tsx): Etiqueta `.nav-file-tag` (`CANVAS`), menú contextual en carpetas y en espacio vacío ("Nuevo lienzo").
---

## 6. Subsistema de Imágenes y Archivos Adjuntos 1:1 con Obsidian
Se realizó ingeniería inversa completa de la implementación oficial de Obsidian (`obsidian.asar`) para replicar de manera idéntica su manejo de imágenes (`.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.svg`, `.avif`, `.bmp`), conservando el color de acento naranja de Urano (`#e06c1b`) y soporte binario en `StorageAdapter` (Local y Google Drive).

### A. Especificaciones Técnicas Extraídas de Obsidian
1. **Nomenclatura de Capturas y Pegado**:
   - `"Pasted image " + moment().format("YYYYMMDDHHmmss") + "." + ext` (ej. `Pasted image 20261020084512.png`).
2. **Parser de Dimensiones y Tubería (`|`)**:
   - Expresión regular: `/^\s*([0-9]+)\s*(?:x\s*([0-9]+)\s*)?$/`.
   - Soporte para `![[imagen.png|300]]` (ancho 300px, alto auto), `![[imagen.png|300x200]]` (ancho 300px, alto 200px con `object-fit: cover`), `![[imagen.png|Texto alternativo|300]]` y Markdown estándar `![texto|300](url)`.
3. **Estructura DOM y CSS**:
   - Contenedor `.image-embed` con `.image-wrapper`, imagen `<img src="...">` y tirador de redimensionamiento `.image-resize-corner`.
   - Pseudoelemento `.image-resize-corner::after` con acento naranja `#e06c1b`, cursor `nwse-resize` y borde sutil.
4. **Copia al Portapapeles (Clipboard API)**:
   - Uso de Canvas Offscreen para exportar cualquier formato como `image/png` y llamar a `navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])`.

### B. Arquitectura e Implementación en Urano
1. **Soporte Binario en Backend Rust (`src-tauri`)**:
   - [vault.rs](file:///home/fkhalil/Desktop/Proyectos/Urano/src-tauri/src/services/vault.rs): Constante `IMAGE_EXTENSIONS`, inclusión en `list_files_recursive`, y funciones `read_file_binary` (retorna `Vec<u8>`) y `write_file_binary` (escribe bytes crudos).
   - [commands/vault.rs](file:///home/fkhalil/Desktop/Proyectos/Urano/src-tauri/src/commands/vault.rs) & [lib.rs](file:///home/fkhalil/Desktop/Proyectos/Urano/src-tauri/src/lib.rs): Comandos invocables desde Tauri.
   - [sync_engine.rs](file:///home/fkhalil/Desktop/Proyectos/Urano/src-tauri/src/services/sync_engine.rs): Detección y sincronización diferencial de archivos binarios de imagen hacia Google Drive.
2. **Capa de Abstracción de Almacenamiento ([storageAdapter.ts](file:///home/fkhalil/Desktop/Proyectos/Urano/src/services/storageAdapter.ts))**:
   - Interfaz `StorageAdapter` con `readBinary(path)`, `writeBinary(path, data)` y `getResourcePath(path)`.
   - `LocalAdapter` y `GoogleDriveAdapter`: `getResourcePath` lee los bytes del archivo, genera un `Blob` con su MIME type y retorna una `ObjectURL` cacheada (`URL.createObjectURL(blob)`), garantizando que las imágenes se rendericen en `<img src="...">` sin errores 404.
   - Utilidades `isImagePath` y `getImageFormatTag`.
3. **Protección del Store ([vaultStore.ts](file:///home/fkhalil/Desktop/Proyectos/Urano/src/stores/vaultStore.ts))**:
   - Modificación de `selectFile` y `saveCurrentFile` para evitar leer o escribir imágenes como cadenas de texto UTF-8 corruptibles.
4. **Extensión CodeMirror 6 Live Preview ([imageExtension.ts](file:///home/fkhalil/Desktop/Proyectos/Urano/src/editor/imageExtension.ts))**:
   - **Dualidad de Cursor**:
     - *Cursor fuera de la línea*: Oculta el texto crudo con `Decoration.replace` y muestra la imagen renderizada limpia con sus dimensiones aplicadas.
     - *Cursor dentro de la línea*: Mantiene el texto Markdown/Wikilink visible y coloreado para edición directa, y despliega debajo un bloque widget interactivo en vivo (`Decoration.widget({ block: true, side: 1 })`), actualizando su tamaño en tiempo real al tipear el número tras `|`.
   - **Tirador de Redimensionamiento Arrastrable**:
     - Al pasar el ratón por la esquina inferior derecha, se visualiza el tirador `.image-resize-corner` con acento naranja `#e06c1b`. Al arrastrar con el mouse, calcula el nuevo ancho proporcionalmente y actualiza automáticamente la sintaxis Markdown en el documento (`|300`).
   - **Pegado con `Ctrl+V` (Solución Robusta para Tauri)**:
     - Intercepta el evento nativo `paste` en CodeMirror 6 (`EditorView.domEventHandlers`) verificando `clipboardData.items` (`type.startsWith("image/")`) y `clipboardData.files`.
     - Función asíncrona `procesarPegadoDeImagen(file, view)`: genera el nombre exacto de Obsidian con mayúsculas `Pasted Image YYYYMMDDHHmmss.png` (ej. `Pasted Image 20261020094410.png`).
     - Conversión binaria requerida por Tauri: `file.arrayBuffer()` -> `new Uint8Array(arrayBuffer)`.
     - Escritura física en disco mediante `StorageAdapter.writeBinary` mapeado directamente a `@tauri-apps/plugin-fs` (`writeFile`) con fallback automático a comando Rust `write_file_binary` y permisos completos `"fs:read-all"` / `"fs:write-all"` en [default.json](file:///home/fkhalil/Desktop/Proyectos/Urano/src-tauri/capabilities/default.json).
     - Actualización inmediata del árbol lateral vía `refreshTree()` para mostrar la nueva imagen con su distintivo `PNG`/`JPG`.
     - Inserción instantánea de `![[Pasted Image YYYYMMDDHHmmss.png]]` en la posición exacta del cursor (`view.dispatch`), activando el Live Preview.
     - Soporte simultáneo en el menú contextual "Pegar" (`handlePaste`) leyendo imágenes con `navigator.clipboard.read()`.
   - **Arrastrar y Soltar (Drag & Drop)**:
     - Desde el sistema operativo hacia el editor o árbol: guarda el archivo binario con su nombre original e inserta `![[nombre.ext]]`.
     - Desde el explorador lateral de Urano hacia el editor: inserta `![[nombre.ext]]` en la posición soltada.
5. **Visor de Imágenes Dedicado ([ImageView.tsx](file:///home/fkhalil/Desktop/Proyectos/Urano/src/components/image/ImageView.tsx))**:
   - Pestaña independiente (`type: "image"`) con icono `<FileImage />`.
   - Imagen centrada sobre fondo oscuro con soporte de arrastre/paneo libre.
   - Zoom con rueda del ratón enfocado hacia el cursor (rango 0.1x a 10x) y controles flotantes (`-`, `+`, `Reset 100%`, `Ajustar a pantalla`).
   - Barra de estado inferior flotante que muestra dimensiones nativas (`ancho × alto px`), tamaño en disco formateado (KB/MB) y porcentaje actual de zoom.
   - Menú contextual nativo al hacer clic derecho.
6. **Explorador de Archivos ([FileTree.tsx](file:///home/fkhalil/Desktop/Proyectos/Urano/src/components/vault/FileTree.tsx))**:
   - Etiqueta de formato en mayúsculas a la derecha de cada archivo (`PNG`, `JPG`, `WEBP`, `SVG`, `GIF`) con clase `.nav-file-tag`.
   - Clic en archivo abre la pestaña `ImageView`.
   - Clic derecho incluye opción "Copiar imagen".
   - Soporte de soltar imágenes del SO sobre cualquier carpeta del árbol.
7. **Menú Contextual de Imagen (Editor y Canvas)**:
   - Evento desacoplado `urano-image-contextmenu` para imágenes en notas o nodos de Canvas:
     - `Copiar imagen` (`Copy`): Exporta a PNG y copia al portapapeles con `navigator.clipboard.write`.
     - `Abrir en una pestaña nueva` (`FileImage`).
     - Separador (`.menu-separator`).
     - `Cambiar nombre...` (`Pencil`).
     - `Eliminar archivo` (`Trash2`, rojo).

---

## 7. Corrección Definitiva: Pegado de Imágenes, Renderizado en Notas Markdown y Drag & Drop
1. **No cambiar de pestaña al pegar (Ctrl+V) dentro de una nota Markdown**:
   - Al pegar con Ctrl+V (o desde el menú contextual) una imagen desde el portapapeles en una nota .md:
     * Se guarda el archivo binario en la raíz de la bóveda activa (activeVault) con el nombre estándar Pasted Image YYYYMMDDHHmmss.png.
     * Se refresca el árbol de archivos (refreshTree()), pero NUNCA se llama a selectFile ni se modifica activeFile. La nota actual permanece activa y en primer plano.
     * Se inserta inmediatamente mediante view.dispatch el texto 
![[Pasted Image YYYYMMDDHHmmss.png]]
 en la posición exacta del cursor.
2. **Eliminación del crash fatal de CodeMirror 6 (RangeError: Block decorations may not be specified via plugins)**:
   - Se prohibió y eliminó el uso de block: true dentro de ViewPlugin en imageExtension.ts.
   - Tanto el reemplazo limpio cuando el cursor no toca el rango (Decoration.replace({ widget })) como el widget cuando el cursor está editando (Decoration.widget({ widget, side: 1 })) se manejan en línea en CodeMirror, mientras que el contenedor HTML del widget se estiliza con display: block; margin: 8px 0; width: fit-content; max-width: 100%; clear: both;.
3. **Desacople y prevención de colisión con wikilinks.ts y liveMarkdown.ts**:
   - En wikilinks.ts:
     * WIKILINK_REGEX usa lookbehind negativo (?<!\!)\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g.
     * Se descartan tanto enlaces precedidos de ! como nombres que correspondan a imágenes (isImagePath), evitando decoraciones duplicadas o clics conflictivos.
   - En liveMarkdown.ts:
     * Se precargan todos los rangos ocupados por ![[...]] y ![...](...) en occupied antes de procesar negritas, cursivas o códigos, impidiendo que tokens como guiones bajos en nombres de imagen interfieran con el formato de texto.
4. **Carga binaria idéntica a ImageView con resolución limpia de dimensiones y caché ObjectURL**:
   - El nombre del archivo se separa estrictamente de las dimensiones antes de consultar disco (const rawTarget = innerText.split('|')[0].trim();).
   - Se resuelve la ruta absoluta buscando rawTarget en el fileTree de la bóveda (o concatenando activeVault).
   - Se lee el binario mediante getStorageAdapter().readBinary(absolutePath) (exactamente como ImageView.tsx).
   - Se genera y cachea el Blob y su URL.createObjectURL en imageBlobUrlCache: Map<string, string>, permitiendo renderizado instantáneo y sin parpadeos.
5. **Arrastrar y soltar (Drag & Drop) desde el Explorador Lateral (FileTree.tsx)**:
   - onDragStart suministra application/x-urano-path y text/plain.
   - El manejador en el editor implementa dragover llamando a e.preventDefault() y configurando dropEffect = 'copy'.
   - Al soltar en el editor, si es imagen se inserta 
![[nombre.png]]
, y si es una nota se inserta [[nombre]] en las coordenadas exactas donde cayó el cursor sin cambiar de pestaña.

---

## 8. Diagnóstico del Rendimiento de Carga de Imágenes (App de Escritorio vs. Navegador) y Solución

### A. Diagnóstico del Problema: ¿Por qué en el navegador es instantáneo y en la app demora?
1. **Diferencia de arquitectura de procesos**:
   - **En Obsidian (Electron / Node.js)**:
     Obsidian corre sobre Chromium con Node.js en el mismo espacio de memoria. Las imágenes se cargan de disco directamente mediante `fs.readFile` sin serialización ni puentes inter-proceso.
   - **En el Navegador estándar (`localhost:1420`)**:
     El motor de navegación maneja la memoria y decodificación de forma nativa sin pasar por el contenedor de escritorio de Tauri ni la capa de seguridad de WebKitGTK.
   - **En la App de Escritorio Urano (Tauri v2 + WebKitGTK en Arch Linux)**:
     - **Cuello de botella #1: Serialización IPC (`read_file_binary`)**:
       Cuando las imágenes se piden mediante comandos `invoke`, Rust lee los bytes del disco y los serializa a un array JSON de números (`number[]` como `[255, 216, 255, ...]`). Una imagen de 2 MB se convierte en un bloque JSON de ~8 a 10 MB de texto que cruza el puente IPC hacia WebKitGTK, donde JavaScript debe parsearlo a un `Uint8Array` y luego crear un `Blob` y un `ObjectURL`.
     - **Cuello de botella #2: Scope y restricciones de rutas en Linux**:
       En Linux, WebKitGTK maneja rutas absolutas con barra inicial (`/home/...`). Los globs genéricos como `["**"]` en Tauri v2 suelen fallar la validación de scope en Linux si no contemplan `$HOME/**/*` o `/home/**/*`, lo que puede provocar rechazos (`403 Forbidden`) o retrasos en la resolución del protocolo `asset://`.
     - **Cuello de botella #3: Directivas CSP en WebKitGTK**:
       Al ejecutarse en modo desarrollo sobre `http://localhost:1420`, WebKitGTK bloquea o retrasa las solicitudes hacia `asset://` si la directiva Content Security Policy no incluye explícitamente `asset:` y `http://asset.localhost`. Cuando esto ocurre, el sistema se ve obligado a recurrir al fallback lento de lectura binaria por IPC.

---

### B. Solución Planteada y Arquitectura de Streaming Directo (0 ms IPC)

1. **Protocolo Nativo de Assets (`asset://`) con Scope Completo en Linux**:
   - **`src-tauri/Cargo.toml`**: Activación de la bandera `features = ["protocol-asset"]` en la dependencia de `tauri`.
   - **`src-tauri/tauri.conf.json`**: Configuración de `assetProtocol` con scope explícito para rutas de Linux:
     ```json
     "assetProtocol": {
       "enable": true,
       "scope": [
         "$HOME/**/*",
         "/home/**/*",
         "**"
       ]
     }
     ```
   - Esto habilita en Rust el servidor interno de streaming HTTP Range (`http-range`), permitiendo que el motor gráfico de WebKit lea directamente del disco en bloques continuos a velocidad nativa de I/O.

2. **Ajuste de Content Security Policy (CSP)**:
   - Habilitar en `tauri.conf.json` las fuentes necesarias:
     `img-src 'self' asset: http://asset.localhost blob: data: https:;`
   - Esto garantiza que WebKitGTK cargue las imágenes locales del protocolo `asset:` sin restricciones de contenido mixto ni bloqueos de seguridad.

3. **Cero Sobrecarga de Serialización con `convertFileSrc`**:
   - En [`src/services/storageAdapter.ts`](file:///home/fkhalil/Desktop/Proyectos/Urano/src/services/storageAdapter.ts) (`getResourcePath`) y en [`src/editor/imageExtension.ts`](file:///home/fkhalil/Desktop/Proyectos/Urano/src/editor/imageExtension.ts) (`resolveImageBlobUrl` y `ImageWidget.toDOM`):
     - Se utiliza `convertFileSrc(absolutePath)` de `@tauri-apps/api/core`.
     - `convertFileSrc` genera síncronamente la URL `asset://localhost/...` en **0 ms**.
     - En el método `toDOM` de `ImageWidget`, `img.src` se establece de forma síncrona en el montaje del widget, eliminando esperas por promesas asíncronas o reconstrucción de blobs en memoria.

4. **Límites de Redimensión y Fluidez Visual**:
   - Redimensión controlada con límites seguros: Mínimo **50px**, Máximo **1200px** con indicador flotante de dimensiones (`image-resize-tooltip`).
   - Skeleton shimmer animado mientras el motor WebKit decodifica la imagen y transición suave al estar disponible.

---

## 9. Diagnóstico Real del "Pegado Lento" (App vs. Navegador) y Corrección Aplicada

La sección 8 atribuía la demora a la carga por IPC; esa parte ya estaba resuelta con `convertFileSrc`. Al revisar el código y la bóveda de prueba (`~/Desktop/prueba`, con decenas de `Pasted Image ... .png` de ~1.6 MB) se encontró que la lentitud estaba en el **flujo de pegado**, no en la lectura de disco. En el navegador el evento `paste` ya trae el blob de la imagen y se renderiza desde memoria; en la app (WebKitGTK) el flujo pasaba por Rust de forma redundante y bloqueante.

### A. Causas confirmadas
1. **`read_clipboard_image` se invocaba dos veces por cada Ctrl+V** (keymap `Mod-v` en `Editor.tsx` + fallback del evento `paste` en `imageExtension.ts`), y también en **cada pegado de texto**.
2. **Comando sincrónico sobre el hilo principal**: `arboard` decodificaba el PNG del portapapeles a RGBA y el crate `image` lo re-codificaba con compresión por defecto. En un binario `debug` eso tarda segundos y congela la UI.
3. **Serialización JSON de bytes**: el resultado `Vec<u8>` viajaba como array de números (~1.6 MB → varios MB de texto JSON a parsear).
4. **`await refreshTree()` antes de insertar el enlace**: el listado completo de la bóveda bloqueaba la inserción de `![[...]]`.
5. **Blob en memoria descartado**: tras guardar, se reemplazaba la URL `blob:` ya cargada por una URL `asset://`, forzando una relectura por el protocolo.
6. **Recreación del `<img>` en CodeMirror**: `ImageWidget.eq` comparaba `from`/`to`, así que cualquier edición encima de la imagen recreaba el nodo DOM y volvía a pedir y decodificar la imagen (skeleton visible otra vez).

### B. Cambios realizados
- **Rust ([commands/vault.rs](file:///home/fkhalil/Desktop/Proyectos/Urano/src-tauri/src/commands/vault.rs))**:
  - `read_clipboard_image` en Linux usa `gtk::Clipboard` para pedir el target `image/png` **crudo** (sin decodificar ni recodificar); si el propietario solo ofrece otro formato de imagen, GDK lo decodifica y libpng (C nativo) lo codifica. En otras plataformas se mantiene `arboard` con `CompressionType::Fast`.
  - `read_clipboard_image` y `read_file_binary` devuelven `tauri::ipc::Response` (binario crudo, cero JSON). Sin imagen → cuerpo vacío.
  - [Cargo.toml](file:///home/fkhalil/Desktop/Proyectos/Urano/src-tauri/Cargo.toml): dependencia `gtk = "0.18"` solo en Linux/BSD y `[profile.dev.package."*"] opt-level = 3` para que en `tauri dev` las dependencias (tauri, wry, tokio, image) corran optimizadas mientras el crate propio sigue en debug. La primera compilación tras este cambio recompila todas las dependencias una vez.
- **Frontend**:
  - [storageAdapter.ts](file:///home/fkhalil/Desktop/Proyectos/Urano/src/services/storageAdapter.ts): utilidad `toUint8Array` (acepta `ArrayBuffer`, `Uint8Array` o `number[]`) usada por todos los consumidores de binarios por IPC.
  - [Editor.tsx](file:///home/fkhalil/Desktop/Proyectos/Urano/src/components/editor/Editor.tsx): eliminado el keymap `Mod-v`; `handlePaste` (menú contextual) normaliza la respuesta binaria.
  - [imageExtension.ts](file:///home/fkhalil/Desktop/Proyectos/Urano/src/editor/imageExtension.ts):
    - Evento `paste`: si `clipboardData` trae la imagen se usa directo; si trae texto plano (y no HTML con `<img>`) se deja pasar a CodeMirror **sin consultar el portapapeles nativo**; solo si no hay texto utilizable se pide el PNG crudo a Rust.
    - `procesarPegadoDeImagen`: conserva la URL `blob:` en memoria como fuente de la imagen durante la sesión, inserta `![[...]]` inmediatamente después de escribir el archivo y ejecuta `refreshTree()` en segundo plano. Debounce reducido a 300 ms.
    - `ImageWidget`: `eq` ya no compara `from`/`to`; nuevo `updateDOM` actualiza en sitio ancho/alto/alt cuando solo cambia la sintaxis (`|300`); las posiciones para redimensionar o abrir el menú contextual se recalculan en el momento con `locateEmbedRange` (basado en `view.posAtDOM`).

---

## 10. Renombrado 1:1 con Obsidian: edición en línea, escaneo de enlaces, modal "Update links" y refresco en vivo

Flujo equivalente a `FileManager.renameFile` + `MetadataCache.getBacklinksForFile` + modal `shouldUpdateLinks` de Obsidian.

### A. Edición en línea en el árbol lateral ([FileTree.tsx](file:///home/fkhalil/Desktop/Proyectos/Urano/src/components/vault/FileTree.tsx))
- `getBaseNameAndExt(name, isDir)` separa nombre base y extensión para **cualquier** archivo (`.md`, `.png`, `.canvas`, `.base`...). El `<input>` muestra y selecciona solo el nombre base (`fotomessi`, no `fotomessi.png`).
- La insignia de formato (`PNG`, `CANVAS`, `BASE`) permanece visible a la derecha durante la edición.
- `Enter`/`onBlur` confirman y reconstruyen `nuevoNombre + extensiónOriginal`; `Escape` cancela y restaura el valor.
- Colisión de nombres: recorrido recursivo del árbol (antes solo se miraba el nivel raíz).
- Carpetas: `renameItem` del store (sin escaneo de enlaces). Archivos: `requestFileRename` → `scanAffectedLinks` → según preferencia ejecuta o abre el modal.

### B. Escaneo de enlaces ([linkRefactorService.ts](file:///home/fkhalil/Desktop/Proyectos/Urano/src/services/linkRefactorService.ts))
- `scanAffectedLinks(vault, oldPath, newPath)`: pide `get_vault_notes_content` (notas `.md`/`.markdown` y `.canvas`), sustituye el contenido de la nota activa por el buffer en memoria si está `isDirty`, y omite el archivo renombrado.
- `findLinkReplacements(text, oldPath, newPath)` devuelve **rangos** `{from, to, insert}` sobre el texto original para `[[x]]`, `![[x]]`, `![[x|300]]`, `[[x|Alias]]`, `[[x#sec]]`, `[alt](x)` y `![alt](x)`. Coincidencia sin distinguir mayúsculas, con o sin extensión, con subcarpetas (`img/x.png`). Alias, dimensiones y anclas se conservan intactos. Regla Obsidian: un enlace escrito sin extensión a una nota `.md` sigue sin extensión; a cualquier otro tipo lleva siempre extensión.
- `replaceLinksInCanvas` recorre `nodes[]` (`type: 'file'` → campo `file`; `type: 'text'` → markdown embebido).
- Resultado: `{ totalLinks, totalFiles, changes[] }` con conteos exactos (apariciones y archivos distintos).

### C. Modal "Update links" ([UpdateLinksModal.tsx](file:///home/fkhalil/Desktop/Proyectos/Urano/src/components/common/UpdateLinksModal.tsx))
- Preferencia persistente `localStorage['urano_always_update_links']` (`"prompt"` por defecto; `"always"` / `"never"`).
- Se muestra solo si `totalLinks > 0` y la preferencia es `"prompt"`: fondo `#1e1e1e`, borde `1px solid #363636`, radio 8px, 440px, botón `×`.
- Texto: `Update links` / `Do you want to update internal links that link to this file?` / `This will affect N link(s) in M file(s).`
- Botones (derecha, `gap: 8px`): `Always update` (guarda `"always"` y actualiza), `Just once` (actualiza solo ahora), `Do not update` (= `×` / `Esc`: renombra solo el archivo físico).

### D. Ejecución del renombrado y refresco en vivo
`applyPhysicalRename` (compartido por `executeLinkRefactor` y `executeFileRenameOnly`):
1. `rename_item` en disco.
2. `renameImageInCache(old, new)` en [imageExtension.ts](file:///home/fkhalil/Desktop/Proyectos/Urano/src/editor/imageExtension.ts): borra las claves viejas; las URL `blob:`/`data:` se reutilizan, pero una URL `asset://` contiene la ruta vieja (ya inexistente) así que la nueva clave recibe `convertFileSrc(newPath)`.
3. Despacha `urano-file-renamed` **antes** de cambiar `activeFile`: [App.tsx](file:///home/fkhalil/Desktop/Proyectos/Urano/src/App.tsx) re-apunta `id`/`filePath`/`title` de la pestaña y `activeTabId`, de modo que el efecto de sincronización de pestañas encuentra la pestaña existente y no abre un duplicado. El rename por título dentro del editor (`renameNoteWithLinkRefactor`) despacha el mismo evento.
4. Actualiza `fileTree` en memoria (`renameInFileTree`), `notesContentMap`, `activeFile`/`activeFileName` (breadcrumb, título del editor e `ImageView` reaccionan solos). `refreshTree()` corre al final para sincronizar tamaños/mtimes.

`executeLinkRefactor` además, por cada archivo afectado:
- Si es la nota abierta: recalcula los rangos sobre `view.state.doc` y hace `view.dispatch({ changes: rangos })` (solo los enlaces cambian; cursor, scroll e historial de deshacer se conservan). Escribe en disco el documento resultante y marca `isDirty: false`.
- Si no está abierta: escribe `newContent` y actualiza `notesContentMap`.
- `ImageWidget.updateDOM` ahora acepta un cambio de destino del mismo tipo de embed: si la URL se resuelve de forma síncrona (caché o `convertFileSrc`) cambia `img.src` en sitio, sin recrear el widget ni mostrar el skeleton.
