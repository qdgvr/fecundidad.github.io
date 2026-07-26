#!/usr/bin/env python3
"""Build Taipower's transformer hosting-capacity points as compact GeoJSON.

The official d077009 ZIP contains two files per service area:

* ``*_capacity.csv`` maps FEEDER to available hosting CAPACITY in kW.
* ``*_tr_feeder.csv`` maps transformer ROWNUM and TWD67 X/Y to FEEDER.

This script joins those files, converts valid TWD67 / TM2 zone 121 coordinates
(EPSG:3828) to web-map longitude/latitude, and writes:

* ``data/grid-atlas/taiwan-hosting-capacity.geojson``
* ``data/grid-atlas/taiwan-hosting-capacity-display.geojson``
* ``data/grid-atlas/taiwan-hosting-capacity.metadata.json``

No third-party Python package is required. If Python's TLS stack rejects the
source server's certificate chain, the script falls back to the platform
``curl`` client without disabling certificate verification. The compact
one-letter feature property names keep the complete 500k+ point source below
GitHub's 100 MB single-file limit; their meanings are documented in the
metadata sidecar.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import math
import os
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Any, Iterable


DATASET_ID = "d077009"
DATASET_PORTAL_URL = "https://data.gov.tw/dataset/161874"
DOWNLOAD_URL = (
    "https://service.taipower.com.tw/data/opendata/apply/file/d077009/001.zip"
)
LICENCE_NAME = "Taiwan Open Government Data License, version 1.0"
LICENCE_URL = "https://data.gov.tw/license"
SOURCE_ID = "taipower-d077009"
SOURCE_DATE = "2026-04-27"
SOURCE_LICENSE_SHORT = "OGDL 1.0"

SOURCE_CRS = "EPSG:3828"
INTERMEDIATE_CRS = "EPSG:3826"
OUTPUT_CRS = "OGC:CRS84"
DISPLAY_GRID_MICRODEGREES = 20_000
DISPLAY_GRID_DEGREES = DISPLAY_GRID_MICRODEGREES / 1_000_000
FEEDER_PLACEHOLDERS = {"", "無"}

# EPSG:3828 projected area-of-use bounds for Taiwan Island. Values outside
# these limits are retained with null geometry instead of being silently
# discarded or plotted in a false location.
SOURCE_AREA_BOUNDS = {
    "min_x": 145_616.57,
    "min_y": 2_419_172.28,
    "max_x": 359_551.35,
    "max_y": 2_803_869.61,
}

# Published two-dimensional TWD67 -> TWD97 approximation. The source plane
# coordinates are adjusted first, then inverse-projected from EPSG:3826.
TWD_A = 0.00001549
TWD_B = 0.000006521
TWD_X_OFFSET_M = 807.8
TWD_Y_OFFSET_M = -248.6

# TWD97 / TM2 zone 121 (EPSG:3826): GRS80 Transverse Mercator.
GRS80_SEMI_MAJOR_M = 6_378_137.0
GRS80_INVERSE_FLATTENING = 298.257222101
TM2_CENTRAL_MERIDIAN_DEG = 121.0
TM2_SCALE_FACTOR = 0.9999
TM2_FALSE_EASTING_M = 250_000.0
TM2_FALSE_NORTHING_M = 0.0

PROPERTY_SCHEMA = {
    "a": {
        "title": "source_area",
        "type": "string",
        "description": "Uppercase area prefix shared by the two source CSV files.",
    },
    "f": {
        "title": "feeder",
        "type": "string",
        "description": "Original FEEDER identifier.",
    },
    "c": {
        "title": "hosting_capacity_kw",
        "type": ["number", "null"],
        "description": (
            "CAPACITY joined from the area's capacity CSV, in kW; null when "
            "the source point's feeder has no matching capacity row."
        ),
    },
    "r": {
        "title": "source_rownum",
        "type": ["integer", "string"],
        "description": "Original ROWNUM value.",
    },
    "x": {
        "title": "source_twd67_x_m",
        "type": ["number", "null"],
        "description": "Original TWD67 / TM2 zone 121 X coordinate in metres.",
    },
    "y": {
        "title": "source_twd67_y_m",
        "type": ["number", "null"],
        "description": "Original TWD67 / TM2 zone 121 Y coordinate in metres.",
    },
    "q": {
        "title": "coordinate_quality",
        "type": "string",
        "description": (
            "Present only when geometry is null: invalid_source_coordinate."
        ),
    },
}

DISPLAY_PROPERTY_SCHEMA = {
    "REGION_KEY": "Constant region key: taiwan.",
    "ASSET_KIND": "Constant display asset type: hosting_cluster.",
    "SOURCE_ID": f"Stable source identifier: {SOURCE_ID}.",
    "POINT_COUNT": "Valid source transformer points assigned to the grid cell.",
    "FEEDER_COUNT": (
        "Unique non-placeholder FEEDER identifiers in the grid cell."
    ),
    "CAPACITY_REPORTED_COUNT": (
        "Unique feeders in the cell with a reported CAPACITY value."
    ),
    "CAPACITY_MIN_KW": (
        "Minimum reported capacity across unique feeders; null when unavailable."
    ),
    "CAPACITY_MAX_KW": (
        "Maximum reported capacity across unique feeders; null when unavailable."
    ),
    "CAPACITY_MEAN_KW": (
        "Arithmetic mean across unique feeder capacity values; repeated "
        "transformer points do not weight or sum capacity."
    ),
    "SOURCE_AREAS": "Sorted source-area prefixes represented in the cell.",
    "SOURCE_DATE": f"Source snapshot date: {SOURCE_DATE}.",
    "SOURCE_URL": "Official source ZIP URL.",
    "SOURCE_LICENSE": f"Short licence label: {SOURCE_LICENSE_SHORT}.",
    "EVIDENCE": "Constant evidence class: reported.",
    "GEOMETRY_CONFIDENCE": (
        "Constant geometry class: aggregated-0.02-degree-grid."
    ),
}


def parse_args() -> argparse.Namespace:
    project_root = Path(__file__).resolve().parents[2]
    default_output = (
        project_root / "data" / "grid-atlas" / "taiwan-hosting-capacity.geojson"
    )
    default_display_output = default_output.with_name(
        "taiwan-hosting-capacity-display.geojson"
    )

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--url",
        default=DOWNLOAD_URL,
        help="Official ZIP URL. Defaults to Taipower d077009.",
    )
    parser.add_argument(
        "--input-zip",
        type=Path,
        help="Use a previously downloaded ZIP instead of requesting --url.",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=default_output,
        help=f"GeoJSON destination (default: {default_output}).",
    )
    parser.add_argument(
        "--display-output",
        type=Path,
        default=default_display_output,
        help=f"Display GeoJSON destination (default: {default_display_output}).",
    )
    parser.add_argument(
        "--metadata-output",
        type=Path,
        help=(
            "Metadata destination. Defaults to the GeoJSON filename with "
            "'.metadata.json' replacing '.geojson'."
        ),
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=180.0,
        help="Network timeout in seconds (default: 180).",
    )
    return parser.parse_args()


def iso_http_date(value: str | None) -> str | None:
    if not value:
        return None
    try:
        return parsedate_to_datetime(value).astimezone(timezone.utc).isoformat()
    except (TypeError, ValueError):
        return value


def sha256_path(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def portable_output_path(path: Path) -> str:
    project_root = Path(__file__).resolve().parents[2]
    try:
        return path.resolve().relative_to(project_root).as_posix()
    except ValueError:
        return path.name


def download_zip_with_urllib(
    url: str, timeout: float
) -> tuple[Path, dict[str, Any]]:
    request = urllib.request.Request(
        url,
        headers={
            "Accept": "application/zip, application/octet-stream;q=0.9, */*;q=0.1",
            "User-Agent": "Comunicacion-Grid-Atlas/1.0 (+https://qdgvr.github.io/)",
        },
    )
    temporary = tempfile.NamedTemporaryFile(
        prefix="taipower-d077009-", suffix=".zip", delete=False
    )
    temporary_path = Path(temporary.name)

    try:
        with temporary, urllib.request.urlopen(request, timeout=timeout) as response:
            while chunk := response.read(1024 * 1024):
                temporary.write(chunk)
            headers = response.headers
            metadata = {
                "transport": "Python urllib",
                "requested_url": url,
                "response_url": response.geturl(),
                "status": response.status,
                "content_type": headers.get("Content-Type"),
                "content_length_header": (
                    int(headers["Content-Length"])
                    if headers.get("Content-Length", "").isdigit()
                    else None
                ),
                "last_modified": iso_http_date(headers.get("Last-Modified")),
                "etag": headers.get("ETag"),
                "server_date": iso_http_date(headers.get("Date")),
            }
        return temporary_path, metadata
    except Exception:
        temporary_path.unlink(missing_ok=True)
        raise


def final_curl_headers(raw_headers: str) -> tuple[int | None, dict[str, str]]:
    blocks = [
        block.strip()
        for block in re.split(r"\r?\n\r?\n", raw_headers)
        if block.strip().lower().startswith("http/")
    ]
    if not blocks:
        return None, {}
    lines = blocks[-1].splitlines()
    status_parts = lines[0].split()
    status = (
        int(status_parts[1])
        if len(status_parts) > 1 and status_parts[1].isdigit()
        else None
    )
    headers: dict[str, str] = {}
    for line in lines[1:]:
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        headers[key.strip().lower()] = value.strip()
    return status, headers


def download_zip_with_curl(
    url: str, timeout: float, urllib_error: Exception
) -> tuple[Path, dict[str, Any]]:
    curl = shutil.which("curl")
    if not curl:
        raise urllib_error

    archive_file = tempfile.NamedTemporaryFile(
        prefix="taipower-d077009-", suffix=".zip", delete=False
    )
    header_file = tempfile.NamedTemporaryFile(
        prefix="taipower-d077009-", suffix=".headers", delete=False
    )
    archive_path = Path(archive_file.name)
    header_path = Path(header_file.name)
    archive_file.close()
    header_file.close()

    try:
        command = [
            curl,
            "--fail",
            "--location",
            "--silent",
            "--show-error",
            "--proto",
            "=https",
            "--proto-redir",
            "=https",
            "--max-time",
            str(timeout),
            "--user-agent",
            "Comunicacion-Grid-Atlas/1.0 (+https://qdgvr.github.io/)",
            "--dump-header",
            str(header_path),
            "--output",
            str(archive_path),
            "--write-out",
            "%{url_effective}\n%{http_code}",
            url,
        ]
        completed = subprocess.run(
            command,
            check=True,
            capture_output=True,
            text=True,
        )
        response_parts = completed.stdout.strip().splitlines()
        response_url = response_parts[0] if response_parts else url
        write_out_status = (
            int(response_parts[1])
            if len(response_parts) > 1 and response_parts[1].isdigit()
            else None
        )
        header_status, headers = final_curl_headers(
            header_path.read_text(encoding="iso-8859-1")
        )
        metadata = {
            "transport": "curl with platform TLS verification",
            "transport_note": (
                "Python urllib could not validate the server certificate on "
                f"this host ({urllib_error}); curl was used without insecure flags."
            ),
            "requested_url": url,
            "response_url": response_url,
            "status": header_status or write_out_status,
            "content_type": headers.get("content-type"),
            "content_length_header": (
                int(headers["content-length"])
                if headers.get("content-length", "").isdigit()
                else None
            ),
            "last_modified": iso_http_date(headers.get("last-modified")),
            "etag": headers.get("etag"),
            "server_date": iso_http_date(headers.get("date")),
        }
        return archive_path, metadata
    except subprocess.CalledProcessError as error:
        archive_path.unlink(missing_ok=True)
        message = error.stderr.strip() or str(error)
        raise OSError(f"curl download failed: {message}") from error
    finally:
        header_path.unlink(missing_ok=True)


def download_zip(url: str, timeout: float) -> tuple[Path, dict[str, Any]]:
    try:
        return download_zip_with_urllib(url, timeout)
    except urllib.error.URLError as error:
        return download_zip_with_curl(url, timeout, error)


def zip_datetime(info: zipfile.ZipInfo) -> str:
    # ZIP's legacy timestamp has no timezone field. Preserve it verbatim rather
    # than attaching a guessed timezone.
    return datetime(*info.date_time).isoformat()


def decode_csv(raw: bytes, source_name: str) -> csv.DictReader:
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError as error:
        raise ValueError(f"{source_name}: expected UTF-8 CSV") from error
    return csv.DictReader(io.StringIO(text, newline=""))


def require_fields(
    reader: csv.DictReader, required: Iterable[str], source_name: str
) -> None:
    actual = set(reader.fieldnames or [])
    missing = set(required) - actual
    if missing:
        raise ValueError(
            f"{source_name}: missing required fields {sorted(missing)}; "
            f"found {reader.fieldnames}"
        )


def parse_float(value: str | None) -> float | None:
    if value is None or not value.strip():
        return None
    try:
        parsed = float(value)
    except ValueError:
        return None
    return parsed if math.isfinite(parsed) else None


def parse_rownum(value: str | None) -> int | str:
    if value is None:
        return ""
    stripped = value.strip()
    try:
        return int(stripped)
    except ValueError:
        return stripped


def is_valid_source_coordinate(x: float | None, y: float | None) -> bool:
    if x is None or y is None:
        return False
    return (
        SOURCE_AREA_BOUNDS["min_x"] <= x <= SOURCE_AREA_BOUNDS["max_x"]
        and SOURCE_AREA_BOUNDS["min_y"] <= y <= SOURCE_AREA_BOUNDS["max_y"]
    )


def twd67_to_twd97_tm2(x67: float, y67: float) -> tuple[float, float]:
    """Apply the published Taiwan-wide 2D approximation in projected metres."""

    x97 = x67 + TWD_X_OFFSET_M + TWD_A * x67 + TWD_B * y67
    y97 = y67 + TWD_Y_OFFSET_M + TWD_A * y67 + TWD_B * x67
    return x97, y97


def inverse_twd97_tm2(x: float, y: float) -> tuple[float, float]:
    """Inverse EPSG:3826 to longitude/latitude using standard TM series."""

    a = GRS80_SEMI_MAJOR_M
    flattening = 1.0 / GRS80_INVERSE_FLATTENING
    eccentricity_sq = flattening * (2.0 - flattening)
    second_eccentricity_sq = eccentricity_sq / (1.0 - eccentricity_sq)

    meridional_arc = (y - TM2_FALSE_NORTHING_M) / TM2_SCALE_FACTOR
    mu = meridional_arc / (
        a
        * (
            1.0
            - eccentricity_sq / 4.0
            - 3.0 * eccentricity_sq**2 / 64.0
            - 5.0 * eccentricity_sq**3 / 256.0
        )
    )

    e1 = (1.0 - math.sqrt(1.0 - eccentricity_sq)) / (
        1.0 + math.sqrt(1.0 - eccentricity_sq)
    )
    footprint_latitude = (
        mu
        + (3.0 * e1 / 2.0 - 27.0 * e1**3 / 32.0) * math.sin(2.0 * mu)
        + (21.0 * e1**2 / 16.0 - 55.0 * e1**4 / 32.0)
        * math.sin(4.0 * mu)
        + 151.0 * e1**3 / 96.0 * math.sin(6.0 * mu)
        + 1097.0 * e1**4 / 512.0 * math.sin(8.0 * mu)
    )

    sine = math.sin(footprint_latitude)
    cosine = math.cos(footprint_latitude)
    tangent = math.tan(footprint_latitude)
    tangent_sq = tangent**2
    c1 = second_eccentricity_sq * cosine**2
    n1 = a / math.sqrt(1.0 - eccentricity_sq * sine**2)
    r1 = (
        a
        * (1.0 - eccentricity_sq)
        / (1.0 - eccentricity_sq * sine**2) ** 1.5
    )
    d = (x - TM2_FALSE_EASTING_M) / (n1 * TM2_SCALE_FACTOR)

    latitude = footprint_latitude - (n1 * tangent / r1) * (
        d**2 / 2.0
        - (
            5.0
            + 3.0 * tangent_sq
            + 10.0 * c1
            - 4.0 * c1**2
            - 9.0 * second_eccentricity_sq
        )
        * d**4
        / 24.0
        + (
            61.0
            + 90.0 * tangent_sq
            + 298.0 * c1
            + 45.0 * tangent_sq**2
            - 252.0 * second_eccentricity_sq
            - 3.0 * c1**2
        )
        * d**6
        / 720.0
    )
    longitude = math.radians(TM2_CENTRAL_MERIDIAN_DEG) + (
        d
        - (1.0 + 2.0 * tangent_sq + c1) * d**3 / 6.0
        + (
            5.0
            - 2.0 * c1
            + 28.0 * tangent_sq
            - 3.0 * c1**2
            + 8.0 * second_eccentricity_sq
            + 24.0 * tangent_sq**2
        )
        * d**5
        / 120.0
    ) / cosine

    return math.degrees(longitude), math.degrees(latitude)


def to_web_lon_lat(x67: float, y67: float) -> tuple[float, float]:
    x97, y97 = twd67_to_twd97_tm2(x67, y67)
    return inverse_twd97_tm2(x97, y97)


def verify_coordinate_transform() -> None:
    # Public Taichung City reference pair:
    # TWD67 213291,2673189 -> WGS84 120.646910,24.161768.
    longitude, latitude = to_web_lon_lat(213_291.0, 2_673_189.0)
    if not (
        abs(longitude - 120.646910) < 0.00005
        and abs(latitude - 24.161768) < 0.00005
    ):
        raise RuntimeError(
            "Coordinate-transform self-check failed: "
            f"received {longitude},{latitude}"
        )


def source_files(archive: zipfile.ZipFile) -> tuple[list[str], list[str]]:
    names = archive.namelist()
    capacity_files = sorted(
        name
        for name in names
        if name.endswith("_capacity.csv") and not name.startswith("schema-")
    )
    point_files = sorted(
        name
        for name in names
        if name.endswith("_tr_feeder.csv") and not name.startswith("schema-")
    )
    capacity_areas = {name.removesuffix("_capacity.csv") for name in capacity_files}
    point_areas = {name.removesuffix("_tr_feeder.csv") for name in point_files}
    if capacity_areas != point_areas:
        raise ValueError(
            "Area mismatch between capacity and transformer files: "
            f"capacity-only={sorted(capacity_areas - point_areas)}, "
            f"point-only={sorted(point_areas - capacity_areas)}"
        )
    if not capacity_files:
        raise ValueError("No *_capacity.csv source files found in archive")
    return capacity_files, point_files


def collect_capacities(
    archive: zipfile.ZipFile, capacity_files: list[str]
) -> tuple[
    dict[str, dict[str, float]],
    dict[str, dict[str, Any]],
    int,
]:
    by_area: dict[str, dict[str, float]] = {}
    member_metadata: dict[str, dict[str, Any]] = {}
    total_rows = 0

    for source_name in capacity_files:
        area = source_name.removesuffix("_capacity.csv")
        raw = archive.read(source_name)
        reader = decode_csv(raw, source_name)
        require_fields(reader, ("FEEDER", "CAPACITY"), source_name)
        capacities: dict[str, float] = {}

        for row in reader:
            feeder = (row.get("FEEDER") or "").strip()
            capacity = parse_float(row.get("CAPACITY"))
            if not feeder or capacity is None:
                raise ValueError(
                    f"{source_name}: invalid FEEDER/CAPACITY row {reader.line_num}"
                )
            if feeder in capacities:
                raise ValueError(
                    f"{source_name}: duplicate FEEDER {feeder!r} "
                    f"at CSV row {reader.line_num}"
                )
            capacities[feeder] = capacity

        info = archive.getinfo(source_name)
        by_area[area] = capacities
        member_metadata[area] = {
            "capacity_file": {
                "name": source_name,
                "sha256": hashlib.sha256(raw).hexdigest(),
                "zip_modified_at_local_unspecified": zip_datetime(info),
                "row_count": len(capacities),
            }
        }
        total_rows += len(capacities)

    return by_area, member_metadata, total_rows


def update_bounds(
    bounds: dict[str, float | None], first: float, second: float
) -> None:
    bounds["min_first"] = (
        first
        if bounds["min_first"] is None
        else min(bounds["min_first"], first)
    )
    bounds["min_second"] = (
        second
        if bounds["min_second"] is None
        else min(bounds["min_second"], second)
    )
    bounds["max_first"] = (
        first
        if bounds["max_first"] is None
        else max(bounds["max_first"], first)
    )
    bounds["max_second"] = (
        second
        if bounds["max_second"] is None
        else max(bounds["max_second"], second)
    )


def display_grid_key(longitude: float, latitude: float) -> tuple[int, int]:
    """Return a stable global 0.02-degree grid key.

    Raw GeoJSON coordinates are rounded to six decimals. Converting them to
    integer microdegrees before flooring prevents binary floating-point edge
    cases from assigning a point on a grid boundary to the wrong cell.
    """

    longitude_microdegrees = int(round(round(longitude, 6) * 1_000_000))
    latitude_microdegrees = int(round(round(latitude, 6) * 1_000_000))
    return (
        longitude_microdegrees // DISPLAY_GRID_MICRODEGREES,
        latitude_microdegrees // DISPLAY_GRID_MICRODEGREES,
    )


def add_display_point(
    cells: dict[tuple[int, int], dict[str, Any]],
    *,
    longitude: float,
    latitude: float,
    area: str,
    feeder: str,
    capacity: float | None,
) -> None:
    key = display_grid_key(longitude, latitude)
    cell = cells.setdefault(
        key,
        {
            "point_count": 0,
            "feeders": set(),
            "reported_capacities": {},
            "source_areas": set(),
            "placeholder_point_count": 0,
        },
    )
    cell["point_count"] += 1
    cell["source_areas"].add(area)

    if feeder in FEEDER_PLACEHOLDERS:
        cell["placeholder_point_count"] += 1
        return

    cell["feeders"].add(feeder)
    if capacity is None:
        return

    previous = cell["reported_capacities"].get(feeder)
    if previous is not None and previous != capacity:
        raise ValueError(
            "Conflicting CAPACITY values for one FEEDER in a display cell: "
            f"cell={key}, feeder={feeder!r}, values={previous},{capacity}"
        )
    cell["reported_capacities"][feeder] = capacity


def inspect_points(
    archive: zipfile.ZipFile,
    point_files: list[str],
    capacities: dict[str, dict[str, float]],
    member_metadata: dict[str, dict[str, Any]],
) -> tuple[dict[str, Any], dict[tuple[int, int], dict[str, Any]]]:
    totals = {
        "feature_count": 0,
        "valid_geometry_count": 0,
        "invalid_geometry_count": 0,
        "capacity_matched_count": 0,
        "capacity_missing_count": 0,
    }
    raw_bounds: dict[str, float | None] = {
        "min_first": None,
        "min_second": None,
        "max_first": None,
        "max_second": None,
    }
    valid_raw_bounds = dict(raw_bounds)
    output_bounds = dict(raw_bounds)
    invalid_examples: list[dict[str, Any]] = []
    missing_feeders: set[tuple[str, str]] = set()
    area_statistics: dict[str, dict[str, Any]] = {}
    display_cells: dict[tuple[int, int], dict[str, Any]] = {}

    for source_name in point_files:
        area = source_name.removesuffix("_tr_feeder.csv")
        raw = archive.read(source_name)
        reader = decode_csv(raw, source_name)
        require_fields(reader, ("ROWNUM", "X", "Y", "FEEDER"), source_name)
        area_stats = {
            "feature_count": 0,
            "valid_geometry_count": 0,
            "invalid_geometry_count": 0,
            "capacity_matched_count": 0,
            "capacity_missing_count": 0,
        }
        area_missing_feeders: set[str] = set()

        for row in reader:
            area_stats["feature_count"] += 1
            totals["feature_count"] += 1
            feeder = (row.get("FEEDER") or "").strip()
            x = parse_float(row.get("X"))
            y = parse_float(row.get("Y"))
            rownum = parse_rownum(row.get("ROWNUM"))

            if x is not None and y is not None:
                update_bounds(raw_bounds, x, y)

            if feeder in capacities[area]:
                area_stats["capacity_matched_count"] += 1
                totals["capacity_matched_count"] += 1
            else:
                area_stats["capacity_missing_count"] += 1
                totals["capacity_missing_count"] += 1
                missing_feeders.add((area, feeder))
                area_missing_feeders.add(feeder)

            if is_valid_source_coordinate(x, y):
                assert x is not None and y is not None
                longitude, latitude = to_web_lon_lat(x, y)
                add_display_point(
                    display_cells,
                    longitude=longitude,
                    latitude=latitude,
                    area=area,
                    feeder=feeder,
                    capacity=capacities[area].get(feeder),
                )
                update_bounds(valid_raw_bounds, x, y)
                update_bounds(output_bounds, longitude, latitude)
                area_stats["valid_geometry_count"] += 1
                totals["valid_geometry_count"] += 1
            else:
                area_stats["invalid_geometry_count"] += 1
                totals["invalid_geometry_count"] += 1
                if len(invalid_examples) < 20:
                    invalid_examples.append(
                        {
                            "area": area,
                            "rownum": rownum,
                            "feeder": feeder,
                            "source_x": x,
                            "source_y": y,
                        }
                    )

        info = archive.getinfo(source_name)
        member_metadata[area]["point_file"] = {
            "name": source_name,
            "sha256": hashlib.sha256(raw).hexdigest(),
            "zip_modified_at_local_unspecified": zip_datetime(info),
            "row_count": area_stats["feature_count"],
        }
        area_stats["capacity_missing_unique_feeder_count"] = len(
            area_missing_feeders
        )
        area_statistics[area] = area_stats

    totals["capacity_missing_unique_feeder_count"] = len(missing_feeders)
    totals["source_coordinate_bounds_all_rows"] = {
        "min_x": raw_bounds["min_first"],
        "min_y": raw_bounds["min_second"],
        "max_x": raw_bounds["max_first"],
        "max_y": raw_bounds["max_second"],
    }
    totals["source_coordinate_bounds_valid_rows"] = {
        "min_x": valid_raw_bounds["min_first"],
        "min_y": valid_raw_bounds["min_second"],
        "max_x": valid_raw_bounds["max_first"],
        "max_y": valid_raw_bounds["max_second"],
    }
    totals["wgs84_bounds_valid_rows"] = {
        "min_longitude": output_bounds["min_first"],
        "min_latitude": output_bounds["min_second"],
        "max_longitude": output_bounds["max_first"],
        "max_latitude": output_bounds["max_second"],
    }
    totals["invalid_coordinate_examples"] = invalid_examples
    totals["areas"] = area_statistics
    return totals, display_cells


def feature_for_row(
    row: dict[str, str],
    area: str,
    capacities: dict[str, dict[str, float]],
) -> dict[str, Any]:
    feeder = (row.get("FEEDER") or "").strip()
    x = parse_float(row.get("X"))
    y = parse_float(row.get("Y"))
    properties: dict[str, Any] = {
        "a": area,
        "f": feeder,
        "c": capacities[area].get(feeder),
        "r": parse_rownum(row.get("ROWNUM")),
        "x": x,
        "y": y,
    }

    if is_valid_source_coordinate(x, y):
        assert x is not None and y is not None
        longitude, latitude = to_web_lon_lat(x, y)
        geometry: dict[str, Any] | None = {
            "type": "Point",
            "coordinates": [round(longitude, 6), round(latitude, 6)],
        }
    else:
        geometry = None
        properties["q"] = "invalid_source_coordinate"

    return {
        "type": "Feature",
        "geometry": geometry,
        "properties": properties,
    }


def write_geojson(
    destination: Path,
    archive: zipfile.ZipFile,
    point_files: list[str],
    capacities: dict[str, dict[str, float]],
) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    file_handle, temporary_name = tempfile.mkstemp(
        prefix=f".{destination.name}.", suffix=".tmp", dir=destination.parent
    )
    temporary_path = Path(temporary_name)

    try:
        with os.fdopen(file_handle, "w", encoding="utf-8", newline="\n") as output:
            output.write('{"type":"FeatureCollection","features":[\n')
            first_feature = True
            for source_name in point_files:
                area = source_name.removesuffix("_tr_feeder.csv")
                reader = decode_csv(archive.read(source_name), source_name)
                require_fields(reader, ("ROWNUM", "X", "Y", "FEEDER"), source_name)
                for row in reader:
                    if not first_feature:
                        output.write(",\n")
                    json.dump(
                        feature_for_row(row, area, capacities),
                        output,
                        ensure_ascii=False,
                        separators=(",", ":"),
                        allow_nan=False,
                    )
                    first_feature = False
            output.write("\n]}\n")
        os.replace(temporary_path, destination)
        destination.chmod(0o644)
    except Exception:
        temporary_path.unlink(missing_ok=True)
        raise


def display_cell_centroid(key: tuple[int, int]) -> tuple[float, float]:
    longitude_index, latitude_index = key
    half_grid = DISPLAY_GRID_MICRODEGREES // 2
    return (
        (longitude_index * DISPLAY_GRID_MICRODEGREES + half_grid) / 1_000_000,
        (latitude_index * DISPLAY_GRID_MICRODEGREES + half_grid) / 1_000_000,
    )


def display_feature(
    key: tuple[int, int], cell: dict[str, Any], source_url: str
) -> dict[str, Any]:
    capacities = list(cell["reported_capacities"].values())
    capacity_min = min(capacities) if capacities else None
    capacity_max = max(capacities) if capacities else None
    capacity_mean = (
        round(math.fsum(capacities) / len(capacities), 3)
        if capacities
        else None
    )
    longitude, latitude = display_cell_centroid(key)
    return {
        "type": "Feature",
        "geometry": {
            "type": "Point",
            "coordinates": [longitude, latitude],
        },
        "properties": {
            "REGION_KEY": "taiwan",
            "ASSET_KIND": "hosting_cluster",
            "SOURCE_ID": SOURCE_ID,
            "POINT_COUNT": cell["point_count"],
            "FEEDER_COUNT": len(cell["feeders"]),
            "CAPACITY_REPORTED_COUNT": len(cell["reported_capacities"]),
            "CAPACITY_MIN_KW": capacity_min,
            "CAPACITY_MAX_KW": capacity_max,
            "CAPACITY_MEAN_KW": capacity_mean,
            "SOURCE_AREAS": sorted(cell["source_areas"]),
            "SOURCE_DATE": SOURCE_DATE,
            "SOURCE_URL": source_url,
            "SOURCE_LICENSE": SOURCE_LICENSE_SHORT,
            "EVIDENCE": "reported",
            "GEOMETRY_CONFIDENCE": "aggregated-0.02-degree-grid",
        },
    }


def inspect_display_cells(
    cells: dict[tuple[int, int], dict[str, Any]],
    source_statistics: dict[str, Any],
) -> dict[str, Any]:
    centroid_bounds: dict[str, float | None] = {
        "min_first": None,
        "min_second": None,
        "max_first": None,
        "max_second": None,
    }
    for key in cells:
        update_bounds(centroid_bounds, *display_cell_centroid(key))

    aggregated_point_count = sum(cell["point_count"] for cell in cells.values())
    if aggregated_point_count != source_statistics["valid_geometry_count"]:
        raise ValueError(
            "Display aggregation point count does not match valid source rows: "
            f"{aggregated_point_count} != "
            f"{source_statistics['valid_geometry_count']}"
        )

    return {
        "method": "fixed-global-0.02-degree-grid-centroid",
        "grid_size_degrees": DISPLAY_GRID_DEGREES,
        "grid_alignment": (
            "Global longitude/latitude multiples of 0.02 degrees; feature "
            "geometry is the geometric center of each occupied cell."
        ),
        "input_source_row_count": source_statistics["feature_count"],
        "input_valid_geometry_count": source_statistics["valid_geometry_count"],
        "invalid_geometry_count_metadata_only": source_statistics[
            "invalid_geometry_count"
        ],
        "aggregated_point_count": aggregated_point_count,
        "output_cell_count": len(cells),
        "feeder_count_method": (
            "Unique non-placeholder FEEDER string per cell; empty and 無 are "
            "excluded. The same FEEDER repeated at many transformer points "
            "counts once per occupied cell."
        ),
        "capacity_method": (
            "CAPACITY_REPORTED_COUNT, MIN, MAX and MEAN use one reported "
            "CAPACITY value per unique FEEDER per cell. Transformer-point "
            "duplicates are never summed or used as repeated mean weights."
        ),
        "placeholder_feeder_values_excluded": sorted(FEEDER_PLACEHOLDERS),
        "placeholder_point_count": sum(
            cell["placeholder_point_count"] for cell in cells.values()
        ),
        "feeder_cell_membership_count": sum(
            len(cell["feeders"]) for cell in cells.values()
        ),
        "capacity_reported_feeder_cell_membership_count": sum(
            len(cell["reported_capacities"]) for cell in cells.values()
        ),
        "cells_without_reported_capacity": sum(
            not cell["reported_capacities"] for cell in cells.values()
        ),
        "cells_without_nonplaceholder_feeder": sum(
            not cell["feeders"] for cell in cells.values()
        ),
        "maximum_points_in_one_cell": max(
            (cell["point_count"] for cell in cells.values()), default=0
        ),
        "centroid_bounds": {
            "min_longitude": centroid_bounds["min_first"],
            "min_latitude": centroid_bounds["min_second"],
            "max_longitude": centroid_bounds["max_first"],
            "max_latitude": centroid_bounds["max_second"],
        },
    }


def write_display_geojson(
    destination: Path,
    cells: dict[tuple[int, int], dict[str, Any]],
    source_url: str,
) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    file_handle, temporary_name = tempfile.mkstemp(
        prefix=f".{destination.name}.", suffix=".tmp", dir=destination.parent
    )
    temporary_path = Path(temporary_name)

    try:
        with os.fdopen(file_handle, "w", encoding="utf-8", newline="\n") as output:
            output.write('{"type":"FeatureCollection","features":[\n')
            for index, (key, cell) in enumerate(
                sorted(cells.items(), key=lambda item: (item[0][1], item[0][0]))
            ):
                if index:
                    output.write(",\n")
                json.dump(
                    display_feature(key, cell, source_url),
                    output,
                    ensure_ascii=False,
                    separators=(",", ":"),
                    allow_nan=False,
                )
            output.write("\n]}\n")
        os.replace(temporary_path, destination)
        destination.chmod(0o644)
    except Exception:
        temporary_path.unlink(missing_ok=True)
        raise


def write_json(destination: Path, value: dict[str, Any]) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    file_handle, temporary_name = tempfile.mkstemp(
        prefix=f".{destination.name}.", suffix=".tmp", dir=destination.parent
    )
    temporary_path = Path(temporary_name)
    try:
        with os.fdopen(file_handle, "w", encoding="utf-8", newline="\n") as output:
            json.dump(
                value,
                output,
                ensure_ascii=False,
                indent=2,
                sort_keys=False,
                allow_nan=False,
            )
            output.write("\n")
        os.replace(temporary_path, destination)
        destination.chmod(0o644)
    except Exception:
        temporary_path.unlink(missing_ok=True)
        raise


def build_metadata(
    *,
    archive_path: Path,
    archive_sha256: str,
    http_metadata: dict[str, Any],
    retrieval_mode: str,
    source_url: str,
    capacity_row_count: int,
    source_members: dict[str, dict[str, Any]],
    statistics: dict[str, Any],
    display_statistics: dict[str, Any],
    output_path: Path,
    display_output_path: Path,
) -> dict[str, Any]:
    generated_at = datetime.now(timezone.utc).isoformat()
    return {
        "schema_version": 2,
        "title": "Taipower renewable hosting capacity source and display layers",
        "description": (
            "Official feeder hosting capacity joined to transformer points. "
            "The raw output preserves source rows and the display output "
            "aggregates valid points to a 0.02-degree grid. Neither is feeder "
            "line geometry or a connectivity/topology model."
        ),
        "generated_at": generated_at,
        "source": {
            "publisher": "Taiwan Power Company (台灣電力公司)",
            "catalogue": "Taiwan Government Data Open Platform",
            "dataset_id": DATASET_ID,
            "catalogue_dataset_id": 161874,
            "portal_url": DATASET_PORTAL_URL,
            "download_url": source_url,
            "source_date": SOURCE_DATE,
            "update_frequency": "semiannual",
            "retrieval_mode": retrieval_mode,
            "http": http_metadata,
            "archive": {
                "source_filename": (
                    Path(urllib.parse.urlparse(source_url).path).name
                    or archive_path.name
                ),
                **(
                    {"local_input_name": archive_path.name}
                    if retrieval_mode == "local input"
                    else {}
                ),
                "size_bytes": archive_path.stat().st_size,
                "sha256": archive_sha256,
            },
        },
        "licence": {
            "name": LICENCE_NAME,
            "url": LICENCE_URL,
            "attribution_required": True,
            "commercial_use_permitted": True,
            "modification_permitted": True,
            "redistribution_permitted": True,
            "cc_by_4_compatible": True,
            "suggested_attribution": (
                "Taiwan Power Company (台灣電力公司), d077009, "
                "Taiwan Government Data Open Platform."
            ),
        },
        "coordinate_reference_systems": {
            "source": {
                "id": SOURCE_CRS,
                "name": "TWD67 / TM2 zone 121",
                "axis_order": ["X easting", "Y northing"],
                "unit": "metre",
                "validity_bounds_used": SOURCE_AREA_BOUNDS,
            },
            "intermediate": {
                "id": INTERMEDIATE_CRS,
                "name": "TWD97 / TM2 zone 121",
                "method": (
                    "Published Taiwan-wide 2D plane-coordinate approximation: "
                    "X97=X67+807.8+A*X67+B*Y67; "
                    "Y97=Y67-248.6+A*Y67+B*X67; "
                    f"A={TWD_A}, B={TWD_B}."
                ),
            },
            "output": {
                "id": OUTPUT_CRS,
                "name": "WGS 84 longitude/latitude for RFC 7946 GeoJSON",
                "coordinate_order": ["longitude", "latitude"],
                "precision_decimal_places": 6,
            },
            "accuracy_note": (
                "The national 2D approximation and TWD97/WGS84 equivalence "
                "are appropriate for web mapping, not cadastral or survey use."
            ),
            "self_check": {
                "input_twd67_tm2": [213291.0, 2673189.0],
                "expected_wgs84": [120.646910, 24.161768],
                "tolerance_degrees": 0.00005,
            },
        },
        "feature_property_schema": PROPERTY_SCHEMA,
        "display_feature_property_schema": DISPLAY_PROPERTY_SCHEMA,
        "source_members": source_members,
        "statistics": {
            "source_area_count": len(source_members),
            "capacity_table_row_count": capacity_row_count,
            **statistics,
        },
        "aggregation": display_statistics,
        "processing": {
            "script": "scripts/grid-atlas/build-taiwan-hosting.py",
            "steps": [
                "Download or open the official d077009 ZIP.",
                "Validate each regional capacity and transformer CSV schema.",
                "Join CAPACITY to transformer points by source area and FEEDER.",
                "Retain unmatched feeders with a null capacity.",
                "Validate TWD67 coordinates against EPSG:3828 area bounds.",
                "Retain invalid coordinates as features with null geometry.",
                "Transform valid coordinates to WGS84-compatible longitude/latitude.",
                (
                    "Assign each valid point to a globally aligned 0.02-degree "
                    "grid and write one display feature at each occupied cell "
                    "centroid."
                ),
                (
                    "Calculate display capacity statistics once per unique "
                    "feeder in each cell, never by summing repeated point values."
                ),
            ],
        },
        "output": {
            "path": portable_output_path(output_path),
            "format": "RFC 7946 GeoJSON FeatureCollection",
            "size_bytes": output_path.stat().st_size,
            "sha256": sha256_path(output_path),
            "direct_browser_loading_note": (
                "The complete point layer is intentionally large. Generate "
                "vector tiles or PMTiles before production browser use."
            ),
            "repository_status": (
                "Reproducible audit artifact, hash-recorded in metadata but "
                "not intended for deployment; the display output represents "
                "every valid point."
            ),
        },
        "display_output": {
            "path": portable_output_path(display_output_path),
            "format": "RFC 7946 GeoJSON FeatureCollection",
            "feature_count": display_statistics["output_cell_count"],
            "source_row_count": display_statistics["input_source_row_count"],
            "aggregated_valid_point_count": display_statistics[
                "aggregated_point_count"
            ],
            "invalid_geometry_excluded_count": display_statistics[
                "invalid_geometry_count_metadata_only"
            ],
            "size_bytes": display_output_path.stat().st_size,
            "sha256": sha256_path(display_output_path),
        },
    }


def main() -> int:
    args = parse_args()
    output_path = args.output.resolve()
    display_output_path = args.display_output.resolve()
    metadata_path = (
        args.metadata_output.resolve()
        if args.metadata_output
        else output_path.with_suffix(".metadata.json")
    )
    downloaded_path: Path | None = None

    verify_coordinate_transform()

    if args.input_zip:
        archive_path = args.input_zip.expanduser().resolve()
        if not archive_path.is_file():
            raise FileNotFoundError(f"Input ZIP does not exist: {archive_path}")
        retrieval_mode = "local input"
        http_metadata: dict[str, Any] = {
            "requested_url": args.url,
            "response_url": None,
            "status": None,
            "content_type": None,
            "content_length_header": None,
            "last_modified": None,
            "etag": None,
            "server_date": None,
            "note": "HTTP headers unavailable because --input-zip was used.",
        }
    else:
        archive_path, http_metadata = download_zip(args.url, args.timeout)
        downloaded_path = archive_path
        retrieval_mode = "network"

    try:
        archive_sha256 = sha256_path(archive_path)
        with zipfile.ZipFile(archive_path) as archive:
            bad_member = archive.testzip()
            if bad_member:
                raise ValueError(f"ZIP CRC check failed for {bad_member}")

            capacity_files, point_files = source_files(archive)
            capacities, member_metadata, capacity_row_count = collect_capacities(
                archive, capacity_files
            )
            statistics, display_cells = inspect_points(
                archive, point_files, capacities, member_metadata
            )
            display_statistics = inspect_display_cells(
                display_cells, statistics
            )
            write_geojson(output_path, archive, point_files, capacities)
            write_display_geojson(
                display_output_path, display_cells, args.url
            )

        metadata = build_metadata(
            archive_path=archive_path,
            archive_sha256=archive_sha256,
            http_metadata=http_metadata,
            retrieval_mode=retrieval_mode,
            source_url=args.url,
            capacity_row_count=capacity_row_count,
            source_members=member_metadata,
            statistics=statistics,
            display_statistics=display_statistics,
            output_path=output_path,
            display_output_path=display_output_path,
        )
        write_json(metadata_path, metadata)

        bounds = statistics["wgs84_bounds_valid_rows"]
        print(f"Wrote {output_path}")
        print(f"Wrote {display_output_path}")
        print(f"Wrote {metadata_path}")
        print(
            "Features: "
            f"{statistics['feature_count']:,} total, "
            f"{statistics['valid_geometry_count']:,} valid geometry, "
            f"{statistics['invalid_geometry_count']:,} null geometry"
        )
        print(
            "Capacity join: "
            f"{statistics['capacity_matched_count']:,} matched, "
            f"{statistics['capacity_missing_count']:,} unmatched"
        )
        print(
            "WGS84 bounds: "
            f"{bounds['min_longitude']:.6f},"
            f"{bounds['min_latitude']:.6f} to "
            f"{bounds['max_longitude']:.6f},"
            f"{bounds['max_latitude']:.6f}"
        )
        print(f"Source ZIP SHA-256: {archive_sha256}")
        print(f"GeoJSON SHA-256: {metadata['output']['sha256']}")
        print(
            "Display aggregation: "
            f"{display_statistics['aggregated_point_count']:,} valid points "
            f"to {display_statistics['output_cell_count']:,} cells"
        )
        print(
            "Display GeoJSON SHA-256: "
            f"{metadata['display_output']['sha256']}"
        )
        return 0
    finally:
        if downloaded_path:
            downloaded_path.unlink(missing_ok=True)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, RuntimeError, zipfile.BadZipFile) as error:
        print(f"error: {error}", file=sys.stderr)
        raise SystemExit(1)
