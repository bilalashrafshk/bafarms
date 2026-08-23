const { Client } = require('pg');
const nodemailer = require('nodemailer');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');

// Load local .env file manually if process.env values are not set (useful for local development)
if (!process.env.SMTP_HOST) {
    try {
        const envPath = path.resolve(process.cwd(), '.env');
        if (fs.existsSync(envPath)) {
            const envConfig = fs.readFileSync(envPath, 'utf8');
            envConfig.split('\n').forEach(line => {
                const parts = line.split('=');
                if (parts.length >= 2) {
                    const key = parts[0].trim();
                    const val = parts.slice(1).join('=').trim().replace(/^['"]|['"]$/g, '');
                    if (key && !process.env[key]) {
                        process.env[key] = val;
                    }
                }
            });
        }
    } catch (e) {
        console.warn("Unable to load local .env file manually in farm api:", e);
    }
}

const SESSION_SECRET = process.env.SESSION_SECRET;

// Verify the staff session bearer token issued by /api/auth. Returns the decoded
// user (email, role, name) if valid, or null if missing/invalid/expired.
function verifySession(req) {
    try {
        const authHeader = req.headers['authorization'] || req.headers['Authorization'];
        if (!authHeader || !authHeader.startsWith('Bearer ') || !SESSION_SECRET) return null;
        const token = authHeader.slice(7);
        return jwt.verify(token, SESSION_SECRET);
    } catch (e) {
        return null;
    }
}

// Actions the public storefront must be able to call without a staff session
// (checkout flow: placing an order and marking a purchased live animal sold).
const PUBLIC_POST_ACTIONS = new Set(['ADD_ORDER', 'RECORD_SALE']);

// SMTP Order Email Sender Helper
async function sendOrderEmail(details) {
    const smtpHost = process.env.SMTP_HOST;
    const smtpPort = process.env.SMTP_PORT || 587;
    const smtpUser = process.env.SMTP_USER;
    const smtpPass = process.env.SMTP_PASS;
    const smtpSecure = process.env.SMTP_SECURE === 'true' || smtpPort == 465;
    const smtpFrom = process.env.SMTP_FROM || smtpUser || 'no-reply@bafoods.pk';

    if (!smtpHost || !smtpUser || !smtpPass) {
        console.warn("⚠️ SMTP credentials not fully configured for orders. Email sending simulated.");
        console.log("Simulated Order Email details:", {
            to: 'sales@bafoods.pk',
            replyTo: details.customerEmail,
            subject: `[BA Farm Order] New Order from ${details.customerName} - Ref: ${details.id}`,
            details
        });
        return { simulated: true };
    }

    const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: parseInt(smtpPort),
        secure: smtpSecure,
        auth: {
            user: smtpUser,
            pass: smtpPass
        }
    });

    // Generate HTML items list
    let itemsHtml = '';
    if (Array.isArray(details.items)) {
        details.items.forEach(item => {
            const itemSubtotal = (item.price * item.quantity).toLocaleString();
            const formattedPrice = item.price.toLocaleString();
            itemsHtml += `
                <tr>
                    <td style="padding: 10px; border-bottom: 1px solid #eeeeee; color: #333;">
                        <strong>${item.title}</strong><br>
                        <span style="font-size: 11px; color: #777;">RFID: ${item.rfid || 'N/A'}</span>
                    </td>
                    <td style="padding: 10px; border-bottom: 1px solid #eeeeee; color: #333; text-align: center;">${item.quantity}</td>
                    <td style="padding: 10px; border-bottom: 1px solid #eeeeee; color: #333; text-align: right;">Rs. ${formattedPrice}</td>
                    <td style="padding: 10px; border-bottom: 1px solid #eeeeee; color: #333; text-align: right; font-weight: bold;">Rs. ${itemSubtotal}</td>
                </tr>
            `;
        });
    }

    const htmlContent = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px; background-color: #fcfcfc;">
            <div style="text-align: center; border-bottom: 2px solid #1e3d2f; padding-bottom: 15px; margin-bottom: 20px;">
                <h2 style="color: #1e3d2f; margin: 0; font-size: 24px;">BA Farms</h2>
                <p style="color: #8c763e; margin: 5px 0 0 0; font-size: 14px; letter-spacing: 1px; text-transform: uppercase; font-weight: bold;">New Order / Inquiry Received</p>
            </div>
            
            <div style="margin-bottom: 20px;">
                <p style="font-size: 16px; color: #333; line-height: 1.5;">A new order/inquiry has been received from the farm website.</p>
            </div>
            
            <h3 style="color: #1e3d2f; border-bottom: 1px solid #1e3d2f; padding-bottom: 5px; margin-top: 25px;">Customer & Delivery Details</h3>
            <table style="width: 100%; border-collapse: collapse; margin-bottom: 25px;">
                <tr>
                    <td style="padding: 8px; border-bottom: 1px solid #eeeeee; font-weight: bold; color: #1e3d2f; width: 40%;">Order Reference ID</td>
                    <td style="padding: 8px; border-bottom: 1px solid #eeeeee; color: #333;"><strong>${details.id}</strong></td>
                </tr>
                <tr>
                    <td style="padding: 8px; border-bottom: 1px solid #eeeeee; font-weight: bold; color: #1e3d2f;">Customer Name</td>
                    <td style="padding: 8px; border-bottom: 1px solid #eeeeee; color: #333;">${details.customerName}</td>
                </tr>
                <tr>
                    <td style="padding: 8px; border-bottom: 1px solid #eeeeee; font-weight: bold; color: #1e3d2f;">Phone Number</td>
                    <td style="padding: 8px; border-bottom: 1px solid #eeeeee; color: #333;">${details.customerPhone}</td>
                </tr>
                <tr>
                    <td style="padding: 8px; border-bottom: 1px solid #eeeeee; font-weight: bold; color: #1e3d2f;">Email Address</td>
                    <td style="padding: 8px; border-bottom: 1px solid #eeeeee; color: #333;">
                        ${details.customerEmail ? `<a href="mailto:${details.customerEmail}" style="color: #8c763e; text-decoration: none;">${details.customerEmail}</a>` : 'Not Provided'}
                    </td>
                </tr>
                <tr>
                    <td style="padding: 8px; border-bottom: 1px solid #eeeeee; font-weight: bold; color: #1e3d2f;">City</td>
                    <td style="padding: 8px; border-bottom: 1px solid #eeeeee; color: #333;">${details.customerCity}</td>
                </tr>
                <tr>
                    <td style="padding: 8px; border-bottom: 1px solid #eeeeee; font-weight: bold; color: #1e3d2f;">Delivery Address</td>
                    <td style="padding: 8px; border-bottom: 1px solid #eeeeee; color: #333;">${details.customerAddress}</td>
                </tr>
                <tr>
                    <td style="padding: 8px; border-bottom: 1px solid #eeeeee; font-weight: bold; color: #1e3d2f;">Payment Method</td>
                    <td style="padding: 8px; border-bottom: 1px solid #eeeeee; color: #333;">${details.paymentMethod}</td>
                </tr>
                ${details.qurbaniService ? `
                <tr>
                    <td style="padding: 8px; border-bottom: 1px solid #eeeeee; font-weight: bold; color: #1e3d2f;">Qurbani Service Option</td>
                    <td style="padding: 8px; border-bottom: 1px solid #eeeeee; color: #333;">${details.qurbaniService}</td>
                </tr>
                ` : ''}
                <tr>
                    <td style="padding: 8px; border-bottom: 1px solid #eeeeee; font-weight: bold; color: #1e3d2f;">Date</td>
                    <td style="padding: 8px; border-bottom: 1px solid #eeeeee; color: #333;">${details.date}</td>
                </tr>
            </table>

            <h3 style="color: #1e3d2f; border-bottom: 1px solid #1e3d2f; padding-bottom: 5px;">Ordered Items</h3>
            <table style="width: 100%; border-collapse: collapse; margin-bottom: 25px;">
                <thead>
                    <tr style="background-color: #f7f9f8;">
                        <th style="padding: 10px; border-bottom: 2px solid #ddd; text-align: left; color: #1e3d2f;">Product</th>
                        <th style="padding: 10px; border-bottom: 2px solid #ddd; text-align: center; color: #1e3d2f;">Qty</th>
                        <th style="padding: 10px; border-bottom: 2px solid #ddd; text-align: right; color: #1e3d2f;">Price</th>
                        <th style="padding: 10px; border-bottom: 2px solid #ddd; text-align: right; color: #1e3d2f;">Subtotal</th>
                    </tr>
                </thead>
                <tbody>
                    ${itemsHtml}
                    <tr style="background-color: #fcfcfc;">
                        <td colspan="3" style="padding: 10px; font-weight: bold; text-align: right; border-top: 2px solid #ddd; color: #1e3d2f;">Net Total:</td>
                        <td style="padding: 10px; font-weight: bold; text-align: right; border-top: 2px solid #ddd; color: #1e3d2f; font-size: 16px;">Rs. ${details.netTotal.toLocaleString()}</td>
                    </tr>
                </tbody>
            </table>
            
            <div style="text-align: center; color: #777; font-size: 12px; border-top: 1px solid #eee; padding-top: 15px; margin-top: 25px;">
                <p style="margin: 0;">This email was sent automatically from the BA Farms Portal.</p>
                <p style="margin: 5px 0 0 0;">&copy; ${new Date().getFullYear()} BA Farms. All rights reserved.</p>
            </div>
        </div>
    `;

    await transporter.sendMail({
        from: `"${details.customerName} via BA Farms" <${smtpFrom}>`,
        to: 'sales@bafoods.pk',
        replyTo: details.customerEmail ? `"${details.customerName}" <${details.customerEmail}>` : undefined,
        subject: `[BA Farm Order] ${details.customerName} - Ref: ${details.id}`,
        html: htmlContent
    });

    return { sent: true };
}

// Add sale columns to ba_animals if they don't exist yet (safe to run on every request).
//
// This only ever actually runs once per warm container (see the `schemaEnsured` guard
// around the caller), but a cold container pays for it inline on whatever request
// happens to land first — and every one of the ~30 ALTER/CREATE statements below used to
// be its own separately-awaited `client.query()` call, each paying a full network round
// trip to Neon before the next was even sent, before any real data was fetched. That's
// the exact anti-pattern the GET endpoint's data queries were later fixed to avoid (see
// the Promise.all comment further down) — just never applied here. Grouped into a
// handful of multi-statement calls instead (same technique `ensureTables` already uses
// for its CREATE TABLE batch): each group is still just as idempotent/additive as
// before, this only cuts how many round trips a cold start has to pay for one-time
// schema bootstrapping. Statement order within a group is preserved (Postgres runs a
// multi-statement query text sequentially), so anything that depends on an earlier
// statement in the same group (a FK referencing a table just created, an UPDATE reading
// a column just added) still runs after it, same as before.
async function ensureColumns(client) {
    // Group 1 — standalone column adds with no cross-table dependencies.
    await client.query(`
        ALTER TABLE ba_animals
            ADD COLUMN IF NOT EXISTS sale_price NUMERIC DEFAULT NULL,
            ADD COLUMN IF NOT EXISTS buyer_name VARCHAR(100) DEFAULT NULL,
            ADD COLUMN IF NOT EXISTS sale_date DATE DEFAULT NULL,
            ADD COLUMN IF NOT EXISTS deceased_date DATE DEFAULT NULL,
            ADD COLUMN IF NOT EXISTS deceased_cause VARCHAR(100) DEFAULT NULL,
            ADD COLUMN IF NOT EXISTS pen VARCHAR(20) DEFAULT NULL,
            ADD COLUMN IF NOT EXISTS price NUMERIC DEFAULT NULL,
            ADD COLUMN IF NOT EXISTS description TEXT DEFAULT NULL,
            ADD COLUMN IF NOT EXISTS images TEXT DEFAULT NULL,
            ADD COLUMN IF NOT EXISTS previous_tags TEXT DEFAULT '[]';

        -- Links a logged treatment back to the specific quarantine-protocol checklist step
        -- it fulfills (e.g. distinguishing the FMD day-1 dose from the FMD day-7 booster,
        -- which otherwise share the same type/medicine and were being conflated). NULL for
        -- treatments logged manually outside of a protocol checklist.
        -- Also links a treatment back to the feed-stock issue (ba_feed_stock_issues, same
        -- category-agnostic FIFO stock system used for feed) that recorded its cost.
        ALTER TABLE ba_treatments
            ADD COLUMN IF NOT EXISTS protocol_task_id VARCHAR(50) DEFAULT NULL,
            ADD COLUMN IF NOT EXISTS stock_issue_id VARCHAR(50) DEFAULT NULL;

        -- Per-plan ingredient price overrides (PKR/kg), and a day 1-7 adaptation table
        -- separate from the weight-indexed steady-state rows in \`weeks\`.
        ALTER TABLE ba_ration_plans
            ADD COLUMN IF NOT EXISTS ingredient_prices JSONB DEFAULT '{}',
            ADD COLUMN IF NOT EXISTS adaptation JSONB DEFAULT '[]',
            ADD COLUMN IF NOT EXISTS wanda_stock_item_id VARCHAR(100) DEFAULT NULL;

        -- Pens switch between forage sources (e.g. run chari while silage ferments, then
        -- switch), and staff track an expected exit date for scheduling.
        ALTER TABLE ba_pens
            ADD COLUMN IF NOT EXISTS forage_type VARCHAR(20) DEFAULT 'silage',
            ADD COLUMN IF NOT EXISTS expected_exit_date DATE DEFAULT NULL;
    `);

    // Group 2 — --- Normalized, CSV-imported ration system (RATION_SYSTEM_SPEC.md) ---
    // Absolute kg/head/day only — this is the deliberate replacement for the
    // percentage-based `ba_ration_plans.weeks`/`adaptation` JSONB blobs above, which
    // is what caused three real pens at meaningfully different weights to be fed an
    // identical ration (the plan never re-resolved per-pen against that pen's own
    // projected weight). New pens/plans use these tables exclusively; old plans and
    // any pen still pointed at one keep working untouched (no dual-write, no drop).
    // ba_pens.plan_id (added last in this group) FKs into ba_ration_plans_v2, so that
    // table must be created earlier in this same batch — it is.
    await client.query(`
        CREATE TABLE IF NOT EXISTS ba_ration_plans_v2 (
            id VARCHAR(80) PRIMARY KEY,
            plan_key VARCHAR(50) NOT NULL,
            version INTEGER NOT NULL,
            name VARCHAR(100) NOT NULL,
            adaptation_days INTEGER NOT NULL DEFAULT 7,
            adg_floor NUMERIC DEFAULT 1.0,
            is_default BOOLEAN DEFAULT FALSE,
            created_by VARCHAR(100),
            created_at TIMESTAMP DEFAULT NOW(),
            UNIQUE(plan_key, version)
        );

        CREATE TABLE IF NOT EXISTS ba_ration_rows (
            id SERIAL PRIMARY KEY,
            plan_id VARCHAR(80) REFERENCES ba_ration_plans_v2(id) ON DELETE CASCADE,
            phase VARCHAR(20) NOT NULL,
            day_no INTEGER,
            forage_type VARCHAR(20) NOT NULL,
            wt_min NUMERIC NOT NULL,
            wt_max NUMERIC NOT NULL,
            target_adg NUMERIC NOT NULL,
            est_cost_per_head_per_day NUMERIC
        );

        CREATE INDEX IF NOT EXISTS idx_ration_rows_lookup
            ON ba_ration_rows (plan_id, forage_type, phase, day_no, wt_min, wt_max);

        CREATE TABLE IF NOT EXISTS ba_ration_row_items (
            id SERIAL PRIMARY KEY,
            row_id INTEGER REFERENCES ba_ration_rows(id) ON DELETE CASCADE,
            ingredient_id VARCHAR(100) NOT NULL,
            qty_kg_per_head_per_day NUMERIC NOT NULL
        );

        -- \`plan_id\` here points at ba_ration_plans_v2 (new system). The pre-existing
        -- \`ration_plan_id\` FK to the old ba_ration_plans is left as-is for pens not yet
        -- migrated. Cached weight/ADG fields let the resolution engine project a pen's
        -- current weight without re-scanning ba_weights on every lookup; both are kept
        -- in sync by LOG_WEIGHT and by SAVE_PEN's initial assignment.
        ALTER TABLE ba_pens
            ADD COLUMN IF NOT EXISTS plan_id VARCHAR(80) REFERENCES ba_ration_plans_v2(id) ON DELETE SET NULL,
            ADD COLUMN IF NOT EXISTS last_actual_weight_kg NUMERIC,
            ADD COLUMN IF NOT EXISTS last_weigh_date DATE,
            ADD COLUMN IF NOT EXISTS current_target_adg NUMERIC;
    `);

    // Group 3 — event log table plus a batch of small, unrelated column adds.
    await client.query(`
        CREATE TABLE IF NOT EXISTS ba_events (
            id SERIAL PRIMARY KEY,
            animal_id INTEGER REFERENCES ba_animals(id) ON DELETE CASCADE,
            date DATE NOT NULL,
            event_type VARCHAR(50) NOT NULL,
            note TEXT,
            created_at TIMESTAMP DEFAULT NOW()
        );

        -- from_pen/to_pen let 'registered' and 'pen_transfer' events double as a dated
        -- pen-membership ledger, so historical feed logs and ration lookups can answer
        -- "who was actually in this pen on that date" instead of trusting today's live
        -- roster (which wrongly includes animals bought in later, or drops ones sold
        -- since). Nullable/additive — existing rows are unaffected.
        ALTER TABLE ba_events ADD COLUMN IF NOT EXISTS from_pen VARCHAR(50);
        ALTER TABLE ba_events ADD COLUMN IF NOT EXISTS to_pen VARCHAR(50);
        ALTER TABLE ba_weights ADD COLUMN IF NOT EXISTS created_by VARCHAR(150);
        ALTER TABLE ba_treatments ADD COLUMN IF NOT EXISTS created_by VARCHAR(150);
        -- Free-text reason/diagnosis/remarks for the treatment (e.g. "Coughing", "Off-feed",
        -- "Leg injury") — previously there was nowhere to record *why* an animal was treated,
        -- only what medicine/dosage was given. Nullable/additive, existing rows unaffected.
        ALTER TABLE ba_treatments ADD COLUMN IF NOT EXISTS notes TEXT;
        ALTER TABLE ba_animals ADD COLUMN IF NOT EXISTS mandi_price NUMERIC;
        ALTER TABLE ba_animals ADD COLUMN IF NOT EXISTS mandi_weight NUMERIC;
        ALTER TABLE ba_animals ADD COLUMN IF NOT EXISTS mandi_tax NUMERIC;
        ALTER TABLE ba_animals ADD COLUMN IF NOT EXISTS carriage NUMERIC;
        ALTER TABLE ba_animals ADD COLUMN IF NOT EXISTS misc_expense NUMERIC;
    `);

    // Group 4 — Approval queue for sensitive herd changes made by non-super-admin staff:
    // edits to an animal's purchase price / entry (gross) weight, and any animal
    // deletion, are staged here instead of writing straight to ba_animals — a super
    // admin (is_admin=true) must approve or reject before the change/delete actually
    // lands. `payload` holds the proposed new field values (UPDATE_ANIMAL) or is NULL
    // (DELETE_ANIMAL, the whole row is already captured in previous_snapshot). Reusing
    // the SAME action names as the direct mutations (UPDATE_ANIMAL/DELETE_ANIMAL) rather
    // than inventing separate request actions keeps this enforced server-side regardless
    // of what the client sends.
    // animal_id is deliberately NOT a foreign key here (unlike ba_events): an approved
    // deletion request needs its own row to survive as a permanent audit record even
    // after the animal it referred to is gone from ba_animals. animal_rfid/animal_breed
    // are captured at request time for the same reason — a live join to ba_animals
    // would go blank the moment the animal is deleted, erasing exactly the detail an
    // audit trail exists to preserve. The self-heal ALTER below drops the cascading FK
    // (so approval history survives an approved delete) and backfills the newer columns
    // for a table created before this schema settled.
    await client.query(`
        CREATE TABLE IF NOT EXISTS ba_pending_approvals (
            id SERIAL PRIMARY KEY,
            action VARCHAR(30) NOT NULL,
            animal_id INTEGER,
            animal_rfid VARCHAR(50),
            animal_breed VARCHAR(60),
            payload JSONB,
            previous_snapshot JSONB,
            requested_by VARCHAR(150) NOT NULL,
            requested_at TIMESTAMP DEFAULT NOW(),
            status VARCHAR(20) NOT NULL DEFAULT 'pending',
            reviewed_by VARCHAR(150),
            reviewed_at TIMESTAMP,
            review_note TEXT
        );

        ALTER TABLE ba_pending_approvals DROP CONSTRAINT IF EXISTS ba_pending_approvals_animal_id_fkey;
        ALTER TABLE ba_pending_approvals ADD COLUMN IF NOT EXISTS animal_rfid VARCHAR(50);
        ALTER TABLE ba_pending_approvals ADD COLUMN IF NOT EXISTS animal_breed VARCHAR(60);
    `);

    // Group 5 — feed log split-feeding tracking + its one-time backfill + constraint
    // swap. Each step depends on the columns/data the previous step in this group
    // added, so order is preserved within the single batch.
    await client.query(`
        -- Explicit flag for a feed log where what was actually fed (overridden quantities
        -- or a substituted/added ingredient) diverged from the pen's Ration Plan that day —
        -- set by TMR's "Log This Feeding". Kept as a real column (not just parsed out of
        -- \`notes\`) so Feed Stock's Issues by Pen and any other view can flag it directly.
        ALTER TABLE ba_feed_logs ADD COLUMN IF NOT EXISTS diet_differed BOOLEAN NOT NULL DEFAULT FALSE;

        -- Split-feeding tracking: a pen can be fed 1 (Full Day), 2 (Morning/Evening), or 3
        -- (Morning/Afternoon/Evening) times a day (TMR's "Feeding N of M" split, which used
        -- to only be encoded as free text in \`notes\`). Each feeding is now its own row, keyed
        -- by feeding_index (0 = Full Day / legacy single log, 1-3 = which feeding of the
        -- split), so a later feeding no longer overwrites an earlier one from the same day —
        -- needed so the Feed & Growth Report can tell a fully-fed day apart from a day where
        -- e.g. only the morning feed was ever logged and the evening feed was missed.
        ALTER TABLE ba_feed_logs ADD COLUMN IF NOT EXISTS feeding_index INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE ba_feed_logs ADD COLUMN IF NOT EXISTS num_feedings INTEGER NOT NULL DEFAULT 1;
        ALTER TABLE ba_feed_logs ADD COLUMN IF NOT EXISTS feeding_pct NUMERIC NOT NULL DEFAULT 100;
        ALTER TABLE ba_feed_logs ADD COLUMN IF NOT EXISTS feeding_time TEXT;

        -- Backfill pre-existing rows from the "FEEDING N OF M (P%)" marker TMR already wrote
        -- into \`notes\` for split feedings — one-time (guarded by num_feedings = 1, the column
        -- default, so it never re-parses a row that's already been backfilled or explicitly set).
        UPDATE ba_feed_logs
        SET feeding_index = (regexp_match(notes, 'FEEDING (\\d+) OF (\\d+) \\((\\d+)%\\)'))[1]::int,
            num_feedings = (regexp_match(notes, 'FEEDING (\\d+) OF (\\d+) \\((\\d+)%\\)'))[2]::int,
            feeding_pct = (regexp_match(notes, 'FEEDING (\\d+) OF (\\d+) \\((\\d+)%\\)'))[3]::numeric
        WHERE num_feedings = 1 AND notes ~ 'FEEDING \\d+ OF \\d+ \\(\\d+%\\)';

        -- The old UNIQUE(date, pen) constraint would silently let a second feeding of the
        -- same day overwrite the first — swap it for one that also keys on feeding_index.
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ba_feed_logs_date_pen_key') THEN
                ALTER TABLE ba_feed_logs DROP CONSTRAINT ba_feed_logs_date_pen_key;
            END IF;
            IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ba_feed_logs_date_pen_feeding_index_key') THEN
                ALTER TABLE ba_feed_logs ADD CONSTRAINT ba_feed_logs_date_pen_feeding_index_key UNIQUE (date, pen, feeding_index);
            END IF;
        END $$;
    `);

    // Group 6 — feed purchase/issue denormalized item_name/item_unit + their one-time
    // backfills. The backfill UPDATEs read item_name, so they must run after the ALTER
    // that adds it — same batch, same order, guaranteed.
    await client.query(`
        -- Optional pin to a specific purchase lot (or 'opening' for opening stock) an issue
        -- should draw from — set when a "Log a Batch" / manual Issue lot picker is used to
        -- override the default FIFO (oldest lot first) draw. NULL means "auto/FIFO".
        ALTER TABLE ba_feed_stock_issues ADD COLUMN IF NOT EXISTS lot_id VARCHAR(50);

        -- Denormalize the item's real name/unit onto each purchase/issue row at the moment
        -- it's recorded, instead of relying purely on a live join against the feed_stock_items
        -- master list (which could silently be missing/out of sync, e.g. for issues, whose
        -- approval path never used to sync it at all) — so Feed Stock / Store Ledger rows
        -- never fall back to showing the internal "item_<timestamp>" id as the product name.
        ALTER TABLE ba_feed_purchases ADD COLUMN IF NOT EXISTS item_name VARCHAR(150);
        ALTER TABLE ba_feed_purchases ADD COLUMN IF NOT EXISTS item_unit VARCHAR(20);
        ALTER TABLE ba_feed_stock_issues ADD COLUMN IF NOT EXISTS item_name VARCHAR(150);
        ALTER TABLE ba_feed_stock_issues ADD COLUMN IF NOT EXISTS item_unit VARCHAR(20);

        -- One-time self-heal for rows saved before item_name existed (or before the
        -- ADD_FEED_STOCK_ISSUE approval path synced names at all): recover the real name from
        -- the archived approval payload — ba_pending_approvals keeps approved rows forever —
        -- or, failing that, from whatever's currently in the feed_stock_items master list.
        -- All four queries are idempotent (WHERE item_name IS NULL), safe to run on every boot.
        UPDATE ba_feed_purchases fp
        SET item_name = sub.name, item_unit = COALESCE(sub.unit, fp.item_unit)
        FROM (
            SELECT DISTINCT ON (payload->>'id')
                payload->>'id' AS purchase_id,
                payload->>'itemName' AS name,
                payload->>'itemUnit' AS unit
            FROM ba_pending_approvals
            WHERE action IN ('ADD_FEED_PURCHASE', 'UPDATE_FEED_PURCHASE')
                AND status = 'approved'
                AND payload->>'itemName' IS NOT NULL
                AND payload->>'itemName' NOT LIKE 'item\_%'
            ORDER BY payload->>'id', reviewed_at DESC
        ) sub
        WHERE fp.id = sub.purchase_id AND fp.item_name IS NULL;

        UPDATE ba_feed_stock_issues fi
        SET item_name = sub.name, item_unit = COALESCE(sub.unit, fi.item_unit)
        FROM (
            SELECT DISTINCT ON (payload->>'id')
                payload->>'id' AS issue_id,
                payload->>'itemName' AS name,
                payload->>'itemUnit' AS unit
            FROM ba_pending_approvals
            WHERE action = 'ADD_FEED_STOCK_ISSUE'
                AND status = 'approved'
                AND payload->>'itemName' IS NOT NULL
                AND payload->>'itemName' NOT LIKE 'item\_%'
            ORDER BY payload->>'id', reviewed_at DESC
        ) sub
        WHERE fi.id = sub.issue_id AND fi.item_name IS NULL;

        UPDATE ba_feed_purchases fp
        SET item_name = items.item ->> 'name', item_unit = COALESCE(items.item ->> 'unit', fp.item_unit)
        FROM (
            SELECT jsonb_array_elements(value) AS item
            FROM ba_settings WHERE key = 'feed_stock_items'
        ) items
        WHERE fp.item_name IS NULL
            AND fp.item_id = items.item ->> 'id'
            AND items.item ->> 'name' IS NOT NULL
            AND items.item ->> 'name' NOT LIKE 'item\_%';

        UPDATE ba_feed_stock_issues fi
        SET item_name = items.item ->> 'name', item_unit = COALESCE(items.item ->> 'unit', fi.item_unit)
        FROM (
            SELECT jsonb_array_elements(value) AS item
            FROM ba_settings WHERE key = 'feed_stock_items'
        ) items
        WHERE fi.item_name IS NULL
            AND fi.item_id = items.item ->> 'id'
            AND items.item ->> 'name' IS NOT NULL
            AND items.item ->> 'name' NOT LIKE 'item\_%';
    `);

    // Group 7 — Operating overhead ledger (salaries, electricity, rent, misc) — separate
    // from the feed/medicine stock system since these are pure dated expenses with no
    // quantity/FIFO costing. Feeds the unified Cost of Gain report as a per-day-in-herd
    // shared cost, same spirit as head-days feed cost allocation.
    await client.query(`
        CREATE TABLE IF NOT EXISTS ba_overhead_expenses (
            id VARCHAR(50) PRIMARY KEY,
            date DATE NOT NULL,
            category VARCHAR(50) NOT NULL,
            description TEXT,
            amount NUMERIC NOT NULL DEFAULT 0,
            created_by VARCHAR(150),
            created_at TIMESTAMP DEFAULT NOW()
        )
    `);
}

// Bump this whenever ensureTables()/ensureColumns() gain a new statement. It's the actual
// gate on whether a cold start needs to run schema migrations at all — see
// ensureSchemaVersion() below for why this replaces re-running ~9 round trips of
// CREATE/ALTER IF NOT EXISTS checks on every single cold start.
const CURRENT_SCHEMA_VERSION = 1;

// Real migration-version gate (the industry-standard pattern: a schema_migrations-style
// table tracked in the DB itself, like Rails/Django/Flyway/Prisma use), instead of relying
// only on the in-memory `schemaEnsured` flag. That flag resets on every cold start, so
// without this, a cold container still unconditionally re-ran the full ensureTables +
// ensureColumns bootstrap (~9 round trips even after batching) before serving a single
// row of real data — on every cold start, forever, even though 99% of the time nothing
// had changed since the last deploy.
//
// This checks a single persisted version number instead: if the DB is already at
// CURRENT_SCHEMA_VERSION, the whole migration bootstrap is skipped and the cold start pays
// only the 2 round trips below. Migrations only actually run again when a deploy bumps
// CURRENT_SCHEMA_VERSION (a genuine new column/table was added), exactly like a real
// migration runner — just gated at request time instead of a separate deploy step, since
// this project has no CI/CD pipeline with DB access to run one.
async function ensureSchemaVersion(client) {
    await client.query(`
        CREATE TABLE IF NOT EXISTS ba_schema_version (
            id INTEGER PRIMARY KEY DEFAULT 1,
            version INTEGER NOT NULL DEFAULT 0
        );
        INSERT INTO ba_schema_version (id, version) VALUES (1, 0) ON CONFLICT (id) DO NOTHING;
    `);
    const { rows } = await client.query('SELECT version FROM ba_schema_version WHERE id = 1');
    return rows[0].version;
}

// Self-healing database provision: creates tables and inserts baseline seeds on first boot
async function ensureTables(client) {
    const res = await client.query(`
        SELECT EXISTS (
            SELECT FROM information_schema.tables
            WHERE table_name = 'ba_animals'
        );
    `);
    const exists = res.rows[0].exists;
    if (exists) {
        // ba_animals exists; still ensure the newer tables exist
        await client.query(`
            CREATE TABLE IF NOT EXISTS ba_orders (
                id VARCHAR(50) PRIMARY KEY,
                customer_name VARCHAR(100) NOT NULL,
                customer_phone VARCHAR(20) NOT NULL,
                customer_email VARCHAR(100),
                customer_city VARCHAR(50) NOT NULL,
                customer_address TEXT NOT NULL,
                items JSONB NOT NULL DEFAULT '[]',
                net_total NUMERIC NOT NULL DEFAULT 0,
                status VARCHAR(50) NOT NULL DEFAULT 'Confirmed',
                has_live BOOLEAN DEFAULT FALSE,
                qurbani_service VARCHAR(50),
                payment_method VARCHAR(20),
                date DATE NOT NULL,
                created_at TIMESTAMP DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS ba_meat_cuts (
                id VARCHAR(100) PRIMARY KEY,
                title VARCHAR(200) NOT NULL,
                category VARCHAR(50) NOT NULL DEFAULT 'cuts',
                price NUMERIC NOT NULL,
                weight VARCHAR(100),
                description TEXT,
                ribbon VARCHAR(100),
                rfid VARCHAR(50),
                marbling VARCHAR(100),
                fat_ratio VARCHAR(50),
                images JSONB DEFAULT '[]',
                created_at TIMESTAMP DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS ba_export_enquiries (
                id          VARCHAR(50) PRIMARY KEY,
                company     VARCHAR(200) NOT NULL,
                contact     VARCHAR(100) NOT NULL,
                email       VARCHAR(100) NOT NULL,
                phone       VARCHAR(30) NOT NULL,
                country     VARCHAR(100) NOT NULL,
                cut_type    VARCHAR(100) NOT NULL,
                volume_mt   NUMERIC NOT NULL,
                frequency   VARCHAR(50),
                notes       TEXT,
                status      VARCHAR(50) DEFAULT 'New',
                created_at  TIMESTAMP DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS ba_quotations (
                id VARCHAR(50) PRIMARY KEY,
                client_name VARCHAR(200) NOT NULL,
                incoterm_basis VARCHAR(50) NOT NULL,
                scope VARCHAR(50) NOT NULL,
                target_destination VARCHAR(100),
                target_destinations TEXT,
                validity VARCHAR(200),
                terms JSONB NOT NULL DEFAULT '[]',
                preparer_name VARCHAR(100),
                preparer_title VARCHAR(100),
                preparer_phone VARCHAR(100),
                products JSONB NOT NULL DEFAULT '[]',
                status VARCHAR(50) DEFAULT 'Sent',
                created_at DATE NOT NULL DEFAULT CURRENT_DATE
            );

            CREATE TABLE IF NOT EXISTS ba_spec_sheets (
                doc_ref VARCHAR(50) PRIMARY KEY,
                client_name VARCHAR(200),
                doc_date DATE,
                id_name VARCHAR(200),
                id_category VARCHAR(100),
                id_spec TEXT,
                id_hs VARCHAR(100),
                id_sku VARCHAR(100),
                origin_country VARCHAR(100),
                origin_supply TEXT,
                origin_breed VARCHAR(100),
                origin_feed VARCHAR(100),
                origin_age VARCHAR(100),
                spec_form VARCHAR(100),
                spec_weight VARCHAR(100),
                spec_color VARCHAR(100),
                spec_ph VARCHAR(50),
                spec_trim VARCHAR(100),
                spec_bone VARCHAR(100),
                pack_primary TEXT,
                pack_secondary TEXT,
                pack_pieces VARCHAR(100),
                pack_weight VARCHAR(100),
                pack_labelling TEXT,
                store_temp TEXT,
                store_life TEXT,
                created_at TIMESTAMP DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS ba_staff_permissions (
                email VARCHAR(150) PRIMARY KEY,
                is_admin BOOLEAN NOT NULL DEFAULT FALSE,
                access_sales BOOLEAN NOT NULL DEFAULT TRUE,
                access_herd BOOLEAN NOT NULL DEFAULT TRUE,
                updated_at TIMESTAMP DEFAULT NOW()
            );

            INSERT INTO ba_staff_permissions (email, is_admin, access_sales, access_herd) VALUES
                ('bilalashraf248@gmail.com', true, true, true),
                ('bilalashrafshk@gmail.com', true, true, true),
                ('codeex624@gmail.com', false, false, true),
                ('drsami841@gmail.com', false, false, true),
                ('fazeel6254@gmail.com', false, false, true),
                ('hania.waseem2@gmail.com', false, false, true),
                ('khurramashraf031@gmail.com', false, true, true),
                ('muhammadashraf2171959@gmail.com', false, true, true),
                ('saqibs111@gmail.com', false, true, true)
            ON CONFLICT (email) DO NOTHING;

            CREATE TABLE IF NOT EXISTS ba_feed_logs (
                id SERIAL PRIMARY KEY,
                date DATE NOT NULL,
                pen VARCHAR(20) NOT NULL DEFAULT 'ALL',
                animal_count INTEGER NOT NULL DEFAULT 0,
                ingredients JSONB NOT NULL DEFAULT '[]',
                total_dm_kg NUMERIC DEFAULT 0,
                total_batch_kg NUMERIC DEFAULT 0,
                total_cost NUMERIC DEFAULT 0,
                cost_per_animal NUMERIC DEFAULT 0,
                notes TEXT,
                created_by VARCHAR(150),
                created_at TIMESTAMP DEFAULT NOW(),
                feeding_index INTEGER NOT NULL DEFAULT 0,
                num_feedings INTEGER NOT NULL DEFAULT 1,
                feeding_pct NUMERIC NOT NULL DEFAULT 100,
                UNIQUE(date, pen, feeding_index)
            );

            CREATE TABLE IF NOT EXISTS ba_ration_plans (
                id VARCHAR(50) PRIMARY KEY,
                name VARCHAR(150) NOT NULL,
                description TEXT,
                adg_floor NUMERIC DEFAULT 1.0,
                weeks JSONB NOT NULL DEFAULT '[]',
                ingredient_prices JSONB DEFAULT '{}',
                is_default BOOLEAN DEFAULT FALSE,
                created_by VARCHAR(150),
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS ba_pens (
                id VARCHAR(20) PRIMARY KEY,
                ration_plan_id VARCHAR(50) REFERENCES ba_ration_plans(id) ON DELETE SET NULL,
                cycle_start_date DATE,
                notes TEXT,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            );

            -- Generic single-value config store for the admin-editable settings that used
            -- to be device-local only (breed roster, med categories, system params,
            -- quarantine protocols, TMR recipe/prices, feed stock item list, opening
            -- stock, mineral split ratio) — editing these on one device now persists for
            -- every device/staff member instead of silently living only in that browser's
            -- localStorage.
            CREATE TABLE IF NOT EXISTS ba_settings (
                key VARCHAR(50) PRIMARY KEY,
                value JSONB NOT NULL,
                updated_by VARCHAR(150),
                updated_at TIMESTAMP DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS ba_feed_purchases (
                id VARCHAR(50) PRIMARY KEY,
                item_id VARCHAR(50) NOT NULL,
                date DATE NOT NULL,
                quantity NUMERIC NOT NULL DEFAULT 0,
                rate NUMERIC NOT NULL DEFAULT 0,
                supplier VARCHAR(150),
                notes TEXT,
                created_by VARCHAR(150),
                created_at TIMESTAMP DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS ba_feed_stock_issues (
                id VARCHAR(50) PRIMARY KEY,
                item_id VARCHAR(50) NOT NULL,
                date DATE NOT NULL,
                pen VARCHAR(20) NOT NULL DEFAULT 'ALL',
                quantity NUMERIC NOT NULL DEFAULT 0,
                notes TEXT,
                created_by VARCHAR(150),
                created_at TIMESTAMP DEFAULT NOW()
            );
        `);
        return;
    }

    // Run table creations inside a single command batch
    await client.query(`
        CREATE TABLE ba_animals (
            id SERIAL PRIMARY KEY,
            rfid VARCHAR(50) UNIQUE NOT NULL,
            breed VARCHAR(50) NOT NULL,
            entry_date DATE NOT NULL,
            entry_weight NUMERIC NOT NULL,
            current_weight NUMERIC NOT NULL,
            target_weight NUMERIC NOT NULL,
            purchase_price NUMERIC NOT NULL,
            source VARCHAR(100),
            status VARCHAR(50) NOT NULL
        );

        CREATE TABLE ba_weights (
            id SERIAL PRIMARY KEY,
            animal_id INTEGER REFERENCES ba_animals(id) ON DELETE CASCADE,
            date DATE NOT NULL,
            weight NUMERIC NOT NULL,
            adg NUMERIC DEFAULT 0
        );

        CREATE TABLE ba_treatments (
            id SERIAL PRIMARY KEY,
            animal_id INTEGER REFERENCES ba_animals(id) ON DELETE CASCADE,
            date DATE NOT NULL,
            type VARCHAR(50) NOT NULL,
            medicine VARCHAR(100) NOT NULL,
            dosage VARCHAR(50) NOT NULL,
            withholding INTEGER DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS ba_orders (
            id VARCHAR(50) PRIMARY KEY,
            customer_name VARCHAR(100) NOT NULL,
            customer_phone VARCHAR(20) NOT NULL,
            customer_email VARCHAR(100),
            customer_city VARCHAR(50) NOT NULL,
            customer_address TEXT NOT NULL,
            items JSONB NOT NULL DEFAULT '[]',
            net_total NUMERIC NOT NULL DEFAULT 0,
            status VARCHAR(50) NOT NULL DEFAULT 'Confirmed',
            has_live BOOLEAN DEFAULT FALSE,
            qurbani_service VARCHAR(50),
            payment_method VARCHAR(20),
            date DATE NOT NULL,
            created_at TIMESTAMP DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS ba_meat_cuts (
            id VARCHAR(100) PRIMARY KEY,
            title VARCHAR(200) NOT NULL,
            category VARCHAR(50) NOT NULL DEFAULT 'cuts',
            price NUMERIC NOT NULL,
            weight VARCHAR(100),
            description TEXT,
            ribbon VARCHAR(100),
            rfid VARCHAR(50),
            marbling VARCHAR(100),
            fat_ratio VARCHAR(50),
            images JSONB DEFAULT '[]',
            created_at TIMESTAMP DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS ba_export_enquiries (
            id          VARCHAR(50) PRIMARY KEY,
            company     VARCHAR(200) NOT NULL,
            contact     VARCHAR(100) NOT NULL,
            email       VARCHAR(100) NOT NULL,
            phone       VARCHAR(30) NOT NULL,
            country     VARCHAR(100) NOT NULL,
            cut_type    VARCHAR(100) NOT NULL,
            volume_mt   NUMERIC NOT NULL,
            frequency   VARCHAR(50),
            notes       TEXT,
            status      VARCHAR(50) DEFAULT 'New',
            created_at  TIMESTAMP DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS ba_quotations (
            id VARCHAR(50) PRIMARY KEY,
            client_name VARCHAR(200) NOT NULL,
            incoterm_basis VARCHAR(50) NOT NULL,
            scope VARCHAR(50) NOT NULL,
            target_destination VARCHAR(100),
            target_destinations TEXT,
            validity VARCHAR(200),
            terms JSONB NOT NULL DEFAULT '[]',
            preparer_name VARCHAR(100),
            preparer_title VARCHAR(100),
            preparer_phone VARCHAR(100),
            products JSONB NOT NULL DEFAULT '[]',
            status VARCHAR(50) DEFAULT 'Sent',
            created_at DATE NOT NULL DEFAULT CURRENT_DATE
        );

        CREATE TABLE IF NOT EXISTS ba_spec_sheets (
            doc_ref VARCHAR(50) PRIMARY KEY,
            client_name VARCHAR(200),
            doc_date DATE,
            id_name VARCHAR(200),
            id_category VARCHAR(100),
            id_spec TEXT,
            id_hs VARCHAR(100),
            id_sku VARCHAR(100),
            origin_country VARCHAR(100),
            origin_supply TEXT,
            origin_breed VARCHAR(100),
            origin_feed VARCHAR(100),
            origin_age VARCHAR(100),
            spec_form VARCHAR(100),
            spec_weight VARCHAR(100),
            spec_color VARCHAR(100),
            spec_ph VARCHAR(50),
            spec_trim VARCHAR(100),
            spec_bone VARCHAR(100),
            pack_primary TEXT,
            pack_secondary TEXT,
            pack_pieces VARCHAR(100),
            pack_weight VARCHAR(100),
            pack_labelling TEXT,
            store_temp TEXT,
            store_life TEXT,
            created_at TIMESTAMP DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS ba_staff_permissions (
            email VARCHAR(150) PRIMARY KEY,
            is_admin BOOLEAN NOT NULL DEFAULT FALSE,
            access_sales BOOLEAN NOT NULL DEFAULT TRUE,
            access_herd BOOLEAN NOT NULL DEFAULT TRUE,
            updated_at TIMESTAMP DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS ba_feed_logs (
            id SERIAL PRIMARY KEY,
            date DATE NOT NULL,
            pen VARCHAR(20) NOT NULL DEFAULT 'ALL',
            animal_count INTEGER NOT NULL DEFAULT 0,
            ingredients JSONB NOT NULL DEFAULT '[]',
            total_dm_kg NUMERIC DEFAULT 0,
            total_batch_kg NUMERIC DEFAULT 0,
            total_cost NUMERIC DEFAULT 0,
            cost_per_animal NUMERIC DEFAULT 0,
            notes TEXT,
            created_by VARCHAR(150),
            created_at TIMESTAMP DEFAULT NOW(),
            feeding_index INTEGER NOT NULL DEFAULT 0,
            num_feedings INTEGER NOT NULL DEFAULT 1,
            feeding_pct NUMERIC NOT NULL DEFAULT 100,
            UNIQUE(date, pen, feeding_index)
        );

        CREATE TABLE IF NOT EXISTS ba_ration_plans (
            id VARCHAR(50) PRIMARY KEY,
            name VARCHAR(150) NOT NULL,
            description TEXT,
            adg_floor NUMERIC DEFAULT 1.0,
            weeks JSONB NOT NULL DEFAULT '[]',
            ingredient_prices JSONB DEFAULT '{}',
            is_default BOOLEAN DEFAULT FALSE,
            created_by VARCHAR(150),
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS ba_pens (
            id VARCHAR(20) PRIMARY KEY,
            ration_plan_id VARCHAR(50) REFERENCES ba_ration_plans(id) ON DELETE SET NULL,
            cycle_start_date DATE,
            notes TEXT,
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS ba_settings (
            key VARCHAR(50) PRIMARY KEY,
            value JSONB NOT NULL,
            updated_by VARCHAR(150),
            updated_at TIMESTAMP DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS ba_feed_purchases (
            id VARCHAR(50) PRIMARY KEY,
            item_id VARCHAR(50) NOT NULL,
            date DATE NOT NULL,
            quantity NUMERIC NOT NULL DEFAULT 0,
            rate NUMERIC NOT NULL DEFAULT 0,
            supplier VARCHAR(150),
            notes TEXT,
            created_by VARCHAR(150),
            created_at TIMESTAMP DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS ba_feed_stock_issues (
            id VARCHAR(50) PRIMARY KEY,
            item_id VARCHAR(50) NOT NULL,
            date DATE NOT NULL,
            pen VARCHAR(20) NOT NULL DEFAULT 'ALL',
            quantity NUMERIC NOT NULL DEFAULT 0,
            notes TEXT,
            created_by VARCHAR(150),
            created_at TIMESTAMP DEFAULT NOW()
        );
    `);
}

// Reconciles and self-heals orphaned stock issues:
// 1. Treatment stock draws whose treatment no longer exists in ba_treatments.
// 2. Premix production draws whose batch no longer exists in ba_settings.premix_batches.
// Direct manual issues entered via the Issue form are never touched.
async function reconcileOrphanedFeedStockIssues(client) {
    try {
        // Prune orphaned treatment stock draws
        await client.query(`
            DELETE FROM ba_feed_stock_issues
            WHERE (notes LIKE '%stock draw%' OR notes LIKE '%Treatment stock draw%')
              AND id NOT IN (SELECT stock_issue_id FROM ba_treatments WHERE stock_issue_id IS NOT NULL)
        `);

        // Prune orphaned premix production issues and purchases
        const premixRes = await client.query("SELECT value FROM ba_settings WHERE key = 'premix_batches'");
        let batches = [];
        if (premixRes.rows.length > 0) {
            try {
                batches = typeof premixRes.rows[0].value === 'string' ? JSON.parse(premixRes.rows[0].value) : premixRes.rows[0].value;
            } catch (e) {}
        }
        if (!Array.isArray(batches)) batches = [];
        const validBatchIssueIds = batches.flatMap(b => b.issueIds || []).filter(Boolean);
        const validBatchPurchaseIds = batches.map(b => b.purchaseId).filter(Boolean);

        if (validBatchIssueIds.length > 0) {
            await client.query(`
                DELETE FROM ba_feed_stock_issues
                WHERE pen = 'PRODUCTION'
                  AND id != ALL($1::text[])
            `, [validBatchIssueIds]);
        } else {
            await client.query(`
                DELETE FROM ba_feed_stock_issues
                WHERE pen = 'PRODUCTION'
            `);
        }

        if (validBatchPurchaseIds.length > 0) {
            await client.query(`
                DELETE FROM ba_feed_purchases
                WHERE supplier = 'In-house production'
                  AND id != ALL($1::text[])
            `, [validBatchPurchaseIds]);
        } else {
            await client.query(`
                DELETE FROM ba_feed_purchases
                WHERE supplier = 'In-house production'
            `);
        }
    } catch (err) {
        console.error("reconcileOrphanedFeedStockIssues error:", err);
    }
}

// Resolves the real product name/unit for a feed_stock item id and durably persists it
// into the feed_stock_items master list (ba_settings) whenever it's missing or has
// changed. Shared by every path that inserts or approves a feed purchase/stock issue, so
// the master list — and therefore the Store Ledger's per-item summary rows, which are
// keyed off it — never drifts out of sync with what a staff member actually typed in,
// regardless of who created it or whether it went through the approval queue. Never
// writes the raw "item_<timestamp>" id back out as if it were a real product name.
async function resolveAndSyncFeedStockItemName(client, itemId, providedName, unit, category, updatedBy) {
    const isValidName = n => !!n && !String(n).startsWith('item_');

    const settingsRes = await client.query("SELECT value FROM ba_settings WHERE key = 'feed_stock_items'");
    let items = [];
    if (settingsRes.rows.length > 0) {
        try { items = typeof settingsRes.rows[0].value === 'string' ? JSON.parse(settingsRes.rows[0].value) : settingsRes.rows[0].value; } catch (e) {}
    }
    if (!Array.isArray(items)) items = [];
    const existing = items.find(i => i.id === itemId);

    const resolvedName = isValidName(providedName) ? providedName : (isValidName(existing?.name) ? existing.name : (providedName || itemId));
    const resolvedUnit = unit || existing?.unit || 'kg';

    if (isValidName(resolvedName) && itemId) {
        let updated = false;
        if (existing) {
            if (existing.name !== resolvedName || (resolvedUnit && existing.unit !== resolvedUnit) || (category && existing.category !== category)) {
                existing.name = resolvedName;
                if (resolvedUnit) existing.unit = resolvedUnit;
                if (category) existing.category = category;
                updated = true;
            }
        } else {
            items.push({ id: itemId, name: resolvedName, category: category || 'medicine', unit: resolvedUnit });
            updated = true;
        }
        if (updated) {
            await client.query(`
                INSERT INTO ba_settings (key, value, updated_by, updated_at)
                VALUES ('feed_stock_items', $1, $2, NOW())
                ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()
            `, [JSON.stringify(items), updatedBy || 'System']);
        }
    }

    return { name: resolvedName, unit: resolvedUnit };
}

// Resolve (and lazily bootstrap) a staff member's per-section access. Existing/new staff
// default to full access on first sight so nobody who could already use the app loses
// access on deploy — an admin dials individual users down afterward from Settings.
async function resolvePermissions(client, session) {
    if (!session || !session.email) return null;
    const email = session.email.toLowerCase().trim();

    const adminEmails = (process.env.ADMIN_EMAILS || process.env.VITE_ADMIN_EMAILS || 'bilalashrafshk@gmail.com,bilalashraf248@gmail.com')
        .split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
    const isHardcodedAdmin = adminEmails.includes(email);

    const existing = await client.query('SELECT * FROM ba_staff_permissions WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
        const row = existing.rows[0];
        const isAdmin = Boolean(row.is_admin || isHardcodedAdmin);
        const accessSales = Boolean(row.access_sales || isAdmin);
        const accessHerd = Boolean(row.access_herd || isAdmin);
        return { isAdmin, accessSales, accessHerd };
    }

    const isAdmin = isHardcodedAdmin;
    await client.query(`
        INSERT INTO ba_staff_permissions (email, is_admin, access_sales, access_herd)
        VALUES ($1, $2, TRUE, $3)
        ON CONFLICT (email) DO NOTHING
    `, [email, isAdmin, isAdmin]);

    return { isAdmin, accessSales: true, accessHerd: isAdmin || true };
}

// Action categories used to gate POST mutations by section access. Public checkout
// actions (ADD_ORDER, RECORD_SALE) are intentionally excluded — they must keep working
// for unauthenticated shoppers and for RotationPlanner's staff-initiated sale flow.
const HERD_ACTIONS = new Set([
    'ADD_ANIMAL', 'LOG_WEIGHT', 'LOG_TREATMENT', 'TRANSITION_STATUS', 'LOG_EVENT',
    'DELETE_ANIMAL', 'UPDATE_ANIMAL', 'RECORD_DEATH', 'DELETE_WEIGHT_LOG', 'DELETE_TREATMENT',
    'LOG_FEED', 'DELETE_FEED_LOG', 'UPDATE_WEIGHT_LOGS_BATCH',
    'SAVE_RATION_PLAN', 'DELETE_RATION_PLAN', 'SAVE_PEN', 'DELETE_PEN',
    'SAVE_SETTINGS', 'ADD_FEED_PURCHASE', 'DELETE_FEED_PURCHASE',
    'ADD_FEED_STOCK_ISSUE', 'DELETE_FEED_STOCK_ISSUE', 'IMPORT_RATION_PLAN',
    'UPDATE_RATION_PLAN_V2', 'UPDATE_RATION_ROW',
    'ADD_OVERHEAD_EXPENSE', 'DELETE_OVERHEAD_EXPENSE'
]);

// Normalizes a feed ingredient / CSV column name for matching: lowercase, drop any
// parenthesized qualifier, strip punctuation, collapse whitespace. Lets "Chari" match
// "Chari (Green Fodder)" and "Steady State Wanda" match "Wanda" without hand-maintained
// alias tables, while still being strict about names that aren't a real match.
function normalizeIngName(str) {
    return String(str || '')
        .toLowerCase()
        .replace(/\([^)]*\)/g, ' ')
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

// Matches a raw CSV ingredient column name against the farm's existing feed stock
// ingredient list — never lets an import introduce an ad-hoc ingredient name that
// diverges from what staff already use in Feed Stock / TMR. Returns { match, ambiguous }.
function matchIngredientColumn(colName, feedIngredients) {
    const normCol = normalizeIngName(colName);
    if (!normCol) return { match: null, ambiguous: false };

    const candidates = feedIngredients.filter(ing => {
        const normIng = normalizeIngName(ing.name);
        if (!normIng) return false;
        return normCol === normIng || normCol.includes(normIng) || normIng.includes(normCol);
    });

    if (candidates.length === 0) return { match: null, ambiguous: false };
    if (candidates.length === 1) return { match: candidates[0], ambiguous: false };

    const exact = candidates.find(ing => normalizeIngName(ing.name) === normCol);
    if (exact) return { match: exact, ambiguous: false };
    return { match: null, ambiguous: true, candidates };
}

// Recomputes a pen's cached weight-projection fields (last_actual_weight_kg,
// last_weigh_date, current_target_adg) from its active animals — the values the
// v2 ration resolution engine needs so it doesn't have to re-scan ba_weights on
// every feed lookup. Called on new-system plan assignment (SAVE_PEN) and again on
// every weigh-in (LOG_WEIGHT) so the cache never goes stale.
async function recomputePenWeightCache(client, penId, planId, forageType) {
    const animalsRes = await client.query(
        `SELECT id, current_weight FROM ba_animals WHERE pen = $1 AND status NOT IN ('Sold', 'Deceased')`,
        [penId]
    );
    if (animalsRes.rows.length === 0) {
        return { lastActualWeightKg: null, lastWeighDate: null, currentTargetAdg: null };
    }

    const avgWeight = animalsRes.rows.reduce((sum, r) => sum + (parseFloat(r.current_weight) || 0), 0) / animalsRes.rows.length;
    const animalIds = animalsRes.rows.map(r => r.id);

    const lastWeighRes = await client.query(
        `SELECT MAX(date) AS last_date FROM ba_weights WHERE animal_id = ANY($1::int[])`,
        [animalIds]
    );
    const lastWeighDate = lastWeighRes.rows[0].last_date || new Date().toISOString().split('T')[0];

    let currentTargetAdg = null;
    if (planId) {
        const bracketRes = await client.query(
            `SELECT target_adg FROM ba_ration_rows
             WHERE plan_id = $1 AND forage_type = $2 AND wt_min <= $3 AND wt_max + 1 > $3
             ORDER BY phase ASC LIMIT 1`,
            [planId, forageType, avgWeight]
        );
        if (bracketRes.rows.length > 0) currentTargetAdg = parseFloat(bracketRes.rows[0].target_adg);
    }

    return { lastActualWeightKg: avgWeight, lastWeighDate, currentTargetAdg };
}

// Re-runs recomputePenWeightCache and writes the result back to ba_pens — the same
// two steps LOG_WEIGHT already did inline. Pulled out so any action that changes a
// pen's animal roster (registering into a pen, moving an animal between pens) can
// keep the cache in sync too, not just weigh-ins: the cache depends on exactly two
// inputs (who's in the pen, and their weights), so a roster change is just as much
// a staleness trigger as a new weigh-in is. No-op for pens with no v2 plan_id yet,
// matching LOG_WEIGHT's existing gate.
async function refreshPenCache(client, penId) {
    if (!penId) return;
    const penInfoRes = await client.query('SELECT plan_id, forage_type FROM ba_pens WHERE id = $1', [penId]);
    const penInfo = penInfoRes.rows[0];
    if (!penInfo || !penInfo.plan_id) return;
    const cache = await recomputePenWeightCache(client, penId, penInfo.plan_id, penInfo.forage_type || 'silage');
    await client.query(`
        UPDATE ba_pens
        SET last_actual_weight_kg = $1, last_weigh_date = $2, current_target_adg = $3
        WHERE id = $4
    `, [cache.lastActualWeightKg, cache.lastWeighDate, cache.currentTargetAdg, penId]);
}

// Allowlist of ba_settings keys the client is permitted to write — keeps SAVE_SETTINGS
// from becoming an arbitrary key-value store for anything a compromised/buggy client
// happens to send.
const SETTINGS_KEYS = new Set([
    'breeds_config', 'med_categories', 'system_params', 'quarantine_protocols',
    'feed_ingredients', 'feed_stock_items', 'feed_opening_stock', 'mineral_split_ratio',
    'premix_types', 'premix_formulas', 'premix_batches'
]);
const SALES_ACTIONS = new Set([
    'UPDATE_ORDER_STATUS', 'DELETE_ORDER', 'UPDATE_ENQUIRY_STATUS', 'DELETE_ENQUIRY',
    'SAVE_QUOTATION', 'UPDATE_QUOTATION_STATUS', 'DELETE_QUOTATION',
    'SAVE_SPEC_SHEET', 'DELETE_SPEC_SHEET', 'ADD_MEAT_CUT', 'UPDATE_MEAT_CUT', 'DELETE_MEAT_CUT'
]);
const ADMIN_ONLY_ACTIONS = new Set(['RESET_DATABASE', 'UPDATE_STAFF_PERMISSIONS', 'DELETE_STAFF_PERMISSIONS', 'APPROVE_PENDING_CHANGE', 'REJECT_PENDING_CHANGE']);

// Insert 6 default meat cuts if ba_meat_cuts is empty
// Skips the whole ensureDefaultCuts/reconcile bootstrap pass on warm invocations of the
// same serverless container (the standard way to cache setup work in a Vercel/Lambda
// function). On a cold start this flag resets, but the actual expensive part — schema
// migrations — is now separately gated by CURRENT_SCHEMA_VERSION/ensureSchemaVersion
// above, so a cold start only re-runs ensureTables/ensureColumns when the persisted DB
// version is genuinely behind, not on every single cold start.
let schemaEnsured = false;

// Throttle for checkMissedFeeds — same warm-container caching idea as schemaEnsured,
// but time-based (30 min) rather than once-ever, since new feed logs land continuously.
let lastMissedFeedCheck = 0;

// Scans the last 14 days of ba_feed_logs for any pen/day where a split feeding (Morning/
// Evening, or Morning/Afternoon/Evening) never got fully logged — e.g. only the Morning
// feed was recorded and the Evening feed was missed — and raises a 'feed_missed' ba_events
// entry for it so it shows up in the Activity Feed, not just as a badge in the Feed & Growth
// Report. Today itself is excluded (the day isn't over, so a still-missing evening feed
// isn't necessarily "missed" yet). Fully idempotent: the whole 14-day window's feed_missed
// events are cleared and recomputed from scratch each run, so a late catch-up log or a
// newly-discovered gap both resolve correctly without needing to track what was seen before.
async function checkMissedFeeds(client) {
    const today = new Date().toISOString().split('T')[0];
    const windowStart = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const res = await client.query(`
        SELECT date, pen, array_agg(feeding_index) AS indexes, SUM(feeding_pct) AS logged_pct, MAX(num_feedings) AS num_feedings
        FROM ba_feed_logs
        WHERE date < $1 AND date >= $2
        GROUP BY date, pen
    `, [today, windowStart]);

    await client.query(`DELETE FROM ba_events WHERE event_type = 'feed_missed' AND date >= $1 AND date < $2`, [windowStart, today]);

    const SESSION_LABELS = { 2: ['Morning', 'Evening'], 3: ['Morning', 'Afternoon', 'Evening'] };

    for (const row of res.rows) {
        const numFeedings = parseInt(row.num_feedings || 1);
        const loggedPct = parseFloat(row.logged_pct || 0);
        if (numFeedings <= 1 || loggedPct >= 99.5) continue; // single full-day log, or fully covered split

        const loggedIndexes = new Set(row.indexes.map(i => parseInt(i)));
        const labels = SESSION_LABELS[numFeedings] || [];
        const missing = [];
        for (let i = 1; i <= numFeedings; i++) {
            if (!loggedIndexes.has(i)) missing.push(labels[i - 1] || `Feeding ${i}`);
        }
        if (missing.length === 0) continue;

        const note = `Pen ${row.pen} — only ${Math.round(loggedPct)}% of feed logged (missing: ${missing.join(', ')})`;
        await client.query(`
            INSERT INTO ba_events (animal_id, date, event_type, note)
            VALUES (NULL, $1, 'feed_missed', $2)
        `, [row.date, note]);
    }
}

async function ensureDefaultCuts(client) {
    const countRes = await client.query('SELECT COUNT(*) FROM ba_meat_cuts');
    const count = parseInt(countRes.rows[0].count, 10);
    if (count > 0) return;

    const cuts = [
        {
            id: 'ribeye',
            title: 'Sahiwal Prime Ribeye Steak',
            category: 'cuts',
            price: 2850,
            weight: '1.0 kg Pack (2 Steaks)',
            ribbon: 'Gourmet Cut',
            rfid: 'BA-RIB-901',
            marbling: 'Grade 4+ (Aged)',
            fat_ratio: '18% Fat Cap',
            images: ['assets/ribeye_steak.png'],
            description: 'Portion-cut from premium grain-finished Sahiwal cattle. Dry-aged for 21 days for supreme marbling, tenderness, and rich flavor.'
        },
        {
            id: 'tbone',
            title: 'Cholistani Gourmet T-Bone',
            category: 'cuts',
            price: 2650,
            weight: '1.2 kg Pack (2 Steaks)',
            ribbon: 'Gourmet Cut',
            rfid: 'BA-TBN-902',
            marbling: 'Grade 3+ (Premium)',
            fat_ratio: '14%',
            images: ['assets/tbone_steak.png'],
            description: 'Classic cut combining robust strip loin and tender tenderloin. Sourced from grass-fed Cholistani steers raised under medical surveillance.'
        },
        {
            id: 'striploin',
            title: 'Premium Angus Cross Striploin',
            category: 'cuts',
            price: 3100,
            weight: '1.0 kg Pack (3 Steaks)',
            ribbon: 'Gourmet Cut',
            rfid: 'BA-STR-903',
            marbling: 'Grade 5 (Supreme)',
            fat_ratio: '20%',
            images: ['assets/striploin_steak.png'],
            description: 'Angus cross cattle reared at Faisalabad. Offers unmatched juicy texture and a thick fat cap that renders beautifully on the grill.'
        },
        {
            id: 'minced',
            title: 'Organic Grass-Fed Minced Beef',
            category: 'cuts',
            price: 1850,
            weight: '1.0 kg Pack (Fine Ground)',
            ribbon: 'Fresh Minced',
            rfid: 'BA-MIN-904',
            marbling: 'Standard Lean',
            fat_ratio: '8%',
            images: ['assets/minced_beef.png'],
            description: 'Extra lean minced beef processed daily under strict sterile cold room conditions. Zero additives, pure organic ground chuck.'
        },
        {
            id: 'bong',
            title: 'Premium Beef Shank (Bong Cut)',
            category: 'cuts',
            price: 1950,
            weight: '1.5 kg Pack (Bone-in)',
            ribbon: 'Fresh Cut',
            rfid: 'BA-BNG-905',
            marbling: 'Lean & Marrow',
            fat_ratio: '10%',
            images: ['assets/bong_cut.png'],
            description: 'Traditional cross-cut shank featuring rich marrow bone. Ideal for slow cooking, stews, and traditional Nihari preparations.'
        },
        {
            id: 'patties',
            title: 'Gourmet Chuck Burger Patties',
            category: 'cuts',
            price: 1600,
            weight: '6 Patties (900g Total)',
            ribbon: 'Ready to Grill',
            rfid: 'BA-PAT-906',
            marbling: 'Burger Ratio 80/20',
            fat_ratio: '20%',
            images: ['assets/burger_patties.png'],
            description: 'House blend of 80% lean chuck and 20% premium brisket. Lightly seasoned and vacuum packed for instant grilling.'
        }
    ];

    for (const cut of cuts) {
        await client.query(`
            INSERT INTO ba_meat_cuts (id, title, category, price, weight, description, ribbon, rfid, marbling, fat_ratio, images)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            ON CONFLICT (id) DO NOTHING
        `, [
            cut.id, cut.title, cut.category, cut.price, cut.weight,
            cut.description, cut.ribbon, cut.rfid, cut.marbling,
            cut.fat_ratio, JSON.stringify(cut.images)
        ]);
    }
}

module.exports = async (req, res) => {
    // Inject CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    const session = verifySession(req);
    const isStaff = !!session;

    // Every mutation except the public checkout actions requires a valid staff session.
    if (req.method === 'POST') {
        const requestedAction = req.body && req.body.action;
        if (requestedAction && !PUBLIC_POST_ACTIONS.has(requestedAction) && !isStaff) {
            return res.status(401).json({ success: false, error: 'Unauthorized. Staff login required.' });
        }
    }

    // Resolve connection from environment secrets (Neon standard parameters)
    const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.bafarms_DATABASE_URL || process.env.bafarms_DATABASE_URL_UNPOOLED;

    if (!connectionString) {
        if (req.method === 'POST' && req.body && req.body.action === 'ADD_ORDER') {
            const { payload } = req.body;
            let emailSent = false;
            let emailError = null;

            try {
                const mailRes = await sendOrderEmail(payload);
                emailSent = !mailRes.simulated;
            } catch (mailErr) {
                console.error("Order email sending failure in unconfigured DB mode:", mailErr);
                emailError = mailErr.message;
            }

            return res.status(200).json({
                success: true,
                message: "Neon Database unconfigured. Order email processed.",
                emailSent,
                emailError,
                unconfigured: true
            });
        }

        return res.status(200).json({
            success: false,
            error: "Neon Database unconfigured. Falling back to local storage.",
            unconfigured: true
        });
    }

    const client = new Client({
        connectionString,
        ssl: { rejectUnauthorized: false }
    });

    try {
        await client.connect();

        // 1. Trigger database provisioning on-demand if tables/columns are missing — gated
        // on both the in-memory schemaEnsured flag (skips entirely on warm invocations) and
        // the persisted schema version (skips the expensive ensureTables/ensureColumns pass
        // on a cold start too, once the DB is already caught up — see ensureSchemaVersion).
        if (!schemaEnsured) {
            const dbSchemaVersion = await ensureSchemaVersion(client);
            if (dbSchemaVersion < CURRENT_SCHEMA_VERSION) {
                await ensureTables(client);
                await ensureColumns(client);
                await client.query('UPDATE ba_schema_version SET version = $1 WHERE id = 1', [CURRENT_SCHEMA_VERSION]);
            }
            await ensureDefaultCuts(client);
            await reconcileOrphanedFeedStockIssues(client);
            schemaEnsured = true;
        }

        // 1b. Re-scan recent feed logs for missed feedings at most once every 30 minutes
        // per warm container — cheap enough to run opportunistically on real requests
        // instead of needing a dedicated cron job.
        if (isStaff && Date.now() - lastMissedFeedCheck > 30 * 60 * 1000) {
            lastMissedFeedCheck = Date.now();
            await checkMissedFeeds(client);
        }

        // 2. Resolve this staff member's per-section access (null if unauthenticated)
        const perms = isStaff ? await resolvePermissions(client, session) : null;
        const canHerd = isStaff && !!(perms && (perms.isAdmin || perms.accessHerd));
        const canSales = isStaff && !!(perms && (perms.isAdmin || perms.accessSales));

        // ─── GET ENDPOINT: LOAD FULL DATABASE STATE ───
        if (req.method === 'GET') {
            // Format date objects to clean strings (YYYY-MM-DD). `pg` parses DATE
            // columns into a JS Date built from LOCAL Y/M/D components (not UTC) —
            // going through `.toISOString()` re-reads those same components via UTC
            // getters, which silently shifts the date back a day whenever the server
            // process's timezone isn't exactly UTC (the same bug class utils/dateOnly.js
            // was written to eliminate on the frontend). Reading back with local
            // getters instead makes this a lossless round trip no matter what timezone
            // the process happens to be running in.
            const formatDate = (dateStr) => {
                if (!dateStr) return '';
                if (typeof dateStr === 'string') {
                    const m = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
                    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
                }
                const d = dateStr instanceof Date ? dateStr : new Date(dateStr);
                if (isNaN(d.getTime())) return '';
                const year = d.getFullYear();
                const month = String(d.getMonth() + 1).padStart(2, '0');
                const day = String(d.getDate()).padStart(2, '0');
                return `${year}-${month}-${day}`;
            };

            // Public order-tracking lookup: returns a single order by its reference ID
            // without requiring a staff session and without exposing every other
            // customer's order history in the process.
            if (req.query && req.query.orderId) {
                const orderRes = await client.query('SELECT * FROM ba_orders WHERE id = $1', [req.query.orderId]);
                if (orderRes.rows.length === 0) {
                    return res.status(404).json({ success: false, error: 'Order not found' });
                }
                const row = orderRes.rows[0];
                return res.status(200).json({
                    success: true,
                    order: {
                        id: row.id,
                        customerName: row.customer_name,
                        customerPhone: row.customer_phone,
                        customerEmail: row.customer_email,
                        customerCity: row.customer_city,
                        customerAddress: row.customer_address,
                        items: row.items,
                        netTotal: parseFloat(row.net_total),
                        status: row.status,
                        hasLive: row.has_live,
                        qurbaniService: row.qurbani_service,
                        paymentMethod: row.payment_method,
                        date: formatDate(row.date)
                    }
                });
            }

            // All ~20 of these are independent reads (nothing here depends on another
            // query's result), but were previously each `await`-ed one at a time —
            // every one paying the full network round trip to Neon before the next
            // was even sent, which alone was several seconds of pure wait on every
            // page load. Firing them all at once (still over the same single Client,
            // which pipelines/queues them in order server-side) collapses that down
            // to roughly the slowest single query instead of the sum of all of them.
            const EMPTY = Promise.resolve({ rows: [] });
            const [
                animalsRes, weightsRes, treatmentsRes, eventsRes, feedLogsRes,
                rationPlansRes, rationPlansV2Res, rationRowsRes, rationRowItemsRes,
                pensRes, settingsRes, feedPurchasesRes, feedStockIssuesRes, ordersRes,
                meatCutsRes, enquiriesRes, quotationsRes, specSheetsRes, staffPermsRes,
                pendingApprovalsRes, myRequestsRes, allApprovalsRes, overheadExpensesRes
            ] = await Promise.all([
                client.query('SELECT * FROM ba_animals ORDER BY id ASC'),
                canHerd ? client.query('SELECT * FROM ba_weights ORDER BY date ASC, id ASC') : EMPTY,
                canHerd ? client.query('SELECT * FROM ba_treatments ORDER BY date ASC, id ASC') : EMPTY,
                canHerd ? client.query('SELECT * FROM ba_events ORDER BY date ASC, id ASC') : EMPTY,
                canHerd ? client.query('SELECT * FROM ba_feed_logs ORDER BY date DESC, pen ASC, feeding_index ASC') : EMPTY,
                canHerd ? client.query('SELECT * FROM ba_ration_plans ORDER BY created_at ASC') : EMPTY,
                canHerd ? client.query('SELECT * FROM ba_ration_plans_v2 ORDER BY plan_key ASC, version ASC') : EMPTY,
                canHerd ? client.query('SELECT * FROM ba_ration_rows ORDER BY plan_id ASC, forage_type ASC, phase ASC, day_no ASC, wt_min ASC') : EMPTY,
                canHerd ? client.query('SELECT * FROM ba_ration_row_items ORDER BY row_id ASC') : EMPTY,
                canHerd ? client.query('SELECT * FROM ba_pens ORDER BY id ASC') : EMPTY,
                canHerd ? client.query('SELECT key, value FROM ba_settings') : EMPTY,
                canHerd ? client.query('SELECT * FROM ba_feed_purchases ORDER BY date DESC, created_at DESC') : EMPTY,
                canHerd ? client.query('SELECT * FROM ba_feed_stock_issues ORDER BY date DESC, created_at DESC') : EMPTY,
                canSales ? client.query('SELECT * FROM ba_orders ORDER BY created_at DESC') : EMPTY,
                client.query('SELECT * FROM ba_meat_cuts ORDER BY created_at ASC'),
                canSales ? client.query('SELECT * FROM ba_export_enquiries ORDER BY created_at DESC') : EMPTY,
                canSales ? client.query('SELECT * FROM ba_quotations ORDER BY id DESC') : EMPTY,
                canSales ? client.query('SELECT * FROM ba_spec_sheets ORDER BY doc_ref DESC') : EMPTY,
                client.query('SELECT email, is_admin, access_sales, access_herd FROM ba_staff_permissions ORDER BY is_admin DESC, email ASC'),
                // Super-admin's review queue: every open request from any staff member,
                // regardless of who's logged in — this is what the login-triggered
                // approval popup is built from. animal_rfid/animal_breed are read
                // straight off ba_pending_approvals (captured at request time) rather
                // than joined live to ba_animals, so they still display correctly for
                // an approved deletion, where the animal itself is already gone.
                (isStaff && perms && perms.isAdmin) ? client.query(`SELECT * FROM ba_pending_approvals WHERE status = 'pending' ORDER BY requested_at ASC`) : EMPTY,
                // A staff member's own recent requests (any status) — lets a non-admin
                // who submitted a sensitive-field edit or delete request see whether
                // it's still pending, was approved, or was rejected (and why).
                (isStaff && canHerd)
                    ? client.query(`SELECT * FROM ba_pending_approvals WHERE requested_by = $1 ORDER BY requested_at DESC LIMIT 30`, [session.email.toLowerCase().trim()])
                    : EMPTY,
                // Super-admin's all-time approval history (any status) — backs the
                // searchable "Approvals" audit tab in Settings, separate from the live
                // pendingApprovals queue above which only ever shows open requests.
                (isStaff && perms && perms.isAdmin) ? client.query(`SELECT * FROM ba_pending_approvals ORDER BY requested_at DESC LIMIT 500`) : EMPTY,
                canHerd ? client.query('SELECT * FROM ba_overhead_expenses ORDER BY date DESC, created_at DESC') : EMPTY
            ]);

            const animals = animalsRes.rows.map(row => ({
                id: row.id,
                rfid: row.rfid,
                breed: row.breed,
                entryDate: formatDate(row.entry_date),
                entryWeight: parseFloat(row.entry_weight),
                currentWeight: parseFloat(row.current_weight),
                targetWeight: parseFloat(row.target_weight),
                purchasePrice: parseFloat(row.purchase_price),
                source: row.source,
                status: row.status,
                salePrice: row.sale_price ? parseFloat(row.sale_price) : null,
                buyerName: row.buyer_name || null,
                saleDate: row.sale_date ? formatDate(row.sale_date) : null,
                deceasedDate: row.deceased_date ? formatDate(row.deceased_date) : null,
                deceasedCause: row.deceased_cause || null,
                pen: row.pen || null,
                price: row.price ? parseFloat(row.price) : null,
                desc: row.description || null,
                images: row.images ? JSON.parse(row.images) : null,
                previousTags: row.previous_tags ? (typeof row.previous_tags === 'string' ? (row.previous_tags.startsWith('[') ? JSON.parse(row.previous_tags) : [row.previous_tags]) : row.previous_tags) : [],
                mandiPrice: row.mandi_price ? parseFloat(row.mandi_price) : null,
                mandiWeight: row.mandi_weight ? parseFloat(row.mandi_weight) : null,
                mandiTax: row.mandi_tax ? parseFloat(row.mandi_tax) : null,
                carriage: row.carriage ? parseFloat(row.carriage) : null,
                miscExpense: row.misc_expense ? parseFloat(row.misc_expense) : null
            }));

            const weightLogs = weightsRes.rows.map(row => ({
                id: row.id,
                animalId: row.animal_id,
                date: formatDate(row.date),
                weight: parseFloat(row.weight),
                adg: parseFloat(row.adg || 0),
                createdBy: row.created_by || null
            }));

            const treatments = treatmentsRes.rows.map(row => ({
                id: row.id,
                animalId: row.animal_id,
                date: formatDate(row.date),
                type: row.type,
                medicine: row.medicine,
                dosage: row.dosage,
                withholding: parseInt(row.withholding || 0),
                protocolTaskId: row.protocol_task_id || null,
                stockIssueId: row.stock_issue_id || null,
                createdBy: row.created_by || null,
                notes: row.notes || ''
            }));

            const events = eventsRes.rows.map(row => ({
                id: row.id,
                animalId: row.animal_id,
                date: formatDate(row.date),
                eventType: row.event_type,
                note: row.note,
                fromPen: row.from_pen,
                toPen: row.to_pen,
                createdBy: row.created_by || null
            }));

            const feedLogs = feedLogsRes.rows.map(row => ({
                id: row.id,
                date: formatDate(row.date),
                pen: row.pen,
                animalCount: parseInt(row.animal_count || 0),
                ingredients: typeof row.ingredients === 'string' ? JSON.parse(row.ingredients) : row.ingredients,
                totalDmKg: parseFloat(row.total_dm_kg || 0),
                totalBatchKg: parseFloat(row.total_batch_kg || 0),
                totalCost: parseFloat(row.total_cost || 0),
                costPerAnimal: parseFloat(row.cost_per_animal || 0),
                notes: row.notes || '',
                dietDiffered: !!row.diet_differed,
                feedingIndex: parseInt(row.feeding_index || 0),
                numFeedings: parseInt(row.num_feedings || 1),
                feedingPct: parseFloat(row.feeding_pct || 100),
                feedingTime: row.feeding_time || (row.created_at ? new Date(row.created_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }) : null),
                createdBy: row.created_by || null,
                createdAt: row.created_at || null
            }));

            const rationPlans = rationPlansRes.rows.map(row => ({
                id: row.id,
                name: row.name,
                description: row.description || '',
                adgFloor: parseFloat(row.adg_floor || 1.0),
                weeks: typeof row.weeks === 'string' ? JSON.parse(row.weeks) : row.weeks,
                adaptation: (typeof row.adaptation === 'string' ? JSON.parse(row.adaptation) : row.adaptation) || [],
                ingredientPrices: (typeof row.ingredient_prices === 'string' ? JSON.parse(row.ingredient_prices) : row.ingredient_prices) || {},
                wandaStockItemId: row.wanda_stock_item_id || null,
                isDefault: row.is_default,
                createdBy: row.created_by || null
            }));

            const pens = pensRes.rows.map(row => ({
                id: row.id,
                rationPlanId: row.ration_plan_id || null,
                planId: row.plan_id || null,
                cycleStartDate: row.cycle_start_date ? formatDate(row.cycle_start_date) : null,
                forageType: row.forage_type || 'silage',
                expectedExitDate: row.expected_exit_date ? formatDate(row.expected_exit_date) : null,
                lastActualWeightKg: row.last_actual_weight_kg !== null ? parseFloat(row.last_actual_weight_kg) : null,
                lastWeighDate: row.last_weigh_date ? formatDate(row.last_weigh_date) : null,
                currentTargetAdg: row.current_target_adg !== null ? parseFloat(row.current_target_adg) : null,
                notes: row.notes || ''
            }));

            const rationPlansV2 = rationPlansV2Res.rows.map(row => ({
                id: row.id,
                planKey: row.plan_key,
                version: row.version,
                name: row.name,
                adaptationDays: row.adaptation_days,
                adgFloor: parseFloat(row.adg_floor || 1.0),
                isDefault: row.is_default,
                createdBy: row.created_by || null
            }));

            const rationRows = rationRowsRes.rows.map(row => ({
                id: row.id,
                planId: row.plan_id,
                phase: row.phase,
                dayNo: row.day_no !== null ? parseInt(row.day_no, 10) : null,
                forageType: row.forage_type,
                wtMin: parseFloat(row.wt_min),
                wtMax: parseFloat(row.wt_max),
                targetAdg: parseFloat(row.target_adg),
                estCostPerHeadPerDay: row.est_cost_per_head_per_day !== null ? parseFloat(row.est_cost_per_head_per_day) : null
            }));

            const rationRowItems = rationRowItemsRes.rows.map(row => ({
                id: row.id,
                rowId: row.row_id,
                ingredientId: row.ingredient_id,
                qtyKgPerHeadPerDay: parseFloat(row.qty_kg_per_head_per_day)
            }));

            const settings = {};
            settingsRes.rows.forEach(row => {
                settings[row.key] = typeof row.value === 'string' ? JSON.parse(row.value) : row.value;
            });

            const feedPurchases = feedPurchasesRes.rows.map(row => ({
                id: row.id,
                itemId: row.item_id,
                itemName: row.item_name || null,
                itemUnit: row.item_unit || null,
                date: formatDate(row.date),
                quantity: parseFloat(row.quantity || 0),
                rate: parseFloat(row.rate || 0),
                supplier: row.supplier || '',
                notes: row.notes || '',
                createdBy: row.created_by || null,
                createdAt: row.created_at || null
            }));

            const feedStockIssues = feedStockIssuesRes.rows.map(row => ({
                id: row.id,
                itemId: row.item_id,
                itemName: row.item_name || null,
                itemUnit: row.item_unit || null,
                date: formatDate(row.date),
                pen: row.pen,
                quantity: parseFloat(row.quantity || 0),
                lotId: row.lot_id || null,
                notes: row.notes || '',
                createdBy: row.created_by || null,
                createdAt: row.created_at || null
            }));

            const overheadExpenses = overheadExpensesRes.rows.map(row => ({
                id: row.id,
                date: formatDate(row.date),
                category: row.category,
                description: row.description || '',
                amount: parseFloat(row.amount || 0),
                createdBy: row.created_by || null,
                createdAt: row.created_at || null
            }));

            const orders = ordersRes.rows.map(row => ({
                id: row.id,
                customerName: row.customer_name,
                customerPhone: row.customer_phone,
                customerEmail: row.customer_email,
                customerCity: row.customer_city,
                customerAddress: row.customer_address,
                items: row.items,
                netTotal: parseFloat(row.net_total),
                status: row.status,
                hasLive: row.has_live,
                qurbaniService: row.qurbani_service,
                paymentMethod: row.payment_method,
                date: formatDate(row.date)
            }));

            const meatCuts = meatCutsRes.rows.map(row => ({
                id: row.id,
                title: row.title,
                category: row.category,
                price: parseFloat(row.price),
                weight: row.weight,
                desc: row.description,
                ribbon: row.ribbon,
                rfid: row.rfid,
                marbling: row.marbling,
                fatRatio: row.fat_ratio,
                images: row.images
            }));

            const enquiries = enquiriesRes.rows.map(row => ({
                id: row.id,
                company: row.company,
                contact: row.contact,
                email: row.email,
                phone: row.phone,
                country: row.country,
                cutType: row.cut_type,
                volumeMt: parseFloat(row.volume_mt),
                frequency: row.frequency,
                notes: row.notes,
                status: row.status,
                createdAt: formatDate(row.created_at)
            }));

            const quotations = quotationsRes.rows.map(row => ({
                id: row.id,
                clientName: row.client_name,
                incotermBasis: row.incoterm_basis,
                scope: row.scope,
                targetDestination: row.target_destination || '',
                targetDestinations: row.target_destinations || '',
                validity: row.validity || '',
                terms: typeof row.terms === 'string' ? JSON.parse(row.terms) : row.terms,
                preparerName: row.preparer_name || '',
                preparerTitle: row.preparer_title || '',
                preparerPhone: row.preparer_phone || '',
                products: typeof row.products === 'string' ? JSON.parse(row.products) : row.products,
                status: row.status || 'Sent',
                createdAt: formatDate(row.created_at)
            }));

            const specSheets = specSheetsRes.rows.map(row => ({
                clientName: row.client_name || '',
                docRef: row.doc_ref,
                docDate: formatDate(row.doc_date),
                idName: row.id_name || '',
                idCategory: row.id_category || '',
                idSpec: row.id_spec || '',
                idHs: row.id_hs || '',
                idSku: row.id_sku || '',
                originCountry: row.origin_country || '',
                originSupply: row.origin_supply || '',
                originBreed: row.origin_breed || '',
                originFeed: row.origin_feed || '',
                originAge: row.origin_age || '',
                specForm: row.spec_form || '',
                specWeight: row.spec_weight || '',
                specColor: row.spec_color || '',
                specPh: row.spec_ph || '',
                specTrim: row.spec_trim || '',
                specBone: row.spec_bone || '',
                packPrimary: row.pack_primary || '',
                packSecondary: row.pack_secondary || '',
                packPieces: row.pack_pieces || '',
                packWeight: row.pack_weight || '',
                packLabelling: row.pack_labelling || '',
                storeTemp: row.store_temp || '',
                storeLife: row.store_life || '',
                createdAt: formatDate(row.created_at)
            }));

            const staffPermissions = staffPermsRes.rows.map(r => ({
                email: r.email,
                isAdmin: r.is_admin,
                accessSales: r.access_sales,
                accessHerd: r.access_herd
            }));

            const mapApproval = (row) => ({
                id: row.id,
                action: row.action,
                animalId: row.animal_id,
                animalRfid: row.animal_rfid || null,
                animalBreed: row.animal_breed || null,
                payload: row.payload,
                previousSnapshot: row.previous_snapshot,
                requestedBy: row.requested_by,
                requestedAt: row.requested_at,
                status: row.status,
                reviewedBy: row.reviewed_by || null,
                reviewedAt: row.reviewed_at || null,
                reviewNote: row.review_note || null
            });
            const pendingApprovals = pendingApprovalsRes.rows.map(mapApproval);
            const myRequests = myRequestsRes.rows.map(mapApproval);
            const allApprovals = allApprovalsRes.rows.map(mapApproval);

            const sessionOut = isStaff ? {
                name: session.name,
                email: session.email,
                picture: session.picture,
                role: session.role,
                isAdmin: !!(perms && perms.isAdmin),
                accessSales: canSales,
                accessHerd: canHerd
            } : null;

            return res.status(200).json({ success: true, animals, weightLogs, treatments, events, feedLogs, rationPlans, rationPlansV2, rationRows, rationRowItems, pens, settings, feedPurchases, feedStockIssues, overheadExpenses, orders, meatCuts, enquiries, quotations, specSheets, session: sessionOut, staffPermissions, pendingApprovals, myRequests, allApprovals });
        }

        // ─── POST ENDPOINT: LOG TRANSACTION DATA ───
        if (req.method === 'POST') {
            const { action, payload } = req.body;
            const userEmail = session && session.email ? session.email.toLowerCase().trim() : null;

            if (!action) {
                return res.status(400).json({ success: false, error: "Action is required" });
            }

            // Fine-grained section gating (Sales vs Herd Management vs admin-only), on top
            // of the coarse staff-session check above. Public checkout actions are exempt.
            if (isStaff && !PUBLIC_POST_ACTIONS.has(action)) {
                const isAdmin = !!(perms && perms.isAdmin);
                if (ADMIN_ONLY_ACTIONS.has(action) && !isAdmin) {
                    return res.status(403).json({ success: false, error: 'Admin access required for this action.' });
                }
                if (HERD_ACTIONS.has(action) && !isAdmin && !(perms && perms.accessHerd)) {
                    return res.status(403).json({ success: false, error: 'You do not have access to Herd Management.' });
                }
                if (SALES_ACTIONS.has(action) && !isAdmin && !(perms && perms.accessSales)) {
                    return res.status(403).json({ success: false, error: 'You do not have access to Sales.' });
                }
            }

            if (action === 'UPDATE_STAFF_PERMISSIONS') {
                const { email, isAdmin, accessSales, accessHerd } = payload;
                if (!email) {
                    return res.status(400).json({ success: false, error: "Email is required" });
                }
                await client.query(`
                    INSERT INTO ba_staff_permissions (email, is_admin, access_sales, access_herd, updated_at)
                    VALUES ($1, $2, $3, $4, NOW())
                    ON CONFLICT (email) DO UPDATE SET
                        is_admin = EXCLUDED.is_admin,
                        access_sales = EXCLUDED.access_sales,
                        access_herd = EXCLUDED.access_herd,
                        updated_at = NOW()
                `, [email.toLowerCase().trim(), !!isAdmin, accessSales !== false, accessHerd !== false]);
                return res.status(200).json({ success: true });
            }

            if (action === 'DELETE_STAFF_PERMISSIONS') {
                const { email } = payload;
                if (!email) {
                    return res.status(400).json({ success: false, error: "Email is required" });
                }
                await client.query('DELETE FROM ba_staff_permissions WHERE LOWER(email) = $1', [email.toLowerCase().trim()]);
                return res.status(200).json({ success: true });
            }

            if (action === 'ADD_ANIMAL') {
                const { rfid, breed, entryDate, entryWeight, targetWeight, purchasePrice, source, status, pen, price, desc, images, mandiPrice, mandiWeight, mandiTax, carriage, miscExpense } = payload;

                const animalRes = await client.query(`
                    INSERT INTO ba_animals (rfid, breed, entry_date, entry_weight, current_weight, target_weight, purchase_price, source, status, pen, price, description, images, mandi_price, mandi_weight, mandi_tax, carriage, misc_expense)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
                    RETURNING *
                `, [
                    rfid, breed, entryDate, entryWeight, entryWeight, targetWeight, purchasePrice, source, status, pen || null,
                    price || null, desc || null, images ? JSON.stringify(images) : null,
                    mandiPrice ? parseFloat(mandiPrice) : null,
                    mandiWeight ? parseFloat(mandiWeight) : null,
                    mandiTax ? parseFloat(mandiTax) : null,
                    carriage ? parseFloat(carriage) : null,
                    miscExpense ? parseFloat(miscExpense) : null
                ]);

                const animal = animalRes.rows[0];

                // Create initial entry scale
                await client.query(`
                    INSERT INTO ba_weights (animal_id, date, weight, adg, created_by)
                    VALUES ($1, $2, $3, 0, $4)
                `, [animal.id, entryDate, entryWeight, userEmail]);

                // Log registration event — to_pen records which pen this animal actually
                // entered on entryDate, so the pen-membership ledger below can tell it
                // apart from animals added to the pen later.
                await client.query(`
                    INSERT INTO ba_events (animal_id, date, event_type, note, to_pen, created_by)
                    VALUES ($1, $2, 'registered', $3, $4, $5)
                `, [animal.id, entryDate, `Registered — ${breed}, ${entryWeight}kg, ${status}`, pen || null, userEmail]);

                // Registering straight into a pen changes that pen's roster/avg weight
                // just as much as a weigh-in does — keep the ration engine's cache in sync.
                await refreshPenCache(client, pen || null);

                return res.status(200).json({ success: true, animalId: animal.id });
            }

            if (action === 'LOG_WEIGHT') {
                const { animalId, date, weight, adg } = payload;

                await client.query(`
                    INSERT INTO ba_weights (animal_id, date, weight, adg, created_by)
                    VALUES ($1, $2, $3, $4, $5)
                `, [animalId, date, weight, adg, userEmail]);

                await client.query(`
                    UPDATE ba_animals
                    SET current_weight = $1
                    WHERE id = $2
                `, [weight, animalId]);

                // Keep the owning pen's v2 weight-projection cache (used by the ration
                // resolution engine) in sync with every new weigh-in — otherwise the
                // pen's projected weight would silently drift stale between weigh-ins.
                const penRes = await client.query('SELECT pen FROM ba_animals WHERE id = $1', [animalId]);
                await refreshPenCache(client, penRes.rows[0]?.pen);

                return res.status(200).json({ success: true });
            }

            if (action === 'LOG_TREATMENT') {
                const { animalId, date, type, medicine, dosage, withholding, protocolTaskId, stockIssueId, notes } = payload;

                await client.query(`
                    INSERT INTO ba_treatments (animal_id, date, type, medicine, dosage, withholding, protocol_task_id, stock_issue_id, created_by, notes)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                `, [animalId, date, type, medicine, dosage, withholding, protocolTaskId || null, stockIssueId || null, userEmail, notes || null]);

                return res.status(200).json({ success: true });
            }

            if (action === 'TRANSITION_STATUS') {
                const { animalId, status, date, note } = payload;

                await client.query(`
                    UPDATE ba_animals
                    SET status = $1
                    WHERE id = $2
                `, [status, animalId]);

                await client.query(`
                    INSERT INTO ba_events (animal_id, date, event_type, note, created_by)
                    VALUES ($1, $2, $3, $4, $5)
                `, [animalId, date || new Date().toISOString().split('T')[0], 'status_change', note || status, userEmail]);

                return res.status(200).json({ success: true });
            }

            if (action === 'LOG_EVENT') {
                const { animalId, date, eventType, note } = payload;
                await client.query(`
                    INSERT INTO ba_events (animal_id, date, event_type, note, created_by)
                    VALUES ($1, $2, $3, $4, $5)
                `, [animalId, date, eventType, note, userEmail]);
                return res.status(200).json({ success: true });
            }

            if (action === 'DELETE_ANIMAL') {
                const { animalId } = payload;
                const isAdmin = !!(perms && perms.isAdmin);

                // Non-super-admins can't hard-delete an animal — stage a delete request
                // for a super admin to approve instead of touching ba_animals at all.
                if (!isAdmin) {
                    const existingPending = await client.query(
                        `SELECT id FROM ba_pending_approvals WHERE animal_id = $1 AND action = 'DELETE_ANIMAL' AND status = 'pending'`,
                        [animalId]
                    );
                    if (existingPending.rows.length === 0) {
                        const animalRes = await client.query('SELECT * FROM ba_animals WHERE id = $1', [animalId]);
                        if (animalRes.rows.length === 0) {
                            return res.status(404).json({ success: false, error: 'Animal not found.' });
                        }
                        await client.query(`
                            INSERT INTO ba_pending_approvals (action, animal_id, animal_rfid, animal_breed, payload, previous_snapshot, requested_by)
                            VALUES ('DELETE_ANIMAL', $1, $2, $3, NULL, $4, $5)
                        `, [animalId, animalRes.rows[0].rfid, animalRes.rows[0].breed, JSON.stringify(animalRes.rows[0]), session.email.toLowerCase().trim()]);
                    }
                    return res.status(200).json({ success: true, pending: true });
                }

                await client.query('DELETE FROM ba_animals WHERE id = $1', [animalId]);
                return res.status(200).json({ success: true });
            }

            if (action === 'UPDATE_ANIMAL') {
                const { id, rfid, breed, entryDate, entryWeight, targetWeight, purchasePrice, source, status, pen, price, desc, images } = payload;
                const isAdmin = !!(perms && perms.isAdmin);

                const currentRes = await client.query('SELECT * FROM ba_animals WHERE id = $1', [id]);
                if (currentRes.rows.length === 0) {
                    return res.status(404).json({ success: false, error: 'Animal not found.' });
                }
                const current = currentRes.rows[0];

                // Every UPDATE below runs as a full-row write, so any field missing from
                // payload (e.g. the activity log's Undo button, which only ever sends
                // { id, pen } or { id, status }) must fall back to the row's existing
                // value instead of nulling it out — several columns (rfid, breed,
                // entry_date, target_weight, status) are NOT NULL, so a naive partial
                // payload used to hard-fail the whole update (or silently null the
                // nullable columns) on every pen-transfer/status undo.
                const finalRfid = rfid !== undefined ? rfid : current.rfid;
                const finalBreed = breed !== undefined ? breed : current.breed;
                const finalEntryDate = entryDate !== undefined ? entryDate : current.entry_date;
                const finalEntryWeight = entryWeight !== undefined ? parseFloat(entryWeight) : parseFloat(current.entry_weight);
                const finalTargetWeight = targetWeight !== undefined ? targetWeight : current.target_weight;
                const finalPurchasePrice = purchasePrice !== undefined ? parseFloat(purchasePrice) : parseFloat(current.purchase_price);
                const finalSource = source !== undefined ? source : current.source;
                const finalStatus = status !== undefined ? status : current.status;
                const finalPen = pen !== undefined ? (pen || null) : current.pen;
                const finalPrice = price !== undefined ? (price || null) : current.price;
                const finalDesc = desc !== undefined ? (desc || null) : current.description;
                const finalImages = images !== undefined ? images : current.images;
                const finalMandiPrice = mandiPrice !== undefined ? (mandiPrice ? parseFloat(mandiPrice) : null) : (current.mandi_price ? parseFloat(current.mandi_price) : null);
                const finalMandiWeight = mandiWeight !== undefined ? (mandiWeight ? parseFloat(mandiWeight) : null) : (current.mandi_weight ? parseFloat(current.mandi_weight) : null);
                const finalMandiTax = mandiTax !== undefined ? (mandiTax ? parseFloat(mandiTax) : null) : (current.mandi_tax ? parseFloat(current.mandi_tax) : null);
                const finalCarriage = carriage !== undefined ? (carriage ? parseFloat(carriage) : null) : (current.carriage ? parseFloat(current.carriage) : null);
                const finalMiscExpense = miscExpense !== undefined ? (miscExpense ? parseFloat(miscExpense) : null) : (current.misc_expense ? parseFloat(current.misc_expense) : null);

                const entryWeightChanged = finalEntryWeight !== parseFloat(current.entry_weight);
                const purchasePriceChanged = finalPurchasePrice !== parseFloat(current.purchase_price);
                // Moving an animal in/out of a pen changes both pens' rosters — refresh
                // whichever pen(s) actually changed after the write below (same staleness
                // trigger as ADD_ANIMAL/LOG_WEIGHT; a same-pen no-op save shouldn't recompute).
                const oldPen = current.pen;
                const newPen = finalPen;
                const penChanged = oldPen !== newPen;

                const rfidChanged = Boolean(current.rfid && finalRfid && current.rfid.trim() !== finalRfid.trim());
                let finalPreviousTags = current.previous_tags;
                try {
                    let tagsList = current.previous_tags ? (typeof current.previous_tags === 'string' ? JSON.parse(current.previous_tags) : current.previous_tags) : [];
                    if (!Array.isArray(tagsList)) tagsList = [];
                    if (rfidChanged && !tagsList.includes(current.rfid.trim())) {
                        tagsList.push(current.rfid.trim());
                        finalPreviousTags = JSON.stringify(tagsList);
                    }
                } catch (e) {
                    if (rfidChanged) {
                        finalPreviousTags = JSON.stringify([current.rfid.trim()]);
                    }
                }

                // Non-super-admins can't directly overwrite purchase price or entry (gross)
                // weight — those two fields are queued for super-admin approval instead.
                // Every other field (breed, source, status, pen, target weight, dates,
                // listing price/desc/images) still saves immediately for any staff member
                // with Herd access, same as before.
                if (!isAdmin && (entryWeightChanged || purchasePriceChanged)) {
                    const changes = {};
                    if (entryWeightChanged) changes.entryWeight = finalEntryWeight;
                    if (purchasePriceChanged) changes.purchasePrice = finalPurchasePrice;

                    const existingPending = await client.query(
                        `SELECT id FROM ba_pending_approvals WHERE animal_id = $1 AND action = 'UPDATE_ANIMAL' AND status = 'pending'`,
                        [id]
                    );
                    if (existingPending.rows.length === 0) {
                        await client.query(`
                            INSERT INTO ba_pending_approvals (action, animal_id, animal_rfid, animal_breed, payload, previous_snapshot, requested_by)
                            VALUES ('UPDATE_ANIMAL', $1, $2, $3, $4, $5, $6)
                        `, [
                            id, finalRfid, finalBreed, JSON.stringify(changes),
                            JSON.stringify({ entryWeight: parseFloat(current.entry_weight), purchasePrice: parseFloat(current.purchase_price) }),
                            session.email.toLowerCase().trim()
                        ]);
                    }

                    await client.query(`
                        UPDATE ba_animals
                        SET rfid = $1, breed = $2, entry_date = $3, target_weight = $4, source = $5, status = $6, pen = $7, price = $8, description = $9, images = $10, previous_tags = $11, mandi_price = $12, mandi_weight = $13, mandi_tax = $14, carriage = $15, misc_expense = $16
                        WHERE id = $17
                    `, [finalRfid, finalBreed, finalEntryDate, finalTargetWeight, finalSource, finalStatus, finalPen, finalPrice, finalDesc, finalImages ? JSON.stringify(finalImages) : null, finalPreviousTags, finalMandiPrice, finalMandiWeight, finalMandiTax, finalCarriage, finalMiscExpense, id]);

                    if (penChanged) {
                        await refreshPenCache(client, oldPen);
                        await refreshPenCache(client, newPen);
                        await client.query(`
                            INSERT INTO ba_events (animal_id, date, event_type, note, from_pen, to_pen, created_by)
                            VALUES ($1, $2, 'pen_transfer', $3, $4, $5, $6)
                        `, [id, new Date().toISOString().split('T')[0], `Moved Pen ${oldPen || 'Unassigned'} → Pen ${newPen || 'Unassigned'}`, oldPen, newPen, userEmail]);
                    }

                    if (rfidChanged) {
                        await client.query(`
                            INSERT INTO ba_events (animal_id, date, event_type, note, created_by)
                            VALUES ($1, $2, 'tag_replacement', $3, $4)
                        `, [id, new Date().toISOString().split('T')[0], `Ear tag updated: Tag ${current.rfid} → Tag ${finalRfid} (Tag replacement)`, userEmail]);
                    }

                    return res.status(200).json({ success: true, pending: true, pendingFields: Object.keys(changes) });
                }

                await client.query(`
                    UPDATE ba_animals
                    SET rfid = $1, breed = $2, entry_date = $3, entry_weight = $4, target_weight = $5, purchase_price = $6, source = $7, status = $8, pen = $9, price = $10, description = $11, images = $12, previous_tags = $13, mandi_price = $14, mandi_weight = $15, mandi_tax = $16, carriage = $17, misc_expense = $18
                    WHERE id = $19
                `, [
                    finalRfid, finalBreed, finalEntryDate, finalEntryWeight, finalTargetWeight, finalPurchasePrice, finalSource, finalStatus, finalPen,
                    finalPrice, finalDesc, finalImages ? JSON.stringify(finalImages) : null, finalPreviousTags, finalMandiPrice, finalMandiWeight,
                    finalMandiTax, finalCarriage, finalMiscExpense,
                    id
                ]);

                if (penChanged) {
                    await refreshPenCache(client, oldPen);
                    await refreshPenCache(client, newPen);
                    await client.query(`
                        INSERT INTO ba_events (animal_id, date, event_type, note, from_pen, to_pen, created_by)
                        VALUES ($1, $2, 'pen_transfer', $3, $4, $5, $6)
                    `, [id, new Date().toISOString().split('T')[0], `Moved Pen ${oldPen || 'Unassigned'} → Pen ${newPen || 'Unassigned'}`, oldPen, newPen, userEmail]);
                }

                if (rfidChanged) {
                    await client.query(`
                        INSERT INTO ba_events (animal_id, date, event_type, note, created_by)
                        VALUES ($1, $2, 'tag_replacement', $3, $4)
                    `, [id, new Date().toISOString().split('T')[0], `Ear tag updated: Tag ${current.rfid} → Tag ${finalRfid} (Tag replacement)`, userEmail]);
                }

                return res.status(200).json({ success: true });
            }

            if (action === 'APPROVE_PENDING_CHANGE') {
                const { approvalId } = payload;
                const appRes = await client.query(`SELECT * FROM ba_pending_approvals WHERE id = $1 AND status = 'pending'`, [approvalId]);
                if (appRes.rows.length === 0) {
                    return res.status(404).json({ success: false, error: 'Request not found or already resolved.' });
                }
                const approval = appRes.rows[0];
                const changes = typeof approval.payload === 'string' ? JSON.parse(approval.payload) : approval.payload;
                const today = new Date().toISOString().split('T')[0];

                if (approval.action === 'UPDATE_ANIMAL') {
                    const sets = [];
                    const vals = [];
                    let i = 1;
                    if (changes && changes.entryWeight !== undefined) { sets.push(`entry_weight = $${i++}`); vals.push(changes.entryWeight); }
                    if (changes && changes.purchasePrice !== undefined) { sets.push(`purchase_price = $${i++}`); vals.push(changes.purchasePrice); }
                    if (sets.length > 0) {
                        vals.push(approval.animal_id);
                        await client.query(`UPDATE ba_animals SET ${sets.join(', ')} WHERE id = $${i}`, vals);
                    }

                    // Permanent audit trail entry on the animal's own activity timeline
                    // (ba_pending_approvals already records the decision, but ba_events is
                    // what ActivityFeed reads, so this is what surfaces it there too).
                    const fieldSummary = [
                        changes && changes.entryWeight !== undefined ? `Entry Weight → ${changes.entryWeight} kg` : null,
                        changes && changes.purchasePrice !== undefined ? `Purchase Price → ${changes.purchasePrice.toLocaleString()} PKR` : null
                    ].filter(Boolean).join(', ');
                    await client.query(`
                        INSERT INTO ba_events (animal_id, date, event_type, note, created_by)
                        VALUES ($1, $2, 'approval_decision', $3, $4)
                    `, [approval.animal_id, today, `Approved edit — ${fieldSummary} (requested by ${approval.requested_by})`, userEmail]);
                } else if (approval.action === 'DELETE_ANIMAL') {
                    await client.query('DELETE FROM ba_animals WHERE id = $1', [approval.animal_id]);
                    // No ba_events row here — the animal (and its event history) is gone the
                    // instant this runs. The ba_pending_approvals row itself, which is never
                    // cascade-deleted, is the permanent audit record for this decision.
                } else if (approval.action === 'DELETE_FEED_PURCHASE') {
                    await client.query('DELETE FROM ba_feed_purchases WHERE id = $1', [changes.id]);
                } else if (approval.action === 'DELETE_FEED_STOCK_ISSUE') {
                    await client.query('DELETE FROM ba_feed_stock_issues WHERE id = $1', [changes.id]);
                } else if (approval.action === 'DELETE_OVERHEAD_EXPENSE') {
                    await client.query('DELETE FROM ba_overhead_expenses WHERE id = $1', [changes.id]);
                } else if (approval.action === 'DELETE_WEIGHT_LOG') {
                    await client.query('DELETE FROM ba_weights WHERE id = $1', [changes.logId]);
                } else if (approval.action === 'DELETE_TREATMENT') {
                    const tRes = await client.query('SELECT stock_issue_id FROM ba_treatments WHERE id = $1', [changes.treatmentId]);
                    const stockIssueId = tRes.rows[0]?.stock_issue_id || approval.previous_snapshot?.stock_issue_id;
                    await client.query('DELETE FROM ba_treatments WHERE id = $1', [changes.treatmentId]);
                    if (stockIssueId) {
                        await client.query('DELETE FROM ba_feed_stock_issues WHERE id = $1', [stockIssueId]);
                    }
                } else if (approval.action === 'DELETE_FEED_LOG') {
                    if (changes.feedingIndex === undefined || changes.feedingIndex === null) {
                        await client.query('DELETE FROM ba_feed_logs WHERE date = $1 AND pen = $2', [changes.date, changes.pen || 'ALL']);
                    } else {
                        await client.query('DELETE FROM ba_feed_logs WHERE date = $1 AND pen = $2 AND feeding_index = $3', [changes.date, changes.pen || 'ALL', changes.feedingIndex]);
                    }
                } else if (approval.action === 'OVERWRITE_FEED_LOG') {
                    const { date, pen, animalCount, ingredients, totalDmKg, totalBatchKg, totalCost, costPerAnimal, notes, dietDiffered, feedingIndex, numFeedings, feedingPct, feedingTime } = changes;
                    await client.query(`
                        INSERT INTO ba_feed_logs (date, pen, animal_count, ingredients, total_dm_kg, total_batch_kg, total_cost, cost_per_animal, notes, diet_differed, feeding_index, num_feedings, feeding_pct, feeding_time, created_by, created_at)
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW())
                        ON CONFLICT (date, pen, feeding_index) DO UPDATE SET
                            animal_count = EXCLUDED.animal_count,
                            ingredients = EXCLUDED.ingredients,
                            total_dm_kg = EXCLUDED.total_dm_kg,
                            total_batch_kg = EXCLUDED.total_batch_kg,
                            total_cost = EXCLUDED.total_cost,
                            cost_per_animal = EXCLUDED.cost_per_animal,
                            notes = EXCLUDED.notes,
                            diet_differed = EXCLUDED.diet_differed,
                            num_feedings = EXCLUDED.num_feedings,
                            feeding_pct = EXCLUDED.feeding_pct,
                            feeding_time = EXCLUDED.feeding_time,
                            created_by = EXCLUDED.created_by,
                            created_at = NOW()
                    `, [
                        date, pen || 'ALL', animalCount || 0, JSON.stringify(ingredients || []),
                        totalDmKg || 0, totalBatchKg || 0, totalCost || 0, costPerAnimal || 0,
                        notes || null, !!dietDiffered, feedingIndex || 0, numFeedings || 1, feedingPct || 100,
                        feedingTime || null, approval.requested_by
                    ]);
                } else if (approval.action === 'DELETE_RATION_PLAN') {
                    await client.query('UPDATE ba_pens SET ration_plan_id = NULL WHERE ration_plan_id = $1', [changes.id]);
                    await client.query('DELETE FROM ba_ration_plans WHERE id = $1', [changes.id]);
                } else if (approval.action === 'DELETE_RATION_PLAN_V2') {
                    await client.query('UPDATE ba_pens SET plan_id = NULL WHERE plan_id = $1', [changes.id]);
                    await client.query('DELETE FROM ba_ration_plans_v2 WHERE id = $1', [changes.id]);
                } else if (approval.action === 'DELETE_PEN') {
                    await client.query('DELETE FROM ba_pens WHERE id = $1', [changes.id]);
                } else if (approval.action === 'DELETE_ORDER') {
                    await client.query('DELETE FROM ba_orders WHERE id = $1', [changes.orderId]);
                } else if (approval.action === 'DELETE_ENQUIRY') {
                    await client.query('DELETE FROM ba_export_enquiries WHERE id = $1', [changes.enquiryId]);
                } else if (approval.action === 'DELETE_QUOTATION') {
                    await client.query('DELETE FROM ba_quotations WHERE id = $1', [changes.quoteId]);
                } else if (approval.action === 'DELETE_SPEC_SHEET') {
                    await client.query('DELETE FROM ba_spec_sheets WHERE doc_ref = $1', [changes.refId]);
                } else if (approval.action === 'DELETE_MEAT_CUT') {
                    await client.query('DELETE FROM ba_meat_cuts WHERE id = $1', [changes.cutId]);
                } else if (approval.action === 'RECORD_DEATH') {
                    await client.query(`UPDATE ba_animals SET status = 'Deceased', deceased_date = $1, deceased_cause = $2 WHERE id = $3`, [changes.deceasedDate, changes.deceasedCause, approval.animal_id]);
                    await client.query(`INSERT INTO ba_events (animal_id, date, event_type, note, created_by) VALUES ($1, $2, 'deceased', $3, $4)`, [approval.animal_id, changes.deceasedDate, `Deceased — ${changes.deceasedCause}`, userEmail]);
                } else if (approval.action === 'RECORD_SALE') {
                    await client.query(`UPDATE ba_animals SET status = 'Sold', sale_price = $1, buyer_name = $2, sale_date = $3 WHERE id = $4`, [changes.salePrice, changes.buyerName, changes.saleDate, approval.animal_id]);
                    await client.query(`INSERT INTO ba_events (animal_id, date, event_type, note, created_by) VALUES ($1, $2, 'sold', $3, $4)`, [approval.animal_id, changes.saleDate, `Sold to ${changes.buyerName} — PKR ${changes.salePrice?.toLocaleString()}`, userEmail]);
                } else if (approval.action === 'ADD_FEED_PURCHASE' || approval.action === 'UPDATE_FEED_PURCHASE') {
                    const resolved = await resolveAndSyncFeedStockItemName(
                        client, changes.itemId, changes.itemName || changes.name,
                        changes.itemUnit || changes.unit || changes.newItem?.unit,
                        changes.category || changes.newItem?.category,
                        approval.requested_by
                    );
                    await client.query(`
                        INSERT INTO ba_feed_purchases (id, item_id, item_name, item_unit, date, quantity, rate, supplier, notes, created_by, created_at)
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
                        ON CONFLICT (id) DO UPDATE SET item_id = EXCLUDED.item_id, item_name = EXCLUDED.item_name, item_unit = EXCLUDED.item_unit, date = EXCLUDED.date, quantity = EXCLUDED.quantity, rate = EXCLUDED.rate, supplier = EXCLUDED.supplier, notes = EXCLUDED.notes
                    `, [changes.id, changes.itemId, resolved.name, resolved.unit, changes.date, changes.quantity || 0, changes.rate || 0, changes.supplier || null, changes.notes || null, approval.requested_by]);
                } else if (approval.action === 'SAVE_SETTINGS') {
                    await client.query(`
                        INSERT INTO ba_settings (key, value, updated_by, updated_at)
                        VALUES ($1, $2, $3, NOW())
                        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()
                    `, [changes.key, JSON.stringify(changes.value), approval.requested_by]);
                    if (changes.key === 'premix_batches') {
                        await reconcileOrphanedFeedStockIssues(client);
                    }
                } else if (approval.action === 'UPDATE_WEIGHT_LOGS_BATCH') {
                    for (const log of (changes.logs || [])) {
                        await client.query(`UPDATE ba_weights SET date = $1, weight = $2, adg = $3 WHERE id = $4`, [log.date, log.weight, log.adg, log.id]);
                    }
                    if (changes.currentWeight !== undefined) {
                        await client.query(`UPDATE ba_animals SET current_weight = $1 WHERE id = $2`, [changes.currentWeight, approval.animal_id]);
                    }
                } else if (approval.action === 'ADD_MEAT_CUT') {
                    await client.query(`
                        INSERT INTO ba_meat_cuts (id, title, category, price, weight, description, ribbon, rfid, marbling, fat_ratio, images)
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                        ON CONFLICT (id) DO NOTHING
                    `, [changes.id, changes.title, changes.category || 'cuts', changes.price, changes.weight || null, changes.desc || null, changes.ribbon || null, changes.rfid || null, changes.marbling || null, changes.fatRatio || null, JSON.stringify(changes.images || [])]);
                } else if (approval.action === 'ADD_FEED_STOCK_ISSUE') {
                    const resolved = await resolveAndSyncFeedStockItemName(
                        client, changes.itemId, changes.itemName || changes.name,
                        changes.itemUnit || changes.unit || changes.newItem?.unit,
                        changes.category || changes.newItem?.category,
                        approval.requested_by
                    );
                    await client.query(`
                        INSERT INTO ba_feed_stock_issues (id, item_id, item_name, item_unit, date, pen, quantity, lot_id, notes, created_by, created_at)
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
                        ON CONFLICT (id) DO UPDATE SET item_id = EXCLUDED.item_id, item_name = EXCLUDED.item_name, item_unit = EXCLUDED.item_unit, date = EXCLUDED.date, pen = EXCLUDED.pen, quantity = EXCLUDED.quantity, lot_id = EXCLUDED.lot_id, notes = EXCLUDED.notes
                    `, [changes.id, changes.itemId, resolved.name, resolved.unit, changes.date, changes.pen || 'ALL', changes.quantity || 0, changes.lotId || null, changes.notes || null, approval.requested_by]);
                } else if (approval.action === 'ADD_OVERHEAD_EXPENSE') {
                    await client.query(`
                        INSERT INTO ba_overhead_expenses (id, date, category, description, amount, created_by, created_at)
                        VALUES ($1, $2, $3, $4, $5, $6, NOW())
                        ON CONFLICT (id) DO UPDATE SET date = EXCLUDED.date, category = EXCLUDED.category, description = EXCLUDED.description, amount = EXCLUDED.amount
                    `, [changes.id, changes.date, changes.category, changes.description || null, changes.amount || 0, approval.requested_by]);
                } else if (approval.action === 'UPDATE_MEAT_CUT') {
                    await client.query(`
                        UPDATE ba_meat_cuts
                        SET title=$1, price=$2, weight=$3, description=$4, ribbon=$5, rfid=$6, marbling=$7, fat_ratio=$8, images=$9
                        WHERE id=$10
                    `, [changes.title, changes.price, changes.weight || null, changes.desc || null, changes.ribbon || null, changes.rfid || null, changes.marbling || null, changes.fatRatio || null, JSON.stringify(changes.images || []), changes.id]);
                } else if (approval.action === 'SAVE_RATION_PLAN') {
                    await client.query(`
                        INSERT INTO ba_ration_plans (id, name, description, adg_floor, weeks, adaptation, ingredient_prices, wanda_stock_item_id, is_default, created_by, created_at, updated_at)
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
                        ON CONFLICT (id) DO UPDATE SET
                            name = EXCLUDED.name, description = EXCLUDED.description, adg_floor = EXCLUDED.adg_floor,
                            weeks = EXCLUDED.weeks, adaptation = EXCLUDED.adaptation, ingredient_prices = EXCLUDED.ingredient_prices,
                            wanda_stock_item_id = EXCLUDED.wanda_stock_item_id, is_default = EXCLUDED.is_default, updated_at = NOW()
                    `, [changes.id, changes.name, changes.description || null, changes.adgFloor || 1.0, JSON.stringify(changes.weeks || []), JSON.stringify(changes.adaptation || []), JSON.stringify(changes.ingredientPrices || {}), changes.wandaStockItemId || null, !!changes.isDefault, approval.requested_by]);
                } else if (approval.action === 'SAVE_PEN') {
                    await client.query(`
                        INSERT INTO ba_pens (id, ration_plan_id, plan_id, cycle_start_date, forage_type, expected_exit_date, notes, created_at, updated_at)
                        VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
                        ON CONFLICT (id) DO UPDATE SET
                            ration_plan_id = EXCLUDED.ration_plan_id, plan_id = EXCLUDED.plan_id,
                            cycle_start_date = EXCLUDED.cycle_start_date, forage_type = EXCLUDED.forage_type,
                            expected_exit_date = EXCLUDED.expected_exit_date, notes = EXCLUDED.notes, updated_at = NOW()
                    `, [changes.id, changes.rationPlanId || null, changes.planId || null, changes.cycleStartDate || null, changes.forageType || 'silage', changes.expectedExitDate || null, changes.notes || null]);
                    if (changes.planId) {
                        const cache = await recomputePenWeightCache(client, changes.id, changes.planId, changes.forageType || 'silage');
                        await client.query(`UPDATE ba_pens SET last_actual_weight_kg = $1, last_weigh_date = $2, current_target_adg = $3 WHERE id = $4`, [cache.lastActualWeightKg, cache.lastWeighDate, cache.currentTargetAdg, changes.id]);
                    }
                } else if (approval.action === 'UPDATE_RATION_PLAN_V2') {
                    await client.query(`UPDATE ba_ration_plans_v2 SET name = $1, adaptation_days = $2, adg_floor = $3, is_default = $4 WHERE id = $5`, [changes.name?.trim(), changes.adaptationDays || 7, changes.adgFloor || 1.0, !!changes.isDefault, changes.id]);
                } else if (approval.action === 'UPDATE_RATION_ROW') {
                    await client.query(`UPDATE ba_ration_rows SET wt_min = $1, wt_max = $2, target_adg = $3 WHERE id = $4`, [changes.wtMin, changes.wtMax, changes.targetAdg, changes.rowId]);
                    if (changes.items) {
                        await client.query('DELETE FROM ba_ration_row_items WHERE row_id = $1', [changes.rowId]);
                        for (const [ingredientId, qtyRaw] of Object.entries(changes.items)) {
                            const qty = parseFloat(qtyRaw) || 0;
                            if (qty > 0) {
                                await client.query('INSERT INTO ba_ration_row_items (row_id, ingredient_id, amount_kg_head_day) VALUES ($1, $2, $3)', [changes.rowId, ingredientId, qty]);
                            }
                        }
                    }
                }

                await client.query(
                    `UPDATE ba_pending_approvals SET status = 'approved', reviewed_by = $1, reviewed_at = NOW() WHERE id = $2`,
                    [session.email.toLowerCase().trim(), approvalId]
                );
                return res.status(200).json({ success: true });
            }

            if (action === 'REJECT_PENDING_CHANGE') {
                const { approvalId, note } = payload;
                const result = await client.query(
                    `UPDATE ba_pending_approvals SET status = 'rejected', reviewed_by = $1, reviewed_at = NOW(), review_note = $2 WHERE id = $3 AND status = 'pending' RETURNING animal_id, action, requested_by`,
                    [session.email.toLowerCase().trim(), note || null, approvalId]
                );
                if (result.rowCount === 0) {
                    return res.status(404).json({ success: false, error: 'Request not found or already resolved.' });
                }

                // Rejecting never touches ba_animals, so the animal is guaranteed to still
                // exist — safe to log this on its timeline regardless of request type.
                const resolved = result.rows[0];
                const today = new Date().toISOString().split('T')[0];
                const label = resolved.action === 'DELETE_ANIMAL' ? 'deletion' : 'edit';
                await client.query(`
                    INSERT INTO ba_events (animal_id, date, event_type, note, created_by)
                    VALUES ($1, $2, 'approval_decision', $3, $4)
                `, [resolved.animal_id, today, `Rejected ${label} request from ${resolved.requested_by}${note ? ` — ${note}` : ''}`, userEmail]);

                return res.status(200).json({ success: true });
            }

            if (action === 'RECORD_DEATH') {
                const { animalId, deceasedDate, deceasedCause } = payload;
                const isAdmin = !!(perms && perms.isAdmin);
                if (!isAdmin) {
                    const existingPending = await client.query(
                        `SELECT id FROM ba_pending_approvals WHERE action = 'RECORD_DEATH' AND animal_id = $1 AND status = 'pending'`,
                        [animalId]
                    );
                    if (existingPending.rows.length === 0) {
                        const animalRes = await client.query('SELECT * FROM ba_animals WHERE id = $1', [animalId]);
                        if (animalRes.rows.length === 0) {
                            return res.status(404).json({ success: false, error: 'Animal not found.' });
                        }
                        await client.query(`
                            INSERT INTO ba_pending_approvals (action, animal_id, animal_rfid, animal_breed, payload, previous_snapshot, requested_by)
                            VALUES ('RECORD_DEATH', $1, $2, $3, $4, $5, $6)
                        `, [animalId, animalRes.rows[0].rfid, animalRes.rows[0].breed, JSON.stringify({ animalId, deceasedDate, deceasedCause }), JSON.stringify(animalRes.rows[0]), session.email.toLowerCase().trim()]);
                    }
                    return res.status(200).json({ success: true, pending: true });
                }

                await client.query(`
                    UPDATE ba_animals
                    SET status = 'Deceased', deceased_date = $1, deceased_cause = $2
                    WHERE id = $3
                `, [deceasedDate, deceasedCause, animalId]);
                await client.query(`
                    INSERT INTO ba_events (animal_id, date, event_type, note, created_by)
                    VALUES ($1, $2, 'deceased', $3, $4)
                `, [animalId, deceasedDate, `Deceased — ${deceasedCause}`, userEmail]);
                return res.status(200).json({ success: true });
            }

            if (action === 'RECORD_SALE') {
                const { animalId, salePrice, buyerName, saleDate } = payload;
                const isAdmin = !!(perms && perms.isAdmin);

                // Food-safety gate: refuse the sale if any logged treatment's withholding
                // (withdrawal) period has not yet elapsed as of the sale date.
                const withholdRes = await client.query(
                    'SELECT date, medicine, withholding FROM ba_treatments WHERE animal_id = $1 AND withholding > 0',
                    [animalId]
                );
                const saleDateObj = new Date(saleDate || new Date().toISOString().split('T')[0]);
                let lockedBy = null;
                let latestClearDate = null;
                for (const t of withholdRes.rows) {
                    const treatmentDate = new Date(t.date);
                    const daysElapsed = Math.floor((saleDateObj - treatmentDate) / (1000 * 60 * 60 * 24));
                    if (daysElapsed < t.withholding) {
                        const clearDate = new Date(treatmentDate.getTime() + t.withholding * 86400000);
                        if (!latestClearDate || clearDate > latestClearDate) {
                            latestClearDate = clearDate;
                            lockedBy = t.medicine;
                        }
                    }
                }
                if (lockedBy) {
                    return res.status(409).json({
                        success: false,
                        error: `Sale blocked: animal is still within the withholding period for "${lockedBy}" (clears ${latestClearDate.toISOString().split('T')[0]}).`
                    });
                }

                if (!isAdmin) {
                    const existingPending = await client.query(
                        `SELECT id FROM ba_pending_approvals WHERE action = 'RECORD_SALE' AND animal_id = $1 AND status = 'pending'`,
                        [animalId]
                    );
                    if (existingPending.rows.length === 0) {
                        const animalRes = await client.query('SELECT * FROM ba_animals WHERE id = $1', [animalId]);
                        if (animalRes.rows.length === 0) {
                            return res.status(404).json({ success: false, error: 'Animal not found.' });
                        }
                        await client.query(`
                            INSERT INTO ba_pending_approvals (action, animal_id, animal_rfid, animal_breed, payload, previous_snapshot, requested_by)
                            VALUES ('RECORD_SALE', $1, $2, $3, $4, $5, $6)
                        `, [animalId, animalRes.rows[0].rfid, animalRes.rows[0].breed, JSON.stringify({ animalId, salePrice, buyerName, saleDate }), JSON.stringify(animalRes.rows[0]), session.email.toLowerCase().trim()]);
                    }
                    return res.status(200).json({ success: true, pending: true });
                }

                await client.query(`
                    UPDATE ba_animals
                    SET status = 'Sold', sale_price = $1, buyer_name = $2, sale_date = $3
                    WHERE id = $4
                `, [salePrice, buyerName, saleDate, animalId]);
                await client.query(`
                    INSERT INTO ba_events (animal_id, date, event_type, note, created_by)
                    VALUES ($1, $2, 'sold', $3, $4)
                `, [animalId, saleDate, `Sold to ${buyerName} — PKR ${salePrice?.toLocaleString()}`, userEmail]);
                return res.status(200).json({ success: true });
            }

            if (action === 'DELETE_WEIGHT_LOG') {
                const { logId } = payload;
                const isAdmin = !!(perms && perms.isAdmin);
                if (!isAdmin) {
                    const existingPending = await client.query(
                        `SELECT id FROM ba_pending_approvals WHERE action = 'DELETE_WEIGHT_LOG' AND (payload->>'logId') = $1 AND status = 'pending'`,
                        [String(logId)]
                    );
                    if (existingPending.rows.length === 0) {
                        const currentRes = await client.query('SELECT w.*, a.rfid as animal_rfid, a.breed as animal_breed FROM ba_weights w LEFT JOIN ba_animals a ON w.animal_id = a.id WHERE w.id = $1', [logId]);
                        if (currentRes.rows.length > 0) {
                            const row = currentRes.rows[0];
                            await client.query(`
                                INSERT INTO ba_pending_approvals (action, animal_id, animal_rfid, animal_breed, payload, previous_snapshot, requested_by)
                                VALUES ('DELETE_WEIGHT_LOG', $1, $2, $3, $4, $5, $6)
                            `, [row.animal_id, row.animal_rfid || null, row.animal_breed || null, JSON.stringify({ logId }), JSON.stringify(row), session.email.toLowerCase().trim()]);
                        }
                    }
                    return res.status(200).json({ success: true, pending: true });
                }
                await client.query('DELETE FROM ba_weights WHERE id = $1', [logId]);
                return res.status(200).json({ success: true });
            }

            // Correcting a weight or weighing date on an existing log recalculates ADG
            // for that animal's entire chronological chain client-side (see
            // recalcWeightChain in FarmContext) — persist every affected log plus the
            // animal's refreshed currentWeight in one transaction so they never drift.
            if (action === 'UPDATE_WEIGHT_LOGS_BATCH') {
                const { animalId, logs, currentWeight } = payload;
                const isAdmin = !!(perms && perms.isAdmin);
                if (!isAdmin) {
                    const existingPending = await client.query(
                        `SELECT id FROM ba_pending_approvals WHERE action = 'UPDATE_WEIGHT_LOGS_BATCH' AND animal_id = $1 AND status = 'pending'`,
                        [animalId]
                    );
                    if (existingPending.rows.length === 0) {
                        const animalRes = await client.query('SELECT * FROM ba_animals WHERE id = $1', [animalId]);
                        await client.query(`
                            INSERT INTO ba_pending_approvals (action, animal_id, animal_rfid, animal_breed, payload, previous_snapshot, requested_by)
                            VALUES ('UPDATE_WEIGHT_LOGS_BATCH', $1, $2, $3, $4, $5, $6)
                        `, [animalId, animalRes.rows[0]?.rfid || null, animalRes.rows[0]?.breed || null, JSON.stringify({ animalId, logs, currentWeight }), JSON.stringify(animalRes.rows[0] || {}), session.email.toLowerCase().trim()]);
                    }
                    return res.status(200).json({ success: true, pending: true });
                }
                for (const log of (logs || [])) {
                    await client.query(`
                        UPDATE ba_weights
                        SET date = $1, weight = $2, adg = $3
                        WHERE id = $4
                    `, [log.date, log.weight, log.adg, log.id]);
                }
                if (currentWeight !== undefined) {
                    await client.query(`
                        UPDATE ba_animals
                        SET current_weight = $1
                        WHERE id = $2
                    `, [currentWeight, animalId]);
                }
                return res.status(200).json({ success: true });
            }

            if (action === 'DELETE_TREATMENT') {
                const { treatmentId } = payload;
                const isAdmin = !!(perms && perms.isAdmin);
                if (!isAdmin) {
                    const existingPending = await client.query(
                        `SELECT id FROM ba_pending_approvals WHERE action = 'DELETE_TREATMENT' AND (payload->>'treatmentId') = $1 AND status = 'pending'`,
                        [String(treatmentId)]
                    );
                    if (existingPending.rows.length === 0) {
                        const currentRes = await client.query('SELECT t.*, a.rfid as animal_rfid, a.breed as animal_breed FROM ba_treatments t LEFT JOIN ba_animals a ON t.animal_id = a.id WHERE t.id = $1', [treatmentId]);
                        if (currentRes.rows.length > 0) {
                            const row = currentRes.rows[0];
                            await client.query(`
                                INSERT INTO ba_pending_approvals (action, animal_id, animal_rfid, animal_breed, payload, previous_snapshot, requested_by)
                                VALUES ('DELETE_TREATMENT', $1, $2, $3, $4, $5, $6)
                            `, [row.animal_id, row.animal_rfid || null, row.animal_breed || null, JSON.stringify({ treatmentId }), JSON.stringify(row), session.email.toLowerCase().trim()]);
                        }
                    }
                    return res.status(200).json({ success: true, pending: true });
                }
                const tRes = await client.query('SELECT stock_issue_id FROM ba_treatments WHERE id = $1', [treatmentId]);
                const stockIssueId = tRes.rows[0]?.stock_issue_id;
                await client.query('DELETE FROM ba_treatments WHERE id = $1', [treatmentId]);
                if (stockIssueId) {
                    await client.query('DELETE FROM ba_feed_stock_issues WHERE id = $1', [stockIssueId]);
                }
                return res.status(200).json({ success: true });
            }

            // Snapshots what was actually fed on a given date (for a pen, or 'ALL' for
            // the whole herd) as an immutable dated record — separate from the live
            // recipe definition in ba_feed_ingredients-equivalent client state, so
            // editing today's recipe never rewrites history. One record per (date, pen);
            // re-logging the same day/pen updates that day's snapshot only.
            if (action === 'LOG_FEED') {
                const {
                    date, pen, animalCount, ingredients,
                    totalDmKg, totalBatchKg, totalCost, costPerAnimal, notes, dietDiffered, feedingTime
                } = payload;
                let { feedingIndex, numFeedings, feedingPct } = payload;

                if (!date) {
                    return res.status(400).json({ success: false, error: "Date is required" });
                }

                if (feedingIndex === undefined || numFeedings === undefined || feedingPct === undefined) {
                    const match = notes && notes.match(/FEEDING (\d+) OF (\d+) \((\d+)%\)/i);
                    feedingIndex = match ? parseInt(match[1]) : 0;
                    numFeedings = match ? parseInt(match[2]) : 1;
                    feedingPct = match ? parseInt(match[3]) : 100;
                }

                const isAdmin = !!(perms && perms.isAdmin);
                const targetPen = pen || 'ALL';
                const targetIdx = feedingIndex || 0;

                const existingRes = await client.query(
                    'SELECT * FROM ba_feed_logs WHERE date = $1 AND pen = $2 AND feeding_index = $3',
                    [date, targetPen, targetIdx]
                );

                if (!isAdmin && existingRes.rows.length > 0) {
                    const existingPending = await client.query(`
                        SELECT id FROM ba_pending_approvals 
                        WHERE action = 'OVERWRITE_FEED_LOG' 
                        AND (payload->>'date') = $1 
                        AND (payload->>'pen') = $2 
                        AND (payload->>'feedingIndex') = $3 
                        AND status = 'pending'
                    `, [String(date), String(targetPen), String(targetIdx)]);

                    if (existingPending.rows.length === 0) {
                        await client.query(`
                            INSERT INTO ba_pending_approvals (action, payload, previous_snapshot, requested_by)
                            VALUES ('OVERWRITE_FEED_LOG', $1, $2, $3)
                        `, [
                            JSON.stringify({ ...payload, pen: targetPen, feedingIndex: targetIdx }),
                            JSON.stringify(existingRes.rows[0]),
                            session.email.toLowerCase().trim()
                        ]);
                    }
                    return res.status(200).json({ success: true, pending: true });
                }

                await client.query(`
                    INSERT INTO ba_feed_logs (date, pen, animal_count, ingredients, total_dm_kg, total_batch_kg, total_cost, cost_per_animal, notes, diet_differed, feeding_index, num_feedings, feeding_pct, feeding_time, created_by, created_at)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW())
                    ON CONFLICT (date, pen, feeding_index) DO UPDATE SET
                        animal_count = EXCLUDED.animal_count,
                        ingredients = EXCLUDED.ingredients,
                        total_dm_kg = EXCLUDED.total_dm_kg,
                        total_batch_kg = EXCLUDED.total_batch_kg,
                        total_cost = EXCLUDED.total_cost,
                        cost_per_animal = EXCLUDED.cost_per_animal,
                        notes = EXCLUDED.notes,
                        diet_differed = EXCLUDED.diet_differed,
                        num_feedings = EXCLUDED.num_feedings,
                        feeding_pct = EXCLUDED.feeding_pct,
                        feeding_time = EXCLUDED.feeding_time,
                        created_by = EXCLUDED.created_by,
                        created_at = NOW()
                `, [
                    date, targetPen, animalCount || 0, JSON.stringify(ingredients || []),
                    totalDmKg || 0, totalBatchKg || 0, totalCost || 0, costPerAnimal || 0,
                    notes || null, !!dietDiffered, targetIdx, numFeedings || 1, feedingPct || 100,
                    feedingTime || null, session ? session.email : null
                ]);

                return res.status(200).json({ success: true });
            }

            if (action === 'DELETE_FEED_LOG') {
                const { date, pen, feedingIndex } = payload;
                const isAdmin = !!(perms && perms.isAdmin);
                if (!isAdmin) {
                    const existingPending = await client.query(
                        `SELECT id FROM ba_pending_approvals WHERE action = 'DELETE_FEED_LOG' AND (payload->>'date') = $1 AND (payload->>'pen') = $2 AND status = 'pending'`,
                        [String(date), String(pen || 'ALL')]
                    );
                    if (existingPending.rows.length === 0) {
                        const currentRes = await client.query('SELECT * FROM ba_feed_logs WHERE date = $1 AND pen = $2', [date, pen || 'ALL']);
                        if (currentRes.rows.length > 0) {
                            await client.query(`
                                INSERT INTO ba_pending_approvals (action, payload, previous_snapshot, requested_by)
                                VALUES ('DELETE_FEED_LOG', $1, $2, $3)
                            `, [JSON.stringify({ date, pen: pen || 'ALL', feedingIndex }), JSON.stringify(currentRes.rows[0]), session.email.toLowerCase().trim()]);
                        }
                    }
                    return res.status(200).json({ success: true, pending: true });
                }

                if (feedingIndex === undefined || feedingIndex === null) {
                    // No specific session given — clear every feeding logged for that pen/day.
                    await client.query('DELETE FROM ba_feed_logs WHERE date = $1 AND pen = $2', [date, pen || 'ALL']);
                } else {
                    await client.query('DELETE FROM ba_feed_logs WHERE date = $1 AND pen = $2 AND feeding_index = $3', [date, pen || 'ALL', feedingIndex]);
                }
                return res.status(200).json({ success: true });
            }

            if (action === 'SAVE_RATION_PLAN') {
                const { id, name, description, adgFloor, weeks, adaptation, ingredientPrices, isDefault, wandaStockItemId } = payload;
                const isAdmin = !!(perms && perms.isAdmin);

                if (!id || !name) {
                    return res.status(400).json({ success: false, error: "Plan id and name are required" });
                }

                if (!isAdmin) {
                    const existingPending = await client.query(
                        `SELECT id FROM ba_pending_approvals WHERE action = 'SAVE_RATION_PLAN' AND (payload->>'id') = $1 AND status = 'pending'`,
                        [String(id)]
                    );
                    if (existingPending.rows.length === 0) {
                        const currentRes = await client.query('SELECT * FROM ba_ration_plans WHERE id = $1', [id]);
                        await client.query(`
                            INSERT INTO ba_pending_approvals (action, payload, previous_snapshot, requested_by)
                            VALUES ('SAVE_RATION_PLAN', $1, $2, $3)
                        `, [JSON.stringify(payload), JSON.stringify(currentRes.rows[0] || {}), session.email.toLowerCase().trim()]);
                    }
                    return res.status(200).json({ success: true, pending: true });
                }

                await client.query(`
                    INSERT INTO ba_ration_plans (id, name, description, adg_floor, weeks, adaptation, ingredient_prices, wanda_stock_item_id, is_default, created_by, created_at, updated_at)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
                    ON CONFLICT (id) DO UPDATE SET
                        name = EXCLUDED.name,
                        description = EXCLUDED.description,
                        adg_floor = EXCLUDED.adg_floor,
                        weeks = EXCLUDED.weeks,
                        adaptation = EXCLUDED.adaptation,
                        ingredient_prices = EXCLUDED.ingredient_prices,
                        wanda_stock_item_id = EXCLUDED.wanda_stock_item_id,
                        is_default = EXCLUDED.is_default,
                        updated_at = NOW()
                `, [
                    id, name, description || null, adgFloor || 1.0,
                    JSON.stringify(weeks || []), JSON.stringify(adaptation || []), JSON.stringify(ingredientPrices || {}), wandaStockItemId || null, !!isDefault, session ? session.email : null
                ]);

                return res.status(200).json({ success: true });
            }

            if (action === 'DELETE_RATION_PLAN') {
                const { id } = payload;
                const isAdmin = !!(perms && perms.isAdmin);
                if (!isAdmin) {
                    return res.status(403).json({ success: false, error: "Unauthorized: Deleting Ration Plans requires Super Admin access." });
                }
                await client.query('UPDATE ba_pens SET ration_plan_id = NULL WHERE ration_plan_id = $1', [id]);
                await client.query('DELETE FROM ba_ration_plans WHERE id = $1', [id]);
                return res.status(200).json({ success: true });
            }

            if (action === 'SAVE_PEN') {
                const { id, rationPlanId, planId, cycleStartDate, forageType, expectedExitDate, notes } = payload;
                const isAdmin = !!(perms && perms.isAdmin);

                if (!id) {
                    return res.status(400).json({ success: false, error: "Pen id is required" });
                }

                if (!isAdmin) {
                    const existingPending = await client.query(
                        `SELECT id FROM ba_pending_approvals WHERE action = 'SAVE_PEN' AND (payload->>'id') = $1 AND status = 'pending'`,
                        [String(id)]
                    );
                    if (existingPending.rows.length === 0) {
                        const currentRes = await client.query('SELECT * FROM ba_pens WHERE id = $1', [id]);
                        await client.query(`
                            INSERT INTO ba_pending_approvals (action, payload, previous_snapshot, requested_by)
                            VALUES ('SAVE_PEN', $1, $2, $3)
                        `, [JSON.stringify(payload), JSON.stringify(currentRes.rows[0] || {}), session.email.toLowerCase().trim()]);
                    }
                    return res.status(200).json({ success: true, pending: true });
                }

                await client.query(`
                    INSERT INTO ba_pens (id, ration_plan_id, plan_id, cycle_start_date, forage_type, expected_exit_date, notes, created_at, updated_at)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
                    ON CONFLICT (id) DO UPDATE SET
                        ration_plan_id = EXCLUDED.ration_plan_id,
                        plan_id = EXCLUDED.plan_id,
                        cycle_start_date = EXCLUDED.cycle_start_date,
                        forage_type = EXCLUDED.forage_type,
                        expected_exit_date = EXCLUDED.expected_exit_date,
                        notes = EXCLUDED.notes,
                        updated_at = NOW()
                `, [id, rationPlanId || null, planId || null, cycleStartDate || null, forageType || 'silage', expectedExitDate || null, notes || null]);

                if (planId) {
                    const cache = await recomputePenWeightCache(client, id, planId, forageType || 'silage');
                    await client.query(`
                        UPDATE ba_pens
                        SET last_actual_weight_kg = $1, last_weigh_date = $2, current_target_adg = $3
                        WHERE id = $4
                    `, [cache.lastActualWeightKg, cache.lastWeighDate, cache.currentTargetAdg, id]);
                }

                return res.status(200).json({ success: true });
            }

            if (action === 'DELETE_PEN') {
                const { id } = payload;
                const isAdmin = !!(perms && perms.isAdmin);
                if (!isAdmin) {
                    const existingPending = await client.query(
                        `SELECT id FROM ba_pending_approvals WHERE action = 'DELETE_PEN' AND (payload->>'id') = $1 AND status = 'pending'`,
                        [String(id)]
                    );
                    if (existingPending.rows.length === 0) {
                        const currentRes = await client.query('SELECT * FROM ba_pens WHERE id = $1', [id]);
                        if (currentRes.rows.length > 0) {
                            await client.query(`
                                INSERT INTO ba_pending_approvals (action, payload, previous_snapshot, requested_by)
                                VALUES ('DELETE_PEN', $1, $2, $3)
                            `, [JSON.stringify({ id }), JSON.stringify(currentRes.rows[0]), session.email.toLowerCase().trim()]);
                        }
                    }
                    return res.status(200).json({ success: true, pending: true });
                }
                await client.query('DELETE FROM ba_pens WHERE id = $1', [id]);
                return res.status(200).json({ success: true });
            }

            if (action === 'IMPORT_RATION_PLAN') {
                const { planKey, planName, adaptationDays, adgFloor, isDefault, rows } = payload;

                if (!planKey || !planName || !Array.isArray(rows) || rows.length === 0) {
                    return res.status(400).json({ success: false, errors: ['planKey, planName and at least one row are required.'] });
                }

                const ingRes = await client.query(`SELECT value FROM ba_settings WHERE key = 'feed_ingredients'`);
                const feedIngredients = ingRes.rows.length
                    ? ((typeof ingRes.rows[0].value === 'string' ? JSON.parse(ingRes.rows[0].value) : ingRes.rows[0].value) || [])
                    : [];
                const validNames = feedIngredients.map(i => i.name);

                if (feedIngredients.length === 0) {
                    return res.status(400).json({ success: false, errors: ['No feed ingredients are set up yet — add them in Feed Pricing before importing a ration plan.'] });
                }

                const rawColumnNames = new Set();
                rows.forEach(r => Object.keys(r.ingredients || {}).forEach(c => rawColumnNames.add(c)));

                let errors = [];
                const columnToIngredientId = {};
                rawColumnNames.forEach(col => {
                    const { match, ambiguous } = matchIngredientColumn(col, feedIngredients);
                    if (ambiguous) {
                        errors.push(`Column "${col}" matches more than one feed stock ingredient — rename it to be unambiguous.`);
                    } else if (!match) {
                        errors.push(`Column "${col}" does not match any feed stock ingredient.`);
                    } else {
                        columnToIngredientId[col] = match.id;
                    }
                });

                if (errors.length > 0) {
                    errors.push(`Valid feed stock ingredient names: ${validNames.join(', ')}`);
                    return res.status(400).json({ success: false, errors });
                }

                rows.forEach((r, idx) => {
                    const label = `Row ${idx + 1} (${r.forageType} ${r.phase}${r.dayNo ? ' day ' + r.dayNo : ''}, ${r.wtMin}-${r.wtMax}kg)`;
                    const wtMin = parseFloat(r.wtMin), wtMax = parseFloat(r.wtMax), targetAdg = parseFloat(r.targetAdg);

                    if (!(wtMin < wtMax)) errors.push(`${label}: wt_min must be less than wt_max.`);
                    if (!(targetAdg >= 0.2 && targetAdg <= 2.0)) errors.push(`${label}: target_adg ${r.targetAdg} out of range 0.2-2.0.`);
                    if (r.phase !== 'ADAPTATION' && r.phase !== 'STEADY') errors.push(`${label}: phase must be ADAPTATION or STEADY.`);
                    if (r.phase === 'ADAPTATION' && !(r.dayNo >= 1 && r.dayNo <= 7)) errors.push(`${label}: ADAPTATION rows must have day_no 1-7.`);
                    if (r.phase === 'STEADY' && r.dayNo !== null && r.dayNo !== undefined && r.dayNo !== '') errors.push(`${label}: STEADY rows must not have a day_no.`);

                    let rowTotal = 0;
                    Object.entries(r.ingredients || {}).forEach(([col, qtyRaw]) => {
                        const qty = parseFloat(qtyRaw) || 0;
                        if (qty < 0 || qty > 25) errors.push(`${label}: ${col} = ${qty}kg is outside the 0-25kg/head/day bound.`);
                        rowTotal += qty;
                    });
                    if (!(rowTotal >= 1 && rowTotal <= 40)) errors.push(`${label}: total ration ${rowTotal.toFixed(2)}kg/head/day is outside the 1-40kg bound.`);
                });

                if (errors.length > 0) {
                    return res.status(400).json({ success: false, errors });
                }

                const groups = {};
                rows.forEach(r => {
                    const key = `${r.forageType}|${r.phase}|${r.dayNo ?? ''}`;
                    (groups[key] = groups[key] || []).push(r);
                });
                Object.entries(groups).forEach(([key, groupRows]) => {
                    const sorted = [...groupRows].sort((a, b) => parseFloat(a.wtMin) - parseFloat(b.wtMin));
                    for (let i = 0; i < sorted.length - 1; i++) {
                        if (Math.abs(parseFloat(sorted[i].wtMax) + 1 - parseFloat(sorted[i + 1].wtMin)) > 0.001) {
                            errors.push(`Bracket gap/overlap in ${key}: ${sorted[i].wtMin}-${sorted[i].wtMax}kg vs ${sorted[i + 1].wtMin}-${sorted[i + 1].wtMax}kg.`);
                        }
                    }
                });

                if (errors.length > 0) {
                    return res.status(400).json({ success: false, errors });
                }

                const verRes = await client.query('SELECT COALESCE(MAX(version), 0) AS max_version FROM ba_ration_plans_v2 WHERE plan_key = $1', [planKey]);
                const version = parseInt(verRes.rows[0].max_version, 10) + 1;
                const planId = `${planKey}-v${version}`;

                try {
                    await client.query('BEGIN');

                    await client.query(`
                        INSERT INTO ba_ration_plans_v2 (id, plan_key, version, name, adaptation_days, adg_floor, is_default, created_by, created_at)
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
                    `, [planId, planKey, version, planName, adaptationDays || 7, adgFloor || 1.0, !!isDefault, session ? session.email : null]);

                    const rowValues = [];
                    const rowParams = [];
                    rows.forEach((r, idx) => {
                        const base = idx * 8;
                        rowValues.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8})`);
                        rowParams.push(
                            planId, r.phase, r.phase === 'ADAPTATION' ? r.dayNo : null, r.forageType,
                            r.wtMin, r.wtMax, r.targetAdg, r.estCostPerHeadPerDay || null
                        );
                    });
                    const rowsInsertRes = await client.query(`
                        INSERT INTO ba_ration_rows (plan_id, phase, day_no, forage_type, wt_min, wt_max, target_adg, est_cost_per_head_per_day)
                        VALUES ${rowValues.join(', ')}
                        RETURNING id
                    `, rowParams);

                    const createdRows = rows.map((r, idx) => ({
                        id: rowsInsertRes.rows[idx].id, planId, phase: r.phase,
                        dayNo: r.phase === 'ADAPTATION' ? r.dayNo : null,
                        forageType: r.forageType, wtMin: parseFloat(r.wtMin), wtMax: parseFloat(r.wtMax),
                        targetAdg: parseFloat(r.targetAdg), estCostPerHeadPerDay: r.estCostPerHeadPerDay || null
                    }));

                    const itemValues = [];
                    const itemParams = [];
                    let itemIdx = 0;
                    rows.forEach((r, idx) => {
                        const rowId = rowsInsertRes.rows[idx].id;
                        Object.entries(r.ingredients || {}).forEach(([col, qtyRaw]) => {
                            const qty = parseFloat(qtyRaw) || 0;
                            if (qty <= 0) return;
                            const base = itemIdx * 3;
                            itemValues.push(`($${base + 1}, $${base + 2}, $${base + 3})`);
                            itemParams.push(rowId, columnToIngredientId[col], qty);
                            itemIdx++;
                        });
                    });

                    let createdItems = [];
                    if (itemValues.length > 0) {
                        const itemsInsertRes = await client.query(`
                            INSERT INTO ba_ration_row_items (row_id, ingredient_id, qty_kg_per_head_per_day)
                            VALUES ${itemValues.join(', ')}
                            RETURNING id, row_id, ingredient_id, qty_kg_per_head_per_day
                        `, itemParams);
                        createdItems = itemsInsertRes.rows.map(row => ({
                            id: row.id, rowId: row.row_id, ingredientId: row.ingredient_id,
                            qtyKgPerHeadPerDay: parseFloat(row.qty_kg_per_head_per_day)
                        }));
                    }

                    await client.query('COMMIT');

                    const createdPlan = {
                        id: planId, planKey, version, name: planName,
                        adaptationDays: adaptationDays || 7, adgFloor: adgFloor || 1.0,
                        isDefault: !!isDefault, createdBy: session ? session.email : null
                    };

                    return res.status(200).json({
                        success: true, planId, planKey, version, rowCount: rows.length,
                        plan: createdPlan, rows: createdRows, items: createdItems
                    });
                } catch (importErr) {
                    await client.query('ROLLBACK');
                    throw importErr;
                }
            }

            if (action === 'UPDATE_RATION_PLAN_V2') {
                const { id, name, adaptationDays, adgFloor, isDefault } = payload;
                const isAdmin = !!(perms && perms.isAdmin);

                if (!id || !name || !name.trim()) {
                    return res.status(400).json({ success: false, error: "Plan id and name are required" });
                }

                if (!isAdmin) {
                    const existingPending = await client.query(
                        `SELECT id FROM ba_pending_approvals WHERE action = 'UPDATE_RATION_PLAN_V2' AND (payload->>'id') = $1 AND status = 'pending'`,
                        [String(id)]
                    );
                    if (existingPending.rows.length === 0) {
                        const currentRes = await client.query('SELECT * FROM ba_ration_plans_v2 WHERE id = $1', [id]);
                        await client.query(`
                            INSERT INTO ba_pending_approvals (action, payload, previous_snapshot, requested_by)
                            VALUES ('UPDATE_RATION_PLAN_V2', $1, $2, $3)
                        `, [JSON.stringify(payload), JSON.stringify(currentRes.rows[0] || {}), session.email.toLowerCase().trim()]);
                    }
                    return res.status(200).json({ success: true, pending: true });
                }

                const existsRes = await client.query('SELECT id FROM ba_ration_plans_v2 WHERE id = $1', [id]);
                if (existsRes.rows.length === 0) {
                    return res.status(404).json({ success: false, error: "Ration plan not found" });
                }

                await client.query(`
                    UPDATE ba_ration_plans_v2
                    SET name = $1, adaptation_days = $2, adg_floor = $3, is_default = $4
                    WHERE id = $5
                `, [name.trim(), adaptationDays || 7, adgFloor || 1.0, !!isDefault, id]);

                return res.status(200).json({ success: true });
            }

            if (action === 'DELETE_RATION_PLAN_V2') {
                const { id } = payload;
                const isAdmin = !!(perms && perms.isAdmin);
                if (!isAdmin) {
                    return res.status(403).json({ success: false, error: "Unauthorized: Deleting Ration Plans requires Super Admin access." });
                }
                await client.query('UPDATE ba_pens SET plan_id = NULL WHERE plan_id = $1', [id]);
                await client.query('DELETE FROM ba_ration_plans_v2 WHERE id = $1', [id]);
                return res.status(200).json({ success: true });
            }

            // (forage_type, phase, day_no) group, so a bad edit can't silently break
            // the bracket sequence that live pens are already resolving against.
            if (action === 'UPDATE_RATION_ROW') {
                const { rowId, wtMin, wtMax, targetAdg, estCostPerHeadPerDay, items } = payload;

                if (!rowId) {
                    return res.status(400).json({ success: false, errors: ['rowId is required.'] });
                }

                const rowRes = await client.query('SELECT * FROM ba_ration_rows WHERE id = $1', [rowId]);
                if (rowRes.rows.length === 0) {
                    return res.status(404).json({ success: false, errors: ['Ration row not found.'] });
                }
                const existingRow = rowRes.rows[0];

                const newWtMin = parseFloat(wtMin);
                const newWtMax = parseFloat(wtMax);
                const newTargetAdg = parseFloat(targetAdg);
                const label = `${existingRow.forage_type} ${existingRow.phase}${existingRow.day_no ? ' day ' + existingRow.day_no : ''}, ${newWtMin}-${newWtMax}kg`;

                let errors = [];
                if (!(newWtMin < newWtMax)) errors.push(`${label}: wt_min must be less than wt_max.`);
                if (!(newTargetAdg >= 0.2 && newTargetAdg <= 2.0)) errors.push(`${label}: target_adg ${targetAdg} out of range 0.2-2.0.`);

                let rowTotal = 0;
                Object.entries(items || {}).forEach(([ingredientId, qtyRaw]) => {
                    const qty = parseFloat(qtyRaw) || 0;
                    if (qty < 0 || qty > 25) errors.push(`${label}: ${ingredientId} = ${qty}kg is outside the 0-25kg/head/day bound.`);
                    rowTotal += qty;
                });
                if (!(rowTotal >= 1 && rowTotal <= 40)) errors.push(`${label}: total ration ${rowTotal.toFixed(2)}kg/head/day is outside the 1-40kg bound.`);

                if (errors.length > 0) {
                    return res.status(400).json({ success: false, errors });
                }

                // Contiguity against this row's siblings in the same bracket group,
                // using the *new* wt_min/wt_max for this row and the existing values
                // for every other row in the group.
                const siblingsRes = await client.query(`
                    SELECT id, wt_min, wt_max FROM ba_ration_rows
                    WHERE plan_id = $1 AND forage_type = $2 AND phase = $3
                    AND (day_no = $4 OR ($4 IS NULL AND day_no IS NULL))
                `, [existingRow.plan_id, existingRow.forage_type, existingRow.phase, existingRow.day_no]);
                const group = siblingsRes.rows.map(r => ({
                    id: r.id,
                    wtMin: r.id === parseInt(rowId, 10) ? newWtMin : parseFloat(r.wt_min),
                    wtMax: r.id === parseInt(rowId, 10) ? newWtMax : parseFloat(r.wt_max)
                })).sort((a, b) => a.wtMin - b.wtMin);
                for (let i = 0; i < group.length - 1; i++) {
                    if (Math.abs(group[i].wtMax + 1 - group[i + 1].wtMin) > 0.001) {
                        errors.push(`Bracket gap/overlap: ${group[i].wtMin}-${group[i].wtMax}kg vs ${group[i + 1].wtMin}-${group[i + 1].wtMax}kg.`);
                    }
                }

                if (errors.length > 0) {
                    return res.status(400).json({ success: false, errors });
                }

                await client.query(`
                    UPDATE ba_ration_rows
                    SET wt_min = $1, wt_max = $2, target_adg = $3, est_cost_per_head_per_day = $4
                    WHERE id = $5
                `, [newWtMin, newWtMax, newTargetAdg, estCostPerHeadPerDay || null, rowId]);

                await client.query('DELETE FROM ba_ration_row_items WHERE row_id = $1', [rowId]);
                const newItems = [];
                for (const [ingredientId, qtyRaw] of Object.entries(items || {})) {
                    const qty = parseFloat(qtyRaw) || 0;
                    if (qty <= 0) continue;
                    const itemRes = await client.query(`
                        INSERT INTO ba_ration_row_items (row_id, ingredient_id, qty_kg_per_head_per_day)
                        VALUES ($1, $2, $3)
                        RETURNING id
                    `, [rowId, ingredientId, qty]);
                    newItems.push({ id: itemRes.rows[0].id, rowId: parseInt(rowId, 10), ingredientId, qtyKgPerHeadPerDay: qty });
                }

                return res.status(200).json({
                    success: true,
                    row: {
                        id: parseInt(rowId, 10), planId: existingRow.plan_id, phase: existingRow.phase,
                        dayNo: existingRow.day_no !== null ? parseInt(existingRow.day_no, 10) : null,
                        forageType: existingRow.forage_type, wtMin: newWtMin, wtMax: newWtMax,
                        targetAdg: newTargetAdg, estCostPerHeadPerDay: estCostPerHeadPerDay || null
                    },
                    items: newItems
                });
            }

            // Generic settings upsert — covers the breed roster, med categories, system
            // params, quarantine protocols, TMR recipe/prices, feed stock item list,
            // opening stock and mineral split ratio. All of these used to be device-local
            // only; routing them through here means an edit made on one device/by one
            // staff member is never silently invisible/lost on another.
            if (action === 'SAVE_SETTINGS') {
                const { key, value } = payload;
                const isAdmin = !!(perms && perms.isAdmin);

                if (!key || !SETTINGS_KEYS.has(key)) {
                    return res.status(400).json({ success: false, error: "Unknown or missing settings key" });
                }
                if (value === undefined) {
                    return res.status(400).json({ success: false, error: "Settings value is required" });
                }

                if (!isAdmin) {
                    const existingPending = await client.query(
                        `SELECT id FROM ba_pending_approvals WHERE action = 'SAVE_SETTINGS' AND (payload->>'key') = $1 AND status = 'pending'`,
                        [key]
                    );
                    if (existingPending.rows.length === 0) {
                        const currentRes = await client.query('SELECT value FROM ba_settings WHERE key = $1', [key]);
                        await client.query(`
                            INSERT INTO ba_pending_approvals (action, payload, previous_snapshot, requested_by)
                            VALUES ('SAVE_SETTINGS', $1, $2, $3)
                        `, [JSON.stringify({ key, value }), JSON.stringify(currentRes.rows[0] || {}), session.email.toLowerCase().trim()]);
                    }
                    return res.status(200).json({ success: true, pending: true });
                }

                await client.query(`
                    INSERT INTO ba_settings (key, value, updated_by, updated_at)
                    VALUES ($1, $2, $3, NOW())
                    ON CONFLICT (key) DO UPDATE SET
                        value = EXCLUDED.value,
                        updated_by = EXCLUDED.updated_by,
                        updated_at = NOW()
                `, [key, JSON.stringify(value), session ? session.email : null]);

                if (key === 'premix_batches') {
                    await reconcileOrphanedFeedStockIssues(client);
                }

                return res.status(200).json({ success: true });
            }

            if (action === 'ADD_FEED_PURCHASE') {
                const { id, itemId, date, quantity, rate, supplier, notes } = payload;
                const isAdmin = !!(perms && perms.isAdmin);

                if (!id || !itemId || !date) {
                    return res.status(400).json({ success: false, error: "Purchase id, item and date are required" });
                }

                if (!isAdmin) {
                    const existingPending = await client.query(
                        `SELECT id FROM ba_pending_approvals WHERE action = 'ADD_FEED_PURCHASE' AND (payload->>'id') = $1 AND status = 'pending'`,
                        [String(id)]
                    );
                    if (existingPending.rows.length === 0) {
                        await client.query(`
                            INSERT INTO ba_pending_approvals (action, payload, previous_snapshot, requested_by)
                            VALUES ('ADD_FEED_PURCHASE', $1, $2, $3)
                        `, [JSON.stringify(payload), JSON.stringify({}), session.email.toLowerCase().trim()]);
                    }
                    return res.status(200).json({ success: true, pending: true });
                }

                const resolved = await resolveAndSyncFeedStockItemName(
                    client, itemId, payload.itemName || payload.name,
                    payload.itemUnit || payload.unit || payload.newItem?.unit,
                    payload.category || payload.newItem?.category,
                    session ? session.email : null
                );
                await client.query(`
                    INSERT INTO ba_feed_purchases (id, item_id, item_name, item_unit, date, quantity, rate, supplier, notes, created_by, created_at)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
                    ON CONFLICT (id) DO UPDATE SET
                        item_id = EXCLUDED.item_id,
                        item_name = EXCLUDED.item_name,
                        item_unit = EXCLUDED.item_unit,
                        date = EXCLUDED.date,
                        quantity = EXCLUDED.quantity,
                        rate = EXCLUDED.rate,
                        supplier = EXCLUDED.supplier,
                        notes = EXCLUDED.notes
                `, [id, itemId, resolved.name, resolved.unit, date, quantity || 0, rate || 0, supplier || null, notes || null, session ? session.email : null]);

                return res.status(200).json({ success: true });
            }

            if (action === 'UPDATE_FEED_PURCHASE') {
                const { id, itemId, itemName, date, quantity, rate, supplier, notes, unit } = payload;
                const isAdmin = !!(perms && perms.isAdmin);

                if (!id || !itemId || !date) {
                    return res.status(400).json({ success: false, error: "Purchase id, item and date are required" });
                }

                if (!isAdmin) {
                    const currentRes = await client.query('SELECT * FROM ba_feed_purchases WHERE id = $1', [id]);
                    const existingPending = await client.query(
                        `SELECT id FROM ba_pending_approvals WHERE action = 'UPDATE_FEED_PURCHASE' AND (payload->>'id') = $1 AND status = 'pending'`,
                        [String(id)]
                    );
                    if (existingPending.rows.length === 0) {
                        await client.query(`
                            INSERT INTO ba_pending_approvals (action, payload, previous_snapshot, requested_by)
                            VALUES ('UPDATE_FEED_PURCHASE', $1, $2, $3)
                        `, [
                            JSON.stringify(payload),
                            JSON.stringify(currentRes.rows[0] || {}),
                            session.email.toLowerCase().trim()
                        ]);
                    }
                    return res.status(200).json({ success: true, pending: true });
                }

                const resolved = await resolveAndSyncFeedStockItemName(
                    client, itemId, itemName,
                    unit || payload.newItem?.unit,
                    payload.category || payload.newItem?.category,
                    session ? session.email : null
                );
                await client.query(`
                    UPDATE ba_feed_purchases
                    SET item_id = $1, item_name = $2, item_unit = $3, date = $4, quantity = $5, rate = $6, supplier = $7, notes = $8
                    WHERE id = $9
                `, [itemId, resolved.name, resolved.unit, date, quantity || 0, rate || 0, supplier || null, notes || null, id]);

                return res.status(200).json({ success: true });
            }

            if (action === 'DELETE_FEED_PURCHASE') {
                const { id } = payload;
                const isAdmin = !!(perms && perms.isAdmin);
                if (!isAdmin) {
                    const existingPending = await client.query(
                        `SELECT id FROM ba_pending_approvals WHERE action = 'DELETE_FEED_PURCHASE' AND (payload->>'id') = $1 AND status = 'pending'`,
                        [String(id)]
                    );
                    if (existingPending.rows.length === 0) {
                        const currentRes = await client.query('SELECT * FROM ba_feed_purchases WHERE id = $1', [id]);
                        if (currentRes.rows.length > 0) {
                            await client.query(`
                                INSERT INTO ba_pending_approvals (action, payload, previous_snapshot, requested_by)
                                VALUES ('DELETE_FEED_PURCHASE', $1, $2, $3)
                            `, [JSON.stringify({ id }), JSON.stringify(currentRes.rows[0]), session.email.toLowerCase().trim()]);
                        }
                    }
                    return res.status(200).json({ success: true, pending: true });
                }
                await client.query('DELETE FROM ba_feed_purchases WHERE id = $1', [id]);
                return res.status(200).json({ success: true });
            }

            if (action === 'ADD_FEED_STOCK_ISSUE') {
                const { id, itemId, date, pen, quantity, lotId, notes } = payload;
                const isAdmin = !!(perms && perms.isAdmin);

                if (!id || !itemId || !date) {
                    return res.status(400).json({ success: false, error: "Issue id, item and date are required" });
                }

                if (!isAdmin) {
                    const existingPending = await client.query(
                        `SELECT id FROM ba_pending_approvals WHERE action = 'ADD_FEED_STOCK_ISSUE' AND (payload->>'id') = $1 AND status = 'pending'`,
                        [String(id)]
                    );
                    if (existingPending.rows.length === 0) {
                        await client.query(`
                            INSERT INTO ba_pending_approvals (action, payload, previous_snapshot, requested_by)
                            VALUES ('ADD_FEED_STOCK_ISSUE', $1, $2, $3)
                        `, [JSON.stringify(payload), JSON.stringify({}), session.email.toLowerCase().trim()]);
                    }
                    return res.status(200).json({ success: true, pending: true });
                }

                const resolved = await resolveAndSyncFeedStockItemName(
                    client, itemId, payload.itemName || payload.name,
                    payload.itemUnit || payload.unit || payload.newItem?.unit,
                    payload.category || payload.newItem?.category,
                    session ? session.email : null
                );
                await client.query(`
                    INSERT INTO ba_feed_stock_issues (id, item_id, item_name, item_unit, date, pen, quantity, lot_id, notes, created_by, created_at)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
                    ON CONFLICT (id) DO UPDATE SET
                        item_id = EXCLUDED.item_id,
                        item_name = EXCLUDED.item_name,
                        item_unit = EXCLUDED.item_unit,
                        date = EXCLUDED.date,
                        pen = EXCLUDED.pen,
                        quantity = EXCLUDED.quantity,
                        lot_id = EXCLUDED.lot_id,
                        notes = EXCLUDED.notes
                `, [id, itemId, resolved.name, resolved.unit, date, pen || 'ALL', quantity || 0, lotId || null, notes || null, session ? session.email : null]);

                return res.status(200).json({ success: true });
            }

            if (action === 'DELETE_FEED_STOCK_ISSUE') {
                const { id } = payload;
                const isAdmin = !!(perms && perms.isAdmin);
                if (!isAdmin) {
                    const existingPending = await client.query(
                        `SELECT id FROM ba_pending_approvals WHERE action = 'DELETE_FEED_STOCK_ISSUE' AND (payload->>'id') = $1 AND status = 'pending'`,
                        [String(id)]
                    );
                    if (existingPending.rows.length === 0) {
                        const currentRes = await client.query('SELECT * FROM ba_feed_stock_issues WHERE id = $1', [id]);
                        if (currentRes.rows.length > 0) {
                            await client.query(`
                                INSERT INTO ba_pending_approvals (action, payload, previous_snapshot, requested_by)
                                VALUES ('DELETE_FEED_STOCK_ISSUE', $1, $2, $3)
                            `, [JSON.stringify({ id }), JSON.stringify(currentRes.rows[0]), session.email.toLowerCase().trim()]);
                        }
                    }
                    return res.status(200).json({ success: true, pending: true });
                }
                await client.query('DELETE FROM ba_feed_stock_issues WHERE id = $1', [id]);
                return res.status(200).json({ success: true });
            }

            if (action === 'ADD_OVERHEAD_EXPENSE') {
                const { id, date, category, description, amount } = payload;
                const isAdmin = !!(perms && perms.isAdmin);

                if (!id || !date || !category) {
                    return res.status(400).json({ success: false, error: "Expense id, date and category are required" });
                }

                if (!isAdmin) {
                    const existingPending = await client.query(
                        `SELECT id FROM ba_pending_approvals WHERE action = 'ADD_OVERHEAD_EXPENSE' AND (payload->>'id') = $1 AND status = 'pending'`,
                        [String(id)]
                    );
                    if (existingPending.rows.length === 0) {
                        await client.query(`
                            INSERT INTO ba_pending_approvals (action, payload, previous_snapshot, requested_by)
                            VALUES ('ADD_OVERHEAD_EXPENSE', $1, $2, $3)
                        `, [JSON.stringify({ id, date, category, description, amount }), JSON.stringify({}), session.email.toLowerCase().trim()]);
                    }
                    return res.status(200).json({ success: true, pending: true });
                }

                await client.query(`
                    INSERT INTO ba_overhead_expenses (id, date, category, description, amount, created_by, created_at)
                    VALUES ($1, $2, $3, $4, $5, $6, NOW())
                    ON CONFLICT (id) DO UPDATE SET
                        date = EXCLUDED.date,
                        category = EXCLUDED.category,
                        description = EXCLUDED.description,
                        amount = EXCLUDED.amount
                `, [id, date, category, description || null, amount || 0, session ? session.email : null]);

                return res.status(200).json({ success: true });
            }

            if (action === 'DELETE_OVERHEAD_EXPENSE') {
                const { id } = payload;
                const isAdmin = !!(perms && perms.isAdmin);
                if (!isAdmin) {
                    const existingPending = await client.query(
                        `SELECT id FROM ba_pending_approvals WHERE action = 'DELETE_OVERHEAD_EXPENSE' AND (payload->>'id') = $1 AND status = 'pending'`,
                        [String(id)]
                    );
                    if (existingPending.rows.length === 0) {
                        const currentRes = await client.query('SELECT * FROM ba_overhead_expenses WHERE id = $1', [id]);
                        if (currentRes.rows.length > 0) {
                            await client.query(`
                                INSERT INTO ba_pending_approvals (action, payload, previous_snapshot, requested_by)
                                VALUES ('DELETE_OVERHEAD_EXPENSE', $1, $2, $3)
                            `, [JSON.stringify({ id }), JSON.stringify(currentRes.rows[0]), session.email.toLowerCase().trim()]);
                        }
                    }
                    return res.status(200).json({ success: true, pending: true });
                }
                await client.query('DELETE FROM ba_overhead_expenses WHERE id = $1', [id]);
                return res.status(200).json({ success: true });
            }

            if (action === 'ADD_ORDER') {
                const {
                    id, customerName, customerPhone, customerEmail, customerCity,
                    customerAddress, items, netTotal, status, hasLive,
                    qurbaniService, paymentMethod, date
                } = payload;

                await client.query(`
                    INSERT INTO ba_orders (id, customer_name, customer_phone, customer_email, customer_city, customer_address, items, net_total, status, has_live, qurbani_service, payment_method, date)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
                    ON CONFLICT (id) DO NOTHING
                `, [
                    id, customerName, customerPhone, customerEmail || null, customerCity,
                    customerAddress, JSON.stringify(items || []), netTotal,
                    status || 'Confirmed', hasLive || false,
                    qurbaniService || null, paymentMethod || null, date
                ]);

                let emailSent = false;
                let emailError = null;

                try {
                    const mailRes = await sendOrderEmail({
                        id, customerName, customerPhone, customerEmail, customerCity,
                        customerAddress, items, netTotal, status, hasLive,
                        qurbaniService, paymentMethod, date
                    });
                    emailSent = !mailRes.simulated;
                } catch (mailErr) {
                    console.error("Order email sending failure:", mailErr);
                    emailError = mailErr.message;
                }

                return res.status(200).json({ success: true, emailSent, emailError });
            }

            if (action === 'UPDATE_ORDER_STATUS') {
                const { orderId, status } = payload;
                await client.query('UPDATE ba_orders SET status=$1 WHERE id=$2', [status, orderId]);
                return res.status(200).json({ success: true });
            }

            if (action === 'DELETE_ORDER') {
                const { orderId } = payload;
                const isAdmin = !!(perms && perms.isAdmin);
                if (!isAdmin) {
                    const existingPending = await client.query(
                        `SELECT id FROM ba_pending_approvals WHERE action = 'DELETE_ORDER' AND (payload->>'orderId') = $1 AND status = 'pending'`,
                        [String(orderId)]
                    );
                    if (existingPending.rows.length === 0) {
                        const currentRes = await client.query('SELECT * FROM ba_orders WHERE id = $1', [orderId]);
                        if (currentRes.rows.length > 0) {
                            await client.query(`
                                INSERT INTO ba_pending_approvals (action, payload, previous_snapshot, requested_by)
                                VALUES ('DELETE_ORDER', $1, $2, $3)
                            `, [JSON.stringify({ orderId }), JSON.stringify(currentRes.rows[0]), session.email.toLowerCase().trim()]);
                        }
                    }
                    return res.status(200).json({ success: true, pending: true });
                }
                await client.query('DELETE FROM ba_orders WHERE id=$1', [orderId]);
                return res.status(200).json({ success: true });
            }

            if (action === 'UPDATE_ENQUIRY_STATUS') {
                const { enquiryId, status } = payload;
                await client.query('UPDATE ba_export_enquiries SET status=$1 WHERE id=$2', [status, enquiryId]);
                return res.status(200).json({ success: true });
            }

            if (action === 'DELETE_ENQUIRY') {
                const { enquiryId } = payload;
                const isAdmin = !!(perms && perms.isAdmin);
                if (!isAdmin) {
                    const existingPending = await client.query(
                        `SELECT id FROM ba_pending_approvals WHERE action = 'DELETE_ENQUIRY' AND (payload->>'enquiryId') = $1 AND status = 'pending'`,
                        [String(enquiryId)]
                    );
                    if (existingPending.rows.length === 0) {
                        const currentRes = await client.query('SELECT * FROM ba_export_enquiries WHERE id = $1', [enquiryId]);
                        if (currentRes.rows.length > 0) {
                            await client.query(`
                                INSERT INTO ba_pending_approvals (action, payload, previous_snapshot, requested_by)
                                VALUES ('DELETE_ENQUIRY', $1, $2, $3)
                            `, [JSON.stringify({ enquiryId }), JSON.stringify(currentRes.rows[0]), session.email.toLowerCase().trim()]);
                        }
                    }
                    return res.status(200).json({ success: true, pending: true });
                }
                await client.query('DELETE FROM ba_export_enquiries WHERE id=$1', [enquiryId]);
                return res.status(200).json({ success: true });
            }

            if (action === 'SAVE_QUOTATION') {
                const {
                    id, clientName, incotermBasis, scope, targetDestination,
                    targetDestinations, validity, terms, preparerName,
                    preparerTitle, preparerPhone, products, status, createdAt
                } = payload;

                await client.query(`
                    INSERT INTO ba_quotations (id, client_name, incoterm_basis, scope, target_destination, target_destinations, validity, terms, preparer_name, preparer_title, preparer_phone, products, status, created_at)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
                    ON CONFLICT (id) DO UPDATE SET
                        client_name = EXCLUDED.client_name,
                        incoterm_basis = EXCLUDED.incoterm_basis,
                        scope = EXCLUDED.scope,
                        target_destination = EXCLUDED.target_destination,
                        target_destinations = EXCLUDED.target_destinations,
                        validity = EXCLUDED.validity,
                        terms = EXCLUDED.terms,
                        preparer_name = EXCLUDED.preparer_name,
                        preparer_title = EXCLUDED.preparer_title,
                        preparer_phone = EXCLUDED.preparer_phone,
                        products = EXCLUDED.products,
                        status = EXCLUDED.status,
                        created_at = EXCLUDED.created_at
                `, [
                    id, clientName, incotermBasis, scope, targetDestination || null,
                    targetDestinations || null, validity || null,
                    JSON.stringify(terms || []), preparerName || null,
                    preparerTitle || null, preparerPhone || null,
                    JSON.stringify(products || []), status || 'Sent', createdAt
                ]);

                return res.status(200).json({ success: true });
            }

            if (action === 'UPDATE_QUOTATION_STATUS') {
                const { quoteId, status } = payload;
                await client.query('UPDATE ba_quotations SET status=$1 WHERE id=$2', [status, quoteId]);
                return res.status(200).json({ success: true });
            }

            if (action === 'DELETE_QUOTATION') {
                const { quoteId } = payload;
                const isAdmin = !!(perms && perms.isAdmin);
                if (!isAdmin) {
                    const existingPending = await client.query(
                        `SELECT id FROM ba_pending_approvals WHERE action = 'DELETE_QUOTATION' AND (payload->>'quoteId') = $1 AND status = 'pending'`,
                        [String(quoteId)]
                    );
                    if (existingPending.rows.length === 0) {
                        const currentRes = await client.query('SELECT * FROM ba_quotations WHERE id = $1', [quoteId]);
                        if (currentRes.rows.length > 0) {
                            await client.query(`
                                INSERT INTO ba_pending_approvals (action, payload, previous_snapshot, requested_by)
                                VALUES ('DELETE_QUOTATION', $1, $2, $3)
                            `, [JSON.stringify({ quoteId }), JSON.stringify(currentRes.rows[0]), session.email.toLowerCase().trim()]);
                        }
                    }
                    return res.status(200).json({ success: true, pending: true });
                }
                await client.query('DELETE FROM ba_quotations WHERE id=$1', [quoteId]);
                return res.status(200).json({ success: true });
            }

            if (action === 'SAVE_SPEC_SHEET') {
                const {
                    docRef, clientName, docDate, idName, idCategory, idSpec,
                    idHs, idSku, originCountry, originSupply, originBreed,
                    originFeed, originAge, specForm, specWeight, specColor,
                    specPh, specTrim, specBone, packPrimary, packSecondary,
                    packPieces, packWeight, packLabelling, storeTemp, storeLife
                } = payload;

                await client.query(`
                    INSERT INTO ba_spec_sheets (doc_ref, client_name, doc_date, id_name, id_category, id_spec, id_hs, id_sku, origin_country, origin_supply, origin_breed, origin_feed, origin_age, spec_form, spec_weight, spec_color, spec_ph, spec_trim, spec_bone, pack_primary, pack_secondary, pack_pieces, pack_weight, pack_labelling, store_temp, store_life)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26)
                    ON CONFLICT (doc_ref) DO UPDATE SET
                        client_name = EXCLUDED.client_name,
                        doc_date = EXCLUDED.doc_date,
                        id_name = EXCLUDED.id_name,
                        id_category = EXCLUDED.id_category,
                        id_spec = EXCLUDED.id_spec,
                        id_hs = EXCLUDED.id_hs,
                        id_sku = EXCLUDED.id_sku,
                        origin_country = EXCLUDED.origin_country,
                        origin_supply = EXCLUDED.origin_supply,
                        origin_breed = EXCLUDED.origin_breed,
                        origin_feed = EXCLUDED.origin_feed,
                        origin_age = EXCLUDED.origin_age,
                        spec_form = EXCLUDED.spec_form,
                        spec_weight = EXCLUDED.spec_weight,
                        spec_color = EXCLUDED.spec_color,
                        spec_ph = EXCLUDED.spec_ph,
                        spec_trim = EXCLUDED.spec_trim,
                        spec_bone = EXCLUDED.spec_bone,
                        pack_primary = EXCLUDED.pack_primary,
                        pack_secondary = EXCLUDED.pack_secondary,
                        pack_pieces = EXCLUDED.pack_pieces,
                        pack_weight = EXCLUDED.pack_weight,
                        pack_labelling = EXCLUDED.pack_labelling,
                        store_temp = EXCLUDED.store_temp,
                        store_life = EXCLUDED.store_life
                `, [
                    docRef, clientName || null, docDate, idName || null, idCategory || null,
                    idSpec || null, idHs || null, idSku || null, originCountry || null,
                    originSupply || null, originBreed || null, originFeed || null,
                    originAge || null, specForm || null, specWeight || null,
                    specColor || null, specPh || null, specTrim || null,
                    specBone || null, packPrimary || null, packSecondary || null,
                    packPieces || null, packWeight || null, packLabelling || null,
                    storeTemp || null, storeLife || null
                ]);

                return res.status(200).json({ success: true });
            }

            if (action === 'DELETE_SPEC_SHEET') {
                const { refId } = payload;
                const isAdmin = !!(perms && perms.isAdmin);
                if (!isAdmin) {
                    const existingPending = await client.query(
                        `SELECT id FROM ba_pending_approvals WHERE action = 'DELETE_SPEC_SHEET' AND (payload->>'refId') = $1 AND status = 'pending'`,
                        [String(refId)]
                    );
                    if (existingPending.rows.length === 0) {
                        const currentRes = await client.query('SELECT * FROM ba_spec_sheets WHERE doc_ref = $1', [refId]);
                        if (currentRes.rows.length > 0) {
                            await client.query(`
                                INSERT INTO ba_pending_approvals (action, payload, previous_snapshot, requested_by)
                                VALUES ('DELETE_SPEC_SHEET', $1, $2, $3)
                            `, [JSON.stringify({ refId }), JSON.stringify(currentRes.rows[0]), session.email.toLowerCase().trim()]);
                        }
                    }
                    return res.status(200).json({ success: true, pending: true });
                }
                await client.query('DELETE FROM ba_spec_sheets WHERE doc_ref=$1', [refId]);
                return res.status(200).json({ success: true });
            }

            if (action === 'ADD_MEAT_CUT') {
                const { id, title, category, price, weight, desc, ribbon, rfid, marbling, fatRatio, images } = payload;
                const isAdmin = !!(perms && perms.isAdmin);

                if (!isAdmin) {
                    const existingPending = await client.query(
                        `SELECT id FROM ba_pending_approvals WHERE action = 'ADD_MEAT_CUT' AND (payload->>'id') = $1 AND status = 'pending'`,
                        [String(id)]
                    );
                    if (existingPending.rows.length === 0) {
                        await client.query(`
                            INSERT INTO ba_pending_approvals (action, payload, previous_snapshot, requested_by)
                            VALUES ('ADD_MEAT_CUT', $1, $2, $3)
                        `, [JSON.stringify(payload), JSON.stringify({}), session.email.toLowerCase().trim()]);
                    }
                    return res.status(200).json({ success: true, pending: true });
                }

                await client.query(`
                    INSERT INTO ba_meat_cuts (id, title, category, price, weight, description, ribbon, rfid, marbling, fat_ratio, images)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                    ON CONFLICT (id) DO NOTHING
                `, [
                    id, title, category || 'cuts', price, weight || null,
                    desc || null, ribbon || null, rfid || null,
                    marbling || null, fatRatio || null,
                    JSON.stringify(images || [])
                ]);

                return res.status(200).json({ success: true });
            }

            if (action === 'UPDATE_MEAT_CUT') {
                const { id, title, price, weight, desc, ribbon, rfid, marbling, fatRatio, images } = payload;
                const isAdmin = !!(perms && perms.isAdmin);

                if (!isAdmin) {
                    const existingPending = await client.query(
                        `SELECT id FROM ba_pending_approvals WHERE action = 'UPDATE_MEAT_CUT' AND (payload->>'id') = $1 AND status = 'pending'`,
                        [String(id)]
                    );
                    if (existingPending.rows.length === 0) {
                        const currentRes = await client.query('SELECT * FROM ba_meat_cuts WHERE id = $1', [id]);
                        await client.query(`
                            INSERT INTO ba_pending_approvals (action, payload, previous_snapshot, requested_by)
                            VALUES ('UPDATE_MEAT_CUT', $1, $2, $3)
                        `, [JSON.stringify(payload), JSON.stringify(currentRes.rows[0] || {}), session.email.toLowerCase().trim()]);
                    }
                    return res.status(200).json({ success: true, pending: true });
                }

                await client.query(`
                    UPDATE ba_meat_cuts
                    SET title=$1, price=$2, weight=$3, description=$4, ribbon=$5, rfid=$6, marbling=$7, fat_ratio=$8, images=$9
                    WHERE id=$10
                `, [
                    title, price, weight || null, desc || null,
                    ribbon || null, rfid || null, marbling || null,
                    fatRatio || null, JSON.stringify(images || []),
                    id
                ]);

                return res.status(200).json({ success: true });
            }

            if (action === 'DELETE_MEAT_CUT') {
                const { cutId } = payload;
                const isAdmin = !!(perms && perms.isAdmin);
                if (!isAdmin) {
                    const existingPending = await client.query(
                        `SELECT id FROM ba_pending_approvals WHERE action = 'DELETE_MEAT_CUT' AND (payload->>'cutId') = $1 AND status = 'pending'`,
                        [String(cutId)]
                    );
                    if (existingPending.rows.length === 0) {
                        const currentRes = await client.query('SELECT * FROM ba_meat_cuts WHERE id = $1', [cutId]);
                        if (currentRes.rows.length > 0) {
                            await client.query(`
                                INSERT INTO ba_pending_approvals (action, payload, previous_snapshot, requested_by)
                                VALUES ('DELETE_MEAT_CUT', $1, $2, $3)
                            `, [JSON.stringify({ cutId }), JSON.stringify(currentRes.rows[0]), session.email.toLowerCase().trim()]);
                        }
                    }
                    return res.status(200).json({ success: true, pending: true });
                }
                await client.query('DELETE FROM ba_meat_cuts WHERE id=$1', [cutId]);
                return res.status(200).json({ success: true });
            }

            if (action === 'RESET_DATABASE') {
                await client.query('TRUNCATE TABLE ba_animals, ba_weights, ba_treatments CASCADE');
                await client.query('TRUNCATE TABLE ba_orders');
                await client.query('TRUNCATE TABLE ba_meat_cuts');
                return res.status(200).json({ success: true });
            }

            return res.status(400).json({ success: false, error: `Action "${action}" is invalid` });
        }

        return res.status(405).json({ success: false, error: "Method not allowed" });

    } catch (e) {
        console.error("Database sync endpoint crash:", e);
        return res.status(500).json({ success: false, error: e.message });
    } finally {
        await client.end();
    }
};
