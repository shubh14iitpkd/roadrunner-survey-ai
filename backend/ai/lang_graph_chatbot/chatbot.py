"""
LangGraph Chatbot — Main Chatbot Class
Drop-in replacement for LangChatbot with the same interface.
"""

import logging
import time
from typing import Optional
from langchain_core.messages import HumanMessage

from ai.lang_graph_chatbot.graph import get_graph
from ai.lang_graph_chatbot.state import ResponseType, extract_text_content

logger = logging.getLogger("chatbot")


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
        logger.info(f"Chatbot initialized | route_id={route_id} | chat_id={self.chat_id} | user_id={user_id}")

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

        logger.info(f"Question: '{question[:120]}' | route_id={effective_route_id} | chat_id={effective_chat_id}")

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
            t0 = time.time()
            result = self.graph.invoke(input_state, config)
            elapsed = time.time() - t0

            logger.info(f"Graph completed in {elapsed:.1f}s | messages_count={len(result.get('messages', []))}")

            # Extract the validated final response
            final = result.get("final_response")
            if final and final.strip():
                logger.info(f"Final response (first 150): {final[:150]}")
                return final

            # Fallback: try to get from last AI message
            logger.warning("No final_response in result, trying message fallback")
            for msg in reversed(result.get("messages", [])):
                if hasattr(msg, "type") and msg.type == "ai" and msg.content:
                    text = extract_text_content(msg.content)
                    logger.info(f"Recovered from AI message (first 150): {text[:150]}")
                    return text

            logger.error("No response could be extracted from graph result")
            return "I'm sorry, I couldn't generate a response. Please try again."

        except Exception as e:
            logger.error(f"Graph execution failed: {e}", exc_info=True)
            return "I apologize, but I encountered an error processing your request. Please try again."

    def set_route(self, route_id: int):
        """Set active route for queries."""
        self.route_id = route_id
        logger.info(f"Route set to {route_id}")
