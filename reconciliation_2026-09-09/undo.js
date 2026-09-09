// One-button undo for apply.js. Reads backup.json (written by apply.js right after it
// committed) and puts the database back exactly as it was: deletes every row apply.js
// inserted, and restores every animal it updated to its pre-reconciliation rfid/
// previous_tags/current_weight. Run this any time to fully reverse the reconciliation.
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

async function refreshPenCache(client, penId) {
  if (!penId) return;
  const penInfoRes = await client.query('SELECT plan_id FROM ba_pens WHERE id = $1', [penId]);
  if (!penInfoRes.rows[0] || !penInfoRes.rows[0].plan_id) return;
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
  const backupPath = path.join(__dirname, 'backup.json');
  if (!fs.existsSync(backupPath)) {
    console.error('No backup.json found at', backupPath, '- nothing to undo.');
    process.exit(1);
  }
  const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'));

  const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();

  try {
    await client.query('BEGIN');

    if (backup.insertedWeightIds.length) {
      await client.query(`DELETE FROM ba_weights WHERE id = ANY($1::int[])`, [backup.insertedWeightIds]);
    }
    if (backup.insertedEventIds.length) {
      await client.query(`DELETE FROM ba_events WHERE id = ANY($1::int[])`, [backup.insertedEventIds]);
    }
    if (backup.insertedAnimalIds.length) {
      await client.query(`DELETE FROM ba_animals WHERE id = ANY($1::int[])`, [backup.insertedAnimalIds]);
    }
    for (const u of backup.updatedAnimals) {
      await client.query(
        `UPDATE ba_animals SET rfid = $1, previous_tags = $2, current_weight = $3, pen = $4, status = $5 WHERE id = $6`,
        [u.before.rfid, u.before.previous_tags, u.before.current_weight, u.before.pen || null, u.before.status || null, u.id]
      );
    }

    for (const pen of ['A', 'B', 'C', 'D']) {
      await refreshPenCache(client, pen);
    }

    await client.query('COMMIT');

    const donePath = path.join(__dirname, 'backup.reverted.json');
    fs.renameSync(backupPath, donePath);
    console.log('UNDO COMPLETE. Database restored to its pre-reconciliation state.');
    console.log(`Deleted ${backup.insertedWeightIds.length} weight rows, ${backup.insertedEventIds.length} events, ${backup.insertedAnimalIds.length} new animal(s).`);
    console.log(`Restored ${backup.updatedAnimals.length} animals' rfid/previous_tags/current_weight.`);
    console.log(`backup.json renamed to ${donePath} so this can't be run twice by accident.`);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('UNDO FAILED, rolled back. Backup.json left in place. Error:', e);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
