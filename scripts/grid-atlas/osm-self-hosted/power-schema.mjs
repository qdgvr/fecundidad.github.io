export const LAYERS = Object.freeze([
  "power_line",
  "power_plant",
  "power_generator_area",
  "power_substation",
  "power_plant_point",
  "power_generator",
  "power_substation_point",
  "power_transformer",
  "power_switch",
  "power_compensator",
]);

export const FIXED_MINZOOMS = Object.freeze({
  power_plant: 8,
  power_generator_area: 12,
  power_substation: 12,
  power_plant_point: 5,
  power_generator: 9,
  power_substation_point: 5,
  power_transformer: 12,
  power_switch: 12,
  power_compensator: 12,
});

const AREA_CENTROID_MAXZOOM = 11;

const LINE_TYPES = new Set(["line", "minor_line", "cable", "minor_cable", "line_section"]);
const AREA_OR_POINT_TYPES = new Set(["plant", "generator", "substation"]);
const EQUIPMENT_TYPES = new Set(["transformer", "switch", "compensator"]);
const EXCLUDED_POWER_TYPES = new Set([
  "tower",
  "pole",
  "portal",
  "terminal",
  "insulator",
  "marker",
  "connection",
  "bay",
  "busbar",
  "catenary_mast",
]);
const LIFECYCLE_STATES = [
  "construction",
  "planned",
  "proposed",
  "disused",
  "abandoned",
  "decommissioned",
  "demolished",
  "removed",
  "razed",
  "destroyed",
];
const TYPE_ALIASES = new Map([
  ["minorline", "minor_line"],
  ["minor-line", "minor_line"],
  ["minorcable", "minor_cable"],
  ["minor-cable", "minor_cable"],
  ["station", "substation"],
  ["sub_station", "substation"],
]);

const POPUP_TAGS = new Set([
  "name",
  "operator",
  "owner",
  "ref",
  "circuits",
  "cables",
  "wires",
  "line",
  "location",
  "tunnel",
  "bridge",
  "substation",
  "generator:type",
  "plant:type",
  "start_date",
  "commissioning_date",
  "decommissioning_date",
  "website",
  "wikidata",
  "wikipedia",
  "network",
  "route",
  "rating",
  "windings",
  "phases",
  "gas_insulated",
  "switch",
  "transformer",
  "compensator",
  "voltage:primary",
  "voltage:secondary",
  "voltage:tertiary",
]);

function text(value) {
  if (value === null || value === undefined) return undefined;
  const result = String(value).trim();
  return result || undefined;
}

function normalizeType(value) {
  const normalized = text(value)?.toLowerCase().replace(/\s+/g, "_");
  if (!normalized) return undefined;
  return TYPE_ALIASES.get(normalized) ?? normalized;
}

function truthyTag(value) {
  const normalized = text(value)?.toLowerCase();
  return normalized === "yes" || normalized === "true" || normalized === "1";
}

function lifecycleDescriptor(tags) {
  const direct = normalizeType(tags.power);
  if (
    direct &&
    (LINE_TYPES.has(direct) ||
      AREA_OR_POINT_TYPES.has(direct) ||
      EQUIPMENT_TYPES.has(direct))
  ) {
    let status = "active";
    for (const state of LIFECYCLE_STATES) {
      if (truthyTag(tags[state])) {
        status = state;
        break;
      }
    }
    return { type: direct, status };
  }

  if (direct && LIFECYCLE_STATES.includes(direct)) {
    const nested =
      normalizeType(tags[direct]) ?? normalizeType(tags[`${direct}:power`]);
    if (nested) return { type: nested, status: direct };
  }

  for (const state of LIFECYCLE_STATES) {
    const nested = normalizeType(tags[`${state}:power`]);
    if (nested) return { type: nested, status: state };
  }

  return direct ? { type: direct, status: "active" } : undefined;
}

function numberFromString(raw) {
  const normalized = raw.replace(/(\d),(\d)/g, "$1.$2").replace(/\s+/g, "");
  const match = normalized.match(/^([-+]?\d+(?:\.\d+)?)([a-zA-Z]*)$/);
  if (!match) return undefined;
  const value = Number(match[1]);
  return Number.isFinite(value) ? { value, unit: match[2].toLowerCase() } : undefined;
}

export function parseVoltages(...rawValues) {
  const values = [];
  for (const rawValue of rawValues) {
    const raw = text(rawValue);
    if (!raw) continue;
    for (const token of raw.split(/[;|]/)) {
      const parsed = numberFromString(token.trim());
      if (!parsed || parsed.value <= 0) continue;
      let kilovolts;
      if (!parsed.unit || parsed.unit === "v" || parsed.unit === "volt" || parsed.unit === "volts") {
        kilovolts = parsed.value / 1000;
      } else if (
        parsed.unit === "kv" ||
        parsed.unit === "kilovolt" ||
        parsed.unit === "kilovolts"
      ) {
        kilovolts = parsed.value;
      } else if (parsed.unit === "mv") {
        kilovolts = parsed.value * 1000;
      } else {
        continue;
      }
      const rounded = Number(kilovolts.toFixed(6));
      if (!values.some((value) => Math.abs(value - rounded) < 1e-9)) {
        values.push(rounded);
      }
    }
  }
  return values.slice(0, 4);
}

export function parseFrequency(rawValue) {
  const raw = text(rawValue);
  if (!raw) return undefined;
  for (const token of raw.split(/[;|]/)) {
    const parsed = numberFromString(token.trim());
    if (!parsed || parsed.value < 0) continue;
    if (!parsed.unit || parsed.unit === "hz") return parsed.value;
    if (parsed.unit === "khz") return parsed.value * 1000;
  }
  return undefined;
}

export function parseOutputMegawatts(rawValue) {
  const raw = text(rawValue);
  if (!raw) return undefined;
  for (const token of raw.split(/[;|]/)) {
    const parsed = numberFromString(token.trim());
    if (!parsed || parsed.value < 0) continue;
    const multipliers = {
      "": 1 / 1_000_000,
      w: 1 / 1_000_000,
      kw: 1 / 1000,
      mw: 1,
      gw: 1000,
      tw: 1_000_000,
    };
    const multiplier = multipliers[parsed.unit];
    if (multiplier !== undefined) {
      return Number((parsed.value * multiplier).toFixed(6));
    }
  }
  return undefined;
}

function normalizeOsmType(value) {
  const raw = text(value)?.toLowerCase();
  if (!raw) return undefined;
  if (raw === "n" || raw === "node") return "node";
  if (raw === "w" || raw === "way") return "way";
  if (raw === "r" || raw === "relation") return "relation";
  return undefined;
}

function parseCombinedIdentity(value) {
  const raw = text(value);
  if (!raw) return {};
  const match = raw.match(/^(node|way|relation)[/:_-]?(\d+)$/i) ?? raw.match(/^([nwr])(\d+)$/i);
  if (!match) return /^\d+$/.test(raw) ? { id: raw } : {};
  return { type: normalizeOsmType(match[1]), id: match[2] };
}

function safeOsmId(value) {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return value;
  const raw = text(value);
  if (!raw) return undefined;
  const parsed = parseCombinedIdentity(raw).id ?? raw;
  if (!/^\d+$/.test(parsed) || parsed === "0") return undefined;
  const numeric = Number(parsed);
  return Number.isSafeInteger(numeric) ? numeric : parsed;
}

export function extractOsmIdentity(feature) {
  const tags = feature?.properties ?? {};
  let type = normalizeOsmType(tags["@type"] ?? tags.osm_type);
  let id = safeOsmId(tags["@id"] ?? tags.osm_id);

  for (const candidate of [feature?.id, tags["@id"], tags.id]) {
    const combined = parseCombinedIdentity(candidate);
    type ??= combined.type;
    id ??= safeOsmId(combined.id);
  }

  return { type, id };
}

function layerFor(type, geometryType) {
  const isPoint = geometryType === "Point" || geometryType === "MultiPoint";
  const isArea = geometryType === "Polygon" || geometryType === "MultiPolygon";
  const isLine = geometryType === "LineString" || geometryType === "MultiLineString";

  if (LINE_TYPES.has(type)) return isLine ? "power_line" : undefined;
  if (type === "plant") {
    if (isArea) return "power_plant";
    if (isPoint) return "power_plant_point";
  }
  if (type === "generator") {
    if (isArea) return "power_generator_area";
    if (isPoint) return "power_generator";
  }
  if (type === "substation") {
    if (isArea) return "power_substation";
    if (isPoint) return "power_substation_point";
  }
  if (EQUIPMENT_TYPES.has(type) && (isPoint || isArea)) {
    return `power_${type}`;
  }
  return undefined;
}

function isDuplicateAreaRepresentation(type, geometry, tags, identity) {
  if (
    identity.type !== "way" ||
    geometry.type !== "LineString" ||
    (!AREA_OR_POINT_TYPES.has(type) && !EQUIPMENT_TYPES.has(type)) ||
    text(tags.area)?.toLowerCase() === "no"
  ) {
    return false;
  }
  const coordinates = geometry.coordinates;
  if (!Array.isArray(coordinates) || coordinates.length < 4) return false;
  const first = coordinates[0];
  const last = coordinates[coordinates.length - 1];
  return (
    Array.isArray(first) &&
    Array.isArray(last) &&
    first.length >= 2 &&
    last.length >= 2 &&
    first[0] === last[0] &&
    first[1] === last[1]
  );
}

function geometryBboxCenter(geometry) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  function visit(value) {
    if (
      Array.isArray(value) &&
      value.length >= 2 &&
      typeof value[0] === "number" &&
      typeof value[1] === "number"
    ) {
      minX = Math.min(minX, value[0]);
      minY = Math.min(minY, value[1]);
      maxX = Math.max(maxX, value[0]);
      maxY = Math.max(maxY, value[1]);
      return;
    }
    if (Array.isArray(value)) value.forEach(visit);
  }

  visit(geometry.coordinates);
  if (![minX, minY, maxX, maxY].every(Number.isFinite)) return undefined;
  return { type: "Point", coordinates: [(minX + maxX) / 2, (minY + maxY) / 2] };
}

function ringCentroid(ring) {
  if (!Array.isArray(ring) || ring.length < 4) return undefined;
  let crossSum = 0;
  let xSum = 0;
  let ySum = 0;
  for (let index = 0; index < ring.length - 1; index += 1) {
    const current = ring[index];
    const next = ring[index + 1];
    if (
      !Array.isArray(current) ||
      !Array.isArray(next) ||
      !Number.isFinite(current[0]) ||
      !Number.isFinite(current[1]) ||
      !Number.isFinite(next[0]) ||
      !Number.isFinite(next[1])
    ) {
      return undefined;
    }
    const cross = current[0] * next[1] - next[0] * current[1];
    crossSum += cross;
    xSum += (current[0] + next[0]) * cross;
    ySum += (current[1] + next[1]) * cross;
  }
  if (Math.abs(crossSum) < 1e-14) return undefined;
  return {
    area: Math.abs(crossSum) / 2,
    x: xSum / (3 * crossSum),
    y: ySum / (3 * crossSum),
  };
}

function polygonCentroid(geometry) {
  const polygons = geometry.type === "Polygon"
    ? [geometry.coordinates]
    : geometry.type === "MultiPolygon"
      ? geometry.coordinates
      : [];
  let totalWeight = 0;
  let weightedX = 0;
  let weightedY = 0;

  for (const polygon of polygons) {
    if (!Array.isArray(polygon) || !polygon.length) continue;
    for (let index = 0; index < polygon.length; index += 1) {
      const centroid = ringCentroid(polygon[index]);
      if (!centroid) continue;
      const weight = centroid.area * (index === 0 ? 1 : -1);
      totalWeight += weight;
      weightedX += centroid.x * weight;
      weightedY += centroid.y * weight;
    }
  }

  if (
    totalWeight > 1e-14 &&
    Number.isFinite(weightedX) &&
    Number.isFinite(weightedY)
  ) {
    return {
      type: "Point",
      coordinates: [weightedX / totalWeight, weightedY / totalWeight],
    };
  }
  return geometryBboxCenter(geometry);
}

function energyTag(tags, suffix) {
  return (
    text(tags[`generator:${suffix}`]) ??
    text(tags[`plant:${suffix}`]) ??
    text(tags[suffix])
  );
}

function popupProperties(tags) {
  const output = {};
  for (const [key, value] of Object.entries(tags)) {
    const isLocalizedName = /^name:[a-z0-9_-]+$/i.test(key);
    const isOperatorReference = /^(operator|ref):[a-z0-9_-]+$/i.test(key);
    if (!POPUP_TAGS.has(key) && !isLocalizedName && !isOperatorReference) continue;
    if (["string", "number", "boolean"].includes(typeof value) && text(value) !== undefined) {
      output[key] = value;
    }
  }
  return output;
}

function lineMinzoom(properties) {
  if (properties.frequency === 0) return 2;
  const voltage = properties.voltage;
  if (typeof voltage !== "number") return 11;
  if (voltage > 199) return 2;
  if (voltage > 99) return 4;
  if (voltage > 49) return 5;
  if (voltage > 24) return 6;
  if (voltage > 9) return 9;
  return 11;
}

export function featureMinzoom(layer, properties) {
  return layer === "power_line" ? lineMinzoom(properties) : FIXED_MINZOOMS[layer];
}

export function normalizePowerFeature(feature) {
  if (!feature || feature.type !== "Feature" || !feature.geometry) {
    return { skipReason: "invalid_feature" };
  }

  const tags = feature.properties ?? {};
  const descriptor = lifecycleDescriptor(tags);
  const identity = extractOsmIdentity(feature);

  if (!descriptor) {
    const hasPowerTags = Object.keys(tags).some(
      (key) => key === "power" || key.endsWith(":power"),
    );
    return {
      skipReason:
        identity.type === "node" && !hasPowerTags ? "reference_node" : "unclassified",
    };
  }
  if (EXCLUDED_POWER_TYPES.has(descriptor.type)) {
    return { skipReason: "excluded_support" };
  }

  let geometry = feature.geometry;
  if (isDuplicateAreaRepresentation(descriptor.type, geometry, tags, identity)) {
    return { skipReason: "duplicate_area_representation" };
  }
  const layer = layerFor(descriptor.type, geometry.type);
  if (!layer) return { skipReason: "unsupported_geometry" };
  if (!identity.type || identity.id === undefined) {
    return { skipReason: "missing_osm_identity" };
  }

  let geometryReducedFrom;
  if (
    EQUIPMENT_TYPES.has(descriptor.type) &&
    (geometry.type === "Polygon" || geometry.type === "MultiPolygon")
  ) {
    geometryReducedFrom = geometry.type;
    geometry = geometryBboxCenter(geometry);
    if (!geometry) return { skipReason: "invalid_geometry" };
  }

  const properties = popupProperties(tags);
  properties.type = descriptor.type;
  if (descriptor.status !== "active") properties.status = descriptor.status;
  if (["construction", "planned", "proposed"].includes(descriptor.status)) {
    properties.construction = true;
  }
  if (
    ["disused", "abandoned", "decommissioned", "demolished", "removed", "razed", "destroyed"]
      .includes(descriptor.status)
  ) {
    properties.disused = true;
  }

  const voltages = parseVoltages(
    tags.voltage,
    tags["voltage:primary"],
    tags["voltage:secondary"],
    tags["voltage:tertiary"],
  );
  voltages.sort((first, second) => second - first).forEach((value, index) => {
    properties[index === 0 ? "voltage" : `voltage_${index + 1}`] = value;
  });

  const primaryVoltage = parseVoltages(tags["voltage:primary"], tags.voltage_primary)[0];
  const secondaryVoltage = parseVoltages(tags["voltage:secondary"], tags.voltage_secondary)[0];
  const tertiaryVoltage = parseVoltages(tags["voltage:tertiary"], tags.voltage_tertiary)[0];
  if (primaryVoltage !== undefined) properties.voltage_primary = primaryVoltage;
  if (secondaryVoltage !== undefined) properties.voltage_secondary = secondaryVoltage;
  if (tertiaryVoltage !== undefined) properties.voltage_tertiary = tertiaryVoltage;

  const frequency = parseFrequency(tags.frequency);
  if (frequency !== undefined) properties.frequency = frequency;

  const output = parseOutputMegawatts(
    tags["generator:output:electricity"] ??
      tags["plant:output:electricity"] ??
      tags["output:electricity"] ??
      tags.output,
  );
  if (output !== undefined) properties.output = output;

  for (const suffix of ["source", "method", "storage"]) {
    const value = energyTag(tags, suffix);
    if (value !== undefined) properties[suffix] = value;
  }

  const transformerType = text(tags.transformer ?? tags["transformer:type"]);
  const switchType = text(tags.switch ?? tags["switch:type"]);
  const compensatorType = text(tags.compensator ?? tags["compensator:type"]);
  if (transformerType) properties.transformer_type = transformerType;
  if (switchType) properties.switch_type = switchType;
  if (compensatorType) properties.compensator_type = compensatorType;
  for (const key of ["rating", "windings", "phases"]) {
    const value = text(tags[key]);
    if (value !== undefined) properties[key] = value;
  }
  if (truthyTag(tags.tunnel)) properties.tunnel = true;
  if (truthyTag(tags.gas_insulated)) properties.gas_insulated = true;

  if (identity.type === "relation") properties.osm_id = identity.id;
  properties.osm_type = identity.type;

  const normalized = {
    type: "Feature",
    ...(
      typeof identity.id === "number" && identity.type !== "relation"
        ? { id: identity.id }
        : {}
    ),
    geometry,
    properties,
    tippecanoe: { minzoom: featureMinzoom(layer, properties) },
  };
  const centroidLayer = {
    power_plant: "power_plant_point",
    power_generator_area: "power_generator",
    power_substation: "power_substation_point",
  }[layer];
  const companions = [];
  if (centroidLayer) {
    const centroid = polygonCentroid(geometry);
    if (centroid) {
      companions.push({
        layer: centroidLayer,
        feature: {
          type: "Feature",
          ...(
            typeof identity.id === "number" && identity.type !== "relation"
              ? { id: identity.id }
              : {}
          ),
          geometry: centroid,
          properties: { ...properties },
          tippecanoe: {
            minzoom: featureMinzoom(centroidLayer, properties),
            maxzoom: AREA_CENTROID_MAXZOOM,
          },
        },
      });
    }
  }
  return {
    feature: normalized,
    layer,
    companions,
    status: descriptor.status,
    geometryReducedFrom,
  };
}

export function stripRecordSeparator(line) {
  return line.replace(/^\s*\u001e?/, "").trim();
}
