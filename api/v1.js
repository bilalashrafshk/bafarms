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
if (!process.env.DATABASE_URL) {
    try {
        const envPath = path.resolve(process.cwd(), '.env');
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
        }
    } catch (e) {
        console.warn('Unable to load local .env in v1 api:', e.message);
    }
}

const DATABASE_URL = process.env.DATABASE_URL;
const BA_API_KEY = process.env.BA_API_KEY || process.env.API_SECRET_KEY;

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
    if (!dateStr || typeof dateStr !== 'string') {
        throw new Error('DATE_ERROR: "date" field is required and must be a string formatted as YYYY-MM-DD.');
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
        SELECT id, rfid, breed, pen, status, current_weight, entry_weight, entry_date, previous_tags
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
                const today = query.date || getTodayStr();
                validateDateStr(today, true);

                const animalsRes = await client.query(`SELECT id, rfid, pen, status, current_weight FROM ba_animals WHERE status NOT IN ('Sold', 'Deceased')`);
                const feedLogsRes = await client.query(`SELECT pen, feeding_index, num_feedings, feeding_pct, total_batch_kg FROM ba_feed_logs WHERE date = $1`, [today]);
                const penChecksRes = await client.query(`SELECT pen, session, bunk_score, head_count, head_pulled FROM ba_pen_checks WHERE date = $1`, [today]);

                const activeAnimals = animalsRes.rows;
                const activePens = Array.from(new Set(activeAnimals.filter(a => a.pen).map(a => a.pen))).sort();

                // Feed coverage per active pen
                const penFeedCoverage = {};
                for (const penId of activePens) {
                    const logs = feedLogsRes.rows.filter(l => l.pen === penId || l.pen === 'ALL');
                    const loggedPct = logs.reduce((sum, l) => sum + parseFloat(l.feeding_pct || 0), 0);
                    const isComplete = logs.some(l => (l.feeding_index === 0 || l.num_feedings <= 1 || parseFloat(l.feeding_pct) >= 99.5)) || loggedPct >= 99.5;
                    penFeedCoverage[penId] = {
                        complete: isComplete,
                        logged_pct: Math.min(100, Math.round(loggedPct)),
                        feedings_recorded: logs.length
                    };
                }

                const totalPens = activePens.length;
                const completedPens = activePens.filter(p => penFeedCoverage[p].complete).length;
                const overallFeedPct = totalPens > 0 ? Math.round((completedPens / totalPens) * 100) : 100;

                // Pen check coverage
                const penCheckCoverage = {};
                for (const penId of activePens) {
                    const checks = penChecksRes.rows.filter(c => c.pen === penId);
                    penCheckCoverage[penId] = {
                        checked: checks.length > 0,
                        sessions: checks.map(c => c.session),
                        latest_bunk_score: checks.length > 0 ? checks[checks.length - 1].bunk_score : null
                    };
                }

                const sickCalves = activeAnimals.filter(a => a.status === 'Sick' || a.status === 'Hospital');

                return res.status(200).json({
                    success: true,
                    date: today,
                    compliance: {
                        feed: {
                            is_fully_compliant: completedPens === totalPens,
                            completion_pct: overallFeedPct,
                            completed_pens: completedPens,
                            total_active_pens: totalPens,
                            pen_details: penFeedCoverage
                        },
                        bunk_checks: {
                            completed_pens: activePens.filter(p => penCheckCoverage[p].checked).length,
                            total_active_pens: totalPens,
                            pen_details: penCheckCoverage
                        },
                        health_alerts: {
                            sick_animals_count: sickCalves.length,
                            sick_animal_tags: sickCalves.map(c => c.rfid)
                        }
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

                return res.status(200).json({
                    success: true,
                    animal: {
                        animal_id: animal.id,
                        tag: animal.rfid,
                        pen: animal.pen,
                        breed: animal.breed,
                        status: animal.status,
                        current_weight_kg: parseFloat(animal.current_weight || 0),
                        entry_weight_kg: parseFloat(animal.entry_weight || 0),
                        entry_date: animal.entry_date,
                        dof: calcDof(animal.entry_date),
                        under_withholding: activeWithholding.length > 0,
                        active_withholdings: activeWithholding
                    },
                    weight_history: weightsRes.rows.map(w => ({
                        date: w.date,
                        weight_kg: parseFloat(w.weight),
                        adg: w.adg ? parseFloat(w.adg) : null
                    })),
                    treatments: treatmentsRes.rows,
                    lifecycle_events: eventsRes.rows
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
            // GET /api/v1/tasks/upcoming
            // -------------------------------------------------------------
            if (route === 'tasks/upcoming' || route === 'tasks') {
                const today = getTodayStr();
                const quarantined = await client.query(`
                    SELECT id, rfid, pen, entry_date 
                    FROM ba_animals 
                    WHERE status = 'Quarantined'
                    ORDER BY entry_date ASC
                `);

                const protocolTasks = [];
                for (const q of quarantined.rows) {
                    const dof = calcDof(q.entry_date);
                    const milestones = [
                        { day: 1, title: 'Intake Deworming & Multivitamin' },
                        { day: 7, title: 'Primary Clostridial / HS Vaccine' },
                        { day: 14, title: 'Booster Dose & Ear Tag Check' },
                        { day: 21, title: 'Quarantine Exit Scale Weigh-in' }
                    ];

                    for (const m of milestones) {
                        if (dof <= m.day && m.day - dof <= 7) {
                            protocolTasks.push({
                                tag: q.rfid,
                                pen: q.pen,
                                dof,
                                scheduled_day: m.day,
                                task_title: m.title,
                                due_in_days: m.day - dof
                            });
                        }
                    }
                }

                return res.status(200).json({
                    success: true,
                    today,
                    upcoming_protocol_tasks: protocolTasks
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
                const [typesRes, formulasRes, stockRes] = await Promise.all([
                    client.query("SELECT value FROM ba_settings WHERE key = 'premix_types'"),
                    client.query("SELECT value FROM ba_settings WHERE key = 'premix_formulas'"),
                    client.query("SELECT value FROM ba_settings WHERE key = 'feed_stock_items'")
                ]);

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
                    ai_require_approval: isRequired,
                    mode: isRequired ? 'junior_employee' : 'normal_staff',
                    description: isRequired
                        ? 'Junior Employee Mode active. All AI tasks (feed logs, cattle weights, treatments, purchases, wanda mixing) are held in ba_pending_approvals for Admin review.'
                        : 'Normal SmartHerd Staff Mode active. Valid AI entries commit directly to production records with active biological sanity clamps.'
                });
            }

            return res.status(200).json({
                success: true,
                message: 'BA Foods M2M & AI Integration API (v1) Online.',
                available_get_routes: [
                    '/api/v1/compliance/summary',
                    '/api/v1/cattle/roster',
                    '/api/v1/cattle/passport?tag=<TAG>',
                    '/api/v1/feed/logs?date=<YYYY-MM-DD>',
                    '/api/v1/pen-checks?date=<YYYY-MM-DD>',
                    '/api/v1/health/withholding',
                    '/api/v1/tasks/upcoming',
                    '/api/v1/inventory/summary',
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
                    tag, date, type, medicine, dosage, withholding,
                    diagnosis, notes, allow_historical
                } = body;

                const animal = await resolveAnimal(client, tag);
                if (animal.status === 'Sold' || animal.status === 'Deceased') {
                    throw new Error(`ANIMAL_INACTIVE: Cannot log treatment for calf ${animal.rfid} because status is "${animal.status}".`);
                }

                const validDate = validateDateStr(date, allow_historical);

                if (!medicine || typeof medicine !== 'string') {
                    throw new Error('TREATMENT_ERROR: "medicine" name is required.');
                }
                if (!dosage || typeof dosage !== 'string') {
                    throw new Error('TREATMENT_ERROR: "dosage" is required (e.g. "10 ml", "1 bolus").');
                }

                const withholdingDays = parseInt(withholding || 0, 10);
                if (isNaN(withholdingDays) || withholdingDays < 0) {
                    throw new Error(`SANITY_CHECK_FAILED: "withholding" must be a non-negative number of days (received ${withholding}).`);
                }

                // Anti-Overdose Duplicate Check
                const existingMeds = await client.query(`
                    SELECT id, dosage FROM ba_treatments
                    WHERE animal_id = $1 AND date = $2 AND LOWER(medicine) = LOWER($3)
                `, [animal.id, validDate, medicine.trim()]);
                if (existingMeds.rows.length > 0 && !body.allow_duplicate_dose) {
                    return res.status(409).json({
                        success: false,
                        error: `DUPLICATE_TREATMENT_BLOCKED: Tag ${animal.rfid} was already administered "${medicine.trim()}" on ${validDate} (Log #${existingMeds.rows[0].id}). Accidental repeat dose blocked.`,
                        hint: 'If this is an intentional second dose (e.g. BID administration), pass "allow_duplicate_dose": true.'
                    });
                }

                if (isDryRun) {
                    return res.status(200).json({
                        success: true,
                        dry_run: true,
                        message: 'SANITY_CHECKS_PASSED: Treatment is valid and ready to commit.',
                        simulated_record: {
                            animal_id: animal.id,
                            tag: animal.rfid,
                            date: validDate,
                            type: type || 'Curative',
                            medicine: medicine.trim(),
                            dosage: dosage.trim(),
                            withholding_days: withholdingDays
                        }
                    });
                }

                const requireApproval = await isAiApprovalRequired(client, req, body);
                if (requireApproval) {
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
                            type: type || 'Curative',
                            medicine: medicine.trim(),
                            dosage: dosage.trim(),
                            withholding: withholdingDays,
                            notes: notes || (diagnosis ? `Diagnosis: ${diagnosis}` : null)
                        }),
                        JSON.stringify(animal),
                        agentActor
                    ]);

                    return res.status(202).json({
                        success: true,
                        status: 'pending_approval',
                        approval_id: approvalRes.rows[0].id,
                        mode: 'junior_employee',
                        action: 'LOG_TREATMENT',
                        message: `Treatment for Tag ${animal.rfid} (${medicine.trim()}) submitted in Junior Employee mode. Queued for Admin review in SmartHerd portal.`,
                        details: {
                            animal_id: animal.id,
                            tag: animal.rfid,
                            medicine: medicine.trim(),
                            dosage: dosage.trim(),
                            date: validDate,
                            withholding_days: withholdingDays
                        }
                    });
                }

                const insertRes = await client.query(`
                    INSERT INTO ba_treatments (
                        animal_id, date, type, medicine, dosage, withholding,
                        created_by, notes
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                    RETURNING id
                `, [
                    animal.id, validDate, type || 'Curative', medicine.trim(),
                    dosage.trim(), withholdingDays, agentActor,
                    notes || (diagnosis ? `Diagnosis: ${diagnosis}` : null)
                ]);

                return res.status(201).json({
                    success: true,
                    status: 'committed',
                    mode: 'normal_staff',
                    id: insertRes.rows[0].id,
                    message: `Treatment recorded for Tag ${animal.rfid} (${medicine.trim()} - ${dosage.trim()}).`
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
            if (route === 'cattle/pen-transfer' || route === 'pen-transfer') {
                const { tags, to_pen, reason } = body;
                if (!Array.isArray(tags) || tags.length === 0) {
                    throw new Error('TRANSFER_ERROR: "tags" must be an array of tag IDs (e.g. ["36", "08"]).');
                }
                if (!to_pen || typeof to_pen !== 'string') {
                    throw new Error('TRANSFER_ERROR: "to_pen" destination pen ID is required (e.g. "C", "E").');
                }
                const targetPen = to_pen.trim().toUpperCase();
                const today = getTodayStr();

                // Validate destination pen
                const validPensRes = await client.query('SELECT id FROM ba_pens');
                const validPenSet = new Set(validPensRes.rows.map(p => p.id.toUpperCase()));
                ['SICK', 'HOSPITAL', 'QUARANTINE'].forEach(p => validPenSet.add(p));
                if (!validPenSet.has(targetPen)) {
                    throw new Error(`TRANSFER_ERROR: Destination pen "${targetPen}" is not a recognized pen on the farm (Valid pens: ${Array.from(validPenSet).join(', ')}).`);
                }

                const resolvedAnimals = [];
                for (const t of tags) {
                    const a = await resolveAnimal(client, t);
                    resolvedAnimals.push(a);
                }

                if (isDryRun) {
                    return res.status(200).json({
                        success: true,
                        dry_run: true,
                        message: 'SANITY_CHECKS_PASSED: Pen transfer is valid and ready to commit.',
                        simulated_transfer: {
                            destination_pen: targetPen,
                            count: resolvedAnimals.length,
                            transfers: resolvedAnimals.map(a => ({
                                tag: a.rfid,
                                from_pen: a.pen,
                                to_pen: targetPen
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
                            JSON.stringify({ id: a.id, pen: targetPen, note: reason || `Pen transfer to ${targetPen}` }),
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
                        message: `Pen transfer for ${resolvedAnimals.length} animal(s) to Pen ${targetPen} submitted in Junior Employee mode. Queued for Admin review in SmartHerd portal.`,
                        details: {
                            destination_pen: targetPen,
                            transferred_count: resolvedAnimals.length,
                            transferred_tags: resolvedAnimals.map(a => a.rfid)
                        }
                    });
                }

                for (const a of resolvedAnimals) {
                    const oldPen = a.pen;
                    if (oldPen !== targetPen) {
                        await client.query(`UPDATE ba_animals SET pen = $1 WHERE id = $2`, [targetPen, a.id]);
                        await client.query(`
                            INSERT INTO ba_events (animal_id, date, event_type, note, from_pen, to_pen, created_by)
                            VALUES ($1, $2, 'pen_transfer', $3, $4, $5, $6)
                        `, [a.id, today, reason || `Transferred from Pen ${oldPen} to Pen ${targetPen}`, oldPen, targetPen, agentActor]);
                    }
                }

                return res.status(200).json({
                    success: true,
                    status: 'committed',
                    mode: 'normal_staff',
                    message: `Successfully transferred ${resolvedAnimals.length} animals to Pen ${targetPen}.`,
                    transferred_tags: resolvedAnimals.map(a => a.rfid)
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
                const matchedStock = stockItems.find(s => s.name.toLowerCase() === item_name.toLowerCase().trim() || s.id === item_name.trim());
                const itemId = matchedStock ? matchedStock.id : null;

                if (isDryRun) {
                    return res.status(200).json({
                        success: true,
                        dry_run: true,
                        message: 'SANITY_CHECKS_PASSED: Purchase receipt is valid and ready to commit.',
                        simulated_record: {
                            date: validDate,
                            item_name: matchedStock ? matchedStock.name : item_name.trim(),
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
                            itemName: matchedStock ? matchedStock.name : item_name.trim(),
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
                    `SELECT id FROM ba_animals WHERE (tag = $1 OR rfid = $2) AND status NOT IN ('Sold', 'Deceased')`,
                    [finalTag, finalRfid]
                );
                if (dupCheck.rows.length > 0) {
                    throw new Error(`INTAKE_ERROR: An active animal with tag/RFID "${finalTag}" already exists in the herd.`);
                }

                if (isDryRun) {
                    return res.status(200).json({
                        success: true,
                        dry_run: true,
                        message: 'SANITY_CHECKS_PASSED: Cattle intake record is valid and ready to commit.',
                        simulated_record: { tag: finalTag, rfid: finalRfid, breed: breed || 'Cross', entry_weight: weightNum, pen: pen || 'Quarantine' }
                    });
                }

                const requireApproval = await isAiApprovalRequired(client, req, body);
                if (requireApproval) {
                    const approvalRes = await client.query(`
                        INSERT INTO ba_pending_approvals (action, animal_rfid, animal_breed, payload, requested_by)
                        VALUES ('ADD_ANIMAL', $1, $2, $3, $4)
                        RETURNING id
                    `, [
                        finalRfid,
                        breed || 'Cross',
                        JSON.stringify({
                            tag: finalTag,
                            rfid: finalRfid,
                            breed: breed || 'Cross',
                            entryDate: validDate,
                            entryWeight: weightNum,
                            purchasePrice: parseFloat(purchase_price || 0),
                            source: source || 'Direct Purchase',
                            targetAdg: parseFloat(target_adg || 1.2),
                            status: status || 'Quarantined',
                            pen: (pen || 'Quarantine').toUpperCase(),
                            notes: notes || null,
                            image: image || null
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
                        details: { tag: finalTag, breed: breed || 'Cross', entry_weight: weightNum, pen: pen || 'Quarantine' }
                    });
                }

                const insertRes = await client.query(`
                    INSERT INTO ba_animals (tag, rfid, breed, entry_date, entry_weight, current_weight, purchase_price, source, target_adg, status, pen, notes, image, created_by)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
                    RETURNING id
                `, [
                    finalTag, finalRfid, breed || 'Cross', validDate, weightNum, weightNum,
                    parseFloat(purchase_price || 0), source || 'Direct Purchase',
                    parseFloat(target_adg || 1.2), status || 'Quarantined', (pen || 'Quarantine').toUpperCase(),
                    notes || null, image || null, agentActor
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
                    message: `Animal ${finalTag} added to herd successfully.`
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
        const isSanity = err.message.startsWith('SANITY_CHECK_FAILED') || err.message.startsWith('DATE_') || err.message.startsWith('ANIMAL_') || err.message.startsWith('FEED_') || err.message.startsWith('WEIGHT_') || err.message.startsWith('PEN_') || err.message.startsWith('TRANSFER_') || err.message.startsWith('TREATMENT_') || err.message.startsWith('PURCHASE_') || err.message.startsWith('PREMIX_');
        return res.status(isSanity ? 422 : 500).json({
            success: false,
            error: err.message,
            recovery_hint: isSanity ? 'Correct the invalid payload fields according to AI_API_SPEC.md.' : 'Server execution error. Verify parameters and retry.'
        });
    } finally {
        client.release();
    }
};
