#!/usr/bin/env python3
"""Build the official Netherlands high-voltage line layer from TOP10NL.

PDOK's TOP10NL OGC API exposes ``inrichtingselement_lijn`` as cursor-paged
GeoJSON.  The API deliberately supports only ``lokaal_id`` as an attribute
query parameter, so there is no server-side filter for
``typeinrichtingselement=hoogspanningsleiding``.  This builder therefore:

1. covers the declared collection extent with a gap-free bbox grid and
   follows every partition's ``next`` cursor until it is exhausted;
2. selects the exact official value ``hoogspanningsleiding``;
3. deduplicates bbox-boundary intersections by stable TOP10NL identifier;
4. preserves original identifiers and source dates;
5. rounds coordinates to six decimals without line simplification; and
6. writes a deterministic GeoJSON plus a hash-recorded metadata sidecar.

No third-party Python package is required.  The builder tries Python's TLS
stack once and then pins itself to the platform ``curl`` client if local CA
configuration prevents urllib from reaching PDOK.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import shutil
import subprocess
import tempfile
import time
import urllib.parse
import urllib.request
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable


SOURCE_ID = "nl-kadaster-top10nl-high-voltage-2026-06"
PUBLISHER = "Kadaster (Basisregistratie Topografie)"
DATASET_TITLE = "BRT TOP10NL"
API_ROOT = "https://api.pdok.nl/kadaster/brt-top10nl/ogc/v1"
COLLECTION_ID = "inrichtingselement_lijn"
TARGET_TYPE = "hoogspanningsleiding"
SOURCE_UPDATE = "2026-06-01"
SOURCE_SCALE = "1:10,000"
LICENCE_NAME = "Creative Commons Attribution 4.0 International"
LICENCE_SHORT = "CC BY 4.0"
LICENCE_URL = "https://creativecommons.org/licenses/by/4.0/"
CATALOGUE_URL = "https://www.pdok.nl/introductie/-/article/basisregistratie-topografie-brt-topnl"
MAX_API_LIMIT = 1000
MAX_OUTPUT_BYTES = 10 * 1024 * 1024
COORDINATE_DECIMALS = 6


def parse_args() -> argparse.Namespace:
    project_root = Path(__file__).resolve().parents[2]
    output = (
        project_root
        / "data"
        / "grid-atlas"
        / "netherlands-official-grid.geojson"
    )
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--api-root",
        default=API_ROOT,
        help="TOP10NL OGC API root.",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=output,
        help=f"GeoJSON destination (default: {output}).",
    )
    parser.add_argument(
        "--metadata-output",
        type=Path,
        help="Metadata destination; defaults beside --output.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=MAX_API_LIMIT,
        help=f"Features per API page, 1-{MAX_API_LIMIT}.",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=180.0,
        help="Timeout per HTTP request in seconds.",
    )
    parser.add_argument(
        "--max-pages",
        type=int,
        help=(
            "Safety/debug limit for a serial, unpartitioned crawl. "
            "Omit for the required complete spatially partitioned crawl."
        ),
    )
    parser.add_argument(
        "--sleep",
        type=float,
        default=0.0,
        help="Optional pause between API pages in seconds.",
    )
    parser.add_argument(
        "--bbox-columns",
        type=int,
        default=8,
        help="Columns used to partition the official collection extent.",
    )
    parser.add_argument(
        "--bbox-rows",
        type=int,
        default=8,
        help="Rows used to partition the official collection extent.",
    )
    parser.add_argument(
        "--workers",
        type=int,
        default=8,
        help="Concurrent official bbox cursor crawls.",
    )
    return parser.parse_args()


def sha256_bytes(contents: bytes) -> str:
    return hashlib.sha256(contents).hexdigest()


def sha256_path(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def canonical_json_bytes(value: Any) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")


def portable_output_path(path: Path) -> str:
    project_root = Path(__file__).resolve().parents[2]
    try:
        return path.resolve().relative_to(project_root).as_posix()
    except ValueError:
        return path.name


class JsonFetcher:
    """Small JSON client that chooses one verified transport per run."""

    def __init__(self, timeout: float) -> None:
        self.timeout = timeout
        self.transport: str | None = None
        self.urllib_error: str | None = None

    @staticmethod
    def _request_headers() -> dict[str, str]:
        return {
            "Accept": "application/geo+json, application/json;q=0.9",
            "User-Agent": (
                "Comunicacion-Grid-Atlas/1.0 "
                "(+https://qdgvr.github.io/fecundidad.github.io/)"
            ),
        }

    def _urllib(self, url: str) -> bytes:
        request = urllib.request.Request(url, headers=self._request_headers())
        with urllib.request.urlopen(request, timeout=self.timeout) as response:
            return response.read()

    def _curl(self, url: str) -> bytes:
        curl = shutil.which("curl")
        if not curl:
            raise RuntimeError("curl is unavailable")
        result = subprocess.run(
            [
                curl,
                "--fail",
                "--location",
                "--silent",
                "--show-error",
                "--max-time",
                str(max(1, math.ceil(self.timeout))),
                "--header",
                "Accept: application/geo+json, application/json;q=0.9",
                "--user-agent",
                self._request_headers()["User-Agent"],
                url,
            ],
            check=True,
            stdout=subprocess.PIPE,
        )
        return result.stdout

    def get(self, url: str, attempts: int = 5) -> tuple[dict[str, Any], bytes]:
        last_error: Exception | None = None
        for attempt in range(attempts):
            try:
                if self.transport == "curl":
                    raw = self._curl(url)
                elif self.transport == "urllib":
                    raw = self._urllib(url)
                else:
                    try:
                        raw = self._urllib(url)
                        self.transport = "urllib"
                    except Exception as urllib_error:
                        self.urllib_error = str(urllib_error)
                        raw = self._curl(url)
                        self.transport = "curl"
                value = json.loads(raw)
                if not isinstance(value, dict):
                    raise ValueError("Expected a JSON object")
                return value, raw
            except Exception as error:
                last_error = error
                if attempt + 1 == attempts:
                    break
                time.sleep(min(8.0, 0.75 * (2**attempt)))
        raise RuntimeError(f"Could not fetch {url}: {last_error}") from last_error


def next_link(document: dict[str, Any]) -> str | None:
    for link in document.get("links", []):
        if isinstance(link, dict) and link.get("rel") == "next":
            href = link.get("href")
            if isinstance(href, str) and href.startswith("https://"):
                return href
    return None


def collection_updated(document: dict[str, Any]) -> str | None:
    updates = [
        link.get("updated")
        for link in document.get("links", [])
        if isinstance(link, dict) and isinstance(link.get("updated"), str)
    ]
    return max(updates) if updates else None


def official_collection_bbox(document: dict[str, Any]) -> list[float]:
    try:
        bbox = document["extent"]["spatial"]["bbox"][0]
    except (KeyError, IndexError, TypeError) as error:
        raise ValueError("TOP10NL collection has no declared spatial extent") from error
    if not isinstance(bbox, list) or len(bbox) != 4:
        raise ValueError(f"Unexpected TOP10NL collection extent: {bbox!r}")
    normalized = [finite_coordinate(value) for value in bbox]
    west, south, east, north = normalized
    if not west < east or not south < north:
        raise ValueError(f"Invalid TOP10NL collection extent: {normalized!r}")
    return normalized


def make_bbox_partitions(
    extent: list[float], columns: int, rows: int
) -> list[dict[str, Any]]:
    west, south, east, north = extent
    x_edges = [
        west + (east - west) * column / columns
        for column in range(columns + 1)
    ]
    y_edges = [
        south + (north - south) * row / rows
        for row in range(rows + 1)
    ]
    partitions: list[dict[str, Any]] = []
    for row in range(rows):
        for column in range(columns):
            partitions.append(
                {
                    "key": f"r{row + 1:02d}c{column + 1:02d}",
                    "row": row + 1,
                    "column": column + 1,
                    "bbox": [
                        x_edges[column],
                        y_edges[row],
                        x_edges[column + 1],
                        y_edges[row + 1],
                    ],
                }
            )
    return partitions


def crawl_partition(
    partition: dict[str, Any],
    collection_url: str,
    limit: int,
    timeout: float,
    sleep_seconds: float,
    preferred_transport: str | None,
    max_pages: int | None,
) -> dict[str, Any]:
    parameters: dict[str, Any] = {"f": "json", "limit": limit}
    bbox = partition.get("bbox")
    if isinstance(bbox, list):
        parameters["bbox"] = ",".join(f"{value:.12g}" for value in bbox)
    url: str | None = (
        f"{collection_url}/items?"
        + urllib.parse.urlencode(parameters, safe=",")
    )

    fetcher = JsonFetcher(timeout)
    if preferred_transport in {"curl", "urllib"}:
        fetcher.transport = preferred_transport
    page_count = 0
    scanned_feature_count = 0
    target_response_record_count = 0
    target_source_features: dict[str, dict[str, Any]] = {}
    source_type_counts: Counter[str] = Counter()
    source_timestamp_min: str | None = None
    source_timestamp_max: str | None = None
    source_page_digest = hashlib.sha256()
    seen_page_urls: set[str] = set()
    exhausted = False

    while url:
        if url in seen_page_urls:
            raise ValueError(
                f"PDOK cursor loop in partition {partition['key']} at {url}"
            )
        seen_page_urls.add(url)
        document, raw = fetcher.get(url)
        page_count += 1
        source_page_digest.update(hashlib.sha256(raw).digest())

        timestamp = document.get("timeStamp")
        if isinstance(timestamp, str):
            source_timestamp_min = (
                timestamp
                if source_timestamp_min is None
                else min(source_timestamp_min, timestamp)
            )
            source_timestamp_max = (
                timestamp
                if source_timestamp_max is None
                else max(source_timestamp_max, timestamp)
            )

        features = document.get("features")
        if not isinstance(features, list):
            raise ValueError(
                f"PDOK partition {partition['key']} page {page_count} "
                "has no features array"
            )
        reported = document.get("numberReturned")
        if reported != len(features):
            raise ValueError(
                f"PDOK partition {partition['key']} page {page_count} "
                f"numberReturned={reported!r}, but features={len(features)}"
            )

        for source_feature in features:
            if not isinstance(source_feature, dict):
                raise ValueError(
                    f"PDOK partition {partition['key']} has a non-object feature"
                )
            scanned_feature_count += 1
            properties = source_feature.get("properties")
            if not isinstance(properties, dict):
                raise ValueError("TOP10NL source feature has no properties object")
            source_type = properties.get("typeinrichtingselement")
            source_type_counts[str(source_type)] += 1
            if source_type != TARGET_TYPE:
                continue
            target_response_record_count += 1
            feature_id = source_feature.get("id")
            if not isinstance(feature_id, str) or not feature_id:
                raise ValueError("TOP10NL target feature has no stable id")
            previous = target_source_features.get(feature_id)
            if (
                previous is not None
                and canonical_json_bytes(previous)
                != canonical_json_bytes(source_feature)
            ):
                raise ValueError(f"Conflicting duplicate TOP10NL id {feature_id}")
            target_source_features[feature_id] = source_feature

        next_url = next_link(document)
        exhausted = next_url is None
        if page_count % 25 == 0 and not exhausted:
            print(
                f"PDOK partition={partition['key']} "
                f"pages={page_count:,} "
                f"scanned={scanned_feature_count:,} "
                f"target_records={target_response_record_count:,} "
                "status=running",
                flush=True,
            )
        if max_pages is not None and page_count >= max_pages and not exhausted:
            raise RuntimeError(
                "--max-pages stopped before collection exhaustion; "
                "no incomplete output was written"
            )
        url = next_url
        if url and sleep_seconds:
            time.sleep(sleep_seconds)

    return {
        **partition,
        "page_count": page_count,
        "scanned_feature_count": scanned_feature_count,
        "target_response_record_count": target_response_record_count,
        "target_source_features": target_source_features,
        "source_type_counts": source_type_counts,
        "source_timestamp_min": source_timestamp_min,
        "source_timestamp_max": source_timestamp_max,
        "page_response_digest_sha256": source_page_digest.hexdigest(),
        "cursor_exhausted": exhausted,
        "transport": fetcher.transport,
        "urllib_fallback_error": fetcher.urllib_error,
    }


def finite_coordinate(value: Any) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError) as error:
        raise ValueError(f"Non-numeric coordinate: {value!r}") from error
    if not math.isfinite(number):
        raise ValueError(f"Non-finite coordinate: {value!r}")
    return number


def normalize_line_geometry(geometry: Any, feature_id: str) -> dict[str, Any]:
    if not isinstance(geometry, dict) or geometry.get("type") != "LineString":
        raise ValueError(
            f"TOP10NL feature {feature_id} is not a LineString: "
            f"{geometry.get('type') if isinstance(geometry, dict) else geometry!r}"
        )
    coordinates = geometry.get("coordinates")
    if not isinstance(coordinates, list) or len(coordinates) < 2:
        raise ValueError(f"TOP10NL feature {feature_id} has fewer than two points")

    normalized: list[list[float]] = []
    for index, coordinate in enumerate(coordinates):
        if not isinstance(coordinate, list) or len(coordinate) < 2:
            raise ValueError(
                f"TOP10NL feature {feature_id} coordinate {index} is invalid"
            )
        longitude = finite_coordinate(coordinate[0])
        latitude = finite_coordinate(coordinate[1])
        if not (-180 <= longitude <= 180 and -90 <= latitude <= 90):
            raise ValueError(
                f"TOP10NL feature {feature_id} coordinate {index} is outside "
                "longitude/latitude bounds"
            )
        normalized.append(
            [
                round(longitude, COORDINATE_DECIMALS),
                round(latitude, COORDINATE_DECIMALS),
            ]
        )
    return {"type": "LineString", "coordinates": normalized}


def normalized_properties(
    feature_id: str, properties: dict[str, Any]
) -> dict[str, Any]:
    return {
        "REGION_KEY": "netherlands",
        "ASSET_KIND": "official_transmission_line",
        "SOURCE_ID": SOURCE_ID,
        "ORIGINAL_ID": feature_id,
        "LOCAL_ID": properties.get("lokaal_id"),
        "NAMESPACE": properties.get("namespace"),
        "TOP10NL_TYPE": properties.get("typeinrichtingselement"),
        "TOP10NL_CODE": properties.get("tdncode"),
        "VISUALISATION_CODE": properties.get("visualisatiecode"),
        "NAME": properties.get("naam"),
        "NUMBER": properties.get("nummer"),
        "HEIGHT_LEVEL": properties.get("hoogteniveau"),
        "SOURCE_FEATURE_DATE": properties.get("bronactualiteit"),
        "OBJECT_BEGIN_DATE": properties.get("objectbegintijd"),
        "REGISTRATION_DATE": properties.get("tijdstipregistratie"),
        "MUTATION_TYPE": properties.get("mutatietype"),
        "SOURCE_METHOD": properties.get("brontype"),
        "SOURCE_ACCURACY_M": properties.get("bronnauwkeurigheid"),
        "VOLTAGE_KV": None,
        "SOURCE_DATE": SOURCE_UPDATE,
        "SOURCE_URL": API_ROOT,
        "SOURCE_LICENSE": LICENCE_SHORT,
        "EVIDENCE": "official",
        "GEOMETRY_CONFIDENCE": (
            "official-top10nl-1:10000-rounded-6dp-no-simplification"
        ),
    }


def iter_coordinates(geometry: dict[str, Any]) -> Iterable[list[float]]:
    yield from geometry["coordinates"]


def feature_bounds(features: list[dict[str, Any]]) -> dict[str, float]:
    west = math.inf
    south = math.inf
    east = -math.inf
    north = -math.inf
    for feature in features:
        for longitude, latitude in iter_coordinates(feature["geometry"]):
            west = min(west, longitude)
            south = min(south, latitude)
            east = max(east, longitude)
            north = max(north, latitude)
    if not features or not all(math.isfinite(v) for v in (west, south, east, north)):
        raise ValueError("No finite target feature bounds were produced")
    return {"west": west, "south": south, "east": east, "north": north}


def write_atomic(path: Path, contents: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        prefix=f".{path.name}.", dir=path.parent, delete=False
    ) as temporary:
        temporary.write(contents)
        temporary_path = Path(temporary.name)
    temporary_path.replace(path)
    path.chmod(0o644)


def verify_output(
    output: Path,
    expected_count: int,
    expected_bounds: dict[str, float],
    expected_sha256: str,
) -> None:
    size = output.stat().st_size
    if size >= MAX_OUTPUT_BYTES:
        raise ValueError(
            f"{output} is {size:,} bytes; required maximum is "
            f"{MAX_OUTPUT_BYTES - 1:,} bytes"
        )
    if sha256_path(output) != expected_sha256:
        raise ValueError("Output SHA-256 changed between write and verification")
    document = json.loads(output.read_text(encoding="utf-8"))
    features = document.get("features")
    if not isinstance(features, list) or len(features) != expected_count:
        raise ValueError("Output feature count does not match the build count")
    actual_bounds = feature_bounds(features)
    if actual_bounds != expected_bounds:
        raise ValueError(
            f"Output bounds changed after serialization: {actual_bounds}"
        )
    ids = [feature.get("id") for feature in features]
    if len(ids) != len(set(ids)):
        raise ValueError("Output contains duplicate original feature IDs")


def build(args: argparse.Namespace) -> dict[str, Any]:
    if not 1 <= args.limit <= MAX_API_LIMIT:
        raise SystemExit(f"--limit must be between 1 and {MAX_API_LIMIT}")
    if args.max_pages is not None and args.max_pages < 1:
        raise SystemExit("--max-pages must be positive when provided")
    if args.sleep < 0:
        raise SystemExit("--sleep cannot be negative")
    if not 1 <= args.bbox_columns <= 32:
        raise SystemExit("--bbox-columns must be between 1 and 32")
    if not 1 <= args.bbox_rows <= 32:
        raise SystemExit("--bbox-rows must be between 1 and 32")
    if args.bbox_columns * args.bbox_rows > 256:
        raise SystemExit("The bbox partition grid cannot exceed 256 cells")
    if not 1 <= args.workers <= 16:
        raise SystemExit("--workers must be between 1 and 16")

    api_root = args.api_root.rstrip("/")
    collection_url = f"{api_root}/collections/{COLLECTION_ID}"

    fetcher = JsonFetcher(args.timeout)
    landing, _ = fetcher.get(f"{api_root}?f=json")
    collection, _ = fetcher.get(f"{collection_url}?f=json")

    licence_links = [
        link
        for link in landing.get("links", [])
        if isinstance(link, dict) and link.get("rel") == "license"
    ]
    if not any(
        link.get("title") == "CC BY 4.0"
        and str(link.get("href", "")).startswith(
            "https://creativecommons.org/licenses/by/4.0"
        )
        for link in licence_links
    ):
        raise ValueError("PDOK landing page no longer declares CC BY 4.0")

    collection_bbox = official_collection_bbox(collection)
    if args.max_pages is not None:
        partitions = [
            {
                "key": "full-collection-debug",
                "row": None,
                "column": None,
                "bbox": None,
            }
        ]
        worker_count = 1
    else:
        partitions = make_bbox_partitions(
            collection_bbox, args.bbox_columns, args.bbox_rows
        )
        worker_count = min(args.workers, len(partitions))

    partition_results: dict[str, dict[str, Any]] = {}
    with ThreadPoolExecutor(max_workers=worker_count) as executor:
        futures = {
            executor.submit(
                crawl_partition,
                partition,
                collection_url,
                args.limit,
                args.timeout,
                args.sleep,
                fetcher.transport,
                args.max_pages,
            ): partition["key"]
            for partition in partitions
        }
        for future in as_completed(futures):
            result = future.result()
            partition_results[result["key"]] = result
            print(
                f"PDOK partition={result['key']} "
                f"pages={result['page_count']:,} "
                f"scanned={result['scanned_feature_count']:,} "
                f"target_records={result['target_response_record_count']:,}",
                flush=True,
            )

    page_count = 0
    scanned_feature_count = 0
    target_response_record_count = 0
    duplicate_target_response_record_count = 0
    target_source_features: dict[str, dict[str, Any]] = {}
    source_type_counts: Counter[str] = Counter()
    source_timestamp_min: str | None = None
    source_timestamp_max: str | None = None
    partition_digest_records: list[dict[str, Any]] = []
    partition_metadata: list[dict[str, Any]] = []
    exhausted = True

    for key in sorted(partition_results):
        result = partition_results[key]
        page_count += result["page_count"]
        scanned_feature_count += result["scanned_feature_count"]
        target_response_record_count += result["target_response_record_count"]
        source_type_counts.update(result["source_type_counts"])
        timestamp_min = result["source_timestamp_min"]
        timestamp_max = result["source_timestamp_max"]
        if isinstance(timestamp_min, str):
            source_timestamp_min = (
                timestamp_min
                if source_timestamp_min is None
                else min(source_timestamp_min, timestamp_min)
            )
        if isinstance(timestamp_max, str):
            source_timestamp_max = (
                timestamp_max
                if source_timestamp_max is None
                else max(source_timestamp_max, timestamp_max)
            )
        exhausted = exhausted and bool(result["cursor_exhausted"])
        for feature_id, source_feature in result[
            "target_source_features"
        ].items():
            previous = target_source_features.get(feature_id)
            if previous is not None:
                duplicate_target_response_record_count += 1
                if canonical_json_bytes(previous) != canonical_json_bytes(
                    source_feature
                ):
                    raise ValueError(
                        f"Conflicting bbox duplicate TOP10NL id {feature_id}"
                    )
            else:
                target_source_features[feature_id] = source_feature
        digest_record = {
            "key": key,
            "bbox": result["bbox"],
            "page_count": result["page_count"],
            "page_response_digest_sha256": result[
                "page_response_digest_sha256"
            ],
        }
        partition_digest_records.append(digest_record)
        partition_metadata.append(
            {
                **digest_record,
                "row": result["row"],
                "column": result["column"],
                "scanned_response_record_count": result[
                    "scanned_feature_count"
                ],
                "target_response_record_count": result[
                    "target_response_record_count"
                ],
                "cursor_exhausted": result["cursor_exhausted"],
                "transport": result["transport"],
            }
        )

    source_page_digest = sha256_bytes(
        canonical_json_bytes(partition_digest_records)
    )

    if not exhausted:
        raise ValueError(
            "One or more PDOK spatial crawls did not terminate without a next link"
        )
    if not target_source_features:
        raise ValueError(f"No {TARGET_TYPE!r} features were found")

    source_subset = [
        target_source_features[feature_id]
        for feature_id in sorted(target_source_features)
    ]
    source_subset_sha256 = sha256_bytes(canonical_json_bytes(source_subset))

    output_features: list[dict[str, Any]] = []
    source_date_counts: Counter[str] = Counter()
    registration_date_counts: Counter[str] = Counter()
    for source_feature in source_subset:
        feature_id = source_feature["id"]
        properties = source_feature["properties"]
        normalized = {
            "type": "Feature",
            "id": feature_id,
            "geometry": normalize_line_geometry(
                source_feature.get("geometry"), feature_id
            ),
            "properties": normalized_properties(feature_id, properties),
        }
        output_features.append(normalized)
        source_date_counts[str(properties.get("bronactualiteit"))] += 1
        registration_date_counts[str(properties.get("tijdstipregistratie"))] += 1

    bounds = feature_bounds(output_features)
    output_document = {
        "type": "FeatureCollection",
        "name": "netherlands_official_grid",
        "source": {
            "id": SOURCE_ID,
            "publisher": PUBLISHER,
            "title": DATASET_TITLE,
            "api": api_root,
            "collection": COLLECTION_ID,
            "selected_type": TARGET_TYPE,
            "date": SOURCE_UPDATE,
            "licence": LICENCE_SHORT,
            "licence_url": LICENCE_URL,
        },
        "features": output_features,
    }
    output_bytes = canonical_json_bytes(output_document) + b"\n"
    if len(output_bytes) >= MAX_OUTPUT_BYTES:
        raise ValueError(
            f"Normalized Netherlands GeoJSON would be {len(output_bytes):,} "
            f"bytes, over the {MAX_OUTPUT_BYTES - 1:,}-byte limit"
        )
    output_sha256 = sha256_bytes(output_bytes)

    output = args.output.expanduser().resolve()
    metadata_output = (
        args.metadata_output.expanduser().resolve()
        if args.metadata_output
        else output.with_name(
            output.name.removesuffix(".geojson") + ".metadata.json"
        )
    )
    write_atomic(output, output_bytes)
    verify_output(output, len(output_features), bounds, output_sha256)

    metadata = {
        "schema_version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source": {
            "id": SOURCE_ID,
            "publisher": PUBLISHER,
            "title": DATASET_TITLE,
            "catalogue_url": CATALOGUE_URL,
            "api_root": api_root,
            "collection_id": COLLECTION_ID,
            "collection_url": collection_url,
            "collection_updated": collection_updated(collection),
            "declared_source_date": SOURCE_UPDATE,
            "update_frequency": "annual",
            "source_scale": SOURCE_SCALE,
            "source_collection_extent": collection.get("extent"),
            "source_storage_crs": collection.get("storageCrs"),
            "output_crs": "OGC:CRS84",
            "source_subset_sha256": source_subset_sha256,
            "partition_page_digest_manifest_sha256": source_page_digest,
            "api_timestamp_min": source_timestamp_min,
            "api_timestamp_max": source_timestamp_max,
            "transport": fetcher.transport,
            "urllib_fallback_error": fetcher.urllib_error,
        },
        "licence": {
            "name": LICENCE_NAME,
            "short_name": LICENCE_SHORT,
            "url": LICENCE_URL,
            "attribution_required": True,
            "commercial_use_permitted": True,
            "modification_permitted": True,
            "redistribution_permitted": True,
            "suggested_attribution": (
                "Kadaster, Basisregistratie Topografie (BRT) TOP10NL, "
                f"{SOURCE_UPDATE}, CC BY 4.0."
            ),
        },
        "selection": {
            "collection": COLLECTION_ID,
            "property": "typeinrichtingselement",
            "exact_value": TARGET_TYPE,
            "server_side_attribute_filter": False,
            "server_filter_note": (
                "The collection OpenAPI exposes bbox, cursor, limit, CRS and "
                "lokaal_id only. The builder covers the complete declared "
                "collection extent with a gap-free bbox grid, exhausts every "
                "partition cursor, deduplicates boundary intersections by "
                "stable feature ID, and applies the exact official type "
                "value locally."
            ),
            "page_limit": args.limit,
            "api_maximum_page_limit": MAX_API_LIMIT,
            "page_count": page_count,
            "cursor_exhausted": exhausted,
            "spatial_partitioning": {
                "enabled": args.max_pages is None,
                "declared_collection_bbox_crs84": collection_bbox,
                "columns": args.bbox_columns if args.max_pages is None else 1,
                "rows": args.bbox_rows if args.max_pages is None else 1,
                "worker_count": worker_count,
                "partition_count": len(partition_metadata),
                "partitions": partition_metadata,
            },
        },
        "transform": {
            "unit_of_observation": "one official TOP10NL LineString feature",
            "geometry": (
                "Source CRS84 vertices rounded to six decimal places; no "
                "simplification, smoothing, merging or inferred connectivity."
            ),
            "coordinate_decimal_places": COORDINATE_DECIMALS,
            "voltage": (
                "TOP10NL identifies high-voltage lines but publishes no "
                "numeric voltage; VOLTAGE_KV is intentionally null."
            ),
            "topology": (
                "Cartographic line geometry only; no electrical connectivity "
                "or circuit topology is inferred."
            ),
        },
        "property_schema": {
            "REGION_KEY": "Constant atlas region key: netherlands.",
            "ASSET_KIND": "Constant: official_transmission_line.",
            "SOURCE_ID": f"Stable builder source identifier: {SOURCE_ID}.",
            "ORIGINAL_ID": "Original stable OGC API feature UUID.",
            "LOCAL_ID": "Original TOP10NL lokaal_id.",
            "NAMESPACE": "Original TOP10NL namespace.",
            "TOP10NL_TYPE": "Original typeinrichtingselement.",
            "TOP10NL_CODE": "Original tdncode.",
            "VISUALISATION_CODE": "Original visualisatiecode.",
            "NAME": "Original optional name.",
            "NUMBER": "Original optional number.",
            "HEIGHT_LEVEL": "Original hoogteniveau.",
            "SOURCE_FEATURE_DATE": "Original bronactualiteit date.",
            "OBJECT_BEGIN_DATE": "Original objectbegintijd date.",
            "REGISTRATION_DATE": "Original tijdstipregistratie date.",
            "MUTATION_TYPE": "Original optional mutatietype.",
            "SOURCE_METHOD": "Original brontype.",
            "SOURCE_ACCURACY_M": "Original bronnauwkeurigheid in metres.",
            "VOLTAGE_KV": "Always null because TOP10NL does not publish voltage.",
            "SOURCE_DATE": f"Dataset snapshot date: {SOURCE_UPDATE}.",
            "SOURCE_URL": "Official TOP10NL OGC API root.",
            "SOURCE_LICENSE": f"Short reuse label: {LICENCE_SHORT}.",
            "EVIDENCE": "Constant evidence class: official.",
            "GEOMETRY_CONFIDENCE": (
                "Official cartographic scale and output transform statement."
            ),
        },
        "statistics": {
            "source_response_records_scanned": scanned_feature_count,
            "source_response_record_note": (
                "Counts include bbox-boundary intersections returned in more "
                "than one partition; selected output IDs are deduplicated."
            ),
            "source_type_counts": dict(sorted(source_type_counts.items())),
            "selected_response_record_count": target_response_record_count,
            "selected_feature_count": len(output_features),
            "duplicate_selected_bbox_records": target_response_record_count
            - len(output_features),
            "cross_partition_duplicate_selected_bbox_records": (
                duplicate_target_response_record_count
            ),
            "geometry_type_counts": {"LineString": len(output_features)},
            "source_feature_date_counts": dict(
                sorted(source_date_counts.items())
            ),
            "registration_date_counts": dict(
                sorted(registration_date_counts.items())
            ),
            "output_bounds_crs84": bounds,
        },
        "verification": {
            "all_partition_cursors_terminated_without_next_link": exhausted,
            "declared_collection_extent_covered_by_gap_free_bbox_grid": (
                args.max_pages is None
            ),
            "bbox_duplicate_ids_byte_identical": True,
            "output_json_reparsed": True,
            "feature_ids_unique": True,
            "feature_count_verified": len(output_features),
            "bounds_verified": bounds,
            "output_below_10_mib": len(output_bytes) < MAX_OUTPUT_BYTES,
        },
        "output": {
            "path": portable_output_path(output),
            "format": "RFC 7946 GeoJSON FeatureCollection",
            "feature_count": len(output_features),
            "size_bytes": len(output_bytes),
            "sha256": output_sha256,
        },
        "processing": {
            "script": "scripts/grid-atlas/build-netherlands-official-grid.py",
            "steps": [
                "Read and verify the OGC API landing-page CC BY 4.0 link.",
                "Read collection metadata and its snapshot update timestamp.",
                "Partition the complete declared extent into a gap-free bbox grid.",
                "Exhaust every bbox cursor at the API maximum of 1,000 items.",
                "Deduplicate bbox-boundary responses by stable original UUID.",
                "Select exact typeinrichtingselement=hoogspanningsleiding.",
                "Sort by original stable feature UUID for deterministic output.",
                "Round CRS84 vertices to six decimals without simplification.",
                "Write atomically and reparse to verify hash, count and bounds.",
            ],
        },
    }
    metadata_bytes = (
        json.dumps(
            metadata,
            ensure_ascii=False,
            indent=2,
            sort_keys=False,
            allow_nan=False,
        ).encode("utf-8")
        + b"\n"
    )
    if len(metadata_bytes) >= MAX_OUTPUT_BYTES:
        raise ValueError("Metadata unexpectedly exceeds the 10 MiB limit")
    write_atomic(metadata_output, metadata_bytes)
    return metadata


def main() -> None:
    metadata = build(parse_args())
    output = metadata["output"]
    bounds = metadata["statistics"]["output_bounds_crs84"]
    print(
        f"Wrote {output['feature_count']:,} official Netherlands lines to "
        f"{output['path']} ({output['size_bytes']:,} bytes, "
        f"sha256={output['sha256']})."
    )
    print(f"Bounds: {bounds}")


if __name__ == "__main__":
    main()
