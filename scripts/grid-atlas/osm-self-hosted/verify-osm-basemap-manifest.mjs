#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectDirectory = path.resolve(scriptDirectory, '../../..');
const defaultManifestPath = path.join(
  projectDirectory,
  'data',
  'grid-atlas',
  'osm-basemap-manifest.json'
);
const defaultAssetRoot = path.join(
  projectDirectory,
  'data',
  'grid-atlas',
  'osm-basemap'
);
const releaseTag = 'osm-basemap-2026-07-25-schema1';
const archiveRoot = 'data/grid-atlas/osm-basemap';
const maximumTotalBytes = 190_000_000;
const regionOrder = [
  'europa',
  'estados-unidos',
  'china',
  'japon',
  'corea-del-sur',
  'taiwan'
];
const archiveOrder = ['world', ...regionOrder];
const worldLayers = [
  'base_land',
  'base_boundary',
  'base_water',
  'base_waterway',
  'base_urban'
];
const regionLayers = ['base_road', 'base_place'];

const usage = `Usage:
  node verify-osm-basemap-manifest.mjs [options]

Options:
  --manifest PATH    Manifest to validate
                     (default: data/grid-atlas/osm-basemap-manifest.json)
  --asset-root PATH  Directory containing the seven downloaded PMTiles assets
                     (default: data/grid-atlas/osm-basemap)
  --help             Show this help
`;

function parseArguments(values) {
  const parsed = {
    manifest: defaultManifestPath,
    assetRoot: defaultAssetRoot
  };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === '--help' || value === '-h') {
      parsed.help = true;
    } else if (value === '--manifest' || value === '--asset-root') {
      const next = values[index + 1];
      if (!next || next.startsWith('--')) {
        throw new Error(`Missing value for ${value}`);
      }
      if (value === '--manifest') parsed.manifest = path.resolve(next);
      else parsed.assetRoot = path.resolve(next);
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${value}`);
    }
  }
  return parsed;
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isInteger(value, minimum = 0) {
  return Number.isInteger(value) && value >= minimum;
}

function isSha256(value) {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const digest = createHash('sha256');
    const input = createReadStream(filePath);
    input.on('error', reject);
    input.on('data', chunk => digest.update(chunk));
    input.on('end', () => resolve(digest.digest('hex')));
  });
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 ** 2)).toFixed(1)} MiB`;
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  if (args.help) {
    console.log(usage);
    return;
  }
  const manifest = JSON.parse(await readFile(args.manifest, 'utf8'));
  const failures = [];
  const requireCondition = (condition, message) => {
    if (!condition) failures.push(message);
  };

  requireCondition(isObject(manifest), 'manifest root must be an object');
  if (!isObject(manifest)) throw new Error(failures.join('\n- '));
  requireCondition(manifest.schema_version === 1, 'schema_version must be 1');
  requireCondition(
    manifest.dataset === 'fecundidad-self-hosted-basemap',
    'dataset must be fecundidad-self-hosted-basemap'
  );
  requireCondition(manifest.release_tag === releaseTag, `release_tag must be ${releaseTag}`);
  requireCondition(manifest.archive_root === archiveRoot, `archive_root must be ${archiveRoot}`);
  requireCondition(manifest.complete === true, 'complete must be true');
  requireCondition(manifest.expected_archive_count === 7, 'expected_archive_count must be 7');
  requireCondition(manifest.archive_count === 7, 'archive_count must be 7');
  requireCondition(sameJson(manifest.archive_order, archiveOrder), 'archive_order is invalid');
  requireCondition(
    manifest.maximum_total_bytes === maximumTotalBytes,
    `maximum_total_bytes must be ${maximumTotalBytes}`
  );
  requireCondition(
    manifest.contracts?.world?.minzoom === 0 &&
      manifest.contracts?.world?.maxzoom === 8 &&
      sameJson(manifest.contracts?.world?.vector_layers, worldLayers),
    'world layer/zoom contract is invalid'
  );
  requireCondition(
    manifest.contracts?.region?.minzoom === 2 &&
    manifest.contracts?.region?.maxzoom === 9 &&
      sameJson(manifest.contracts?.region?.vector_layers, regionLayers),
    'regional layer/zoom contract is invalid'
  );
  requireCondition(Array.isArray(manifest.archives), 'archives must be an array');

  const archives = Array.isArray(manifest.archives) ? manifest.archives : [];
  requireCondition(archives.length === 7, 'archives must contain seven entries');
  const byKey = new Map();
  for (const archive of archives) {
    if (!isObject(archive)) {
      failures.push('every archive must be an object');
      continue;
    }
    if (byKey.has(archive.key)) failures.push(`duplicate archive key: ${archive.key}`);
    byKey.set(archive.key, archive);
  }

  let actualTotalBytes = 0;
  for (const key of archiveOrder) {
    const archive = byKey.get(key);
    if (!archive) {
      failures.push(`missing archive: ${key}`);
      continue;
    }
    const expectedKind = key === 'world' ? 'world' : 'region';
    const expectedAsset = key === 'world' ? 'world.pmtiles' : `${key}.pmtiles`;
    const expectedLayers = key === 'world' ? worldLayers : regionLayers;
    const expectedMinzoom = key === 'world' ? 0 : 2;
    const expectedMaxzoom = key === 'world' ? 8 : 9;
    const prefix = `${key}:`;

    requireCondition(archive.kind === expectedKind, `${prefix} kind must be ${expectedKind}`);
    requireCondition(archive.asset === expectedAsset, `${prefix} asset must be ${expectedAsset}`);
    requireCondition(
      archive.path === `${archiveRoot}/${expectedAsset}`,
      `${prefix} archive path is invalid`
    );
    requireCondition(
      archive.metadata_path === `${archiveRoot}/${expectedAsset}.metadata.json`,
      `${prefix} metadata path is invalid`
    );
    requireCondition(isInteger(archive.bytes, 1), `${prefix} bytes must be positive`);
    requireCondition(isSha256(archive.sha256), `${prefix} SHA-256 is invalid`);
    requireCondition(
      isInteger(archive.metadata_bytes, 1),
      `${prefix} metadata_bytes must be positive`
    );
    requireCondition(
      isSha256(archive.metadata_sha256),
      `${prefix} metadata SHA-256 is invalid`
    );
    requireCondition(archive.minzoom === expectedMinzoom, `${prefix} minzoom is invalid`);
    requireCondition(archive.maxzoom === expectedMaxzoom, `${prefix} maxzoom is invalid`);
    requireCondition(
      sameJson(archive.vector_layers, expectedLayers),
      `${prefix} vector layer contract is invalid`
    );

    const assetPath = path.join(args.assetRoot, expectedAsset);
    const metadataPath = `${assetPath}.metadata.json`;
    try {
      const details = await stat(assetPath);
      const digest = await hashFile(assetPath);
      actualTotalBytes += details.size;
      requireCondition(details.size === archive.bytes, `${prefix} downloaded byte count mismatch`);
      requireCondition(digest === archive.sha256, `${prefix} downloaded SHA-256 mismatch`);
    } catch (error) {
      failures.push(`${prefix} could not inspect downloaded asset: ${error.message}`);
    }
    try {
      const details = await stat(metadataPath);
      const digest = await hashFile(metadataPath);
      requireCondition(
        details.size === archive.metadata_bytes,
        `${prefix} metadata byte count mismatch`
      );
      requireCondition(
        digest === archive.metadata_sha256,
        `${prefix} metadata SHA-256 mismatch`
      );
    } catch (error) {
      failures.push(`${prefix} could not inspect metadata sidecar: ${error.message}`);
    }
  }

  requireCondition(
    manifest.total_bytes === actualTotalBytes,
    `total_bytes mismatch: manifest ${manifest.total_bytes}, downloaded ${actualTotalBytes}`
  );
  requireCondition(
    actualTotalBytes <= maximumTotalBytes,
    `context payload ${formatBytes(actualTotalBytes)} exceeds ${formatBytes(maximumTotalBytes)}`
  );
  if (failures.length) {
    throw new Error(`Basemap manifest verification failed:\n- ${failures.join('\n- ')}`);
  }
  console.log(
    `Verified ${archives.length} self-hosted basemap archives ` +
    `(${formatBytes(actualTotalBytes)} total).`
  );
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
