import json
import base64
import os
import anthropic
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from client import ask_agent_stream
from tools import resolve_approval, store_document
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

system=(
    "You are a clinical document extraction assistant. Extract information "
    "exactly as written — do not interpret, infer, or give clinical opinions. "
    "Structure your response with: Patient name (if visible), Date (if visible), "
    "Document type, and Findings as a clear list. Flag any values outside their "
    "reference range with [ABNORMAL]. If any field is illegible write "
    "'unclear — please verify'. Keep the summary concise and factual."
)

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
    
@app.post("/documents/upload")
async def upload_document(
    file: UploadFile = File(...),
    patient_id: int = Form(...),
    surgeon_id: int = Form(...),
    document_type: str = Form(...),
):
    try:
        contents = await file.read()
        
        if file.content_type == "application/pdf":
            import fitz
            pdf_doc = fitz.open(stream=contents, filetype="pdf")
            pix = pdf_doc[0].get_pixmap(dpi=150)
            img_bytes = pix.tobytes("png")
            image_data = base64.b64encode(img_bytes).decode("utf-8")
            media_type = "image/png"
        else:
            image_data = base64.b64encode(contents).decode("utf-8")
            media_type = file.content_type

        
        client = anthropic.AsyncAnthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))
        messages=[{
            "role": "user",
            "content": [
                {
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": media_type, 
                        "data": image_data
                    }
                },
                {
                    "type": "text",
                    "text": "Extract the key clinical findings from this document. Include: patient name if visible, document date if visible, all test results or findings, and flag any abnormal values. If any field is unclear write 'unclear — please verify'. Do not give clinical opinions, only state what is written in the document."
                }
            ]
        }]
        response = await client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=2048,
            system=system,
            messages=messages
        )
        summary = response.content[0].text
        document_id = store_document(patient_id, document_type, summary, surgeon_id, None, None)
        return {"document_id": document_id, "summary": summary}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

