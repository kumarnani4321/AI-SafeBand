import { Injectable, OnDestroy } from '@angular/core';
import { Subject } from 'rxjs';

export interface VictimData {
  victimId: string;
  name: string;
  phone?: string;
  guardianName?: string;
  guardianPhone?: string;
  location: { lat: number; lng: number } | null;
  heartRate: number;
  shakeIntensity: number;
  screamDetected: boolean;
  audioLevel: number;
  sosPressed: boolean;
  riskScore: number;
  alertLevel: string;
  riskReasons: string[];
  alertTriggered: boolean;
  lastSeen: string;
}

export interface AlertMessage {
  id: string;
  timestamp: string;
  to: string;
  text: string;
  sent: boolean;
  victimId: string;
}

export interface WSMessage {
  type: 'INIT' | 'VICTIM_UPDATE';
  victims?: VictimData[];
  alertHistory?: AlertMessage[];
  victim?: VictimData;
  alert?: AlertMessage | null;
}

@Injectable({ providedIn: 'root' })
export class WebsocketService implements OnDestroy {
  private ws?: WebSocket;
  private reconnectTimer?: any;
  private readonly WS_URL = 'wss://safeband-backend-4q0a.onrender.com';

  message$ = new Subject<WSMessage>();
  connected$ = new Subject<boolean>();

  connect(): void {
    this.disconnect();
    try {
      this.ws = new WebSocket(this.WS_URL);

      this.ws.onopen = () => {
        console.log('✅ Connected to SafeBand backend');
        this.connected$.next(true);
        clearTimeout(this.reconnectTimer);
      };

      this.ws.onmessage = (event) => {
        try {
          const data: WSMessage = JSON.parse(event.data);
          this.message$.next(data);
        } catch (e) {
          console.error('WS parse error:', e);
        }
      };

      this.ws.onclose = () => {
        this.connected$.next(false);
        console.warn('WebSocket disconnected, reconnecting in 3s...');
        this.reconnectTimer = setTimeout(() => this.connect(), 3000);
      };

      this.ws.onerror = (err) => {
        console.error('WebSocket error:', err);
        this.connected$.next(false);
      };
    } catch (err) {
      console.error('Cannot connect to WebSocket:', err);
      this.reconnectTimer = setTimeout(() => this.connect(), 5000);
    }
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = undefined;
    }
    clearTimeout(this.reconnectTimer);
  }

  ngOnDestroy(): void {
    this.disconnect();
  }
}
