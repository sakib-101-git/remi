"""Rule-based credit-building planner. Readiness = Σ points(done) + ½ Σ points(in_progress), over total points."""
from __future__ import annotations

from typing import Any

from sqlmodel import select

from ..config import load_yaml
from ..models import CreditTask, utcnow
from .context import Ctx, DomainError

STATUSES = ("todo", "in_progress", "done")
COUNTRY_CONFIG = {"UK": "uk", "CA": "ca", "US": "us"}


def config_for(ctx: Ctx) -> dict[str, Any]:
    key = ctx.user.profile.get("credit_config") or COUNTRY_CONFIG.get(ctx.user.host_country, "uk")
    return load_yaml(f"credit/{key}.yaml")


def _tasks(ctx: Ctx) -> list[CreditTask]:
    return sorted(
        ctx.session.exec(select(CreditTask).where(CreditTask.workspace_id == ctx.ws_id, CreditTask.user_id == ctx.user.id)).all(),
        key=lambda t: (t.month, t.task_key),
    )


def readiness(tasks: list[CreditTask]) -> int:
    total = sum(t.points for t in tasks)
    if not total:
        return 0
    earned = sum(t.points for t in tasks if t.status == "done") + sum(t.points / 2 for t in tasks if t.status == "in_progress")
    return round(earned / total * 100)


def plan(ctx: Ctx) -> dict[str, Any]:
    cfg = config_for(ctx)
    tasks = _tasks(ctx)
    saved = bool(tasks)
    if not saved:
        rows = [
            {"task_key": t["key"], "title": t["title"], "description": t["description"], "month": t["month"], "points": t["points"], "depends_on": t["depends_on"], "status": "todo"}
            for t in cfg["tasks"]
        ]
    else:
        rows = [{"task_key": t.task_key, "title": t.title, "description": t.description, "month": t.month, "points": t.points, "depends_on": t.depends_on, "status": t.status} for t in tasks]
    done = {r["task_key"] for r in rows if r["status"] == "done"}
    for r in rows:
        r["unlocked"] = all(d in done for d in r["depends_on"])
    score = readiness(tasks) if saved else 0
    next_up = [r for r in rows if r["unlocked"] and r["status"] != "done"][:3]
    return {
        "country": cfg["country"],
        "country_label": cfg["label"],
        "saved": saved,
        "readiness_score": score,
        "readiness_label": "Getting started" if score < 30 else "Building" if score < 70 else "Established",
        "tasks": rows,
        "next_steps": next_up,
        "months": 6,
        "illustrative": True,
        "disclaimer": cfg["disclaimer"],
        "sources": [f"Credit-building basics ({cfg['country']})"],
    }


def create(ctx: Ctx) -> dict[str, Any]:
    if _tasks(ctx):
        return {**plan(ctx), "status": "already_exists"}
    for t in config_for(ctx)["tasks"]:
        ctx.session.add(CreditTask(
            workspace_id=ctx.ws_id, user_id=ctx.user.id, task_key=t["key"], title=t["title"], description=t["description"],
            month=t["month"], points=t["points"], depends_on=list(t["depends_on"]),
        ))
    ctx.session.flush()
    return {**plan(ctx), "status": "created"}


def update(ctx: Ctx, task_key: str, status: str) -> dict[str, Any]:
    if status not in STATUSES:
        raise DomainError(f"Status must be one of {', '.join(STATUSES)}")
    tasks = {t.task_key: t for t in _tasks(ctx)}
    if not tasks:
        create(ctx)
        tasks = {t.task_key: t for t in _tasks(ctx)}
    task = tasks.get(task_key) or next((t for t in tasks.values() if task_key.lower() in t.title.lower()), None)
    if task is None:
        raise DomainError(f"Unknown credit task '{task_key}'")
    blocked_by = [d for d in task.depends_on if tasks.get(d) and tasks[d].status != "done"]
    if status == "done" and blocked_by:
        raise DomainError(f"Finish {', '.join(tasks[d].title for d in blocked_by)} first")
    previous = task.status
    task.status, task.updated_at = status, utcnow()
    ctx.session.flush()
    return {"status": "saved", "task_key": task.task_key, "task_status": status, "undo": {"previous_status": previous}, "readiness_score": readiness(list(tasks.values()))}
