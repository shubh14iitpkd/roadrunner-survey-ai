"""
Langchain Chatbot - Main Entry Point
RoadSight AI chatbot for road survey analysis
"""

# import sys
# import os
# sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

from typing import Optional
from ai.lang_chatbot.agents import agent_factory, get_agent_with_context
from dotenv import load_dotenv
load_dotenv()


class LangChatbot:
    """
    Langchain-based chatbot for road survey queries.
    Supports both demo videos and regular MongoDB-backed videos.
    Uses LangGraph memory for conversation persistence.
    """
    
    def __init__(self, video_id: Optional[str] = None, route_id: Optional[int] = None, chat_id: Optional[str] = None):
        """
        Initialize chatbot with optional context.
        
        Args:
            video_id: Video identifier for queries
            route_id: Route number for survey queries
            chat_id: Chat identifier for conversation memory (thread_id)
        """
        self.video_id = video_id
        self.route_id = route_id
        self.chat_id = chat_id or "default_thread"
        self.agent = agent_factory(video_id=video_id)
    
    def ask(self, question: str, video_id: str = None, chat_id: str = None) -> str:
        """
        Ask question to the chatbot with conversation memory.
        
        Args:
            question: User's question
            video_id: Optional video ID override
            chat_id: Optional chat ID for memory thread
        
        Returns:
            Agent's response
        """
        vid = video_id or self.video_id
        thread_id = chat_id or self.chat_id
        
        # Inject video context if provided
        if vid:
            context_msg = f"[Context: Active video is {vid}]\n\n"
            full_question = context_msg + question
        else:
            full_question = question
        
        try:
            # Configure thread for memory persistence
            config = {"configurable": {"thread_id": thread_id}}
            
            response = self.agent.invoke(
                {"messages": [("user", full_question)]},
                config=config  # Pass thread config for memory
            )
            
            # Extract final answer
            if "messages" in response and response["messages"]:
                answer = response["messages"][-1].content
                
                # Validate and sanitize response - ensure it's a valid string
                answer = self._validate_response(answer)
                return answer
            
            return "I couldn't process your question. Please try again."
            
        except Exception as e:
            print(f"[LangChatbot] Error: {e}")
            import traceback
            traceback.print_exc()
            return "I apologize, but I encountered an issue processing your request. Please try rephrasing your question."
    
    def _validate_response(self, answer) -> str:
        """
        Validate and sanitize the agent response to ensure it's valid markdown.
        Returns a polite error message if response is invalid.
        """
        # Handle None
        if answer is None:
            return "I wasn't able to generate a response. Please try again."
        
        # Handle list responses - common in LangChain multimodal messages
        # Format: [{'type': 'text', 'text': 'actual response'}, ...]
        if isinstance(answer, list):
            print(f"[LangChatbot] DEBUG: Response was a list with {len(answer)} items")
            text_parts = []
            for item in answer:
                if isinstance(item, dict):
                    # LangChain content part format
                    if item.get("type") == "text" and "text" in item:
                        text_parts.append(item["text"])
                    elif "content" in item:
                        text_parts.append(str(item["content"]))
                    elif "text" in item:
                        text_parts.append(str(item["text"]))
                elif isinstance(item, str):
                    text_parts.append(item)
                else:
                    text_parts.append(str(item))
            
            if text_parts:
                answer = "\n".join(text_parts)
            else:
                return "I received an unexpected response format. Please try rephrasing your question."
        
        # Handle dict/object responses - convert to string or extract content
        if isinstance(answer, dict):
            print(f"[LangChatbot] DEBUG: Response was a dict")
            # Check for LangChain content part format
            if answer.get("type") == "text" and "text" in answer:
                answer = answer["text"]
            elif "content" in answer:
                answer = str(answer["content"])
            elif "text" in answer:
                answer = str(answer["text"])
            elif "output" in answer:
                answer = str(answer["output"])
            else:
                # Last resort - stringify
                try:
                    import json
                    answer = json.dumps(answer, indent=2)
                except Exception:
                    return "I received an unexpected response format. Please try rephrasing your question."
        
        # Ensure it's a string
        if not isinstance(answer, str):
            try:
                answer = str(answer)
            except Exception:
                return "I received an unexpected response format. Please try rephrasing your question."
        
        # Check for empty response
        if not answer.strip():
            return "I wasn't able to generate a meaningful response. Please try again."
        
        return answer
    
    def set_video(self, video_id: str):
        """Set active video for queries"""
        self.video_id = video_id
        self.agent = agent_factory(video_id=video_id)
    
    def set_route(self, route_id: int):
        """Set active route for queries"""
        self.route_id = route_id


def get_lang_chatbot(video_id: str = None) -> LangChatbot:
    """Factory function for chatbot instance"""
    return LangChatbot(video_id=video_id)


# =============================================================================
# CLI INTERFACE FOR TESTING
# =============================================================================

if __name__ == "__main__":
    print("\n" + "=" * 60)
    print("ROADSIGHT AI - Langchain Chatbot")
    print("=" * 60)
    # Default to demo video for testing
    # demo_video = "2025_0817_115147_F"
    # chatbot = LangChatbot(video_id=demo_video)
    chatbot = LangChatbot()
    
    # print(f"\nActive video: {demo_video}")
    print("Type 'exit' to quit, 'video <id>' to switch videos\n")
    
    # Run some test queries automatically
    test_queries = [
        # "Describe the video and what assets were found in it",
        # "What are the asset categories?",
        # "How many street lights are there?",
        # "What's the road condition?",
        # "Who conducted most surveys?",
        # "When and who conducted surveys?",
        # "List of all surveys",
        # "What things were found in most recent survey",
        # "Give me summary of road condition",
        # "Who conducted most surveys?"
        # "Give a summary of video",
        # "What's the total number of assets?",
        # "What are different asset categories?",
        # "List all the assets with counts",
        # "Which assets are in poor condition?",
        # "What is at frame 60?",
        # "Rank asset categories by defects",
        # "Condition of traffic sign",
        # "What is the condition of traffic signal",
        # "How many street lights are there?",
        # "How many road markings are present?",
        # "How many routes we have surveyed?",
        # "Which asset category has most defects?",
        "Tell me about route 258",
    ]
    
    print("--- Running test queries ---\n")
    for q in test_queries:
        print(f">>> {q}")
        answer = chatbot.ask(q)
        print(f"{answer}\n")
        print("-" * 40)
    
    # Interactive mode
    # print("\n--- Interactive Mode ---\n")
    # while True:
    #     try:
    #         user_input = input("User: ").strip()
    #     except (EOFError, KeyboardInterrupt):
    #         print("\nGoodbye!")
    #         break
        
    #     if not user_input:
    #         continue
        
    #     if user_input.lower() == "exit":
    #         print("Goodbye!")
    #         break
        
    #     if user_input.lower().startswith("video "):
    #         new_video = user_input[6:].strip()
    #         chatbot.set_video(new_video)
    #         print(f"Switched to video: {new_video}\n")
    #         continue
        
    #     answer = chatbot.ask(user_input)
    #     print(f"Agent: {answer}\n")
