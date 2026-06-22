from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from client import ask_agent
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
    
@app.get("/health")
async def get_health():
    return {"status": "ok"}

@app.post("/chat")
async def chat(request: ChatRequest):
    try:
        channel_id=str(request.surgeon_id)
        response = await ask_agent(request.message, request.surgeon_id, channel_id)
        return {"response": response}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
        