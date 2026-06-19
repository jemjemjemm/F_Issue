"""Conservative relevance classification: omission avoidance comes first."""
from __future__ import annotations

import re

CONTEXT_KEYWORDS = [
    "유가", "석유", "정유사", "정유업계", "기름값", "휘발유", "경유", "주유소",
    "석유제품", "유류가격", "공정위", "공정거래위원회", "담합", "가격담합",
]
EXCLUDED_PATTERNS = {
    "인사/부고/일정성 문서": ["인사", "부고", "동정", "주요일정", "오늘의 일정"],
    "스포츠/연예성 기사": ["오늘의 경기", "스포츠", "연예", "예능", "드라마", "시청률", "출연"],
    "생활정보성 기사": ["오늘의 운세", "맛집", "여행"],
    "광고/홍보성 문서": ["광고", "이벤트", "협찬", "prnewswire", "비즈니스와이어"],
    "단순 사진 기사": ["[포토]", "[사진]", "화보"],
    "비관련 담합 기사": ["부동산 담합", "입찰 담합", "병원 담합", "학원 담합"],
}


def matched_keywords(title: str, snippet: str = "") -> list[str]:
    text = f"{title} {snippet}".casefold()
    return [keyword for keyword in CONTEXT_KEYWORDS if keyword.casefold() in text]


def assess_quality(item: dict) -> tuple[str, str, str, list[str]]:
    title = (item.get("title") or "").strip()
    snippet = item.get("snippet") or ""
    text = f"{title} {snippet}".casefold()
    matches = matched_keywords(title, snippet)
    for reason, words in EXCLUDED_PATTERNS.items():
        if any(word.casefold() in text for word in words):
            return "excluded", "제외", reason, matches
    missing = []
    if not item.get("published_at"):
        missing.append("발행시각 확인 불가")
    if not item.get("source"):
        missing.append("언론사 확인 불가")
    if not item.get("url"):
        missing.append("기사 링크 확인 불가")
    # A single broad word is not enough to exclude: retain it for review.
    has_oil = any(k in text for k in ["유가", "석유", "정유", "기름값", "휘발유", "경유", "주유소", "유류"])
    has_collusion = "담합" in text or "공정위" in text or "공정거래위원회" in text
    if not (has_oil and has_collusion):
        missing.append("유가담합 관련성 확인 필요")
    if missing:
        return "review", "검토필요", " · ".join(dict.fromkeys(missing)), matches
    return "ok", "정상", "유가담합 관련 맥락 확인", matches

