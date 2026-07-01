import json
from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from client import ask_agent_stream
from tools import resolve_approval
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],      # demo only — lock down later
    allow_methods=["*"],
    allow_headers=["*"],
)

class ChatRequest(BaseModel):
    message: str
    surgeon_id: int

class ResolveRequest(BaseModel):
    status: str   # "approved" | "rejected"
    surgeon_id: int

@app.get("/health")
async def get_health():
    return {"status": "ok"}

# @app.post("/chat")
# async def chat(request: ChatRequest):
#     try:
#         channel_id=str(request.surgeon_id)
#         response = await ask_agent(request.message, request.surgeon_id, channel_id)
#         return {"response": response}
#     except Exception as e:
#         raise HTTPException(status_code=500, detail=str(e))

@app.post("/chat/stream")
async def chat_stream(request: ChatRequest):
    channel_id = str(request.surgeon_id)

    async def event_source():
        try:
            async for event in ask_agent_stream(request.message, request.surgeon_id, channel_id):
                yield f"data: {json.dumps(event)}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'content': str(e)})}\n\n"

    return StreamingResponse(
        event_source(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )

@app.post("/approvals/{approval_id}/resolve")
async def resolve(approval_id: int, request: ResolveRequest):
    if request.status not in ("approved", "rejected"):
        raise HTTPException(status_code=400, detail="status must be 'approved' or 'rejected'")
    try:
        channel_id = str(request.surgeon_id)
        resolve_approval(approval_id, request.status, channel_id)
        return {"ok": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
