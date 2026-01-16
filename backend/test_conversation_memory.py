"""Test conversation memory feature"""
import sys
sys.path.insert(0, '/Volumes/WD_2TB/Projects/dev_lenovo/RoadVisionAI/roadrunner-survey-ai-neelansh-demo/backend')

from ai.chatbot_ai import get_chatbot

chatbot = get_chatbot()

print("=" * 80)
print("TESTING CONVERSATION MEMORY")
print("=" * 80)

# Simulate a conversation
conversation_history = []

# Question 1
q1 = "How many street lights are on route 105?"
print(f"\nUser: {q1}")
a1 = chatbot.ask(q1, conversation_history)
print(f"AI: {a1}")
conversation_history.append({"role": "user", "content": q1})
conversation_history.append({"role": "assistant", "content": a1})

# Question 2 - referring back to previous question
q2 = "And how many road markings are on that same route?"
print(f"\nUser: {q2}")
a2 = chatbot.ask(q2, conversation_history)
print(f"AI: {a2}")
conversation_history.append({"role": "user", "content": q2})
conversation_history.append({"role": "assistant", "content": a2})

# Question 3 - follow-up
q3 = "What about frames with detections on that route?"
print(f"\nUser: {q3}")
a3 = chatbot.ask(q3, conversation_history)
print(f"AI: {a3}")

print("\n" + "=" * 80)
print("Memory test complete! AI should have understood context from previous questions.")
print("=" * 80)
