# BA Foods — Machine-to-Machine (M2M) & AI Integration API Specification (v1)

This specification defines the programmatic REST and Webhook interface for **BA Foods / SmartHerd**. It is engineered specifically for autonomous AI agents (such as **Gemini Spark**, Claude, GPT), automated IoT devices, and external webhooks (e.g. Google Sheets, ERP bridges).

---

## 1. Executive Purpose & Governance Safeguards

### 1.0 What This Integration Does
This integration acts as an intelligent, automated bridge connecting physical farm operations to the **SmartHerd Management Portal** using **Gemini Spark**:
1. **Urdu Paper Slip $\rightarrow$ Digital Ledger Translation:** Farm workers record daily feed mixtures, bunk checks, scale weigh-ins, and medicine doses on paper or whiteboards in Urdu. Staff photograph the slips $\rightarrow$ Gemini Spark extracts the data using multimodal vision $\rightarrow$ pushes structured records directly into SmartHerd.
2. **Junior Employee Governance & Supervision:** Eliminates the risk of an AI agent corrupting live databases. Submissions are staged in the **SmartHerd Admin Approvals queue (`ba_pending_approvals`)** for Bilal's one-click review until the Admin toggles the AI to "Normal Staff" mode.
3. **Conversational Farm Encyclopedia:** Enables Bilal and management to ask questions in plain English or Urdu (*"What was the landed weight and feed cost of tag 57?"*, *"What is Pen A's current biomass and ADG?"*) and receive exact figures in seconds via the live API / MCP connection.
4. **Automated Daily Audit & Compliance:** Automatically queries daily operations at 8:00 PM to verify that all pens were fed, bunk scores recorded, and withdrawal periods observed, drafting an evening compliance report.

---

### 1.1 Dual Governance Architecture (Junior Employee vs. Normal Staff Mode)
To eliminate any risk of an AI agent "going rogue" or corrupting farm records, the API implements a **two-tier governance model** controlled by an Admin Switch:

1. **Junior Employee Mode (`ai_require_approval = true`, Default):**
   * The AI functions strictly like a newly onboarded junior employee.
   * Every action submitted by the AI (daily feeding logs, bunk checks, scale weigh-ins, health treatments, feed/medicine purchases, animal intakes, and custom mixing batches) is validated by mathematical and biological guards, then **queued into the SmartHerd Admin Approval queue (`ba_pending_approvals`)** with HTTP `202 Accepted` (`status: "pending_approval"`).
   * Nothing touches the live active herd or feed database until the Admin (Bilal) reviews and approves it in the SmartHerd portal.
2. **Normal SmartHerd Staff Mode (`ai_require_approval = false`):**
   * Once you observe that the AI extracts and logs data reliably, you can toggle the switch to "Normal Staff".
   * Valid entries commit directly to the live production database with HTTP `201 Created` (`status: "committed"`), tagged with `created_by: 'api:gemini-spark'`.
   * Even in this mode, the hard biological sanity clamps remain fully active (it is physically impossible to drop tables, delete records, or enter absurd values).

### 1.2 The Admin Autonomy Switch
The Admin can toggle between Junior Employee Mode and Normal Staff Mode at any time via:
* **SmartHerd Portal UI:** A dedicated **AI Assistant Governance Switch** banner is rendered at the top of the **Admin Approvals** dashboard for superadmins.
* **API Endpoints:**
  * `GET /api/v1/system/approval-mode` — Inspect the current mode.
  * `POST /api/v1/system/approval-mode` — Update the mode (`{"require_approval": false}`).
* **Per-Request Override:**
  * HTTP Header: `x-require-approval: true` or `false`
  * JSON Body: `"require_approval": true` or `false`

### 1.3 Zero-Cost & Anti-Corruption Safeguards
1. **Zero Added Vercel Cost:** Single-table pooled queries execute in **10–25ms** using <40MB RAM.
2. **Strict Append-Only (No Overwrites or Deletes):** Historical records cannot be deleted or wiped out over the AI API. Existing records on the same key return `409 Conflict`.
3. **High-Precision Biological Sanity Clamps:**
   * **Dates:** Format `YYYY-MM-DD`. Future dates ($>1$ day) and distant past ($>30$ days) are blocked.
   * **Weights:** Clamped between $40\text{ kg} - 1200\text{ kg}$. Weight drops $>50\%$ or spikes $>60\%$ trigger `422 SANITY_CHECK_FAILED` to catch OCR dropped/extra zero errors.
   * **Feed Batches:** Ingredient mass balance must sum to `total_batch_kg` within $\pm 1.0\text{ kg}$. Daily cumulative feeding cannot exceed $100\%$.
   * **Bunk Scores:** Must be between $0 - 100\%$.
   * **Anti-Ghost Feeding:** Feeds cannot be logged to a pen with 0 active animals.
4. **Dry-Run Simulation Mode (`dry_run: true`):**
   * Pass `"dry_run": true` (or `?dry_run=true`) to simulate any payload without writing to the database.

### 1.4 Unrestricted, Zero-Friction Read Access (GET Operations)
While mutating actions (`POST`) are protected by the Junior Employee approval queue and biological sanity clamps, **all data fetching (`GET`) operations are 100% unrestricted**:
* **Zero Approvals or Delays:** Read operations never require human approval and execute immediately.
* **Complete Minute Granularity:** The AI has full access to the entire farm state down to individual tags, weight logs since intake, daily ADG calculations, pen biomasses, raw material recipes, bunk scores, and purchasing invoices.
* **Safe & Read-Only:** Queries use pooled, indexed SQL lookups with zero risk of database mutation.

---

## 2. Authentication & Base URL

* **Production Base URL:** `https://bafoods.pk/api/v1` (or local `http://localhost:5173/api/v1`)
* **Headers Required:**
  ```http
  Authorization: Bearer <BA_API_KEY>
  Content-Type: application/json
  x-agent-name: gemini-spark
  ```
  *(Alternatively, pass header `x-api-key: <BA_API_KEY>`)*

---

## 3. GET Endpoints (Unrestricted Data Fetching & Verification)

All GET endpoints are unrestricted and provide deep historical and real-time visibility across the entire farm.

### 3.1 Live Compliance Summary
Fetch real-time daily operational compliance for feed sessions, bunk checks, and urgent health alerts.
* **Route:** `GET /api/v1/compliance/summary`
* **Query Parameters:** `date` *(optional YYYY-MM-DD, defaults to today)*
* **Response Example (`200 OK`):**
```json
{
  "success": true,
  "date": "2026-09-14",
  "compliance": {
    "feed": {
      "is_fully_compliant": false,
      "completion_pct": 50,
      "completed_pens": 3,
      "total_active_pens": 6,
      "pen_details": {
        "A": { "complete": true, "logged_pct": 100, "feedings_recorded": 2 },
        "B": { "complete": true, "logged_pct": 100, "feedings_recorded": 2 },
        "C": { "complete": false, "logged_pct": 50, "feedings_recorded": 1 },
        "D": { "complete": false, "logged_pct": 50, "feedings_recorded": 1 },
        "E": { "complete": false, "logged_pct": 0, "feedings_recorded": 0 },
        "G": { "complete": true, "logged_pct": 100, "feedings_recorded": 2 }
      }
    },
    "bunk_checks": {
      "completed_pens": 6,
      "total_active_pens": 6,
      "pen_details": {
        "A": { "checked": true, "sessions": ["Morning"], "latest_bunk_score": 0 },
        "B": { "checked": true, "sessions": ["Morning"], "latest_bunk_score": 5 }
      }
    },
    "health_alerts": {
      "sick_animals_count": 1,
      "sick_animal_tags": ["36"]
    }
  }
}
```

---

### 3.2 Cattle Herd Roster
List all active cattle with pens, current weights, entry dates, and Days on Feed (DOF).
* **Route:** `GET /api/v1/cattle/roster`
* **Query Parameters:** `pen` *(optional, e.g. `?pen=C`)*
* **Response Example (`200 OK`):**
```json
{
  "success": true,
  "total_active_cattle": 128,
  "animals": [
    {
      "tag": "101",
      "pen": "A",
      "breed": "Sahiwal Cross",
      "current_weight_kg": 245.5,
      "entry_weight_kg": 180.0,
      "entry_date": "2026-06-01",
      "days_on_feed": 105,
      "target_adg": 1.25,
      "status": "Active"
    }
  ]
}
```

---

### 3.3 Individual Cattle Passport / Full Dossier
Fetches every single detail about an individual calf: Mandi weight & purchase breakdown, landed weight, transit shrink %, current weight, total gain, lifetime ADG, feed cost to date, all weigh-ins with session ADG, and every medical treatment administered.
* **Route:** `GET /api/v1/cattle/passport?tag=<TAG>`
* **Response Example (`200 OK`):**
```json
{
  "success": true,
  "animal": {
    "animal_id": 9,
    "tag": "57",
    "pen": "A",
    "breed": "Sahiwal",
    "status": "Fattening",
    "source": "Chiniot",
    "mandi_weight_kg": 132.0,
    "landed_weight_kg": 127.0,
    "transit_shrink_pct": 3.8,
    "current_weight_kg": 181.0,
    "total_weight_gain_kg": 54.0,
    "target_weight_kg": 280.0,
    "entry_date": "2026-07-29",
    "days_on_feed": 47,
    "lifetime_adg": 1.15,
    "mandi_price_pkr": 85000.0,
    "landed_purchase_price_pkr": 88881.0,
    "procurement_breakdown": {
      "mandi_price_pkr": 85000.0,
      "carriage_pkr": 2500.0,
      "mandi_tax_pkr": 500.0,
      "misc_expense_pkr": 881.0,
      "source_market": "Chiniot"
    },
    "feed_cost_to_date_pkr": 12011.48,
    "feed_sessions_count": 79,
    "total_cost_to_date_pkr": 100892.48,
    "cost_per_kg_gain_pkr": 222.43,
    "under_withholding": true,
    "active_withholdings": [
      {
        "date": "2026-08-24",
        "type": "Deworming",
        "medicine": "Ivotec 100ml (4.893 ml)",
        "dosage": "4.893 ml",
        "withholding": 21,
        "notes": null
      }
    ]
  },
  "weight_history": [
    { "date": "2026-07-29", "weight_kg": 127.0, "adg": 0.0 },
    { "date": "2026-08-08", "weight_kg": 164.0, "adg": 3.7 },
    { "date": "2026-08-21", "weight_kg": 175.5, "adg": 0.88 },
    { "date": "2026-09-09", "weight_kg": 181.0, "adg": 0.28 }
  ],
  "treatments": [
    {
      "date": "2026-09-03",
      "type": "Vaccination",
      "medicine": "Pulmovac 100ml (2 ml)",
      "dosage": "2 ml",
      "withholding_days": 0,
      "notes": "H.S VACCINATION"
    },
    {
      "date": "2026-08-24",
      "type": "Deworming",
      "medicine": "Oxafax Drench 1 ltr (35.945 ml)",
      "dosage": "35.945 ml",
      "withholding_days": 14,
      "notes": null
    }
  ],
  "lifecycle_events": [
    { "date": "2026-08-07", "event_type": "pen_transfer", "from_pen": "B", "to_pen": "A", "note": "Moved B → A" }
  ]
}
```

---

### 3.4 Complete Herd Weight Log History
Fetches granular weight logs across the entire herd or filtered by tag, pen, or date window. Returns exact weight, ADG between weigh-ins, and who logged it.
* **Route:** `GET /api/v1/cattle/weights`
* **Query Parameters:**
  * `tag` *(optional, e.g. `?tag=36`)*
  * `pen` *(optional, e.g. `?pen=C`)*
  * `start_date` *(optional YYYY-MM-DD)*
  * `end_date` *(optional YYYY-MM-DD)*
* **Response Example (`200 OK`):**
```json
{
  "success": true,
  "count": 2,
  "filters": { "tag": "36", "pen": "ALL", "start_date": null, "end_date": null },
  "weight_logs": [
    {
      "id": 412,
      "tag": "36",
      "pen": "B",
      "breed": "Cholistani",
      "date": "2026-09-10",
      "weight_kg": 268.0,
      "adg": 1.14,
      "logged_by": "Scale Operator"
    },
    {
      "id": 310,
      "tag": "36",
      "pen": "B",
      "breed": "Cholistani",
      "date": "2026-08-10",
      "weight_kg": 234.0,
      "adg": 1.10,
      "logged_by": "Scale Operator"
    }
  ]
}
```

---

### 3.5 Pen Roster & Biomass Summary
Returns all active pens with exact head count, average calf weight, total biomass (kg), active ration, and target ADG.
* **Route:** `GET /api/v1/pens`
* **Response Example (`200 OK`):**
```json
{
  "success": true,
  "total_pens": 6,
  "total_active_cattle": 128,
  "pens": [
    {
      "pen": "A",
      "head_count": 22,
      "avg_weight_kg": 235.4,
      "total_biomass_kg": 5178.8,
      "forage_type": "corn_silage",
      "target_adg": 1.30,
      "notes": "Transition group 2"
    },
    {
      "pen": "B",
      "head_count": 24,
      "avg_weight_kg": 272.1,
      "total_biomass_kg": 6530.4,
      "forage_type": "corn_silage",
      "target_adg": 1.40,
      "notes": "Finishing group"
    }
  ]
}
```

---

### 3.6 Daily Feed Distribution Logs
Returns exact TMR split-feedings logged on a given date, including kg-by-kg ingredient breakdown.
* **Route:** `GET /api/v1/feed/logs?date=<YYYY-MM-DD>&pen=<PEN>`
* **Response Example (`200 OK`):**
```json
{
  "success": true,
  "date": "2026-09-14",
  "feed_logs": [
    {
      "pen": "C",
      "feeding_index": 1,
      "num_feedings": 2,
      "feeding_pct": 50,
      "total_batch_kg": 180.0,
      "ingredients": [
        { "name": "Corn Silage", "kg": 120.0 },
        { "name": "Wheat Straw", "kg": 20.0 },
        { "name": "Chokar", "kg": 25.0 },
        { "name": "Corn Grain Ground", "kg": 15.0 }
      ],
      "logged_by": "TMR Mixer Operator",
      "created_at": "2026-09-14T07:15:00Z"
    }
  ]
}
```

---

### 3.7 Daily Pen Checks & Bunk Scores
Returns morning and evening feed bunk scores ($0-100\%$) and health observation flags.
* **Route:** `GET /api/v1/pen-checks?date=<YYYY-MM-DD>`

---

### 3.8 Active Medical Withholding Alerts
Returns all animals currently under slaughter withholding, days remaining, and safe release dates.
* **Route:** `GET /api/v1/health/withholding`

---

### 3.9 Upcoming Protocol Tasks
Returns quarantine and intake protocol tasks due in the next 7 days (Day 1, 7, 14, 21 vaccines/deworming).
* **Route:** `GET /api/v1/tasks/upcoming`

---

### 3.10 Feed & Medicine Purchasing History
Returns receipts of feed deliveries and veterinary medicines purchased, including unit rates, quantities, and suppliers.
* **Route:** `GET /api/v1/purchasing/history`
* **Query Parameters:** `start_date`, `end_date`, `item_name`
* **Response Example (`200 OK`):**
```json
{
  "success": true,
  "count": 1,
  "purchases": [
    {
      "id": 88,
      "date": "2026-09-12",
      "item_id": "silage_bunker_1",
      "item_name": "Corn Silage",
      "unit": "kg",
      "quantity": 15000.0,
      "rate_per_unit": 12.5,
      "total_cost_pkr": 187500.0,
      "supplier": "Al-Rehman Agri",
      "notes": "32% DM silage batch 4",
      "logged_by": "Bilal Ashraf"
    }
  ]
}
```

---

### 3.11 Feed Stock Inventory Summary
Returns warehouse and bunker inventory levels for all commodities.
* **Route:** `GET /api/v1/inventory/summary`

---

### 3.12 Wanda & Premix Formulas Directory
Returns active in-house Wanda recipes, exact inclusion percentages, and available raw materials.
* **Route:** `GET /api/v1/premix/formulas`

---

### 3.13 AI Governance Status
Check whether the AI is currently operating in Junior Employee mode or Normal Staff mode.
* **Route:** `GET /api/v1/system/approval-mode`
* **Response Example (`200 OK`):**
```json
{
  "success": true,
  "ai_require_approval": true,
  "mode": "junior_employee",
  "description": "Junior Employee Mode active. All AI tasks (feed logs, cattle weights, treatments, purchases, wanda mixing) are held in ba_pending_approvals for Admin review."
}
```

---

## 4. POST Endpoints (Append-Only Actions)

Every POST endpoint supports `"dry_run": true` for simulation. When `dry_run: false`:
* In **Junior Employee Mode (`ai_require_approval = true`)**, the endpoint returns **HTTP 202 Accepted** with `"status": "pending_approval"` and an `"approval_id"` matching the row in the SmartHerd portal's Admin Approvals dashboard.
* In **Normal Staff Mode (`ai_require_approval = false`)**, the endpoint returns **HTTP 201 Created** with `"status": "committed"`.

---

### 4.1 Ingest Feed Log (TMR Batch Distribution)
* **Route:** `POST /api/v1/feed/logs`
* **Payload:**
```json
{
  "date": "2026-09-14",
  "pen": "C",
  "feeding_index": 1,
  "num_feedings": 2,
  "feeding_pct": 50,
  "total_batch_kg": 180.0,
  "ingredients": [
    { "name": "Corn Silage", "kg": 120.0 },
    { "name": "Wheat Straw", "kg": 20.0 },
    { "name": "Chokar", "kg": 25.0 },
    { "name": "Corn Grain Ground", "kg": 15.0 }
  ],
  "notes": "Morning split feeding",
  "dry_run": false
}
```
* **Junior Employee Response (`202 Accepted`):**
```json
{
  "success": true,
  "status": "pending_approval",
  "approval_id": 867,
  "mode": "junior_employee",
  "action": "ADD_FEED_LOG",
  "message": "Feed log for Pen C on 2026-09-14 submitted in Junior Employee mode. Queued for Admin review in SmartHerd portal.",
  "details": {
    "pen": "C",
    "date": "2026-09-14",
    "feeding_index": 1,
    "num_feedings": 2,
    "total_batch_kg": 180.0
  }
}
```
* **Normal Staff Response (`201 Created`):**
```json
{
  "success": true,
  "status": "committed",
  "mode": "normal_staff",
  "id": 1420,
  "message": "Feed logged successfully for Pen C on 2026-09-14 (#1/2)."
}
```

---

### 4.2 Ingest Pen Bunk Check & Flagged Animals
* **Route:** `POST /api/v1/pen-checks`
* **Payload:**
```json
{
  "date": "2026-09-14",
  "pen": "C",
  "session": "Morning",
  "check_time": "06:30",
  "bunk_score_pct": 5,
  "head_count": 16,
  "head_pulled": 1,
  "flagged_tags": [
    { "tag": "36", "note": "Lethargic and droopy ears" }
  ],
  "notes": "Pen looks brisk, slick bunk except small pile at north corner.",
  "dry_run": false
}
```
* **Junior Employee Response (`202 Accepted`):**
```json
{
  "success": true,
  "status": "pending_approval",
  "approval_id": 868,
  "mode": "junior_employee",
  "action": "LOG_PEN_CHECK",
  "message": "Pen check for Pen C (Morning) submitted in Junior Employee mode. Queued for Admin review in SmartHerd portal."
}
```

---

### 4.3 Log Health Treatment / Vaccine
* **Route:** `POST /api/v1/health/treatments`
* **Payload:**
```json
{
  "tag": "36",
  "date": "2026-09-14",
  "type": "Curative",
  "medicine": "Flunixin Meglumine",
  "dosage": "5 ml",
  "withholding": 4,
  "diagnosis": "Mild fever",
  "notes": "Administered IV via jugular vein.",
  "dry_run": false
}
```
* **Junior Employee Response (`202 Accepted`):**
```json
{
  "success": true,
  "status": "pending_approval",
  "approval_id": 869,
  "mode": "junior_employee",
  "action": "LOG_TREATMENT",
  "message": "Treatment for Tag 36 (Flunixin Meglumine) submitted in Junior Employee mode. Queued for Admin review in SmartHerd portal."
}
```

---

### 4.4 Log Scale Weigh-In
* **Route:** `POST /api/v1/cattle/weights`
* **Payload:**
```json
{
  "tag": "36",
  "date": "2026-09-14",
  "weight": 172.5,
  "bypass_weight_sanity": false,
  "dry_run": false
}
```
* **Junior Employee Response (`202 Accepted`):**
```json
{
  "success": true,
  "status": "pending_approval",
  "approval_id": 870,
  "mode": "junior_employee",
  "action": "LOG_WEIGHT",
  "message": "Weight entry of 172.5 kg for Tag 36 submitted in Junior Employee mode. Queued for Admin review in SmartHerd portal.",
  "details": {
    "animal_id": 18,
    "tag": "36",
    "weight_kg": 172.5,
    "previous_weight_kg": 160.0,
    "weight_delta_kg": 12.5,
    "adg": 1.25,
    "date": "2026-09-14"
  }
}
```

---

### 4.5 Execute Pen Transfer
* **Route:** `POST /api/v1/cattle/pen-transfer`
* **Payload:**
```json
{
  "tags": ["36", "08"],
  "to_pen": "E",
  "reason": "Weight sorting after 30-day weigh-in",
  "dry_run": false
}
```
* **Junior Employee Response (`202 Accepted`):**
```json
{
  "success": true,
  "status": "pending_approval",
  "approval_ids": [871, 872],
  "mode": "junior_employee",
  "action": "UPDATE_ANIMAL",
  "message": "Pen transfer for 2 animal(s) to Pen E submitted in Junior Employee mode. Queued for Admin review in SmartHerd portal."
}
```

---

### 4.6 Ingest Feed or Medicine Purchase
* **Routes:** `POST /api/v1/purchasing/feed` or `POST /api/v1/purchasing/medicine`
* **Feed Purchase Payload:**
```json
{
  "date": "2026-09-14",
  "item_name": "Corn Silage",
  "quantity_kg": 5000,
  "rate_per_kg": 18.5,
  "supplier": "Al-Rehman Agri Farms",
  "notes": "Trolley #4 delivery - 68% moisture",
  "dry_run": false
}
```
* **Medicine Purchase Payload:**
```json
{
  "date": "2026-09-14",
  "item_name": "Amovet Inj 100ml",
  "quantity": 10,
  "unit": "vials",
  "rate": 1850,
  "supplier": "Ghazi Vet Pharmacy",
  "notes": "Batch #AM-2026-09",
  "dry_run": false
}
```
* **Junior Employee Response (`202 Accepted`):**
```json
{
  "success": true,
  "status": "pending_approval",
  "approval_id": 873,
  "mode": "junior_employee",
  "action": "ADD_FEED_PURCHASE",
  "message": "Purchase receipt for 5000 kg Corn Silage submitted in Junior Employee mode. Queued for Admin review in SmartHerd portal."
}
```

---

### 4.7 Ingest New Cattle Arrival / Intake
* **Route:** `POST /api/v1/cattle/intake` (or `/api/v1/purchasing/animal`)
* **Payload:**
```json
{
  "tag": "145",
  "rfid": "982000421098145",
  "breed": "Cholistani Cross",
  "entry_date": "2026-09-14",
  "entry_weight": 195.0,
  "purchase_price": 95000,
  "source": "Multan Mandi",
  "target_adg": 1.3,
  "pen": "Quarantine",
  "notes": "Arrived in good health, intake deworming given.",
  "dry_run": false
}
```
* **Junior Employee Response (`202 Accepted`):**
```json
{
  "success": true,
  "status": "pending_approval",
  "approval_id": 874,
  "mode": "junior_employee",
  "action": "ADD_ANIMAL",
  "message": "Cattle intake for Tag 145 submitted in Junior Employee mode. Queued for Admin review in SmartHerd portal."
}
```

---

### 4.8 Log In-House Wanda Batch (Standard or Custom Formulation)
* **Route:** `POST /api/v1/premix/batches`
* **Custom Breakdown Payload (e.g. 1.0% Urea adjustment):**
```json
{
  "date": "2026-09-14",
  "premix_name": "Potato Max Wanda",
  "total_kg": 240.0,
  "custom_ingredients": [
    { "name": "Maize", "kg": 122.4 },
    { "name": "Gluten Feed", "kg": 83.5 },
    { "name": "Molasses", "kg": 16.7 },
    { "name": "Sodium bicarbonate (Meetha Soda)", "kg": 4.8 },
    { "name": "Limestone", "kg": 6.1 },
    { "name": "Urea", "kg": 2.4 },
    { "name": "Mineral Pack", "kg": 1.9 },
    { "name": "Toxin Binder", "kg": 1.2 },
    { "name": "Monensin", "kg": 1.0 }
  ],
  "notes": "Custom mixing with 1.0% urea as instructed by vet",
  "dry_run": false
}
```
* **Junior Employee Response (`202 Accepted`):**
```json
{
  "success": true,
  "status": "pending_approval",
  "approval_id": 875,
  "mode": "junior_employee",
  "action": "SAVE_SETTINGS",
  "message": "Wanda mixing batch (240 kg of Potato Max Wanda) submitted in Junior Employee mode. Queued for Admin review in SmartHerd portal."
}
```

---

### 4.9 Toggle AI Governance Mode (Admin Switch)
Allows switching the AI between Junior Employee Mode and Normal Staff Mode.
* **Route:** `POST /api/v1/system/approval-mode`
* **Payload:**
```json
{
  "require_approval": false
}
```
* **Response Example (`200 OK`):**
```json
{
  "success": true,
  "ai_require_approval": false,
  "mode": "normal_staff",
  "message": "AI governance switched to Normal SmartHerd Staff (Direct Execution)."
}
```

---

## 5. Error Codes & AI Recovery Guidelines

| Status Code | Error Prefix | Cause | What the AI Agent Should Do |
| :--- | :--- | :--- | :--- |
| `401 Unauthorized` | `UNAUTHORIZED` | Invalid or missing `BA_API_KEY`. | Check environment variable and header configuration. |
| `409 Conflict` | `RECORD_ALREADY_EXISTS` | Record already exists for this pen/date/session. | Do NOT retry. Alert the user that this session was already logged. If it is an additional feeding, increment `feeding_index`. |
| `409 Conflict` | `DUPLICATE_TREATMENT_BLOCKED` | Same medicine already administered to animal on this date. | Pass `allow_duplicate_dose: true` if an intentional repeat dose (e.g. BID). |
| `422 Unprocessable` | `SANITY_CHECK_FAILED` | Input failed domain rules (e.g. ingredient sum mismatch, weight delta $>50\%$, bunk $>100\%$). | Inspect error details, verify numbers against photo, fix fields, or ask user for confirmation. |
| `422 Unprocessable` | `ANIMAL_NOT_FOUND` | Tag ID is not recognized in active herd. | Check if tag has a typo or was registered under an RFID tag. |
| `422 Unprocessable` | `ANIMAL_INACTIVE` | Calf is marked Sold or Deceased. | Abort logging; notify user that the animal is no longer in the active herd. |
| `500 Server Error` | `CONFIG_ERROR` | Database connection issue. | Retry once after a 2-second delay. |

---

## 6. Gemini Spark Autonomous Daily Workflow Blueprint

```mermaid
graph TD
    Photo["1. Employee sends Urdu photo"] --> SparkOCR["2. Gemini Spark reads slip (Multimodal Vision)"]
    SparkOCR --> RecipeCheck["3. Recipe & Herd Lookups via GET /api/v1"]
    RecipeCheck --> DryRun["4. Pre-Flight Test with dry_run: true"]
    DryRun --> Evaluation{"Passes all Sanity Checks?"}
    Evaluation -- Yes --> Submit["5. POST to /api/v1 (dry_run: false)"]
    Evaluation -- No or Ambiguous --> Escalate["6. STOP & Send Email to Bilal for Confirmation"]
    Submit --> CheckMode{"Mode: Junior vs Normal?"}
    CheckMode -- Junior Employee (202) --> Queued["Queued in SmartHerd Admin Approvals"]
    CheckMode -- Normal Staff (201) --> Committed["Committed to Production DB"]
    Queued --> EveningReport["7. 8:00 PM Daily Compliance Digest Email"]
    Committed --> EveningReport
    Escalate --> AwaitReply["Wait for Bilal's confirmation reply before committing"]
```

### 6.1 The "Read Before Write" Protocol (Fetch-First Policy)

**Rule for Gemini Spark:** When processing any worker slip, scale sheet, or medical log, Spark must **always query the portal first** (`GET` / MCP tool) before attempting to submit a new entry (`POST`).

Because read queries execute in **<25ms** and cost **$0.00**, this fetch-first approach guarantees that:
1. **No Accidental Duplicates:** If staff photographed a slip that was already recorded earlier in the day, Spark identifies it immediately instead of attempting duplicate inserts.
2. **Contextual Biological Validation:** Spark verifies new numbers against historical baselines (e.g. comparing today's scale weight to the animal's previous intake weight).
3. **Ghost Prevention:** Spark confirms that the target pen currently has active animals before logging feed.

---

### 6.2 Deduplication & Conflict Handling (When Data Is Already in the Portal)

When Spark fetches existing records for a given date or animal, it evaluates the situation according to this decision matrix:

| Scenario | What Spark Finds in the Portal | How Spark Behaves |
| :--- | :--- | :--- |
| **Identical Feed Log Already Present** | Pen A Morning feed on 2026-09-14 with matching ingredients is already recorded. | **SKIP INSERT.** Spark alerts: *"Notice: Pen A Morning feed (180 kg) is already recorded in SmartHerd. Skipping duplicate entry."* |
| **Differing Feed Log Already Present** | Pen A Morning feed exists, but the slip has different ingredient weights (e.g., afternoon correction). | **ESCALATE.** Spark does NOT overwrite. It notifies Bilal: *"Conflict: Slip shows 190 kg for Pen A Morning, but portal has 180 kg. Please review in Admin Approvals."* |
| **Weigh-In for Same Animal on Same Date** | Tag 57 already has a weight log on 2026-09-14. | **BLOCK.** If the new weight matches, skip. If different, alert Bilal of the conflicting weigh-in rather than corrupting the scale log. |
| **Medical Treatment on Same Date** | Animal was already administered this medication today. | **BLOCK.** Prevents double-dosing of antibiotics or dewormers (`DUPLICATE_TREATMENT_BLOCKED`) unless explicit veterinary re-dose is specified. |

---

### 6.3 Domain-Specific Fetch-First Workflows

#### 1. Daily Feeding Flow:
1. Staff sends photo of morning feed slip for Pen C.
2. Spark calls `get_feed_logs(date="2026-09-14", pen="C")`.
3. If feeding index 1 is already recorded $\rightarrow$ Spark checks whether it's an exact match or an afternoon feeding (index 2).
4. If not recorded $\rightarrow$ Spark runs `dry_run: true` $\rightarrow$ verifies ingredient sum $\rightarrow$ calls `add_feed_log`.

#### 2. Scale Weigh-In Flow:
1. Staff sends weigh-in slip: `"Tag 57 weight 181 kg"`.
2. Spark calls `get_animal_passport(tag="57")` **FIRST**.
3. Spark observes:
   * Previous weight was `175.5 kg` on August 21 (24 days ago).
   * Total gain: $+5.5\text{ kg}$ ($\approx 0.23\text{ kg/day}$ ADG).
   * Sanity check passed (no dropped digits or impossible spikes).
4. Spark calls `log_cattle_weight({ tag: "57", weight: 181, date: "2026-09-14" })`.
5. If in Junior Employee mode $\rightarrow$ queued with ID `#882` for Bilal's review.

#### 3. Veterinary Medical Flow:
1. Staff sends photo: `"Tag 36 given 15 ml Amovet"`.
2. Spark calls `get_withholding_alerts()` and `get_animal_passport(tag="36")`.
3. Spark checks: Has Amovet already been logged today? What was the previous treatment?
4. If valid $\rightarrow$ Spark calls `log_treatment` with the mandatory 14-day slaughter withholding period.

---

### 6.4 The Stop & Confirm Escalation Rule
If an ear tag number is smudged, an ingredient name is ambiguous, or a weight drop exceeds biological limits, Spark **stops immediately**. It sends an email or WhatsApp alert to Bilal with:
1. A cropped preview of the unclear slip.
2. What the AI thinks it says vs. alternative interpretations.
3. A direct link to confirm or correct the entry.

---

### 6.5 Daily 8:00 PM Evening Digest Email
At 8:00 PM daily, Spark calls `get_compliance_summary(date=today)` to evaluate:
* Total completed feed sessions vs planned pens.
* Bunk clearance scores across all pens.
* Active sick animals and withdrawal alerts.
* Any pending entries waiting for Bilal's sign-off in the Staff Approvals queue.

Drafts and delivers a concise executive report directly to Bilal's inbox.

---

## 7. Model Context Protocol (MCP) Remote Server for Gemini Spark

BA Foods exposes a native **Model Context Protocol (MCP)** server over Streamable HTTP / JSON-RPC 2.0. This allows **Gemini Spark** (and other MCP clients like Claude or cursor) to interact with SmartHerd using native function calling without needing command-line curl or shell execution.

### 7.1 Connection URL
```text
https://www.bafoods.pk/api/mcp?key=ba_live_4ad74dc4971ed32e6454ea51aea9f3dfab943e9fb750146b
```

### 7.2 Setup in Gemini Spark ("Custom apps for Spark")
1. Open Gemini Spark $\rightarrow$ **Settings & help** $\rightarrow$ **Connected Apps** $\rightarrow$ **Add a custom app**.
2. **Add a custom app link:** Paste the connection URL above.
3. **Advanced settings (Client ID & Client secret):** **LEAVE BLANK**. *(Manual OAuth credentials are not needed because authentication is embedded directly via the secure token parameter).*
4. Click **Next / Connect**.

### 7.3 Available Native Tools in Gemini Spark

| Tool Name | Type | Description | Key Parameters |
| :--- | :--- | :--- | :--- |
| `get_animal_passport` | Query | Complete dossier for an animal: Mandi weight, landed arrival weight, purchase price, current weight, gain, lifetime ADG, cost of feed till yet, all weigh-ins, and all treatments. | `tag` (string, required) |
| `get_cattle_weights` | Query | Historical weight logs across herd. Returns weights in kg, session ADG, dates, and recorders. | `tag`, `pen`, `start_date`, `end_date` |
| `get_pens` | Query | Live pen roster: head count, average animal weight, total pen biomass in kg, forage type, target ADG. | *(none)* |
| `get_feed_logs` | Query | Daily TMR split-feeding logs with exact kg-by-kg ingredient breakdown. | `date`, `pen` |
| `get_pen_checks` | Query | Morning and evening feed bunk scores ($0-100\%$) and flagged sick cattle. | `date` |
| `get_withholding_alerts` | Query | Animals currently under slaughter withholding for medications, days remaining, safe dates. | *(none)* |
| `get_tasks_upcoming` | Query | Intake & quarantine tasks due in next 7 days (Day 1, 7, 14, 21 vaccines/deworming). | *(none)* |
| `get_purchasing_history` | Query | Delivery receipts of feed commodities and veterinary medicines with rates, quantities, suppliers. | `start_date`, `end_date`, `item_name` |
| `get_inventory_summary` | Query | Warehouse and bunker inventory stock levels for all feed ingredients. | *(none)* |
| `get_premix_formulas` | Query | Active in-house Wanda recipes, exact ingredient percentages (e.g. Urea 1%), available raw commodities. | *(none)* |
| `get_compliance_summary` | Query | Daily operational compliance overview (feed completion, bunk checks, sick alerts) for daily digest reports. | `date` |
| `add_feed_log` | Mutation | Record a daily TMR split-feeding. Protected by sanity checks & Admin Approval queue in Junior mode. | `date`, `pen`, `feeding_index`, `total_batch_kg`, `ingredients` |
| `log_cattle_weight` | Mutation | Record a scale weigh-in ($40-1200\text{ kg}$). Protected by sanity checks & Admin Approval queue in Junior mode. | `tag`, `weight`, `date`, `pen` |
| `log_treatment` | Mutation | Record veterinary medication with slaughter withholding days. | `tag`, `date`, `type`, `medicine`, `dosage`, `withholding_days` |
| `add_purchase` | Mutation | Record delivery of feed commodities or veterinary medicines. | `date`, `item_name`, `quantity`, `rate`, `supplier` |

