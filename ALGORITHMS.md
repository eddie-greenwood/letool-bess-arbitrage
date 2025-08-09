# Lé Tool - Algorithms & Methodology

## Overview

Lé Tool is a Battery Energy Storage System (BESS) arbitrage optimizer that uses advanced algorithms to maximize revenue from energy trading in the Australian National Electricity Market (NEM). The tool employs two complementary optimization approaches and sophisticated market analysis techniques.

## Core Algorithms

### 1. Dynamic Programming (DP) Optimizer

The DP optimizer uses a value function approach with backward induction to find the globally optimal trading strategy.

#### Key Features:
- **Value Function Approach**: Computes optimal value at each state (SoC level) and time
- **Reservation Prices**: Calculates charge/discharge thresholds dynamically
- **Salvage Value**: Accounts for end-of-day State of Charge value
- **Throughput Cost Calibration**: Uses bisection method to achieve target cycles

#### Algorithm Steps:
1. **Initialization**:
   - Discretize SoC into 201 steps (0.5% resolution)
   - Set terminal value function with salvage value
   - Initialize value grid V[soc][time]

2. **Backward Induction**:
   ```
   For each time step (backward):
     For each SoC state:
       Calculate value of:
         - Charging: V_charge = -buyPrice * energy + V[future_soc][t+1]
         - Discharging: V_discharge = sellPrice * energy + V[future_soc][t+1]  
         - Idle: V_idle = V[soc][t+1]
       V[soc][t] = max(V_charge, V_discharge, V_idle)
   ```

3. **Forward Simulation**:
   - Start from initial SoC
   - At each time, choose action with highest value
   - Apply efficiency losses (√η for both charge and discharge)

4. **Reservation Price Calculation**:
   - Charge threshold: price below which charging is profitable
   - Discharge threshold: price above which discharging is profitable
   - Smoothing applied to reduce noise

5. **Cycle Control**:
   - Bisection method to find throughput cost that achieves target cycles
   - Iteratively adjusts cost penalty on energy throughput

### 2. Heuristic Optimizer

Fast greedy algorithm that identifies and exploits the best arbitrage opportunities.

#### Key Features:
- **Opportunity Ranking**: Sorts charge/discharge pairs by profitability
- **Non-overlapping Selection**: Ensures selected opportunities don't conflict
- **Fixed Efficiency Split**: √η applied to both charge and discharge

#### Algorithm Steps:
1. **Opportunity Identification**:
   ```
   For each potential charge window:
     For each potential discharge window after charge:
       Calculate profit = (discharge_price * η - charge_price) * capacity
       Store if profitable
   ```

2. **Opportunity Selection**:
   - Sort opportunities by profit margin
   - Select non-overlapping opportunities up to max cycles
   - Build operation schedule

3. **Simulation**:
   - Execute schedule with efficiency losses
   - Track SoC throughout the day
   - Calculate total revenue

### 3. Price Processing

#### Price Cleaning:
- **Spike Detection**: Identifies abnormal price spikes (>$500/MWh)
- **Clamping**: Limits extreme values to reasonable range
- **Outlier Handling**: Replaces outliers with local average

#### Minimum Run Constraints:
- Enforces 15-minute minimum operation duration
- Prevents rapid switching that's impractical for real batteries
- Groups operations into continuous blocks

## Network Tariff Integration

### Tariff Components:
1. **Time-of-Use Energy Charges**:
   - Solar Soak (10am-3pm): Lower or negative rates
   - Peak (3pm-9pm): Higher rates
   - Off-Peak (9pm-10am): Moderate rates

2. **Standing Charges**:
   - Fixed daily connection charge
   - Pro-rated from annual amount

3. **Demand Charges** (Sub-Transmission only):
   - Based on peak kVA in each period
   - Monthly charge pro-rated daily

### Net Price Calculation:
```
Net Buy Price = Wholesale Price + Network Import Charge
Net Sell Price = Wholesale Price + Network Export Credit
```

## Efficiency Modeling

### Round-Trip Efficiency:
- Total round-trip efficiency: η (typically 85-90%)
- Split equally between charge and discharge: √η each
- Energy losses accounted at each conversion

### Power and Energy Constraints:
- Maximum charge/discharge power (MW)
- Battery capacity (MWh)
- State of Charge limits (0-100%)

## Performance Metrics

### Key Calculations:
1. **Average Spread**: 
   ```
   Avg Spread = (Avg Discharge Price * η) - Avg Charge Price
   ```

2. **Cycles per Day**:
   ```
   Cycles = Total Energy Throughput / (2 * Battery Capacity)
   ```

3. **Utilization Rate**:
   ```
   Utilization = Active Intervals / Total Intervals * 100%
   ```

4. **Revenue Breakdown**:
   - Wholesale Revenue: Energy arbitrage profit
   - Network Charges: Time-of-use charges/credits
   - Standing Charges: Fixed daily costs
   - Demand Charges: Peak power costs

## Data Sources

### Primary: AEMO NEMWeb
- Real-time 5-minute settlement prices
- Historical dispatch data
- Direct from Australian Energy Market Operator

### Fallback: Simulated Data
- Duck curve pattern simulation
- Weekend/weekday variations
- Realistic price volatility modeling

## Implementation Notes

### Computational Efficiency:
- DP optimizer: O(S × T × A) where S=states, T=time steps, A=actions
- Heuristic: O(T² log T) for opportunity sorting
- Real-time processing: <1 second for daily optimization

### Numerical Stability:
- Fixed-point arithmetic for SoC calculations
- Careful handling of floating-point comparisons
- Bounds checking on all operations

### Calibration Parameters:
- Salvage value: 10% of average daily price
- Throughput cost: Dynamically calibrated via bisection
- Smoothing window: 5 intervals for reservation prices
- Price clamp: $500/MWh maximum

## Algorithm Selection

### When to use DP Optimizer:
- Need globally optimal solution
- Complex tariff structures
- Research and analysis
- Benchmark comparisons

### When to use Heuristic:
- Quick estimates needed
- Simple price patterns
- Real-time applications
- Initial feasibility studies

## Future Enhancements

1. **Machine Learning Integration**:
   - Price forecasting models
   - Pattern recognition for opportunity identification
   - Adaptive parameter tuning

2. **Multi-Day Optimization**:
   - Consider weekly cycles
   - Account for battery degradation
   - Seasonal patterns

3. **Risk Management**:
   - Uncertainty quantification
   - Robust optimization approaches
   - Scenario analysis

4. **Market Integration**:
   - FCAS market participation
   - Network support services
   - Virtual Power Plant coordination

## References

- Dynamic Programming and Optimal Control (Bertsekas)
- Energy Storage Valuation (EPRI)
- Australian Energy Market Operator (AEMO) documentation
- AusNet Services Network Tariff Structure Statement 2024-25