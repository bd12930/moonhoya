/**
 * Nursery App Settings Types & Default Configurations
 */

export interface CategorySetting {
  id: string;
  label: string;
  icon: string;
  subtitle: string;
}

export interface CurrencySetting {
  code: string;
  symbol: string;
  name: string;
}

export interface PotSizeSetting {
  value: number;
  label: string;
}

export interface AppSettingsData {
  categories: CategorySetting[];
  currency: CurrencySetting;
  locations: string[];
  potSizes: PotSizeSetting[];
}

export const DEFAULT_CATEGORIES: CategorySetting[] = [
  { id: 'PLANT', label: 'Plant', icon: '🌿', subtitle: 'Hoyas & Greenhouse Flora' },
  { id: 'FERTILIZER', label: 'Fertilizer', icon: '🧪', subtitle: 'Nutrients & Soil Boosters' },
  { id: 'POT', label: 'Pot / Planter', icon: '🪴', subtitle: 'Nursery, Slotted, Hanging' },
  { id: 'EQUIPMENT', label: 'Equipment', icon: '🛠️', subtitle: 'Shears, Lights, Sprayers' },
  { id: 'HARDWARE', label: 'Hardware', icon: '🔩', subtitle: 'Trellises, Stakes, Perlite' },
];

export const DEFAULT_CURRENCY: CurrencySetting = {
  code: 'USD',
  symbol: '$',
  name: 'US Dollar',
};

export const COMMON_CURRENCIES: CurrencySetting[] = [
  { code: 'USD', symbol: '$', name: 'US Dollar ($)' },
  { code: 'EUR', symbol: '€', name: 'Euro (€)' },
  { code: 'GBP', symbol: '£', name: 'British Pound (£)' },
  { code: 'IDR', symbol: 'Rp', name: 'Indonesian Rupiah (Rp)' },
  { code: 'SGD', symbol: 'S$', name: 'Singapore Dollar (S$)' },
  { code: 'AUD', symbol: 'A$', name: 'Australian Dollar (A$)' },
  { code: 'CAD', symbol: 'CA$', name: 'Canadian Dollar (CA$)' },
  { code: 'JPY', symbol: '¥', name: 'Japanese Yen (¥)' },
  { code: 'THB', symbol: '฿', name: 'Thai Baht (฿)' },
  { code: 'MYR', symbol: 'RM', name: 'Malaysian Ringgit (RM)' },
  { code: 'PHP', symbol: '₱', name: 'Philippine Peso (₱)' },
];

export const DEFAULT_LOCATIONS: string[] = [
  'Shade House A',
  'Shade House B',
  'Greenhouse 1 (Hoyas)',
  'Greenhouse 2 (Aroids)',
  'Propagation Bench',
  'Fertilizer Shed',
  'Hardware Bay 3',
  'Retail Display',
];

export const DEFAULT_POT_SIZES: PotSizeSetting[] = [
  { value: 0, label: 'N/A' },
  { value: 2, label: '2" Plug' },
  { value: 3, label: '3" Small' },
  { value: 4, label: '4" Nursery' },
  { value: 5, label: '5" Medium' },
  { value: 6, label: '6" Standard' },
  { value: 8, label: '8" Hanging' },
  { value: 10, label: '10" Specimen' },
  { value: 12, label: '12" Extra Large' },
];

export const DEFAULT_SETTINGS: AppSettingsData = {
  categories: DEFAULT_CATEGORIES,
  currency: DEFAULT_CURRENCY,
  locations: DEFAULT_LOCATIONS,
  potSizes: DEFAULT_POT_SIZES,
};

/** Format price in cents with the given currency symbol */
export function formatPrice(priceCents: number, currency = DEFAULT_CURRENCY): string {
  const amount = (priceCents / 100).toFixed(2);
  // Currencies like IDR or JPY typically don't use decimal cents
  if (['IDR', 'JPY', 'KRW', 'VND'].includes(currency.code)) {
    return `${currency.symbol} ${(priceCents / 100).toLocaleString()}`;
  }
  return `${currency.symbol}${amount}`;
}
