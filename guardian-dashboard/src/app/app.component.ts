import { Component, OnInit, OnDestroy, AfterViewInit, ElementRef, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClientModule, HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { Subject, takeUntil } from 'rxjs';
import { WebsocketService, VictimData, AlertMessage } from './services/websocket.service';

declare const L: any; // Leaflet

export interface ChatMessage {
  sender: 'user' | 'ai';
  text: string;
  time: string;
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, HttpClientModule, FormsModule],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css'
})
export class AppComponent implements OnInit, OnDestroy, AfterViewInit {
  @ViewChild('mapContainer', { static: false }) mapContainer?: ElementRef;

  private destroy$ = new Subject<void>();
  private map?: any;
  private markers = new Map<string, any>();

  // State
  connected = false;
  victims: VictimData[] = [];
  alertHistory: AlertMessage[] = [];
  selectedVictim: VictimData | null = null;
  activeAlerts: AlertMessage[] = [];
  showAlertBanner = false;
  Math = Math;

  // Chatbot State
  chatMessages: ChatMessage[] = [
    { sender: 'user', text: 'What does a high heart rate mean?', time: '10:30 AM' },
    { sender: 'ai', text: 'A high heart rate (above 100 BPM at rest) could be due to stress, anxiety, dehydration, fever, or other medical conditions. If it persists, please consult a doctor.', time: '10:30 AM' }
  ];
  chatInput = '';
  isChatThinking = false;

  private readonly BACKEND_URL = window.location.hostname === 'localhost'
    ? 'http://localhost:3000/api'
    : 'https://safeband-backend-4q0a.onrender.com/api';

  constructor(
    private wsService: WebsocketService,
    private http: HttpClient
  ) {}

  ngOnInit(): void {
    // WebSocket connection
    this.wsService.connect();

    this.wsService.connected$.pipe(takeUntil(this.destroy$))
      .subscribe(c => this.connected = c);

    this.wsService.message$.pipe(takeUntil(this.destroy$))
      .subscribe(msg => this.handleWSMessage(msg));

    // Also fetch initial state from REST
    this.loadInitialData();
  }

  ngAfterViewInit(): void {
    setTimeout(() => this.initMap(), 500);
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.wsService.disconnect();
  }

  private loadInitialData(): void {
    this.http.get<any>(`${this.BACKEND_URL}/victims`).subscribe({
      next: (res) => { this.victims = res.victims || []; this.updateMapMarkers(); },
      error: () => console.warn('Cannot reach backend REST API')
    });

    this.http.get<any>(`${this.BACKEND_URL}/alerts`).subscribe({
      next: (res) => { this.alertHistory = res.alerts || []; },
      error: () => {}
    });
  }

  private handleWSMessage(msg: any): void {
    if (msg.type === 'INIT') {
      this.victims = msg.victims || [];
      this.alertHistory = msg.alertHistory || [];
      this.updateMapMarkers();
    } else if (msg.type === 'VICTIM_UPDATE') {
      const victim = msg.victim as VictimData;
      const idx = this.victims.findIndex(v => v.victimId === victim.victimId);
      if (idx >= 0) this.victims[idx] = victim;
      else this.victims.push(victim);

      // Update selected victim if it's this one
      if (this.selectedVictim?.victimId === victim.victimId) {
        this.selectedVictim = victim;
      }

      // Handle new alert
      if (msg.alert) {
        this.alertHistory.unshift(msg.alert);
        this.activeAlerts.unshift(msg.alert);
        this.showAlertBanner = true;
        setTimeout(() => { this.showAlertBanner = false; }, 8000);
      }

      this.updateMapMarker(victim);
    }
  }

  // ─── Leaflet Map ──────────────────────────────────────────────
  private initMap(): void {
    if (!this.mapContainer) return;

    // Default center: Bangalore
    this.map = L.map(this.mapContainer.nativeElement, {
      center: [12.9716, 77.5946],
      zoom: 13,
      zoomControl: true
    });

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '©OpenStreetMap ©CartoDB',
      maxZoom: 19
    }).addTo(this.map);

    this.updateMapMarkers();
  }

  private updateMapMarkers(): void {
    this.victims.forEach(v => this.updateMapMarker(v));
  }

  private updateMapMarker(victim: VictimData): void {
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

  // ─── Helpers ──────────────────────────────────────────────────
  selectVictim(victim: VictimData): void {
    this.selectedVictim = victim;
    if (this.map && victim.location) {
      this.map.flyTo([victim.location.lat, victim.location.lng], 15, { duration: 1 });
    }
  }

  openGoogleMaps(victim: VictimData): void {
    if (victim.location) {
      window.open(`https://maps.google.com/?q=${victim.location.lat},${victim.location.lng}`, '_blank');
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

  getAlertClass(level: string): string {
    switch (level) {
      case 'CRITICAL': return 'level-critical';
      case 'DANGER': return 'level-danger';
      case 'WARNING': return 'level-warning';
      default: return 'level-safe';
    }
  }

  get criticalCount(): number { return this.victims.filter(v => v.alertLevel === 'CRITICAL' || v.alertLevel === 'DANGER').length; }
  get safeCount(): number { return this.victims.filter(v => v.alertLevel === 'SAFE').length; }

  formatTime(iso: string): string {
    try { return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }); }
    catch { return iso; }
  }

  // ─── AI Chatbot & Vitals Helpers ──────────────────────────────
  getGyroReadings(v?: VictimData | null): { x: string; y: string; z: string } {
    const s = v?.shakeIntensity || 0.21;
    return {
      x: (s * 0.42).toFixed(2),
      y: (- (s * 0.35)).toFixed(2),
      z: (1.02 + s * 0.18).toFixed(2)
    };
  }

  sendChatQuestion(): void {
    if (!this.chatInput.trim() || this.isChatThinking) return;
    const userText = this.chatInput.trim();
    const timeStr = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
    
    this.chatMessages.push({ sender: 'user', text: userText, time: timeStr });
    this.chatInput = '';
    this.isChatThinking = true;

    setTimeout(() => {
      const aiResp = this.generateAiHealthResponse(userText);
      const aiTime = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
      this.chatMessages.push({ sender: 'ai', text: aiResp, time: aiTime });
      this.isChatThinking = false;
    }, 700);
  }

  generateAiHealthResponse(q: string): string {
    const query = q.toLowerCase();
    const v = this.selectedVictim || (this.victims.length > 0 ? this.victims[0] : null);
    const bpm = v?.heartRate || 72;
    const gyro = this.getGyroReadings(v);

    if (query.includes('heart') || query.includes('bpm') || query.includes('pulse')) {
      if (bpm > 100) {
        return `⚠️ The patient's heart rate is elevated at ${bpm} BPM (above normal resting 60-100 BPM). This could indicate acute stress, panic, dehydration, or strenuous exertion. Continuous real-time monitoring recommended.`;
      }
      return `❤️ The patient's heart rate is currently normal and stable at ${bpm} BPM. Standard resting heart rate is between 60 and 100 BPM.`;
    }
    if (query.includes('motion') || query.includes('gyro') || query.includes('shake')) {
      return `🧭 Gyroscope motion sensors track 3-axis acceleration (X: ${gyro.x}, Y: ${gyro.y}, Z: ${gyro.z}). Current accelerometer shake intensity is ${(v?.shakeIntensity || 0.2).toFixed(2)} m/s². Spikes indicate a fall or sudden struggle.`;
    }
    if (query.includes('audio') || query.includes('scream') || query.includes('noise')) {
      return `🎙️ Live audio monitoring checks ambient decibels (Level: ${v?.audioLevel || 12}/255). Scream detection is currently ${v?.screamDetected ? '🔴 TRIGGERED' : '✅ CLEAR'}.`;
    }
    if (query.includes('location') || query.includes('gps')) {
      const coords = v?.location ? `${v.location.lat.toFixed(4)}° N, ${v.location.lng.toFixed(4)}° E` : '17.4357° N, 78.4867° E';
      return `📍 Real-time GPS sync tracks the patient at ${coords} with continuous updates every 5 seconds.`;
    }
    if (query.includes('alert') || query.includes('emergency') || query.includes('sos')) {
      return `🚨 When an Emergency Alert fires, all 4 live vitals (Location, Gyroscope, Audio, Heart Rate) are immediately dispatched to the Guardian panel. If SOS button is pressed, contact emergency dispatchers at once.`;
    }
    return `🤖 Smart Health AI: All 4 live streams (GPS, Motion, Microphone, Heart Rate) are continually monitored via our secure risk engine. Ask me about heart rate, motion spikes, audio levels, or emergency protocol!`;
  }

  trackByVictim(_: number, v: VictimData) { return v.victimId; }
  trackByAlert(_: number, a: AlertMessage) { return a.id; }
}
