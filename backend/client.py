import asyncio, os, anthropic
from dotenv import load_dotenv
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client
from tools import ProposedAction, Decision, classify_action, create_pending_approval

load_dotenv()

conversation_histories = {}

async def ask_agent(user_message: str, surgeon_id: int, channel_id: str) -> str:
    client = anthropic.AsyncAnthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))
    WRITE_TOOLS = {"update_prescription", "create_pending_approval"}
    
    if channel_id not in conversation_histories:
        conversation_histories[channel_id] = []
    
    # add new message to existing history
    conversation_histories[channel_id].append({
        "role": "user", 
        "content": user_message
    })
    
    messages = conversation_histories[channel_id]

    # tell the MCP client how to start your server
    server_params = StdioServerParameters(
        command="uv",
        args=["run", "python", "server.py"]
    )

    async with stdio_client(server_params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()

            # ask the server what tools do you have?
            mcp_tools = await session.list_tools()

            # convert MCP tool format into Anthropic tool format
            tools = [
                {
                    "name": t.name,
                    "description": t.description,
                    "input_schema": t.inputSchema
                }
                for t in mcp_tools.tools
            ]

            # agent loop
            while True:
                response = await client.messages.create(
                    model="claude-sonnet-4-6",
                    max_tokens=1024,
                    tools=tools,
                    messages=messages
                )

                # if claude is done then print and exit
                if response.stop_reason == "end_turn":
                    final_response = response.content[0].text
                    conversation_histories[channel_id].append({
                        "role": "assistant",
                        "content": final_response
                    })
                    return final_response

                # if claude wants to call a tool
                if response.stop_reason == "tool_use":
                    # add claude's response to chat history
                    messages.append({
                        "role": "assistant",
                        "content": response.content
                    })

                    # execute every tool that claude asks for
                    tool_results = []
                    for block in response.content:
                        if block.type == "tool_use":
                            print(f"DEBUG: Tool called: {block.name}")  # add this
                            print(f"DEBUG: In WRITE_TOOLS: {block.name in WRITE_TOOLS}")  # add this
                            if block.name in WRITE_TOOLS:
                                database_write = True
                            else:
                                database_write = False
                                
                            action = ProposedAction(
                                action_type=block.name,
                                writes_to_db=database_write,
                                description=f"Tool call: {block.name}"
                            )
                            decision = classify_action(action)
                            print(f"DEBUG: Decision: {decision}")  # add this

                            if (Decision.SAFE == decision):
                                result = await session.call_tool(
                                block.name,
                                arguments=block.input
                                )
                                tool_results.append({
                                    "type": "tool_result",
                                    "tool_use_id": block.id,
                                    "content": str(result.content)
                                })
                                
                            if decision == Decision.NEEDS_APPROVAL:
                                print(f"DEBUG: NEEDS_APPROVAL triggered for {block.name}")  # add this
                                try:
                                    approval_id = create_pending_approval(
                                        action_type=block.name,
                                        action_payload=block.input,
                                        description=f"Approval required for {block.name}",
                                        approver_id=surgeon_id
                                    )
                                    print(f"DEBUG: Created approval with id {approval_id}")  # add this
                                except Exception as e:
                                    print(f"DEBUG: create_pending_approval failed: {e}")  # add this
                                tool_results.append({
                                    "type": "tool_result",
                                    "tool_use_id": block.id,
                                    "content": "This action requires surgeon approval."
                                })
                    # feed results back to claude
                    messages.append({
                        "role": "user",
                        "content": tool_results
                    })