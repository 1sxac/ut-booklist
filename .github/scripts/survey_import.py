"""Turn the "Course Textbook Transparency" Google Form export into verified.json for the website.

usage: python3 survey_import.py RESPONSES(.xlsx|.csv) SITE_DIR [--min N] [--term "Fall 2026"] [--quiet]

  RESPONSES  Google Forms export (File > Download > .xlsx or .csv from the responses sheet)
  SITE_DIR   folder holding data.json; verified.json and survey_review.csv are written next to it
  --min      confirming responses a section needs before it shows "Student verified" (default 1)
  --term     semester the site's book lists are for; only responses from it count toward the badge

Matching, in order:
  1. a course code typed anywhere in the response (e.g. "GOV 364V"), or a "Course code" column if the form adds one
  2. OVERRIDES below (free-text course name -> course code), for names the matcher can't resolve
  3. the course title, abbreviation-aware: Co-op titles are truncated ("SOCL WORK PRAC WITH INDIV/FAMS")
Then sections are narrowed by professor (if the form asks), unique number (if asked), or by which
sections list the books the student named. Only derived fields are published, never emails or names.
"""
import csv, datetime as dt, json, os, re, sys, collections

OVERRIDES = {
    # 'normalized course name as students type it': 'COURSE CODE',
}

STOP = {'AND', 'OF', 'THE', 'IN', 'WITH', 'TO', 'FOR', 'A', 'AN', 'ON', 'AT', 'BY', 'SMNR', 'SEMINAR', 'TOPICS', 'TPCS'}


ROMAN = {'1': 'I', '2': 'II', '3': 'III', '4': 'IV'}


def toks(s):
    out = []
    for t in re.split(r'[^A-Z0-9]+', str(s or '').upper()):
        t = ROMAN.get(t, t)               # "Calc 2" ~ "CALCULUS II"
        if (len(t) > 1 or t == 'I') and t not in STOP:
            out.append(t)
    return out


def abbr(a, w):
    """Does token a abbreviate word w (or vice versa)? PRAC~PRACTICE, SOCL~SOCIAL, FAMS~FAMILIES, PROPAGNDA~PROPAGANDA."""
    if a == w:
        return True
    if len(a) > len(w):
        a, w = w, a
    if len(a) < 3 or a[0] != w[0]:
        return False
    if w.startswith(a):
        return True
    it = iter(w)
    return all(ch in it for ch in a) and len(a) >= 0.45 * len(w)


def title_score(student, title):
    st, tt = toks(student), toks(re.sub(r'^\d+-', '', title or ''))
    if not st or not tt:
        return 0.0
    hit_t = sum(1 for t in tt if any(abbr(t, s) for s in st))
    hit_s = sum(1 for s in st if any(abbr(t, s) for t in tt))
    return (hit_t / len(tt)) * (hit_s / len(st))


def book_hit(item_title, text):
    """Is this book named in the student's free text? Uses the main title (before ':'), ignoring series prefixes."""
    t = re.sub(r'^(empowerment series|mindtap|connect)\s*:\s*', '', item_title or '', flags=re.I)
    main = toks(t.split(':')[0]) or toks(t)
    if not main:
        return False
    words = toks(text)
    hit = sum(1 for m in main if any(abbr(m, w) for w in words))
    return hit / len(main) >= 0.6


def price_bounds(p):
    """'$100 or less' -> (0,100); '$50-$100' -> (50,100); 'More than $200' / '$200+' -> (200,None); '$0' / 'None' -> (0,0)."""
    s = str(p or '').strip().lower()
    if not s:
        return None
    nums = [float(x.replace(',', '')) for x in re.findall(r'\d[\d,]*(?:\.\d+)?', s)]
    if re.search(r'\b(none|nothing|free)\b', s) or nums == [0.0]:
        return (0.0, 0.0)
    if not nums:
        return None
    if re.search(r'or less|under|less than|below|up to|<', s):
        return (0.0, nums[0])
    if re.search(r'more than|over|above|\+|or more|>', s):
        return (nums[0], None)
    if len(nums) >= 2:
        return (min(nums[:2]), max(nums[:2]))
    return (nums[0], nums[0])


def to_day(ts):
    """Form timestamp -> YYYY-MM-DD. The .xlsx export gives datetimes; the CSV export gives '10/12/2026 16:52:18'."""
    if isinstance(ts, (dt.datetime, dt.date)):
        return (ts.date() if isinstance(ts, dt.datetime) else ts).isoformat()
    s = str(ts or '').strip()
    for fmt in ('%m/%d/%Y %H:%M:%S', '%m/%d/%Y %H:%M', '%m/%d/%Y', '%Y-%m-%d %H:%M:%S', '%Y-%m-%dT%H:%M:%S', '%Y-%m-%d', '%d/%m/%Y %H:%M:%S'):
        try:
            return dt.datetime.strptime(s.split('.')[0], fmt).date().isoformat()
        except ValueError:
            pass
    return s[:10]


def read_rows(path):
    if path.lower().endswith('.csv'):
        with open(path, newline='', encoding='utf-8-sig') as f:
            rows = list(csv.reader(f))
    else:
        import openpyxl
        ws = openpyxl.load_workbook(path, data_only=True).worksheets[0]
        rows = [list(r) for r in ws.iter_rows(values_only=True)]
    rows = [r for r in rows if any(v not in (None, '') for v in r)]
    return [str(h or '').strip() for h in rows[0]], rows[1:]


def col(headers, *pats, avoid=()):
    for i, h in enumerate(headers):
        hl = h.lower()
        if any(re.search(p, hl) for p in pats) and not any(re.search(a, hl) for a in avoid):
            return i
    return None


def main():
    args = sys.argv[1:]
    opt = {'--min': '1', '--term': 'Fall 2026'}
    pos, quiet = [], False
    while args:
        a = args.pop(0)
        if a == '--quiet':
            quiet = True          # CI logs on a public repo are public: print counts only, never responses
        elif a in opt:
            opt[a] = args.pop(0)
        else:
            pos.append(a)
    src, site = pos
    MIN, TERM = int(opt['--min']), opt['--term']
    D = json.load(open(os.path.join(site, 'data.json')))
    items = D['items']
    REQ = {'R', 'L', 'W'}
    code_rx = re.compile(r'\b(' + '|'.join(sorted((re.escape(k) for k in D['depts']), key=len, reverse=True)) + r')\s?(\d{3}[A-Z]{0,2})\b', re.I)
    by_code = {re.sub(r'\s+', '', c['c']).upper(): c for c in D['courses']}
    secs = [(c, s) for c in D['courses'] for s in c['s']]

    headers, rows = read_rows(src)
    H = {
        'ts': col(headers, r'timestamp'),
        'code': col(headers, r'course (code|number)', r'^course #'),
        'course': col(headers, r'course'),
        'sem': col(headers, r'semester|term'),
        'n': col(headers, r'how many'),
        'books': col(headers, r'textbook name|book name|title', avoid=(r'how many', r'price')),
        'price': col(headers, r'price|cost|paid|spend'),
        'prof': col(headers, r'professor|instructor|teacher'),
        'uniq': col(headers, r'unique'),
    }
    if H['course'] == H['code']:
        H['course'] = col(headers, r'course name') or H['course']
    get = lambda r, k: (r[H[k]] if H[k] is not None and H[k] < len(r) else None)

    reports, review = [], []
    sec_map = collections.defaultdict(list)
    for r in rows:
        name = str(get(r, 'course') or '').strip()
        code_txt = ' '.join(str(x or '') for x in (get(r, 'code'), name))
        books = str(get(r, 'books') or '').strip()
        prof = str(get(r, 'prof') or '').strip()
        uniq = re.findall(r'\b\d{5}\b', str(get(r, 'uniq') or ''))
        day = to_day(get(r, 'ts'))
        how, cands = '', []
        # 1. typed course code
        m = code_rx.search(code_txt)
        if m and (m.group(1) + m.group(2)).replace(' ', '').upper() in by_code:
            c = by_code[(m.group(1) + m.group(2)).replace(' ', '').upper()]
            cands, how = [(c, s) for s in c['s']], 'course code'
        # 2. manual override
        elif ' '.join(toks(name)) in OVERRIDES:
            c = by_code[OVERRIDES[' '.join(toks(name))].replace(' ', '').upper()]
            cands, how = [(c, s) for s in c['s']], 'manual mapping'
        # 3. title
        elif name:
            scored = [(title_score(name, s.get('tt') or c['t']), c, s) for c, s in secs]
            best = max(x[0] for x in scored)
            if best >= 0.6:
                cands = [(c, s) for sc, c, s in scored if sc >= best - 1e-9]
                how = 'title match (%.0f%%)' % (best * 100)
        # narrow to sections: unique number, then professor, then the books they named
        if cands and uniq:
            cands = [x for x in cands if x[1]['u'] in uniq] or cands
        if cands and prof:
            last = [t for t in toks(prof) if len(t) > 2]
            hit = [x for x in cands if any(t in (x[1]['in'] or '').upper() for t in last)]
            cands = hit or cands
        overlap = {}
        if cands and books:
            for c, s in cands:
                req = [ix for ix, rq in s['m'] if rq in REQ]
                overlap[s['u']] = sum(1 for ix in req if book_hit(items[ix]['t'], books))
            top = max(overlap.values())
            if top:
                cands = [x for x in cands if overlap[x[1]['u']] == top]
        courses = sorted({c['c'] for c, s in cands})
        # cross-listed sections share an instructor and book list; anything else is ambiguous
        sig = {((s['in'] or ''), tuple(sorted(ix for ix, _ in s['m']))) for c, s in cands}
        ambiguous = len(courses) > 1 and len({x[0] for x in sig}) > 1
        status, note = 'unmatched', ''
        rep = None
        if cands and not ambiguous:
            s0 = cands[0][1]
            req = [ix for ix, rq in s0['m'] if rq in REQ]
            found = [ix for ix in req if book_hit(items[ix]['t'], books)]
            n_raw = get(r, 'n')
            try:
                n = int(float(n_raw)) if n_raw not in (None, '') else None
            except ValueError:
                n = None
            books_ok = bool(req) and len(found) == len(req) and (n is None or n == len(req))
            if not req and (n == 0 or re.search(r'\b(none|no textbook|n/?a)\b', books, re.I)):
                books_ok = True
            pb = price_bounds(get(r, 'price'))
            est = s0.get('c')
            price_ok = None
            if pb and est is not None:
                lo, hi = pb
                price_ok = (est >= lo - 0.5) and (hi is None or est <= hi + 0.5)
            sem = str(get(r, 'sem') or '').strip()
            this_term = (not sem) or sem.lower() == TERM.lower()
            rep = {'d': day, 'sem': sem, 'n': n, 'b': books[:300], 'p': str(get(r, 'price') or '').strip()[:40],
                   'ok': 1 if books_ok else 0, 'po': None if price_ok is None else (1 if price_ok else 0),
                   'cur': 1 if this_term else 0, 'u': [s['u'] for c, s in cands], 'f': len(found), 'rq': len(req)}
            reports.append(rep)
            for c, s in cands:
                sec_map[s['u']].append(len(reports) - 1)
            status = 'confirms our list' if books_ok else 'differs from our list'
            if not this_term:
                note = 'different semester; shown but not counted'
        elif ambiguous:
            note = 'title matches several unrelated courses: ' + ', '.join(courses[:6]) + ' (add it to OVERRIDES or ask for the course code)'
        else:
            note = 'no course title close enough; add it to OVERRIDES or ask for the course code'
        review.append({'date': day, 'course_entered': name, 'matched_by': how, 'courses': '; '.join(courses) if not ambiguous else '',
                       'sections': ' '.join(sorted({s['u'] for c, s in cands})) if not ambiguous else '',
                       'status': status, 'books_on_site': ' | '.join(items[ix]['t'] for ix, rq in (cands[0][1]['m'] if cands and not ambiguous else []) if rq in REQ),
                       'books_entered': books, 'price_entered': str(get(r, 'price') or ''),
                       'site_estimate': (cands[0][1].get('c') if cands and not ambiguous else ''), 'note': note})

    out = {'asof': dt.date.today().isoformat(), 'term': TERM, 'min': MIN, 'total': len(rows),
           'matched': len(reports), 'r': reports, 'sec': dict(sec_map)}
    vpath = os.path.join(site, 'verified.json')
    try:
        old = json.load(open(vpath))
    except (OSError, ValueError):
        old = None
    changed = not (old and {k: v for k, v in old.items() if k != 'asof'} == {k: v for k, v in out.items() if k != 'asof'})
    if changed:      # only touch the file (and its date) when the results actually changed
        json.dump(out, open(vpath, 'w'), separators=(',', ':'), ensure_ascii=False)
    if not quiet:
        rv = os.path.join(os.path.dirname(os.path.abspath(site)), 'survey_review.csv')
        with open(rv, 'w', newline='') as f:
            w = csv.DictWriter(f, fieldnames=list(review[0].keys()) if review else ['date'])
            w.writeheader(); w.writerows(review)
    verified = {u for u, ix in sec_map.items() if sum(1 for i in ix if reports[i]['ok'] and reports[i]['cur']) >= MIN}
    print('responses', len(rows), 'matched', len(reports), 'unmatched', len(rows) - len(reports),
          'sections with reports', len(sec_map), 'verified sections', len(verified), 'changed' if changed else 'unchanged')
    if not quiet:
        for x in review:
            print(' -', x['date'], '|', x['course_entered'], '->', x['courses'] or '?', x['sections'], '|', x['matched_by'], '|', x['status'], '|', x['note'])


if __name__ == '__main__':
    main()
