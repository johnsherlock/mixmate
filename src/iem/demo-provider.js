// Synthetic design data only. This module has no transport, persistence or live fallback.
export function createDemoProvider() {
  const names = ["GAV’S", "DARA’S", "JOHN’S", "CARL’S", "SPARE"];
  const mixColours = ["#6bcbd1", "#b6a2ef", "#e8bb69", "#7aaef0", "#e494a7"];
  const channels = [
    "KICK",
    "SNARE",
    "TOM 1",
    "TOM 2",
    "TOM 3",
    "TOM 4",
    "OH L",
    "OH R",
    "BASS",
    "BASS R",
    "CARL GUITAR",
    "JOHN GUITAR",
    "CARL VOX",
    "DARA VOX",
    "JOHN VOX",
    "AMBIENCE",
    "CH 17",
    "CH 18",
    "CH 19",
    "CH 20",
    "CH 21",
    "CH 22",
    "CH 23",
    "CH 24",
    "FX 1 REVERB",
    "FX 2 REVERB",
    "FX 3 DELAY",
    "FX 4 ROOM",
  ];
  const groupDefaults = [
    { name: "DRUMS", members: [0, 1, 2, 3, 4, 5, 6, 7] },
    { name: "GUITARS", members: [8, 10, 11] },
    { name: "VOCALS", members: [12, 13, 14] },
  ];
  const addresses = ["192.168.0.60", "192.168.1.60"];
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const initial = [
    -3, -7, -10, -12, -14, -14, -16, -16, -11, -11, -14, -9, -13, -8, -6, -22,
    -18, -20, -18, -18, -18, -18, -18, -18, -18, -18, -22, -20,
  ];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const smooth = (t) => {
    t = clamp(t, 0, 1);
    return t * t * (3 - 2 * t);
  };
  function newEQ() {
    return {
      mode: "points",
      curve: Array(161).fill(0),
      bands: [
        { x: 0.233, gain: 2, q: 1 },
        { x: 0.566, gain: -1.5, q: 1 },
        { x: 0.85, gain: 1, q: 1 },
      ],
      lowEnabled: true,
      lowHz: 35,
      highEnabled: true,
      highHz: 16000,
    };
  }
  function newMixes() {
    return names.map((name, i) => ({
      name,
      master: [-12, -10, -14, -11, -18][i],
      levels: initial.map((v, j) => v + (i - 2) * 1.5 + (j % 3 === 0 ? i : 0)),
      pans: channels.map(
        (_, i) =>
          ({
            6: -100,
            7: 100,
            8: -100,
            9: 100,
            10: -30,
            11: 30,
            12: -10,
            14: 10,
          })[i] || 0,
      ),
      offsets: [0, 0, 0],
      eq: newEQ(),
    }));
  }
  const desks = [0, 1].map(() => ({
    groups: clone(groupDefaults),
    mixes: newMixes(),
  }));

  return {
    names,
    mixColours,
    channels,
    groupDefaults,
    addresses,
    clone,
    clamp,
    smooth,
    newEQ,
    desks,
    meterLevels: (i) => [55 + ((i * 7) % 30), 52 + ((i * 9) % 29)],
  };
}
