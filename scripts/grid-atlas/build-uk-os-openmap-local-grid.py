#!/usr/bin/env python3
"""Build Great Britain's official overhead transmission-line layer.

OS OpenMap – Local 2026-04 publishes ``ElectricityTransmissionLine`` as
ESRI Shapefiles inside a 2.45 GB GB archive.  Downloading every unrelated
OpenMap layer would be wasteful, so the network path uses HTTP byte ranges:

* read the ZIP central directory;
* fetch only the 160 .shp/.shx/.dbf/.prj transmission-line members;
* verify every selected member with ZIP CRC and SHA-256;
* parse Shapefile and dBASE records with the Python standard library; and
* transform EPSG:27700 coordinates to WGS84 GeoJSON.

The source has only a feature ID and styling code.  It explicitly describes
the features as cables suspended between pylons and publishes no voltage.
No line simplification is applied.  A seven-parameter Helmert transform is
used after inverse British National Grid projection; this is suitable for a
1:10,000 contextual web layer, not survey or legal-boundary work.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import io
import json
import math
import re
import shutil
import struct
import subprocess
import tempfile
import urllib.request
import zipfile
from collections import Counter, OrderedDict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, BinaryIO, Iterable


SOURCE_ID = "uk-os-openmap-local-electricity-2026-04"
PUBLISHER = "Ordnance Survey"
PRODUCT_ID = "OpenMapLocal"
PRODUCT_TITLE = "OS OpenMap – Local"
SOURCE_VERSION = "2026-04"
PRODUCT_API_URL = "https://api.os.uk/downloads/v1/products/OpenMapLocal"
DOWNLOADS_API_URL = f"{PRODUCT_API_URL}/downloads"
DOCUMENTATION_URL = (
    "https://docs.os.uk/os-downloads/products/maps-and-imagery-portfolio/"
    "os-openmap-local/os-openmap-local-overview"
)
FEATURE_DOCUMENTATION_URL = (
    "https://docs.os.uk/os-downloads/products/maps-and-imagery-portfolio/"
    "os-openmap-local/os-openmap-local-technical-specification/feature-types/"
    "electricitytransmissionline"
)
LICENCE_NAME = "Open Government Licence version 3.0"
LICENCE_SHORT = "OGL 3.0"
LICENCE_URL = (
    "https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/"
)
ATTRIBUTION = "Contains OS data © Crown copyright and database right 2026"
SOURCE_CRS = "EPSG:27700"
OUTPUT_CRS = "OGC:CRS84"
SOURCE_SCALE = "1:10,000"
EXPECTED_FEATURE_CODE = 15102
MAX_OUTPUT_BYTES = 10 * 1024 * 1024
COORDINATE_DECIMALS = 6
MEMBER_PATTERN = re.compile(
    r"^data/(?P<tile>[A-Z]{2})/"
    r"(?P=tile)_ElectricityTransmissionLine\."
    r"(?P<extension>dbf|prj|shp|shx)$",
    re.IGNORECASE,
)

# Airy 1830 and British National Grid.
AIRY_A = 6_377_563.396
AIRY_B = 6_356_256.909
BNG_F0 = 0.9996012717
BNG_LAT0 = math.radians(49.0)
BNG_LON0 = math.radians(-2.0)
BNG_N0 = -100_000.0
BNG_E0 = 400_000.0

# OSGB36 -> WGS84 Helmert parameters.
HELMERT_TX = 446.448
HELMERT_TY = -125.157
HELMERT_TZ = 542.060
HELMERT_RX_ARCSEC = 0.1502
HELMERT_RY_ARCSEC = 0.2470
HELMERT_RZ_ARCSEC = 0.8421
HELMERT_SCALE_PPM = -20.4894

WGS84_A = 6_378_137.0
WGS84_B = 6_356_752.3141
TRANSFORM_SELF_CHECK = {
    "input_easting_northing": [651_409.903, 313_177.270],
    "expected_wgs84": [1.716052, 52.657979],
    "tolerance_degrees": 0.00002,
}


def parse_args() -> argparse.Namespace:
    project_root = Path(__file__).resolve().parents[2]
    output = (
        project_root
        / "data"
        / "grid-atlas"
        / "uk-os-openmap-local-electricity-lines.geojson"
    )
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--product-api-url",
        default=PRODUCT_API_URL,
        help="Official OS product metadata URL.",
    )
    parser.add_argument(
        "--downloads-api-url",
        default=DOWNLOADS_API_URL,
        help="Official OS downloads listing URL.",
    )
    parser.add_argument(
        "--input-zip",
        type=Path,
        help="Use a complete local GB Shapefile ZIP instead of HTTP ranges.",
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
        "--timeout",
        type=float,
        default=180.0,
        help="Timeout for each metadata or byte-range request.",
    )
    parser.add_argument(
        "--range-block-mib",
        type=int,
        default=2,
        help="HTTP range cache block size in MiB.",
    )
    parser.add_argument(
        "--range-cache-blocks",
        type=int,
        default=16,
        help="Maximum in-memory HTTP range blocks.",
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


def md5_path(path: Path) -> str:
    digest = hashlib.md5(usedforsecurity=False)
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


def curl_json(url: str, timeout: float) -> dict[str, Any] | list[Any]:
    curl = shutil.which("curl")
    if not curl:
        request = urllib.request.Request(
            url,
            headers={
                "Accept": "application/json",
                "User-Agent": "Comunicacion-Grid-Atlas/1.0",
            },
        )
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.loads(response.read())
    result = subprocess.run(
        [
            curl,
            "--fail",
            "--location",
            "--silent",
            "--show-error",
            "--max-time",
            str(max(1, math.ceil(timeout))),
            "--header",
            "Accept: application/json",
            "--user-agent",
            "Comunicacion-Grid-Atlas/1.0",
            url,
        ],
        check=True,
        stdout=subprocess.PIPE,
    )
    return json.loads(result.stdout)


def header_value(headers: str, name: str) -> str | None:
    matches = re.findall(
        rf"(?im)^{re.escape(name)}:\s*([^\r\n]+)", headers
    )
    return matches[-1].strip() if matches else None


class CurlRangeReader(io.RawIOBase):
    """Seekable HTTP reader backed by cached, certificate-verified curl ranges."""

    def __init__(
        self,
        public_url: str,
        timeout: float,
        block_size: int,
        max_cache_blocks: int,
    ) -> None:
        super().__init__()
        curl = shutil.which("curl")
        if not curl:
            raise RuntimeError("curl is required for remote ZIP range extraction")
        if block_size < 64 * 1024:
            raise ValueError("Range block size is too small")
        if max_cache_blocks < 2:
            raise ValueError("At least two range cache blocks are required")

        probe = subprocess.run(
            [
                curl,
                "--fail",
                "--location",
                "--silent",
                "--show-error",
                "--max-time",
                str(max(1, math.ceil(timeout))),
                "--range",
                "0-0",
                "--output",
                "/dev/null",
                "--dump-header",
                "-",
                "--write-out",
                "\\n__EFFECTIVE_URL__:%{url_effective}\\n",
                "--user-agent",
                "Comunicacion-Grid-Atlas/1.0",
                public_url,
            ],
            check=True,
            stdout=subprocess.PIPE,
        )
        probe_text = probe.stdout.decode("iso-8859-1")
        effective_urls = re.findall(
            r"(?m)^__EFFECTIVE_URL__:(.+)$", probe_text
        )
        content_ranges = re.findall(
            r"(?im)^Content-Range:\s*bytes\s+0-0/(\d+)", probe_text
        )
        if not effective_urls or not content_ranges:
            raise RuntimeError("OS archive endpoint did not honor bytes=0-0")

        self.public_url = public_url
        self._effective_url = effective_urls[-1].strip()
        self.size = int(content_ranges[-1])
        self.timeout = timeout
        self.block_size = block_size
        self.max_cache_blocks = max_cache_blocks
        self.position = 0
        self.cache: OrderedDict[int, bytes] = OrderedDict()
        self.range_request_count = 0
        self.range_bytes_downloaded = 0
        self.response_metadata = {
            "content_range_total_bytes": self.size,
            "last_modified": header_value(probe_text, "Last-Modified"),
            "etag": header_value(probe_text, "ETag"),
            "content_md5_base64": header_value(probe_text, "Content-MD5"),
            "accept_ranges": header_value(probe_text, "Accept-Ranges"),
        }

    def readable(self) -> bool:
        return True

    def seekable(self) -> bool:
        return True

    def tell(self) -> int:
        return self.position

    def seek(self, offset: int, whence: int = io.SEEK_SET) -> int:
        if whence == io.SEEK_SET:
            position = offset
        elif whence == io.SEEK_CUR:
            position = self.position + offset
        elif whence == io.SEEK_END:
            position = self.size + offset
        else:
            raise ValueError(f"Unsupported whence: {whence}")
        if position < 0:
            raise ValueError("Negative seek position")
        self.position = position
        return self.position

    def _block(self, block_index: int) -> bytes:
        cached = self.cache.get(block_index)
        if cached is not None:
            self.cache.move_to_end(block_index)
            return cached

        start = block_index * self.block_size
        end = min(self.size - 1, start + self.block_size - 1)
        result = subprocess.run(
            [
                shutil.which("curl") or "curl",
                "--fail",
                "--silent",
                "--show-error",
                "--max-time",
                str(max(1, math.ceil(self.timeout))),
                "--range",
                f"{start}-{end}",
                "--user-agent",
                "Comunicacion-Grid-Atlas/1.0",
                self._effective_url,
            ],
            check=True,
            stdout=subprocess.PIPE,
        )
        data = result.stdout
        expected = end - start + 1
        if len(data) != expected:
            raise IOError(
                f"OS range {start}-{end} returned {len(data)} bytes, "
                f"expected {expected}"
            )
        self.range_request_count += 1
        self.range_bytes_downloaded += len(data)
        self.cache[block_index] = data
        self.cache.move_to_end(block_index)
        while len(self.cache) > self.max_cache_blocks:
            self.cache.popitem(last=False)
        return data

    def read(self, size: int = -1) -> bytes:
        if size is None or size < 0:
            size = self.size - self.position
        size = min(size, max(0, self.size - self.position))
        if size <= 0:
            return b""

        output = bytearray()
        remaining = size
        while remaining:
            block_index, block_offset = divmod(
                self.position, self.block_size
            )
            block = self._block(block_index)
            take = min(remaining, len(block) - block_offset)
            if take <= 0:
                raise IOError("Range reader made no forward progress")
            output.extend(block[block_offset : block_offset + take])
            self.position += take
            remaining -= take
        return bytes(output)


def parse_dbf(contents: bytes, member_name: str) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    if len(contents) < 32:
        raise ValueError(f"{member_name} is too short for a dBASE header")
    record_count = struct.unpack_from("<I", contents, 4)[0]
    header_length = struct.unpack_from("<H", contents, 8)[0]
    record_length = struct.unpack_from("<H", contents, 10)[0]
    if header_length < 33 or record_length < 2:
        raise ValueError(f"{member_name} has invalid dBASE dimensions")

    fields: list[tuple[str, str, int, int]] = []
    offset = 32
    while offset + 32 <= header_length and contents[offset] != 0x0D:
        descriptor = contents[offset : offset + 32]
        name = (
            descriptor[:11]
            .split(b"\x00", 1)[0]
            .decode("ascii", errors="strict")
        )
        fields.append(
            (
                name,
                chr(descriptor[11]),
                descriptor[16],
                descriptor[17],
            )
        )
        offset += 32
    if [field[0] for field in fields] != ["ID", "FEATCODE"]:
        raise ValueError(
            f"{member_name} fields changed: {[field[0] for field in fields]}"
        )
    expected_length = header_length + record_count * record_length
    if len(contents) < expected_length:
        raise ValueError(f"{member_name} is truncated")

    records: list[dict[str, Any]] = []
    for record_index in range(record_count):
        start = header_length + record_index * record_length
        raw_record = contents[start : start + record_length]
        deleted = raw_record[:1] == b"*"
        cursor = 1
        values: dict[str, Any] = {"_deleted": deleted}
        for name, field_type, length, decimals in fields:
            raw_value = raw_record[cursor : cursor + length]
            cursor += length
            text = raw_value.decode("cp1252").strip()
            if not text:
                value: Any = None
            elif field_type in {"N", "F"}:
                value = float(text) if decimals else int(text)
            else:
                value = text
            values[name] = value
        records.append(values)

    return records, {
        "record_count": record_count,
        "header_length": header_length,
        "record_length": record_length,
        "last_update": (
            f"{1900 + contents[1]:04d}-{contents[2]:02d}-{contents[3]:02d}"
            if contents[1] and contents[2] and contents[3]
            else None
        ),
        "fields": [
            {
                "name": name,
                "type": field_type,
                "length": length,
                "decimals": decimals,
            }
            for name, field_type, length, decimals in fields
        ],
    }


def parse_shapefile(
    contents: bytes, member_name: str
) -> tuple[list[list[list[tuple[float, float]]] | None], dict[str, Any]]:
    if len(contents) < 100:
        raise ValueError(f"{member_name} is too short for a Shapefile header")
    file_code = struct.unpack_from(">i", contents, 0)[0]
    declared_bytes = struct.unpack_from(">i", contents, 24)[0] * 2
    version, header_shape_type = struct.unpack_from("<2i", contents, 28)
    source_bbox = struct.unpack_from("<4d", contents, 36)
    if file_code != 9994 or version != 1000:
        raise ValueError(f"{member_name} has an invalid Shapefile header")
    if declared_bytes != len(contents):
        raise ValueError(
            f"{member_name} length is {len(contents)}, header says {declared_bytes}"
        )
    if header_shape_type not in {3, 13, 23}:
        raise ValueError(
            f"{member_name} has unsupported shape type {header_shape_type}"
        )

    records: list[list[list[tuple[float, float]]] | None] = []
    shape_type_counts: Counter[int] = Counter()
    offset = 100
    expected_record_number = 1
    point_count = 0
    part_count = 0
    while offset < len(contents):
        if offset + 8 > len(contents):
            raise ValueError(f"{member_name} has a truncated record header")
        record_number, content_words = struct.unpack_from(">2i", contents, offset)
        content_bytes = content_words * 2
        start = offset + 8
        end = start + content_bytes
        if end > len(contents):
            raise ValueError(f"{member_name} has a truncated record")
        if record_number != expected_record_number:
            raise ValueError(
                f"{member_name} record sequence changed at {record_number}"
            )
        expected_record_number += 1

        shape_type = struct.unpack_from("<i", contents, start)[0]
        shape_type_counts[shape_type] += 1
        if shape_type == 0:
            records.append(None)
            offset = end
            continue
        if shape_type not in {3, 13, 23}:
            raise ValueError(
                f"{member_name} record {record_number} has unsupported "
                f"shape type {shape_type}"
            )
        number_of_parts, number_of_points = struct.unpack_from(
            "<2i", contents, start + 36
        )
        parts_offset = start + 44
        points_offset = parts_offset + 4 * number_of_parts
        minimum = points_offset + 16 * number_of_points
        if (
            number_of_parts < 1
            or number_of_points < 2
            or minimum > end
        ):
            raise ValueError(
                f"{member_name} record {record_number} has invalid geometry"
            )
        part_starts = list(
            struct.unpack_from(
                f"<{number_of_parts}i", contents, parts_offset
            )
        )
        if part_starts[0] != 0 or part_starts != sorted(part_starts):
            raise ValueError(
                f"{member_name} record {record_number} has invalid parts"
            )
        points = [
            struct.unpack_from("<2d", contents, points_offset + index * 16)
            for index in range(number_of_points)
        ]
        part_ends = part_starts[1:] + [number_of_points]
        record_parts = [
            points[part_start:part_end]
            for part_start, part_end in zip(part_starts, part_ends)
        ]
        if any(len(part) < 2 for part in record_parts):
            raise ValueError(
                f"{member_name} record {record_number} has a short part"
            )
        records.append(record_parts)
        point_count += number_of_points
        part_count += number_of_parts
        offset = end

    return records, {
        "record_count": len(records),
        "shape_type": header_shape_type,
        "shape_type_counts": {
            str(key): value for key, value in sorted(shape_type_counts.items())
        },
        "source_bbox_epsg27700": {
            "west": source_bbox[0],
            "south": source_bbox[1],
            "east": source_bbox[2],
            "north": source_bbox[3],
        },
        "part_count": part_count,
        "point_count": point_count,
    }


def airy_meridional_arc(latitude: float) -> float:
    n = (AIRY_A - AIRY_B) / (AIRY_A + AIRY_B)
    n2 = n * n
    n3 = n2 * n
    delta = latitude - BNG_LAT0
    sigma = latitude + BNG_LAT0
    return AIRY_B * BNG_F0 * (
        (1 + n + 1.25 * n2 + 1.25 * n3) * delta
        - (3 * n + 3 * n2 + 21 / 8 * n3)
        * math.sin(delta)
        * math.cos(sigma)
        + (15 / 8 * n2 + 15 / 8 * n3)
        * math.sin(2 * delta)
        * math.cos(2 * sigma)
        - (35 / 24 * n3)
        * math.sin(3 * delta)
        * math.cos(3 * sigma)
    )


def bng_to_osgb36_geodetic(
    easting: float, northing: float
) -> tuple[float, float]:
    latitude = BNG_LAT0 + (northing - BNG_N0) / (AIRY_A * BNG_F0)
    for _ in range(12):
        residual = northing - BNG_N0 - airy_meridional_arc(latitude)
        latitude += residual / (AIRY_A * BNG_F0)
        if abs(residual) < 1e-5:
            break
    else:
        raise ValueError("British National Grid inverse projection did not converge")

    e2 = 1 - (AIRY_B * AIRY_B) / (AIRY_A * AIRY_A)
    sin_lat = math.sin(latitude)
    cos_lat = math.cos(latitude)
    tan_lat = math.tan(latitude)
    nu = AIRY_A * BNG_F0 / math.sqrt(1 - e2 * sin_lat * sin_lat)
    rho = (
        AIRY_A
        * BNG_F0
        * (1 - e2)
        / (1 - e2 * sin_lat * sin_lat) ** 1.5
    )
    eta2 = nu / rho - 1
    sec_lat = 1 / cos_lat
    tan2 = tan_lat * tan_lat
    tan4 = tan2 * tan2
    tan6 = tan4 * tan2

    vii = tan_lat / (2 * rho * nu)
    viii = tan_lat / (24 * rho * nu**3) * (
        5 + 3 * tan2 + eta2 - 9 * tan2 * eta2
    )
    ix = tan_lat / (720 * rho * nu**5) * (
        61 + 90 * tan2 + 45 * tan4
    )
    x = sec_lat / nu
    xi = sec_lat / (6 * nu**3) * (nu / rho + 2 * tan2)
    xii = sec_lat / (120 * nu**5) * (
        5 + 28 * tan2 + 24 * tan4
    )
    xiia = sec_lat / (5040 * nu**7) * (
        61 + 662 * tan2 + 1320 * tan4 + 720 * tan6
    )
    de = easting - BNG_E0
    latitude = latitude - vii * de**2 + viii * de**4 - ix * de**6
    longitude = (
        BNG_LON0
        + x * de
        - xi * de**3
        + xii * de**5
        - xiia * de**7
    )
    return latitude, longitude


def geodetic_to_cartesian(
    latitude: float, longitude: float, a: float, b: float
) -> tuple[float, float, float]:
    e2 = 1 - (b * b) / (a * a)
    sin_lat = math.sin(latitude)
    nu = a / math.sqrt(1 - e2 * sin_lat * sin_lat)
    cos_lat = math.cos(latitude)
    return (
        nu * cos_lat * math.cos(longitude),
        nu * cos_lat * math.sin(longitude),
        nu * (1 - e2) * sin_lat,
    )


def helmert_osgb36_to_wgs84(
    x: float, y: float, z: float
) -> tuple[float, float, float]:
    arcseconds_to_radians = math.pi / (180 * 3600)
    rx = HELMERT_RX_ARCSEC * arcseconds_to_radians
    ry = HELMERT_RY_ARCSEC * arcseconds_to_radians
    rz = HELMERT_RZ_ARCSEC * arcseconds_to_radians
    scale = 1 + HELMERT_SCALE_PPM * 1e-6
    return (
        HELMERT_TX + scale * x - rz * y + ry * z,
        HELMERT_TY + rz * x + scale * y - rx * z,
        HELMERT_TZ - ry * x + rx * y + scale * z,
    )


def cartesian_to_wgs84(
    x: float, y: float, z: float
) -> tuple[float, float]:
    e2 = 1 - (WGS84_B * WGS84_B) / (WGS84_A * WGS84_A)
    longitude = math.atan2(y, x)
    p = math.hypot(x, y)
    latitude = math.atan2(z, p * (1 - e2))
    for _ in range(12):
        nu = WGS84_A / math.sqrt(
            1 - e2 * math.sin(latitude) ** 2
        )
        next_latitude = math.atan2(
            z + e2 * nu * math.sin(latitude), p
        )
        if abs(next_latitude - latitude) < 1e-12:
            latitude = next_latitude
            break
        latitude = next_latitude
    return latitude, longitude


def bng_to_wgs84(easting: float, northing: float) -> tuple[float, float]:
    if not (
        math.isfinite(easting)
        and math.isfinite(northing)
        and -100_000 <= easting <= 800_000
        and -200_000 <= northing <= 1_400_000
    ):
        raise ValueError(
            f"Coordinate is outside expected EPSG:27700 bounds: "
            f"{easting}, {northing}"
        )
    osgb_lat, osgb_lon = bng_to_osgb36_geodetic(easting, northing)
    airy_xyz = geodetic_to_cartesian(
        osgb_lat, osgb_lon, AIRY_A, AIRY_B
    )
    wgs_xyz = helmert_osgb36_to_wgs84(*airy_xyz)
    wgs_lat, wgs_lon = cartesian_to_wgs84(*wgs_xyz)
    return math.degrees(wgs_lon), math.degrees(wgs_lat)


def verify_transform() -> dict[str, Any]:
    easting, northing = TRANSFORM_SELF_CHECK["input_easting_northing"]
    expected_lon, expected_lat = TRANSFORM_SELF_CHECK["expected_wgs84"]
    longitude, latitude = bng_to_wgs84(easting, northing)
    error = max(abs(longitude - expected_lon), abs(latitude - expected_lat))
    tolerance = TRANSFORM_SELF_CHECK["tolerance_degrees"]
    if error > tolerance:
        raise ValueError(
            f"BNG transform self-check error {error} exceeds {tolerance}"
        )
    return {
        **TRANSFORM_SELF_CHECK,
        "actual_wgs84": [longitude, latitude],
        "maximum_absolute_error_degrees": error,
        "passed": True,
    }


def canonical_part(
    source_points: list[tuple[float, float]]
) -> tuple[tuple[float, float], ...]:
    coordinates: list[tuple[float, float]] = []
    for easting, northing in source_points:
        longitude, latitude = bng_to_wgs84(easting, northing)
        coordinates.append(
            (
                round(longitude, COORDINATE_DECIMALS),
                round(latitude, COORDINATE_DECIMALS),
            )
        )
    converted = tuple(coordinates)
    if len(converted) < 2:
        raise ValueError("Transmission-line part has fewer than two points")
    reversed_part = tuple(reversed(converted))
    return min(converted, reversed_part)


def geometry_bounds(features: list[dict[str, Any]]) -> dict[str, float]:
    west = math.inf
    south = math.inf
    east = -math.inf
    north = -math.inf
    for feature in features:
        geometry = feature["geometry"]
        parts = (
            [geometry["coordinates"]]
            if geometry["type"] == "LineString"
            else geometry["coordinates"]
        )
        for part in parts:
            for longitude, latitude in part:
                west = min(west, longitude)
                south = min(south, latitude)
                east = max(east, longitude)
                north = max(north, latitude)
    if not features or not all(math.isfinite(v) for v in (west, south, east, north)):
        raise ValueError("No finite output bounds")
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


def select_archive(downloads: list[Any]) -> dict[str, Any]:
    matches = [
        entry
        for entry in downloads
        if isinstance(entry, dict)
        and entry.get("area") == "GB"
        and entry.get("format") == "ESRI® Shapefile"
    ]
    if len(matches) != 1:
        raise ValueError(f"Expected one GB Shapefile archive; found {len(matches)}")
    entry = matches[0]
    for field in ("url", "fileName", "size", "md5"):
        if not entry.get(field):
            raise ValueError(f"OS download entry is missing {field}")
    return entry


def selected_member_infos(
    archive: zipfile.ZipFile,
) -> dict[str, dict[str, zipfile.ZipInfo]]:
    selected: dict[str, dict[str, zipfile.ZipInfo]] = {}
    for info in archive.infolist():
        match = MEMBER_PATTERN.match(info.filename)
        if not match:
            continue
        tile = match.group("tile").upper()
        extension = match.group("extension").lower()
        selected.setdefault(tile, {})[extension] = info
    for tile, members in selected.items():
        missing = {"dbf", "prj", "shp", "shx"} - members.keys()
        if missing:
            raise ValueError(
                f"OS tile {tile} is missing selected members: {sorted(missing)}"
            )
    if not selected:
        raise ValueError("No ElectricityTransmissionLine Shapefiles found")
    return dict(sorted(selected.items()))


def build(args: argparse.Namespace) -> dict[str, Any]:
    if args.range_block_mib < 1:
        raise SystemExit("--range-block-mib must be positive")
    if args.range_cache_blocks < 2:
        raise SystemExit("--range-cache-blocks must be at least 2")

    product = curl_json(args.product_api_url, args.timeout)
    downloads = curl_json(args.downloads_api_url, args.timeout)
    if not isinstance(product, dict) or product.get("id") != PRODUCT_ID:
        raise ValueError("OS product API returned an unexpected product")
    if product.get("version") != SOURCE_VERSION:
        raise ValueError(
            f"Expected OS OpenMap Local {SOURCE_VERSION}, got "
            f"{product.get('version')!r}. Use the recorded archive or update "
            "the builder intentionally for a new release."
        )
    if not isinstance(downloads, list):
        raise ValueError("OS downloads API did not return a list")
    archive_entry = select_archive(downloads)

    range_reader: CurlRangeReader | None = None
    local_path: Path | None = None
    local_archive_md5: str | None = None
    if args.input_zip:
        local_path = args.input_zip.expanduser().resolve()
        if not local_path.is_file():
            raise SystemExit(f"Local OS ZIP does not exist: {local_path}")
        local_archive_md5 = md5_path(local_path)
        if local_archive_md5.lower() != str(archive_entry["md5"]).lower():
            raise ValueError(
                f"Local OS ZIP MD5 {local_archive_md5} does not match catalog "
                f"{archive_entry['md5']}"
            )
        archive_source: BinaryIO = local_path.open("rb")
        retrieval_mode = "complete local archive"
    else:
        range_reader = CurlRangeReader(
            archive_entry["url"],
            args.timeout,
            args.range_block_mib * 1024 * 1024,
            args.range_cache_blocks,
        )
        if range_reader.size != int(archive_entry["size"]):
            raise ValueError(
                f"OS archive size {range_reader.size} does not match catalog "
                f"{archive_entry['size']}"
            )
        archive_source = range_reader
        retrieval_mode = "HTTP byte-range member extraction"

    transform_self_check = verify_transform()
    member_metadata: dict[str, dict[str, Any]] = {}
    tile_metadata: dict[str, Any] = {}
    grouped: dict[str, dict[str, Any]] = {}
    source_record_count = 0
    source_part_count = 0
    source_point_count = 0
    deleted_record_count = 0
    null_shape_count = 0
    feature_code_counts: Counter[int] = Counter()
    duplicate_part_count = 0
    prj_values: set[str] = set()

    try:
        with archive_source:
            with zipfile.ZipFile(archive_source) as archive:
                selected = selected_member_infos(archive)
                for tile, infos in selected.items():
                    contents: dict[str, bytes] = {}
                    for extension, info in sorted(infos.items()):
                        data = archive.read(info)
                        contents[extension] = data
                        member_metadata[info.filename] = {
                            "tile": tile,
                            "extension": extension,
                            "size_bytes": info.file_size,
                            "compressed_size_bytes": info.compress_size,
                            "zip_crc32": f"{info.CRC:08x}",
                            "sha256": sha256_bytes(data),
                            "zip_crc_verified_by_full_member_read": True,
                        }

                    prj = contents["prj"].decode("ascii", errors="strict").strip()
                    prj_values.add(prj)
                    if (
                        "British_National_Grid" not in prj
                        or "Airy_1830" not in prj
                        or 'AUTHORITY["EPSG",27700]' not in prj
                    ):
                        raise ValueError(f"OS tile {tile} CRS is not EPSG:27700")

                    dbf_records, dbf_meta = parse_dbf(
                        contents["dbf"], infos["dbf"].filename
                    )
                    shp_records, shp_meta = parse_shapefile(
                        contents["shp"], infos["shp"].filename
                    )
                    if len(dbf_records) != len(shp_records):
                        raise ValueError(
                            f"OS tile {tile} DBF/SHP count mismatch: "
                            f"{len(dbf_records)} vs {len(shp_records)}"
                        )
                    tile_metadata[tile] = {
                        "dbf": dbf_meta,
                        "shapefile": shp_meta,
                    }
                    source_record_count += len(dbf_records)
                    source_part_count += shp_meta["part_count"]
                    source_point_count += shp_meta["point_count"]

                    for row, source_parts in zip(dbf_records, shp_records):
                        if row["_deleted"]:
                            deleted_record_count += 1
                            continue
                        if source_parts is None:
                            null_shape_count += 1
                            continue
                        original_id = row.get("ID")
                        feature_code = row.get("FEATCODE")
                        if not isinstance(original_id, str) or not original_id:
                            raise ValueError(f"OS tile {tile} row has no ID")
                        if not isinstance(feature_code, int):
                            raise ValueError(
                                f"OS feature {original_id} has no integer FEATCODE"
                            )
                        feature_code_counts[feature_code] += 1
                        group = grouped.setdefault(
                            original_id,
                            {
                                "feature_codes": set(),
                                "tiles": set(),
                                "parts": {},
                            },
                        )
                        group["feature_codes"].add(feature_code)
                        group["tiles"].add(tile)
                        for source_part in source_parts:
                            part = canonical_part(source_part)
                            key = canonical_json_bytes(part)
                            if key in group["parts"]:
                                duplicate_part_count += 1
                            else:
                                group["parts"][key] = part
    finally:
        if local_path and not archive_source.closed:
            archive_source.close()

    if prj_values.__len__() != 1:
        raise ValueError("OS selected members do not share one CRS definition")
    if set(feature_code_counts) != {EXPECTED_FEATURE_CODE}:
        raise ValueError(
            f"Unexpected OS feature codes: {dict(feature_code_counts)}"
        )

    output_features: list[dict[str, Any]] = []
    multipart_feature_count = 0
    for original_id in sorted(grouped):
        group = grouped[original_id]
        feature_codes = sorted(group["feature_codes"])
        if feature_codes != [EXPECTED_FEATURE_CODE]:
            raise ValueError(
                f"OS ID {original_id} has conflicting feature codes "
                f"{feature_codes}"
            )
        parts = [
            [list(coordinate) for coordinate in part]
            for _, part in sorted(group["parts"].items())
        ]
        if not parts:
            raise ValueError(f"OS ID {original_id} has no line parts")
        if len(parts) == 1:
            geometry = {"type": "LineString", "coordinates": parts[0]}
        else:
            multipart_feature_count += 1
            geometry = {"type": "MultiLineString", "coordinates": parts}
        output_features.append(
            {
                "type": "Feature",
                "id": original_id,
                "geometry": geometry,
                "properties": {
                    "REGION_KEY": "great-britain",
                    "ASSET_KIND": "official_transmission_line",
                    "SOURCE_ID": SOURCE_ID,
                    "ORIGINAL_ID": original_id,
                    "FEATURE_CODE": EXPECTED_FEATURE_CODE,
                    "GRID_SQUARES": "|".join(sorted(group["tiles"])),
                    "VOLTAGE_KV": None,
                    "SOURCE_DATE": SOURCE_VERSION,
                    "SOURCE_URL": PRODUCT_API_URL,
                    "SOURCE_LICENSE": LICENCE_SHORT,
                    "EVIDENCE": "official",
                    "GEOMETRY_CONFIDENCE": (
                        "official-openmap-local-1:10000-bng-helmert-wgs84-"
                        "rounded-6dp-no-simplification"
                    ),
                },
            }
        )

    if not output_features:
        raise ValueError("OS source produced no transmission-line features")
    bounds = geometry_bounds(output_features)
    output_document = {
        "type": "FeatureCollection",
        "name": "uk_os_openmap_local_electricity_lines",
        "source": {
            "id": SOURCE_ID,
            "publisher": PUBLISHER,
            "title": PRODUCT_TITLE,
            "version": SOURCE_VERSION,
            "product_api_url": PRODUCT_API_URL,
            "feature_documentation_url": FEATURE_DOCUMENTATION_URL,
            "licence": LICENCE_SHORT,
            "licence_url": LICENCE_URL,
            "attribution": ATTRIBUTION,
        },
        "features": output_features,
    }
    output_bytes = canonical_json_bytes(output_document) + b"\n"
    if len(output_bytes) >= MAX_OUTPUT_BYTES:
        raise ValueError(
            f"OS GeoJSON would be {len(output_bytes):,} bytes, over the "
            f"{MAX_OUTPUT_BYTES - 1:,}-byte limit. No output was written."
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

    reparsed = json.loads(output.read_text(encoding="utf-8"))
    if len(reparsed.get("features", [])) != len(output_features):
        raise ValueError("OS output feature count changed after serialization")
    if geometry_bounds(reparsed["features"]) != bounds:
        raise ValueError("OS output bounds changed after serialization")
    if sha256_path(output) != output_sha256:
        raise ValueError("OS output SHA-256 changed after serialization")

    catalog_md5 = str(archive_entry["md5"]).lower()
    response_md5_hex: str | None = None
    if range_reader:
        encoded_md5 = range_reader.response_metadata.get("content_md5_base64")
        if isinstance(encoded_md5, str):
            response_md5_hex = base64.b64decode(encoded_md5).hex()

    metadata = {
        "schema_version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source": {
            "id": SOURCE_ID,
            "publisher": PUBLISHER,
            "title": PRODUCT_TITLE,
            "product_id": PRODUCT_ID,
            "version": SOURCE_VERSION,
            "product_api_url": args.product_api_url,
            "downloads_api_url": args.downloads_api_url,
            "documentation_url": DOCUMENTATION_URL,
            "feature_documentation_url": FEATURE_DOCUMENTATION_URL,
            "archive": {
                "file_name": archive_entry["fileName"],
                "public_download_url": archive_entry["url"],
                "catalog_size_bytes": archive_entry["size"],
                "catalog_md5": catalog_md5,
                "retrieval_mode": retrieval_mode,
                "complete_archive_md5_verified": local_archive_md5 is not None,
                "local_archive_md5": local_archive_md5,
                "server_content_md5_hex": response_md5_hex,
                "server_content_md5_matches_catalog": (
                    response_md5_hex == catalog_md5
                    if response_md5_hex is not None
                    else None
                ),
                "http_range": (
                    {
                        **range_reader.response_metadata,
                        "range_request_count": range_reader.range_request_count,
                        "range_bytes_downloaded": (
                            range_reader.range_bytes_downloaded
                        ),
                        "range_block_bytes": range_reader.block_size,
                        "note": (
                            "The temporary signed redirect URL is intentionally "
                            "not recorded."
                        ),
                    }
                    if range_reader
                    else None
                ),
            },
            "selected_members": {
                "count": len(member_metadata),
                "compressed_size_bytes": sum(
                    item["compressed_size_bytes"]
                    for item in member_metadata.values()
                ),
                "uncompressed_size_bytes": sum(
                    item["size_bytes"] for item in member_metadata.values()
                ),
                "files": dict(sorted(member_metadata.items())),
            },
        },
        "licence": {
            "name": LICENCE_NAME,
            "short_name": LICENCE_SHORT,
            "url": LICENCE_URL,
            "attribution_required": True,
            "commercial_use_permitted": True,
            "modification_permitted": True,
            "redistribution_permitted": True,
            "required_attribution": ATTRIBUTION,
        },
        "scope": {
            "geography": "Great Britain",
            "source_layer": "ElectricityTransmissionLine",
            "source_definition": (
                "Cables used to supply electricity that are suspended "
                "between pylons."
            ),
            "source_scale": SOURCE_SCALE,
            "source_crs": SOURCE_CRS,
            "output_crs": OUTPUT_CRS,
            "source_grid_square_count": len(tile_metadata),
            "source_grid_squares": sorted(tile_metadata),
        },
        "transform": {
            "unit_of_observation": (
                "one original OS ID, with clipped/grid-square parts grouped "
                "as LineString or MultiLineString"
            ),
            "projection": (
                "Inverse British National Grid on Airy 1830, then the standard "
                "seven-parameter OSGB36-to-WGS84 Helmert transform."
            ),
            "projection_accuracy_note": (
                "The Helmert transform can differ from OSTN15 by several "
                "metres. It is appropriate for the generalized 1:10,000 web "
                "context layer, not cadastral or survey use."
            ),
            "geometry": (
                "No simplification, smoothing or inferred connectivity. "
                "Coordinates rounded to six decimal degrees. Identical parts "
                "are deduplicated and line direction is canonicalized."
            ),
            "coordinate_decimal_places": COORDINATE_DECIMALS,
            "voltage": (
                "OS OpenMap Local publishes no numeric voltage; VOLTAGE_KV "
                "is intentionally null."
            ),
            "self_check": transform_self_check,
        },
        "property_schema": {
            "REGION_KEY": "Constant atlas region key: great-britain.",
            "ASSET_KIND": "Constant: official_transmission_line.",
            "SOURCE_ID": f"Stable source identifier: {SOURCE_ID}.",
            "ORIGINAL_ID": "Original OS UUID from the Shapefile ID field.",
            "FEATURE_CODE": "Original FEATCODE; expected value 15102.",
            "GRID_SQUARES": "Pipe-separated source 100 km grid-square codes.",
            "VOLTAGE_KV": "Always null because voltage is not published.",
            "SOURCE_DATE": f"OS product version: {SOURCE_VERSION}.",
            "SOURCE_URL": "Official OS product API URL.",
            "SOURCE_LICENSE": f"Short reuse label: {LICENCE_SHORT}.",
            "EVIDENCE": "Constant evidence class: official.",
            "GEOMETRY_CONFIDENCE": (
                "Source scale, CRS transform, precision and simplification note."
            ),
        },
        "statistics": {
            "source_record_count": source_record_count,
            "source_part_count": source_part_count,
            "source_point_count": source_point_count,
            "deleted_record_count": deleted_record_count,
            "null_shape_count": null_shape_count,
            "feature_code_counts": {
                str(key): value
                for key, value in sorted(feature_code_counts.items())
            },
            "unique_original_id_count": len(output_features),
            "multipart_feature_count": multipart_feature_count,
            "duplicate_identical_part_count": duplicate_part_count,
            "output_geometry_counts": dict(
                Counter(
                    feature["geometry"]["type"]
                    for feature in output_features
                )
            ),
            "output_bounds_crs84": bounds,
            "tiles": tile_metadata,
        },
        "verification": {
            "product_version_verified": product.get("version") == SOURCE_VERSION,
            "catalog_archive_size_verified": (
                int(archive_entry["size"])
                == (
                    range_reader.size
                    if range_reader
                    else local_path.stat().st_size
                )
            ),
            "selected_member_zip_crc_verified": True,
            "selected_member_sha256_recorded": True,
            "source_crs_verified": True,
            "source_feature_code_verified": True,
            "transform_self_check_passed": True,
            "output_json_reparsed": True,
            "feature_ids_unique": (
                len({feature["id"] for feature in output_features})
                == len(output_features)
            ),
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
            "script": "scripts/grid-atlas/build-uk-os-openmap-local-grid.py",
            "steps": [
                "Verify OS product ID and pinned 2026-04 version.",
                "Select the GB ESRI Shapefile archive from the downloads API.",
                "Read the remote ZIP by byte range or verify a complete local ZIP.",
                "Read and CRC/SHA-256 verify only ElectricityTransmissionLine members.",
                "Validate DBF ID/FEATCODE and EPSG:27700 Shapefile schemas.",
                "Group clipped parts by the original OS UUID.",
                "Transform BNG vertices to WGS84 and round to six decimals.",
                "Write atomically and reparse to verify hash, count and bounds.",
            ],
        },
    }
    metadata_bytes = (
        json.dumps(
            metadata,
            ensure_ascii=False,
            indent=2,
            allow_nan=False,
        ).encode("utf-8")
        + b"\n"
    )
    if len(metadata_bytes) >= MAX_OUTPUT_BYTES:
        raise ValueError("OS metadata unexpectedly exceeds the 10 MiB limit")
    write_atomic(metadata_output, metadata_bytes)
    return metadata


def main() -> None:
    metadata = build(parse_args())
    output = metadata["output"]
    bounds = metadata["statistics"]["output_bounds_crs84"]
    print(
        f"Wrote {output['feature_count']:,} official OS transmission lines to "
        f"{output['path']} ({output['size_bytes']:,} bytes, "
        f"sha256={output['sha256']})."
    )
    print(f"Bounds: {bounds}")


if __name__ == "__main__":
    main()
