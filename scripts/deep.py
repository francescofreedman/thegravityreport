"""Native Deep Dives: content/deep/<slug>.md -> a normal web article (no LaTeX, no page images).

Markup, one block per blank-line-separated chunk:
  ## Heading
  plain paragraph            inline: **bold**, [n](url) source markers
  !abstract text             the opening summary
  !small text                small print (method notes, grading notes)
  !call 55% | claim | note   a probability bar
  !table Caption             followed on the next lines by a pipe table (first row = header)
  !chart id | Caption        an SVG chart; data in content/deep/<slug>.charts.json under "id"
  !source n | title | url    one entry in the sources list
Tables and charts are numbered in order (Table 1, Figure 1 ...).
"""
import html
import json
import os
import re

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
DEEP_DIR = os.path.join(ROOT, "content", "deep")
SRC_RE = re.compile(r"\[(\d+)\]\((https?://[^)\s]+)\)")
BOLD_RE = re.compile(r"\*\*(.+?)\*\*")
NUM_RE = re.compile(r"^[\s*]*[−+\-]?[$#]?\d[\d,.]*%?[\s*]*$|^[\s*]*[−+\-]?\.\d+[\s*]*$|^[\s*]*\?[\s*]*$|^$")


def e(s):
    return html.escape(str(s), quote=True)


def has_native(slug):
    return os.path.exists(os.path.join(DEEP_DIR, f"{slug}.md"))


def inline(text):
    """Escape, then **bold** and [n](url) source markers (rendered as superscript links)."""
    out, last = [], 0
    for m in SRC_RE.finditer(text):
        out.append(_bold(e(text[last:m.start()])))
        out.append(f'<sup><a class="src" href="{e(m.group(2))}" title="Source {m.group(1)}">{m.group(1)}</a></sup>')
        last = m.end()
    out.append(_bold(e(text[last:])))
    return "".join(out)


def _bold(s):
    return BOLD_RE.sub(r"<b>\1</b>", s)


def read(slug):
    text = open(os.path.join(DEEP_DIR, f"{slug}.md"), encoding="utf-8").read()
    charts_path = os.path.join(DEEP_DIR, f"{slug}.charts.json")
    charts = json.load(open(charts_path, encoding="utf-8")) if os.path.exists(charts_path) else {}
    blocks = []
    for chunk in re.split(r"\n\s*\n", text.strip()):
        lines = [ln.rstrip() for ln in chunk.strip().splitlines()]
        head = lines[0]
        if head.startswith("## "):
            blocks.append({"t": "h2", "text": head[3:].strip()})
        elif head.startswith("!abstract "):
            blocks.append({"t": "abstract", "text": " ".join([head[10:]] + lines[1:])})
        elif head.startswith("!small "):
            blocks.append({"t": "small", "text": " ".join([head[7:]] + lines[1:])})
        elif head.startswith("!call "):
            pct, claim, note = (x.strip() for x in " ".join(lines)[6:].split("|", 2))
            blocks.append({"t": "call", "p": int(pct.rstrip("%")), "claim": claim, "note": note})
        elif head.startswith("!table"):
            rows = [[c.strip() for c in ln.strip().strip("|").split("|")] for ln in lines[1:]
                    if ln.strip().startswith("|") and not re.match(r"^\|[\s\-:|]+\|$", ln.strip())]
            blocks.append({"t": "table", "caption": head[6:].strip(), "rows": rows})
        elif head.startswith("!chart "):
            cid, _, cap = head[7:].partition("|")
            cid = cid.strip()
            if cid not in charts:
                raise KeyError(f"{slug}: chart '{cid}' missing from {slug}.charts.json")
            blocks.append({"t": "chart", "id": cid, "caption": cap.strip(), "spec": charts[cid]})
        elif head.startswith("!source "):
            n, title, url = (x.strip() for x in " ".join(lines)[8:].split("|", 2))
            blocks.append({"t": "source", "n": n, "title": title, "url": url})
        else:
            blocks.append({"t": "p", "text": " ".join(lines)})
    return blocks


def read_minutes(blocks):
    words = 0
    for b in blocks:
        for k in ("text", "claim", "note", "caption"):
            words += len(SRC_RE.sub("", b.get(k, "")).split())
    return max(1, round(words / 230))


# ---------------------------------------------------------------- tables

def table_html(rows, caption, n):
    head, body = rows[0], rows[1:]
    numeric = [all(NUM_RE.match(r[i] if i < len(r) else "") for r in body) for i in range(len(head))]
    def cell(tag, txt, i):
        cls = ' class="num"' if numeric[i] else ""
        return f"<{tag}{cls}>{inline(txt)}</{tag}>"
    th = "".join(cell("th", h, i) for i, h in enumerate(head))
    trs = []
    for r in body:
        hl = ' class="hl"' if r and r[0].startswith("**") or (len(r) > 1 and r[1].startswith("**")) else ""
        trs.append(f"<tr{hl}>" + "".join(cell("td", c, i) for i, c in enumerate(r)) + "</tr>")
    return (f'<figure class="dt-fig"><figcaption><b>Table {n}.</b> {inline(caption)}</figcaption>'
            f'<div class="dt-scroll" tabindex="0"><table class="dt"><thead><tr>{th}</tr></thead>'
            f'<tbody>{"".join(trs)}</tbody></table></div></figure>')


# ---------------------------------------------------------------- charts
# Colors are CSS roles (site.css .viz rules), never raw hex here.
W, H = 760, 320
PAD = {"l": 60, "r": 12, "t": 14, "b": 36}
SHAPES = {"circle", "square", "triangle", "diamond"}


def _scale(v, d0, d1, r0, r1):
    return r0 + (v - d0) / (d1 - d0) * (r1 - r0)


def _axes(x0, x1, y0, y1, xticks, yticks, xlabel, ylabel, yfmt):
    pw0, pw1, ph0, ph1 = PAD["l"], W - PAD["r"], H - PAD["b"], PAD["t"]
    g = []
    for t in yticks:
        y = _scale(t, y0, y1, ph0, ph1)
        g.append(f'<line class="grid" x1="{pw0}" x2="{pw1}" y1="{y:.1f}" y2="{y:.1f}"/>'
                 f'<text class="tick" x="{pw0 - 8}" y="{y + 4:.1f}" text-anchor="end">{yfmt(t)}</text>')
    for t in xticks:
        x = _scale(t, x0, x1, pw0, pw1)
        g.append(f'<text class="tick" x="{x:.1f}" y="{ph0 + 18}" text-anchor="middle">{t}</text>')
    g.append(f'<text class="axlabel" x="{(pw0 + pw1) / 2:.0f}" y="{H - 4}" text-anchor="middle">{e(xlabel)}</text>')
    g.append(f'<text class="axlabel" transform="translate(11,{(ph0 + ph1) / 2:.0f}) rotate(-90)" text-anchor="middle">{e(ylabel)}</text>')
    return "".join(g)


def _legend(series):
    items = "".join(f'<span class="lg"><svg width="14" height="14" aria-hidden="true">{_mark(s.get("shape", "bar"), 7, 7, 5, s["role"])}</svg>{e(s["label"])}</span>'
                    for s in series)
    return f'<div class="viz-legend">{items}</div>'


def _mark(shape, x, y, r, role, title=None):
    t = f"<title>{e(title)}</title>" if title else ""
    c = f'class="m {role}"'
    if shape == "square":
        return f'<rect {c} x="{x - r:.1f}" y="{y - r:.1f}" width="{2 * r}" height="{2 * r}" rx="1">{t}</rect>'
    if shape == "triangle":
        return f'<path {c} d="M{x:.1f},{y - r * 1.15:.1f} L{x + r * 1.1:.1f},{y + r * 0.85:.1f} L{x - r * 1.1:.1f},{y + r * 0.85:.1f} Z">{t}</path>'
    if shape == "diamond":
        return f'<path {c} d="M{x:.1f},{y - r * 1.25:.1f} L{x + r * 1.1:.1f},{y:.1f} L{x:.1f},{y + r * 1.25:.1f} L{x - r * 1.1:.1f},{y:.1f} Z">{t}</path>'
    if shape == "bar":
        return f'<rect {c} x="{x - r:.1f}" y="{y - r:.1f}" width="{2 * r}" height="{2 * r}" rx="2">{t}</rect>'
    return f'<circle {c} cx="{x:.1f}" cy="{y:.1f}" r="{r}">{t}</circle>'


def chart_bars(spec):
    """Overlaid bars per x: series[0] wide (context), series[1] narrow (the highlight)."""
    xs = sorted({int(k) for s in spec["series"] for k in s["data"]})
    x0, x1 = xs[0] - 1, xs[-1] + 1
    y0, y1 = 0, spec.get("ymax", max(v for s in spec["series"] for v in s["data"].values()))
    pw0, pw1, ph0, ph1 = PAD["l"], W - PAD["r"], H - PAD["b"], PAD["t"]
    step = (pw1 - pw0) / (x1 - x0)
    widths = [min(step - 2, 12), max(4, (min(step - 2, 12)) * 0.5)]
    out = [_axes(x0, x1, y0, y1, spec["xticks"], spec["yticks"], spec["xlabel"], spec["ylabel"], lambda t: f"{t:g}")]
    for si, s in enumerate(spec["series"]):
        w = widths[min(si, 1)]
        for k, v in s["data"].items():
            if v <= 0:
                continue
            x = _scale(int(k), x0, x1, pw0, pw1)
            y = _scale(v, y0, y1, ph0, ph1)
            tip = f'{spec["tip_x"].format(x=int(k))}: {v} {s["tip"]}'
            r = min(2, w / 2)
            out.append(f'<path class="m {s["role"]}" d="M{x - w / 2:.1f},{ph0} V{y + r:.1f} Q{x - w / 2:.1f},{y:.1f} {x - w / 2 + r:.1f},{y:.1f} '
                       f'H{x + w / 2 - r:.1f} Q{x + w / 2:.1f},{y:.1f} {x + w / 2:.1f},{y + r:.1f} V{ph0} Z"><title>{e(tip)}</title></path>')
    return out


def chart_dots(spec):
    pts = [(int(k), v, s) for s in spec["series"] for k, v in s["data"].items()]
    x0, x1 = spec["xmin"], spec["xmax"]
    y0, y1 = spec["ymin"], spec["ymax"]
    pw0, pw1, ph0, ph1 = PAD["l"], W - PAD["r"], H - PAD["b"], PAD["t"]
    out = [_axes(x0, x1, y0, y1, spec["xticks"], spec["yticks"], spec["xlabel"], spec["ylabel"], lambda t: f"+{t:.1f}")]
    for s in spec["series"]:  # context series first, highlights drawn on top
        for k, v in s["data"].items():
            x, y = _scale(int(k), x0, x1, pw0, pw1), _scale(v, y0, y1, ph0, ph1)
            name = s.get("names", {}).get(k, s["label"])
            tip = f'{spec["tip_x"].format(x=int(k))}: {name}, +{v:.2f}'
            out.append(_mark(s.get("shape", "circle"), x, y, s.get("r", 4.5), s["role"], tip))
    for lab in spec.get("labels", []):  # selective direct labels
        x, y = _scale(lab["x"], x0, x1, pw0, pw1), _scale(lab["y"], y0, y1, ph0, ph1)
        out.append(f'<text class="dlabel" x="{x:.1f}" y="{y:.1f}" text-anchor="{lab.get("anchor", "middle")}">{e(lab["text"])}</text>')
    return out


def data_table(spec):
    keys = sorted({k for s in spec["series"] for k in s["data"]}, key=int)
    head = "".join(f'<th class="num">{e(s["label"])}</th>' for s in spec["series"])
    rows = []
    for k in keys:
        cells = []
        for s in spec["series"]:
            v = s["data"].get(k)
            nm = s.get("names", {}).get(k)
            cells.append(f'<td class="num">{"" if v is None else e((nm + " " if nm else "") + (f"+{v:.2f}" if isinstance(v, float) else str(v)))}</td>')
        rows.append(f'<tr><td>{e(spec["tip_x"].format(x=int(k)))}</td>{"".join(cells)}</tr>')
    return (f'<details class="viz-data"><summary>Show the numbers</summary><div class="dt-scroll" tabindex="0"><table class="dt">'
            f'<thead><tr><th>{e(spec["xlabel"])}</th>{head}</tr></thead><tbody>{"".join(rows)}</tbody></table></div></details>')


def chart_html(spec, caption, n):
    marks = chart_bars(spec) if spec["type"] == "bars" else chart_dots(spec)
    base = H - PAD["b"]
    marks.append(f'<line class="axis" x1="{PAD["l"]}" x2="{W - PAD["r"]}" y1="{base}" y2="{base}"/>')
    svg = (f'<svg class="viz" viewBox="0 0 {W} {H}" role="img" aria-label="{e(spec["alt"])}">'
           f'{"".join(marks)}</svg>')
    return (f'<figure class="viz-fig"><div class="viz-title">{e(spec["title"])}</div>{_legend(spec["series"])}{svg}'
            f'<figcaption><b>Figure {n}.</b> {inline(caption)}</figcaption>{data_table(spec)}</figure>')


# ---------------------------------------------------------------- page body

def body_html(blocks, pbar, pscale):
    out, nt, nf, scaled, sources = [], 0, 0, False, []
    for b in blocks:
        t = b["t"]
        if t == "h2":
            out.append(f"<h2>{inline(b['text'])}</h2>")
        elif t == "p":
            out.append(f"<p>{inline(b['text'])}</p>")
        elif t == "abstract":
            out.append(f'<div class="abstract"><span class="lead">In short.</span> {inline(b["text"])}</div>')
        elif t == "small":
            out.append(f'<p class="small">{inline(b["text"])}</p>')
        elif t == "table":
            nt += 1
            out.append(table_html(b["rows"], b["caption"], nt))
        elif t == "chart":
            nf += 1
            out.append(chart_html(b["spec"], b["caption"], nf))
        elif t == "call":
            if not scaled:
                out.append(pscale())
                scaled = True
            out.append(f'<div class="call"><div class="call-claim">{inline(b["claim"])}</div>'
                       f'<div class="pbar-wrap">{pbar(b["p"])}<b class="pbar-pct">{b["p"]}%</b></div>'
                       f'<p class="call-note">{inline(b["note"])}</p></div>')
        elif t == "source":
            sources.append(b)
    if sources:
        lis = "".join(f'<li value="{e(s["n"])}">{inline(s["title"])} <a href="{e(s["url"])}">{e(s["url"])}</a></li>' for s in sources)
        out.append(f'<ol class="sources small">{lis}</ol>')
    return "\n".join(out)
