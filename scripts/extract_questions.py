#!/usr/bin/env python3
from __future__ import annotations

import json
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DOWNLOADS = ROOT / "downloads"
OUT = ROOT / "src" / "questionData.json"
HWP5TXT = Path("/Users/windows11/Library/Python/3.14/bin/hwp5txt")
MAX_GRP_LOOKAHEAD = 8


@dataclass
class SourceFile:
    post_title: str
    post_url: str
    path: Path
    year: int
    session: str
    subject: str


def run_text(command: list[str]) -> str:
    result = subprocess.run(command, check=True, capture_output=True, text=True)
    return result.stdout


def extract_text(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix == ".pdf":
        return run_text(["pdftotext", "-layout", str(path), "-"])
    if suffix == ".hwp":
        return run_text([str(HWP5TXT), str(path)])
    return path.read_text(encoding="utf-8", errors="replace")


def extract_candidates(path: Path) -> list[str]:
    if path.suffix.lower() == ".pdf":
        return [
            run_text(["pdftotext", "-layout", str(path), "-"]),
            run_text(["pdftotext", str(path), "-"]),
        ]
    return [extract_text(path)]


def infer_year_session(title: str, filename: str) -> tuple[int, str]:
    text = f"{title} {filename}"
    year_match = re.search(r"(20\d{2})", text)
    year = int(year_match.group(1)) if year_match else 0
    session = "기타"
    if "제1차" in text or "1차" in text:
        session = "제1차"
    elif "제2차" in text or "2차" in text:
        session = "제2차"
    return year, session


def infer_subject(filename: str) -> str:
    if "성경" in filename:
        return "성경"
    if "헌법" in filename or "교단" in filename:
        return "교단헌법"
    return "기타"


def clean_lines(text: str) -> list[str]:
    text = text.replace("\x0c", "\n")
    lines = []
    for raw in text.splitlines():
        line = re.sub(r"\s+", " ", raw).strip()
        if not line:
            continue
        if re.fullmatch(r"\[\s*[0-9]+\s*[~\-~]\s*[0-9]+\s*번", line):
            continue
        if re.fullmatch(r"\[?\s*[0-9]+\s*[~\-]?\s*[0-9]+\s*번\s*[×xX][^\]]*\]?", line):
            continue
        if re.fullmatch(r"[0-9]+\s*점.*\]?", line):
            continue
        if re.fullmatch(r"\d+\s*[=:]\s*\d+\s*점\s*\]?", line):
            continue
        if re.fullmatch(r"\(\s*[0-9]+\s*~\s*[0-9]+\s*번\s*[^)]*\)", line):
            continue
        if re.fullmatch(r"\d+\s*-\s*\d+\s*문항", line):
            continue
        if re.fullmatch(r"^\[\s*[^\]]+\s*\]$", line) and "문항" not in line and "시험문제" not in line:
            continue
        if re.fullmatch(r"- \d+ -", line):
            continue
        if line in {"<그림>", "수험번호:", "한국기독교장로회", "한국기독교장로회 총회"}:
            continue
        if re.fullmatch(r"답\s*:?.*", line):
            continue
        if re.fullmatch(r"\d+\)\s+.*:\s*", line):
            continue
        if line.startswith("한국기독교장로회") and ("목사고시" in line or "총회" in line):
            continue
        lines.append(line)
    return lines


def is_instruction(line: str) -> bool:
    return bool(
        re.match(r"^\d+\.\s+다음 물음에 답하시오", line)
        or re.match(r"^\d+\.\s+다음 문항(에|을|는|를|에[서]?|에 대하여|에 관하여)", line)
        or re.match(r"^\d+\.\s+다음[은는가에서를에게]?\s*보기(에서|를|에서)", line)
        or re.match(r"^\d+\.\s+다음 (성경)?구절", line)
        or re.match(r"^\d+\.\s+다음 물음에 대한", line)
        or re.match(r"^\d+\.\s+다음 중", line)
    )


def is_section_heading(line: str, next_line: str) -> bool:
    match = re.match(r"^(?:문)?(\d+)\.\s*(.+)", line)
    if not match:
        return False
    title = match.group(2).strip()
    if not re.match(r"^다음", title):
        return False
    if re.search(r"[Xx×]\s*[,/]\s*[Oo]|O,?\s*혹은\s*X|○\s*또는\s*×", title):
        return False
    section_like_title = re.search(
        r"각\s*문항\s*\d+\s*점|각\s*\d+\s*점|\d+\s*문항|보기를|보시|보기|물음에 대한|물음\s*\w*\s*답|답하시오|빈칸|빈\s*괄호|채우|성구|서술|성경구절|책\s*이름|어느\s*책|선택|기술|적으시오|써\s*넣|쓰기|작성|묘사|고르|적으",
        title,
    )
    next_is_subitem = re.match(r"^(?:\d+\)|\d+\.)\s*", next_line)
    next_is_score_hint = re.search(r"\(?\s*각\s*문항\s*\d+점", next_line)
    if section_like_title and (next_is_subitem or next_is_score_hint):
        return True
    if next_line == "▶ 다음 구절이 나오는 성경의 책이름을 쓰시오":
        return True
    return False


def is_unnumbered_heading(line: str) -> bool:
    if line.startswith("※"):
        return True
    if not line.startswith("다음 "):
        return False
    if "?" in line:
        return False
    return bool(re.search(r"답|고르|쓰시오|채우|물음|문제|성구|보기|문항|각\s*\d+점", line))


def looks_like_group_intro(line: str) -> bool:
    return bool(
        re.search(r"다음\s+(물음에|문항|문답|질문|보기|사항|설명|내용|기술|서술|적으|쓰기|답하시오|써|채우)", line)
        or re.search(r"문항\s*[Xx×]?\s*\d+점|\d+문항", line)
    )

def is_loose_number_heading(line: str) -> bool:
    match = re.match(r"^(\d+)\s+(.+)", line)
    if not match:
        return False
    if int(match.group(1)) > 120:
        return False
    body = match.group(2).strip()
    if len(body) < 3:
        return False
    if re.match(r"^[·○①②③④⑤]+\s", body):
        return False
    return bool(
        re.search(
            r"[가-힣]|\?|고르|적으|쓰|설명|구분|정의|무엇|어느|기록|기술|나타|선택|말",
            body,
        )
    )


def has_numeric_options(text: str) -> bool:
    return len(re.findall(r"(?<!\d)(?:[1-9]|10)\)\s+", text)) >= 2


def has_blank_placeholders(text: str) -> bool:
    return bool(
        re.search(r"\(\s*\)", text)
        or re.search(r"\(\s{2,}\)", text)
        or re.search(r"\(\s*[①②③④⑤⑥⑦⑧⑨⑩]\s*\)", text)
        or re.search(r"괄호|빈칸|채우", text)
    )


def has_circled_options(text: str) -> bool:
    for match in re.finditer(r"[①②③④⑤]", text):
        before = text[max(0, match.start() - 3) : match.start()]
        after = text[match.end() : match.end() + 3]
        if "(" in before and ")" in after:
            continue
        if re.search(r"정답\s*:?\s*$", text[: match.start()]):
            continue
        return True
    return False


def question_type(text: str, context: str = "") -> str:
    combined = f"{context} {text}"
    if re.search(r"[○Ⅹ]", combined) or re.search(r"O\s*/\s*X", combined, re.I):
        return "ox"
    if has_blank_placeholders(combined):
        return "blank"
    if has_circled_options(text) or (
        has_numeric_options(text)
        and re.search(r"틀린|아닌|고르|해당|설명|무엇인가|어느 것", text)
    ):
        return "choice"
    return "essay"


def is_group_heading(line: str) -> bool:
    match = re.match(r"^(?:문)?(\d+)\.\s*(.+)", line)
    if not match:
        return False
    text = match.group(2)
    if re.search(r"\(\s*\)", text):
        return False
    if text.startswith("다음") and "?" not in text and re.search(r"\d+\s*점", text):
        return True
    return bool(
        re.search(
            r"\d+\s*점\s*[:;]\s*\d+\s*문항|"
            r"\d+\s*문항\s*[Xx×]\s*\d+\s*점|"
            r"\d+\s*[Xx×]\s*\d+\s*=\s*\d+\s*점|"
            r"각\s*\d+\s*점|"
            r"선택\s*\d+|"
            r"책\s*1권당\s*1점|"
            r"다음 중\s*\d+개|"
            r"다음 .*선택|"
            r"최소\s*\d+개",
            text,
        )
    )


def is_group_parent_title(line: str) -> bool:
    if not re.search(r"고르|골라|선택", line):
        return False
    return bool(
        re.search(
            r"문항|각\s*\d+\s*문항|최소\s*\d+\s*개|최대\s*\d+\s*개|중\s*\d+\s*문항|보기",
            line,
        )
    )


def split_options(text: str) -> list[str]:
    if has_blank_placeholders(text):
        return []
    matches = list(re.finditer(r"[①②③④⑤]", text))
    if len(matches) < 2:
        matches = list(re.finditer(r"(?<!\d)(?:[1-9]|10)\)\s*", text))
        if len(matches) < 2:
            return []
    options = []
    for i, match in enumerate(matches):
        start = match.start()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        options.append(text[start:end].strip())
    return options


def parse_score(questions: list[dict]) -> int:
    suspicious = 0
    for q in questions:
        body = q.get("text", "")
        if re.search(r"다음 문제 중|번택 개|문항\s*[Xx×]\s*\d+점", body):
            suspicious += 1
        if abs(body.count("(") - body.count(")")) > 2:
            suspicious += 1
    return len(questions) * 20 - suspicious * 25


def detect_heading(line: str) -> tuple[str, str, str] | None:
    match = re.match(r"^(?:문)?(\d+)\.\s*(.+)", line)
    if match:
        return "dot", match.group(1), match.group(2).strip()

    match = re.match(r"^\[(?:문|Q)\s*(\d+)\]\s*(.+)", line)
    if match and match.group(2).strip():
        return "bracket", match.group(1), match.group(2).strip()

    match = re.match(r"^(\d+)\)\s*(.+)", line)
    if match:
        return "paren", match.group(1), match.group(2).strip()

    if is_loose_number_heading(line):
        match = re.match(r"^(\d+)\s+(.+)", line)
        if match:
            return "loose", match.group(1), match.group(2).strip()

    return None


def expected_child_count(title: str) -> int | None:
    match = re.search(r"(\d+)\s*문항", title)
    return int(match.group(1)) if match else None


def _child_heading_style(line: str) -> str | None:
    if re.match(r"^\(\s*\d+\s*\)", line):
        return "paren"
    if re.match(r"^\d+\)\s+", line):
        return "paren"
    if re.match(r"^(?:문)?\d+\.\s+", line):
        return "dot"
    if is_loose_number_heading(line):
        return "dot"
    return None


def is_connector_or_hint_line(line: str) -> bool:
    if not line:
        return False
    if line.startswith("▶"):
        return True
    if line.startswith("※"):
        return True
    if line.startswith("<표>") or line == "<표>" or line == "[표]":
        return True
    if re.search(r"<\s*표\s*>", line):
        return True
    if re.fullmatch(r"-+\s*[0-9]+\s*-+", line):
        return True
    if re.match(r"^\(.*\)$", line):
        return any(
            token in line
            for token in [
                "문항",
                "점",
                "성구",
                "성경",
                "각",
                "답",
                "괄호",
                "성격",
                "배점",
                "정답",
            ]
        )
    return False


def lookahead_question_line(lines: list[str], start: int) -> str:
    for idx in range(start, min(len(lines), start + MAX_GRP_LOOKAHEAD)):
        line = lines[idx].strip()
        if not line or is_connector_or_hint_line(line):
            continue
        return line
    return lines[start] if start < len(lines) else ""


def should_start_parent_group(line: str, next_line: str) -> bool:
    if not next_line:
        return False
    if _child_heading_style(next_line) is None:
        return False
    if is_group_heading(line):
        return True
    if re.search(r"\d+\s*문항", line):
        return True
    if re.search(r"\d+\s*개", line) and re.search(r"다음.*(선택|고르|골라)", line):
        return True
    if re.search(r"\(\s*각\s*\d+\s*점", line):
        return True
    if re.search(r"다음\s*보기에서.*(고르|골라|틀린|옳은|선택)", line):
        return True
    if re.search(r"^\d+[.)]?\s*(?:다음|아래)\s.*(빈\s*괄호|성구|책의|어느\s*책|성경)", line):
        return True
    return False


def parse_questions(text: str) -> list[dict]:
    lines = clean_lines(text)
    questions: list[dict] = []
    current: dict | None = None
    section = "일반"
    is_parent_group = False
    parent_label: str | None = None
    parent_title: str | None = None
    parent_child_style: str | None = None
    parent_child_limit: int | None = None
    parent_child_count = 0
    question_index = 1

    def make_question(
        number_label: str,
        title_text: str,
        starter: str,
        group_title: str | None = None,
        is_container: bool = False,
    ) -> dict:
        return {
            "number": None,
            "numberLabel": number_label,
            "groupNumber": None,
            "groupTitle": group_title,
            "section": section,
            "title": title_text,
            "starter": starter,
            "parts": [],
            "hasChildren": False,
            "isContainer": is_container,
        }

    def finish() -> None:
        nonlocal current, question_index
        if not current:
            return

        title = current["title"].strip()
        body_parts = [part.strip() for part in current["parts"] if part and part.strip()]
        body = " ".join(body_parts).strip()
        full_text = " ".join([title] + body_parts).strip()
        body = re.sub(r"\s*\(\s*\d+\s*~\s*\d+번[^)]*문항[×xX]\s*\d+점\s*\)\s*", " ", body)
        full_text = re.sub(r"\s*\(\s*\d+\s*~\s*\d+번[^)]*문항[×xX]\s*\d+점\s*\)\s*", " ", full_text)
        body = re.sub(r"\s*※\s*\d+\s*~\s*\d+번[^.。]*문제입니다\.?\s*", " ", body)
        full_text = re.sub(r"\s*※\s*\d+\s*~\s*\d+번[^.。]*문제입니다\.?\s*", " ", full_text)
        body = re.sub(r"\s+", " ", body).strip()
        full_text = re.sub(r"\s+", " ", full_text).strip()

        if current.get("isContainer") and not body_parts:
            current = None
            return

        current["number"] = question_index
        question_index += 1
        current["body"] = body if body else title
        current["text"] = full_text
        current["type"] = question_type(full_text, current.get("section", ""))
        current["options"] = split_options(full_text)
        current.pop("starter", None)
        del current["parts"]
        questions.append(current)
        current = None

    def close_parent_group() -> None:
        nonlocal is_parent_group, parent_label, parent_title
        nonlocal parent_child_style, parent_child_limit, parent_child_count
        is_parent_group = False
        parent_label = None
        parent_title = None
        parent_child_style = None
        parent_child_limit = None
        parent_child_count = 0

    for idx, line in enumerate(lines):
        next_line = lookahead_question_line(lines, idx + 1) if idx + 1 < len(lines) else ""
        if line.startswith("◈"):
            finish()
            section = line
            close_parent_group()
            continue
        if line in {"객관식", "단답식", "주관식", "논술식", "서술형", "논술형"}:
            finish()
            section = line
            close_parent_group()
            continue
        if re.fullmatch(r"^\[[^\]]+\]$", line):
            finish()
            section = f"{section} {line}".strip()
            close_parent_group()
            continue
        if line in {"시험문제", "서술식문제", "단답형문제"}:
            finish()
            section = "시험문제"
            close_parent_group()
            continue

        heading = detect_heading(line)
        if heading is None:
            if current is not None:
                if current.get("isContainer") and is_connector_or_hint_line(line):
                    continue
                current["parts"].append(line)
            elif len(line) > 12:
                section = line
            continue

        kind, raw_number, raw_title = heading
        is_parent_candidate = should_start_parent_group(line, next_line)

        if kind == "paren":
            full = f"{raw_number}) {raw_title}"
            if (
                is_parent_group
                and parent_child_limit is not None
                and parent_child_count >= parent_child_limit
            ):
                if parent_child_style in {None, "paren"} and not is_parent_candidate:
                    if current is not None:
                        finish()
                    continue
                if current is not None:
                    finish()
                close_parent_group()

            if (
                is_parent_group
                and parent_label is not None
                and parent_child_style in {None, "paren"}
                and (parent_child_limit is None or parent_child_count < parent_child_limit)
            ):
                parent_child_style = "paren"
                parent_child_count += 1
                if current is not None:
                    if current.get("starter") == "dot":
                        current["hasChildren"] = True
                        current["isContainer"] = True
                        if not current.get("groupTitle") and parent_title:
                            current["groupTitle"] = parent_title
                    else:
                        current["hasChildren"] = True
                    finish()
                current = make_question(
                    f"{parent_label}-{raw_number}",
                    full,
                    starter="paren",
                    group_title=parent_title,
                )
                continue
            if current is not None and current.get("starter") == "dot" and not current.get("isContainer"):
                current["parts"].append(full)
                continue
            if current is not None and current.get("starter") == "paren":
                finish()
                current = make_question(raw_number, full, starter="paren", group_title=raw_title)
                continue

            finish()
            close_parent_group()
            current = make_question(raw_number, full, starter="paren", group_title=raw_title)
            continue

        if kind == "dot":
            full = f"{raw_number}. {raw_title}"
            if is_parent_group and parent_child_limit is not None and parent_child_count >= parent_child_limit:
                if parent_child_style in {None, "dot"} and not is_parent_candidate:
                    if current is not None:
                        finish()
                    continue
                if current is not None:
                    finish()
                close_parent_group()

            is_child_of_parent = (
                is_parent_group
                and parent_label is not None
                and parent_child_style in {None, "dot"}
                and not is_parent_candidate
                and (parent_child_limit is None or parent_child_count < parent_child_limit)
            )
            if is_child_of_parent:
                parent_child_style = "dot"
                parent_child_count += 1
                if current is not None and current.get("starter") == "dot":
                    current["hasChildren"] = True
                finish()
                current = make_question(
                    f"{parent_label}-{raw_number}",
                    full,
                    starter="dot",
                    group_title=parent_title,
                )
                continue

        finish()
        if is_parent_group:
            close_parent_group()
        is_parent_group = (kind in {"dot", "bracket", "loose"}) and is_parent_candidate
        parent_label = raw_number if is_parent_group else None
        parent_title = raw_title if is_parent_group else None
        if is_parent_group:
            parent_child_limit = expected_child_count(raw_title)
            parent_child_style = None
            parent_child_count = 0
        current = make_question(
            raw_number,
            raw_title,
            starter="dot",
            group_title=raw_title,
            is_container=is_parent_group,
        )

    finish()
    return questions


def apply_display_labels(questions: list[dict]) -> None:
    """Add a document-local unique displayLabel while keeping original numberLabel.

    numberLabel values can repeat in a single document when the source contains
    multiple labeled sections (e.g., several "1번 ...", "2번 ..."). displayLabel
    preserves the original first occurrence and disambiguates later ones.
    """
    seen: dict[str, int] = {}
    used: set[str] = set()

    for question in questions:
        raw_label = str(question.get("numberLabel", "")).strip()
        if not raw_label:
            question["displayLabel"] = ""
            continue

        seen[raw_label] = seen.get(raw_label, 0) + 1
        occurrence = seen[raw_label]
        candidate = raw_label if occurrence == 1 else f"{raw_label}-{occurrence}"

        while candidate in used:
            occurrence += 1
            seen[raw_label] = occurrence
            candidate = f"{raw_label}-{occurrence}"

        question["displayLabel"] = candidate
        used.add(candidate)


def collect_sources() -> list[SourceFile]:
    manifest = json.loads((DOWNLOADS / "manifest.json").read_text(encoding="utf-8"))
    sources: list[SourceFile] = []
    for idx, post in enumerate(manifest, 1):
        post_title = post["title"]
        folder = next(DOWNLOADS.glob(f"{idx:02d}_*"))
        for file_info in post["files"]:
            path = folder / file_info["filename"]
            year, session = infer_year_session(post_title, path.name)
            sources.append(
                SourceFile(
                    post_title=post_title,
                    post_url=post["url"],
                    path=path,
                    year=year,
                    session=session,
                    subject=infer_subject(path.name),
                )
            )
    return sources


def main() -> None:
    documents = []
    questions = []
    for source in collect_sources():
        candidates = []
        for text in extract_candidates(source.path):
            parsed = parse_questions(text)
            candidates.append((parse_score(parsed), text, parsed))
        _, text, parsed = max(candidates, key=lambda item: item[0])
        doc_id = re.sub(r"[^a-zA-Z0-9가-힣]+", "-", source.path.stem).strip("-")
        doc_questions = []
        documents.append(
            {
                "id": doc_id,
                "title": source.post_title,
                "fileName": source.path.name,
                "filePath": str(source.path.relative_to(ROOT)),
                "postUrl": source.post_url,
                "year": source.year,
                "session": source.session,
                "subject": source.subject,
                "questionCount": len(parsed),
                "rawText": "\n".join(clean_lines(text)),
            }
        )
        apply_display_labels(parsed)
        for index, q in enumerate(parsed, 1):
            doc_questions.append(
                {
                    "id": f"{doc_id}-{index}",
                    "documentId": doc_id,
                    "year": source.year,
                    "session": source.session,
                    "subject": source.subject,
                    "sourceTitle": source.post_title,
                    "fileName": source.path.name,
                    **q,
                }
            )
        questions.extend(doc_questions)

    payload = {
        "generatedFrom": "https://www.prok.org/Board/Index/269351",
        "documents": documents,
        "questions": questions,
    }
    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"documents={len(documents)} questions={len(questions)} out={OUT}")
    print(
        json.dumps(
            {
                "bySubject": {
                    subject: sum(1 for q in questions if q["subject"] == subject)
                    for subject in sorted({q["subject"] for q in questions})
                },
                "byType": {
                    qtype: sum(1 for q in questions if q["type"] == qtype)
                    for qtype in sorted({q["type"] for q in questions})
                },
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
