# Event Operations Command Center Dashboard

A full-stack command center prototype for large-scale event operations. It centralizes crowd movement, transportation load, incidents, volunteers, and resource deployment into a live administrator dashboard.

## Tech Stack

- Frontend: Node.js static frontend server with browser JavaScript UI
- API: FastAPI
- Database: MongoDB via Motor
- Local fallback: JSON persistence when MongoDB is not running, so demos still work

## What It Does

- Shows live operational KPIs for risk, crowd density, incidents, volunteer coverage, and transport load.
- Visualizes sectors on an interactive operations map with risk-based heat circles.
- Uses FastAPI endpoints to stream changing operations data into the dashboard.
- Stores sectors and incidents in MongoDB when available.
- Provides AI-style actionable insights and lets command staff apply recommendations.
- Supports manual incident creation, incident acknowledgement, sector filtering, and auto-generated commander briefings.
- Includes a landing page before users enter the command center.

## Project Structure

- `index.html` - landing page
- `dashboard.html` - command center UI
- `styles.css` - responsive dashboard styling
- `app.js` - frontend interactions and API integration
- `server.js` - Node.js frontend server and API proxy
- `package.json` - Node.js scripts
- `backend/main.py` - FastAPI app and MongoDB-backed operations API
- `backend/requirements.txt` - Python dependencies

## Run Locally

Install Python dependencies:

```powershell
python -m pip install -r backend/requirements.txt
```

Optional: start MongoDB locally. If MongoDB is not running, the API automatically uses `backend/local_state.json`.

Start FastAPI:

```powershell
python -m uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000
```

Start the Node.js frontend in a second terminal:

```powershell
node server.js
```

Then open:

```text
http://127.0.0.1:3000
```

On Windows, if `npm` is blocked by PowerShell execution policy, use `node server.js` directly or run scripts with `npm.cmd`.

## API Endpoints

- `GET /api/health` - API and database status
- `GET /api/snapshot` - live sectors, incidents, metrics, insights, and briefing
- `POST /api/incidents` - create an incident
- `PATCH /api/incidents/{incident_id}/ack` - acknowledge an incident
- `POST /api/actions/top` - apply the top recommended action
- `POST /api/reset` - reset seed data

## Environment Variables

- `MONGO_URI` - MongoDB connection string, default `mongodb://127.0.0.1:27017`
- `MONGO_DB` - database name, default `event_command_center`
- `USE_MONGO=0` - force JSON fallback mode
- `FRONTEND_PORT` - Node frontend port, default `3000`
- `API_BASE_URL` - backend URL for the Node proxy, default `http://127.0.0.1:8000`

## Deployment Notes

For a true full-stack live deployment, deploy the FastAPI backend on a service like Render or Railway, connect it to MongoDB Atlas, then deploy the Node frontend on Render, Railway, or Vercel with `API_BASE_URL` pointed at the backend.

For quick static-only demos, the landing/dashboard files still open directly, but the live API and MongoDB features require the backend.
