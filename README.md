# BESS Arbitrage Calculator

A web application that calculates Battery Energy Storage System (BESS) arbitrage opportunities using energy price data from OpenNEM.

## Features

- Real-time energy price data from OpenNEM API
- Customizable battery parameters (capacity, power rating, efficiency)
- Region selection for Australian energy markets
- Visual charts showing:
  - Daily energy price patterns
  - Optimal charge/discharge schedule
- Revenue calculations and metrics

## Local Development

To run locally:
```bash
python3 -m http.server 8000
```
Then open http://localhost:8000

## Deployment to Cloudflare Pages

1. Push this code to a GitHub repository
2. Go to [Cloudflare Pages](https://pages.cloudflare.com)
3. Connect your GitHub account
4. Select your repository
5. Configure build settings:
   - Build command: (leave empty)
   - Build output directory: `/`
6. Deploy

The site will be available at `https://your-project.pages.dev`

## How It Works

1. **Data Fetching**: Retrieves energy price data from OpenNEM API
2. **Arbitrage Calculation**: Identifies optimal charge/discharge periods based on price differentials
3. **Revenue Estimation**: Calculates potential daily revenue considering:
   - Battery capacity and power limits
   - Round-trip efficiency losses
   - Energy price spreads

## Technologies Used

- HTML5, CSS3, JavaScript
- Chart.js for data visualization
- OpenNEM API for energy market data
- Cloudflare Pages for hosting