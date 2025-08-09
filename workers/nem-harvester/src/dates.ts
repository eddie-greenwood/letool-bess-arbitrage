/**
 * Date utilities for NEM time handling
 * NEM operates in AEST (UTC+10) with no daylight saving
 */

/**
 * Get local date string in AEST
 */
export function localDateAEST(date: Date): string {
  // Convert to AEST (UTC+10)
  const aestDate = new Date(date.getTime() + (10 * 60 * 60 * 1000));
  return aestDate.toISOString().slice(0, 10);
}

/**
 * Convert AEMO local time string to UTC ISO
 */
export function localToUTCISO(localStr: string): string {
  // Input format: "YYYY/MM/DD HH:MM:SS" in AEST
  const normalized = localStr.replace(/\//g, '-');
  const date = new Date(normalized + '+10:00');
  return date.toISOString();
}

/**
 * Check if a UTC timestamp is "today" in AEST
 */
export function isTodayAEST(isoUTC: string): boolean {
  const date = new Date(isoUTC);
  const today = localDateAEST(new Date());
  const dateAEST = localDateAEST(date);
  return dateAEST === today;
}

/**
 * Check if a UTC timestamp matches a specific AEST date
 */
export function sameLocalDate(isoUTC: string, dateStr: string): boolean {
  const date = new Date(isoUTC);
  const dateAEST = localDateAEST(date);
  return dateAEST === dateStr;
}

/**
 * Expand a date range into individual dates
 */
export function expandDateRange(from: string, to: string): string[] {
  const dates: string[] = [];
  const current = new Date(from);
  const end = new Date(to);
  
  while (current <= end) {
    dates.push(current.toISOString().slice(0, 10));
    current.setDate(current.getDate() + 1);
  }
  
  return dates;
}

/**
 * Generate 288 5-minute slots for a day in AEST
 */
export function daySlotsAEST(date: Date): Array<{
  utcISO: string;
  hour: number;
  minute: number;
}> {
  const slots: Array<{ utcISO: string; hour: number; minute: number }> = [];
  const dateStr = localDateAEST(date);
  
  // Start at midnight AEST
  const startAEST = new Date(dateStr + 'T00:00:00+10:00');
  
  for (let i = 0; i < 288; i++) {
    const slotTime = new Date(startAEST.getTime() + (i * 5 * 60 * 1000));
    const hour = Math.floor(i * 5 / 60);
    const minute = (i * 5) % 60;
    
    slots.push({
      utcISO: slotTime.toISOString(),
      hour,
      minute
    });
  }
  
  return slots;
}

/**
 * Get the previous trading day (skips weekends for some analyses)
 */
export function previousTradingDay(date: Date, skipWeekends: boolean = false): Date {
  const prev = new Date(date);
  prev.setDate(prev.getDate() - 1);
  
  if (skipWeekends) {
    while (prev.getDay() === 0 || prev.getDay() === 6) {
      prev.setDate(prev.getDate() - 1);
    }
  }
  
  return prev;
}

/**
 * Format a date for display in AEST
 */
export function formatAEST(date: Date): string {
  const aestDate = new Date(date.getTime() + (10 * 60 * 60 * 1000));
  return aestDate.toISOString().replace('T', ' ').slice(0, 19) + ' AEST';
}