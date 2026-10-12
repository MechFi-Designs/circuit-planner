/**
 * Typical household devices: max (nameplate-ish) and typical running watts.
 * Ballpark figures to get started; the nameplate always wins.
 */
export interface DevicePreset {
  name: string;
  maxW: number;
  estW: number;
  continuous?: boolean;
}

export const DEVICE_PRESETS: DevicePreset[] = [
  { name: 'Refrigerator', maxW: 700, estW: 150 },
  { name: 'Chest freezer', maxW: 500, estW: 100 },
  { name: 'Microwave', maxW: 1200, estW: 100 },
  { name: 'Toaster', maxW: 1100, estW: 40 },
  { name: 'Coffee maker', maxW: 1000, estW: 50 },
  { name: 'Electric kettle', maxW: 1500, estW: 50 },
  { name: 'Air fryer', maxW: 1700, estW: 100 },
  { name: 'Dishwasher', maxW: 1500, estW: 300 },
  { name: 'Garbage disposal', maxW: 900, estW: 20 },
  { name: 'Washing machine', maxW: 1200, estW: 300 },
  { name: 'Space heater', maxW: 1500, estW: 1500, continuous: true },
  { name: 'Window AC', maxW: 1200, estW: 800, continuous: true },
  { name: 'Dehumidifier', maxW: 600, estW: 400, continuous: true },
  { name: 'Hair dryer', maxW: 1800, estW: 50 },
  { name: 'Vacuum', maxW: 1200, estW: 30 },
  { name: 'TV', maxW: 150, estW: 80 },
  { name: 'Desktop computer', maxW: 400, estW: 150 },
  { name: 'Gaming PC', maxW: 650, estW: 250 },
  { name: 'Monitor', maxW: 40, estW: 30 },
  { name: 'Laptop charger', maxW: 90, estW: 40 },
  { name: 'Router / modem', maxW: 20, estW: 20, continuous: true },
  { name: 'Aquarium', maxW: 150, estW: 100, continuous: true },
  { name: 'LED light', maxW: 10, estW: 10 },
  { name: 'Ceiling fan', maxW: 75, estW: 40 },
  { name: 'Garage door opener', maxW: 600, estW: 10 },
  { name: 'Sump pump', maxW: 1050, estW: 100 },
  { name: 'Power tools', maxW: 1800, estW: 200 },
];

export const presetByName = (name: string) =>
  DEVICE_PRESETS.find((p) => p.name.toLowerCase() === name.trim().toLowerCase());
