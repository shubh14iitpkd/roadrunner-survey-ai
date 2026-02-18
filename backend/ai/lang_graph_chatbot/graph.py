"""
LangGraph Chatbot — Graph Assembly
Wires together all nodes into a StateGraph with conditional edges.
"""

from langgraph.graph import StateGraph, END
from langgraph.checkpoint.memory import MemorySaver

from ai.lang_graph_chatbot.state import AgentState
from ai.lang_graph_chatbot.nodes.router import router_node, get_route
from ai.lang_graph_chatbot.nodes.expert import expert_node
from ai.lang_graph_chatbot.nodes.tool_node import agent_node, tool_node, should_continue_tools
from ai.lang_graph_chatbot.nodes.formatter import formatter_node
from ai.lang_graph_chatbot.nodes.validator import validator_node

# Global memory saver for conversation persistence across chat_ids
_memory_saver = MemorySaver()


def build_graph():
    """
    Build and compile the LangGraph chatbot graph.

    Flow:
        router → expert → validator → END
        router → agent ⇄ tools → formatter/validator → END
    """
    graph = StateGraph(AgentState)

    # Add nodes
    graph.add_node("router", router_node)
    graph.add_node("expert", expert_node)
    graph.add_node("agent", agent_node)
    graph.add_node("tools", tool_node)
    graph.add_node("formatter", formatter_node)
    graph.add_node("validator", validator_node)

    # Entry point
    graph.set_entry_point("router")

    # Router → expert or agent (tool/visualization both go to agent first)
    graph.add_conditional_edges(
        "router",
        get_route,
        {
            "expert": "expert",
            "agent": "agent",
        },
    )

    # Expert → validator → END
    graph.add_edge("expert", "validator")

    # Agent → tools (if tool_calls) or formatter/validator (if done)
    graph.add_conditional_edges(
        "agent",
        should_continue_tools,
        {
            "tools": "tools",
            "formatter": "formatter",
            "validator": "validator",
        },
    )

    # Tools → back to agent (for multi-step tool calling)
    graph.add_edge("tools", "agent")

    # Formatter → validator → END
    graph.add_edge("formatter", "validator")
    graph.add_edge("validator", END)
    g = graph.compile(checkpointer=_memory_saver)
    # img = g.get_graph().draw_ascii()
    # print(img)
    return g


# Singleton compiled graph
_compiled_graph = None


def get_graph():
    """Get the singleton compiled graph instance."""
    global _compiled_graph
    if _compiled_graph is None:
        _compiled_graph = build_graph()
    return _compiled_graph
