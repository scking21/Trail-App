/* geo.test.js — Jest tests for the pure AR math. Run: npm test */
const Geo = require('./geo');

const close = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

describe('norm360 / angularDelta', () => {
  test('norm360 wraps into [0,360)', () => {
    expect(Geo.norm360(370)).toBeCloseTo(10);
    expect(Geo.norm360(-10)).toBeCloseTo(350);
    expect(Geo.norm360(0)).toBeCloseTo(0);
  });
  test('angularDelta is signed shortest path', () => {
    expect(Geo.angularDelta(350, 10)).toBeCloseTo(20);   // CW across the wrap
    expect(Geo.angularDelta(10, 350)).toBeCloseTo(-20);  // CCW across the wrap
    expect(Geo.angularDelta(0, 180)).toBeCloseTo(180);
    expect(Geo.angularDelta(90, 270)).toBeCloseTo(180);
  });
});

describe('bearing', () => {
  const here = { latitude: 0, longitude: 0 };
  test('cardinal directions from origin', () => {
    expect(close(Geo.bearing(here, { latitude: 1, longitude: 0 }), 0, 1e-3)).toBe(true);   // north
    expect(close(Geo.bearing(here, { latitude: 0, longitude: 1 }), 90, 1e-3)).toBe(true);  // east
    expect(close(Geo.bearing(here, { latitude: -1, longitude: 0 }), 180, 1e-3)).toBe(true);// south
    expect(close(Geo.bearing(here, { latitude: 0, longitude: -1 }), 270, 1e-3)).toBe(true);// west
  });
  test('returns value in [0,360)', () => {
    const b = Geo.bearing({ latitude: 37.0, longitude: -119.0 }, { latitude: 37.5, longitude: -119.5 });
    expect(b).toBeGreaterThanOrEqual(0);
    expect(b).toBeLessThan(360);
  });
});

describe('distance', () => {
  test('~111.2 km per degree of latitude', () => {
    const d = Geo.distance({ latitude: 0, longitude: 0 }, { latitude: 1, longitude: 0 });
    expect(d).toBeGreaterThan(110000);
    expect(d).toBeLessThan(112000);
  });
  test('zero distance for same point', () => {
    expect(Geo.distance({ latitude: 5, longitude: 5 }, { latitude: 5, longitude: 5 })).toBeCloseTo(0);
  });
  test('short hop is a few hundred meters', () => {
    const d = Geo.distance({ latitude: 37.7349, longitude: -119.5383 },
                           { latitude: 37.7352, longitude: -119.5380 });
    expect(d).toBeGreaterThan(20);
    expect(d).toBeLessThan(80);
  });
});

describe('smoothHeading', () => {
  test('first sample passes through', () => {
    expect(Geo.smoothHeading(null, 123, 0.2)).toBeCloseTo(123);
    expect(Geo.smoothHeading(NaN, 45, 0.2)).toBeCloseTo(45);
  });
  test('alpha=1 returns the new sample', () => {
    expect(Geo.smoothHeading(100, 200, 1)).toBeCloseTo(200);
  });
  test('alpha=0 holds the previous', () => {
    expect(Geo.smoothHeading(100, 200, 0)).toBeCloseTo(100);
  });
  test('smooths across the 0/360 wrap without flipping', () => {
    // halfway between 350 and 10 should be ~0, NOT ~180
    const h = Geo.smoothHeading(350, 10, 0.5);
    const d = Math.abs(Geo.angularDelta(0, h));
    expect(d).toBeLessThan(1);
  });
  test('result always in [0,360)', () => {
    const h = Geo.smoothHeading(355, 5, 0.3);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThan(360);
  });
});

describe('chooseHeading', () => {
  const base = { courseSpeedThreshold: 1.0 };
  test('uses GPS course when moving fast enough', () => {
    const r = Geo.chooseHeading({ ...base, course: 90, speed: 2.0, compass: 270 });
    expect(r.source).toBe('gps');
    expect(r.heading).toBeCloseTo(90);
  });
  test('uses compass when slow / standing still', () => {
    const r = Geo.chooseHeading({ ...base, course: 90, speed: 0.2, compass: 270 });
    expect(r.source).toBe('compass');
    expect(r.heading).toBeCloseTo(270);
  });
  test('falls back to compass when course invalid (Android -1)', () => {
    const r = Geo.chooseHeading({ ...base, course: -1, speed: 3, compass: 123 });
    expect(r.source).toBe('compass');
    expect(r.heading).toBeCloseTo(123);
  });
  test('uses course if compass missing even when slow', () => {
    const r = Geo.chooseHeading({ ...base, course: 80, speed: 0.1, compass: null });
    expect(r.source).toBe('gps');
    expect(r.heading).toBeCloseTo(80);
  });
});

describe('projectToScreen', () => {
  const W = 400, fov = 60;
  test('dead-center target lands at screen middle', () => {
    const p = Geo.projectToScreen({ bearingToTarget: 100, heading: 100, fovDeg: fov, width: W });
    expect(p.onScreen).toBe(true);
    expect(p.x).toBeCloseTo(200);
    expect(p.fraction).toBeCloseTo(0);
  });
  test('target at +half-FOV lands at right edge', () => {
    const p = Geo.projectToScreen({ bearingToTarget: 130, heading: 100, fovDeg: fov, width: W });
    expect(p.onScreen).toBe(true);
    expect(p.x).toBeCloseTo(400);
    expect(p.side).toBe('right');
  });
  test('target at -half-FOV lands at left edge', () => {
    const p = Geo.projectToScreen({ bearingToTarget: 70, heading: 100, fovDeg: fov, width: W });
    expect(p.x).toBeCloseTo(0);
    expect(p.side).toBe('left');
  });
  test('target beyond FOV is off-screen with a turn side', () => {
    const right = Geo.projectToScreen({ bearingToTarget: 170, heading: 100, fovDeg: fov, width: W });
    expect(right.onScreen).toBe(false);
    expect(right.side).toBe('right');
    const left = Geo.projectToScreen({ bearingToTarget: 30, heading: 100, fovDeg: fov, width: W });
    expect(left.onScreen).toBe(false);
    expect(left.side).toBe('left');
  });
  test('handles wrap: target north, facing slightly west of north', () => {
    const p = Geo.projectToScreen({ bearingToTarget: 5, heading: 350, fovDeg: fov, width: W });
    expect(p.onScreen).toBe(true);
    expect(p.relative).toBeCloseTo(15); // target is 15° to the right
  });
});
