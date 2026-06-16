"""Compliance reporting: gap analysis + CSV / PDF export.

Builds an audit-ready view of control posture per framework and renders it as
CSV or a dependency-free PDF. An optional AI-drafted executive summary is added
via the AI gateway (degrades gracefully when no provider is configured).
"""

import io
import csv
import time

from sqlalchemy.orm import Session

import models
import framework_library


# ---------------------------------------------------------------------------
# Data
# ---------------------------------------------------------------------------

def build_gap_analysis(db: Session, org_id: str, framework_id: str = None) -> dict:
    """Per-framework control posture with gaps (failing/warning controls)."""
    fw_query = db.query(models.Framework).filter_by(org_id=org_id)
    if framework_id:
        fw_query = fw_query.filter_by(id=framework_id)
    frameworks = fw_query.all()

    out_frameworks = []
    for fw in frameworks:
        controls = db.query(models.Control).filter(
            models.Control.org_id == org_id,
            models.Control.frameworks.contains(fw.id),
        ).all()
        total = len(controls)
        passing = sum(1 for c in controls if c.status == "Passing")
        failing = [c for c in controls if c.status == "Failing"]
        warning = [c for c in controls if c.status == "Warning"]
        out_frameworks.append({
            "id": fw.id,
            "name": fw.name,
            "code": fw.code,
            "total_controls": total,
            "passing": passing,
            "warning": len(warning),
            "failing": len(failing),
            "readiness": round((passing / total) * 100, 1) if total else 0.0,
            "controls": [
                {"control_code": c.control_code, "title": c.title, "status": c.status}
                for c in sorted(controls, key=lambda x: x.control_code)
            ],
            "gaps": [
                {"control_code": c.control_code, "title": c.title, "status": c.status}
                for c in (failing + warning)
            ],
        })

    total_controls = db.query(models.Control).filter_by(org_id=org_id).count()
    return {
        "org_id": org_id,
        "generated_at": int(time.time()),
        "framework_count": len(out_frameworks),
        "total_controls": total_controls,
        "frameworks": out_frameworks,
    }


def ai_executive_summary(report: dict, org_id: str) -> str:
    """Draft a short executive summary of the gap analysis (best-effort)."""
    try:
        import ai_gateway
        lines = [f"{f['name']}: {f['readiness']}% ready, {f['failing']} failing, "
                 f"{f['warning']} warning of {f['total_controls']} controls"
                 for f in report["frameworks"]]
        prompt = (
            "Write a concise (max 150 words) executive summary of this compliance "
            "gap analysis for a banking GRC audit report. State overall posture and "
            "the top remediation priorities. Plain prose, no markdown headings.\n\n"
            + "\n".join(lines)
        )
        return ai_gateway.generate_content(
            prompt, "You are a senior GRC compliance officer.", org_id=org_id
        ).strip()
    except Exception as e:
        print(f"AI summary skipped: {e}")
        return ""


# ---------------------------------------------------------------------------
# CSV
# ---------------------------------------------------------------------------

def render_csv(report: dict) -> str:
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["Framework", "Code", "Control Code", "Control Title", "Status"])
    for fw in report["frameworks"]:
        if not fw["controls"]:
            w.writerow([fw["name"], fw["code"], "", "(no controls)", ""])
        for c in fw["controls"]:
            w.writerow([fw["name"], fw["code"], c["control_code"], c["title"], c["status"]])
    return buf.getvalue()


# ---------------------------------------------------------------------------
# PDF (minimal, dependency-free)
# ---------------------------------------------------------------------------

def _pdf_escape(text: str) -> str:
    return text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def _wrap(text: str, width: int = 95):
    words = (text or "").replace("\r", " ").split(" ")
    lines, line = [], ""
    for word in words:
        nxt = f"{line} {word}".strip()
        if len(nxt) > width and line:
            lines.append(line)
            line = word
        else:
            line = nxt
    if line:
        lines.append(line)
    return lines or [""]


def _build_lines(report: dict, summary: str = "") -> list[str]:
    ts = time.strftime("%Y-%m-%d %H:%M UTC", time.gmtime(report["generated_at"]))
    lines = [
        "COMPLIANCE GAP ANALYSIS",
        f"Generated: {ts}",
        f"Frameworks: {report['framework_count']}    Total controls: {report['total_controls']}",
        "",
    ]
    if summary:
        lines.append("EXECUTIVE SUMMARY")
        for l in _wrap(summary):
            lines.append(l)
        lines.append("")
    for fw in report["frameworks"]:
        lines.append(f"{fw['name']} [{fw['code']}]  -  Readiness {fw['readiness']}%")
        lines.append(f"  Passing {fw['passing']} / {fw['total_controls']}   Failing {fw['failing']}   Warning {fw['warning']}")
        for c in fw["controls"]:
            mark = {"Passing": "[PASS]", "Warning": "[WARN]", "Failing": "[FAIL]"}.get(c["status"], "[----]")
            for i, l in enumerate(_wrap(f"{mark} {c['control_code']}  {c['title']}", 90)):
                lines.append(("    " if i == 0 else "          ") + l)
        if not fw["controls"]:
            lines.append("    (no controls imported)")
        lines.append("")
    lines.append("Advisory: AI-assisted analysis. Review with a qualified analyst before action.")
    return lines


def render_pdf(report: dict, summary: str = "") -> bytes:
    """Render a simple multi-page text PDF (no external dependencies)."""
    text_lines = _build_lines(report, summary)

    # Layout
    page_w, page_h = 612, 792
    margin, font_size, leading = 50, 10, 14
    max_lines = int((page_h - 2 * margin) / leading)

    pages = [text_lines[i:i + max_lines] for i in range(0, len(text_lines), max_lines)] or [[""]]

    objects = []  # raw object bodies (without the "N 0 obj" wrapper)

    # 1: Catalog, 2: Pages, 3: Font; page + content objects follow.
    font_obj = 3
    first_page_obj = 4
    page_obj_ids = [first_page_obj + i * 2 for i in range(len(pages))]
    content_obj_ids = [first_page_obj + i * 2 + 1 for i in range(len(pages))]

    catalog = "<< /Type /Catalog /Pages 2 0 R >>"
    kids = " ".join(f"{pid} 0 R" for pid in page_obj_ids)
    pages_obj = f"<< /Type /Pages /Count {len(pages)} /Kids [{kids}] >>"
    font = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"

    objects.append(catalog)
    objects.append(pages_obj)
    objects.append(font)

    for idx, page_lines in enumerate(pages):
        # Content stream
        stream_parts = ["BT", f"/F1 {font_size} Tf", f"{leading} TL", f"{margin} {page_h - margin} Td"]
        for j, line in enumerate(page_lines):
            if j == 0:
                stream_parts.append(f"({_pdf_escape(line)}) Tj")
            else:
                stream_parts.append(f"T* ({_pdf_escape(line)}) Tj")
        stream_parts.append("ET")
        stream = "\n".join(stream_parts)
        content_obj = f"<< /Length {len(stream)} >>\nstream\n{stream}\nendstream"
        page_dict = (
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {page_w} {page_h}] "
            f"/Resources << /Font << /F1 {font_obj} 0 R >> >> "
            f"/Contents {content_obj_ids[idx]} 0 R >>"
        )
        objects.append(page_dict)      # page object
        objects.append(content_obj)    # content object

    # Assemble with xref.
    out = io.BytesIO()
    out.write(b"%PDF-1.4\n")
    offsets = [0]  # object 0 is the free object
    for i, body in enumerate(objects, start=1):
        offsets.append(out.tell())
        out.write(f"{i} 0 obj\n{body}\nendobj\n".encode("latin-1", errors="replace"))

    xref_pos = out.tell()
    count = len(objects) + 1
    out.write(f"xref\n0 {count}\n".encode())
    out.write(b"0000000000 65535 f \n")
    for off in offsets[1:]:
        out.write(f"{off:010d} 00000 n \n".encode())
    out.write(f"trailer\n<< /Size {count} /Root 1 0 R >>\nstartxref\n{xref_pos}\n%%EOF".encode())
    return out.getvalue()


def report_filename(report: dict, framework_id: str = None, ext: str = "csv") -> str:
    base = "gap-analysis"
    if framework_id:
        base = f"{framework_id}-{base}"
    stamp = time.strftime("%Y%m%d", time.gmtime(report["generated_at"]))
    return f"{base}-{stamp}.{ext}"
