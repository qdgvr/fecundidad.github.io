#!/usr/bin/env python3
"""Build a reproducible snapshot of KEPCO transmission-project list pages.

KEPCO's public transmission-construction platform separates projects into four
mutually exclusive workflow stages.  Each stage exposes ten records per HTML
page with these public list fields:

* project name;
* facility type;
* responsible headquarters;
* responsible office.

This builder retrieves every numbered list page, preserves KEPCO's board
identifiers and displayed list number, and parses only voltage values that are
explicitly present in the project name.  It deliberately does not geocode,
create centroids, infer routes, or OCR the raster detail sheets.

The dashboard and the stage lists are captured independently.  Their counts
can differ while KEPCO updates the site.  The generated metadata records both
sets of counts, timestamps the observations, validates that each stage's
displayed list numbers are complete and non-duplicated, and never invents a
placeholder record to reconcile a mismatch.

No third-party Python package is required.
"""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import math
import re
import shutil
import subprocess
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from html.parser import HTMLParser
from pathlib import Path
from typing import Any


SOURCE_ID = "kr-kepco-transmission-construction-2026"
PUBLISHER = "Korea Electric Power Corporation (KEPCO)"
BASE_URL = "https://www.kepco.co.kr"
DASHBOARD_URL = (
    f"{BASE_URL}/home/disclosure/transdisclosure/transstatus/transinfo.do"
)
PAGE_SIZE = 10
USER_AGENT = (
    "Comunicacion-Grid-Atlas/1.0 "
    "(+https://qdgvr.github.io/fecundidad.github.io/)"
)


@dataclass(frozen=True)
class Stage:
    key: str
    label_ko: str
    menu_number: int
    board_mng_no: int
    path_segment: str

    @property
    def list_url(self) -> str:
        return (
            f"{BASE_URL}/home/disclosure/transdisclosure/transstatus/"
            f"{self.path_segment}/boardList.do"
        )

    @property
    def detail_url(self) -> str:
        return (
            f"{BASE_URL}/home/disclosure/transdisclosure/transstatus/"
            f"{self.path_segment}/boardView.do"
        )


STAGES = (
    Stage(
        key="plan_confirmed",
        label_ko="계획확정 - 사업승인전",
        menu_number=63,
        board_mng_no=64,
        path_segment="plantoapprove",
    ),
    Stage(
        key="project_approved",
        label_ko="사업승인 - 공사착수전",
        menu_number=64,
        board_mng_no=65,
        path_segment="approvetostart",
    ),
    Stage(
        key="construction_started",
        label_ko="공사착수 - 사업완료전",
        menu_number=65,
        board_mng_no=66,
        path_segment="starttocomplete",
    ),
    Stage(
        key="completed_within_one_year",
        label_ko="사업완료 - 준공후 1년",
        menu_number=66,
        board_mng_no=67,
        path_segment="completetoyear",
    ),
)

STAGE_BY_LABEL = {stage.label_ko: stage for stage in STAGES}
VOLTAGE_PATTERN = re.compile(
    r"(?<!\d)(\d{1,4}(?:[.,]\d+)?)\s*(?:k\s*v|㎸|Ｋ\s*Ｖ)",
    re.IGNORECASE,
)
DATE_PATTERN = re.compile(r"\b(20\d{2}-\d{2}-\d{2})\b")


@dataclass
class RetrievedPage:
    requested_url: str
    response_url: str
    body: bytes
    observed_at: str
    transport: str
    status: int | None
    content_type: str | None
    server_date: str | None
    last_modified: str | None
    etag: str | None
    cache_path: str | None = None

    @property
    def sha256(self) -> str:
        return hashlib.sha256(self.body).hexdigest()

    @property
    def size_bytes(self) -> int:
        return len(self.body)

    def text(self) -> str:
        return self.body.decode("utf-8-sig")


@dataclass
class ParsedListPage:
    current_page: int | None
    total_pages: int | None
    board_mng_no: int | None
    rows: list[dict[str, Any]]
    source_last_updated: str | None


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


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


def atomic_json_write(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    encoded = (
        json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8") + b"\n"
    )
    temporary = tempfile.NamedTemporaryFile(
        prefix=f".{path.name}.",
        suffix=".tmp",
        dir=path.parent,
        delete=False,
    )
    temporary_path = Path(temporary.name)
    try:
        with temporary:
            temporary.write(encoded)
        temporary_path.chmod(0o644)
        temporary_path.replace(path)
    except Exception:
        temporary_path.unlink(missing_ok=True)
        raise


def parse_args() -> argparse.Namespace:
    project_root = Path(__file__).resolve().parents[2]
    default_output = (
        project_root
        / "data"
        / "grid-atlas"
        / "kepco-transmission-projects.json"
    )
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output",
        type=Path,
        default=default_output,
        help=f"Project JSON destination (default: {default_output}).",
    )
    parser.add_argument(
        "--metadata-output",
        type=Path,
        help=(
            "Metadata destination. Defaults to "
            "data/grid-atlas/kepco-transmission-projects.metadata.json."
        ),
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=120.0,
        help="Per-request network timeout in seconds (default: 120).",
    )
    parser.add_argument(
        "--retries",
        type=int,
        default=3,
        help="Network attempts per page (default: 3).",
    )
    parser.add_argument(
        "--workers",
        type=int,
        default=3,
        help="Concurrent page requests, capped at 6 (default: 3).",
    )
    parser.add_argument(
        "--cache-dir",
        type=Path,
        help=(
            "Optional HTML cache. Existing named pages are reused; missing "
            "pages are downloaded and saved."
        ),
    )
    parser.add_argument(
        "--refresh",
        action="store_true",
        help="Ignore and replace existing files in --cache-dir.",
    )
    parser.add_argument(
        "--offline",
        action="store_true",
        help="Read every page from --cache-dir and make no network requests.",
    )
    parser.add_argument(
        "--allow-unstable-snapshot",
        action="store_true",
        help=(
            "Write output even if dashboard counts or first-page record "
            "signatures change during collection."
        ),
    )
    args = parser.parse_args()
    if args.retries < 1:
        parser.error("--retries must be at least 1")
    if args.workers < 1:
        parser.error("--workers must be at least 1")
    args.workers = min(args.workers, 6)
    if args.timeout <= 0:
        parser.error("--timeout must be positive")
    if args.offline and not args.cache_dir:
        parser.error("--offline requires --cache-dir")
    if args.offline and args.refresh:
        parser.error("--offline and --refresh cannot be combined")
    return args


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


class Fetcher:
    def __init__(
        self,
        *,
        timeout: float,
        retries: int,
        cache_dir: Path | None,
        refresh: bool,
        offline: bool,
    ) -> None:
        self.timeout = timeout
        self.retries = retries
        self.cache_dir = cache_dir.expanduser().resolve() if cache_dir else None
        self.refresh = refresh
        self.offline = offline
        if self.cache_dir:
            self.cache_dir.mkdir(parents=True, exist_ok=True)

    def fetch(self, url: str, cache_name: str) -> RetrievedPage:
        cache_path = self.cache_dir / cache_name if self.cache_dir else None
        if cache_path and cache_path.is_file() and not self.refresh:
            modified_at = datetime.fromtimestamp(
                cache_path.stat().st_mtime, timezone.utc
            ).isoformat()
            return RetrievedPage(
                requested_url=url,
                response_url=url,
                body=cache_path.read_bytes(),
                observed_at=modified_at,
                transport="HTML cache",
                status=None,
                content_type="text/html; cached",
                server_date=None,
                last_modified=None,
                etag=None,
                cache_path=str(cache_path),
            )
        if self.offline:
            raise FileNotFoundError(
                f"Offline cache page is missing: {cache_path or cache_name}"
            )

        last_error: Exception | None = None
        for attempt in range(1, self.retries + 1):
            try:
                result = self._fetch_with_urllib(url)
                break
            except Exception as urllib_error:
                try:
                    result = self._fetch_with_curl(url, urllib_error)
                    break
                except Exception as curl_error:
                    last_error = RuntimeError(
                        f"urllib failed ({urllib_error}); curl failed "
                        f"({curl_error})"
                    )
                    if attempt == self.retries:
                        raise last_error from curl_error
                    time.sleep(min(2 ** (attempt - 1), 8))
        else:  # pragma: no cover - loop always returns or raises
            raise RuntimeError(f"Could not retrieve {url}: {last_error}")

        if cache_path:
            cache_path.write_bytes(result.body)
            result.cache_path = str(cache_path)
        return result

    def _fetch_with_urllib(self, url: str) -> RetrievedPage:
        request = urllib.request.Request(
            url,
            headers={
                "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1",
                "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.5",
                "User-Agent": USER_AGENT,
            },
        )
        with urllib.request.urlopen(request, timeout=self.timeout) as response:
            body = response.read()
            headers = response.headers
            return RetrievedPage(
                requested_url=url,
                response_url=response.geturl(),
                body=body,
                observed_at=utc_now(),
                transport="Python urllib",
                status=getattr(response, "status", None),
                content_type=headers.get("Content-Type"),
                server_date=iso_http_date(headers.get("Date")),
                last_modified=iso_http_date(headers.get("Last-Modified")),
                etag=headers.get("ETag"),
            )

    def _fetch_with_curl(
        self, url: str, urllib_error: Exception
    ) -> RetrievedPage:
        curl = shutil.which("curl")
        if not curl:
            raise urllib_error
        body_file = tempfile.NamedTemporaryFile(
            prefix="kepco-projects-", suffix=".html", delete=False
        )
        header_file = tempfile.NamedTemporaryFile(
            prefix="kepco-projects-", suffix=".headers", delete=False
        )
        body_path = Path(body_file.name)
        header_path = Path(header_file.name)
        body_file.close()
        header_file.close()
        try:
            completed = subprocess.run(
                [
                    curl,
                    "--fail",
                    "--location",
                    "--silent",
                    "--show-error",
                    "--max-time",
                    str(max(1, math.ceil(self.timeout))),
                    "--user-agent",
                    USER_AGENT,
                    "--header",
                    "Accept-Language: ko-KR,ko;q=0.9,en;q=0.5",
                    "--dump-header",
                    str(header_path),
                    "--output",
                    str(body_path),
                    "--write-out",
                    "%{url_effective}",
                    url,
                ],
                check=True,
                capture_output=True,
                text=True,
            )
            raw_headers = header_path.read_text(
                encoding="iso-8859-1", errors="replace"
            )
            status, headers = final_curl_headers(raw_headers)
            return RetrievedPage(
                requested_url=url,
                response_url=completed.stdout.strip() or url,
                body=body_path.read_bytes(),
                observed_at=utc_now(),
                transport=(
                    "curl with platform TLS verification; urllib fallback "
                    f"reason: {urllib_error}"
                ),
                status=status,
                content_type=headers.get("content-type"),
                server_date=iso_http_date(headers.get("date")),
                last_modified=iso_http_date(headers.get("last-modified")),
                etag=headers.get("etag"),
            )
        finally:
            body_path.unlink(missing_ok=True)
            header_path.unlink(missing_ok=True)


class VisibleTextParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []

    def handle_data(self, data: str) -> None:
        self.parts.append(data)

    def value(self) -> str:
        return re.sub(r"\s+", " ", " ".join(self.parts)).strip()


def visible_text(fragment: str) -> str:
    parser = VisibleTextParser()
    parser.feed(fragment)
    return parser.value()


def source_last_updated(page_html: str) -> str | None:
    marker = page_html.find("최종업데이트일")
    if marker < 0:
        return None
    match = DATE_PATTERN.search(visible_text(page_html[marker : marker + 1200]))
    return match.group(1) if match else None


def parse_dashboard(page_html: str) -> dict[str, Any]:
    card_pattern = re.compile(
        r'<span[^>]*class="[^"]*\bcustom-number\b[^"]*"[^>]*>'
        r"\s*(\d+)\s*</span>\s*건\s*</strong>.*?"
        r'<p[^>]*class="[^"]*\binfo\b[^"]*"[^>]*>(.*?)</p>',
        re.IGNORECASE | re.DOTALL,
    )
    observed: dict[str, int] = {}
    for count_text, label_fragment in card_pattern.findall(page_html):
        label = html.unescape(visible_text(label_fragment))
        stage = STAGE_BY_LABEL.get(label)
        if stage:
            observed[stage.key] = int(count_text)
    missing = [stage.key for stage in STAGES if stage.key not in observed]
    if missing:
        raise ValueError(
            "Dashboard did not expose all expected stage counts: "
            + ", ".join(missing)
        )
    return {
        "counts": observed,
        "total": sum(observed.values()),
        "source_last_updated": source_last_updated(page_html),
    }


class ProjectListParser(HTMLParser):
    """Parse only the public project rows and pagination controls."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.div_depth = 0
        self.tbody_depth: int | None = None
        self.row_depth: int | None = None
        self.column_depth: int | None = None
        self.column_field: str | None = None
        self.column_parts: list[str] = []
        self.current_row: dict[str, Any] | None = None
        self.rows: list[dict[str, Any]] = []
        self.current_page: int | None = None
        self.total_pages: int | None = None
        self.board_mng_no: int | None = None

    @staticmethod
    def attributes(attrs: list[tuple[str, str | None]]) -> dict[str, str]:
        return {key: value or "" for key, value in attrs}

    def handle_starttag(
        self, tag: str, attrs: list[tuple[str, str | None]]
    ) -> None:
        attributes = self.attributes(attrs)
        classes = set(attributes.get("class", "").split())

        if tag == "input":
            element_id = attributes.get("id")
            if element_id == "paginationNum":
                self.current_page = integer_or_none(attributes.get("value"))
                self.total_pages = integer_or_none(attributes.get("max"))
            elif element_id == "boardMngNo":
                value = integer_or_none(attributes.get("value"))
                if value is not None:
                    self.board_mng_no = value

        if (
            tag == "a"
            and self.current_row is not None
            and self.column_field == "project_name"
        ):
            detail_match = re.search(
                r"fn_Detail\(\s*['\"](\d+)['\"]\s*,\s*['\"](\d+)['\"]\s*\)",
                attributes.get("href", ""),
            )
            if detail_match:
                self.current_row["board_mng_no"] = int(detail_match.group(1))
                self.current_row["board_no"] = int(detail_match.group(2))

        if tag != "div":
            return

        depth = self.div_depth
        self.div_depth += 1
        if "board-list-tbody" in classes:
            self.tbody_depth = depth
            return
        if (
            self.tbody_depth is not None
            and self.current_row is None
            and "board-list-row" in classes
        ):
            self.current_row = {}
            self.row_depth = depth
            return
        if self.current_row is None or "column" not in classes:
            return

        if "board-m-display-none" in classes:
            field = "list_number"
        elif "board-title" in classes:
            field = "project_name"
        elif "board-block" in classes:
            field = {
                "설비종류": "facility_type",
                "담당본부": "responsible_headquarters",
                "담당사업소": "responsible_office",
            }.get(attributes.get("aria-label", ""))
        else:
            field = None
        if field:
            self.column_field = field
            self.column_depth = depth
            self.column_parts = []

    def handle_data(self, data: str) -> None:
        if self.column_field:
            self.column_parts.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag != "div":
            return
        self.div_depth -= 1
        closed_depth = self.div_depth

        if (
            self.column_field is not None
            and self.column_depth == closed_depth
            and self.current_row is not None
        ):
            value = re.sub(r"\s+", " ", "".join(self.column_parts)).strip()
            if self.column_field == "list_number":
                self.current_row[self.column_field] = integer_or_none(value)
            else:
                self.current_row[self.column_field] = value or None
            self.column_field = None
            self.column_depth = None
            self.column_parts = []

        if (
            self.current_row is not None
            and self.row_depth == closed_depth
        ):
            self.rows.append(self.current_row)
            self.current_row = None
            self.row_depth = None

        if self.tbody_depth == closed_depth:
            self.tbody_depth = None


def integer_or_none(value: Any) -> int | None:
    if value is None:
        return None
    text = str(value).strip()
    return int(text) if text.isdigit() else None


def parse_list_page(page_html: str) -> ParsedListPage:
    parser = ProjectListParser()
    parser.feed(page_html)
    return ParsedListPage(
        current_page=parser.current_page,
        total_pages=parser.total_pages,
        board_mng_no=parser.board_mng_no,
        rows=parser.rows,
        source_last_updated=source_last_updated(page_html),
    )


def numeric_voltage(value: str) -> int | float:
    number = float(value.replace(",", "."))
    return int(number) if number.is_integer() else number


def extract_voltage_values(project_name: str) -> list[int | float]:
    values: list[int | float] = []
    for match in VOLTAGE_PATTERN.finditer(project_name):
        value = numeric_voltage(match.group(1))
        if value not in values:
            values.append(value)
    return values


def page_url(stage: Stage, page: int) -> str:
    return f"{stage.list_url}?{urllib.parse.urlencode({'page': page})}"


def detail_url(stage: Stage, board_mng_no: int, board_no: int) -> str:
    query = urllib.parse.urlencode(
        {"boardMngNo": board_mng_no, "boardNo": board_no}
    )
    return f"{stage.detail_url}?{query}"


def page_evidence(
    retrieved: RetrievedPage, parsed: ParsedListPage, page: int
) -> dict[str, Any]:
    list_numbers = [row.get("list_number") for row in parsed.rows]
    return {
        "page": page,
        "requested_url": retrieved.requested_url,
        "response_url": retrieved.response_url,
        "observed_at": retrieved.observed_at,
        "server_date": retrieved.server_date,
        "transport": retrieved.transport,
        "http_status": retrieved.status,
        "content_type": retrieved.content_type,
        "bytes": retrieved.size_bytes,
        "sha256": retrieved.sha256,
        "row_count": len(parsed.rows),
        "first_list_number": list_numbers[0] if list_numbers else None,
        "last_list_number": list_numbers[-1] if list_numbers else None,
    }


def dashboard_evidence(
    retrieved: RetrievedPage, parsed: dict[str, Any]
) -> dict[str, Any]:
    return {
        "requested_url": retrieved.requested_url,
        "response_url": retrieved.response_url,
        "observed_at": retrieved.observed_at,
        "server_date": retrieved.server_date,
        "transport": retrieved.transport,
        "http_status": retrieved.status,
        "content_type": retrieved.content_type,
        "bytes": retrieved.size_bytes,
        "sha256": retrieved.sha256,
        "source_last_updated": parsed["source_last_updated"],
        "counts": parsed["counts"],
        "total": parsed["total"],
    }


def first_page_signature(parsed: ParsedListPage) -> list[list[Any]]:
    return [
        [
            row.get("board_mng_no"),
            row.get("board_no"),
            row.get("list_number"),
            row.get("project_name"),
            row.get("facility_type"),
            row.get("responsible_headquarters"),
            row.get("responsible_office"),
        ]
        for row in parsed.rows
    ]


def validate_stage_pages(
    stage: Stage,
    pages: dict[int, tuple[RetrievedPage, ParsedListPage]],
) -> tuple[int, list[dict[str, Any]]]:
    first = pages[1][1]
    if first.board_mng_no != stage.board_mng_no:
        raise ValueError(
            f"{stage.key}: expected boardMngNo {stage.board_mng_no}, "
            f"found {first.board_mng_no}"
        )
    if not first.rows:
        if first.total_pages not in (None, 0, 1):
            raise ValueError(
                f"{stage.key}: no rows but pagination reports "
                f"{first.total_pages} pages"
            )
        return 0, []

    listed_count = first.rows[0].get("list_number")
    if not isinstance(listed_count, int) or listed_count < 1:
        raise ValueError(
            f"{stage.key}: first displayed list number is not a valid count"
        )
    expected_pages = math.ceil(listed_count / PAGE_SIZE)
    if first.total_pages != expected_pages:
        raise ValueError(
            f"{stage.key}: list count {listed_count} implies "
            f"{expected_pages} pages, but KEPCO reports {first.total_pages}"
        )
    if set(pages) != set(range(1, expected_pages + 1)):
        raise ValueError(f"{stage.key}: fetched page set is incomplete")

    rows: list[dict[str, Any]] = []
    for page in range(1, expected_pages + 1):
        parsed = pages[page][1]
        if parsed.current_page != page:
            raise ValueError(
                f"{stage.key}: requested page {page}, parsed "
                f"page {parsed.current_page}"
            )
        if parsed.total_pages != expected_pages:
            raise ValueError(
                f"{stage.key}: page {page} changed total page count to "
                f"{parsed.total_pages}"
            )
        if parsed.board_mng_no != stage.board_mng_no:
            raise ValueError(
                f"{stage.key}: page {page} changed boardMngNo to "
                f"{parsed.board_mng_no}"
            )
        expected_row_count = (
            PAGE_SIZE
            if page < expected_pages
            else listed_count - PAGE_SIZE * (expected_pages - 1)
        )
        if len(parsed.rows) != expected_row_count:
            raise ValueError(
                f"{stage.key}: page {page} has {len(parsed.rows)} rows; "
                f"expected {expected_row_count}"
            )
        rows.extend(parsed.rows)

    displayed_numbers = [row.get("list_number") for row in rows]
    expected_numbers = list(range(listed_count, 0, -1))
    if displayed_numbers != expected_numbers:
        raise ValueError(
            f"{stage.key}: displayed list numbers contain a gap, duplicate, "
            "or ordering change"
        )

    source_record_ids: set[tuple[int, int]] = set()
    required_fields = (
        "project_name",
        "facility_type",
        "responsible_headquarters",
        "responsible_office",
        "board_mng_no",
        "board_no",
    )
    for index, row in enumerate(rows, start=1):
        missing = [field for field in required_fields if row.get(field) is None]
        if missing:
            raise ValueError(
                f"{stage.key}: parsed row {index} is missing "
                + ", ".join(missing)
            )
        if row["board_mng_no"] != stage.board_mng_no:
            raise ValueError(
                f"{stage.key}: row {index} detail link uses boardMngNo "
                f"{row['board_mng_no']}"
            )
        source_record_id = (row["board_mng_no"], row["board_no"])
        if source_record_id in source_record_ids:
            raise ValueError(
                f"{stage.key}: duplicate source record {source_record_id}"
            )
        source_record_ids.add(source_record_id)
    return listed_count, rows


def normalized_project(
    stage: Stage, row: dict[str, Any], source_page: int
) -> dict[str, Any]:
    voltages = extract_voltage_values(row["project_name"])
    board_mng_no = row["board_mng_no"]
    board_no = row["board_no"]
    return {
        "source_record_id": f"{board_mng_no}:{board_no}",
        "board_mng_no": board_mng_no,
        "board_no": board_no,
        "list_number": row["list_number"],
        "stage": stage.key,
        "stage_label_ko": stage.label_ko,
        "project_name": row["project_name"],
        "facility_type": row["facility_type"],
        "responsible_headquarters": row["responsible_headquarters"],
        "responsible_office": row["responsible_office"],
        "voltage_kv": voltages[0] if voltages else None,
        "voltage_kv_values": voltages,
        "voltage_source": "project_name" if voltages else None,
        "source_list_page": source_page,
        "source_list_url": page_url(stage, source_page),
        "source_detail_url": detail_url(stage, board_mng_no, board_no),
    }


def stage_for_row_number(listed_count: int, row_index: int) -> int:
    if row_index < 0 or row_index >= listed_count:
        raise IndexError(row_index)
    return row_index // PAGE_SIZE + 1


def aggregate_page_digest(
    page_audits: list[dict[str, Any]]
) -> str:
    canonical = json.dumps(
        [[page["page"], page["sha256"]] for page in page_audits],
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(canonical).hexdigest()


def main() -> int:
    args = parse_args()
    output = args.output.expanduser().resolve()
    metadata_output = (
        args.metadata_output.expanduser().resolve()
        if args.metadata_output
        else output.with_name("kepco-transmission-projects.metadata.json")
    )
    fetcher = Fetcher(
        timeout=args.timeout,
        retries=args.retries,
        cache_dir=args.cache_dir,
        refresh=args.refresh,
        offline=args.offline,
    )
    observation_started_at = utc_now()

    dashboard_before_page = fetcher.fetch(
        DASHBOARD_URL, "dashboard-before.html"
    )
    dashboard_before = parse_dashboard(dashboard_before_page.text())

    stage_results: dict[str, dict[str, Any]] = {}
    all_projects: list[dict[str, Any]] = []
    unstable_reasons: list[str] = []

    for stage in STAGES:
        first_retrieved = fetcher.fetch(
            page_url(stage, 1), f"{stage.key}-page-001.html"
        )
        first_parsed = parse_list_page(first_retrieved.text())
        if first_parsed.total_pages is None:
            raise ValueError(f"{stage.key}: pagination controls were not found")
        total_pages = first_parsed.total_pages
        pages: dict[int, tuple[RetrievedPage, ParsedListPage]] = {
            1: (first_retrieved, first_parsed)
        }

        def retrieve_page(
            page: int,
        ) -> tuple[int, RetrievedPage, ParsedListPage]:
            retrieved = fetcher.fetch(
                page_url(stage, page),
                f"{stage.key}-page-{page:03d}.html",
            )
            return page, retrieved, parse_list_page(retrieved.text())

        with ThreadPoolExecutor(max_workers=args.workers) as executor:
            futures = {
                executor.submit(retrieve_page, page): page
                for page in range(2, total_pages + 1)
            }
            for future in as_completed(futures):
                page, retrieved, parsed = future.result()
                pages[page] = (retrieved, parsed)

        listed_count, rows = validate_stage_pages(stage, pages)
        for row_index, row in enumerate(rows):
            source_page = stage_for_row_number(listed_count, row_index)
            all_projects.append(normalized_project(stage, row, source_page))

        page_audits = [
            page_evidence(*pages[page], page)
            for page in range(1, total_pages + 1)
        ]
        recheck_retrieved = fetcher.fetch(
            page_url(stage, 1), f"{stage.key}-page-001-recheck.html"
        )
        recheck_parsed = parse_list_page(recheck_retrieved.text())
        first_page_stable = (
            first_page_signature(first_parsed)
            == first_page_signature(recheck_parsed)
            and first_parsed.total_pages == recheck_parsed.total_pages
            and first_parsed.board_mng_no == recheck_parsed.board_mng_no
            and first_parsed.source_last_updated
            == recheck_parsed.source_last_updated
        )
        if not first_page_stable:
            unstable_reasons.append(
                f"{stage.key}: first-page records or pagination changed "
                "during collection"
            )

        stage_results[stage.key] = {
            "key": stage.key,
            "label_ko": stage.label_ko,
            "menu_number": stage.menu_number,
            "board_mng_no": stage.board_mng_no,
            "list_url": stage.list_url,
            "detail_url": stage.detail_url,
            "source_last_updated": first_parsed.source_last_updated,
            "dashboard_count_before": dashboard_before["counts"][stage.key],
            "listed_count": listed_count,
            "count_difference_dashboard_minus_list": (
                dashboard_before["counts"][stage.key] - listed_count
            ),
            "page_count": total_pages,
            "row_count": len(rows),
            "page_size": PAGE_SIZE,
            "validation": {
                "displayed_list_numbers_complete": True,
                "displayed_list_numbers_unique": True,
                "source_record_ids_unique_within_stage": True,
                "required_public_list_fields_present": True,
                "first_page_stable_during_collection": first_page_stable,
            },
            "first_page_recheck": page_evidence(
                recheck_retrieved, recheck_parsed, 1
            ),
            "page_sha256_manifest_digest": aggregate_page_digest(page_audits),
            "pages": page_audits,
        }

    dashboard_after_page = fetcher.fetch(
        DASHBOARD_URL, "dashboard-after.html"
    )
    dashboard_after = parse_dashboard(dashboard_after_page.text())
    dashboard_stable = (
        dashboard_before["counts"] == dashboard_after["counts"]
        and dashboard_before["source_last_updated"]
        == dashboard_after["source_last_updated"]
    )
    if not dashboard_stable:
        unstable_reasons.append(
            "dashboard stage counts or source update date changed during "
            "collection"
        )
    if unstable_reasons and not args.allow_unstable_snapshot:
        raise RuntimeError(
            "KEPCO changed while the snapshot was being collected. Rerun the "
            "builder, or inspect and explicitly pass "
            "--allow-unstable-snapshot. Changes: "
            + "; ".join(unstable_reasons)
        )

    listed_counts = {
        stage.key: stage_results[stage.key]["listed_count"] for stage in STAGES
    }
    dashboard_counts = dashboard_before["counts"]
    listed_total = sum(listed_counts.values())
    dashboard_total = dashboard_before["total"]
    count_difference = dashboard_total - listed_total

    built_at = utc_now()
    data_payload = {
        "schema_version": 1,
        "source_id": SOURCE_ID,
        "publisher": PUBLISHER,
        "snapshot_built_at": built_at,
        "record_scope": (
            "All records exposed by KEPCO's four numbered public stage lists "
            "during this snapshot."
        ),
        "dashboard_reported_total": dashboard_total,
        "listed_record_total": listed_total,
        "contains_geometry": False,
        "projects": all_projects,
    }
    atomic_json_write(output, data_payload)

    with_voltage = sum(
        1 for project in all_projects if project["voltage_kv"] is not None
    )
    multiple_voltages = sum(
        1 for project in all_projects if len(project["voltage_kv_values"]) > 1
    )
    source_record_ids = [
        project["source_record_id"] for project in all_projects
    ]
    if len(source_record_ids) != len(set(source_record_ids)):
        raise RuntimeError("Cross-stage source record IDs are not unique")

    stage_metadata = [stage_results[stage.key] for stage in STAGES]
    discrepancy_by_stage = {
        stage.key: dashboard_counts[stage.key] - listed_counts[stage.key]
        for stage in STAGES
    }
    metadata_payload = {
        "schema_version": 1,
        "built_at": built_at,
        "source": {
            "id": SOURCE_ID,
            "publisher": PUBLISHER,
            "title": "Transmission and substation construction disclosure",
            "dashboard_url": DASHBOARD_URL,
            "publication_status": "public official website",
            "licence": (
                "KEPCO official website publication terms; confirm reuse "
                "requirements before downstream republication."
            ),
        },
        "snapshot": {
            "observation_started_at": observation_started_at,
            "observation_finished_at": built_at,
            "dashboard_stable_during_collection": dashboard_stable,
            "stage_first_pages_stable_during_collection": all(
                stage_result["validation"][
                    "first_page_stable_during_collection"
                ]
                for stage_result in stage_metadata
            ),
            "unstable_reasons": unstable_reasons,
            "dashboard_before": dashboard_evidence(
                dashboard_before_page, dashboard_before
            ),
            "dashboard_after": dashboard_evidence(
                dashboard_after_page, dashboard_after
            ),
        },
        "count_reconciliation": {
            "dashboard_reported_counts": dashboard_counts,
            "dashboard_reported_total": dashboard_total,
            "stage_list_counts": listed_counts,
            "stage_list_total": listed_total,
            "dashboard_minus_list_by_stage": discrepancy_by_stage,
            "dashboard_minus_list_total": count_difference,
            "reconciled": count_difference == 0,
            "rule": (
                "The data file contains only records actually exposed by the "
                "numbered stage lists. A dashboard/list mismatch is preserved "
                "as evidence; no synthetic or placeholder project is created."
            ),
            "observed_note": (
                "At this snapshot the dashboard reported 849 projects "
                "(444 + 189 + 202 + 14), while the four numbered lists exposed "
                "848 rows (443 + 189 + 202 + 14). The one-record difference "
                "is confined to plan_confirmed and is timestamped above."
                if dashboard_total == 849
                and listed_total == 848
                and discrepancy_by_stage["plan_confirmed"] == 1
                else (
                    "Dashboard and list counts are reported exactly as "
                    "observed in this run."
                )
            ),
        },
        "stages": stage_metadata,
        "extraction": {
            "unit_of_observation": (
                "one KEPCO public stage-list row; project names are not "
                "deduplicated or merged"
            ),
            "public_list_fields_preserved": [
                "project_name",
                "facility_type",
                "responsible_headquarters",
                "responsible_office",
                "stage",
                "board_mng_no",
                "board_no",
                "list_number",
            ],
            "voltage_rule": (
                "voltage_kv is the first kV value explicitly printed in "
                "project_name; voltage_kv_values preserves every distinct "
                "explicit kV value in appearance order. Null means the list "
                "title did not state a voltage. No voltage is inferred from "
                "facility type or another project."
            ),
            "list_number_note": (
                "list_number is KEPCO's current descending display ordinal, "
                "not a permanent cross-snapshot identifier"
            ),
            "detail_enrichment": {
                "detail_pages_fetched": False,
                "raster_detail_ocr_performed": False,
                "administrative_location_included": False,
                "reason": (
                    "Most detailed progress fields are embedded in raster "
                    "images without machine-readable text. Automatic OCR was "
                    "not included because per-record verification was outside "
                    "this reproducible list-only build."
                ),
            },
            "geometry": {
                "coordinates_included": False,
                "centroids_created": False,
                "line_routes_created": False,
                "rule": (
                    "The public list pages do not publish reusable coordinates "
                    "or route geometry. Project names, offices, and facility "
                    "types are never converted into map geometry."
                ),
            },
        },
        "counts": {
            "project_records": len(all_projects),
            "by_stage": listed_counts,
            "records_with_explicit_title_voltage": with_voltage,
            "records_without_explicit_title_voltage": (
                len(all_projects) - with_voltage
            ),
            "records_with_multiple_explicit_title_voltages": multiple_voltages,
            "unique_source_record_ids": len(set(source_record_ids)),
        },
        "output": {
            "path": portable_output_path(output),
            "bytes": output.stat().st_size,
            "sha256": sha256_path(output),
            "contains_geometry": False,
        },
    }
    atomic_json_write(metadata_output, metadata_payload)
    print(
        f"Wrote {len(all_projects)} KEPCO project rows to {output} "
        f"(dashboard={dashboard_total}, listed={listed_total})."
    )
    print(f"Wrote metadata to {metadata_output}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
