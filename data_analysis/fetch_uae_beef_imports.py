#!/usr/bin/env python3
"""
Fetch ALL UAE beef imports (HS 0201 + 0202) from Tendata API.
Batches by HS code x quarterly date range to stay under the 5,000-record API cap.
Run via: conda run python fetch_uae_beef_imports.py
"""

import urllib.request
import urllib.error
import json
import time
import sys
import os

import pandas as pd
import numpy as np

# ── Auth ──────────────────────────────────────────────────────────────────────
COOKIE = (
    "locale=en; userId=50019; "
    "refresh_token=fhdYofoScAu_b01w6mCToNbRNQDN1MALW9UzViQq2w_2rH9Mj0pCC92bR8Q0CaGxeIaIHV_Hfsv_CMGlb8cXf97gduvsUhAM01XTIOovT-dLC2URaUme__wnY45gE4QG; "
    "token=9980b5a4-0a83-4bcf-930f-ba4caa88dddb; "
    "tokenUpdateTimestamp=2026-07-01T10:50:16.560Z; "
    "tradeDate=2025-06-18|2026-06-17"
)

HEADERS = {
    "accept": "application/json, text/plain, */*",
    "accept-language": "en,en-GB;q=0.9,en-US;q=0.8",
    "content-type": "application/json",
    "cookie": COOKIE,
    "origin": "https://data.tendata.cn",
    "referer": "https://data.tendata.cn/trade",
    "user-agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36"
    ),
}

SEARCH_URL = "https://data.tendata.cn/api/tradec1/v2/search"
PAGE_SIZE  = 100
OUT_DIR    = os.path.dirname(os.path.abspath(__file__))
RAW_CSV    = os.path.join(OUT_DIR, "UAE_Beef_Imports_Raw.csv")
EXCEL_OUT  = os.path.join(OUT_DIR, "UAE_Beef_Imports_Analysis.xlsx")

# 8 slices: 2 HS codes × 4 quarters — all confirmed < 5,000 records each
BATCHES = [
    ("0201", "2025-06-18", "2025-09-17"),
    ("0201", "2025-09-18", "2025-12-17"),
    ("0201", "2025-12-18", "2026-03-17"),
    ("0201", "2026-03-18", "2026-06-17"),
    ("0202", "2025-06-18", "2025-09-17"),
    ("0202", "2025-09-18", "2025-12-17"),
    ("0202", "2025-12-18", "2026-03-17"),
    ("0202", "2026-03-18", "2026-06-17"),
]


# ── Helpers ───────────────────────────────────────────────────────────────────

def build_payload(hs: str, start: str, end: str, page: int) -> bytes:
    payload = {
        "country": "united_arab_emirates_mir",
        "catalog": "imports",
        "conditions": {},
        "rangeConditions": {},
        "active": True,
        "conditionGroups": [
            {"conditions": [{"param": "hs_code", "character": "", "value": [hs]}]}
        ],
        "startDate": start,
        "endDate": end,
        "filterBlankFields": [],
        "filterLogisticFields": [],
        "filterRepetitive": False,
        "highlights": ["hs_code"],
        "level": "LOW",
        "onlyRepetitive": False,
        "page": page,
        "size": PAGE_SIZE,
        "sessionId": f"united_arab_emirates@{int(time.time()*1000)}|united_arab_emirates_mir$imports",
    }
    return json.dumps(payload).encode("utf-8")


def post(hs: str, start: str, end: str, page: int, retries: int = 4) -> dict:
    req = urllib.request.Request(
        SEARCH_URL,
        data=build_payload(hs, start, end, page),
        headers=HEADERS,
        method="POST",
    )
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", errors="replace")
            print(f"  HTTP {e.code} (attempt {attempt+1}): {body[:200]}")
            if e.code in (401, 403):
                print("  Session expired. Exiting.")
                sys.exit(1)
            if attempt == retries - 1:
                raise
        except Exception as exc:
            print(f"  Error (attempt {attempt+1}): {exc}")
            if attempt == retries - 1:
                raise
        time.sleep(2 ** attempt)


def flatten(rec: dict) -> dict:
    flat = {}
    for k, v in rec.items():
        if isinstance(v, list):
            flat[k] = "; ".join(str(i) for i in v)
        elif isinstance(v, dict):
            for sk, sv in v.items():
                flat[f"{k}.{sk}"] = sv
        else:
            flat[k] = v
    return flat


# ── Fetch ─────────────────────────────────────────────────────────────────────

def fetch_batch(hs: str, start: str, end: str) -> list[dict]:
    r1 = post(hs, start, end, page=1)
    results = r1.get("results", {})
    total_pages = results.get("totalPages", 1)
    total       = results.get("totalElements", 0)
    content     = results.get("content", [])
    print(f"  HS {hs}  {start}→{end}  total={total:,}  pages={total_pages}")

    records = [flatten(r) for r in content]
    for page in range(2, total_pages + 1):
        try:
            resp  = post(hs, start, end, page)
            batch = resp.get("results", {}).get("content", [])
            if not batch:
                break
            records.extend(flatten(r) for r in batch)
        except Exception as exc:
            print(f"  Page {page} failed ({exc}) — keeping {len(records)} records from this batch.")
            break
        time.sleep(0.3)
    return records


# ── Analysis ──────────────────────────────────────────────────────────────────

def analyse(df: pd.DataFrame) -> None:
    # ── Clean types ───────────────────────────────────────────────────────────
    if "date" in df.columns:
        df["date"] = (
            pd.to_datetime(df["date"], errors="coerce", utc=True)
            .dt.tz_localize(None)   # strip tz for Excel compatibility
        )

    numeric_cols = ["weight", "qty", "sumOfUSD", "weightUnitPrice", "qtyUnitPrice"]
    for col in numeric_cols:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")

    if "hsCode" in df.columns:
        df["hs4"] = df["hsCode"].astype(str).str[:4]
        df["hs6"] = df["hsCode"].astype(str).str[:6]

    usd_col = "sumOfUSD" if "sumOfUSD" in df.columns else None
    kg_col  = "weight"   if "weight"   in df.columns else None
    imp_col = "importer" if "importer" in df.columns else None
    exp_col = "exporter" if "exporter" in df.columns else None
    org_col = "countryOfOrigin" if "countryOfOrigin" in df.columns else None

    print(f"\nBuilding Excel with {len(df):,} records …")
    writer = pd.ExcelWriter(EXCEL_OUT, engine="openpyxl")

    # Sheet 1 — Raw data
    df.to_excel(writer, sheet_name="Raw Data", index=False)

    # Sheet 2 — Top Importers
    if imp_col and usd_col and kg_col:
        grp = df.groupby(imp_col, dropna=False)
        top = (
            grp.agg(
                Shipments       = (usd_col, "count"),
                Total_USD       = (usd_col, "sum"),
                Total_KG        = (kg_col,  "sum"),
                First_Shipment  = ("date",  "min"),
                Last_Shipment   = ("date",  "max"),
            )
            .reset_index()
            .sort_values("Total_USD", ascending=False)
        )
        top["Avg_USD_per_KG"] = (top["Total_USD"] / top["Total_KG"]).round(4)
        top["Market_Share_%"] = (top["Total_USD"] / top["Total_USD"].sum() * 100).round(2)
        top["Cumulative_%"]   = top["Market_Share_%"].cumsum().round(2)
        top.to_excel(writer, sheet_name="Top Importers", index=False)

        print("\nTop 15 UAE Beef Importers:")
        print(top.head(15)[["importer", "Total_USD", "Total_KG", "Shipments", "Market_Share_%"]].to_string(index=False))

    # Sheet 3 — By Origin Country
    if org_col and usd_col and kg_col:
        by_org = (
            df.groupby(org_col, dropna=False)
            .agg(Shipments=(usd_col,"count"), Total_USD=(usd_col,"sum"), Total_KG=(kg_col,"sum"))
            .reset_index()
            .sort_values("Total_USD", ascending=False)
        )
        by_org["Share_%"] = (by_org["Total_USD"] / by_org["Total_USD"].sum() * 100).round(2)
        by_org.to_excel(writer, sheet_name="By Origin Country", index=False)

    # Sheet 4 — By HS Code (4+6 digit)
    if "hs4" in df.columns and usd_col and kg_col:
        for level in ("hs4", "hs6"):
            by_hs = (
                df.groupby(level, dropna=False)
                .agg(Shipments=(usd_col,"count"), Total_USD=(usd_col,"sum"), Total_KG=(kg_col,"sum"))
                .reset_index()
                .sort_values("Total_USD", ascending=False)
            )
            by_hs.to_excel(writer, sheet_name=f"By {level.upper()}", index=False)

    # Sheet 5 — Monthly Trend
    if "date" in df.columns and usd_col and kg_col:
        df["year_month"] = df["date"].dt.to_period("M").astype(str)
        monthly = (
            df.groupby("year_month")
            .agg(Shipments=(usd_col,"count"), Total_USD=(usd_col,"sum"), Total_KG=(kg_col,"sum"))
            .reset_index()
            .sort_values("year_month")
        )
        monthly.to_excel(writer, sheet_name="Monthly Trend", index=False)

    # Sheet 6 — By Exporter
    if exp_col and usd_col and kg_col:
        by_exp = (
            df.groupby(exp_col, dropna=False)
            .agg(Shipments=(usd_col,"count"), Total_USD=(usd_col,"sum"), Total_KG=(kg_col,"sum"))
            .reset_index()
            .sort_values("Total_USD", ascending=False)
        )
        by_exp.to_excel(writer, sheet_name="By Exporter", index=False)

    # Sheet 7 — Importer × Origin pivot
    if imp_col and org_col and usd_col:
        pivot = (
            df.groupby([imp_col, org_col])[usd_col]
            .sum()
            .unstack(fill_value=0)
            .sort_values(by=df[org_col].value_counts().index[0], ascending=False)
        )
        pivot.to_excel(writer, sheet_name="Importer x Origin Pivot")

    # Sheet 8 — Importer × HS4 pivot
    if imp_col and "hs4" in df.columns and usd_col:
        pivot2 = (
            df.groupby([imp_col, "hs4"])[usd_col]
            .sum()
            .unstack(fill_value=0)
            .sort_values(by=df["hs4"].value_counts().index[0], ascending=False)
        )
        pivot2.to_excel(writer, sheet_name="Importer x HS4 Pivot")

    writer.close()
    print(f"\nExcel saved → {EXCEL_OUT}")


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    print("=" * 60)
    print("  Tendata — UAE Beef Imports (HS 0201 + 0202)")
    print("  Period: 2025-06-18 → 2026-06-17  |  8 batches")
    print("=" * 60 + "\n")

    all_records = []
    seen_ids    = set()

    for i, (hs, start, end) in enumerate(BATCHES, 1):
        print(f"Batch {i}/{len(BATCHES)} …")
        batch = fetch_batch(hs, start, end)
        # Deduplicate on 'id' field if present
        for rec in batch:
            rid = rec.get("id")
            if rid and rid in seen_ids:
                continue
            if rid:
                seen_ids.add(rid)
            all_records.append(rec)
        print(f"  → {len(all_records):,} unique records so far\n")

    df = pd.DataFrame(all_records)
    print(f"Total unique records : {len(df):,}")
    print(f"Columns              : {len(df.columns)}")
    print(f"Columns: {list(df.columns)}\n")

    df.to_csv(RAW_CSV, index=False, encoding="utf-8-sig")
    print(f"Raw CSV saved → {RAW_CSV}")

    analyse(df)


if __name__ == "__main__":
    main()
