import { Component, OnInit, OnDestroy, AfterViewInit, ElementRef, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClientModule, HttpClient } from '@angular/common/http';
import { Subject, takeUntil } from 'rxjs';
import { SensorService } from './services/sensor.service';
import { WebsocketService, VictimData, AlertMessage } from './services/websocket.service';
import { initializeApp, getApps } from 'firebase/app';
import { getFirestore, doc, setDoc, getDoc, serverTimestamp, collection, query, where, getDocs } from 'firebase/firestore';

declare const L: any; // Leaflet for guardian map

const firebaseConfig = {
  apiKey: "AIzaSyA-tP4DbBotf2z-fjIeD8TSePBexFgmRAI",
  authDomain: "safepulse-companion.firebaseapp.com",
  projectId: "safepulse-companion",
  storageBucket: "safepulse-companion.firebasestorage.app",
  messagingSenderId: "856410389326",
  appId: "1:856410389326:web:770fa23cf460a4ac1b3c1f",
  measurementId: "G-J6JLCKSNRJ"
};

const firebaseApp = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
const db = getFirestore(firebaseApp);

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule, HttpClientModule],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css'
})
export class AppComponent implements OnInit, OnDestroy, AfterViewInit {
  @ViewChild('mapContainer', { static: false }) mapContainer?: ElementRef;

  private destroy$ = new Subject<void>();
  Math = Math; 

  // ==========================================
  // SHARED STATE
  // ==========================================
  userRole: 'NONE' | 'VICTIM' | 'GUARDIAN' = 'NONE';
  private readonly BACKEND_URL = window.location.hostname === 'localhost'
    ? 'http://localhost:3000/api'
    : 'https://safeband-backend-4q0a.onrender.com/api';

  // ==========================================
  // VICTIM STATE
  // ==========================================
  isSetup = true;
  victimName = '';
  victimPhone = '';
  guardianName = '';
  guardianPhone = '';
  setupError = '';
  showEditForm = false;
  firebaseSynced = false;
  profileSaved = false;

  isMonitoring = false;
  riskScore = 0;
  alertLevel = 'SAFE';
  alertTriggered = false;
  reasons: string[] = [];
  location: { lat: number; lng: number } | null = null;
  heartRate = 0;
  shakeIntensity = 0;
  screamDetected = false;
  audioLevel = 0;
  sosPressed = false;
  cameraActive = false;
  backendConnected = false;
  permissionsGranted = false;
  heartRateStatus: 'idle' | 'measuring' | 'ok' | 'noSignal' = 'idle';

  showHeartRateModal = false;
  sosCountdown = 0;
  sosTimer?: any;
  alertHistory: string[] = [];

  // ==========================================
  // GUARDIAN STATE
  // ==========================================
  loginGuardianName = '';
  loginGuardianPhone = '';
  guardianLoginError = '';
  guardianIsLoading = false;
  isDashboardActive = false;

  guardianConnected = false;
  guardianVictims: any[] = [];
  guardianAlertHistory: AlertMessage[] = [];
  selectedVictim: any = null;
  activeAlerts: AlertMessage[] = [];
  showAlertBanner = false;
  activeGuardianTab: 'users' | 'feed' | 'alerts' = 'users';

  // New Features State
  isChatOpen = false;
  isChatTyping = false;
  chatInput = '';
  chatMessages: {sender: string, text: string}[] = [
    { sender: 'ai', text: 'Hello! I am your AI Health Assistant. How can I help you today?' }
  ];

  private map?: any;
  private markers = new Map<string, any>();
  private offlineTimer?: any;

  constructor(
    public sensorService: SensorService,
    private wsService: WebsocketService,
    private http: HttpClient
  ) {}

  ngOnInit(): void {
    this.loadUserProfile();
    
    const savedRole = localStorage.getItem('userRole') as 'VICTIM' | 'GUARDIAN' | null;
    if (savedRole === 'VICTIM') {
      this.selectRole('VICTIM');
    } else if (savedRole === 'GUARDIAN') {
      this.loginGuardianName = localStorage.getItem('loginGuardianName') || '';
      this.loginGuardianPhone = localStorage.getItem('loginGuardianPhone') || '';
      this.selectRole('GUARDIAN');
    }
  }

  ngAfterViewInit(): void {
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.sensorService.stopMonitoring();
    this.wsService.disconnect();
    if (this.offlineTimer) clearInterval(this.offlineTimer);
  }

  selectRole(role: 'VICTIM' | 'GUARDIAN'): void {
    this.userRole = role;
    localStorage.setItem('userRole', role);
    if (role === 'VICTIM') {
      this.initVictimMode();
    }
  }

  resetRole(): void {
    this.sensorService.stopMonitoring();
    this.wsService.disconnect();
    if (this.offlineTimer) clearInterval(this.offlineTimer);
    this.isMonitoring = false;
    this.isSetup = true;
    this.userRole = 'NONE';
    this.isDashboardActive = false;
    localStorage.removeItem('userRole');
  }

  // ==========================================
  // VICTIM LOGIC
  // ==========================================
  private initVictimMode(): void {
    this.sensorService.riskScore$.pipe(takeUntil(this.destroy$)).subscribe(v => this.riskScore = v);
    this.sensorService.alertLevel$.pipe(takeUntil(this.destroy$)).subscribe(v => this.alertLevel = v);
    this.sensorService.alertTriggered$.pipe(takeUntil(this.destroy$)).subscribe(v => {
      if (v && !this.alertTriggered) this.onAlertFired();
      this.alertTriggered = v;
    });
    this.sensorService.reasons$.pipe(takeUntil(this.destroy$)).subscribe(v => this.reasons = v);
    this.sensorService.location$.pipe(takeUntil(this.destroy$)).subscribe(v => this.location = v);
    this.sensorService.heartRate$.pipe(takeUntil(this.destroy$)).subscribe(v => this.heartRate = v);
    this.sensorService.shakeIntensity$.pipe(takeUntil(this.destroy$)).subscribe(v => this.shakeIntensity = v);
    this.sensorService.screamDetected$.pipe(takeUntil(this.destroy$)).subscribe(v => this.screamDetected = v);
    this.sensorService.audioLevel$.pipe(takeUntil(this.destroy$)).subscribe(v => this.audioLevel = v);
    this.sensorService.sosPressed$.pipe(takeUntil(this.destroy$)).subscribe(v => this.sosPressed = v);
    this.sensorService.cameraActive$.pipe(takeUntil(this.destroy$)).subscribe(v => this.cameraActive = v);
    this.sensorService.backendConnected$.pipe(takeUntil(this.destroy$)).subscribe(v => this.backendConnected = v);
    this.sensorService.permissionsGranted$.pipe(takeUntil(this.destroy$)).subscribe(v => this.permissionsGranted = v);
    this.sensorService.heartRateStatus$.pipe(takeUntil(this.destroy$)).subscribe(v => this.heartRateStatus = v);
  }

  private async loadUserProfile(): Promise<void> {
    this.victimName     = localStorage.getItem('victimName')     || '';
    this.victimPhone    = localStorage.getItem('victimPhone')    || '';
    this.guardianName   = localStorage.getItem('guardianName')   || '';
    this.guardianPhone  = localStorage.getItem('guardianPhone')  || '';
    this.profileSaved   = localStorage.getItem('profileSaved')   === 'true';
    const phone = this.victimPhone;
    if (phone) {
      try {
        const snap = await getDoc(doc(db, 'users', phone));
        if (snap.exists()) {
          const data = snap.data();
          this.victimName    = data['victimName']    || this.victimName;
          this.victimPhone   = data['victimPhone']   || this.victimPhone;
          this.guardianName  = data['guardianName']  || this.guardianName;
          this.guardianPhone = data['guardianPhone'] || this.guardianPhone;
          this.firebaseSynced = true;
          this.saveLocalStorage();
        }
      } catch (e) {
        console.warn('[Firebase] Could not load profile:', e);
      }
    }
  }

  private saveLocalStorage(): void {
    localStorage.setItem('victimName',    this.victimName);
    localStorage.setItem('victimPhone',   this.victimPhone);
    localStorage.setItem('guardianName',  this.guardianName);
    localStorage.setItem('guardianPhone', this.guardianPhone);
  }

  /** Converts any accepted phone format to +91XXXXXXXXXX for consistent storage */
  private toCanonicalPhone(phone: string): string {
    const digits = (phone || '').replace(/\D/g, '');
    const last10 = digits.slice(-10);
    return last10.length === 10 ? `+91${last10}` : phone;
  }

  private async saveUserProfile(): Promise<void> {
    // Always normalize phones before saving
    this.victimPhone   = this.toCanonicalPhone(this.victimPhone);
    this.guardianPhone = this.toCanonicalPhone(this.guardianPhone);
    this.saveLocalStorage();
    if (this.victimPhone) {
      try {
        await setDoc(doc(db, 'users', this.victimPhone), {
          victimName:    this.victimName,
          victimPhone:   this.victimPhone,
          guardianName:  this.guardianName,
          guardianPhone: this.guardianPhone,
          updatedAt:     serverTimestamp()
        }, { merge: true });
        this.firebaseSynced = true;
        localStorage.setItem('profileSaved', 'true');
        this.profileSaved = true;
        console.log('[Firebase] Profile saved ✅ phones normalized:', this.victimPhone, this.guardianPhone);
      } catch (e) {
        console.warn('[Firebase] Could not save profile:', e);
      }
    }
  }

  get isAlreadyRegistered(): boolean {
    return !!(this.victimName && this.victimPhone && this.guardianName && this.guardianPhone);
  }

  async startWithRegistered(): Promise<void> {
    if (this.isAlreadyRegistered) {
      await this.startMonitoring(true);
    }
  }

  async startMonitoring(skipValidation = false): Promise<void> {
    if (!skipValidation) {
      if (!this.victimName.trim()) {
        this.setupError = 'Please enter your name.';
        return;
      }
      if (!this.validatePhone(this.victimPhone)) {
        this.setupError = 'Please enter a valid 10-digit phone number (e.g. 9876543210 or +91-9876543210).';
        return;
      }
      if (!this.guardianName.trim()) {
        this.setupError = "Please enter your guardian's name.";
        return;
      }
      if (!this.validatePhone(this.guardianPhone)) {
        this.setupError = "Guardian's phone must be a valid 10-digit number (e.g. 9876543210 or +91-9876543210).";
        return;
      }
      this.setupError = '';
      await this.saveUserProfile();
    }
    const success = await this.sensorService.startMonitoring(
      this.victimName, this.victimPhone, this.guardianName, this.guardianPhone
    );
    if (success) {
      this.isSetup = false;
      this.isMonitoring = true;
      this.showEditForm = false;
    }
  }

  stopMonitoring(): void {
    this.sensorService.stopMonitoring();
    this.isMonitoring = false;
    this.isSetup = true;
  }

  triggerSOS(): void {
    this.sensorService.triggerSOS();
    this.sosCountdown = 10;
    clearInterval(this.sosTimer);
    this.sosTimer = setInterval(() => {
      this.sosCountdown--;
      if (this.sosCountdown <= 0) clearInterval(this.sosTimer);
    }, 1000);
  }

  async toggleCamera(): Promise<void> {
    if (this.cameraActive) {
      this.sensorService.stopCameraHeartRate();
    } else {
      const success = await this.sensorService.startCameraHeartRate();
      if (!success) alert('Camera permission denied');
    }
  }

  onAlertFired(): void {
    const entry = `[${new Date().toLocaleTimeString()}] ALERT - Score: ${this.riskScore}`;
    this.alertHistory.unshift(entry);
  }

  get alertClass(): string {
    switch (this.alertLevel) {
      case 'CRITICAL': return 'level-critical';
      case 'DANGER':   return 'level-danger';
      case 'WARNING':  return 'level-warning';
      default:         return 'level-safe';
    }
  }

  get riskBarColor(): string {
    if (this.riskScore >= 70) return '#ef4444';
    if (this.riskScore >= 40) return '#f59e0b';
    return '#10b981';
  }

  get locationString(): string {
    if (!this.location) return 'Acquiring...';
    return `${this.location.lat.toFixed(4)}°N, ${this.location.lng.toFixed(4)}°E`;
  }

  get audioPercent(): number {
    return Math.min(100, this.audioLevel);
  }

  openMapsLink(): void {
    if (this.location) {
      window.open(`https://www.google.com/maps/search/?api=1&query=${this.location.lat},${this.location.lng}`, '_blank');
    }
  }

  editRegistration(): void {
    this.sensorService.stopMonitoring();
    this.isMonitoring = false;
    this.profileSaved = false; // Allow editing details without auto-saving
    this.isSetup = true;
  }

  private deduplicateVictims(list: any[]): any[] {
    const uniqueMap = new Map<string, any>();
    list.forEach(v => {
      const key = (v.phone && v.phone !== 'N/A') ? this.normalizePhone(v.phone) : v.victimId;
      if (!uniqueMap.has(key)) {
        uniqueMap.set(key, v);
      } else {
        const existing = uniqueMap.get(key);
        const existingTime = existing.lastSeen ? new Date(existing.lastSeen).getTime() : 0;
        const newTime = v.lastSeen ? new Date(v.lastSeen).getTime() : 0;
        if (existing.isOffline && !v.isOffline) {
          uniqueMap.set(key, v);
        } else if (newTime > existingTime) {
          uniqueMap.set(key, v);
        }
      }
    });
    return Array.from(uniqueMap.values());
  }

  // ==========================================
  // PHONE VALIDATION
  // ==========================================
  /**
   * Accepts any of these formats as valid:
   *   +91-8790131164  → strips to 918790131164 → last 10 = 8790131164 ✓
   *   +918790131164   → strips to 918790131164 → last 10 = 8790131164 ✓
   *   8790131164      → strips to 8790131164   → length 10 = valid    ✓
   * Rejects anything whose digit-only form is not 10 or 12 (starting with 91).
   */
  validatePhone(phone: string): boolean {
    const digits = (phone || '').replace(/\D/g, '');
    if (digits.length === 10) return true;                          // plain 10 digits
    if (digits.length === 12 && digits.startsWith('91')) return true; // +91 prefix
    return false;
  }

  normalizePhone(phone: string): string {
    const digits = (phone || '').replace(/\D/g, '');
    return digits.slice(-10); // always returns last 10 digits
  }

  // ==========================================
  // GUARDIAN LOGIC
  // ==========================================
  
  async loginGuardian(): Promise<void> {
    if (!this.loginGuardianName.trim()) {
      this.guardianLoginError = 'Please enter your name.';
      return;
    }
    if (!this.validatePhone(this.loginGuardianPhone)) {
      this.guardianLoginError = 'Please enter a valid 10-digit phone number (e.g. 9876543210 or +91-9876543210).';
      return;
    }

    // Normalize to canonical format before querying Firestore
    const normalizedPhone = this.toCanonicalPhone(this.loginGuardianPhone);

    this.guardianIsLoading = true;
    this.guardianLoginError = '';

    try {
      const q = query(
        collection(db, "users"),
        where("guardianPhone", "==", normalizedPhone)
      );
      const querySnapshot = await getDocs(q);

      if (querySnapshot.empty) {
        this.guardianLoginError = 'No user registered for this guardian phone number.';
        this.guardianIsLoading = false;
        return;
      }

      // Case-insensitive guardian name comparison in memory
      const matchedUser = querySnapshot.docs.find(d => {
        const storedName = (d.data()['guardianName'] || '').toLowerCase().trim();
        const inputName = this.loginGuardianName.toLowerCase().trim();
        return storedName === inputName;
      });

      if (!matchedUser) {
        this.guardianLoginError = 'Guardian name does not match the registered name.';
        this.guardianIsLoading = false;
        return;
      }

      // Set name to exact casing stored in Firestore
      this.loginGuardianName = matchedUser.data()['guardianName'];

      // Store normalized phone so dashboard filtering also works
      this.loginGuardianPhone = normalizedPhone;
      localStorage.setItem('loginGuardianName', this.loginGuardianName);
      localStorage.setItem('loginGuardianPhone', normalizedPhone);
      this.guardianIsLoading = false;
      this.initGuardianDashboard();

    } catch (e) {
      console.error("Guardian login error:", e);
      this.guardianLoginError = 'Error verifying guardian. Please try again.';
      this.guardianIsLoading = false;
    }
  }

  private initGuardianDashboard(): void {
    this.isDashboardActive = true;

    this.wsService.connect();

    this.wsService.connected$.pipe(takeUntil(this.destroy$)).subscribe(c => this.guardianConnected = c);

    this.wsService.message$.pipe(takeUntil(this.destroy$)).subscribe(msg => this.handleWSMessage(msg));

    this.http.get<any>(`${this.BACKEND_URL}/victims`).subscribe({
      next: (res) => { 
        const targetPhone = (this.loginGuardianPhone || '').replace(/\D/g, '').slice(-10);
        const filtered = (res.victims || []).filter((v:any) => {
          const p = (v.guardianPhone || '').replace(/\D/g, '').slice(-10);
          return p && p === targetPhone;
        });
        this.guardianVictims = this.deduplicateVictims(filtered);
        if (this.guardianVictims.length > 0 && !this.selectedVictim) {
          this.selectedVictim = this.guardianVictims[0];
        }
        setTimeout(() => this.initMap(), 500);
      },
      error: () => console.warn('Cannot reach backend REST API')
    });

    this.http.get<any>(`${this.BACKEND_URL}/alerts`).subscribe({
      next: (res) => {
        const victimIds = this.guardianVictims.map(v => v.victimId);
        this.guardianAlertHistory = (res.alerts || []).filter((a: any) => victimIds.includes(a.victimId));
      },
      error: () => {}
    });

    this.offlineTimer = setInterval(() => {
       const now = Date.now();
       this.guardianVictims.forEach(v => {
          if (v.lastSeen) {
             const lastSeenTime = new Date(v.lastSeen).getTime();
             if (now - lastSeenTime > 15000) {
                 v.isOffline = true;
             } else {
                 v.isOffline = false;
             }
          }
       });
    }, 5000);
  }

  private handleWSMessage(msg: any): void {
    const targetPhone = (this.loginGuardianPhone || '').replace(/\D/g, '').slice(-10);
    if (msg.type === 'INIT') {
      const filtered = (msg.victims || []).filter((v:any) => {
        const p = (v.guardianPhone || '').replace(/\D/g, '').slice(-10);
        return p && p === targetPhone;
      });
      this.guardianVictims = this.deduplicateVictims(filtered);
      const victimIds = this.guardianVictims.map(v => v.victimId);
      this.guardianAlertHistory = (msg.alertHistory || []).filter((a: any) => victimIds.includes(a.victimId));
      if (this.guardianVictims.length > 0 && !this.selectedVictim) {
        this.selectedVictim = this.guardianVictims[0];
      }
      this.updateMapMarkers();
    } else if (msg.type === 'VICTIM_UPDATE') {
      const victim = msg.victim;
      victim.isOffline = false; 

      const victimGuardianPhone = (victim.guardianPhone || '').replace(/\D/g, '').slice(-10);
      if (!victimGuardianPhone || victimGuardianPhone !== targetPhone) return;

      const idx = this.guardianVictims.findIndex(v => v.victimId === victim.victimId);
      if (idx >= 0) {
        this.guardianVictims[idx] = victim;
      } else {
        this.guardianVictims.push(victim);
      }
      this.guardianVictims = this.deduplicateVictims(this.guardianVictims);

      if (this.selectedVictim?.victimId === victim.victimId) {
        this.selectedVictim = this.guardianVictims.find(v => v.victimId === victim.victimId) || null;
      }

      if (msg.alert) {
        const victimIds = this.guardianVictims.map(v => v.victimId);
        if (victimIds.includes(msg.alert.victimId)) {
          this.guardianAlertHistory.unshift(msg.alert);
          this.activeAlerts.unshift(msg.alert);
          this.showAlertBanner = true;
          setTimeout(() => { this.showAlertBanner = false; }, 8000);
        }
      }

      const filteredVictim = this.guardianVictims.find(v => v.victimId === victim.victimId);
      if (filteredVictim) this.updateMapMarker(filteredVictim);
    }
  }

  // ─── Leaflet Map ──────────────────────────────────────────────
  private initMap(): void {
    if (!this.mapContainer) return;
    if (this.map) {
      this.map.remove();
    }
    this.map = L.map(this.mapContainer.nativeElement, { center: [12.9716, 77.5946], zoom: 13, zoomControl: true });
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '©OpenStreetMap ©CartoDB', maxZoom: 19
    }).addTo(this.map);
    this.updateMapMarkers();
  }

  private updateMapMarkers(): void {
    if (!this.map) return;
    this.guardianVictims.forEach(v => this.updateMapMarker(v));
  }

  private updateMapMarker(victim: any): void {
    if (!this.map || !victim.location) return;

    const { lat, lng } = victim.location;
    const color = this.getAlertColor(victim.alertLevel);
    const isAlert = victim.alertTriggered;

    const icon = L.divIcon({
      className: '',
      html: `
        <div class="map-marker ${isAlert ? 'marker-alert' : ''}">
          <div class="marker-inner" style="background:${color}">
            <span>${victim.name[0]?.toUpperCase() || '?'}</span>
          </div>
          ${isAlert ? '<div class="marker-ring"></div>' : ''}
        </div>
      `,
      iconSize: [40, 40],
      iconAnchor: [20, 20]
    });

    if (this.markers.has(victim.victimId)) {
      const marker = this.markers.get(victim.victimId);
      marker.setLatLng([lat, lng]);
      marker.setIcon(icon);
    } else {
      const marker = L.marker([lat, lng], { icon })
        .addTo(this.map)
        .on('click', () => this.selectVictim(victim));
      this.markers.set(victim.victimId, marker);
    }
  }

  selectVictim(victim: any): void {
    this.selectedVictim = victim;
    this.activeGuardianTab = 'feed'; // Switch to Live Feed tab on mobile
    if (this.map && victim.location) {
      this.map.flyTo([victim.location.lat, victim.location.lng], 15, { duration: 1 });
    }
  }

  openGuardianGoogleMaps(victim: any): void {
    if (victim.location) {
      window.open(`https://www.google.com/maps/search/?api=1&query=${victim.location.lat},${victim.location.lng}`, '_blank');
    }
  }

  getAlertColor(level: string): string {
    switch (level) {
      case 'CRITICAL': return '#dc2626';
      case 'DANGER': return '#ef4444';
      case 'WARNING': return '#f59e0b';
      default: return '#10b981';
    }
  }

  getGuardianAlertClass(level: string): string {
    switch (level) {
      case 'CRITICAL': return 'level-critical';
      case 'DANGER': return 'level-danger';
      case 'WARNING': return 'level-warning';
      default: return 'level-safe';
    }
  }

  get criticalCount(): number { return this.guardianVictims.filter(v => (v.alertLevel === 'CRITICAL' || v.alertLevel === 'DANGER') && !v.isOffline).length; }
  get safeCount(): number { return this.guardianVictims.filter(v => v.alertLevel === 'SAFE' && !v.isOffline).length; }

  formatTime(iso: string): string {
    if (!iso) return '--:--:--';
    try { return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }); }
    catch { return iso; }
  }

  getAlertScore(a: any): string {
    if (a.score !== undefined && a.score !== null) return `${a.score}`;
    const match = (a.text || '').match(/\((\d+)\/100\)/);
    return match ? match[1] : '70';
  }

  trackByVictim(_: number, v: any) { return v.victimId; }
  trackByAlert(_: number, a: AlertMessage) { return a.id; }

  // ─── AI Health Chatbot ──────────────────────────────────────
  sendChatMessage(): void {
    if (!this.chatInput.trim()) return;
    
    this.chatMessages.push({ sender: 'user', text: this.chatInput });
    const query = this.chatInput;
    this.chatInput = '';
    this.isChatTyping = true;
    
    const url = `${this.BACKEND_URL}/chat?q=${encodeURIComponent(query)}`;
    
    this.http.get<any>(url).subscribe({
      next: (res) => {
        this.isChatTyping = false;
        if (res && res.reply) {
          this.chatMessages.push({ sender: 'ai', text: res.reply });
        } else {
          this.chatMessages.push({ sender: 'ai', text: 'Received empty response from AI.' });
        }
      },
      error: (err) => {
        this.isChatTyping = false;
        const errMsg = err.message || JSON.stringify(err);
        console.error('AI Error:', err);
        this.chatMessages.push({ sender: 'ai', text: 'Error details: ' + errMsg });
      }
    });
  }
}
