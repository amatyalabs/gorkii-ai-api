import asyncio, os, anthropic
from dotenv import load_dotenv
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

load_dotenv()

async def ask_agent(user_message: str) -> str:
    client = anthropic.AsyncAnthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))

    # Tell the MCP client how to start your server
    server_params = StdioServerParameters(
        command="uv",
        args=["run", "python", "server.py"]
    )

    async with stdio_client(server_params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()

            # Ask the server: what tools do you have?
            mcp_tools = await session.list_tools()

            # Convert MCP tool format → Anthropic tool format
            tools = [
                {
                    "name": t.name,
                    "description": t.description,
                    "input_schema": t.inputSchema
                }
                for t in mcp_tools.tools
            ]

            messages = [
                {"role": "user", "content": user_message}
            ]

            # Agent loop
            while True:
                response = await client.messages.create(
                    model="claude-sonnet-4-6",
                    max_tokens=1024,
                    tools=tools,
                    messages=messages
                )

                # If Claude is done, print and exit
                if response.stop_reason == "end_turn":
                    return response.content[0].text

                # If Claude wants to call a tool
                if response.stop_reason == "tool_use":
                    # Add Claude's response to message history
                    messages.append({
                        "role": "assistant",
                        "content": response.content
                    })

                    # Execute each tool Claude asked for
                    tool_results = []
                    for block in response.content:
                        if block.type == "tool_use":
                            result = await session.call_tool(
                                block.name,
                                arguments=block.input
                            )
                            tool_results.append({
                                "type": "tool_result",
                                "tool_use_id": block.id,
                                "content": str(result.content)
                            })

                    # Feed results back to Claude
                    messages.append({
                        "role": "user",
                        "content": tool_results
                    })