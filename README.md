# UT Austin Course Booklist

Search any Fall 2026 UT Austin course to see its sections, instructors, required books and materials, and an estimated cost. A Majors tab has a dashboard for every department.

Unofficial student project, not affiliated with UT Austin or the University Co-op.

## Files

| File | What it is |
|---|---|
| `index.html` | The website |
| `budget.js` | The **Your budget** and **Cheaper materials** tabs, including the UT dates and dollar figures they use |
| `data.json` | Courses, sections, books and prices (University Co-op Fall 2026 book list, pulled Oct 13, 2026) |
| `syllabi.json` | Materials excerpts from public UT syllabi |
| `verified.json` | Results of the student textbook survey, for the "Student verified" badges |

## Your budget and Cheaper materials tabs

`budget.js` adds two tabs. **Your budget** lets students add courses (or click *Add to my budget* on a course page), then shows what their materials cost, when each bill is due (books before class, LTA charges on the What I Owe due date) and how much to set aside each week, every 2 weeks or monthly so every bill is covered on time. Plans are saved in the visitor's browser only. **Cheaper materials** lists free and lower-cost options, scholarships, offices that can help, key dates and sources.

When UT posts new calendars, update `BCFG` at the top of `budget.js`: class start dates, the Co-op refund window, LTA bill, opt-out and due dates (dates listed in `est` are shown as estimates), the $724 cost-of-attendance figure and the Co-op scholarship amount. Update `checked` when you re-verify the facts on the Cheaper materials tab.

## Survey results update automatically

The **Update survey results** workflow (`.github/workflows/update-survey.yml`) runs once a day, around 6 AM Austin time. It downloads the Google Form responses, matches each one to a course and section with `.github/scripts/survey_import.py`, and commits a new `verified.json` when something changed. GitHub Pages then rebuilds the site. To run it right away: **Actions → Update survey results → Run workflow**.

It reads the responses from the `SURVEY_CSV_URL` repository variable (Settings → Secrets and variables → Actions → Variables). Responses that can't be matched to a course are skipped. Asking for the course code on the form (e.g. GOV 364V) makes matching reliable.

## Visit counts

The site counts page views with [GoatCounter](https://www.goatcounter.com) (no cookies, no personal data). Each course page is counted as `/course/<code>` and each department as `/major/<dept>`, so the dashboard at **utbooklist.goatcounter.com** ranks the most-viewed courses. Events also record searches that found nothing (`search-no-results/...`) and clicks out to the Co-op, VitalSource and syllabi (`co-op-link/<course>` and so on).

## Updating course data

Upload a new copy of `data.json` with the same file name: **Add file → Upload files → Commit changes**. The live site updates within a couple of minutes.
