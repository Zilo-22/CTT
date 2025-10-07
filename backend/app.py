import io, os, json, csv, html
from typing import Dict, Any, List, Optional
import pandas as pd
from bs4 import BeautifulSoup
from ftfy import fix_text
from fastapi import FastAPI, Request, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
TEMPLATES_DIR = os.path.join(BASE_DIR, "templates")
STATIC_DIR = os.path.join(BASE_DIR, "static")

app = FastAPI(title="Catalog Buddy")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve static + templates; UI opens directly at "/"
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
templates = Jinja2Templates(directory=TEMPLATES_DIR)


@app.get("/", response_class=HTMLResponse)
async def serve_index(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})


VARIANT_LEVEL_SHOPIFY_HEADERS = set([
    "Variant SKU", "Variant Price", "Variant Compare At Price", "Variant Barcode",
    "Variant Inventory Qty", "Variant Grams", "Variant Weight", "Variant Weight Unit",
    "Variant Tax Code", "Variant Fulfillment Service", "Variant Requires Shipping",
    "Variant Taxable", "Variant Title", "Variant Image",
    "Option1 Value", "Option2 Value", "Option3 Value",
    "Cost per item", "Inventory Policy", "Inventory Qty", "Inventory Item ID", "Inventory Tracker"
])


def read_templates() -> Dict[str, Any]:
    res = {}
    for f in os.listdir(TEMPLATES_DIR):
        if f.endswith(".json"):
            with open(os.path.join(TEMPLATES_DIR, f), "r", encoding="utf-8") as fh:
                data = json.load(fh)
                res[data["templateKey"]] = data
    return res


def clean_text_value(v: Any) -> str:
    if v is None:
        return ""
    s = str(v)
    s = fix_text(s)
    s = html.unescape(s)
    s = BeautifulSoup(s, "html.parser").get_text(" ")
    return " ".join(s.split())


def normalize_headers(df: pd.DataFrame) -> pd.DataFrame:
    for c in df.columns:
        df[c] = df[c].astype(str).fillna("").replace("nan", "")
    return df


def get_col(df: pd.DataFrame, name: str) -> Optional[pd.Series]:
    if name in df.columns:
        return df[name]
    low = {c.lower(): c for c in df.columns}
    return df[low[name.lower()]] if name.lower() in low else None


def collect_images(df: pd.DataFrame) -> Dict[str, Dict[int, str]]:
    res = {}
    h = get_col(df, "Handle")
    s = get_col(df, "Image Src")
    p = get_col(df, "Image Position")
    if h is None or s is None or p is None:
        return res
    for i in range(len(df)):
        handle = (h.iloc[i] or "").strip()
        url = (s.iloc[i] or "").strip()
        pos_raw = (p.iloc[i] or "").strip()
        if not handle or not url or not pos_raw:
            continue
        try:
            pos = int(float(pos_raw))
        except:
            continue
        if pos < 1 or pos > 5:
            continue
        res.setdefault(handle, {})
        if pos not in res[handle]:
            res[handle][pos] = url
    return res


def stream_csv(header: List[str], rows_iter):
    def it():
        yield b'\xef\xbb\xbf'
        buf = io.StringIO()
        w = csv.writer(buf, lineterminator="\r\n")
        w.writerow(header)
        yield buf.getvalue().encode("utf-8")
        buf.seek(0); buf.truncate(0)
        for r in rows_iter:
            w.writerow(r)
            yield buf.getvalue().encode("utf-8")
            buf.seek(0); buf.truncate(0)
    return StreamingResponse(it(), media_type="text/csv; charset=utf-8")


@app.get("/templates")
def list_templates():
    return {"templates": list(read_templates().values())}


@app.post("/transform")
async def transform(
    file: UploadFile = File(...),
    templateKey: str = Form(...),
    mapping: str = Form(...),
    textCleanup: str = Form(""),
    filename: str = Form("zilo_export.csv"),
    preview: str = Form("")
):
    tpls = read_templates()
    if templateKey not in tpls:
        raise HTTPException(400, "Unknown templateKey")
    tpl = tpls[templateKey]
    export_rules = tpl.get("exportRules", {})
    required_key = export_rules.get("requiredFieldKey", "sku")
    drop_if_blank = set(export_rules.get("dropRowIfBlankKeys", []))

    try:
        mapping_obj = json.loads(mapping)
    except:
        raise HTTPException(400, "Invalid mapping JSON")

    cleanup_cols = []
    if textCleanup:
        try:
            cleanup_cols = json.loads(textCleanup).get("columns", [])
        except:
            cleanup_cols = []

    content = await file.read()
    try:
        df = pd.read_csv(io.BytesIO(content), dtype=str, keep_default_na=False, na_filter=False, encoding="utf-8")
    except:
        df = pd.read_csv(io.BytesIO(content), dtype=str, keep_default_na=False, na_filter=False, encoding="utf-8-sig")
    df = normalize_headers(df)

    for c in cleanup_cols:
        ser = get_col(df, c)
        if ser is not None:
            df[ser.name] = df[ser.name].map(clean_text_value)

    images = collect_images(df)

    auto_image_fields, mapped_fields = [], []
    for f in tpl["fields"]:
        k = f["key"]
        auto = f.get("autoMap")
        if auto and f.get("type") == "image":
            try:
                pos = int(auto.split("=")[-1])
            except:
                pos = None
            if pos:
                auto_image_fields.append((k, pos, f["label"]))
        elif k in mapping_obj and mapping_obj[k]:
            mapped_fields.append({"key": k, "src": mapping_obj[k], "label": f["label"]})

    # --- Build unique headers ---
    headers: List[str] = []
    added_labels = set()
    for f in tpl["fields"]:
        lbl = f["label"]
        k = f["key"]
        if lbl in added_labels:
            continue
        if any(m["key"] == k for m in mapped_fields) or any(a[0] == k for a in auto_image_fields):
            headers.append(lbl)
            added_labels.add(lbl)

    handle_series = get_col(df, "Handle")
    if handle_series is None:
        handle_series = pd.Series(["__row__" + str(i) for i in range(len(df))])

    product_values = {}
    for m in mapped_fields:
        src = m["src"]
        is_variant = src in VARIANT_LEVEL_SHOPIFY_HEADERS
        if not is_variant:
            src_col = get_col(df, src)
            if src_col is None:
                continue
            values_by_handle = {}
            for idx, h in enumerate(handle_series):
                v = (src_col.iloc[idx] or "").strip()
                if not v:
                    continue
                if h not in values_by_handle:
                    values_by_handle[h] = v
            for h, v in values_by_handle.items():
                product_values.setdefault(h, {})[m["key"]] = v

    def rows_iter():
        for idx in range(len(df)):
            h = handle_series.iloc[idx]
            out = []
            used_labels = set()

            sku_src = next((m["src"] for m in mapped_fields if m["key"] == required_key), None)
            sku_val = ""
            if sku_src:
                col = get_col(df, sku_src)
                if col is not None:
                    sku_val = (col.iloc[idx] or "").strip()
            if not sku_val and required_key in drop_if_blank:
                continue

            for f in tpl["fields"]:
                lbl = f["label"]
                if lbl in used_labels:
                    continue
                k = f["key"]

                m = next((mm for mm in mapped_fields if mm["key"] == k), None)
                if m:
                    src = m["src"]
                    col = get_col(df, src)
                    if col is not None and src in VARIANT_LEVEL_SHOPIFY_HEADERS:
                        val = (col.iloc[idx] or "").strip()
                    else:
                        val = product_values.get(h, {}).get(k) or ((col.iloc[idx] if col is not None else ""))
                    out.append(val)
                    used_labels.add(lbl)
                    continue

                ai = next(((ak, pos, lab) for (ak, pos, lab) in auto_image_fields if ak == k), None)
                if ai and lbl not in used_labels:
                    pos = ai[1]
                    url = images.get(h, {}).get(pos, "")
                    out.append(url)
                    used_labels.add(lbl)
                    continue

            yield out

    # --- Preview mode fix ---
    if preview.lower() == "true":
        all_rows = list(rows_iter())
        total_rows = len(all_rows)
        preview_rows = all_rows[:10]
        return {
            "headers": headers,
            "rows": preview_rows,
            "totalRows": total_rows,
            "templateKey": templateKey
        }

    resp = stream_csv(headers, rows_iter())
    resp.headers["Content-Disposition"] = f'attachment; filename="{filename or "zilo_export.csv"}"'
    return resp
