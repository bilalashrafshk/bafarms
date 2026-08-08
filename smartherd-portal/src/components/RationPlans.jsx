import React, { useContext, useState } from 'react';
import { FarmContext } from '../context/FarmContext';

export default function RationPlans() {
    const {
        rationPlans, saveRationPlan, duplicateRationPlan, deleteRationPlan,
        rationPlansV2, rationRows, rationRowItems, importRationPlanCSV, updateRationPlanV2, updateRationRow,
        pens, savePen, deletePen, getPenRationRow,
        animals, feedIngredients, getIngredientStockPrice, addStockTrackedIngredient, staffUser
    } = useContext(FarmContext);

    // Herd Management access (admin-configurable in Settings) is the real gate for editing
    // diets — the "Internal Corporate Staff" role is just an email-domain login role, so it's
    // OR'd in for backward compatibility (matches FeedStock.jsx).
    const isAdmin = staffUser?.accessHerd === true || staffUser?.isAdmin === true;

    const [activeTab, setActiveTab] = useState('plans');

    // Only ingredients backed by a real feed-stock item can be scheduled into a Ration Plan —
    // that's what lets cost figures come straight from the purchase ledger instead of a
    // manually-typed number that can drift from reality. Legacy untracked ingredients (from
    // before this existed) still display wherever they're already in use, priced at whatever
    // static value they were last saved with.
    const stockTrackedIngredients = feedIngredients.filter(i => getIngredientStockPrice(i.id) !== null);

    const [isAddIngredientFormOpen, setIsAddIngredientFormOpen] = useState(false);
    const [newStockIngredientName, setNewStockIngredientName] = useState('');

    const handleAddStockIngredient = (e) => {
        e.preventDefault();
        if (!isAdmin || !newStockIngredientName.trim()) return;
        addStockTrackedIngredient(newStockIngredientName.trim());
        setNewStockIngredientName('');
        setIsAddIngredientFormOpen(false);
    };

    // Estimated cost/day for a week's ingredient quantities, priced live off the feed stock
    // ledger's weighted-average rate — no manual entry, nothing to fall out of sync.
    const estimateWeekCost = (weekIngredients, plan = null) => {
        return Object.entries(weekIngredients || {}).reduce((sum, [id, qty]) => {
            const stockPrice = getIngredientStockPrice(id);
            const planPrice = plan?.ingredientPrices?.[id];
            const ing = feedIngredients.find(i => i.id === id || i.name?.toLowerCase() === id?.toLowerCase());
            const defaultFallbackPrice = ing?.price && ing.price > 0 ? ing.price
                : (id === 'wanda' || id.toLowerCase().includes('wanda') ? 72.47
                : id === 'silage' || id.toLowerCase().includes('silage') ? 12.5
                : id === 'straw' || id.toLowerCase().includes('straw') || id.toLowerCase().includes('toori') ? 16.0
                : id === 'chari' || id.toLowerCase().includes('chari') ? 8.0
                : 0);
            const price = (stockPrice !== null && stockPrice > 0)
                ? stockPrice
                : (planPrice !== undefined && planPrice !== null && parseFloat(planPrice) > 0)
                    ? parseFloat(planPrice)
                    : defaultFallbackPrice;
            return sum + (parseFloat(qty) || 0) * price;
        }, 0);
    };

    const estimateWeekAvgCost = (week, plan = null) => {
        if (week.scheduleMode === 'day' && week.dailyIngredients && Object.keys(week.dailyIngredients).length > 0) {
            const days = Object.values(week.dailyIngredients);
            return days.reduce((sum, dayIng) => sum + estimateWeekCost(dayIng, plan), 0) / days.length;
        }
        return estimateWeekCost(week.ingredients, plan);
    };

    // ─── PLAN EDITOR STATE ───
    const [editingId, setEditingId] = useState(null); // null = closed, 'new' = creating, else plan id
    const [formName, setFormName] = useState('');
    const [formDesc, setFormDesc] = useState('');
    const [formAdgFloor, setFormAdgFloor] = useState(1.0);
    const [formIsDefault, setFormIsDefault] = useState(false);
    const [columnStockMappings, setColumnStockMappings] = useState({});
    const [formIngredientIds, setFormIngredientIds] = useState([]);
    const [formWeeks, setFormWeeks] = useState([]);
    const [formAdaptation, setFormAdaptation] = useState([]);
    const [addIngredientChoice, setAddIngredientChoice] = useState('');
    const [saveConfirm, setSaveConfirm] = useState(false);
    const [isNewIngredientFormOpen, setIsNewIngredientFormOpen] = useState(false);
    const [newIngredientName, setNewIngredientName] = useState('');
    const [showBulkImport, setShowBulkImport] = useState(false);
    const [showMappingsPanel, setShowMappingsPanel] = useState(false);

    // ─── CSV IMPORT (new normalized ration system, RATION_SYSTEM_SPEC.md) ───
    // A single CSV can bundle multiple plans (grouped by its plan_id column, e.g.
    // "conservative"/"type-1"/"high") — parsed entirely client-side, then imported one
    // group at a time so a mistake in one plan's rows doesn't block the others. Ingredient
    // column names are matched strictly server-side against Feed Stock (never introduced
    // ad-hoc), so the whole file's structure only needs light client-side parsing here.
    const CSV_FIXED_COLS = new Set(['plan_id', 'phase', 'day_no', 'forage_type', 'wt_min', 'wt_max', 'target_adg', 'est_cost_per_head_per_day']);

    const parseRationCSV = (text) => {
        const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
        if (lines.length < 2) return {};
        const header = lines[0].split(',').map(h => h.trim());
        const ingredientCols = header.filter(h => !CSV_FIXED_COLS.has(h.toLowerCase()));
        const groups = {};
        lines.slice(1).forEach(line => {
            const cells = line.split(',').map(c => c.trim());
            const cellByHeader = {};
            header.forEach((h, i) => { cellByHeader[h] = cells[i]; });
            const planKey = (cellByHeader['plan_id'] || '').trim();
            if (!planKey) return;
            const ingredients = {};
            ingredientCols.forEach(col => { ingredients[col] = cellByHeader[col]; });
            const row = {
                phase: (cellByHeader['phase'] || '').trim().toUpperCase(),
                dayNo: cellByHeader['day_no'] ? parseInt(cellByHeader['day_no'], 10) : null,
                forageType: (cellByHeader['forage_type'] || '').trim().toLowerCase(),
                wtMin: parseFloat(cellByHeader['wt_min']),
                wtMax: parseFloat(cellByHeader['wt_max']),
                targetAdg: parseFloat(cellByHeader['target_adg']),
                estCostPerHeadPerDay: cellByHeader['est_cost_per_head_per_day'] ? parseFloat(cellByHeader['est_cost_per_head_per_day']) : null,
                ingredients
            };
            (groups[planKey] = groups[planKey] || []).push(row);
        });
        return groups;
    };

    const [csvGroups, setCsvGroups] = useState({}); // planKey -> rows[]
    const [csvPlanNames, setCsvPlanNames] = useState({}); // planKey -> editable display name
    const [csvImportResults, setCsvImportResults] = useState({}); // planKey -> { success, errors|planId|version|rowCount }
    const [csvImporting, setCsvImporting] = useState(null); // planKey currently submitting

    const handleCsvFileChange = (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            const groups = parseRationCSV(String(ev.target.result || ''));
            setCsvGroups(groups);
            setCsvImportResults({});
            const names = {};
            Object.keys(groups).forEach(key => {
                names[key] = key.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
            });
            setCsvPlanNames(names);
        };
        reader.readAsText(file);
        e.target.value = '';
    };

    const handleImportCsvGroup = async (planKey) => {
        if (!isAdmin) return;
        const rows = csvGroups[planKey];
        if (!rows || rows.length === 0) return;
        setCsvImporting(planKey);
        const adgVals = rows.map(r => r.targetAdg).filter(v => Number.isFinite(v));
        const result = await importRationPlanCSV({
            planKey,
            planName: csvPlanNames[planKey] || planKey,
            adaptationDays: 7,
            adgFloor: adgVals.length ? Math.min(...adgVals) : 1.0,
            isDefault: false,
            rows
        });
        setCsvImportResults(prev => ({ ...prev, [planKey]: result }));
        setCsvImporting(null);
    };

    // ─── v2 PLAN METADATA EDIT + CSV EXPORT ───
    const [editingV2Id, setEditingV2Id] = useState(null);
    const [v2EditName, setV2EditName] = useState('');
    const [v2EditAdaptationDays, setV2EditAdaptationDays] = useState(7);
    const [v2EditAdgFloor, setV2EditAdgFloor] = useState(1.0);
    const [v2EditIsDefault, setV2EditIsDefault] = useState(false);
    const [v2SavingId, setV2SavingId] = useState(null);

    const openEditV2Plan = (plan) => {
        setEditingV2Id(plan.id);
        setV2EditName(plan.name);
        setV2EditAdaptationDays(plan.adaptationDays);
        setV2EditAdgFloor(plan.adgFloor);
        setV2EditIsDefault(!!plan.isDefault);
    };

    const handleSaveV2Plan = async (planId) => {
        setV2SavingId(planId);
        const result = await updateRationPlanV2({
            id: planId,
            name: v2EditName,
            adaptationDays: parseInt(v2EditAdaptationDays, 10) || 7,
            adgFloor: parseFloat(v2EditAdgFloor) || 1.0,
            isDefault: v2EditIsDefault
        });
        setV2SavingId(null);
        if (result.success) {
            setEditingV2Id(null);
        } else {
            alert(result.error || 'Failed to update plan.');
        }
    };

    // Rebuilds the plan's CSV in the exact column format IMPORT_RATION_PLAN accepts, so
    // the exported file can be edited and re-uploaded as a new version (spec's versioning
    // rule — never overwrite, always re-import).
    const handleExportV2Plan = (plan) => {
        const rows = rationRows.filter(r => r.planId === plan.id);
        const ingredientIdSet = new Set();
        rows.forEach(row => {
            rationRowItems.filter(i => i.rowId === row.id).forEach(i => ingredientIdSet.add(i.ingredientId));
        });
        const ingredientIds = [...ingredientIdSet];
        const ingredientNames = ingredientIds.map(id => feedIngredients.find(f => f.id === id)?.name || id);

        const sorted = [...rows].sort((a, b) => {
            if (a.forageType !== b.forageType) return a.forageType.localeCompare(b.forageType);
            if (a.phase !== b.phase) return a.phase.localeCompare(b.phase);
            const aDay = a.dayNo == null ? -1 : a.dayNo;
            const bDay = b.dayNo == null ? -1 : b.dayNo;
            if (aDay !== bDay) return aDay - bDay;
            return a.wtMin - b.wtMin;
        });

        const header = ['plan_id', 'phase', 'day_no', 'forage_type', 'wt_min', 'wt_max', 'target_adg', ...ingredientNames, 'est_cost_per_head_per_day'];
        const lines = [header.join(',')];
        sorted.forEach(row => {
            const itemsByIng = {};
            rationRowItems.filter(i => i.rowId === row.id).forEach(i => { itemsByIng[i.ingredientId] = i.qtyKgPerHeadPerDay; });
            const cells = [
                plan.planKey,
                row.phase,
                row.dayNo != null ? row.dayNo : '',
                row.forageType,
                row.wtMin,
                row.wtMax,
                row.targetAdg,
                ...ingredientIds.map(id => (itemsByIng[id] != null ? itemsByIng[id] : 0)),
                row.estCostPerHeadPerDay != null ? row.estCostPerHeadPerDay : ''
            ];
            lines.push(cells.join(','));
        });

        const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${plan.planKey}_v${plan.version}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    // ─── v2 BRACKET DETAIL VIEW/EDIT ───
    // Lets a plan's actual imported bracket rows (previously only shown as a count) be
    // read and corrected row-by-row without re-uploading a whole new CSV version. Server
    // (UPDATE_RATION_ROW) re-checks the same bound/contiguity rules IMPORT_RATION_PLAN
    // applies, so a bad edit can't silently break the sequence live pens resolve against.
    const [expandedV2PlanId, setExpandedV2PlanId] = useState(null);
    const [bracketFilterForage, setBracketFilterForage] = useState('all');
    const [bracketFilterPhase, setBracketFilterPhase] = useState('all');
    const [editingRowId, setEditingRowId] = useState(null);
    const [rowEditWtMin, setRowEditWtMin] = useState('');
    const [rowEditWtMax, setRowEditWtMax] = useState('');
    const [rowEditTargetAdg, setRowEditTargetAdg] = useState('');
    const [rowEditEstCost, setRowEditEstCost] = useState('');
    const [rowEditItems, setRowEditItems] = useState({});
    const [rowSavingId, setRowSavingId] = useState(null);
    const [rowSaveErrors, setRowSaveErrors] = useState([]);

    const toggleV2PlanExpanded = (planId) => {
        setExpandedV2PlanId(prev => (prev === planId ? null : planId));
        setEditingRowId(null);
        setRowSaveErrors([]);
        setBracketFilterForage('all');
        setBracketFilterPhase('all');
    };

    const openEditRow = (row, ingredientIds) => {
        setEditingRowId(row.id);
        setRowEditWtMin(row.wtMin);
        setRowEditWtMax(row.wtMax);
        setRowEditTargetAdg(row.targetAdg);
        setRowEditEstCost(row.estCostPerHeadPerDay ?? '');
        const itemsByIng = {};
        ingredientIds.forEach(id => { itemsByIng[id] = 0; });
        rationRowItems.filter(i => i.rowId === row.id).forEach(i => { itemsByIng[i.ingredientId] = i.qtyKgPerHeadPerDay; });
        setRowEditItems(itemsByIng);
        setRowSaveErrors([]);
    };

    const handleSaveRow = async () => {
        setRowSavingId(editingRowId);
        const result = await updateRationRow({
            rowId: editingRowId,
            wtMin: parseFloat(rowEditWtMin),
            wtMax: parseFloat(rowEditWtMax),
            targetAdg: parseFloat(rowEditTargetAdg),
            estCostPerHeadPerDay: rowEditEstCost !== '' && rowEditEstCost !== null ? parseFloat(rowEditEstCost) : null,
            items: rowEditItems
        });
        setRowSavingId(null);
        if (result.success) {
            setEditingRowId(null);
            setRowSaveErrors([]);
        } else {
            setRowSaveErrors(result.errors || ['Failed to save bracket.']);
        }
    };

    // Smart auto-matching helper: matches an ingredient column to a Feed Stock item
    const findMatchingStockItem = (colId) => {
        if (columnStockMappings[colId]) {
            const explicit = feedIngredients.find(i => i.id === columnStockMappings[colId]);
            if (explicit) return explicit;
        }
        const exactId = feedIngredients.find(i => i.id === colId);
        if (exactId) return exactId;

        const colName = (feedIngredients.find(i => i.id === colId)?.name || colId).toLowerCase();
        const byName = feedIngredients.find(i => {
            const name = i.name.toLowerCase();
            return name === colName || name.includes(colName) || colName.includes(name);
        });
        return byName || null;
    };
    const [bulkForageType, setBulkForageType] = useState('silage');
    const [bulkBracketText, setBulkBracketText] = useState('');
    const [bulkAdaptationText, setBulkAdaptationText] = useState('');

    const DAYS_OF_WEEK = [1, 2, 3, 4, 5, 6, 7];
    const FORAGE_TYPES = [
        { id: 'silage', label: 'Silage' },
        { id: 'chari', label: 'Chari' },
        { id: 'mixed', label: 'Mixed (Chari + Silage)' }
    ];

    const blankWeek = (weekNum, ingredientIds, prevWeek) => ({
        week: weekNum,
        liveWeightMin: prevWeek ? prevWeek.liveWeightMax : '',
        liveWeightMax: '',
        targetAdg: prevWeek ? prevWeek.targetAdg : '',
        forageType: prevWeek?.forageType || 'silage',
        note: '',
        scheduleMode: 'week',
        dailyIngredients: {},
        ingredients: ingredientIds.reduce((acc, id) => {
            acc[id] = prevWeek?.ingredients?.[id] ?? 0;
            return acc;
        }, {})
    });

    const blankAdaptationSet = (forageType) => DAYS_OF_WEEK.map(day => ({
        day, forageType, wandaPct: 0, tooriKg: 0, forageKg: 0, foragePct: 100, starchCapPct: 0
    }));

    // Splits pasted tab- or comma-separated rows into arrays of trimmed string cells.
    const parsePastedRows = (text) => text.split('\n').map(l => l.trim()).filter(Boolean).map(line =>
        (line.includes('\t') ? line.split('\t') : line.split(',')).map(c => c.trim())
    );

    // Bulk-import steady-state bracket rows pasted as: wt_min, wt_max, target_adg, then
    // one value per configured ingredient column (in the same order as the table above).
    const handleBulkImportBrackets = () => {
        const rows = parsePastedRows(bulkBracketText);
        if (rows.length === 0) return;
        const startWeek = formWeeks.length > 0 ? Math.max(...formWeeks.map(w => parseInt(w.week) || 0)) : 0;
        const newRows = rows.map((cols, i) => {
            const [wtMin, wtMax, adg, ...ingVals] = cols;
            const ingredients = formIngredientIds.reduce((acc, id, idx) => {
                acc[id] = parseFloat(ingVals[idx]) || 0;
                return acc;
            }, {});
            return {
                week: startWeek + i + 1,
                liveWeightMin: parseFloat(wtMin) || 0,
                liveWeightMax: parseFloat(wtMax) || 0,
                targetAdg: parseFloat(adg) || 0,
                forageType: bulkForageType,
                note: '',
                scheduleMode: 'week',
                dailyIngredients: {},
                ingredients
            };
        });
        setFormWeeks(prev => [...prev, ...newRows]);
        setBulkBracketText('');
    };

    // Bulk-import adaptation rows pasted as:
    // day, wanda_pct, toori_kg, forage_val (silage kg / chari %), starch_cap_pct, [custom1, custom2...]
    // (or 4 cols: day, wanda_pct, toori_kg, starch_cap_pct, [custom...]).
    const handleBulkImportAdaptation = () => {
        const rows = parsePastedRows(bulkAdaptationText);
        if (rows.length === 0) return;
        const isChari = bulkForageType === 'chari';
        const customCols = formIngredientIds.filter(id => id !== 'silage' && id !== 'chari' && id !== 'straw' && id !== 'wanda' && !id.toLowerCase().includes('wanda'));

        const newRows = rows.map(cols => {
            const day = parseInt(cols[0]) || 0;
            const wandaPct = parseFloat(cols[1]) || 0;
            const tooriKg = parseFloat(cols[2]) || 0;

            let forageKg = 0;
            let foragePct = 100;
            let starchCapPct = 0;
            let customStartIndex = 3;

            if (cols.length >= 5) {
                const forageVal = parseFloat(cols[3]) || 0;
                forageKg = isChari ? 0 : forageVal;
                foragePct = isChari ? forageVal : 100;
                starchCapPct = parseFloat(cols[4]) || 0;
                customStartIndex = 5;
            } else if (cols.length === 4) {
                starchCapPct = parseFloat(cols[3]) || 0;
                customStartIndex = 4;
            }

            const custom = {};
            customCols.forEach((colId, idx) => {
                const rawVal = cols[customStartIndex + idx];
                if (rawVal !== undefined && rawVal !== '') {
                    custom[colId] = parseFloat(rawVal) || 0;
                }
            });

            return {
                day,
                forageType: bulkForageType,
                wandaPct,
                tooriKg,
                forageKg,
                foragePct,
                starchCapPct,
                custom
            };
        });
        setFormAdaptation(prev => {
            const filtered = prev.filter(r => !(r.forageType === bulkForageType && newRows.some(n => n.day === r.day)));
            return [...filtered, ...newRows];
        });
        setBulkAdaptationText('');
    };

    const handleAddAdaptationSet = (forageType) => {
        setFormAdaptation(prev => prev.some(r => r.forageType === forageType) ? prev : [...prev, ...blankAdaptationSet(forageType)]);
    };

    const handleRemoveAdaptationSet = (forageType) => {
        setFormAdaptation(prev => prev.filter(r => r.forageType !== forageType));
    };

    const handleAdaptationFieldChange = (forageType, day, field, value) => {
        setFormAdaptation(prev => prev.map(r => (r.forageType === forageType && r.day === day) ? { ...r, [field]: value } : r));
    };

    const handleCustomAdaptationFieldChange = (forageType, day, ingId, value) => {
        setFormAdaptation(prev => prev.map(r => {
            if (r.forageType === forageType && r.day === day) {
                const custom = { ...(r.custom || {}), [ingId]: value };
                return { ...r, custom };
            }
            return r;
        }));
    };

    const openNewPlan = () => {
        const defaultIds = ['silage', 'maizeGrain', 'glutenFeed', 'straw', 'urea', 'minerals'].filter(id =>
            stockTrackedIngredients.some(i => i.id === id)
        );
        setEditingId('new');
        setFormName('');
        setFormDesc('');
        setFormAdgFloor(1.0);
        setFormIsDefault(false);
        setColumnStockMappings({});
        setFormIngredientIds(defaultIds.length ? defaultIds : stockTrackedIngredients.map(i => i.id));
        setFormWeeks([blankWeek(1, defaultIds, null)]);
        setFormAdaptation([]);
    };

    const openEditPlan = (plan) => {
        const idSet = new Set();
        (plan.weeks || []).forEach(w => Object.keys(w.ingredients || {}).forEach(id => idSet.add(id)));
        setEditingId(plan.id);
        setFormName(plan.name);
        setFormDesc(plan.description || '');
        setFormAdgFloor(plan.adgFloor ?? 1.0);
        setFormIsDefault(!!plan.isDefault);
        setColumnStockMappings(plan.columnStockMappings || {});
        setFormIngredientIds([...idSet]);
        setFormWeeks((plan.weeks || []).map(w => ({
            ...w,
            forageType: w.forageType || 'silage',
            ingredients: { ...w.ingredients },
            scheduleMode: w.scheduleMode === 'day' ? 'day' : 'week',
            dailyIngredients: w.dailyIngredients
                ? Object.fromEntries(Object.entries(w.dailyIngredients).map(([day, ing]) => [day, { ...ing }]))
                : {}
        })));
        setFormAdaptation((plan.adaptation || []).map(r => ({ ...r })));
    };

    const closeEditor = () => {
        setEditingId(null);
        setAddIngredientChoice('');
        setShowBulkImport(false);
        setBulkBracketText('');
        setBulkAdaptationText('');
    };

    const handleAddIngredientColumn = () => {
        if (!addIngredientChoice || formIngredientIds.includes(addIngredientChoice)) return;
        setFormIngredientIds(prev => [...prev, addIngredientChoice]);
        setAddIngredientChoice('');
    };

    // Lets an admin create a brand-new stock-tracked ingredient (e.g. a specific mineral
    // blend) and add it as a schedule column in one step. It's automatically priced from
    // whatever it's purchased at in Feed Stock — nothing to type in here.
    const handleCreateAndAddIngredient = (e) => {
        e.preventDefault();
        if (!isAdmin || !newIngredientName.trim()) return;
        const newId = addStockTrackedIngredient(newIngredientName.trim());
        if (newId) setFormIngredientIds(prev => [...prev, newId]);
        setNewIngredientName('');
        setIsNewIngredientFormOpen(false);
    };

    const handleRemoveIngredientColumn = (id) => {
        setFormIngredientIds(prev => prev.filter(x => x !== id));
        setFormWeeks(prev => prev.map(w => {
            const ing = { ...w.ingredients };
            delete ing[id];
            const dailyIngredients = w.dailyIngredients
                ? Object.fromEntries(Object.entries(w.dailyIngredients).map(([day, dayIng]) => {
                    const d = { ...dayIng };
                    delete d[id];
                    return [day, d];
                }))
                : w.dailyIngredients;
            return { ...w, ingredients: ing, dailyIngredients };
        }));
    };

    const handleWeekFieldChange = (index, field, value) => {
        setFormWeeks(prev => prev.map((w, i) => (i === index ? { ...w, [field]: value } : w)));
    };

    const handleWeekIngredientChange = (index, ingId, value) => {
        setFormWeeks(prev => prev.map((w, i) => (i === index ? { ...w, ingredients: { ...w.ingredients, [ingId]: value } } : w)));
    };

    // Flip a week between "same ration every day" and "different ration per day" —
    // switching into day mode for the first time seeds all 7 days from the current
    // whole-week quantities so nothing is lost, just editable per day from there.
    const handleToggleWeekMode = (index) => {
        setFormWeeks(prev => prev.map((w, i) => {
            if (i !== index) return w;
            const nextMode = w.scheduleMode === 'day' ? 'week' : 'day';
            if (nextMode === 'day' && (!w.dailyIngredients || Object.keys(w.dailyIngredients).length === 0)) {
                const seeded = {};
                DAYS_OF_WEEK.forEach(day => { seeded[day] = { ...w.ingredients }; });
                return { ...w, scheduleMode: nextMode, dailyIngredients: seeded };
            }
            return { ...w, scheduleMode: nextMode };
        }));
    };

    const handleDailyIngredientChange = (weekIndex, day, ingId, value) => {
        setFormWeeks(prev => prev.map((w, i) => {
            if (i !== weekIndex) return w;
            const dailyIngredients = { ...(w.dailyIngredients || {}) };
            dailyIngredients[day] = { ...(dailyIngredients[day] || {}), [ingId]: value };
            return { ...w, dailyIngredients };
        }));
    };

    const handleAddWeek = () => {
        const last = formWeeks[formWeeks.length - 1];
        setFormWeeks(prev => [...prev, blankWeek((last?.week || 0) + 1, formIngredientIds, last)]);
    };

    const handleRemoveWeek = (index) => {
        setFormWeeks(prev => prev.filter((_, i) => i !== index));
    };

    const handleSavePlan = (e) => {
        e.preventDefault();
        if (!isAdmin || !formName.trim()) return;

        const id = editingId === 'new'
            ? `plan-${formName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}-${Date.now().toString(36)}`
            : editingId;

        const weeks = formWeeks.map(w => {
            const scheduleMode = w.scheduleMode === 'day' ? 'day' : 'week';
            const record = {
                week: parseInt(w.week) || 0,
                liveWeightMin: parseFloat(w.liveWeightMin) || 0,
                liveWeightMax: parseFloat(w.liveWeightMax) || 0,
                targetAdg: parseFloat(w.targetAdg) || 0,
                forageType: w.forageType || 'silage',
                note: w.note || '',
                scheduleMode,
                // In day mode this whole-week field is just a Day-1 fallback for any code
                // path that doesn't know about dailyIngredients — the real per-day figures
                // live in dailyIngredients below.
                ingredients: formIngredientIds.reduce((acc, ingId) => {
                    const source = scheduleMode === 'day' ? w.dailyIngredients?.[1] : w.ingredients;
                    acc[ingId] = parseFloat(source?.[ingId]) || 0;
                    return acc;
                }, {})
            };
            if (scheduleMode === 'day') {
                record.dailyIngredients = DAYS_OF_WEEK.reduce((dacc, day) => {
                    dacc[day] = formIngredientIds.reduce((acc, ingId) => {
                        acc[ingId] = parseFloat(w.dailyIngredients?.[day]?.[ingId]) || 0;
                        return acc;
                    }, {});
                    return dacc;
                }, {});
            }
            return record;
        });

        const adaptation = formAdaptation.map(r => ({
            day: parseInt(r.day) || 0,
            forageType: r.forageType || 'silage',
            wandaPct: parseFloat(r.wandaPct) || 0,
            tooriKg: parseFloat(r.tooriKg) || 0,
            forageKg: parseFloat(r.forageKg) || 0,
            foragePct: parseFloat(r.foragePct) || 0,
            starchCapPct: parseFloat(r.starchCapPct) || 0,
            custom: r.custom || {}
        }));

        let wandaStockItemId = 'wanda';
        const wandaCol = formIngredientIds.find(colId => {
            const matched = findMatchingStockItem(colId);
            const name = (matched?.name || colId).toLowerCase();
            return name.includes('wanda') || matched?.isPremix;
        });
        if (wandaCol) {
            const matched = findMatchingStockItem(wandaCol);
            wandaStockItemId = matched?.id || wandaCol;
        }

        saveRationPlan({
            id,
            name: formName.trim(),
            description: formDesc.trim(),
            adgFloor: parseFloat(formAdgFloor) || 1.0,
            isDefault: formIsDefault,
            wandaStockItemId,
            columnStockMappings,
            weeks,
            adaptation
        });

        setSaveConfirm(true);
        setTimeout(() => setSaveConfirm(false), 2000);
        closeEditor();
    };

    const handleDeletePlan = (plan) => {
        if (!isAdmin) return;
        const affectedPens = pens.filter(p => p.rationPlanId === plan.id).map(p => p.id);
        const impactMsg = affectedPens.length > 0
            ? `\n\n${affectedPens.length} pen${affectedPens.length === 1 ? '' : 's'} currently use this plan and will be unassigned and stop being fed until reassigned: Pen ${affectedPens.join(', Pen ')}.`
            : '\n\nNo pens are currently using this plan.';
        if (window.confirm(`Delete Ration Plan "${plan.name}"?${impactMsg}\n\nThis cannot be undone.`)) {
            if (editingId === plan.id) closeEditor();
            deleteRationPlan(plan.id);
        }
    };

    // Non-blocking heads-up for gaps/overlaps in the 5kg brackets, checked separately per
    // forage_type group since silage and chari row-sets cover the same weight range but
    // are independent tables.
    const bracketWarnings = (() => {
        const groups = {};
        formWeeks.forEach(w => {
            const ft = w.forageType || 'silage';
            (groups[ft] = groups[ft] || []).push(w);
        });
        const warnings = [];
        Object.entries(groups).forEach(([ft, rows]) => {
            const sorted = [...rows].sort((a, b) => (parseFloat(a.liveWeightMin) || 0) - (parseFloat(b.liveWeightMin) || 0));
            for (let i = 1; i < sorted.length; i++) {
                const prevMax = parseFloat(sorted[i - 1].liveWeightMax) || 0;
                const curMin = parseFloat(sorted[i].liveWeightMin) || 0;
                if (curMin > prevMax) warnings.push(`${ft}: gap between ${prevMax}kg and ${curMin}kg`);
                else if (curMin < prevMax) warnings.push(`${ft}: overlap around ${curMin}–${prevMax}kg`);
            }
        });
        return warnings;
    })();

    // ─── PEN ASSIGNMENT ───
    const distinctPenNames = [...new Set([
        ...animals.filter(a => a.pen).map(a => a.pen),
        ...pens.map(p => p.id)
    ])].sort();

    // Pens with active animals but no Ration Plan attached — the TMR Calculator can't
    // feed these until a plan is assigned, so surface it here rather than silently.
    const unassignedPens = distinctPenNames.filter(penId => {
        const hasActiveAnimals = animals.some(a => a.pen === penId && a.status !== 'Sold' && a.status !== 'Deceased');
        const penConfig = pens.find(p => p.id === penId);
        return hasActiveAnimals && !penConfig?.rationPlanId && !penConfig?.planId;
    });

    const [newPenId, setNewPenId] = useState('');

    const handleAddPen = async (e) => {
        e.preventDefault();
        if (!isAdmin) return;
        const id = newPenId.trim();
        if (!id) return;
        const result = await savePen({ id, rationPlanId: null, cycleStartDate: null, forageType: 'silage', expectedExitDate: null, notes: '' });
        if (result?.success === false) {
            alert(result.error || 'Failed to add pen.');
            return;
        }
        setNewPenId('');
    };

    const handlePenFieldChange = (penId, field, value) => {
        if (!isAdmin) return;
        const existing = pens.find(p => p.id === penId) || { id: penId, rationPlanId: null, cycleStartDate: null, forageType: 'silage', expectedExitDate: null, notes: '' };
        savePen({ ...existing, [field]: value || null });
    };

    // A pen is assigned to exactly one system at a time — legacy (rationPlanId,
    // percentage-based) or v2 (planId, CSV-imported absolute kg/head/day). Switching
    // the dropdown always clears the other pointer so a stale one can never cause the
    // pen to silently resolve through the wrong engine.
    const handlePenPlanChange = (penId, rawValue) => {
        if (!isAdmin) return;
        const existing = pens.find(p => p.id === penId) || { id: penId, rationPlanId: null, planId: null, cycleStartDate: null, forageType: 'silage', expectedExitDate: null, notes: '' };
        if (!rawValue) {
            savePen({ ...existing, rationPlanId: null, planId: null });
            return;
        }
        const sep = rawValue.indexOf(':');
        const kind = rawValue.slice(0, sep);
        const id = rawValue.slice(sep + 1);
        if (kind === 'v2') {
            savePen({ ...existing, rationPlanId: null, planId: id });
        } else {
            savePen({ ...existing, rationPlanId: id, planId: null });
        }
    };

    // Animals sorted into the same pen at very different weights muddy both the ration
    // bracket match and the batch feed sheet. Spread is measured as a % of the pen's
    // average weight (not a flat kg number) so the tolerance scales with animal size:
    // up to 15% apart is fine, 15-20% is a soft warning, above 20% is a strict warning —
    // surfaced, not hard-blocked, since reassignment happens elsewhere (Herd Registry).
    const penWeightSpreads = distinctPenNames.map(penId => {
        const penAnimals = animals.filter(a => a.pen === penId && a.status !== 'Sold' && a.status !== 'Deceased');
        if (penAnimals.length < 2) return null;
        const weights = penAnimals.map(a => parseFloat(a.currentWeight) || 0);
        const avg = weights.reduce((s, w) => s + w, 0) / weights.length;
        if (avg <= 0) return null;
        const spreadPct = ((Math.max(...weights) - Math.min(...weights)) / avg) * 100;
        return { penId, spreadPct };
    }).filter(Boolean);

    const wideSpreadPens = penWeightSpreads.filter(p => p.spreadPct > 15 && p.spreadPct <= 20);
    const strictSpreadPens = penWeightSpreads.filter(p => p.spreadPct > 20);

    const handleDeletePen = (penId) => {
        if (!isAdmin) return;
        if (window.confirm(`Remove pen "${penId}"'s ration plan assignment? Animals keep their pen label — this only clears the plan/cycle config.`)) {
            deletePen(penId);
        }
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

            {!isAdmin && (
                <div style={{ background: 'rgba(255, 193, 7, 0.05)', border: '1px solid rgba(255, 193, 7, 0.15)', borderRadius: '8px', padding: '1rem', display: 'flex', gap: '1rem', alignItems: 'center' }}>
                    <i class="fa-solid fa-triangle-exclamation" style={{ color: 'var(--accent-gold)', fontSize: '1.4rem' }}></i>
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>
                        Read-only view. Only Admin staff can create Ration Plans or assign them to pens.
                    </span>
                </div>
            )}

            {isAdmin && (
                <div style={{ background: 'rgba(74, 144, 217, 0.06)', border: '1px solid rgba(74, 144, 217, 0.18)', borderRadius: '8px', padding: '0.9rem 1.1rem', display: 'flex', gap: '0.9rem', alignItems: 'flex-start' }}>
                    <i class="fa-solid fa-circle-info" style={{ color: '#4a90d9', fontSize: '1.1rem', marginTop: '0.15rem' }}></i>
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem', lineHeight: '1.5' }}>
                        <strong style={{ color: 'var(--text-pure)' }}>How this works:</strong> Build a weekly schedule under <strong>Ration Plans</strong> (or use the pre-loaded "Baseline" plan) — only ingredients with real Feed Stock inventory can be scheduled, and every cost figure is priced live off that ingredient's current average purchase rate in <strong>Feed Pricing</strong>, so there's nothing to type in or keep in sync. Finally, switch to <strong>Pen Assignment</strong> to link a plan and cycle start date to each pen — the TMR Calculator will then auto-fill each pen's daily batch from the plan, with no cost figures cluttering that page.
                    </span>
                </div>
            )}

            <div style={{ display: 'flex', gap: '0.5rem', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '0.75rem', flexWrap: 'wrap' }}>
                <button class={`filter-btn ${activeTab === 'plans' ? 'active' : ''}`} onClick={() => setActiveTab('plans')}>
                    <i class="fa-solid fa-clipboard-list"></i> Ration Plans
                </button>
                <button class={`filter-btn ${activeTab === 'pens' ? 'active' : ''}`} onClick={() => setActiveTab('pens')}>
                    <i class="fa-solid fa-warehouse"></i> Pen Assignment
                </button>
                <button class={`filter-btn ${activeTab === 'costs' ? 'active' : ''}`} onClick={() => setActiveTab('costs')}>
                    <i class="fa-solid fa-money-bill-wave"></i> Feed Pricing
                </button>
            </div>

            {/* ═══ TAB: RATION PLANS ═══ */}
            {activeTab === 'plans' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

                    <div class="glass-panel">
                        <div class="form-header-bar" style={{ marginBottom: '1rem' }}>
                            <h3 class="panel-title" style={{ margin: 0 }}><i class="fa-solid fa-list-check"></i> Named Ration Plans</h3>
                            {isAdmin && (
                                <button type="button" class="btn btn-primary btn-sm" onClick={openNewPlan}>
                                    <i class="fa-solid fa-circle-plus"></i> New Plan
                                </button>
                            )}
                        </div>

                        <div class="table-wrapper">
                            <table class="data-table" style={{ fontSize: '0.85rem' }}>
                                <thead>
                                    <tr>
                                        <th>NAME</th>
                                        <th>WEEKS</th>
                                        <th>ADG FLOOR</th>
                                        <th>EST. COST/DAY</th>
                                        <th>PENS ASSIGNED</th>
                                        {isAdmin && <th style={{ textAlign: 'center', width: '160px' }}>ACTIONS</th>}
                                    </tr>
                                </thead>
                                <tbody>
                                    {rationPlans.map(plan => {
                                        const weekCosts = (plan.weeks || []).map(w => estimateWeekAvgCost(w, plan));
                                        const minCost = weekCosts.length ? Math.min(...weekCosts) : null;
                                        const maxCost = weekCosts.length ? Math.max(...weekCosts) : null;
                                        return (
                                        <tr key={plan.id}>
                                            <td style={{ fontWeight: '700', color: 'var(--text-pure)' }}>
                                                {plan.name}
                                                {plan.isDefault && <span style={{ marginLeft: '0.5rem', fontSize: '0.68rem', color: 'var(--accent-gold)' }}>DEFAULT</span>}
                                                <span style={{ marginLeft: '0.5rem', fontSize: '0.68rem', color: 'var(--text-muted)' }}>(legacy)</span>
                                                {plan.description && <div style={{ fontWeight: '400', fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>{plan.description}</div>}
                                            </td>
                                            <td>{(plan.weeks || []).length}</td>
                                            <td>{plan.adgFloor} kg/day</td>
                                            <td>{minCost !== null ? (minCost === maxCost ? `${Math.round(minCost)} PKR` : `${Math.round(minCost)}–${Math.round(maxCost)} PKR`) : '—'}</td>
                                            <td>{pens.filter(p => p.rationPlanId === plan.id).length}</td>
                                            {isAdmin && (
                                                <td style={{ textAlign: 'center', display: 'flex', gap: '0.4rem', justifyContent: 'center' }}>
                                                    <button type="button" class="btn btn-secondary" style={{ padding: '0.2rem 0.5rem', minHeight: '28px', height: '28px' }} onClick={() => openEditPlan(plan)} title="Edit">
                                                        <i class="fa-solid fa-pen"></i>
                                                    </button>
                                                    <button type="button" class="btn btn-secondary" style={{ padding: '0.2rem 0.5rem', minHeight: '28px', height: '28px' }} onClick={() => duplicateRationPlan(plan)} title="Duplicate as scenario variant">
                                                        <i class="fa-solid fa-copy"></i>
                                                    </button>
                                                    <button type="button" class="btn btn-secondary" style={{ padding: '0.2rem 0.5rem', minHeight: '28px', height: '28px', color: 'hsl(0,75%,55%)', borderColor: 'rgba(220,53,69,0.2)' }} onClick={() => handleDeletePlan(plan)} title="Delete">
                                                        <i class="fa-solid fa-trash-can"></i>
                                                    </button>
                                                </td>
                                            )}
                                        </tr>
                                        );
                                    })}
                                    {rationPlans.length === 0 && (
                                        <tr>
                                            <td colSpan={isAdmin ? 6 : 5} style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--text-muted)' }}>
                                                No Ration Plans defined yet.
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {isAdmin && (
                        <div class="glass-panel">
                            <div class="form-header-bar" style={{ marginBottom: '1rem' }}>
                                <h3 class="panel-title" style={{ margin: 0 }}><i class="fa-solid fa-file-csv"></i> Import Ration Plan (CSV)</h3>
                            </div>
                            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.8rem', lineHeight: '1.5' }}>
                                Upload a ration CSV — columns: <code>plan_id, phase, day_no, forage_type, wt_min, wt_max, target_adg, &lt;ingredient columns…&gt;, est_cost_per_head_per_day</code>. A single file can bundle multiple plans (grouped by <code>plan_id</code>) — each is imported separately below. Ingredient column names must match an existing Feed Stock ingredient by name; the whole plan is rejected if any column is unmatched, any row fails validation, or any weight bracket has a gap/overlap.
                            </p>
                            <input type="file" accept=".csv" onChange={handleCsvFileChange} />

                            {Object.entries(csvGroups).map(([planKey, rows]) => {
                                const result = csvImportResults[planKey];
                                return (
                                    <div key={planKey} style={{ marginTop: '1rem', background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '8px', padding: '0.9rem 1rem' }}>
                                        <div style={{ display: 'flex', gap: '0.8rem', alignItems: 'center', flexWrap: 'wrap' }}>
                                            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                                Plan key: <strong style={{ color: 'var(--text-pure)' }}>{planKey}</strong> · {rows.length} rows
                                            </span>
                                            <input
                                                type="text"
                                                class="form-control"
                                                style={{ maxWidth: '220px' }}
                                                value={csvPlanNames[planKey] || ''}
                                                onChange={e => setCsvPlanNames(prev => ({ ...prev, [planKey]: e.target.value }))}
                                                placeholder="Plan display name"
                                            />
                                            <button type="button" class="btn btn-primary btn-sm" onClick={() => handleImportCsvGroup(planKey)} disabled={csvImporting === planKey}>
                                                <i class="fa-solid fa-upload"></i> {csvImporting === planKey ? 'Importing…' : 'Import as New Version'}
                                            </button>
                                        </div>
                                        {result && result.success && (
                                            <div style={{ marginTop: '0.6rem', fontSize: '0.78rem', color: 'var(--primary-green-light)' }}>
                                                <i class="fa-solid fa-circle-check"></i> Imported "{csvPlanNames[planKey]}" v{result.version} — {result.rowCount} brackets. Assign it to pens under Pen Assignment.
                                            </div>
                                        )}
                                        {result && !result.success && (
                                            <div style={{ marginTop: '0.6rem', fontSize: '0.76rem', color: 'hsl(0,75%,65%)' }}>
                                                <i class="fa-solid fa-triangle-exclamation"></i> Import rejected — nothing was written:
                                                <ul style={{ margin: '0.3rem 0 0 1.2rem', padding: 0 }}>
                                                    {(result.errors || []).map((err, i) => <li key={i}>{err}</li>)}
                                                </ul>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    {rationPlansV2.length > 0 && (
                        <div class="glass-panel">
                            <h3 class="panel-title" style={{ marginBottom: '1rem' }}><i class="fa-solid fa-file-import"></i> Imported Ration Plans (v2)</h3>
                            <div class="table-wrapper">
                                <table class="data-table" style={{ fontSize: '0.85rem' }}>
                                    <thead>
                                        <tr>
                                            <th>NAME</th>
                                            <th>VERSION</th>
                                            <th>ADAPTATION DAYS</th>
                                            <th>ADG FLOOR</th>
                                            <th>BRACKETS</th>
                                            <th>PENS ASSIGNED</th>
                                            <th>ACTIONS</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {rationPlansV2.map(plan => (
                                            <React.Fragment key={plan.id}>
                                            {editingV2Id === plan.id ? (
                                                <tr>
                                                    <td>
                                                        <input type="text" class="form-control" style={{ minWidth: '140px' }} value={v2EditName} onChange={e => setV2EditName(e.target.value)} />
                                                    </td>
                                                    <td>v{plan.version}</td>
                                                    <td>
                                                        <input type="number" class="form-control" style={{ width: '80px' }} value={v2EditAdaptationDays} onChange={e => setV2EditAdaptationDays(e.target.value)} />
                                                    </td>
                                                    <td>
                                                        <input type="number" step="0.01" class="form-control" style={{ width: '90px' }} value={v2EditAdgFloor} onChange={e => setV2EditAdgFloor(e.target.value)} />
                                                    </td>
                                                    <td>{rationRows.filter(r => r.planId === plan.id).length}</td>
                                                    <td>{pens.filter(p => p.planId === plan.id).length}</td>
                                                    <td>
                                                        <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.72rem', marginBottom: '0.4rem' }}>
                                                            <input type="checkbox" checked={v2EditIsDefault} onChange={e => setV2EditIsDefault(e.target.checked)} /> Default
                                                        </label>
                                                        <div style={{ display: 'flex', gap: '0.4rem' }}>
                                                            <button type="button" class="btn btn-primary btn-sm" onClick={() => handleSaveV2Plan(plan.id)} disabled={v2SavingId === plan.id}>
                                                                {v2SavingId === plan.id ? 'Saving…' : 'Save'}
                                                            </button>
                                                            <button type="button" class="btn btn-ghost btn-sm" onClick={() => setEditingV2Id(null)}>Cancel</button>
                                                        </div>
                                                    </td>
                                                </tr>
                                            ) : (
                                                <tr>
                                                    <td style={{ fontWeight: '700', color: 'var(--text-pure)' }}>
                                                        {plan.name}
                                                        {plan.isDefault && <span style={{ marginLeft: '0.5rem', fontSize: '0.68rem', color: 'var(--accent-gold)' }}>DEFAULT</span>}
                                                    </td>
                                                    <td>v{plan.version}</td>
                                                    <td>{plan.adaptationDays}</td>
                                                    <td>{plan.adgFloor} kg/day</td>
                                                    <td>{rationRows.filter(r => r.planId === plan.id).length}</td>
                                                    <td>{pens.filter(p => p.planId === plan.id).length}</td>
                                                    <td>
                                                        <div style={{ display: 'flex', gap: '0.4rem' }}>
                                                            <button type="button" class={`btn btn-sm ${expandedV2PlanId === plan.id ? 'btn-primary' : 'btn-ghost'}`} title="View / edit brackets" onClick={() => toggleV2PlanExpanded(plan.id)}>
                                                                <i class={`fa-solid ${expandedV2PlanId === plan.id ? 'fa-chevron-up' : 'fa-table-list'}`}></i>
                                                            </button>
                                                            {isAdmin && (
                                                                <button type="button" class="btn btn-ghost btn-sm" title="Edit name/settings" onClick={() => openEditV2Plan(plan)}>
                                                                    <i class="fa-solid fa-pen-to-square"></i>
                                                                </button>
                                                            )}
                                                            <button type="button" class="btn btn-ghost btn-sm" title="Export as CSV" onClick={() => handleExportV2Plan(plan)}>
                                                                <i class="fa-solid fa-file-csv"></i>
                                                            </button>
                                                        </div>
                                                    </td>
                                                </tr>
                                            )}
                                            {expandedV2PlanId === plan.id && (
                                                <tr>
                                                    <td colSpan={7} style={{ padding: 0, background: 'rgba(255,255,255,0.02)' }}>
                                                        <BracketDetailPanel
                                                            plan={plan}
                                                            rationRows={rationRows}
                                                            rationRowItems={rationRowItems}
                                                            feedIngredients={feedIngredients}
                                                            isAdmin={isAdmin}
                                                            bracketFilterForage={bracketFilterForage}
                                                            setBracketFilterForage={setBracketFilterForage}
                                                            bracketFilterPhase={bracketFilterPhase}
                                                            setBracketFilterPhase={setBracketFilterPhase}
                                                            editingRowId={editingRowId}
                                                            openEditRow={openEditRow}
                                                            cancelEditRow={() => { setEditingRowId(null); setRowSaveErrors([]); }}
                                                            rowEditWtMin={rowEditWtMin} setRowEditWtMin={setRowEditWtMin}
                                                            rowEditWtMax={rowEditWtMax} setRowEditWtMax={setRowEditWtMax}
                                                            rowEditTargetAdg={rowEditTargetAdg} setRowEditTargetAdg={setRowEditTargetAdg}
                                                            rowEditEstCost={rowEditEstCost} setRowEditEstCost={setRowEditEstCost}
                                                            rowEditItems={rowEditItems} setRowEditItems={setRowEditItems}
                                                            rowSavingId={rowSavingId}
                                                            rowSaveErrors={rowSaveErrors}
                                                            handleSaveRow={handleSaveRow}
                                                        />
                                                    </td>
                                                </tr>
                                            )}
                                            </React.Fragment>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}

                    {/* ─── PLAN EDITOR ─── */}
                    {editingId && isAdmin && (
                        <div class="glass-panel animate-scale-up" style={{ borderTop: '4px solid var(--accent-gold)' }}>
                            <div class="form-header-bar" style={{ marginBottom: '1.2rem' }}>
                                <h3 class="panel-title" style={{ margin: 0 }}>
                                    <i class="fa-solid fa-flask"></i> {editingId === 'new' ? 'New Ration Plan' : `Editing: ${formName}`}
                                </h3>
                                <button type="button" class="btn btn-secondary btn-sm" onClick={closeEditor}>
                                    <i class="fa-solid fa-xmark"></i> Close
                                </button>
                            </div>

                            <form onSubmit={handleSavePlan}>
                                <div class="form-grid-2" style={{ marginBottom: '1rem' }}>
                                    <div class="form-group">
                                        <label>Plan Name *</label>
                                        <input type="text" class="form-control" value={formName} onChange={e => setFormName(e.target.value)} placeholder="e.g. Baseline, Scenario A" required />
                                    </div>
                                    <div class="form-group">
                                        <label>Minimum ADG Floor (kg/day)</label>
                                        <input type="number" step="0.05" class="form-control" value={formAdgFloor} onChange={e => setFormAdgFloor(e.target.value)} />
                                        <small style={{ color: 'var(--text-muted)', display: 'block', marginTop: '0.3rem' }}>Safety-net floor — pens falling below this flag on the Feed &amp; Growth Report.</small>
                                    </div>
                                </div>
                                <div class="form-group" style={{ marginBottom: '1rem' }}>
                                    <label>Description</label>
                                    <input type="text" class="form-control" value={formDesc} onChange={e => setFormDesc(e.target.value)} placeholder="Optional notes" />
                                </div>

                                <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.82rem', color: 'var(--text-pure)', marginBottom: '1.2rem', cursor: 'pointer' }}>
                                    <input type="checkbox" checked={formIsDefault} onChange={e => setFormIsDefault(e.target.checked)} style={{ width: '15px', height: '15px' }} />
                                    Mark as default plan
                                </label>

                                {/* Ingredient column management */}
                                <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: '0.6rem', background: 'rgba(0,0,0,0.15)', padding: '0.8rem', borderRadius: '8px' }}>
                                    <div class="form-group" style={{ marginBottom: 0, minWidth: '220px' }}>
                                        <label style={{ fontSize: '0.75rem' }}>Add Ingredient Column</label>
                                        <select class="form-control" value={addIngredientChoice} onChange={e => setAddIngredientChoice(e.target.value)}>
                                            <option value="">Select ingredient…</option>
                                            {stockTrackedIngredients.filter(i => !formIngredientIds.includes(i.id)).map(i => (
                                                <option key={i.id} value={i.id}>{i.name}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <button type="button" class="btn btn-secondary" onClick={handleAddIngredientColumn} disabled={!addIngredientChoice}>
                                        <i class="fa-solid fa-plus"></i> Add Column
                                    </button>
                                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>or</span>
                                    <button type="button" class="btn btn-secondary" onClick={() => setIsNewIngredientFormOpen(!isNewIngredientFormOpen)}>
                                        <i class={`fa-solid ${isNewIngredientFormOpen ? 'fa-xmark' : 'fa-circle-plus'}`}></i> {isNewIngredientFormOpen ? 'Cancel' : 'New Ingredient'}
                                    </button>
                                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>or</span>
                                    <button type="button" class="btn btn-secondary" onClick={() => setShowBulkImport(!showBulkImport)}>
                                        <i class={`fa-solid ${showBulkImport ? 'fa-xmark' : 'fa-file-import'}`}></i> {showBulkImport ? 'Cancel Bulk Import' : 'Bulk Import Rows'}
                                    </button>
                                </div>

                                {showBulkImport && (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem', marginBottom: '1rem', background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.05)', padding: '0.9rem', borderRadius: '8px' }}>
                                        <div class="form-group" style={{ marginBottom: 0, maxWidth: '220px' }}>
                                            <label style={{ fontSize: '0.75rem' }}>Forage type for this paste</label>
                                            <select class="form-control" value={bulkForageType} onChange={e => setBulkForageType(e.target.value)}>
                                                {FORAGE_TYPES.map(ft => <option key={ft.id} value={ft.id}>{ft.label}</option>)}
                                            </select>
                                        </div>

                                        <div class="form-group" style={{ marginBottom: 0 }}>
                                            <label style={{ fontSize: '0.75rem' }}>Steady-state bracket rows</label>
                                            <small style={{ color: 'var(--text-muted)', display: 'block', marginBottom: '0.3rem' }}>
                                                One bracket per line, tab- or comma-separated: <code>wt_min, wt_max, target_adg, {formIngredientIds.map(id => feedIngredients.find(i => i.id === id)?.name || id).join(', ') || '(add ingredient columns above first)'}</code>
                                            </small>
                                            <textarea class="form-control" rows={5} style={{ fontFamily: 'monospace', fontSize: '0.78rem' }} value={bulkBracketText} onChange={e => setBulkBracketText(e.target.value)} placeholder={`120\t125\t1.15\t0.5\t5.2\t0.35\t1.1\t0.05`}></textarea>
                                            <button type="button" class="btn btn-secondary" style={{ marginTop: '0.4rem' }} onClick={handleBulkImportBrackets} disabled={!bulkBracketText.trim()}>
                                                <i class="fa-solid fa-plus"></i> Append Bracket Rows
                                            </button>
                                        </div>

                                        <div class="form-group" style={{ marginBottom: 0 }}>
                                            <label style={{ fontSize: '0.75rem' }}>Adaptation rows (Day 1-7)</label>
                                            <small style={{ color: 'var(--text-muted)', display: 'block', marginBottom: '0.3rem' }}>
                                                One day per line: <code>day, wanda_pct, toori_kg, {bulkForageType === 'chari' ? 'chari_pct' : 'silage_kg'}, starch_cap_pct{formIngredientIds.filter(id => id !== 'silage' && id !== 'chari' && id !== 'straw' && id !== 'wanda' && !id.toLowerCase().includes('wanda')).map(id => `, ${id === 'khal' || id.toLowerCase().includes('khal') || id.toLowerCase().includes('cottonseed') ? 'khal_pct' : (feedIngredients.find(i => i.id === id)?.name.toLowerCase().replace(/[^a-z0-9]+/g, '_') || id)}`).join('')}</code> — re-pasting overwrites matching days for {bulkForageType}.
                                            </small>
                                            <textarea class="form-control" rows={4} style={{ fontFamily: 'monospace', fontSize: '0.78rem' }} value={bulkAdaptationText} onChange={e => setBulkAdaptationText(e.target.value)} placeholder={
                                                (() => {
                                                    const customCols = formIngredientIds.filter(id => id !== 'silage' && id !== 'chari' && id !== 'straw' && id !== 'wanda' && !id.toLowerCase().includes('wanda'));
                                                    const customSuffix = customCols.map(id => (id === 'khal' || id.toLowerCase().includes('khal') || id.toLowerCase().includes('cottonseed')) ? '\t0.5' : '\t0').join('');
                                                    return bulkForageType === 'chari'
                                                        ? `1\t30\t0.35\t100\t18${customSuffix}\n2\t41\t0.35\t100\t22${customSuffix}`
                                                        : `1\t30\t0.35\t12.5\t18${customSuffix}\n2\t41\t0.35\t12.5\t22${customSuffix}`;
                                                })()
                                            }></textarea>
                                            <button type="button" class="btn btn-secondary" style={{ marginTop: '0.4rem' }} onClick={handleBulkImportAdaptation} disabled={!bulkAdaptationText.trim()}>
                                                <i class="fa-solid fa-plus"></i> Import Adaptation Rows
                                            </button>
                                        </div>
                                    </div>
                                )}

                                {bracketWarnings.length > 0 && (
                                    <div style={{ background: 'rgba(255, 193, 7, 0.05)', border: '1px solid rgba(255, 193, 7, 0.15)', borderRadius: '8px', padding: '0.6rem 0.9rem', marginBottom: '0.8rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                        <i class="fa-solid fa-triangle-exclamation" style={{ color: 'var(--accent-gold)' }}></i> Bracket check: {bracketWarnings.join(' · ')}
                                    </div>
                                )}

                                {isNewIngredientFormOpen && (
                                    <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: '1rem', background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.05)', padding: '0.8rem', borderRadius: '8px' }}>
                                        <div class="form-group" style={{ marginBottom: 0, minWidth: '180px' }}>
                                            <label style={{ fontSize: '0.75rem' }}>New Ingredient Name</label>
                                            <input type="text" class="form-control" placeholder="e.g. Custom Mineral Mix" value={newIngredientName} onChange={e => setNewIngredientName(e.target.value)} />
                                        </div>
                                        <button type="button" class="btn btn-primary" onClick={handleCreateAndAddIngredient} disabled={!newIngredientName.trim()}>
                                            <i class="fa-solid fa-plus"></i> Create &amp; Add Column
                                        </button>
                                        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', width: '100%' }}>
                                            Also registers it as a Feed Stock item — buy it from the Purchases tab and its price here updates automatically.
                                        </span>
                                    </div>
                                )}

                                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '0.6rem' }}>
                                    <button type="button" class="btn btn-secondary btn-sm" onClick={() => setShowMappingsPanel(!showMappingsPanel)}>
                                        <i class="fa-solid fa-link"></i> {showMappingsPanel ? 'Hide Stock Mappings' : '⚡ View / Edit Feed Stock Mappings'}
                                    </button>
                                </div>

                                {(showMappingsPanel || formIngredientIds.some(id => !findMatchingStockItem(id))) && (
                                    <div style={{ background: 'rgba(255, 193, 7, 0.08)', border: '1px solid rgba(255, 193, 7, 0.25)', borderRadius: '8px', padding: '0.8rem 1rem', marginBottom: '1rem' }}>
                                        <div style={{ fontSize: '0.82rem', fontWeight: '700', color: 'var(--accent-gold)', marginBottom: '0.3rem' }}>
                                            <i class="fa-solid fa-link"></i> Feed Stock Column Mappings
                                        </div>
                                        <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)', marginBottom: '0.6rem' }}>
                                            Columns are auto-linked by name. You can override which Feed Stock item any column (including Wanda) is linked to below:
                                        </div>
                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.8rem' }}>
                                            {formIngredientIds.map(colId => {
                                                const matched = findMatchingStockItem(colId);
                                                const isUnmatched = !matched;
                                                return (
                                                    <div key={colId} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', background: 'rgba(0,0,0,0.2)', padding: '0.35rem 0.6rem', borderRadius: '6px', border: isUnmatched ? '1px solid rgba(255,193,7,0.4)' : '1px solid rgba(255,255,255,0.05)' }}>
                                                        <span style={{ fontSize: '0.78rem', fontWeight: '600', color: 'var(--text-pure)' }}>
                                                            {feedIngredients.find(i => i.id === colId)?.name || colId}:
                                                        </span>
                                                        <select
                                                            class="form-control"
                                                            style={{ width: '190px', minHeight: '28px', height: '28px', fontSize: '0.75rem', padding: '0.1rem 0.4rem' }}
                                                            value={columnStockMappings[colId] || matched?.id || ''}
                                                            onChange={e => setColumnStockMappings(prev => ({ ...prev, [colId]: e.target.value }))}
                                                        >
                                                            <option value="">Select Feed Stock item…</option>
                                                            {feedIngredients.map(i => (
                                                                <option key={i.id} value={i.id}>{i.name} {i.isPremix ? '(Premix)' : ''}</option>
                                                            ))}
                                                        </select>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}

                                {/* Weekly schedule table */}
                                <div class="table-wrapper" style={{ marginBottom: '1rem' }}>
                                    <table class="data-table" style={{ fontSize: '0.8rem' }}>
                                        <thead>
                                            <tr>
                                                <th style={{ width: '50px' }}>WK</th>
                                                <th style={{ whiteSpace: 'nowrap' }}>FORAGE</th>
                                                <th>LIVE WT MIN</th>
                                                <th>LIVE WT MAX</th>
                                                <th>TARGET ADG</th>
                                                {formAdaptation.length === 0 && <th style={{ whiteSpace: 'nowrap' }}>DIET</th>}
                                                {formIngredientIds.map(id => {
                                                    const ing = feedIngredients.find(i => i.id === id);
                                                    return (
                                                        <th key={id} style={{ whiteSpace: 'nowrap' }}>
                                                            {ing?.name || id}
                                                            <button type="button" onClick={() => handleRemoveIngredientColumn(id)} style={{ background: 'none', border: 'none', color: 'hsl(0,75%,60%)', cursor: 'pointer', marginLeft: '0.3rem' }} title="Remove column">
                                                                <i class="fa-solid fa-xmark"></i>
                                                            </button>
                                                        </th>
                                                    );
                                                })}
                                                <th>NOTE</th>
                                                <th style={{ whiteSpace: 'nowrap' }}>EST. COST/DAY</th>
                                                <th style={{ width: '50px' }}></th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {formWeeks.map((w, idx) => {
                                                const isDayMode = w.scheduleMode === 'day';
                                                return (
                                                <React.Fragment key={idx}>
                                                <tr>
                                                    <td>
                                                        <input type="number" class="form-control" style={{ width: '55px', minHeight: '32px', height: '32px', padding: '0.2rem 0.4rem' }} value={w.week} onChange={e => handleWeekFieldChange(idx, 'week', e.target.value)} />
                                                    </td>
                                                    <td>
                                                        <select class="form-control" style={{ minHeight: '32px', height: '32px', padding: '0.2rem 0.4rem' }} value={w.forageType || 'silage'} onChange={e => handleWeekFieldChange(idx, 'forageType', e.target.value)}>
                                                            {FORAGE_TYPES.map(ft => <option key={ft.id} value={ft.id}>{ft.label}</option>)}
                                                        </select>
                                                    </td>
                                                    <td>
                                                        <input type="number" class="form-control" style={{ width: '80px', minHeight: '32px', height: '32px', padding: '0.2rem 0.4rem' }} value={w.liveWeightMin} onChange={e => handleWeekFieldChange(idx, 'liveWeightMin', e.target.value)} />
                                                    </td>
                                                    <td>
                                                        <input type="number" class="form-control" style={{ width: '80px', minHeight: '32px', height: '32px', padding: '0.2rem 0.4rem' }} value={w.liveWeightMax} onChange={e => handleWeekFieldChange(idx, 'liveWeightMax', e.target.value)} />
                                                    </td>
                                                    <td>
                                                        <input type="number" step="0.01" class="form-control" style={{ width: '75px', minHeight: '32px', height: '32px', padding: '0.2rem 0.4rem' }} value={w.targetAdg} onChange={e => handleWeekFieldChange(idx, 'targetAdg', e.target.value)} />
                                                    </td>
                                                    {formAdaptation.length === 0 && (
                                                    <td>
                                                        <button
                                                            type="button"
                                                            class="btn btn-secondary"
                                                            style={{ padding: '0.2rem 0.5rem', minHeight: '28px', height: '28px', fontSize: '0.72rem', whiteSpace: 'nowrap' }}
                                                            onClick={() => handleToggleWeekMode(idx)}
                                                            title={isDayMode ? 'Same ration every day of this week' : 'Set a different ration for each of the 7 days'}
                                                        >
                                                            <i class={`fa-solid ${isDayMode ? 'fa-calendar-days' : 'fa-calendar-week'}`}></i> {isDayMode ? 'Per Day' : 'Per Week'}
                                                        </button>
                                                    </td>
                                                    )}
                                                    {formIngredientIds.map(id => (
                                                        <td key={id}>
                                                            {isDayMode ? (
                                                                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>Set below ↓</span>
                                                            ) : (
                                                                <input type="number" step="0.001" class="form-control" style={{ width: '75px', minHeight: '32px', height: '32px', padding: '0.2rem 0.4rem' }} value={w.ingredients[id] ?? 0} onChange={e => handleWeekIngredientChange(idx, id, e.target.value)} />
                                                            )}
                                                        </td>
                                                    ))}
                                                    <td>
                                                        <input type="text" class="form-control" style={{ minWidth: '160px', minHeight: '32px', height: '32px', padding: '0.2rem 0.4rem' }} value={w.note} onChange={e => handleWeekFieldChange(idx, 'note', e.target.value)} placeholder="e.g. adaptation week" />
                                                    </td>
                                                    <td style={{ whiteSpace: 'nowrap', color: 'var(--text-muted)' }}>
                                                        {Math.round(estimateWeekAvgCost(w))} PKR{isDayMode && <span style={{ fontSize: '0.68rem' }}> avg</span>}
                                                    </td>
                                                    <td style={{ textAlign: 'center' }}>
                                                        <button type="button" onClick={() => handleRemoveWeek(idx)} style={{ background: 'none', border: 'none', color: 'hsl(0,75%,60%)', cursor: 'pointer' }} title="Remove week">
                                                            <i class="fa-solid fa-trash-can"></i>
                                                        </button>
                                                    </td>
                                                </tr>
                                                {isDayMode && formAdaptation.length === 0 && (
                                                    <tr>
                                                        <td colSpan={9 + formIngredientIds.length} style={{ background: 'rgba(0,0,0,0.15)', padding: '0.7rem' }}>
                                                            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
                                                                <i class="fa-solid fa-calendar-days"></i> Daily diet for Week {w.week || idx + 1} — Day 1 is the pen's first day in this bracket (from its cycle start date).
                                                            </div>
                                                            <div class="table-wrapper">
                                                                <table class="data-table" style={{ fontSize: '0.78rem' }}>
                                                                    <thead>
                                                                        <tr>
                                                                            <th style={{ width: '60px' }}>DAY</th>
                                                                            {formIngredientIds.map(id => {
                                                                                const ing = feedIngredients.find(i => i.id === id);
                                                                                return <th key={id} style={{ whiteSpace: 'nowrap' }}>{ing?.name || id}</th>;
                                                                            })}
                                                                            <th style={{ whiteSpace: 'nowrap' }}>EST. COST/DAY</th>
                                                                        </tr>
                                                                    </thead>
                                                                    <tbody>
                                                                        {DAYS_OF_WEEK.map(day => (
                                                                            <tr key={day}>
                                                                                <td style={{ fontWeight: '700', color: 'var(--text-pure)' }}>Day {day}</td>
                                                                                {formIngredientIds.map(id => (
                                                                                    <td key={id}>
                                                                                        <input
                                                                                            type="number"
                                                                                            step="0.001"
                                                                                            class="form-control"
                                                                                            style={{ width: '75px', minHeight: '30px', height: '30px', padding: '0.15rem 0.4rem' }}
                                                                                            value={w.dailyIngredients?.[day]?.[id] ?? 0}
                                                                                            onChange={e => handleDailyIngredientChange(idx, day, id, e.target.value)}
                                                                                        />
                                                                                    </td>
                                                                                ))}
                                                                                <td style={{ whiteSpace: 'nowrap', color: 'var(--text-muted)' }}>
                                                                                    {Math.round(estimateWeekCost(w.dailyIngredients?.[day]))} PKR
                                                                                </td>
                                                                            </tr>
                                                                        ))}
                                                                    </tbody>
                                                                </table>
                                                            </div>
                                                        </td>
                                                    </tr>
                                                )}
                                                </React.Fragment>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>

                                {/* Adaptation Table (Day 1-7, percentage-based, per forage type) */}
                                <div style={{ marginBottom: '1.2rem', background: 'rgba(0,0,0,0.15)', padding: '0.9rem', borderRadius: '8px' }}>
                                    <div class="form-header-bar" style={{ marginBottom: '0.5rem' }}>
                                        <h4 style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-pure)' }}>
                                            <i class="fa-solid fa-seedling"></i> Adaptation Table (Day 1–7)
                                        </h4>
                                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                                            {FORAGE_TYPES.filter(ft => !formAdaptation.some(r => r.forageType === ft.id)).map(ft => (
                                                <button key={ft.id} type="button" class="btn btn-secondary btn-sm" onClick={() => handleAddAdaptationSet(ft.id)}>
                                                    <i class="fa-solid fa-plus"></i> Add {ft.label} Adaptation
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                    <small style={{ color: 'var(--text-muted)', display: 'block', marginBottom: '0.7rem' }}>
                                        For a pen's first 7 days on feed, this overrides the steady-state bracket above: Wanda is fed as a % of whatever the pen's <em>current</em> weight bracket's Wanda quantity is, Toori is a fixed kg, Chari is fed as a % of the bracket's Chari quantity, Silage is an explicitly imported/entered kg, and Starch Cap is reference-only. A plan with no adaptation table falls back to the legacy Per-Day toggle on the bracket table instead.
                                    </small>

                                    {formAdaptation.length === 0 && (
                                        <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                                            No adaptation table configured for this plan yet.
                                        </div>
                                    )}

                                    {FORAGE_TYPES.map(ft => {
                                        const rows = formAdaptation.filter(r => r.forageType === ft.id).sort((a, b) => a.day - b.day);
                                        if (rows.length === 0) return null;
                                        return (
                                            <div key={ft.id} style={{ marginBottom: '1rem' }}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.3rem' }}>
                                                    <strong style={{ fontSize: '0.8rem', color: 'var(--text-pure)' }}>{ft.label} Adaptation</strong>
                                                    <button type="button" onClick={() => handleRemoveAdaptationSet(ft.id)} style={{ background: 'none', border: 'none', color: 'hsl(0,75%,60%)', cursor: 'pointer', fontSize: '0.72rem' }}>
                                                        <i class="fa-solid fa-trash-can"></i> Remove {ft.label} set
                                                    </button>
                                                </div>
                                                <div class="table-wrapper">
                                                    <table class="data-table" style={{ fontSize: '0.8rem' }}>
                                                        <thead>
                                                            <tr>
                                                                <th style={{ width: '70px' }}>DAY</th>
                                                                <th>WANDA %</th>
                                                                <th>TOORI (KG)</th>
                                                                <th>{ft.id === 'chari' ? 'CHARI %' : 'SILAGE (KG)'}</th>
                                                                {formIngredientIds.filter(id => id !== 'silage' && id !== 'chari' && id !== 'straw' && id !== 'wanda' && !id.toLowerCase().includes('wanda')).map(id => {
                                                                    const name = feedIngredients.find(i => i.id === id)?.name || id;
                                                                    const isKhal = id === 'khal' || id.toLowerCase().includes('khal') || id.toLowerCase().includes('cottonseed');
                                                                    return (
                                                                        <th key={id} style={{ whiteSpace: 'nowrap' }}>
                                                                            {name.toUpperCase()} {isKhal ? '(KHAL %)' : '(% BW)'}
                                                                        </th>
                                                                    );
                                                                })}
                                                                <th style={{ whiteSpace: 'nowrap' }}>STARCH CAP % (ref)</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody>
                                                            {rows.map(r => (
                                                                <tr key={r.day}>
                                                                    <td style={{ fontWeight: '700', color: 'var(--text-pure)' }}>Day {r.day}</td>
                                                                    <td>
                                                                        <input type="number" step="0.1" class="form-control" style={{ width: '80px', minHeight: '32px', height: '32px', padding: '0.2rem 0.4rem' }} value={r.wandaPct} onChange={e => handleAdaptationFieldChange(ft.id, r.day, 'wandaPct', e.target.value)} />
                                                                    </td>
                                                                    <td>
                                                                        <input type="number" step="0.01" class="form-control" style={{ width: '80px', minHeight: '32px', height: '32px', padding: '0.2rem 0.4rem' }} value={r.tooriKg} onChange={e => handleAdaptationFieldChange(ft.id, r.day, 'tooriKg', e.target.value)} />
                                                                    </td>
                                                                    <td>
                                                                        {ft.id === 'chari' ? (
                                                                            <input type="number" step="0.1" class="form-control" style={{ width: '80px', minHeight: '32px', height: '32px', padding: '0.2rem 0.4rem' }} value={r.foragePct ?? 100} onChange={e => handleAdaptationFieldChange(ft.id, r.day, 'foragePct', e.target.value)} />
                                                                        ) : (
                                                                            <input type="number" step="0.1" class="form-control" style={{ width: '80px', minHeight: '32px', height: '32px', padding: '0.2rem 0.4rem' }} value={r.forageKg ?? 0} onChange={e => handleAdaptationFieldChange(ft.id, r.day, 'forageKg', e.target.value)} />
                                                                        )}
                                                                    </td>
                                                                    {formIngredientIds.filter(id => id !== 'silage' && id !== 'chari' && id !== 'straw' && id !== 'wanda' && !id.toLowerCase().includes('wanda')).map(id => (
                                                                        <td key={id}>
                                                                            <input
                                                                                type="number"
                                                                                step="0.01"
                                                                                class="form-control"
                                                                                style={{ width: '80px', minHeight: '32px', height: '32px', padding: '0.2rem 0.4rem' }}
                                                                                value={r.custom?.[id] ?? r[id] ?? ''}
                                                                                onChange={e => handleCustomAdaptationFieldChange(ft.id, r.day, id, e.target.value)}
                                                                                placeholder={id === 'khal' || id.toLowerCase().includes('khal') || id.toLowerCase().includes('cottonseed') ? "0.5" : "0"}
                                                                            />
                                                                        </td>
                                                                    ))}
                                                                    <td>
                                                                        <input type="number" step="0.1" class="form-control" style={{ width: '80px', minHeight: '32px', height: '32px', padding: '0.2rem 0.4rem' }} value={r.starchCapPct} onChange={e => handleAdaptationFieldChange(ft.id, r.day, 'starchCapPct', e.target.value)} />
                                                                    </td>
                                                                </tr>
                                                            ))}
                                                        </tbody>
                                                    </table>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>

                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
                                    <button type="button" class="btn btn-secondary" onClick={handleAddWeek}>
                                        <i class="fa-solid fa-plus"></i> Add Week
                                    </button>
                                    <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                                        {saveConfirm && (
                                            <span style={{ fontSize: '0.82rem', color: 'var(--primary-green-light)', fontWeight: '600' }}>
                                                <i class="fa-solid fa-circle-check"></i> Saved!
                                            </span>
                                        )}
                                        <button type="submit" class="btn btn-primary"><i class="fa-solid fa-floppy-disk"></i> Save Ration Plan</button>
                                    </div>
                                </div>
                            </form>
                        </div>
                    )}
                </div>
            )}

            {/* ═══ TAB: PEN ASSIGNMENT ═══ */}
            {activeTab === 'pens' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

                    {unassignedPens.length > 0 && (
                        <div style={{ background: 'rgba(255, 193, 7, 0.05)', border: '1px solid rgba(255, 193, 7, 0.15)', borderRadius: '8px', padding: '0.9rem 1.1rem', display: 'flex', gap: '0.9rem', alignItems: 'flex-start' }}>
                            <i class="fa-solid fa-triangle-exclamation" style={{ color: 'var(--accent-gold)', fontSize: '1.1rem', marginTop: '0.15rem' }}></i>
                            <span style={{ color: 'var(--text-muted)', fontSize: '0.82rem', lineHeight: '1.5' }}>
                                <strong style={{ color: 'var(--text-pure)' }}>{unassignedPens.length} pen{unassignedPens.length === 1 ? '' : 's'} with active animals have no Ration Plan assigned</strong> and can't be fed from the TMR Calculator: Pen {unassignedPens.join(', Pen ')}. Assign a plan below.
                            </span>
                        </div>
                    )}

                    {strictSpreadPens.length > 0 && (
                        <div style={{ background: 'rgba(220, 53, 69, 0.08)', border: '1px solid rgba(220, 53, 69, 0.3)', borderRadius: '8px', padding: '0.9rem 1.1rem', display: 'flex', gap: '0.9rem', alignItems: 'flex-start' }}>
                            <i class="fa-solid fa-triangle-exclamation" style={{ color: 'hsl(0,75%,60%)', fontSize: '1.1rem', marginTop: '0.15rem' }}></i>
                            <span style={{ color: 'var(--text-muted)', fontSize: '0.82rem', lineHeight: '1.5' }}>
                                <strong style={{ color: 'hsl(0,75%,65%)' }}>{strictSpreadPens.length} pen{strictSpreadPens.length === 1 ? '' : 's'} mix animals more than 20% apart in body weight</strong> — {strictSpreadPens.map(p => `Pen ${p.penId} (${p.spreadPct.toFixed(0)}% spread)`).join(', ')}. Re-sort at intake — this is too wide for the bracket match and batch feed sheet to stay accurate.
                            </span>
                        </div>
                    )}

                    {wideSpreadPens.length > 0 && (
                        <div style={{ background: 'rgba(255, 193, 7, 0.05)', border: '1px solid rgba(255, 193, 7, 0.15)', borderRadius: '8px', padding: '0.9rem 1.1rem', display: 'flex', gap: '0.9rem', alignItems: 'flex-start' }}>
                            <i class="fa-solid fa-scale-unbalanced" style={{ color: 'var(--accent-gold)', fontSize: '1.1rem', marginTop: '0.15rem' }}></i>
                            <span style={{ color: 'var(--text-muted)', fontSize: '0.82rem', lineHeight: '1.5' }}>
                                <strong style={{ color: 'var(--text-pure)' }}>{wideSpreadPens.length} pen{wideSpreadPens.length === 1 ? '' : 's'} mix animals 15–20% apart in body weight</strong> — {wideSpreadPens.map(p => `Pen ${p.penId} (${p.spreadPct.toFixed(0)}% spread)`).join(', ')}. Consider re-sorting at intake.
                            </span>
                        </div>
                    )}

                    {isAdmin && (
                        <div class="glass-panel">
                            <h3 class="panel-title"><i class="fa-solid fa-circle-plus"></i> Register a Pen</h3>
                            <form onSubmit={handleAddPen} style={{ display: 'flex', gap: '1rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                                <div class="form-group" style={{ flex: 1, minWidth: '200px', marginBottom: 0 }}>
                                    <label>Pen Identifier</label>
                                    <input type="text" class="form-control" placeholder="e.g. A, B, 1" value={newPenId} onChange={e => setNewPenId(e.target.value)} required />
                                </div>
                                <button type="submit" class="btn btn-primary"><i class="fa-solid fa-circle-plus"></i> Add Pen</button>
                            </form>
                        </div>
                    )}

                    <div class="glass-panel">
                        <h3 class="panel-title"><i class="fa-solid fa-warehouse"></i> Pen Ration Plan Assignment</h3>
                        <div class="table-wrapper">
                            <table class="data-table" style={{ fontSize: '0.85rem' }}>
                                <thead>
                                    <tr>
                                        <th>PEN</th>
                                        <th>HEAD COUNT</th>
                                        <th>AVG WEIGHT</th>
                                        <th>ASSIGNED PLAN</th>
                                        <th>FORAGE</th>
                                        <th>CYCLE START DATE</th>
                                        <th>EXPECTED EXIT</th>
                                        <th>CURRENT RATION</th>
                                        {isAdmin && <th style={{ textAlign: 'center', width: '70px' }}>REMOVE</th>}
                                    </tr>
                                </thead>
                                <tbody>
                                    {distinctPenNames.map(penId => {
                                        const penConfig = pens.find(p => p.id === penId) || {};
                                        const resolved = getPenRationRow(penId);
                                        return (
                                            <tr key={penId}>
                                                <td style={{ fontWeight: '700', color: 'var(--text-pure)' }}>Pen {penId}</td>
                                                <td>{resolved ? resolved.headCount : animals.filter(a => a.pen === penId && a.status !== 'Sold' && a.status !== 'Deceased').length}</td>
                                                <td>{resolved?.avgWeight ? `${resolved.avgWeight.toFixed(1)} kg` : '—'}</td>
                                                <td>
                                                    <select
                                                        class="form-control"
                                                        style={{ minHeight: '32px', height: '32px', padding: '0.2rem 0.5rem', borderColor: unassignedPens.includes(penId) ? 'rgba(255, 193, 7, 0.5)' : undefined }}
                                                        value={penConfig.planId ? `v2:${penConfig.planId}` : (penConfig.rationPlanId ? `legacy:${penConfig.rationPlanId}` : '')}
                                                        onChange={e => handlePenPlanChange(penId, e.target.value)}
                                                        disabled={!isAdmin}
                                                    >
                                                        <option value="">— No plan —</option>
                                                        <optgroup label="Imported Plans (v2)">
                                                            {rationPlansV2.map(plan => (
                                                                <option key={plan.id} value={`v2:${plan.id}`}>{plan.name} v{plan.version}</option>
                                                            ))}
                                                        </optgroup>
                                                        <optgroup label="Legacy Plans">
                                                            {rationPlans.map(plan => (
                                                                <option key={plan.id} value={`legacy:${plan.id}`}>{plan.name}</option>
                                                            ))}
                                                        </optgroup>
                                                    </select>
                                                    {unassignedPens.includes(penId) && (
                                                        <span style={{ fontSize: '0.68rem', color: 'var(--accent-gold)', display: 'block', marginTop: '0.2rem' }}>
                                                            <i class="fa-solid fa-triangle-exclamation"></i> Can't be fed
                                                        </span>
                                                    )}
                                                </td>
                                                <td>
                                                    <select
                                                        class="form-control"
                                                        style={{ minHeight: '32px', height: '32px', padding: '0.2rem 0.5rem' }}
                                                        value={penConfig.forageType || 'silage'}
                                                        onChange={e => handlePenFieldChange(penId, 'forageType', e.target.value)}
                                                        disabled={!isAdmin}
                                                    >
                                                        {FORAGE_TYPES.map(ft => <option key={ft.id} value={ft.id}>{ft.label}</option>)}
                                                    </select>
                                                </td>
                                                <td>
                                                    <input
                                                        type="date"
                                                        class="form-control"
                                                        style={{ minHeight: '32px', height: '32px', padding: '0.2rem 0.5rem' }}
                                                        value={penConfig.cycleStartDate || ''}
                                                        onChange={e => handlePenFieldChange(penId, 'cycleStartDate', e.target.value)}
                                                        disabled={!isAdmin}
                                                    />
                                                </td>
                                                <td>
                                                    <input
                                                        type="date"
                                                        class="form-control"
                                                        style={{ minHeight: '32px', height: '32px', padding: '0.2rem 0.5rem' }}
                                                        value={penConfig.expectedExitDate || ''}
                                                        onChange={e => handlePenFieldChange(penId, 'expectedExitDate', e.target.value)}
                                                        disabled={!isAdmin}
                                                    />
                                                </td>
                                                <td>
                                                    {resolved ? (
                                                        resolved.blocked ? (
                                                            <span style={{ color: 'hsl(0,75%,65%)' }}>
                                                                <i class="fa-solid fa-ban"></i> Feeding blocked
                                                                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>{resolved.error}</div>
                                                            </span>
                                                        ) : resolved.system === 'v2' ? (
                                                            <span>
                                                                Bracket {resolved.bracketMin}–{resolved.bracketMax}kg
                                                                {resolved.phase === 'ADAPTATION' && <span style={{ color: 'var(--accent-gold)' }}> · Day {resolved.dayNo} (adaptation)</span>}
                                                                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                                                                    Projected {resolved.avgProjectedWeight?.toFixed(1)}kg · target {resolved.week.targetAdg} kg/day
                                                                </div>
                                                            </span>
                                                        ) : (
                                                            <span>
                                                                {resolved.usesAdaptationTable ? (
                                                                    <span style={{ color: 'var(--accent-gold)' }}>Adaptation Day {resolved.adaptationDay}</span>
                                                                ) : (
                                                                    <span>
                                                                        Week {resolved.week.week}
                                                                        {resolved.usesDailyDiet && resolved.dayInWeek && <span style={{ color: 'var(--primary-green-light)' }}> · Day {resolved.dayInWeek}</span>}
                                                                        {resolved.isAdaptationWeek && <span style={{ color: 'var(--accent-gold)' }}> (adaptation)</span>}
                                                                    </span>
                                                                )}
                                                                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                                                                    {resolved.matchedByWeight ? 'Matched by weight' : 'Matched by cycle day (no weigh-in yet)'} · target {resolved.week.targetAdg} kg/day
                                                                    {resolved.forageAdLib && <span> · {resolved.adLibForageId === 'chari' ? 'Chari' : 'Silage'} ad lib</span>}
                                                                </div>
                                                            </span>
                                                        )
                                                    ) : (
                                                        <span style={{ color: 'var(--text-muted)' }}>—</span>
                                                    )}
                                                </td>
                                                {isAdmin && (
                                                    <td style={{ textAlign: 'center' }}>
                                                        <button
                                                            type="button"
                                                            class="btn btn-secondary"
                                                            style={{ padding: '0.2rem 0.5rem', minHeight: '28px', height: '28px', color: 'hsl(0,75%,55%)', borderColor: 'rgba(220,53,69,0.2)' }}
                                                            onClick={() => handleDeletePen(penId)}
                                                        >
                                                            <i class="fa-solid fa-trash-can"></i>
                                                        </button>
                                                    </td>
                                                )}
                                            </tr>
                                        );
                                    })}
                                    {distinctPenNames.length === 0 && (
                                        <tr>
                                            <td colSpan={isAdmin ? 9 : 8} style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--text-muted)' }}>
                                                No pens registered yet. Assign animals to a pen in Herd Registry, or add one above.
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}

            {/* ═══ TAB: FEED PRICING ═══ */}
            {activeTab === 'costs' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

                    <div style={{ background: 'rgba(255, 193, 7, 0.05)', border: '1px solid rgba(255, 193, 7, 0.15)', borderRadius: '8px', padding: '0.9rem 1.1rem', display: 'flex', gap: '0.9rem', alignItems: 'flex-start' }}>
                        <i class="fa-solid fa-circle-info" style={{ color: 'var(--accent-gold)', fontSize: '1.1rem', marginTop: '0.15rem' }}></i>
                        <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem', lineHeight: '1.5' }}>
                            Prices here are <strong>read-only</strong> — each ingredient's current weighted-average cost per kg, pulled live from its purchase history in Feed Stock. It drives every cost figure across the portal (Ration Plan estimates, TMR Calculator, Feed &amp; Growth Report). To change what an ingredient costs, record a purchase at the new rate in <strong>Feed Stock → Purchases</strong> — there's nothing to edit here.
                        </span>
                    </div>

                    <div class="glass-panel">
                        <div class="form-header-bar" style={{ marginBottom: '1rem' }}>
                            <h3 class="panel-title" style={{ margin: 0 }}><i class="fa-solid fa-money-bill-wave"></i> Feed Ingredient Pricing</h3>
                            {isAdmin && (
                                <button type="button" class="btn btn-secondary btn-sm" onClick={() => setIsAddIngredientFormOpen(!isAddIngredientFormOpen)}>
                                    <i class={`fa-solid ${isAddIngredientFormOpen ? 'fa-xmark' : 'fa-plus'}`}></i> {isAddIngredientFormOpen ? 'Cancel' : 'Add Ingredient'}
                                </button>
                            )}
                        </div>

                        {isAddIngredientFormOpen && (
                            <form onSubmit={handleAddStockIngredient} style={{ background: 'rgba(0, 0, 0, 0.2)', border: '1px solid rgba(255, 255, 255, 0.05)', borderRadius: '8px', padding: '0.8rem 1rem', marginBottom: '1.2rem' }}>
                                <div style={{ display: 'grid', gridTemplateColumns: '2fr auto', gap: '0.8rem', alignItems: 'flex-end' }}>
                                    <div class="form-group" style={{ marginBottom: 0 }}>
                                        <label style={{ fontSize: '0.75rem' }}>Name</label>
                                        <input type="text" class="form-control" placeholder="e.g. Molasses" value={newStockIngredientName} onChange={e => setNewStockIngredientName(e.target.value)} required />
                                    </div>
                                    <button type="submit" class="btn btn-primary">Add</button>
                                </div>
                                <small style={{ color: 'var(--text-muted)', display: 'block', marginTop: '0.5rem' }}>
                                    Registers it as a Feed Stock item too — its price appears here as soon as you record a purchase.
                                </small>
                            </form>
                        )}

                        <div class="table-wrapper">
                            <table class="data-table" style={{ fontSize: '0.85rem' }}>
                                <thead>
                                    <tr>
                                        <th>INGREDIENT</th>
                                        <th>CURRENT AVG PRICE (PKR/KG)</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {feedIngredients.map(ing => {
                                        const stockPrice = getIngredientStockPrice(ing.id);
                                        return (
                                            <tr key={ing.id}>
                                                <td style={{ fontWeight: '600', color: 'var(--text-pure)' }}>{ing.name}</td>
                                                <td>
                                                    {stockPrice !== null
                                                        ? `${stockPrice.toFixed(2)} PKR`
                                                        : <span style={{ color: 'var(--text-muted)' }} title="No matching Feed Stock item — legacy price used">{(ing.price || 0).toFixed(2)} PKR (not stock-tracked)</span>
                                                    }
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

// Detailed, filterable view of a single imported (v2) plan's bracket rows — the drill-down
// that used to only show as a "333" count. Sorted/grouped the same way the CSV export is
// (forage type → phase → day → weight) so the on-screen table and the exported file read
// identically. Row-level edits (admin only) go through UPDATE_RATION_ROW, which re-validates
// bounds + bracket contiguity against sibling rows before writing.
function BracketDetailPanel({
    plan, rationRows, rationRowItems, feedIngredients, isAdmin,
    bracketFilterForage, setBracketFilterForage,
    bracketFilterPhase, setBracketFilterPhase,
    editingRowId, openEditRow, cancelEditRow,
    rowEditWtMin, setRowEditWtMin,
    rowEditWtMax, setRowEditWtMax,
    rowEditTargetAdg, setRowEditTargetAdg,
    rowEditEstCost, setRowEditEstCost,
    rowEditItems, setRowEditItems,
    rowSavingId, rowSaveErrors, handleSaveRow
}) {
    const allRows = rationRows.filter(r => r.planId === plan.id);
    const forageTypes = [...new Set(allRows.map(r => r.forageType))].sort();

    const ingredientIdSet = new Set();
    allRows.forEach(row => {
        rationRowItems.filter(i => i.rowId === row.id).forEach(i => ingredientIdSet.add(i.ingredientId));
    });
    const ingredientIds = [...ingredientIdSet];
    const ingredientNameById = (id) => feedIngredients.find(f => f.id === id)?.name || id;

    const filteredRows = allRows.filter(r =>
        (bracketFilterForage === 'all' || r.forageType === bracketFilterForage) &&
        (bracketFilterPhase === 'all' || r.phase === bracketFilterPhase)
    ).sort((a, b) => {
        if (a.forageType !== b.forageType) return a.forageType.localeCompare(b.forageType);
        if (a.phase !== b.phase) return a.phase.localeCompare(b.phase);
        const aDay = a.dayNo == null ? -1 : a.dayNo;
        const bDay = b.dayNo == null ? -1 : b.dayNo;
        if (aDay !== bDay) return aDay - bDay;
        return a.wtMin - b.wtMin;
    });

    return (
        <div style={{ padding: '1rem 1.2rem' }}>
            <div style={{ display: 'flex', gap: '0.8rem', alignItems: 'center', marginBottom: '0.8rem', flexWrap: 'wrap' }}>
                <strong style={{ color: 'var(--text-pure)', fontSize: '0.85rem' }}>
                    <i class="fa-solid fa-table-list"></i> {filteredRows.length} of {allRows.length} brackets
                </strong>
                <select class="form-control" style={{ width: 'auto', fontSize: '0.78rem' }} value={bracketFilterForage} onChange={e => setBracketFilterForage(e.target.value)}>
                    <option value="all">All forage types</option>
                    {forageTypes.map(ft => <option key={ft} value={ft}>{ft}</option>)}
                </select>
                <select class="form-control" style={{ width: 'auto', fontSize: '0.78rem' }} value={bracketFilterPhase} onChange={e => setBracketFilterPhase(e.target.value)}>
                    <option value="all">Both phases</option>
                    <option value="ADAPTATION">Adaptation</option>
                    <option value="STEADY">Steady</option>
                </select>
                {isAdmin && (
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                        <i class="fa-solid fa-circle-info"></i> Editing here corrects this exact version in place — pens already on v{plan.version} pick up the change immediately.
                    </span>
                )}
            </div>

            {rowSaveErrors.length > 0 && (
                <div style={{ background: 'rgba(220,50,50,0.12)', border: '1px solid rgba(220,50,50,0.4)', borderRadius: '8px', padding: '0.6rem 0.8rem', marginBottom: '0.8rem', fontSize: '0.76rem', color: '#ff8080' }}>
                    {rowSaveErrors.map((e, i) => <div key={i}><i class="fa-solid fa-triangle-exclamation"></i> {e}</div>)}
                </div>
            )}

            <div style={{ maxHeight: '440px', overflowY: 'auto', border: '1px solid var(--border-subtle)', borderRadius: '8px' }}>
                <table class="data-table" style={{ fontSize: '0.78rem' }}>
                    <thead style={{ position: 'sticky', top: 0, background: 'var(--bg-card, #1a1d24)', zIndex: 1 }}>
                        <tr>
                            <th>FORAGE</th>
                            <th>PHASE</th>
                            <th>DAY</th>
                            <th>WT MIN</th>
                            <th>WT MAX</th>
                            <th>TARGET ADG</th>
                            {ingredientIds.map(id => <th key={id}>{ingredientNameById(id)}</th>)}
                            <th>EST COST</th>
                            {isAdmin && <th>ACTIONS</th>}
                        </tr>
                    </thead>
                    <tbody>
                        {filteredRows.map(row => {
                            const isEditing = editingRowId === row.id;
                            const itemsByIng = {};
                            rationRowItems.filter(i => i.rowId === row.id).forEach(i => { itemsByIng[i.ingredientId] = i.qtyKgPerHeadPerDay; });

                            if (isEditing) {
                                return (
                                    <tr key={row.id} style={{ background: 'rgba(212,175,55,0.08)' }}>
                                        <td>{row.forageType}</td>
                                        <td>{row.phase}</td>
                                        <td>{row.dayNo ?? '—'}</td>
                                        <td><input type="number" class="form-control" style={{ width: '65px' }} value={rowEditWtMin} onChange={e => setRowEditWtMin(e.target.value)} /></td>
                                        <td><input type="number" class="form-control" style={{ width: '65px' }} value={rowEditWtMax} onChange={e => setRowEditWtMax(e.target.value)} /></td>
                                        <td><input type="number" step="0.01" class="form-control" style={{ width: '70px' }} value={rowEditTargetAdg} onChange={e => setRowEditTargetAdg(e.target.value)} /></td>
                                        {ingredientIds.map(id => (
                                            <td key={id}>
                                                <input type="number" step="0.01" class="form-control" style={{ width: '65px' }}
                                                    value={rowEditItems[id] ?? 0}
                                                    onChange={e => setRowEditItems(prev => ({ ...prev, [id]: e.target.value }))} />
                                            </td>
                                        ))}
                                        <td><input type="number" step="0.01" class="form-control" style={{ width: '75px' }} value={rowEditEstCost} onChange={e => setRowEditEstCost(e.target.value)} /></td>
                                        <td>
                                            <div style={{ display: 'flex', gap: '0.3rem' }}>
                                                <button type="button" class="btn btn-primary btn-sm" title="Save bracket" onClick={handleSaveRow} disabled={rowSavingId === row.id}>
                                                    <i class={`fa-solid ${rowSavingId === row.id ? 'fa-hourglass-half' : 'fa-check'}`}></i>
                                                </button>
                                                <button type="button" class="btn btn-ghost btn-sm" title="Cancel" onClick={cancelEditRow}>
                                                    <i class="fa-solid fa-xmark"></i>
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            }

                            return (
                                <tr key={row.id}>
                                    <td>{row.forageType}</td>
                                    <td>{row.phase}</td>
                                    <td>{row.dayNo ?? '—'}</td>
                                    <td>{row.wtMin}</td>
                                    <td>{row.wtMax}</td>
                                    <td>{row.targetAdg}</td>
                                    {ingredientIds.map(id => (
                                        <td key={id}>{itemsByIng[id] != null ? itemsByIng[id] : '—'}</td>
                                    ))}
                                    <td>{row.estCostPerHeadPerDay != null ? row.estCostPerHeadPerDay.toFixed(2) : '—'}</td>
                                    {isAdmin && (
                                        <td>
                                            <button type="button" class="btn btn-ghost btn-sm" title="Edit this bracket" onClick={() => openEditRow(row, ingredientIds)}>
                                                <i class="fa-solid fa-pen-to-square"></i>
                                            </button>
                                        </td>
                                    )}
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
