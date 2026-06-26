import { Component, OnInit, OnDestroy, AfterViewInit, ElementRef, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClientModule, HttpClient } from '@angular/common/http';
import { Subject, takeUntil } from 'rxjs';
import { WebsocketService, VictimData, AlertMessage } from './services/websocket.service';

declare const L: any; // Leaflet

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, HttpClientModule],
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

  private readonly BACKEND_URL = 'https://safeband-backend-4q0a.onrender.com/api';

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

  trackByVictim(_: number, v: VictimData) { return v.victimId; }
  trackByAlert(_: number, a: AlertMessage) { return a.id; }
}
