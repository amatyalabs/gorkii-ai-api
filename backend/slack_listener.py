import os
import asyncio
from dotenv import load_dotenv
from slack_bolt.async_app import AsyncApp
from slack_bolt.adapter.socket_mode.async_handler import AsyncSocketModeHandler
from client import ask_agent

load_dotenv()

app = AsyncApp(token=os.getenv("SLACK_BOT_TOKEN"))

@app.event("message")
async def handle_message(event, say):
    text = event.get("text")
    channel_id = event.get("channel")
    response = await ask_agent(text, surgeon_id=1, channel_id=channel_id)
    await say(response)
    

async def main():
    handler = AsyncSocketModeHandler(app, os.getenv("SLACK_APP_TOKEN"))
    await handler.start_async()

asyncio.run(main())