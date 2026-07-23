#!/usr/bin/env python3
"""
Fetch Saudi Arabia beef imports (HS 0201 + 0202) and merge with UAE data.
Updates UAE_Beef_Imports_Analysis.xlsx with Saudi sheets + combined analysis.
Run via: conda run python fetch_saudi_beef_imports.py
"""

import urllib.request
import urllib.error
import json
import time
import sys
import os

import pandas as pd
import numpy as np

# ── Auth (refreshed 2026-07-01) ───────────────────────────────────────────────
COOKIE = (
    "locale=en; userId=50019; "
    "user=%7B%22userId%22%3A50019%7D; "
    "tradeDate=2025-06-18|2026-06-17; "
    "refresh_token=epVXOSCaV6lppgAm8ir_zy9QKBZPpq5q4MazhkeG8w6JIOuGUllitqs7knmJe9AAt0R1dpoZjcftyGL72jRRJMXyJ-5yUcqE5h6Y8k8U-VKf6_pFK4Bm2f-7PrZ1JCFL; "
    "token=70b1f633-f969-4e98-a4c3-cec2e729b5d5; "
    "tokenUpdateTimestamp=2026-07-01T14:03:10.705Z"
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

SEARCH_URL  = "https://data.tendata.cn/api/tradec1/v2/search"
PAGE_SIZE   = 100
START_DATE  = "2025-06-18"
END_DATE    = "2026-06-17"
OUT_DIR     = os.path.dirname(os.path.abspath(__file__))
UAE_CSV     = os.path.join(OUT_DIR, "UAE_Beef_Imports_Raw.csv")
SAU_CSV     = os.path.join(OUT_DIR, "SAU_Beef_Imports_Raw.csv")
EXCEL_OUT   = os.path.join(OUT_DIR, "Beef_Imports_UAE_Saudi_Analysis.xlsx")

SAU_BATCHES = [
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

def build_payload(country: str, hs: str, start: str, end: str, page: int) -> bytes:
    return json.dumps({
        "country": country,
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
        "sessionId": f"{country}@{int(time.time()*1000)}|{country}$imports",
    }).encode("utf-8")


def post(country: str, hs: str, start: str, end: str, page: int, retries: int = 4) -> dict:
    req = urllib.request.Request(
        SEARCH_URL,
        data=build_payload(country, hs, start, end, page),
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


def fetch_batches(country: str, batches: list) -> pd.DataFrame:
    all_records = []
    seen_ids    = set()
    for i, (hs, start, end) in enumerate(batches, 1):
        print(f"  Batch {i}/{len(batches)}: HS {hs}  {start}→{end}", end="  ", flush=True)
        r1 = post(country, hs, start, end, page=1)
        results     = r1.get("results", {})
        total       = results.get("totalElements", 0)
        total_pages = results.get("totalPages", 1)
        content     = results.get("content", [])
        print(f"total={total:,}  pages={total_pages}")

        records = [flatten(r) for r in content]
        for page in range(2, total_pages + 1):
            try:
                resp  = post(country, hs, start, end, page)
                batch = resp.get("results", {}).get("content", [])
                if not batch:
                    break
                records.extend(flatten(r) for r in batch)
            except Exception as exc:
                print(f"    Page {page} failed ({exc}) — keeping {len(records)} records.")
                break
            time.sleep(0.3)

        for rec in records:
            rid = rec.get("id")
            if rid and rid in seen_ids:
                continue
            if rid:
                seen_ids.add(rid)
            all_records.append(rec)

        print(f"    → {len(all_records):,} unique records so far")

    return pd.DataFrame(all_records)


# ── Per-country analysis sheets ───────────────────────────────────────────────

def clean_df(df: pd.DataFrame, country_label: str) -> pd.DataFrame:
    df = df.copy()
    df["_country"] = country_label
    if "date" in df.columns:
        df["date"] = (
            pd.to_datetime(df["date"], errors="coerce", utc=True)
            .dt.tz_localize(None)
        )
    for col in ["weight", "qty", "sumOfUSD", "weightUnitPrice", "qtyUnitPrice"]:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")
    if "hsCode" in df.columns:
        df["hs4"] = df["hsCode"].astype(str).str[:4]
        df["hs6"] = df["hsCode"].astype(str).str[:6]
    return df


def top_importers(df: pd.DataFrame) -> pd.DataFrame:
    usd = "sumOfUSD"
    kg  = "weight"
    imp = "importer"
    grp = (
        df.groupby(imp, dropna=False)
        .agg(
            Shipments      = (usd, "count"),
            Total_USD      = (usd, "sum"),
            Total_KG       = (kg,  "sum"),
            First_Shipment = ("date", "min"),
            Last_Shipment  = ("date", "max"),
        )
        .reset_index()
        .sort_values("Total_USD", ascending=False)
    )
    grp["Avg_USD_per_KG"] = (grp["Total_USD"] / grp["Total_KG"]).round(4)
    grp["Market_Share_%"] = (grp["Total_USD"] / grp["Total_USD"].sum() * 100).round(2)
    grp["Cumulative_%"]   = grp["Market_Share_%"].cumsum().round(2)
    return grp


def by_origin(df: pd.DataFrame) -> pd.DataFrame:
    usd = "sumOfUSD"; kg = "weight"; org = "countryOfOrigin"
    grp = (
        df.groupby(org, dropna=False)
        .agg(Shipments=(usd,"count"), Total_USD=(usd,"sum"), Total_KG=(kg,"sum"))
        .reset_index()
        .sort_values("Total_USD", ascending=False)
    )
    grp["Share_%"] = (grp["Total_USD"] / grp["Total_USD"].sum() * 100).round(2)
    return grp


def monthly_trend(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df["year_month"] = df["date"].dt.to_period("M").astype(str)
    return (
        df.groupby("year_month")
        .agg(Shipments=("sumOfUSD","count"), Total_USD=("sumOfUSD","sum"), Total_KG=("weight","sum"))
        .reset_index()
        .sort_values("year_month")
    )


def by_hs(df: pd.DataFrame, level: str = "hs4") -> pd.DataFrame:
    return (
        df.groupby(level, dropna=False)
        .agg(Shipments=("sumOfUSD","count"), Total_USD=("sumOfUSD","sum"), Total_KG=("weight","sum"))
        .reset_index()
        .sort_values("Total_USD", ascending=False)
    )


def by_exporter(df: pd.DataFrame) -> pd.DataFrame:
    return (
        df.groupby("exporter", dropna=False)
        .agg(Shipments=("sumOfUSD","count"), Total_USD=("sumOfUSD","sum"), Total_KG=("weight","sum"))
        .reset_index()
        .sort_values("Total_USD", ascending=False)
    )


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    # ── Load UAE data ─────────────────────────────────────────────────────────
    print("Loading existing UAE data …")
    uae_df = pd.read_csv(UAE_CSV)
    uae_df  = clean_df(uae_df, "UAE")
    print(f"  UAE: {len(uae_df):,} records\n")

    # ── Fetch Saudi data ──────────────────────────────────────────────────────
    print("=" * 55)
    print("  Fetching Saudi Arabia (saudi_arabia_mir) …")
    print("=" * 55)
    sau_df = fetch_batches("saudi_arabia_mir", SAU_BATCHES)
    sau_df = clean_df(sau_df, "Saudi Arabia")
    sau_df.to_csv(SAU_CSV, index=False, encoding="utf-8-sig")
    print(f"\nSaudi raw CSV saved → {SAU_CSV}")
    print(f"Saudi records: {len(sau_df):,}  |  columns: {len(sau_df.columns)}\n")

    # ── Combined ──────────────────────────────────────────────────────────────
    combined = pd.concat([uae_df, sau_df], ignore_index=True)
    print(f"Combined total: {len(combined):,} records\n")

    # ── Build Excel ───────────────────────────────────────────────────────────
    print(f"Building Excel → {EXCEL_OUT}")
    writer = pd.ExcelWriter(EXCEL_OUT, engine="openpyxl")

    # UAE sheets
    uae_df.to_excel(writer, sheet_name="UAE — Raw Data",        index=False)
    top_importers(uae_df).to_excel(writer, sheet_name="UAE — Top Importers",   index=False)
    by_origin(uae_df).to_excel(writer, sheet_name="UAE — By Origin Country",   index=False)
    by_hs(uae_df, "hs4").to_excel(writer, sheet_name="UAE — By HS4",           index=False)
    monthly_trend(uae_df).to_excel(writer, sheet_name="UAE — Monthly Trend",   index=False)
    by_exporter(uae_df).to_excel(writer, sheet_name="UAE — By Exporter",       index=False)

    # Saudi sheets
    sau_df.to_excel(writer, sheet_name="SAU — Raw Data",        index=False)
    top_importers(sau_df).to_excel(writer, sheet_name="SAU — Top Importers",   index=False)
    by_origin(sau_df).to_excel(writer, sheet_name="SAU — By Origin Country",   index=False)
    by_hs(sau_df, "hs4").to_excel(writer, sheet_name="SAU — By HS4",           index=False)
    monthly_trend(sau_df).to_excel(writer, sheet_name="SAU — Monthly Trend",   index=False)
    by_exporter(sau_df).to_excel(writer, sheet_name="SAU — By Exporter",       index=False)

    # Combined sheets
    combined.to_excel(writer, sheet_name="ALL — Raw Data", index=False)

    # Combined top importers (with country label)
    comb_imp = (
        combined.groupby(["_country", "importer"], dropna=False)
        .agg(
            Shipments      = ("sumOfUSD", "count"),
            Total_USD      = ("sumOfUSD", "sum"),
            Total_KG       = ("weight",   "sum"),
            First_Shipment = ("date",     "min"),
            Last_Shipment  = ("date",     "max"),
        )
        .reset_index()
        .sort_values(["_country", "Total_USD"], ascending=[True, False])
    )
    comb_imp["Avg_USD_per_KG"] = (comb_imp["Total_USD"] / comb_imp["Total_KG"]).round(4)
    comb_imp.to_excel(writer, sheet_name="ALL — Top Importers by Country", index=False)

    # Combined monthly trend with country breakdown
    combined["year_month"] = combined["date"].dt.to_period("M").astype(str)
    comb_monthly = (
        combined.groupby(["year_month", "_country"])
        .agg(Shipments=("sumOfUSD","count"), Total_USD=("sumOfUSD","sum"), Total_KG=("weight","sum"))
        .reset_index()
        .sort_values(["year_month", "_country"])
    )
    comb_monthly.to_excel(writer, sheet_name="ALL — Monthly Trend", index=False)

    # Combined by origin
    comb_org = (
        combined.groupby(["_country", "countryOfOrigin"], dropna=False)
        .agg(Shipments=("sumOfUSD","count"), Total_USD=("sumOfUSD","sum"), Total_KG=("weight","sum"))
        .reset_index()
        .sort_values(["_country", "Total_USD"], ascending=[True, False])
    )
    comb_org.to_excel(writer, sheet_name="ALL — By Origin Country", index=False)

    writer.close()
    print(f"\nDone! → {EXCEL_OUT}")

    # Summary printout
    for label, df in [("UAE", uae_df), ("Saudi Arabia", sau_df)]:
        print(f"\nTop 10 — {label}:")
        t = top_importers(df).head(10)
        print(t[["importer","Total_USD","Total_KG","Shipments","Market_Share_%"]].to_string(index=False))


if __name__ == "__main__":
    main()
