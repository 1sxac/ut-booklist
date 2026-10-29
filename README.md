# UT Austin Course Booklist

Search any Fall 2026 UT Austin course to see its sections, instructors, required books and materials, and an estimated cost. A Majors tab has a dashboard for every department.

Unofficial student project, not affiliated with UT Austin or the University Co-op.

## Files

| File | What it is |
|---|---|
| `index.html` | The website |
| `data.json` | Courses, sections, books and prices (University Co-op Fall 2026 book list, pulled Oct 13, 2026) |
| `syllabi.json` | Materials excerpts from public UT syllabi |
| `verified.json` | Results of the student textbook survey, for the "Student verified" badges |

## Survey results update automatically

The **Update survey results** workflow (`.github/workflows/update-survey.yml`) runs once a day, around 6 AM Austin time. It downloads the Google Form responses, matches each one to a course and section with `.github/scripts/survey_import.py`, and commits a new `verified.json` when something changed. GitHub Pages then rebuilds the site. To run it right away: **Actions → Update survey results → Run workflow**.

It reads the responses from the `SURVEY_CSV_URL` repository variable (Settings → Secrets and variables → Actions → Variables). Responses that can't be matched to a course are skipped. Asking for the course code on the form (e.g. GOV 364V) makes matching reliable.

## Visit counts

The site counts page views with [GoatCounter](https://www.goatcounter.com) (no cookies, no personal data). Each course page is counted as `/course/<code>` and each department as `/major/<dept>`, so the dashboard at **utbooklist.goatcounter.com** ranks the most-viewed courses. Events also record searches that found nothing (`search-no-results/...`) and clicks out to the Co-op, VitalSource and syllabi (`co-op-link/<course>` and so on).

## Updating course data

Upload a new copy of `data.json` with the same file name: **Add file → Upload files → Commit changes**. The live site updates within a couple of minutes.
