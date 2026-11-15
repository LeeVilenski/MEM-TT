import { describe, expect, it } from 'vitest';
import { SPIN_PALETTES, setSpinPalette, spinColor, spinKind } from '../src/render/ballView';
import * as THREE from 'three';
import { spinVector, v3 } from '../src/physics';

const vel = v3(0, 0, 10);
const ball = (top: number, side = 0, cork = 0) => spinVector({ x: 0, y: 0, z: 1 }, { top, side, cork });

describe('spin colours', () => {
  it('classifies the predominant spin', () => {
    expect(spinKind(vel, ball(100)).kind).toBe('top');
    expect(spinKind(vel, ball(-80)).kind).toBe('back');
    expect(spinKind(vel, ball(20, 60)).kind).toBe('side');
    expect(spinKind(vel, ball(10, 0, 70)).kind).toBe('side'); // corkscrew counts as sidespin
    expect(spinKind(vel, ball(90, 60)).kind).toBe('top'); // a hook loop is still mostly topspin
    expect(spinKind(vel, ball(3)).kind).toBe('none');
  });

  it('uses red / green / yellow, or the colour-blind palette', () => {
    const hex = (top: number, side = 0) => '#' + spinColor(vel, ball(top, side), new THREE.Color()).getHexString();
    setSpinPalette('standard');
    expect(hex(120)).toBe(SPIN_PALETTES.standard.top);
    expect(hex(-120)).toBe(SPIN_PALETTES.standard.back);
    expect(hex(0, 120)).toBe(SPIN_PALETTES.standard.side);
    setSpinPalette('colourblind');
    expect(hex(120)).toBe(SPIN_PALETTES.colourblind.top);
    expect(hex(-120)).toBe(SPIN_PALETTES.colourblind.back);
    setSpinPalette('standard');
  });
});
