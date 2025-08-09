/**
 * CSV Parsers for AEMO data files
 */

export interface PriceRow {
  timestamp: string;
  region: string;
  price: number;
}

export interface FcasRow extends PriceRow {
  service: string;
}

/**
 * Parse DISPATCHREGIONSUM CSV
 * Contains regional price (RRP) data
 */
export function parseDispatchRegionSum(csv: string): PriceRow[] {
  const lines = csv.split(/\r?\n/).filter(Boolean);
  const rows: PriceRow[] = [];
  
  // Find header line
  let headerLine: string | undefined;
  let headerIndex = -1;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes('SETTLEMENTDATE') && line.includes('REGIONID') && line.includes('RRP')) {
      headerLine = line;
      headerIndex = i;
      break;
    }
  }
  
  if (!headerLine) {
    // Fallback to known column positions
    return parseWithFixedColumns(lines);
  }
  
  // Parse with dynamic column detection
  const headers = headerLine.replace(/^[DIC],/, '').split(',').map(h => h.trim());
  const dateIdx = headers.findIndex(h => /SETTLEMENTDATE/i.test(h));
  const regionIdx = headers.findIndex(h => /REGIONID/i.test(h));
  const rrpIdx = headers.findIndex(h => /^RRP$/i.test(h));
  
  if (dateIdx === -1 || regionIdx === -1 || rrpIdx === -1) {
    console.error('Could not find required columns in header');
    return parseWithFixedColumns(lines);
  }
  
  // Parse data rows
  for (let i = headerIndex + 1; i < lines.length; i++) {
    const line = lines[i];
    
    // Skip info/comment lines
    if (/^[IC],/.test(line)) continue;
    
    const cols = line.replace(/^D,/, '').split(',');
    
    if (cols.length > Math.max(dateIdx, regionIdx, rrpIdx)) {
      const settlementDate = cols[dateIdx]?.trim();
      const region = cols[regionIdx]?.trim().toUpperCase();
      const rrp = parseFloat(cols[rrpIdx]);
      
      if (settlementDate && region && !isNaN(rrp)) {
        rows.push({
          timestamp: parseAEMODate(settlementDate),
          region,
          price: rrp
        });
      }
    }
  }
  
  return rows;
}

/**
 * Parse DISPATCHPRICE CSV
 * Contains FCAS (ancillary services) price data
 */
export function parseDispatchPrice(csv: string): FcasRow[] {
  const lines = csv.split(/\r?\n/).filter(Boolean);
  const rows: FcasRow[] = [];
  
  // Service mappings
  const fcasServices = [
    'RAISE6SEC', 'LOWER6SEC',
    'RAISE60SEC', 'LOWER60SEC',
    'RAISE5MIN', 'LOWER5MIN',
    'RAISEREG', 'LOWERREG'
  ];
  
  // Find header
  let headerLine: string | undefined;
  let headerIndex = -1;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes('SETTLEMENTDATE') && line.includes('REGIONID')) {
      headerLine = line;
      headerIndex = i;
      break;
    }
  }
  
  if (!headerLine) return rows;
  
  const headers = headerLine.replace(/^[DIC],/, '').split(',').map(h => h.trim());
  const dateIdx = headers.findIndex(h => /SETTLEMENTDATE/i.test(h));
  const regionIdx = headers.findIndex(h => /REGIONID/i.test(h));
  
  // Find FCAS service columns
  const serviceIndices: Map<string, number> = new Map();
  for (const service of fcasServices) {
    const idx = headers.findIndex(h => h.includes(service));
    if (idx !== -1) {
      serviceIndices.set(service, idx);
    }
  }
  
  // Parse data rows
  for (let i = headerIndex + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^[IC],/.test(line)) continue;
    
    const cols = line.replace(/^D,/, '').split(',');
    
    if (cols.length > Math.max(dateIdx, regionIdx)) {
      const settlementDate = cols[dateIdx]?.trim();
      const region = cols[regionIdx]?.trim().toUpperCase();
      
      if (settlementDate && region) {
        const timestamp = parseAEMODate(settlementDate);
        
        // Extract each FCAS service price
        for (const [service, idx] of serviceIndices) {
          const price = parseFloat(cols[idx]);
          if (!isNaN(price)) {
            rows.push({
              timestamp,
              region,
              service,
              price
            });
          }
        }
      }
    }
  }
  
  return rows;
}

/**
 * Fallback parser using known column positions
 */
function parseWithFixedColumns(lines: string[]): PriceRow[] {
  const rows: PriceRow[] = [];
  
  // Known positions for common DISPATCHREGIONSUM format
  // D,DISPATCH,REGIONSUM,<runno>,<date>,<TI>,<region>,<flags...>,<values...>,RRP at position 11
  const DATE_IDX = 4;
  const REGION_IDX = 6;
  const RRP_IDX = 11;
  
  for (const line of lines) {
    if (/^[IC],/.test(line)) continue;
    
    const cols = line.split(',');
    
    if (cols.length > RRP_IDX && cols[0] === 'D') {
      const settlementDate = cols[DATE_IDX]?.trim();
      const region = cols[REGION_IDX]?.trim().toUpperCase();
      const rrp = parseFloat(cols[RRP_IDX]);
      
      if (settlementDate && region && !isNaN(rrp)) {
        rows.push({
          timestamp: parseAEMODate(settlementDate),
          region,
          price: rrp
        });
      }
    }
  }
  
  return rows;
}

/**
 * Convert AEMO date format to ISO timestamp
 * AEMO format: "YYYY/MM/DD HH:MM:SS" in NEM time (AEST, no DST)
 */
function parseAEMODate(dateStr: string): string {
  // Replace slashes with dashes and assume +10:00 (AEST)
  const normalized = dateStr.replace(/\//g, '-');
  
  // Parse as AEST (UTC+10)
  const localDate = new Date(normalized + '+10:00');
  
  // Return as ISO string in UTC
  return localDate.toISOString();
}