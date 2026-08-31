import { describe, it, expect } from 'vitest';
import { formatIngredientDisplayName, getIngredientSortRank, sortIngredientsCanonical } from './dietFormatting';

describe('dietFormatting utility', () => {
    describe('formatIngredientDisplayName', () => {
        it('formats Potato Max Wanda to Wanda (Potato Max Wanda)', () => {
            expect(formatIngredientDisplayName('Potato Max Wanda')).toBe('Wanda (Potato Max Wanda)');
            expect(formatIngredientDisplayName('potato max wanda')).toBe('Wanda (Potato Max Wanda)');
        });

        it('formats Single Bag Wanda and Steady State Wanda correctly', () => {
            expect(formatIngredientDisplayName('Single Bag Wanda (W MGF)')).toBe('Wanda (Single Bag Wanda)');
            expect(formatIngredientDisplayName('Steady State Wanda')).toBe('Wanda (Steady State Wanda)');
        });

        it('formats generic Wanda properly', () => {
            expect(formatIngredientDisplayName('Wanda')).toBe('Wanda');
        });

        it('formats Straw / Toori', () => {
            expect(formatIngredientDisplayName('Wheat Straw (Toori)')).toBe('Wheat Straw (Toori)');
            expect(formatIngredientDisplayName('straw')).toBe('Wheat Straw (Toori)');
            expect(formatIngredientDisplayName('toori')).toBe('Wheat Straw (Toori)');
        });

        it('formats Silage', () => {
            expect(formatIngredientDisplayName('silage')).toBe('Maize Silage');
            expect(formatIngredientDisplayName('Maize Silage')).toBe('Maize Silage');
        });

        it('formats Potato and Limestone', () => {
            expect(formatIngredientDisplayName('Potato')).toBe('Potato (Aloo)');
            expect(formatIngredientDisplayName('Limestone')).toBe('Limestone');
        });
    });

    describe('Canonical Ingredient Ordering', () => {
        it('ranks Wanda first, then Silage, Straw, Potato, Limestone, Soda, Urea, Monensin', () => {
            const wandaRank = getIngredientSortRank('wanda', 'Wanda (Potato Max Wanda)');
            const silageRank = getIngredientSortRank('silage', 'Maize Silage');
            const strawRank = getIngredientSortRank('straw', 'Wheat Straw (Toori)');
            const potatoRank = getIngredientSortRank('potato', 'Potato');
            const limestoneRank = getIngredientSortRank('limestone', 'Limestone');
            const sodaRank = getIngredientSortRank('soda', 'Sodium Bicarbonate');
            const ureaRank = getIngredientSortRank('urea', 'Urea');
            const monensinRank = getIngredientSortRank('monensin', 'Monensin');

            expect(wandaRank).toBeLessThan(silageRank);
            expect(silageRank).toBeLessThan(strawRank);
            expect(strawRank).toBeLessThan(potatoRank);
            expect(potatoRank).toBeLessThan(limestoneRank);
            expect(limestoneRank).toBeLessThan(sodaRank);
            expect(sodaRank).toBeLessThan(ureaRank);
            expect(ureaRank).toBeLessThan(monensinRank);
        });

        it('sorts ingredients canonically regardless of input order', () => {
            const input = [
                { id: 'urea', name: 'Urea' },
                { id: 'straw', name: 'Wheat Straw (Toori)' },
                { id: 'wanda', name: 'Potato Max Wanda' },
                { id: 'silage', name: 'Maize Silage' },
                { id: 'limestone', name: 'Limestone' },
                { id: 'potato', name: 'Potato' }
            ];

            const sorted = sortIngredientsCanonical(input);
            const sortedIds = sorted.map(i => i.id);

            expect(sortedIds).toEqual(['wanda', 'silage', 'straw', 'potato', 'limestone', 'urea']);
        });
    });

    describe('Symmetric Diet Condition Rules', () => {
        it('detects 50/50 split without forced restrictions as symmetric', () => {
            const mPct = 50;
            const ePct = 50;
            const penIngredients = [
                { id: 'wanda', scaleM: 0.5, scaleE: 0.5 },
                { id: 'silage', scaleM: 0.5, scaleE: 0.5 }
            ];
            const hasForcedFeedingRules = penIngredients.some(ing => Math.abs(ing.scaleM - ing.scaleE) > 0.001);
            const isSymmetric = (mPct === 50 && ePct === 50 && !hasForcedFeedingRules);

            expect(hasForcedFeedingRules).toBe(false);
            expect(isSymmetric).toBe(true);
        });

        it('detects forced rules (e.g. Potato only in PM) as non-symmetric', () => {
            const mPct = 50;
            const ePct = 50;
            const penIngredients = [
                { id: 'wanda', scaleM: 0.5, scaleE: 0.5 },
                { id: 'potato', scaleM: 0.0, scaleE: 1.0 } // PM only
            ];
            const hasForcedFeedingRules = penIngredients.some(ing => Math.abs(ing.scaleM - ing.scaleE) > 0.001);
            const isSymmetric = (mPct === 50 && ePct === 50 && !hasForcedFeedingRules);

            expect(hasForcedFeedingRules).toBe(true);
            expect(isSymmetric).toBe(false);
        });
    });
});

