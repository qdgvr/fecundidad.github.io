import { readFile } from 'node:fs/promises';

const registryUrl = new URL('../../data/grid-atlas/source-registry.json', import.meta.url);
const registry = JSON.parse(await readFile(registryUrl, 'utf8'));
const regionKeys = new Set([
  'europa',
  'estados-unidos',
  'china',
  'japon',
  'corea-del-sur',
  'taiwan'
]);
const sourceClasses = new Set(registry.method?.source_classes || []);
const evidenceLevels = new Set(registry.method?.evidence_levels || []);
const required = [
  'id',
  'regions',
  'source_class',
  'evidence_level',
  'publisher',
  'title',
  'coverage',
  'date',
  'licence',
  'url',
  'integration_status',
  'redistribution'
];

const errors = [];
const ids = new Set();

for (const [index, source] of (registry.sources || []).entries()) {
  for (const field of required) {
    if (
      source[field] === undefined ||
      source[field] === null ||
      (typeof source[field] === 'string' && !source[field].trim()) ||
      (Array.isArray(source[field]) && source[field].length === 0)
    ) {
      errors.push(`sources[${index}] is missing ${field}`);
    }
  }

  if (ids.has(source.id)) errors.push(`duplicate source id: ${source.id}`);
  ids.add(source.id);

  if (!sourceClasses.has(source.source_class)) {
    errors.push(`${source.id}: unknown source_class ${source.source_class}`);
  }
  if (!evidenceLevels.has(source.evidence_level)) {
    errors.push(`${source.id}: unknown evidence_level ${source.evidence_level}`);
  }
  for (const region of source.regions || []) {
    if (!regionKeys.has(region)) errors.push(`${source.id}: unknown region ${region}`);
  }

  try {
    new URL(source.url);
    if (source.endpoint) new URL(source.endpoint.replaceAll('{z}', '0').replaceAll('{x}', '0').replaceAll('{y}', '0'));
  } catch {
    errors.push(`${source.id}: invalid URL`);
  }
}

for (const region of regionKeys) {
  const activeOrCatalogued = (registry.sources || []).some(source => source.regions?.includes(region));
  if (!activeOrCatalogued) errors.push(`no source registered for region ${region}`);
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Validated ${registry.sources.length} grid-atlas sources across ${regionKeys.size} regions.`);
}
