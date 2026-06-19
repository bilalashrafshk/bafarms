const { Client } = require('pg');

// Self-healing database provision for export enquiries
async function ensureEnquiryTable(client) {
    await client.query(`
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

module.exports = async (req, res) => {
    // Inject CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;

    // Fallback cuts if database is not configured
    const defaultCuts = [
        { id: 'ribeye', title: 'Sahiwal Prime Ribeye Steak', category: 'cuts', price: 2850, weight: '1.0 kg Pack (2 Steaks)', marbling: 'Grade 4+ (Aged)', fat_ratio: '18% Fat Cap' },
        { id: 'tbone', title: 'Cholistani Gourmet T-Bone', category: 'cuts', price: 2650, weight: '1.2 kg Pack (2 Steaks)', marbling: 'Grade 3+ (Premium)', fat_ratio: '14%' },
        { id: 'striploin', title: 'Premium Angus Cross Striploin', category: 'cuts', price: 3100, weight: '1.0 kg Pack (3 Steaks)', marbling: 'Grade 5 (Supreme)', fat_ratio: '20%' },
        { id: 'minced', title: 'Organic Grass-Fed Minced Beef', category: 'cuts', price: 1850, weight: '1.0 kg Pack (Fine Ground)', marbling: 'Standard Lean', fat_ratio: '8%' },
        { id: 'bong', title: 'Premium Beef Shank (Bong Cut)', category: 'cuts', price: 1950, weight: '1.5 kg Pack (Bone-in)', marbling: 'Lean & Marrow', fat_ratio: '10%' },
        { id: 'patties', title: 'Gourmet Chuck Burger Patties', category: 'cuts', price: 1600, weight: '6 Patties (900g Total)', marbling: 'Burger Ratio 80/20', fat_ratio: '20%' }
    ];

    if (!connectionString) {
        if (req.method === 'GET') {
            return res.status(200).json({ success: true, cuts: defaultCuts, unconfigured: true });
        }
        if (req.method === 'POST') {
            // Mock success in development if DB is not configured
            const { company, contact, email, phone, country, cut_type, volume_mt, frequency } = req.body;
            if (!company || !contact || !email || !phone || !country || !cut_type || !volume_mt) {
                return res.status(400).json({ success: false, error: "Missing required fields" });
            }
            const refId = `BA-EX-${Math.floor(10000 + Math.random() * 90000)}`;
            return res.status(200).json({
                success: true,
                message: "Neon Database unconfigured. Simulated success.",
                id: refId,
                unconfigured: true
            });
        }
    }

    const client = new Client({
        connectionString,
        ssl: { rejectUnauthorized: false }
    });

    try {
        await client.connect();
        await ensureEnquiryTable(client);

        // ─── GET ENDPOINT: FETCH ACTIVE CUTS FOR B2B PORTFOLIO ───
        if (req.method === 'GET') {
            const cutsRes = await client.query('SELECT * FROM ba_meat_cuts ORDER BY created_at ASC');
            
            let cuts = cutsRes.rows.map(row => ({
                id: row.id,
                title: row.title,
                category: row.category,
                price: parseFloat(row.price),
                weight: row.weight,
                desc: row.description,
                ribbon: row.ribbon,
                rfid: row.rfid,
                marbling: row.marbling,
                fat_ratio: row.fat_ratio
            }));

            // Fallback if no cuts seeded yet
            if (cuts.length === 0) {
                cuts = defaultCuts;
            }

            return res.status(200).json({ success: true, cuts });
        }

        // ─── POST ENDPOINT: SUBMIT B2B EXPORT ENQUIRY ───
        if (req.method === 'POST') {
            const { company, contact, email, phone, country, cut_type, volume_mt, frequency, notes } = req.body;

            // Validate mandatory fields
            if (!company || !contact || !email || !phone || !country || !cut_type || !volume_mt) {
                return res.status(400).json({ success: false, error: "Missing required fields" });
            }

            // Generate unique B2B Enquiry reference code
            const refId = `BA-EX-${Math.floor(10000 + Math.random() * 90000)}`;

            await client.query(`
                INSERT INTO ba_export_enquiries (id, company, contact, email, phone, country, cut_type, volume_mt, frequency, notes)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            `, [
                refId,
                company.trim(),
                contact.trim(),
                email.trim(),
                phone.trim(),
                country.trim(),
                cut_type,
                parseFloat(volume_mt),
                frequency || 'One-time',
                notes ? notes.trim() : null
            ]);

            return res.status(200).json({ success: true, id: refId });
        }

        return res.status(405).json({ success: false, error: "Method not allowed" });

    } catch (e) {
        console.error("Database connection crash inside enquiry handler:", e);
        return res.status(500).json({ success: false, error: e.message });
    } finally {
        await client.end();
    }
};
