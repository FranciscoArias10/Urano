#!/usr/bin/env node
/**
 * Comprueba la coherencia de los diccionarios i18n de Urano.
 *
 *   node scripts/i18n-check.mjs            → informa y sale con código 1 si hay errores
 *   node scripts/i18n-check.mjs --strict   → también falla si `es.json` no cubre todo `en.json`
 *
 * 1. Toda clave usada en el código (`t('a.b')`, `t("a.b")`; en Ajustes con prefijo implícito
 *    `settings.`) debe existir en `src/locales/en.json`.
 * 2. Informa de las claves de `en.json` que faltan en cada otro idioma embebido.
 * 3. Informa de claves huérfanas en los demás idiomas (no existen en `en.json`).
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const SRC = join(ROOT, 'src');
const LOCALES = join(SRC, 'locales');
const strict = process.argv.includes('--strict');

function flatten(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object') flatten(v, path, out);
    else out[path] = v;
  }
  return out;
}
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx?|mjs)$/.test(name) && !name.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

// Durante una migración, los fragmentos pendientes de fusionar (`_fragments/*.en.json`)
// cuentan como parte de en.json para que cada autor pueda validar sus claves.
const FRAGMENTS = join(LOCALES, '_fragments');
function loadLang(lang) {
  const base = JSON.parse(readFileSync(join(LOCALES, `${lang}.json`), 'utf8'));
  if (existsSync(FRAGMENTS)) {
    for (const f of readdirSync(FRAGMENTS).filter((n) => n.endsWith(`.${lang}.json`)).sort()) {
      Object.assign(base, deepMerge(base, JSON.parse(readFileSync(join(FRAGMENTS, f), 'utf8'))));
    }
  }
  return base;
}
function deepMerge(target, source) {
  for (const [k, v] of Object.entries(source)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) target[k] = deepMerge(target[k] && typeof target[k] === 'object' ? target[k] : {}, v);
    else target[k] = v;
  }
  return target;
}

const en = flatten(loadLang('en'));
const enKeys = new Set(Object.keys(en));
let errors = 0;

// 1. Claves usadas en el código
const KEY_RE = /\b(?:t|tr|translate)\(\s*(['"])([^'"\n]+)\1/g;
for (const file of walk(SRC)) {
  const rel = relative(ROOT, file);
  const settingsScoped = rel.includes('/components/settings/') || rel.endsWith('/stores/settingsStore.ts');
  const code = readFileSync(file, 'utf8');
  for (const m of code.matchAll(KEY_RE)) {
    const key = m[2];
    const ok = enKeys.has(key) || (settingsScoped && enKeys.has(`settings.${key}`));
    if (!ok) {
      const line = code.slice(0, m.index).split('\n').length;
      console.error(`✗ ${rel}:${line}  clave inexistente en en.json: "${key}"`);
      errors++;
    }
  }
}

// 2 y 3. Cobertura de los demás idiomas
for (const name of readdirSync(LOCALES).filter((n) => n.endsWith('.json') && n !== 'en.json')) {
  const other = flatten(loadLang(name.replace(/\.json$/, '')));
  const missing = [...enKeys].filter((k) => !(k in other) && !k.startsWith('_meta.'));
  const orphan = Object.keys(other).filter((k) => !enKeys.has(k) && !k.startsWith('_meta.'));
  if (missing.length) {
    console[strict ? 'error' : 'warn'](`${strict ? '✗' : '!'} ${name}: faltan ${missing.length} claves de en.json`);
    for (const k of missing.slice(0, 40)) console.log(`    - ${k}`);
    if (missing.length > 40) console.log(`    … y ${missing.length - 40} más`);
    if (strict) errors++;
  }
  if (orphan.length) {
    console.warn(`! ${name}: ${orphan.length} claves huérfanas (no están en en.json)`);
    for (const k of orphan.slice(0, 20)) console.log(`    - ${k}`);
  }
}

console.log(errors ? `\n${errors} error(es)` : `✓ i18n OK — ${enKeys.size} claves en en.json`);
process.exit(errors ? 1 : 0);
