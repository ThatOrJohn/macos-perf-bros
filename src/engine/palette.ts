/**
 * The game palette. One place to tweak the whole look.
 * Original "dusk arcade" palette: deep twilight skies, warm stone, saturated accents.
 */
export const P = {
  // sky
  skyTop: 0x141a33,
  skyBot: 0x3b4f86,
  star: 0xc9d4ff,
  cloud: 0xe6ecf5,
  cloudShade: 0xa7b4cc,

  // land
  grass: 0x5fa83a,
  grassLight: 0x86c94f,
  grassDark: 0x3d7a28,
  dirt: 0x8a5a3a,
  dirtDark: 0x5c3a24,
  path: 0xcfae72,
  pathDark: 0xa98850,
  hill: 0x2c4a3a,
  hillLight: 0x3c6450,

  // stone & metal
  stone: 0x8c8fa3,
  stoneLight: 0xb9bdcc,
  stoneDark: 0x5b5e72,
  stoneDeep: 0x3a3c4c,
  metal: 0x7d8796,
  metalLight: 0xaab3c0,
  wood: 0x9a6a3c,
  woodDark: 0x6b4526,

  // cores
  eBrick: 0x5b8fd6,
  eBrickLight: 0x8db6ee,
  eBrickDark: 0x37609e,
  pBrick: 0xe0703a,
  pBrickLight: 0xf4a26a,
  pBrickDark: 0xa04a22,

  // water / memory
  wired: 0x27407a,
  app: 0x2f7fd0,
  appLight: 0x5aa6ea,
  compressed: 0x6a5ad0,
  compressedLight: 0x8f82ea,
  cached: 0x7fc6e8,
  waterHi: 0xc8f0ff,
  glass: 0x9fb6c8,
  swap: 0x8a4fb0,
  swapLight: 0xb27ad4,

  // fire / power
  lava: 0xff5a1f,
  lavaHi: 0xffc23f,
  ember: 0xb3261e,
  smoke: 0x9aa0a8,
  smokeDark: 0x6e737c,
  glow: 0xfff1a8,

  // status
  ok: 0x58c46c,
  warn: 0xe8c547,
  crit: 0xe04848,

  // ui
  white: 0xf4f4f4,
  ink: 0x0d0f1a,
  dim: 0x8a90a8,
  hudBg: 0x0d0f1a,
  hudFg: 0xe9ecf5,
  accent: 0xffd23f,
  select: 0xffd23f,

  // player
  bodyTeal: 0x2ec4b6,
  bodyTealDark: 0x1a8a80,
  visor: 0x101018,
  eye: 0xb8fff6,
} as const;
