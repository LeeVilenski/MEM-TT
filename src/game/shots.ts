import { TABLE, length, spinComponents, type Vec3 } from '../physics';

export interface ShotInfo {
  name: string;
  speed: number;
  /** Spin in rps relative to the outgoing direction. */
  top: number;
  side: number;
  cork: number;
  rpm: number;
  elevation: number;
}

/**
 * Name a shot from what actually happened at contact, so names emerge from
 * the physics rather than from buttons.
 */
export function classifyShot(contact: Vec3, velOut: Vec3, spinOut: Vec3, paddleVel: Vec3, velIn: Vec3, spinIn: Vec3): ShotInfo {
  const c = spinComponents(velOut, spinOut);
  const inc = spinComponents(velIn, spinIn);
  const speed = length(velOut);
  const rpm = (length(spinOut) / (2 * Math.PI)) * 60;
  const elevation = (Math.atan2(velOut.y, Math.hypot(velOut.x, velOut.z)) * 180) / Math.PI;
  const paddleSpeed = length(paddleVel);
  const overTable = contact.z < TABLE.halfLength + 0.05;
  const hooked = Math.abs(c.side) > 35 || Math.abs(c.cork) > 35;

  let name: string;
  if (paddleSpeed < 2.2) {
    name = c.top < -20 ? 'Chop block' : 'Block';
  } else if (elevation > 28 && speed > 7 && c.top > 15) {
    name = 'Lob';
  } else if (speed > 21 && Math.abs(c.top) < 70) {
    name = 'Smash';
  } else if (c.top < -20) {
    if (overTable && speed < 3) name = 'Drop shot';
    else if (speed < 7.5) name = overTable ? 'Push' : 'Long push';
    else name = 'Chop';
  } else if (c.top > 20) {
    if (overTable) name = hooked ? 'Banana flick' : 'Flick';
    else if (c.top > 80 && inc.top > 50) name = 'Counter-loop';
    else if (c.top > 80) name = speed > 17 ? 'Power loop' : speed < 11 ? 'Spin loop' : 'Loop';
    else name = 'Drive';
    if (hooked && !overTable) name = `Hook ${name.toLowerCase()}`;
  } else {
    name = hooked ? 'Sidespin hit' : 'Flat hit';
  }
  return { name, speed, top: c.top, side: c.side, cork: c.cork, rpm, elevation };
}
