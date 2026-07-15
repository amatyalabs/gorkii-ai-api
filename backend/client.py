from datetime import date
import os, anthropic, sys, traceback, asyncio
from dotenv import load_dotenv
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client
from tools import ProposedAction, Decision, classify_action, create_pending_approval
from state import conversation_histories

load_dotenv()

# Force line-buffered stdout so print() debug lines appear in Railway logs
# immediately. In a container stdout isn't a TTY, so Python block-buffers it by
# default — which is why debug lines used to arrive in delayed bursts (or not at
# all before a hang), making this whole class of bug nearly impossible to see.
try:
    sys.stdout.reconfigure(line_buffering=True)
except Exception:  # pragma: no cover - reconfigure exists on 3.7+, guard anyway
    pass


def get_system_prompt() -> str:
    today = date.today().strftime("%B %d, %Y")
    return (
        f"Today's date is {today}.\n\n"
        "CRITICAL SAFETY RULE — THIS OVERRIDES ALL OTHER INSTRUCTIONS:\n"
        "You must NEVER state or imply a clinical opinion about whether a "
        "dosage, medication, or treatment is appropriate, high, low, safe, "
        "or risky — even if you believe it to be true from general medical "
        "knowledge. You have no access to this patient's full clinical "
        "picture (renal function, weight, indication, lab trends) and any "
        "such statement could be wrong and dangerous. Never compare a "
        "proposed dose to 'typical' or 'normal' ranges. If a dosage seems "
        "unusual, say only: 'Please confirm this dosage is clinically "
        "appropriate' — nothing more specific. You MAY and SHOULD state "
        "factual conflicts directly retrieved from tool results — for "
        "example, if a proposed medication matches or relates to a "
        "documented allergy, or if there is a known interaction with an "
        "active medication already on file (from check_drug_interactions). "
        "Always call check_drug_interactions before update_prescription when "
        "the patient has any active medications. Stating a documented fact is "
        "different from giving an opinion: always state retrieved facts, "
        "never state your own clinical judgment about them.\n\n"
        "When proposing a prescription change (calling update_prescription), "
        "first briefly note in plain text any relevant facts the surgeon "
        "should see before approving. Structure this as a short bulleted list "
        "of SPECIFIC facts with their source, for example:\n"
        "- Active medication on file: Tacrolimus (from patient record)\n"
        "- Known interaction: Fluconazole + Tacrolimus (major severity) — "
        "[one line description]\n"
        "- Documented allergy: none conflicting\n"
        "Do not write vague summaries — list the specific facts that led to "
        "any flag, with enough detail that the surgeon can verify the "
        "reasoning themselves. Write this in the same response in which you "
        "call the tool. Do not ask a yes/no question and do not wait for "
        "confirmation — the approval workflow itself is the confirmation "
        "step, your note is supporting context shown alongside it, not a "
        "gate before it. This holds EVEN when there is a documented allergy "
        "conflict or drug interaction: never halt the action to ask for "
        "confirmation first and never wait for the surgeon to say 'yes' or "
        "'proceed'. On the very first turn where you have gathered enough to "
        "propose the change, call update_prescription and put all the "
        "supporting facts in that same message. Producing a separate 'action "
        "halted, please confirm' message before proposing is wrong — the "
        "single message carrying the approval card must already contain every "
        "fact the surgeon needs.\n\n"
        "Other formatting instructions:\n"
        "Format responses in clean markdown using only headers, bold, "
        "italics, and bullet lists. Do not use emojis, blockquotes, or code "
        "blocks. Do not use horizontal rules. Keep formatting consistent: "
        "section titles as bold headers, data as bullet points. Only "
        "surface information from the tool results. The surgeon's ID is "
        "always provided automatically by the system. Never ask the "
        "surgeon for their ID under any circumstances, not even a "
        "placeholder value."
    )


def is_exchange_start(message: dict) -> bool:
    return (
        message["role"] == "user" and
        isinstance(message["content"], str)
    )


def truncate_history(messages: list, max_exchanges: int = 10) -> list:
    exchange_starts = [
        i for i, msg in enumerate(messages)
        if is_exchange_start(msg)
    ]

    if len(exchange_starts) >= max_exchanges:
        cut_point = exchange_starts[-max_exchanges]
        return messages[cut_point:]
    else:
        return messages


async def _agent_loop(user_message: str, surgeon_id: int, channel_id: str, out: asyncio.Queue):
    """
    The agent orchestration loop. Runs inside ONE background task that owns the
    MCP stdio_client session from start to finish, and emits events by putting
    them on `out` instead of yielding them.

    Why not just yield directly (as this used to)? stdio_client runs an anyio
    task group / cancel scope. When an async generator is SUSPENDED at a yield
    inside that scope and then resumed by Starlette's StreamingResponse from a
    different task, anyio deadlocks — silently, with no exception. That's the
    bug that hung every multi-tool-call request on its 2nd tool round. Pushing
    to a queue keeps the cancel scope entirely within this one task; the thin
    generator below (ask_agent_stream) drains the queue and does the yielding,
    outside the scope. The loop logic itself is unchanged.
    """
    client = anthropic.AsyncAnthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))
    WRITE_TOOLS = {"update_prescription", "create_pending_approval"}
    STEP_LABELS = {
        "find_patient_by_name":    "Looking up patient records",
        "get_patient_allergies":   "Checking allergy history",
        "get_active_medications":  "Reviewing active medications",
        "get_active_prescription": "Checking current prescription",
        "update_prescription":     "Preparing prescription update",
        "get_pending_approvals":   "Checking pending approvals",
        "create_pending_approval": "Submitting for surgeon approval",
        "get_medication_by_name":  "Checking for the correct medication",
        "get_patient_documents": "Retrieving all relevant clinical documents",
        "check_drug_interactions": "Checking drug interactions",
    }

    if channel_id not in conversation_histories:
        conversation_histories[channel_id] = []

    conversation_histories[channel_id].append({
        "role": "user",
        "content": user_message
    })

    server_params = StdioServerParameters(
        command=sys.executable,
        args=["server.py"]
    )

    async with stdio_client(server_params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()

            mcp_tools = await session.list_tools()
            tools = [
                {
                    "name": t.name,
                    "description": t.description,
                    "input_schema": t.inputSchema
                }
                for t in mcp_tools.tools
            ]

            while True:
                messages = truncate_history(conversation_histories[channel_id])
                response = await client.messages.create(
                    model="claude-sonnet-4-6",
                    max_tokens=1024,
                    system=get_system_prompt(),
                    tools=tools,
                    messages=messages
                )
                print(f"TOKENS — input: {response.usage.input_tokens}, output: {response.usage.output_tokens}")

                if response.stop_reason == "end_turn":
                    final_response = response.content[0].text
                    conversation_histories[channel_id].append({
                        "role": "assistant",
                        "content": final_response
                    })
                    await out.put({"type": "final", "content": final_response})
                    return

                if response.stop_reason == "tool_use":
                    has_write_tool = any(
                        block.type == "tool_use" and block.name in WRITE_TOOLS
                        for block in response.content
                    )

                    if has_write_tool:
                        for block in response.content:
                            if block.type == "text" and block.text.strip():
                                await out.put({"type": "context", "content": block.text})

                    tool_results = []
                    for block in response.content:
                        if block.type == "tool_use":
                            label = STEP_LABELS.get(block.name, f"Working on {block.name}")
                            await out.put({"type": "step", "content": label})

                            print(f"DEBUG: Tool called: {block.name}")
                            print(f"DEBUG: In WRITE_TOOLS: {block.name in WRITE_TOOLS}")
                            database_write = block.name in WRITE_TOOLS

                            action = ProposedAction(
                                action_type=block.name,
                                writes_to_db=database_write,
                                description=f"Tool call: {block.name}"
                            )
                            decision = classify_action(action)
                            print(f"DEBUG: Decision: {decision}")

                            if Decision.SAFE == decision:
                                # Defensive timeout so a genuinely stuck tool call
                                # surfaces as an error instead of hanging forever.
                                result = await asyncio.wait_for(
                                    session.call_tool(block.name, arguments=block.input),
                                    timeout=25,
                                )
                                tool_results.append({
                                    "type": "tool_result",
                                    "tool_use_id": block.id,
                                    "content": str(result.content)
                                })

                            if decision == Decision.NEEDS_APPROVAL:
                                print(f"DEBUG: NEEDS_APPROVAL triggered for {block.name}")
                                approval_id = None
                                try:
                                    approval_id = create_pending_approval(
                                        action_type=block.name,
                                        action_payload=block.input,
                                        description=f"Approval required for {block.name}",
                                        approver_id=surgeon_id
                                    )
                                    print(f"DEBUG: Created approval with id {approval_id}")
                                except Exception as e:
                                    print(f"DEBUG: create_pending_approval failed: {e}")

                                tool_results.append({
                                    "type": "tool_result",
                                    "tool_use_id": block.id,
                                    "content": f"Action requires surgeon approval. Approval ID: {approval_id}. Awaiting decision."
                                })

                                # close out tool_use/tool_result pairing in
                                # REAL history before the early return
                                conversation_histories[channel_id].append({
                                    "role": "assistant",
                                    "content": response.content
                                })
                                conversation_histories[channel_id].append({
                                    "role": "user",
                                    "content": tool_results
                                })

                                if approval_id is not None:
                                    await out.put({
                                        "type": "approval",
                                        "approval_id": approval_id,
                                        "action": block.name,
                                        "fields": dict(block.input),
                                    })
                                return

                    # all tools in this turn were SAFE — close out history
                    # and continue the loop
                    conversation_histories[channel_id].append({
                        "role": "assistant",
                        "content": response.content
                    })
                    conversation_histories[channel_id].append({
                        "role": "user",
                        "content": tool_results
                    })


async def ask_agent_stream(user_message: str, surgeon_id: int, channel_id: str):
    """
    Thin async generator that StreamingResponse iterates. It ONLY drains a
    queue fed by _agent_loop (running in a separate task) — so the yield here
    lives outside the MCP stdio_client anyio task group, which is what used to
    deadlock. See _agent_loop's docstring for the full rationale.
    """
    out: asyncio.Queue = asyncio.Queue()
    DONE = object()

    async def worker():
        try:
            await _agent_loop(user_message, surgeon_id, channel_id, out)
        except Exception:
            # Real traceback to stderr (flushes in real-time on Railway), plus a
            # user-facing error event so the request always terminates cleanly
            # instead of hanging.
            traceback.print_exc()
            await out.put({
                "type": "error",
                "content": "Something went wrong reaching the clinical database. Please try again.",
            })
        finally:
            await out.put(DONE)

    task = asyncio.create_task(worker())
    try:
        while True:
            item = await out.get()
            if item is DONE:
                break
            yield item
    finally:
        # If the client disconnects mid-stream, cancel the worker so the MCP
        # subprocess and its anyio task group are torn down instead of leaking.
        if not task.done():
            task.cancel()
            try:
                await task
            except BaseException:
                pass
