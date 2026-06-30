const { Client } = require('pg');
const nodemailer = require('nodemailer');
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
        console.warn("Unable to load local .env file manually:", e);
    }
}

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

// SMTP Email Sender Helper
async function sendEnquiryEmail(details) {
    const smtpHost = process.env.SMTP_HOST;
    const smtpPort = process.env.SMTP_PORT || 587;
    const smtpUser = process.env.SMTP_USER;
    const smtpPass = process.env.SMTP_PASS;
    const smtpSecure = process.env.SMTP_SECURE === 'true' || smtpPort == 465;
    const smtpFrom = process.env.SMTP_FROM || smtpUser || 'no-reply@bafoods.pk';

    if (!smtpHost || !smtpUser || !smtpPass) {
        console.warn("⚠️ SMTP credentials not fully configured. Email sending simulated.");
        console.log("Simulated Email details:", {
            to: 'sales@bafoods.pk',
            replyTo: details.email,
            subject: `[B2B Enquiry] ${details.company} - Ref: ${details.refId}`,
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

    const htmlContent = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px; background-color: #fcfcfc;">
            <div style="text-align: center; border-bottom: 2px solid #1e3d2f; padding-bottom: 15px; margin-bottom: 20px;">
                <h2 style="color: #1e3d2f; margin: 0; font-size: 24px;">BA Foods</h2>
                <p style="color: #8c763e; margin: 5px 0 0 0; font-size: 14px; letter-spacing: 1px; text-transform: uppercase; font-weight: bold;">B2B Export Portal Enquiry</p>
            </div>
            
            <div style="margin-bottom: 20px;">
                <p style="font-size: 16px; color: #333; line-height: 1.5;">A new corporate inquiry has been received from the website portal.</p>
            </div>
            
            <table style="width: 100%; border-collapse: collapse; margin-bottom: 25px;">
                <tr>
                    <td style="padding: 10px; border-bottom: 1px solid #eeeeee; font-weight: bold; color: #1e3d2f; width: 40%;">Reference ID</td>
                    <td style="padding: 10px; border-bottom: 1px solid #eeeeee; color: #333;"><strong>${details.refId}</strong></td>
                </tr>
                <tr>
                    <td style="padding: 10px; border-bottom: 1px solid #eeeeee; font-weight: bold; color: #1e3d2f;">Company Name</td>
                    <td style="padding: 10px; border-bottom: 1px solid #eeeeee; color: #333;">${details.company}</td>
                </tr>
                <tr>
                    <td style="padding: 10px; border-bottom: 1px solid #eeeeee; font-weight: bold; color: #1e3d2f;">Contact Person</td>
                    <td style="padding: 10px; border-bottom: 1px solid #eeeeee; color: #333;">${details.contact}</td>
                </tr>
                <tr>
                    <td style="padding: 10px; border-bottom: 1px solid #eeeeee; font-weight: bold; color: #1e3d2f;">Corporate Email</td>
                    <td style="padding: 10px; border-bottom: 1px solid #eeeeee; color: #333;"><a href="mailto:${details.email}" style="color: #8c763e; text-decoration: none;">${details.email}</a></td>
                </tr>
                <tr>
                    <td style="padding: 10px; border-bottom: 1px solid #eeeeee; font-weight: bold; color: #1e3d2f;">Phone Number</td>
                    <td style="padding: 10px; border-bottom: 1px solid #eeeeee; color: #333;">${details.phone}</td>
                </tr>
                <tr>
                    <td style="padding: 10px; border-bottom: 1px solid #eeeeee; font-weight: bold; color: #1e3d2f;">Destination / Port</td>
                    <td style="padding: 10px; border-bottom: 1px solid #eeeeee; color: #333;">${details.country}</td>
                </tr>
                <tr>
                    <td style="padding: 10px; border-bottom: 1px solid #eeeeee; font-weight: bold; color: #1e3d2f;">Product / Cut</td>
                    <td style="padding: 10px; border-bottom: 1px solid #eeeeee; color: #333;">${details.cut_type}</td>
                </tr>
                <tr>
                    <td style="padding: 10px; border-bottom: 1px solid #eeeeee; font-weight: bold; color: #1e3d2f;">Volume (MT)</td>
                    <td style="padding: 10px; border-bottom: 1px solid #eeeeee; color: #333;">${details.volume_mt || '0'}</td>
                </tr>
                <tr>
                    <td style="padding: 10px; border-bottom: 1px solid #eeeeee; font-weight: bold; color: #1e3d2f;">Frequency</td>
                    <td style="padding: 10px; border-bottom: 1px solid #eeeeee; color: #333;">${details.frequency || 'One-time'}</td>
                </tr>
            </table>
            
            ${details.notes ? `
            <div style="background-color: #f7f9f8; border-left: 4px solid #8c763e; padding: 15px; margin-bottom: 25px; border-radius: 4px;">
                <h4 style="margin: 0 0 10px 0; color: #1e3d2f; font-size: 15px;">Additional Requirements / Specifications:</h4>
                <p style="margin: 0; color: #555; line-height: 1.5; font-size: 14px; white-space: pre-wrap;">${details.notes}</p>
            </div>
            ` : ''}
            
            <div style="text-align: center; color: #777; font-size: 12px; border-top: 1px solid #eee; padding-top: 15px; margin-top: 25px;">
                <p style="margin: 0;">This email was sent automatically from the BA Foods B2B Portal.</p>
                <p style="margin: 5px 0 0 0;">&copy; ${new Date().getFullYear()} BA Foods. All rights reserved.</p>
            </div>
        </div>
    `;

    await transporter.sendMail({
        from: `"${details.contact} via BA Foods" <${smtpFrom}>`,
        to: 'sales@bafoods.pk',
        replyTo: `"${details.contact}" <${details.email}>`,
        subject: `[B2B Enquiry] ${details.company} - Ref: ${details.refId}`,
        html: htmlContent
    });

    return { sent: true };
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
        {
            id: 'chilled_primal_cuts',
            title: 'Chilled Beef Primal Cuts',
            spec: 'Sahiwal x Friesian (Grain-Finished)',
            packaging: 'Vacuum packed; carton weights to buyer spec',
            shelf_life: 'Up to 120 Days Chilled (0-2°C)',
            weight: 'Carton weights to buyer spec',
            capacity: '5–10 tons/week, scaling with requirement'
        },
        {
            id: 'chilled_carcasses_quarters',
            title: 'Chilled Carcasses & Quarters',
            spec: 'Halal slaughtered chilled carcasses/quarters',
            packaging: 'High-barrier vacuum packed (UAE/GCC compliant)',
            shelf_life: 'Up to 120 Days Chilled (0-2°C)',
            weight: '30-45 kg quarter / 120-180 kg carcass',
            capacity: 'Air freighted, scaling with requirement'
        },
        {
            id: 'frozen_carcasses_quarters',
            title: 'Frozen Carcasses & Quarters',
            spec: 'Halal slaughtered frozen carcasses/quarters',
            packaging: 'Stockinette wrapped / custom wrapping',
            shelf_life: 'Up to 12 Months (Frozen at -18°C)',
            weight: '30-45 kg quarter / 120-180 kg carcass',
            capacity: 'Sea freight container reefers where volume justifies'
        },
        {
            id: 'frozen_primal_cuts',
            title: 'Frozen Primal Cuts',
            spec: 'Custom specifications on request',
            packaging: 'Vacuum packed in heavy shipping cartons',
            shelf_life: 'Up to 12 Months (Frozen at -18°C)',
            weight: 'Carton weights to buyer spec',
            capacity: 'Sea freight container reefers where volume justifies'
        },
        {
            id: 'beef_offal',
            title: 'Beef Offal & Variety Meats',
            spec: 'Export-grade beef offal & constituents',
            packaging: 'Vacuum packed / poly cartons',
            shelf_life: 'Up to 12 Months (Frozen at -18°C)',
            weight: 'Carton weights to buyer spec',
            capacity: 'Dispatched to high-value international markets'
        }
    ];

    // If database connection is not configured, we still want to support the POST endpoint for sending email
    if (!connectionString) {
        if (req.method === 'GET') {
            return res.status(200).json({ success: true, cuts: defaultCuts, unconfigured: true });
        }
        
        if (req.method === 'POST') {
            const { company, contact, email, phone, country, cut_type, volume_mt, frequency, notes } = req.body;
            
            const finalCountry = country ? country.trim() : 'Not Specified';
            const finalCutType = cut_type ? cut_type.trim() : 'General Inquiry';
            
            if (!company || !contact || !email || !phone) {
                return res.status(400).json({ success: false, error: "Missing required fields" });
            }
            
            const refId = `BA-EX-${Math.floor(10000 + Math.random() * 90000)}`;
            const parsedVolume = volume_mt ? parseFloat(volume_mt) : 0;
            const finalFrequency = frequency || 'One-time';

            let emailSent = false;
            let emailError = null;
            
            try {
                const mailRes = await sendEnquiryEmail({
                    refId,
                    company: company.trim(),
                    contact: contact.trim(),
                    email: email.trim(),
                    phone: phone.trim(),
                    country: finalCountry,
                    cut_type: finalCutType,
                    volume_mt: parsedVolume,
                    frequency: finalFrequency,
                    notes: notes ? notes.trim() : null
                });
                emailSent = !mailRes.simulated;
            } catch (mailErr) {
                console.error("Email sending failure in unconfigured DB mode:", mailErr);
                emailError = mailErr.message;
            }

            return res.status(200).json({
                success: true,
                message: "Neon Database unconfigured. Email processing completed.",
                id: refId,
                emailSent,
                emailError,
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
            // Return B2B export capability forms for the corporate page
            return res.status(200).json({ success: true, cuts: defaultCuts });
        }

        // ─── POST ENDPOINT: SUBMIT B2B EXPORT ENQUIRY ───
        if (req.method === 'POST') {
            const { company, contact, email, phone, country, cut_type, volume_mt, frequency, notes } = req.body;

            const finalCountry = country ? country.trim() : 'Not Specified';
            const finalCutType = cut_type ? cut_type.trim() : 'General Inquiry';

            // Validate mandatory fields
            if (!company || !contact || !email || !phone) {
                return res.status(400).json({ success: false, error: "Missing required fields" });
            }

            // Generate unique B2B Enquiry reference code
            const refId = `BA-EX-${Math.floor(10000 + Math.random() * 90000)}`;
            const parsedVolume = volume_mt ? parseFloat(volume_mt) : 0;
            const finalFrequency = frequency || 'One-time';

            await client.query(`
                INSERT INTO ba_export_enquiries (id, company, contact, email, phone, country, cut_type, volume_mt, frequency, notes)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            `, [
                refId,
                company.trim(),
                contact.trim(),
                email.trim(),
                phone.trim(),
                finalCountry,
                finalCutType,
                parsedVolume,
                finalFrequency,
                notes ? notes.trim() : null
            ]);

            let emailSent = false;
            let emailError = null;

            try {
                const mailRes = await sendEnquiryEmail({
                    refId,
                    company: company.trim(),
                    contact: contact.trim(),
                    email: email.trim(),
                    phone: phone.trim(),
                    country: finalCountry,
                    cut_type: finalCutType,
                    volume_mt: parsedVolume,
                    frequency: finalFrequency,
                    notes: notes ? notes.trim() : null
                });
                emailSent = !mailRes.simulated;
            } catch (mailErr) {
                console.error("Email sending failure in database mode:", mailErr);
                emailError = mailErr.message;
            }

            return res.status(200).json({ 
                success: true, 
                id: refId, 
                emailSent, 
                emailError 
            });
        }

        return res.status(405).json({ success: false, error: "Method not allowed" });

    } catch (e) {
        console.error("Database connection crash inside enquiry handler:", e);
        return res.status(500).json({ success: false, error: e.message });
    } finally {
        await client.end();
    }
};
