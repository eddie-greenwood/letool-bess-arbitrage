# Lé Tool - BESS Arbitrage Optimizer

## Overview

Lé Tool is a sophisticated Battery Energy Storage System (BESS) arbitrage optimization platform designed for the Australian National Electricity Market (NEM). It provides real-time analysis and optimization of battery operations to maximize revenue from energy trading.

**Live Application**: [letool.io](https://letool.io)

## Features

### 🔋 Core Functionality
- **Real-time NEM price data** from AEMO NEMWeb
- **Dual optimization algorithms**: Dynamic Programming (DP) and Heuristic
- **Multi-day analysis** with comprehensive revenue tracking
- **Network tariff integration** supporting AusNet BESS trial tariffs
- **Visual analytics** with interactive charts and metrics

### 📊 Optimization Algorithms
- **Dynamic Programming (DP)**: Global optimal solution using value function approach
- **Heuristic Optimizer**: Fast greedy algorithm for quick analysis
- **Cycle control**: Configurable daily cycle limits (0.5 - 4.0)
- **Efficiency modeling**: Accurate round-trip efficiency calculations

### 💰 Network Tariff Support
- **AusNet UESH01T (HV)**: High Voltage connection tariff
- **AusNet UESS01T (Sub-Tx)**: Sub-Transmission connection tariff
- **Time-of-Use pricing**: Solar soak, peak, and off-peak periods
- **Comprehensive charges**: Energy, standing, and demand charges

### 📈 Analytics & Visualization
- **Revenue breakdown**: Wholesale, network, standing, and demand components
- **Daily analysis**: SoC tracking, price profiles, and operation schedules
- **Period summary**: Cumulative revenue, daily trends, utilization metrics
- **Export functionality**: Download results as CSV

## Technology Stack

- **Frontend**: Vanilla JavaScript, Chart.js, HTML5, CSS3
- **Backend**: Cloudflare Pages Functions
- **Data Source**: AEMO NEMWeb (5-minute settlement data)
- **Hosting**: Cloudflare Pages
- **Domain**: Custom domain support via Cloudflare

## Quick Start

### Local Development

1. Clone the repository:
```bash
git clone https://github.com/eddie-greenwood/letool-bess-arbitrage.git
cd letool-bess-arbitrage
```

2. Install dependencies:
```bash
npm install
```

3. Run development server:
```bash
npx wrangler pages dev .
```

4. Open browser to `http://localhost:8788`

### Deployment

The application automatically deploys to Cloudflare Pages on push to main branch.

Manual deployment:
```bash
npx wrangler pages deploy . --project-name=letool-bess-arbitrage
```

## Configuration

### Battery Parameters
- **Capacity**: 1-1000 MWh
- **Power**: 1-500 MW
- **Efficiency**: 70-98% round-trip
- **Units**: 1-10 parallel units
- **Cycles**: 0.5-4.0 per day

### Market Regions
- VIC1 (Victoria)
- NSW1 (New South Wales)
- QLD1 (Queensland)
- SA1 (South Australia)
- TAS1 (Tasmania)

## Algorithm Details

See [ALGORITHMS.md](ALGORITHMS.md) for comprehensive documentation on:
- Dynamic Programming optimizer methodology
- Heuristic algorithm implementation
- Price processing and cleaning
- Network tariff calculations
- Efficiency modeling

## Project Structure

```
letool-bess-arbitrage/
├── index.html           # Main application UI
├── advanced-script.js   # Core application logic
├── dp-optimizer.js      # Dynamic Programming optimizer
├── functions/          
│   └── api/
│       ├── price.js    # AEMO NEMWeb data fetcher
│       └── test.js     # API test endpoint
├── _headers            # Cache control headers
├── _redirects          # Cloudflare Pages redirects
├── wrangler.toml       # Cloudflare configuration
├── ALGORITHMS.md       # Algorithm documentation
└── README.md          # This file
```

## API Endpoints

### `/api/price`
Fetches real-time price data from AEMO NEMWeb.

Parameters:
- `region`: NEM region code (e.g., VIC1)
- `date`: Date in YYYY-MM-DD format

Response:
```json
{
  "success": true,
  "source": "aemo-nemweb",
  "region": "VIC1",
  "date": "2024-08-09",
  "dataPoints": 288,
  "data": [...]
}
```

## Performance

- **Optimization speed**: <1 second for daily analysis
- **Data points**: 288 intervals per day (5-minute resolution)
- **State space**: 201 SoC levels (0.5% resolution)
- **Browser compatibility**: Chrome, Firefox, Safari, Edge

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

Copyright © 2024 Greenwood Energy. All rights reserved.

## Support

For issues or questions, please open an issue on GitHub or contact Greenwood Energy.

## Acknowledgments

- Australian Energy Market Operator (AEMO) for market data
- AusNet Services for network tariff structures
- Cloudflare for hosting infrastructure

---

**Powered by Greenwood Energy** 🌱⚡