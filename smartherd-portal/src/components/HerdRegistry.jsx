import React, { useContext, useState } from 'react';
import { createPortal } from 'react-dom';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { FarmContext } from '../context/FarmContext';
import { formatDate } from '../utils/formatDate';
import { todayPKT } from '../utils/dateOnly';
import { getLaggerIds } from '../utils/laggers';

// Accessors used to sort the herd table by column. Defined outside the component
// since they don't depend on props/state.
const SORT_ACCESSORS = {
    tag: (a) => a.rfid,
    breed: (a) => a.breed,
    entryDate: (a) => a.entryDate || '',
    mandiWeight: (a) => a.mandiWeight || 0,
    entryWeight: (a) => a.entryWeight,
    weight: (a) => a.currentWeight,
    gain: (a) => a.currentWeight - a.entryWeight,
    mandiPrice: (a) => a.mandiPrice || 0,
    mandiTax: (a) => a.mandiTax || 0,
    carriage: (a) => a.carriage || 0,
    miscExpense: (a) => a.miscExpense || 0,
    cost: (a) => a.purchasePrice,
    costPerKg: (a) => (a.entryWeight ? a.purchasePrice / a.entryWeight : 0),
    pen: (a) => a.pen || '',
    status: (a) => a.status
};

export default function HerdRegistry() {
    const { animals, addAnimal, updateAnimal, deleteAnimal, recordDeath, transitionAnimalStatus, breedsConfig, updateBreedsConfig, staffUser, myRequests, weightLogs, systemParams } = useContext(FarmContext);

    // Strictly the DB-backed Super Admin flag — non-admins can add animals freely
    // but have entry weight/purchase price edits and deletes staged for approval.
    const isSuperAdmin = staffUser?.isAdmin === true;

    // UI State
    const [search, setSearch] = useState('');
    const [filterStatus, setFilterStatus] = useState('All');
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingAnimal, setEditingAnimal] = useState(null);
    const [sortConfig, setSortConfig] = useState({ key: null, direction: 'asc' });
    const [notice, setNotice] = useState(null);
    const [showMyRequests, setShowMyRequests] = useState(false);

    // Advanced Feedlot Filter State
    const [entryDateFrom, setEntryDateFrom] = useState('');
    const [entryDateTo, setEntryDateTo] = useState('');
    const [selectedPen, setSelectedPen] = useState('All');
    const [selectedBreed, setSelectedBreed] = useState('All');
    const [selectedMandi, setSelectedMandi] = useState('All');
    const [minWeight, setMinWeight] = useState('');
    const [maxWeight, setMaxWeight] = useState('');
    const [weightType, setWeightType] = useState('currentWeight'); // 'currentWeight' | 'entryWeight'
    const [gainFilter, setGainFilter] = useState('All'); // 'All' | 'positive' | 'stagnantOrLoss' | 'highGain'
    const [marketReadyFilter, setMarketReadyFilter] = useState('All'); // 'All' | 'ready' | 'inProgress'
    const [duplicateFilter, setDuplicateFilter] = useState(false); // boolean: show only duplicate RFIDs
    const [showFilterPanel, setShowFilterPanel] = useState(false);

    // Deceased modal state
    const [deathAnimal, setDeathAnimal] = useState(null);
    const [deathDate, setDeathDate] = useState(todayPKT());
    const [deathCause, setDeathCause] = useState('Disease');

    // Form Input state
    const [rfid, setRfid] = useState('');
    const [breed, setBreed] = useState('');
    const [entryWeight, setEntryWeight] = useState('');
    const [purchasePrice, setPurchasePrice] = useState('');
    const [source, setSource] = useState('');
    const [status, setStatus] = useState('Quarantined');
    const [targetWeight, setTargetWeight] = useState('');
    const [entryDate, setEntryDate] = useState('');
    const [pen, setPen] = useState('');
    const [mandiPrice, setMandiPrice] = useState('');
    const [mandiWeight, setMandiWeight] = useState('');
    const [mandiTax, setMandiTax] = useState('');
    const [carriage, setCarriage] = useState('');
    const [miscExpense, setMiscExpense] = useState('');
    // When true, the Breed field is a free-text input instead of the preset dropdown —
    // lets staff register an animal with a breed that isn't in the configured list yet.
    const [customBreedMode, setCustomBreedMode] = useState(false);
    const CUSTOM_BREED_OPTION = '__custom__';

    // Derived unique dropdown options from herd data
    const uniquePens = React.useMemo(() => {
        const pens = new Set();
        animals.forEach(a => { if (a.pen) pens.add(a.pen); });
        return Array.from(pens).sort();
    }, [animals]);

    const uniqueBreeds = React.useMemo(() => {
        const breeds = new Set();
        animals.forEach(a => { if (a.breed) breeds.add(a.breed); });
        return Array.from(breeds).sort();
    }, [animals]);

    const uniqueMandis = React.useMemo(() => {
        const mandis = new Set();
        animals.forEach(a => { if (a.source) mandis.add(a.source); });
        return Array.from(mandis).sort();
    }, [animals]);

    // Feedlot shortcut metrics
    const stagnantCount = React.useMemo(() => {
        return animals.filter(a => (a.currentWeight - a.entryWeight) <= 0).length;
    }, [animals]);

    const marketReadyCount = React.useMemo(() => {
        return animals.filter(a => a.currentWeight >= (a.targetWeight || 360)).length;
    }, [animals]);

    const recentArrivalsCount = React.useMemo(() => {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - 30);
        const yyyy = cutoff.getFullYear();
        const mm = String(cutoff.getMonth() + 1).padStart(2, '0');
        const dd = String(cutoff.getDate()).padStart(2, '0');
        const cutoffStr = `${yyyy}-${mm}-${dd}`;
        return animals.filter(a => a.entryDate && a.entryDate >= cutoffStr).length;
    }, [animals]);

    // Duplicate RFID tracking across active herd
    const duplicateRfidsMap = React.useMemo(() => {
        const counts = {};
        animals.filter(a => a.status !== 'Deceased').forEach(a => {
            const tag = (a.rfid || '').trim().toLowerCase();
            if (tag) counts[tag] = (counts[tag] || 0) + 1;
        });
        return counts;
    }, [animals]);

    const duplicateCount = React.useMemo(() => {
        return animals.filter(a => {
            if (a.status === 'Deceased') return false;
            const tag = (a.rfid || '').trim().toLowerCase();
            return tag && duplicateRfidsMap[tag] > 1;
        }).length;
    }, [animals, duplicateRfidsMap]);

    // Active filter count
    const activeFilterCount = (
        (entryDateFrom ? 1 : 0) +
        (entryDateTo ? 1 : 0) +
        (selectedPen !== 'All' ? 1 : 0) +
        (selectedBreed !== 'All' ? 1 : 0) +
        (selectedMandi !== 'All' ? 1 : 0) +
        (minWeight !== '' ? 1 : 0) +
        (maxWeight !== '' ? 1 : 0) +
        (gainFilter !== 'All' ? 1 : 0) +
        (marketReadyFilter !== 'All' ? 1 : 0) +
        (duplicateFilter ? 1 : 0)
    );

    const handleResetFilters = () => {
        setSearch('');
        setFilterStatus('All');
        setEntryDateFrom('');
        setEntryDateTo('');
        setSelectedPen('All');
        setSelectedBreed('All');
        setSelectedMandi('All');
        setMinWeight('');
        setMaxWeight('');
        setGainFilter('All');
        setMarketReadyFilter('All');
        setDuplicateFilter(false);
    };

    const applyDatePreset = (preset) => {
        const today = new Date();
        const formatDateStr = (d) => {
            const yyyy = d.getFullYear();
            const mm = String(d.getMonth() + 1).padStart(2, '0');
            const dd = String(d.getDate()).padStart(2, '0');
            return `${yyyy}-${mm}-${dd}`;
        };

        if (preset === '7d') {
            const d = new Date(today);
            d.setDate(d.getDate() - 7);
            setEntryDateFrom(formatDateStr(d));
            setEntryDateTo(formatDateStr(today));
        } else if (preset === '30d') {
            const d = new Date(today);
            d.setDate(d.getDate() - 30);
            setEntryDateFrom(formatDateStr(d));
            setEntryDateTo(formatDateStr(today));
        } else if (preset === '90d') {
            const d = new Date(today);
            d.setDate(d.getDate() - 90);
            setEntryDateFrom(formatDateStr(d));
            setEntryDateTo(formatDateStr(today));
        } else if (preset === 'thisYear') {
            setEntryDateFrom(`${today.getFullYear()}-01-01`);
            setEntryDateTo(formatDateStr(today));
        } else if (preset === 'clear') {
            setEntryDateFrom('');
            setEntryDateTo('');
        }
    };

    const exportCSV = () => {
        const headers = ['#,RFID,Previous Tags,Breed,Entry Date,Mandi Weight (kg),Entry Weight (kg),Transit Shrink (kg),Transit Shrink (%),Current Weight (kg),Total Gain (kg),Mandi Price (PKR),Mandi Tax (PKR),Carriage (PKR),Misc Expense (PKR),Total Landed Cost (PKR),Actual Landed Cost per KG (PKR),Mandi Cost per KG (PKR),Source,Pen,Status'];
        const rows = sortedAnimals.map((a, idx) => {
            const shrinkKg = a.mandiWeight ? (a.mandiWeight - a.entryWeight).toFixed(1) : '';
            const shrinkPct = (a.mandiWeight && a.mandiWeight > 0) ? (((a.mandiWeight - a.entryWeight) / a.mandiWeight) * 100).toFixed(2) : '';
            const landedCostPerKg = a.entryWeight && a.purchasePrice ? (a.purchasePrice / a.entryWeight).toFixed(0) : '';
            const mandiCostPerKg = a.mandiWeight && a.mandiPrice ? (a.mandiPrice / a.mandiWeight).toFixed(0) : '';

            return [
                idx + 1,
                a.rfid,
                (a.previousTags && a.previousTags.length > 0) ? a.previousTags.join(';') : '',
                a.breed,
                formatDate(a.entryDate),
                a.mandiWeight || '',
                a.entryWeight,
                shrinkKg,
                shrinkPct,
                a.currentWeight,
                (a.currentWeight - a.entryWeight).toFixed(1),
                a.mandiPrice || '',
                a.mandiTax || '',
                a.carriage || '',
                a.miscExpense || '',
                a.purchasePrice,
                landedCostPerKg,
                mandiCostPerKg,
                a.source || '',
                a.pen || '',
                a.status
            ].join(',');
        });
        const csv = [...headers, ...rows].join('\n');
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `BA_Farms_Herd_${todayPKT()}.csv`;
        link.click();
        URL.revokeObjectURL(url);
    };

    const exportPDF = () => {
        const totalCost = filteredAnimals.reduce((sum, a) => sum + (a.purchasePrice || 0), 0);
        const totalWeight = filteredAnimals.reduce((sum, a) => sum + (a.entryWeight || 0), 0);
        const totalCurrentWeight = filteredAnimals.reduce((sum, a) => sum + (a.currentWeight || 0), 0);
        const totalGain = totalCurrentWeight - totalWeight;
        const avgPerKg = totalWeight > 0 ? totalCost / totalWeight : 0;

        const mandiAnimals = filteredAnimals.filter(a => a.mandiWeight && a.mandiWeight > 0);
        const totalMandiWeight = mandiAnimals.reduce((sum, a) => sum + a.mandiWeight, 0);
        const totalEntryWeightForMandi = mandiAnimals.reduce((sum, a) => sum + a.entryWeight, 0);
        const totalShrinkKg = totalMandiWeight - totalEntryWeightForMandi;
        const totalShrinkPct = totalMandiWeight > 0 ? ((totalShrinkKg / totalMandiWeight) * 100) : 0;
        const shrinkSummaryStr = totalMandiWeight > 0 ? `-${totalShrinkKg.toFixed(1)}kg (-${totalShrinkPct.toFixed(2)}%)` : '—';

        const totalMandiPrice = filteredAnimals.reduce((sum, a) => sum + (a.mandiPrice || 0), 0);
        const totalExpenses = filteredAnimals.reduce((sum, a) => sum + ((a.mandiTax || 0) + (a.carriage || 0) + (a.miscExpense || 0)), 0);

        const doc = new jsPDF({ orientation: 'landscape' });

        doc.setFontSize(16);
        doc.text('BA Farms — Herd Registry', 14, 15);
        doc.setFontSize(9);
        doc.setTextColor(100);
        const filterNote = activeFilterCount > 0 || search || filterStatus !== 'All' ? ' (Filtered View)' : '';
        const shrinkHeaderNote = totalMandiWeight > 0 ? ` · Transit Shrink: -${totalShrinkKg.toFixed(1)} kg (-${totalShrinkPct.toFixed(2)}%)` : '';
        const expenseHeaderNote = totalExpenses > 0 ? ` · Total Acquisition Exp: ${totalExpenses.toLocaleString()} PKR` : '';
        doc.text(`Generated ${formatDate(todayPKT())} · ${filteredAnimals.length} animal${filteredAnimals.length === 1 ? '' : 's'}${filterNote} · Avg Landed Cost: ${Math.round(avgPerKg).toLocaleString()} PKR/kg${shrinkHeaderNote}${expenseHeaderNote}`, 14, 21);

        autoTable(doc, {
            startY: 26,
            head: [['#', 'Tag', 'Breed', 'Entry Date', 'Mandi Wt', 'Entry Wt', 'Transit Shrink', 'Latest Wt', 'Mandi Base', 'Tax/Carriage/Misc', 'Total Landed Cost', 'Actual Cost/kg', 'Pen', 'Status']],
            body: sortedAnimals.map((a, idx) => {
                const shrinkKg = a.mandiWeight ? (a.mandiWeight - a.entryWeight) : null;
                const shrinkPct = (a.mandiWeight && a.mandiWeight > 0) ? ((shrinkKg / a.mandiWeight) * 100) : null;
                const shrinkStr = shrinkKg !== null ? `-${shrinkKg.toFixed(1)}kg (-${shrinkPct.toFixed(1)}%)` : '—';
                const exp = (a.mandiTax || 0) + (a.carriage || 0) + (a.miscExpense || 0);

                return [
                    idx + 1,
                    (a.previousTags && a.previousTags.length > 0) ? `${a.rfid} (prev: ${a.previousTags.join(', ')})` : a.rfid,
                    a.breed,
                    formatDate(a.entryDate),
                    a.mandiWeight ? `${a.mandiWeight} kg` : '—',
                    `${a.entryWeight} kg`,
                    shrinkStr,
                    `${a.currentWeight} kg`,
                    a.mandiPrice ? a.mandiPrice.toLocaleString() : '—',
                    exp > 0 ? exp.toLocaleString() : (a.mandiPrice ? '0' : '—'),
                    a.purchasePrice.toLocaleString(),
                    a.entryWeight ? `${Math.round(a.purchasePrice / a.entryWeight).toLocaleString()} /kg` : '—',
                    a.pen || '—',
                    a.status
                ];
            }),
            foot: [[
                '', '', '', '',
                totalMandiWeight > 0 ? `${totalMandiWeight.toFixed(1)} kg` : '',
                `${totalWeight.toFixed(1)} kg`,
                shrinkSummaryStr,
                `${totalCurrentWeight.toFixed(1)} kg`,
                totalMandiPrice > 0 ? totalMandiPrice.toLocaleString() : '',
                totalExpenses > 0 ? totalExpenses.toLocaleString() : '',
                totalCost.toLocaleString(),
                `${Math.round(avgPerKg).toLocaleString()} /kg`,
                '',
                'TOTAL / AVG'
            ]],
            styles: { fontSize: 7.2, cellPadding: 2 },
            headStyles: { fillColor: [25, 90, 60], fontStyle: 'bold' },
            footStyles: { fillColor: [230, 230, 230], textColor: 20, fontStyle: 'bold' }
        });

        doc.save(`BA_Farms_Herd_${todayPKT()}.pdf`);
    };

    const openRegisterModal = () => {
        setEditingAnimal(null);
        setRfid('');
        setBreed(breedsConfig[0]?.name || 'Sahiwal');
        setCustomBreedMode(false);
        setEntryWeight('');
        setPurchasePrice('');
        setMandiPrice('');
        setMandiWeight('');
        setMandiTax('');
        setCarriage('');
        setMiscExpense('');
        setSource('');
        setStatus('Quarantined');
        setTargetWeight('');
        setEntryDate(todayPKT());
        setPen('');
        setIsModalOpen(true);
    };

    const openEditModal = (animal) => {
        setEditingAnimal(animal);
        setRfid(animal.rfid);
        setBreed(animal.breed);
        // If this animal's breed isn't in the configured list (e.g. it was entered as a
        // custom breed, or the config was later trimmed), keep the field editable as
        // free text instead of silently swapping it for the first preset breed.
        setCustomBreedMode(!breedsConfig.some(b => b.name === animal.breed));
        setEntryWeight(animal.entryWeight);
        setPurchasePrice(animal.purchasePrice);
        setMandiPrice(animal.mandiPrice ? String(animal.mandiPrice) : '');
        setMandiWeight(animal.mandiWeight ? String(animal.mandiWeight) : '');
        setMandiTax(animal.mandiTax ? String(animal.mandiTax) : '');
        setCarriage(animal.carriage ? String(animal.carriage) : '');
        setMiscExpense(animal.miscExpense ? String(animal.miscExpense) : '');
        setSource(animal.source);
        setStatus(animal.status);
        setTargetWeight(animal.targetWeight || '');
        setEntryDate(animal.entryDate);
        setPen(animal.pen || '');
        setIsModalOpen(true);
    };

    const openDeathModal = (animal) => {
        setDeathAnimal(animal);
        setDeathDate(todayPKT());
        setDeathCause('Disease');
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!entryWeight || !purchasePrice) return;

        const cleanRfid = (rfid || '').trim();
        if (!cleanRfid) {
            setNotice({ type: 'error', text: 'RFID / Ear Tag number is required.' });
            return;
        }

        // Duplicate Tag Validation: prevent adding or editing if another active animal shares this RFID
        const duplicateAnimal = animals.find(a => 
            (!editingAnimal || a.id !== editingAnimal.id) &&
            a.status !== 'Deceased' &&
            String(a.rfid || '').trim().toLowerCase() === cleanRfid.toLowerCase()
        );
        if (duplicateAnimal) {
            alert(`Duplicate Tag Conflict!\n\nRFID / Tag "${cleanRfid}" is already assigned to Animal #${duplicateAnimal.id} in Pen ${duplicateAnimal.pen || 'Unassigned'} (${duplicateAnimal.breed}).\n\nDuplicate tags are not permitted. Please choose a unique Tag ID.`);
            return;
        }

        const selectedBreedName = (breed || '').trim() || (breedsConfig[0]?.name || 'Sahiwal');
        const matchedBreed = breedsConfig.find(b => b.name.toLowerCase() === selectedBreedName.toLowerCase());
        const defaultTarget = matchedBreed ? matchedBreed.defaultTargetWeight : (parseFloat(targetWeight) || 360);

        // A newly typed custom breed isn't in the registry yet — add it now so it's
        // available in future dropdowns and shows up alongside the presets in Settings.
        if (customBreedMode && !matchedBreed) {
            updateBreedsConfig([...breedsConfig, { name: selectedBreedName, defaultTargetWeight: defaultTarget }]);
        }

        const payload = {
            rfid,
            breed: selectedBreedName,
            entryWeight: parseFloat(entryWeight),
            purchasePrice: parseFloat(purchasePrice),
            source,
            status,
            targetWeight: parseFloat(targetWeight) || defaultTarget,
            entryDate,
            pen: pen || null,
            mandiPrice: mandiPrice ? parseFloat(mandiPrice) : null,
            mandiWeight: mandiWeight ? parseFloat(mandiWeight) : null,
            mandiTax: mandiTax ? parseFloat(mandiTax) : null,
            carriage: carriage ? parseFloat(carriage) : null,
            miscExpense: miscExpense ? parseFloat(miscExpense) : null
        };

        if (editingAnimal) {
            const result = await updateAnimal({
                id: editingAnimal.id,
                currentWeight: editingAnimal.currentWeight, // preserve current weight
                ...payload
            });
            if (result?.success === false) {
                setNotice({ type: 'error', text: result.error || 'Update could not be saved.' });
                return;
            }
            if (result?.pending) {
                setNotice({ type: 'pending', text: `Entry Weight / Purchase Price change for ${payload.rfid} needs Super Admin approval. Every other field was saved.` });
            }
        } else {
            addAnimal(payload);
        }

        // Reset form & close
        setRfid('');
        setBreed(breedsConfig[0]?.name || 'Sahiwal');
        setCustomBreedMode(false);
        setEntryWeight('');
        setPurchasePrice('');
        setMandiPrice('');
        setMandiWeight('');
        setSource('');
        setStatus('Quarantined');
        setTargetWeight('');
        setEntryDate('');
        setPen('');
        setEditingAnimal(null);
        setIsModalOpen(false);
    };

    const handleDeathSubmit = async (e) => {
        e.preventDefault();
        if (!deathDate || !deathCause) return;
        await recordDeath(deathAnimal.id, deathDate, deathCause);
        setDeathAnimal(null);
    };

    // This staff member's own open (pending) requests, keyed by animal — drives the
    // per-row "Pending Approval" chip so a non-admin can see at a glance which of
    // their edits/deletes are still awaiting a super admin's sign-off.
    const myPendingByAnimal = React.useMemo(() => {
        const map = {};
        myRequests.filter(r => r.status === 'pending').forEach(r => { map[r.animalId] = r; });
        return map;
    }, [myRequests]);

    // Comprehensive Filter Pipeline
    const filteredAnimals = React.useMemo(() => {
        return animals.filter(animal => {
            // Text Search
            if (search.trim()) {
                const s = search.toLowerCase().trim();
                const matches = (
                    (animal.rfid || '').toLowerCase().includes(s) ||
                    (animal.previousTags || []).some(t => String(t).toLowerCase().includes(s)) ||
                    (animal.breed || '').toLowerCase().includes(s) ||
                    (animal.source || '').toLowerCase().includes(s) ||
                    (animal.pen || '').toLowerCase().includes(s)
                );
                if (!matches) return false;
            }

            // Status Tab Filter
            if (filterStatus !== 'All' && animal.status !== filterStatus) {
                return false;
            }

            // Entry Date From (On or After)
            if (entryDateFrom) {
                if (!animal.entryDate || animal.entryDate < entryDateFrom) return false;
            }

            // Entry Date To (On or Before)
            if (entryDateTo) {
                if (!animal.entryDate || animal.entryDate > entryDateTo) return false;
            }

            // Pen / Lot Filter
            if (selectedPen !== 'All') {
                if (selectedPen === '__unassigned__') {
                    if (animal.pen) return false;
                } else if (animal.pen !== selectedPen) {
                    return false;
                }
            }

            // Breed Filter
            if (selectedBreed !== 'All' && animal.breed !== selectedBreed) {
                return false;
            }

            // Mandi / Source Filter
            if (selectedMandi !== 'All') {
                if (selectedMandi === '__unassigned__') {
                    if (animal.source) return false;
                } else if (animal.source !== selectedMandi) {
                    return false;
                }
            }

            // Weight Range (Current Weight or Entry Weight)
            const wtVal = weightType === 'entryWeight' ? animal.entryWeight : animal.currentWeight;
            if (minWeight !== '' && !isNaN(parseFloat(minWeight))) {
                if (wtVal == null || wtVal < parseFloat(minWeight)) return false;
            }
            if (maxWeight !== '' && !isNaN(parseFloat(maxWeight))) {
                if (wtVal == null || wtVal > parseFloat(maxWeight)) return false;
            }

            // Gain Filter
            const gain = animal.currentWeight - animal.entryWeight;
            if (gainFilter === 'positive' && gain <= 0) return false;
            if (gainFilter === 'stagnantOrLoss' && gain > 0) return false;
            if (gainFilter === 'highGain' && gain < 20) return false;

            // Market Readiness Filter
            const target = animal.targetWeight || 360;
            if (marketReadyFilter === 'ready' && animal.currentWeight < target) return false;
            if (marketReadyFilter === 'inProgress' && animal.currentWeight >= target) return false;

            // Duplicate Tag Filter
            if (duplicateFilter) {
                const tag = (animal.rfid || '').trim().toLowerCase();
                if (!tag || (duplicateRfidsMap[tag] || 0) <= 1) return false;
            }

            return true;
        });
    }, [animals, search, filterStatus, entryDateFrom, entryDateTo, selectedPen, selectedBreed, selectedMandi, minWeight, maxWeight, weightType, gainFilter, marketReadyFilter, duplicateFilter, duplicateRfidsMap]);

    // Overall purchase average = total purchase cost / total gross (entry) weight, across the current view
    const totalPurchaseCost = filteredAnimals.reduce((sum, a) => sum + (a.purchasePrice || 0), 0);
    const totalMandiBase = filteredAnimals.reduce((sum, a) => sum + (a.mandiPrice || 0), 0);
    const totalMandiTax = filteredAnimals.reduce((sum, a) => sum + (a.mandiTax || 0), 0);
    const totalCarriage = filteredAnimals.reduce((sum, a) => sum + (a.carriage || 0), 0);
    const totalMiscExpense = filteredAnimals.reduce((sum, a) => sum + (a.miscExpense || 0), 0);
    const totalAcquisitionExp = totalMandiTax + totalCarriage + totalMiscExpense;
    const totalGrossWeight = filteredAnimals.reduce((sum, a) => sum + (a.entryWeight || 0), 0);
    const avgCostPerKg = totalGrossWeight > 0 ? totalPurchaseCost / totalGrossWeight : 0;

    // Animals flagged as "laggers" (ADG below the herd alert threshold) — same shared
    // definition Dashboard/Weight Tracker/Rotation Planner use, surfaced here as a badge.
    const laggerIds = React.useMemo(() => getLaggerIds(animals, weightLogs, systemParams), [animals, weightLogs, systemParams]);

    // Column sorting — click a header to sort by it, click again to reverse direction
    const handleSort = (key) => {
        setSortConfig(prev => prev.key === key
            ? { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' }
            : { key, direction: 'asc' });
    };

    const sortedAnimals = React.useMemo(() => {
        if (!sortConfig.key) return filteredAnimals;
        const accessor = SORT_ACCESSORS[sortConfig.key];
        const sorted = [...filteredAnimals].sort((a, b) => {
            const valA = accessor(a);
            const valB = accessor(b);
            if (typeof valA === 'string') return valA.localeCompare(valB);
            return valA - valB;
        });
        if (sortConfig.direction === 'desc') sorted.reverse();
        return sorted;
    }, [filteredAnimals, sortConfig]);

    const renderSortIcon = (key) => {
        if (sortConfig.key !== key) {
            return <i className="fa-solid fa-sort" style={{ opacity: 0.25, marginLeft: '0.4rem', fontSize: '0.7rem' }}></i>;
        }
        return sortConfig.direction === 'asc'
            ? <i className="fa-solid fa-sort-up" style={{ marginLeft: '0.4rem', fontSize: '0.7rem', color: 'var(--accent-gold)' }}></i>
            : <i className="fa-solid fa-sort-down" style={{ marginLeft: '0.4rem', fontSize: '0.7rem', color: 'var(--accent-gold)' }}></i>;
    };

    const sortableTh = (label, key) => (
        <th onClick={() => handleSort(key)} style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }} title="Click to sort">
            {label}{renderSortIcon(key)}
        </th>
    );

    return (
        <div className="glass-panel">

            {/* Header with Search, Filter toggle and Registration */}
            <div className="form-header-bar">
                <div className="search-bar-wrap">
                    <i className="fa-solid fa-magnifying-glass"></i>
                    <input
                        type="text"
                        placeholder="Search Tag, Breed, or Mandi..."
                        className="form-control search-control"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />
                </div>

                <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
                    <button
                        className={`btn ${showFilterPanel || activeFilterCount > 0 ? 'btn-primary' : 'btn-secondary'}`}
                        onClick={() => setShowFilterPanel(!showFilterPanel)}
                        title="Toggle Feedlot & Date Filters"
                        style={{ position: 'relative' }}
                    >
                        <i className="fa-solid fa-filter"></i> Filters
                        {activeFilterCount > 0 && (
                            <span style={{
                                marginLeft: '0.4rem',
                                background: 'var(--accent-gold)',
                                color: '#000',
                                fontWeight: 'bold',
                                borderRadius: '50%',
                                padding: '0.1rem 0.45rem',
                                fontSize: '0.7rem'
                            }}>
                                {activeFilterCount}
                            </span>
                        )}
                    </button>

                    {!isSuperAdmin && myRequests.length > 0 && (
                        <button
                            className="btn btn-secondary"
                            style={{ borderColor: 'rgba(255,193,7,0.3)', color: 'hsl(43,90%,53%)' }}
                            onClick={() => setShowMyRequests(true)}
                            title="View the status of your submitted edit/delete requests"
                        >
                            <i className="fa-solid fa-hourglass-half"></i> My Requests ({myRequests.filter(r => r.status === 'pending').length})
                        </button>
                    )}
                    <button className="btn btn-secondary" onClick={exportCSV} title="Export current view to CSV">
                        <i className="fa-solid fa-file-csv"></i> Export CSV
                    </button>
                    <button className="btn btn-secondary" onClick={exportPDF} title="Export current view to PDF">
                        <i className="fa-solid fa-file-pdf"></i> Export PDF
                    </button>
                    <button className="btn btn-primary" onClick={openRegisterModal}>
                        <i className="fa-solid fa-plus"></i> Register New Calf
                    </button>
                </div>
            </div>

            {/* Quick Feedlot Shortcuts */}
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.8rem', alignItems: 'center' }}>
                <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 600 }}>Feedlot Presets:</span>
                <button
                    className={`btn btn-secondary ${gainFilter === 'stagnantOrLoss' ? 'active' : ''}`}
                    style={{
                        fontSize: '0.75rem', padding: '0.2rem 0.6rem', minHeight: '28px',
                        borderColor: gainFilter === 'stagnantOrLoss' ? 'rgba(220,53,69,0.5)' : 'rgba(255,255,255,0.08)',
                        color: gainFilter === 'stagnantOrLoss' ? 'hsl(0, 75%, 65%)' : 'var(--text-muted)',
                        background: gainFilter === 'stagnantOrLoss' ? 'rgba(220,53,69,0.1)' : 'transparent'
                    }}
                    onClick={() => {
                        if (gainFilter === 'stagnantOrLoss') {
                            setGainFilter('All');
                        } else {
                            setGainFilter('stagnantOrLoss');
                            setShowFilterPanel(true);
                        }
                    }}
                >
                    ⚠️ Weight Loss / Stagnant ({stagnantCount})
                </button>
                <button
                    className={`btn btn-secondary ${marketReadyFilter === 'ready' ? 'active' : ''}`}
                    style={{
                        fontSize: '0.75rem', padding: '0.2rem 0.6rem', minHeight: '28px',
                        borderColor: marketReadyFilter === 'ready' ? 'rgba(25,135,84,0.5)' : 'rgba(255,255,255,0.08)',
                        color: marketReadyFilter === 'ready' ? 'var(--primary-green-light)' : 'var(--text-muted)',
                        background: marketReadyFilter === 'ready' ? 'rgba(25,135,84,0.1)' : 'transparent'
                    }}
                    onClick={() => {
                        if (marketReadyFilter === 'ready') {
                            setMarketReadyFilter('All');
                        } else {
                            setMarketReadyFilter('ready');
                            setShowFilterPanel(true);
                        }
                    }}
                >
                    🎯 Market Ready ({marketReadyCount})
                </button>
                <button
                    className={`btn btn-secondary ${entryDateFrom ? 'active' : ''}`}
                    style={{
                        fontSize: '0.75rem', padding: '0.2rem 0.6rem', minHeight: '28px',
                        borderColor: entryDateFrom ? 'rgba(255,193,7,0.5)' : 'rgba(255,255,255,0.08)',
                        color: entryDateFrom ? 'var(--accent-gold)' : 'var(--text-muted)',
                        background: entryDateFrom ? 'rgba(255,193,7,0.1)' : 'transparent'
                    }}
                    onClick={() => {
                        if (entryDateFrom) {
                            applyDatePreset('clear');
                        } else {
                            applyDatePreset('30d');
                            setShowFilterPanel(true);
                        }
                    }}
                >
                    🆕 Recent Arrivals (30d) ({recentArrivalsCount})
                </button>
                {duplicateCount > 0 && (
                    <button
                        className={`btn btn-secondary ${duplicateFilter ? 'active' : ''}`}
                        style={{
                            fontSize: '0.75rem', padding: '0.2rem 0.6rem', minHeight: '28px',
                            borderColor: duplicateFilter ? 'rgba(220,53,69,0.8)' : 'rgba(220,53,69,0.35)',
                            color: 'hsl(0, 85%, 65%)',
                            background: duplicateFilter ? 'rgba(220,53,69,0.22)' : 'rgba(220,53,69,0.08)',
                            fontWeight: 600
                        }}
                        onClick={() => {
                            setDuplicateFilter(!duplicateFilter);
                            if (!duplicateFilter) setShowFilterPanel(true);
                        }}
                        title="Filter table to show only animals with duplicate RFIDs"
                    >
                        <i className="fa-solid fa-triangle-exclamation"></i> Duplicate Tags ({duplicateCount})
                    </button>
                )}
            </div>

            {/* Expandable Advanced Feedlot Filter Panel */}
            {showFilterPanel && (
                <div className="feedlot-filter-panel">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.8rem', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '0.5rem' }}>
                        <h4 style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-pure)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <i className="fa-solid fa-sliders" style={{ color: 'var(--accent-gold)' }}></i> Feedlot Advanced Filters
                        </h4>
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                            <button
                                className="btn btn-secondary"
                                style={{ minHeight: '28px', padding: '0.15rem 0.6rem', fontSize: '0.75rem' }}
                                onClick={handleResetFilters}
                            >
                                <i className="fa-solid fa-rotate-left"></i> Reset All
                            </button>
                            <button
                                className="btn btn-secondary"
                                style={{ minHeight: '28px', padding: '0.15rem 0.6rem', fontSize: '0.75rem' }}
                                onClick={() => setShowFilterPanel(false)}
                            >
                                <i className="fa-solid fa-xmark"></i> Close
                            </button>
                        </div>
                    </div>

                    <div className="filter-grid-4">
                        {/* 1. Entry Date Filters */}
                        <div className="filter-group">
                            <label><i className="fa-solid fa-calendar-days"></i> Entry Date Range</label>
                            <div style={{ display: 'flex', gap: '0.4rem' }}>
                                <input
                                    type="date"
                                    className="form-control"
                                    style={{ fontSize: '0.8rem', padding: '0.35rem 0.5rem' }}
                                    value={entryDateFrom}
                                    onChange={(e) => setEntryDateFrom(e.target.value)}
                                    title="Entry On or After"
                                />
                                <span style={{ alignSelf: 'center', color: 'var(--text-muted)', fontSize: '0.75rem' }}>to</span>
                                <input
                                    type="date"
                                    className="form-control"
                                    style={{ fontSize: '0.8rem', padding: '0.35rem 0.5rem' }}
                                    value={entryDateTo}
                                    onChange={(e) => setEntryDateTo(e.target.value)}
                                    title="Entry On or Before"
                                />
                            </div>
                            <div className="date-preset-group">
                                <button className="date-preset-btn" onClick={() => applyDatePreset('7d')}>7 Days</button>
                                <button className="date-preset-btn" onClick={() => applyDatePreset('30d')}>30 Days</button>
                                <button className="date-preset-btn" onClick={() => applyDatePreset('90d')}>90 Days</button>
                                <button className="date-preset-btn" onClick={() => applyDatePreset('thisYear')}>This Year</button>
                                <button className="date-preset-btn" onClick={() => applyDatePreset('clear')}>Clear</button>
                            </div>
                        </div>

                        {/* 2. Pen, Breed & Mandi Filters */}
                        <div className="filter-group">
                            <label><i className="fa-solid fa-map-pin"></i> Lot, Breed & Source</label>
                            <select
                                className="form-control"
                                style={{ fontSize: '0.8rem', padding: '0.35rem 0.5rem', marginBottom: '0.4rem' }}
                                value={selectedPen}
                                onChange={(e) => setSelectedPen(e.target.value)}
                            >
                                <option value="All">All Pens / Lots</option>
                                {uniquePens.map(p => (
                                    <option key={p} value={p}>Pen {p}</option>
                                ))}
                                <option value="__unassigned__">Unassigned Pen</option>
                            </select>

                            <div style={{ display: 'flex', gap: '0.4rem' }}>
                                <select
                                    className="form-control"
                                    style={{ fontSize: '0.8rem', padding: '0.35rem 0.5rem' }}
                                    value={selectedBreed}
                                    onChange={(e) => setSelectedBreed(e.target.value)}
                                >
                                    <option value="All">All Breeds</option>
                                    {uniqueBreeds.map(b => (
                                        <option key={b} value={b}>{b}</option>
                                    ))}
                                </select>

                                <select
                                    className="form-control"
                                    style={{ fontSize: '0.8rem', padding: '0.35rem 0.5rem' }}
                                    value={selectedMandi}
                                    onChange={(e) => setSelectedMandi(e.target.value)}
                                >
                                    <option value="All">All Mandis / Sources</option>
                                    {uniqueMandis.map(m => (
                                        <option key={m} value={m}>{m}</option>
                                    ))}
                                    <option value="__unassigned__">Unknown Mandi</option>
                                </select>
                            </div>
                        </div>

                        {/* 3. Weight Range Filters */}
                        <div className="filter-group">
                            <label><i className="fa-solid fa-weight-hanging"></i> Weight Range (kg)</label>
                            <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.4rem' }}>
                                <select
                                    className="form-control"
                                    style={{ fontSize: '0.78rem', padding: '0.35rem 0.4rem' }}
                                    value={weightType}
                                    onChange={(e) => setWeightType(e.target.value)}
                                >
                                    <option value="currentWeight">Latest Weight</option>
                                    <option value="entryWeight">Entry Weight</option>
                                </select>
                            </div>
                            <div style={{ display: 'flex', gap: '0.4rem' }}>
                                <input
                                    type="number"
                                    className="form-control"
                                    style={{ fontSize: '0.8rem', padding: '0.35rem 0.5rem' }}
                                    placeholder="Min Weight"
                                    value={minWeight}
                                    onChange={(e) => setMinWeight(e.target.value)}
                                />
                                <input
                                    type="number"
                                    className="form-control"
                                    style={{ fontSize: '0.8rem', padding: '0.35rem 0.5rem' }}
                                    placeholder="Max Weight"
                                    value={maxWeight}
                                    onChange={(e) => setMaxWeight(e.target.value)}
                                />
                            </div>
                        </div>

                        {/* 4. Gain Performance & Target Readiness */}
                        <div className="filter-group">
                            <label><i className="fa-solid fa-chart-line"></i> Gain & Target Status</label>
                            <select
                                className="form-control"
                                style={{ fontSize: '0.8rem', padding: '0.35rem 0.5rem', marginBottom: '0.4rem' }}
                                value={gainFilter}
                                onChange={(e) => setGainFilter(e.target.value)}
                            >
                                <option value="All">All Weight Gains</option>
                                <option value="positive">Gaining Weight (+kg)</option>
                                <option value="stagnantOrLoss">⚠️ Weight Loss / Stagnant (≤ 0kg)</option>
                                <option value="highGain">🚀 High Gain (≥ 20kg)</option>
                            </select>

                            <select
                                className="form-control"
                                style={{ fontSize: '0.8rem', padding: '0.35rem 0.5rem' }}
                                value={marketReadyFilter}
                                onChange={(e) => setMarketReadyFilter(e.target.value)}
                            >
                                <option value="All">All Market Readiness</option>
                                <option value="ready">🎯 Market Ready (≥ Target Wt)</option>
                                <option value="inProgress">⏳ Fattening Phase (&lt; Target Wt)</option>
                            </select>
                        </div>
                    </div>
                </div>
            )}

            {/* Active Filter Chips Bar */}
            {(activeFilterCount > 0 || search) && (
                <div className="active-filter-chips">
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>Active Filters:</span>
                    
                    {search && (
                        <span className="filter-chip">
                            Search: "{search}"
                            <button onClick={() => setSearch('')}>✕</button>
                        </span>
                    )}

                    {entryDateFrom && (
                        <span className="filter-chip">
                            Entry From: {formatDate(entryDateFrom)}
                            <button onClick={() => setEntryDateFrom('')}>✕</button>
                        </span>
                    )}

                    {entryDateTo && (
                        <span className="filter-chip">
                            Entry To: {formatDate(entryDateTo)}
                            <button onClick={() => setEntryDateTo('')}>✕</button>
                        </span>
                    )}

                    {selectedPen !== 'All' && (
                        <span className="filter-chip">
                            Pen: {selectedPen === '__unassigned__' ? 'Unassigned' : selectedPen}
                            <button onClick={() => setSelectedPen('All')}>✕</button>
                        </span>
                    )}

                    {selectedBreed !== 'All' && (
                        <span className="filter-chip">
                            Breed: {selectedBreed}
                            <button onClick={() => setSelectedBreed('All')}>✕</button>
                        </span>
                    )}

                    {selectedMandi !== 'All' && (
                        <span className="filter-chip">
                            Mandi: {selectedMandi === '__unassigned__' ? 'Unknown' : selectedMandi}
                            <button onClick={() => setSelectedMandi('All')}>✕</button>
                        </span>
                    )}

                    {(minWeight || maxWeight) && (
                        <span className="filter-chip">
                            {weightType === 'entryWeight' ? 'Entry Wt' : 'Latest Wt'}: {minWeight || '0'} - {maxWeight || '∞'} kg
                            <button onClick={() => { setMinWeight(''); setMaxWeight(''); }}>✕</button>
                        </span>
                    )}

                    {gainFilter !== 'All' && (
                        <span className="filter-chip">
                            Gain: {gainFilter === 'positive' ? 'Positive (+kg)' : gainFilter === 'stagnantOrLoss' ? '⚠️ Loss/Stagnant (≤0kg)' : '🚀 High Gain (≥20kg)'}
                            <button onClick={() => setGainFilter('All')}>✕</button>
                        </span>
                    )}

                    {marketReadyFilter !== 'All' && (
                        <span className="filter-chip">
                            Target: {marketReadyFilter === 'ready' ? '🎯 Market Ready' : '⏳ In Progress'}
                            <button onClick={() => setMarketReadyFilter('All')}>✕</button>
                        </span>
                    )}

                    <button
                        className="btn btn-secondary"
                        style={{ fontSize: '0.72rem', padding: '0.15rem 0.5rem', minHeight: '24px', marginLeft: 'auto' }}
                        onClick={handleResetFilters}
                    >
                        Clear All
                    </button>
                </div>
            )}

            {notice && (
                <div style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem',
                    padding: '0.6rem 1rem', borderRadius: '8px', marginBottom: '1rem', fontSize: '0.85rem',
                    background: notice.type === 'error' ? 'rgba(220, 53, 69, 0.08)' : 'rgba(255,193,7,0.08)',
                    border: `1px solid ${notice.type === 'error' ? 'rgba(220, 53, 69, 0.3)' : 'rgba(255,193,7,0.3)'}`,
                    color: notice.type === 'error' ? 'hsl(0, 75%, 70%)' : 'hsl(43,90%,53%)'
                }}>
                    <span><i className={`fa-solid ${notice.type === 'error' ? 'fa-triangle-exclamation' : 'fa-hourglass-half'}`}></i> {notice.text}</span>
                    <button className="modal-close-btn" style={{ position: 'static' }} onClick={() => setNotice(null)}>
                        <i className="fa-solid fa-xmark"></i>
                    </button>
                </div>
            )}

            {/* Filtering toggles */}
            <div className="table-filters">
                <button className={`filter-btn ${filterStatus === 'All' ? 'active' : ''}`} onClick={() => setFilterStatus('All')}>All ({animals.length})</button>
                <button className={`filter-btn ${filterStatus === 'Fattening' ? 'active' : ''}`} onClick={() => setFilterStatus('Fattening')}>Fattening ({animals.filter(a => a.status === 'Fattening').length})</button>
                <button className={`filter-btn ${filterStatus === 'Quarantined' ? 'active' : ''}`} onClick={() => setFilterStatus('Quarantined')}>Quarantined ({animals.filter(a => a.status === 'Quarantined').length})</button>
                <button className={`filter-btn ${filterStatus === 'Sick' ? 'active' : ''}`} onClick={() => setFilterStatus('Sick')}>Sick ({animals.filter(a => a.status === 'Sick').length})</button>
                <button className={`filter-btn ${filterStatus === 'Deceased' ? 'active' : ''}`} onClick={() => setFilterStatus('Deceased')}>Deceased ({animals.filter(a => a.status === 'Deceased').length})</button>
                <button className={`filter-btn ${filterStatus === 'Sold' ? 'active' : ''}`} onClick={() => setFilterStatus('Sold')}>Sold ({animals.filter(a => a.status === 'Sold').length})</button>
            </div>

            {/* Average purchase price and acquisition expenses overview */}
            <div className="dashboard-grid" style={{ marginBottom: '1rem', gridTemplateColumns: totalAcquisitionExp > 0 ? 'repeat(auto-fit, minmax(280px, 1fr))' : '1fr' }}>
                <div className="glass-panel stat-box">
                    <div className="stat-header">
                        <h3>Avg Purchase Price / Gross Weight</h3>
                        <div className="stat-icon"><i className="fa-solid fa-scale-balanced"></i></div>
                    </div>
                    <div className="stat-val">{Math.round(avgCostPerKg).toLocaleString()} <small style={{ fontSize: '1rem', color: 'var(--text-muted)' }}>PKR/kg</small></div>
                    <span className="stat-lbl">
                        <i className="fa-solid fa-cow"></i> {totalPurchaseCost.toLocaleString()} PKR ÷ {totalGrossWeight.toLocaleString()} kg across {filteredAnimals.length} animal{filteredAnimals.length === 1 ? '' : 's'}
                    </span>
                </div>

                {totalAcquisitionExp > 0 && (
                    <div className="glass-panel stat-box">
                        <div className="stat-header">
                            <h3>Acquisition Expense Breakdown</h3>
                            <div className="stat-icon"><i className="fa-solid fa-receipt"></i></div>
                        </div>
                        <div className="stat-val" style={{ fontSize: '1.4rem', color: 'hsl(43,90%,53%)' }}>
                            {totalAcquisitionExp.toLocaleString()} <small style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>PKR total expenses</small>
                        </div>
                        <span className="stat-lbl" style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', fontSize: '0.72rem' }}>
                            <span>Tax: <strong>{totalMandiTax.toLocaleString()}</strong> PKR</span>
                            <span>·</span>
                            <span>Freight: <strong>{totalCarriage.toLocaleString()}</strong> PKR</span>
                            <span>·</span>
                            <span>Misc: <strong>{totalMiscExpense.toLocaleString()}</strong> PKR</span>
                        </span>
                    </div>
                )}
            </div>

            {/* Main Ledger Table */}
            <div className="table-wrapper">
                <table className="data-table">
                    <thead>
                        <tr>
                            <th style={{ width: '40px', color: 'var(--text-muted)', textAlign: 'center' }}>#</th>
                            {sortableTh('TAG', 'tag')}
                            {sortableTh('BREED', 'breed')}
                            {sortableTh('ENTRY DATE', 'entryDate')}
                            {sortableTh('MANDI WT', 'mandiWeight')}
                            {sortableTh('ENTRY WT', 'entryWeight')}
                            {sortableTh('LATEST WT', 'weight')}
                            {sortableTh('GAIN', 'gain')}
                            {sortableTh('MANDI BASE', 'mandiPrice')}
                            {sortableTh('TAX', 'mandiTax')}
                            {sortableTh('CARRIAGE', 'carriage')}
                            {sortableTh('MISC', 'miscExpense')}
                            {sortableTh('LANDED COST', 'cost')}
                            {sortableTh('LANDED /KG', 'costPerKg')}
                            {sortableTh('PEN', 'pen')}
                            {sortableTh('STATUS', 'status')}
                            <th style={{ textAlign: 'center' }}>ACTIONS</th>
                        </tr>
                    </thead>
                    <tbody>
                        {sortedAnimals.map((animal, idx) => (
                            <tr key={animal.id}>
                                <td style={{ color: 'var(--text-muted)', fontSize: '0.78rem', textAlign: 'center' }}>{idx + 1}</td>
                                <td style={{ fontFamily: 'var(--font-heading)', fontWeight: '700', color: 'var(--text-pure)' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                                        <span>{animal.rfid}</span>
                                        {duplicateRfidsMap[(animal.rfid || '').trim().toLowerCase()] > 1 && animal.status !== 'Deceased' && (
                                            <span
                                                style={{
                                                    fontSize: '0.65rem',
                                                    padding: '1px 5px',
                                                    borderRadius: '4px',
                                                    background: 'rgba(220,53,69,0.2)',
                                                    color: 'hsl(0,85%,65%)',
                                                    border: '1px solid rgba(220,53,69,0.4)',
                                                    fontWeight: 700
                                                }}
                                                title="Multiple active animals share this exact Tag ID!"
                                            >
                                                <i className="fa-solid fa-triangle-exclamation"></i> DUP
                                            </span>
                                        )}
                                        {animal.previousTags && animal.previousTags.length > 0 && (
                                            <span
                                                style={{
                                                    fontSize: '0.68rem',
                                                    padding: '1px 5px',
                                                    borderRadius: '4px',
                                                    background: 'rgba(255, 255, 255, 0.08)',
                                                    color: 'var(--text-muted)',
                                                    fontWeight: '500',
                                                    border: '1px solid rgba(255, 255, 255, 0.12)'
                                                }}
                                                title={`Previous Tag(s): ${animal.previousTags.join(', ')}`}
                                            >
                                                Prev: {animal.previousTags.join(', ')}
                                            </span>
                                        )}
                                        {laggerIds.has(animal.id) && (
                                            <span
                                                style={{
                                                    fontSize: '0.68rem',
                                                    padding: '1px 5px',
                                                    borderRadius: '4px',
                                                    background: 'rgba(255,193,7,0.12)',
                                                    color: 'hsl(45,90%,55%)',
                                                    fontWeight: '600',
                                                    border: '1px solid rgba(255,193,7,0.3)'
                                                }}
                                                title="Special Attention: ADG below herd alert threshold"
                                            >
                                                <i class="fa-solid fa-triangle-exclamation"></i> Lagger
                                            </span>
                                        )}
                                    </div>
                                </td>
                                <td>{animal.breed}</td>
                                <td style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{animal.entryDate ? formatDate(animal.entryDate) : '—'}</td>
                                <td>
                                    {animal.mandiWeight ? (
                                        <div>
                                            <span>{animal.mandiWeight} kg</span>
                                            <div style={{ fontSize: '0.68rem', color: 'hsl(43,90%,53%)' }} title={`Loss: -${(animal.mandiWeight - animal.entryWeight).toFixed(1)} kg`}>
                                                -{(((animal.mandiWeight - animal.entryWeight) / animal.mandiWeight) * 100).toFixed(1)}%
                                            </div>
                                        </div>
                                    ) : <span style={{ opacity: 0.35 }}>—</span>}
                                </td>
                                <td><strong>{animal.entryWeight} kg</strong></td>
                                <td><strong>{animal.currentWeight} kg</strong></td>
                                {(() => {
                                    const gain = parseFloat((animal.currentWeight - animal.entryWeight).toFixed(1));
                                    return (
                                        <td style={{ color: gain >= 0 ? 'var(--primary-green-light)' : 'hsl(0,75%,60%)', fontWeight: '600' }}>
                                            {gain > 0 ? '+' : ''}{gain} kg
                                        </td>
                                    );
                                })()}
                                <td>
                                    {animal.mandiPrice ? (
                                        <div>
                                            <div style={{ fontWeight: '600' }}>{animal.mandiPrice.toLocaleString()}</div>
                                            {animal.mandiWeight && (
                                                <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                                                    {Math.round(animal.mandiPrice / animal.mandiWeight)}/kg
                                                </div>
                                            )}
                                        </div>
                                    ) : <span style={{ opacity: 0.35 }}>—</span>}
                                </td>
                                <td>
                                    {animal.mandiTax ? (
                                        <span style={{ color: 'var(--text-muted)' }}>{Math.round(animal.mandiTax).toLocaleString()}</span>
                                    ) : <span style={{ opacity: 0.35 }}>—</span>}
                                </td>
                                <td>
                                    {animal.carriage ? (
                                        <span style={{ color: 'var(--text-muted)' }}>{Math.round(animal.carriage).toLocaleString()}</span>
                                    ) : <span style={{ opacity: 0.35 }}>—</span>}
                                </td>
                                <td>
                                    {animal.miscExpense ? (
                                        <span style={{ color: 'var(--text-muted)' }}>{Math.round(animal.miscExpense).toLocaleString()}</span>
                                    ) : <span style={{ opacity: 0.35 }}>—</span>}
                                </td>
                                <td>
                                    <div style={{ fontWeight: '700', color: 'var(--text-pure)' }}>
                                        {animal.purchasePrice ? animal.purchasePrice.toLocaleString() : '—'}
                                    </div>
                                </td>
                                <td>
                                    <strong style={{ color: 'var(--primary-green-light)' }}>
                                        {animal.entryWeight && animal.purchasePrice ? `${Math.round(animal.purchasePrice / animal.entryWeight).toLocaleString()}` : '—'}
                                    </strong>
                                    <small style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}> /kg</small>
                                </td>
                                <td style={{ fontFamily: 'var(--font-heading)', fontWeight: '600' }}>
                                    {animal.pen ? <span style={{ color: 'var(--accent-gold)' }}>{animal.pen}</span> : <span style={{ opacity: 0.4 }}>—</span>}
                                </td>
                                <td>
                                    <span className={`badge-status ${animal.status.toLowerCase()}`}>
                                        {animal.status}
                                    </span>
                                    {myPendingByAnimal[animal.id] && (
                                        <span
                                            title={`${myPendingByAnimal[animal.id].action === 'DELETE_ANIMAL' ? 'Deletion' : 'Edit'} request awaiting Super Admin approval`}
                                            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.65rem', padding: '0.1rem 0.4rem', borderRadius: '4px', background: 'rgba(255,193,7,0.12)', color: 'hsl(43,90%,53%)', marginLeft: '0.4rem' }}
                                        >
                                            <i className="fa-solid fa-hourglass-half"></i> Pending
                                        </span>
                                    )}
                                </td>
                                <td>
                                    <div className="herd-actions-group" style={{ display: 'flex', gap: '0.3rem', justifyContent: 'center', flexWrap: 'wrap' }}>
                                        <button className="btn btn-secondary" style={{ minHeight: '30px', padding: '0.15rem 0.5rem', fontSize: '0.75rem' }} onClick={() => openEditModal(animal)}>
                                            <i className="fa-solid fa-pen-to-square"></i>
                                        </button>
                                        {animal.status !== 'Sick' && animal.status !== 'Sold' && animal.status !== 'Deceased' && (
                                            <button className="btn btn-secondary" style={{ minHeight: '30px', padding: '0.15rem 0.5rem', fontSize: '0.75rem', borderColor: 'rgba(255,193,7,0.3)', color: 'hsl(43,90%,53%)', background: 'rgba(255,193,7,0.04)' }} onClick={() => transitionAnimalStatus(animal.id, 'Sick')} title="Mark Sick">
                                                <i className="fa-solid fa-heart-pulse"></i> Sick
                                            </button>
                                        )}
                                        {animal.status === 'Sick' && (
                                            <button className="btn btn-secondary" style={{ minHeight: '30px', padding: '0.15rem 0.5rem', fontSize: '0.75rem', borderColor: 'rgba(25,135,84,0.3)', color: 'var(--primary-green-light)', background: 'rgba(25,135,84,0.04)' }} onClick={() => transitionAnimalStatus(animal.id, 'Fattening')} title="Mark Recovered">
                                                <i className="fa-solid fa-circle-check"></i> OK
                                            </button>
                                        )}
                                        {animal.status !== 'Sold' && animal.status !== 'Deceased' && (
                                            <button className="btn btn-secondary" style={{ minHeight: '30px', padding: '0.15rem 0.5rem', fontSize: '0.75rem', borderColor: 'rgba(100, 50, 50, 0.3)', color: 'hsl(0, 60%, 55%)', background: 'rgba(80, 20, 20, 0.05)' }} onClick={() => openDeathModal(animal)} title="Record Death">
                                                ☠
                                            </button>
                                        )}
                                        <button className="btn btn-secondary" style={{ minHeight: '30px', padding: '0.15rem 0.5rem', fontSize: '0.75rem', borderColor: 'rgba(220, 53, 69, 0.2)', color: 'hsl(0, 75%, 65%)', background: 'rgba(220, 53, 69, 0.02)' }} onClick={async () => {
                                            const confirmMsg = isSuperAdmin ? `Delete ${animal.rfid}?` : `Request deletion of ${animal.rfid}? A Super Admin will need to approve it.`;
                                            if (!window.confirm(confirmMsg)) return;
                                            const result = await deleteAnimal(animal.id);
                                            if (result?.success === false) {
                                                setNotice({ type: 'error', text: result.error || 'Delete could not be submitted.' });
                                            } else if (result?.pending) {
                                                setNotice({ type: 'pending', text: `Deletion of ${animal.rfid} needs Super Admin approval.` });
                                            }
                                        }} title={isSuperAdmin ? 'Delete' : 'Request Deletion'}>
                                            <i className="fa-solid fa-trash-can"></i>
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        ))}
                        {sortedAnimals.length === 0 && (
                            <tr>
                                <td colSpan="17" style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
                                    <i className="fa-solid fa-cow" style={{ fontSize: '2rem', marginBottom: '0.5rem', display: 'block' }}></i>
                                    No animal records matching your filters were found in the database.
                                    <div style={{ marginTop: '0.8rem' }}>
                                        <button className="btn btn-secondary" onClick={handleResetFilters}>
                                            <i className="fa-solid fa-rotate-left"></i> Reset All Filters
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>



            {/* 4. MODAL POPUP ADD/EDIT CALF REGISTER FORM */}
            {isModalOpen && createPortal(
                <div class="modal-overlay">
                    <div class="glass-panel modal-container" style={{ maxWidth: '580px' }}>
                        <button class="modal-close-btn" onClick={() => setIsModalOpen(false)}>
                            <i class="fa-solid fa-xmark"></i>
                        </button>

                        <h2 class="panel-title" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '0.6rem', marginBottom: '1rem' }}>
                            <i class="fa-solid fa-plus-circle"></i> {editingAnimal ? 'Edit Animal' : 'Register Animal'}
                        </h2>

                        <form onSubmit={handleSubmit}>
                            <div class="modal-body-scroll">
                                {/* Row 1: RFID, Source, Breed */}
                                <div class="form-grid-3">
                                    <div class="form-group" style={{ marginBottom: 0 }}>
                                        <label>Tag ID *</label>
                                        <input type="text" class="form-control" placeholder="e.g. 001, 012" value={rfid} onChange={(e) => setRfid(e.target.value)} required />
                                        {(() => {
                                            const clean = (rfid || '').trim().toLowerCase();
                                            if (!clean) return null;
                                            const dup = animals.find(a => (!editingAnimal || a.id !== editingAnimal.id) && a.status !== 'Deceased' && (a.rfid || '').trim().toLowerCase() === clean);
                                            if (dup) {
                                                return (
                                                    <div style={{ color: 'hsl(0,85%,65%)', fontSize: '0.72rem', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '4px', fontWeight: 600 }}>
                                                        <i className="fa-solid fa-circle-exclamation"></i>
                                                        <span>Tag "{rfid.trim()}" is already used by Animal #{dup.id} (Pen {dup.pen || 'Unassigned'}, {dup.breed})</span>
                                                    </div>
                                                );
                                            }
                                            return null;
                                        })()}
                                        {editingAnimal?.previousTags && editingAnimal.previousTags.length > 0 && (
                                            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                                                <i className="fa-solid fa-clock-rotate-left" style={{ marginRight: '3px' }}></i>
                                                Prev: <strong>{editingAnimal.previousTags.join(', ')}</strong>
                                            </div>
                                        )}
                                    </div>
                                    <div class="form-group" style={{ marginBottom: 0 }}>
                                        <label>Source Mandi</label>
                                        <input type="text" class="form-control" placeholder="e.g. Jhang Mandi" value={source} onChange={(e) => setSource(e.target.value)} />
                                    </div>
                                    <div class="form-group" style={{ marginBottom: 0 }}>
                                        <label>Breed</label>
                                        {customBreedMode ? (
                                            <div style={{ display: 'flex', gap: '0.4rem' }}>
                                                <input
                                                    type="text"
                                                    class="form-control"
                                                    placeholder="Enter breed name"
                                                    value={breed}
                                                    onChange={(e) => setBreed(e.target.value)}
                                                    required
                                                    autoFocus
                                                />
                                                <button
                                                    type="button"
                                                    class="btn btn-secondary"
                                                    style={{ minHeight: '38px', padding: '0 0.7rem', flexShrink: 0 }}
                                                    title="Back to preset breed list"
                                                    onClick={() => { setCustomBreedMode(false); setBreed(breedsConfig[0]?.name || 'Sahiwal'); }}
                                                >
                                                    <i class="fa-solid fa-xmark"></i>
                                                </button>
                                            </div>
                                        ) : (
                                            <select
                                                class="form-control"
                                                value={breed || (breedsConfig[0]?.name || 'Sahiwal')}
                                                onChange={(e) => {
                                                    if (e.target.value === CUSTOM_BREED_OPTION) {
                                                        setCustomBreedMode(true);
                                                        setBreed('');
                                                    } else {
                                                        setBreed(e.target.value);
                                                    }
                                                }}
                                            >
                                                {breedsConfig.map(b => (
                                                    <option key={b.name} value={b.name}>{b.name}</option>
                                                ))}
                                                <option value={CUSTOM_BREED_OPTION}>+ Add Custom Breed…</option>
                                            </select>
                                        )}
                                    </div>
                                </div>

                                {/* Row 2: Entry Weight, Purchase Cost, Target Weight */}
                                <div class="form-grid-3">
                                    <div class="form-group" style={{ marginBottom: 0 }}>
                                        <label>Entry Weight (kg) *</label>
                                        <input type="number" class="form-control" placeholder="e.g. 120" value={entryWeight} onChange={(e) => setEntryWeight(e.target.value)} required />
                                        {editingAnimal && !isSuperAdmin && (
                                            <small style={{ color: 'hsl(43,90%,53%)', fontSize: '0.7rem' }}>Changes need Super Admin approval</small>
                                        )}
                                    </div>
                                    <div class="form-group" style={{ marginBottom: 0 }}>
                                        <label>Total Landed Cost (PKR) *</label>
                                        <input type="number" class="form-control" placeholder="e.g. 150000" value={purchasePrice} onChange={(e) => setPurchasePrice(e.target.value)} required />
                                        {editingAnimal && !isSuperAdmin && (
                                            <small style={{ color: 'hsl(43,90%,53%)', fontSize: '0.7rem' }}>Changes need Super Admin approval</small>
                                        )}
                                    </div>
                                    <div class="form-group" style={{ marginBottom: 0 }}>
                                        <label>Target Weight (kg)</label>
                                        <input type="number" class="form-control" placeholder="e.g. 360" value={targetWeight} onChange={(e) => setTargetWeight(e.target.value)} />
                                    </div>
                                </div>

                                {/* Row 3: Status, Entry Date, Pen */}
                                <div class="form-grid-3" style={{ marginBottom: '0.8rem' }}>
                                    <div class="form-group" style={{ marginBottom: 0 }}>
                                        <label>Status</label>
                                        <select class="form-control" value={status} onChange={(e) => setStatus(e.target.value)}>
                                            <option value="Quarantined">Quarantined</option>
                                            <option value="Fattening">Fattening</option>
                                            <option value="Sick">Sick</option>
                                            <option value="Deceased">Deceased</option>
                                            <option value="Sold">Sold</option>
                                        </select>
                                    </div>
                                    <div class="form-group" style={{ marginBottom: 0 }}>
                                        <label>Entry Date</label>
                                        <input type="date" class="form-control" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} required />
                                    </div>
                                    <div class="form-group" style={{ marginBottom: 0 }}>
                                        <label>Pen / Lot</label>
                                        <input type="text" class="form-control" placeholder="e.g. A, B, 1" value={pen} onChange={(e) => setPen(e.target.value)} />
                                    </div>
                                </div>

                                {/* Row 4: Mandi Purchase & Expense Breakdown */}
                                <div style={{ background: 'rgba(255, 255, 255, 0.02)', border: '1px solid rgba(255, 255, 255, 0.07)', borderRadius: '8px', padding: '0.75rem 0.9rem', marginBottom: '0.5rem' }}>
                                    <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <span><i class="fa-solid fa-receipt" style={{ marginRight: '0.35rem', color: 'var(--primary-green-light)' }}></i> Mandi Purchase & Acquisition Expenses (Optional)</span>
                                        {mandiWeight && entryWeight && parseFloat(mandiWeight) > 0 && (
                                            <span style={{ color: (parseFloat(mandiWeight) - parseFloat(entryWeight)) >= 0 ? 'var(--accent-gold)' : 'hsl(0,75%,60%)', fontSize: '0.75rem' }}>
                                                Shrink: -{(parseFloat(mandiWeight) - parseFloat(entryWeight)).toFixed(1)} kg ({(((parseFloat(mandiWeight) - parseFloat(entryWeight)) / parseFloat(mandiWeight)) * 100).toFixed(1)}%)
                                            </span>
                                        )}
                                    </div>
                                    <div class="form-grid-row" style={{ marginBottom: '0.5rem' }}>
                                        <div class="form-group" style={{ marginBottom: 0 }}>
                                            <label style={{ fontSize: '0.75rem' }}>Mandi Weight (kg)</label>
                                            <input type="number" step="0.1" class="form-control" placeholder="Mandi scale wt" value={mandiWeight} onChange={(e) => setMandiWeight(e.target.value)} />
                                        </div>
                                        <div class="form-group" style={{ marginBottom: 0 }}>
                                            <label style={{ fontSize: '0.75rem' }}>Mandi Base Price (PKR)</label>
                                            <input 
                                                type="number" 
                                                class="form-control" 
                                                placeholder="Base price to seller" 
                                                value={mandiPrice} 
                                                onChange={(e) => {
                                                    const val = e.target.value;
                                                    setMandiPrice(val);
                                                    const base = parseFloat(val) || 0;
                                                    const tax = parseFloat(mandiTax) || 0;
                                                    const carr = parseFloat(carriage) || 0;
                                                    const misc = parseFloat(miscExpense) || 0;
                                                    if (base > 0 || tax > 0 || carr > 0 || misc > 0) setPurchasePrice(String(base + tax + carr + misc));
                                                }} 
                                            />
                                        </div>
                                    </div>

                                    <div class="form-grid-3">
                                        <div class="form-group" style={{ marginBottom: 0 }}>
                                            <label style={{ fontSize: '0.75rem' }}>Mandi Tax / Parchi (PKR)</label>
                                            <input 
                                                type="number" 
                                                class="form-control" 
                                                placeholder="e.g. 1000" 
                                                value={mandiTax} 
                                                onChange={(e) => {
                                                    const val = e.target.value;
                                                    setMandiTax(val);
                                                    const base = parseFloat(mandiPrice) || 0;
                                                    const tax = parseFloat(val) || 0;
                                                    const carr = parseFloat(carriage) || 0;
                                                    const misc = parseFloat(miscExpense) || 0;
                                                    if (base > 0) setPurchasePrice(String(base + tax + carr + misc));
                                                }} 
                                            />
                                        </div>
                                        <div class="form-group" style={{ marginBottom: 0 }}>
                                            <label style={{ fontSize: '0.75rem' }}>Carriage / Freight (PKR)</label>
                                            <input 
                                                type="number" 
                                                class="form-control" 
                                                placeholder="e.g. 2500" 
                                                value={carriage} 
                                                onChange={(e) => {
                                                    const val = e.target.value;
                                                    setCarriage(val);
                                                    const base = parseFloat(mandiPrice) || 0;
                                                    const tax = parseFloat(mandiTax) || 0;
                                                    const carr = parseFloat(val) || 0;
                                                    const misc = parseFloat(miscExpense) || 0;
                                                    if (base > 0) setPurchasePrice(String(base + tax + carr + misc));
                                                }} 
                                            />
                                        </div>
                                        <div class="form-group" style={{ marginBottom: 0 }}>
                                            <label style={{ fontSize: '0.75rem' }}>Misc Expense (PKR)</label>
                                            <input 
                                                type="number" 
                                                class="form-control" 
                                                placeholder="e.g. 1000" 
                                                value={miscExpense} 
                                                onChange={(e) => {
                                                    const val = e.target.value;
                                                    setMiscExpense(val);
                                                    const base = parseFloat(mandiPrice) || 0;
                                                    const tax = parseFloat(mandiTax) || 0;
                                                    const carr = parseFloat(carriage) || 0;
                                                    const misc = parseFloat(val) || 0;
                                                    if (base > 0) setPurchasePrice(String(base + tax + carr + misc));
                                                }} 
                                            />
                                        </div>
                                    </div>

                                    {/* Live Landed Cost Summary Badge */}
                                    {(mandiPrice || mandiTax || carriage || miscExpense) && (
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(38,194,129,0.08)', border: '1px solid rgba(38,194,129,0.2)', borderRadius: '6px', padding: '0.4rem 0.6rem', fontSize: '0.75rem', marginTop: '0.5rem' }}>
                                            <div>
                                                <span style={{ color: 'var(--text-muted)' }}>Total Landed: </span>
                                                <strong style={{ color: 'var(--primary-green-light)' }}>
                                                    PKR {((parseFloat(mandiPrice||0) + parseFloat(mandiTax||0) + parseFloat(carriage||0) + parseFloat(miscExpense||0))).toLocaleString()}
                                                </strong>
                                                {entryWeight && parseFloat(entryWeight) > 0 && (
                                                    <span style={{ marginLeft: '0.5rem', color: 'var(--accent-gold)' }}>
                                                        ({Math.round(((parseFloat(mandiPrice||0) + parseFloat(mandiTax||0) + parseFloat(carriage||0) + parseFloat(miscExpense||0))) / parseFloat(entryWeight)).toLocaleString()} PKR/kg)
                                                    </span>
                                                )}
                                            </div>
                                            {mandiPrice && mandiWeight && parseFloat(mandiWeight) > 0 && (
                                                <div style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>
                                                    Mandi Rate: {Math.round(parseFloat(mandiPrice) / parseFloat(mandiWeight)).toLocaleString()} PKR/kg
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '0.75rem' }}>
                                <button type="button" class="btn btn-secondary" onClick={() => setIsModalOpen(false)}>Cancel</button>
                                <button type="submit" class="btn btn-primary">Save</button>
                            </div>
                        </form>
                    </div>
                </div>,
                document.body
            )}

            {/* DECEASED RECORDING MODAL */}
            {deathAnimal && createPortal(
                <div class="modal-overlay">
                    <div class="glass-panel modal-container" style={{ maxWidth: '420px' }}>
                        <button class="modal-close-btn" onClick={() => setDeathAnimal(null)}>
                            <i class="fa-solid fa-xmark"></i>
                        </button>

                        <h2 class="panel-title" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '0.8rem', marginBottom: '1.5rem', color: 'hsl(0,60%,55%)' }}>
                            ☠ Record Death — {deathAnimal.rfid}
                        </h2>

                        <div style={{ background: 'rgba(150,30,30,0.05)', border: '1px solid rgba(150,30,30,0.2)', borderRadius: '8px', padding: '0.8rem 1rem', marginBottom: '1.5rem', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                <span>Breed: <strong style={{ color: 'var(--text-pure)' }}>{deathAnimal.breed}</strong></span>
                                <span>Weight: <strong style={{ color: 'var(--text-pure)' }}>{deathAnimal.currentWeight} kg</strong></span>
                            </div>
                        </div>

                        <form onSubmit={handleDeathSubmit}>
                            <div class="form-grid-row" style={{ marginBottom: '1.2rem' }}>
                                <div class="form-group" style={{ marginBottom: 0 }}>
                                    <label>Date of Death *</label>
                                    <input
                                        type="date"
                                        class="form-control"
                                        value={deathDate}
                                        onChange={(e) => setDeathDate(e.target.value)}
                                        required
                                        autoFocus
                                    />
                                </div>
                                <div class="form-group" style={{ marginBottom: 0 }}>
                                    <label>Cause of Death *</label>
                                    <select
                                        class="form-control"
                                        value={deathCause}
                                        onChange={(e) => setDeathCause(e.target.value)}
                                        required
                                    >
                                        <option value="Disease">Disease</option>
                                        <option value="Injury">Injury</option>
                                        <option value="Unknown">Unknown</option>
                                    </select>
                                </div>
                            </div>

                            <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
                                <button type="button" class="btn btn-secondary" onClick={() => setDeathAnimal(null)}>Cancel</button>
                                <button type="submit" class="btn btn-primary" style={{ background: 'rgba(150,30,30,0.5)', borderColor: 'rgba(150,30,30,0.4)' }}>
                                    ☠ Confirm Death Record
                                </button>
                            </div>
                        </form>
                    </div>
                </div>,
                document.body
            )}

            {/* MY REQUESTS — a non-admin's own edit/delete request history & status */}
            {showMyRequests && createPortal(
                <div class="modal-overlay" onClick={() => setShowMyRequests(false)}>
                    <div class="glass-panel modal-container" style={{ maxWidth: '480px' }} onClick={(e) => e.stopPropagation()}>
                        <button class="modal-close-btn" onClick={() => setShowMyRequests(false)}>
                            <i class="fa-solid fa-xmark"></i>
                        </button>

                        <h2 class="panel-title" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '0.6rem', marginBottom: '1rem' }}>
                            <i class="fa-solid fa-hourglass-half"></i> My Requests
                        </h2>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', maxHeight: '60vh', overflowY: 'auto' }}>
                            {myRequests.length === 0 ? (
                                <p class="unregistered-help-text">You haven't submitted any edit/delete requests.</p>
                            ) : myRequests.map(item => (
                                <div key={item.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '0.6rem', display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <strong style={{ color: 'var(--text-pure)' }}>
                                            {item.action === 'DELETE_ANIMAL' ? 'Delete' : 'Edit'} — {item.animalRfid || `Animal #${item.animalId}`}
                                        </strong>
                                        <span style={{
                                            fontSize: '0.7rem', padding: '0.1rem 0.5rem', borderRadius: '4px',
                                            background: item.status === 'approved' ? 'rgba(25,135,84,0.12)' : item.status === 'rejected' ? 'rgba(220,53,69,0.12)' : 'rgba(255,193,7,0.12)',
                                            color: item.status === 'approved' ? 'var(--primary-green-light)' : item.status === 'rejected' ? 'hsl(0, 75%, 65%)' : 'hsl(43,90%,53%)'
                                        }}>
                                            {item.status.toUpperCase()}
                                        </span>
                                    </div>
                                    <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Submitted {formatDate(item.requestedAt)}</span>
                                    {item.status === 'rejected' && item.reviewNote && (
                                        <span style={{ fontSize: '0.78rem', color: 'hsl(0, 75%, 70%)' }}>Reason: {item.reviewNote}</span>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                </div>,
                document.body
            )}

        </div>
    );
}
