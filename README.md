# Digital Hostel Booking, Management and Security System

A WhatsApp-first student accommodation booking platform with an operations dashboard, dual independent facility management (Male and Female Hostels), consent-based random roommate matching, individual payment verification, 12-month accommodation lifecycle tracking, and cryptographic QR digital entry credentials.

---

## 🏛️ System Architecture & Highlights

- **Dual Independent Hostel Facilities**:
  - **Alpha Male Hall** (West Wing Accommodation for Men)
  - **Beta Female Hall** (East Wing Accommodation for Women)
  - Strict database and business-logic enforcement: Students cannot be booked, grouped, or allocated across facilities.
- **WhatsApp-First Conversational Booking**:
  - Conversational multi-step registration (Name &rarr; Gender Facility &rarr; Department &rarr; Level &rarr; Occupancy &rarr; Roommate Selection).
  - Quick-reply interactive buttons and typed fallback commands (`MENU`, `QR`, `BOOK`, `STATUS`, `HELP`).
  - Idempotent webhook processing preventing duplicate message execution.
  - State machine maintained by phone number.
- **Roommate Groups & Consent-Based Matching**:
  - **Known Roommates**: Leader creates group &rarr; unique invitation code (e.g., `GRP-ABCD`) &rarr; roommates register independently and input the code.
  - **Random Matching**: Students independently opt-in with explicit consent. FIFO queue priority matching. Known pairs requesting triple occupancy can receive a consented third member from the queue.
  - Queue priority timestamp is stamped when the group becomes complete.
- **Individual Payments & Held Allocations**:
  - Every student pays individually.
  - Compatible rooms are placed on **HOLD** for complete groups while individual payments are pending.
  - Room allocation is **never finalized** until all required group members have verified payments.
  - Initial compatible room is auto-selected; manager can override with audit logging.
- **Independent 12-Month Accommodations & Renewals**:
  - Independent accommodation start date and 12-month expiry date calculated separately per student.
  - Configurable renewal reminder tiers: 30, 14, 7 days before expiry.
  - **Strict Policy**: No automatic renewal and no automatic charging.
- **QR Digital Identity & Checkpoint Security**:
  - Unpredictable 32-byte cryptographic token; personal student details are **never** exposed in plaintext within QR payloads.
  - Verified in real time against SHA-256 hash in the database.
  - Status-aware: `ACTIVE`, `REVOKED`, `EXPIRED`.
  - In-browser camera scanner (`html5-qrcode`) with manual entry fallback.
  - Access attempts recorded in security checkpoint logs.
- **Meta WhatsApp Cloud API & Safe Local Simulator**:
  - Official Meta Cloud API HTTP integration for production webhooks and messages.
  - Local smartphone simulator interface allowing full testing without external credentials.
  - Clear dashboard indicators showing `SIMULATOR` mode vs. `LIVE` Meta Cloud API connection.

---

## 🛠️ Tech Stack

- **Frontend**: React 18, Vite, TypeScript, Tailwind CSS, Lucide React, `html5-qrcode`
- **Backend**: Node.js v24 (ES Modules), Express, TypeScript, Zod, JWT, bcryptjs, QRCode
- **Database**: Persistent SQLite with `better-sqlite3` (WAL mode, Foreign Keys enabled)
- **Testing**: Vitest automated unit & integration test suite (17 passed tests)
- **Monorepo**: npm workspaces (`shared`, `backend`, `frontend`)

---

## 🚀 Quick Start (Windows Native)

### 1. Prerequisites
- Node.js `v24.15.0` or compatible
- npm `v11+`
- Windows PowerShell

### 2. Install Dependencies & Seed Demo Data
```powershell
# In project root: C:\Users\hcl\Documents\hostel-management-system
npm.cmd install
npm.cmd run seed -w backend
```

### 3. Run Backend & Frontend Concurrently
```powershell
npm.cmd run dev
```

The application will start:
- **Manager Dashboard**: `http://localhost:3000`
- **Backend API & Webhooks**: `http://localhost:4000`

---

## 🔑 Demo Manager Credentials

| Role | Username | Password |
|---|---|---|
| **Hostel General Manager** | `admin` | `AdminPassword123!` |

*(A one-click "Fill Local Demo Credentials" button is also provided on the login page.)*

---

## 🧪 Automated Test Suite

Run the full automated test suite covering facility separation, capacity enforcement, payment verification locks, consent-based random matching, cryptographic QR validation, and WhatsApp state machines:

```powershell
npm.cmd run test -w backend
```

---

## 📱 WhatsApp Integration Setup

### Current Mode: SIMULATOR MODE (Default)
When Meta credentials are not configured in `.env`, the system runs in **SIMULATOR mode**.
The manager can open the **WhatsApp & Simulator** tab in the dashboard to test the full student conversation, registration, booking status, and QR image delivery using an interactive phone mockup.

### Switching to Official Meta Cloud API (Production)
To connect to live Meta WhatsApp Cloud API:

1. Create an app in [Meta for Developers](https://developers.facebook.com/) and add the **WhatsApp** product.
2. In Meta App Dashboard, navigate to **WhatsApp &gt; API Setup** and generate a System User Access Token and Phone Number ID.
3. Configure `.env` in the root folder:
   ```env
   META_WHATSAPP_ACCESS_TOKEN=<your_permanent_access_token>
   META_WHATSAPP_PHONE_NUMBER_ID=<your_meta_phone_number_id>
   META_WHATSAPP_BUSINESS_ACCOUNT_ID=<your_waba_id>
   META_WHATSAPP_APP_SECRET=<your_meta_app_secret>
   META_WHATSAPP_VERIFY_TOKEN=hostel_meta_verify_token_demo_2026
   PUBLIC_BASE_URL=https://your-public-domain.com
   ```
4. Expose port 4000 via a public HTTPS URL (e.g., using ngrok, Cloudflare Tunnel, or a public server):
   ```powershell
   ngrok http 4000
   ```
5. In Meta App Dashboard &gt; WhatsApp &gt; Configuration:
   - **Callback URL**: `https://<your-domain>/api/whatsapp/webhook`
   - **Verify Token**: `hostel_meta_verify_token_demo_2026`
   - Subscribe to the `messages` webhook field.

---

## 📋 Demo Acceptance Walkthrough

Follow these exact steps to demonstrate the prototype:

1. **Open WhatsApp Assistant**:
   - Go to `http://localhost:3000/whatsapp`.
   - The WhatsApp Phone Mockup is loaded.
2. **Register as a Student**:
   - Select "New Student" or enter your phone number.
   - Click `BOOK` or type `BOOK`.
   - Reply with your Full Name, select `Male Hostel` or `Female Hostel`, Department, Academic Level, and Occupancy (e.g. Single).
   - Receive registration confirmation with booking group code and pending payment alert.
3. **Log Into Manager Dashboard**:
   - Navigate to `http://localhost:3000/`.
   - Sign in with `admin` / `AdminPassword123!`.
4. **Review Student & Payments**:
   - Go to **Student Directory**: Find your newly registered student record.
   - Go to **Payments & Approvals**: Find your pending individual deposit. Click **Verify** and enter verification notes.
5. **Finalize Allocation**:
   - Go to **Booking Groups**: Your group now displays all payments verified.
   - Click **Finalize Room Allocation**.
   - Notice the compatible room automatically selected.
   - Pick the accommodation start date and click **Confirm Final Allocation**.
6. **Retrieve Digital Identity QR Pass**:
   - Return to the **WhatsApp Assistant** tab.
   - Click the interactive button **Show my QR code** or type `QR`.
   - The assistant replies with your official cryptographic digital identity pass image with room number and 12-month validity period.
7. **Gate Security Verification**:
   - Click **Verify Student Pass** in the dashboard top bar (or open **QR Digital Identity** &gt; **Launch Gate QR Scanner**).
   - Enter your pass token or hash (or scan via camera).
   - Receive `ACCESS GRANTED` confirmation with student photo, room number, and facility details.
8. **Renewals & Announcements**:
   - Go to **Expiries & Renewals**: Inspect seeded students with upcoming expiries (within 7, 14, 30 days, and expired).
   - Select students and click **Send Reminders** to dispatch WhatsApp notices.
   - Go to **Bulk Announcements**: Compose a memo, preview targeted recipients, and dispatch via WhatsApp.
9. **Audit Trail**:
   - Go to **Audit Trail**: View chronological entries for allocations, reallocations, payment verifications, and price updates.
