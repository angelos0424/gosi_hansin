#!/usr/bin/env python3
from __future__ import annotations

import json
import re
from collections import Counter, defaultdict
from pathlib import Path

from extract_questions import (
    ROOT,
    collect_sources,
    clean_lines,
    extract_candidates,
    detect_heading,
    lookahead_question_line,
    should_start_parent_group,
    parse_questions,
    parse_score,
)


OUT_DIR = ROOT / "audit"
REPORT = OUT_DIR / "question-segment-audit.md"
JSON_REPORT = OUT_DIR / "question-segment-audit.json"


def best_text(path: Path) -> str:
    candidates = []
    for text in extract_candidates(path):
        parsed = parse_questions(text)
        candidates.append((parse_score(parsed), text, parsed))
    _, text, _ = max(candidates, key=lambda item: item[0])
    return text


def normalize_title(title: str) -> str:
    title = re.sub(r"\s+", " ", title).strip()
    title = re.sub(r"^\d+\.\s+", "", title)
    title = re.sub(r"^※\s*", "", title)
    title = re.sub(r"^\[[^\]]+\]\s*", "", title)
    return title.strip()


def expected_from_title(title: str) -> int | None:
    title = normalize_title(title)
    range_match = re.search(r"(\d+)\s*~\s*(\d+)\s*번", title)
    if range_match:
        return int(range_match.group(2)) - int(range_match.group(1)) + 1

    choice_match = re.search(r"(\d+)\s*문항\s*선택", title)
    if choice_match:
        return int(choice_match.group(1))

    count_match = re.search(r"(\d+)\s*문항", title)
    if count_match:
        return int(count_match.group(1))

    choice_count = re.search(r"선택\s*(\d+)", title)
    if choice_count:
        return None

    return None


def is_segment_title(line: str) -> bool:
    return detect_heading(line) is not None


def _line_heading_parts(line: str):
    return detect_heading(line)


def _label_prefix(label: str | None) -> str | None:
    if not label:
        return None
    return label.split("-", 1)[0]


def _segment_key(title: str, label: str | None) -> str:
    normalized = normalize_title(title)
    return f"{normalized}::{_label_prefix(label) or 'na'}"


def line_question_label(line: str, active_group: int | None) -> str | None:
    sub = re.match(r"^(?:문)?(\d+)\)\s+", line)
    if sub and active_group is not None:
        return f"{active_group}-{int(sub.group(1))}"

    top = re.match(r"^(?:문)?(\d+)\.\s+", line)
    if top and not should_start_parent_group(line, ""):
        return str(int(top.group(1)))

    return None


def raw_segments(text: str) -> list[dict]:
    segments: list[dict] = []

    def make_segment(
        raw_title: str,
        raw_number: str | None,
        starter: str | None,
        is_container: bool,
        seed_labels: list[str] | None = None,
    ) -> dict:
        raw_labels = seed_labels[:] if seed_labels else []
        return {
            "title": normalize_title(raw_title),
            "rawLabels": raw_labels,
            "lineCount": len(raw_labels),
            "expected": expected_from_title(raw_title),
            "labelPrefix": raw_number,
            "key": _segment_key(raw_title, raw_number),
            "starter": starter,
            "isContainer": is_container,
        }

    current = {
        "title": "문서 시작",
        "rawLabels": [],
        "lineCount": 0,
        "expected": None,
        "labelPrefix": None,
        "key": _segment_key("문서 시작", None),
        "starter": None,
        "isContainer": False,
    }
    active_group: int | None = None
    parent_child_style: str | None = None

    def push() -> None:
        nonlocal current
        if current["rawLabels"] or current["title"] != "문서 시작":
            current["key"] = _segment_key(current["title"], current["labelPrefix"])
            segments.append(current)
        current = {
            "title": "문서 시작",
            "rawLabels": [],
            "lineCount": 0,
            "expected": None,
            "labelPrefix": None,
            "key": _segment_key("문서 시작", None),
            "starter": None,
            "isContainer": False,
        }

    lines = clean_lines(text)
    for idx, line in enumerate(lines):
        heading = _line_heading_parts(line)
        next_line = lookahead_question_line(lines, idx + 1) if idx + 1 < len(lines) else ""
        if heading is not None:
            kind, raw_number, raw_title = heading
            is_parent_group = (kind in {"dot", "bracket", "loose"}) and should_start_parent_group(line, next_line)
            heading_style = "dot" if kind in {"dot", "bracket", "loose"} else "paren"

            if is_parent_group:
                if current["rawLabels"] or current["title"] != "문서 시작":
                    push()
                current = make_segment(raw_title, str(int(raw_number)), kind, True)
                active_group = int(raw_number)
                parent_child_style = None
                continue

            if (
                active_group is None
                and heading_style == "paren"
                and current["starter"] in {"dot", "bracket", "loose"}
                and not current["isContainer"]
            ):
                current["lineCount"] += 1
                continue

            if active_group is not None:
                if parent_child_style is None:
                    parent_child_style = heading_style
                if parent_child_style == heading_style:
                    current["rawLabels"].append(f"{active_group}-{int(raw_number)}")
                    current["lineCount"] += 1
                    continue

                if parent_child_style != heading_style:
                    push()
                    active_group = None
                    parent_child_style = None

            if current["rawLabels"] or current["title"] != "문서 시작":
                push()
            current = make_segment(
                raw_title,
                str(int(raw_number)),
                kind,
                False,
                [str(int(raw_number))],
            )
            active_group = None
            continue

        current["lineCount"] += 1
        label = line_question_label(line, active_group)
        if label:
            current["rawLabels"].append(label)
        if label and current.get("labelPrefix") is None:
            current["labelPrefix"] = str(label).split("-", 1)[0]

    push()
    return segments


def parsed_segments(questions: list[dict]) -> dict[str, list[dict]]:
    grouped: dict[str, list[dict]] = defaultdict(list)
    for q in questions:
        key = _segment_key(q.get("groupTitle") or q.get("section") or "일반", q.get("numberLabel") or str(q.get("number")))
        grouped[key].append(q)
    return grouped


def label_sequence(labels: list[str]) -> str:
    if not labels:
        return "-"
    if len(labels) > 18:
        return ", ".join(labels[:18]) + f", ... (+{len(labels) - 18})"
    return ", ".join(labels)


def audit_document(source) -> dict:
    text = best_text(source.path)
    parsed = parse_questions(text)
    pseg = parsed_segments(parsed)
    segments = []
    issues = []

    for segment in raw_segments(text):
        title = normalize_title(segment["title"])
        parsed_items = pseg.get(segment["key"], [])
        parsed_labels = [q.get("numberLabel") or str(q.get("number")) for q in parsed_items]
        expected = segment["expected"]
        raw_count = len(segment["rawLabels"])
        parsed_count = len(parsed_items)
        flags = []

        if expected is not None and parsed_count != expected:
            flags.append(f"expected {expected}, parsed {parsed_count}")
        if raw_count and parsed_count and raw_count != parsed_count and not (
            expected is not None and parsed_count == expected
        ):
            flags.append(f"raw labels {raw_count}, parsed {parsed_count}")
        if raw_count and not parsed_count:
            flags.append("raw labels present but no parsed questions")
        if parsed_count and not raw_count and expected is not None:
            flags.append("parsed questions but no raw labels")
        if len(parsed_labels) != len(set(parsed_labels)):
            flags.append("duplicate parsed labels")

        segments.append(
            {
                "title": title,
                "expected": expected,
                "rawCount": raw_count,
                "parsedCount": parsed_count,
                "rawLabels": segment["rawLabels"],
                "parsedLabels": parsed_labels,
                "flags": flags,
            }
        )
        if flags:
            issues.append(segments[-1])

    parsed_only = []
    raw_keys = {segment["key"] for segment in raw_segments(text)}
    for key, items in pseg.items():
        if key not in raw_keys:
            title = key.split("::", 1)[0]
            parsed_only.append(
                {
                    "title": title,
                    "parsedCount": len(items),
                    "parsedLabels": [q.get("numberLabel") or str(q.get("number")) for q in items],
                }
            )

    duplicate_keys = Counter(
        (normalize_title(q.get("groupTitle") or q.get("section") or "일반"), q.get("numberLabel") or str(q.get("number")))
        for q in parsed
    )
    duplicates = [f"{section}:{label}" for (section, label), count in duplicate_keys.items() if count > 1]

    return {
        "fileName": source.path.name,
        "year": source.year,
        "session": source.session,
        "subject": source.subject,
        "questionCount": len(parsed),
        "segments": segments,
        "issues": issues,
        "parsedOnly": parsed_only,
        "duplicateLabels": duplicates,
    }


def main() -> None:
    OUT_DIR.mkdir(exist_ok=True)
    audits = [audit_document(source) for source in collect_sources()]
    JSON_REPORT.write_text(json.dumps(audits, ensure_ascii=False, indent=2), encoding="utf-8")

    lines = [
        "# Question Segment Audit",
        "",
        f"- Documents: {len(audits)}",
        f"- Questions: {sum(a['questionCount'] for a in audits)}",
        f"- Documents with segment flags: {sum(1 for a in audits if a['issues'] or a['duplicateLabels'])}",
        "",
    ]

    for audit in audits:
        if not audit["issues"] and not audit["duplicateLabels"] and not audit["parsedOnly"]:
            continue
        lines.extend(
            [
                f"## {audit['year']} {audit['session']} {audit['subject']} - {audit['fileName']}",
                f"- Parsed questions: {audit['questionCount']}",
            ]
        )
        if audit["duplicateLabels"]:
            lines.append(f"- Duplicate labels: {', '.join(audit['duplicateLabels'])}")
        for issue in audit["issues"]:
            lines.extend(
                [
                    f"- Segment: {issue['title']}",
                    f"  - Flags: {'; '.join(issue['flags'])}",
                    f"  - Expected: {issue['expected']}, raw: {issue['rawCount']}, parsed: {issue['parsedCount']}",
                    f"  - Raw labels: {label_sequence(issue['rawLabels'])}",
                    f"  - Parsed labels: {label_sequence(issue['parsedLabels'])}",
                ]
            )
        for item in audit["parsedOnly"]:
            lines.extend(
                [
                    f"- Parsed-only section: {item['title']}",
                    f"  - Parsed: {item['parsedCount']} ({label_sequence(item['parsedLabels'])})",
                ]
            )
        lines.append("")

    REPORT.write_text("\n".join(lines), encoding="utf-8")
    print(f"wrote {REPORT}")
    print(f"wrote {JSON_REPORT}")
    print(f"flagged_docs={sum(1 for a in audits if a['issues'] or a['duplicateLabels'])}")


if __name__ == "__main__":
    main()
