import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClientModule } from '@angular/common/http';
import { Subject, takeUntil } from 'rxjs';
import { SensorService } from './services/sensor.service';
import { initializeApp, getApps } from 'firebase/app';
import { getFirestore, doc, setDoc, getDoc, serverTimestamp } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyDgE1WsQRKy4Xv0NxioRZljnTPrN_QInbI",
  authDomain: "safeband-ai-4910b.firebaseapp.com",
  projectId: "safeband-ai-4910b",
  storageBucket: "safeband-ai-4910b.firebasestorage.app",
  messagingSenderId: "178087581591",
  appId: "1:178087581591:web:45e191917733b269e996d2",
  measurementId: "G-WK7ZPRTHZB"
};

// Initialise Firebase only once (guard for HMR re-runs)
const firebaseApp = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
const db = getFirestore(firebaseApp);

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule, HttpClientModule],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css'
})
export class AppComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  Math = Math; // Expose to template

  // Setup fields
  isSetup = true;
  victimName = '';
  victimPhone = '';
  guardianName = '';
  guardianPhone = '';
  setupError = '';
  showEditForm = false;    // controls inline edit panel
  firebaseSynced = false;  // shows cloud-sync badge

  // Sensor state
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

  // UI State
  showHeartRateModal = false;
  sosCountdown = 0;
  sosTimer?: any;
  alertHistory: string[] = [];

  constructor(public sensorService: SensorService) {}

  ngOnInit(): void {
    // Try loading from Firebase first, fallback to localStorage
    this.loadUserProfile();

    // Subscribe to all sensor streams
    this.sensorService.riskScore$.pipe(takeUntil(this.destroy$))
      .subscribe(v => this.riskScore = v);
    this.sensorService.alertLevel$.pipe(takeUntil(this.destroy$))
      .subscribe(v => this.alertLevel = v);
    this.sensorService.alertTriggered$.pipe(takeUntil(this.destroy$))
      .subscribe(v => {
        if (v && !this.alertTriggered) this.onAlertFired();
        this.alertTriggered = v;
      });
    this.sensorService.reasons$.pipe(takeUntil(this.destroy$))
      .subscribe(v => this.reasons = v);
    this.sensorService.location$.pipe(takeUntil(this.destroy$))
      .subscribe(v => this.location = v);
    this.sensorService.heartRate$.pipe(takeUntil(this.destroy$))
      .subscribe(v => this.heartRate = v);
    this.sensorService.shakeIntensity$.pipe(takeUntil(this.destroy$))
      .subscribe(v => this.shakeIntensity = v);
    this.sensorService.screamDetected$.pipe(takeUntil(this.destroy$))
      .subscribe(v => this.screamDetected = v);
    this.sensorService.audioLevel$.pipe(takeUntil(this.destroy$))
      .subscribe(v => this.audioLevel = v);
    this.sensorService.sosPressed$.pipe(takeUntil(this.destroy$))
      .subscribe(v => this.sosPressed = v);
    this.sensorService.cameraActive$.pipe(takeUntil(this.destroy$))
      .subscribe(v => this.cameraActive = v);
    this.sensorService.backendConnected$.pipe(takeUntil(this.destroy$))
      .subscribe(v => this.backendConnected = v);
    this.sensorService.permissionsGranted$.pipe(takeUntil(this.destroy$))
      .subscribe(v => this.permissionsGranted = v);
    this.sensorService.heartRateStatus$.pipe(takeUntil(this.destroy$))
      .subscribe(v => this.heartRateStatus = v);
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.sensorService.stopMonitoring();
  }

  // ── Firebase: Load user profile ──────────────────────────────
  private async loadUserProfile(): Promise<void> {
    // Primary: localStorage (instant)
    this.victimName     = localStorage.getItem('victimName')     || '';
    this.victimPhone    = localStorage.getItem('victimPhone')    || '';
    this.guardianName   = localStorage.getItem('guardianName')   || '';
    this.guardianPhone  = localStorage.getItem('guardianPhone')  || '';

    // Secondary: try to pull from Firestore if phone is known
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
          // Keep localStorage in sync
          localStorage.setItem('victimName',    this.victimName);
          localStorage.setItem('victimPhone',   this.victimPhone);
          localStorage.setItem('guardianName',  this.guardianName);
          localStorage.setItem('guardianPhone', this.guardianPhone);
        }
      } catch (e) {
        console.warn('[Firebase] Could not load profile:', e);
      }
    }
  }

  // ── Firebase: Save user profile ──────────────────────────────
  private async saveUserProfile(): Promise<void> {
    localStorage.setItem('victimName',    this.victimName);
    localStorage.setItem('victimPhone',   this.victimPhone);
    localStorage.setItem('guardianName',  this.guardianName);
    localStorage.setItem('guardianPhone', this.guardianPhone);

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
        console.log('[Firebase] Profile saved ✅');
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
      if (!this.victimName.trim() || !this.victimPhone.trim() || !this.guardianName.trim() || !this.guardianPhone.trim()) {
        this.setupError = 'Please fill out all registration fields.';
        return;
      }
      this.setupError = '';
      await this.saveUserProfile();
    }

    const success = await this.sensorService.startMonitoring(
      this.victimName,
      this.victimPhone,
      this.guardianName,
      this.guardianPhone
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
      window.open(`https://maps.google.com/?q=${this.location.lat},${this.location.lng}`, '_blank');
    }
  }

  editRegistration(): void {
    this.sensorService.stopMonitoring();
    this.isMonitoring = false;
    this.isSetup = true;
  }
}
