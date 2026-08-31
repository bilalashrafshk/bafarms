/**
 * Diet Formatting & Table Image Generator Utility
 * 
 * Provides:
 * 1. Canonical ingredient ordering across all pens (Wanda -> Silage -> Straw -> Potato -> Minerals -> Additives).
 * 2. Standardized ingredient display names e.g. "Wanda (Potato Max Wanda)".
 * 3. High-resolution HTML5 Canvas table image generator for WhatsApp sharing & visual preview.
 */

import { formatDate } from './formatDate';
import { formatKg } from '../components/TMRCalculator';

/**
 * Standardizes ingredient names to avoid confusion.
 * E.g. "Potato Max Wanda" -> "Wanda (Potato Max Wanda)"
 *      "Single Bag Wanda (W MGF)" -> "Wanda (Single Bag Wanda)"
 *      "Wheat Straw (Toori)" -> "Wheat Straw (Toori)"
 */
export function formatIngredientDisplayName(name, id = '') {
    if (!name && !id) return 'Unknown Ingredient';
    const raw = (name || id).trim();
    const lower = raw.toLowerCase();

    // Specific Wanda formulations
    if (lower.includes('potato max') || lower.includes('potatomax')) {
        return 'Wanda (Potato Max Wanda)';
    }
    if (lower.includes('single bag') || lower.includes('w mgf') || lower.includes('singlebag')) {
        return 'Wanda (Single Bag Wanda)';
    }
    if (lower.includes('steady state') || lower.includes('steadystate')) {
        return 'Wanda (Steady State Wanda)';
    }
    if (lower.includes('adaptation wanda')) {
        return 'Wanda (Adaptation Wanda)';
    }
    if (lower.includes('wanda') && !lower.startsWith('wanda (')) {
        // If it's a specific custom Wanda, wrap the variation
        if (lower !== 'wanda') {
            const cleanSub = raw.replace(/wanda/gi, '').trim();
            if (cleanSub) {
                return `Wanda (${cleanSub})`;
            }
        }
        return 'Wanda';
    }

    // Straw / Toori
    if (lower.includes('wheat straw') || lower.includes('toori') || lower === 'straw' || lower.includes('bhoosa')) {
        return 'Wheat Straw (Toori)';
    }

    // Silage
    if (lower === 'silage' || lower.includes('maize silage') || lower.includes('corn silage')) {
        return 'Maize Silage';
    }

    // Chari
    if (lower.includes('chari') || lower.includes('green fodder')) {
        return 'Chari (Green Fodder)';
    }

    // Cottonseed / Khal
    if (lower.includes('cottonseed') || lower.includes('khal') || lower.includes('csc')) {
        return 'Cottonseed Cake (Khal)';
    }

    // Maize Grain
    if (lower === 'maize' || lower.includes('maize grain') || lower.includes('corn grain')) {
        return 'Maize Grain';
    }

    // Gluten Feed
    if (lower.includes('gluten')) {
        return 'Maize Gluten Feed';
    }

    // Limestone / Minerals
    if (lower.includes('limestone') && lower.includes('mineral')) {
        return 'Limestone / Minerals';
    }
    if (lower.includes('limestone')) {
        return 'Limestone';
    }
    if (lower.includes('mineral pack') || lower.includes('mineralpack')) {
        return 'Mineral Pack';
    }
    if (lower === 'minerals' || lower.includes('mineral mix')) {
        return 'Minerals Premix';
    }

    // Sodium Bicarbonate / Meetha Soda
    if (lower.includes('bicarbonate') || lower.includes('meetha soda') || lower.includes('soda bicarb')) {
        return 'Sodium Bicarbonate (Meetha Soda)';
    }

    // Potato
    if (lower.includes('potato') && !lower.includes('wanda')) {
        return 'Potato (Aloo)';
    }

    // Urea
    if (lower.includes('urea')) {
        return 'Urea';
    }

    // Monensin
    if (lower.includes('monensin') || lower.includes('rumensin')) {
        return 'Monensin';
    }

    // Molasses
    if (lower.includes('molasses') || lower.includes('sheera')) {
        return 'Molasses (Sheera)';
    }

    // Clean up casing if untouched
    return raw;
}

/**
 * Returns a canonical numeric rank for an ingredient so all pens follow the exact same sequence:
 * 1. Wanda & Concentrates (10..19)
 * 2. Silage & Green Fodder (20..39)
 * 3. Straw & Dry Roughage (40..49)
 * 4. Tubers / Bulky Feeds (50..59)
 * 5. Molasses & Energy (60..69)
 * 6. Minerals & Buffers (70..89)
 * 7. Additives & Premixes (90..109)
 * 8. Other / Miscellaneous (110+)
 */
export function getIngredientSortRank(id = '', name = '') {
    const combined = `${id} ${name}`.toLowerCase();

    // 1. Wanda & Concentrates
    if (combined.includes('wanda')) return 10;
    if (combined.includes('maize grain') || combined.includes('corn grain') || combined === 'maize') return 12;
    if (combined.includes('gluten')) return 14;
    if (combined.includes('cottonseed') || combined.includes('khal') || combined.includes('csc')) return 16;
    if (combined.includes('grain') || combined.includes('bran') || combined.includes('chopper') || combined.includes('meal')) return 18;

    // 2. Forages & Silage
    if (combined.includes('silage')) return 20;
    if (combined.includes('chari') || combined.includes('fodder') || combined.includes('lucerne') || combined.includes('barseem') || combined.includes('grass')) return 30;

    // 3. Straw & Dry Roughage
    if (combined.includes('straw') || combined.includes('toori') || combined.includes('bhoosa') || combined.includes('hay')) return 40;

    // 4. Tubers / Succulent feeds
    if (combined.includes('potato') || combined.includes('aloo') || combined.includes('beet') || combined.includes('pulp')) return 50;

    // 5. Molasses & Syrups
    if (combined.includes('molasses') || combined.includes('sheera')) return 60;

    // 6. Minerals & Buffers
    if (combined.includes('limestone') || combined.includes('calcium') || combined.includes('dcp')) return 70;
    if (combined.includes('bicarbonate') || combined.includes('meetha soda') || combined.includes('buffer')) return 75;
    if (combined.includes('mineral') || combined.includes('salt') || combined.includes('premix')) return 80;

    // 7. Additives & Micro-ingredients
    if (combined.includes('urea')) return 90;
    if (combined.includes('monensin') || combined.includes('rumensin')) return 95;
    if (combined.includes('toxin') || combined.includes('yeast') || combined.includes('probiotic') || combined.includes('acidifier')) return 100;

    return 200;
}

/**
 * Comparator function to sort ingredient rows canonically and deterministically.
 */
export function compareIngredients(a, b) {
    const rankA = getIngredientSortRank(a.id, a.name);
    const rankB = getIngredientSortRank(b.id, b.name);
    if (rankA !== rankB) return rankA - rankB;

    const nameA = formatIngredientDisplayName(a.name || a.id, a.id);
    const nameB = formatIngredientDisplayName(b.name || b.id, b.id);
    return nameA.localeCompare(nameB);
}

/**
 * Sorts an array of ingredient objects according to the master canonical order.
 */
export function sortIngredientsCanonical(ingredients = []) {
    if (!Array.isArray(ingredients)) return [];
    return [...ingredients].sort(compareIngredients);
}

/**
 * Renders a crisp, Retina-scaled visual Diet Matrix Table onto an HTML5 Canvas.
 * 
 * @param {Object} options
 * @param {string} options.dateStr - ISO Date string (YYYY-MM-DD)
 * @param {string} options.sessionLabel - Shift description e.g. "Morning Feeding (50%)" or "Full Day (100%)"
 * @param {Array}  options.penDataList - Array of pen batch objects:
 *      {
 *         penId: 'A',
 *         headCount: 25,
 *         avgWeight: 220,
 *         planName: 'Potato Max',
 *         totalBatchWeight: 525.0,
 *         ingredients: [ { id, name, wetBatch, wetSingle, scaleSession } ]
 *      }
 * @param {Array}  options.masterIngredientsList - Canonical unified list of all ingredients across all pens:
 *      [ { id, name, totalFarmBatch, avgPerHead } ]
 * @param {number} options.grandTotalWeight - Total farm feeding weight (kg)
 * @param {number} options.grandTotalAnimals - Total herd headcount
 * @returns {HTMLCanvasElement} The rendered canvas
 */
export function generateDietTableCanvas({
    dateStr,
    sessionLabel = 'Full Day Diet (100%)',
    isSymmetricMorningEvening = false,
    penDataList = [],
    masterIngredientsList = [],
    grandTotalWeight = 0,
    grandTotalAnimals = 0
}) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    // Layout configuration (in CSS pixels, scaled by 2 for Retina sharpness)
    const scale = 2;
    const isSinglePen = penDataList.length === 1;

    const paddingX = 24;
    const paddingTop = 28;
    const paddingBottom = 24;
    const headerHeight = 85;
    const tableHeaderHeight = 44;
    const rowHeight = 36;
    const footerHeight = 45;

    // Column widths
    const ingColWidth = isSinglePen ? 260 : 220;
    const penColWidth = isSinglePen ? 160 : Math.max(100, Math.min(135, Math.floor(650 / (penDataList.length || 1))));
    const totalColWidth = isSinglePen ? 160 : 130;
    const avgColWidth = isSinglePen ? 0 : 115;

    const tableWidth = ingColWidth + (penDataList.length * penColWidth) + (isSinglePen ? (penColWidth) : (totalColWidth + avgColWidth));
    const totalWidth = Math.max(720, tableWidth + (paddingX * 2));

    const totalRowsCount = masterIngredientsList.length + 3; // ingredients + Total Batch + Headcount + Avg Weight
    const tableTotalHeight = tableHeaderHeight + (totalRowsCount * rowHeight);
    const totalHeight = paddingTop + headerHeight + tableTotalHeight + footerHeight + paddingBottom;

    // Canvas physical size (scaled for high DPI)
    canvas.width = totalWidth * scale;
    canvas.height = totalHeight * scale;
    canvas.style.width = `${totalWidth}px`;
    canvas.style.height = `${totalHeight}px`;

    ctx.scale(scale, scale);

    // --- 1. Background (Obsidian & Farm Emerald Gradient) ---
    const bgGradient = ctx.createLinearGradient(0, 0, 0, totalHeight);
    bgGradient.addColorStop(0, '#0f1713');
    bgGradient.addColorStop(1, '#070b09');
    ctx.fillStyle = bgGradient;
    ctx.fillRect(0, 0, totalWidth, totalHeight);

    // Outer subtle border
    ctx.strokeStyle = '#1e3328';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(8, 8, totalWidth - 16, totalHeight - 16);

    // --- 2. Header Section ---
    let curY = paddingTop;

    // Logo / Farm Brand
    ctx.fillStyle = '#25D366';
    ctx.font = 'bold 18px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillText('BA FARMS', paddingX, curY + 18);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '500 12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillText('FEEDLOT PRECISION MANAGEMENT • TMR MIXING SHEET', paddingX, curY + 36);

    // Shift Badge on Top Right
    const isMorning = sessionLabel.toLowerCase().includes('morning');
    const shiftBadgeText = (isSymmetricMorningEvening && isMorning)
        ? '🌅 MORNING (50%) • SAME FOR EVENING'
        : sessionLabel.toUpperCase();
    ctx.font = 'bold 12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    const badgeMetrics = ctx.measureText(shiftBadgeText);
    const badgeWidth = badgeMetrics.width + 24;
    const badgeHeight = 28;
    const badgeX = totalWidth - paddingX - badgeWidth;
    const badgeY = curY + 6;

    ctx.fillStyle = 'rgba(37, 211, 102, 0.15)';
    ctx.strokeStyle = '#25D366';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(badgeX, badgeY, badgeWidth, badgeHeight, 6);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#4ade80';
    ctx.fillText(shiftBadgeText, badgeX + 12, badgeY + 18);


    // Date & Summary Subline
    curY += 56;
    ctx.fillStyle = '#e2e8f0';
    ctx.font = '600 13px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    const formattedDateText = `📅 ${formatDate(dateStr || new Date().toISOString().split('T')[0])}`;
    ctx.fillText(formattedDateText, paddingX, curY);

    const herdSummaryText = `Total Herd: ${grandTotalAnimals} Head across ${penDataList.length} Pen${penDataList.length === 1 ? '' : 's'} | Total Batch: ${grandTotalWeight.toFixed(1)} kg`;
    const herdMetrics = ctx.measureText(herdSummaryText);
    ctx.fillStyle = '#cbd5e1';
    ctx.font = '500 12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillText(herdSummaryText, totalWidth - paddingX - herdMetrics.width, curY);

    // Divider
    curY += 16;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.beginPath();
    ctx.moveTo(paddingX, curY);
    ctx.lineTo(totalWidth - paddingX, curY);
    ctx.stroke();

    // --- 3. Table Headers ---
    curY += 12;
    const tableStartX = paddingX;
    const startY = curY;

    // Header Background
    ctx.fillStyle = '#16231d';
    ctx.fillRect(tableStartX, startY, tableWidth, tableHeaderHeight);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.strokeRect(tableStartX, startY, tableWidth, tableHeaderHeight);

    let colX = tableStartX;

    // Col 1: Ingredients
    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillText('INGREDIENTS', colX + 12, startY + 26);
    colX += ingColWidth;

    // Pen Columns
    penDataList.forEach(pen => {
        // Vertical divider
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
        ctx.beginPath();
        ctx.moveTo(colX, startY);
        ctx.lineTo(colX, startY + tableHeaderHeight);
        ctx.stroke();

        ctx.fillStyle = '#38bdf8';
        ctx.font = 'bold 12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        const title = isSinglePen ? `PEN ${pen.penId}` : `PEN ${pen.penId}`;
        ctx.fillText(title, colX + 10, startY + 18);

        ctx.fillStyle = '#94a3b8';
        ctx.font = '500 10px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        const sub = `${pen.headCount || 0} hd${pen.avgWeight ? ` • ${Math.round(pen.avgWeight)}kg` : ''}`;
        ctx.fillText(sub, colX + 10, startY + 34);

        colX += penColWidth;
    });

    if (isSinglePen) {
        // Single pen mode has a "Per Head" column
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
        ctx.beginPath();
        ctx.moveTo(colX, startY);
        ctx.lineTo(colX, startY + tableHeaderHeight);
        ctx.stroke();

        ctx.fillStyle = '#fbbf24';
        ctx.font = 'bold 12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        ctx.fillText('RATE / HEAD', colX + 10, startY + 26);
        colX += penColWidth;
    } else {
        // Multi-pen mode: Total Farm Sum & Herd Avg
        // Total Col
        ctx.fillStyle = 'rgba(37, 211, 102, 0.12)';
        ctx.fillRect(colX, startY, totalColWidth, tableHeaderHeight);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
        ctx.strokeRect(colX, startY, totalColWidth, tableHeaderHeight);

        ctx.fillStyle = '#4ade80';
        ctx.font = 'bold 12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        ctx.fillText('TOTAL FARM', colX + 10, startY + 18);
        ctx.fillStyle = '#86efac';
        ctx.font = '500 10px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        ctx.fillText('(SUM kg)', colX + 10, startY + 34);
        colX += totalColWidth;

        // Herd Avg Col
        ctx.fillStyle = 'rgba(56, 189, 248, 0.12)';
        ctx.fillRect(colX, startY, avgColWidth, tableHeaderHeight);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
        ctx.strokeRect(colX, startY, avgColWidth, tableHeaderHeight);

        ctx.fillStyle = '#38bdf8';
        ctx.font = 'bold 12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        ctx.fillText('HERD AVG', colX + 10, startY + 18);
        ctx.fillStyle = '#7dd3fc';
        ctx.font = '500 10px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        ctx.fillText('(kg / head)', colX + 10, startY + 34);
        colX += avgColWidth;
    }

    // --- 4. Ingredient Rows (Canonical Master Order) ---
    curY = startY + tableHeaderHeight;

    masterIngredientsList.forEach((ing, rowIdx) => {
        const isAlt = rowIdx % 2 === 1;
        ctx.fillStyle = isAlt ? 'rgba(255, 255, 255, 0.02)' : 'rgba(0, 0, 0, 0.2)';
        ctx.fillRect(tableStartX, curY, tableWidth, rowHeight);

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
        ctx.strokeRect(tableStartX, curY, tableWidth, rowHeight);

        let rowColX = tableStartX;

        // Ingredient Name
        const formattedName = formatIngredientDisplayName(ing.name || ing.id, ing.id);
        ctx.fillStyle = '#ffffff';
        ctx.font = '600 11.5px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        ctx.fillText(formattedName, rowColX + 12, curY + 22);
        rowColX += ingColWidth;

        // Pen Values
        penDataList.forEach(pen => {
            // Find this ingredient in this pen
            const penIng = pen.ingredients.find(i => i.id === ing.id || i.name?.toLowerCase() === ing.name?.toLowerCase());
            const qty = penIng ? (penIng.ingSessionBatch !== undefined ? penIng.ingSessionBatch : penIng.wetBatch) : 0;
            const isRestrictedOff = penIng && penIng.scaleSession === 0;

            ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
            ctx.beginPath();
            ctx.moveTo(rowColX, curY);
            ctx.lineTo(rowColX, curY + rowHeight);
            ctx.stroke();

            if (isRestrictedOff) {
                ctx.fillStyle = '#64748b';
                ctx.font = 'italic 10px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
                ctx.fillText('0.0 (PM)', rowColX + 10, curY + 22);
            } else if (qty > 0) {
                ctx.fillStyle = '#f1f5f9';
                ctx.font = '600 11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
                ctx.fillText(`${formatKg(qty, 1)} kg`, rowColX + 10, curY + 22);
            } else {
                ctx.fillStyle = '#475569';
                ctx.font = '500 11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
                ctx.fillText('-', rowColX + 14, curY + 22);
            }

            rowColX += penColWidth;
        });

        if (isSinglePen) {
            // Per head for single pen
            const singlePen = penDataList[0];
            const penIng = singlePen.ingredients.find(i => i.id === ing.id || i.name?.toLowerCase() === ing.name?.toLowerCase());
            const perHead = penIng ? (penIng.ingPerHead !== undefined ? penIng.ingPerHead : penIng.wetSingle) : 0;

            ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
            ctx.beginPath();
            ctx.moveTo(rowColX, curY);
            ctx.lineTo(rowColX, curY + rowHeight);
            ctx.stroke();

            ctx.fillStyle = '#fbbf24';
            ctx.font = '600 11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
            ctx.fillText(`${formatKg(perHead, 2)} kg/hd`, rowColX + 10, curY + 22);
            rowColX += penColWidth;
        } else {
            // Total Column
            ctx.fillStyle = 'rgba(37, 211, 102, 0.04)';
            ctx.fillRect(rowColX, curY, totalColWidth, rowHeight);
            ctx.strokeStyle = 'rgba(37, 211, 102, 0.2)';
            ctx.strokeRect(rowColX, curY, totalColWidth, rowHeight);

            ctx.fillStyle = '#4ade80';
            ctx.font = 'bold 11.5px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
            ctx.fillText(`${formatKg(ing.totalFarmBatch || 0, 1)} kg`, rowColX + 10, curY + 22);
            rowColX += totalColWidth;

            // Avg Column
            ctx.fillStyle = 'rgba(56, 189, 248, 0.04)';
            ctx.fillRect(rowColX, curY, avgColWidth, rowHeight);
            ctx.strokeStyle = 'rgba(56, 189, 248, 0.2)';
            ctx.strokeRect(rowColX, curY, avgColWidth, rowHeight);

            ctx.fillStyle = '#38bdf8';
            ctx.font = '600 11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
            ctx.fillText(`${formatKg(ing.avgPerHead || 0, 2)} kg`, rowColX + 10, curY + 22);
            rowColX += avgColWidth;
        }

        curY += rowHeight;
    });

    // --- 5. Total Batch Weight Row (Highlighted Emerald Banner) ---
    ctx.fillStyle = '#1e382b';
    ctx.fillRect(tableStartX, curY, tableWidth, rowHeight);
    ctx.strokeStyle = '#22c55e';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(tableStartX, curY, tableWidth, rowHeight);

    let totColX = tableStartX;
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillText('⚖️ TOTAL BATCH (kg)', totColX + 10, curY + 22);
    totColX += ingColWidth;

    penDataList.forEach(pen => {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
        ctx.beginPath();
        ctx.moveTo(totColX, curY);
        ctx.lineTo(totColX, curY + rowHeight);
        ctx.stroke();

        ctx.fillStyle = '#4ade80';
        ctx.font = 'bold 12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        ctx.fillText(`${formatKg(pen.totalBatchWeight || 0, 1)} kg`, totColX + 10, curY + 22);
        totColX += penColWidth;
    });

    if (isSinglePen) {
        const singlePen = penDataList[0];
        const avgHeadBatch = singlePen.headCount > 0 ? (singlePen.totalBatchWeight / singlePen.headCount) : 0;
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
        ctx.beginPath();
        ctx.moveTo(totColX, curY);
        ctx.lineTo(totColX, curY + rowHeight);
        ctx.stroke();

        ctx.fillStyle = '#fde047';
        ctx.font = 'bold 12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        ctx.fillText(`${formatKg(avgHeadBatch, 2)} kg/hd`, totColX + 10, curY + 22);
        totColX += penColWidth;
    } else {
        // Multi pen grand totals
        ctx.fillStyle = 'rgba(34, 197, 94, 0.2)';
        ctx.fillRect(totColX, curY, totalColWidth, rowHeight);
        ctx.strokeStyle = '#22c55e';
        ctx.strokeRect(totColX, curY, totalColWidth, rowHeight);

        ctx.fillStyle = '#86efac';
        ctx.font = 'bold 12.5px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        ctx.fillText(`${formatKg(grandTotalWeight, 1)} kg`, totColX + 10, curY + 22);
        totColX += totalColWidth;

        const grandAvgPerHead = grandTotalAnimals > 0 ? (grandTotalWeight / grandTotalAnimals) : 0;
        ctx.fillStyle = 'rgba(56, 189, 248, 0.15)';
        ctx.fillRect(totColX, curY, avgColWidth, rowHeight);
        ctx.strokeStyle = '#38bdf8';
        ctx.strokeRect(totColX, curY, avgColWidth, rowHeight);

        ctx.fillStyle = '#7dd3fc';
        ctx.font = 'bold 12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        ctx.fillText(`${formatKg(grandAvgPerHead, 2)} kg`, totColX + 10, curY + 22);
        totColX += avgColWidth;
    }

    curY += rowHeight;

    // --- 6. Summary Rows: Head Count & Avg Live Weight ---
    // Row 1: Headcount
    ctx.fillStyle = '#111c16';
    ctx.fillRect(tableStartX, curY, tableWidth, rowHeight);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.strokeRect(tableStartX, curY, tableWidth, rowHeight);

    let headColX = tableStartX;
    ctx.fillStyle = '#94a3b8';
    ctx.font = '600 11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillText('🐄 Herd Headcount', headColX + 12, curY + 22);
    headColX += ingColWidth;

    penDataList.forEach(pen => {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
        ctx.beginPath();
        ctx.moveTo(headColX, curY);
        ctx.lineTo(headColX, curY + rowHeight);
        ctx.stroke();

        ctx.fillStyle = '#e2e8f0';
        ctx.font = '600 11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        ctx.fillText(`${pen.headCount || 0} hd`, headColX + 10, curY + 22);
        headColX += penColWidth;
    });

    if (isSinglePen) {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
        ctx.beginPath();
        ctx.moveTo(headColX, curY);
        ctx.lineTo(headColX, curY + rowHeight);
        ctx.stroke();

        ctx.fillStyle = '#94a3b8';
        ctx.font = '500 11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        ctx.fillText('Active', headColX + 10, curY + 22);
        headColX += penColWidth;
    } else {
        ctx.fillStyle = '#e2e8f0';
        ctx.font = 'bold 11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        ctx.fillText(`${grandTotalAnimals} Head`, headColX + 10, curY + 22);
        headColX += totalColWidth;

        ctx.fillStyle = '#94a3b8';
        ctx.font = '500 11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        ctx.fillText('-', headColX + 14, curY + 22);
        headColX += avgColWidth;
    }

    curY += rowHeight;

    // Row 2: Avg Live Weight
    ctx.fillStyle = '#0d1511';
    ctx.fillRect(tableStartX, curY, tableWidth, rowHeight);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.strokeRect(tableStartX, curY, tableWidth, rowHeight);

    let wtColX = tableStartX;
    ctx.fillStyle = '#94a3b8';
    ctx.font = '600 11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillText('📊 Avg Live Weight', wtColX + 12, curY + 22);
    wtColX += ingColWidth;

    let totalWeightSum = 0;
    let weightedAnimalsSum = 0;

    penDataList.forEach(pen => {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
        ctx.beginPath();
        ctx.moveTo(wtColX, curY);
        ctx.lineTo(wtColX, curY + rowHeight);
        ctx.stroke();

        const penAvg = pen.avgWeight ? Math.round(pen.avgWeight) : null;
        if (penAvg && pen.headCount) {
            totalWeightSum += penAvg * pen.headCount;
            weightedAnimalsSum += pen.headCount;
        }

        ctx.fillStyle = '#e2e8f0';
        ctx.font = '600 11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        ctx.fillText(penAvg ? `${penAvg} kg` : '-', wtColX + 10, curY + 22);
        wtColX += penColWidth;
    });

    const farmWeightedAvgWt = weightedAnimalsSum > 0 ? Math.round(totalWeightSum / weightedAnimalsSum) : null;

    if (isSinglePen) {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
        ctx.beginPath();
        ctx.moveTo(wtColX, curY);
        ctx.lineTo(wtColX, curY + rowHeight);
        ctx.stroke();

        ctx.fillStyle = '#94a3b8';
        ctx.font = '500 11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        ctx.fillText('-', wtColX + 14, curY + 22);
        wtColX += penColWidth;
    } else {
        ctx.fillStyle = '#e2e8f0';
        ctx.font = 'bold 11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        ctx.fillText(farmWeightedAvgWt ? `${farmWeightedAvgWt} kg (Avg)` : '-', wtColX + 10, curY + 22);
        wtColX += totalColWidth;

        ctx.fillStyle = '#94a3b8';
        ctx.font = '500 11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        ctx.fillText('-', wtColX + 14, curY + 22);
        wtColX += avgColWidth;
    }

    curY += rowHeight;

    // --- 7. Footer Notice ---
    curY += 18;
    ctx.fillStyle = '#64748b';
    ctx.font = 'italic 11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    const footerNoticeText = (isSymmetricMorningEvening && isMorning)
        ? '📌 Note: Morning & Evening diets are identical (50/50 split). Prepare exact same batch for Evening.'
        : '📌 Note: Please zero/tare the mixer scale before loading ingredients.';
    ctx.fillText(footerNoticeText, paddingX, curY);

    const brandingText = 'BA Farms Feedlot Precision Management';
    const brandMetrics = ctx.measureText(brandingText);
    ctx.fillStyle = '#4ade80';
    ctx.font = '600 11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillText(brandingText, totalWidth - paddingX - brandMetrics.width, curY);


    return canvas;
}

/**
 * Generates a PNG Blob from the table canvas.
 */
export async function generateDietTableBlob(options) {
    const canvas = generateDietTableCanvas(options);
    return new Promise((resolve) => {
        canvas.toBlob((blob) => {
            resolve(blob);
        }, 'image/png');
    });
}

/**
 * Downloads the generated table canvas as a PNG file.
 */
export function downloadDietTableImage(options, filename = 'BA_Farms_Diet_Sheet.png') {
    const canvas = generateDietTableCanvas(options);
    const link = document.createElement('a');
    link.download = filename;
    link.href = canvas.toDataURL('image/png');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

/**
 * Copies a PNG Blob to the system clipboard.
 */
export async function copyImageBlobToClipboard(blob) {
    if (!navigator.clipboard || !window.ClipboardItem) {
        throw new Error('ClipboardItem API is not supported in this browser.');
    }
    await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': blob })
    ]);
}

