import pandas as pd
import re
import os

def analyze_importers():
    dir_path = os.path.dirname(os.path.abspath(__file__))
    csv_path = os.path.join(dir_path, "tendata_all_beef_exports_YTD2026_RAW.csv")
    
    if not os.path.exists(csv_path):
        print(f"Error: Raw CSV not found at {csv_path}")
        return
        
    df = pd.read_csv(csv_path, dtype={'HSCode': str, 'hs4': str, 'hs6': str})

    # GCC destinations
    gcc_dests = ['United Arab Emirates', 'Saudi Arabia', 'Kuwait', 'Qatar', 'Bahrain', 'Oman']
    df_gcc = df[df['Destination'].isin(gcc_dests)].copy()

    # Standardize importer names
    def standardize_importer(name):
        if not isinstance(name, str):
            return "UNKNOWN"
        name = name.upper().strip()
        name = re.sub(r'\s+', ' ', name)
        name = name.replace('.', '').replace(',', '')
        
        name = re.sub(r'\bLLC\b|\bL L C\b|\bSOLE PROPRIETORSHIP\b', 'LLC', name)
        name = re.sub(r'\bWLL\b|\bW L L\b|\bWLL DOHA QATAR\b', 'WLL', name)
        name = re.sub(r'\bEST\b|\bESTABLISHMENT\b', 'EST', name)
        name = re.sub(r'\bCO\b|\bCOMPANY\b', 'CO', name)
        name = re.sub(r'\bTRD\b|\bTRADING\b', 'TRADING', name)
        name = re.sub(r'\bGEN\b|\bGENERAL\b', 'GENERAL', name)
        
        # Consolidation mappings
        if "AL TAYEB MEAT" in name:
            return "AL TAYEB MEAT LLC"
        if "JAWEED CENTER" in name:
            return "JAWEED CENTER FOR WHOLESALE MEAT CO"
        if "AL ARQAB TRADING" in name:
            return "AL ARQAB TRADING"
        if "FAIR STAR FOOD" in name:
            return "FAIR STAR FOODSTUFF TRADING"
        if "MOHAMMAD TARIQ TRADING" in name or "MUHAMMAD TARIQ TRADING" in name:
            return "MUHAMMAD TARIQ TRADING CO WLL"
        if "NESTO HYPER" in name:
            return "NESTO HYPERMARKET LLC"
            
        name = re.sub(r'\bLLC LLC\b', 'LLC', name)
        return name.strip()

    df_gcc['Standardized_Importer'] = df_gcc['Importer'].apply(standardize_importer)

    # Output detailed report to markdown
    md_report = "# top beef importers in GCC/Middle East\n"
    md_report += "Derived from raw custom database: `tendata_all_beef_exports_YTD2026_RAW.csv` (Jan–May 2026 YTD)\n\n"
    
    # Summary table
    md_report += "## GCC Market Overview (Jan–May 2026 YTD)\n\n"
    md_report += "| Destination | Total Volume (KG) | Total Value (USD) | Shipments | Weighted Avg Price ($/kg) |\n"
    md_report += "| :--- | :---: | :---: | :---: | :---: |\n"
    
    total_gcc_kg = 0
    total_gcc_usd = 0
    total_gcc_ships = 0
    
    summary_rows = []
    for dest in gcc_dests:
        df_dest = df_gcc[df_gcc['Destination'] == dest]
        kg = df_dest['GrossKg'].sum()
        usd = df_dest['TotalUSD'].sum()
        ships = len(df_dest)
        wavg = usd / kg if kg > 0 else 0
        summary_rows.append((dest, kg, usd, ships, wavg))
        
        total_gcc_kg += kg
        total_gcc_usd += usd
        total_gcc_ships += ships
        
    for row in summary_rows:
        md_report += f"| **{row[0]}** | {row[1]:,.0f} | ${row[2]:,.2f} | {row[3]:,} | ${row[4]:.2f}/kg |\n"
    
    gcc_avg = total_gcc_usd / total_gcc_kg if total_gcc_kg > 0 else 0
    md_report += f"| **TOTAL GCC** | **{total_gcc_kg:,.0f}** | **${total_gcc_usd:,.2f}** | **{total_gcc_ships:,}** | **${gcc_avg:.2f}/kg** |\n\n"
    
    # Detailed Importers
    md_report += "## Top Importers by Country (based on Volume)\n"
    for dest in gcc_dests:
        df_dest = df_gcc[df_gcc['Destination'] == dest]
        country_total_kg = df_dest['GrossKg'].sum()
        
        imp_stats = df_dest.groupby('Standardized_Importer').agg(
            Total_KG=('GrossKg', 'sum'),
            Total_USD=('TotalUSD', 'sum'),
            Shipments=('Date', 'count')
        ).reset_index()
        imp_stats['Weighted_Avg_$/kg'] = imp_stats['Total_USD'] / imp_stats['Total_KG']
        imp_stats['Volume_Share_%'] = (imp_stats['Total_KG'] / country_total_kg) * 100
        
        top_imps = imp_stats.sort_values('Total_KG', ascending=False).head(10)
        
        md_report += f"\n### {dest}\n"
        md_report += f"Total country volume: {country_total_kg:,.0f} KG | Value: ${df_dest['TotalUSD'].sum():,.2f} | {len(df_dest):,} shipments\n\n"
        md_report += "| Importer | Volume (KG) | Value (USD) | Shipments | Weighted Price | Volume Share (%) |\n"
        md_report += "| :--- | :---: | :---: | :---: | :---: | :---: |\n"
        
        for _, r in top_imps.iterrows():
            md_report += f"| {r['Standardized_Importer']} | {r['Total_KG']:,.0f} | ${r['Total_USD']:,.2f} | {r['Shipments']:,} | ${r['Weighted_Avg_$/kg']:.2f}/kg | {r['Volume_Share_%']:.2f}% |\n"
            
    out_md = os.path.join(dir_path, "top_importers_gcc_YTD2026.md")
    with open(out_md, 'w') as f:
        f.write(md_report)
    print(f"Report written to: {out_md}")

if __name__ == "__main__":
    analyze_importers()
