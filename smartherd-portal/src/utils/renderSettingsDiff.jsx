import React from 'react';

export function renderSettingsDiff(key, newValue, snapValue) {
    let oldValue = snapValue;
    if (typeof oldValue === 'string') {
        try { oldValue = JSON.parse(oldValue); } catch (e) {}
    }
    if (oldValue && typeof oldValue === 'object' && 'value' in oldValue) {
        oldValue = oldValue.value;
        if (typeof oldValue === 'string') {
            try { oldValue = JSON.parse(oldValue); } catch (e) {}
        }
    }

    if (key === 'feed_stock_items') {
        const newArr = Array.isArray(newValue) ? newValue : [];
        const oldArr = Array.isArray(oldValue) ? oldValue : [];

        const added = newArr.filter(n => !oldArr.some(o => o.id === n.id));
        const removed = oldArr.filter(o => !newArr.some(n => n.id === o.id));
        const modified = newArr.filter(n => {
            const old = oldArr.find(o => o.id === n.id);
            if (!old) return false;
            return old.name !== n.name || old.unit !== n.unit || old.category !== n.category || old.derivedFromIngredientId !== n.derivedFromIngredientId;
        });

        const lines = [];
        added.forEach(item => lines.push(`+ Added: "${item.name}" (${item.category || 'feed'}, ${item.unit || 'kg'})`));
        removed.forEach(item => lines.push(`- Removed: "${item.name}" (ID: ${item.id})`));
        modified.forEach(item => {
            const old = oldArr.find(o => o.id === item.id);
            const changes = [];
            if (old.name !== item.name) changes.push(`Name: ${old.name} → ${item.name}`);
            if (old.unit !== item.unit) changes.push(`Unit: ${old.unit} → ${item.unit}`);
            if (old.category !== item.category) changes.push(`Category: ${old.category} → ${item.category}`);
            lines.push(`• Updated "${item.name}": ${changes.join(', ')}`);
        });

        if (lines.length === 0) {
            return (
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                    <strong>Feed Stock Roster ({newArr.length} items):</strong> {newArr.map(i => i.name).join(', ') || 'None'}
                </div>
            );
        }

        return (
            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: '0.2rem', marginTop: '0.2rem' }}>
                <div style={{ fontWeight: '600', color: 'var(--accent-gold)' }}>Feed Stock Items ({lines.length} change{lines.length > 1 ? 's' : ''}):</div>
                {lines.map((line, idx) => (
                    <div key={idx} style={{ color: line.startsWith('+') ? 'var(--primary-green-light)' : line.startsWith('-') ? 'hsl(0, 75%, 65%)' : 'var(--text-pure)' }}>
                        {line}
                    </div>
                ))}
            </div>
        );
    }

    if (key === 'feed_ingredients') {
        const newArr = Array.isArray(newValue) ? newValue : [];
        const oldArr = Array.isArray(oldValue) ? oldValue : [];

        const lines = [];
        newArr.forEach(n => {
            const old = oldArr.find(o => o.id === n.id);
            if (!old) {
                lines.push(`+ Added Ingredient: "${n.name}" @ PKR ${n.price || 0}/kg`);
            } else {
                const priceChanged = parseFloat(old.price) !== parseFloat(n.price);
                const dmChanged = parseFloat(old.dmTarget) !== parseFloat(n.dmTarget);
                if (priceChanged || dmChanged) {
                    const diffs = [];
                    if (priceChanged) diffs.push(`Price: PKR ${old.price || 0} → PKR ${n.price || 0}/kg`);
                    if (dmChanged) diffs.push(`DM: ${old.dmTarget || 0}% → ${n.dmTarget || 0}%`);
                    lines.push(`• ${n.name}: ${diffs.join(', ')}`);
                }
            }
        });
        oldArr.filter(o => !newArr.some(n => n.id === o.id)).forEach(o => {
            lines.push(`- Removed Ingredient: "${o.name}"`);
        });

        if (lines.length === 0) {
            return (
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                    <strong>Master Ingredient Prices:</strong> {newArr.map(i => `${i.name} (PKR ${i.price || 0})`).join(', ')}
                </div>
            );
        }

        return (
            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: '0.2rem', marginTop: '0.2rem' }}>
                <div style={{ fontWeight: '600', color: 'var(--accent-gold)' }}>Ingredient Price Changes ({lines.length}):</div>
                {lines.map((line, idx) => (
                    <div key={idx} style={{ color: line.startsWith('+') ? 'var(--primary-green-light)' : line.startsWith('-') ? 'hsl(0, 75%, 65%)' : 'var(--text-pure)' }}>
                        {line}
                    </div>
                ))}
            </div>
        );
    }

    if (key === 'feed_opening_stock') {
        const newObj = newValue || {};
        const oldObj = oldValue || {};
        const keys = Array.from(new Set([...Object.keys(newObj), ...Object.keys(oldObj)]));
        const lines = [];

        keys.forEach(k => {
            const n = newObj[k] || { qty: 0, value: 0 };
            const o = oldObj[k] || { qty: 0, value: 0 };
            if (n.qty !== o.qty || n.value !== o.value) {
                lines.push(`• ${k}: ${o.qty} kg (PKR ${o.value}) → ${n.qty} kg (PKR ${n.value})`);
            }
        });

        return (
            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: '0.2rem', marginTop: '0.2rem' }}>
                <div style={{ fontWeight: '600', color: 'var(--accent-gold)' }}>Feed Opening Stock Updates:</div>
                {lines.length > 0 ? lines.map((l, i) => <div key={i} style={{ color: 'var(--text-pure)' }}>{l}</div>) : <div>Opening stock updated.</div>}
            </div>
        );
    }

    if (key === 'mineral_split_ratio') {
        const n = (Number(parseFloat(newValue) * 100) || 0).toFixed(0);
        const o = (Number(parseFloat(oldValue) * 100) || 0).toFixed(0);
        return (
            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                <strong>Mineral Split Ratio:</strong> {o}% Limestone → <strong style={{ color: 'var(--accent-gold)' }}>{n}% Limestone</strong>
            </div>
        );
    }

    return (
        <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
            Setting Key: <strong>{key}</strong>
        </div>
    );
}
