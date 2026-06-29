# 🚀 SafePulse AI — Live Demo Presenter Script (2 Presenters)

This script coordinates the live demo between **Presenter 1 (You)** and **Presenter 2 (Your Colleague)**. It is structured like a conversational flow to show off the mobile User App and Web Guardian Dashboard.

---

## 🎭 Roles & Setup
* **Presenter 1 (You):** Screensharing your mobile phone (User App).
* **Presenter 2 (Colleague):** Screensharing their laptop screen (Guardian Dashboard).

---

## 🎬 Part 1: The Transition to Demo
**Colleague (Presenter 2):**
> *"Thank you. Now that we have covered the slides, we would love to show you a live demonstration of how SafePulse AI operates in a real-world scenario. My colleague will start by showing the user’s mobile application interface."*

**[Action: Presenter 1 shares mobile screen showing the User Registration page]**

---

## 📱 Part 2: The User App & Sensor Check
**You (Presenter 1):**
> *"Thank you. I am currently sharing my mobile screen. What you see here is the onboarding interface of the SafePulse AI User App.*
> 
> *As a new user, registration is extremely simple. I will fill in my name—**Pramodh**—and register my trusted contact's phone number. Once I click **'Start Monitoring'**, the application securely establishes a WebSocket connection to our backend server and begins streaming active telemetry.*
> 
> *Now that I am logged in, you can see my live safety dashboard. The application is monitoring critical safety signals in real-time:*
> * *First, my **GPS Location** coordinates are being updated.*
> * *Second, the **Gyroscope** tracks any sudden, violent movements or drops.*
> * *Third, the **Voice Decibel Meter** listens for scream thresholds.*
> * *And finally, our **Heart Rate sensor** tracks distress signals.*
> 
> *Our backend AI engine continuously processes these inputs to calculate a real-time risk score from 0 to 100. Right now, because I am safe and standing still, my risk score is at zero. I will now hand over to my colleague to show what the guardian sees on their end."*

**[Action: Presenter 1 stops sharing. Presenter 2 shares laptop screen showing the Guardian Dashboard]**

---

## 🛡️ Part 3: The Guardian Dashboard
**Colleague (Presenter 2):**
> *"Thank you. Now, I am sharing the Guardian Dashboard. As you can see, the moment Pramodh clicked 'Start Monitoring', his profile immediately appeared on my feed as **'ONLINE'**.*
> 
> *I can see his exact location pinned on this interactive map, updated live every 5 seconds. I can also monitor his safety status and risk score, which is currently showing **0% (SAFE)**. Both portals are connected through a high-speed, low-latency WebSocket connection, ensuring no delays."*

---

## ⚡ Part 4: Triggering the Alert (The Climax)
**You (Presenter 1):**
> *"Now, let's look at how the emergency alert is triggered.*
> 
> *SafePulse AI handles this in two ways:*
> * *First, **automatically**: if my phone detects a combination of violent shaking, high decibel screams, or a spiked heart rate, the risk score climbs and triggers an alert when it crosses 70.*
> * *Second, **manual**: if I am in immediate danger, I can override the sensors by tapping the **SOS button**.*
> 
> *For this demo, I will tap the **SOS button** on my phone now."*

**[Action: You tap the SOS button on your phone]**

**Colleague (Presenter 2):**
> *"The moment the SOS is tapped, look at the Guardian Dashboard. It immediately flashes red, displaying a **'CRITICAL'** alarm status. Pramodh's risk score instantly jumped to **95/100**.*
> 
> *At the exact same millisecond, the backend server triggers an emergency SMS to my phone via Twilio. You can see this entry live in the **'📩 SMS Alerts Sent'** section of the dashboard showing the recipient, the precise coordinate link, and time of trigger. This guarantees that help is on the way immediately, even if the user's phone is lost or taken.*
> 
> *This concludes our live demonstration. We are now open for any questions you might have. Thank you!"*
