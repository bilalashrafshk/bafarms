const { Client } = require('pg');

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
    `);
}

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
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // Resolve connection from environment secrets (Neon standard parameters)
    const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;

    if (!connectionString) {
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

        // ─── GET ENDPOINT: LOAD FULL DATABASE STATE ───
        if (req.method === 'GET') {
            const animalsRes = await client.query('SELECT * FROM ba_animals ORDER BY id ASC');
            const weightsRes = await client.query('SELECT * FROM ba_weights ORDER BY date ASC, id ASC');
            const treatmentsRes = await client.query('SELECT * FROM ba_treatments ORDER BY date ASC, id ASC');
            const ordersRes = await client.query('SELECT * FROM ba_orders ORDER BY created_at DESC');
            const meatCutsRes = await client.query('SELECT * FROM ba_meat_cuts ORDER BY created_at ASC');
            const enquiriesRes = await client.query('SELECT * FROM ba_export_enquiries ORDER BY created_at DESC');

            // Format date objects to clean strings (YYYY-MM-DD)
            const formatDate = (dateStr) => {
                if (!dateStr) return '';
                const d = new Date(dateStr);
                return d.toISOString().split('T')[0];
            };

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
                withholding: parseInt(row.withholding || 0)
            }));

            const events = eventsRes.rows.map(row => ({
                id: row.id,
                animalId: row.animal_id,
                date: formatDate(row.date),
                eventType: row.event_type,
                note: row.note
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

            return res.status(200).json({ success: true, animals, weightLogs, treatments, events, orders, meatCuts, enquiries });
        }

        // ─── POST ENDPOINT: LOG TRANSACTION DATA ───
        if (req.method === 'POST') {
            const { action, payload } = req.body;

            if (!action) {
                return res.status(400).json({ success: false, error: "Action is required" });
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
                const { animalId, date, type, medicine, dosage, withholding } = payload;

                await client.query(`
                    INSERT INTO ba_treatments (animal_id, date, type, medicine, dosage, withholding)
                    VALUES ($1, $2, $3, $4, $5, $6)
                `, [animalId, date, type, medicine, dosage, withholding]);

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

                return res.status(200).json({ success: true });
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
