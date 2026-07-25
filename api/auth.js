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
const SESSION_TTL = '7d';

const getEmailList = (envVal, fallback) => {
    if (!envVal) return fallback;
    return envVal.split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
};

// Authoritative server-side authorization check — mirrors (and replaces trust in) the
// client-side logic that used to live in Login.jsx.
const verifyAndAuthorizeEmail = (email) => {
    const cleaned = email.toLowerCase().trim();

    if (cleaned.endsWith('@bafoods.pk')) {
        return { authorized: true, role: 'Internal Corporate Staff' };
    }

    const adminEmails = getEmailList(process.env.ADMIN_EMAILS || process.env.VITE_ADMIN_EMAILS, ['bilalashrafshk@gmail.com']);
    if (adminEmails.includes(cleaned)) {
        return { authorized: true, role: 'Internal Corporate Staff' };
    }

    const allowedEmails = getEmailList(process.env.ALLOWED_EMAILS || process.env.VITE_ALLOWED_EMAILS, ['guest@gmail.com']);
    if (allowedEmails.includes(cleaned)) {
        return { authorized: true, role: 'External Guest/Evaluator' };
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

    const { credential } = req.body || {};
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

        const authResult = verifyAndAuthorizeEmail(payload.email);
        if (!authResult.authorized) {
            return res.status(403).json({ success: false, error: `Access Denied: "${payload.email}" is not registered in the staff directory.` });
        }

        const user = {
            name: payload.name,
            email: payload.email,
            picture: payload.picture,
            role: authResult.role,
            provider: 'Google'
        };

        const token = jwt.sign(user, SESSION_SECRET, { expiresIn: SESSION_TTL });

        return res.status(200).json({ success: true, token, user });
    } catch (err) {
        console.error('Google ID token verification failed:', err.message);
        return res.status(401).json({ success: false, error: 'Google authentication failed. Token could not be verified.' });
    }
};
