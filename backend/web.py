import json
import base64
import os
import tempfile
import anthropic
import assemblyai as aai
import fitz
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

class MedicationItem(BaseModel):
    name: str
    dose: str | None = None
    frequency: str | None = None

class AllergyItem(BaseModel):
    name: str
    confidence: str | None = None
    severity: str | None = None   # surgeon may have edited this in the confirm UI

class OnboardRequest(BaseModel):
    name: str
    age: int | None = None
    sex: str | None = None
    allergies: list[AllergyItem] = []
    active_medications: list[MedicationItem] = []
    primary_diagnosis: str | None = None
    surgeon_id: int
    source_ref: int | None = None   # document_id from /patients/extract, if any

class VoiceExtractRequest(BaseModel):
    text: str
    surgeon_id: int

@app.get("/health")
async def get_health():
    return {"status": "ok"}


@app.get("/audit-log")
async def audit_log(limit: int = 50):
    try:
        from tools import get_audit_log
        results = get_audit_log(limit)
        return {"entries": results}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/patients/search")
async def search_patients(name: str):
    try:
        from tools import find_patient_by_name
        results = find_patient_by_name(name)
        return {"patients": results}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    
@app.post("/patients/extract") 
async def extract_patients(
    file: UploadFile = File(...),
    surgeon_id: int = Form(...),
):
    try:
        contents = await file.read()
        
        if file.content_type == "application/pdf":
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
                    "text": """Extract patient information from this document and return it 
                    in exactly this JSON structure:

                    {
                    "source_type": "lab_result or referral_letter or discharge_summary or other",
                    "patient": {
                        "name": "full name as written",
                        "age": null,
                        "sex": "Male or Female or null"
                    },
                    "allergies": [
                        {"name": "substance name", "confidence": "documented or inferred"}
                    ],
                    "active_medications": [
                        {"name": "drug name", "dose": "dosage", "frequency": "frequency"}
                    ],
                    "primary_diagnosis": "as written in document or null"
                    }""" 
                    }
            ]
        }]
        response = await client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=2048,
            system=
            "You are a clinical document extraction assistant. "
            "You must respond with valid JSON only — no preamble, no explanation, "
            "no markdown fences. If a field cannot be determined from the document, "
            "use null for that field. Never guess or infer values not explicitly  "
            "present in the document.",
            messages=messages
        )
        raw = response.content[0].text.strip()
        # strip markdown fences if Claude adds them despite instructions
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        raw = raw.strip()
        extracted = json.loads(raw)
        return {"extracted": extracted}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# Text counterpart to /patients/extract — the Voice capture tab has no
# document photo, only a dictation transcript (already produced by
# /voice/transcribe), so this runs the same extraction contract against text
# instead of an image and returns the identical { "extracted": {...} } shape.
@app.post("/patients/extract-voice")
async def extract_patient_voice(request: VoiceExtractRequest):
    try:
        client = anthropic.AsyncAnthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))
        messages = [{
            "role": "user",
            "content": f"""Extract patient information from this surgeon's spoken dictation
            and return it in exactly this JSON structure:

            {{
            "source_type": "voice",
            "patient": {{
                "name": "full name as stated",
                "age": null,
                "sex": "Male or Female or null"
            }},
            "allergies": [
                {{"name": "substance name", "confidence": "documented or inferred"}}
            ],
            "active_medications": [
                {{"name": "drug name", "dose": "dosage", "frequency": "frequency"}}
            ],
            "primary_diagnosis": "as stated or null"
            }}

            Dictation transcript:
            \"\"\"{request.text}\"\"\""""
        }]
        response = await client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=2048,
            system=
            "You are a clinical dictation extraction assistant. "
            "You must respond with valid JSON only — no preamble, no explanation, "
            "no markdown fences. If a field cannot be determined from the transcript, "
            "use null for that field. Never guess or infer values not explicitly stated. "
            "Speech-to-text transcripts sometimes mishear drug or dosage names — use "
            "clinical judgment to correct obvious transcription errors, but do not "
            "invent information that isn't in the transcript.",
            messages=messages
        )
        raw = response.content[0].text.strip()
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        raw = raw.strip()
        extracted = json.loads(raw)
        return {"extracted": extracted}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/patients/onboard")
async def onboard(request: OnboardRequest):
    try:
        from tools import onboard_patient
        from datetime import date

        dob = None
        if request.age:
            dob = date(date.today().year - request.age, 1, 1).isoformat()

        allergies = [
            {"name": a.name, "severity": a.severity or "moderate"}
            for a in request.allergies
        ]
        medications = [
            {"name": m.name, "dose": m.dose, "frequency": m.frequency}
            for m in request.active_medications
        ]

        patient_id = onboard_patient(
            name=request.name,
            date_of_birth=dob,
            sex=request.sex,
            allergies=allergies,
            medications=medications,
            primary_diagnosis=request.primary_diagnosis,
            surgeon_id=request.surgeon_id,
        )
        return {"patient_id": patient_id, "status": "onboarded"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

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


# Declared as a plain `def` (not `async def`) — the assemblyai SDK's
# Transcriber.transcribe() is a blocking call (it polls internally), and
# FastAPI runs sync path operations in a worker thread automatically so it
# doesn't block the event loop.
@app.post("/voice/transcribe")
def transcribe_voice(file: UploadFile = File(...)):
    tmp_path = None
    try:
        aai.settings.api_key = os.getenv("ASSEMBLYAI_API_KEY")
        contents = file.file.read()

        suffix = os.path.splitext(file.filename or "")[1] or ".m4a"
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            tmp.write(contents)
            tmp_path = tmp.name

        config = aai.TranscriptionConfig(
            speech_models=["universal-3-5-pro", "universal-2"],
            domain="medical-v1",  # medical vocabulary mode — drug/anatomy terms, dosages
            prompt=(
                "Clinical dictation by a surgeon in a hospital setting — "
                "patient details, medications, diagnoses, or a request to "
                "a clinical assistant."
            ),
        )
        transcript = aai.Transcriber(config=config).transcribe(tmp_path)
        if transcript.status == aai.TranscriptStatus.error:
            raise HTTPException(status_code=500, detail=transcript.error)
        return {"text": transcript.text}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)

