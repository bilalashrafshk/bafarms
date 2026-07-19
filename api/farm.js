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

// Add sale columns to ba_animals if they don't exist yet (safe to run on every request)
async function ensureColumns(client) {
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
            ADD COLUMN IF NOT EXISTS images TEXT DEFAULT NULL
    `);

    // Links a logged treatment back to the specific quarantine-protocol checklist step
    // it fulfills (e.g. distinguishing the FMD day-1 dose from the FMD day-7 booster,
    // which otherwise share the same type/medicine and were being conflated). NULL for
    // treatments logged manually outside of a protocol checklist.
    await client.query(`
        ALTER TABLE ba_treatments
            ADD COLUMN IF NOT EXISTS protocol_task_id VARCHAR(50) DEFAULT NULL
    `);

    // Event log table — safe CREATE IF NOT EXISTS
    await client.query(`
        CREATE TABLE IF NOT EXISTS ba_events (
            id SERIAL PRIMARY KEY,
            animal_id INTEGER REFERENCES ba_animals(id) ON DELETE CASCADE,
            date DATE NOT NULL,
            event_type VARCHAR(50) NOT NULL,
            note TEXT,
            created_at TIMESTAMP DEFAULT NOW()
        )
    `);
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
                UNIQUE(date, pen)
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
            UNIQUE(date, pen)
        );
    `);
}

// Resolve (and lazily bootstrap) a staff member's per-section access. Existing/new staff
// default to full access on first sight so nobody who could already use the app loses
// access on deploy — an admin dials individual users down afterward from Settings.
async function resolvePermissions(client, session) {
    if (!session || !session.email) return null;
    const email = session.email.toLowerCase().trim();

    const existing = await client.query('SELECT * FROM ba_staff_permissions WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
        const row = existing.rows[0];
        return { isAdmin: row.is_admin, accessSales: row.access_sales, accessHerd: row.access_herd };
    }

    const adminEmails = (process.env.ADMIN_EMAILS || 'bilalashrafshk@gmail.com')
        .split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
    const isAdmin = adminEmails.includes(email);

    await client.query(`
        INSERT INTO ba_staff_permissions (email, is_admin, access_sales, access_herd)
        VALUES ($1, $2, TRUE, TRUE)
        ON CONFLICT (email) DO NOTHING
    `, [email, isAdmin]);

    return { isAdmin, accessSales: true, accessHerd: true };
}

// Action categories used to gate POST mutations by section access. Public checkout
// actions (ADD_ORDER, RECORD_SALE) are intentionally excluded — they must keep working
// for unauthenticated shoppers and for RotationPlanner's staff-initiated sale flow.
const HERD_ACTIONS = new Set([
    'ADD_ANIMAL', 'LOG_WEIGHT', 'LOG_TREATMENT', 'TRANSITION_STATUS', 'LOG_EVENT',
    'DELETE_ANIMAL', 'UPDATE_ANIMAL', 'RECORD_DEATH', 'DELETE_WEIGHT_LOG', 'DELETE_TREATMENT',
    'LOG_FEED', 'DELETE_FEED_LOG'
]);
const SALES_ACTIONS = new Set([
    'UPDATE_ORDER_STATUS', 'DELETE_ORDER', 'UPDATE_ENQUIRY_STATUS', 'DELETE_ENQUIRY',
    'SAVE_QUOTATION', 'UPDATE_QUOTATION_STATUS', 'DELETE_QUOTATION',
    'SAVE_SPEC_SHEET', 'DELETE_SPEC_SHEET', 'ADD_MEAT_CUT', 'UPDATE_MEAT_CUT', 'DELETE_MEAT_CUT'
]);
const ADMIN_ONLY_ACTIONS = new Set(['RESET_DATABASE', 'UPDATE_STAFF_PERMISSIONS']);

// Insert 6 default meat cuts if ba_meat_cuts is empty
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

        // 1. Trigger database provisioning on-demand if tables do not exist
        await ensureTables(client);
        await ensureColumns(client);
        await ensureDefaultCuts(client);

        // 2. Resolve this staff member's per-section access (null if unauthenticated)
        const perms = isStaff ? await resolvePermissions(client, session) : null;
        const canHerd = isStaff && !!(perms && (perms.isAdmin || perms.accessHerd));
        const canSales = isStaff && !!(perms && (perms.isAdmin || perms.accessSales));

        // ─── GET ENDPOINT: LOAD FULL DATABASE STATE ───
        if (req.method === 'GET') {
            // Format date objects to clean strings (YYYY-MM-DD)
            const formatDate = (dateStr) => {
                if (!dateStr) return '';
                const d = new Date(dateStr);
                return d.toISOString().split('T')[0];
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

            const animalsRes = await client.query('SELECT * FROM ba_animals ORDER BY id ASC');
            const weightsRes = canHerd
                ? await client.query('SELECT * FROM ba_weights ORDER BY date ASC, id ASC')
                : { rows: [] };
            const treatmentsRes = canHerd
                ? await client.query('SELECT * FROM ba_treatments ORDER BY date ASC, id ASC')
                : { rows: [] };
            const eventsRes = canHerd
                ? await client.query('SELECT * FROM ba_events ORDER BY date ASC, id ASC')
                : { rows: [] };
            const feedLogsRes = canHerd
                ? await client.query('SELECT * FROM ba_feed_logs ORDER BY date DESC, pen ASC')
                : { rows: [] };
            const ordersRes = canSales
                ? await client.query('SELECT * FROM ba_orders ORDER BY created_at DESC')
                : { rows: [] };
            const meatCutsRes = await client.query('SELECT * FROM ba_meat_cuts ORDER BY created_at ASC');
            const enquiriesRes = canSales
                ? await client.query('SELECT * FROM ba_export_enquiries ORDER BY created_at DESC')
                : { rows: [] };
            const quotationsRes = canSales
                ? await client.query('SELECT * FROM ba_quotations ORDER BY id DESC')
                : { rows: [] };
            const specSheetsRes = canSales
                ? await client.query('SELECT * FROM ba_spec_sheets ORDER BY doc_ref DESC')
                : { rows: [] };
            const staffPermsRes = (isStaff && perms && perms.isAdmin)
                ? await client.query('SELECT email, is_admin, access_sales, access_herd FROM ba_staff_permissions ORDER BY email ASC')
                : { rows: [] };

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
                images: row.images ? JSON.parse(row.images) : null
            }));

            const weightLogs = weightsRes.rows.map(row => ({
                id: row.id,
                animalId: row.animal_id,
                date: formatDate(row.date),
                weight: parseFloat(row.weight),
                adg: parseFloat(row.adg || 0)
            }));

            const treatments = treatmentsRes.rows.map(row => ({
                id: row.id,
                animalId: row.animal_id,
                date: formatDate(row.date),
                type: row.type,
                medicine: row.medicine,
                dosage: row.dosage,
                withholding: parseInt(row.withholding || 0),
                protocolTaskId: row.protocol_task_id || null
            }));

            const events = eventsRes.rows.map(row => ({
                id: row.id,
                animalId: row.animal_id,
                date: formatDate(row.date),
                eventType: row.event_type,
                note: row.note
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
                createdBy: row.created_by || null
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

            const sessionOut = isStaff ? {
                name: session.name,
                email: session.email,
                picture: session.picture,
                role: session.role,
                isAdmin: !!(perms && perms.isAdmin),
                accessSales: canSales,
                accessHerd: canHerd
            } : null;

            return res.status(200).json({ success: true, animals, weightLogs, treatments, events, feedLogs, orders, meatCuts, enquiries, quotations, specSheets, session: sessionOut, staffPermissions });
        }

        // ─── POST ENDPOINT: LOG TRANSACTION DATA ───
        if (req.method === 'POST') {
            const { action, payload } = req.body;

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

            if (action === 'ADD_ANIMAL') {
                const { rfid, breed, entryDate, entryWeight, targetWeight, purchasePrice, source, status, pen, price, desc, images } = payload;

                const animalRes = await client.query(`
                    INSERT INTO ba_animals (rfid, breed, entry_date, entry_weight, current_weight, target_weight, purchase_price, source, status, pen, price, description, images)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
                    RETURNING *
                `, [
                    rfid, breed, entryDate, entryWeight, entryWeight, targetWeight, purchasePrice, source, status, pen || null,
                    price || null, desc || null, images ? JSON.stringify(images) : null
                ]);

                const animal = animalRes.rows[0];

                // Create initial entry scale
                await client.query(`
                    INSERT INTO ba_weights (animal_id, date, weight, adg)
                    VALUES ($1, $2, $3, 0)
                `, [animal.id, entryDate, entryWeight]);

                // Log registration event
                await client.query(`
                    INSERT INTO ba_events (animal_id, date, event_type, note)
                    VALUES ($1, $2, 'registered', $3)
                `, [animal.id, entryDate, `Registered — ${breed}, ${entryWeight}kg, ${status}`]);

                return res.status(200).json({ success: true, animalId: animal.id });
            }

            if (action === 'LOG_WEIGHT') {
                const { animalId, date, weight, adg } = payload;

                await client.query(`
                    INSERT INTO ba_weights (animal_id, date, weight, adg)
                    VALUES ($1, $2, $3, $4)
                `, [animalId, date, weight, adg]);

                await client.query(`
                    UPDATE ba_animals
                    SET current_weight = $1
                    WHERE id = $2
                `, [weight, animalId]);

                return res.status(200).json({ success: true });
            }

            if (action === 'LOG_TREATMENT') {
                const { animalId, date, type, medicine, dosage, withholding, protocolTaskId } = payload;

                await client.query(`
                    INSERT INTO ba_treatments (animal_id, date, type, medicine, dosage, withholding, protocol_task_id)
                    VALUES ($1, $2, $3, $4, $5, $6, $7)
                `, [animalId, date, type, medicine, dosage, withholding, protocolTaskId || null]);

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
                    INSERT INTO ba_events (animal_id, date, event_type, note)
                    VALUES ($1, $2, $3, $4)
                `, [animalId, date || new Date().toISOString().split('T')[0], 'status_change', note || status]);

                return res.status(200).json({ success: true });
            }

            if (action === 'LOG_EVENT') {
                const { animalId, date, eventType, note } = payload;
                await client.query(`
                    INSERT INTO ba_events (animal_id, date, event_type, note)
                    VALUES ($1, $2, $3, $4)
                `, [animalId, date, eventType, note]);
                return res.status(200).json({ success: true });
            }

            if (action === 'DELETE_ANIMAL') {
                const { animalId } = payload;
                await client.query('DELETE FROM ba_animals WHERE id = $1', [animalId]);
                return res.status(200).json({ success: true });
            }

            if (action === 'UPDATE_ANIMAL') {
                const { id, rfid, breed, entryDate, entryWeight, targetWeight, purchasePrice, source, status, pen, price, desc, images } = payload;
                await client.query(`
                    UPDATE ba_animals
                    SET rfid = $1, breed = $2, entry_date = $3, entry_weight = $4, target_weight = $5, purchase_price = $6, source = $7, status = $8, pen = $9, price = $10, description = $11, images = $12
                    WHERE id = $13
                `, [
                    rfid, breed, entryDate, entryWeight, targetWeight, purchasePrice, source, status, pen || null,
                    price || null, desc || null, images ? JSON.stringify(images) : null,
                    id
                ]);
                return res.status(200).json({ success: true });
            }

            if (action === 'RECORD_DEATH') {
                const { animalId, deceasedDate, deceasedCause } = payload;
                await client.query(`
                    UPDATE ba_animals
                    SET status = 'Deceased', deceased_date = $1, deceased_cause = $2
                    WHERE id = $3
                `, [deceasedDate, deceasedCause, animalId]);
                await client.query(`
                    INSERT INTO ba_events (animal_id, date, event_type, note)
                    VALUES ($1, $2, 'deceased', $3)
                `, [animalId, deceasedDate, `Deceased — ${deceasedCause}`]);
                return res.status(200).json({ success: true });
            }

            if (action === 'RECORD_SALE') {
                const { animalId, salePrice, buyerName, saleDate } = payload;

                // Food-safety gate: refuse the sale if any logged treatment's withholding
                // (withdrawal) period has not yet elapsed as of the sale date. This is the
                // authoritative check — UI filters elsewhere are a convenience, not a guarantee.
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

                await client.query(`
                    UPDATE ba_animals
                    SET status = 'Sold', sale_price = $1, buyer_name = $2, sale_date = $3
                    WHERE id = $4
                `, [salePrice, buyerName, saleDate, animalId]);
                await client.query(`
                    INSERT INTO ba_events (animal_id, date, event_type, note)
                    VALUES ($1, $2, 'sold', $3)
                `, [animalId, saleDate, `Sold to ${buyerName} — PKR ${salePrice?.toLocaleString()}`]);
                return res.status(200).json({ success: true });
            }

            if (action === 'DELETE_WEIGHT_LOG') {
                const { logId } = payload;
                await client.query('DELETE FROM ba_weights WHERE id = $1', [logId]);
                return res.status(200).json({ success: true });
            }

            if (action === 'DELETE_TREATMENT') {
                const { treatmentId } = payload;
                await client.query('DELETE FROM ba_treatments WHERE id = $1', [treatmentId]);
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
                    totalDmKg, totalBatchKg, totalCost, costPerAnimal, notes
                } = payload;

                if (!date) {
                    return res.status(400).json({ success: false, error: "Date is required" });
                }

                await client.query(`
                    INSERT INTO ba_feed_logs (date, pen, animal_count, ingredients, total_dm_kg, total_batch_kg, total_cost, cost_per_animal, notes, created_by, created_at)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
                    ON CONFLICT (date, pen) DO UPDATE SET
                        animal_count = EXCLUDED.animal_count,
                        ingredients = EXCLUDED.ingredients,
                        total_dm_kg = EXCLUDED.total_dm_kg,
                        total_batch_kg = EXCLUDED.total_batch_kg,
                        total_cost = EXCLUDED.total_cost,
                        cost_per_animal = EXCLUDED.cost_per_animal,
                        notes = EXCLUDED.notes,
                        created_by = EXCLUDED.created_by,
                        created_at = NOW()
                `, [
                    date, pen || 'ALL', animalCount || 0, JSON.stringify(ingredients || []),
                    totalDmKg || 0, totalBatchKg || 0, totalCost || 0, costPerAnimal || 0,
                    notes || null, session ? session.email : null
                ]);

                return res.status(200).json({ success: true });
            }

            if (action === 'DELETE_FEED_LOG') {
                const { date, pen } = payload;
                await client.query('DELETE FROM ba_feed_logs WHERE date = $1 AND pen = $2', [date, pen || 'ALL']);
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
                await client.query('DELETE FROM ba_spec_sheets WHERE doc_ref=$1', [refId]);
                return res.status(200).json({ success: true });
            }

            if (action === 'ADD_MEAT_CUT') {
                const { id, title, category, price, weight, desc, ribbon, rfid, marbling, fatRatio, images } = payload;

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
