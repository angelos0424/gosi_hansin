#!/usr/bin/env python3
from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path

from extract_questions import clean_lines

ROOT = Path(__file__).resolve().parents[1]
DOWNLOADS = ROOT / "downloads"
OUTPUT = ROOT / "audit" / "manual-year-review.md"
HWP5TXT = Path("/Users/windows11/Library/Python/3.14/bin/hwp5txt")


def extract_text(path: Path) -> str:
    if path.suffix.lower() == ".pdf":
        return subprocess.run(
            ["pdftotext", "-layout", str(path), "-"],
            check=True,
            capture_output=True,
            text=True,
        ).stdout
    if path.suffix.lower() == ".hwp":
        return subprocess.run(
            [str(HWP5TXT), str(path)],
            check=True,
            capture_output=True,
            text=True,
        ).stdout
    return path.read_text(encoding="utf-8", errors="replace")


def is_question_heading(line: str) -> bool:
    if re.match(r"^문\s*\d+\.\s+.{4,}", line):
        return True
    if re.match(r"^\d+[.)]\s+.{4,}", line):
        return True
    if re.match(r"^\[[문Q]\d+\]\s*", line):
        return True
    # 공백 구분 번호
    m = re.match(r"^(\d+)\s+(.+)", line)
    if not m:
        return False
    body = m.group(2).strip()
    if len(body) < 4:
        return False
    if re.match(r"^[·○①②③④⑤]\s+", body):
        return False
    if re.search(
        r"문항|적으|쓰기|고르|설명|기술|구분|무엇|항목|아래|다음|작성|정의|쓰시오|적으시오|답하|채우|맞|틀린|구분하",
        body,
    ):
        return True
    return False


def parse_year_and_session(title: str, filename: str) -> tuple[int, str]:
    y = int(re.search(r"(20\d{2})", f"{title} {filename}").group(1))
    session = "제1차" if "1차" in title else "제2차" if "2차" in title else "기타"
    return y, session


def parse_subject(path: Path, title: str) -> str:
    nm = (path.name + " " + title)
    if "성경" in nm:
        return "성경"
    if "교단" in nm or "헌법" in nm:
        return "교단헌법"
    return "기타"


def collect_documents() -> list[tuple[int, str, str, Path]]:
    manifest = json.loads((DOWNLOADS / "manifest.json").read_text(encoding="utf-8"))
    out: list[tuple[int, str, str, Path]] = []
    for idx, post in enumerate(manifest, 1):
        year, session = parse_year_and_session(post["title"], post["files"][0]["filename"])
        folder = next(DOWNLOADS.glob(f"{idx:02d}_*"))
        for file_info in post["files"]:
            path = folder / file_info["filename"]
            out.append((year, session, parse_subject(path, post["title"]), path))
    return out


def extract_headings(lines: list[str]) -> list[tuple[int, str]]:
    headings: list[tuple[int, str]] = []
    for idx, line in enumerate(lines, 1):
        if is_question_heading(line):
            headings.append((idx, line))
    return headings


def main() -> None:
    docs = collect_documents()
    by_year: dict[int, list[dict]] = {}

    for year, session, subject, path in docs:
        text = extract_text(path)
        lines = clean_lines(text)
        headings = extract_headings(lines)
        by_year.setdefault(year, []).append(
            {
                "session": session,
                "subject": subject,
                "file": path.name,
                "count": len(headings),
                "headings": headings,
            }
        )

    lines_out = ["# 연도별 직접 검수 후보(문항 라인)", ""]
    for year in sorted(by_year.keys(), reverse=True):
        lines_out.append(f"## {year}")
        for item in sorted(by_year[year], key=lambda x: (x["session"], x["file"])):
            lines_out.append(
                f"- {item['session']} / {item['subject']} / {item['file']} => {item['count']}개"
            )
            if item["count"]:
                for num, text in item["headings"]:
                    lines_out.append(f"  - {num:4d}: {text}")
        lines_out.append("")

    OUTPUT.write_text("\n".join(lines_out), encoding="utf-8")
    print(f"wrote {OUTPUT}")


if __name__ == "__main__":
    main()
