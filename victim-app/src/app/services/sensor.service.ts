import { Injectable, NgZone } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { BehaviorSubject, interval, Subscription } from 'rxjs';
import { v4 as uuidv4 } from 'uuid';

export interface SensorData {
  victimId: string;
  name: string;
  phone: string;
  
  guardianName: string;
  guardianPhone: string;
  location: { lat: number; lng: number } | null;
  shakeIntensity: number;
  screamDetected: boolean;
  audioLevel: number;
  heartRate: number;
  sosPressed: boolean;
  timestamp: string;
}

export interface RiskResponse {
  success: boolean;
  riskScore: number;
  alertLevel: 'SAFE' | 'WARNING' | 'DANGER' | 'CRITICAL';
  alertTriggered: boolean;
  reasons: string[];
  alertFired: boolean;
}

@Injectable({ providedIn: 'root' })
export class SensorService {
  private readonly BACKEND_URL = window.location.hostname === 'localhost'
    ? 'http://localhost:3000/api'
    : 'https://safeband-backend-4q0a.onrender.com/api';
  private readonly victimId = localStorage.getItem('victimId') || (() => {
    const id = uuidv4();
    localStorage.setItem('victimId', id);
    return id;
  })();

  // Registration details
  private victimName = '';
  private victimPhone = '';
  private guardianName = '';
  private guardianPhone = '';

  // ── Heart Rate status ──────────────────────────────────────────────────────
  // rPPG via camera is EXPERIMENTAL. Requires mobile + torch + finger on lens.
  heartRateStatus$ = new BehaviorSubject<'idle' | 'measuring' | 'ok' | 'noSignal'>('idle');

  // State subjects
  riskScore$       = new BehaviorSubject<number>(0);
  alertLevel$      = new BehaviorSubject<string>('SAFE');
  alertTriggered$  = new BehaviorSubject<boolean>(false);
  reasons$         = new BehaviorSubject<string[]>([]);
  location$        = new BehaviorSubject<{ lat: number; lng: number } | null>(null);
  heartRate$       = new BehaviorSubject<number>(0);
  shakeIntensity$  = new BehaviorSubject<number>(0);
  screamDetected$  = new BehaviorSubject<boolean>(false);
  audioLevel$      = new BehaviorSubject<number>(0);   // 0–100 RMS percent
  sosPressed$      = new BehaviorSubject<boolean>(false);
  isMonitoring$    = new BehaviorSubject<boolean>(false);
  permissionsGranted$ = new BehaviorSubject<boolean>(false);
  backendConnected$   = new BehaviorSubject<boolean>(false);
  cameraActive$    = new BehaviorSubject<boolean>(false);

  private sendInterval?: Subscription;
  private locationWatchId?: number;
  private audioContext?: AudioContext;
  private audioStream?: MediaStream;
  private cameraStream?: MediaStream;
  private videoElement?: HTMLVideoElement;
  private canvasElement?: HTMLCanvasElement;
  private motionListener?: (event: DeviceMotionEvent) => void;
  private heartRateInterval?: any;

  // Shake: track gravity baseline via exponential moving average
  private gravityX = 0;
  private gravityY = 0;
  private gravityZ = 9.8;
  private readonly GRAVITY_ALPHA = 0.85; // smoothing factor

  // Edge-detect: track previous sensor states to fire immediate send on threshold cross
  private prevScreamDetected = false;
  private prevShakeHigh = false;
  // Debounce: prevent spamming sendSensorData on every frame
  private lastImmediateSend = 0;
  private readonly IMMEDIATE_SEND_DEBOUNCE_MS = 1500;

  // rPPG ring buffer
  private rppgValues: number[] = [];
  private rppgFrameCount = 0;
  private readonly RPPG_FPS = 30;
  private readonly RPPG_WINDOW_SEC = 6;  // collect 6 seconds before calculating

  private currentSensorData: Partial<SensorData> = {
    victimId: this.victimId,
    sosPressed: false,
    shakeIntensity: 0,
    screamDetected: false,
    audioLevel: 0,
    heartRate: 0
  };

  constructor(private http: HttpClient, private ngZone: NgZone) {}

  get victimIdValue() { return this.victimId; }

  // ─── Start All Monitoring ──────────────────────────────────────────────────
  async startMonitoring(
    victimName: string,
    victimPhone: string,
    guardianName: string,
    guardianPhone: string
  ): Promise<boolean> {
    try {
      this.victimName   = victimName;
      this.victimPhone  = victimPhone;
      this.guardianName = guardianName;
      this.guardianPhone = guardianPhone;

      await this.requestPermissions();
      this.startLocationTracking();
      await this.startAccelerometerDetection();

      this.isMonitoring$.next(true);

      // Start decibel analyzer
      await this.startMicrophoneDetection();
      this.startDataTransmission();
      return true;
    } catch (err) {
      console.error('Failed to start monitoring:', err);
      return false;
    }
  }

  stopMonitoring(): void {
    this.sendInterval?.unsubscribe();
    if (this.locationWatchId) navigator.geolocation.clearWatch(this.locationWatchId);
    if (this.motionListener) window.removeEventListener('devicemotion', this.motionListener);
    if (this.audioStream) this.audioStream.getTracks().forEach(t => t.stop());
    if (this.cameraStream) this.cameraStream.getTracks().forEach(t => t.stop());
    if (this.audioContext) this.audioContext.close();
    clearInterval(this.heartRateInterval);
    this.isMonitoring$.next(false);
    this.cameraActive$.next(false);
    this.heartRateStatus$.next('idle');
  }

  // ─── Permissions ───────────────────────────────────────────────────────────
  private async requestPermissions(): Promise<void> {
    // Grab mic stream for the decibel/RMS analyzer on all platforms
    const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.audioStream = micStream;
    this.permissionsGranted$.next(true);
  }

  // ─── Location Tracking ──────────────────────────────────────────────────
  private startLocationTracking(): void {
    if (!navigator.geolocation) return;
    const options = { enableHighAccuracy: true, timeout: 10000, maximumAge: 5000 };
    this.locationWatchId = navigator.geolocation.watchPosition(
      (pos) => {
        const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        this.location$.next(loc);
        this.currentSensorData['location'] = loc;
      },
      (err) => console.warn('GPS error:', err.message),
      options
    );
    // Fallback demo location after 3s if GPS not available
    setTimeout(() => {
      if (!this.location$.value) {
        const demoLoc = {
          lat: 17.3850 + (Math.random() - 0.5) * 0.01,
          lng: 78.4867 + (Math.random() - 0.5) * 0.01
        };
        this.location$.next(demoLoc);
        this.currentSensorData['location'] = demoLoc;
      }
    }, 3000);
  }



  // ─── Microphone Scream Detection (RMS-based) ────────────────────────────
  // HOW IT WORKS:
  // 1. We get raw PCM time-domain samples from the microphone using Web Audio API
  // 2. We compute RMS (Root Mean Square) = sqrt(mean of squared samples)
  //    This gives a true loudness value from 0.0 to 1.0
  // 3. We convert RMS to a 0–100 percentage for display
  // 4. Threshold: RMS > 0.15 (15%) = scream/clap/loud noise detected
  //    Normal speech: ~3–8%, clap: ~15–30%, scream: ~30–80%
  private async startMicrophoneDetection(): Promise<void> {
    try {
      const stream = this.audioStream || await navigator.mediaDevices.getUserMedia({ audio: true });
      this.audioStream = stream;
      this.audioContext = new AudioContext();

      // ── CRITICAL: resume AudioContext (browsers auto-suspend it) ──────
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }

      const source  = this.audioContext.createMediaStreamSource(stream);
      const analyser = this.audioContext.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.2;  // faster response
      source.connect(analyser);

      const timeDomainBuffer = new Float32Array(analyser.fftSize);

      const checkAudio = () => {
        // Resume AudioContext if it got suspended again (e.g. tab switch)
        if (this.audioContext?.state === 'suspended') {
          this.audioContext.resume();
        }

        // ── RMS calculation (true loudness) ──────────────────────────────
        analyser.getFloatTimeDomainData(timeDomainBuffer);
        let sumSquares = 0;
        for (let i = 0; i < timeDomainBuffer.length; i++) {
          sumSquares += timeDomainBuffer[i] * timeDomainBuffer[i];
        }
        const rms = Math.sqrt(sumSquares / timeDomainBuffer.length);
        
        // Convert RMS to estimated dB SPL (ranging from ~30 dB to 100 dB)
        const dbValue = Math.round(30 + Math.sqrt(rms) * 70);
        const finalDb = Math.min(100, dbValue);

        // Threshold: 70 dB = calibrated for loud scream or shout (70–80 dB)
        const SCREAM_THRESHOLD = 70;
        const isScream = finalDb >= SCREAM_THRESHOLD;

        this.ngZone.run(() => {
          this.audioLevel$.next(finalDb);
          this.screamDetected$.next(isScream);
          this.currentSensorData['audioLevel'] = finalDb;
          this.currentSensorData['screamDetected'] = isScream;

          // ── IMMEDIATE risk update on threshold crossing ────────────────
          if (isScream && !this.prevScreamDetected) {
            console.log(`[Mic] Scream detected! level=${finalDb} dB`);
            this.calculateLocalRisk();
            this.triggerImmediateSend();
          } else if (!isScream && this.prevScreamDetected) {
            this.calculateLocalRisk();
          }
          this.prevScreamDetected = isScream;
        });

        if (this.isMonitoring$.value) requestAnimationFrame(checkAudio);
      };

      requestAnimationFrame(checkAudio);
    } catch (err) {
      console.warn('Microphone error:', err);
    }
  }

  // ─── Accelerometer Shake Detection (with mobile permission) ──────────────
  // HOW IT WORKS:
  // 1. DeviceMotionEvent gives raw accelerometer readings (x, y, z) in m/s²
  //    INCLUDING gravity (~9.8 m/s² pointing down)
  // 2. We filter out gravity using an exponential moving average (EMA)
  //    This gives us only the LINEAR acceleration (actual motion)
  // 3. We compute magnitude = sqrt(x²+y²+z²) of the linear acceleration
  // 4. Threshold: magnitude > 5 m/s² = violent shake (+40 pts)
  //              magnitude > 2.5 m/s² = moderate shake (+20 pts)
  // ON DESKTOP: DeviceMotionEvent is not available → we show "0.0" which is correct
  //             Use the "Simulate Shake" button in Demo Controls for testing
  // ON MOBILE (Chrome Android 116+): requires permission prompt first
  private async startAccelerometerDetection(): Promise<void> {
    if (!('DeviceMotionEvent' in window)) {
      console.warn('DeviceMotionEvent not supported on this device (desktop browser). Use Simulate Shake button for testing.');
      // Keep showing 0.0 — this is accurate, not an error
      return;
    }

    // ── Request permission on iOS 13+ / newer Android ─────────────────
    // @ts-ignore — requestPermission exists on iOS Safari
    if (typeof (DeviceMotionEvent as any).requestPermission === 'function') {
      try {
        // @ts-ignore
        const perm = await (DeviceMotionEvent as any).requestPermission();
        if (perm !== 'granted') {
          console.warn('Motion permission denied. Use Simulate Shake button.');
          return;
        }
      } catch (e) {
        console.warn('Motion permission request failed:', e);
        return;
      }
    }

    this.motionListener = (event: DeviceMotionEvent) => {
      const acc = event.accelerationIncludingGravity;
      if (!acc || (acc.x === null && acc.y === null && acc.z === null)) return;

      const ax = acc.x ?? 0;
      const ay = acc.y ?? 0;
      const az = acc.z ?? 0;

      // ── Exponential moving average to isolate gravity ─────────────────
      this.gravityX = this.GRAVITY_ALPHA * this.gravityX + (1 - this.GRAVITY_ALPHA) * ax;
      this.gravityY = this.GRAVITY_ALPHA * this.gravityY + (1 - this.GRAVITY_ALPHA) * ay;
      this.gravityZ = this.GRAVITY_ALPHA * this.gravityZ + (1 - this.GRAVITY_ALPHA) * az;

      // Linear acceleration = raw - gravity
      const linX = ax - this.gravityX;
      const linY = ay - this.gravityY;
      const linZ = az - this.gravityZ;

      const magnitude = Math.sqrt(linX * linX + linY * linY + linZ * linZ);
      const shakeVal  = Math.round(magnitude * 10) / 10;

      this.ngZone.run(() => {
        this.shakeIntensity$.next(shakeVal);
        this.currentSensorData['shakeIntensity'] = shakeVal;

        // ── IMMEDIATE risk update when shake threshold is crossed ─────────
        const isShakeHigh = shakeVal > 2.5; // moderate or violent shake
        if (isShakeHigh && !this.prevShakeHigh) {
          console.log(`[Shake] Threshold crossed! magnitude=${shakeVal}`);
          this.calculateLocalRisk();
          this.triggerImmediateSend();
        } else if (!isShakeHigh && this.prevShakeHigh) {
          this.calculateLocalRisk();
        }
        this.prevShakeHigh = isShakeHigh;
      });
    };

    window.addEventListener('devicemotion', this.motionListener, { passive: true });
    console.log('✅ Accelerometer listener active — shake your phone!');
  }

  // ─── Camera Heart Rate (rPPG — EXPERIMENTAL) ────────────────────────────
  // HOW IT WORKS:
  // 1. User places finger over rear camera lens (blocks external light)
  // 2. Blood vessels under skin absorb/reflect different amounts of light
  //    as the heart beats → causes tiny rhythmic changes in red channel brightness
  // 3. We sample the average RED channel from each frame
  // 4. We detect peaks in the smoothed red-channel signal → count peaks per second
  // 5. peaks/second × 60 = BPM
  //
  // LIMITATIONS (why it shows wrong values like 55 BPM with no finger):
  // - Without a finger, any ambient light changes create false peaks
  // - No torch/flashlight → very dark/noisy signal
  // - Simple peak detection is fooled by noise
  // - Works best ONLY on mobile with: finger on lens + torch ON + still hands
  //
  // RECOMMENDATION: Use the BPM Override slider in Demo Controls for presentations
  async startCameraHeartRate(): Promise<boolean> {
    try {
      // Request video — prefer rear camera with torch if available
      const constraints: MediaStreamConstraints = {
        video: {
          facingMode: 'environment',
          width: { ideal: 320 },
          height: { ideal: 240 }
        }
      };
      this.cameraStream = await navigator.mediaDevices.getUserMedia(constraints);

      // ── Try to enable torch/flashlight ────────────────────────────────
      const videoTrack = this.cameraStream.getVideoTracks()[0];
      const capabilities = videoTrack.getCapabilities() as any;
      if (capabilities.torch) {
        await (videoTrack.applyConstraints as any)({ advanced: [{ torch: true }] });
        console.log('🔦 Torch enabled for rPPG');
      } else {
        console.warn('⚠️ Torch not available. rPPG accuracy will be reduced. Use BPM Override for demos.');
      }

      this.videoElement = document.createElement('video');
      this.videoElement.srcObject = this.cameraStream;
      this.videoElement.setAttribute('playsinline', 'true');
      this.videoElement.muted = true;
      await this.videoElement.play();

      this.canvasElement = document.createElement('canvas');
      this.canvasElement.width  = 64;   // smaller canvas = faster processing
      this.canvasElement.height = 48;

      // Reset state
      this.rppgValues = [];
      this.rppgFrameCount = 0;
      this.heartRateStatus$.next('measuring');
      this.cameraActive$.next(true);

      this.processRPPG();
      return true;
    } catch (err) {
      console.warn('Camera error:', err);
      return false;
    }
  }

  // rPPG signal processing
  private processRPPG(): void {
    const canvas = this.canvasElement!;
    const ctx    = canvas.getContext('2d', { willReadFrequently: true })!;

    this.heartRateInterval = setInterval(() => {
      if (!this.videoElement || !this.cameraStream) return;
      if (this.videoElement.readyState < 2) return; // not ready yet

      // Draw current video frame to small canvas
      ctx.drawImage(this.videoElement, 0, 0, canvas.width, canvas.height);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;

      // ── Sample RED channel only (most sensitive to blood flow) ────────
      let redSum = 0;
      const pixelCount = data.length / 4;
      for (let i = 0; i < data.length; i += 4) {
        redSum += data[i]; // R component
      }
      const avgRed = redSum / pixelCount;

      // ── Check if finger is on lens (very bright red, ~200+) ──────────
      const fingerDetected = avgRed > 100; // dark without finger, bright red with

      this.rppgValues.push(avgRed);
      this.rppgFrameCount++;

      // Keep rolling window of RPPG_WINDOW_SEC seconds
      const maxSamples = this.RPPG_FPS * this.RPPG_WINDOW_SEC;
      if (this.rppgValues.length > maxSamples) {
        this.rppgValues.shift();
      }

      // ── Calculate BPM every 3 seconds (after initial collection) ─────
      if (this.rppgFrameCount % (this.RPPG_FPS * 3) === 0 && this.rppgValues.length > this.RPPG_FPS * 3) {
        if (!fingerDetected) {
          this.heartRateStatus$.next('noSignal');
          console.log('👆 Place finger firmly on camera lens');
          return;
        }

        const bpm = this.calculateBPM(this.rppgValues, this.RPPG_FPS);
        console.log(`[rPPG] Raw BPM calculation: ${bpm}, avgRed: ${avgRed.toFixed(1)}`);

        // Accept only physiologically plausible BPM (50–180)
        if (bpm >= 50 && bpm <= 180) {
          this.heartRate$.next(bpm);
          this.currentSensorData['heartRate'] = bpm;
          this.heartRateStatus$.next('ok');
        } else {
          this.heartRateStatus$.next('noSignal');
        }
      }
    }, Math.round(1000 / this.RPPG_FPS));
  }

  private calculateBPM(signal: number[], fps: number): number {
    // Step 1: Detrend — remove slow drift by subtracting the moving average
    const trend = this.movingAverage(signal, fps); // 1-second trend window
    const detrended = signal.map((v, i) => v - trend[i]);

    // Step 2: Bandpass-like filter — only keep peaks in 0.7–3.5 Hz (42–210 BPM)
    // Achieved by using a larger moving average to smooth then counting peaks
    const smoothed = this.movingAverage(detrended, 4);

    // Step 3: Count peaks
    let peaks = 0;
    for (let i = 2; i < smoothed.length - 2; i++) {
      const isLocalMax =
        smoothed[i] > smoothed[i - 1] &&
        smoothed[i] > smoothed[i - 2] &&
        smoothed[i] > smoothed[i + 1] &&
        smoothed[i] > smoothed[i + 2];
      // Only count significant peaks (above 10% of signal range)
      const range = Math.max(...smoothed) - Math.min(...smoothed);
      if (isLocalMax && smoothed[i] > Math.min(...smoothed) + range * 0.1) {
        peaks++;
      }
    }

    const durationSec = signal.length / fps;
    const bpm = Math.round((peaks / durationSec) * 60);
    return bpm;
  }

  private movingAverage(arr: number[], window: number): number[] {
    return arr.map((_, i) => {
      const start = Math.max(0, i - window + 1);
      const slice = arr.slice(start, i + 1);
      return slice.reduce((a, b) => a + b, 0) / slice.length;
    });
  }

  stopCameraHeartRate(): void {
    if (this.cameraStream) {
      this.cameraStream.getTracks().forEach(t => t.stop());
      this.cameraStream = undefined;
    }
    clearInterval(this.heartRateInterval);
    this.cameraActive$.next(false);
    this.heartRateStatus$.next('idle');
    this.heartRate$.next(0);
    this.rppgValues = [];
  }

  // ─── SOS Button ──────────────────────────────────────────────────────────
  triggerSOS(): void {
    this.sosPressed$.next(true);
    this.currentSensorData['sosPressed'] = true;
    this.triggerImmediateSend();
    setTimeout(() => {
      this.sosPressed$.next(false);
      this.currentSensorData['sosPressed'] = false;
      this.triggerImmediateSend();
    }, 10000);
  }

  // ─── Data Transmission (every 2 seconds) ────────────────────────────────
  private startDataTransmission(): void {
    // Reduced from 5s → 2s so the risk score updates more frequently
    this.sendInterval = interval(2000).subscribe(() => this.sendSensorData());
    this.sendSensorData(); // immediate first send
  }

  // ─── Immediate send on threshold cross (debounced) ────────────────────────
  // Prevents spamming the backend on every audio frame
  private triggerImmediateSend(): void {
    const now = Date.now();
    if (now - this.lastImmediateSend > this.IMMEDIATE_SEND_DEBOUNCE_MS) {
      this.lastImmediateSend = now;
      this.sendSensorData();
    }
  }

  sendSensorData(): void {
    const hrVal = this.heartRate$.value;

    const payload: SensorData = {
      victimId:      this.victimId,
      name:          this.victimName,
      phone:         this.victimPhone,
      guardianName:  this.guardianName,
      guardianPhone: this.guardianPhone,
      location:      this.location$.value,
      shakeIntensity: this.shakeIntensity$.value,
      screamDetected: this.screamDetected$.value,
      audioLevel:    this.audioLevel$.value,
      heartRate:     hrVal,
      sosPressed:    this.sosPressed$.value,
      timestamp:     new Date().toISOString()
    };

    const headers = new HttpHeaders().set('Bypass-Tunnel-Reminder', 'true');
    this.http.post<RiskResponse>(`${this.BACKEND_URL}/sensor`, payload, { headers }).subscribe({
      next: (res) => {
        this.riskScore$.next(res.riskScore);
        this.alertLevel$.next(res.alertLevel);
        this.alertTriggered$.next(res.alertTriggered);
        this.reasons$.next(res.reasons);
        this.backendConnected$.next(true);
      },
      error: () => {
        console.warn('Backend unavailable — running local risk engine');
        this.backendConnected$.next(false);
        this.calculateLocalRisk();
      }
    });
  }

  // ─── Local Risk Engine (offline fallback) ────────────────────────────────
  private calculateLocalRisk(): void {
    let score = 0;
    if (this.sosPressed$.value) score += 95;
    if (this.shakeIntensity$.value > 5)   score += 40;
    else if (this.shakeIntensity$.value > 2.5) score += 20;
    if (this.screamDetected$.value) score += 35;
    const bpm = this.heartRate$.value;
    if (bpm > 140) score += 25;
    else if (bpm > 120) score += 15;

    score = Math.min(score, 100);
    this.riskScore$.next(score);
    this.alertLevel$.next(
      score >= 95 ? 'CRITICAL' :
      score >= 70 ? 'DANGER' :
      score >= 40 ? 'WARNING' : 'SAFE'
    );
    this.alertTriggered$.next(score >= 70);
  }
}
