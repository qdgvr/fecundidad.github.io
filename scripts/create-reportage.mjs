#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(scriptDir, '..');
const args = process.argv.slice(2);
const slug = args.find((arg) => !arg.startsWith('--'));
const dryRun = args.includes('--dry-run');

if (!slug || !/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
  console.error('Uso: node scripts/create-reportage.mjs <slug> [--dry-run]');
  console.error('El slug solo puede contener letras minúsculas, números y guiones.');
  process.exit(1);
}

const sourcePath = join(rootDir, 'index.html');
const examplePath = join(rootDir, 'content', 'article.example.js');
const pagePath = join(rootDir, `${slug}.html`);
const configPath = join(rootDir, 'content', `${slug}.js`);
const marker = '<!-- REPORTAGE_TEMPLATE_RUNTIME -->';

const source = readFileSync(sourcePath, 'utf8');
if (!source.includes(marker)) {
  console.error(`No se encontró el marcador de plantilla en ${sourcePath}`);
  process.exit(1);
}

if (!dryRun && (existsSync(pagePath) || existsSync(configPath))) {
  console.error(`Ya existe una página o configuración para "${slug}".`);
  process.exit(1);
}

const templateScripts = [
  `<script src="content/${slug}.js"></script>`,
  '<script src="article-template.js?v=editor-1"></script>'
].join('\n  ');

const page = source.replace(marker, templateScripts);
const config = readFileSync(examplePath, 'utf8').replaceAll('__SLUG__', slug);

if (!page.includes(`content/${slug}.js`) || !page.includes('article-template.js')) {
  console.error('La página generada no contiene los scripts de plantilla esperados.');
  process.exit(1);
}

if (dryRun) {
  console.log(`Comprobación correcta: ${slug}.html + content/${slug}.js`);
  process.exit(0);
}

mkdirSync(join(rootDir, 'content'), { recursive: true });
writeFileSync(pagePath, page, 'utf8');
writeFileSync(configPath, config, 'utf8');

console.log(`Creado: ${pagePath}`);
console.log(`Creado: ${configPath}`);
console.log('Edite únicamente el archivo de configuración para sustituir el contenido.');
