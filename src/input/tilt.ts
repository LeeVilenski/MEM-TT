/**
 * Optional phone tilt: tilting the phone away from you closes the paddle face,
 * tilting it toward you opens it. Calibrated to however you're holding the phone
 * when you switch it on (or tap "recalibrate").
 */

/**
 * Forward/back tilt (degrees) of the phone in the current screen orientation.
 * In portrait that's `beta`; in landscape the same physical motion shows up in
 * `gamma`, with a sign depending on which way the phone is turned.
 */
export function forwardTilt(beta: number, gamma: number, screenAngle: number): number {
  const a = ((screenAngle % 360) + 360) % 360;
  if (a === 90) return -gamma;
  if (a === 270) return gamma;
  if (a === 180) return -beta;
  return beta;
}

/** Face pitch from tilt relative to the calibration (positive = open). */
export function tiltToPitch(tilt: number, calibration: number, gain = 1.2, limit = 50): number {
  let d = tilt - calibration;
  // Wrap to [-180, 180] (gamma/beta jump at their range limits).
  d = ((((d + 180) % 360) + 360) % 360) - 180;
  return Math.max(-limit, Math.min(limit, -d * gain));
}

type PermissionApi = { requestPermission?: () => Promise<'granted' | 'denied'> };

export class TiltControl {
  active = false;
  pitch = 0;
  private calibration: number | null = null;
  private latest = 0;
  private handler = (e: DeviceOrientationEvent) => {
    if (e.beta == null || e.gamma == null) return;
    const angle = screen.orientation?.angle ?? (window as unknown as { orientation?: number }).orientation ?? 0;
    this.latest = forwardTilt(e.beta, e.gamma, angle);
    if (this.calibration === null) this.calibration = this.latest;
    this.pitch = tiltToPitch(this.latest, this.calibration);
  };

  /** Must be called from a user gesture (iOS asks for permission). Returns false if unavailable. */
  async enable(): Promise<boolean> {
    if (typeof DeviceOrientationEvent === 'undefined') return false;
    const api = DeviceOrientationEvent as unknown as PermissionApi;
    if (api.requestPermission) {
      try {
        if ((await api.requestPermission()) !== 'granted') return false;
      } catch {
        return false;
      }
    }
    this.calibration = null;
    window.addEventListener('deviceorientation', this.handler);
    this.active = true;
    return true;
  }

  disable() {
    window.removeEventListener('deviceorientation', this.handler);
    this.active = false;
    this.pitch = 0;
  }

  recalibrate() {
    this.calibration = this.latest;
    this.pitch = 0;
  }
}
