/**
 * BA Foods — Model Context Protocol (MCP) Remote Server for Gemini Spark & AI Agents
 * 
 * Provides native tool discovery and execution for Google Gemini Spark, Claude, and MCP clients.
 * Protocol specification: JSON-RPC 2.0 over HTTP (Streamable HTTP / SSE / REST).
 *
 * Base Endpoint:
 * https://www.bafoods.pk/api/mcp?key=<BA_API_KEY>
 */

const fs = require('fs');
const path = require('path');
const v1Handler = require('./v1.js');

// Load environment variables locally if needed
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
        console.warn('Unable to load .env in mcp server:', e.message);
    }
}

const SERVER_INFO = {
    name: 'bafoods-smartherd-mcp',
    version: '1.0.0',
    protocolVersion: '2024-11-05'
};

// Tool Definitions with JSON Schema
const TOOLS = [
    {
        name: 'get_animal_passport',
        description: 'Get complete dossier for an individual cattle tag/RFID: Mandi weight, landed arrival weight, purchase price & procurement cost breakdown, current scale weight, total weight gain, days on feed (DOF), lifetime ADG, cost of feed till yet across feeding sessions, all historical weigh-ins, and all veterinary medical treatments with withholding status.',
        inputSchema: {
            type: 'object',
            properties: {
                tag: {
                    type: 'string',
                    description: 'Cattle visual ear tag number or RFID (e.g. "57", "36", "101")'
                }
            },
            required: ['tag']
        }
    },
    {
        name: 'get_cattle_weights',
        description: 'Get complete historical weight logs across the herd or filtered by tag, pen, or date range. Returns date, weight in kg, computed ADG between weigh-ins, and who recorded it.',
        inputSchema: {
            type: 'object',
            properties: {
                tag: { type: 'string', description: 'Filter by animal ear tag or RFID' },
                pen: { type: 'string', description: 'Filter by pen letter (e.g. "A", "B", "C")' },
                start_date: { type: 'string', description: 'Start date in YYYY-MM-DD' },
                end_date: { type: 'string', description: 'End date in YYYY-MM-DD' }
            }
        }
    },
    {
        name: 'get_pens',
        description: 'Get real-time pen roster with live head count, average animal weight, total pen biomass in kg, active forage type, target ADG, and pen notes.',
        inputSchema: {
            type: 'object',
            properties: {}
        }
    },
    {
        name: 'get_feed_logs',
        description: 'Get daily TMR split-feeding logs for a given date, including feeding percentages and kg-by-kg ingredient mass breakdown (Silage, Wanda, Chokar, Straw, etc.).',
        inputSchema: {
            type: 'object',
            properties: {
                date: { type: 'string', description: 'Date in YYYY-MM-DD (defaults to today)' },
                pen: { type: 'string', description: 'Filter by pen (e.g. "A")' }
            }
        }
    },
    {
        name: 'get_pen_checks',
        description: 'Get morning and evening feed bunk scores (0-100% feed clearance) and flagged off-feed or sick animals for a given date.',
        inputSchema: {
            type: 'object',
            properties: {
                date: { type: 'string', description: 'Date in YYYY-MM-DD (defaults to today)' }
            }
        }
    },
    {
        name: 'get_withholding_alerts',
        description: 'Get list of all cattle currently under slaughter withholding for veterinary medications/antibiotics, days remaining, and safe slaughter clearance date.',
        inputSchema: {
            type: 'object',
            properties: {}
        }
    },
    {
        name: 'get_tasks_upcoming',
        description: 'Get all upcoming and overdue tasks across the feedlot: overdue weigh-ins (>14 days), upcoming pen-by-pen weigh-in schedules (next 7-14 days), quarantine protocol milestones & graduations, active medical withholding clearance dates, and market-ready harvest cattle.',
        inputSchema: {
            type: 'object',
            properties: {
                pen: { type: 'string', description: 'Filter tasks by pen (e.g. "A", "C", "D")' },
                weigh_interval_days: { type: 'number', description: 'Weigh interval threshold in days (default 14)' }
            }
        }
    },
    {
        name: 'get_purchasing_history',
        description: 'Get delivery receipts of feed commodities and veterinary medicines: quantity, unit rate, total PKR cost, supplier, and notes.',
        inputSchema: {
            type: 'object',
            properties: {
                start_date: { type: 'string', description: 'Start date YYYY-MM-DD' },
                end_date: { type: 'string', description: 'End date YYYY-MM-DD' },
                item_name: { type: 'string', description: 'Filter by item name (e.g. "Silage", "Amovet")' }
            }
        }
    },
    {
        name: 'get_inventory_summary',
        description: 'Get warehouse and bunker inventory stock levels for all feed commodities.',
        inputSchema: {
            type: 'object',
            properties: {}
        }
    },
    {
        name: 'get_premix_formulas',
        description: 'Get active in-house Wanda recipes, exact ingredient inclusion percentages (e.g. Urea 1% vs 1.5%), and available raw materials.',
        inputSchema: {
            type: 'object',
            properties: {}
        }
    },
    {
        name: 'get_compliance_summary',
        description: 'Get high-level daily farm operational compliance for feeding and bunk checks (ideal for daily morning/evening status reports).',
        inputSchema: {
            type: 'object',
            properties: {
                date: { type: 'string', description: 'Date in YYYY-MM-DD (defaults to today)' }
            }
        }
    },
    {
        name: 'get_herd_analytics',
        description: 'Get comprehensive feedlot growth & performance analytics: Overall Herd Average ADG (kg/day), 30-day rolling ADG, Pen-by-pen ADG and biomass, breed performance, Days on Feed (DOF) cohorts, and cattle currently ready for slaughter/sale.',
        inputSchema: {
            type: 'object',
            properties: {}
        }
    },
    {
        name: 'get_financial_analytics',
        description: 'Get feedlot economics & financial KPIs: Total cattle procurement capital, cumulative feed spend, overhead expenses, total invested capital, blended feed cost per kg gain (PKR/kg), and daily feed cost per head.',
        inputSchema: {
            type: 'object',
            properties: {
                date: { type: 'string', description: 'Target date (YYYY-MM-DD) for multi-day feed cost trend and diet comparison. Defaults to latest verified date in DB.' }
            }
        }
    },
    {
        name: 'get_feed_efficiency',
        description: 'Get nutritional efficiency analytics: Feed Conversion Ratio (FCR = dry matter intake ÷ weight gain), total wet/dry TMR tonnage fed, and cumulative commodity consumption breakdown (Silage, Maize, Gluten, Chokar, Urea, etc.).',
        inputSchema: {
            type: 'object',
            properties: {}
        }
    },
    {
        name: 'get_feed_items',
        description: 'Get the complete, unified directory of all unique feed commodities, Wanda recipes, forages, and supplements the farm currently has in inventory or has ever purchased/fed historically. Separates feed commodities from veterinary medicines.',
        inputSchema: {
            type: 'object',
            properties: {}
        }
    },
    {
        name: 'add_feed_log',
        description: 'Record a daily TMR split-feeding for a pen. Subject to biological sanity clamps and Admin Approval if in Junior Employee mode.',
        inputSchema: {
            type: 'object',
            properties: {
                date: { type: 'string', description: 'Date in YYYY-MM-DD' },
                pen: { type: 'string', description: 'Pen identifier (e.g. "A", "B", "C")' },
                feeding_index: { type: 'integer', description: '1 for Morning feeding, 2 for Afternoon/Evening feeding' },
                num_feedings: { type: 'integer', description: 'Total planned feedings for day (typically 2)' },
                feeding_pct: { type: 'number', description: 'Percentage of daily ration (e.g. 50)' },
                total_batch_kg: { type: 'number', description: 'Total wet weight in kg distributed' },
                ingredients: {
                    type: 'array',
                    description: 'List of ingredients and kg amounts that sum to total_batch_kg',
                    items: {
                        type: 'object',
                        properties: {
                            name: { type: 'string' },
                            kg: { type: 'number' }
                        },
                        required: ['name', 'kg']
                    }
                },
                notes: { type: 'string', description: 'Optional operational notes' }
            },
            required: ['date', 'pen', 'feeding_index', 'total_batch_kg', 'ingredients']
        }
    },
    {
        name: 'log_cattle_weight',
        description: 'Record a scale weight measurement for an animal. Clamped between 40kg-1200kg with biological sanity checks. Subject to Admin Approval if in Junior Employee mode.',
        inputSchema: {
            type: 'object',
            properties: {
                tag: { type: 'string', description: 'Cattle visual ear tag or RFID' },
                weight: { type: 'number', description: 'Weight in kilograms' },
                date: { type: 'string', description: 'Date in YYYY-MM-DD' },
                pen: { type: 'string', description: 'Optional current pen' },
                notes: { type: 'string', description: 'Optional notes' }
            },
            required: ['tag', 'weight', 'date']
        }
    },
    {
        name: 'log_treatment',
        description: 'Record a veterinary treatment, antibiotic, dewormer, or vaccination for one or more cattle. If dosage is omitted, standard protocol dosages are automatically applied (e.g. 3ml for HS Vaccine, 2ml for FMD/Pulmovac, 5ml for Ivermectin, 30ml for Oxafax). Automatically updates withholding clearance dates and quarantine checklist. Subject to Admin Approval in Junior Employee mode.',
        inputSchema: {
            type: 'object',
            properties: {
                tags: { type: 'array', items: { type: 'string' }, description: 'Array of cattle ear tags or RFIDs (e.g. ["02", "03", "04"])' },
                tag: { type: 'string', description: 'Single ear tag or comma-separated string (e.g. "02" or "2, 3, 4")' },
                date: { type: 'string', description: 'Administration date in YYYY-MM-DD (defaults to today)' },
                medicine: { type: 'string', description: 'Medicine or vaccine name (e.g. "HS Vaccine", "FMD Vaccine", "Ivermectin", "Pulmovac")' },
                dosage: { type: 'string', description: 'Administered dosage (e.g. "3 ml", "10 ml"). Optional — defaults to standard protocol dose if omitted.' },
                type: { type: 'string', description: 'Treatment, Vaccination, or Deworming' },
                withholding_days: { type: 'integer', description: 'Withdrawal period in days (e.g. 0 for vaccines, 14 for Oxafax, 21 for Ivermectin)' },
                notes: { type: 'string', description: 'Clinical symptoms, diagnosis, or administration notes' }
            },
            required: ['medicine']
        }
    },
    {
        name: 'add_purchase',
        description: 'Record a delivery receipt of feed commodities or veterinary medicines. Subject to Admin Approval if in Junior Employee mode.',
        inputSchema: {
            type: 'object',
            properties: {
                date: { type: 'string', description: 'Delivery date YYYY-MM-DD' },
                item_name: { type: 'string', description: 'Item name (e.g. "Corn Silage", "Amovet 20%")' },
                quantity: { type: 'number', description: 'Quantity received' },
                rate: { type: 'number', description: 'Price per unit in PKR' },
                supplier: { type: 'string', description: 'Vendor or supplier name' },
                unit: { type: 'string', description: 'Unit of measurement (e.g. "kg", "mund", "vial")' },
                notes: { type: 'string', description: 'Quality observations or batch reference' }
            },
            required: ['date', 'item_name', 'quantity', 'rate', 'supplier']
        }
    },
    {
        name: 'register_animal',
        description: 'Register a new animal into the herd (intake / purchase). Records tag/RFID, breed, arrival weight, initial pen (e.g. Quarantine, A, B, etc.), landed purchase price, and Mandi procurement breakdown. Automatically initializes initial scale weight and arrival event. Subject to biological sanity clamps (40-1200kg) and Admin Approval in Junior Employee mode.',
        inputSchema: {
            type: 'object',
            properties: {
                tag: { type: 'string', description: 'Visual ear tag or RFID number (e.g. "105", "106")' },
                breed: { type: 'string', description: 'Cattle breed (e.g. "Sahiwal", "Cholistani", "Cross", "Desi", "Friesian Cross")' },
                entry_date: { type: 'string', description: 'Arrival date in YYYY-MM-DD (defaults to today)' },
                entry_weight: { type: 'number', description: 'Arrival / scale weight in kg (between 40kg and 1200kg)' },
                pen: { type: 'string', description: 'Assigned pen (e.g. "A", "B", "C", "D", "E", "G", "Quarantine"). Always prompt the user for the pen, or confirm if they want Quarantine. If assigning to a brand new pen, create it first using create_pen.' },
                purchase_price: { type: 'number', description: 'Total landed purchase price in PKR' },
                source: { type: 'string', description: 'Source Mandi or farm (e.g. "Multan Mandi", "Direct Farm Purchase")' },
                target_weight: { type: 'number', description: 'Target slaughter weight in kg (defaults to 380)' },
                notes: { type: 'string', description: 'Color, markings, health notes, or Mandi slip details' }
            },
            required: ['tag', 'entry_weight']
        }
    },
    {
        name: 'create_pen',
        description: 'Create a new feedlot pen (e.g. "H", "H1", "Sick Bay", "Hospital") or update an existing pen configuration (forage type, target ADG, notes).',
        inputSchema: {
            type: 'object',
            properties: {
                pen: { type: 'string', description: 'Unique pen identifier (e.g. "H", "H1", "F2")' },
                forage_type: { type: 'string', description: 'Primary forage type: "silage", "mixed", "hay", "green fodder"' },
                target_adg: { type: 'number', description: 'Target Average Daily Gain in kg/day (e.g. 1.2)' },
                notes: { type: 'string', description: 'Capacity, location, or pen purpose notes' }
            },
            required: ['pen']
        }
    },
    {
        name: 'transfer_cattle_pen',
        description: 'Shift or rotate animals between pens and health stages (e.g. Sick bay back to Fattening, Quarantine to Fattening Pen C, or Pen A to Pen B). Automatically updates pen location, health status ("Fattening", "Sick", "Quarantined"), and logs an audit transfer event in the portal.',
        inputSchema: {
            type: 'object',
            properties: {
                tags: { type: 'array', items: { type: 'string' }, description: 'Array of ear tag IDs to transfer (e.g. ["36", "08"])' },
                tag: { type: 'string', description: 'Single ear tag ID (if transferring one animal)' },
                to_pen: { type: 'string', description: 'Destination pen ID (e.g. "A", "B", "C", "D", "E", "F", "G", "SICK", "HOSPITAL", "QUARANTINE")' },
                status: { type: 'string', description: 'Optional status override: "Fattening", "Active", "Sick", "Hospital", "Quarantined"' },
                reason: { type: 'string', description: 'Reason for transfer (e.g. "Graduated from quarantine", "Moved to sick bay for treatment", "Recovered from illness")' }
            },
            required: ['to_pen']
        }
    }
];

// Helper: Dispatch tool call to internal v1 API handler
function dispatchToV1(method, pathname, query = {}, body = null, apiKey) {
    return new Promise((resolve) => {
        const queryString = new URLSearchParams(query).toString();
        const fullUrl = `/api/v1/${pathname}${queryString ? '?' + queryString : ''}`;

        let statusCode = 200;
        let responseData = null;

        const resMock = {
            setHeader: () => {},
            status: (code) => {
                statusCode = code;
                return resMock;
            },
            json: (data) => {
                responseData = data;
                resolve({ status: statusCode, data });
            },
            end: (data) => {
                resolve({ status: statusCode, data: responseData || data });
            }
        };

        const reqMock = {
            method,
            url: fullUrl,
            headers: {
                authorization: `Bearer ${apiKey || process.env.BA_API_KEY || ''}`,
                'x-agent-name': 'gemini-spark-mcp',
                'content-type': 'application/json'
            },
            body
        };

        v1Handler(reqMock, resMock).catch((err) => {
            resolve({
                status: 500,
                data: { success: false, error: err.message }
            });
        });
    });
}

// Execute an MCP Tool Call
async function executeToolCall(toolName, args, apiKey) {
    switch (toolName) {
        case 'get_animal_passport': {
            const res = await dispatchToV1('GET', 'cattle/passport', { tag: args.tag }, null, apiKey);
            return res.data;
        }
        case 'get_cattle_weights': {
            const query = {};
            if (args.tag) query.tag = args.tag;
            if (args.pen) query.pen = args.pen;
            if (args.start_date) query.start_date = args.start_date;
            if (args.end_date) query.end_date = args.end_date;
            const res = await dispatchToV1('GET', 'cattle/weights', query, null, apiKey);
            return res.data;
        }
        case 'get_pens': {
            const res = await dispatchToV1('GET', 'pens', {}, null, apiKey);
            return res.data;
        }
        case 'get_feed_logs': {
            const query = {};
            if (args.date) query.date = args.date;
            if (args.pen) query.pen = args.pen;
            const res = await dispatchToV1('GET', 'feed/logs', query, null, apiKey);
            return res.data;
        }
        case 'get_pen_checks': {
            const query = {};
            if (args.date) query.date = args.date;
            const res = await dispatchToV1('GET', 'pen-checks', query, null, apiKey);
            return res.data;
        }
        case 'get_withholding_alerts': {
            const res = await dispatchToV1('GET', 'health/withholding', {}, null, apiKey);
            return res.data;
        }
        case 'get_tasks_upcoming': {
            const res = await dispatchToV1('GET', 'tasks/upcoming', args || {}, null, apiKey);
            return res.data;
        }
        case 'get_purchasing_history': {
            const query = {};
            if (args.start_date) query.start_date = args.start_date;
            if (args.end_date) query.end_date = args.end_date;
            if (args.item_name) query.item_name = args.item_name;
            const res = await dispatchToV1('GET', 'purchasing/history', query, null, apiKey);
            return res.data;
        }
        case 'get_inventory_summary': {
            const res = await dispatchToV1('GET', 'inventory/summary', {}, null, apiKey);
            return res.data;
        }
        case 'get_premix_formulas': {
            const res = await dispatchToV1('GET', 'premix/formulas', {}, null, apiKey);
            return res.data;
        }
        case 'get_compliance_summary': {
            const query = {};
            if (args.date) query.date = args.date;
            const res = await dispatchToV1('GET', 'compliance/summary', query, null, apiKey);
            return res.data;
        }
        case 'get_herd_analytics': {
            const res = await dispatchToV1('GET', 'analytics/performance', {}, null, apiKey);
            return res.data;
        }
        case 'get_financial_analytics': {
            const res = await dispatchToV1('GET', 'analytics/financials', args || {}, null, apiKey);
            return res.data;
        }
        case 'get_feed_efficiency': {
            const res = await dispatchToV1('GET', 'analytics/feed-efficiency', {}, null, apiKey);
            return res.data;
        }
        case 'get_feed_items': {
            const res = await dispatchToV1('GET', 'feed/items', {}, null, apiKey);
            return res.data;
        }
        case 'add_feed_log': {
            const res = await dispatchToV1('POST', 'feed/logs', {}, args, apiKey);
            return res.data;
        }
        case 'log_cattle_weight': {
            const res = await dispatchToV1('POST', 'cattle/weights', {}, args, apiKey);
            return res.data;
        }
        case 'log_treatment': {
            const res = await dispatchToV1('POST', 'health/treatments', {}, args, apiKey);
            return res.data;
        }
        case 'add_purchase': {
            const res = await dispatchToV1('POST', 'purchasing/feed', {}, args, apiKey);
            return res.data;
        }
        case 'register_animal':
        case 'intake_animal': {
            const res = await dispatchToV1('POST', 'cattle/intake', {}, args, apiKey);
            return res.data;
        }
        case 'create_pen':
        case 'add_pen': {
            const res = await dispatchToV1('POST', 'pens', {}, args, apiKey);
            return res.data;
        }
        case 'transfer_cattle_pen':
        case 'pen_transfer': {
            const res = await dispatchToV1('POST', 'cattle/pen-transfer', {}, args, apiKey);
            return res.data;
        }
        default:
            throw new Error(`Unknown tool: "${toolName}"`);
    }
}

module.exports = async (req, res) => {
    // 1. Universal CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, x-api-key, Content-Type, x-agent-name');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

    if (req.method === 'OPTIONS') {
        return res.status(204).end();
    }

    // 2. Extract API Key (supports Header or URL query ?key=...)
    const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const queryKey = parsedUrl.searchParams.get('key') || parsedUrl.searchParams.get('apiKey') || parsedUrl.searchParams.get('token');
    const authHeader = req.headers['authorization'] || req.headers['Authorization'] || '';
    const customHeader = req.headers['x-api-key'] || req.headers['X-API-KEY'] || '';

    let apiKey = queryKey || '';
    if (!apiKey && authHeader.startsWith('Bearer ')) {
        apiKey = authHeader.slice(7).trim();
    } else if (!apiKey && customHeader) {
        apiKey = customHeader.trim();
    }
    if (!apiKey) {
        apiKey = process.env.BA_API_KEY || process.env.API_SECRET_KEY || 'ba_live_4ad74dc4971ed32e6454ea51aea9f3dfab943e9fb750146b';
    }

    // 3. GET /mcp — Server discovery or SSE handshake
    if (req.method === 'GET') {
        const isSse = req.headers.accept && req.headers.accept.includes('text/event-stream');
        if (isSse) {
            res.writeHead(200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
                'Access-Control-Allow-Origin': '*'
            });
            res.write(`event: endpoint\ndata: ${req.url}\n\n`);
            return;
        }

        return res.status(200).json({
            status: 'online',
            service: 'BA Foods SmartHerd MCP Server',
            protocolVersion: SERVER_INFO.protocolVersion,
            documentation: 'https://bafoods.pk/AI_API_SPEC.md',
            mcp_endpoint: 'https://www.bafoods.pk/api/mcp',
            tools_count: TOOLS.length,
            available_tools: TOOLS.map(t => ({ name: t.name, description: t.description }))
        });
    }

    // 4. POST /mcp — JSON-RPC 2.0 Dispatcher
    if (req.method === 'POST') {
        const body = req.body || {};
        const { jsonrpc, id, method, params } = body;

        // Support standard MCP handshake & tools
        if (method === 'initialize') {
            return res.status(200).json({
                jsonrpc: '2.0',
                id: id ?? null,
                result: {
                    protocolVersion: SERVER_INFO.protocolVersion,
                    capabilities: {
                        tools: {
                            listChanged: false
                        }
                    },
                    serverInfo: {
                        name: SERVER_INFO.name,
                        version: SERVER_INFO.version
                    }
                }
            });
        }

        if (method === 'notifications/initialized') {
            return res.status(200).json({ jsonrpc: '2.0' });
        }

        if (method === 'ping') {
            return res.status(200).json({ jsonrpc: '2.0', id, result: {} });
        }

        if (method === 'tools/list') {
            return res.status(200).json({
                jsonrpc: '2.0',
                id: id ?? null,
                result: {
                    tools: TOOLS
                }
            });
        }

        if (method === 'tools/call') {
            const toolName = params?.name;
            const args = params?.arguments || {};

            try {
                const toolResult = await executeToolCall(toolName, args, apiKey);
                return res.status(200).json({
                    jsonrpc: '2.0',
                    id: id ?? null,
                    result: {
                        content: [
                            {
                                type: 'text',
                                text: typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult, null, 2)
                            }
                        ],
                        isError: false
                    }
                });
            } catch (err) {
                return res.status(200).json({
                    jsonrpc: '2.0',
                    id: id ?? null,
                    result: {
                        content: [
                            {
                                type: 'text',
                                text: `TOOL_ERROR: ${err.message}`
                            }
                        ],
                        isError: true
                    }
                });
            }
        }

        // Fallback for unknown method
        return res.status(200).json({
            jsonrpc: '2.0',
            id: id ?? null,
            error: {
                code: -32601,
                message: `Method "${method}" not found. Supported methods: initialize, tools/list, tools/call, ping.`
            }
        });
    }

    return res.status(405).json({ error: 'Method Not Allowed' });
};
