# Shared in-memory state. Lives in its own module so both client.py (the
# agent loop) and tools.py (resolve_approval) can import it without a
# circular import between the two.
conversation_histories: dict = {}