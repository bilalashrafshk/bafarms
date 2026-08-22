const { OAuth2Client } = require('google-auth-library');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');

// Load local .env file manually if process.env values are not set (mirrors api/farm.js)
if (!process.env.SESSION_SECRET) {
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
        console.warn("Unable to load local .env file manually in auth api:", e);
    }
}

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || process.env.VITE_GOOGLE_CLIENT_ID;
const SESSION_SECRET = process.env.SESSION_SECRET;
// Long baseline TTL — nothing in this portal is highly sensitive, and the client
// silently refreshes the token (see the `refresh` branch below) every time the
// staff member is actively using the app, so this is really just the "how long can
// you go without opening the app before you have to sign in again" ceiling.
const SESSION_TTL = '30d';

const getEmailList = (envVal, fallback) => {
    if (!envVal) return fallback;
    return envVal.split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
};

const { Client } = require('pg');

const DEFAULT_STAFF_PERMISSIONS = [
    { email: 'bilalashraf248@gmail.com', isAdmin: true, accessSales: true, accessHerd: true, role: 'Internal Corporate Staff' },
    { email: 'bilalashrafshk@gmail.com', isAdmin: true, accessSales: true, accessHerd: true, role: 'Internal Corporate Staff' },
    { email: 'codeex624@gmail.com', isAdmin: false, accessSales: false, accessHerd: true, role: 'Farm Operations Staff' },
    { email: 'drsami841@gmail.com', isAdmin: false, accessSales: false, accessHerd: true, role: 'Veterinary Staff' },
    { email: 'fazeel6254@gmail.com', isAdmin: false, accessSales: false, accessHerd: true, role: 'Farm Operations Staff' },
    { email: 'hania.waseem2@gmail.com', isAdmin: false, accessSales: false, accessHerd: true, role: 'Farm Operations Staff' },
    { email: 'khurramashraf031@gmail.com', isAdmin: false, accessSales: true, accessHerd: true, role: 'Internal Corporate Staff' },
    { email: 'muhammadashraf2171959@gmail.com', isAdmin: false, accessSales: true, accessHerd: true, role: 'Internal Corporate Staff' },
    { email: 'saqibs111@gmail.com', isAdmin: false, accessSales: true, accessHerd: true, role: 'Internal Corporate Staff' }
];

// Authoritative server-side authorization check — mirrors (and replaces trust in) the
// client-side logic that used to live in Login.jsx. Checks domain, env vars, and ba_staff_permissions DB table.
const verifyAndAuthorizeEmail = async (email) => {
    const cleaned = email.toLowerCase().trim();
    const adminEmails = getEmailList(process.env.ADMIN_EMAILS || process.env.VITE_ADMIN_EMAILS, ['bilalashrafshk@gmail.com', 'bilalashraf248@gmail.com']);
    const isHardcodedAdmin = adminEmails.includes(cleaned) || cleaned.endsWith('@bafoods.pk');

    const defaultStaff = DEFAULT_STAFF_PERMISSIONS.find(p => p.email.toLowerCase() === cleaned);

    const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.bafarms_DATABASE_URL || process.env.bafarms_DATABASE_URL_UNPOOLED;
    if (connectionString) {
        const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
        try {
            await client.connect();
            await client.query(`
                CREATE TABLE IF NOT EXISTS ba_staff_permissions (
                    email VARCHAR(150) PRIMARY KEY,
                    is_admin BOOLEAN NOT NULL DEFAULT FALSE,
                    access_sales BOOLEAN NOT NULL DEFAULT TRUE,
                    access_herd BOOLEAN NOT NULL DEFAULT TRUE,
                    updated_at TIMESTAMP DEFAULT NOW()
                )
            `);
            const dbRes = await client.query('SELECT is_admin, access_sales, access_herd FROM ba_staff_permissions WHERE LOWER(email) = $1', [cleaned]);
            if (dbRes.rows.length > 0) {
                await client.end();
                const row = dbRes.rows[0];
                const isAdmin = Boolean(row.is_admin || isHardcodedAdmin);
                return {
                    authorized: true,
                    role: isAdmin ? 'Internal Corporate Staff' : (defaultStaff?.role || 'Farm Operations Staff'),
                    isAdmin,
                    accessSales: Boolean(row.access_sales || isAdmin),
                    accessHerd: Boolean(row.access_herd || isAdmin)
                };
            }
            if (defaultStaff) {
                await client.query(
                    'INSERT INTO ba_staff_permissions (email, is_admin, access_sales, access_herd) VALUES ($1, $2, $3, $4) ON CONFLICT (email) DO UPDATE SET is_admin = $2, access_sales = $3, access_herd = $4',
                    [defaultStaff.email, defaultStaff.isAdmin, defaultStaff.accessSales, defaultStaff.accessHerd]
                );
            }
            await client.end();
        } catch (e) {
            console.error('Error checking ba_staff_permissions in auth API:', e);
            try { await client.end(); } catch (_) {}
        }
    }

    if (isHardcodedAdmin) {
        return {
            authorized: true,
            role: 'Internal Corporate Staff',
            isAdmin: true,
            accessSales: true,
            accessHerd: true
        };
    }

    if (defaultStaff) {
        return {
            authorized: true,
            role: defaultStaff.role || 'Farm Operations Staff',
            isAdmin: defaultStaff.isAdmin,
            accessSales: defaultStaff.accessSales,
            accessHerd: defaultStaff.accessHerd
        };
    }

    const allowedEmails = getEmailList(process.env.ALLOWED_EMAILS || process.env.VITE_ALLOWED_EMAILS, []);
    if (allowedEmails.includes(cleaned)) {
        return {
            authorized: true,
            role: 'Staff',
            isAdmin: false,
            accessSales: true,
            accessHerd: true
        };
    }

    return { authorized: false };
};

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, error: 'Method not allowed' });
    }

    if (!SESSION_SECRET) {
        console.error('SESSION_SECRET is not configured — staff login is disabled until this is set.');
        return res.status(500).json({ success: false, error: 'Server auth is not configured (missing SESSION_SECRET). Contact an administrator.' });
    }

    if (!GOOGLE_CLIENT_ID) {
        console.error('GOOGLE_CLIENT_ID is not configured — staff login is disabled until this is set.');
        return res.status(500).json({ success: false, error: 'Server auth is not configured (missing GOOGLE_CLIENT_ID). Contact an administrator.' });
    }

    const { credential, refresh } = req.body || {};

    // ─── SLIDING SESSION REFRESH ───
    // Called silently by the client (on focus, on an interval) while a staff member
    // is actively using the portal, so a valid session never dies mid-use — it only
    // needs a fresh Google sign-in if the token has actually expired (i.e. the app
    // hasn't been opened in SESSION_TTL). This mirrors how most dashboards keep an
    // active user signed in indefinitely without resorting to a short, hard timeout.
    if (refresh) {
        const authHeader = req.headers['authorization'] || req.headers['Authorization'];
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ success: false, error: 'Missing session token.' });
        }

        try {
            const oldToken = authHeader.slice(7);
            const decoded = jwt.verify(oldToken, SESSION_SECRET); // throws if actually expired/invalid

            // Re-check authorization rather than trusting the old token's claims — if
            // the staff allowlist changed since the token was issued, that revocation
            // should take effect on the next refresh, not just on a future re-login.
            const authResult = await verifyAndAuthorizeEmail(decoded.email);
            if (!authResult.authorized) {
                return res.status(403).json({ success: false, error: 'Access has been revoked.' });
            }

            const user = {
                name: decoded.name,
                email: decoded.email,
                picture: decoded.picture,
                role: authResult.role,
                isAdmin: Boolean(authResult.isAdmin),
                accessSales: Boolean(authResult.accessSales),
                accessHerd: Boolean(authResult.accessHerd),
                provider: decoded.provider || 'Google'
            };
            const newToken = jwt.sign(user, SESSION_SECRET, { expiresIn: SESSION_TTL });

            return res.status(200).json({ success: true, token: newToken, user });
        } catch (err) {
            return res.status(401).json({ success: false, error: 'Session token expired or invalid. Please sign in again.' });
        }
    }

    if (!credential) {
        return res.status(400).json({ success: false, error: 'Missing Google credential.' });
    }

    try {
        const client = new OAuth2Client(GOOGLE_CLIENT_ID);
        const ticket = await client.verifyIdToken({
            idToken: credential,
            audience: GOOGLE_CLIENT_ID
        });
        const payload = ticket.getPayload();

        if (!payload || !payload.email) {
            return res.status(401).json({ success: false, error: 'Google authentication failed. ID token was malformed.' });
        }

        if (!payload.email_verified) {
            return res.status(401).json({ success: false, error: 'Google account email is not verified.' });
        }

        const authResult = await verifyAndAuthorizeEmail(payload.email);
        if (!authResult.authorized) {
            return res.status(403).json({ success: false, error: `Access Denied: "${payload.email}" is not registered in the staff directory.` });
        }

        const user = {
            name: payload.name,
            email: payload.email,
            picture: payload.picture,
            role: authResult.role,
            isAdmin: Boolean(authResult.isAdmin),
            accessSales: Boolean(authResult.accessSales),
            accessHerd: Boolean(authResult.accessHerd),
            provider: 'Google'
        };

        const token = jwt.sign(user, SESSION_SECRET, { expiresIn: SESSION_TTL });

        return res.status(200).json({ success: true, token, user });
    } catch (err) {
        console.error('Google ID token verification failed:', err.message);
        return res.status(401).json({ success: false, error: 'Google authentication failed. Token could not be verified.' });
    }
};
