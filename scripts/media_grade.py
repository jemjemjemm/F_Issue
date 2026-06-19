"""Media-name normalization and A/B/C classification."""
from __future__ import annotations

import re

GRADE_A = [
    "연합뉴스", "한국경제", "매일경제", "서울경제", "이데일리", "머니투데이",
    "아시아경제", "파이낸셜뉴스", "중앙일보", "조선일보", "동아일보", "한겨레",
    "경향신문", "한국일보", "뉴스1", "뉴시스",
]
GRADE_B = [
    "국민일보", "문화일보", "세계일보", "헤럴드경제", "이투데이", "아시아투데이",
    "전자신문", "비즈워치", "조세일보", "데일리안", "한스경제", "더구루", "신아일보",
    "국제신문", "에너지경제", "매일일보", "SBS", "KBS", "MBC", "YTN", "JTBC",
    "MBN", "채널A", "TV조선",
]
ALIASES = {
    "매경": "매일경제", "매경닷컴": "매일경제", "한경": "한국경제",
    "한국경제신문": "한국경제", "연합": "연합뉴스", "연합 뉴스": "연합뉴스",
    "연합뉴스tv": "연합뉴스TV", "news1": "뉴스1", "뉴스 1": "뉴스1",
    "파이낸셜 뉴스": "파이낸셜뉴스", "헤럴드 경제": "헤럴드경제",
    "tv조선": "TV조선", "채널 a": "채널A",
}


def normalize_source(source: str) -> str:
    value = re.sub(r"\s+", " ", (source or "").strip())
    value = re.sub(r"\s*[|·\-]\s*(네이버뉴스|다음뉴스|Google News)$", "", value, flags=re.I)
    if not value:
        return "매체 미상"
    for alias, canonical in ALIASES.items():
        if value.casefold() == alias.casefold():
            return canonical
    return value


def get_media_grade(source: str) -> str:
    normalized = normalize_source(source)
    if normalized in GRADE_A:
        return "A"
    if normalized in GRADE_B:
        return "B"
    return "C"


def media_sort_index(source: str, grade: str | None = None) -> int:
    normalized = normalize_source(source)
    values = GRADE_A if (grade or get_media_grade(normalized)) == "A" else GRADE_B
    try:
        return values.index(normalized)
    except ValueError:
        return len(values)

