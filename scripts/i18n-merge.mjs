#!/usr/bin/env node
/**
 * Fusiona fragmentos `src/locales/_fragments/<nombre>.<lang>.json` dentro de
 * `src/locales/<lang>.json` (fusión profunda; el fragmento gana) y los elimina.
 * Herramienta de migración: permite que varias personas/agentes añadan espacios de
 * nombres en paralelo sin pisarse el mismo archivo.
 */
import { readFileSync, writeFileSync, readdirSync, unlinkSync, existsSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';

const LOCALES = new URL('../src/locales/', import.meta.url).pathname;
const FRAGMENTS = join(LOCALES, '_fragments');
if (!existsSync(FRAGMENTS)) {
  console.log('Sin fragmentos que fusionar.');
  process.exit(0);
}
function deepMerge(target, source, path = '') {
  for (const [k, v] of Object.entries(source)) {
    const p = path ? `${path}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if (target[k] !== undefined && typeof target[k] !== 'object') {
        throw new Error(`Conflicto: "${p}" es texto en destino y objeto en el fragmento`);
      }
      target[k] = deepMerge(target[k] ?? {}, v, p);
    } else {
      if (target[k] && typeof target[k] === 'object') {
        throw new Error(`Conflicto: "${p}" es objeto en destino y texto en el fragmento`);
      }
      target[k] = v;
    }
  }
  return target;
}
const files = readdirSync(FRAGMENTS).filter((f) => f.endsWith('.json')).sort();
const byLang = new Map();
for (const f of files) {
  const m = /^(.+)\.([a-z]{2,3}(?:-[a-z]{2,4})?)\.json$/i.exec(f);
  if (!m) {
    console.warn(`Ignorado (nombre inesperado): ${f}`);
    continue;
  }
  const lang = m[2].toLowerCase();
  if (!byLang.has(lang)) byLang.set(lang, []);
  byLang.get(lang).push(f);
}
for (const [lang, frags] of byLang) {
  const target = join(LOCALES, `${lang}.json`);
  const base = existsSync(target) ? JSON.parse(readFileSync(target, 'utf8')) : {};
  for (const f of frags) {
    deepMerge(base, JSON.parse(readFileSync(join(FRAGMENTS, f), 'utf8')));
    console.log(`  + ${f} → ${lang}.json`);
  }
  writeFileSync(target, JSON.stringify(base, null, 2) + '\n');
}
for (const f of files) unlinkSync(join(FRAGMENTS, f));
try { rmdirSync(FRAGMENTS); } catch { /* quedan archivos no-json */ }
console.log('Fusión completada.');
