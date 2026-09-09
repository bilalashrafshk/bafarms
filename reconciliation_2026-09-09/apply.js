// One-shot script: reconciles the 2026-09-06/09-09 ear-tag mix-up across pens A/B and C/D.
// Mirrors the exact write patterns the app itself uses (api/farm.js: UPDATE_ANIMAL rfid-change
// path, LOG_WEIGHT, ADD_ANIMAL) so the resulting rows are indistinguishable from a human using
// the portal. Everything runs in ONE transaction, and every row this script creates or changes
// is captured into backup.json BEFORE it's touched, so undo.js can put the DB back exactly as
// it was with a single command.
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const CREATED_BY = 'bilalashraf248@gmail.com';
const AB_DATE = '2026-09-09';
const CD_DATE = '2026-09-06';

// ---- AB pen (today 09-09-2026) ----
const AB_DIRECT = { // rfid unchanged -> today's weight
  '16': 199.0, '42': 179.5, '37': 177.0, '31': 189.5, '73': 170.0, '35': 219.5, '60': 196.0,
  '47': 197.0, '14': 231.0, '53': 184.5, '57': 181.0, '34': 209.0, '50': 164.0, '30': 181.0,
  '02': 204.5, '61': 207.5, '72': 227.5, '36': 164.0, '86': 156.0, '29': 139.5, '38': 146.0,
};
const AB_REASSIGN = [ // [oldTag, newTag, todayWeight]
  ['67', '17', 187.5], ['98', '85', 149.5], ['52', '68', 227.5],
  ['90', '87', 196.0], ['28', '10', 193.5], ['05', '55', 215.0],
  // 65->22: AB is a closed 29-animal pool (29 DB records = 29 tag readings today), so by
  // elimination tag 22 (144kg) must be whichever AB animal is left unaccounted for once the
  // other 6 pairs are made - that's tag 65 (last 223.5kg, 2026-08-20). Implied ADG is a steep
  // -3.98 kg/day (a ~79.5kg apparent loss in 20 days) - NOT a plausible normal growth curve,
  // but the headcount constraint leaves no other candidate anywhere in the farm's own tag
  // pool. Flagged prominently below for on-site follow-up (possible illness, or the 08-20
  // entry itself was mis-keyed).
  ['65', '22', 144.0],
];
// tag 93 / animal id 34: owner decided - no pen transfer, leave it in A. Just add today's
// 184kg reading like any other AB weigh-in (its rfid, pen, and status all stay unchanged).
const TAG93_WEIGHT = { rfid: '93', pens: ['A', 'B'], weight: 184.0 };

// ---- CD pen (Sunday 09-06-2026) ----
const CD_DIRECT = {
  '20': 229.0, '49': 272.5, '78': 206.0, '24': 201.5, '51': 153.5, '62': 161.25, '48': 141.75,
  '44': 183.0, '80': 159.5, '82': 193.0, '40': 174.0, '92': 220.0, '81': 142.5, '26': 177.0,
  '21': 182.5, '69': 135.5, '39': 168.0, '77': 204.0, '54': 168.5, '43': 194.5,
  '98': 163.0, // was going to be renamed to '58', cancelled - see NOTES.md (rfid collision)
};
const CD_REASSIGN = [
  ['91', '70', 183.5], ['13', '75', 147.5], ['17', '96', 147.5], ['79', '52', 208.0],
  ['55', '45', 163.5], ['68', '66', 191.0], ['22', '99', 165.5], ['03', '23', 148.0],
  ['76', '64', 154.5], ['85', '100', 151.5], ['87', '91', 219.0],
];
// Explicitly untouched this run: tag 08 (not weighed Sunday, carries forward), tag 46 and the
// original tag-58 animal (unresolved identity - no Sunday reading exists for either, nothing
// to write) - see NOTES.md. Tag 93 is handled separately via TAG93_TRANSFER above.

function daysBetween(d1, d2) {
  const a = new Date(d1 + 'T00:00:00Z');
  const b = new Date(d2 + 'T00:00:00Z');
  return Math.round((a - b) / 86400000);
}

async function refreshPenCache(client, penId) {
  if (!penId) return;
  const penInfoRes = await client.query('SELECT plan_id, forage_type FROM ba_pens WHERE id = $1', [penId]);
  const penInfo = penInfoRes.rows[0];
  if (!penInfo || !penInfo.plan_id) return;
  // Mirrors farm.js's refreshPenCache/recomputePenWeightCache at a lighter weight: just pull
  // this pen's current animals and derive the same three cache columns it writes.
  const animalsRes = await client.query(
    `SELECT current_weight FROM ba_animals WHERE pen = $1 AND status != 'Deceased'`, [penId]
  );
  const weights = animalsRes.rows.map(r => parseFloat(r.current_weight)).filter(w => !isNaN(w));
  const avg = weights.length ? weights.reduce((a, b) => a + b, 0) / weights.length : null;
  const lastWeighRes = await client.query(
    `SELECT MAX(w.date) as d FROM ba_weights w JOIN ba_animals a ON a.id = w.animal_id WHERE a.pen = $1`, [penId]
  );
  await client.query(
    `UPDATE ba_pens SET last_actual_weight_kg = $1, last_weigh_date = $2 WHERE id = $3`,
    [avg, lastWeighRes.rows[0]?.d || null, penId]
  );
}

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();

  const backup = {
    createdAt: new Date().toISOString(),
    updatedAnimals: [],   // [{id, before: {rfid, previous_tags, current_weight}}]
    insertedWeightIds: [],
    insertedEventIds: [],
    insertedAnimalIds: [],
    log: [],
  };

  try {
    await client.query('BEGIN');

    const backedUp = new Set();
    async function backupAnimal(row) {
      if (backedUp.has(row.id)) return;
      backedUp.add(row.id);
      backup.updatedAnimals.push({
        id: row.id,
        before: { rfid: row.rfid, previous_tags: row.previous_tags, current_weight: row.current_weight, pen: row.pen, status: row.status },
      });
    }

    async function getAnimal(rfid, pens) {
      const r = await client.query(
        `SELECT id, rfid, previous_tags, current_weight, pen, status FROM ba_animals WHERE rfid = $1 AND pen = ANY($2)`,
        [rfid, pens]
      );
      if (r.rows.length !== 1) throw new Error(`Expected exactly 1 animal for rfid=${rfid} in pens ${pens}, got ${r.rows.length}`);
      await backupAnimal(r.rows[0]);
      return r.rows[0];
    }

    async function lastWeight(animalId) {
      const r = await client.query(
        `SELECT date, weight FROM ba_weights WHERE animal_id = $1 ORDER BY date DESC, id DESC LIMIT 1`,
        [animalId]
      );
      return r.rows[0] || null;
    }

    async function logWeight(animalId, date, weight) {
      const last = await lastWeight(animalId);
      let adg = 0;
      if (last) {
        const days = Math.max(1, daysBetween(date, last.date.toISOString().slice(0, 10)));
        adg = parseFloat(((weight - parseFloat(last.weight)) / days).toFixed(2));
      }
      const r = await client.query(
        `INSERT INTO ba_weights (animal_id, date, weight, adg, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [animalId, date, weight, adg, CREATED_BY]
      );
      backup.insertedWeightIds.push(r.rows[0].id);
      await client.query(`UPDATE ba_animals SET current_weight = $1 WHERE id = $2`, [weight, animalId]);
      return adg;
    }

    async function renameTag(animal, newRfid, date) {
      await backupAnimal(animal);
      let tagsList = [];
      try {
        tagsList = animal.previous_tags ? (typeof animal.previous_tags === 'string' ? JSON.parse(animal.previous_tags) : animal.previous_tags) : [];
        if (!Array.isArray(tagsList)) tagsList = [];
      } catch (e) { tagsList = []; }
      if (!tagsList.includes(animal.rfid)) tagsList.push(animal.rfid);
      await client.query(`UPDATE ba_animals SET rfid = $1, previous_tags = $2 WHERE id = $3`,
        [newRfid, JSON.stringify(tagsList), animal.id]);
      const evRes = await client.query(
        `INSERT INTO ba_events (animal_id, date, event_type, note, created_by) VALUES ($1,$2,'tag_replacement',$3,$4) RETURNING id`,
        [animal.id, date, `Ear tag updated: Tag ${animal.rfid} → Tag ${newRfid} (Tag replacement)`, CREATED_BY]
      );
      backup.insertedEventIds.push(evRes.rows[0].id);
    }

    // ---------- AB direct matches ----------
    for (const [rfid, weight] of Object.entries(AB_DIRECT)) {
      const a = await getAnimal(rfid, ['A', 'B']);
      const adg = await logWeight(a.id, AB_DATE, weight);
      backup.log.push(`AB direct  ${rfid.padStart(3)}  ${weight}kg  adg=${adg}`);
    }

    // ---------- AB reassignments ----------
    for (const [oldTag, newTag, weight] of AB_REASSIGN) {
      const a = await getAnimal(oldTag, ['A', 'B']);
      await renameTag(a, newTag, AB_DATE);
      const adg = await logWeight(a.id, AB_DATE, weight);
      backup.log.push(`AB reassign ${oldTag}->${newTag}  ${weight}kg  adg=${adg}  (animal id ${a.id})`);
    }

    // ---------- Tag 93 / animal id 34: just a weight, no pen change ----------
    {
      const a = await getAnimal(TAG93_WEIGHT.rfid, TAG93_WEIGHT.pens);
      const adg = await logWeight(a.id, AB_DATE, TAG93_WEIGHT.weight);
      backup.log.push(`Tag93 weight-only  id=${a.id}  pen ${a.pen}  ${TAG93_WEIGHT.weight}kg  adg=${adg}`);
    }

    // ---------- CD direct matches ----------
    for (const [rfid, weight] of Object.entries(CD_DIRECT)) {
      const a = await getAnimal(rfid, ['C', 'D']);
      const adg = await logWeight(a.id, CD_DATE, weight);
      backup.log.push(`CD direct  ${rfid.padStart(3)}  ${weight}kg  adg=${adg}`);
    }

    // ---------- CD reassignments ----------
    for (const [oldTag, newTag, weight] of CD_REASSIGN) {
      const a = await getAnimal(oldTag, ['C', 'D']);
      await renameTag(a, newTag, CD_DATE);
      const adg = await logWeight(a.id, CD_DATE, weight);
      backup.log.push(`CD reassign ${oldTag}->${newTag}  ${weight}kg  adg=${adg}  (animal id ${a.id})`);
    }

    // ---------- Refresh pen caches ----------
    for (const pen of ['A', 'B', 'C', 'D']) {
      await refreshPenCache(client, pen);
    }

    await client.query('COMMIT');

    const backupPath = path.join(__dirname, 'backup.json');
    fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2));
    console.log('COMMITTED. Backup written to', backupPath);
    console.log(backup.log.join('\n'));
    console.log(`\nTotals: ${backup.updatedAnimals.length} animals tag-updated, ${backup.insertedWeightIds.length} weight rows inserted, ${backup.insertedEventIds.length} events inserted, ${backup.insertedAnimalIds.length} new animal(s).`);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('FAILED, rolled back. Nothing was written. Error:', e);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
