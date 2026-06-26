"""
TenData Pakistan Beef Export Scraper
Pulls all YTD (2026-01-01 → 2026-05-31) export records for HS 0201, 0202, 0206
then runs the full pricing benchmark analysis and saves to Excel.
"""

import requests
import pandas as pd
import warnings
import time
import json
import os
warnings.filterwarnings('ignore')

# ── Config ──────────────────────────────────────────────────────────────────
URL        = "https://data.tendata.cn/api/tradec1/v2/search"
START_DATE = "2026-01-01"
END_DATE   = "2026-05-31"
HS_CODES   = ["0201", "0202", "0206"]
PAGE_SIZE  = 100   # max to minimise API calls
DELAY_S    = 0.8   # polite pause between pages
OUT_DIR    = os.path.dirname(os.path.abspath(__file__))

COOKIES = {
    "locale":               "en",
    "userId":               "50019",
    "tradeDate":            "2025-06-01|2026-05-31",
    "refresh_token":        "YdYjssUXTjVXDwk0w7Jo5wpG6xWZw3UpYeeA0rUyO2uAxBTisE4wl2gVCq_GMGE9xoHWzTHMfyrgK8602mDWtI2iCTxRprU54wG8SX5a84Kfx5ERUIx6hSvSBz4BSX3P",
    "token":                "5a978630-c8db-4561-abd4-c7014d62d474",
    "tokenUpdateTimestamp": "2026-06-24T21:06:11.561Z",
}

HEADERS = {
    "accept":           "application/json, text/plain, */*",
    "accept-language":  "en,en-GB;q=0.9,en-US;q=0.8",
    "content-type":     "application/json",
    "origin":           "https://data.tendata.cn",
    "referer":          "https://data.tendata.cn/trade",
    "user-agent":       "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
}

BASE_PAYLOAD = {
    "active":              True,
    "catalog":             "exports",
    "country":             "pakistan",
    "conditions":          {},
    "rangeConditions":     {},
    "conditionGroups":     [{"conditions": [{"param": "hs_code", "character": "", "value": HS_CODES}]}],
    "filterBlankFields":   [],
    "filterLogisticFields":[],
    "filterRepetitive":    False,
    "onlyRepetitive":      False,
    "highlights":          ["hs_code"],
    "level":               "LOW",
    "startDate":           START_DATE,
    "endDate":             END_DATE,
    "sessionId":           "pakistan@1782330734025|pakistan$exports",
    "size":                PAGE_SIZE,
}

# ── Scraper ──────────────────────────────────────────────────────────────────
def fetch_page(page: int) -> dict:
    payload = {**BASE_PAYLOAD, "page": page}
    r = requests.post(URL, headers=HEADERS, cookies=COOKIES, json=payload, timeout=30)
    r.raise_for_status()
    return r.json()

def scrape_all() -> list[dict]:
    print("Fetching page 1 to get total count...")
    data = fetch_page(1)

    # TenData wraps results — try common response shapes
    body    = data.get("data") or data.get("result") or data
    records = body.get("list") or body.get("data") or body.get("records") or []
    total   = body.get("total") or body.get("totalCount") or body.get("count") or 0

    print(f"Total records reported: {total:,}")
    print(f"Page 1: {len(records)} records")

    all_records = list(records)
    total_pages = max(1, -(-int(total) // PAGE_SIZE))  # ceiling division
    print(f"Pages to fetch: {total_pages}")

    for page in range(2, total_pages + 1):
        print(f"  Page {page}/{total_pages}...", end=" ", flush=True)
        try:
            data = fetch_page(page)
            body = data.get("data") or data.get("result") or data
            recs = body.get("list") or body.get("data") or body.get("records") or []
            all_records.extend(recs)
            print(f"{len(recs)} records (total so far: {len(all_records):,})")
        except Exception as e:
            print(f"ERROR: {e} — skipping page {page}")
        time.sleep(DELAY_S)

    return all_records

# ── Run scrape ────────────────────────────────────────────────────────────────
print("=" * 60)
print("TenData Pakistan Beef Export Scraper")
print(f"Period: {START_DATE} → {END_DATE}")
print(f"HS codes: {HS_CODES}")
print("=" * 60)

records = scrape_all()
print(f"\nTotal records fetched: {len(records):,}")

if not records:
    print("\nERROR: No records returned. Cookie may have expired.")
    print("Response structure debug — re-run with debug=True")
    exit(1)

# ── Build DataFrame ───────────────────────────────────────────────────────────
df = pd.DataFrame(records)
print(f"\nRaw columns: {list(df.columns)}")
print(df.head(2).to_string())

# Save raw JSON backup
raw_json_path = os.path.join(OUT_DIR, "tendata_raw_response.json")
with open(raw_json_path, "w") as f:
    json.dump(records, f, indent=2, default=str)
print(f"\nRaw JSON saved: {raw_json_path}")

# ── Column mapping (TenData field names) ──────────────────────────────────────
col_map = {
    "date":                  "Date",
    "hsCode":                "HSCode",
    "hsCodeDescEn":          "HS_Desc",
    "goodsDesc":             "ProductDesc",
    "exporter":              "Exporter",
    "exporterId":            "ExporterID",
    "importer":              "Importer",
    "countryOfDestination":  "Destination",
    "countryOfDestinationCode": "DestCode",
    "weight":                "GrossKg",
    "sumOfUSD":              "TotalUSD",
    "weightUnitPrice":       "UnitUSDkg",
    "qty":                   "Qty",
    "qtyUnit":               "QtyUnit",
    "portOfDeparture":       "LoadingPort",
    "declaredTotalPrice":    "DeclaredPricePKR",
    "tradeId":               "TradeID",
}
df = df.rename(columns={k: v for k, v in col_map.items() if k in df.columns})

# ── Clean ─────────────────────────────────────────────────────────────────────
df['Date']      = pd.to_datetime(df['Date'], errors='coerce')
df['GrossKg']   = pd.to_numeric(df.get('GrossKg',   pd.Series(dtype=float)), errors='coerce')
df['TotalUSD']  = pd.to_numeric(df.get('TotalUSD',  pd.Series(dtype=float)), errors='coerce')
df['UnitUSDkg'] = pd.to_numeric(df.get('UnitUSDkg', pd.Series(dtype=float)), errors='coerce')

# Zero-pad HS code (Excel/API drops leading zero)
df['HSCode_str'] = df['HSCode'].astype(str).str.strip().str.zfill(8)
df['hs4'] = df['HSCode_str'].str[:4]
df['hs6'] = df['HSCode_str'].str[:6]

# Transport mode: PAE suffix = airport (Air), everything else = Sea
df['Mode'] = df['LoadingPort'].astype(str).apply(
    lambda x: 'Air' if x.upper().endswith('PAE') else 'Sea'
)

print(f"\nDate range  : {df['Date'].min().date()} → {df['Date'].max().date()}")
print(f"Total rows  : {len(df):,}")
print(f"hs4 counts  :\n{df['hs4'].value_counts()}")
print(f"Mode counts :\n{df['Mode'].value_counts()}")

# ── Save raw cleaned CSV ───────────────────────────────────────────────────────
raw_csv = os.path.join(OUT_DIR, "tendata_all_beef_exports_YTD2026_RAW.csv")
df.to_csv(raw_csv, index=False)
print(f"\nRaw CSV saved: {raw_csv}")

# ── Analysis: filter chilled (0201) ──────────────────────────────────────────
chilled = df[df['hs4'] == '0201'].dropna(subset=['GrossKg','TotalUSD']).copy()

hs6_labels = {
    '020110': 'Carcass / Half-carcass (chilled)',
    '020120': 'Bone-in cuts (chilled)',
    '020130': 'Boneless cuts (chilled)',
}
chilled['HS6_Desc'] = chilled['hs6'].map(hs6_labels).fillna(chilled['hs6'])

print(f"\nChilled beef (0201) shipments: {len(chilled):,}")
print(chilled.groupby(['hs6','HS6_Desc']).agg(
    shipments=('GrossKg','count'), total_kg=('GrossKg','sum'), total_usd=('TotalUSD','sum')
).to_string())

def wavg_stats(g):
    total_kg  = g['GrossKg'].sum()
    total_usd = g['TotalUSD'].sum()
    return pd.Series({
        'Wavg_USD_kg': round(total_usd / total_kg, 4) if total_kg else None,
        'Min_USD_kg':  round(g['UnitUSDkg'].min(), 4),
        'Max_USD_kg':  round(g['UnitUSDkg'].max(), 4),
        'Total_KG':    round(total_kg, 0),
        'Total_USD':   round(total_usd, 2),
        'Shipments':   len(g),
    })

bench      = chilled.groupby(['Destination','hs6','HS6_Desc']).apply(wavg_stats).reset_index().sort_values('Wavg_USD_kg', ascending=False)
bench_mode = chilled.groupby(['Destination','hs6','HS6_Desc','Mode']).apply(wavg_stats).reset_index().sort_values(['hs6','Wavg_USD_kg'],ascending=[True,False])
mode_summ  = chilled.groupby(['Mode','hs6','HS6_Desc']).apply(wavg_stats).reset_index().sort_values(['hs6','Wavg_USD_kg'],ascending=[True,False])
hs6_summ   = chilled.groupby(['hs6','HS6_Desc']).apply(wavg_stats).reset_index().sort_values('Wavg_USD_kg',ascending=False)
dest_summ  = chilled.groupby('Destination').apply(wavg_stats).reset_index().sort_values('Wavg_USD_kg',ascending=False)

# Also analyse frozen (0202) and offal (0206) for reference
frozen  = df[df['hs4'] == '0202'].dropna(subset=['GrossKg','TotalUSD']).copy()
offal   = df[df['hs4'] == '0206'].dropna(subset=['GrossKg','TotalUSD']).copy()

grand_wavg = chilled['TotalUSD'].sum() / chilled['GrossKg'].sum()

print(f"\nGrand weighted avg (all chilled): ${grand_wavg:.4f}/kg")
print("\n=== DEST × HS6 BENCHMARK ===")
print(bench.to_string(index=False))

# ── Excel Export ──────────────────────────────────────────────────────────────
EXCEL_OUT = os.path.join(OUT_DIR, "BA_Foods_Beef_Pricing_Benchmark_YTD2026.xlsx")

with pd.ExcelWriter(EXCEL_OUT, engine='xlsxwriter') as writer:
    wb  = writer.book
    hdr = wb.add_format({'bold':True,'bg_color':'#1C3D1C','font_color':'white','border':1,'align':'center','valign':'vcenter','text_wrap':True})
    usd = wb.add_format({'num_format':'$#,##0.0000','border':1})
    u2  = wb.add_format({'num_format':'$#,##0.00','border':1})
    num = wb.add_format({'num_format':'#,##0','border':1})
    cel = wb.add_format({'border':1})
    ttl = wb.add_format({'bold':True,'font_size':13,'font_color':'#1C3D1C'})
    sub = wb.add_format({'italic':True,'font_color':'#555555','font_size':10})

    usd_c  = ['Wavg_USD_kg','Min_USD_kg','Max_USD_kg']
    usd2_c = ['Total_USD']
    num_c  = ['Total_KG','Shipments']

    def write_sheet(name, title, subtitle, data):
        data.to_excel(writer, sheet_name=name, index=False, startrow=3)
        ws = writer.sheets[name]
        ws.write(0, 0, title, ttl)
        ws.write(1, 0, subtitle, sub)
        for ci, cn in enumerate(data.columns):
            ws.write(2, ci, cn, hdr)
            w = max(len(str(cn)), data[cn].astype(str).str.len().max()) + 3
            ws.set_column(ci, ci, min(w, 40),
                          usd if cn in usd_c else (u2 if cn in usd2_c else (num if cn in num_c else cel)))
        ws.freeze_panes(3, 0)

    write_sheet('1_Dest_HS6',
        'BA Foods — Chilled Beef: Price Benchmark by Destination & Product',
        f'Weight-weighted avg USD/kg | HS4=0201 | {START_DATE} → {END_DATE} | {len(chilled):,} shipments | Source: TenData',
        bench)

    write_sheet('2_Air_vs_Sea',
        'Chilled Beef — Air vs Sea by Destination & Product',
        'Air freight commands a premium — use this to decide routing per market',
        bench_mode)

    write_sheet('3_Mode_Summary',
        'Transport Mode × Product Type — Overall',
        'Carcass by air vs bone-in by sea — margin comparison',
        mode_summ)

    write_sheet('4_HS6_Overall',
        'Product Type Summary (All Destinations)',
        f'Grand weighted avg all chilled: ${grand_wavg:.4f}/kg',
        hs6_summ)

    write_sheet('5_Dest_Overall',
        'Destination Summary — All Product Types Combined',
        'Volume and price per market (use for market prioritisation)',
        dest_summ)

    # Frozen beef summary
    if len(frozen) > 0:
        frozen['HS6_Desc'] = frozen['hs6'].map({
            '020210':'Carcass/Half-carcass (frozen)','020220':'Bone-in (frozen)','020230':'Boneless (frozen)'
        }).fillna(frozen['hs6'])
        frz_bench = frozen.groupby(['Destination','hs6','HS6_Desc']).apply(wavg_stats).reset_index().sort_values('Wavg_USD_kg',ascending=False)
        write_sheet('6_Frozen_0202',
            'Frozen Beef (HS 0202) — Reference Benchmark',
            'Frozen is your chilled competitor for sea-freight routes; compare margins',
            frz_bench)

    # Raw data
    raw_cols = [c for c in ['Date','Exporter','Destination','DestCode','hs6','HS6_Desc',
                             'GrossKg','TotalUSD','UnitUSDkg','Mode','LoadingPort',
                             'ProductDesc','HS_Desc','TradeID'] if c in df.columns]
    raw_out = df[raw_cols].copy()
    raw_out.to_excel(writer, sheet_name='7_Raw_All', index=False)
    ws7 = writer.sheets['7_Raw_All']
    for ci, cn in enumerate(raw_out.columns):
        ws7.write(0, ci, cn, hdr)
        ws7.set_column(ci, ci, 20)
    ws7.freeze_panes(1, 0)

print(f"\nExcel saved: {EXCEL_OUT}")
print("Sheets: 1_Dest_HS6 | 2_Air_vs_Sea | 3_Mode_Summary | 4_HS6_Overall | 5_Dest_Overall | 6_Frozen_0202 | 7_Raw_All")
print(f"\nDone. {len(df):,} total records across {df['hs4'].nunique()} HS4 chapters.")
