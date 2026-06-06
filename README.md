# Event Operations Command Center Dashboard

A working command center prototype for large-scale event operations. It centralizes crowd movement, transportation load, incidents, volunteers, and resource deployment into a live administrator dashboard.

## What It Does

- Shows live operational KPIs for risk, crowd density, incidents, volunteer coverage, and transport load.
- Visualizes sectors on an interactive operations map with risk-based heat circles.
- Simulates live feeds and operational scenarios: normal, crowd surge, medical spike, and transit delay.
- Provides AI-style actionable insights and lets command staff apply recommendations.
- Supports manual incident creation, incident acknowledgement, sector filtering, and auto-generated commander briefings.
- Works as a standalone browser app with no dependency installation.

## Run Locally

Open `index.html` in a browser, or serve the folder with any static server.

```powershell
python -m http.server 8000
```

Then visit `http://localhost:8000`.

## Product Thinking

The dashboard is designed for event managers who need quick situational awareness and fast action, not a passive report. The interface prioritizes dense information, sortable operational surfaces, scenario testing, and direct actions such as reinforcing sectors, reducing transit load, and acknowledging incidents.

## Files

- `index.html` - landing page with redirect into the dashboard
- `dashboard.html` - command center application structure
- `styles.css` - responsive dashboard styling
- `app.js` - live simulation, insights, map rendering, and interactions
