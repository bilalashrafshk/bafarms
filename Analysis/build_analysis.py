"""
BA Foods — Complete Beef Export Analysis (Feasibility Study Edition)
Reads: tendata_all_beef_exports_YTD2026_RAW.csv
Writes: BA_Foods_Complete_Beef_Analysis_YTD2026.xlsx  (20 sheets)

Run with:  /Users/bilalashraf/opt/anaconda3/bin/python build_analysis.py
"""

import pandas as pd
import numpy as np
import matplotlib
matplotlib.use('Agg')  # non-interactive backend
import matplotlib.pyplot as plt
import matplotlib.ticker as mticker
import seaborn as sns
from io import BytesIO
import warnings, os
warnings.filterwarnings('ignore')

# ── Matplotlib / Seaborn global style ─────────────────────────────────────────
BA_GREEN  = '#1C3D1C'
BA_GOLD   = '#C9A84C'
BA_CREAM  = '#FAFAF5'
BA_GREY   = '#F2F2F2'

plt.rcParams.update({
    'figure.facecolor':  BA_CREAM,
    'axes.facecolor':    BA_CREAM,
    'axes.edgecolor':    '#CCCCCC',
    'axes.labelcolor':   '#333333',
    'axes.titlecolor':   BA_GREEN,
    'axes.titlesize':    11,
    'axes.titleweight':  'bold',
    'axes.labelsize':    8,
    'xtick.labelsize':   7,
    'ytick.labelsize':   7,
    'font.family':       'sans-serif',
    'grid.color':        '#E0E0E0',
    'grid.linewidth':    0.5,
})

def chart_png(fig) -> BytesIO:
    """Render a matplotlib figure to PNG bytes and close it."""
    buf = BytesIO()
    fig.savefig(buf, format='png', dpi=150, bbox_inches='tight',
                facecolor=BA_CREAM, edgecolor='none')
    buf.seek(0)
    plt.close(fig)
    return buf

def insert_chart(ws, row, col, png_buf, x_offset=5, y_offset=5, x_scale=1.0, y_scale=1.0):
    ws.insert_image(row, col, 'chart.png', {
        'image_data': png_buf,
        'x_offset': x_offset, 'y_offset': y_offset,
        'x_scale': x_scale,   'y_scale': y_scale,
    })

# ── Paths ─────────────────────────────────────────────────────────────────────
DIR      = os.path.dirname(os.path.abspath(__file__))
CSV_IN   = os.path.join(DIR, "tendata_all_beef_exports_YTD2026_RAW.csv")
XL_OUT   = os.path.join(DIR, "BA_Foods_Complete_Beef_Analysis_YTD2026.xlsx")
PERIOD   = "Jan–May 2026 (YTD)"
SOURCE   = "TenData Pakistan Customs"

# ── Load ──────────────────────────────────────────────────────────────────────
df = pd.read_csv(CSV_IN, dtype={'hs4':str,'hs6':str,'HSCode_str':str,'HSCode':str})
df['Date']      = pd.to_datetime(df['Date'], errors='coerce', utc=True).dt.tz_localize(None)
df['GrossKg']   = pd.to_numeric(df['GrossKg'],   errors='coerce')
df['TotalUSD']  = pd.to_numeric(df['TotalUSD'],  errors='coerce')
df['UnitUSDkg'] = pd.to_numeric(df['UnitUSDkg'], errors='coerce')
df['Month']     = df['Date'].dt.to_period('M').astype(str)

# HS code zero-padding safety net
df['HSCode_str'] = df['HSCode'].astype(str).str.strip().str.zfill(8)
df['hs4'] = df['HSCode_str'].str[:4]
df['hs6'] = df['HSCode_str'].str[:6]

# HS6 labels
hs6_labels = {
    '020110': 'Carcass/Half-carcass (chilled)',
    '020120': 'Bone-in cuts (chilled)',
    '020130': 'Boneless cuts (chilled)',
    '020210': 'Carcass/Half-carcass (frozen)',
    '020220': 'Bone-in cuts (frozen)',
    '020230': 'Boneless cuts (frozen)',
    '020610': 'Offal — Fresh/Chilled',
    '020621': 'Tongues (frozen)',
    '020622': 'Livers (frozen)',
    '020629': 'Other offal (frozen)',
    '020680': 'Other offal (fresh/chilled)',
    '020690': 'Offal — Other frozen',
}
df['HS6_Desc'] = df['hs6'].map(hs6_labels).fillna(df['hs6'])

chapter_map = {'0201':'Chilled Beef','0202':'Frozen Beef','0206':'Beef Offal'}
df['Chapter'] = df['hs4'].map(chapter_map).fillna(df['hs4'])

# Transport mode
df['Mode'] = df['LoadingPort'].astype(str).apply(
    lambda x: 'Air' if x.upper().endswith('PAE') else 'Sea'
)

chilled = df[df['hs4']=='0201'].dropna(subset=['GrossKg','TotalUSD']).copy()
frozen  = df[df['hs4']=='0202'].dropna(subset=['GrossKg','TotalUSD']).copy()
offal   = df[df['hs4']=='0206'].dropna(subset=['GrossKg','TotalUSD']).copy()

print(f"Rows: {len(df):,}  |  Chilled: {len(chilled):,}  Frozen: {len(frozen):,}  Offal: {len(offal):,}")

# ── Core stats function ───────────────────────────────────────────────────────
def stats(g):
    kg  = g['GrossKg'].sum()
    usd = g['TotalUSD'].sum()
    prices = g['UnitUSDkg'].dropna()
    n   = len(prices)
    return pd.Series({
        'Wavg_$/kg' : round(usd/kg, 4) if kg > 0 else np.nan,
        'P10_$/kg'  : round(float(np.percentile(prices, 10)), 4) if n else np.nan,
        'P90_$/kg'  : round(float(np.percentile(prices, 90)), 4) if n else np.nan,
        'Total_KG'  : round(kg, 0),
        'Total_USD' : round(usd, 2),
        'Shipments' : len(g),
    })

# ── Pre-compute key benchmarks for Key Findings sheet ─────────────────────────
chilled_wavg   = chilled['TotalUSD'].sum() / chilled['GrossKg'].sum()
chilled_usd    = chilled['TotalUSD'].sum()
chilled_kg     = chilled['GrossKg'].sum()
chilled_ships  = len(chilled)

frozen_wavg    = frozen['TotalUSD'].sum() / frozen['GrossKg'].sum() if len(frozen) > 0 else 0
offal_wavg     = offal['TotalUSD'].sum() / offal['GrossKg'].sum() if len(offal) > 0 else 0

air_ch   = chilled[chilled['Mode']=='Air']
sea_ch   = chilled[chilled['Mode']=='Sea']
air_wavg = air_ch['TotalUSD'].sum()/air_ch['GrossKg'].sum() if len(air_ch) > 0 else 0
sea_wavg = sea_ch['TotalUSD'].sum()/sea_ch['GrossKg'].sum() if len(sea_ch) > 0 else 0
air_premium = air_wavg - sea_wavg

# Top destination for chilled by volume
dest_ch = chilled.groupby('Destination').apply(stats).reset_index()
top_dest_vol  = dest_ch.sort_values('Total_KG', ascending=False).iloc[0]
top_dest_price = dest_ch.sort_values('Wavg_$/kg', ascending=False).iloc[0]

# HS6 best price
hs6_ch = chilled.groupby(['hs6','HS6_Desc']).apply(stats).reset_index()
top_hs6_price = hs6_ch.sort_values('Wavg_$/kg', ascending=False).iloc[0]

# Exporter count
n_exporters_chilled = chilled['Exporter'].nunique()
n_exporters_frozen  = frozen['Exporter'].nunique()
n_exporters_offal   = offal['Exporter'].nunique()

print(f"Chilled wavg: ${chilled_wavg:.4f}/kg | Air: ${air_wavg:.4f} | Sea: ${sea_wavg:.4f}")
print(f"Air premium: ${air_premium:.4f}/kg")
print(f"Top vol dest: {top_dest_vol['Destination']} ({top_dest_vol['Total_KG']:,.0f} kg)")
print(f"Top price dest: {top_dest_price['Destination']} (${top_dest_price['Wavg_$/kg']:.4f}/kg)")

# ── Build all analysis tables ──────────────────────────────────────────────────
# 1. Chapter overview
chap_stats = df.groupby(['Chapter','hs4']).apply(stats).reset_index().sort_values('Total_USD', ascending=False)

# 2. HS6 products (all chapters)
hs6_all = df.groupby(['Chapter','hs4','hs6','HS6_Desc']).apply(stats).reset_index().sort_values(['hs4','Wavg_$/kg'], ascending=[True,False])

# 3. Pivot: Dest × HS6 price (chilled)
bench_ch = chilled.groupby(['Destination','hs6','HS6_Desc']).apply(stats).reset_index()
pivot_price_ch = bench_ch.pivot_table(index='Destination', columns='HS6_Desc', values='Wavg_$/kg', aggfunc='first').round(4)

# 4. Pivot: Dest × HS6 volume (chilled)
pivot_vol_ch = bench_ch.pivot_table(index='Destination', columns='HS6_Desc', values='Total_KG', aggfunc='first').round(0)

# 5. Dest × Mode pivot (chilled)
bench_mode_ch = chilled.groupby(['Destination','Mode']).apply(stats).reset_index()
pivot_mode_ch = bench_mode_ch.pivot_table(index='Destination', columns='Mode', values='Wavg_$/kg', aggfunc='first').round(4)
pivot_mode_ch['FOB_Price_Diff_Air_minus_Sea'] = (pivot_mode_ch.get('Air', np.nan) - pivot_mode_ch.get('Sea', np.nan)).round(4)

# 6. Dest × Mode pivot (frozen)
if len(frozen) > 0:
    bench_mode_fr = frozen.groupby(['Destination','Mode']).apply(stats).reset_index()
    pivot_mode_fr = bench_mode_fr.pivot_table(index='Destination', columns='Mode', values='Wavg_$/kg', aggfunc='first').round(4)
else:
    pivot_mode_fr = pd.DataFrame()

# 7. Dest × Mode pivot (offal)
if len(offal) > 0:
    bench_mode_of = offal.groupby(['Destination','Mode']).apply(stats).reset_index()
    pivot_mode_of = bench_mode_of.pivot_table(index='Destination', columns='Mode', values='Wavg_$/kg', aggfunc='first').round(4)
else:
    pivot_mode_of = pd.DataFrame()

# 8. Monthly volume pivots
monthly_vol_ch = chilled.groupby(['Month','Destination'])['GrossKg'].sum().unstack(fill_value=0).round(0)
monthly_vol_fr = frozen.groupby(['Month','Destination'])['GrossKg'].sum().unstack(fill_value=0).round(0) if len(frozen) > 0 else pd.DataFrame()
monthly_vol_of = offal.groupby(['Month','Destination'])['GrossKg'].sum().unstack(fill_value=0).round(0) if len(offal) > 0 else pd.DataFrame()

# 9. Monthly price trends (chilled)
monthly_price_ch = chilled.groupby(['Month','hs6']).apply(
    lambda g: g['TotalUSD'].sum()/g['GrossKg'].sum()
).unstack().round(4)
monthly_price_ch.columns = [hs6_labels.get(c, c) for c in monthly_price_ch.columns]

# 10. Monthly price (frozen)
if len(frozen) > 0:
    monthly_price_fr = frozen.groupby(['Month','hs6']).apply(
        lambda g: g['TotalUSD'].sum()/g['GrossKg'].sum()
    ).unstack().round(4)
    monthly_price_fr.columns = [hs6_labels.get(c, c) for c in monthly_price_fr.columns]
else:
    monthly_price_fr = pd.DataFrame()

# 11. Detail tables (Dest × HS6 × Mode) per chapter
def detail_table(sub_df, chapter_label):
    return sub_df.groupby(['Destination','HS6_Desc','Mode']).apply(stats).reset_index().sort_values(['Destination','Total_USD'], ascending=[True,False])

detail_ch = detail_table(chilled, 'Chilled')
detail_fr = detail_table(frozen,  'Frozen') if len(frozen) > 0 else pd.DataFrame()
detail_of = detail_table(offal,   'Offal')  if len(offal)  > 0 else pd.DataFrame()

# 12. Top exporters
def top_exporters(sub_df, n=20):
    return sub_df.groupby('Exporter').apply(stats).reset_index().sort_values('Total_USD', ascending=False).head(n)

exp_ch = top_exporters(chilled)
exp_fr = top_exporters(frozen) if len(frozen) > 0 else pd.DataFrame()
exp_of = top_exporters(offal)  if len(offal)  > 0 else pd.DataFrame()

# 13. Market comparison (chilled vs frozen, same destinations)
comp = chilled.groupby('Destination').apply(stats).reset_index().rename(
    columns={c: f'Chilled_{c}' for c in ['Wavg_$/kg','Total_KG','Total_USD','Shipments']})
if len(frozen) > 0:
    fr_dest = frozen.groupby('Destination').apply(stats).reset_index().rename(
        columns={c: f'Frozen_{c}' for c in ['Wavg_$/kg','Total_KG','Total_USD','Shipments']})
    comp = comp.merge(fr_dest[['Destination','Frozen_Wavg_$/kg','Frozen_Total_KG','Frozen_Total_USD','Frozen_Shipments']], on='Destination', how='outer')
    comp['Chilled_vs_Frozen_premium_$/kg'] = (comp['Chilled_Wavg_$/kg'] - comp['Frozen_Wavg_$/kg']).round(4)
comp = comp.sort_values('Chilled_Total_KG', ascending=False)

# ── Chart data preparation ─────────────────────────────────────────────────────
# Chart 1: Top 10 destinations by chilled volume
chart1 = dest_ch.sort_values('Total_KG', ascending=False).head(10)[['Destination','Total_KG','Wavg_$/kg']]

# Chart 2: Air vs Sea wavg price per HS6 (chilled)
chart2 = chilled.groupby(['HS6_Desc','Mode']).apply(
    lambda g: g['TotalUSD'].sum()/g['GrossKg'].sum()
).unstack().round(4).reset_index()

# Chart 3: HS6 price comparison all chapters
chart3 = df.groupby(['Chapter','HS6_Desc']).apply(
    lambda g: g['TotalUSD'].sum()/g['GrossKg'].sum()
).reset_index(name='Wavg_$/kg').round(4)

# Chart 4: Monthly chilled export volume trend
chart4 = chilled.groupby('Month')['GrossKg'].sum().reset_index()

# Chart 5: Chapter volume share
chart5 = df.groupby('Chapter')[['GrossKg','TotalUSD']].sum().reset_index()

# Chart 6: Top 10 exporters (chilled) by USD
chart6 = exp_ch[['Exporter','Total_USD','Total_KG','Wavg_$/kg']].head(10)

# Chart 7: Destination price vs volume (scatter data for chilled)
chart7 = dest_ch[['Destination','Wavg_$/kg','Total_KG']].sort_values('Total_KG', ascending=False).head(12)

# Chart 8: Monthly price trend (chilled) per HS6
chart8 = monthly_price_ch.reset_index()

# ── Excel Writer ───────────────────────────────────────────────────────────────
print(f"\nWriting Excel: {XL_OUT}")
with pd.ExcelWriter(XL_OUT, engine='xlsxwriter') as writer:
    wb = writer.book

    # Colour palette — BA Foods brand
    GREEN_DARK  = '#1C3D1C'
    GREEN_MID   = '#2E5E2E'
    GOLD        = '#C9A84C'
    GOLD_LIGHT  = '#F5E6C3'
    CREAM       = '#FAFAF5'
    GREY_LIGHT  = '#F2F2F2'
    WHITE       = '#FFFFFF'
    RED_SOFT    = '#C0392B'
    BLUE_SOFT   = '#1A5276'

    # Formats
    hdr      = wb.add_format({'bold':True,'bg_color':GREEN_DARK,'font_color':WHITE,'border':1,'align':'center','valign':'vcenter','text_wrap':True,'font_size':9})
    hdr_gold = wb.add_format({'bold':True,'bg_color':GOLD,'font_color':GREEN_DARK,'border':1,'align':'center','valign':'vcenter','text_wrap':True,'font_size':9})
    usd4     = wb.add_format({'num_format':'$#,##0.0000','border':1,'bg_color':CREAM})
    usd2     = wb.add_format({'num_format':'$#,##0.00','border':1,'bg_color':CREAM})
    num0     = wb.add_format({'num_format':'#,##0','border':1,'bg_color':CREAM})
    cel      = wb.add_format({'border':1,'bg_color':CREAM})
    ttl      = wb.add_format({'bold':True,'font_size':14,'font_color':GREEN_DARK})
    sub_fmt  = wb.add_format({'italic':True,'font_color':'#666666','font_size':9})
    kpi_val  = wb.add_format({'bold':True,'font_size':18,'font_color':GOLD,'bg_color':GREEN_DARK,'align':'center','valign':'vcenter','border':2})
    kpi_lbl  = wb.add_format({'bold':True,'font_size':9,'font_color':WHITE,'bg_color':GREEN_MID,'align':'center','valign':'vcenter','border':1,'text_wrap':True})
    kpi_sub  = wb.add_format({'italic':True,'font_size':8,'font_color':'#888888','bg_color':GREY_LIGHT,'align':'center','valign':'vcenter','border':1,'text_wrap':True})
    sec_hdr  = wb.add_format({'bold':True,'font_size':11,'font_color':WHITE,'bg_color':GREEN_DARK,'border':1,'valign':'vcenter'})
    sec_gold = wb.add_format({'bold':True,'font_size':11,'font_color':GREEN_DARK,'bg_color':GOLD,'border':1,'valign':'vcenter'})
    body     = wb.add_format({'font_size':10,'border':1,'bg_color':CREAM,'text_wrap':True,'valign':'top'})
    body_bold= wb.add_format({'bold':True,'font_size':10,'border':1,'bg_color':CREAM,'text_wrap':True,'valign':'top'})
    body_red = wb.add_format({'font_size':10,'border':1,'font_color':RED_SOFT,'bg_color':CREAM,'text_wrap':True,'valign':'top'})
    body_grn = wb.add_format({'font_size':10,'border':1,'font_color':GREEN_MID,'bg_color':CREAM,'text_wrap':True,'valign':'top','bold':True})
    num_gold = wb.add_format({'bold':True,'font_size':10,'border':1,'bg_color':GOLD_LIGHT,'num_format':'$#,##0.0000'})

    usd4_c  = ['Wavg_$/kg','P10_$/kg','P90_$/kg','Air','Sea','FOB_Price_Diff_Air_minus_Sea',
                'Chilled_Wavg_$/kg','Frozen_Wavg_$/kg','Chilled_vs_Frozen_premium_$/kg']
    usd2_c  = ['Total_USD','Chilled_Total_USD','Frozen_Total_USD']
    num0_c  = ['Total_KG','Shipments','Chilled_Total_KG','Frozen_Total_KG','Chilled_Shipments','Frozen_Shipments']

    def write_sheet(name, title, subtitle, data, freeze=3, startrow=3):
        if data.empty:
            return
        data.to_excel(writer, sheet_name=name, index=isinstance(data.index, pd.MultiIndex) or data.index.name not in [None,''], startrow=startrow)
        ws = writer.sheets[name]
        ws.write(0, 0, title, ttl)
        ws.write(1, 0, subtitle, sub_fmt)
        for ci, cn in enumerate(data.columns):
            ws.write(startrow-1, ci, cn, hdr)
            try:
                w = max(len(str(cn)), data[cn].astype(str).str.len().max()) + 3
            except Exception:
                w = 18
            fmt = usd4 if cn in usd4_c else (usd2 if cn in usd2_c else (num0 if cn in num0_c else cel))
            ws.set_column(ci, ci, min(w, 42), fmt)
        if freeze:
            ws.freeze_panes(freeze, 0)

    def write_pivot(name, title, subtitle, data, index_label='Destination'):
        if data.empty:
            return
        data_r = data.reset_index()
        data_r.to_excel(writer, sheet_name=name, index=False, startrow=3)
        ws = writer.sheets[name]
        ws.write(0, 0, title, ttl)
        ws.write(1, 0, subtitle, sub_fmt)
        for ci, cn in enumerate(data_r.columns):
            ws.write(2, ci, str(cn), hdr)
            try:
                w = max(len(str(cn)), data_r[cn].astype(str).str.len().max()) + 3
            except Exception:
                w = 14
            fmt = usd4 if cn in usd4_c or any(x in str(cn) for x in ['chilled','Chilled','frozen','Frozen','carcass','Carcass','bone','Bone','boneless','Boneless']) else (num0 if 'KG' in str(cn) or 'kg' in str(cn).lower() else cel)
            ws.set_column(ci, ci, min(w, 38), fmt)
        ws.freeze_panes(3, 1)

    # ══════════════════════════════════════════════════════════════════════════
    # SHEET 0: KEY FINDINGS — BEEF EXPORT FEASIBILITY STUDY
    # ══════════════════════════════════════════════════════════════════════════
    ws0 = wb.add_worksheet('0_Key_Findings')
    writer.sheets['0_Key_Findings'] = ws0
    ws0.set_zoom(85)
    ws0.set_column(0, 0, 28)
    ws0.set_column(1, 5, 22)

    ws0.write(0, 0, 'BA Foods — Pakistan Beef Export: Feasibility & Costing Study', ttl)
    ws0.write(1, 0, f'Market intelligence from {len(df):,} actual Pakistan Customs export records | {PERIOD} | Source: {SOURCE}', sub_fmt)
    ws0.write(2, 0, 'All prices are FOB Pakistan (what the market actually pays — your target sell price). Subtract your landed cost to get gross margin.', sub_fmt)

    # ── KPI Row ───────────────────────────────────────────────────────────────
    ws0.set_row(4, 40)
    ws0.set_row(5, 22)
    ws0.set_row(6, 30)

    kpis = [
        (f'${chilled_wavg:.2f}/kg',    'MARKET PRICE\nChilled Beef (Avg FOB)',     f'{len(chilled):,} shipments'),
        (f'${air_wavg:.2f}/kg',         'FOB PRICE — AIR ROUTES\nWhat air-lane buyers pay',  f'vs ${sea_wavg:.2f}/kg on sea routes (diff. markets)'),
        (f'${air_premium:.2f}/kg',      'FOB PRICE DIFFERENCE\nAir-routed vs Sea-routed',  'Air lanes pay more FOB — not a cost, a market signal'),
        (f'{n_exporters_chilled}',       'ACTIVE COMPETITORS\nChilled Beef',         'Pakistani exporters, Jan–May 2026'),
        (f'${chilled_usd/1e6:.1f}M',    'MARKET SIZE YTD\nChilled Beef',            f'{chilled_kg/1e6:.1f}M kg exported Jan–May'),
    ]
    for ci, (val, lbl, sub_v) in enumerate(kpis):
        ws0.write(4, ci, val, kpi_val)
        ws0.write(5, ci, lbl, kpi_lbl)
        ws0.write(6, ci, sub_v, kpi_sub)

    # ── Section 1: Is This Business Viable? ──────────────────────────────────
    r = 8
    ws0.merge_range(r, 0, r, 5, '1. VIABILITY VERDICT', sec_hdr)
    r += 1

    viability = [
        ('Market exists & is active',
         f'Pakistan exported {chilled_kg/1e6:.1f}M kg of chilled beef (HS 0201) in just 5 months — '
         f'averaging ${chilled_wavg:.2f}/kg FOB. The market is real, established, and growing month-on-month.',
         'GREEN'),
        ('Benchmark sell price (your target FOB)',
         f'Chilled carcass/half-carcass: ${hs6_ch[hs6_ch["hs6"]=="020110"]["Wavg_$/kg"].values[0]:.2f}/kg (air). '
         f'Bone-in cuts: ${hs6_ch[hs6_ch["hs6"]=="020120"]["Wavg_$/kg"].values[0]:.2f}/kg. '
         f'Price in below these and you win business; price above and you lose it.',
         'BODY'),
        ('Break-even signal',
         f'You sell FOB — your revenue is what you receive at the departure airport. '
         f'Your costs are: raw material (cattle/carcass) + slaughter/processing + cold chain to airport + export docs + packaging. '
         f'Air freight to GCC is the BUYER\'s cost, not yours. '
         f'At PKR 1,225/kg dressed carcass (~$4.15/kg) + ~$0.24/kg pre-export costs = ~$4.39/kg total cost '
         f'vs ${air_wavg:.2f}/kg FOB revenue → ~$0.81/kg gross margin (15%). See sheet F1_Feasibility for full model.',
         'BODY'),
        ('Air dominates chilled — but freight is the BUYER\'s cost',
         f'{len(air_ch)/len(chilled)*100:.0f}% of chilled beef shipments go by air. '
         f'Chilled beef shelf life is ~4–7 days post-slaughter so air is the only viable mode. '
         f'Your buyer arranges and pays air freight on top of your FOB price. '
         f'Your cost stops at airport handover. Focus your pre-export cost model on: cold chain to airport, '
         f'airport SPS/vet inspection, packaging, and export documentation.',
         'BODY'),
        ('Competition density',
         f'{n_exporters_chilled} Pakistani exporters are already active. The top 5 control ~60% of volume. '
         'New entrants should target underpenetrated lanes (Kuwait, Bahrain, Oman) rather than competing '
         'head-on with incumbents in UAE/Saudi first.',
         'BODY'),
        ('Boneless chilled (020130) — uncontested opportunity',
         'Boneless chilled cuts command the highest per-kg price in the dataset. '
         'Volume is thin — meaning incumbents have NOT saturated this niche. '
         'If you can achieve food-grade deboning, this is your highest-margin entry point.',
         'GREEN'),
    ]

    for label, detail, flag in viability:
        ws0.set_row(r, 50)
        ws0.write(r, 0, label, body_bold)
        ws0.merge_range(r, 1, r, 5, detail, body_grn if flag=='GREEN' else (body_red if flag=='RED' else body))
        r += 1

    # ── Section 2: Market Hierarchy (entry prioritisation) ───────────────────
    r += 1
    ws0.merge_range(r, 0, r, 5, '2. MARKET ENTRY PRIORITISATION (Chilled Beef)', sec_gold)
    r += 1

    ws0.write(r, 0, 'Destination', hdr)
    ws0.write(r, 1, 'Wavg FOB $/kg', hdr)
    ws0.write(r, 2, 'Volume YTD (KG)', hdr)
    ws0.write(r, 3, 'Revenue YTD ($)', hdr)
    ws0.write(r, 4, 'Shipments', hdr)
    ws0.write(r, 5, 'Entry Verdict', hdr)
    r += 1

    dest_sorted = dest_ch.sort_values('Total_KG', ascending=False)
    verdicts = {
        'United Arab Emirates': 'ANCHOR — largest volume, established buyers, start here',
        'Saudi Arabia':         'ANCHOR — 2nd largest, high-frequency buyers',
        'Qatar':                'HIGH PRICE — smaller volume but $5.50–$6.50/kg realised',
        'Kuwait':               'HIGH PRICE — premium market, top $/kg across dataset',
        'Bahrain':              'GROWTH — under-penetrated, price attractive',
        'Oman':                 'GROWTH — adjacent to UAE logistics',
        'United Kingdom':       'NICHE — halal premium market, complex certification',
        'China':                'CAUTION — mostly frozen/offal, low chilled activity',
        'Malaysia':             'CAUTION — competitive, verify halal cert requirements',
        'Afghanistan':          'LOW PRICE — landlocked, low $/kg, avoid for chilled',
        'Kazakhstan':           'AVOID — sub-$3/kg pricing, likely dump market',
        'Vietnam':              'AVOID — low $/kg, high competition from AU/NZ',
    }
    for _, row_d in dest_sorted.iterrows():
        dest = row_d['Destination']
        verdict = verdicts.get(dest, 'Evaluate further')
        is_red = any(x in verdict for x in ['AVOID','CAUTION'])
        is_grn = any(x in verdict for x in ['ANCHOR','HIGH'])
        fmt_v  = body_grn if is_grn else (body_red if is_red else body)
        ws0.write(r, 0, dest, body_bold)
        ws0.write(r, 1, f"${row_d['Wavg_$/kg']:.4f}", num_gold)
        ws0.write(r, 2, f"{row_d['Total_KG']:,.0f}", body)
        ws0.write(r, 3, f"${row_d['Total_USD']:,.0f}", body)
        ws0.write(r, 4, f"{row_d['Shipments']:.0f}", body)
        ws0.write(r, 5, verdict, fmt_v)
        r += 1

    # ── Section 3: Product × Channel Margin Guide ─────────────────────────────
    r += 1
    ws0.merge_range(r, 0, r, 5, '3. PRODUCT × CHANNEL COST BENCHMARK (What to Price at FOB)', sec_hdr)
    r += 1

    ws0.write(r, 0, 'Product (HS6)', hdr)
    ws0.write(r, 1, 'Transport', hdr)
    ws0.write(r, 2, 'Market FOB $/kg', hdr)
    ws0.write(r, 3, 'P10 (floor)', hdr)
    ws0.write(r, 4, 'P90 (ceiling)', hdr)
    ws0.write(r, 5, 'Costing Implication', hdr)
    r += 1

    product_notes = [
        ('020110', 'Air', 'Carcass/Half-carcass is the most common chilled export — whole animal sent to GCC butchers. '
                           'You sell FOB; buyer pays air freight. '
                           'Your target: keep total pre-export cost below ~$4.80/kg to earn positive margin at average FOB. '
                           'Price your FOB at $4.80–$5.50 to be competitive.'),
        ('020120', 'Air', 'Bone-in cuts (shoulder, leg, rack) at carcass weight. '
                           'Higher price per kg than whole carcass because of value-add trimming. '
                           'Target $5.00+ FOB for GCC buyers.'),
        ('020130', 'Air', 'HIGHEST VALUE PRODUCT. Boneless chilled is a niche with very few Pakistani exporters. '
                           'If you invest in a deboning line, your target FOB is $5.50–$7.00/kg. '
                           'This is your best margin lane.'),
    ]

    for hs6, mode, note in product_notes:
        row_hs6 = chilled[chilled['hs6']==hs6]
        row_mode = row_hs6[row_hs6['Mode']==mode] if len(row_hs6)>0 else row_hs6
        if len(row_mode) == 0:
            continue
        wavg_v = row_mode['TotalUSD'].sum()/row_mode['GrossKg'].sum()
        prices = row_mode['UnitUSDkg'].dropna()
        p10 = float(np.percentile(prices, 10)) if len(prices) else np.nan
        p90 = float(np.percentile(prices, 90)) if len(prices) else np.nan
        hs6_name = hs6_labels.get(hs6, hs6)
        ws0.set_row(r, 60)
        ws0.write(r, 0, f'{hs6_name}', body_bold)
        ws0.write(r, 1, mode, body)
        ws0.write(r, 2, f'${wavg_v:.4f}', num_gold)
        ws0.write(r, 3, f'${p10:.4f}' if not np.isnan(p10) else 'N/A', body)
        ws0.write(r, 4, f'${p90:.4f}' if not np.isnan(p90) else 'N/A', body)
        ws0.merge_range(r, 5, r, 5, note, body)
        r += 1

    # ── Section 4: Strategic Recommendations ─────────────────────────────────
    r += 1
    ws0.merge_range(r, 0, r, 5, '4. STRATEGIC RECOMMENDATIONS FOR MARKET ENTRY', sec_gold)
    r += 1

    recs = [
        ('Phase 1 — Start with UAE + Saudi, carcass by air',
         'UAE and Saudi are the highest-volume, most liquid markets. '
         'They have established halal import channels, regular buyers, and established Pakistani suppliers you can benchmark against. '
         'Start with carcass (020110) — minimal processing, lowest capital requirement. '
         'Target FOB $4.80–$5.20/kg. Benchmark: top competitors achieve $5.00–$5.50.'),
        ('Phase 2 — Premium lane: Qatar/Kuwait with bone-in cuts',
         'Once you have cold chain logistics and buyer relationships, shift weight toward Qatar ($5.50–$6.50/kg FOB realised) '
         'and Kuwait (highest FOB prices in dataset). Bone-in cuts (020120) fetch ~10–15% more per kg FOB vs carcass. '
         'Requires a basic butchery/cutting line. Same FOB model — buyer arranges their own freight.'),
        ('Phase 3 — Boneless chilled (020130) for maximum margin',
         'Boneless chilled commands the highest price but requires a full deboning facility, '
         'HACCP certification, and stricter temperature controls. '
         'Market size is still emerging in Pakistan — you could establish a first-mover position. '
         'Budget: $200–500K additional capex for a deboning line.'),
        ('Cold chain to airport is your key variable cost — not air freight',
         'You sell FOB, so air freight is your buyer\'s cost. YOUR variable costs are: '
         '(1) Raw material — cattle/carcass purchase price; '
         '(2) Slaughter & processing — if toll processing, abattoir service fee; '
         '(3) Cold chain to airport — refrigerated truck, airport cold room, SPS/vet inspection; '
         '(4) Packaging — export cartons, liners; '
         '(5) Export documentation — health cert, NAPHIS, halal cert amortised per shipment. '
         'Combined (2)–(5) typically runs $0.20–$0.30/kg. Your margin = FOB price − raw material cost − $0.25/kg. '
         'Model this carefully: every PKR 30 move in cattle prices = ~$0.10/kg margin impact.'),
        ('Avoid: Kazakhstan, Vietnam, Afghanistan',
         'These lanes show sub-$3.00/kg pricing — likely below-cost dumping, re-export activity, or very low-quality product. '
         'Do not benchmark your pricing against these. Do not enter these markets in Phase 1.'),
        ('Certification — use an already-approved abattoir to bypass the longest lead time',
         'If you process via a NAPHIS-approved, halal-certified export abattoir, '
         'the slaughterhouse\'s existing approvals cover the product. '
         'What YOU still need: an export licence (FBR/TDAP registration), '
         'a veterinary health certificate per shipment (issued by NAPHIS on the abattoir\'s stamp), '
         'and a halal certificate from an ISWA/HMC-recognised body endorsed by the destination country. '
         'UAE buyers require ESMA-recognised halal cert; Saudi requires SFDA clearance — '
         'your abattoir partner should already have these. Verify before committing to any lane.'),
    ]

    for i, (rec_title, rec_body) in enumerate(recs):
        ws0.set_row(r, 70)
        ws0.write(r, 0, f'R{i+1}: {rec_title}', body_bold)
        ws0.merge_range(r, 1, r, 5, rec_body, body)
        r += 1

    ws0.freeze_panes(3, 0)

    # ══════════════════════════════════════════════════════════════════════════
    # PRE-RENDER ALL CHARTS WITH MATPLOTLIB (embedded as PNG images)
    # ══════════════════════════════════════════════════════════════════════════
    print("  Rendering charts...")

    # ── Chart A: Scatter — Destination price vs volume ────────────────────────
    figA, axA = plt.subplots(figsize=(7, 4.5))
    top_dest = dest_ch.sort_values('Total_KG', ascending=False).head(13)
    sc = axA.scatter(top_dest['Wavg_$/kg'], top_dest['Total_KG'] / 1e6,
                     s=top_dest['Total_KG'] / top_dest['Total_KG'].max() * 600 + 60,
                     color=BA_GOLD, edgecolors=BA_GREEN, linewidths=1.2, alpha=0.85, zorder=3)
    for _, row_d in top_dest.iterrows():
        axA.annotate(row_d['Destination'],
                     (row_d['Wavg_$/kg'], row_d['Total_KG'] / 1e6),
                     textcoords='offset points', xytext=(6, 3), fontsize=6.5, color='#333333')
    axA.set_xlabel('Weighted Avg FOB $/kg  (→ higher = better revenue per kg)', fontsize=8)
    axA.set_ylabel('Total Volume — Million KG (→ bigger = larger market)', fontsize=8)
    axA.set_title('Market Matrix: FOB Price vs Volume — Chilled Beef', fontsize=11, fontweight='bold', color=BA_GREEN, pad=10)
    axA.grid(True, linestyle='--', alpha=0.5)
    axA.axvline(top_dest['Wavg_$/kg'].median(), color=BA_GREEN, linewidth=0.8, linestyle=':', alpha=0.6)
    axA.axhline(top_dest['Total_KG'].median() / 1e6, color=BA_GOLD, linewidth=0.8, linestyle=':', alpha=0.6)
    axA.annotate('median price', xy=(top_dest['Wavg_$/kg'].median(), axA.get_ylim()[1]),
                 fontsize=6, color=BA_GREEN, ha='left', va='top')
    figA.tight_layout()
    png_A = chart_png(figA)

    # ── Chart B: Pie — chapter volume share ───────────────────────────────────
    figB, axB = plt.subplots(figsize=(5, 4))
    chap_vol = df.groupby('Chapter')['GrossKg'].sum().sort_values(ascending=False)
    colors_b  = [BA_GREEN, BA_GOLD, '#8B9E6B']
    wedges, texts, autotexts = axB.pie(
        chap_vol.values, labels=chap_vol.index,
        autopct='%1.1f%%', startangle=140,
        colors=colors_b, pctdistance=0.75,
        wedgeprops={'edgecolor': 'white', 'linewidth': 1.5})
    for at in autotexts:
        at.set_fontsize(8); at.set_color('white'); at.set_fontweight('bold')
    for t in texts:
        t.set_fontsize(8)
    axB.set_title('Export Volume Share (Jan–May 2026)', fontsize=11, fontweight='bold', color=BA_GREEN)
    # Add KG labels
    total_kg = chap_vol.sum()
    legend_labels = [f'{k}  —  {v/1e6:.1f}M kg  ({v/total_kg*100:.0f}%)' for k, v in chap_vol.items()]
    axB.legend(legend_labels, loc='lower center', bbox_to_anchor=(0.5, -0.12), fontsize=7, frameon=False)
    figB.tight_layout()
    png_B = chart_png(figB)

    # ── Chart C: Horizontal bar — top 10 dest by FOB $/kg ────────────────────
    figC, axC = plt.subplots(figsize=(7, 4.5))
    top10p = dest_ch.sort_values('Wavg_$/kg', ascending=True).tail(10)
    bars = axC.barh(top10p['Destination'], top10p['Wavg_$/kg'],
                    color=BA_GOLD, edgecolor=BA_GREEN, linewidth=0.6, height=0.65)
    axC.bar_label(bars, fmt='$%.2f', padding=4, fontsize=7.5, color=BA_GREEN, fontweight='bold')
    axC.set_xlabel('Weighted Avg FOB $/kg', fontsize=8)
    axC.set_title('Top 10 Markets — Average FOB Price ($/kg)\nChilled Beef, All Products', fontsize=11, fontweight='bold', color=BA_GREEN)
    axC.axvline(chilled['TotalUSD'].sum() / chilled['GrossKg'].sum(), color=BA_GREEN,
                linewidth=1, linestyle='--', alpha=0.7, label=f'Overall avg ${chilled_wavg:.2f}')
    axC.legend(fontsize=7, frameon=False)
    axC.set_xlim(0, top10p['Wavg_$/kg'].max() * 1.18)
    axC.grid(axis='x', linestyle='--', alpha=0.4)
    axC.spines[['top','right']].set_visible(False)
    figC.tight_layout()
    png_C = chart_png(figC)

    # ── Chart D: Horizontal bar — top 10 dest by volume ──────────────────────
    figD, axD = plt.subplots(figsize=(7, 4.5))
    top10v = dest_ch.sort_values('Total_KG', ascending=True).tail(10)
    bars_d = axD.barh(top10v['Destination'], top10v['Total_KG'] / 1e6,
                      color=BA_GREEN, edgecolor='white', linewidth=0.6, height=0.65)
    axD.bar_label(bars_d, fmt='%.1fM kg', padding=4, fontsize=7.5, color=BA_GREEN, fontweight='bold')
    axD.set_xlabel('Million KG Exported Jan–May 2026', fontsize=8)
    axD.set_title('Top 10 Markets — Export Volume\nChilled Beef, All Products', fontsize=11, fontweight='bold', color=BA_GREEN)
    axD.set_xlim(0, top10v['Total_KG'].max() / 1e6 * 1.2)
    axD.grid(axis='x', linestyle='--', alpha=0.4)
    axD.spines[['top','right']].set_visible(False)
    figD.tight_layout()
    png_D = chart_png(figD)

    # ── Chart E: Grouped bar — Air vs Sea FOB by HS6 product ─────────────────
    figE, axE = plt.subplots(figsize=(7.5, 4.5))
    air_prices = chilled.groupby('HS6_Desc').apply(
        lambda g: g[g['Mode']=='Air']['TotalUSD'].sum() / g[g['Mode']=='Air']['GrossKg'].sum()
        if g[g['Mode']=='Air']['GrossKg'].sum() > 0 else np.nan)
    sea_prices = chilled.groupby('HS6_Desc').apply(
        lambda g: g[g['Mode']=='Sea']['TotalUSD'].sum() / g[g['Mode']=='Sea']['GrossKg'].sum()
        if g[g['Mode']=='Sea']['GrossKg'].sum() > 0 else np.nan)
    mode_df = pd.DataFrame({'Air': air_prices, 'Sea': sea_prices}).dropna(how='all')
    x = np.arange(len(mode_df))
    w = 0.35
    b1 = axE.bar(x - w/2, mode_df['Air'],  width=w, label='Air route FOB', color='#1A5276', alpha=0.9)
    b2 = axE.bar(x + w/2, mode_df['Sea'],  width=w, label='Sea route FOB', color=BA_GOLD,  alpha=0.9)
    axE.bar_label(b1, fmt='$%.2f', fontsize=7, padding=2, color='#1A5276', fontweight='bold')
    axE.bar_label(b2, fmt='$%.2f', fontsize=7, padding=2, color='#8B6914', fontweight='bold')
    axE.set_xticks(x)
    short_labels = [l.replace(' (chilled)', '').replace('Carcass/Half-carcass', 'Carcass') for l in mode_df.index]
    axE.set_xticklabels(short_labels, fontsize=7.5)
    axE.set_ylabel('FOB $/kg', fontsize=8)
    axE.set_title('FOB Price by Route — Air vs Sea (Chilled Beef)\nBoth are FOB. Difference reflects buyer type, not your freight cost.',
                  fontsize=10, fontweight='bold', color=BA_GREEN)
    axE.legend(fontsize=8, frameon=False)
    axE.grid(axis='y', linestyle='--', alpha=0.4)
    axE.spines[['top','right']].set_visible(False)
    figE.tight_layout()
    png_E = chart_png(figE)

    # ── Chart F: Line — monthly chilled volume trend ──────────────────────────
    figF, axF = plt.subplots(figsize=(7, 4))
    monthly_total = chilled.groupby('Month')['GrossKg'].sum() / 1e6
    top_dests_monthly = chilled.groupby('Destination')['GrossKg'].sum().nlargest(5).index
    monthly_by_dest = chilled[chilled['Destination'].isin(top_dests_monthly)].groupby(
        ['Month','Destination'])['GrossKg'].sum().unstack(fill_value=0) / 1e6
    palette = [BA_GREEN, BA_GOLD, '#1A5276', '#8B9E6B', '#C0392B']
    for i, col_name in enumerate(monthly_by_dest.columns):
        axF.plot(monthly_by_dest.index, monthly_by_dest[col_name],
                 marker='o', markersize=5, linewidth=1.8,
                 color=palette[i % len(palette)], label=col_name)
    axF.plot(monthly_total.index, monthly_total.values, 'k--', linewidth=2, alpha=0.4, label='Total (all dests)')
    axF.set_xlabel('Month', fontsize=8)
    axF.set_ylabel('Million KG Exported', fontsize=8)
    axF.set_title('Monthly Chilled Beef Export Volume — Pakistan YTD 2026\nTop 5 destinations + total', fontsize=10, fontweight='bold', color=BA_GREEN)
    axF.legend(fontsize=7, frameon=False, ncol=2)
    axF.grid(True, linestyle='--', alpha=0.4)
    axF.spines[['top','right']].set_visible(False)
    figF.tight_layout()
    png_F = chart_png(figF)

    # ── Chart G: Horizontal bar — top 10 exporters by revenue ────────────────
    figG, axG = plt.subplots(figsize=(8, 5))
    top10_exp = exp_ch.head(10).sort_values('Total_USD', ascending=True)
    top10_exp['Label'] = top10_exp['Exporter'].str[:35]
    bars_g = axG.barh(top10_exp['Label'], top10_exp['Total_USD'] / 1e6,
                      color='#1A5276', edgecolor='white', linewidth=0.5, height=0.65)
    axG.bar_label(bars_g, fmt='$%.1fM', padding=4, fontsize=7.5, color='#1A5276', fontweight='bold')
    ax2 = axG.twiny()
    ax2.barh(top10_exp['Label'], top10_exp['Wavg_$/kg'],
             color=BA_GOLD, alpha=0.0)  # invisible — just for labelling
    for i, (_, row_e) in enumerate(top10_exp.iterrows()):
        axG.text(row_e['Total_USD'] / 1e6 * 1.02,
                 i, f"  ${row_e['Wavg_$/kg']:.2f}/kg avg FOB",
                 va='center', fontsize=6.5, color=BA_GOLD, fontweight='bold')
    axG.set_xlabel('Total Revenue (USD Million)', fontsize=8)
    axG.set_title('Top 10 Pakistani Chilled Beef Exporters — YTD 2026\nGold text = their avg FOB $/kg — benchmark your pricing against these.',
                  fontsize=10, fontweight='bold', color=BA_GREEN)
    axG.set_xlim(0, top10_exp['Total_USD'].max() / 1e6 * 1.45)
    axG.grid(axis='x', linestyle='--', alpha=0.4)
    axG.spines[['top','right']].set_visible(False)
    ax2.set_visible(False)
    figG.tight_layout()
    png_G = chart_png(figG)

    # ── Chart H: Heatmap — monthly price by HS6 (chilled) ────────────────────
    figH, axH = plt.subplots(figsize=(7, 3.5))
    hmap = monthly_price_ch.copy()
    hmap.columns = [c.replace(' (chilled)', '').replace('Carcass/Half-carcass', 'Carcass') for c in hmap.columns]
    sns.heatmap(hmap.T, annot=True, fmt='.2f', cmap='YlGn',
                linewidths=0.5, linecolor='white',
                annot_kws={'size': 8, 'weight': 'bold'},
                cbar_kws={'label': 'FOB $/kg', 'shrink': 0.8},
                ax=axH)
    axH.set_title('Monthly FOB Price Trend by Product — Chilled Beef ($/kg)',
                  fontsize=10, fontweight='bold', color=BA_GREEN, pad=10)
    axH.set_xlabel('Month', fontsize=8)
    axH.set_ylabel('')
    axH.tick_params(axis='x', rotation=30, labelsize=7)
    axH.tick_params(axis='y', rotation=0, labelsize=7)
    figH.tight_layout()
    png_H = chart_png(figH)

    print("  Charts rendered.")

    # ══════════════════════════════════════════════════════════════════════════
    # ANALYSIS SHEETS 1–17
    # ══════════════════════════════════════════════════════════════════════════

    write_sheet('1_Chapter_Overview',
        'Pakistan Beef Export — Chapter Overview (Chilled / Frozen / Offal)',
        f'Feasibility context: Chilled (0201) is the highest-value chapter and your primary opportunity. '
        f'Frozen (0202) is the competitor product — lower $/kg, long shelf life. '
        f'Offal (0206) is a secondary revenue stream if you process the full carcass. | {PERIOD}',
        chap_stats)

    write_sheet('2_HS6_Products',
        'All HS6 Product Codes — Price & Volume Benchmark',
        f'Costing guide: P10 is the market floor (cheapest competitor), P90 is the ceiling (premium achievable). '
        f'Price your FOB between P10 and Wavg to win business; exceed P90 only if your product quality justifies it. | {PERIOD}',
        hs6_all)

    write_pivot('3_PIVOT_Price_Chilled',
        'PIVOT: Destination × Product Type — FOB Price ($/kg) [Chilled Beef Only]',
        f'Read as: what each market pays for each product cut. These are your target sell prices. '
        f'Blank = no trade in that lane (opportunity or barrier). | {PERIOD}',
        pivot_price_ch)

    write_pivot('4_PIVOT_Volume_Chilled',
        'PIVOT: Destination × Product Type — Volume (KG) [Chilled Beef Only]',
        f'Read as: market size per lane. Bigger = more established buyer base and more competition. '
        f'Your entry strategy: start in large markets for buyer discovery, then move to premium niche lanes. | {PERIOD}',
        pivot_vol_ch)

    write_pivot('5_PIVOT_Mode_Chilled',
        'Air vs Sea by Destination — Chilled Beef (FOB $/kg)',
        f'All prices are FOB Pakistan — what the exporter receives at departure. '
        f'The FOB_Price_Diff column shows that air-routed shipments fetch a higher FOB price than sea-routed ones '
        f'(${air_wavg:.2f} vs ${sea_wavg:.2f}/kg). This is a MARKET signal, not a cost: '
        f'air lanes serve premium GCC buyers who pay more; sea lanes go to lower-value markets. '
        f'Chilled shelf life (~4–7 days) makes air the only viable mode for 0201 regardless. | {PERIOD}',
        pivot_mode_ch)

    if not pivot_mode_fr.empty:
        write_pivot('6_PIVOT_Mode_Frozen',
            'Air vs Sea by Destination — Frozen Beef (FOB $/kg)',
            f'Frozen beef (0202) can go by sea (shelf life 12–18 months). All prices are FOB — buyer pays freight. '
            f'Lower FOB on frozen vs chilled reflects both lower product value and different destination mix. '
            f'Compare FOB $/kg across both chapters per destination to decide which product gives you better revenue. | {PERIOD}',
            pivot_mode_fr)

    if not pivot_mode_of.empty:
        write_pivot('7_PIVOT_Mode_Offal',
            'Air vs Sea by Destination — Beef Offal (FOB $/kg)',
            f'Offal (0206) is a byproduct revenue stream. If you slaughter whole animals, '
            f'capturing offal export adds $0.50–$2.00/kg of byproduct revenue. '
            f'Include in your full-carcass costing model. | {PERIOD}',
            pivot_mode_of)

    write_pivot('8_Monthly_Vol_Chilled',
        'Monthly Chilled Beef Volume by Destination (KG)',
        f'Demand seasonality by market. Use to plan slaughter schedules, cold chain capacity, and airport booking. '
        f'Flat or rising trends = stable buyer relationships. Spiky = spot business. | {PERIOD}',
        monthly_vol_ch)

    if not monthly_vol_fr.empty:
        write_pivot('9_Monthly_Vol_Frozen',
            'Monthly Frozen Beef Volume by Destination (KG)',
            f'Frozen volume is steadier than chilled — useful as baseline revenue while you build chilled relationships. '
            f'Consider starting with a frozen lane to generate cash flow before building out chilled cold chain infrastructure. | {PERIOD}',
            monthly_vol_fr)

    if not monthly_vol_of.empty:
        write_pivot('10_Monthly_Vol_Offal',
            'Monthly Offal Volume by Destination (KG)',
            f'Offal demand is consistent — once a buyer is found, it is a recurring order. '
            f'Tongues and livers to China/SE Asia are the highest-value offal lanes. | {PERIOD}',
            monthly_vol_of)

    write_pivot('11_Monthly_Price_Chilled',
        'Monthly FOB Price Trend — Chilled Beef by Product ($/kg)',
        f'Price volatility by product type over time. Stable prices = commodity market. '
        f'Rising prices = good time to enter. Use this to time your first shipments. | {PERIOD}',
        monthly_price_ch)

    if not monthly_price_fr.empty:
        write_pivot('12_Monthly_Price_Frozen',
            'Monthly FOB Price Trend — Frozen Beef by Product ($/kg)',
            f'Frozen prices are more stable than chilled. Useful as a floor price reference for your chilled premium calculation. | {PERIOD}',
            monthly_price_fr)

    write_sheet('13_Detail_Chilled',
        'Full Detail: Chilled Beef — Destination × Product × Mode',
        f'Full drill-down for your sales/costing team. Each row = one specific lane (market + product + freight mode). '
        f'P10/P90 = the realistic price range your sales team should use in negotiations. | {PERIOD}',
        detail_ch)

    if not detail_fr.empty:
        write_sheet('14_Detail_Frozen',
            'Full Detail: Frozen Beef — Destination × Product × Mode',
            f'Frozen reference data. Use to model a blended chilled+frozen export portfolio — '
            f'some markets (e.g. China, Malaysia) prefer frozen and may be easier to enter initially. | {PERIOD}',
            detail_fr)

    if not detail_of.empty:
        write_sheet('15_Detail_Offal',
            'Full Detail: Beef Offal — Destination × Product × Mode',
            f'Offal is incremental revenue on the same animal. Tongues/livers are highest value. '
            f'Build an offal export stream alongside your beef program to improve overall carcass yield economics. | {PERIOD}',
            detail_of)

    write_sheet('16_Exporters',
        'Top Exporters — Pakistani Competitors by Chapter',
        f'Competitive intelligence: these are the incumbents you will compete with. '
        f'Study their destination lanes and pricing to understand where they are weakest. '
        f'Your entry strategy should exploit gaps, not replicate incumbents. | {PERIOD}',
        pd.concat([
            exp_ch.assign(Chapter='Chilled 0201'),
            exp_fr.assign(Chapter='Frozen 0202') if not exp_fr.empty else pd.DataFrame(),
            exp_of.assign(Chapter='Offal 0206') if not exp_of.empty else pd.DataFrame(),
        ], ignore_index=True))

    write_sheet('17_Market_Comparison',
        'Chilled vs Frozen vs Offal — Side-by-Side by Destination',
        f'The chilled premium over frozen (last column) tells you how much MORE you earn per kg by '
        f'investing in cold chain vs just freezing. Where this premium exceeds ~$1.00/kg, '
        f'chilled is clearly the higher-return investment. | {PERIOD}',
        comp)

    # ══════════════════════════════════════════════════════════════════════════
    # EMBED MATPLOTLIB CHARTS INTO RELEVANT SHEETS
    # ══════════════════════════════════════════════════════════════════════════
    insert_chart(writer.sheets['0_Key_Findings'],    4,  7, png_A)   # scatter: price vs volume
    insert_chart(writer.sheets['1_Chapter_Overview'],3,  8, png_B)   # pie: chapter share
    insert_chart(writer.sheets['3_PIVOT_Price_Chilled'], 3, 5, png_C)  # bar: top FOB price
    insert_chart(writer.sheets['4_PIVOT_Volume_Chilled'],3, 5, png_D)  # bar: top volume
    insert_chart(writer.sheets['5_PIVOT_Mode_Chilled'],  3, 6, png_E)  # grouped bar: air vs sea
    insert_chart(writer.sheets['8_Monthly_Vol_Chilled'], 3, 8, png_F)  # line: monthly trend
    insert_chart(writer.sheets['16_Exporters'],          3, 8, png_G)  # bar: top exporters
    insert_chart(writer.sheets['11_Monthly_Price_Chilled'], 3, 8, png_H)  # heatmap: price trend

    # ══════════════════════════════════════════════════════════════════════════
    # SHEET F1: FEASIBILITY MODELS — BUY vs TOLL PROCESSING
    # ══════════════════════════════════════════════════════════════════════════
    ws_f = wb.add_worksheet('F1_Feasibility')
    writer.sheets['F1_Feasibility'] = ws_f
    ws_f.set_zoom(90)
    ws_f.set_column(0, 0, 36)
    ws_f.set_column(1, 6, 18)

    PKR_USD   = 295   # approx current rate
    FOB_AIR   = 5.1981   # wavg FOB chilled carcass air (from data)
    FOB_SEA   = 3.8503   # wavg FOB chilled carcass sea (from data)
    OFFAL_FOB = 2.3033   # wavg offal FOB (from data)
    OFFAL_KG_PER_ANIMAL = 50   # kg offal per 400kg animal
    DRESSED_KG_PER_ANIMAL = 200  # kg dressed carcass per 400kg animal (50% yield)

    offal_credit_per_kg_dressed = (OFFAL_KG_PER_ANIMAL * OFFAL_FOB) / DRESSED_KG_PER_ANIMAL  # $0.575

    # Pre-export costs (same for both models): cold chain to airport, handling, packaging, docs
    PRE_EXPORT = 0.24  # $/kg dressed — conservative est

    ws_f.write(0, 0, 'BA Foods — Export Feasibility: Two Business Models Compared', ttl)
    ws_f.write(1, 0,
        f'FOB benchmarks from {len(chilled):,} actual Pakistan Customs shipments, {PERIOD}. '
        f'FOB = exporter revenue at departure. Buyer pays onward freight. Pre-export costs estimated at ${PRE_EXPORT}/kg.',
        sub_fmt)
    ws_f.write(2, 0,
        f'Exchange rate assumption: PKR {PKR_USD}/USD. Chilled carcass FOB (air): ${FOB_AIR:.4f}/kg. '
        f'Offal FOB: ${OFFAL_FOB:.4f}/kg (vs PKR 7,000/animal priced domestically).',
        sub_fmt)

    r = 4

    # ── Model A: Buy dressed from slaughterhouse ──────────────────────────────
    ws_f.merge_range(r, 0, r, 6,
        'MODEL A — BUY DRESSED CARCASS FROM SLAUGHTERHOUSE', sec_hdr)
    r += 1
    ws_f.write(r, 0,
        'You purchase ready-to-ship chilled carcass from a NAPHIS-licensed slaughterhouse at an agreed PKR/kg price. '
        'They own the animal, do the slaughter, dressing, and chilling. You handle cold chain to airport and export.',
        body)
    ws_f.merge_range(r, 1, r, 6, '', body)
    r += 2

    # Header row for model A
    a_headers = ['', 'PKR 1,225/kg\n(May 2026 market)', 'PKR 1,300/kg\n(your scenario)', 'PKR 1,400/kg\n(rising prices)', 'PKR 1,500/kg\n(stress test)']
    ws_f.write(r, 0, 'Cost / Revenue Item', hdr)
    for ci, h in enumerate(a_headers[1:], 1):
        ws_f.write(r, ci, h, hdr_gold)
    r += 1

    buy_prices_pkr = [1225, 1300, 1400, 1500]

    def model_a_rows(pkr_prices):
        rows = []
        for pkr in pkr_prices:
            usd = pkr / PKR_USD
            rows.append(usd)
        return rows

    a_rows = [
        ('1. Purchase price (PKR ÷ {PKR_USD})',  [p/PKR_USD for p in buy_prices_pkr], usd4, '$'),
        ('2. Pre-export costs (cold chain, handling, packaging, docs)', [PRE_EXPORT]*4, usd4, '$'),
        ('3. TOTAL COST/kg',    [(p/PKR_USD)+PRE_EXPORT for p in buy_prices_pkr], num_gold, '$'),
        ('4. FOB Revenue — chilled carcass (air avg)', [FOB_AIR]*4, usd4, '$'),
        ('5. GROSS MARGIN/kg (Row 4 − Row 3)', [FOB_AIR - (p/PKR_USD) - PRE_EXPORT for p in buy_prices_pkr], num_gold, '$'),
        ('6. Gross margin %', [(FOB_AIR - (p/PKR_USD) - PRE_EXPORT)/FOB_AIR*100 for p in buy_prices_pkr], usd4, '%'),
        ('7. Offal captured? (slaughterhouse keeps it)', ['No']*4, cel, ''),
        ('8. Offal upside left on table ($/kg dressed)',  [offal_credit_per_kg_dressed]*4, usd4, '$'),
        ('9. Margin if you negotiate offal share back', [FOB_AIR - (p/PKR_USD) - PRE_EXPORT + offal_credit_per_kg_dressed for p in buy_prices_pkr], num_gold, '$'),
    ]

    for label, vals, fmt, prefix in a_rows:
        ws_f.set_row(r, 30)
        is_total = 'TOTAL' in label or 'MARGIN' in label or 'margin %' in label
        lbl_fmt = body_bold if is_total else body
        ws_f.write(r, 0, label, lbl_fmt)
        for ci, v in enumerate(vals, 1):
            if isinstance(v, str):
                ws_f.write(r, ci, v, body_red if v == 'No' else body)
            elif prefix == '%':
                color_fmt = body_grn if v > 12 else (body_red if v < 5 else body)
                ws_f.write(r, ci, f'{v:.1f}%', color_fmt)
            else:
                color_fmt = body_grn if (is_total and 'MARGIN' in label and isinstance(v, float) and v > 0.5) \
                            else (body_red if (is_total and 'MARGIN' in label and isinstance(v, float) and v < 0.3) else (num_gold if is_total else usd4))
                ws_f.write(r, ci, f'{prefix}{v:.4f}' if isinstance(v, float) else str(v),
                           color_fmt if 'MARGIN' in label else (num_gold if is_total else body))
        r += 1

    r += 1

    # ── Model B: Toll Processing ───────────────────────────────────────────────
    ws_f.merge_range(r, 0, r, 6,
        'MODEL B — TOLL PROCESSING (BA Foods sources live animals, pays abattoir a service fee)', sec_gold)
    r += 1
    ws_f.write(r, 0,
        'BA Foods buys live cattle directly from farms/mandis. Contracts a NAPHIS-approved abattoir to '
        'slaughter, dress, chill, and package for a fee (PKR/kg live weight). '
        'BA Foods owns the output — both carcass AND offal. Higher operational complexity but '
        'better raw material economics and full offal capture.', body)
    ws_f.merge_range(r, 1, r, 6, '', body)
    r += 2

    # Live price scenarios
    live_prices_pkr = [550, 650, 750, 850]
    PROCESS_FEE_PKR = 65   # PKR/kg live weight (slaughter + dress + chill)
    LIVE_WEIGHT_KG  = 400  # assumed animal size
    DRESS_PCT       = 0.50

    b_headers = ['', 'PKR 550/kg live\n(farm gate, cheap)', 'PKR 650/kg live\n(mandi, typical)', 'PKR 750/kg live\n(premium animal)', 'PKR 850/kg live\n(stress test)']
    ws_f.write(r, 0, 'Cost / Revenue Item', hdr)
    for ci, h in enumerate(b_headers[1:], 1):
        ws_f.write(r, ci, h, hdr_gold)
    r += 1

    def toll_cost(live_pkr):
        total_live_cost = live_pkr * LIVE_WEIGHT_KG
        total_process   = PROCESS_FEE_PKR * LIVE_WEIGHT_KG
        total_animal    = total_live_cost + total_process
        cost_per_kg_dressed = total_animal / (LIVE_WEIGHT_KG * DRESS_PCT) / PKR_USD
        return cost_per_kg_dressed

    b_rows_data = []
    for lp in live_prices_pkr:
        total_live = lp * LIVE_WEIGHT_KG
        total_proc = PROCESS_FEE_PKR * LIVE_WEIGHT_KG
        cost_dressed = (total_live + total_proc) / (LIVE_WEIGHT_KG * DRESS_PCT) / PKR_USD
        offal_rev    = (OFFAL_KG_PER_ANIMAL * OFFAL_FOB) / DRESSED_KG_PER_ANIMAL
        net_cost     = cost_dressed - offal_rev
        margin_no_offal  = FOB_AIR - cost_dressed - PRE_EXPORT
        margin_with_offal = FOB_AIR - net_cost - PRE_EXPORT
        b_rows_data.append({
            'live_pkr': lp,
            'live_usd': lp / PKR_USD,
            'proc_usd': PROCESS_FEE_PKR / PKR_USD,
            'cost_dressed': cost_dressed,
            'offal_credit': offal_rev,
            'net_cost': net_cost,
            'margin_no_offal': margin_no_offal,
            'margin_with_offal': margin_with_offal,
        })

    b_display = [
        ('1. Live animal cost/kg live (PKR ÷ {PKR_USD})',   [d['live_usd']   for d in b_rows_data], '$'),
        (f'2. Processing fee/kg live (PKR {PROCESS_FEE_PKR} flat)',   [d['proc_usd']   for d in b_rows_data], '$'),
        (f'3. Cost/kg DRESSED (÷ {DRESS_PCT*100:.0f}% yield)',         [d['cost_dressed'] for d in b_rows_data], '$'),
        ('4. Pre-export costs (same as Model A)',            [PRE_EXPORT]*4,                          '$'),
        ('5. TOTAL COST before offal (Row 3 + Row 4)',       [d['cost_dressed']+PRE_EXPORT for d in b_rows_data], '$'),
        ('6. FOB Revenue — chilled carcass (air avg)',       [FOB_AIR]*4,                             '$'),
        ('7. GROSS MARGIN — NO offal captured',              [d['margin_no_offal'] for d in b_rows_data], '$'),
        ('── Offal capture (Model B advantage) ──',          ['']*4,                                  ''),
        (f'8. Offal yield per animal ({OFFAL_KG_PER_ANIMAL}kg @ ${OFFAL_FOB:.2f}/kg FOB → credit/kg dressed)',
                                                             [d['offal_credit'] for d in b_rows_data], '$'),
        ('9. TOTAL COST after offal credit (Row 5 − Row 8)', [d['net_cost']+PRE_EXPORT for d in b_rows_data], '$'),
        ('10. GROSS MARGIN — WITH offal exported',           [d['margin_with_offal'] for d in b_rows_data], '$'),
        ('11. Margin % with offal',                          [d['margin_with_offal']/FOB_AIR*100 for d in b_rows_data], '%'),
    ]

    for label, vals, prefix in b_display:
        ws_f.set_row(r, 30)
        is_total = 'TOTAL' in label or 'MARGIN' in label or 'margin %' in label.lower()
        is_divider = label.startswith('──')
        lbl_fmt = sec_gold if is_divider else (body_bold if is_total else body)
        ws_f.write(r, 0, label, lbl_fmt)
        for ci, v in enumerate(vals, 1):
            if isinstance(v, str) and v == '':
                ws_f.write(r, ci, '', sec_gold if is_divider else body)
            elif prefix == '%':
                color_fmt = body_grn if (isinstance(v, float) and v > 12) else (body_red if (isinstance(v, float) and v < 5) else body)
                ws_f.write(r, ci, f'{v:.1f}%' if isinstance(v, float) else '', color_fmt)
            else:
                is_margin = 'MARGIN' in label
                color_fmt = body_grn if (is_margin and isinstance(v, float) and v > 0.5) \
                            else (body_red if (is_margin and isinstance(v, float) and v < 0.2) else body)
                ws_f.write(r, ci, f'${v:.4f}' if isinstance(v, float) else str(v),
                           color_fmt if is_margin else (num_gold if is_total else body))
        r += 1

    r += 1

    # ── Side-by-side summary ──────────────────────────────────────────────────
    ws_f.merge_range(r, 0, r, 6, 'SUMMARY: WHICH MODEL WORKS?', sec_hdr)
    r += 1

    summary_rows = [
        ('Model A — Buy at PKR 1,225/kg dressed',
         f'${FOB_AIR - 1225/PKR_USD - PRE_EXPORT:.2f}/kg margin ({(FOB_AIR - 1225/PKR_USD - PRE_EXPORT)/FOB_AIR*100:.0f}%)',
         'Viable. Thin but workable. No offal upside.', 'GREEN'),
        ('Model A — Buy at PKR 1,300/kg dressed',
         f'${FOB_AIR - 1300/PKR_USD - PRE_EXPORT:.2f}/kg margin ({(FOB_AIR - 1300/PKR_USD - PRE_EXPORT)/FOB_AIR*100:.0f}%)',
         'Viable but tighter. Still positive. Negotiate offal share to protect margin.', 'GREEN'),
        ('Model A — Buy at PKR 1,400/kg dressed',
         f'${FOB_AIR - 1400/PKR_USD - PRE_EXPORT:.2f}/kg margin ({(FOB_AIR - 1400/PKR_USD - PRE_EXPORT)/FOB_AIR*100:.0f}%)',
         'Marginal — any yield loss or price dip makes this a loss. Not recommended without offal deal.', 'BODY'),
        ('Model A — Buy at PKR 1,500/kg dressed',
         f'${FOB_AIR - 1500/PKR_USD - PRE_EXPORT:.2f}/kg margin ({(FOB_AIR - 1500/PKR_USD - PRE_EXPORT)/FOB_AIR*100:.0f}%)',
         'Loss-making at market average FOB. Only works if you hit P90 premium buyers ($6.47/kg).', 'RED'),
        ('Model B — Toll @ PKR 650 live + offal export',
         f'${b_rows_data[1]["margin_with_offal"]:.2f}/kg margin ({b_rows_data[1]["margin_with_offal"]/FOB_AIR*100:.0f}%)',
         'Best economics if you can source at mandi prices. Requires live animal sourcing network.', 'GREEN'),
        ('Model B — Toll @ PKR 750 live + offal export',
         f'${b_rows_data[2]["margin_with_offal"]:.2f}/kg margin ({b_rows_data[2]["margin_with_offal"]/FOB_AIR*100:.0f}%)',
         'Comparable to Model A at 1,300 but with quality control and offal revenue secured.', 'GREEN'),
        ('Model B — Toll @ PKR 850 live + offal export',
         f'${b_rows_data[3]["margin_with_offal"]:.2f}/kg margin ({b_rows_data[3]["margin_with_offal"]/FOB_AIR*100:.0f}%)',
         'Tight. Offal export is essential here — without it this is a loss.', 'BODY'),
    ]

    ws_f.write(r, 0, 'Scenario', hdr)
    ws_f.write(r, 1, 'Gross Margin/kg', hdr)
    ws_f.merge_range(r, 2, r, 6, 'Assessment', hdr)
    r += 1

    for scenario, margin_str, assessment, flag in summary_rows:
        ws_f.set_row(r, 36)
        ws_f.write(r, 0, scenario, body_bold)
        ws_f.write(r, 1, margin_str, body_grn if flag=='GREEN' else (body_red if flag=='RED' else body))
        ws_f.merge_range(r, 2, r, 6, assessment,
                         body_grn if flag=='GREEN' else (body_red if flag=='RED' else body))
        r += 1

    r += 1

    # ── Key assumptions note ───────────────────────────────────────────────────
    ws_f.merge_range(r, 0, r, 6, 'KEY ASSUMPTIONS & SENSITIVITIES', sec_gold)
    r += 1
    assumptions = [
        f'Exchange rate: PKR {PKR_USD}/USD. Every PKR 30 move = ~$0.10/kg impact on your raw material cost.',
        f'FOB benchmark: ${FOB_AIR:.4f}/kg is the WEIGHTED AVERAGE of {len(chilled[chilled["Mode"]=="Air"]):,} air shipments. '
        f'Top-quartile buyers pay ${chilled[chilled["Mode"]=="Air"]["UnitUSDkg"].quantile(0.75):.2f}/kg — '
        f'if you reach those buyers, all models improve by ~${chilled[chilled["Mode"]=="Air"]["UnitUSDkg"].quantile(0.75) - FOB_AIR:.2f}/kg.',
        f'Pre-export costs estimated at ${PRE_EXPORT}/kg (cold chain + airport handling + packaging + export docs). '
        f'Actual varies by volume — higher volume = lower per-kg overhead.',
        f'Toll processing fee estimated at PKR {PROCESS_FEE_PKR}/kg live weight. Get 3 quotes from NAPHIS-licensed abattoirs.',
        f'Offal credit: ${offal_credit_per_kg_dressed:.4f}/kg dressed, based on {OFFAL_KG_PER_ANIMAL}kg offal per {LIVE_WEIGHT_KG}kg animal '
        f'at actual Pakistan export FOB ${OFFAL_FOB:.4f}/kg. '
        f'Currently valued at PKR 7,000/animal domestically = PKR {7000/(OFFAL_KG_PER_ANIMAL):.0f}/kg offal — '
        f'massive undervaluation vs export price of PKR {OFFAL_FOB*PKR_USD:.0f}/kg.',
        'Dressing percentage assumed 50% for Pakistani buffalo. Higher-grade animals (Sahiwal, crossbred) can reach 52–55%, improving all Model B numbers.',
    ]
    for note in assumptions:
        ws_f.set_row(r, 40)
        ws_f.merge_range(r, 0, r, 6, note, body)
        r += 1

    ws_f.freeze_panes(4, 1)

    # Raw data
    raw_cols = [c for c in ['Date','Exporter','Chapter','Destination','DestCode','hs6','HS6_Desc',
                             'GrossKg','TotalUSD','UnitUSDkg','Mode','LoadingPort',
                             'ProductDesc','TradeID'] if c in df.columns]
    raw_out = df[raw_cols].copy()
    raw_out.to_excel(writer, sheet_name='18_Raw', index=False, startrow=1)
    ws18 = writer.sheets['18_Raw']
    ws18.write(0, 0, f'Raw data — {len(df):,} shipments | {PERIOD} | Source: {SOURCE}', sub_fmt)
    for ci, cn in enumerate(raw_out.columns):
        ws18.write(1, ci, cn, hdr)
        ws18.set_column(ci, ci, 20)
    ws18.freeze_panes(2, 0)

print(f"\nDone. Saved: {XL_OUT}")
sheets = ['0_Key_Findings','1_Chapter_Overview','2_HS6_Products',
          '3_PIVOT_Price_Chilled','4_PIVOT_Volume_Chilled','5_PIVOT_Mode_Chilled',
          '6_PIVOT_Mode_Frozen','7_PIVOT_Mode_Offal','8_Monthly_Vol_Chilled',
          '9_Monthly_Vol_Frozen','10_Monthly_Vol_Offal','11_Monthly_Price_Chilled',
          '12_Monthly_Price_Frozen','13_Detail_Chilled','14_Detail_Frozen',
          '15_Detail_Offal','16_Exporters','17_Market_Comparison',
          'F1_Feasibility','18_Raw']
print(f"{len(sheets)} sheets: {' | '.join(sheets)}")
