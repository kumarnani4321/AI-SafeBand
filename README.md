# AI SafeBand - Complete Setup & Run Guide

## Quick Start

Open **3 separate PowerShell terminals** and run one command in each:

### Terminal 1 — Backend
```powershell
cd "c:\Users\MIRIYALA PUSHPALATHA\Downloads\AI SafeBand\backend"
node server.js
```

### Terminal 2 — Victim App (Angular PWA)
```powershell
cd "c:\Users\MIRIYALA PUSHPALATHA\Downloads\AI SafeBand\victim-app"
npx ng serve --port 4200 --open
```

### Terminal 3 — Guardian Dashboard (Angular)
```powershell
cd "c:\Users\MIRIYALA PUSHPALATHA\Downloads\AI SafeBand\guardian-dashboard"
npx ng serve --port 4201 --open
```

---

## URLs
| App | URL | Purpose |
|-----|-----|---------|
| Victim App | http://localhost:4200 | Open on phone / victim browser |
| Guardian Dashboard | http://localhost:4201 | Open on guardian's computer |
| Backend API | http://localhost:3000/api/health | Check backend status |

---

## How It Works (from screenshots)

```
All automatic — zero hardware — real signals
─────────────────────────────────────────────

📳 Shake          🎙️ Scream        ❤️ Heart Rate      📍 Location       🆘 SOS
Accelerometer     Microphone       Camera rPPG        GPS               Big button
Built into phone  Built into phone Finger on lens     Built into phone  on screen
                                   Real BPM!

            ↓              ↓              ↓              ↓         ↓
          ┌─────────────────────────────────────────────────────────┐
          │                     Risk Engine                         │
          │   Shake > threshold  → +40 pts                         │
          │   Scream detected    → +35 pts                         │
          │   BPM > 120 (panic)  → +25 pts                        │
          │   SOS pressed        → +95 pts instantly               │
          └─────────────────────────────────────────────────────────┘
                              score > 70 ?
                                  ↓
                          Alert Fired! 🚨
                  SMS + WhatsApp → Guardian sees everything
```

---

## Real Twilio SMS (Optional)
1. Create account at https://twilio.com
2. Copy `.env.example` to `.env` in the backend folder
3. Fill in your credentials:
   ```
   TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   TWILIO_AUTH_TOKEN=your_token
   TWILIO_FROM=+1234567890    # Your Twilio number
   GUARDIAN_PHONE=+91XXXXXXXXXX  # Guardian's phone
   ```
4. Uncomment the Twilio code in `backend/server.js`

---

## Project Structure
```
AI SafeBand/
├── backend/              # Node.js + Express + WebSocket
│   ├── server.js        # Risk engine, REST API, WebSocket
│   └── package.json
├── victim-app/           # Angular PWA (victim's phone)
│   └── src/app/
│       ├── app.component.ts   # Main component
│       ├── app.component.html # UI template
│       ├── app.component.css  # Premium dark UI
│       └── services/
│           └── sensor.service.ts  # GPS, camera, mic, shake
└── guardian-dashboard/   # Angular (guardian's screen)
    └── src/app/
        ├── app.component.ts   # Dashboard logic
        ├── app.component.html # Live map + alerts
        ├── app.component.css  # Dark command center UI
        └── services/
            └── websocket.service.ts  # Real-time WS
```
