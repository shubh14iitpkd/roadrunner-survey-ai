"""
LangGraph Chatbot — Main Chatbot Class
Drop-in replacement for LangChatbot with the same interface.
"""

from typing import Optional
from langchain_core.messages import HumanMessage

from ai.lang_graph_chatbot.graph import get_graph
from ai.lang_graph_chatbot.state import ResponseType, extract_text_content


class LangGraphChatbot:
    """
    LangGraph-based chatbot for road survey queries.
    Uses a state-machine graph with router, expert, tool, formatter, and validator nodes.
    Supports conversation persistence via LangGraph memory checkpointer.
    """

    def __init__(
        self,
        route_id: Optional[int] = None,
        chat_id: Optional[str] = None,
        user_id: Optional[str] = None,
    ):
        """
        Initialize chatbot with optional context.

        Args:
            route_id: Route number for survey queries (primary context)
            chat_id: Chat identifier for conversation memory (thread_id)
            user_id: User identifier for display name preferences
        """
        self.route_id = route_id
        self.chat_id = chat_id or "default"
        self.user_id = user_id
        self.graph = get_graph()

    def ask(self, question: str, route_id: int = None, chat_id: str = None) -> str:
        """
        Ask a question to the chatbot.

        Args:
            question: User's question
            route_id: Optional route ID override
            chat_id: Optional chat ID override for memory thread

        Returns:
            The chatbot's response string
        """
        effective_route_id = route_id if route_id is not None else self.route_id
        effective_chat_id = chat_id or self.chat_id

        # Build the initial state
        input_state = {
            "messages": [HumanMessage(content=question)],
            "intent": None,  # will be set by router
            "response_type": ResponseType.TEXT,  # will be set by router
            "route_id": effective_route_id,
            "user_id": self.user_id,
            "final_response": None,
        }

        # Config for memory persistence — thread_id enables chat history
        config = {
            "configurable": {
                "thread_id": effective_chat_id,
            }
        }

        try:
            # Run the graph
            result = self.graph.invoke(input_state, config)

            # Extract the validated final response
            final = result.get("final_response")
            if final and final.strip():
                return final

            # Fallback: try to get from last AI message
            for msg in reversed(result.get("messages", [])):
                if hasattr(msg, "type") and msg.type == "ai" and msg.content:
                    return extract_text_content(msg.content)

            return "I'm sorry, I couldn't generate a response. Please try again."

        except Exception as e:
            print(f"[LangGraphChatbot] Error: {e}")
            import traceback
            traceback.print_exc()
            return "I apologize, but I encountered an error processing your request. Please try again."

    def set_route(self, route_id: int):
        """Set active route for queries."""
        self.route_id = route_id
