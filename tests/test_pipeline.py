import sys
import unittest
from datetime import date, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from dedupe import canonicalize_url, deduplicate, normalize_title
from build_report import build_report, format_report_title, process_articles
from media_grade import get_media_grade, normalize_source
from quality_filter import assess_quality
from utils_time import KST, get_period, is_in_period
from collect_news import KEYWORDS


class TimeTests(unittest.TestCase):
    def test_morning_period_is_half_open(self):
        start, end = get_period(date(2026, 6, 19), "morning")
        self.assertEqual(start.isoformat(), "2026-06-18T17:00:00+09:00")
        self.assertEqual(end.isoformat(), "2026-06-19T08:00:00+09:00")
        self.assertTrue(is_in_period(start, start, end))
        self.assertFalse(is_in_period(end, start, end))

    def test_evening_period_is_half_open(self):
        start, end = get_period("2026-06-19", "evening")
        self.assertEqual(start.hour, 8)
        self.assertEqual(end.hour, 17)
        self.assertTrue(is_in_period(datetime(2026, 6, 19, 16, 59, tzinfo=KST), start, end))


class DedupeTests(unittest.TestCase):
    def item(self, portal, source="연합뉴스", title="[속보] 정유사 담합 조사", url="https://example.com/a"):
        return {"portal": portal, "query": "유가담합", "source": source, "title": title, "url": url, "published_at": "", "collected_at": "2026-06-19T08:00:00+09:00", "snippet": ""}

    def test_same_title_and_source_merge_portals(self):
        result = deduplicate([self.item("naver"), self.item("daum", title="정유사 담합 조사")])
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["portals"], ["naver", "daum"])
        self.assertEqual(result[0]["duplicate_count"], 1)

    def test_same_title_different_source_is_retained(self):
        result = deduplicate([self.item("naver"), self.item("google", source="뉴스1")])
        self.assertEqual(len(result), 2)

    def test_title_decoration_removed_for_comparison(self):
        self.assertEqual(normalize_title(" [단독]  유가  담합 (종합) "), "유가 담합")

    def test_portal_redirect_url_is_unwrapped(self):
        url = "https://search.example/redirect?url=https%3A%2F%2Fpress.example%2Farticle"
        self.assertEqual(canonicalize_url(url), "https://press.example/article")


class ClassificationTests(unittest.TestCase):
    def test_media_grades_and_aliases(self):
        self.assertEqual(normalize_source("매경"), "매일경제")
        self.assertEqual(get_media_grade("연합뉴스"), "A")
        self.assertEqual(get_media_grade("YTN"), "B")
        self.assertEqual(get_media_grade("지역매체"), "C")

    def test_excluded_and_review_status(self):
        excluded = assess_quality({"title": "오늘의 스포츠 유가 소식 담합", "snippet": "", "published_at": "x", "source": "YTN", "url": "https://x"})
        self.assertEqual(excluded[0], "excluded")
        review = assess_quality({"title": "정유사 담합 조사", "snippet": "", "published_at": "", "source": "연합뉴스", "url": "https://x"})
        self.assertEqual(review[0], "review")

    def test_all_required_queries_are_configured(self):
        self.assertEqual(len(KEYWORDS), 13)
        self.assertIn("공정거래위원회 정유사 담합", KEYWORDS)


class ReportTests(unittest.TestCase):
    def test_report_title_uses_short_date_and_slot(self):
        self.assertEqual(format_report_title("2026-06-19", "morning"), "'26.6.19. Morning Report")
        self.assertEqual(format_report_title("2026-07-03", "evening"), "'26.7.3. Evening Report")

    def test_unknown_publication_time_is_retained_for_review(self):
        start, end = get_period("2026-06-19", "morning")
        item = {
            "portal": "google", "query": "유가 담합", "title": "정유사 담합 조사",
            "url": "https://example.com/a", "source": "연합뉴스", "published_at": "",
            "collected_at": "2026-06-19T08:10:00+09:00", "snippet": "공정위가 유가 담합을 조사한다.",
        }
        articles = process_articles([item], start, end)
        self.assertEqual(len(articles), 1)
        self.assertEqual(articles[0]["published_at_status"], "unknown")
        self.assertEqual(articles[0]["quality_status"], "review")

    def test_known_out_of_period_article_is_removed(self):
        start, end = get_period("2026-06-19", "morning")
        item = {
            "portal": "naver", "query": "유가 담합", "title": "정유사 담합 조사",
            "url": "https://example.com/a", "source": "연합뉴스",
            "published_at": "2026-06-19T08:00:00+09:00",
            "collected_at": "2026-06-19T08:10:00+09:00", "snippet": "",
        }
        self.assertEqual(process_articles([item], start, end), [])

    def test_zero_result_report_is_still_complete(self):
        raw = {"items": [], "keywords": KEYWORDS, "portal_counts": {}, "collection_warnings": []}
        report = build_report(raw, "2026-06-19", "evening")
        self.assertEqual(report["total_deduped_count"], 0)
        self.assertEqual(report["articles"], [])
        self.assertEqual(report["grade_counts"], {"A": 0, "B": 0, "C": 0})


if __name__ == "__main__":
    unittest.main()
