import asyncio
import json
import math
import os
import random
import time
from pathlib import Path
from typing import Any

try:
    from fastapi import FastAPI, HTTPException, Query
    from fastapi.middleware.cors import CORSMiddleware
    from pydantic import BaseModel, Field
except ImportError as exc:  # pragma: no cover - startup guard for missing deps
    raise RuntimeError(
        "FastAPI dependencies are missing. Run: pip install -r backend/requirements.txt"
    ) from exc

try:
    from motor.motor_asyncio import AsyncIOMotorClient
except ImportError:  # pragma: no cover - motor is optional for JSON fallback
    AsyncIOMotorClient = None


ROOT = Path(__file__).resolve().parent
STATE_FILE = ROOT / "local_state.json"
MONGO_URI = os.getenv("MONGO_URI", "mongodb://127.0.0.1:27017")
MONGO_DB = os.getenv("MONGO_DB", "event_command_center")


SCENARIOS = {
    "normal": {"crowd": 0, "medical": 0, "transport": 0, "incident_chance": 0.08},
    "surge": {"crowd": 12, "medical": 1, "transport": 5, "incident_chance": 0.20},
    "medical": {"crowd": 5, "medical": 4, "transport": 0, "incident_chance": 0.18},
    "transport": {"crowd": 6, "medical": 0, "transport": 16, "incident_chance": 0.18},
}


SEED_STATE = {
    "sectors": [
        {
            "id": "north",
            "name": "North Gate",
            "x": 210,
            "y": 130,
            "crowd": 62,
            "volunteers": 42,
            "required": 48,
            "medical": 4,
            "buses": 76,
            "gates": 66,
            "queue": 18,
        },
        {
            "id": "east",
            "name": "East Shuttle Hub",
            "x": 705,
            "y": 172,
            "crowd": 71,
            "volunteers": 36,
            "required": 44,
            "medical": 6,
            "buses": 88,
            "gates": 58,
            "queue": 27,
        },
        {
            "id": "south",
            "name": "South Pilgrim Route",
            "x": 470,
            "y": 412,
            "crowd": 55,
            "volunteers": 53,
            "required": 45,
            "medical": 3,
            "buses": 64,
            "gates": 71,
            "queue": 14,
        },
        {
            "id": "west",
            "name": "Food Court West",
            "x": 160,
            "y": 390,
            "crowd": 68,
            "volunteers": 31,
            "required": 42,
            "medical": 5,
            "buses": 52,
            "gates": 62,
            "queue": 24,
        },
        {
            "id": "ghat",
            "name": "Sangam Ghat",
            "x": 520,
            "y": 252,
            "crowd": 82,
            "volunteers": 63,
            "required": 74,
            "medical": 8,
            "buses": 70,
            "gates": 80,
            "queue": 32,
        },
    ],
    "incidents": [
        {
            "id": 101,
            "priority": "Critical",
            "location": "Sangam Ghat",
            "type": "Crowd bottleneck",
            "status": "Dispatching",
            "eta": 7,
        },
        {
            "id": 102,
            "priority": "High",
            "location": "East Shuttle Hub",
            "type": "Transport delay",
            "status": "Open",
            "eta": 12,
        },
        {
            "id": 103,
            "priority": "Medium",
            "location": "Food Court West",
            "type": "Lost person",
            "status": "Assigned",
            "eta": 9,
        },
        {
            "id": 104,
            "priority": "Low",
            "location": "North Gate 3",
            "type": "Resource request",
            "status": "Monitoring",
            "eta": 18,
        },
    ],
}


class IncidentIn(BaseModel):
    location: str
    type: str
    priority: str = Field(pattern="^(Low|Medium|High|Critical)$")


class DataStore:
    def __init__(self) -> None:
        self.client = None
        self.db = None
        self.using_mongo = False

    async def connect(self) -> None:
        if AsyncIOMotorClient is not None and os.getenv("USE_MONGO", "1") != "0":
            try:
                self.client = AsyncIOMotorClient(MONGO_URI, serverSelectionTimeoutMS=900)
                await self.client.admin.command("ping")
                self.db = self.client[MONGO_DB]
                self.using_mongo = True
                await self._seed_mongo()
                return
            except Exception:
                self.client = None
                self.db = None

        await self._seed_file()

    async def health(self) -> dict[str, Any]:
        return {
            "status": "ok",
            "database": "mongodb" if self.using_mongo else "json-fallback",
            "mongo_uri": MONGO_URI if self.using_mongo else None,
        }

    async def get_state(self) -> dict[str, Any]:
        if self.using_mongo:
            sectors = await self.db.sectors.find({}, {"_id": 0}).to_list(length=100)
            incidents = await self.db.incidents.find({}, {"_id": 0}).to_list(length=100)
            return {"sectors": sectors, "incidents": incidents}

        return json.loads(STATE_FILE.read_text(encoding="utf-8"))

    async def save_state(self, state: dict[str, Any]) -> None:
        if self.using_mongo:
            await self.db.sectors.delete_many({})
            await self.db.incidents.delete_many({})
            if state["sectors"]:
                await self.db.sectors.insert_many(state["sectors"])
            if state["incidents"]:
                await self.db.incidents.insert_many(state["incidents"])
            return

        STATE_FILE.write_text(json.dumps(state, indent=2), encoding="utf-8")

    async def _seed_mongo(self) -> None:
        if await self.db.sectors.count_documents({}) == 0:
            await self.db.sectors.insert_many(SEED_STATE["sectors"])
        if await self.db.incidents.count_documents({}) == 0:
            await self.db.incidents.insert_many(SEED_STATE["incidents"])

    async def _seed_file(self) -> None:
        if not STATE_FILE.exists():
            STATE_FILE.write_text(json.dumps(SEED_STATE, indent=2), encoding="utf-8")


store = DataStore()
app = FastAPI(title="Event Operations Command Center API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup() -> None:
    await store.connect()


def clamp(value: float, minimum: int, maximum: int) -> int:
    return max(minimum, min(maximum, round(value)))


def sector_risk(sector: dict[str, Any]) -> int:
    volunteer_gap = max(0, sector["required"] - sector["volunteers"]) * 1.5
    transport_pressure = (sector["buses"] + sector["gates"]) / 2
    return round(
        sector["crowd"] * 0.48
        + transport_pressure * 0.22
        + sector["medical"] * 3.4
        + volunteer_gap
    )


def visible_sectors(state: dict[str, Any], sector: str) -> list[dict[str, Any]]:
    if sector == "all":
        return state["sectors"]
    return [item for item in state["sectors"] if item["id"] == sector]


def filter_incidents(state: dict[str, Any], sector: str) -> list[dict[str, Any]]:
    if sector == "all":
        return state["incidents"]

    selected = next((item for item in state["sectors"] if item["id"] == sector), None)
    if not selected:
        return state["incidents"]

    key = selected["name"].split(" ")[0]
    return [
        item
        for item in state["incidents"]
        if key in item["location"] or item["location"] == selected["name"]
    ]


def random_step(size: int) -> float:
    return (random.random() - 0.5) * size


def create_random_incident(state: dict[str, Any]) -> None:
    sector = random.choice(state["sectors"])
    types = [
        "Crowd bottleneck",
        "Medical assistance",
        "Transport delay",
        "Resource request",
        "Lost person",
    ]
    if sector["crowd"] > 84:
        priority = "Critical"
    elif sector["crowd"] > 72:
        priority = "High"
    else:
        priority = "Medium" if random.random() > 0.55 else "Low"

    state["incidents"].insert(
        0,
        {
            "id": round(time.time() * 1000),
            "priority": priority,
            "location": sector["name"],
            "type": random.choice(types),
            "status": "Open",
            "eta": random.randint(6, 21),
        },
    )
    state["incidents"] = state["incidents"][:9]


def advance_state(state: dict[str, Any], scenario: str, speed: int) -> dict[str, Any]:
    profile = SCENARIOS.get(scenario, SCENARIOS["normal"])
    for _ in range(speed):
        for sector in state["sectors"]:
            center_crowd = 58 + profile["crowd"] + (14 if sector["id"] == "ghat" else 0)
            sector["crowd"] = clamp(
                sector["crowd"] + (center_crowd - sector["crowd"]) * 0.08 + random_step(4),
                24,
                98,
            )
            sector["medical"] = clamp(
                sector["medical"] + random_step(2) + profile["medical"] * 0.1,
                1,
                16,
            )
            sector["buses"] = clamp(
                sector["buses"] + random_step(4) + profile["transport"] * 0.08,
                28,
                98,
            )
            sector["gates"] = clamp(
                sector["gates"] + random_step(3) + (sector["crowd"] - 65) * 0.04,
                32,
                98,
            )
            sector["queue"] = clamp(
                sector["queue"]
                + random_step(3)
                + (sector["crowd"] - 70) * 0.08
                + profile["transport"] * 0.05,
                3,
                58,
            )

        for incident in state["incidents"]:
            incident["eta"] = clamp(incident["eta"] + random_step(2), 3, 28)

        if random.random() < profile["incident_chance"]:
            create_random_incident(state)

    return state


def metrics_for(state: dict[str, Any], sector: str) -> dict[str, Any]:
    sectors = visible_sectors(state, sector) or state["sectors"]
    incidents = filter_incidents(state, sector)
    total_required = max(1, sum(item["required"] for item in sectors))
    avg_transport = round(
        sum((item["buses"] + item["gates"]) / 2 for item in sectors) / len(sectors)
    )

    return {
        "riskScore": round(sum(sector_risk(item) for item in sectors) / len(sectors)),
        "crowdDensity": round(sum(item["crowd"] for item in sectors) / len(sectors)),
        "openIncidents": len(incidents),
        "criticalIncidents": len(
            [item for item in incidents if item["priority"] == "Critical"]
        ),
        "volunteerCoverage": round(
            sum(item["volunteers"] for item in sectors) / total_required * 100
        ),
        "transportLoad": avg_transport,
    }


def build_insights(state: dict[str, Any], sector: str) -> list[dict[str, Any]]:
    sectors = visible_sectors(state, sector) or state["sectors"]
    incidents = filter_incidents(state, sector)
    insights = []
    highest_risk = sorted(sectors, key=sector_risk, reverse=True)[0]
    critical = next((item for item in incidents if item["priority"] == "Critical"), None)

    if critical:
        insights.append(
            {
                "type": "incident",
                "targetId": critical["id"],
                "title": f"Escalate {critical['location']}",
                "detail": f"{critical['type']} is marked critical with {critical['eta']} minute response ETA. Open a direct command channel and stage medical support nearby.",
            }
        )

    insights.append(
        {
            "type": "reinforce",
            "targetId": highest_risk["id"],
            "title": f"Rebalance {highest_risk['name']}",
            "detail": f"Risk score {sector_risk(highest_risk)}. Redirect {max(4, highest_risk['required'] - highest_risk['volunteers'])} volunteers and open one alternate movement corridor.",
        }
    )

    transport = sorted(
        sectors, key=lambda item: (item["buses"] + item["gates"]) / 2, reverse=True
    )[0]
    if (transport["buses"] + transport["gates"]) / 2 >= 72:
        insights.append(
            {
                "type": "transport",
                "targetId": transport["id"],
                "title": f"Reduce transit load at {transport['name']}",
                "detail": f"Transport load is averaging {round((transport['buses'] + transport['gates']) / 2)}%. Trigger shuttle spacing and hold non-urgent inbound batches for 10 minutes.",
            }
        )

    gap = sorted(sectors, key=lambda item: item["required"] - item["volunteers"], reverse=True)[
        0
    ]
    if gap["volunteers"] < gap["required"]:
        insights.append(
            {
                "type": "reinforce",
                "targetId": gap["id"],
                "title": "Fill volunteer gap",
                "detail": f"{gap['name']} is short by {gap['required'] - gap['volunteers']} volunteers. Shift standby staff from lower-risk routes.",
            }
        )

    return insights[:4]


def briefing_for(state: dict[str, Any], sector: str) -> str:
    sectors = visible_sectors(state, sector) or state["sectors"]
    metrics = metrics_for(state, sector)
    highest = sorted(sectors, key=sector_risk, reverse=True)[0]
    status = (
        "red"
        if metrics["riskScore"] >= 82
        else "amber"
        if metrics["riskScore"] >= 64
        else "green"
    )
    insight = build_insights(state, sector)[0]

    return "\n".join(
        [
            f"Operational status: {status} watch with aggregate risk score {metrics['riskScore']}.",
            f"Primary hotspot: {highest['name']} at {highest['crowd']}% crowd density and {highest['queue']} minute queue time.",
            f"Incident load: {metrics['openIncidents']} open items, including {metrics['criticalIncidents']} critical.",
            f"Staffing: {metrics['volunteerCoverage']}% volunteer coverage across selected sectors.",
            f"Recommended command action: {insight['detail']}",
        ]
    )


def apply_action(state: dict[str, Any], action: dict[str, Any]) -> None:
    if action["type"] == "incident":
        for incident in state["incidents"]:
            if incident["id"] == action["targetId"]:
                incident["status"] = "Assigned"
                incident["eta"] = max(3, incident["eta"] - 4)
                return

    sector = next(
        (item for item in state["sectors"] if item["id"] == action["targetId"]), None
    )
    if not sector:
        return

    if action["type"] == "transport":
        sector["buses"] = clamp(sector["buses"] - 10, 20, 98)
        sector["gates"] = clamp(sector["gates"] - 6, 20, 98)
        sector["queue"] = clamp(sector["queue"] - 4, 1, 58)
    else:
        added = max(4, min(12, sector["required"] - sector["volunteers"] + 3))
        sector["volunteers"] = clamp(sector["volunteers"] + added, 0, sector["required"] + 18)
        sector["queue"] = clamp(sector["queue"] - 5, 1, 58)


@app.get("/api/health")
async def health() -> dict[str, Any]:
    return await store.health()


@app.get("/api/snapshot")
async def snapshot(
    sector: str = "all",
    scenario: str = Query(default="normal", pattern="^(normal|surge|medical|transport)$"),
    speed: int = Query(default=1, ge=1, le=5),
    advance: bool = True,
) -> dict[str, Any]:
    state = await store.get_state()
    if advance:
        state = advance_state(state, scenario, speed)
        await store.save_state(state)

    return {
        "sectors": state["sectors"],
        "incidents": state["incidents"],
        "metrics": metrics_for(state, sector),
        "insights": build_insights(state, sector),
        "briefing": briefing_for(state, sector),
        "database": "mongodb" if store.using_mongo else "json-fallback",
    }


@app.post("/api/incidents")
async def create_incident(payload: IncidentIn) -> dict[str, Any]:
    state = await store.get_state()
    priority_eta = {"Critical": 5, "High": 9, "Medium": 15, "Low": 18}
    incident = {
        "id": round(time.time() * 1000),
        "priority": payload.priority,
        "location": payload.location,
        "type": payload.type,
        "status": "Open",
        "eta": priority_eta[payload.priority],
    }
    state["incidents"].insert(0, incident)
    await store.save_state(state)
    return incident


@app.patch("/api/incidents/{incident_id}/ack")
async def acknowledge_incident(incident_id: int) -> dict[str, Any]:
    state = await store.get_state()
    for incident in state["incidents"]:
        if incident["id"] == incident_id:
            incident["status"] = "Assigned"
            incident["eta"] = max(3, incident["eta"] - 4)
            await store.save_state(state)
            return incident
    raise HTTPException(status_code=404, detail="Incident not found")


@app.post("/api/actions/top")
async def apply_top_action(sector: str = "all") -> dict[str, Any]:
    state = await store.get_state()
    action = build_insights(state, sector)[0]
    apply_action(state, action)
    await store.save_state(state)
    return {"applied": action, "metrics": metrics_for(state, sector)}


@app.post("/api/reset")
async def reset_state() -> dict[str, str]:
    await store.save_state(json.loads(json.dumps(SEED_STATE)))
    return {"status": "reset"}
