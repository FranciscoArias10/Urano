import { FileItem } from '../types';
import { t } from '../locales/i18n';
import { normalizePath } from './pathUtils';

/**
 * Validación y saneamiento centralizado de nombres de archivos y carpetas (1:1 con Obsidian `app.asar`).
 *
 * Reglas extraídas mediante REA sobre `obsidian-1.15.1.asar` (`app.js`, `i18n.js`, `i18n/es.txt`):
 * - `s0e` / `Cc`: caracteres prohibidos por SO (Windows / multiplataforma): `* " \ / < > : | ?` + caracteres de control `[\x00-\x1F\x7F]`.
 * - `GX` / `ST`: caracteres que rompen enlaces internos (aviso no bloqueante en `Xh`): `# ^ [ ] |`.
 * - `Yk` / `hh`: bloqueo estricto de cualquier archivo o carpeta que comience por `.` (`msgBadDotfile`), ya que el reconciliador ignora dotfiles.
 * - `Ik`: bloqueo de nombres terminados en punto `.` o espacio, y nombres de dispositivo reservados de Windows (`CON`, `PRN`, `AUX`, `NUL`, `COM1`–`COM9`, `LPT1`–`LPT9`, con o sin extensión).
 * - `Wi` / `TT`: longitud máxima de 250 caracteres por nombre de archivo/carpeta y normalización NFC + espacios no separables (`\u00A0`, `\u202F`).
 * - `checkForDuplicate` / `getAvailablePath`: colisión insensible a mayúsculas/minúsculas entre hermanos, permitiendo cambiar únicamente las mayúsculas/minúsculas del propio archivo (`nota.md` -> `Nota.md`).
 */

export const FORBIDDEN_FILENAME_CHARS_DISPLAY = '* " \\ / < > : | ?';
export const FORBIDDEN_FILENAME_CHARS_RE = /[*"\\/<>:|?\x00-\x1F\x7F]/;

export const UNSAFE_LINK_CHARS_DISPLAY = '# ^ [ ] |';
export const UNSAFE_LINK_CHARS_RE = /[#^\[\]|]/;

export const WINDOWS_RESERVED_NAME_RE = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;

export const MAX_FILENAME_LENGTH = 250;

const AUTO_SANITIZE_CHARS_RE = /([*"\\/<>:|?#^\[\]\x00-\x1F\x7F\r\n]|%%|\[\[|\]\])/g;

export type FileNameErrorCode =
  | 'empty'
  | 'invalid_chars'
  | 'dotfile'
  | 'trailing_dot'
  | 'reserved_name'
  | 'too_long'
  | 'path_traversal'
  | 'duplicate';

export interface ValidateFileNameOptions {
  /** Si es `true` (p. ej. escritura en vivo en `.inline-title`), una cadena vacía no devuelve error. */
  allowEmpty?: boolean;
  /** Extensión del archivo (p. ej. `.md`, `.canvas`, `.png`) para comprobar longitud y duplicados. */
  extension?: string;
  /** Ruta completa actual del elemento al renombrar (permite renombrado de solo mayúsculas/minúsculas). */
  currentPath?: string | null;
  /** Carpeta padre donde vive o se creará el elemento. */
  parentDir?: string | null;
  /** Árbol o lista de elementos de la bóveda para comprobar colisiones insensibles a mayúsculas. */
  existingItems?: FileItem[];
  /** Si es `true`, exige que tampoco exista conflicto cuando `existingItems` incluye subárboles anidados. */
  checkDuplicates?: boolean;
}

export interface FileNameValidationResult {
  valid: boolean;
  /** Nombre limpio (espacios recortados y normalizado en NFC). */
  sanitizedName: string;
  /** Nombre completo con extensión si se proporcionó `extension`. */
  fullFileName: string;
  error?: string;
  errorCode?: FileNameErrorCode;
  /** Aviso no bloqueante de Obsidian cuando el nombre incluye `# ^ [ ] |`. */
  warning?: string;
}

/**
 * Normaliza espacios Unicode no separables (`\u00A0`, `\u202F`), aplica NFC y recorta espacios iniciales/finales.
 * Mantiene los caracteres de control intactos para que `FORBIDDEN_FILENAME_CHARS_RE` los detecte si se validan,
 * salvo que se indique `stripControlChars = true`.
 */
export function normalizeFileNameInput(raw: string, stripControlChars = false): string {
  if (!raw) return '';
  let next = raw.replace(/[\u00A0\u202F]/g, ' ').normalize('NFC');
  if (stripControlChars) {
    next = next.replace(/[\x00-\x1F\x7F]/g, ' ');
  }
  return next.trim();
}

/**
 * Convierte saltos de línea al pegar texto en `.inline-title` o inputs de renombrado en espacios simples (`bp` en Obsidian).
 */
export function stripInlineTitleNewlines(raw: string): string {
  if (!raw) return '';
  return raw.replace(/[\r\n]+/g, ' ').replace(/[\u00A0\u202F]/g, ' ').normalize('NFC');
}

/**
 * Comprueba si el nombre (con o sin extensión) coincide con un nombre de dispositivo reservado en Windows.
 * Bloquea tanto `CON` como `con.md`, `AUX.png` o `COM1.txt.md`.
 */
export function isWindowsReservedFileName(fileNameOrStem: string): boolean {
  const trimmed = fileNameOrStem.trim();
  if (!trimmed) return false;

  if (WINDOWS_RESERVED_NAME_RE.test(trimmed)) {
    return true;
  }

  const lastDot = trimmed.lastIndexOf('.');
  if (lastDot > 0) {
    const withoutLastExt = trimmed.slice(0, lastDot).trim();
    if (WINDOWS_RESERVED_NAME_RE.test(withoutLastExt)) {
      return true;
    }
  }

  const firstDot = trimmed.indexOf('.');
  if (firstDot > 0) {
    const primaryStem = trimmed.slice(0, firstDot).trim();
    if (WINDOWS_RESERVED_NAME_RE.test(primaryStem)) {
      return true;
    }
  }

  return false;
}

function normalizeExt(ext?: string): string {
  if (!ext) return '';
  const trimmed = ext.trim();
  if (!trimmed) return '';
  return trimmed.startsWith('.') ? trimmed : `.${trimmed}`;
}

function findCollisionInTree(
  items: FileItem[],
  candidatePathLower: string,
  currentPathLower: string | null
): FileItem | null {
  for (const item of items) {
    const normItem = normalizePath(item.path).toLowerCase();
    if (normItem === candidatePathLower) {
      if (currentPathLower && normItem === currentPathLower) {
        // Mismo archivo/carpeta (permite cambio de capitalización p. ej. `nota.md` -> `Nota.md`)
      } else {
        return item;
      }
    }
    if (item.children?.length) {
      const childHit = findCollisionInTree(item.children, candidatePathLower, currentPathLower);
      if (childHit) return childHit;
    }
  }
  return null;
}

/**
 * Valida un nombre individual de archivo o carpeta (sin separadores de ruta) siguiendo 1:1 las reglas de Obsidian.
 */
export function validateFileName(
  rawName: string,
  options: ValidateFileNameOptions = {}
): FileNameValidationResult {
  const cleaned = normalizeFileNameInput(rawName ?? '', false);
  const ext = normalizeExt(options.extension);

  if (!cleaned) {
    if (options.allowEmpty) {
      return { valid: true, sanitizedName: '', fullFileName: '' };
    }
    return {
      valid: false,
      sanitizedName: '',
      fullFileName: '',
      errorCode: 'empty',
      error: t('vault.errors.nameEmpty'),
    };
  }

  // 1. Caracteres prohibidos por el sistema operativo (`Cc` en Obsidian: * " \ / < > : | ? + chars de control)
  if (FORBIDDEN_FILENAME_CHARS_RE.test(cleaned)) {
    return {
      valid: false,
      sanitizedName: cleaned,
      fullFileName: cleaned,
      errorCode: 'invalid_chars',
      error: t('vault.errors.nameInvalidChars'),
    };
  }

  // 2. Bloqueo de dotfiles y segmentos `.` / `..` (`msgBadDotfile` en Obsidian)
  if (cleaned === '.' || cleaned === '..' || cleaned.startsWith('.')) {
    return {
      valid: false,
      sanitizedName: cleaned,
      fullFileName: cleaned,
      errorCode: 'dotfile',
      error: t('vault.errors.nameBadDotfile'),
    };
  }

  // Resolver base y nombre completo considerando extensión opcional
  const hasProvidedExt =
    Boolean(ext) &&
    cleaned.length > ext.length &&
    cleaned.toLowerCase().endsWith(ext.toLowerCase());
  const basePart = hasProvidedExt ? cleaned.slice(0, -ext.length) : cleaned;
  const fullFileName = ext && !hasProvidedExt ? `${cleaned}${ext}` : cleaned;

  if (!basePart.trim()) {
    return {
      valid: false,
      sanitizedName: cleaned,
      fullFileName,
      errorCode: 'empty',
      error: t('vault.errors.nameEmpty'),
    };
  }

  // 3. Puntos o espacios al final (`Ik` en Obsidian; crítico en Windows donde NTFS recorta puntos finales)
  if (
    cleaned.endsWith('.') ||
    cleaned.endsWith(' ') ||
    basePart.endsWith('.') ||
    basePart.endsWith(' ')
  ) {
    return {
      valid: false,
      sanitizedName: cleaned,
      fullFileName,
      errorCode: 'trailing_dot',
      error: t('vault.errors.nameTrailingDot'),
    };
  }

  // 4. Nombres reservados de Windows (`CON`, `PRN`, `AUX`, `NUL`, `COM1`-`COM9`, `LPT1`-`LPT9`)
  if (isWindowsReservedFileName(basePart) || isWindowsReservedFileName(fullFileName)) {
    return {
      valid: false,
      sanitizedName: cleaned,
      fullFileName,
      errorCode: 'reserved_name',
      error: t('vault.errors.nameReserved', { name: basePart }),
    };
  }

  // 5. Longitud máxima de nombre de archivo (250 caracteres en Obsidian)
  if (fullFileName.length > MAX_FILENAME_LENGTH || cleaned.length > MAX_FILENAME_LENGTH) {
    return {
      valid: false,
      sanitizedName: cleaned,
      fullFileName,
      errorCode: 'too_long',
      error: t('vault.errors.nameTooLong', { max: MAX_FILENAME_LENGTH }),
    };
  }

  // 6. Colisión de duplicados insensible a mayúsculas/minúsculas en la misma carpeta
  const shouldCheckDuplicates =
    options.checkDuplicates !== false &&
    Boolean(options.existingItems) &&
    Boolean(options.parentDir !== undefined || options.currentPath);

  if (shouldCheckDuplicates && options.existingItems) {
    const normCurrent = options.currentPath ? normalizePath(options.currentPath) : null;
    const derivedParent =
      options.parentDir !== undefined && options.parentDir !== null
        ? normalizePath(options.parentDir)
        : normCurrent && normCurrent.includes('/')
        ? normCurrent.slice(0, normCurrent.lastIndexOf('/'))
        : '';
    const candidatePath = (derivedParent ? `${derivedParent}/${fullFileName}` : fullFileName).replace(
      /\/+/g,
      '/'
    );
    const collision = findCollisionInTree(
      options.existingItems,
      candidatePath.toLowerCase(),
      normCurrent ? normCurrent.toLowerCase() : null
    );
    if (collision) {
      return {
        valid: false,
        sanitizedName: cleaned,
        fullFileName,
        errorCode: 'duplicate',
        error: t('vault.errors.nameExists'),
      };
    }
  }

  // 7. Aviso no bloqueante para caracteres que rompen wikilinks (`# ^ [ ] |` en `Xh`)
  const warning = UNSAFE_LINK_CHARS_RE.test(basePart)
    ? t('vault.errors.nameUnsafeLinkChars')
    : undefined;

  return {
    valid: true,
    sanitizedName: cleaned,
    fullFileName,
    ...(warning ? { warning } : {}),
  };
}

export interface ValidateVaultRelativePathOptions {
  /** Carpeta base absoluta (raíz de la bóveda o carpeta padre). */
  baseDir: string;
  /** Extensión por defecto para el archivo hoja si no trae una extensión reconocida (p. ej. `.md`). */
  defaultExtension?: string;
  /** Expresión regular de extensiones válidas que no requieren añadir `defaultExtension`. */
  knownExtensionsRe?: RegExp;
  /** Árbol de archivos para detectar colisiones con archivos existentes. */
  existingItems?: FileItem[];
  /** Si es `true`, permite que el archivo destino ya exista (p. ej. abrir/añadir si existe). */
  allowExistingTarget?: boolean;
  /** Ruta actual si se está renombrando. */
  currentPath?: string | null;
}

export interface VaultRelativePathValidationResult {
  valid: boolean;
  normalizedRelPath: string;
  fullPath: string;
  parentDir: string;
  fileName: string;
  baseName: string;
  error?: string;
  errorCode?: FileNameErrorCode;
  warning?: string;
}

const DEFAULT_KNOWN_NOTE_EXT_RE = /\.(md|markdown|canvas|base)$/i;

/**
 * Valida una ruta relativa dentro de la bóveda que puede incluir subcarpetas (`Carpeta/Sub/Nota`),
 * validando cada segmento intermedio y el nombre de archivo final con las reglas 1:1 de Obsidian.
 */
export function validateVaultRelativePath(
  rawRelPath: string,
  options: ValidateVaultRelativePathOptions
): VaultRelativePathValidationResult {
  const normBase = normalizePath(options.baseDir).replace(/\/+$/, '');
  const rawNormalized = (rawRelPath ?? '')
    .replace(/[\u00A0\u202F]/g, ' ')
    .normalize('NFC')
    .replace(/\\/g, '/')
    .trim();

  const emptyFail = (
    errorCode: FileNameErrorCode,
    error: string
  ): VaultRelativePathValidationResult => ({
    valid: false,
    normalizedRelPath: '',
    fullPath: '',
    parentDir: normBase,
    fileName: '',
    baseName: '',
    errorCode,
    error,
  });

  if (!rawNormalized) {
    return emptyFail('empty', t('vault.errors.nameEmpty'));
  }

  // Rechazar traversal explícito `..` o prefijos de unidad (`C:...`)
  if (/(^|\/)\.\.(\/|$)/.test(rawNormalized)) {
    return emptyFail('dotfile', t('vault.errors.nameBadDotfile'));
  }
  if (/^[a-zA-Z]:/.test(rawNormalized)) {
    return emptyFail('invalid_chars', t('vault.errors.nameInvalidChars'));
  }

  const trimmedSlashes = rawNormalized.replace(/^\/+|\/+$/g, '');
  if (!trimmedSlashes) {
    return emptyFail('empty', t('vault.errors.nameEmpty'));
  }

  const rawSegments = trimmedSlashes.split('/');
  if (rawSegments.some((seg) => !seg.trim())) {
    return emptyFail('invalid_chars', t('vault.errors.nameInvalidChars'));
  }

  const cleanSegments: string[] = [];
  let latestWarning: string | undefined;

  // Validar cada carpeta intermedia
  for (let i = 0; i < rawSegments.length - 1; i++) {
    const segRes = validateFileName(rawSegments[i], { checkDuplicates: false });
    if (!segRes.valid) {
      return emptyFail(segRes.errorCode || 'invalid_chars', segRes.error || t('vault.errors.nameInvalidChars'));
    }
    if (segRes.warning) latestWarning = segRes.warning;
    cleanSegments.push(segRes.sanitizedName);

    // Si en `existingItems` ya existe un archivo (no carpeta) con la ruta de esta carpeta intermedia, hay colisión
    if (options.existingItems) {
      const folderCandidate = `${normBase}/${cleanSegments.join('/')}`.replace(/\/+/g, '/');
      const hit = findCollisionInTree(options.existingItems, folderCandidate.toLowerCase(), null);
      if (hit && !hit.isDir) {
        return emptyFail('duplicate', t('vault.errors.nameExists'));
      }
    }
  }

  const rawLeaf = rawSegments[rawSegments.length - 1];
  const extRe = options.knownExtensionsRe ?? DEFAULT_KNOWN_NOTE_EXT_RE;
  const defaultExt = normalizeExt(options.defaultExtension);
  const leafAlreadyHasExt = extRe.test(rawLeaf.trim());
  const effectiveExt = leafAlreadyHasExt ? '' : defaultExt;

  const resolvedParentDir = cleanSegments.length > 0
    ? `${normBase}/${cleanSegments.join('/')}`.replace(/\/+/g, '/')
    : normBase;

  const leafRes = validateFileName(rawLeaf, {
    extension: effectiveExt,
    parentDir: resolvedParentDir,
    existingItems: options.allowExistingTarget ? undefined : options.existingItems,
    currentPath: options.currentPath,
  });

  if (!leafRes.valid) {
    return {
      valid: false,
      normalizedRelPath: '',
      fullPath: '',
      parentDir: resolvedParentDir,
      fileName: leafRes.fullFileName,
      baseName: leafRes.sanitizedName,
      errorCode: leafRes.errorCode,
      error: leafRes.error,
    };
  }

  if (leafRes.warning) latestWarning = leafRes.warning;

  const fileName = leafRes.fullFileName;
  const lastDot = fileName.lastIndexOf('.');
  const baseName = lastDot > 0 ? fileName.slice(0, lastDot) : fileName;
  const normalizedRelPath = [...cleanSegments, fileName].join('/');
  const fullPath = (normBase ? `${normBase}/${normalizedRelPath}` : normalizedRelPath).replace(
    /\/+/g,
    '/'
  );

  return {
    valid: true,
    normalizedRelPath,
    fullPath,
    parentDir: resolvedParentDir,
    fileName,
    baseName,
    ...(latestWarning ? { warning: latestWarning } : {}),
  };
}

/**
 * Sanea un título automático o de adjunto reemplazando caracteres prohibidos/inseguros por espacios (`Wi` en Obsidian)
 * y recortando puntos finales y longitud a 250 caracteres.
 */
export function sanitizeAutoFileName(raw: string, fallback = 'Untitled'): string {
  let cleaned = normalizeFileNameInput(raw ?? '', true)
    .replace(AUTO_SANITIZE_CHARS_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Quitar puntos iniciales y puntos/espacios finales
  cleaned = cleaned.replace(/^\.+/, '').replace(/[. ]+$/, '').trim();

  if (!cleaned || isWindowsReservedFileName(cleaned)) {
    cleaned = fallback;
  }

  if (cleaned.length > MAX_FILENAME_LENGTH) {
    cleaned = cleaned.slice(0, MAX_FILENAME_LENGTH).replace(/[. ]+$/, '').trim();
  }

  return cleaned || fallback;
}

/**
 * Genera el siguiente nombre disponible al crear notas, canvas, bases o carpetas sin nombre manual
 * (`Sin título`, `Sin título 1`, `Sin título 2` / `Untitled`, `Untitled 1`, `Untitled 2`),
 * comparando sin distinguir mayúsculas/minúsculas (`getAvailablePath` en Obsidian).
 */
export function getAvailableUntitledName(
  baseTitle: string,
  existingNamesLower: Set<string>,
  extension = ''
): { fullName: string; baseName: string } {
  const ext = normalizeExt(extension);
  const cleanBase = normalizeFileNameInput(baseTitle) || 'Untitled';

  let baseCandidate = cleanBase;
  let fullCandidate = `${baseCandidate}${ext}`;
  let counter = 1;

  while (existingNamesLower.has(fullCandidate.toLowerCase())) {
    baseCandidate = `${cleanBase} ${counter}`;
    fullCandidate = `${baseCandidate}${ext}`;
    counter++;
  }

  return {
    fullName: fullCandidate,
    baseName: baseCandidate,
  };
}

