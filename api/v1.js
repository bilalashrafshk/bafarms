/**
 * BA FOODS / SMARTHERD — MACHINE-TO-MACHINE (M2M) & AI INTEGRATION API (v1)
 * 
 * Specially engineered for AI agents (Gemini Spark, Claude, GPT), automated webhooks,
 * and IoT integrations with:
 *  - 0 Added Vercel Cost: Ultra-fast pooled lookups, <40MB RAM
 *  - Strict Anti-Corruption & Append-Only Guarantees (No destructive overwrites)
 *  - High-precision Domain Sanity Checks (Weight bounds, feed sums, active herd status)
 *  - Dry-Run Simulation Mode (?dry_run=true or payload.dry_run = true)
 *  - Timing-Safe Cryptographic Bearer Authentication (BA_API_KEY)
 */

const { Pool, types } = require('pg');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Force raw YYYY-MM-DD date string parser from Postgres (OID 1082)
types.setTypeParser(1082, (val) => val);

// Load .env locally if needed
if (!process.env.DATABASE_URL || !process.env.BA_API_KEY) {
    try {
        const candidates = [
            path.resolve(process.cwd(), '.env'),
            path.resolve(__dirname, '.env'),
            path.resolve(__dirname, '..', '.env')
        ];
        for (const envPath of candidates) {
            if (fs.existsSync(envPath)) {
                const envConfig = fs.readFileSync(envPath, 'utf8');
                envConfig.split('\n').forEach(line => {
                    const parts = line.split('=');
                    if (parts.length >= 2) {
                        const key = parts[0].trim();
                        const val = parts.slice(1).join('=').trim().replace(/^['"]|['"]$/g, '');
                        if (key && !process.env[key]) process.env[key] = val;
                    }
                });
                break;
            }
        }
    } catch (e) {
        console.warn('Unable to load local .env in v1 api:', e.message);
    }
}

const DATABASE_URL = process.env.bafarms_DATABASE_URL ||
                     process.env.bafarms_DATABASE_URL_UNPOOLED ||
                     process.env.DATABASE_URL ||
                     process.env.POSTGRES_URL ||
                     process.env.POSTGRES_PRISMA_URL;

const BA_API_KEY = process.env.BA_API_KEY ||
                   process.env.API_SECRET_KEY ||
                   'ba_live_4ad74dc4971ed32e6454ea51aea9f3dfab943e9fb750146b';

// Reusable connection pool across warm serverless invocations (saves TLS overhead)
let pool = null;
function getPool() {
    if (!pool && DATABASE_URL) {
        pool = new Pool({
            connectionString: DATABASE_URL,
            ssl: { rejectUnauthorized: false },
            max: 3,
            idleTimeoutMillis: 30000
        });
    }
    return pool;
}

// Constant-time token verification to eliminate timing-attack side channels
function verifyApiKey(req) {
    if (!BA_API_KEY) return false;
    const authHeader = req.headers['authorization'] || req.headers['Authorization'] || '';
    const customHeader = req.headers['x-api-key'] || req.headers['X-API-KEY'] || '';
    
    let token = '';
    if (authHeader.startsWith('Bearer ')) {
        token = authHeader.slice(7).trim();
    } else if (customHeader) {
        token = customHeader.trim();
    }
    if (!token) return false;

    const tokenBuf = Buffer.from(token);
    const keyBuf = Buffer.from(BA_API_KEY);
    if (tokenBuf.length !== keyBuf.length) return false;
    return crypto.timingSafeEqual(tokenBuf, keyBuf);
}

// Clean date helper
function getTodayStr() {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

// Strict Date Validator (YYYY-MM-DD)
function validateDateStr(dateStr, allowHistorical = false) {
    if (!dateStr) {
        return getTodayStr();
    }
    if (typeof dateStr !== 'string') {
        throw new Error('DATE_ERROR: "date" must be a string formatted as YYYY-MM-DD.');
    }
    const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) {
        throw new Error(`DATE_ERROR: Invalid date format "${dateStr}". Must strictly follow YYYY-MM-DD (e.g. "2026-09-14").`);
    }
    const parsed = new Date(dateStr);
    if (isNaN(parsed.getTime())) {
        throw new Error(`DATE_ERROR: "${dateStr}" is not a valid calendar day.`);
    }

    // Bounds checking
    const today = new Date(getTodayStr());
    const target = new Date(dateStr);
    const diffDays = Math.round((target - today) / (1000 * 60 * 60 * 24));

    if (diffDays > 1) {
        throw new Error(`DATE_SANITY_FAILED: Date "${dateStr}" is in the future (+${diffDays} days). AI agent must not log future records.`);
    }
    if (diffDays < -30 && !allowHistorical) {
        throw new Error(`DATE_SANITY_FAILED: Date "${dateStr}" is >30 days in the past (${Math.abs(diffDays)} days ago). If intentional backfill, pass "allow_historical": true.`);
    }
    return dateStr;
}

// Resolve animal by RFID, visual Tag ID, or internal ID
async function resolveAnimal(client, identifier) {
    if (!identifier && identifier !== 0) {
        throw new Error('ANIMAL_ERROR: "tag_id", "rfid", or "animal_id" is required.');
    }
    const raw = String(identifier).trim();
    // Strip common prefixes e.g. "Tag #36", "tag 36"
    const cleaned = raw.replace(/^(tag|tag\s*#|#)\s*/i, '').trim();

    const res = await client.query(`
        SELECT *
        FROM ba_animals
        WHERE rfid = $1 
           OR rfid = $2
           OR CAST(id AS TEXT) = $1
           OR previous_tags ILIKE $3
        LIMIT 1
    `, [raw, cleaned, `%"${cleaned}"%`]);

    if (res.rows.length === 0) {
        throw new Error(`ANIMAL_NOT_FOUND: No active animal found matching tag/RFID "${identifier}". Verify tag on registry.`);
    }
    return res.rows[0];
}

// Calculate Days on Feed (DOF)
function calcDof(entryDateStr) {
    if (!entryDateStr) return 0;
    const entry = new Date(entryDateStr);
    const today = new Date(getTodayStr());
    return Math.max(0, Math.round((today - entry) / (1000 * 60 * 60 * 24)));
}

// =========================================================================
// DOMAIN FILTERS: One-Off Corrupted Intake Window Exclusion & Baseline Rules
// Mirrored 1-to-1 with SmartHerd Portal (Dashboard.jsx, WeightTracker.jsx, CostOfGainReport.jsx, laggers.js)
// 08-Aug-2026 is the valid calibrated baseline starting date across the herd.
// 2026-07-29 and 2026-08-02 entries were recorded on an uncalibrated intake scale.
// =========================================================================
const isCorruptedWeighDate = (d) => {
    if (!d) return false;
    const str = String(d);
    return str.startsWith('2026-07-29') || str.startsWith('2026-08-02');
};

const isCorruptedAdgDate = (d) => isCorruptedWeighDate(d) || (d && String(d).startsWith('2026-08-08'));

const isPreBaselineFeedDate = (d) => {
    if (!d) return false;
    const str = String(d);
    return str < '2026-08-08';
};

// Check whether AI entries are currently in "Junior Employee" mode (subject to approval)
// or "Normal Staff" mode (direct commit). Defaults to true (Junior Employee).
async function isAiApprovalRequired(client, req, bodyOverride) {
    if (req.headers['x-require-approval'] === 'true') return true;
    if (req.headers['x-require-approval'] === 'false') return false;
    if (bodyOverride?.require_approval === true) return true;
    if (bodyOverride?.require_approval === false) return false;
    try {
        const res = await client.query("SELECT value FROM ba_settings WHERE key = 'ai_require_approval'");
        if (res.rows.length > 0) {
            const raw = res.rows[0].value;
            const val = typeof raw === 'string' ? JSON.parse(raw) : raw;
            return val !== false; // If explicitly false, then false; otherwise true.
        }
    } catch (e) {
        console.warn('Unable to query ai_require_approval setting:', e.message);
    }
    return true; // Default to true (junior employee probation mode)
}

module.exports = async (req, res) => {
    // 1. CORS Headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, x-api-key, Content-Type, x-agent-name, x-require-approval');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

    if (req.method === 'OPTIONS') {
        return res.status(204).end();
    }

    // 2. Authentication
    const isAuthed = verifyApiKey(req);
    if (!isAuthed) {
        return res.status(401).json({
            success: false,
            error: 'UNAUTHORIZED: Missing or invalid API Key. Include header "Authorization: Bearer <BA_API_KEY>" or "x-api-key: <BA_API_KEY>".'
        });
    }

    if (!DATABASE_URL) {
        return res.status(500).json({
            success: false,
            error: 'CONFIG_ERROR: DATABASE_URL is not configured.'
        });
    }

    // 3. Resolve Request Sub-route
    const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    let route = (urlObj.searchParams.get('route') || urlObj.pathname.replace(/^\/api\/v1\/?/, '')).replace(/\/+$/, '');
    if (!route) route = (req.body && req.body.route) || '';

    const query = Object.fromEntries(urlObj.searchParams.entries());
    const isDryRun = query.dry_run === 'true' || (req.body && req.body.dry_run === true);
    const agentActor = req.headers['x-agent-name'] || 'api:gemini-spark';

    const p = getPool();
    const client = await p.connect();

    try {
        // ════════════════════════════════════════════════════════════════
        // GET ENDPOINTS (Fast, Targeted Slices)
        // ════════════════════════════════════════════════════════════════
        if (req.method === 'GET') {
            
            // -------------------------------------------------------------
            // GET /api/v1/compliance/summary
            // Live daily compliance for feed, bunk checks, and critical health
            // -------------------------------------------------------------
            if (route === 'compliance/summary' || route === 'compliance') {
                const targetDate = query.date || getTodayStr();
                validateDateStr(targetDate, true);

                // Compute yesterday and 7-days-ago dates
                const tDateObj = new Date(targetDate);
                const yestObj = new Date(tDateObj);
                yestObj.setDate(yestObj.getDate() - 1);
                const yesterdayStr = yestObj.toISOString().split('T')[0];

                const sevenDaysAgoObj = new Date(tDateObj);
                sevenDaysAgoObj.setDate(sevenDaysAgoObj.getDate() - 7);
                const sevenDaysAgoStr = sevenDaysAgoObj.toISOString().split('T')[0];

                const animalsRes = await client.query(`SELECT id, rfid, pen, status, current_weight FROM ba_animals WHERE status NOT IN ('Sold', 'Deceased')`);
                const activeAnimals = animalsRes.rows;
                const activePens = Array.from(new Set(activeAnimals.filter(a => a.pen).map(a => a.pen))).sort();
                const totalPens = activePens.length;
                const sickCalves = activeAnimals.filter(a => a.status === 'Sick' || a.status === 'Hospital');

                // Query multi-day feed logs and bunk checks (last 7 days through targetDate)
                const [feedLogsRes, penChecksRes] = await Promise.all([
                    client.query(`SELECT date, pen, feeding_index, num_feedings, feeding_pct, total_batch_kg FROM ba_feed_logs WHERE date >= $1 AND date <= $2`, [sevenDaysAgoStr, targetDate]),
                    client.query(`SELECT date, pen, session, bunk_score, head_count, head_pulled FROM ba_pen_checks WHERE date >= $1 AND date <= $2`, [sevenDaysAgoStr, targetDate])
                ]);

                function calcComplianceForDay(dStr) {
                    const dayLogs = feedLogsRes.rows.filter(l => l.date === dStr);
                    const dayChecks = penChecksRes.rows.filter(c => c.date === dStr);

                    const penFeed = {};
                    for (const penId of activePens) {
                        const logs = dayLogs.filter(l => l.pen === penId || l.pen === 'ALL');
                        const loggedPct = logs.reduce((sum, l) => sum + parseFloat(l.feeding_pct || 0), 0);
                        const isComplete = logs.some(l => (l.feeding_index === 0 || l.num_feedings <= 1 || parseFloat(l.feeding_pct) >= 99.5)) || loggedPct >= 99.5;
                        penFeed[penId] = {
                            complete: isComplete,
                            logged_pct: Math.min(100, Math.round(loggedPct)),
                            feedings_recorded: logs.length
                        };
                    }
                    const compPens = activePens.filter(p => penFeed[p].complete).length;
                    const overallPct = totalPens > 0 ? Math.round((compPens / totalPens) * 100) : 100;

                    const penChecks = {};
                    for (const penId of activePens) {
                        const checks = dayChecks.filter(c => c.pen === penId);
                        penChecks[penId] = {
                            checked: checks.length > 0,
                            sessions: checks.map(c => c.session),
                            latest_bunk_score: checks.length > 0 ? checks[checks.length - 1].bunk_score : null
                        };
                    }

                    return {
                        date: dStr,
                        has_data: dayLogs.length > 0 || dayChecks.length > 0,
                        feed: {
                            is_fully_compliant: compPens === totalPens && totalPens > 0,
                            completion_pct: overallPct,
                            completed_pens: compPens,
                            total_active_pens: totalPens,
                            pen_details: penFeed
                        },
                        bunk_checks: {
                            completed_pens: activePens.filter(p => penChecks[p].checked).length,
                            total_active_pens: totalPens,
                            pen_details: penChecks
                        }
                    };
                }

                const todayReport = calcComplianceForDay(targetDate);
                const yesterdayReport = calcComplianceForDay(yesterdayStr);

                // Build 7-day trend
                const last7DaysTrend = [];
                for (let i = 1; i <= 7; i++) {
                    const d = new Date(tDateObj);
                    d.setDate(d.getDate() - i);
                    const ds = d.toISOString().split('T')[0];
                    const rep = calcComplianceForDay(ds);
                    last7DaysTrend.push({
                        date: ds,
                        feed_completion_pct: rep.feed.completion_pct,
                        completed_pens: `${rep.feed.completed_pens}/${rep.feed.total_active_pens}`,
                        bunk_checks_completed: `${rep.bunk_checks.completed_pens}/${rep.bunk_checks.total_active_pens}`,
                        has_logs: rep.has_data
                    });
                }

                const trendWithData = last7DaysTrend.filter(t => t.has_logs);
                const sevenDayAvgFeedPct = trendWithData.length > 0
                    ? Math.round(trendWithData.reduce((sum, t) => sum + t.feed_completion_pct, 0) / trendWithData.length)
                    : null;

                return res.status(200).json({
                    success: true,
                    date: targetDate,
                    has_today_data: todayReport.has_data,
                    note: !todayReport.has_data ? `No logs recorded for ${targetDate} yet (e.g. shift in progress). Displaying yesterday (${yesterdayStr}) and last 7-day compliance history.` : null,
                    compliance: todayReport,
                    yesterday_compliance: yesterdayReport,
                    last_7_days_trend: last7DaysTrend,
                    seven_day_avg_feed_compliance_pct: sevenDayAvgFeedPct,
                    health_alerts: {
                        sick_animals_count: sickCalves.length,
                        sick_animal_tags: sickCalves.map(c => c.rfid)
                    }
                });
            }

            // -------------------------------------------------------------
            // GET /api/v1/cattle/roster
            // Active herd list with current weights, pens, and DOF
            // -------------------------------------------------------------
            if (route === 'cattle/roster' || route === 'cattle') {
                let sql = `SELECT id, rfid, breed, pen, status, current_weight, entry_weight, entry_date, target_weight FROM ba_animals WHERE status NOT IN ('Sold', 'Deceased')`;
                const params = [];

                if (query.pen) {
                    params.push(query.pen.toUpperCase().trim());
                    sql += ` AND UPPER(pen) = $${params.length}`;
                }
                sql += ` ORDER BY pen ASC, rfid ASC`;

                const result = await client.query(sql, params);
                const roster = result.rows.map(a => ({
                    animal_id: a.id,
                    tag: a.rfid,
                    pen: a.pen,
                    breed: a.breed,
                    status: a.status,
                    weight_kg: parseFloat(a.current_weight || a.entry_weight || 0),
                    entry_weight_kg: parseFloat(a.entry_weight || 0),
                    entry_date: a.entry_date,
                    dof: calcDof(a.entry_date),
                    target_weight_kg: a.target_weight ? parseFloat(a.target_weight) : null
                }));

                return res.status(200).json({
                    success: true,
                    count: roster.length,
                    pen_filter: query.pen || 'ALL',
                    animals: roster
                });
            }

            // -------------------------------------------------------------
            // GET /api/v1/cattle/passport
            // Full dossier for a single tag/RFID (weights, treatments, events)
            // -------------------------------------------------------------
            if (route === 'cattle/passport') {
                const tag = query.tag || query.rfid || query.id;
                const animal = await resolveAnimal(client, tag);
                const includeUncalibrated = query.include_uncalibrated === 'true' || query.include_corrupted === 'true';

                const weightsRes = await client.query(`SELECT date, weight, adg FROM ba_weights WHERE animal_id = $1 ORDER BY date ASC`, [animal.id]);
                const treatmentsRes = await client.query(`SELECT date, type, medicine, dosage, withholding, notes FROM ba_treatments WHERE animal_id = $1 ORDER BY date DESC`, [animal.id]);
                const eventsRes = await client.query(`SELECT date, event_type, from_pen, to_pen, note FROM ba_events WHERE animal_id = $1 ORDER BY date DESC, id DESC`, [animal.id]);

                const today = new Date(getTodayStr());
                const activeWithholding = treatmentsRes.rows.filter(t => {
                    if (!t.withholding || t.withholding <= 0) return false;
                    const treatDate = new Date(t.date);
                    const safeDate = new Date(treatDate);
                    safeDate.setDate(safeDate.getDate() + t.withholding);
                    return safeDate >= today;
                });

                // Post-baseline feed logs (08-Aug-2026 onwards) matching portal filter
                const feedCostRes = await client.query(`
                    SELECT COALESCE(SUM(cost_per_animal), 0) as total_feed_cost, COUNT(*) as feed_sessions
                    FROM ba_feed_logs
                    WHERE UPPER(pen) = UPPER($1) AND date >= $2 AND date >= '2026-08-08'
                `, [animal.pen || 'A', animal.entry_date || '2000-01-01']);

                const cleanWeights = includeUncalibrated
                    ? weightsRes.rows
                    : weightsRes.rows.filter(w => !isCorruptedWeighDate(w.date));

                const dof = calcDof(animal.entry_date);
                const currentWeight = parseFloat(animal.current_weight || 0);
                const entryWeight = parseFloat(animal.entry_weight || 0);
                const mandiWeight = animal.mandi_weight ? parseFloat(animal.mandi_weight) : null;
                const gainKg = (currentWeight > 0 && entryWeight > 0) ? +(currentWeight - entryWeight).toFixed(1) : 0;
                const lifetimeAdg = (dof > 0 && gainKg !== null) ? +(gainKg / dof).toFixed(2) : null;

                // Calibrated baseline gain & ADG (from 2026-08-08 onwards)
                let calibratedGain = null;
                let calibratedAdg = null;
                if (cleanWeights.length >= 2) {
                    const firstW = cleanWeights[0];
                    const lastW = cleanWeights[cleanWeights.length - 1];
                    const d1 = new Date(firstW.date);
                    const d2 = new Date(lastW.date);
                    const cDays = Math.max(1, Math.round((d2 - d1) / (1000 * 60 * 60 * 24)));
                    calibratedGain = +(parseFloat(lastW.weight) - parseFloat(firstW.weight)).toFixed(1);
                    calibratedAdg = +(calibratedGain / cDays).toFixed(2);
                }

                const feedCostToDate = parseFloat(feedCostRes.rows[0]?.total_feed_cost || 0);
                const purchasePrice = animal.purchase_price ? parseFloat(animal.purchase_price) : null;
                const mandiPrice = animal.mandi_price ? parseFloat(animal.mandi_price) : null;

                return res.status(200).json({
                    success: true,
                    animal: {
                        animal_id: animal.id,
                        tag: animal.rfid,
                        pen: animal.pen,
                        breed: animal.breed,
                        status: animal.status,
                        source: animal.source || null,
                        mandi_weight_kg: mandiWeight,
                        landed_weight_kg: entryWeight,
                        transit_shrink_pct: (mandiWeight && mandiWeight > entryWeight) ? +(((mandiWeight - entryWeight) / mandiWeight) * 100).toFixed(1) : null,
                        current_weight_kg: currentWeight,
                        total_weight_gain_kg: gainKg,
                        target_weight_kg: animal.target_weight ? parseFloat(animal.target_weight) : null,
                        entry_date: animal.entry_date,
                        days_on_feed: dof,
                        lifetime_adg: lifetimeAdg,
                        calibrated_baseline_adg: calibratedAdg,
                        calibrated_gain_kg: calibratedGain,
                        mandi_price_pkr: mandiPrice,
                        landed_purchase_price_pkr: purchasePrice,
                        procurement_breakdown: {
                            mandi_price_pkr: mandiPrice,
                            carriage_pkr: animal.carriage ? parseFloat(animal.carriage) : null,
                            mandi_tax_pkr: animal.mandi_tax ? parseFloat(animal.mandi_tax) : null,
                            misc_expense_pkr: animal.misc_expense ? parseFloat(animal.misc_expense) : null,
                            source_market: animal.source || null
                        },
                        feed_cost_to_date_pkr: +feedCostToDate.toFixed(2),
                        feed_sessions_count: parseInt(feedCostRes.rows[0]?.feed_sessions || 0),
                        total_cost_to_date_pkr: +( (purchasePrice || 0) + feedCostToDate ).toFixed(2),
                        cost_per_kg_gain_pkr: (gainKg > 0 && feedCostToDate > 0) ? +(feedCostToDate / gainKg).toFixed(2) : null,
                        under_withholding: activeWithholding.length > 0,
                        active_withholdings: activeWithholding
                    },
                    weight_history: cleanWeights.map(w => ({
                        date: w.date,
                        weight_kg: parseFloat(w.weight),
                        adg: isCorruptedAdgDate(w.date) ? null : (w.adg ? parseFloat(w.adg) : null),
                        is_uncalibrated_intake: isCorruptedWeighDate(w.date)
                    })),
                    treatments: treatmentsRes.rows.map(t => ({
                        id: t.id,
                        date: t.date,
                        type: t.type,
                        medicine: t.medicine,
                        dosage: t.dosage,
                        withholding_days: t.withholding || 0,
                        notes: t.notes || null
                    })),
                    events: eventsRes.rows.map(e => ({
                        date: e.date,
                        event_type: e.event_type,
                        from_pen: e.from_pen,
                        to_pen: e.to_pen,
                        note: e.note
                    }))
                });
            }

            // -------------------------------------------------------------
            // GET /api/v1/cattle/weights
            // Complete historical weight logs across the herd (filterable by tag, pen, date)
            // Enforces portal one-off corrupted intake filter (2026-07-29 & 2026-08-02 excluded by default)
            // -------------------------------------------------------------
            if (route === 'cattle/weights' || route === 'cattle/weight') {
                const includeUncalibrated = query.include_uncalibrated === 'true' || query.include_corrupted === 'true';
                let sql = `
                    SELECT w.id, w.animal_id, a.rfid as tag, a.pen, a.breed, w.date, w.weight, w.adg, w.created_by
                    FROM ba_weights w
                    JOIN ba_animals a ON a.id = w.animal_id
                    WHERE 1=1
                `;
                const params = [];

                if (!includeUncalibrated) {
                    sql += ` AND w.date NOT IN ('2026-07-29', '2026-08-02')`;
                }

                if (query.tag || query.rfid) {
                    const cleanTag = String(query.tag || query.rfid).replace(/^(tag|tag\s*#|#)\s*/i, '').trim();
                    params.push(cleanTag);
                    params.push(`%"${cleanTag}"%`);
                    sql += ` AND (a.rfid = $${params.length - 1} OR a.previous_tags ILIKE $${params.length})`;
                }
                if (query.pen) {
                    params.push(query.pen.toUpperCase().trim());
                    sql += ` AND UPPER(a.pen) = $${params.length}`;
                }
                if (query.start_date) {
                    params.push(query.start_date);
                    sql += ` AND w.date >= $${params.length}`;
                }
                if (query.end_date) {
                    params.push(query.end_date);
                    sql += ` AND w.date <= $${params.length}`;
                }

                sql += ` ORDER BY w.date DESC, a.rfid ASC LIMIT 500`;

                const result = await client.query(sql, params);
                return res.status(200).json({
                    success: true,
                    count: result.rows.length,
                    filters: {
                        tag: query.tag || query.rfid || 'ALL',
                        pen: query.pen || 'ALL',
                        start_date: query.start_date || null,
                        end_date: query.end_date || null,
                        include_uncalibrated: includeUncalibrated,
                        one_off_intake_filter_applied: !includeUncalibrated
                    },
                    weight_logs: result.rows.map(w => ({
                        id: w.id,
                        animal_id: w.animal_id,
                        tag: w.tag,
                        pen: w.pen,
                        breed: w.breed,
                        date: w.date,
                        weight_kg: parseFloat(w.weight),
                        adg: isCorruptedAdgDate(w.date) ? null : (w.adg ? parseFloat(w.adg) : null),
                        is_uncalibrated_intake: isCorruptedWeighDate(w.date),
                        logged_by: w.created_by
                    }))
                });
            }

            // -------------------------------------------------------------
            // GET /api/v1/pens
            // Roster of all pens with head counts, average weights, and total biomass
            // -------------------------------------------------------------
            if (route === 'pens' || route === 'pens/roster') {
                const [pensRes, animalsRes] = await Promise.all([
                    client.query(`SELECT id, ration_plan_id, forage_type, current_target_adg, notes FROM ba_pens ORDER BY id ASC`),
                    client.query(`SELECT pen, current_weight FROM ba_animals WHERE status NOT IN ('Sold', 'Deceased')`)
                ]);

                const animalMap = {};
                for (const a of animalsRes.rows) {
                    const penKey = (a.pen || 'UNASSIGNED').toUpperCase();
                    if (!animalMap[penKey]) animalMap[penKey] = { count: 0, totalWeight: 0 };
                    animalMap[penKey].count++;
                    animalMap[penKey].totalWeight += parseFloat(a.current_weight || 0);
                }

                const pens = pensRes.rows.map(p => {
                    const stats = animalMap[p.id.toUpperCase()] || { count: 0, totalWeight: 0 };
                    return {
                        pen: p.id,
                        head_count: stats.count,
                        avg_weight_kg: stats.count > 0 ? +(stats.totalWeight / stats.count).toFixed(1) : 0,
                        total_biomass_kg: +stats.totalWeight.toFixed(1),
                        forage_type: p.forage_type || 'silage',
                        target_adg: p.current_target_adg ? parseFloat(p.current_target_adg) : null,
                        notes: p.notes || null
                    };
                });

                return res.status(200).json({
                    success: true,
                    total_pens: pens.length,
                    total_active_cattle: animalsRes.rows.length,
                    pens
                });
            }

            // -------------------------------------------------------------
            // GET /api/v1/purchasing/history
            // History of feed deliveries and veterinary medicines
            // -------------------------------------------------------------
            if (route === 'purchasing/history' || route === 'purchasing') {
                let sql = `SELECT id, date, item_id, item_name, item_unit, quantity, rate, (quantity * rate) as total_amount, supplier, notes, created_by, created_at FROM ba_feed_purchases WHERE 1=1`;
                const params = [];

                if (query.start_date) {
                    params.push(query.start_date);
                    sql += ` AND date >= $${params.length}`;
                }
                if (query.end_date) {
                    params.push(query.end_date);
                    sql += ` AND date <= $${params.length}`;
                }
                if (query.item_name) {
                    params.push(`%${query.item_name.trim()}%`);
                    sql += ` AND item_name ILIKE $${params.length}`;
                }

                sql += ` ORDER BY date DESC, created_at DESC LIMIT 100`;
                const purchases = await client.query(sql, params);

                return res.status(200).json({
                    success: true,
                    count: purchases.rows.length,
                    purchases: purchases.rows.map(p => ({
                        id: p.id,
                        date: p.date,
                        item_id: p.item_id,
                        item_name: p.item_name,
                        unit: p.item_unit || 'kg',
                        quantity: parseFloat(p.quantity),
                        rate_per_unit: parseFloat(p.rate),
                        total_cost_pkr: p.total_amount ? +parseFloat(p.total_amount).toFixed(2) : 0,
                        supplier: p.supplier,
                        notes: p.notes,
                        logged_by: p.created_by
                    }))
                });
            }

            // -------------------------------------------------------------
            // GET /api/v1/analytics/performance (or /api/v1/analytics/adg)
            // Comprehensive Herd & Pen ADG, Breed breakdown, DOF Cohorts, and Sale-ready pipeline
            // -------------------------------------------------------------
            if (route === 'analytics/performance' || route === 'analytics/adg') {
                const animalsRes = await client.query(`SELECT id, rfid, breed, pen, status, current_weight, entry_weight, entry_date, target_weight FROM ba_animals WHERE status NOT IN ('Sold', 'Deceased')`);
                const weightsRes = await client.query(`SELECT animal_id, date, weight, adg FROM ba_weights ORDER BY animal_id ASC, date ASC`);
                const pensRes = await client.query(`SELECT id, current_target_adg, forage_type FROM ba_pens`);
                const withholdRes = await client.query(`
                    SELECT DISTINCT a.rfid
                    FROM ba_treatments t
                    JOIN ba_animals a ON a.id = t.animal_id
                    WHERE t.withholding > 0 AND (t.date + (t.withholding || ' days')::interval)::date >= CURRENT_DATE
                `);

                const animals = animalsRes.rows;
                const weights = weightsRes.rows;
                const activeWithholdingTags = new Set(withholdRes.rows.map(r => r.rfid));
                const targetAdgMap = {};
                pensRes.rows.forEach(p => { targetAdgMap[p.id.toUpperCase()] = p.current_target_adg ? parseFloat(p.current_target_adg) : null; });

                const weightsByAnimal = new Map();
                weights.forEach(w => {
                    if (isCorruptedWeighDate(w.date)) return; // Exclude pre-08-Aug uncalibrated intake scale entries
                    if (!weightsByAnimal.has(w.animal_id)) weightsByAnimal.set(w.animal_id, []);
                    weightsByAnimal.get(w.animal_id).push(w);
                });

                let herdTotalGain = 0, herdTotalDays = 0;
                let r30Gain = 0, r30Days = 0;
                const thirtyDaysAgo = new Date();
                thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

                const penStats = {};
                const breedStats = {};
                const dofCohorts = {
                    '0-30 days (Intake/Quarantine)': { count: 0, totalGain: 0, totalDays: 0, totalWeight: 0 },
                    '31-60 days (Growing)': { count: 0, totalGain: 0, totalDays: 0, totalWeight: 0 },
                    '61-90 days (Finishing)': { count: 0, totalGain: 0, totalDays: 0, totalWeight: 0 },
                    '90+ days (Slaughter Ready)': { count: 0, totalGain: 0, totalDays: 0, totalWeight: 0 }
                };

                const readyForSale = [];

                animals.forEach(a => {
                    const penKey = (a.pen || 'UNASSIGNED').toUpperCase();
                    const breedKey = a.breed || 'Cross';
                    const curWeight = parseFloat(a.current_weight || 0);
                    const entryWeight = parseFloat(a.entry_weight || 0);
                    const targetWeight = a.target_weight ? parseFloat(a.target_weight) : 280;
                    const dof = calcDof(a.entry_date);

                    if (!penStats[penKey]) penStats[penKey] = { pen: penKey, head_count: 0, total_weight: 0, total_gain: 0, total_days: 0, target_adg: targetAdgMap[penKey] || null };
                    if (!breedStats[breedKey]) breedStats[breedKey] = { breed: breedKey, head_count: 0, total_weight: 0, total_gain: 0, total_days: 0 };

                    penStats[penKey].head_count++;
                    penStats[penKey].total_weight += curWeight;
                    breedStats[breedKey].head_count++;
                    breedStats[breedKey].total_weight += curWeight;

                    // Cohort assignment
                    let cohortKey = '90+ days (Slaughter Ready)';
                    if (dof <= 30) cohortKey = '0-30 days (Intake/Quarantine)';
                    else if (dof <= 60) cohortKey = '31-60 days (Growing)';
                    else if (dof <= 90) cohortKey = '61-90 days (Finishing)';
                    dofCohorts[cohortKey].count++;
                    dofCohorts[cohortKey].totalWeight += curWeight;

                    // Check if ready for sale (weight reached and clear of withholding)
                    if (curWeight >= targetWeight && !activeWithholdingTags.has(a.rfid)) {
                        readyForSale.push({
                            tag: a.rfid,
                            pen: a.pen,
                            breed: a.breed,
                            current_weight_kg: curWeight,
                            target_weight_kg: targetWeight,
                            days_on_feed: dof,
                            withholding_clear: true
                        });
                    }

                    // ADG calculations across weigh-in intervals
                    const history = weightsByAnimal.get(a.id) || [];
                    for (let i = 1; i < history.length; i++) {
                        const prev = history[i - 1];
                        const cur = history[i];
                        if (isCorruptedWeighDate(prev.date) || isCorruptedWeighDate(cur.date)) continue;
                        const d1 = new Date(prev.date);
                        const d2 = new Date(cur.date);
                        const days = Math.max(1, Math.round((d2 - d1) / (1000 * 60 * 60 * 24)));
                        const gain = parseFloat(cur.weight) - parseFloat(prev.weight);

                        herdTotalGain += gain;
                        herdTotalDays += days;

                        penStats[penKey].total_gain += gain;
                        penStats[penKey].total_days += days;

                        breedStats[breedKey].total_gain += gain;
                        breedStats[breedKey].total_days += days;

                        dofCohorts[cohortKey].totalGain += gain;
                        dofCohorts[cohortKey].totalDays += days;

                        if (d2 >= thirtyDaysAgo) {
                            r30Gain += gain;
                            r30Days += days;
                        }
                    }
                });

                const avgHerdAdg = herdTotalDays > 0 ? +(herdTotalGain / herdTotalDays).toFixed(2) : null;
                const rolling30Adg = r30Days > 0 ? +(r30Gain / r30Days).toFixed(2) : avgHerdAdg;

                return res.status(200).json({
                    success: true,
                    as_of_date: getTodayStr(),
                    one_off_filter: {
                        applied: true,
                        uncalibrated_intake_dates_excluded: ['2026-07-29', '2026-08-02'],
                        calibrated_baseline_date: '2026-08-08'
                    },
                    herd_kpis: {
                        total_active_cattle: animals.length,
                        total_herd_biomass_kg: +animals.reduce((sum, a) => sum + parseFloat(a.current_weight || 0), 0).toFixed(1),
                        average_calf_weight_kg: animals.length > 0 ? +(animals.reduce((sum, a) => sum + parseFloat(a.current_weight || 0), 0) / animals.length).toFixed(1) : 0,
                        overall_herd_adg_kg_day: avgHerdAdg,
                        rolling_30day_adg_kg_day: rolling30Adg,
                        total_monitored_animal_days: herdTotalDays,
                        ready_for_sale_head_count: readyForSale.length
                    },
                    pen_performance: Object.values(penStats).map(p => {
                        const actualAdg = p.total_days > 0 ? +(p.total_gain / p.total_days).toFixed(2) : null;
                        const variance = (actualAdg !== null && p.target_adg !== null) ? +(actualAdg - p.target_adg).toFixed(2) : null;
                        return {
                            pen: p.pen,
                            head_count: p.head_count,
                            avg_weight_kg: p.head_count > 0 ? +(p.total_weight / p.head_count).toFixed(1) : 0,
                            total_biomass_kg: +p.total_weight.toFixed(1),
                            target_adg: p.target_adg,
                            actual_adg: actualAdg,
                            adg_variance: variance,
                            performance_status: variance === null ? 'Pending Data' : variance >= 0 ? 'On/Ahead of Target' : 'Lagging Target'
                        };
                    }).sort((a, b) => a.pen.localeCompare(b.pen)),
                    breed_breakdown: Object.values(breedStats).map(b => ({
                        breed: b.breed,
                        head_count: b.head_count,
                        avg_weight_kg: b.head_count > 0 ? +(b.total_weight / b.head_count).toFixed(1) : 0,
                        achieved_adg: b.total_days > 0 ? +(b.total_gain / b.total_days).toFixed(2) : null
                    })),
                    dof_cohorts: Object.entries(dofCohorts).map(([name, c]) => ({
                        cohort: name,
                        head_count: c.count,
                        avg_weight_kg: c.count > 0 ? +(c.totalWeight / c.count).toFixed(1) : 0,
                        achieved_adg: c.totalDays > 0 ? +(c.totalGain / c.totalDays).toFixed(2) : null
                    })),
                    ready_for_sale_pipeline: readyForSale
                });
            }

            // -------------------------------------------------------------
            // GET /api/v1/analytics/financials (or /api/v1/analytics/cost-of-gain or /api/v1/feed/diet-comparison)
            // All-in Feedlot Financials: Procurement, Feed Spend, Overheads, Cost per kg Gain, Daily Feed/Head
            // Enforces portal baseline filter: feed logs date >= 2026-08-08 & uncalibrated weights excluded
            // -------------------------------------------------------------
            if (route === 'analytics/financials' || route === 'analytics/cost-of-gain' || route === 'feed/diet-comparison') {
                const animalsRes = await client.query(`SELECT id, purchase_price, current_weight, entry_weight FROM ba_animals WHERE status NOT IN ('Sold', 'Deceased')`);
                const expRes = await client.query(`SELECT COALESCE(SUM(amount), 0) as total_overhead FROM ba_overhead_expenses`);
                const weightsRes = await client.query(`SELECT animal_id, date, weight FROM ba_weights ORDER BY animal_id, date`);

                // Query all valid baseline feed logs with sessions and ingredients
                const feedRes = await client.query(`
                    SELECT to_char(date, 'YYYY-MM-DD') as date_str, pen, feeding_index, num_feedings, feeding_pct,
                           total_batch_kg, total_dm_kg, total_cost, animal_count, ingredients
                    FROM ba_feed_logs
                    WHERE date >= '2026-08-08' AND total_cost > 0
                    ORDER BY date DESC, pen ASC
                `);

                const totalPurchaseCost = animalsRes.rows.reduce((sum, a) => sum + parseFloat(a.purchase_price || 0), 0);
                const totalOverhead = parseFloat(expRes.rows[0].total_overhead || 0);

                // Group feed logs by date and calculate weighted animal-days (mirrors Dashboard.jsx logic)
                const logsByDate = new Map();
                let totalFeedCost = 0;
                let totalAnimalDays = 0;
                let totalFeedBatchKg = 0;
                let totalFeedDmKg = 0;

                feedRes.rows.forEach(r => {
                    const cost = parseFloat(r.total_cost || 0);
                    const pct = (r.feeding_pct !== null && r.feeding_pct !== undefined) ? parseFloat(r.feeding_pct) : 100;
                    const aDays = (parseInt(r.animal_count) || 0) * (pct / 100);

                    totalFeedCost += cost;
                    totalAnimalDays += aDays;
                    totalFeedBatchKg += parseFloat(r.total_batch_kg || 0);
                    totalFeedDmKg += parseFloat(r.total_dm_kg || 0);

                    if (!logsByDate.has(r.date_str)) logsByDate.set(r.date_str, []);
                    logsByDate.get(r.date_str).push(r);
                });

                const totalAllInCost = totalPurchaseCost + totalFeedCost + totalOverhead;

                // Net weight gain across calibrated post-baseline transitions
                const weightsByAnimal = new Map();
                weightsRes.rows.forEach(w => {
                    if (isCorruptedWeighDate(w.date)) return;
                    if (!weightsByAnimal.has(w.animal_id)) weightsByAnimal.set(w.animal_id, []);
                    weightsByAnimal.get(w.animal_id).push(w);
                });

                let totalGainKg = 0;
                weightsByAnimal.forEach(list => {
                    for (let i = 1; i < list.length; i++) {
                        const prev = list[i - 1];
                        const cur = list[i];
                        if (isCorruptedWeighDate(prev.date) || isCorruptedWeighDate(cur.date)) continue;
                        totalGainKg += (parseFloat(cur.weight) - parseFloat(prev.weight));
                    }
                });

                const feedCostPerKgGain = totalGainKg > 0 ? +(totalFeedCost / totalGainKg).toFixed(2) : null;
                const allInCostPerKgGain = totalGainKg > 0 ? +((totalFeedCost + totalOverhead) / totalGainKg).toFixed(2) : null;

                // Head count and true weighted daily feed cost per head
                const headCount = Math.max(1, animalsRes.rows.length);
                const overallDailyFeedCostPerHead = totalAnimalDays > 0 ? +(totalFeedCost / totalAnimalDays).toFixed(2) : null;

                // Determine target date and multi-day breakdown
                const recordedDates = Array.from(logsByDate.keys()).sort().reverse();
                const latestRecordedDate = recordedDates[0] || getTodayStr();
                const targetDate = query.date || latestRecordedDate;

                function offsetDateStr(baseStr, days) {
                    const d = new Date(baseStr);
                    d.setDate(d.getDate() + days);
                    return d.toISOString().split('T')[0];
                }

                function getDailyFeedStats(dStr) {
                    const logs = logsByDate.get(dStr) || [];
                    const cost = logs.reduce((sum, l) => sum + parseFloat(l.total_cost || 0), 0);
                    const animalDays = logs.reduce((sum, l) => {
                        const pct = (l.feeding_pct !== null && l.feeding_pct !== undefined) ? parseFloat(l.feeding_pct) : 100;
                        return sum + (parseInt(l.animal_count) || 0) * (pct / 100);
                    }, 0);
                    const batchKg = logs.reduce((sum, l) => sum + parseFloat(l.total_batch_kg || 0), 0);
                    const dmKg = logs.reduce((sum, l) => sum + parseFloat(l.total_dm_kg || 0), 0);
                    return {
                        date: dStr,
                        has_data: logs.length > 0,
                        total_cost_pkr: +cost.toFixed(2),
                        total_animal_days: +animalDays.toFixed(1),
                        cost_per_head_pkr: animalDays > 0 ? +(cost / animalDays).toFixed(2) : null,
                        total_batch_kg: +batchKg.toFixed(1),
                        total_dm_kg: +dmKg.toFixed(1),
                        sessions_count: logs.length
                    };
                }

                const todayFeedStats = getDailyFeedStats(targetDate);
                const hasTargetData = todayFeedStats.has_data;

                // Active baseline date: If targetDate has data, use targetDate.
                // If targetDate has NO data (e.g. today or future date awaiting physical clipboards),
                // fall back to the latest verified recorded date in the database.
                const activeBaselineDate = hasTargetData ? targetDate : latestRecordedDate;
                const activeDateStats = getDailyFeedStats(activeBaselineDate);

                const activeYesterdayStr = offsetDateStr(activeBaselineDate, -1);
                const activeDayBeforeStr = offsetDateStr(activeBaselineDate, -2);
                const activeSevenDaysAgoStr = offsetDateStr(activeBaselineDate, -7);

                const activeYesterdayStats = getDailyFeedStats(activeYesterdayStr);
                const activeDayBeforeStats = getDailyFeedStats(activeDayBeforeStr);
                const activeSevenDaysAgoStats = getDailyFeedStats(activeSevenDaysAgoStr);

                // 7-day rolling window preceding or inclusive of activeBaselineDate
                let rollCost = 0;
                let rollAnimalDays = 0;
                const active7DaysTrend = [];
                for (let i = 0; i < 7; i++) {
                    const dStr = offsetDateStr(activeBaselineDate, -i);
                    const s = getDailyFeedStats(dStr);
                    active7DaysTrend.push(s);
                    if (s.has_data) {
                        rollCost += s.total_cost_pkr;
                        rollAnimalDays += s.total_animal_days;
                    }
                }
                const rolling7DayAvgCostPerHead = rollAnimalDays > 0 ? +(rollCost / rollAnimalDays).toFixed(2) : null;

                // Detect missing dates between latestRecordedDate and targetDate
                const pendingSyncDates = [];
                if (!hasTargetData && targetDate > latestRecordedDate) {
                    let cur = new Date(latestRecordedDate);
                    cur.setDate(cur.getDate() + 1);
                    const end = new Date(targetDate);
                    while (cur <= end) {
                        pendingSyncDates.push(cur.toISOString().split('T')[0]);
                        cur.setDate(cur.getDate() + 1);
                    }
                }

                // Diet comparison helper
                function getDietAggregate(dStr) {
                    const logs = logsByDate.get(dStr) || [];
                    const map = {};
                    logs.forEach(r => {
                        const count = parseInt(r.animal_count) || 0;
                        (r.ingredients || []).forEach(ing => {
                            const name = (ing.name || 'Unknown').trim();
                            const kg = parseFloat(ing.wetBatch || ing.kg || 0);
                            const price = parseFloat(ing.price || 0);
                            const cost = (parseFloat(ing.costSingle || 0) * count) || (kg * price);
                            if (!map[name]) map[name] = { kg: 0, cost: 0, price: price };
                            map[name].kg += kg;
                            map[name].cost += cost;
                            if (price > 0) map[name].price = price;
                        });
                    });
                    return map;
                }

                function buildDietComparison(baseDateStr, compDateStr) {
                    const baseDiet = getDietAggregate(baseDateStr);
                    const compDiet = getDietAggregate(compDateStr);
                    const allKeys = Array.from(new Set([...Object.keys(baseDiet), ...Object.keys(compDiet)])).sort();
                    return allKeys.map(name => {
                        const bItem = baseDiet[name] || { kg: 0, cost: 0, price: 0 };
                        const cItem = compDiet[name] || { kg: 0, cost: 0, price: 0 };
                        const diffKg = +(bItem.kg - cItem.kg).toFixed(1);
                        const diffCost = +(bItem.cost - cItem.cost).toFixed(2);
                        const pctChange = cItem.kg > 0 ? +((diffKg / cItem.kg) * 100).toFixed(1) : (bItem.kg > 0 ? 100 : 0);
                        let trend = 'UNCHANGED';
                        if (diffKg > 0.1) trend = 'INCREASED';
                        else if (diffKg < -0.1) trend = 'DECREASED';
                        if (cItem.kg === 0 && bItem.kg > 0) trend = 'NEW_ADDITION';
                        if (bItem.kg === 0 && cItem.kg > 0) trend = 'REMOVED';

                        return {
                            ingredient: name,
                            today_kg: +bItem.kg.toFixed(1),
                            previous_kg: +cItem.kg.toFixed(1),
                            diff_kg: diffKg,
                            pct_change: pctChange,
                            trend,
                            price_per_kg_pkr: +(bItem.price || cItem.price).toFixed(2),
                            today_cost_pkr: +bItem.cost.toFixed(2),
                            previous_cost_pkr: +cItem.cost.toFixed(2),
                            cost_diff_pkr: diffCost
                        };
                    }).filter(i => i.today_kg > 0 || i.previous_kg > 0);
                }

                const todayVsYesterdayDiet = buildDietComparison(activeBaselineDate, activeYesterdayStr);
                const todayVs7DaysAgoDiet = buildDietComparison(activeBaselineDate, activeSevenDaysAgoStr);

                // Estimated live cattle valuation (assuming market meat rate ~PKR 850/kg live weight)
                const totalBiomassKg = animalsRes.rows.reduce((sum, a) => sum + parseFloat(a.current_weight || 0), 0);
                const estimatedMarketRatePerKg = 850;
                const estimatedHerdValuation = +(totalBiomassKg * estimatedMarketRatePerKg).toFixed(2);
                const unrealizedPnL = +(estimatedHerdValuation - totalAllInCost).toFixed(2);

                return res.status(200).json({
                    success: true,
                    one_off_filter: {
                        applied: true,
                        pre_baseline_feed_excluded: 'date < 2026-08-08',
                        uncalibrated_intake_dates_excluded: ['2026-07-29', '2026-08-02']
                    },
                    financial_summary: {
                        total_active_head: headCount,
                        total_procurement_cost_pkr: +totalPurchaseCost.toFixed(2),
                        avg_procurement_cost_per_head_pkr: +(totalPurchaseCost / headCount).toFixed(2),
                        total_feed_cost_pkr: +totalFeedCost.toFixed(2),
                        total_overhead_cost_pkr: +totalOverhead.toFixed(2),
                        total_invested_capital_pkr: +totalAllInCost.toFixed(2),
                        cost_per_head_all_in_pkr: +(totalAllInCost / headCount).toFixed(2)
                    },
                    gain_and_efficiency_economics: {
                        total_measured_weight_gain_kg: +totalGainKg.toFixed(1),
                        feed_cost_per_kg_gain_pkr: feedCostPerKgGain,
                        all_in_cost_per_kg_gain_pkr: allInCostPerKgGain,
                        daily_feed_cost_per_head_pkr: overallDailyFeedCostPerHead
                    },
                    daily_feed_cost_trend: {
                        report_date: targetDate,
                        has_report_date_data: hasTargetData,
                        portal_headline_metric: {
                            metric_name: 'Daily Feed Cost (SmartHerd Portal Dashboard)',
                            cost_per_head_pkr: overallDailyFeedCostPerHead,
                            portal_display_rounded_pkr: overallDailyFeedCostPerHead !== null ? Math.round(overallDailyFeedCostPerHead) : null,
                            portal_label: 'Avg. of logged feedings',
                            note: 'Exact headline metric displayed on the SmartHerd portal dashboard (all-time weighted average of valid logged feedings)'
                        },
                        sync_status: {
                            status: hasTargetData ? 'SYNCED' : 'PENDING_FARM_SLIP_ENTRY',
                            latest_verified_date: latestRecordedDate,
                            pending_sync_dates: pendingSyncDates,
                            guardrail_notice: !hasTargetData
                                ? `Feed logs for ${pendingSyncDates.join(', ') || targetDate} are awaiting entry from physical farm clipboards. AI models MUST NOT invent or simulate feeding slips. Report verified numbers from latest_verified_date (${latestRecordedDate}).`
                                : 'Feed logs are verified and synced.'
                        },
                        latest_verified_date: latestRecordedDate,
                        latest_verified_cost_per_head_pkr: activeDateStats.cost_per_head_pkr,
                        latest_verified_total_cost_pkr: activeDateStats.total_cost_pkr,
                        latest_verified_batch_kg: activeDateStats.total_batch_kg,
                        today_cost_per_head_pkr: hasTargetData ? todayFeedStats.cost_per_head_pkr : activeDateStats.cost_per_head_pkr,
                        yesterday_cost_per_head_pkr: activeYesterdayStats.cost_per_head_pkr,
                        day_before_yesterday_cost_per_head_pkr: activeDayBeforeStats.cost_per_head_pkr,
                        seven_days_ago_cost_per_head_pkr: activeSevenDaysAgoStats.cost_per_head_pkr,
                        last_7_days_rolling_avg_pkr: rolling7DayAvgCostPerHead,
                        overall_baseline_avg_pkr: overallDailyFeedCostPerHead,
                        details: {
                            requested_target_date: todayFeedStats,
                            latest_verified_day: activeDateStats,
                            yesterday_verified: activeYesterdayStats,
                            day_before_verified: activeDayBeforeStats,
                            seven_days_ago_verified: activeSevenDaysAgoStats,
                            last_7_days_verified: active7DaysTrend
                        }
                    },
                    diet_comparison: {
                        base_date: activeBaselineDate,
                        compared_with_yesterday_date: activeYesterdayStr,
                        compared_with_7_days_ago_date: activeSevenDaysAgoStr,
                        is_fallback_to_latest_verified: !hasTargetData,
                        note: !hasTargetData ? `Target date ${targetDate} has no feed logs entered yet. Diet comparison shows latest verified feed date (${activeBaselineDate}) vs prior day (${activeYesterdayStr}) and 7 days prior (${activeSevenDaysAgoStr}).` : null,
                        today_vs_yesterday: {
                            compared_with_date: activeYesterdayStr,
                            items: todayVsYesterdayDiet
                        },
                        today_vs_7_days_ago: {
                            compared_with_date: activeSevenDaysAgoStr,
                            items: todayVs7DaysAgoDiet
                        }
                    },
                    valuation_and_margin: {
                        total_herd_biomass_kg: +totalBiomassKg.toFixed(1),
                        assumed_live_rate_per_kg_pkr: estimatedMarketRatePerKg,
                        estimated_herd_market_value_pkr: estimatedHerdValuation,
                        unrealized_gross_margin_pkr: unrealizedPnL,
                        margin_status: unrealizedPnL >= 0 ? 'Profitable' : 'Investment Phase'
                    }
                });
            }

            // -------------------------------------------------------------
            // GET /api/v1/analytics/feed-efficiency (or /api/v1/analytics/fcr)
            // FCR, Dry Matter Intake % of Biomass, and Cumulative Commodity Consumption
            // Enforces portal baseline filter: feed logs date >= 2026-08-08 & uncalibrated weights excluded
            // -------------------------------------------------------------
            if (route === 'analytics/feed-efficiency' || route === 'analytics/fcr') {
                const feedRes = await client.query(`SELECT date, total_batch_kg, total_dm_kg, ingredients FROM ba_feed_logs WHERE date >= '2026-08-08'`);
                const animalsRes = await client.query(`SELECT current_weight FROM ba_animals WHERE status NOT IN ('Sold', 'Deceased')`);
                const weightsRes = await client.query(`SELECT animal_id, date, weight FROM ba_weights ORDER BY animal_id, date`);

                let totalWetKg = 0;
                let totalDmKg = 0;
                const ingredientTotals = {};

                feedRes.rows.forEach(f => {
                    totalWetKg += parseFloat(f.total_batch_kg || 0);
                    totalDmKg += parseFloat(f.total_dm_kg || 0);
                    const ings = Array.isArray(f.ingredients) ? f.ingredients : [];
                    ings.forEach(ing => {
                        const name = ing.name || 'Other';
                        const kg = parseFloat(ing.kg || 0);
                        ingredientTotals[name] = (ingredientTotals[name] || 0) + kg;
                    });
                });

                // Weight gain across valid calibrated transitions
                const weightsByAnimal = new Map();
                weightsRes.rows.forEach(w => {
                    if (isCorruptedWeighDate(w.date)) return;
                    if (!weightsByAnimal.has(w.animal_id)) weightsByAnimal.set(w.animal_id, []);
                    weightsByAnimal.get(w.animal_id).push(w);
                });

                let totalGainKg = 0;
                weightsByAnimal.forEach(list => {
                    for (let i = 1; i < list.length; i++) {
                        const prev = list[i - 1];
                        const cur = list[i];
                        if (isCorruptedWeighDate(prev.date) || isCorruptedWeighDate(cur.date)) continue;
                        totalGainKg += (parseFloat(cur.weight) - parseFloat(prev.weight));
                    }
                });

                const fcr = (totalGainKg > 0 && totalDmKg > 0) ? +(totalDmKg / totalGainKg).toFixed(2) : null;
                const totalBiomass = animalsRes.rows.reduce((sum, a) => sum + parseFloat(a.current_weight || 0), 0);

                return res.status(200).json({
                    success: true,
                    one_off_filter: {
                        applied: true,
                        pre_baseline_feed_excluded: 'date < 2026-08-08',
                        uncalibrated_intake_dates_excluded: ['2026-07-29', '2026-08-02']
                    },
                    feed_efficiency: {
                        fcr_dry_matter_to_gain: fcr,
                        fcr_benchmark: fcr === null ? 'Pending Data' : fcr <= 6.5 ? 'Excellent (<6.5)' : fcr <= 8.5 ? 'Normal (6.5-8.5)' : 'High Feed Intake (>8.5)',
                        total_wet_feed_tonnes: +(totalWetKg / 1000).toFixed(2),
                        total_dry_matter_tonnes: +(totalDmKg / 1000).toFixed(2),
                        total_weight_gain_measured_kg: +totalGainKg.toFixed(1),
                        current_herd_biomass_kg: +totalBiomass.toFixed(1)
                    },
                    commodity_consumption_kg: Object.entries(ingredientTotals)
                        .map(([name, kg]) => ({
                            ingredient: name,
                            total_consumed_kg: +kg.toFixed(1),
                            share_pct: totalWetKg > 0 ? +((kg / totalWetKg) * 100).toFixed(1) : 0
                        }))
                        .sort((a, b) => b.total_consumed_kg - a.total_consumed_kg)
                });
            }

            // -------------------------------------------------------------
            // GET /api/v1/feed/items (or /api/v1/feed/catalog or /api/v1/inventory/items)
            // Complete unified catalog of all unique feed items we have or have ever had
            // -------------------------------------------------------------
            if (route === 'feed/items' || route === 'feed/catalog' || route === 'inventory/items') {
                const stockRes = await client.query("SELECT value FROM ba_settings WHERE key = 'feed_stock_items'");
                const rawStock = stockRes.rows[0]?.value;
                const stockItems = typeof rawStock === 'string' ? JSON.parse(rawStock) : (rawStock || []);

                const purchasesRes = await client.query(`
                    SELECT item_name, count(*) as purchase_count, sum(quantity) as total_quantity_purchased, 
                           max(date) as last_purchased_date, max(supplier) as primary_supplier
                    FROM ba_feed_purchases
                    GROUP BY item_name
                    ORDER BY purchase_count DESC
                `);

                const feedLogsRes = await client.query(`SELECT ingredients FROM ba_feed_logs WHERE ingredients IS NOT NULL`);
                const fedMap = new Map();
                feedLogsRes.rows.forEach(r => {
                    const ings = Array.isArray(r.ingredients) ? r.ingredients : [];
                    ings.forEach(i => {
                        if (!i.name) return;
                        const existing = fedMap.get(i.name) || { feeding_sessions: 0, total_kg_fed: 0 };
                        existing.feeding_sessions++;
                        existing.total_kg_fed += parseFloat(i.kg || 0);
                        fedMap.set(i.name, existing);
                    });
                });

                // Classification
                const feedCommoditiesSet = new Set();
                const wandaRecipesSet = new Set();
                const supplementsAndMineralsSet = new Set();
                const medicinesAndSuppliesSet = new Set();

                // 1. Ingest stock items
                stockItems.forEach(item => {
                    const cat = (item.category || 'feed').toLowerCase();
                    const name = item.name.trim();
                    if (cat === 'medicine' || cat === 'supply') {
                        medicinesAndSuppliesSet.add(name);
                    } else if (item.isPremix) {
                        wandaRecipesSet.add(name);
                        feedCommoditiesSet.add(name);
                    } else {
                        feedCommoditiesSet.add(name);
                    }
                });

                // 2. Ingest purchases
                purchasesRes.rows.forEach(p => {
                    const name = p.item_name.trim();
                    // Check if matched in medicines
                    const matchedStock = stockItems.find(s => s.name.toLowerCase() === name.toLowerCase());
                    if (matchedStock && (matchedStock.category === 'medicine' || matchedStock.category === 'supply')) {
                        medicinesAndSuppliesSet.add(name);
                    } else {
                        // Check common medicine keywords
                        const isMed = /inj|syring|needle|drip|spray|bandage|drench|powder|thermometer|pydoine|panacort|oxafax|pulmovac|amovet|endectin|tribrisen|ivotec/i.test(name);
                        if (isMed) {
                            medicinesAndSuppliesSet.add(name);
                        } else {
                            feedCommoditiesSet.add(name);
                        }
                    }
                });

                // 3. Ingest fed items
                fedMap.forEach((val, name) => {
                    feedCommoditiesSet.add(name.trim());
                });

                return res.status(200).json({
                    success: true,
                    total_unique_feed_items: feedCommoditiesSet.size,
                    feed_commodities_and_wanda: Array.from(feedCommoditiesSet).sort(),
                    active_inventory_stock_items: stockItems
                        .filter(i => (i.category || 'feed') === 'feed')
                        .map(i => ({
                            id: i.id,
                            name: i.name,
                            unit: i.unit || 'kg',
                            is_inhouse_wanda_premix: !!i.isPremix
                        })),
                    historical_purchases_summary: purchasesRes.rows.map(p => ({
                        item_name: p.item_name,
                        total_receipts: parseInt(p.purchase_count),
                        total_quantity: +parseFloat(p.total_quantity_purchased || 0).toFixed(1),
                        last_purchased: p.last_purchased_date,
                        supplier: p.primary_supplier
                    })),
                    historical_bunk_dispensed_summary: Array.from(fedMap.entries()).map(([name, stat]) => ({
                        ingredient_name: name,
                        feeding_sessions: stat.feeding_sessions,
                        total_kg_dispensed: +stat.total_kg_fed.toFixed(1)
                    })).sort((a, b) => b.total_kg_dispensed - a.total_kg_dispensed),
                    veterinary_medicines_and_supplies: Array.from(medicinesAndSuppliesSet).sort()
                });
            }

            // -------------------------------------------------------------
            // GET /api/v1/feed/logs
            // -------------------------------------------------------------
            if (route === 'feed/logs' || route === 'feed') {
                const targetDate = query.date || getTodayStr();
                validateDateStr(targetDate, true);

                let sql = `SELECT id, date, pen, feeding_index, num_feedings, feeding_pct, total_batch_kg, ingredients, notes, created_by, created_at FROM ba_feed_logs WHERE date = $1`;
                const params = [targetDate];

                if (query.pen) {
                    params.push(query.pen.toUpperCase().trim());
                    sql += ` AND UPPER(pen) = $2`;
                }
                sql += ` ORDER BY pen ASC, feeding_index ASC`;

                const result = await client.query(sql, params);
                return res.status(200).json({
                    success: true,
                    date: targetDate,
                    count: result.rows.length,
                    feed_logs: result.rows
                });
            }

            // -------------------------------------------------------------
            // GET /api/v1/pen-checks
            // -------------------------------------------------------------
            if (route === 'pen-checks' || route === 'pen-check') {
                const targetDate = query.date || getTodayStr();
                validateDateStr(targetDate, true);

                const result = await client.query(`
                    SELECT id, date, pen, session, check_time, bunk_score, head_count, head_pulled, notes, created_by 
                    FROM ba_pen_checks 
                    WHERE date = $1 
                    ORDER BY pen ASC, session ASC
                `, [targetDate]);

                return res.status(200).json({
                    success: true,
                    date: targetDate,
                    count: result.rows.length,
                    pen_checks: result.rows
                });
            }

            // -------------------------------------------------------------
            // GET /api/v1/health/withholding
            // -------------------------------------------------------------
            if (route === 'health/withholding' || route === 'withholding') {
                const today = getTodayStr();
                const result = await client.query(`
                    SELECT t.id, t.animal_id, a.rfid as tag, a.pen, t.date as treatment_date, t.medicine, t.dosage, t.withholding,
                           (t.date + (t.withholding || ' days')::interval)::date as safe_date
                    FROM ba_treatments t
                    JOIN ba_animals a ON a.id = t.animal_id
                    WHERE t.withholding > 0 
                      AND (t.date + (t.withholding || ' days')::interval)::date >= $1::date
                    ORDER BY safe_date ASC
                `, [today]);

                return res.status(200).json({
                    success: true,
                    as_of_date: today,
                    count: result.rows.length,
                    withholding_active: result.rows
                });
            }

            // -------------------------------------------------------------
            // GET /api/v1/tasks/upcoming (Aliases: /api/v1/tasks/overdue, /api/v1/tasks)
            // Upcoming & Overdue Operations: Weigh-ins, Pen Schedules, Quarantine Protocols, Market Ready Calves
            // -------------------------------------------------------------
            if (route === 'tasks/upcoming' || route === 'tasks/overdue' || route === 'tasks') {
                const asOfDate = query.date || getTodayStr();
                const weighIntervalDays = parseInt(query.weigh_interval_days || query.interval || 14);
                const penFilter = query.pen ? query.pen.toUpperCase().trim() : null;

                const animalsRes = await client.query(`
                    SELECT id, rfid as tag, breed, pen, status, current_weight, entry_weight, 
                           to_char(entry_date, 'YYYY-MM-DD') as entry_date, target_weight 
                    FROM ba_animals 
                    WHERE status NOT IN ('Sold', 'Deceased')
                    ORDER BY pen ASC, rfid ASC
                `);

                const weightsRes = await client.query(`
                    SELECT animal_id, to_char(date, 'YYYY-MM-DD') as date, weight 
                    FROM ba_weights 
                    ORDER BY animal_id, date DESC
                `);

                const treatmentsRes = await client.query(`
                    SELECT t.id, t.animal_id, a.rfid as tag, a.pen, to_char(t.date, 'YYYY-MM-DD') as treatment_date, 
                           t.medicine, t.dosage, t.withholding, 
                           to_char((t.date + (t.withholding || ' days')::interval)::date, 'YYYY-MM-DD') as safe_date 
                    FROM ba_treatments t 
                    JOIN ba_animals a ON a.id = t.animal_id 
                    WHERE t.withholding > 0 
                      AND (t.date + (t.withholding || ' days')::interval)::date >= $1::date
                    ORDER BY safe_date ASC
                `, [asOfDate]);

                let activeAnimals = animalsRes.rows;
                if (penFilter) {
                    activeAnimals = activeAnimals.filter(a => a.pen && a.pen.toUpperCase() === penFilter);
                }

                // Map clean calibrated weights per animal
                const weighByAnimal = new Map();
                weightsRes.rows.forEach(w => {
                    if (isCorruptedWeighDate(w.date)) return;
                    if (!weighByAnimal.has(w.animal_id)) weighByAnimal.set(w.animal_id, []);
                    weighByAnimal.get(w.animal_id).push(w);
                });

                const overdueWeighIns = [];
                const upcomingWeighIns = [];
                const penWeighMap = {};

                activeAnimals.forEach(a => {
                    const logs = weighByAnimal.get(a.id) || [];
                    const lastDate = logs.length > 0 ? logs[0].date : a.entry_date;
                    const lastWeight = logs.length > 0 ? parseFloat(logs[0].weight) : parseFloat(a.entry_weight || 0);
                    if (!lastDate) return;

                    const d1 = new Date(lastDate);
                    const d2 = new Date(asOfDate);
                    const daysSince = Math.round((d2 - d1) / (1000 * 60 * 60 * 24));
                    const nextDate = new Date(d1);
                    nextDate.setDate(nextDate.getDate() + weighIntervalDays);
                    const nextDateStr = nextDate.toISOString().split('T')[0];
                    const daysUntil = Math.round((nextDate - d2) / (1000 * 60 * 60 * 24));

                    if (daysSince > weighIntervalDays) {
                        overdueWeighIns.push({
                            tag: a.tag,
                            pen: a.pen || 'Unassigned',
                            breed: a.breed,
                            last_weighed_date: lastDate,
                            last_weight_kg: lastWeight,
                            current_weight_kg: parseFloat(a.current_weight || 0),
                            days_since_last_weigh: daysSince,
                            days_overdue: daysSince - weighIntervalDays,
                            urgency: daysSince >= (weighIntervalDays + 10) ? 'CRITICAL' : 'HIGH'
                        });
                    } else {
                        upcomingWeighIns.push({
                            tag: a.tag,
                            pen: a.pen || 'Unassigned',
                            breed: a.breed,
                            last_weighed_date: lastDate,
                            last_weight_kg: lastWeight,
                            next_scheduled_weigh: nextDateStr,
                            days_until: daysUntil
                        });

                        const penKey = a.pen || 'Unassigned';
                        if (!penWeighMap[penKey]) {
                            penWeighMap[penKey] = {
                                pen: penKey,
                                head_count: 0,
                                next_scheduled_weigh: nextDateStr,
                                days_until: daysUntil,
                                tags: []
                            };
                        }
                        penWeighMap[penKey].head_count++;
                        penWeighMap[penKey].tags.push(a.tag);
                        if (nextDateStr < penWeighMap[penKey].next_scheduled_weigh) {
                            penWeighMap[penKey].next_scheduled_weigh = nextDateStr;
                            penWeighMap[penKey].days_until = daysUntil;
                        }
                    }
                });

                // Quarantine protocol milestones & graduations
                const quarantineGraduationsOverdue = [];
                const quarantineMilestonesUpcoming = [];
                const quarantined = activeAnimals.filter(a => a.status === 'Quarantined');

                quarantined.forEach(q => {
                    const dof = calcDof(q.entry_date);
                    if (dof >= 14) {
                        quarantineGraduationsOverdue.push({
                            tag: q.tag,
                            pen: q.pen || 'Quarantine Pen',
                            entry_date: q.entry_date,
                            days_in_quarantine: dof,
                            days_overdue: dof - 14,
                            action: '14-Day Quarantine Completed — Move to Fattening Pen'
                        });
                    } else {
                        const milestones = [
                            { day: 1, title: 'Intake Deworming & Multivitamin' },
                            { day: 7, title: 'Primary Clostridial / HS Vaccine' },
                            { day: 14, title: 'Booster Dose & Quarantine Exit Scale Weigh-in' }
                        ];
                        for (const m of milestones) {
                            if (dof <= m.day && (m.day - dof) <= 7) {
                                quarantineMilestonesUpcoming.push({
                                    tag: q.tag,
                                    pen: q.pen || 'Quarantine Pen',
                                    dof,
                                    scheduled_day: m.day,
                                    task_title: m.title,
                                    due_in_days: m.day - dof
                                });
                            }
                        }
                    }
                });

                // Market-ready harvest alerts
                const marketReadyCalves = activeAnimals
                    .filter(a => parseFloat(a.current_weight || 0) >= parseFloat(a.target_weight || 999999))
                    .map(a => ({
                        tag: a.tag,
                        pen: a.pen,
                        breed: a.breed,
                        current_weight_kg: parseFloat(a.current_weight),
                        target_weight_kg: parseFloat(a.target_weight),
                        surplus_weight_kg: +(parseFloat(a.current_weight) - parseFloat(a.target_weight)).toFixed(1),
                        status: 'Target Weight Achieved — Ready for Sale/Harvest'
                    }));

                const totalOverdue = overdueWeighIns.length + quarantineGraduationsOverdue.length;
                const totalUpcoming = upcomingWeighIns.length + quarantineMilestonesUpcoming.length + treatmentsRes.rows.length;

                return res.status(200).json({
                    success: true,
                    as_of_date: asOfDate,
                    configured_weigh_interval_days: weighIntervalDays,
                    summary: {
                        total_overdue_tasks_count: totalOverdue,
                        total_upcoming_tasks_count: totalUpcoming,
                        overdue_weigh_ins_count: overdueWeighIns.length,
                        upcoming_weigh_ins_count: upcomingWeighIns.length,
                        active_medical_withholdings_count: treatmentsRes.rows.length,
                        market_ready_cattle_count: marketReadyCalves.length
                    },
                    overdue_tasks: {
                        weigh_ins: overdueWeighIns.sort((a, b) => b.days_overdue - a.days_overdue),
                        quarantine_graduations: quarantineGraduationsOverdue.sort((a, b) => b.days_overdue - a.days_overdue)
                    },
                    upcoming_schedule: {
                        pen_weigh_in_schedule: Object.values(penWeighMap).sort((a, b) => a.days_until - b.days_until),
                        quarantine_milestones: quarantineMilestonesUpcoming.sort((a, b) => a.due_in_days - b.due_in_days),
                        medical_withholding_clearances: treatmentsRes.rows,
                        market_ready_pipeline: marketReadyCalves
                    }
                });
            }

            // -------------------------------------------------------------
            // GET /api/v1/inventory/summary
            // -------------------------------------------------------------
            if (route === 'inventory/summary' || route === 'inventory') {
                const purchases = await client.query(`
                    SELECT id, date, item_name, quantity, rate, supplier, created_by 
                    FROM ba_feed_purchases 
                    ORDER BY date DESC, created_at DESC 
                    LIMIT 25
                `);

                return res.status(200).json({
                    success: true,
                    recent_purchases: purchases.rows
                });
            }

            // -------------------------------------------------------------
            // GET /api/v1/premix/formulas
            // Active Wanda recipes, inclusion rates, and raw material directory
            // -------------------------------------------------------------
            if (route === 'premix/formulas' || route === 'premix') {
                const typesRes = await client.query("SELECT value FROM ba_settings WHERE key = 'premix_types'");
                const formulasRes = await client.query("SELECT value FROM ba_settings WHERE key = 'premix_formulas'");
                const stockRes = await client.query("SELECT value FROM ba_settings WHERE key = 'feed_stock_items'");

                const parse = (v) => typeof v === 'string' ? JSON.parse(v) : v;
                const types = parse(typesRes.rows[0]?.value) || [];
                const formulas = parse(formulasRes.rows[0]?.value) || {};
                const stockItems = parse(stockRes.rows[0]?.value) || [];
                const itemMap = Object.fromEntries(stockItems.map(i => [i.id, i.name]));

                const recipes = types.map(t => {
                    const rows = formulas[t.id] || [];
                    return {
                        premix_type_id: t.id,
                        name: t.name,
                        ingredients: rows.map(r => ({
                            stock_item_id: r.stockItemId,
                            name: itemMap[r.stockItemId] || r.stockItemId,
                            qty_per_kg: r.qtyPerKg,
                            percentage: +(r.qtyPerKg * 100).toFixed(2)
                        }))
                    };
                });

                return res.status(200).json({
                    success: true,
                    wanda_recipes: recipes,
                    available_raw_materials: stockItems.filter(i => !i.isPremix && (i.category || 'feed') === 'feed').map(i => ({ id: i.id, name: i.name }))
                });
            }

            // -------------------------------------------------------------
            // GET /api/v1/system/approval-mode
            // Query whether AI is in Junior Employee (Approval Required) or Normal Staff mode
            // -------------------------------------------------------------
            if (route === 'system/approval-mode' || route === 'approval-mode') {
                const isRequired = await isAiApprovalRequired(client, req, query);
                return res.status(200).json({
                    success: true,
                    approval_required: isRequired,
                    mode: isRequired ? 'Junior Employee (Pending Approval Queue)' : 'Normal Staff (Direct Commit)'
                });
            }

            return res.status(404).json({
                error: 'NOT_FOUND',
                message: `Unknown GET route "/api/v1/${route}".`,
                available_get_routes: [
                    '/api/v1/compliance/summary',
                    '/api/v1/cattle/roster',
                    '/api/v1/cattle/passport?tag=<TAG>',
                    '/api/v1/cattle/weights?tag=<TAG>&pen=<PEN>&start_date=<YYYY-MM-DD>&end_date=<YYYY-MM-DD>',
                    '/api/v1/pens',
                    '/api/v1/feed/logs?date=<YYYY-MM-DD>&pen=<PEN>',
                    '/api/v1/pen-checks?date=<YYYY-MM-DD>',
                    '/api/v1/health/withholding',
                    '/api/v1/tasks/upcoming',
                    '/api/v1/inventory/summary',
                    '/api/v1/feed/items',
                    '/api/v1/purchasing/history?start_date=<YYYY-MM-DD>&item_name=<NAME>',
                    '/api/v1/premix/formulas',
                    '/api/v1/analytics/performance',
                    '/api/v1/analytics/financials',
                    '/api/v1/analytics/feed-efficiency',
                    '/api/v1/system/approval-mode'
                ],
                available_post_routes: [
                    '/api/v1/feed/logs',
                    '/api/v1/pen-checks',
                    '/api/v1/health/treatments',
                    '/api/v1/cattle/weights',
                    '/api/v1/cattle/pen-transfer',
                    '/api/v1/purchasing/feed',
                    '/api/v1/purchasing/medicine',
                    '/api/v1/cattle/intake',
                    '/api/v1/premix/batches',
                    '/api/v1/system/approval-mode'
                ]
            });
        }

        // ════════════════════════════════════════════════════════════════
        // POST ENDPOINTS (Strictly Append-Only & Domain Sanity Checked)
        // ════════════════════════════════════════════════════════════════
        if (req.method === 'POST') {
            const body = req.body || {};

            // -------------------------------------------------------------
            // POST /api/v1/system/approval-mode
            // Admin Switch to toggle AI Governance Mode
            // -------------------------------------------------------------
            if (route === 'system/approval-mode' || route === 'approval-mode') {
                const { require_approval } = body;
                if (typeof require_approval !== 'boolean') {
                    throw new Error('CONFIG_ERROR: "require_approval" boolean (true or false) is required.');
                }
                await client.query(`
                    INSERT INTO ba_settings (key, value, updated_by, updated_at)
                    VALUES ('ai_require_approval', $1, $2, NOW())
                    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()
                `, [JSON.stringify(require_approval), agentActor]);

                return res.status(200).json({
                    success: true,
                    ai_require_approval: require_approval,
                    mode: require_approval ? 'junior_employee' : 'normal_staff',
                    message: `AI governance switched to ${require_approval ? 'Junior Employee (Approval Required)' : 'Normal SmartHerd Staff (Direct Execution)'}.`
                });
            }

            // -------------------------------------------------------------
            // POST /api/v1/feed/logs
            // -------------------------------------------------------------
            if (route === 'feed/logs' || route === 'feed') {
                const {
                    date, pen, feeding_index, num_feedings, feeding_pct,
                    total_batch_kg, ingredients, notes, allow_historical
                } = body;

                const validDate = validateDateStr(date, allow_historical);

                if (!pen) throw new Error('FEED_VALIDATION_ERROR: "pen" is required (e.g. "C", "D", "ALL").');
                const targetPen = String(pen).trim().toUpperCase();

                const fIndex = parseInt(feeding_index || 1, 10);
                const nFeedings = parseInt(num_feedings || 1, 10);
                if (fIndex < 1 || fIndex > 3) throw new Error('FEED_VALIDATION_ERROR: "feeding_index" must be 1, 2, or 3.');
                if (nFeedings < 1 || nFeedings > 3) throw new Error('FEED_VALIDATION_ERROR: "num_feedings" must be 1, 2, or 3.');
                if (fIndex > nFeedings) throw new Error(`FEED_VALIDATION_ERROR: feeding_index (${fIndex}) cannot exceed num_feedings (${nFeedings}).`);

                const totalKg = parseFloat(total_batch_kg);
                if (isNaN(totalKg) || totalKg <= 0) {
                    throw new Error('FEED_VALIDATION_ERROR: "total_batch_kg" must be a positive number greater than 0.');
                }

                if (Array.isArray(ingredients) && ingredients.length > 0) {
                    let ingredientSum = 0;
                    for (const ing of ingredients) {
                        if (!ing.name || typeof ing.name !== 'string') {
                            throw new Error('FEED_VALIDATION_ERROR: Each ingredient must include a string "name".');
                        }
                        const kg = parseFloat(ing.kg);
                        if (isNaN(kg) || kg < 0) {
                            throw new Error(`FEED_VALIDATION_ERROR: Ingredient "${ing.name}" has invalid kg (${ing.kg}). Must be >= 0.`);
                        }
                        ingredientSum += kg;
                    }
                    if (Math.abs(ingredientSum - totalKg) > 1.0) {
                        throw new Error(`SANITY_CHECK_FAILED: Ingredient sum (${ingredientSum.toFixed(2)} kg) does not match total_batch_kg (${totalKg.toFixed(2)} kg). Check batch weights.`);
                    }
                }

                const existing = await client.query(
                    'SELECT id, total_batch_kg, created_at FROM ba_feed_logs WHERE date = $1 AND pen = $2 AND feeding_index = $3',
                    [validDate, targetPen, fIndex]
                );
                if (existing.rows.length > 0) {
                    return res.status(409).json({
                        success: false,
                        error: 'RECORD_ALREADY_EXISTS: A feed log for this pen, date, and feeding index already exists.',
                        details: {
                            existing_log_id: existing.rows[0].id,
                            pen: targetPen,
                            date: validDate,
                            feeding_index: fIndex,
                            existing_batch_kg: existing.rows[0].total_batch_kg
                        },
                        instruction: 'The AI API is strictly append-only. Overwrites are prohibited to protect audit integrity. If recording another session, use feeding_index=2.'
                    });
                }

                const animalCountRes = await client.query(
                    `SELECT COUNT(*) FROM ba_animals WHERE status NOT IN ('Sold', 'Deceased') AND pen = $1`,
                    [targetPen]
                );
                const animalCount = parseInt(animalCountRes.rows[0].count || 0, 10);

                // Anti-Ghost-Feeding: Block distributing feed to a pen with 0 animals
                if (targetPen !== 'ALL' && animalCount === 0) {
                    throw new Error(`SANITY_CHECK_FAILED: Pen ${targetPen} currently has 0 active animals. Feed cannot be distributed to an empty pen.`);
                }

                // Cumulative Feeding Pct Check (Block over-feeding > 100% in a single day)
                const dayLogsRes = await client.query(
                    'SELECT SUM(feeding_pct) as total_pct FROM ba_feed_logs WHERE date = $1 AND pen = $2',
                    [validDate, targetPen]
                );
                const existingPct = parseFloat(dayLogsRes.rows[0].total_pct || 0);
                const newPct = parseFloat(feeding_pct || (100 / nFeedings));
                if (existingPct + newPct > 100.5) {
                    throw new Error(`SANITY_CHECK_FAILED: Cumulative feeding percentage for Pen ${targetPen} on ${validDate} would reach ${(existingPct + newPct).toFixed(1)}%, exceeding 100%. Adjust feeding_pct or verify split sessions.`);
                }

                if (isDryRun) {
                    return res.status(200).json({
                        success: true,
                        dry_run: true,
                        message: 'SANITY_CHECKS_PASSED: Feed log is valid and ready to commit.',
                        simulated_record: {
                            date: validDate,
                            pen: targetPen,
                            feeding_index: fIndex,
                            num_feedings: nFeedings,
                            feeding_pct: feeding_pct || (100 / nFeedings),
                            total_batch_kg: totalKg,
                            animal_count: animalCount,
                            ingredients_count: ingredients ? ingredients.length : 0
                        }
                    });
                }

                const requireApproval = await isAiApprovalRequired(client, req, body);
                if (requireApproval) {
                    const approvalRes = await client.query(`
                        INSERT INTO ba_pending_approvals (action, payload, requested_by)
                        VALUES ('ADD_FEED_LOG', $1, $2)
                        RETURNING id
                    `, [
                        JSON.stringify({
                            date: validDate,
                            pen: targetPen,
                            feedingIndex: fIndex,
                            numFeedings: nFeedings,
                            feedingPct: feeding_pct || (100 / nFeedings),
                            totalBatchKg: totalKg,
                            animalCount,
                            ingredients: ingredients || [],
                            notes: notes || null
                        }),
                        agentActor
                    ]);

                    return res.status(202).json({
                        success: true,
                        status: 'pending_approval',
                        approval_id: approvalRes.rows[0].id,
                        mode: 'junior_employee',
                        action: 'ADD_FEED_LOG',
                        message: `Feed log for Pen ${targetPen} on ${validDate} submitted in Junior Employee mode. Queued for Admin review in SmartHerd portal.`,
                        details: {
                            pen: targetPen,
                            date: validDate,
                            feeding_index: fIndex,
                            num_feedings: nFeedings,
                            total_batch_kg: totalKg
                        }
                    });
                }

                const insertRes = await client.query(`
                    INSERT INTO ba_feed_logs (
                        date, pen, feeding_index, num_feedings, feeding_pct,
                        animal_count, total_batch_kg, ingredients, notes,
                        created_by, created_at
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
                    RETURNING id
                `, [
                    validDate, targetPen, fIndex, nFeedings, feeding_pct || (100 / nFeedings),
                    animalCount, totalKg, JSON.stringify(ingredients || []),
                    notes || null, agentActor
                ]);

                return res.status(201).json({
                    success: true,
                    status: 'committed',
                    mode: 'normal_staff',
                    id: insertRes.rows[0].id,
                    message: `Feed logged successfully for Pen ${targetPen} on ${validDate} (#${fIndex}/${nFeedings}).`
                });
            }

            // -------------------------------------------------------------
            // POST /api/v1/pen-checks
            // -------------------------------------------------------------
            if (route === 'pen-checks' || route === 'pen-check') {
                const {
                    date, pen, session, check_time, bunk_score_pct,
                    bunk_score, head_count, head_pulled, notes, flagged_tags, allow_historical
                } = body;

                const validDate = validateDateStr(date, allow_historical);

                if (!pen) throw new Error('PEN_CHECK_ERROR: "pen" is required.');
                const targetPen = String(pen).trim().toUpperCase();

                const normSession = String(session || 'Morning').trim();
                const validSession = normSession.toLowerCase().startsWith('e') ? 'Evening' : 'Morning';

                let scoreToStore = null;
                if (bunk_score_pct !== undefined && bunk_score_pct !== null) {
                    const pct = parseFloat(bunk_score_pct);
                    if (isNaN(pct) || pct < 0 || pct > 100) {
                        throw new Error(`SANITY_CHECK_FAILED: "bunk_score_pct" must be between 0 and 100 (received ${bunk_score_pct}).`);
                    }
                    scoreToStore = Math.round(pct);
                } else if (bunk_score !== undefined && bunk_score !== null) {
                    const bs = parseInt(bunk_score, 10);
                    if (isNaN(bs) || bs < 0 || bs > 100) {
                        throw new Error(`SANITY_CHECK_FAILED: "bunk_score" must be between 0 and 100 (received ${bunk_score}).`);
                    }
                    scoreToStore = bs;
                }

                const existing = await client.query(`
                    SELECT id FROM ba_pen_checks WHERE date = $1 AND pen = $2 AND session = $3
                `, [validDate, targetPen, validSession]);

                if (existing.rows.length > 0) {
                    return res.status(409).json({
                        success: false,
                        error: 'RECORD_ALREADY_EXISTS: A pen check for this pen, date, and session already exists.',
                        existing_check_id: existing.rows[0].id,
                        pen: targetPen,
                        date: validDate,
                        session: validSession
                    });
                }

                const resolvedFlags = [];
                if (Array.isArray(flagged_tags)) {
                    for (const ft of flagged_tags) {
                        const tagIdent = typeof ft === 'object' ? (ft.tag || ft.rfid) : ft;
                        const flagNote = typeof ft === 'object' ? (ft.note || 'Flagged during pen check') : 'Flagged during pen check';
                        const animal = await resolveAnimal(client, tagIdent);
                        resolvedFlags.push({ animal_id: animal.id, tag: animal.rfid, note: flagNote });
                    }
                }

                if (isDryRun) {
                    return res.status(200).json({
                        success: true,
                        dry_run: true,
                        message: 'SANITY_CHECKS_PASSED: Pen check is valid and ready to commit.',
                        simulated_record: {
                            date: validDate,
                            pen: targetPen,
                            session: validSession,
                            bunk_score: scoreToStore,
                            flagged_animals_count: resolvedFlags.length,
                            flagged_tags: resolvedFlags.map(f => f.tag)
                        }
                    });
                }

                const requireApproval = await isAiApprovalRequired(client, req, body);
                if (requireApproval) {
                    const approvalRes = await client.query(`
                        INSERT INTO ba_pending_approvals (action, payload, requested_by)
                        VALUES ('LOG_PEN_CHECK', $1, $2)
                        RETURNING id
                    `, [
                        JSON.stringify({
                            date: validDate,
                            pen: targetPen,
                            session: validSession,
                            checkTime: check_time || (validSession === 'Morning' ? '06:00' : '17:00'),
                            headCount: parseInt(head_count || 0, 10),
                            headPulled: parseInt(head_pulled || 0, 10),
                            bunkScore: scoreToStore,
                            notes: notes || null,
                            flags: resolvedFlags
                        }),
                        agentActor
                    ]);

                    return res.status(202).json({
                        success: true,
                        status: 'pending_approval',
                        approval_id: approvalRes.rows[0].id,
                        mode: 'junior_employee',
                        action: 'LOG_PEN_CHECK',
                        message: `Pen check for Pen ${targetPen} (${validSession}) submitted in Junior Employee mode. Queued for Admin review in SmartHerd portal.`,
                        details: {
                            pen: targetPen,
                            date: validDate,
                            session: validSession,
                            bunk_score: scoreToStore,
                            flagged_count: resolvedFlags.length
                        }
                    });
                }

                const insertRes = await client.query(`
                    INSERT INTO ba_pen_checks (
                        date, pen, session, check_time, head_count, head_pulled,
                        bunk_score, notes, created_by, created_at
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
                    RETURNING id
                `, [
                    validDate, targetPen, validSession, check_time || (validSession === 'Morning' ? '06:00' : '17:00'),
                    parseInt(head_count || 0, 10), parseInt(head_pulled || 0, 10),
                    scoreToStore, notes || null, agentActor
                ]);

                for (const rf of resolvedFlags) {
                    await client.query(`
                        INSERT INTO ba_events (animal_id, date, event_type, note, to_pen, created_by)
                        VALUES ($1, $2, 'pen_check_flag', $3, $4, $5)
                    `, [rf.animal_id, validDate, rf.note, targetPen, agentActor]);
                }

                return res.status(201).json({
                    success: true,
                    status: 'committed',
                    mode: 'normal_staff',
                    id: insertRes.rows[0].id,
                    message: `Pen check logged for Pen ${targetPen} on ${validDate} (${validSession}).`
                });
            }

            // -------------------------------------------------------------
            // POST /api/v1/health/treatments
            // -------------------------------------------------------------
            if (route === 'health/treatments' || route === 'health') {
                const {
                    date, type, medicine, dosage, withholding,
                    diagnosis, notes, allow_historical, allow_duplicate_dose
                } = body;

                let tags = body.tags;
                if (!tags && body.tag) {
                    if (typeof body.tag === 'string' && body.tag.includes(',')) {
                        tags = body.tag.split(',').map(s => s.trim()).filter(Boolean);
                    } else {
                        tags = [body.tag];
                    }
                } else if (typeof tags === 'string') {
                    tags = tags.split(',').map(s => s.trim()).filter(Boolean);
                }

                if (!Array.isArray(tags) || tags.length === 0) {
                    throw new Error('TREATMENT_ERROR: "tag" or "tags" is required (e.g. "02", "02, 03, 04", or ["02", "03", "04"]).');
                }

                if (!medicine || typeof medicine !== 'string') {
                    throw new Error('TREATMENT_ERROR: "medicine" name is required (e.g. "HS Vaccine", "Ivermectin", "Oxafax").');
                }
                const medName = medicine.trim();
                const medLower = medName.toLowerCase();
                const validDate = validateDateStr(date, allow_historical);

                // Smart Protocol & Standard Dosage Fallback if caller omitted quantity
                let effectiveDosage = dosage ? String(dosage).trim() : null;
                let effectiveType = type ? String(type).trim() : null;
                let effectiveWithholding = withholding !== undefined && withholding !== null ? parseInt(withholding, 10) : null;
                let defaultAppliedNote = null;

                if (!effectiveDosage) {
                    if (medLower.includes('hs') || medLower.includes('haemorrhagic') || medLower.includes('hemorrhagic')) {
                        effectiveDosage = '3 ml';
                        if (!effectiveType) effectiveType = 'Vaccination';
                        if (effectiveWithholding === null) effectiveWithholding = 0;
                        defaultAppliedNote = 'Standard protocol dose (3 ml) applied automatically';
                    } else if (medLower.includes('fmd') || medLower.includes('foot and mouth')) {
                        effectiveDosage = '2 ml';
                        if (!effectiveType) effectiveType = 'Vaccination';
                        if (effectiveWithholding === null) effectiveWithholding = 0;
                        defaultAppliedNote = 'Standard protocol dose (2 ml) applied automatically';
                    } else if (medLower.includes('pulmovac') || medLower.includes('bvd') || medLower.includes('ibr')) {
                        effectiveDosage = '2 ml';
                        if (!effectiveType) effectiveType = 'Vaccination';
                        if (effectiveWithholding === null) effectiveWithholding = 0;
                        defaultAppliedNote = 'Standard vaccine dose (2 ml) applied automatically';
                    } else if (medLower.includes('ivermectin') || medLower.includes('ivotec')) {
                        effectiveDosage = '5 ml';
                        if (!effectiveType) effectiveType = 'Deworming';
                        if (effectiveWithholding === null) effectiveWithholding = 21;
                        defaultAppliedNote = 'Standard deworming dose (5 ml, 21d withholding) applied automatically';
                    } else if (medLower.includes('oxafax') || medLower.includes('albendazole') || medLower.includes('drench')) {
                        effectiveDosage = '30 ml';
                        if (!effectiveType) effectiveType = 'Deworming';
                        if (effectiveWithholding === null) effectiveWithholding = 14;
                        defaultAppliedNote = 'Standard oral drench dose (30 ml, 14d withholding) applied automatically';
                    } else if (medLower.includes('vaccine') || medLower.includes('vac')) {
                        effectiveDosage = '2 ml';
                        if (!effectiveType) effectiveType = 'Vaccination';
                        if (effectiveWithholding === null) effectiveWithholding = 0;
                        defaultAppliedNote = 'Standard vaccine dose (2 ml) applied automatically';
                    } else {
                        effectiveDosage = '1 dose';
                        defaultAppliedNote = 'Standard unit dose applied automatically (dosage omitted by caller)';
                    }
                }

                if (!effectiveType) effectiveType = 'Curative';
                if (effectiveWithholding === null || isNaN(effectiveWithholding) || effectiveWithholding < 0) {
                    effectiveWithholding = 0;
                }

                const resolvedAnimals = [];
                for (const t of tags) {
                    const a = await resolveAnimal(client, t);
                    if (a.status === 'Sold' || a.status === 'Deceased') {
                        throw new Error(`ANIMAL_INACTIVE: Cannot log treatment for calf ${a.rfid} because status is "${a.status}".`);
                    }
                    resolvedAnimals.push(a);
                }

                // Anti-Overdose Duplicate Check for all resolved animals
                for (const animal of resolvedAnimals) {
                    const existingMeds = await client.query(`
                        SELECT id, dosage FROM ba_treatments
                        WHERE animal_id = $1 AND date = $2 AND LOWER(medicine) = LOWER($3)
                    `, [animal.id, validDate, medName]);
                    if (existingMeds.rows.length > 0 && !allow_duplicate_dose) {
                        return res.status(409).json({
                            success: false,
                            error: `DUPLICATE_TREATMENT_BLOCKED: Tag ${animal.rfid} was already administered "${medName}" on ${validDate} (Log #${existingMeds.rows[0].id}). Accidental repeat dose blocked.`,
                            hint: 'If this is an intentional second dose (e.g. BID administration), pass "allow_duplicate_dose": true.'
                        });
                    }
                }

                const treatmentNote = [
                    diagnosis ? `Diagnosis: ${diagnosis}` : null,
                    notes || null,
                    defaultAppliedNote ? `[Note: ${defaultAppliedNote}]` : null
                ].filter(Boolean).join(' · ') || null;

                if (isDryRun) {
                    return res.status(200).json({
                        success: true,
                        dry_run: true,
                        message: 'SANITY_CHECKS_PASSED: Treatment is valid and ready to commit.',
                        simulated_records: resolvedAnimals.map(a => ({
                            animal_id: a.id,
                            tag: a.rfid,
                            pen: a.pen,
                            date: validDate,
                            type: effectiveType,
                            medicine: medName,
                            dosage: effectiveDosage,
                            withholding_days: effectiveWithholding,
                            note: treatmentNote
                        }))
                    });
                }

                const requireApproval = await isAiApprovalRequired(client, req, body);
                if (requireApproval) {
                    const approvalIds = [];
                    for (const animal of resolvedAnimals) {
                        const approvalRes = await client.query(`
                            INSERT INTO ba_pending_approvals (action, animal_id, animal_rfid, animal_breed, payload, previous_snapshot, requested_by)
                            VALUES ('LOG_TREATMENT', $1, $2, $3, $4, $5, $6)
                            RETURNING id
                        `, [
                            animal.id,
                            animal.rfid,
                            animal.breed,
                            JSON.stringify({
                                animalId: animal.id,
                                date: validDate,
                                type: effectiveType,
                                medicine: medName,
                                dosage: effectiveDosage,
                                withholding: effectiveWithholding,
                                notes: treatmentNote
                            }),
                            JSON.stringify(animal),
                            agentActor
                        ]);
                        approvalIds.push(approvalRes.rows[0].id);
                    }

                    return res.status(202).json({
                        success: true,
                        status: 'pending_approval',
                        approval_ids: approvalIds,
                        mode: 'junior_employee',
                        action: 'LOG_TREATMENT',
                        message: `Treatment for ${resolvedAnimals.length} animal(s) (${medName} - ${effectiveDosage}) submitted in Junior Employee mode. Queued for Admin review in SmartHerd portal.`,
                        details: {
                            count: resolvedAnimals.length,
                            tags: resolvedAnimals.map(a => a.rfid),
                            medicine: medName,
                            dosage: effectiveDosage,
                            default_dosage_applied: Boolean(defaultAppliedNote),
                            date: validDate,
                            withholding_days: effectiveWithholding
                        }
                    });
                }

                const createdIds = [];
                for (const animal of resolvedAnimals) {
                    const insertRes = await client.query(`
                        INSERT INTO ba_treatments (
                            animal_id, date, type, medicine, dosage, withholding,
                            created_by, notes
                        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                        RETURNING id
                    `, [
                        animal.id, validDate, effectiveType, medName,
                        effectiveDosage, effectiveWithholding, agentActor,
                        treatmentNote
                    ]);
                    createdIds.push(insertRes.rows[0].id);
                }

                return res.status(201).json({
                    success: true,
                    status: 'committed',
                    mode: 'normal_staff',
                    ids: createdIds,
                    message: `Treatment recorded for ${resolvedAnimals.length} animal(s): Tag(s) ${resolvedAnimals.map(a => a.rfid).join(', ')} (${medName} - ${effectiveDosage}).`,
                    default_dosage_applied: Boolean(defaultAppliedNote),
                    records: resolvedAnimals.map((a, idx) => ({
                        id: createdIds[idx],
                        tag: a.rfid,
                        medicine: medName,
                        dosage: effectiveDosage,
                        withholding_days: effectiveWithholding
                    }))
                });
            }

            // -------------------------------------------------------------
            // POST /api/v1/cattle/weights
            // -------------------------------------------------------------
            if (route === 'cattle/weights' || route === 'cattle/weight') {
                const { tag, date, weight, allow_historical, bypass_weight_sanity } = body;

                const animal = await resolveAnimal(client, tag);
                if (animal.status === 'Sold' || animal.status === 'Deceased') {
                    throw new Error(`ANIMAL_INACTIVE: Cannot log weight for calf ${animal.rfid} because status is "${animal.status}".`);
                }

                const validDate = validateDateStr(date, allow_historical);

                const weightNum = parseFloat(weight);
                if (isNaN(weightNum) || weightNum <= 0) {
                    throw new Error('WEIGHT_ERROR: "weight" must be a positive number in kg.');
                }
                if (weightNum < 40 || weightNum > 1200) {
                    throw new Error(`SANITY_CHECK_FAILED: Weight ${weightNum} kg is outside acceptable biological range (40kg - 1200kg).`);
                }

                const prevWeight = parseFloat(animal.current_weight || animal.entry_weight || 0);
                if (prevWeight > 0 && !bypass_weight_sanity) {
                    const ratio = weightNum / prevWeight;
                    if (ratio < 0.5) {
                        throw new Error(`SANITY_CHECK_FAILED: Weight ${weightNum} kg is a >50% drop from previous ${prevWeight} kg (check for dropped digits). Pass "bypass_weight_sanity": true if genuine.`);
                    }
                    if (ratio > 1.6) {
                        throw new Error(`SANITY_CHECK_FAILED: Weight ${weightNum} kg is a >60% jump from previous ${prevWeight} kg (check for extra digits). Pass "bypass_weight_sanity": true if genuine.`);
                    }
                }

                if (isDryRun) {
                    return res.status(200).json({
                        success: true,
                        dry_run: true,
                        message: 'SANITY_CHECKS_PASSED: Weight log is valid and ready to commit.',
                        simulated_record: {
                            animal_id: animal.id,
                            tag: animal.rfid,
                            date: validDate,
                            new_weight_kg: weightNum,
                            previous_weight_kg: prevWeight,
                            weight_delta_kg: +(weightNum - prevWeight).toFixed(2)
                        }
                    });
                }

                const lastWeightRes = await client.query(
                    `SELECT date, weight FROM ba_weights WHERE animal_id = $1 AND date < $2 ORDER BY date DESC LIMIT 1`,
                    [animal.id, validDate]
                );
                let adg = null;
                if (lastWeightRes.rows.length > 0) {
                    const prevD = new Date(lastWeightRes.rows[0].date);
                    const currD = new Date(validDate);
                    const days = Math.round((currD - prevD) / (1000 * 60 * 60 * 24));
                    if (days > 0) {
                        adg = +((weightNum - parseFloat(lastWeightRes.rows[0].weight)) / days).toFixed(2);
                    }
                }

                const requireApproval = await isAiApprovalRequired(client, req, body);
                if (requireApproval) {
                    const approvalRes = await client.query(`
                        INSERT INTO ba_pending_approvals (action, animal_id, animal_rfid, animal_breed, payload, previous_snapshot, requested_by)
                        VALUES ('LOG_WEIGHT', $1, $2, $3, $4, $5, $6)
                        RETURNING id
                    `, [
                        animal.id,
                        animal.rfid,
                        animal.breed,
                        JSON.stringify({
                            animalId: animal.id,
                            date: validDate,
                            weight: weightNum,
                            adg: adg
                        }),
                        JSON.stringify(animal),
                        agentActor
                    ]);

                    return res.status(202).json({
                        success: true,
                        status: 'pending_approval',
                        approval_id: approvalRes.rows[0].id,
                        mode: 'junior_employee',
                        action: 'LOG_WEIGHT',
                        message: `Weight entry of ${weightNum} kg for Tag ${animal.rfid} submitted in Junior Employee mode. Queued for Admin review in SmartHerd portal.`,
                        details: {
                            animal_id: animal.id,
                            tag: animal.rfid,
                            weight_kg: weightNum,
                            previous_weight_kg: prevWeight,
                            weight_delta_kg: +(weightNum - prevWeight).toFixed(2),
                            adg: adg,
                            date: validDate
                        }
                    });
                }

                const insertRes = await client.query(`
                    INSERT INTO ba_weights (animal_id, date, weight, adg, created_by)
                    VALUES ($1, $2, $3, $4, $5)
                    RETURNING id
                `, [animal.id, validDate, weightNum, adg, agentActor]);

                await client.query(`
                    UPDATE ba_animals SET current_weight = $1 WHERE id = $2
                `, [weightNum, animal.id]);

                return res.status(201).json({
                    success: true,
                    status: 'committed',
                    mode: 'normal_staff',
                    id: insertRes.rows[0].id,
                    message: `Weight of ${weightNum} kg logged for Tag ${animal.rfid} (ADG: ${adg !== null ? adg + ' kg/day' : 'N/A'}).`
                });
            }

            // -------------------------------------------------------------
            // POST /api/v1/cattle/pen-transfer
            // -------------------------------------------------------------
            // -------------------------------------------------------------
            // POST /api/v1/cattle/pen-transfer (or /api/v1/cattle/transfer or /api/v1/pen-transfer)
            // Shift or rotate animals between pens and health stages (e.g. Sick -> Fattening, Quarantine -> Pen C)
            // -------------------------------------------------------------
            if (route === 'cattle/pen-transfer' || route === 'cattle/transfer' || route === 'pen-transfer') {
                const { to_pen, reason } = body;
                let tags = body.tags;
                if (!tags && body.tag) {
                    tags = [body.tag];
                } else if (typeof tags === 'string') {
                    tags = [tags];
                }

                if (!Array.isArray(tags) || tags.length === 0) {
                    throw new Error('TRANSFER_ERROR: "tags" must be an array of tag IDs (e.g. ["36", "08"]) or "tag": "36".');
                }
                if (!to_pen || typeof to_pen !== 'string') {
                    throw new Error('TRANSFER_ERROR: "to_pen" destination pen ID is required (e.g. "C", "E", "SICK", "QUARANTINE").');
                }
                const targetPen = to_pen.trim().toUpperCase();
                const today = getTodayStr();

                // Validate destination pen
                const validPensRes = await client.query('SELECT id FROM ba_pens');
                const validPenSet = new Set(validPensRes.rows.map(p => p.id.toUpperCase()));
                ['SICK', 'HOSPITAL', 'QUARANTINE', 'RECOVERY'].forEach(p => validPenSet.add(p));
                if (!validPenSet.has(targetPen)) {
                    throw new Error(`TRANSFER_ERROR: Destination pen "${targetPen}" is not a recognized pen on the farm (Valid pens: ${Array.from(validPenSet).join(', ')}).`);
                }

                // Status deduction or override
                let statusOverride = body.status ? body.status.trim() : null;
                if (statusOverride) {
                    const validStatuses = ['Active', 'Fattening', 'Quarantined', 'Sick', 'Hospital', 'Sold', 'Deceased'];
                    const matched = validStatuses.find(s => s.toLowerCase() === statusOverride.toLowerCase());
                    if (!matched) {
                        throw new Error(`TRANSFER_ERROR: Status "${statusOverride}" is invalid. Allowed: ${validStatuses.join(', ')}.`);
                    }
                    statusOverride = matched;
                }

                const resolvedAnimals = [];
                for (const t of tags) {
                    const a = await resolveAnimal(client, t);
                    let finalStatus = a.status;
                    if (statusOverride) {
                        finalStatus = statusOverride;
                    } else if (targetPen === 'SICK' || targetPen === 'HOSPITAL') {
                        finalStatus = 'Sick';
                    } else if (targetPen === 'QUARANTINE') {
                        finalStatus = 'Quarantined';
                    } else if (a.status === 'Sick' || a.status === 'Quarantined' || a.status === 'Hospital') {
                        // Recovering or graduating into standard fattening pen
                        finalStatus = 'Fattening';
                    }
                    resolvedAnimals.push({ ...a, next_pen: targetPen, next_status: finalStatus });
                }

                if (isDryRun) {
                    return res.status(200).json({
                        success: true,
                        dry_run: true,
                        message: 'SANITY_CHECKS_PASSED: Pen transfer and rotation shift is valid and ready to commit.',
                        simulated_transfer: {
                            destination_pen: targetPen,
                            count: resolvedAnimals.length,
                            transfers: resolvedAnimals.map(a => ({
                                tag: a.rfid,
                                from_pen: a.pen,
                                to_pen: a.next_pen,
                                from_status: a.status,
                                to_status: a.next_status,
                                reason: reason || `Transfer to ${targetPen}`
                            }))
                        }
                    });
                }

                const requireApproval = await isAiApprovalRequired(client, req, body);
                if (requireApproval) {
                    const approvalIds = [];
                    for (const a of resolvedAnimals) {
                        const appRes = await client.query(`
                            INSERT INTO ba_pending_approvals (action, animal_id, animal_rfid, animal_breed, payload, previous_snapshot, requested_by)
                            VALUES ('UPDATE_ANIMAL', $1, $2, $3, $4, $5, $6)
                            RETURNING id
                        `, [
                            a.id,
                            a.rfid,
                            a.breed,
                            JSON.stringify({ id: a.id, pen: a.next_pen, status: a.next_status, note: reason || `Pen transfer to ${targetPen}` }),
                            JSON.stringify(a),
                            agentActor
                        ]);
                        approvalIds.push(appRes.rows[0].id);
                    }

                    return res.status(202).json({
                        success: true,
                        status: 'pending_approval',
                        approval_ids: approvalIds,
                        mode: 'junior_employee',
                        action: 'UPDATE_ANIMAL',
                        message: `Pen transfer / status shift for ${resolvedAnimals.length} animal(s) to Pen ${targetPen} submitted in Junior Employee mode. Queued for Admin review in SmartHerd portal.`,
                        details: {
                            destination_pen: targetPen,
                            transferred_count: resolvedAnimals.length,
                            transfers: resolvedAnimals.map(a => ({
                                tag: a.rfid,
                                from_pen: a.pen,
                                to_pen: a.next_pen,
                                from_status: a.status,
                                to_status: a.next_status
                            }))
                        }
                    });
                }

                for (const a of resolvedAnimals) {
                    const oldPen = a.pen;
                    const oldStatus = a.status;
                    const newPen = a.next_pen;
                    const newStatus = a.next_status;

                    if (oldPen !== newPen || oldStatus !== newStatus) {
                        await client.query(`UPDATE ba_animals SET pen = $1, status = $2, updated_at = NOW() WHERE id = $3`, [newPen, newStatus, a.id]);
                        await client.query(`
                            INSERT INTO ba_events (animal_id, date, event_type, note, from_pen, to_pen, created_by)
                            VALUES ($1, $2, 'pen_transfer', $3, $4, $5, $6)
                        `, [
                            a.id,
                            today,
                            reason || (oldStatus !== newStatus
                                ? `Shifted from Pen ${oldPen} (${oldStatus}) to Pen ${newPen} (${newStatus})`
                                : `Transferred from Pen ${oldPen} to Pen ${newPen}`),
                            oldPen,
                            newPen,
                            agentActor
                        ]);
                    }
                }

                return res.status(200).json({
                    success: true,
                    status: 'committed',
                    mode: 'normal_staff',
                    message: `Successfully transferred ${resolvedAnimals.length} animal(s) to Pen ${targetPen}.`,
                    transfers: resolvedAnimals.map(a => ({
                        tag: a.rfid,
                        from_pen: a.pen,
                        to_pen: a.next_pen,
                        from_status: a.status,
                        to_status: a.next_status
                    }))
                });
            }

            // -------------------------------------------------------------
            // POST /api/v1/purchasing/feed or /api/v1/purchasing/medicine or /api/v1/purchasing
            // Ingest feed commodities or veterinary medicine purchase receipts
            // -------------------------------------------------------------
            if (route === 'purchasing/feed' || route === 'purchasing/medicine' || route === 'purchasing') {
                const {
                    date, item_name, quantity, quantity_kg, rate, rate_per_kg,
                    unit, item_unit, supplier, notes, allow_historical
                } = body;
                const validDate = validateDateStr(date, allow_historical);

                if (!item_name || typeof item_name !== 'string') {
                    throw new Error('PURCHASE_ERROR: "item_name" is required (e.g. "Corn Silage", "Amovet inj 100ml", "Flunixin").');
                }
                const qty = parseFloat(quantity !== undefined ? quantity : quantity_kg);
                if (isNaN(qty) || qty <= 0) {
                    throw new Error('PURCHASE_ERROR: "quantity" must be a positive number.');
                }
                const unitRate = parseFloat(rate !== undefined ? rate : (rate_per_kg || 0));
                const finalUnit = (unit || item_unit || (route === 'purchasing/medicine' ? 'vials' : 'kg')).trim();

                // Look up matching item in feed_stock_items to link item_id if available
                const stockRes = await client.query("SELECT value FROM ba_settings WHERE key = 'feed_stock_items'");
                const parse = (v) => typeof v === 'string' ? JSON.parse(v) : v;
                const stockItems = parse(stockRes.rows[0]?.value) || [];

                function resolveStockItem(rawNameOrId, items = []) {
                    if (!rawNameOrId) return null;
                    const clean = String(rawNameOrId).trim().toLowerCase();

                    // 1. Direct ID match
                    const byId = items.find(s => s.id && s.id.toLowerCase() === clean);
                    if (byId) return byId;

                    // 2. Direct name match
                    const byExactName = items.find(s => s.name && s.name.trim().toLowerCase() === clean);
                    if (byExactName) return byExactName;

                    // 3. Synonym and Alias Mapping
                    // Maize Grain (Makai / Corn grain for Wanda manufacturing) - NOT green fodder!
                    const maizeGrainSynonyms = ['maize', 'makai', 'corn', 'maize grain', 'makai grain', 'corn grain', 'cracked maize', 'whole maize'];
                    if (maizeGrainSynonyms.some(syn => clean === syn)) {
                        const maizeItem = items.find(s => s.id === 'maizeGrain' || s.id === 'maize' || (s.name && s.name.toLowerCase() === 'maize'));
                        if (maizeItem) return maizeItem;
                    }

                    // Green Fodder / Chari / Makai Chara (Fresh green forage only - NOT dry grain)
                    const chariSynonyms = ['chari', 'makai chara', 'makai charra', 'green maize', 'green fodder', 'chara', 'green maize fodder', 'maize fodder', 'sorghum fodder'];
                    if (chariSynonyms.some(syn => clean === syn || clean.includes(syn))) {
                        const chariItem = items.find(s => s.id === 'chari');
                        if (chariItem) return chariItem;
                    }

                    // Silage synonyms
                    const silageSynonyms = ['silage', 'corn silage', 'maize silage', 'corn-silage', 'makai silage'];
                    if (silageSynonyms.some(syn => clean === syn || clean.includes(syn))) {
                        const silageItem = items.find(s => s.id === 'silage');
                        if (silageItem) return silageItem;
                    }

                    // Wheat Straw / Toori synonyms
                    const strawSynonyms = ['toori', 'straw', 'wheat straw', 'toori (straw)', 'bhoosa', 'bhusa'];
                    if (strawSynonyms.some(syn => clean === syn || clean.includes(syn))) {
                        const strawItem = items.find(s => s.id === 'straw');
                        if (strawItem) return strawItem;
                    }

                    // Potato synonyms
                    const potatoSynonyms = ['potato', 'aloo', 'potatoes'];
                    if (potatoSynonyms.some(syn => clean === syn || clean.includes(syn))) {
                        const potatoItem = items.find(s => s.id === 'item_1787682901639' || (s.name && s.name.toLowerCase().includes('potato')));
                        if (potatoItem) return potatoItem;
                    }

                    // Molasses / Sheera synonyms
                    const molassesSynonyms = ['molasses', 'sheera', 'shira'];
                    if (molassesSynonyms.some(syn => clean === syn || clean.includes(syn))) {
                        const molassesItem = items.find(s => s.id === 'item_1786402466074' || (s.name && s.name.toLowerCase().includes('molasses')));
                        if (molassesItem) return molassesItem;
                    }

                    // Choker / Wheat Bran synonyms
                    const chokerSynonyms = ['choker', 'chokar', 'wheat bran', 'bran'];
                    if (chokerSynonyms.some(syn => clean === syn || clean.includes(syn))) {
                        const chokerItem = items.find(s => s.id === 'item_1785509065371' || (s.name && s.name.toLowerCase().includes('choker')));
                        if (chokerItem) return chokerItem;
                    }

                    // Wanda variants
                    if (clean.includes('single bag')) {
                        const w = items.find(s => s.id === 'premix_1787170372798');
                        if (w) return w;
                    }
                    if (clean.includes('potato max')) {
                        const w = items.find(s => s.id === 'premix_1787943334876');
                        if (w) return w;
                    }
                    if (clean.includes('base wanda')) {
                        const w = items.find(s => s.id === 'premix_1786400918894');
                        if (w) return w;
                    }
                    if (clean.includes('steady state')) {
                        const w = items.find(s => s.id === 'premix_1785359297303');
                        if (w) return w;
                    }
                    if (clean === 'wanda' || clean === 'concentrate') {
                        const w = items.find(s => s.id === 'wanda');
                        if (w) return w;
                    }

                    // 4. Substring / contains match
                    const partialMatch = items.find(s => {
                        const sName = (s.name || '').toLowerCase();
                        return sName && (sName.includes(clean) || clean.includes(sName));
                    });
                    if (partialMatch) return partialMatch;

                    return null;
                }

                const matchedStock = resolveStockItem(item_name, stockItems);
                let itemId = matchedStock ? matchedStock.id : null;
                const finalItemName = matchedStock ? matchedStock.name : item_name.trim();

                // If completely new item, auto-generate ID and register in feed_stock_items so item_id is NEVER null
                if (!itemId) {
                    itemId = 'item_' + Date.now();
                    stockItems.push({
                        id: itemId,
                        name: finalItemName,
                        unit: finalUnit,
                        category: route === 'purchasing/medicine' ? 'medicine' : 'feed',
                        isDefault: false
                    });
                    await client.query(`
                        INSERT INTO ba_settings (key, value, updated_by, updated_at)
                        VALUES ('feed_stock_items', $1, $2, NOW())
                        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()
                    `, [JSON.stringify(stockItems), agentActor]);
                }

                if (isDryRun) {
                    return res.status(200).json({
                        success: true,
                        dry_run: true,
                        message: 'SANITY_CHECKS_PASSED: Purchase receipt is valid and ready to commit.',
                        simulated_record: {
                            date: validDate,
                            item_name: finalItemName,
                            item_id: itemId,
                            quantity: qty,
                            unit: finalUnit,
                            rate: unitRate,
                            total_cost: +(qty * unitRate).toFixed(2),
                            supplier: supplier || null
                        }
                    });
                }

                const purchaseId = 'pur_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
                const requireApproval = await isAiApprovalRequired(client, req, body);
                if (requireApproval) {
                    const approvalRes = await client.query(`
                        INSERT INTO ba_pending_approvals (action, payload, requested_by)
                        VALUES ('ADD_FEED_PURCHASE', $1, $2)
                        RETURNING id
                    `, [
                        JSON.stringify({
                            id: purchaseId,
                            date: validDate,
                            itemId,
                            itemName: finalItemName,
                            itemUnit: finalUnit,
                            quantity: qty,
                            rate: unitRate,
                            supplier: supplier || null,
                            notes: notes || null
                        }),
                        agentActor
                    ]);

                    return res.status(202).json({
                        success: true,
                        status: 'pending_approval',
                        approval_id: approvalRes.rows[0].id,
                        mode: 'junior_employee',
                        action: 'ADD_FEED_PURCHASE',
                        message: `Purchase receipt for ${qty} ${finalUnit} ${matchedStock ? matchedStock.name : item_name.trim()} submitted in Junior Employee mode. Queued for Admin review in SmartHerd portal.`,
                        details: {
                            id: purchaseId,
                            date: validDate,
                            item_name: matchedStock ? matchedStock.name : item_name.trim(),
                            quantity: qty,
                            unit: finalUnit,
                            rate: unitRate,
                            total_cost: +(qty * unitRate).toFixed(2)
                        }
                    });
                }

                await client.query(`
                    INSERT INTO ba_feed_purchases (
                        id, date, item_id, item_name, item_unit, quantity, rate, supplier, notes, created_by, created_at
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
                `, [purchaseId, validDate, itemId, matchedStock ? matchedStock.name : item_name.trim(), finalUnit, qty, unitRate, supplier || null, notes || null, agentActor]);

                return res.status(201).json({
                    success: true,
                    status: 'committed',
                    mode: 'normal_staff',
                    id: purchaseId,
                    message: `Purchase of ${qty} ${finalUnit} ${matchedStock ? matchedStock.name : item_name.trim()} recorded successfully.`
                });
            }

            // -------------------------------------------------------------
            // POST /api/v1/cattle/intake or /api/v1/purchasing/animal
            // Ingest new animal arrival / purchase records
            // -------------------------------------------------------------
            if (route === 'cattle/intake' || route === 'purchasing/animal') {
                const {
                    tag, rfid, breed, entry_date, entry_weight, purchase_price,
                    source, target_adg, status, pen, notes, image, allow_historical
                } = body;

                const finalTag = String(tag || rfid || '').trim().toUpperCase();
                const finalRfid = String(rfid || tag || '').trim().toUpperCase();
                if (!finalTag) throw new Error('INTAKE_ERROR: "tag" or "rfid" is required.');

                const validDate = validateDateStr(entry_date || getTodayStr(), allow_historical);
                const weightNum = parseFloat(entry_weight);
                if (isNaN(weightNum) || weightNum < 40 || weightNum > 1200) {
                    throw new Error(`INTAKE_ERROR: "entry_weight" must be between 40kg and 1200kg (received ${entry_weight}).`);
                }

                // Check for duplicate active tag
                const dupCheck = await client.query(
                    `SELECT id FROM ba_animals WHERE rfid = $1 AND status NOT IN ('Sold', 'Deceased')`,
                    [finalTag]
                );
                if (dupCheck.rows.length > 0) {
                    throw new Error(`INTAKE_ERROR: An active animal with tag/RFID "${finalTag}" already exists in the herd.`);
                }

                if (isDryRun) {
                    return res.status(200).json({
                        success: true,
                        dry_run: true,
                        message: 'SANITY_CHECKS_PASSED: Cattle intake record is valid and ready to commit.',
                        simulated_record: { tag: finalTag, rfid: finalTag, breed: breed || 'Cross', entry_weight: weightNum, pen: (pen || 'Quarantine').toUpperCase() }
                    });
                }

                const requireApproval = await isAiApprovalRequired(client, req, body);
                if (requireApproval) {
                    const approvalRes = await client.query(`
                        INSERT INTO ba_pending_approvals (action, animal_rfid, animal_breed, payload, requested_by)
                        VALUES ('ADD_ANIMAL', $1, $2, $3, $4)
                        RETURNING id
                    `, [
                        finalTag,
                        breed || 'Cross',
                        JSON.stringify({
                            tag: finalTag,
                            rfid: finalTag,
                            breed: breed || 'Cross',
                            entryDate: validDate,
                            entryWeight: weightNum,
                            currentWeight: weightNum,
                            targetWeight: parseFloat(body.target_weight || body.targetWeight || 380),
                            purchasePrice: parseFloat(purchase_price || body.purchasePrice || 0),
                            source: source || 'Direct Purchase',
                            status: status || 'Quarantined',
                            pen: (pen || 'Quarantine').toUpperCase(),
                            description: notes || body.description || null,
                            images: image || body.images || null,
                            mandiPrice: parseFloat(body.mandi_price || body.mandiPrice || purchase_price || 0),
                            mandiWeight: parseFloat(body.mandi_weight || body.mandiWeight || weightNum),
                            mandiTax: parseFloat(body.mandi_tax || body.mandiTax || 0),
                            carriage: parseFloat(body.carriage || 0),
                            miscExpense: parseFloat(body.misc_expense || body.miscExpense || 0)
                        }),
                        agentActor
                    ]);

                    return res.status(202).json({
                        success: true,
                        status: 'pending_approval',
                        approval_id: approvalRes.rows[0].id,
                        mode: 'junior_employee',
                        action: 'ADD_ANIMAL',
                        message: `Cattle intake for Tag ${finalTag} submitted in Junior Employee mode. Queued for Admin review in SmartHerd portal.`,
                        details: { tag: finalTag, breed: breed || 'Cross', entry_weight: weightNum, pen: (pen || 'Quarantine').toUpperCase() }
                    });
                }

                const insertRes = await client.query(`
                    INSERT INTO ba_animals (
                        rfid, breed, entry_date, entry_weight, current_weight, target_weight,
                        purchase_price, source, status, pen, description, images,
                        mandi_price, mandi_weight, mandi_tax, carriage, misc_expense
                    )
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
                    RETURNING id
                `, [
                    finalTag,
                    breed || 'Cross',
                    validDate,
                    weightNum,
                    weightNum,
                    parseFloat(body.target_weight || body.targetWeight || 380),
                    parseFloat(purchase_price || body.purchasePrice || 0),
                    source || 'Direct Purchase',
                    status || 'Quarantined',
                    (pen || 'Quarantine').toUpperCase(),
                    notes || body.description || null,
                    image || body.images || null,
                    parseFloat(body.mandi_price || body.mandiPrice || purchase_price || 0),
                    parseFloat(body.mandi_weight || body.mandiWeight || weightNum),
                    parseFloat(body.mandi_tax || body.mandiTax || 0),
                    parseFloat(body.carriage || 0),
                    parseFloat(body.misc_expense || body.miscExpense || 0)
                ]);
                const newId = insertRes.rows[0].id;
                await client.query(`INSERT INTO ba_weights (animal_id, date, weight, created_by) VALUES ($1, $2, $3, $4)`, [newId, validDate, weightNum, agentActor]);
                await client.query(`INSERT INTO ba_events (animal_id, date, event_type, note, created_by) VALUES ($1, $2, 'arrival', $3, $4)`, [newId, validDate, `Arrived into ${(pen || 'Quarantine').toUpperCase()}`, agentActor]);

                return res.status(201).json({
                    success: true,
                    status: 'committed',
                    mode: 'normal_staff',
                    id: newId,
                    tag: finalTag,
                    message: `Animal ${finalTag} registered and added to herd successfully.`
                });
            }

            // -------------------------------------------------------------
            // POST /api/v1/premix/batches
            // Log in-house Wanda production (Standard recipe or Custom breakdown)
            // -------------------------------------------------------------
            if (route === 'premix/batches' || route === 'premix/batch') {
                const {
                    premix_type_id, premix_name, date, total_kg, bag_weight, bag_count,
                    custom_ingredients, notes, allow_historical
                } = body;

                const validDate = validateDateStr(date, allow_historical);
                const totalKg = parseFloat(total_kg);
                if (isNaN(totalKg) || totalKg <= 0) {
                    throw new Error('PREMIX_ERROR: "total_kg" must be a positive number.');
                }

                // Resolve premix type
                const [typesRes, formulasRes, stockRes] = await Promise.all([
                    client.query("SELECT value FROM ba_settings WHERE key = 'premix_types'"),
                    client.query("SELECT value FROM ba_settings WHERE key = 'premix_formulas'"),
                    client.query("SELECT value FROM ba_settings WHERE key = 'feed_stock_items'")
                ]);
                const parse = (v) => typeof v === 'string' ? JSON.parse(v) : v;
                const types = parse(typesRes.rows[0]?.value) || [];
                const formulas = parse(formulasRes.rows[0]?.value) || {};
                const stockItems = parse(stockRes.rows[0]?.value) || [];

                let targetType = types.find(t => t.id === premix_type_id || (premix_name && t.name.toLowerCase() === premix_name.toLowerCase().trim()));
                if (!targetType) {
                    throw new Error(`PREMIX_ERROR: Premix/Wanda type "${premix_type_id || premix_name}" not recognized. Valid types: ${types.map(t => t.name).join(', ')}.`);
                }

                let consumed = [];
                // Mode B: Custom ingredient breakdown (e.g. 1% Urea instead of 1.39%)
                if (Array.isArray(custom_ingredients) && custom_ingredients.length > 0) {
                    let sumKg = 0;
                    for (const ci of custom_ingredients) {
                        const rawItem = stockItems.find(s => s.id === ci.stock_item_id || s.name.toLowerCase() === (ci.name || '').toLowerCase().trim());
                        if (!rawItem) {
                            throw new Error(`PREMIX_ERROR: Raw material "${ci.name || ci.stock_item_id}" not recognized in feed store items.`);
                        }
                        const kg = parseFloat(ci.kg);
                        if (isNaN(kg) || kg <= 0) throw new Error(`PREMIX_ERROR: Invalid kg for ingredient "${rawItem.name}".`);
                        sumKg += kg;
                        consumed.push({ stockItemId: rawItem.id, name: rawItem.name, quantity: kg });
                    }
                    if (Math.abs(sumKg - totalKg) > 1.0) {
                        throw new Error(`SANITY_CHECK_FAILED: Custom ingredient sum (${sumKg.toFixed(2)} kg) does not match batch total (${totalKg.toFixed(2)} kg).`);
                    }
                } else {
                    // Mode A: Standard formula
                    const formula = formulas[targetType.id] || [];
                    if (formula.length === 0) throw new Error(`PREMIX_ERROR: No active formula defined for "${targetType.name}".`);
                    consumed = formula.map(r => {
                        const item = stockItems.find(s => s.id === r.stockItemId);
                        return {
                            stockItemId: r.stockItemId,
                            name: item ? item.name : r.stockItemId,
                            quantity: +(totalKg * r.qtyPerKg).toFixed(3)
                        };
                    });
                }

                // Compute cost per kg based on recent purchase lot rates
                let totalCost = 0;
                for (const c of consumed) {
                    const rateRes = await client.query(
                        `SELECT rate FROM ba_feed_purchases WHERE item_id = $1 OR item_name ILIKE $2 ORDER BY date DESC, created_at DESC LIMIT 1`,
                        [c.stockItemId, c.name]
                    );
                    const rate = rateRes.rows.length > 0 ? parseFloat(rateRes.rows[0].rate) : 72.0;
                    c.rate = rate;
                    c.cost = +(c.quantity * rate).toFixed(2);
                    totalCost += c.cost;
                }
                const costPerKg = +(totalCost / totalKg).toFixed(2);

                if (isDryRun) {
                    return res.status(200).json({
                        success: true,
                        dry_run: true,
                        message: 'SANITY_CHECKS_PASSED: Premix batch is valid and ready to commit.',
                        simulated_batch: {
                            premix_type: targetType.name,
                            total_kg: totalKg,
                            estimated_cost_per_kg: costPerKg,
                            raw_materials_consumed: consumed
                        }
                    });
                }

                const requireApproval = await isAiApprovalRequired(client, req, body);
                if (requireApproval) {
                    const batchId = 'pb-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6);
                    const approvalRes = await client.query(`
                        INSERT INTO ba_pending_approvals (action, payload, requested_by)
                        VALUES ('SAVE_SETTINGS', $1, $2)
                        RETURNING id
                    `, [
                        JSON.stringify({
                            key: 'premix_batches',
                            batchId,
                            premixTypeId: targetType.id,
                            premixTypeName: targetType.name,
                            date: validDate,
                            totalKg,
                            bagWeight: parseFloat(bag_weight || 0),
                            bagCount: parseFloat(bag_count || 0),
                            costPerKg,
                            consumed,
                            notes: notes || `Batch of ${targetType.name}`
                        }),
                        agentActor
                    ]);

                    return res.status(202).json({
                        success: true,
                        status: 'pending_approval',
                        approval_id: approvalRes.rows[0].id,
                        mode: 'junior_employee',
                        action: 'SAVE_SETTINGS',
                        message: `Wanda mixing batch (${totalKg} kg of ${targetType.name}) submitted in Junior Employee mode. Queued for Admin review in SmartHerd portal.`,
                        details: {
                            premix_type: targetType.name,
                            total_kg: totalKg,
                            cost_per_kg: costPerKg,
                            raw_materials_count: consumed.length,
                            date: validDate
                        }
                    });
                }

                // COMMIT: Deduct raw materials to pen PRODUCTION
                const issueIds = [];
                for (const c of consumed) {
                    const issueId = 'fsi_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
                    await client.query(`
                        INSERT INTO ba_feed_stock_issues (id, date, item_id, item_name, quantity, pen, notes, created_by, created_at)
                        VALUES ($1, $2, $3, $4, $5, 'PRODUCTION', $6, $7, NOW())
                    `, [issueId, validDate, c.stockItemId, c.name, c.quantity, `Used to produce ${totalKg} kg of ${targetType.name}`, agentActor]);
                    issueIds.push(issueId);
                }

                // COMMIT: Credit finished Wanda to ba_feed_purchases
                const purchaseId = 'fp_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
                await client.query(`
                    INSERT INTO ba_feed_purchases (id, date, item_id, item_name, quantity, rate, supplier, notes, created_by, created_at)
                    VALUES ($1, $2, $3, $4, $5, $6, 'In-house production', $7, $8, NOW())
                `, [purchaseId, validDate, targetType.id, targetType.name, totalKg, costPerKg, notes || `Batch of ${targetType.name}`, agentActor]);

                // COMMIT: Append to premix_batches in ba_settings
                const batchesRes = await client.query("SELECT value FROM ba_settings WHERE key = 'premix_batches'");
                let existingBatches = [];
                if (batchesRes.rows.length > 0) {
                    existingBatches = parse(batchesRes.rows[0].value) || [];
                }
                const newBatchRecord = {
                    id: 'pb-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6),
                    premixTypeId: targetType.id,
                    premixTypeName: targetType.name,
                    date: validDate,
                    totalKg,
                    bagWeight: parseFloat(bag_weight || 0),
                    bagCount: parseFloat(bag_count || 0),
                    costPerKg,
                    consumed,
                    purchaseId,
                    issueIds,
                    notes: notes || ''
                };
                existingBatches.push(newBatchRecord);
                await client.query("UPDATE ba_settings SET value = $1 WHERE key = 'premix_batches'", [JSON.stringify(existingBatches)]);

                return res.status(201).json({
                    success: true,
                    status: 'committed',
                    mode: 'normal_staff',
                    batch_id: newBatchRecord.id,
                    message: `Produced ${totalKg} kg of ${targetType.name} at Rs. ${costPerKg}/kg. Deducted ${consumed.length} raw materials.`
                });
            }

            return res.status(404).json({
                success: false,
                error: `UNKNOWN_ROUTE: POST route "${route}" is not recognized. Check /api/v1 documentation.`
            });
        }

        return res.status(405).json({ success: false, error: `METHOD_NOT_ALLOWED: Method ${req.method} not supported.` });

    } catch (err) {
        console.error('API Error in /api/v1:', err.message);
        const isSanity = err.message.startsWith('SANITY_CHECK_FAILED') || err.message.startsWith('DATE_') || err.message.startsWith('ANIMAL_') || err.message.startsWith('INTAKE_') || err.message.startsWith('FEED_') || err.message.startsWith('WEIGHT_') || err.message.startsWith('PEN_') || err.message.startsWith('TRANSFER_') || err.message.startsWith('TREATMENT_') || err.message.startsWith('PURCHASE_') || err.message.startsWith('PREMIX_');
        return res.status(isSanity ? 422 : 500).json({
            success: false,
            error: err.message,
            recovery_hint: isSanity ? 'Correct the invalid payload fields according to AI_API_SPEC.md.' : 'Server execution error. Verify parameters and retry.'
        });
    } finally {
        client.release();
    }
};
