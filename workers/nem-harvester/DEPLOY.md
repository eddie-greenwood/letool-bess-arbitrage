# NEM Harvester Deployment Guide

## Overview
This Cloudflare Worker continuously harvests AEMO/NEM price data:
- Backfills historical data from archive
- Updates live data every 2 minutes
- Stores in R2 with gzip compression
- Serves API for LeTool

## Setup Steps

### 1. Install Dependencies
```bash
cd workers/nem-harvester
npm install
```

### 2. Create Cloudflare Resources

```bash
# Create D1 database
npm run create-db
# Note the database_id returned and update wrangler.toml

# Initialize database schema
npm run init-db

# Create R2 bucket
npm run create-bucket

# Create Queue
npm run create-queue
```

### 3. Configure wrangler.toml

Update these values:
- `database_id`: From D1 creation
- `ADMIN_SECRET`: Generate a secure token

### 4. Deploy Worker

```bash
npm run deploy
```

### 5. Trigger Initial Backfill

```bash
# Backfill last 2 years
curl -X POST https://nem-harvester.<your-subdomain>.workers.dev/admin/backfill \
  -H "Authorization: Bearer YOUR_ADMIN_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"from": "2023-01-01", "to": "2025-08-09"}'
```

### 6. Update LeTool

Point LeTool's API calls to your worker:

```javascript
// In advanced-script.js, update the price API URL:
const API_BASE = 'https://nem-harvester.<your-subdomain>.workers.dev';

async function fetchDayData(dateStr, region) {
    const url = `${API_BASE}/api/day?region=${region}&date=${dateStr}`;
    // ... rest stays the same
}
```

## API Endpoints

### Public Endpoints

**Get Day Data**
```
GET /api/day?region=VIC1&date=2025-08-09
GET /api/price?region=VIC1&date=2025-08-09
```

Returns:
```json
{
  "success": true,
  "source": "r2",
  "data": [
    {
      "time": "00:00",
      "hour": 0,
      "minute": 0,
      "price": 45.67,
      "timestamp": "2025-08-09T00:00:00.000Z"
    },
    // ... 288 intervals
  ]
}
```

### Admin Endpoints

**Trigger Backfill**
```
POST /admin/backfill
Authorization: Bearer YOUR_ADMIN_SECRET
{
  "from": "2023-01-01",
  "to": "2023-12-31"
}
```

**System Status**
```
GET /admin/status
```

## Monitoring

View logs:
```bash
npm run tail
```

Check D1 database:
```bash
wrangler d1 execute nem-meta --command "SELECT * FROM day_index ORDER BY updated_at DESC LIMIT 10"
```

Check R2 storage:
```bash
wrangler r2 object list nem-data --prefix="nem/silver/day/VIC1/"
```

## Storage Structure

```
R2 Bucket: nem-data/
├── nem/
│   ├── raw/
│   │   └── dispatchis/
│   │       └── YYYY/MM/DD/
│   │           └── DISPATCHREGIONSUM_*.csv
│   └── silver/
│       ├── day/
│       │   └── REGION/
│       │       └── YYYY-MM-DD.json.gz
│       └── today/
│           └── REGION.json.gz
```

## Cost Estimates

- **R2 Storage**: ~5GB for 10 years = $0.075/month
- **R2 Operations**: ~1M reads/month = $0.36/month  
- **D1**: Free tier covers index
- **Workers**: Free tier covers cron + API
- **Total**: < $1/month

## Troubleshooting

### Backfill not working
- Check queue processing: `wrangler tail`
- Verify AEMO site is accessible
- Check D1 for job status

### Live updates delayed
- Check cron is running every 2 min
- Verify last_processed_file in system_state
- Check AEMO Current directory has new files

### API returning simulation
- Check R2 has data for requested date
- Verify day_index has entry
- Check timezone handling (should be AEST)

## Next Steps

After basic price data is working:

1. **Add FCAS prices**: Modify parser to handle DISPATCHPRICE files
2. **Add more regions**: Currently handles all 5 NEM regions
3. **Add analytics**: Track usage, missing data, etc.
4. **Add caching**: Use Cache API for frequently accessed days
5. **Add compression**: Already using gzip, consider parquet for long-term