#!/usr/bin/env python3
"""
Fetch UAE + Saudi Arabia beef imports (HS 0201 + 0202)
Period: 2025-07-01 → 2026-07-01
Batches by HS x sub-period to stay under the 5,000-record API cap.
Run via: conda run python fetch_beef_imports_v2.py
"""

import urllib.request, urllib.error, json, time, sys, os
import pandas as pd

# ── Auth ──────────────────────────────────────────────────────────────────────
COOKIE = (
    "locale=en; userId=50019; "
    "user=%7B%22userId%22%3A50019%7D; "
    "tradeDate=2025-07-01|2026-07-01; "
    "refresh_token=epVXOSCaV6lppgAm8ir_zy9QKBZPpq5q4MazhkeG8w6JIOuGUllitqs7knmJe9AAt0R1dpoZjcftyGL72jRRJMXyJ-5yUcqE5h6Y8k8U-VKf6_pFK4Bm2f-7PrZ1JCFL; "
    "token=70b1f633-f969-4e98-a4c3-cec2e729b5d5; "
    "tokenUpdateTimestamp=2026-07-01T14:03:10.705Z"
)
HEADERS = {
    "accept": "application/json, text/plain, */*",
    "content-type": "application/json",
    "cookie": COOKIE,
    "origin": "https://data.tendata.cn",
    "referer": "https://data.tendata.cn/trade",
    "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
}

SEARCH_URL = "https://data.tendata.cn/api/tradec1/v2/search"
PAGE_SIZE  = 100
OUT_DIR    = os.path.dirname(os.path.abspath(__file__))
EXCEL_OUT  = os.path.join(OUT_DIR, "Beef_Imports_UAE_Saudi_Analysis.xlsx")

# UAE: Oct-Dec 0201 split monthly due to >5k records
UAE_BATCHES = [
    ("united_arab_emirates_mir", "0201", "2025-07-01", "2025-09-30"),
    ("united_arab_emirates_mir", "0201", "2025-10-01", "2025-10-31"),  # split
    ("united_arab_emirates_mir", "0201", "2025-11-01", "2025-11-30"),  # split
    ("united_arab_emirates_mir", "0201", "2025-12-01", "2025-12-31"),  # split
    ("united_arab_emirates_mir", "0201", "2026-01-01", "2026-03-31"),
    ("united_arab_emirates_mir", "0201", "2026-04-01", "2026-07-01"),
    ("united_arab_emirates_mir", "0202", "2025-07-01", "2025-09-30"),
    ("united_arab_emirates_mir", "0202", "2025-10-01", "2025-12-31"),
    ("united_arab_emirates_mir", "0202", "2026-01-01", "2026-03-31"),
    ("united_arab_emirates_mir", "0202", "2026-04-01", "2026-07-01"),
]

SAU_BATCHES = [
    ("saudi_arabia_mir", "0201", "2025-07-01", "2025-09-30"),
    ("saudi_arabia_mir", "0201", "2025-10-01", "2025-12-31"),
    ("saudi_arabia_mir", "0201", "2026-01-01", "2026-03-31"),
    ("saudi_arabia_mir", "0201", "2026-04-01", "2026-07-01"),
    ("saudi_arabia_mir", "0202", "2025-07-01", "2025-09-30"),
    ("saudi_arabia_mir", "0202", "2025-10-01", "2025-12-31"),
    ("saudi_arabia_mir", "0202", "2026-01-01", "2026-03-31"),
    ("saudi_arabia_mir", "0202", "2026-04-01", "2026-07-01"),
]


# ── API ───────────────────────────────────────────────────────────────────────

def post(country, hs, start, end, page, retries=4):
    sid = f"{country}@{int(time.time()*1000)}|{country}$imports"
    payload = json.dumps({
        "country": country, "catalog": "imports",
        "conditions": {}, "rangeConditions": {}, "active": True,
        "conditionGroups": [{"conditions": [{"param": "hs_code", "character": "", "value": [hs]}]}],
        "startDate": start, "endDate": end,
        "filterBlankFields": [], "filterLogisticFields": [],
        "filterRepetitive": False, "highlights": ["hs_code"],
        "level": "LOW", "onlyRepetitive": False,
        "page": page, "size": PAGE_SIZE, "sessionId": sid,
    }).encode()
    req = urllib.request.Request(SEARCH_URL, data=payload, headers=HEADERS, method="POST")
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read().decode())
        except urllib.error.HTTPError as e:
            body = e.read().decode(errors="replace")
            print(f"  HTTP {e.code} (attempt {attempt+1}): {body[:150]}")
            if e.code in (401, 403):
                print("  Session expired — update COOKIE and retry.")
                sys.exit(1)
            if attempt == retries - 1:
                raise
        except Exception as exc:
            print(f"  Error (attempt {attempt+1}): {exc}")
            if attempt == retries - 1:
                raise
        time.sleep(2 ** attempt)


def flatten(rec):
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


def fetch(batches, label):
    print(f"\n{'='*55}")
    print(f"  {label}")
    print(f"{'='*55}")
    all_records = []
    seen_ids    = set()
    for i, (country, hs, start, end) in enumerate(batches, 1):
        print(f"  Batch {i}/{len(batches)}: HS{hs}  {start}→{end}", end="  ", flush=True)
        r1    = post(country, hs, start, end, 1)
        res   = r1.get("results", {})
        total = res.get("totalElements", 0)
        pages = res.get("totalPages", 1)
        print(f"total={total:,}  pages={pages}")
        records = [flatten(r) for r in res.get("content", [])]
        for page in range(2, pages + 1):
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


# ── Analysis helpers ──────────────────────────────────────────────────────────

def clean(df, country_label):
    df = df.copy()
    df["_country"] = country_label
    if "date" in df.columns:
        df["date"] = pd.to_datetime(df["date"], errors="coerce", utc=True).dt.tz_localize(None)
    for col in ["weight", "qty", "sumOfUSD", "weightUnitPrice", "qtyUnitPrice"]:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")
    if "hsCode" in df.columns:
        df["hs4"] = df["hsCode"].astype(str).str[:4]
        df["hs6"] = df["hsCode"].astype(str).str[:6]
    return df


def top_imp(df):
    g = (
        df.groupby("importer", dropna=False)
        .agg(Shipments=("sumOfUSD","count"), Total_USD=("sumOfUSD","sum"),
             Total_KG=("weight","sum"), First_Shipment=("date","min"), Last_Shipment=("date","max"))
        .reset_index().sort_values("Total_USD", ascending=False)
    )
    g["Avg_USD_per_KG"]   = (g["Total_USD"] / g["Total_KG"]).round(4)
    g["Market_Share_%"]   = (g["Total_USD"] / g["Total_USD"].sum() * 100).round(2)
    g["Cumulative_%"]     = g["Market_Share_%"].cumsum().round(2)
    return g


def by_origin(df):
    g = (
        df.groupby("countryOfOrigin", dropna=False)
        .agg(Shipments=("sumOfUSD","count"), Total_USD=("sumOfUSD","sum"), Total_KG=("weight","sum"))
        .reset_index().sort_values("Total_USD", ascending=False)
    )
    g["Share_%"] = (g["Total_USD"] / g["Total_USD"].sum() * 100).round(2)
    return g


def monthly(df):
    d = df.copy()
    d["year_month"] = d["date"].dt.to_period("M").astype(str)
    return (
        d.groupby("year_month")
        .agg(Shipments=("sumOfUSD","count"), Total_USD=("sumOfUSD","sum"), Total_KG=("weight","sum"))
        .reset_index().sort_values("year_month")
    )


def by_hs(df, level="hs4"):
    return (
        df.groupby(level, dropna=False)
        .agg(Shipments=("sumOfUSD","count"), Total_USD=("sumOfUSD","sum"), Total_KG=("weight","sum"))
        .reset_index().sort_values("Total_USD", ascending=False)
    )


def by_exp(df):
    return (
        df.groupby("exporter", dropna=False)
        .agg(Shipments=("sumOfUSD","count"), Total_USD=("sumOfUSD","sum"), Total_KG=("weight","sum"))
        .reset_index().sort_values("Total_USD", ascending=False)
    )


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    uae_raw = fetch(UAE_BATCHES, "UAE (united_arab_emirates_mir) — 2025-07-01 → 2026-07-01")
    sau_raw = fetch(SAU_BATCHES, "Saudi Arabia (saudi_arabia_mir) — 2025-07-01 → 2026-07-01")

    uae_raw.to_csv(os.path.join(OUT_DIR, "UAE_Beef_Imports_Raw.csv"),  index=False, encoding="utf-8-sig")
    sau_raw.to_csv(os.path.join(OUT_DIR, "SAU_Beef_Imports_Raw.csv"),  index=False, encoding="utf-8-sig")

    uae = clean(uae_raw, "UAE")
    sau = clean(sau_raw, "Saudi Arabia")
    all_df = pd.concat([uae, sau], ignore_index=True)

    print(f"\nUAE records    : {len(uae):,}")
    print(f"Saudi records  : {len(sau):,}")
    print(f"Combined total : {len(all_df):,}")
    print(f"\nBuilding Excel → {EXCEL_OUT}")

    writer = pd.ExcelWriter(EXCEL_OUT, engine="openpyxl")

    # ── UAE sheets ────────────────────────────────────────────────────────────
    uae.to_excel(writer,          sheet_name="UAE — Raw Data",          index=False)
    top_imp(uae).to_excel(writer, sheet_name="UAE — Top Importers",     index=False)
    by_origin(uae).to_excel(writer, sheet_name="UAE — By Origin",       index=False)
    by_hs(uae).to_excel(writer,   sheet_name="UAE — By HS4",            index=False)
    by_hs(uae,"hs6").to_excel(writer, sheet_name="UAE — By HS6",        index=False)
    monthly(uae).to_excel(writer, sheet_name="UAE — Monthly Trend",     index=False)
    by_exp(uae).to_excel(writer,  sheet_name="UAE — By Exporter",       index=False)

    # ── Saudi sheets ──────────────────────────────────────────────────────────
    sau.to_excel(writer,          sheet_name="SAU — Raw Data",          index=False)
    top_imp(sau).to_excel(writer, sheet_name="SAU — Top Importers",     index=False)
    by_origin(sau).to_excel(writer, sheet_name="SAU — By Origin",       index=False)
    by_hs(sau).to_excel(writer,   sheet_name="SAU — By HS4",            index=False)
    by_hs(sau,"hs6").to_excel(writer, sheet_name="SAU — By HS6",        index=False)
    monthly(sau).to_excel(writer, sheet_name="SAU — Monthly Trend",     index=False)
    by_exp(sau).to_excel(writer,  sheet_name="SAU — By Exporter",       index=False)

    # ── Combined sheets ───────────────────────────────────────────────────────
    all_df.to_excel(writer, sheet_name="ALL — Raw Data", index=False)

    # Combined top importers per country
    comb_imp = (
        all_df.groupby(["_country", "importer"], dropna=False)
        .agg(Shipments=("sumOfUSD","count"), Total_USD=("sumOfUSD","sum"),
             Total_KG=("weight","sum"), First_Shipment=("date","min"), Last_Shipment=("date","max"))
        .reset_index().sort_values(["_country","Total_USD"], ascending=[True,False])
    )
    comb_imp["Avg_USD_per_KG"] = (comb_imp["Total_USD"] / comb_imp["Total_KG"]).round(4)
    comb_imp.to_excel(writer, sheet_name="ALL — Top Importers", index=False)

    # Combined monthly
    all_df["year_month"] = all_df["date"].dt.to_period("M").astype(str)
    (
        all_df.groupby(["year_month","_country"])
        .agg(Shipments=("sumOfUSD","count"), Total_USD=("sumOfUSD","sum"), Total_KG=("weight","sum"))
        .reset_index().sort_values(["year_month","_country"])
    ).to_excel(writer, sheet_name="ALL — Monthly Trend", index=False)

    # Combined by origin
    (
        all_df.groupby(["_country","countryOfOrigin"], dropna=False)
        .agg(Shipments=("sumOfUSD","count"), Total_USD=("sumOfUSD","sum"), Total_KG=("weight","sum"))
        .reset_index().sort_values(["_country","Total_USD"], ascending=[True,False])
    ).to_excel(writer, sheet_name="ALL — By Origin", index=False)

    writer.close()
    print(f"Done! → {EXCEL_OUT}")

    for label, df in [("UAE", uae), ("Saudi Arabia", sau)]:
        print(f"\nTop 10 — {label}:")
        t = top_imp(df).head(10)
        print(t[["importer","Total_USD","Total_KG","Shipments","Market_Share_%"]].to_string(index=False))


if __name__ == "__main__":
    main()
