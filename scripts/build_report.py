"""Transform raw search results into report JSON/HTML and update the index."""
from __future__ import annotations

import argparse
import hashlib
import json
from collections import Counter
from datetime import datetime
from pathlib import Path

from dedupe import deduplicate
from media_grade import get_media_grade, media_sort_index, normalize_source
from quality_filter import assess_quality
from telegram_notify import notify_for_report
from utils_time import get_period, is_in_period, now_kst, parse_datetime, period_label, resolve_base_date, resolve_slot

ROOT = Path(__file__).resolve().parents[1]


def process_articles(raw_items: list[dict], start: datetime, end: datetime) -> list[dict]:
    eligible = [item for item in raw_items if not item.get("published_at") or is_in_period(item.get("published_at"), start, end)]
    articles = []
    for item in deduplicate(eligible):
        source = normalize_source(item.get("source", ""))
        status, label, reason, matches = assess_quality(item)
        canonical = item.get("canonical_url") or item.get("url", "")
        stable = f"{item.get('duplicate_key')}::{canonical}"
        item.update({
            "id": hashlib.sha1(stable.encode("utf-8")).hexdigest()[:16],
            "url": canonical, "canonical_url": canonical,
            "source": item.get("source") or source, "source_normalized": source,
            "grade": get_media_grade(source),
            "published_at_status": "known" if item.get("published_at") else "unknown",
            "matched_keywords": matches, "quality_status": status,
            "status_label": label, "status_reason": reason,
        })
        for transient in ("portal", "query", "raw"):
            item.pop(transient, None)
        articles.append(item)

    def timestamp(article: dict) -> float:
        value = parse_datetime(article.get("published_at")) or parse_datetime(article.get("collected_at"))
        return value.timestamp() if value else 0

    grade_order = {"A": 0, "B": 1, "C": 2}
    articles.sort(key=lambda a: (grade_order[a["grade"]], media_sort_index(a["source_normalized"], a["grade"]), a["source_normalized"].casefold(), -timestamp(a)))
    return articles


def build_report(raw: dict, base_date: str, slot: str) -> dict:
    start, end = get_period(base_date, slot)
    articles = process_articles(raw.get("items", []), start, end)
    status_counts = Counter(item["quality_status"] for item in articles)
    grade_counts = Counter(item["grade"] for item in articles)
    query_counts = Counter(query for item in articles for query in item.get("queries", []))
    return {
        "title": "F-Issue Report", "subtitle": "유가담합 키워드 뉴스 전수 모니터링",
        "base_date": base_date, "slot": slot,
        "period_start": start.isoformat(), "period_end": end.isoformat(),
        "period_label": period_label(start, end), "generated_at": now_kst().isoformat(),
        "keywords": raw.get("keywords", []), "total_raw_count": len(raw.get("items", [])),
        "total_deduped_count": len(articles), "total_ok_count": status_counts["ok"],
        "total_review_count": status_counts["review"], "total_excluded_count": status_counts["excluded"],
        "grade_counts": {grade: grade_counts[grade] for grade in "ABC"},
        "portal_counts": {portal: raw.get("portal_counts", {}).get(portal, 0) for portal in ("naver", "daum", "google")},
        "query_counts": dict(sorted(query_counts.items())),
        "collection_warnings": raw.get("collection_warnings", []), "telegram_alert_log": [],
        "articles": articles,
    }


def report_index_entry(report: dict) -> dict:
    stem = f"{report['base_date']}-{report['slot']}"
    return {
        "base_date": report["base_date"], "slot": report["slot"],
        "label": f"{report['base_date']} {report['slot'].title()}", "period": report["period_label"],
        "html_path": f"reports/{stem}.html", "json_path": f"data/reports/{stem}.json",
        "period_start": report["period_start"], "period_end": report["period_end"],
        "total_deduped_count": report["total_deduped_count"], "total_ok_count": report["total_ok_count"],
        "total_review_count": report["total_review_count"], "total_excluded_count": report["total_excluded_count"],
        "grade_counts": report["grade_counts"], "generated_at": report["generated_at"],
    }


def update_index(report: dict) -> None:
    path = ROOT / "data" / "report-index.json"
    try:
        entries = json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        entries = []
    entry = report_index_entry(report)
    entries = [old for old in entries if not (old.get("base_date") == entry["base_date"] and old.get("slot") == entry["slot"])]
    entries.append(entry)
    entries.sort(key=lambda x: (x.get("base_date", ""), 1 if x.get("slot") == "evening" else 0), reverse=True)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(entries, ensure_ascii=False, indent=2), encoding="utf-8")


def write_report_html(report: dict) -> None:
    stem = f"{report['base_date']}-{report['slot']}"
    target = ROOT / "reports" / f"{stem}.html"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(f"""<!doctype html>
<html lang=\"ko\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">
<title>{report['label'] if 'label' in report else stem} | F-Issue Report</title>
<link rel=\"canonical\" href=\"../index.html?report=data/reports/{stem}.json\">
<script>location.replace('../index.html?report='+encodeURIComponent('data/reports/{stem}.json'));</script></head>
<body><p><a href=\"../index.html?report=data/reports/{stem}.json\">F-Issue Report에서 이 리포트 열기</a></p></body></html>""", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--slot", default="")
    parser.add_argument("--base-date", default="")
    args = parser.parse_args()
    slot = resolve_slot(args.slot)
    base_date = resolve_base_date(args.base_date).isoformat()
    raw_path = ROOT / "data" / "raw" / f"{base_date}-{slot}-raw.json"
    if not raw_path.exists():
        raise FileNotFoundError(f"Raw data not found: {raw_path}")
    raw = json.loads(raw_path.read_text(encoding="utf-8"))
    report = build_report(raw, base_date, slot)
    out = ROOT / "data" / "reports" / f"{base_date}-{slot}.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    update_index(report)
    write_report_html(report)
    try:
        if notify_for_report(report):
            report["telegram_alert_log"].append({"status": "sent", "message": "수집 상태 알림을 Telegram으로 발송했습니다.", "created_at": now_kst().isoformat()})
            out.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    except Exception as exc:
        report["telegram_alert_log"].append({"status": "failed", "message": f"Telegram 알림을 보내지 못했습니다: {type(exc).__name__}", "created_at": now_kst().isoformat()})
        out.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Built {report['total_deduped_count']} articles -> {out.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
